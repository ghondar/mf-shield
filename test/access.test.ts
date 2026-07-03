import { describe, expect, it } from "vitest";

import { allowRemoteAccess, denyRemoteAccess, evaluateRemoteAccess } from "../src/core";

const defaultDeniedReason = "access denied before remote import";

describe("allowRemoteAccess", () => {
  it("returns an allowed decision", () => {
    expect(allowRemoteAccess()).toEqual({ allowed: true });
  });
});

describe("denyRemoteAccess", () => {
  it("returns a denied decision with the default reason", () => {
    expect(denyRemoteAccess()).toEqual({ allowed: false, reason: defaultDeniedReason });
  });

  it("returns a denied decision with a custom reason", () => {
    expect(denyRemoteAccess("nope")).toEqual({ allowed: false, reason: "nope" });
  });
});

describe("evaluateRemoteAccess", () => {
  it("allows access when no policy is provided", () => {
    expect(evaluateRemoteAccess()).toEqual({ allowed: true });
  });

  it("allows access when the policy returns true", () => {
    expect(evaluateRemoteAccess(() => true)).toEqual({ allowed: true, reason: undefined });
  });

  it("denies access with the default reason when the policy returns false", () => {
    expect(evaluateRemoteAccess(() => false)).toEqual({ allowed: false, reason: defaultDeniedReason });
  });

  it("passes through an object decision with a reason", () => {
    expect(evaluateRemoteAccess(() => ({ allowed: false, reason: "blocked" }))).toEqual({
      allowed: false,
      reason: "blocked"
    });
  });

  it("falls back to the default reason for a denied object without a reason", () => {
    expect(evaluateRemoteAccess(() => ({ allowed: false }))).toEqual({
      allowed: false,
      reason: defaultDeniedReason
    });
  });

  it("does not attach a reason to an allowed object decision", () => {
    expect(evaluateRemoteAccess(() => ({ allowed: true }))).toEqual({ allowed: true, reason: undefined });
  });
});
