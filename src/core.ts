import { FederationTimeoutError, MissingRemoteExportError } from "./errors";
import { accessDeniedReason, cssPoisonSelector, getDefaultCssPoisonRoot } from "./internal";

export type RemoteAccessDecision = boolean | { allowed: boolean; reason?: string };
export type RemoteAccessPolicy = () => RemoteAccessDecision;
export type RemoteAccessEvaluation = { allowed: boolean; reason?: string };

export type CssPoisonRemovalOptions = { selector?: string; root?: ParentNode };
export type CssPoisonGuardOptions = CssPoisonRemovalOptions & {
  onPoisonRemoved?: (count: number) => void;
  debounceMs?: number;
};

export type SharedConfig = {
  singleton?: boolean;
  requiredVersion?: false | string;
  eager?: boolean;
  strictVersion?: boolean;
};

export type SharedModule = {
  version?: string;
  shareConfig?: SharedConfig;
  lib?: () => unknown;
  get?: () => unknown;
  eager?: boolean;
};

export type SharedModules = Record<string, SharedModule | SharedModule[]>;

export type ShareStrategy = "version-first" | "loaded-first";

export type ValidateSharedSingletonsInput = {
  shared: SharedModules;
  shareStrategy?: ShareStrategy;
};

export type SharedSingleton<T> = {
  version: string;
  lib: () => T;
  shareConfig: { singleton: true; requiredVersion: string; strictVersion: true };
};

export function allowRemoteAccess(): RemoteAccessDecision {
  return { allowed: true };
}

export function denyRemoteAccess(reason = accessDeniedReason): RemoteAccessDecision {
  return { allowed: false, reason };
}

export function evaluateRemoteAccess(policy?: RemoteAccessPolicy): RemoteAccessEvaluation {
  const decision = policy ? policy() : allowRemoteAccess();

  if (typeof decision === "boolean") {
    return { allowed: decision, reason: decision ? undefined : accessDeniedReason };
  }

  return {
    allowed: decision.allowed,
    reason: decision.allowed ? undefined : decision.reason ?? accessDeniedReason
  };
}

/**
 * Verifica que un módulo remoto ya resuelto exponga todos los exports esperados por el contrato.
 *
 * Un export se considera faltante cuando su valor es `null` **o** `undefined` (mirroring del drift real:
 * un remote puede compilar y cargar, pero dejar de exponer un símbolo o exponerlo como `null`). Los valores
 * falsy legítimos (`0`, `""`, `false`) NO se consideran faltantes.
 *
 * Cuando hay faltantes lanza {@link MissingRemoteExportError} con el `id` del módulo y la lista `missing`.
 * En caso contrario no lanza y estrecha el tipo de `module` para marcar las claves esperadas como presentes
 * y no-nulas (`asserts module is ...`). Pura: sin imports de MF, sin efectos.
 *
 * @example
 * ```ts
 * const mod = await loadRemote<{ RemoteWidget?: RemoteComponent }>("stable/Widget");
 * assertRemoteExports(mod, "stable/Widget", ["RemoteWidget"]);
 * // A partir de aquí `mod.RemoteWidget` es no-nulo para el type-checker.
 * ```
 */
export function assertRemoteExports<T extends object, K extends keyof T>(
  module: T,
  id: string,
  expected: readonly K[]
): asserts module is T & { [P in K]-?: NonNullable<T[P]> } {
  const missing = expected.filter(key => module[key] == null);
  if (missing.length) {
    throw new MissingRemoteExportError(id, missing.map(String));
  }
}

/**
 * Valida configuraciones de `shared` singleton contra footguns conocidos de Module Federation
 * y devuelve advertencias legibles ([] cuando está limpio). No lanza ni muta la config.
 *
 * Reglas:
 * - `singleton: true` sin `strictVersion: true` puede permitir versiones divergentes del mismo singleton.
 * - `singleton: true` sin `requiredVersion` (o con `requiredVersion: false`) deja el rango de versión sin fijar.
 * - `shareStrategy: 'version-first'` combinado con cualquier singleton (footgun MF #3209): puede cargar
 *   múltiples instancias del singleton y hace eager-load de todos los remote entries en el init.
 */
export function validateSharedSingletons({ shared, shareStrategy }: ValidateSharedSingletonsInput): string[] {
  const warnings: string[] = [];
  let hasSingleton = false;

  for (const [name, entry] of Object.entries(shared)) {
    const modules = Array.isArray(entry) ? entry : [entry];

    for (const module of modules) {
      const config = module.shareConfig;
      if (!config?.singleton) continue;

      hasSingleton = true;

      if (!config.strictVersion) {
        warnings.push(`shared "${name}": singleton without strictVersion may load divergent versions of the same singleton`);
      }

      if (config.requiredVersion === undefined || config.requiredVersion === false) {
        warnings.push(`shared "${name}": singleton without requiredVersion leaves the version range unpinned`);
      }

      if (shareStrategy === "version-first") {
        warnings.push(
          `shared "${name}": shareStrategy 'version-first' with a singleton can load multiple singleton instances and eager-loads all remote entries at init (MF #3209)`
        );
      }
    }
  }

  return hasSingleton ? warnings : [];
}

export type RemoteEntryInput = { name: string; entry?: string; version?: string };
export type RemoteEntriesPolicy = { allowedOrigins?: string[]; requireHttps?: boolean };
export type RemoteEntryIssue = {
  kind: "duplicate-name" | "missing-entry" | "invalid-url" | "origin-not-allowed" | "insecure-entry";
  name: string;
  detail: string;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Valida un conjunto de entradas de remotes contra reglas de higiene y una política opcional, y devuelve
 * un reporte de issues (`[]` cuando está limpio). Sigue el idiom de {@link validateSharedSingletons}: **nunca
 * lanza** y es totalmente pura (no hace `fetch`, no importa el runtime de MF). Pensada para correr en el
 * arranque o en CI sobre la config de remotes, sea del bundler (`entry` URL) o de registry (`version`).
 *
 * Reglas:
 * - `duplicate-name`: dos entradas con el mismo `name`.
 * - `missing-entry`: la entrada no tiene ni `entry` ni `version`.
 * - `invalid-url`: `entry` presente pero no parseable por `new URL`.
 * - `origin-not-allowed`: `policy.allowedOrigins` definido y el `origin` de `entry` no está en la lista.
 * - `insecure-entry`: `policy.requireHttps` y el protocolo es `http:` sobre un host no-loopback
 *   (`localhost`, `127.0.0.1`, `[::1]` quedan exentos para permitir dev local).
 *
 * Las entradas *version-only* (estilo registry, sin `entry`) omiten los checks de URL: solo aplican
 * `duplicate-name` y `missing-entry`.
 */
export function validateRemoteEntries(entries: readonly RemoteEntryInput[], policy?: RemoteEntriesPolicy): RemoteEntryIssue[] {
  const issues: RemoteEntryIssue[] = [];
  const seen = new Set<string>();

  for (const { name, entry, version } of entries) {
    if (seen.has(name)) {
      issues.push({ kind: "duplicate-name", name, detail: `duplicate remote name "${name}"` });
    } else {
      seen.add(name);
    }

    if (entry == null && version == null) {
      issues.push({ kind: "missing-entry", name, detail: `remote "${name}" has neither an entry URL nor a version` });
      continue;
    }

    if (entry == null) continue;

    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      issues.push({ kind: "invalid-url", name, detail: `remote "${name}" entry is not a valid URL: ${entry}` });
      continue;
    }

    if (policy?.allowedOrigins && !policy.allowedOrigins.includes(url.origin)) {
      issues.push({ kind: "origin-not-allowed", name, detail: `remote "${name}" origin ${url.origin} is not in allowedOrigins` });
    }

    if (policy?.requireHttps && url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
      issues.push({ kind: "insecure-entry", name, detail: `remote "${name}" entry uses insecure http: (${url.origin})` });
    }
  }

  return issues;
}

/**
 * Discriminada de resultado para operaciones federadas: éxito con `value` o fallo con `error`, sin excepciones.
 *
 * NO es una mónada: no expone `map`/`flatMap` ni helpers. Es un único combinador ({@link toFederationResult})
 * pensado para envolver una carga federada y forzar el manejo explícito del fallo en el call-site vía el
 * narrowing de `ok`. Compone con {@link withTimeout} (envuelve el thunk para obtener `{ok:false}` en timeout)
 * y con los errores tipados ({@link FederationTimeoutError}, `RemoteModuleNullError`, etc.): al ser `ok:false`
 * puedes discriminar `error` con `instanceof`.
 */
export type FederationResult<T, E = Error> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/**
 * Ejecuta `thunk` (sync o async) y normaliza su resultado a un {@link FederationResult}. Captura tanto un
 * `throw` síncrono como un rechazo de promesa y los devuelve como `{ ok: false, error }`. Nunca lanza.
 *
 * @example
 * ```ts
 * const result = await toFederationResult(() => withTimeout(loadRemote("stable/Widget"), 800, "widget"));
 * if (!result.ok) return renderFallback(result.error);
 * mount(result.value);
 * ```
 */
export async function toFederationResult<T, E = Error>(thunk: () => Promise<T> | T): Promise<FederationResult<T, E>> {
  try {
    const value = await thunk();
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error as E };
  }
}

export function removeCssPoison({ selector = cssPoisonSelector, root = getDefaultCssPoisonRoot() }: CssPoisonRemovalOptions = {}): number {
  if (!root) return 0;

  const nodes = Array.from(root.querySelectorAll(selector));
  nodes.forEach(node => node.remove());
  return nodes.length;
}

export function createSharedSingleton<T>(version: string, lib: () => T): SharedSingleton<T> {
  return {
    version,
    lib,
    shareConfig: { singleton: true, requiredVersion: version, strictVersion: true }
  };
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;

  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new FederationTimeoutError(label, timeoutMs)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
