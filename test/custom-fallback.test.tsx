import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  RemoteBoundary,
  RemoteSlot,
  type RemoteComponent,
  type RemoteFallbackRenderer,
  type RemoteSlotConfig
} from "../src/react";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const customFallback: RemoteFallbackRenderer = ({ label, error }) => (
  <div data-testid="custom-fallback">
    custom for {label}: {String(error instanceof Error ? error.message : error)}
  </div>
);

function slot(overrides: Partial<RemoteSlotConfig> = {}): RemoteSlotConfig {
  return {
    label: "cards",
    fallback: customFallback,
    load: async () => (() => <span>ok</span>) as RemoteComponent,
    ...overrides
  };
}

describe("RemoteSlotConfig.fallback (custom renderer)", () => {
  it("replaces the default fallback UI on load failure", async () => {
    render(
      <RemoteSlot
        config={slot({
          load: async () => {
            throw new Error("load failed");
          }
        })}
      />
    );

    const custom = await screen.findByTestId("custom-fallback");
    expect(custom.textContent).toContain("custom for cards: load failed");
    expect(screen.queryByTestId("remote-fallback")).toBeNull();
  });

  it("replaces the default fallback UI on a render crash via RemoteBoundary", async () => {
    // Silence the boundary's componentDidCatch console.error noise.
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const Crashing: RemoteComponent = () => {
      throw new Error("render boom");
    };

    render(<RemoteSlot config={slot({ load: async () => Crashing })} />);

    const custom = await screen.findByTestId("custom-fallback");
    expect(custom.textContent).toContain("render boom");
    expect(screen.queryByTestId("remote-fallback")).toBeNull();
  });
});

describe("RemoteBoundary with a fallback prop", () => {
  it("renders the custom fallback when a child throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const Boom = () => {
      throw new Error("child boom");
    };

    render(
      <RemoteBoundary label="wrapped" fallback={customFallback}>
        <Boom />
      </RemoteBoundary>
    );

    const custom = screen.getByTestId("custom-fallback");
    expect(custom.textContent).toContain("custom for wrapped: child boom");
    expect(screen.queryByTestId("remote-fallback")).toBeNull();
  });

  it("renders the default RemoteFallback when no fallback prop is given", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const Boom = () => {
      throw new Error("child boom");
    };

    render(
      <RemoteBoundary label="wrapped">
        <Boom />
      </RemoteBoundary>
    );

    expect(screen.getByTestId("remote-fallback").textContent).toContain("child boom");
    expect(screen.queryByTestId("custom-fallback")).toBeNull();
  });
});
