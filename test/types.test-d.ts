import { describe, expectTypeOf, it } from "vitest";
import type { ComponentType } from "react";

import { createFederatedLoader, createRemoteAccessPlugin, createRemoteFallbackPlugin } from "../src/federation";
import { validateSharedSingletons } from "../src/core";
import type { SharedModules } from "../src/core";
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
