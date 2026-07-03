import { afterEach, describe, expect, it, vi } from "vitest";

import { createTrailingDebounce } from "../src/internal";

afterEach(() => {
  vi.useRealTimers();
});

describe("createTrailingDebounce", () => {
  it("invokes immediately when waitMs is 0", () => {
    const fn = vi.fn();
    const debounced = createTrailingDebounce(fn, 0);

    debounced.run();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("invokes immediately when waitMs is negative", () => {
    const fn = vi.fn();
    const debounced = createTrailingDebounce(fn, -5);

    debounced.run();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("collapses rapid calls into a single trailing invocation", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createTrailingDebounce(fn, 100);

    debounced.run();
    debounced.run();
    debounced.run();

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("invokes again after the window elapses for a later call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createTrailingDebounce(fn, 100);

    debounced.run();
    vi.advanceTimersByTime(100);
    debounced.run();
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancel() clears a pending trailing invocation", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createTrailingDebounce(fn, 100);

    debounced.run();
    debounced.cancel();
    vi.advanceTimersByTime(100);

    expect(fn).not.toHaveBeenCalled();
  });

  it("cancel() is safe to call with no pending invocation", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createTrailingDebounce(fn, 100);

    expect(() => debounced.cancel()).not.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it("cancel() is a no-op in immediate mode", () => {
    const fn = vi.fn();
    const debounced = createTrailingDebounce(fn, 0);

    debounced.run();
    debounced.cancel();

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
