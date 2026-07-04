import { describe, expect, it } from "vitest";

import { assertRemoteExports } from "../src/core";
import { MissingRemoteExportError } from "../src/errors";

describe("assertRemoteExports", () => {
  it("does not throw when every expected export is present", () => {
    const module = { RemoteWidget: () => null, meta: { version: 1 } };

    expect(() => assertRemoteExports(module, "stable/Widget", ["RemoteWidget", "meta"])).not.toThrow();
  });

  it("throws MissingRemoteExportError when an export is undefined", () => {
    const module: { RemoteWidget?: () => null; meta?: unknown } = { meta: {} };

    expect(() => assertRemoteExports(module, "stable/Widget", ["RemoteWidget"])).toThrow(MissingRemoteExportError);
  });

  it("treats a null export as missing (null OR undefined)", () => {
    const module = { RemoteWidget: null as unknown as () => null };

    expect(() => assertRemoteExports(module, "stable/Widget", ["RemoteWidget"])).toThrow(MissingRemoteExportError);
  });

  it("collects every missing export and lists them in the message", () => {
    const module: { a?: unknown; b?: unknown; c?: unknown } = { b: 1 };

    let caught: unknown;
    try {
      assertRemoteExports(module, "stable/Widget", ["a", "b", "c"]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MissingRemoteExportError);
    const error = caught as MissingRemoteExportError;
    expect(error.id).toBe("stable/Widget");
    expect(error.missing).toEqual(["a", "c"]);
    expect(error.message).toBe("federation: stable/Widget is missing expected export(s): a, c");
    expect(error.name).toBe("MissingRemoteExportError");
  });

  it("does not flag falsy-but-present values (0, empty string, false)", () => {
    const module = { count: 0, label: "", flag: false };

    expect(() => assertRemoteExports(module, "stable/Widget", ["count", "label", "flag"])).not.toThrow();
  });

  it("does not throw for an empty expected list", () => {
    expect(() => assertRemoteExports({}, "stable/Widget", [])).not.toThrow();
  });
});
