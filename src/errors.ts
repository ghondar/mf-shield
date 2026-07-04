export class FederationTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`federation: ${label} timed out after ${timeoutMs}ms`);
    this.name = "FederationTimeoutError";
  }
}

export class RemoteAccessDeniedError extends Error {
  constructor(reason: string) {
    super(`federation: ${reason}`);
    this.name = "RemoteAccessDeniedError";
  }
}

export class RemoteModuleNullError extends Error {
  constructor(id: string) {
    super(`federation: ${id} returned no module`);
    this.name = "RemoteModuleNullError";
  }
}

/**
 * Se lanza cuando un módulo remoto se resolvió pero no expone todos los exports esperados por el contrato.
 * `assertRemoteExports` detecta drift de exports (`null` o `undefined`) tras la carga y lanza este error con
 * el `id` del módulo y la lista de exports faltantes en `missing`, para fallar rápido y con diagnóstico claro.
 */
export class MissingRemoteExportError extends Error {
  readonly id: string;
  readonly missing: string[];

  constructor(id: string, missing: string[]) {
    super(`federation: ${id} is missing expected export(s): ${missing.join(", ")}`);
    this.name = "MissingRemoteExportError";
    this.id = id;
    this.missing = missing;
  }
}

/**
 * Se lanza cuando `createSriPlugin` corre en modo estricto y una URL de asset federado no tiene
 * un hash SRI registrado. Bloquea la carga antes de inyectar el `<script>`/`<link>`, así un asset
 * sin hash nunca se ejecuta sin verificación de integridad. Expone `url` para diagnóstico.
 */
export class FederationIntegrityError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(`federation: no integrity hash registered for ${url}`);
    this.name = "FederationIntegrityError";
    this.url = url;
  }
}
