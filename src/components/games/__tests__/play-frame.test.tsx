// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { HostServerOptions } from "@/lib/engine/host-server";

const fakes = vi.hoisted(() => ({
  created: [] as Array<{
    opts: HostServerOptions;
    server: {
      notifySavesChanged: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      resume: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    };
  }>,
}));

vi.mock("@/lib/engine/host-server", () => ({
  createHostServer: (opts: HostServerOptions) => {
    const server = {
      notifySavesChanged: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      dispose: vi.fn(),
    };
    fakes.created.push({ opts, server });
    return server;
  },
}));

const { PlayFrame } = await import("../PlayFrame");

const FRAME_URL = "https://play.example.test/frames/rel-1/index.html?host=jams";

function props(overrides: Partial<Parameters<typeof PlayFrame>[0]> = {}) {
  return {
    frameUrl: FRAME_URL,
    title: "Tactics",
    release: { id: "rel-1", gameId: "tactics", projectId: "proj-1" },
    saveMode: "site" as const,
    saves: vi.fn(),
    describe: () => "Saves stay in this browser.",
    prefs: { load: () => ({ remap: null, prefs: null }), save: vi.fn() },
    ...overrides,
  };
}

function last() {
  const entry = fakes.created.at(-1);
  if (!entry) throw new Error("no host server created");
  return entry;
}

let hidden = false;

beforeEach(() => {
  fakes.created.length = 0;
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PlayFrame", () => {
  it("renders the sandboxed iframe with the release's attributes", () => {
    render(<PlayFrame {...props()} />);
    const iframe = screen.getByTitle("Tactics");
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe.getAttribute("src")).toBe(FRAME_URL);
    expect(iframe.getAttribute("sandbox")).toBe(
      "allow-scripts allow-pointer-lock allow-popups allow-popups-to-escape-sandbox",
    );
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe.getAttribute("allow")).toBe(
      "fullscreen *; gamepad *; autoplay *; screen-wake-lock *",
    );
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("creates the host server on mount and disposes it on unmount", () => {
    const onHostServer = vi.fn();
    const { unmount } = render(<PlayFrame {...props({ onHostServer })} />);
    expect(fakes.created).toHaveLength(1);
    const { opts, server } = last();
    expect(opts.iframe).toBe(screen.getByTitle("Tactics"));
    expect(opts.release).toEqual({ id: "rel-1", gameId: "tactics", projectId: "proj-1" });
    expect(opts.mode).toBe("site");
    expect(opts.describe()).toBe("Saves stay in this browser.");
    expect(onHostServer).toHaveBeenLastCalledWith(server);
    unmount();
    expect(server.dispose).toHaveBeenCalledTimes(1);
    expect(onHostServer).toHaveBeenLastCalledWith(null);
  });

  it("keeps one server across re-renders and reads the latest callbacks", () => {
    const { rerender } = render(<PlayFrame {...props()} />);
    rerender(<PlayFrame {...props({ describe: () => "Saved to your account." })} />);
    expect(fakes.created).toHaveLength(1);
    expect(last().opts.describe()).toBe("Saved to your account.");
  });

  it("rebuilds the server for another release", () => {
    const { rerender } = render(<PlayFrame {...props()} />);
    const first = last().server;
    rerender(
      <PlayFrame
        {...props({
          frameUrl: "https://play.example.test/frames/rel-2/index.html?host=jams",
          release: { id: "rel-2", gameId: "tactics", projectId: "proj-1" },
        })}
      />,
    );
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(fakes.created).toHaveLength(2);
  });

  it("focuses the iframe on load and on click", () => {
    render(<PlayFrame {...props()} />);
    const iframe = screen.getByTitle("Tactics");
    const focus = vi.spyOn(iframe, "focus");
    fireEvent.load(iframe);
    expect(focus).toHaveBeenCalledTimes(1);
    fireEvent.click(iframe.parentElement!);
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it("pauses while the page is hidden", () => {
    render(<PlayFrame {...props()} />);
    const { server } = last();
    hidden = true;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(server.pause).toHaveBeenCalledTimes(1);
    hidden = false;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(server.resume).toHaveBeenCalledTimes(1);
  });

  it("pauses while a dialog is open, and refocuses the game after", () => {
    const { rerender } = render(<PlayFrame {...props()} />);
    const { server } = last();
    const focus = vi.spyOn(screen.getByTitle("Tactics"), "focus");
    rerender(<PlayFrame {...props({ dialogOpen: true })} />);
    expect(server.pause).toHaveBeenCalledTimes(1);
    hidden = true;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    rerender(<PlayFrame {...props({ dialogOpen: false })} />);
    expect(server.resume).not.toHaveBeenCalled();
    hidden = false;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(server.pause).toHaveBeenCalledTimes(1);
    expect(server.resume).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalled();
  });

  it("starts paused when mounted behind an open dialog", () => {
    render(<PlayFrame {...props({ dialogOpen: true })} />);
    expect(last().server.pause).toHaveBeenCalledTimes(1);
  });

  it("offers a Download recording button once the frame sends a download", () => {
    const createObjectURL = vi.fn(() => "blob:recording");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<PlayFrame {...props()} />);
    expect(screen.queryByRole("button", { name: /download recording/i })).toBeNull();

    act(() => {
      last().opts.onDownload?.({
        name: "../match.jamsrec",
        contentType: "application/json",
        bytes: new TextEncoder().encode("{}").buffer,
      });
    });
    const button = screen.getByRole("button", { name: /download recording/i });
    fireEvent.click(button);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("_match.jamsrec");
    expect(anchor.href).toBe("blob:recording");
  });

  it("ignores download offers when it offers no downloads", () => {
    render(<PlayFrame {...props({ offerDownloads: false })} />);
    act(() => {
      last().opts.onDownload?.({
        name: "match.jamsrec",
        contentType: "application/json",
        bytes: new TextEncoder().encode("{}").buffer,
      });
    });
    expect(screen.queryByRole("button", { name: /download recording/i })).toBeNull();
  });
});
