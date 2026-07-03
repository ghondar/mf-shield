import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { RemoteSlot, type RemoteComponent, type RemoteSlotConfig } from "../src/react";
import { FederationTimeoutError } from "../src/errors";
import { denyRemoteAccess } from "../src/core";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const Widget: RemoteComponent = () => <span data-testid="remote-widget">remote online</span>;

function slot(overrides: Partial<RemoteSlotConfig> = {}): RemoteSlotConfig {
  return {
    label: "stable widget",
    load: async () => Widget,
    ...overrides
  };
}

describe("RemoteSlot", () => {
  it("resolves and renders the remote component (status ready)", async () => {
    render(<RemoteSlot config={slot()} />);

    const widget = await screen.findByTestId("remote-widget");
    expect(widget.textContent).toBe("remote online");
    expect(screen.getByTestId("mf-shield-slot-status").textContent).toBe("status: ready");
    expect(screen.queryByTestId("remote-fallback")).toBeNull();
  });

  it("renders the default fallback with the error message when load rejects", async () => {
    const load = vi.fn(async () => {
      throw new Error("remote exploded");
    });

    render(<RemoteSlot config={slot({ load })} />);

    const fallback = await screen.findByTestId("remote-fallback");
    expect(fallback.textContent).toContain("remote exploded");
    expect(screen.getByTestId("mf-shield-slot-status").textContent).toBe("status: failed");
  });

  it("falls back with the denial reason when canLoad denies, without ever calling load", async () => {
    const load = vi.fn(async () => Widget);

    render(<RemoteSlot config={slot({ canLoad: () => denyRemoteAccess("admins only"), load })} />);

    const fallback = await screen.findByTestId("remote-fallback");
    expect(fallback.textContent).toContain("admins only");
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByTestId("remote-widget")).toBeNull();
  });

  it("times out with FederationTimeoutError when the load exceeds timeoutMs", async () => {
    vi.useFakeTimers();
    let capturedError: unknown;

    render(
      <RemoteSlot
        config={slot({
          timeoutMs: 800,
          load: () => new Promise<RemoteComponent>(() => undefined),
          fallback: ({ error }) => {
            capturedError = error;
            return <div data-testid="timeout-fallback">{String(error)}</div>;
          }
        })}
      />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(capturedError).toBeInstanceOf(FederationTimeoutError);
    expect(screen.getByTestId("timeout-fallback").textContent).toContain("timed out after 800ms");
  });

  it("does not update state (no warning) when unmounted before the load resolves", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let resolveLoad: (component: RemoteComponent) => void = () => undefined;
    const load = () =>
      new Promise<RemoteComponent>(resolve => {
        resolveLoad = resolve;
      });

    const { unmount } = render(<RemoteSlot config={slot({ load })} />);
    unmount();

    await act(async () => {
      resolveLoad(Widget);
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
    expect(screen.queryByTestId("remote-widget")).toBeNull();
  });
});

describe("RemoteSlot typed props (RemoteSlotConfig.props)", () => {
  it("forwards config.props to the remote component", async () => {
    const TypedWidget: RemoteComponent<{ greeting: string }> = ({ greeting }) => (
      <span data-testid="typed-widget">{greeting}</span>
    );

    const typedSlot: RemoteSlotConfig<{ greeting: string }> = {
      label: "typed widget",
      props: { greeting: "hola remoto" },
      load: async () => TypedWidget
    };

    render(<RemoteSlot config={typedSlot} />);

    const widget = await screen.findByTestId("typed-widget");
    expect(widget.textContent).toBe("hola remoto");
  });
});

describe("RemoteSlot.onError (failure observability)", () => {
  it("fires onError with the denial reason when canLoad denies", async () => {
    const onError = vi.fn();

    render(<RemoteSlot config={slot({ canLoad: () => denyRemoteAccess("admins only"), onError })} />);

    await screen.findByTestId("remote-fallback");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0].label).toBe("stable widget");
    expect(String(onError.mock.calls[0]![0].error)).toContain("admins only");
  });

  it("fires onError when load rejects", async () => {
    const onError = vi.fn();
    const load = async () => {
      throw new Error("remote exploded");
    };

    render(<RemoteSlot config={slot({ load, onError })} />);

    await screen.findByTestId("remote-fallback");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]![0].error)).toContain("remote exploded");
  });

  it("fires onError on timeout with a FederationTimeoutError", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();

    render(
      <RemoteSlot
        config={slot({
          timeoutMs: 800,
          load: () => new Promise<RemoteComponent>(() => undefined),
          onError
        })}
      />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0].error).toBeInstanceOf(FederationTimeoutError);
  });

  it("fires onError when the remote crashes on render (via RemoteBoundary)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onError = vi.fn();
    const Crashing: RemoteComponent = () => {
      throw new Error("render boom");
    };

    render(<RemoteSlot config={slot({ load: async () => Crashing, onError })} />);

    await screen.findByTestId("remote-fallback");
    expect(onError).toHaveBeenCalled();
    expect(String(onError.mock.calls.at(-1)![0].error)).toContain("render boom");
    expect(onError.mock.calls.at(-1)![0].label).toBe("stable widget");
  });
});

describe("RemoteSlot.onStatusChange (transition sequence)", () => {
  it("emits loading then ready on a successful load", async () => {
    const statuses: string[] = [];

    render(<RemoteSlot config={slot({ onStatusChange: status => statuses.push(status) })} />);

    await screen.findByTestId("remote-widget");
    expect(statuses).toEqual(["loading", "ready"]);
  });

  it("emits loading then failed on a load rejection", async () => {
    const statuses: string[] = [];
    const load = async () => {
      throw new Error("nope");
    };

    render(<RemoteSlot config={slot({ load, onStatusChange: status => statuses.push(status) })} />);

    await screen.findByTestId("remote-fallback");
    expect(statuses).toEqual(["loading", "failed"]);
  });
});

describe("RemoteSlot callbacks after unmount", () => {
  it("does not fire onStatusChange nor onError after unmount", async () => {
    const onStatusChange = vi.fn();
    const onError = vi.fn();
    let rejectLoad: (reason: unknown) => void = () => undefined;
    const load = () =>
      new Promise<RemoteComponent>((_, reject) => {
        rejectLoad = reject;
      });

    const { unmount } = render(<RemoteSlot config={slot({ load, onStatusChange, onError })} />);

    // Only the initial "loading" transition should have fired synchronously.
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith("loading");

    unmount();

    await act(async () => {
      rejectLoad(new Error("too late"));
      await Promise.resolve();
    });

    // No "failed" transition and no onError after unmount.
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
