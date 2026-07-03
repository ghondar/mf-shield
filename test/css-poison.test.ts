import { afterEach, describe, expect, it } from "vitest";

import { removeCssPoison } from "../src/core";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

function addStyle(root: ParentNode, attribute: string) {
  const style = document.createElement("style");
  if (attribute) style.setAttribute(attribute, "");
  (root as Element | Document).appendChild(style);
  return style;
}

describe("removeCssPoison", () => {
  it("removes only matching styles from document.head and returns the count", () => {
    addStyle(document.head, "data-mf-shield-poison");
    addStyle(document.head, "data-mf-shield-poison");
    addStyle(document.head, "");

    const removed = removeCssPoison();

    expect(removed).toBe(2);
    expect(document.head.querySelectorAll("style[data-mf-shield-poison]").length).toBe(0);
    expect(document.head.querySelectorAll("style").length).toBe(1);
  });

  it("honors a custom root and selector", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    addStyle(root, "data-custom-poison");
    addStyle(document.head, "data-custom-poison");

    const removed = removeCssPoison({ root, selector: "style[data-custom-poison]" });

    expect(removed).toBe(1);
    expect(root.querySelectorAll("style").length).toBe(0);
    expect(document.head.querySelectorAll("style[data-custom-poison]").length).toBe(1);
  });

  it("returns 0 when nothing matches", () => {
    addStyle(document.head, "");
    expect(removeCssPoison()).toBe(0);
  });
});
