---
"mf-shield": minor
---

Add six additive resilience primitives (no breaking changes).

Core entry (`mf-shield`):

- `assertRemoteExports(module, id, expected)`: validates that a resolved remote module exposes the expected exports, treating `null` and `undefined` as missing (real-world falsy-export drift). Throws the new typed `MissingRemoteExportError` (with `id` and `missing[]`) and narrows the module type on success.
- `validateRemoteEntries(entries, policy?)`: fully agnostic report (never throws, no fetch) of remote-entry issues — `duplicate-name`, `missing-entry`, `invalid-url`, `origin-not-allowed`, and `insecure-entry`. Version-only (registry-style) entries skip URL checks and loopback hosts are exempt from `requireHttps`.
- `toFederationResult(thunk)` and the `FederationResult<T, E>` type: a single narrow combinator (not a monad) that runs a sync-or-async thunk and normalizes it to `{ ok: true, value } | { ok: false, error }`, catching both synchronous throws and rejections. Composes with `withTimeout` and the typed errors.

Federation entry (`mf-shield/federation`):

- `createLoaderFromInstance(instance, options?)`: closes the adoption gap for the common case where the bundler plugin auto-initializes the runtime and apps reach it via `getInstance()`. The instance is a parameter (the library never calls `getInstance()`), plugins register once at creation, and `remoteEntries` are registered lazily with the same Set-dedup semantics as `createFederatedLoader`. A shared instance-bound loader helper was extracted internally with no change to existing APIs.
- Offline manifest synthesis in `createRemoteFallbackPlugin`: the new `offlineManifest` and `onOfflineManifest` options add a `fetch` loaderHook that, when `globalThis.fetch` fails, serves a synthesized `200` manifest so the runtime can continue. The exported, pure `buildOfflineManifest(input?)` produces exactly the fields `generateSnapshotFromManifest` (`@module-federation/sdk` 2.6.0) requires. When the option is absent the plugin object has no `fetch` property (zero behavior change).
- Declarative stub map for the fallback: `createRemoteFallbackPlugin({ fallback })` now also accepts a `RemoteStubMap` (`"<remote>/<expose>" -> stub`, with an optional `"*"` catch-all). Stubs may be module objects or sync/async factories, and are compiled with a lifecycle gate so they apply only in the `onLoad` lifecycle (returning module content elsewhere corrupts the share scope).
