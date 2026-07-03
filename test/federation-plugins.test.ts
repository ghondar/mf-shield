import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFederationRuntime,
  createInstanceFederationRuntime,
  createRemoteAccessPlugin,
  createRemoteFallbackPlugin
} from "../src/federation";
import { RemoteAccessDeniedError, RemoteModuleNullError } from "../src/errors";

const { initMock, createInstanceMock, instanceLoadRemoteMock, instanceRegisterRemotesMock } = vi.hoisted(() => {
  const instanceLoadRemoteMock = vi.fn();
  const instanceRegisterRemotesMock = vi.fn();
  return {
    initMock: vi.fn(),
    instanceLoadRemoteMock,
    instanceRegisterRemotesMock,
    createInstanceMock: vi.fn(() => ({
      loadRemote: instanceLoadRemoteMock,
      registerRemotes: instanceRegisterRemotesMock
    }))
  };
});

vi.mock("@module-federation/runtime", () => ({
  init: initMock,
  createInstance: createInstanceMock,
  loadRemote: vi.fn(),
  registerRemotes: vi.fn()
}));

afterEach(() => {
  vi.clearAllMocks();
});

const beforeRequestArgs = { id: "untrusted/Widget", options: {}, origin: {} } as never;

describe("createRemoteAccessPlugin", () => {
  it("names the plugin", () => {
    const plugin = createRemoteAccessPlugin({ policy: () => true });
    expect(plugin.name).toBe("mf-shield-remote-access");
  });

  it("returns the beforeRequest args unchanged when the policy allows the remote", () => {
    const plugin = createRemoteAccessPlugin({ policy: () => true });

    expect(plugin.beforeRequest?.(beforeRequestArgs)).toBe(beforeRequestArgs);
  });

  it("passes the extracted remote name (not the full id) to the policy", () => {
    const policy = vi.fn(() => true);
    const plugin = createRemoteAccessPlugin({ policy });

    plugin.beforeRequest?.(beforeRequestArgs);

    expect(policy).toHaveBeenCalledWith("untrusted");
  });

  it("throws RemoteAccessDeniedError with the federation: prefix when denied", () => {
    const plugin = createRemoteAccessPlugin({ policy: () => ({ allowed: false, reason: "blocked untrusted" }) });

    expect(() => plugin.beforeRequest?.(beforeRequestArgs)).toThrow(RemoteAccessDeniedError);
    expect(() => plugin.beforeRequest?.(beforeRequestArgs)).toThrow("federation: blocked untrusted");
  });

  it("uses the default reason when a denied decision omits the reason", () => {
    const plugin = createRemoteAccessPlugin({ policy: () => false });

    expect(() => plugin.beforeRequest?.(beforeRequestArgs)).toThrow("federation: access denied before remote import");
  });

  it("invokes onDenied with the remote and reason before throwing", () => {
    const onDenied = vi.fn();
    const plugin = createRemoteAccessPlugin({ policy: () => ({ allowed: false, reason: "nope" }), onDenied });

    expect(() => plugin.beforeRequest?.(beforeRequestArgs)).toThrow();
    expect(onDenied).toHaveBeenCalledWith({ remote: "untrusted", reason: "nope" });
  });

  it("does not call onDenied when the remote is allowed", () => {
    const onDenied = vi.fn();
    const plugin = createRemoteAccessPlugin({ policy: () => true, onDenied });

    plugin.beforeRequest?.(beforeRequestArgs);

    expect(onDenied).not.toHaveBeenCalled();
  });
});

const errorArgs = {
  id: "untrusted/Widget",
  error: new Error("boom"),
  lifecycle: "onLoad",
  from: "runtime"
} as never;

describe("createRemoteFallbackPlugin", () => {
  it("names the plugin", () => {
    const plugin = createRemoteFallbackPlugin({ fallback: () => undefined });
    expect(plugin.name).toBe("mf-shield-remote-fallback");
  });

  it("passes normalized info (id, error, lifecycle, from) to the fallback", () => {
    const fallback = vi.fn(() => undefined);
    const plugin = createRemoteFallbackPlugin({ fallback });
    const error = new Error("boom");

    plugin.errorLoadRemote?.({ id: "untrusted/Widget", error, lifecycle: "onLoad", from: "runtime" } as never);

    expect(fallback).toHaveBeenCalledWith({ id: "untrusted/Widget", error, lifecycle: "onLoad", from: "runtime" });
  });

  it("returns undefined (propagates the error) when the fallback returns undefined", () => {
    const plugin = createRemoteFallbackPlugin({ fallback: () => undefined });

    expect(plugin.errorLoadRemote?.(errorArgs)).toBeUndefined();
  });

  it("returns the fallback module content when the fallback provides one", () => {
    const module = { RemoteWidget: () => null };
    const plugin = createRemoteFallbackPlugin({ fallback: () => module });

    expect(plugin.errorLoadRemote?.(errorArgs)).toBe(module);
  });
});

const remoteEntries = { stable: { name: "stable", entry: "http://127.0.0.1:4174/mf-manifest.json" } } as const;

describe("createFederationRuntime plugin pass-through", () => {
  it("forwards plugins to init", () => {
    const plugin = createRemoteAccessPlugin({ policy: () => true });

    createFederationRuntime({ name: "host_with_plugins", remoteEntries, plugins: [plugin] });

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock.mock.calls[0]?.[0]).toMatchObject({ name: "host_with_plugins", plugins: [plugin] });
  });
});

describe("createInstanceFederationRuntime", () => {
  it("builds an isolated instance via createInstance (not init) and forwards plugins", () => {
    const plugin = createRemoteAccessPlugin({ policy: () => true });

    createInstanceFederationRuntime({ name: "isolated_host", remoteEntries, plugins: [plugin] });

    expect(initMock).not.toHaveBeenCalled();
    expect(createInstanceMock).toHaveBeenCalledTimes(1);
    expect(createInstanceMock.mock.calls[0]?.[0]).toMatchObject({ name: "isolated_host", plugins: [plugin] });
  });

  it("returns a loader that registers each remote once on the instance and delegates to instance.loadRemote", async () => {
    instanceLoadRemoteMock.mockResolvedValue({ ok: true });
    const load = createInstanceFederationRuntime({ name: "isolated_host", remoteEntries });

    await load("stable/Widget");
    await load("stable/Other");

    expect(instanceRegisterRemotesMock).toHaveBeenCalledTimes(1);
    expect(instanceRegisterRemotesMock).toHaveBeenCalledWith([remoteEntries.stable]);
    expect(instanceLoadRemoteMock).toHaveBeenCalledWith("stable/Widget");
  });

  it("throws RemoteModuleNullError when the instance returns no module", async () => {
    instanceLoadRemoteMock.mockResolvedValue(null);
    const load = createInstanceFederationRuntime({ name: "isolated_host", remoteEntries });

    await expect(load("stable/Widget")).rejects.toBeInstanceOf(RemoteModuleNullError);
  });

  it("emits [mf-shield] shared singleton warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    createInstanceFederationRuntime({
      name: "isolated_risky",
      remoteEntries,
      shared: { react: { version: "19.2.5", shareConfig: { singleton: true } } }
    });

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.every(call => String(call[0]).startsWith("[mf-shield] "))).toBe(true);
    warn.mockRestore();
  });
});
