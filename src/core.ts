import { FederationTimeoutError } from "./errors";
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
