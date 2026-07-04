import { afterEach, describe, expect, it, vi } from "vitest";

import { createRemoteFallbackPlugin } from "../src/federation";

vi.mock("@module-federation/runtime", () => ({
  init: vi.fn(),
  createInstance: vi.fn(),
  loadRemote: vi.fn(),
  registerRemotes: vi.fn()
}));

afterEach(() => {
  vi.clearAllMocks();
});

function errorArgs(id: string, lifecycle: string) {
  return { id, error: new Error("boom"), lifecycle, from: "runtime" } as never;
}

describe("createRemoteFallbackPlugin — RemoteStubMap (declarative)", () => {
  it("applies a matching stub object only in the onLoad lifecycle", () => {
    const stub = { RemoteWidget: () => null };
    const plugin = createRemoteFallbackPlugin({ fallback: { "stable/Widget": stub } });

    expect(plugin.errorLoadRemote?.(errorArgs("stable/Widget", "onLoad"))).toBe(stub);
  });

  it("does NOT apply the stub outside onLoad (afterResolve gate) — propagates undefined", () => {
    const stub = { RemoteWidget: () => null };
    const plugin = createRemoteFallbackPlugin({ fallback: { "stable/Widget": stub } });

    expect(plugin.errorLoadRemote?.(errorArgs("stable/Widget", "afterResolve"))).toBeUndefined();
    expect(plugin.errorLoadRemote?.(errorArgs("stable/Widget", "beforeRequest"))).toBeUndefined();
    expect(plugin.errorLoadRemote?.(errorArgs("stable/Widget", "beforeLoadShare"))).toBeUndefined();
  });

  it("invokes a factory stub (sync) and returns its module content", () => {
    const module = { RemoteWidget: () => null };
    const factory = vi.fn(() => module);
    const plugin = createRemoteFallbackPlugin({ fallback: { "stable/Widget": factory } });

    expect(plugin.errorLoadRemote?.(errorArgs("stable/Widget", "onLoad"))).toBe(module);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("invokes an async factory stub and resolves to its module content", async () => {
    const module = { RemoteWidget: () => null };
    const plugin = createRemoteFallbackPlugin({ fallback: { "stable/Widget": async () => module } });

    await expect(plugin.errorLoadRemote?.(errorArgs("stable/Widget", "onLoad"))).resolves.toBe(module);
  });

  it("falls back to the '*' catch-all when no exact key matches", () => {
    const star = { Fallback: () => null };
    const plugin = createRemoteFallbackPlugin({ fallback: { "*": star } });

    expect(plugin.errorLoadRemote?.(errorArgs("unknown/Thing", "onLoad"))).toBe(star);
  });

  it("returns undefined for a non-matching id with no catch-all (propagates)", () => {
    const plugin = createRemoteFallbackPlugin({ fallback: { "stable/Widget": { X: 1 } } });

    expect(plugin.errorLoadRemote?.(errorArgs("other/Thing", "onLoad"))).toBeUndefined();
  });

  it("still supports the function fallback variant (regression)", () => {
    const module = { RemoteWidget: () => null };
    const plugin = createRemoteFallbackPlugin({ fallback: info => (info.lifecycle === "onLoad" ? module : undefined) });

    expect(plugin.errorLoadRemote?.(errorArgs("stable/Widget", "onLoad"))).toBe(module);
    expect(plugin.errorLoadRemote?.(errorArgs("stable/Widget", "afterResolve"))).toBeUndefined();
  });
});
