import { describe, expect, it } from "vitest";

import { createSharedSingleton } from "../src/core";

describe("createSharedSingleton", () => {
  it("builds a singleton share descriptor with the expected shape", () => {
    const lib = () => ({ version: "x" });
    const shared = createSharedSingleton("19.2.5", lib);

    expect(shared).toEqual({
      version: "19.2.5",
      lib,
      shareConfig: { singleton: true, requiredVersion: "19.2.5", strictVersion: true }
    });
    expect(shared.lib).toBe(lib);
  });
});
