# mf-shield

[![npm version](https://img.shields.io/npm/v/mf-shield)](https://www.npmjs.com/package/mf-shield)
[![CI](https://github.com/ghondar/mf-shield/actions/workflows/ci.yml/badge.svg)](https://github.com/ghondar/mf-shield/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/npm/l/mf-shield)](./LICENSE)

> English docs → [README.md](./README.md)

Un escudo de resiliencia para Module Federation. Encapsula las fallas típicas que tumban un host cuando carga remotes que no controlas al 100%: manifest caído, exposed module faltante, chunk 404, render crash, timeout, mismatch de versiones, CSS global peligroso y acceso directo no autorizado.

La librería NO es un sandbox. Es una capa de contención: mantiene el shell vivo y aísla la falla dentro del slot o del provider que la produjo, con errores tipados y políticas de acceso explícitas.

## Qué resuelve

- Carga de remotes detrás de un boundary con estados `loading` / `ready` / `failed` y fallback propio.
- Timeout local por slot para remotes lentos, con error tipado.
- Política de acceso evaluada **antes** del import remoto (la URL directa no descarga ni ejecuta el módulo).
- Detección y remoción de CSS global inyectado por un remote.
- Boundary self-safe para providers con lazy/data-loaders riesgosos.
- Bootstrap de runtime y shared singletons sin repetir configuración por consumer.

## Instalación

```bash
pnpm add mf-shield
```

Peer dependencies (las instala tu app, no la librería):

| Peer | Rango | Cuándo hace falta |
|---|---|---|
| `react` | `^18.2.0 \|\| ^19.0.0` | Solo si usas la entrada `/react` |
| `@module-federation/runtime` | `^2.6.0` | Solo si usas la entrada `/federation` |

Ambos peers son opcionales: la entrada core (`.`) es framework-agnostic y no importa React ni el runtime de MF.

## Entradas

| Import | Contenido | React |
|---|---|---|
| `mf-shield` | core: `evaluateRemoteAccess`, `denyRemoteAccess`, `allowRemoteAccess`, `withTimeout`, `removeCssPoison`, `createSharedSingleton`, `validateSharedSingletons`, `assertRemoteExports`, `validateRemoteEntries`, `toFederationResult` y errores tipados (`FederationTimeoutError`, `RemoteAccessDeniedError`, `RemoteModuleNullError`, `FederationIntegrityError`, `MissingRemoteExportError`) | No |
| `mf-shield/federation` | `createFederationRuntime`, `createInstanceFederationRuntime`, `createLoaderFromInstance`, `initFederationShield`, `createFederatedLoader`, `buildOfflineManifest`, plugins de runtime `createRemoteAccessPlugin` / `createRemoteFallbackPlugin` / `createSriPlugin`, `resolveIntegrity`, tipos `RemoteEntry` / `FederationRuntimeOptions` / `SriPluginOptions` / `IntegritySource` / `ShieldInstanceOptions` / `RemoteStubMap` / `OfflineManifestInput` | No |
| `mf-shield/react` | `RemoteSlot`, `RemoteBoundary`, `RemoteFallback`, `useCssPoisonGuard`, `ProviderSuspenseBoundary`, `ProviderBoundary`, `ProviderFallback`, el tipo `RemoteFallbackRenderer` y sus prop types | Sí |

El paquete se distribuye compilado (`dist`, ESM + CJS + tipos). No necesitas transpilar `node_modules`.

## Recetas mínimas

### 1. RemoteSlot con fallback + retry

`RemoteSlot` monta el remote, muestra estado y cae en fallback si falla. Cambiar `retryKey` remonta el slot para reintentar.

```tsx
import { useState } from "react";
import { RemoteSlot, type RemoteComponent, type RemoteSlotConfig } from "mf-shield/react";

const widgetSlot: RemoteSlotConfig = {
  label: "stable widget",
  timeoutMs: 800, // opcional: corta remotes lentos
  load: async () => (await loadRemote<{ RemoteWidget: RemoteComponent }>("stable/Widget")).RemoteWidget
};

export function WidgetPanel() {
  const [attempt, setAttempt] = useState(0);

  return (
    <section>
      <button type="button" onClick={() => setAttempt(value => value + 1)}>
        Reintentar
      </button>
      <RemoteSlot config={widgetSlot} retryKey={attempt} />
    </section>
  );
}
```

Si el `load` rechaza (manifest caído, chunk 404, render crash capturado por el boundary interno), el slot renderiza `RemoteFallback` con `data-testid="remote-fallback"` y el shell sigue vivo.

#### Props tipadas del remoto (`props`) + observabilidad de fallas (`onError`, `onStatusChange`)

`RemoteSlotConfig<P>` es genérico sobre las props del remoto. Pasa `props` para reenviarlas al remoto, y usa `onError` / `onStatusChange` para observar cada falla y transición de forma programática:

```tsx
const typedSlot: RemoteSlotConfig<{ userId: string }> = {
  label: "user card",
  props: { userId: "42" }, // fluye hacia el remoto
  onStatusChange: status => track("slot", status), // "loading" → "ready" | "failed"
  onError: ({ label, error }) => report(label, error), // acceso denegado, rechazo, timeout, render crash
  load: async () => (await loadRemote<{ UserCard: RemoteComponent<{ userId: string }> }>("stable/UserCard")).UserCard
};
```

#### UI de fallback personalizada (`fallback`)

Pasa `fallback` en la config del slot para reemplazar la tarjeta `RemoteFallback` por defecto con tu propia UI temática. El renderer recibe `{ label, error }` y cubre **tanto** los fallos de carga (timeout, acceso denegado, módulo nulo, red) como los render crashes capturados por el boundary — el slot también lo reenvía a su `RemoteBoundary` interno.

```tsx
import { RemoteSlot, type RemoteComponent, type RemoteFallbackRenderer, type RemoteSlotConfig } from "mf-shield/react";

const pokedexFallback: RemoteFallbackRenderer = ({ label, error }) => (
  <section className="pokedex-card pokedex-card--fainted">
    <strong>Este Pokémon se debilitó</strong>
    <p>No se pudo invocar {label}.</p>
    <code>{error instanceof Error ? error.message : String(error)}</code>
  </section>
);

const cardsSlot: RemoteSlotConfig = {
  label: "pokemon cards",
  timeoutMs: 800,
  fallback: pokedexFallback,
  load: async () => (await loadRemote<{ RemoteCards: RemoteComponent }>("stable/Cards")).RemoteCards
};
```

Sin `fallback`, la tarjeta por defecto (`data-testid="remote-fallback"`) queda igual. Esto completa la historia de personalización: UI del slot/boundary (`fallback`) ← fallback del provider (`ProviderBoundary.fallback`) ← plugin de runtime (`createRemoteFallbackPlugin`, que reemplaza el módulo completo).

### 2. Runtime + loader con errores tipados

`createFederationRuntime` inicializa el runtime y devuelve un loader. `withTimeout` envuelve cualquier promesa y rechaza con `FederationTimeoutError`, que puedes discriminar con `instanceof`.

```ts
import * as React from "react";
import * as ReactDOM from "react-dom";
import { createSharedSingleton, withTimeout, FederationTimeoutError } from "mf-shield";
import { createFederationRuntime } from "mf-shield/federation";

const loadRemote = createFederationRuntime({
  name: "pokedex_host",
  remoteEntries: {
    stable: { name: "stable", entry: "http://127.0.0.1:4174/mf-manifest.json" }
  },
  shared: {
    react: createSharedSingleton("19.2.5", () => React),
    "react-dom": createSharedSingleton("19.2.5", () => ReactDOM)
  }
});

async function loadWidgetWithSla() {
  try {
    const mod = await withTimeout(loadRemote("stable/Widget"), 800, "stable widget");
    return mod;
  } catch (error) {
    if (error instanceof FederationTimeoutError) {
      // Degrada a fallback local: el remote no cumplió el SLA.
      return null;
    }
    throw error;
  }
}
```

Si ya inicializaste el runtime en otro lado, usa `createFederatedLoader(remoteEntries)` para obtener solo el loader sin re-inicializar.

### 3. Política de acceso antes del import

`denyRemoteAccess()` centraliza la decisión de bloqueo; `evaluateRemoteAccess()` la resuelve a `{ allowed, reason? }`. `RemoteSlot` la corre **antes** de ejecutar `load`, así una URL directa no autorizada nunca descarga ni ejecuta el remote.

```ts
import { denyRemoteAccess, evaluateRemoteAccess } from "mf-shield";

function canSeeAdminWidget(user: { role: string }) {
  return user.role === "admin";
}

const decision = evaluateRemoteAccess(() =>
  canSeeAdminWidget(currentUser) ? true : denyRemoteAccess("solo admins")
);

if (!decision.allowed) {
  console.warn(`bloqueado: ${decision.reason}`); // "bloqueado: solo admins"
}
```

Aplicado a un slot, la política vive en `canLoad`:

```ts
import type { RemoteSlotConfig } from "mf-shield/react";

const adminSlot: RemoteSlotConfig = {
  label: "admin widget",
  canLoad: () => canSeeAdminWidget(currentUser) ? true : denyRemoteAccess("solo admins"),
  load: async () => (await loadRemote<{ AdminWidget: RemoteComponent }>("stable/AdminWidget")).AdminWidget
};
```

Si `canLoad` deniega, el slot cae en fallback con la razón y no se emite ninguna request al origen del remote.

## Plugins de runtime

Además del guard por slot (`canLoad`), la librería alinea con el modelo de extensión oficial de MF2 (`FederationRuntimePlugin`). Los plugins se pasan a `createFederationRuntime({ plugins: [...] })` y corren dentro del runtime, no por componente.

### Política de acceso como plugin (`createRemoteAccessPlugin`)

Evalúa una política en el hook `beforeRequest`, **antes** de resolver el remote. Recibe el `remoteName` (extraído de `"<remote>/<expose>"`); si deniega, lanza `RemoteAccessDeniedError` (`federation: <reason>`) y corta la resolución.

```ts
import { denyRemoteAccess, allowRemoteAccess } from "mf-shield";
import { createFederationRuntime, createRemoteAccessPlugin } from "mf-shield/federation";

const accessPlugin = createRemoteAccessPlugin({
  policy: remoteName => (remoteName === "legacy" ? denyRemoteAccess("legacy remote deshabilitado") : allowRemoteAccess()),
  onDenied: info => console.warn(`[app] bloqueado ${info.remote}: ${info.reason}`)
});

const loadRemote = createFederationRuntime({ name: "pokedex_host", remoteEntries, plugins: [accessPlugin] });
```

### Fallback de carga como plugin (`createRemoteFallbackPlugin`)

Intercepta fallos de carga en el hook `errorLoadRemote`. Devuelve un **objeto módulo** (mismo shape que expone el remote) para reemplazar el módulo caído, o `undefined` para dejar propagar el error.

```ts
import { RemoteAccessDeniedError } from "mf-shield";
import { createFederationRuntime, createRemoteFallbackPlugin } from "mf-shield/federation";
import type { RemoteComponent } from "mf-shield/react";

const LocalFallback: RemoteComponent = () => <section>Contenido de respaldo local</section>;

const fallbackPlugin = createRemoteFallbackPlugin({
  fallback: info => {
    // Defiere a una denegación de acceso: deja que el guard gane.
    if (info.error instanceof RemoteAccessDeniedError) return undefined;
    // Reemplaza un fallo real de carga (lifecycle "onLoad") con un módulo local.
    return { RemoteWidget: LocalFallback };
  }
});

const loadRemote = createFederationRuntime({ name: "pokedex_host", remoteEntries, plugins: [fallbackPlugin] });
```

Contrato de retorno (verificado contra `@module-federation/runtime` 2.6.0): en `lifecycle: "onLoad"` un valor devuelto se usa como contenido del módulo (una función se trata como *module factory*); en `lifecycle: "beforeRequest"` MF interpreta el retorno como **args de request de reemplazo** para redirigir a otro remote — para propagar una denegación devuelve `undefined`. Nota: cuando `beforeRequest` lanza, MF re-emite `errorLoadRemote` con `lifecycle: "onLoad"`, así que si quieres que la denegación gane, verifica `info.error instanceof RemoteAccessDeniedError` como arriba.

### Segundo runtime en la misma app (`createInstanceFederationRuntime`)

`createFederationRuntime` usa `init`, que en 2.6.0 es **singleton por nombre**: un segundo `init` con otro nombre lanza `#RUNTIME-010`. Para un runtime adicional aislado (por ejemplo con otro set de plugins) usa `createInstanceFederationRuntime`, que crea una instancia independiente vía `createInstance` y liga el loader a ella:

```ts
import { createInstanceFederationRuntime } from "mf-shield/federation";

const loadIsolated = createInstanceFederationRuntime({ name: "widgets_host", remoteEntries, plugins: [accessPlugin, fallbackPlugin] });
```

### Adopción sobre una instancia de runtime existente (`createLoaderFromInstance`)

El caso mayoritario en el mundo real: el plugin del bundler ya **auto-inicializó** el runtime y tu app lo obtiene con `getInstance()`. No quieres un segundo `init` ni `createInstance`: quieres blindar la instancia que ya tienes. `createLoaderFromInstance` recibe esa instancia como **parámetro** (la librería nunca llama a `getInstance()`, lo que la mantiene testeable y desacoplada del entry `enhanced/runtime` vs `runtime`) y devuelve el mismo loader tipado que `createFederatedLoader`.

```ts
import { getInstance } from "@module-federation/runtime";
import { createLoaderFromInstance } from "mf-shield/federation";
import { createRemoteAccessPlugin, createRemoteFallbackPlugin } from "mf-shield/federation";

const instance = getInstance();
if (!instance) throw new Error("MF runtime not initialized yet"); // el null-guard es responsabilidad del caller

const loadRemote = createLoaderFromInstance(instance, {
  plugins: [createRemoteAccessPlugin({ policy: allowPikachuOnly }), createRemoteFallbackPlugin({ fallback: stubMap })],
  // remoteEntries es opcional: proveelo para registrar de forma perezosa (dedup por Set, igual que createFederatedLoader);
  // omitelo para cargar ids contra los remotes que el plugin del bundler ya registró.
  remoteEntries: { stable: { name: "stable", entry: "http://127.0.0.1:4174/mf-manifest.json" } }
});

const mod = await loadRemote<{ RemoteWidget: RemoteComponent }>("stable/Widget");
```

- Los `plugins` se registran **una sola vez** al crear el loader vía `instance.registerPlugins`.
- Con `remoteEntries` omitido no se registra nada; los ids cargan contra los remotes ya registrados.
- Un módulo nulo lanza `RemoteModuleNullError`, igual que los otros loaders.

### Manifest offline + stubs (`createRemoteFallbackPlugin`)

Dos poderes aditivos sobre el mismo plugin de fallback, ambos opt-in.

**Mapa declarativo de stubs.** En vez de una función `fallback` hecha a mano, pasa un mapa `id -> stub`. Las claves son ids completos `"<remote>/<expose>"`; `"*"` es un catch-all opcional. Un stub es el objeto módulo o una factory (sync o async). El plugin compila el mapa con el **gate de lifecycle** incorporado: los stubs se aplican **solo** cuando `info.lifecycle === "onLoad"` — devolver contenido de módulo en cualquier otro lifecycle corrompe el share scope (MF lo trata como args de request de reemplazo), que es justamente el endurecimiento que un fallback hecho a mano suele omitir.

```ts
import { createRemoteFallbackPlugin } from "mf-shield/federation";
import type { RemoteComponent } from "mf-shield/react";

const FaintedCard: RemoteComponent = () => <section>Este Pokémon se debilitó</section>;

const fallbackPlugin = createRemoteFallbackPlugin({
  fallback: {
    "stable/Pokedex": { RemotePokedex: FaintedCard },        // stub objeto
    "stable/Cards": async () => import("./local-cards"),      // factory async
    "*": { Fallback: FaintedCard }                            // catch-all
  }
});
```

**Síntesis de manifest offline.** Cuando el fetch del manifest falla (provider caído, dev offline), el runtime ni siquiera puede empezar a resolver. Habilita `offlineManifest` para agregar un loaderHook `fetch`: intenta `globalThis.fetch` y, ante throw/reject, invoca `onOfflineManifest` y sirve un manifest sintetizado con `200` para que el runtime pueda continuar.

```ts
const fallbackPlugin = createRemoteFallbackPlugin({
  fallback: { "*": { Fallback: FaintedCard } },
  offlineManifest: { name: "stable", globalName: "stable_g", publicPath: "/stable/" }, // o `true` para defaults
  onOfflineManifest: ({ manifestUrl, error }) => console.warn(`[app] manifest offline para ${manifestUrl}`, error)
});
```

El shape sintetizado contiene exactamente los campos que `generateSnapshotFromManifest` (`@module-federation/sdk` 2.6.0) exige como obligatorios; `buildOfflineManifest(input?)` está exportada y es pura si quieres inspeccionarla o reusarla. Cuando `offlineManifest` se omite, el objeto plugin **no** tiene propiedad `fetch` alguna — cero cambio de comportamiento.

### Componer con `@module-federation/retry-plugin`

Los plugins del escudo componen con plugins oficiales de MF por la misma opción `plugins`. Para reintentos automáticos de fetch de manifest/chunks, agrega el retry-plugin oficial (instálalo en tu app; **no** es dependencia de esta librería):

```bash
pnpm add @module-federation/retry-plugin
```

```ts
import { RetryPlugin } from "@module-federation/retry-plugin";
import { createFederationRuntime, createRemoteFallbackPlugin } from "mf-shield/federation";

const loadRemote = createFederationRuntime({
  name: "pokedex_host",
  remoteEntries,
  plugins: [
    RetryPlugin({ fetch: { retryTimes: 3 } }),
    createRemoteFallbackPlugin({ fallback: () => ({ RemoteWidget: LocalFallback }) })
  ]
});
```

El retry-plugin reintenta la descarga; el fallback-plugin cubre el caso en que, agotados los reintentos, el módulo sigue sin cargar.

### Validar shared singletons (`validateSharedSingletons`)

Detecta footguns de configuración `shared` sin lanzar. Devuelve advertencias legibles (`[]` cuando está limpio). `createFederationRuntime` la corre automáticamente y emite `console.warn("[mf-shield] …")` una vez por creación de runtime; también puedes correrla suelta:

```ts
import { validateSharedSingletons } from "mf-shield";

const warnings = validateSharedSingletons({
  shared: { react: { version: "19.2.5", shareConfig: { singleton: true } } },
  shareStrategy: "version-first"
});
// warnings: falta strictVersion, falta requiredVersion, y 'version-first' + singleton (MF #3209)
```

Reglas: `singleton: true` sin `strictVersion`, `singleton: true` sin `requiredVersion`, y `shareStrategy: 'version-first'` combinado con cualquier singleton (puede cargar múltiples instancias del singleton y hace eager-load de todos los remote entries en el init).

### Helpers de validación core (agnósticos, sin importar MF)

Tres helpers puros en el entry core (`mf-shield`) para endurecer contratos y componer con seguridad:

| Helper | Resumen |
|---|---|
| `assertRemoteExports(module, id, expected)` | Asegura que un remote resuelto exponga los exports esperados; lanza `MissingRemoteExportError` (con `id` + `missing[]`) cuando alguno es `null`/`undefined`. En caso de éxito estrecha el tipo del módulo. |
| `validateRemoteEntries(entries, policy?)` | Devuelve un reporte (`[]` cuando está limpio, nunca lanza) de issues de remote-entries: `duplicate-name`, `missing-entry`, `invalid-url`, `origin-not-allowed`, `insecure-entry`. Las entradas version-only (estilo registry) omiten los checks de URL; `localhost`/`127.0.0.1`/`[::1]` quedan exentos de `requireHttps`. |
| `toFederationResult(thunk)` | Ejecuta un thunk sync o async y lo normaliza a un `FederationResult<T, E>` discriminado (`{ ok: true, value } \| { ok: false, error }`), capturando tanto throws síncronos como rechazos. No es una mónada — un único combinador. Compone con `withTimeout` y los errores tipados. |

```ts
import { assertRemoteExports, validateRemoteEntries, toFederationResult } from "mf-shield";

const result = await toFederationResult(() => withTimeout(loadRemote("stable/Pokedex"), 800, "pokedex"));
if (!result.ok) return renderFainted(result.error);
assertRemoteExports(result.value, "stable/Pokedex", ["RemotePokedex"]); // fallo rápido ante drift de contrato
```

### CSS poison con debounce (`useCssPoisonGuard`)

`useCssPoisonGuard` observa el `document.head` (o un `root` propio) y remueve CSS global inyectado por remotes. En remotes que inyectan estilos en ráfaga, pasa `debounceMs` para agrupar las remociones en una sola pasada trailing (default `0` = comportamiento inmediato). El callback `onPoisonRemoved` se toma por ref, así que cambiarlo no re-suscribe el observer.

```tsx
useCssPoisonGuard({ debounceMs: 50, onPoisonRemoved: count => console.warn(`[app] removidos ${count} estilos`) });
```

## Subresource Integrity (`createSriPlugin`)

CSP dice **de qué origen** carga un script; SRI dice **qué bytes exactos**. `createSriPlugin` aplica Subresource Integrity a los assets federados (remoteEntry, chunks y, opcionalmente, CSS/preload) vía los hooks oficiales `createScript` / `createLink` de MF: setea `integrity` + `crossorigin` en el elemento a partir de un hash que registras. Si los bytes no coinciden, el browser rechaza el script y el remote no se ejecuta.

```ts
import { createFederationRuntime, createSriPlugin } from "mf-shield/federation";

const loadRemote = createFederationRuntime({
  name: "pokedex_host",
  remoteEntries: { app: { name: "app", entry: "https://cdn.pokedex.example/app/v1.2.3/mf-manifest.json" } },
  plugins: [
    createSriPlugin({
      // url exacta del asset -> hash "sha384-..."
      integrity: {
        "https://cdn.pokedex.example/app/v1.2.3/remoteEntry.js": "sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8w"
      },
      strict: true,        // default: url sin hash registrado -> FederationIntegrityError
      crossOrigin: "anonymous", // default; requerido para SRI cross-origin
      onViolation: info => console.warn(`[app] sin hash SRI para ${info.url}`)
    })
  ]
});
```

- `integrity` acepta un **mapa** `url -> hash` (match por URL exacta, sin normalizar slash/query) o una **función** `(url) => hash | undefined` para lógica flexible (prefijos de origen, versiones).
- `strict: true` (default) bloquea con `FederationIntegrityError` cualquier asset sin hash registrado; `strict: false` deja pasar sin `integrity` (útil para adopción gradual).
- SRI fija los **bytes exactos**: cada deploy del remote que cambie el bundle debe **republicar** los hashes. Encaja con remotes **versionados/pinneados** (URLs inmutables por versión), no con URLs `latest` mutables.
- Gotcha de reúso: si ya existe en el DOM un `<script>` con un `src` que coincide, MF lo reutiliza y omite el hook `createScript`, así que un tag pre-existente para la misma URL nunca recibe `integrity`.

Genera el hash de cada asset con:

```bash
openssl dgst -sha384 -binary remoteEntry.js | openssl base64 -A
# => pegar como "sha384-<salida>"
```

Composición: `createSriPlugin` corre en los mismos hooks de carga que usa el runtime y compone con `createRemoteAccessPlugin` / `createRemoteFallbackPlugin` y con el retry-plugin oficial por la misma opción `plugins`.

Cómo se combina con CSP (allowlist de origen, nonce + `strict-dynamic`, límites reales): ver [`docs/csp-guide.md`](../../docs/csp-guide.md).

## Requisitos CSP

Los remotes federados cargan manifest + chunks desde su propio origen en runtime. Tu Content-Security-Policy debe permitirlo:

- `script-src`: incluye el origen de cada remote (p. ej. `https://remotes.pokedex.example`). En **producción no hace falta** `unsafe-eval`: los chunks son JS estático servido por el provider.
- `connect-src`: incluye los mismos orígenes para el `fetch` del `mf-manifest.json` y de los chunks.
- `style-src`: si los remotes inyectan estilos, contempla su origen (o `useCssPoisonGuard` para remover CSS global no deseado).

Hosts con CSP estricta (sin `unsafe-inline`): usa un **nonce** por request combinado con `strict-dynamic`, de modo que el loader raíz autorizado pueda cargar los chunks remotos sin allowlistar cada URL a mano.

Guía práctica completa (allowlist por origen, nonce + `strict-dynamic`, `unsafe-eval` dev vs prod, cómo `createSriPlugin` complementa CSP y límites honestos): [`docs/csp-guide.md`](../../docs/csp-guide.md).

## Compatibilidad

| Bundler | Soporte | Notas |
|---|---|---|
| webpack | Soportado | Module Federation nativo |
| rspack | Soportado | Module Federation nativo |
| rsbuild | Soportado | Cubierto por la suite e2e |
| vite | Runtime-level | Funciona vía `@module-federation/runtime`; sin dev mode oficial todavía |

| React | Soporte |
|---|---|
| 18 | `peer ^18.2.0` |
| 19 | `peer ^19.0.0` |

La entrada `/react` es la única que toca React; core y federation son agnósticas.

## Seguridad (honesto)

Esta librería **no es un sandbox**. Una vez cargado, el código remoto corre en el mismo realm que tu host: comparte `window`, `document`, memoria y prototipos. Es plenamente confiable desde el punto de vista de ejecución — puede hacer lo que quiera dentro de la página.

Lo que la librería sí aporta como mitigación:

- **Allowlist de orígenes**: los remotes se registran explícitamente; no hay carga arbitraria.
- **Política de acceso previa al import**: el guard corre antes de descargar el manifest.
- **CSP fuerte**: recorta qué orígenes pueden servir script/estilos (ver [`docs/csp-guide.md`](../../docs/csp-guide.md)).
- **SRI (Subresource Integrity)**: `createSriPlugin` verifica los bytes exactos de cada asset federado; en modo estricto bloquea cualquier chunk sin hash registrado.

Para aislamiento real de código no confiable (CPU infinito, memoria extrema, DOM/CSS hostil, supply chain malicioso) necesitas otro nivel: Web Worker, iframe, shadow DOM o proceso separado. Ningún boundary same-realm reemplaza eso.

## Suite de conformance

El comportamiento de estas protecciones está validado por una suite end-to-end de **26 escenarios de falla reales** (Playwright) que inyectan fallas reales — manifest caído / HTML en vez de JS / colgado sin responder, exposed module faltante, loader/render/async crash, mismatch de versiones, timeout, chunk 404, drift de contrato, multi-remote, retry/recovery, CSS poison (con y sin marca de poison), CPU burst, boundary de provider, plugins de runtime (acceso + fallback), SRI (hash incorrecto bloqueado + gate estricto sin hash), footguns de `shared` singleton (double React silencioso) y ruta directa no autorizada — más portabilidad de bundler (un host Vite reutiliza el escudo), y verifican que el shell nunca muere.
