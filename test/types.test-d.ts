import { describe, expectTypeOf, it } from "vitest";
import type { ComponentType } from "react";

import {
  buildOfflineManifest,
  createFederatedLoader,
  createLoaderFromInstance,
  createRemoteAccessPlugin,
  createRemoteFallbackPlugin
} from "../src/federation";
import type {
  OfflineManifest,
  OfflineManifestInput,
  RemoteFallback,
  RemoteModuleStub,
  RemoteStubMap,
  ShieldInstanceOptions
} from "../src/federation";
import { assertRemoteExports, toFederationResult, validateRemoteEntries, validateSharedSingletons } from "../src/core";
import type { FederationResult, RemoteEntriesPolicy, RemoteEntryInput, RemoteEntryIssue, SharedModules } from "../src/core";
import { MissingRemoteExportError } from "../src/errors";
import type { RemoteSlotConfig, RemoteComponent, RemoteSlotProps } from "../src/react";

const remoteEntries = {
  stable: { name: "stable", entry: "http://127.0.0.1:4174/mf-manifest.json" },
  untrusted: { name: "untrusted", entry: "https://cdn.pokedex.example/untrusted/mf-manifest.json" }
} as const;

type RemoteName = "stable" | "untrusted";

describe("createFederatedLoader typing", () => {
  it("constrains the loader id to the template-literal remote namespace", () => {
    const load = createFederatedLoader(remoteEntries);
    expectTypeOf(load).parameter(0).toEqualTypeOf<`${RemoteName}/${string}`>();
    expectTypeOf(load<{ ok: true }>).returns.resolves.toEqualTypeOf<{ ok: true }>();
  });
});

describe("RemoteSlotConfig typing", () => {
  it("requires a label and a load function returning a RemoteComponent", () => {
    expectTypeOf<RemoteSlotConfig>().toHaveProperty("label").toEqualTypeOf<string>();
    expectTypeOf<RemoteSlotConfig["load"]>().returns.resolves.toEqualTypeOf<RemoteComponent>();
    expectTypeOf<RemoteSlotConfig["timeoutMs"]>().toEqualTypeOf<number | undefined>();
  });
});

describe("RemoteComponent generic", () => {
  it("defaults to a no-props component type", () => {
    expectTypeOf<RemoteComponent>().toEqualTypeOf<ComponentType<Record<string, never>>>();
  });

  it("accepts a prop type parameter", () => {
    expectTypeOf<RemoteComponent<{ contractVersion: number }>>().toEqualTypeOf<ComponentType<{ contractVersion: number }>>();
  });

  it("flows the prop type through RemoteSlotConfig", () => {
    expectTypeOf<RemoteSlotConfig<{ n: number }>["load"]>().returns.resolves.toEqualTypeOf<ComponentType<{ n: number }>>();
  });

  it("exposes typed remote props through RemoteSlotConfig.props", () => {
    expectTypeOf<RemoteSlotConfig<{ n: number }>["props"]>().toEqualTypeOf<{ n: number } | undefined>();
  });
});

describe("RemoteSlotProps generic", () => {
  it("defaults config to a no-props RemoteSlotConfig", () => {
    expectTypeOf<RemoteSlotProps["config"]>().toEqualTypeOf<RemoteSlotConfig<Record<string, never>>>();
  });

  it("flows the prop type parameter into config", () => {
    expectTypeOf<RemoteSlotProps<{ n: number }>["config"]>().toEqualTypeOf<RemoteSlotConfig<{ n: number }>>();
  });

  it("keeps retryKey optional and numeric", () => {
    expectTypeOf<RemoteSlotProps["retryKey"]>().toEqualTypeOf<number | undefined>();
  });
});

describe("RemoteSlotConfig failure observability callbacks", () => {
  it("types onError with a label and error payload", () => {
    expectTypeOf<RemoteSlotConfig["onError"]>().toEqualTypeOf<
      ((info: { label: string; error: unknown }) => void) | undefined
    >();
  });

  it("types onStatusChange with the three lifecycle states", () => {
    expectTypeOf<RemoteSlotConfig["onStatusChange"]>().toEqualTypeOf<
      ((status: "loading" | "ready" | "failed") => void) | undefined
    >();
  });
});

describe("federation plugin factories typing", () => {
  it("returns a plugin object with a name", () => {
    expectTypeOf(createRemoteAccessPlugin({ policy: () => true })).toHaveProperty("name").toEqualTypeOf<string>();
    expectTypeOf(createRemoteFallbackPlugin({ fallback: () => undefined })).toHaveProperty("name").toEqualTypeOf<string>();
  });
});

describe("validateSharedSingletons typing", () => {
  it("takes shared modules and returns string warnings", () => {
    expectTypeOf(validateSharedSingletons).parameter(0).toHaveProperty("shared").toEqualTypeOf<SharedModules>();
    expectTypeOf(validateSharedSingletons).returns.toEqualTypeOf<string[]>();
  });
});

describe("assertRemoteExports typing", () => {
  it("narrows the module to mark expected keys as present and non-null", () => {
    const module: { RemoteWidget?: (() => null) | null } = {};
    assertRemoteExports(module, "stable/Widget", ["RemoteWidget"]);
    expectTypeOf(module.RemoteWidget).toEqualTypeOf<() => null>();
  });

  it("exposes id and missing fields on MissingRemoteExportError", () => {
    expectTypeOf<MissingRemoteExportError["id"]>().toEqualTypeOf<string>();
    expectTypeOf<MissingRemoteExportError["missing"]>().toEqualTypeOf<string[]>();
  });
});

describe("validateRemoteEntries typing", () => {
  it("takes readonly entries plus an optional policy and returns issues", () => {
    expectTypeOf(validateRemoteEntries).parameter(0).toEqualTypeOf<readonly RemoteEntryInput[]>();
    expectTypeOf(validateRemoteEntries).parameter(1).toEqualTypeOf<RemoteEntriesPolicy | undefined>();
    expectTypeOf(validateRemoteEntries).returns.toEqualTypeOf<RemoteEntryIssue[]>();
  });

  it("constrains the issue kind to the five union members", () => {
    expectTypeOf<RemoteEntryIssue["kind"]>().toEqualTypeOf<
      "duplicate-name" | "missing-entry" | "invalid-url" | "origin-not-allowed" | "insecure-entry"
    >();
  });
});

describe("toFederationResult typing", () => {
  it("resolves to a discriminated FederationResult", () => {
    expectTypeOf(toFederationResult<number>).returns.resolves.toEqualTypeOf<FederationResult<number>>();
  });

  it("narrows value on ok:true and error on ok:false", () => {
    const result = {} as FederationResult<{ value: 1 }, TypeError>;
    if (result.ok) {
      expectTypeOf(result.value).toEqualTypeOf<{ value: 1 }>();
    } else {
      expectTypeOf(result.error).toEqualTypeOf<TypeError>();
    }
  });
});

describe("createLoaderFromInstance typing", () => {
  it("accepts optional ShieldInstanceOptions and returns a typed loader", () => {
    expectTypeOf(createLoaderFromInstance).parameter(1).toEqualTypeOf<ShieldInstanceOptions<string> | undefined>();
    expectTypeOf<ShieldInstanceOptions<"stable">["remoteEntries"]>().toEqualTypeOf<
      Record<"stable", { name: "stable"; entry: string }> | undefined
    >();
  });
});

describe("fallback stub-map + offline manifest typing", () => {
  it("accepts a function or a stub map for fallback", () => {
    expectTypeOf(createRemoteFallbackPlugin).parameter(0).toHaveProperty("fallback").toEqualTypeOf<RemoteFallback | RemoteStubMap>();
  });

  it("types a stub as an object module or a (possibly async) factory", () => {
    expectTypeOf<RemoteModuleStub>().toEqualTypeOf<Record<string, unknown> | (() => unknown) | (() => Promise<unknown>)>();
  });

  it("buildOfflineManifest takes an optional input and returns an OfflineManifest", () => {
    expectTypeOf(buildOfflineManifest).parameter(0).toEqualTypeOf<OfflineManifestInput | undefined>();
    expectTypeOf(buildOfflineManifest).returns.toEqualTypeOf<OfflineManifest>();
  });
});
