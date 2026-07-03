import { describe, expect, it } from "vitest";

import { validateSharedSingletons } from "../src/core";
import type { SharedModules } from "../src/core";

describe("validateSharedSingletons", () => {
  it("returns no warnings for a clean singleton with strictVersion and requiredVersion", () => {
    const shared: SharedModules = {
      react: { version: "19.2.5", shareConfig: { singleton: true, strictVersion: true, requiredVersion: "19.2.5" } }
    };

    expect(validateSharedSingletons({ shared })).toEqual([]);
  });

  it("warns when a singleton lacks strictVersion", () => {
    const shared: SharedModules = {
      react: { version: "19.2.5", shareConfig: { singleton: true, requiredVersion: "19.2.5" } }
    };

    const warnings = validateSharedSingletons({ shared });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("react");
    expect(warnings[0]).toContain("strictVersion");
  });

  it("warns when a singleton lacks requiredVersion", () => {
    const shared: SharedModules = {
      react: { version: "19.2.5", shareConfig: { singleton: true, strictVersion: true } }
    };

    const warnings = validateSharedSingletons({ shared });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("react");
    expect(warnings[0]).toContain("requiredVersion");
  });

  it("treats requiredVersion:false as missing and warns", () => {
    const shared: SharedModules = {
      react: { version: "19.2.5", shareConfig: { singleton: true, strictVersion: true, requiredVersion: false } }
    };

    const warnings = validateSharedSingletons({ shared });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("requiredVersion");
  });

  it("emits two warnings for a singleton missing both strictVersion and requiredVersion", () => {
    const shared: SharedModules = {
      react: { version: "19.2.5", shareConfig: { singleton: true } }
    };

    const warnings = validateSharedSingletons({ shared });

    expect(warnings).toHaveLength(2);
    expect(warnings.some(w => w.includes("strictVersion"))).toBe(true);
    expect(warnings.some(w => w.includes("requiredVersion"))).toBe(true);
  });

  it("does not warn about strict/required version for non-singleton entries", () => {
    const shared: SharedModules = {
      lodash: { version: "4.17.21", shareConfig: { singleton: false } }
    };

    expect(validateSharedSingletons({ shared })).toEqual([]);
  });

  it("warns once per singleton when shareStrategy is version-first (MF footgun 3209)", () => {
    const shared: SharedModules = {
      react: { version: "19.2.5", shareConfig: { singleton: true, strictVersion: true, requiredVersion: "19.2.5" } }
    };

    const warnings = validateSharedSingletons({ shared, shareStrategy: "version-first" });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("version-first");
    expect(warnings[0]).toContain("react");
  });

  it("does not add a version-first warning when shareStrategy is loaded-first", () => {
    const shared: SharedModules = {
      react: { version: "19.2.5", shareConfig: { singleton: true, strictVersion: true, requiredVersion: "19.2.5" } }
    };

    expect(validateSharedSingletons({ shared, shareStrategy: "loaded-first" })).toEqual([]);
  });

  it("does not add a version-first warning when there are no singletons", () => {
    const shared: SharedModules = {
      lodash: { version: "4.17.21", shareConfig: { singleton: false } }
    };

    expect(validateSharedSingletons({ shared, shareStrategy: "version-first" })).toEqual([]);
  });

  it("inspects every entry of an array-valued shared module", () => {
    const shared: SharedModules = {
      react: [
        { version: "19.2.5", shareConfig: { singleton: true, strictVersion: true, requiredVersion: "19.2.5" } },
        { version: "18.3.1", shareConfig: { singleton: true } }
      ]
    };

    const warnings = validateSharedSingletons({ shared });

    expect(warnings).toHaveLength(2);
    expect(warnings.every(w => w.includes("react"))).toBe(true);
  });

  it("returns an empty array when shared is empty", () => {
    expect(validateSharedSingletons({ shared: {} })).toEqual([]);
  });

  it("does not warn for entries without a shareConfig", () => {
    const shared: SharedModules = {
      react: { version: "19.2.5" }
    };

    expect(validateSharedSingletons({ shared })).toEqual([]);
  });
});
