// @vitest-environment node
import { describe, expect, it } from "vitest";

import { removeCssPoison } from "../src/core";

describe("removeCssPoison (SSR)", () => {
  it("returns 0 without throwing when document is undefined", () => {
    expect(typeof document).toBe("undefined");
    expect(() => removeCssPoison()).not.toThrow();
    expect(removeCssPoison()).toBe(0);
  });
});
