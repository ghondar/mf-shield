import { createInstance, init, loadRemote, registerRemotes } from "@module-federation/runtime";
import type { ModuleFederationRuntimePlugin } from "@module-federation/runtime";

import { evaluateRemoteAccess, validateSharedSingletons } from "./core";
import type { RemoteAccessDecision, SharedModules, ShareStrategy } from "./core";
import { FederationIntegrityError, RemoteAccessDeniedError, RemoteModuleNullError } from "./errors";

export type { SharedConfig, SharedModule, SharedModules, ShareStrategy } from "./core";

export type RemoteEntry<Name extends string> = { name: Name; entry: string };

type FederationInitOptions = Parameters<typeof init>[0];

export type FederationRemote = {
  name: string;
  entry?: string;
  alias?: string;
  shareScope?: string | string[];
};

export type FederationRuntimeOptions<RemoteName extends string = string> = {
  name: string;
  remoteEntries: Record<RemoteName, RemoteEntry<RemoteName>>;
  version?: string;
  shared?: SharedModules;
  remotes?: FederationRemote[];
  plugins?: FederationInitOptions["plugins"];
  shareStrategy?: ShareStrategy;
};

export function initFederationShield(options: FederationInitOptions) {
  return init({ ...options, remotes: options.remotes ?? [] });
}

function warnSharedSingletons(shared?: SharedModules, shareStrategy?: ShareStrategy) {
  if (!shared) return;
  for (const warning of validateSharedSingletons({ shared, shareStrategy })) {
    console.warn(`[mf-shield] ${warning}`);
  }
}

export function createFederationRuntime<RemoteName extends string>({
  remoteEntries,
  remotes = [],
  ...options
}: FederationRuntimeOptions<RemoteName>) {
  warnSharedSingletons(options.shared, options.shareStrategy);
  initFederationShield({ ...options, remotes } as FederationInitOptions);
  return createFederatedLoader(remoteEntries);
}

/**
 * Igual que `createFederationRuntime`, pero crea una **instancia aislada** vía `createInstance` en vez de
 * `init`. Úsalo para un segundo runtime en la misma página/app.
 *
 * En @module-federation/runtime 2.6.0 `init()` es un singleton por nombre: llamar `init({ name })` con un
 * nombre distinto al ya inicializado lanza en runtime (`#RUNTIME-010`, "The name option cannot be changed
 * after initialization"). `createInstance` construye una instancia nueva e independiente y el loader devuelto
 * queda ligado a ella (`instance.registerRemotes` + `instance.loadRemote`), sin tocar el runtime primario.
 */
export function createInstanceFederationRuntime<RemoteName extends string>({
  remoteEntries,
  remotes = [],
  ...options
}: FederationRuntimeOptions<RemoteName>) {
  warnSharedSingletons(options.shared, options.shareStrategy);
  const instance = createInstance({ ...options, remotes } as FederationInitOptions);
  const registeredRemotes = new Set<RemoteName>();

  return async function loadFederatedModule<T>(id: `${RemoteName}/${string}`): Promise<T> {
    const remoteName = id.split("/")[0] as RemoteName;

    if (!registeredRemotes.has(remoteName)) {
      instance.registerRemotes([remoteEntries[remoteName]]);
      registeredRemotes.add(remoteName);
    }

    const module = await instance.loadRemote<T>(id);
    if (!module) throw new RemoteModuleNullError(id);
    return module;
  };
}

export function createFederatedLoader<RemoteName extends string>(remoteEntries: Record<RemoteName, RemoteEntry<RemoteName>>) {
  const registeredRemotes = new Set<RemoteName>();

  return async function loadFederatedModule<T>(id: `${RemoteName}/${string}`): Promise<T> {
    const remoteName = id.split("/")[0] as RemoteName;

    if (!registeredRemotes.has(remoteName)) {
      registerRemotes([remoteEntries[remoteName]]);
      registeredRemotes.add(remoteName);
    }

    const module = await loadRemote<T>(id);
    if (!module) throw new RemoteModuleNullError(id);
    return module;
  };
}

export type RemoteAccessPluginOptions = {
  policy: (remoteName: string) => RemoteAccessDecision;
  onDenied?: (info: { remote: string; reason: string }) => void;
};

/**
 * Plugin de runtime MF (`FederationRuntimePlugin`) que evalúa una política de acceso en el hook
 * `beforeRequest`, ANTES de resolver el remote. El `id` del hook es `"<remoteName>/<expose>"`;
 * se extrae `remoteName` y se pasa a `policy`. Si la decisión es denegada llama a `onDenied` y
 * lanza `RemoteAccessDeniedError` con el mensaje `federation: <reason>`; si es permitida devuelve
 * los args sin modificar para que el waterfall continúe.
 */
export function createRemoteAccessPlugin({ policy, onDenied }: RemoteAccessPluginOptions): ModuleFederationRuntimePlugin {
  return {
    name: "mf-shield-remote-access",
    beforeRequest(args) {
      const remote = args.id.split("/")[0] ?? args.id;
      const decision = evaluateRemoteAccess(() => policy(remote));

      if (!decision.allowed) {
        const reason = decision.reason ?? "access denied before remote import";
        onDenied?.({ remote, reason });
        throw new RemoteAccessDeniedError(reason);
      }

      return args;
    }
  };
}

export type RemoteFallbackLifecycle = "beforeRequest" | "beforeLoadShare" | "afterResolve" | "onLoad";

export type RemoteFallbackInfo = {
  id: string;
  error: unknown;
  lifecycle: RemoteFallbackLifecycle;
  from: "build" | "runtime";
};

export type RemoteFallbackPluginOptions = {
  fallback: (info: RemoteFallbackInfo) => unknown | undefined;
};

/**
 * Plugin de runtime MF (`FederationRuntimePlugin`) que intercepta fallos de carga de remotes en el
 * hook `errorLoadRemote`. Llama a `fallback` con info normalizada (`id`, `error`, `lifecycle`, `from`).
 *
 * Contrato de retorno (verificado en runtime-core 2.6.0):
 * - Si `fallback` devuelve `undefined`, el plugin no retorna nada y el error original se propaga por el flujo normal.
 * - Si el fallo ocurre en el `lifecycle: "onLoad"` (falla real al resolver/cargar el módulo remoto), un valor
 *   devuelto se usa como **contenido del módulo remoto**. Para que un componente React del caller funcione al
 *   cargarse vía `createFederatedLoader` + `RemoteSlot`, devuelve el **objeto módulo** con el mismo shape que
 *   expone el remote (p. ej. `{ RemoteWidget: MiFallback }`), no el componente solo; `loadRemote(id)` resuelve
 *   a ese objeto. Una función se interpreta como *module factory*.
 * - Si el fallo ocurre en cualquier lifecycle previo a la carga (`"beforeRequest"`, `"beforeLoadShare"`,
 *   `"afterResolve"`), MF interpreta el valor devuelto como **args de request de reemplazo** `{ id, options, origin }`
 *   para redirigir a otro remote, no como módulo. Para simplemente propagar el error devuelve `undefined` en esos
 *   lifecycles: solo los retornos en `"onLoad"` son contenido de módulo.
 */
export function createRemoteFallbackPlugin({ fallback }: RemoteFallbackPluginOptions): ModuleFederationRuntimePlugin {
  return {
    name: "mf-shield-remote-fallback",
    errorLoadRemote(args) {
      const result = fallback({ id: args.id, error: args.error, lifecycle: args.lifecycle, from: args.from });
      if (result === undefined) return;
      return result;
    }
  };
}

/**
 * Fuente de hashes SRI: un mapa `url -> "sha384-..."` o una función resolver `(url) => hash | undefined`.
 * El matching contra el mapa es por **URL exacta** (sin normalizar trailing slash ni query): la URL que
 * recibe el hook de MF debe coincidir carácter a carácter con la clave del mapa. Para lógica flexible
 * (prefijos de origen, ignorar query, etc.) usa la variante función.
 */
export type IntegritySource = Record<string, string> | ((url: string) => string | undefined);

export type SriPluginOptions = {
  /** Mapa `url -> hash` o resolver `(url) => hash`. Ver {@link IntegritySource}. */
  integrity: IntegritySource;
  /**
   * `true` (default): una URL sin hash registrado lanza {@link FederationIntegrityError} y bloquea la carga.
   * `false`: pasa la URL sin tocar (MF crea su `<script>`/`<link>` normal, sin `integrity`).
   */
  strict?: boolean;
  /**
   * `crossOrigin` a setear en el elemento (default `"anonymous"`). SRI en assets cross-origin **requiere**
   * `crossorigin`; sin él el browser trata el recurso como opaco y falla la verificación.
   */
  crossOrigin?: "anonymous" | "use-credentials";
  /** Se llama con la URL bloqueada justo antes de lanzar en modo estricto. */
  onViolation?: (info: { url: string }) => void;
};

/**
 * Resuelve el hash SRI de una URL desde un {@link IntegritySource}. Lógica pura, sin DOM.
 *
 * - Mapa: match por URL **exacta** (`source[url]`), sin normalización de slash/query.
 * - Función: se delega la resolución al resolver.
 *
 * @returns el hash (`"sha384-..."`) o `undefined` si no hay entrada para la URL.
 */
export function resolveIntegrity(source: IntegritySource, url: string): string | undefined {
  if (typeof source === "function") return source(url);
  return Object.prototype.hasOwnProperty.call(source, url) ? source[url] : undefined;
}

type SriHookInput = { url: string; attrs?: Record<string, unknown> };

function buildSriElement<E extends HTMLScriptElement | HTMLLinkElement>(
  element: E,
  urlAttr: "src" | "href",
  { url, attrs }: SriHookInput,
  hash: string,
  crossOrigin: NonNullable<SriPluginOptions["crossOrigin"]>
): E {
  // Al devolver nuestro propio elemento, MF NO corre su loop de `attrs` (verificado en sdk 2.6.0 dom.js):
  // por eso copiamos los attrs recibidos (p. ej. `type`, `fetchpriority`) para no perder los defaults de MF.
  if (attrs) {
    for (const name of Object.keys(attrs)) {
      const value = attrs[name];
      if (value != null) element.setAttribute(name, String(value));
    }
  }
  element.setAttribute(urlAttr, url);
  element.setAttribute("integrity", hash);
  element.crossOrigin = crossOrigin;
  return element;
}

/**
 * Plugin de runtime MF (`FederationRuntimePlugin`) que aplica **Subresource Integrity** a los assets
 * federados vía los hooks oficiales `createScript` (remoteEntry y chunks) y `createLink` (preload/CSS).
 *
 * Por cada asset construye el elemento con `integrity` + `crossOrigin` a partir del hash registrado y lo
 * devuelve al hook. En @module-federation 2.6.0, si `createScript` devuelve un `HTMLScriptElement`, MF usa
 * **ese** elemento tal cual (no reaplica sus `attrs` ni pisa el `src`/`integrity`), y lo appendea a
 * `document.head` **después** de que el hook retorna, así el browser verifica la integridad al hacer fetch.
 *
 * Gotcha: si ya existe en el DOM un `<script>` con un `src` que coincide con la URL del asset, MF reutiliza
 * ese elemento y **omite** el hook `createScript`, así que un tag pre-existente para la misma URL no recibe
 * `integrity` (p. ej. un remoteEntry preinyectado en el HTML o por otra carga previa).
 *
 * Modos:
 * - `strict` (default): URL sin hash -> `onViolation` + lanza {@link FederationIntegrityError} (gate sin
 *   depender de la variabilidad de SRI del browser).
 * - `strict: false`: URL sin hash -> devuelve `void`, MF crea su elemento normal sin `integrity`.
 *
 * SRI fija los **bytes exactos** del archivo: cada deploy del remote que cambie el bundle debe **republicar**
 * los hashes. Encaja con remotes pinneados/versionados (URLs inmutables por versión), no con URLs `latest`
 * mutables. Genera el hash con:
 *
 * ```bash
 * openssl dgst -sha384 -binary remoteEntry.js | openssl base64 -A   # => pegar como "sha384-<...>"
 * # o
 * shasum -b -a 384 remoteEntry.js | awk '{print $1}' | xxd -r -p | base64
 * ```
 *
 * `crossOrigin` es obligatorio para SRI cross-origin (default `"anonymous"`); el provider debe responder
 * con CORS que permita el origen del host.
 *
 * @example
 * ```ts
 * createSriPlugin({
 *   integrity: { "https://cdn/app/v1.2.3/remoteEntry.js": "sha384-oqVuAfXRKap7fdgcCY5..." }
 * });
 * ```
 */
export function createSriPlugin({
  integrity,
  strict = true,
  crossOrigin = "anonymous",
  onViolation
}: SriPluginOptions): ModuleFederationRuntimePlugin {
  const guard = (url: string): string | undefined => {
    const hash = resolveIntegrity(integrity, url);
    if (hash) return hash;
    if (!strict) return undefined;
    onViolation?.({ url });
    throw new FederationIntegrityError(url);
  };

  return {
    name: "mf-shield-sri",
    createScript(args) {
      const { url } = args as SriHookInput;
      const hash = guard(url);
      if (!hash) return;
      return buildSriElement(document.createElement("script"), "src", args as SriHookInput, hash, crossOrigin);
    },
    createLink(args) {
      const { url } = args as SriHookInput;
      const hash = guard(url);
      if (!hash) return;
      return buildSriElement(document.createElement("link"), "href", args as SriHookInput, hash, crossOrigin);
    }
  };
}
