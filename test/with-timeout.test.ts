import { afterEach, describe, expect, it, vi } from "vitest";

import { withTimeout } from "../src/core";
import { FederationTimeoutError } from "../src/errors";

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("passes through a resolved value", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50, "slot")).resolves.toBe("ok");
  });

  it("passes through a rejection", async () => {
    const rejection = new Error("upstream failure");
    await expect(withTimeout(Promise.reject(rejection), 50, "slot")).rejects.toBe(rejection);
  });

  it("rejects with FederationTimeoutError and the exact message on timeout", async () => {
    vi.useFakeTimers();
    const pending = new Promise<string>(() => undefined);
    const raced = withTimeout(pending, 500, "remote timeout");
    const assertion = expect(raced).rejects.toMatchObject({
      name: "FederationTimeoutError",
      message: "federation: remote timeout timed out after 500ms"
    });
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    await expect(raced).rejects.toBeInstanceOf(FederationTimeoutError);
  });

  it("clears the timer when the promise wins the race (no leak)", async () => {
    vi.useFakeTimers();
    let resolve!: (value: string) => void;
    const controlled = new Promise<string>(res => {
      resolve = res;
    });

    const raced = withTimeout(controlled, 1000, "slot");
    expect(vi.getTimerCount()).toBe(1);

    resolve("done");
    await expect(raced).resolves.toBe("done");

    expect(vi.getTimerCount()).toBe(0);
  });
});
