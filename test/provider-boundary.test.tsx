import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ProviderBoundary, type ProviderFallbackRenderer } from "../src/react";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const Boom = () => {
  throw new Error("provider internal failure");
};

describe("ProviderBoundary", () => {
  it("renders a custom fallback renderer when a child throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const fallback: ProviderFallbackRenderer = error => (
      <div data-testid="custom-provider-fallback">recovered: {error.message}</div>
    );

    render(
      <ProviderBoundary fallback={fallback}>
        <Boom />
      </ProviderBoundary>
    );

    expect(screen.getByTestId("custom-provider-fallback").textContent).toContain("recovered: provider internal failure");
    expect(screen.queryByTestId("provider-fallback")).toBeNull();
  });

  it("renders the default ProviderFallback when no fallback prop is given", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ProviderBoundary>
        <Boom />
      </ProviderBoundary>
    );

    expect(screen.getByTestId("provider-fallback").textContent).toContain("provider internal failure");
    expect(screen.queryByTestId("custom-provider-fallback")).toBeNull();
  });

  it("renders children unchanged when nothing throws", () => {
    render(
      <ProviderBoundary>
        <span data-testid="healthy-child">healthy</span>
      </ProviderBoundary>
    );

    expect(screen.getByTestId("healthy-child").textContent).toBe("healthy");
    expect(screen.queryByTestId("provider-fallback")).toBeNull();
  });
});
