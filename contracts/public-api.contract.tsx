import {
  allowRemoteAccess,
  assertRemoteExports,
  createSharedSingleton,
  denyRemoteAccess,
  evaluateRemoteAccess,
  FederationIntegrityError,
  MissingRemoteExportError,
  removeCssPoison,
  toFederationResult,
  validateRemoteEntries,
  validateSharedSingletons,
  withTimeout,
  type CssPoisonGuardOptions,
  type FederationResult,
  type RemoteAccessPolicy,
  type RemoteEntriesPolicy,
  type RemoteEntryInput,
  type RemoteEntryIssue,
  type SharedConfig,
  type SharedModule,
  type SharedModules,
  type ShareStrategy
} from "mf-shield";
import {
  buildOfflineManifest,
  createFederatedLoader,
  createFederationRuntime,
  createInstanceFederationRuntime,
  createLoaderFromInstance,
  createRemoteAccessPlugin,
  createRemoteFallbackPlugin,
  createSriPlugin,
  initFederationShield,
  resolveIntegrity,
  type IntegritySource,
  type OfflineManifest,
  type OfflineManifestInput,
  type RemoteAccessPluginOptions,
  type RemoteFallback,
  type RemoteFallbackInfo,
  type RemoteFallbackPluginOptions,
  type RemoteModuleStub,
  type RemoteStubMap,
  type SharedModules as FederationSharedModules,
  type ShareStrategy as FederationShareStrategy,
  type ShieldInstanceOptions,
  type SriPluginOptions
} from "mf-shield/federation";
import {
  ProviderBoundary,
  ProviderFallback,
  ProviderSuspenseBoundary,
  RemoteBoundary,
  RemoteSlot,
  useCssPoisonGuard,
  type ProviderBoundaryProps,
  type ProviderFallbackProps,
  type ProviderFallbackRenderer,
  type ProviderSuspenseBoundaryProps,
  type RemoteComponent,
  type RemoteFallbackRenderer,
  type RemoteSlotConfig
} from "mf-shield/react";

const Remote: RemoteComponent = () => <section data-testid="contract-remote">ok</section>;
const TypedRemote: RemoteComponent<{ contractVersion: number }> = ({ contractVersion }) => (
  <section data-testid="contract-typed-remote">{contractVersion}</section>
);

const contractAccessPolicy: RemoteAccessPolicy = () => denyRemoteAccess("contract denied");
const cssPoisonGuardOptions: CssPoisonGuardOptions = { onPoisonRemoved: () => undefined, debounceMs: 50 };

const contractSharedModule: SharedModule = { version: "19.2.5", shareConfig: { singleton: true, strictVersion: true, requiredVersion: "19.2.5" } };
const contractSharedConfig: SharedConfig = contractSharedModule.shareConfig!;
const contractSharedModules: SharedModules = { react: contractSharedModule };
const contractFederationShared: FederationSharedModules = contractSharedModules;
const contractShareStrategy: ShareStrategy = "loaded-first";
const contractFederationStrategy: FederationShareStrategy = contractShareStrategy;

const accessPluginOptions: RemoteAccessPluginOptions = {
  policy: remoteName => (remoteName === "untrusted" ? denyRemoteAccess("blocked") : allowRemoteAccess()),
  onDenied: () => undefined
};
const fallbackPluginOptions: RemoteFallbackPluginOptions = {
  fallback: (info: RemoteFallbackInfo) => (info.from === "runtime" ? { RemoteWidget: Remote } : undefined)
};
const providerFallbackRenderer: ProviderFallbackRenderer = error => <ProviderFallback error={error} />;
const providerFallbackProps: ProviderFallbackProps = { error: new Error("provider contract") };
const providerSuspenseBoundaryProps: ProviderSuspenseBoundaryProps = { loading: <p>loading</p>, children: <Remote /> };
const providerBoundaryProps: ProviderBoundaryProps = {
  fallback: providerFallbackRenderer,
  children: (
    <>
      <ProviderFallback {...providerFallbackProps} />
      <ProviderSuspenseBoundary {...providerSuspenseBoundaryProps} />
    </>
  )
};

const contractRemoteFallback: RemoteFallbackRenderer = ({ label, error }) => (
  <p data-testid="contract-custom-fallback">{`${label}: ${String(error)}`}</p>
);

const slotConfig: RemoteSlotConfig = {
  label: "contract slot",
  timeoutMs: 1,
  canLoad: contractAccessPolicy,
  fallback: contractRemoteFallback,
  load: async () => Remote
};

const typedSlotConfig: RemoteSlotConfig<{ contractVersion: number }> = {
  label: "typed contract slot",
  props: { contractVersion: 1 },
  onError: ({ label, error }) => void `${label}: ${String(error)}`,
  onStatusChange: status => void status,
  load: async () => TypedRemote
};

const remoteEntries = {
  stable: { name: "stable", entry: "http://127.0.0.1:4174/mf-manifest.json" }
} as const;

const integrityMap: IntegritySource = { "http://127.0.0.1:4174/static/js/stable.js": "sha384-contract" };
const integrityFn: IntegritySource = (url: string) => (url.endsWith(".js") ? "sha384-contract" : undefined);
const sriPluginOptions: SriPluginOptions = {
  integrity: integrityMap,
  strict: true,
  crossOrigin: "anonymous",
  onViolation: info => void info.url
};

const accessPlugin = createRemoteAccessPlugin(accessPluginOptions);
const fallbackPlugin = createRemoteFallbackPlugin(fallbackPluginOptions);
const sriPlugin = createSriPlugin(sriPluginOptions);
const sriPluginFn = createSriPlugin({ integrity: integrityFn });

const loadRemote = createFederatedLoader(remoteEntries);
const loadRemoteFromRuntime = createFederationRuntime({
  name: "contract_runtime_host",
  remoteEntries,
  shareStrategy: contractShareStrategy,
  shared: { react: createSharedSingleton("19.2.5", () => ({ createElement: () => null })) },
  plugins: [accessPlugin, fallbackPlugin]
});
const loadRemoteFromInstance = createInstanceFederationRuntime({
  name: "contract_instance_host",
  remoteEntries,
  plugins: [accessPlugin, fallbackPlugin, sriPlugin, sriPluginFn]
});

// Feature 4: createLoaderFromInstance — the instance is a caller-owned parameter (getInstance() null-guard is the caller's job).
const contractInstance = {
  registerPlugins: () => undefined,
  registerRemotes: () => undefined,
  loadRemote: async () => null
} as unknown as Parameters<typeof createLoaderFromInstance>[0];
const contractInstanceOptions: ShieldInstanceOptions<"stable"> = { remoteEntries, plugins: [accessPlugin, fallbackPlugin] };
const loadRemoteFromExistingInstance = createLoaderFromInstance(contractInstance, contractInstanceOptions);
const loadRemoteFromBareInstance = createLoaderFromInstance<"stable">(contractInstance);

// Feature 6: declarative stub map for the fallback (with the onLoad lifecycle gate applied internally).
const contractObjectStub: RemoteModuleStub = { RemoteWidget: Remote };
const contractFactoryStub: RemoteModuleStub = () => ({ RemoteWidget: Remote });
const contractAsyncStub: RemoteModuleStub = async () => ({ RemoteWidget: Remote });
const contractStubMap: RemoteStubMap = {
  "stable/Widget": contractObjectStub,
  "stable/Factory": contractFactoryStub,
  "stable/Async": contractAsyncStub,
  "*": { RemoteWidget: Remote }
};
const contractFallbackFn: RemoteFallback = (info: RemoteFallbackInfo) => (info.lifecycle === "onLoad" ? { RemoteWidget: Remote } : undefined);
const stubMapPlugin = createRemoteFallbackPlugin({ fallback: contractStubMap });
const fnFallbackPlugin = createRemoteFallbackPlugin({ fallback: contractFallbackFn });

// Feature 5: offline manifest synthesis via the fallback plugin's fetch loaderHook.
const contractOfflineInput: OfflineManifestInput = { name: "stable", globalName: "stable_g", publicPath: "/stable/", remoteEntryName: "remoteEntry.js" };
const contractOfflineManifest: OfflineManifest = buildOfflineManifest(contractOfflineInput);
const offlineManifestPlugin = createRemoteFallbackPlugin({
  fallback: contractStubMap,
  offlineManifest: contractOfflineInput,
  onOfflineManifest: info => void `${info.manifestUrl}: ${String(info.error)}`
});
const offlineManifestBoolPlugin = createRemoteFallbackPlugin({ fallback: () => undefined, offlineManifest: true });

void initFederationShield({ name: "contract_host", remotes: [] });
void withTimeout(Promise.resolve("ok"), 1, "contract timeout");
void evaluateRemoteAccess(() => allowRemoteAccess());
void evaluateRemoteAccess(() => false);
void loadRemote<{ RemoteWidget: RemoteComponent }>("stable/Widget");
void loadRemoteFromRuntime<{ RemoteWidget: RemoteComponent }>("stable/Widget");
void loadRemoteFromInstance<{ RemoteWidget: RemoteComponent }>("stable/Widget");
void loadRemoteFromExistingInstance<{ RemoteWidget: RemoteComponent }>("stable/Widget");
void loadRemoteFromBareInstance<{ RemoteWidget: RemoteComponent }>("stable/Widget");
void removeCssPoison;
void resolveIntegrity(integrityMap, "http://127.0.0.1:4174/static/js/stable.js");
void resolveIntegrity(integrityFn, "http://127.0.0.1:4174/static/js/stable.js");
void new FederationIntegrityError("http://127.0.0.1:4174/static/js/stable.js");
void validateSharedSingletons({ shared: contractSharedModules, shareStrategy: contractShareStrategy });
void contractSharedConfig;
void contractFederationShared;
void contractFederationStrategy;

// Feature 1: export-contract validation.
const contractModule: { RemoteWidget?: RemoteComponent } = { RemoteWidget: Remote };
assertRemoteExports(contractModule, "stable/Widget", ["RemoteWidget"]);
void contractModule.RemoteWidget;
void new MissingRemoteExportError("stable/Widget", ["RemoteWidget"]);

// Feature 2: remote entries validation (fully agnostic report).
const contractEntries: RemoteEntryInput[] = [
  { name: "stable", entry: "https://cdn.pokedex.example/stable/mf-manifest.json" },
  { name: "registry-only", version: "1.2.3" }
];
const contractEntriesPolicy: RemoteEntriesPolicy = { allowedOrigins: ["https://cdn.pokedex.example"], requireHttps: true };
const contractEntryIssues: RemoteEntryIssue[] = validateRemoteEntries(contractEntries, contractEntriesPolicy);
void contractEntryIssues;

// Feature 3: FederationResult narrow combinator.
void (async () => {
  const result: FederationResult<{ RemoteWidget: RemoteComponent }> = await toFederationResult(() =>
    loadRemote<{ RemoteWidget: RemoteComponent }>("stable/Widget")
  );
  if (result.ok) void result.value.RemoteWidget;
  else void result.error;
});

void contractOfflineManifest;
void stubMapPlugin;
void fnFallbackPlugin;
void offlineManifestPlugin;
void offlineManifestBoolPlugin;

export function ConsumerPublicApiContract() {
  useCssPoisonGuard(cssPoisonGuardOptions);

  return (
    <RemoteBoundary label="contract boundary">
      <RemoteSlot config={slotConfig} retryKey={1} />
      <RemoteSlot config={typedSlotConfig} />
    </RemoteBoundary>
  );
}

export function ProviderPublicApiContract() {
  return <ProviderBoundary {...providerBoundaryProps} />;
}
