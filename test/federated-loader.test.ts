import { afterEach, describe, expect, it, vi } from "vitest";

import { createFederatedLoader } from "../src/federation";
import { RemoteModuleNullError } from "../src/errors";

const { loadRemoteMock, registerRemotesMock } = vi.hoisted(() => ({
  loadRemoteMock: vi.fn(),
  registerRemotesMock: vi.fn()
}));

vi.mock("@module-federation/runtime", () => ({
  init: vi.fn(),
  loadRemote: loadRemoteMock,
  registerRemotes: registerRemotesMock
}));

const remoteEntries = {
  stable: { name: "stable", entry: "http://127.0.0.1:4174/mf-manifest.json" }
} as const;

afterEach(() => {
  vi.clearAllMocks();
});

describe("createFederatedLoader", () => {
  it("registers a remote only once across repeated loads (Set dedup)", async () => {
    loadRemoteMock.mockResolvedValue({ ok: true });
    const load = createFederatedLoader(remoteEntries);

    await load("stable/Widget");
    await load("stable/Other");

    expect(registerRemotesMock).toHaveBeenCalledTimes(1);
    expect(registerRemotesMock).toHaveBeenCalledWith([remoteEntries.stable]);
  });

  it("passes the full id to loadRemote", async () => {
    loadRemoteMock.mockResolvedValue({ ok: true });
    const load = createFederatedLoader(remoteEntries);

    await load("stable/Widget");

    expect(loadRemoteMock).toHaveBeenCalledWith("stable/Widget");
  });

  it("returns the resolved module", async () => {
    const module = { RemoteWidget: () => null };
    loadRemoteMock.mockResolvedValue(module);
    const load = createFederatedLoader(remoteEntries);

    await expect(load("stable/Widget")).resolves.toBe(module);
  });

  it("throws RemoteModuleNullError with the exact message when the module is null", async () => {
    loadRemoteMock.mockResolvedValue(null);
    const load = createFederatedLoader(remoteEntries);

    await expect(load("stable/Widget")).rejects.toBeInstanceOf(RemoteModuleNullError);
    await expect(load("stable/Widget")).rejects.toThrow("federation: stable/Widget returned no module");
  });
});
