import { describe, expect, it } from "vitest";

import { toFederationResult } from "../src/core";

describe("toFederationResult", () => {
  it("wraps a resolved value as { ok: true, value }", async () => {
    const result = await toFederationResult(async () => ({ RemoteWidget: 1 }));

    expect(result).toEqual({ ok: true, value: { RemoteWidget: 1 } });
    if (result.ok) {
      expect(result.value.RemoteWidget).toBe(1);
    }
  });

  it("wraps a sync return value as { ok: true, value }", async () => {
    const result = await toFederationResult(() => 42);

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("wraps a rejection as { ok: false, error }", async () => {
    const boom = new Error("rejected");
    const result = await toFederationResult(async () => {
      throw boom;
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(boom);
    }
  });

  it("wraps a synchronous throw as { ok: false, error }", async () => {
    const boom = new Error("sync throw");
    const result = await toFederationResult(() => {
      throw boom;
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(boom);
    }
  });
});
