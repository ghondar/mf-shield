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
  vi.unstubAllGlobals();
});

describe("createRemoteFallbackPlugin — offline manifest fetch hook", () => {
  it("has NO fetch hook property when offlineManifest is absent (zero behavior change)", () => {
    const plugin = createRemoteFallbackPlugin({ fallback: () => undefined });

    expect("fetch" in plugin).toBe(false);
  });

  it("gains a fetch hook when offlineManifest is enabled", () => {
    const plugin = createRemoteFallbackPlugin({ fallback: () => undefined, offlineManifest: true });

    expect(typeof plugin.fetch).toBe("function");
  });

  it("delegates to globalThis.fetch when the network succeeds", async () => {
    const realResponse = new Response("{}", { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(realResponse);
    vi.stubGlobal("fetch", fetchMock);

    const plugin = createRemoteFallbackPlugin({ fallback: () => undefined, offlineManifest: true });
    const result = await plugin.fetch?.("https://cdn.example/mf-manifest.json", {});

    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example/mf-manifest.json", {});
    expect(result).toBe(realResponse);
  });

  it("returns a synthesized manifest Response when the network throws, and calls onOfflineManifest", async () => {
    const netError = new Error("offline");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(netError));
    const onOfflineManifest = vi.fn();

    const plugin = createRemoteFallbackPlugin({
      fallback: () => undefined,
      offlineManifest: { name: "stable", globalName: "stable_g" },
      onOfflineManifest
    });

    const response = (await plugin.fetch?.("https://cdn.example/mf-manifest.json", {})) as Response;

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body.name).toBe("stable");
    expect(body.metaData.globalName).toBe("stable_g");
    expect(body.shared).toEqual([]);

    expect(onOfflineManifest).toHaveBeenCalledWith(
      expect.objectContaining({ manifestUrl: "https://cdn.example/mf-manifest.json", error: netError })
    );
  });
});
