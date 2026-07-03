import { describe, expect, it, vi } from "vitest";

import { createSriPlugin, resolveIntegrity } from "../src/federation";
import { FederationIntegrityError } from "../src/errors";

describe("resolveIntegrity", () => {
  it("resolves a hash from a map by exact url match", () => {
    const map = { "http://cdn/a.js": "sha384-AAA", "http://cdn/b.js": "sha384-BBB" };
    expect(resolveIntegrity(map, "http://cdn/a.js")).toBe("sha384-AAA");
    expect(resolveIntegrity(map, "http://cdn/b.js")).toBe("sha384-BBB");
  });

  it("returns undefined for a url absent from the map (exact match only)", () => {
    const map = { "http://cdn/a.js": "sha384-AAA" };
    expect(resolveIntegrity(map, "http://cdn/other.js")).toBeUndefined();
  });

  it("does not normalize trailing slashes or query strings (exact match)", () => {
    const map = { "http://cdn/a.js": "sha384-AAA" };
    expect(resolveIntegrity(map, "http://cdn/a.js?v=2")).toBeUndefined();
    expect(resolveIntegrity(map, "http://cdn/a.js/")).toBeUndefined();
  });

  it("delegates to a function resolver", () => {
    const fn = (url: string) => (url.endsWith(".js") ? "sha384-FN" : undefined);
    expect(resolveIntegrity(fn, "http://cdn/a.js")).toBe("sha384-FN");
    expect(resolveIntegrity(fn, "http://cdn/a.css")).toBeUndefined();
  });
});

describe("createSriPlugin", () => {
  const url = "http://cdn/remoteEntry.js";

  function scriptHook(plugin: ReturnType<typeof createSriPlugin>, arg: { url: string; attrs?: Record<string, unknown> }) {
    return plugin.createScript?.(arg as never) as HTMLScriptElement | { script?: HTMLScriptElement } | void;
  }

  it("names the plugin", () => {
    const plugin = createSriPlugin({ integrity: {} });
    expect(plugin.name).toBe("mf-shield-sri");
  });

  it("builds a script element with integrity and default crossOrigin when a hash exists", () => {
    const plugin = createSriPlugin({ integrity: { [url]: "sha384-HASH" } });

    const result = scriptHook(plugin, { url });

    expect(result).toBeInstanceOf(HTMLScriptElement);
    const script = result as HTMLScriptElement;
    // The browser reads the `integrity` attribute for SRI; jsdom 25 does not reflect the IDL property.
    expect(script.getAttribute("integrity")).toBe("sha384-HASH");
    expect(script.crossOrigin).toBe("anonymous");
    expect(script.src).toBe(url);
  });

  it("honors a configured crossOrigin value", () => {
    const plugin = createSriPlugin({ integrity: { [url]: "sha384-HASH" }, crossOrigin: "use-credentials" });

    const script = scriptHook(plugin, { url }) as HTMLScriptElement;

    expect(script.crossOrigin).toBe("use-credentials");
  });

  it("copies received attrs onto the returned element (MF skips its attr loop when we return one)", () => {
    const plugin = createSriPlugin({ integrity: { [url]: "sha384-HASH" } });

    const script = scriptHook(plugin, { url, attrs: { type: "text/javascript", fetchpriority: "high" } }) as HTMLScriptElement;

    expect(script.getAttribute("fetchpriority")).toBe("high");
  });

  it("resolves the hash via a function resolver", () => {
    const plugin = createSriPlugin({ integrity: () => "sha384-FN" });

    const script = scriptHook(plugin, { url }) as HTMLScriptElement;

    expect(script.getAttribute("integrity")).toBe("sha384-FN");
  });

  it("throws FederationIntegrityError in strict mode (default) when no hash is registered", () => {
    const plugin = createSriPlugin({ integrity: {} });

    expect(() => scriptHook(plugin, { url })).toThrow(FederationIntegrityError);
    expect(() => scriptHook(plugin, { url })).toThrow(`federation: no integrity hash registered for ${url}`);
  });

  it("calls onViolation before throwing in strict mode", () => {
    const onViolation = vi.fn();
    const plugin = createSriPlugin({ integrity: {}, onViolation });

    expect(() => scriptHook(plugin, { url })).toThrow(FederationIntegrityError);
    expect(onViolation).toHaveBeenCalledWith({ url });
  });

  it("passes through untouched (returns void) in non-strict mode when no hash is registered", () => {
    const onViolation = vi.fn();
    const plugin = createSriPlugin({ integrity: {}, strict: false, onViolation });

    expect(scriptHook(plugin, { url })).toBeUndefined();
    expect(onViolation).not.toHaveBeenCalled();
  });

  it("applies integrity via createLink for preload/css assets when a hash exists", () => {
    const cssUrl = "http://cdn/remote.css";
    const plugin = createSriPlugin({ integrity: { [cssUrl]: "sha384-CSS" } });

    const link = plugin.createLink?.({ url: cssUrl } as never) as HTMLLinkElement;

    expect(link).toBeInstanceOf(HTMLLinkElement);
    expect(link.getAttribute("integrity")).toBe("sha384-CSS");
    expect(link.crossOrigin).toBe("anonymous");
    expect(link.getAttribute("href")).toBe(cssUrl);
  });

  it("createLink passes through (void) in non-strict mode without a hash", () => {
    const plugin = createSriPlugin({ integrity: {}, strict: false });

    expect(plugin.createLink?.({ url: "http://cdn/x.css" } as never)).toBeUndefined();
  });
});
