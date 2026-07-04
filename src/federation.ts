import { createInstance, init, loadRemote, registerRemotes } from "@module-federation/runtime";
import type { ModuleFederation, ModuleFederationRuntimePlugin } from "@module-federation/runtime";

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
/**
 * Loader ligado a instancia, con dedup de registro por remote (`Set`), compartido por
 * {@link createInstanceFederationRuntime} y {@link createLoaderFromInstance}. Cuando `remoteEntries` es
 * `undefined`, omite todo el registro: se asume que los remotes ya están registrados en la instancia
 * (caso típico del plugin de bundler que auto-inicializa el runtime). Un módulo nulo lanza
 * {@link RemoteModuleNullError}.
 */
function bindInstanceLoader<RemoteName extends string>(
  instance: ModuleFederation,
  remoteEntries?: Record<RemoteName, RemoteEntry<RemoteName>>
) {
  const registeredRemotes = new Set<RemoteName>();

  return async function loadFederatedModule<T>(id: `${RemoteName}/${string}`): Promise<T> {
    if (remoteEntries) {
      const remoteName = id.split("/")[0] as RemoteName;
      if (!registeredRemotes.has(remoteName)) {
        instance.registerRemotes([remoteEntries[remoteName]]);
        registeredRemotes.add(remoteName);
      }
    }

    const module = await instance.loadRemote<T>(id);
    if (!module) throw new RemoteModuleNullError(id);
    return module;
  };
}

export function createInstanceFederationRuntime<RemoteName extends string>({
  remoteEntries,
  remotes = [],
  ...options
}: FederationRuntimeOptions<RemoteName>) {
  warnSharedSingletons(options.shared, options.shareStrategy);
  const instance = createInstance({ ...options, remotes } as FederationInitOptions);
  return bindInstanceLoader(instance, remoteEntries);
}

export type ShieldInstanceOptions<RemoteName extends string> = {
  /**
   * Mapa `remoteName -> RemoteEntry`. Cuando se provee, el loader registra cada remote de forma perezosa
   * en la instancia (mismo dedup por `Set` que {@link createFederatedLoader}). Cuando se omite, NO se
   * registra nada: los ids se cargan contra los remotes ya registrados en la instancia.
   */
  remoteEntries?: Record<RemoteName, RemoteEntry<RemoteName>>;
  /** Plugins de runtime registrados una sola vez, al crear el loader, vía `instance.registerPlugins`. */
  plugins?: ModuleFederationRuntimePlugin[];
};

/**
 * Crea un loader tipado ligado a una instancia de MF **ya existente**. Es el caso mayoritario del mundo real:
 * el plugin de bundler auto-inicializa el runtime y la app obtiene la instancia con `getInstance()`.
 *
 * A diferencia de {@link createInstanceFederationRuntime} (que llama a `createInstance` internamente), aquí la
 * instancia es un **parámetro**: la librería nunca llama a `getInstance()` (eso mantiene el módulo testeable y
 * desacoplado de si la instancia viene del entry `enhanced/runtime` o `runtime`). El *null-guard* de
 * `getInstance()` (que puede devolver `null` si el runtime no se inicializó) es responsabilidad del caller.
 *
 * - `options.plugins`: se registran una vez, al crear el loader, vía `instance.registerPlugins`.
 * - `options.remoteEntries`: si se provee, el loader registra cada remote perezosamente con el mismo dedup por
 *   `Set` que {@link createFederatedLoader}. Si se omite, se cargan los ids contra los remotes ya registrados.
 * - Un módulo remoto nulo lanza {@link RemoteModuleNullError}.
 *
 * @example
 * ```ts
 * import { getInstance } from "@module-federation/runtime";
 * import { createLoaderFromInstance } from "mf-shield/federation";
 *
 * const instance = getInstance();
 * if (!instance) throw new Error("MF runtime not initialized yet");
 * const loadRemote = createLoaderFromInstance(instance, { plugins: [accessPlugin] });
 * const mod = await loadRemote<{ RemoteWidget: RemoteComponent }>("stable/Widget");
 * ```
 */
export function createLoaderFromInstance<RemoteName extends string = string>(
  instance: ModuleFederation,
  options?: ShieldInstanceOptions<RemoteName>
) {
  if (options?.plugins?.length) {
    instance.registerPlugins(options.plugins);
  }
  return bindInstanceLoader(instance, options?.remoteEntries);
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

export type RemoteFallback = (info: RemoteFallbackInfo) => unknown | undefined;

/**
 * Stub de módulo remoto: el objeto módulo directo (`{ Export: value }`), o una factory (sync o async)
 * que lo produce. Una factory se invoca al aplicarse; el valor devuelto/resuelto es el contenido del módulo.
 */
export type RemoteModuleStub = Record<string, unknown> | (() => unknown) | (() => Promise<unknown>);

/**
 * Mapa declarativo `id -> stub` para el fallback. Las claves son ids completos `"<remote>/<expose>"`;
 * la clave opcional `"*"` actúa como catch-all cuando ningún id exacto matchea.
 */
export type RemoteStubMap = Record<string, RemoteModuleStub>;

/**
 * Entrada para sintetizar un manifest offline mínimo. Todo es opcional; los campos ausentes usan defaults.
 */
export type OfflineManifestInput = {
  name?: string;
  globalName?: string;
  publicPath?: string;
  remoteEntryName?: string;
};

/**
 * Tipo LOCAL mínimo del manifest MF, con exactamente los campos que `generateSnapshotFromManifest` de
 * @module-federation/sdk 2.6.0 exige como obligatorios. No se importa el tipo `Manifest` del sdk a propósito:
 * en pnpm con node_modules estricto + bundling de dts de tsdown, resolver ese tipo del lado del consumidor es
 * frágil. Este shape se verificó contra el sdk 2.6.0:
 * - Top-level requeridos: `id`, `name`, `metaData`, `shared: []`, `remotes: []`, `exposes: []`.
 * - `metaData` requeridos: `name`, `globalName`, `type`, `publicPath`, `remoteEntry`, `buildInfo`.
 * - `metaData.remoteEntry`: `{ name, path, type }`.
 * - `metaData.buildInfo`: `{ buildVersion, buildName }`.
 */
export type OfflineManifest = {
  id: string;
  name: string;
  metaData: {
    name: string;
    globalName: string;
    type: string;
    publicPath: string;
    remoteEntry: { name: string; path: string; type: string };
    buildInfo: { buildVersion: string; buildName: string };
  };
  shared: [];
  remotes: [];
  exposes: [];
};

export type RemoteFallbackPluginOptions = {
  /**
   * Fallback ante fallo de carga. Dos formas:
   * - Función {@link RemoteFallback}: control total (recibe `{ id, error, lifecycle, from }`).
   * - Mapa declarativo {@link RemoteStubMap}: `id -> stub`, con gate de lifecycle automático (ver abajo).
   */
  fallback: RemoteFallback | RemoteStubMap;
  /**
   * Habilita la síntesis de un manifest offline. `true` usa defaults; un {@link OfflineManifestInput}
   * personaliza `name`/`globalName`/`publicPath`/`remoteEntryName`. Cuando está habilitado, el plugin gana un
   * loaderHook `fetch`: si `globalThis.fetch` falla/rechaza, devuelve un `Response` 200 con el manifest
   * sintetizado, para que el runtime pueda continuar aunque el manifest real no esté disponible.
   */
  offlineManifest?: boolean | OfflineManifestInput;
  /** Se invoca cuando el `fetch` real falla y se sirve el manifest sintetizado, con la URL y el error. */
  onOfflineManifest?: (info: { manifestUrl: string; error: unknown }) => void;
};

/**
 * Sintetiza un manifest MF offline mínimo (ver {@link OfflineManifest}). Pura, exportada y unit-testeable.
 * Contiene exactamente los campos que `generateSnapshotFromManifest` de @module-federation/sdk 2.6.0 exige.
 */
export function buildOfflineManifest(input: OfflineManifestInput = {}): OfflineManifest {
  const name = input.name ?? "mf-shield-offline";
  const globalName = input.globalName ?? name;
  const publicPath = input.publicPath ?? "/";
  const remoteEntryName = input.remoteEntryName ?? "remoteEntry.js";

  return {
    id: name,
    name,
    metaData: {
      name,
      globalName,
      type: "app",
      publicPath,
      remoteEntry: { name: remoteEntryName, path: "", type: "global" },
      buildInfo: { buildVersion: "0.0.0", buildName: name }
    },
    shared: [],
    remotes: [],
    exposes: []
  };
}

function isStubMap(fallback: RemoteFallback | RemoteStubMap): fallback is RemoteStubMap {
  return typeof fallback !== "function";
}

/**
 * Compila un {@link RemoteStubMap} a la firma de {@link RemoteFallback}, con el **gate de lifecycle**: los stubs
 * solo se aplican cuando `info.lifecycle === "onLoad"`. Devolver contenido de módulo en otros lifecycles corrompe
 * el share scope (MF lo trata como args de request de reemplazo), así que fuera de `onLoad` se propaga `undefined`.
 * El match es por id exacto; si no hay match usa la clave `"*"` (catch-all) si existe. Las factories se invocan
 * (soportan async).
 */
function compileStubMap(map: RemoteStubMap): RemoteFallback {
  return info => {
    if (info.lifecycle !== "onLoad") return undefined;
    const stub = map[info.id] ?? map["*"];
    if (stub === undefined) return undefined;
    return typeof stub === "function" ? stub() : stub;
  };
}

/**
 * Plugin de runtime MF (`FederationRuntimePlugin`) que intercepta fallos de carga de remotes en el
 * hook `errorLoadRemote`. La opción `fallback` acepta una función {@link RemoteFallback} (control total) o un
 * mapa declarativo {@link RemoteStubMap} (`id -> stub`, con gate de lifecycle automático).
 *
 * Contrato de retorno (verificado en runtime-core 2.6.0):
 * - Si el fallback devuelve `undefined`, el plugin no retorna nada y el error original se propaga por el flujo normal.
 * - Si el fallo ocurre en el `lifecycle: "onLoad"` (falla real al resolver/cargar el módulo remoto), un valor
 *   devuelto se usa como **contenido del módulo remoto**. Para que un componente React del caller funcione al
 *   cargarse vía `createFederatedLoader` + `RemoteSlot`, devuelve el **objeto módulo** con el mismo shape que
 *   expone el remote (p. ej. `{ RemoteWidget: MiFallback }`), no el componente solo; `loadRemote(id)` resuelve
 *   a ese objeto. Una función se interpreta como *module factory*.
 * - Si el fallo ocurre en cualquier lifecycle previo a la carga (`"beforeRequest"`, `"beforeLoadShare"`,
 *   `"afterResolve"`), MF interpreta el valor devuelto como **args de request de reemplazo** `{ id, options, origin }`
 *   para redirigir a otro remote, no como módulo. Para simplemente propagar el error devuelve `undefined` en esos
 *   lifecycles: solo los retornos en `"onLoad"` son contenido de módulo. El mapa declarativo aplica ese gate por vos.
 *
 * Manifest offline: con `offlineManifest` habilitado, el plugin agrega un loaderHook `fetch` (verificado en
 * runtime-core 2.6.0: `fetch` es una propiedad de nivel superior del objeto plugin, `AsyncHook<[url, init, ...],
 * false | void | Promise<Response>>`). Intenta `globalThis.fetch`; ante throw/reject invoca `onOfflineManifest` y
 * devuelve un `Response` 200 (`Content-Type: application/json`) con {@link buildOfflineManifest}. Sin la opción,
 * el objeto plugin **no** tiene propiedad `fetch` (cero cambio de comportamiento).
 */
export function createRemoteFallbackPlugin({
  fallback,
  offlineManifest,
  onOfflineManifest
}: RemoteFallbackPluginOptions): ModuleFederationRuntimePlugin {
  const resolveFallback: RemoteFallback = isStubMap(fallback) ? compileStubMap(fallback) : fallback;

  const plugin: ModuleFederationRuntimePlugin = {
    name: "mf-shield-remote-fallback",
    errorLoadRemote(args) {
      const result = resolveFallback({ id: args.id, error: args.error, lifecycle: args.lifecycle, from: args.from });
      if (result === undefined) return;
      return result;
    }
  };

  if (offlineManifest) {
    const manifestInput: OfflineManifestInput = offlineManifest === true ? {} : offlineManifest;
    plugin.fetch = async (manifestUrl: string, init?: RequestInit) => {
      try {
        return await globalThis.fetch(manifestUrl, init);
      } catch (error) {
        onOfflineManifest?.({ manifestUrl, error });
        return new Response(JSON.stringify(buildOfflineManifest(manifestInput)), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    };
  }

  return plugin;
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
