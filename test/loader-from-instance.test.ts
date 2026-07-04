import { afterEach, describe, expect, it, vi } from "vitest";

import { createLoaderFromInstance } from "../src/federation";
import { RemoteModuleNullError } from "../src/errors";

function makeInstance() {
  return {
    registerPlugins: vi.fn(),
    registerRemotes: vi.fn(),
    loadRemote: vi.fn()
  };
}

const remoteEntries = {
  stable: { name: "stable", entry: "http://127.0.0.1:4174/mf-manifest.json" }
} as const;

afterEach(() => {
  vi.clearAllMocks();
});

describe("createLoaderFromInstance", () => {
  it("registers the provided plugins once at creation via instance.registerPlugins", () => {
    const instance = makeInstance();
    const plugins = [{ name: "p1" }, { name: "p2" }];

    createLoaderFromInstance(instance as never, { plugins: plugins as never });

    expect(instance.registerPlugins).toHaveBeenCalledTimes(1);
    expect(instance.registerPlugins).toHaveBeenCalledWith(plugins);
  });

  it("does not call registerPlugins when no plugins are provided", () => {
    const instance = makeInstance();

    createLoaderFromInstance(instance as never);

    expect(instance.registerPlugins).not.toHaveBeenCalled();
  });

  it("registers each remote once (Set dedup) when remoteEntries are provided", async () => {
    const instance = makeInstance();
    instance.loadRemote.mockResolvedValue({ ok: true });
    const load = createLoaderFromInstance(instance as never, { remoteEntries });

    await load("stable/Widget");
    await load("stable/Other");

    expect(instance.registerRemotes).toHaveBeenCalledTimes(1);
    expect(instance.registerRemotes).toHaveBeenCalledWith([remoteEntries.stable]);
    expect(instance.loadRemote).toHaveBeenCalledWith("stable/Widget");
  });

  it("skips remote registration entirely when remoteEntries are omitted", async () => {
    const instance = makeInstance();
    instance.loadRemote.mockResolvedValue({ ok: true });
    const load = createLoaderFromInstance(instance as never);

    await load("stable/Widget");

    expect(instance.registerRemotes).not.toHaveBeenCalled();
    expect(instance.loadRemote).toHaveBeenCalledWith("stable/Widget");
  });

  it("throws RemoteModuleNullError when the instance returns no module", async () => {
    const instance = makeInstance();
    instance.loadRemote.mockResolvedValue(null);
    const load = createLoaderFromInstance(instance as never, { remoteEntries });

    await expect(load("stable/Widget")).rejects.toBeInstanceOf(RemoteModuleNullError);
    await expect(load("stable/Widget")).rejects.toThrow("federation: stable/Widget returned no module");
  });

  it("returns the resolved module", async () => {
    const instance = makeInstance();
    const module = { RemoteWidget: () => null };
    instance.loadRemote.mockResolvedValue(module);
    const load = createLoaderFromInstance(instance as never, { remoteEntries });

    await expect(load("stable/Widget")).resolves.toBe(module);
  });
});
