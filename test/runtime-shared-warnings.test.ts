import { afterEach, describe, expect, it, vi } from "vitest";

import { createFederationRuntime } from "../src/federation";

const { initMock } = vi.hoisted(() => ({ initMock: vi.fn() }));

vi.mock("@module-federation/runtime", () => ({
  init: initMock,
  loadRemote: vi.fn(),
  registerRemotes: vi.fn()
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const remoteEntries = { stable: { name: "stable", entry: "http://127.0.0.1:4174/mf-manifest.json" } } as const;

describe("createFederationRuntime shared singleton warnings", () => {
  it("warns with the [mf-shield] tag for a risky singleton config", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    createFederationRuntime({
      name: "risky_host",
      remoteEntries,
      shared: { react: { version: "19.2.5", shareConfig: { singleton: true } } }
    });

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.every(call => String(call[0]).startsWith("[mf-shield] "))).toBe(true);
  });

  it("does not warn for a clean singleton config", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    createFederationRuntime({
      name: "clean_host",
      remoteEntries,
      shared: { react: { version: "19.2.5", shareConfig: { singleton: true, strictVersion: true, requiredVersion: "19.2.5" } } }
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn when no shared config is provided", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    createFederationRuntime({ name: "no_shared_host", remoteEntries });

    expect(warn).not.toHaveBeenCalled();
  });
});
