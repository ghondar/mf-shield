import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { useCssPoisonGuard } from "../src/react";
import type { CssPoisonGuardOptions } from "../src/core";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

function Guard(props: CssPoisonGuardOptions) {
  useCssPoisonGuard(props);
  return null;
}

function addStyle(root: ParentNode, selectorAttr: string, id?: string) {
  const style = document.createElement("style");
  style.setAttribute(selectorAttr, "");
  if (id) style.id = id;
  (root as Element).appendChild(style);
  return style;
}

describe("useCssPoisonGuard", () => {
  it("removes injected poison from a custom root using a custom selector on mount", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    addStyle(root, "data-custom-poison");
    // A poison in the default head must NOT be touched when a custom root is scoped.
    addStyle(document.head, "data-custom-poison");

    const onPoisonRemoved = vi.fn();
    render(<Guard root={root} selector="style[data-custom-poison]" onPoisonRemoved={onPoisonRemoved} />);

    expect(root.querySelectorAll("style").length).toBe(0);
    expect(document.head.querySelectorAll("style[data-custom-poison]").length).toBe(1);
    expect(onPoisonRemoved).toHaveBeenCalledWith(1);
  });

  it("removes poison reinjected later via MutationObserver on the debounced path", async () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    document.body.appendChild(root);

    const onPoisonRemoved = vi.fn();
    render(<Guard root={root} selector="style[data-custom-poison]" debounceMs={50} onPoisonRemoved={onPoisonRemoved} />);

    // Nothing on mount.
    expect(onPoisonRemoved).not.toHaveBeenCalled();

    // Reinject poison; the MutationObserver schedules a trailing debounced clean.
    await act(async () => {
      addStyle(root, "data-custom-poison");
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(root.querySelectorAll("style[data-custom-poison]").length).toBe(0);
    expect(onPoisonRemoved).toHaveBeenCalledWith(1);
  });

  it("does not invoke onPoisonRemoved when nothing matches", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    addStyle(root, "data-not-poison");

    const onPoisonRemoved = vi.fn();
    render(<Guard root={root} selector="style[data-custom-poison]" onPoisonRemoved={onPoisonRemoved} />);

    expect(onPoisonRemoved).not.toHaveBeenCalled();
    expect(root.querySelectorAll("style").length).toBe(1);
  });
});
