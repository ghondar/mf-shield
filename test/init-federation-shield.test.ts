import { afterEach, describe, expect, it, vi } from "vitest";

import { initFederationShield } from "../src/federation";

const { initMock } = vi.hoisted(() => ({ initMock: vi.fn() }));

vi.mock("@module-federation/runtime", () => ({
  init: initMock,
  createInstance: vi.fn(),
  loadRemote: vi.fn(),
  registerRemotes: vi.fn()
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("initFederationShield", () => {
  it("forwards the given options to init", () => {
    const plugins = [{ name: "custom-plugin" }];
    initFederationShield({ name: "host", plugins } as never);

    expect(initMock).toHaveBeenCalledTimes(1);
    const passed = initMock.mock.calls[0]?.[0];
    expect(passed).toMatchObject({ name: "host", plugins });
  });

  it("defaults remotes to an empty array when none is provided", () => {
    initFederationShield({ name: "host" } as never);

    expect(initMock).toHaveBeenCalledWith(expect.objectContaining({ remotes: [] }));
  });

  it("keeps caller-provided remotes instead of defaulting", () => {
    const remotes = [{ name: "stable", entry: "http://127.0.0.1:4174/mf-manifest.json" }];
    initFederationShield({ name: "host", remotes } as never);

    expect(initMock).toHaveBeenCalledWith(expect.objectContaining({ remotes }));
  });

  it("returns whatever init returns", () => {
    const sentinel = Symbol("init-result");
    initMock.mockReturnValueOnce(sentinel);

    expect(initFederationShield({ name: "host" } as never)).toBe(sentinel);
  });
});
