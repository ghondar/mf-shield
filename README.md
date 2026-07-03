# mf-shield

[![npm version](https://img.shields.io/npm/v/mf-shield)](https://www.npmjs.com/package/mf-shield)
[![CI](https://github.com/ghondar/mf-shield/actions/workflows/ci.yml/badge.svg)](https://github.com/ghondar/mf-shield/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/npm/l/mf-shield)](./LICENSE)

> Documentación en español → [README.es.md](./README.es.md)

A resilience shield for Module Federation. It wraps the typical failures that take a host down when it loads remotes you don't fully control: dead manifest, missing exposed module, chunk 404, render crash, timeout, version mismatch, dangerous global CSS, and unauthorized direct access.

The library is NOT a sandbox. It's a containment layer: it keeps the shell alive and isolates the failure inside the slot or provider that caused it, with typed errors and explicit access policies.

## What it solves

- Loading remotes behind a boundary with `loading` / `ready` / `failed` states and its own fallback.
- Per-slot local timeout for slow remotes, with a typed error.
- Access policy evaluated **before** the remote import (a direct URL neither downloads nor executes the module).
- Detection and removal of global CSS injected by a remote.
- Self-safe boundary for providers with risky lazy/data-loaders.
- Runtime and shared-singleton bootstrap without repeating configuration per consumer.

## Installation

```bash
pnpm add mf-shield
```

Peer dependencies (your app installs them, not the library):

| Peer | Range | When you need it |
|---|---|---|
| `react` | `^18.2.0 \|\| ^19.0.0` | Only if you use the `/react` entry |
| `@module-federation/runtime` | `^2.6.0` | Only if you use the `/federation` entry |

Both peers are optional: the core entry (`.`) is framework-agnostic and imports neither React nor the MF runtime.

## Entries

| Import | Contents | React |
|---|---|---|
| `mf-shield` | core: `evaluateRemoteAccess`, `denyRemoteAccess`, `allowRemoteAccess`, `withTimeout`, `removeCssPoison`, `createSharedSingleton`, `validateSharedSingletons`, and typed errors (`FederationTimeoutError`, `RemoteAccessDeniedError`, `RemoteModuleNullError`, `FederationIntegrityError`) | No |
| `mf-shield/federation` | `createFederationRuntime`, `createInstanceFederationRuntime`, `initFederationShield`, `createFederatedLoader`, runtime plugins `createRemoteAccessPlugin` / `createRemoteFallbackPlugin` / `createSriPlugin`, `resolveIntegrity`, types `RemoteEntry` / `FederationRuntimeOptions` / `SriPluginOptions` / `IntegritySource` | No |
| `mf-shield/react` | `RemoteSlot`, `RemoteBoundary`, `RemoteFallback`, `useCssPoisonGuard`, `ProviderSuspenseBoundary`, `ProviderBoundary`, `ProviderFallback`, the `RemoteFallbackRenderer` type, and their prop types | Yes |

The package ships compiled (`dist`, ESM + CJS + types). You don't need to transpile `node_modules`.

## Minimal recipes

### 1. RemoteSlot with fallback + retry

`RemoteSlot` mounts the remote, shows its state, and falls back if it fails. Changing `retryKey` remounts the slot to retry.

```tsx
import { useState } from "react";
import { RemoteSlot, type RemoteComponent, type RemoteSlotConfig } from "mf-shield/react";

const widgetSlot: RemoteSlotConfig = {
  label: "stable widget",
  timeoutMs: 800, // optional: cuts off slow remotes
  load: async () => (await loadRemote<{ RemoteWidget: RemoteComponent }>("stable/Widget")).RemoteWidget
};

export function WidgetPanel() {
  const [attempt, setAttempt] = useState(0);

  return (
    <section>
      <button type="button" onClick={() => setAttempt(value => value + 1)}>
        Retry
      </button>
      <RemoteSlot config={widgetSlot} retryKey={attempt} />
    </section>
  );
}
```

If `load` rejects (dead manifest, chunk 404, render crash caught by the internal boundary), the slot renders `RemoteFallback` with `data-testid="remote-fallback"` and the shell stays alive.

#### Typed remote props (`props`) + failure observability (`onError`, `onStatusChange`)

`RemoteSlotConfig<P>` is generic over the remote's props. Pass `props` to forward them to the remote, and use `onError` / `onStatusChange` to observe every failure and transition programmatically:

```tsx
const typedSlot: RemoteSlotConfig<{ userId: string }> = {
  label: "user card",
  props: { userId: "42" }, // flows into the remote
  onStatusChange: status => track("slot", status), // "loading" → "ready" | "failed"
  onError: ({ label, error }) => report(label, error), // deny, reject, timeout, render crash
  load: async () => (await loadRemote<{ UserCard: RemoteComponent<{ userId: string }> }>("stable/UserCard")).UserCard
};
```

#### Custom fallback UI (`fallback`)

Pass `fallback` on the slot config to replace the default `RemoteFallback` card with your own themed UI. The renderer receives `{ label, error }` and covers **both** load failures (timeout, denied access, module null, network) and render crashes caught by the boundary — the slot forwards it to its internal `RemoteBoundary` too.

```tsx
import { RemoteSlot, type RemoteComponent, type RemoteFallbackRenderer, type RemoteSlotConfig } from "mf-shield/react";

const pokedexFallback: RemoteFallbackRenderer = ({ label, error }) => (
  <section className="pokedex-card pokedex-card--fainted">
    <strong>This Pokémon fainted</strong>
    <p>{label} could not be summoned.</p>
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

Without `fallback`, the default card (`data-testid="remote-fallback"`) is unchanged. This completes the customization story: slot/boundary UI (`fallback`) ← provider fallback (`ProviderBoundary.fallback`) ← runtime plugin (`createRemoteFallbackPlugin`, which replaces the whole module).

### 2. Runtime + loader with typed errors

`createFederationRuntime` initializes the runtime and returns a loader. `withTimeout` wraps any promise and rejects with `FederationTimeoutError`, which you can discriminate with `instanceof`.

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
      // Degrade to a local fallback: the remote missed the SLA.
      return null;
    }
    throw error;
  }
}
```

If you already initialized the runtime elsewhere, use `createFederatedLoader(remoteEntries)` to get just the loader without re-initializing.

### 3. Access policy before the import

`denyRemoteAccess()` centralizes the block decision; `evaluateRemoteAccess()` resolves it to `{ allowed, reason? }`. `RemoteSlot` runs it **before** executing `load`, so an unauthorized direct URL never downloads or executes the remote.

```ts
import { denyRemoteAccess, evaluateRemoteAccess } from "mf-shield";

function canSeeAdminWidget(user: { role: string }) {
  return user.role === "admin";
}

const decision = evaluateRemoteAccess(() =>
  canSeeAdminWidget(currentUser) ? true : denyRemoteAccess("admins only")
);

if (!decision.allowed) {
  console.warn(`blocked: ${decision.reason}`); // "blocked: admins only"
}
```

Applied to a slot, the policy lives in `canLoad`:

```ts
import type { RemoteSlotConfig } from "mf-shield/react";

const adminSlot: RemoteSlotConfig = {
  label: "admin widget",
  canLoad: () => canSeeAdminWidget(currentUser) ? true : denyRemoteAccess("admins only"),
  load: async () => (await loadRemote<{ AdminWidget: RemoteComponent }>("stable/AdminWidget")).AdminWidget
};
```

If `canLoad` denies, the slot falls back with the reason and no request is emitted to the remote's origin.

## Runtime plugins

Beyond the per-slot guard (`canLoad`), the library aligns with MF2's official extension model (`FederationRuntimePlugin`). Plugins are passed to `createFederationRuntime({ plugins: [...] })` and run inside the runtime, not per component.

### Access policy as a plugin (`createRemoteAccessPlugin`)

Evaluates a policy in the `beforeRequest` hook, **before** resolving the remote. It receives the `remoteName` (extracted from `"<remote>/<expose>"`); if it denies, it throws `RemoteAccessDeniedError` (`federation: <reason>`) and stops resolution.

```ts
import { denyRemoteAccess, allowRemoteAccess } from "mf-shield";
import { createFederationRuntime, createRemoteAccessPlugin } from "mf-shield/federation";

const accessPlugin = createRemoteAccessPlugin({
  policy: remoteName => (remoteName === "legacy" ? denyRemoteAccess("legacy remote disabled") : allowRemoteAccess()),
  onDenied: info => console.warn(`[app] blocked ${info.remote}: ${info.reason}`)
});

const loadRemote = createFederationRuntime({ name: "pokedex_host", remoteEntries, plugins: [accessPlugin] });
```

### Load fallback as a plugin (`createRemoteFallbackPlugin`)

Intercepts load failures in the `errorLoadRemote` hook. Return a **module object** (same shape the remote exposes) to replace the failed module, or `undefined` to let the error propagate.

```ts
import { RemoteAccessDeniedError } from "mf-shield";
import { createFederationRuntime, createRemoteFallbackPlugin } from "mf-shield/federation";
import type { RemoteComponent } from "mf-shield/react";

const LocalFallback: RemoteComponent = () => <section>Local fallback content</section>;

const fallbackPlugin = createRemoteFallbackPlugin({
  fallback: info => {
    // Defer to an access denial: let the guard win.
    if (info.error instanceof RemoteAccessDeniedError) return undefined;
    // Replace a real load failure (lifecycle "onLoad") with a local module.
    return { RemoteWidget: LocalFallback };
  }
});

const loadRemote = createFederationRuntime({ name: "pokedex_host", remoteEntries, plugins: [fallbackPlugin] });
```

Return contract (verified against `@module-federation/runtime` 2.6.0): in `lifecycle: "onLoad"` a returned value is used as the module contents (a function is treated as a *module factory*); in `lifecycle: "beforeRequest"` MF interprets the return as **replacement request args** to redirect to another remote — to propagate a denial, return `undefined`. Note: when `beforeRequest` throws, MF re-emits `errorLoadRemote` with `lifecycle: "onLoad"`, so if you want the denial to win, check `info.error instanceof RemoteAccessDeniedError` as above.

### Second runtime in the same app (`createInstanceFederationRuntime`)

`createFederationRuntime` uses `init`, which in 2.6.0 is a **singleton by name**: a second `init` with a different name throws `#RUNTIME-010`. For an additional isolated runtime (for example with a different plugin set) use `createInstanceFederationRuntime`, which creates an independent instance via `createInstance` and binds the loader to it:

```ts
import { createInstanceFederationRuntime } from "mf-shield/federation";

const loadIsolated = createInstanceFederationRuntime({ name: "widgets_host", remoteEntries, plugins: [accessPlugin, fallbackPlugin] });
```

### Compose with `@module-federation/retry-plugin`

The shield plugins compose with official MF plugins through the same `plugins` option. For automatic retries on manifest/chunk fetches, add the official retry-plugin (install it in your app; it is **not** a dependency of this library):

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

The retry-plugin retries the download; the fallback-plugin covers the case where, once retries are exhausted, the module still won't load.

### Validate shared singletons (`validateSharedSingletons`)

Detects `shared` config footguns without throwing. Returns readable warnings (`[]` when clean). `createFederationRuntime` runs it automatically and emits `console.warn("[mf-shield] …")` once per runtime creation; you can also run it standalone:

```ts
import { validateSharedSingletons } from "mf-shield";

const warnings = validateSharedSingletons({
  shared: { react: { version: "19.2.5", shareConfig: { singleton: true } } },
  shareStrategy: "version-first"
});
// warnings: missing strictVersion, missing requiredVersion, and 'version-first' + singleton (MF #3209)
```

Rules: `singleton: true` without `strictVersion`, `singleton: true` without `requiredVersion`, and `shareStrategy: 'version-first'` combined with any singleton (it can load multiple instances of the singleton and eager-loads all remote entries at init).

### CSS poison with debounce (`useCssPoisonGuard`)

`useCssPoisonGuard` observes `document.head` (or a custom `root`) and removes global CSS injected by remotes. On remotes that inject styles in bursts, pass `debounceMs` to batch the removals into a single trailing pass (default `0` = immediate behavior). The `onPoisonRemoved` callback is taken by ref, so changing it does not re-subscribe the observer.

```tsx
useCssPoisonGuard({ debounceMs: 50, onPoisonRemoved: count => console.warn(`[app] removed ${count} styles`) });
```

## Subresource Integrity (`createSriPlugin`)

CSP says **which origin** a script loads from; SRI says **which exact bytes**. `createSriPlugin` applies Subresource Integrity to federated assets (remoteEntry, chunks, and optionally CSS/preload) via MF's official `createScript` / `createLink` hooks: it sets `integrity` + `crossorigin` on the element from a hash you register. If the bytes don't match, the browser rejects the script and the remote never runs.

```ts
import { createFederationRuntime, createSriPlugin } from "mf-shield/federation";

const loadRemote = createFederationRuntime({
  name: "pokedex_host",
  remoteEntries: { app: { name: "app", entry: "https://cdn.pokedex.example/app/v1.2.3/mf-manifest.json" } },
  plugins: [
    createSriPlugin({
      // exact asset url -> hash "sha384-..."
      integrity: {
        "https://cdn.pokedex.example/app/v1.2.3/remoteEntry.js": "sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8w"
      },
      strict: true,        // default: url with no registered hash -> FederationIntegrityError
      crossOrigin: "anonymous", // default; required for cross-origin SRI
      onViolation: info => console.warn(`[app] no SRI hash for ${info.url}`)
    })
  ]
});
```

- `integrity` accepts a **map** `url -> hash` (matched by exact URL, no slash/query normalization) or a **function** `(url) => hash | undefined` for flexible logic (origin prefixes, versions).
- `strict: true` (default) blocks with `FederationIntegrityError` any asset without a registered hash; `strict: false` lets it through without `integrity` (useful for gradual adoption).
- SRI pins the **exact bytes**: every remote deploy that changes the bundle must **republish** the hashes. It fits **versioned/pinned** remotes (immutable URLs per version), not mutable `latest` URLs.
- Reuse gotcha: if a `<script>` with a matching `src` already exists in the DOM, MF reuses it and skips the `createScript` hook, so a pre-existing tag for the same URL never gets `integrity` applied.

Generate each asset's hash with:

```bash
openssl dgst -sha384 -binary remoteEntry.js | openssl base64 -A
# => paste as "sha384-<output>"
```

Composition: `createSriPlugin` runs in the same load hooks the runtime uses and composes with `createRemoteAccessPlugin` / `createRemoteFallbackPlugin` and the official retry-plugin through the same `plugins` option.

How it combines with CSP (origin allowlist, nonce + `strict-dynamic`, real limits): see [`docs/csp-guide.en.md`](../../docs/csp-guide.en.md).

## CSP requirements

Federated remotes load manifest + chunks from their own origin at runtime. Your Content-Security-Policy must allow it:

- `script-src`: include each remote's origin (e.g. `https://remotes.pokedex.example`). In **production you don't need** `unsafe-eval`: chunks are static JS served by the provider.
- `connect-src`: include the same origins for the `fetch` of `mf-manifest.json` and the chunks.
- `style-src`: if remotes inject styles, account for their origin (or `useCssPoisonGuard` to remove unwanted global CSS).

Hosts with strict CSP (no `unsafe-inline`): use a per-request **nonce** combined with `strict-dynamic`, so the authorized root loader can load the remote chunks without allowlisting each URL by hand.

Full practical guide (per-origin allowlist, nonce + `strict-dynamic`, `unsafe-eval` dev vs prod, how `createSriPlugin` complements CSP, and honest limits): [`docs/csp-guide.en.md`](../../docs/csp-guide.en.md).

## Compatibility

| Bundler | Support | Notes |
|---|---|---|
| webpack | Supported | Native Module Federation |
| rspack | Supported | Native Module Federation |
| rsbuild | Supported | Covered by the e2e suite |
| vite | Runtime-level | Works via `@module-federation/runtime`; no official dev mode yet |

| React | Support |
|---|---|
| 18 | `peer ^18.2.0` |
| 19 | `peer ^19.0.0` |

The `/react` entry is the only one that touches React; core and federation are agnostic.

## Security (honest)

This library is **not a sandbox**. Once loaded, the remote code runs in the same realm as your host: it shares `window`, `document`, memory, and prototypes. It is fully trusted from an execution standpoint — it can do whatever it wants inside the page.

What the library does provide as mitigation:

- **Origin allowlist**: remotes are registered explicitly; there is no arbitrary loading.
- **Access policy before the import**: the guard runs before downloading the manifest.
- **Strong CSP**: trim which origins can serve script/styles (see [`docs/csp-guide.en.md`](../../docs/csp-guide.en.md)).
- **SRI (Subresource Integrity)**: `createSriPlugin` verifies the exact bytes of each federated asset; in strict mode it blocks any chunk without a registered hash.

For real isolation of untrusted code (infinite CPU, extreme memory, hostile DOM/CSS, malicious supply chain) you need another level: Web Worker, iframe, shadow DOM, or a separate process. No same-realm boundary replaces that.

## Conformance suite

The behavior of these protections is validated by an end-to-end suite of **26 real failure scenarios** (Playwright) that inject real failures — dead manifest / HTML instead of JS / hanging with no response, missing exposed module, loader/render/async crash, version mismatch, timeout, chunk 404, contract drift, multi-remote, retry/recovery, CSS poison (with and without a poison marker), CPU burst, provider boundary, runtime plugins (access + fallback), SRI (wrong hash blocked + strict gate with no hash), `shared` singleton footguns (silent double React), and unauthorized direct route — plus bundler portability (a Vite host reuses the shield), and they verify the shell never dies.
