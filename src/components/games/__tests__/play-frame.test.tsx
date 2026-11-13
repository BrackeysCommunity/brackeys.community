// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { HostServerOptions } from "@/lib/engine/host-server";
import type { LiveClientOptions } from "@/lib/engine/live-client";
import type { LiveSnapshot } from "@/lib/engine/live-state";

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

const downloads = vi.hoisted(() => ({ downloadBlob: vi.fn<(name: string, blob: Blob) => void>() }));
vi.mock("@/lib/download", () => downloads);

const live = vi.hoisted(() => ({
  clients: [] as Array<{ opts: LiveClientOptions; dispose: ReturnType<typeof vi.fn> }>,
}));
vi.mock("@/lib/engine/live-client", () => ({
  createLiveClient: (opts: LiveClientOptions) => {
    const dispose = vi.fn();
    live.clients.push({ opts, dispose });
    return { dispose };
  },
}));

const toasts = vi.hoisted(() => ({
  show: vi.fn(),
  dismiss: vi.fn(),
  loading: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({
  toast: Object.assign(toasts.show, {
    dismiss: toasts.dismiss,
    loading: toasts.loading,
    error: toasts.error,
  }),
}));

const {
  PlayFrame,
  LIVE_RELEASE_LOADING,
  LIVE_REMOVED_NOTICE,
  LIVE_SWAP_TOAST,
  liveReleaseFailedToast,
  liveReleaseToast,
} = await import("../PlayFrame");

type ToastAction = { label: string; onClick: (event: { preventDefault(): void }) => void };
const click = (action: ToastAction) => {
  const preventDefault = vi.fn();
  action.onClick({ preventDefault });
  return preventDefault;
};

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
  live.clients.length = 0;
  toasts.show.mockReset();
  toasts.dismiss.mockReset();
  toasts.loading.mockReset();
  toasts.error.mockReset();
  downloads.downloadBlob.mockReset();
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
    render(<PlayFrame {...props()} />);
    expect(screen.queryByRole("button", { name: /download recording/i })).toBeNull();

    act(() => {
      last().opts.onDownload?.(
        {
          name: "../match.jamsrec",
          contentType: "application/json",
          bytes: new TextEncoder().encode("{}").buffer,
        },
        { requested: false },
      );
    });
    const button = screen.getByRole("button", { name: /download recording/i });
    fireEvent.click(button);

    expect(downloads.downloadBlob).toHaveBeenCalledTimes(1);
    const [name, blob] = downloads.downloadBlob.mock.calls[0]!;
    expect(name).toBe("_match.jamsrec");
    expect(blob.type).toBe("application/json");
    expect(blob.size).toBe(2);
  });

  it("ignores download offers when it offers no downloads", () => {
    render(<PlayFrame {...props({ offerDownloads: false })} />);
    act(() => {
      last().opts.onDownload?.(
        {
          name: "match.jamsrec",
          contentType: "application/json",
          bytes: new TextEncoder().encode("{}").buffer,
        },
        { requested: false },
      );
    });
    expect(screen.queryByRole("button", { name: /download recording/i })).toBeNull();
    expect(downloads.downloadBlob).not.toHaveBeenCalled();
  });

  it("saves a recording the page asked for straight away, without an offer", () => {
    render(<PlayFrame {...props({ offerDownloads: false })} />);
    act(() => {
      last().opts.onDownload?.(
        {
          name: "hall.recording.json",
          contentType: "application/json",
          bytes: new TextEncoder().encode("{}").buffer,
        },
        { requested: true },
      );
    });
    expect(downloads.downloadBlob).toHaveBeenCalledTimes(1);
    const [name, blob] = downloads.downloadBlob.mock.calls[0]!;
    expect(name).toBe("hall.recording.json");
    expect(blob.type).toBe("application/json");
    expect(screen.queryByRole("button", { name: /download recording/i })).toBeNull();
  });
});

const SNAPSHOT: LiveSnapshot = {
  channel: "production",
  rev: 3,
  release: "rel-1",
  scenes: [
    {
      scene: "ford",
      version: "f".repeat(64),
      number: 2,
      timing: "now",
      since: "2026-11-12T14:48:00.000Z",
    },
  ],
  removed: [],
};

function liveClient() {
  const entry = live.clients.at(-1);
  if (!entry) throw new Error("no live client created");
  return entry;
}

describe("PlayFrame's live levels", () => {
  it("starts no live client for a numbered play, and welcomes the frame with no live scenes", () => {
    render(<PlayFrame {...props({ live: null })} />);
    expect(live.clients).toHaveLength(0);
    expect(last().opts.live?.()).toBeNull();
  });

  it("follows the payload's channel over the host server it creates, and stops with it", () => {
    const { unmount } = render(<PlayFrame {...props({ live: SNAPSHOT })} />);
    expect(live.clients).toHaveLength(1);
    const { opts, dispose } = liveClient();
    expect(opts).toMatchObject({ projectId: "proj-1", channel: "production", initial: SNAPSHOT });
    expect(opts.host).toBe(last().server);
    expect(last().opts.live?.()).toEqual(SNAPSHOT);
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("starts no client for live scenes over another release", () => {
    render(<PlayFrame {...props({ live: { ...SNAPSHOT, release: "rel-0" } })} />);
    expect(live.clients).toHaveLength(0);
  });

  it("tells the player when a level was just updated", () => {
    render(<PlayFrame {...props({ live: SNAPSHOT })} />);
    act(() =>
      liveClient().opts.onSwapApplied?.({ scene: "ford", version: "f".repeat(64), timing: "now" }),
    );
    expect(toasts.show).toHaveBeenCalledTimes(1);
    expect(toasts.show).toHaveBeenCalledWith("This level was just updated.");
    expect(LIVE_SWAP_TOAST).toBe("This level was just updated.");
  });

  it("offers Reload for a new release, which loads the play again", async () => {
    const onReload = vi.fn(async () => {});
    render(<PlayFrame {...props({ live: SNAPSHOT, onReload })} />);
    act(() => liveClient().opts.onReleaseMoved());
    expect(toasts.show).toHaveBeenCalledTimes(1);
    const [text, options] = toasts.show.mock.calls[0] as [
      string,
      { id: string; action: ToastAction },
    ];
    expect(text).toBe("A new version of Tactics is available.");
    expect(liveReleaseToast("Tactics")).toBe(text);
    expect(options.action.label).toBe("Reload");
    expect(onReload).not.toHaveBeenCalled();

    const keptOpen = click(options.action);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(keptOpen).toHaveBeenCalled();
    expect(toasts.loading).toHaveBeenCalledWith(
      LIVE_RELEASE_LOADING,
      expect.objectContaining({ id: options.id, action: undefined }),
    );
    expect(LIVE_RELEASE_LOADING).toBe("Loading the new version…");
    await vi.waitFor(() => expect(toasts.dismiss).toHaveBeenCalledWith(options.id));
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("says so when Reload fails, and offers it again", async () => {
    const onReload = vi.fn<() => Promise<unknown>>().mockRejectedValueOnce(new Error("offline"));
    onReload.mockResolvedValueOnce(undefined);
    render(<PlayFrame {...props({ live: SNAPSHOT, onReload })} />);
    act(() => liveClient().opts.onReleaseMoved());
    const [, options] = toasts.show.mock.calls[0] as [string, { id: string; action: ToastAction }];

    click(options.action);
    await vi.waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    const [text, failed] = toasts.error.mock.calls[0] as [
      string,
      { id: string; duration: number; action: ToastAction },
    ];
    expect(text).toBe("The new version of Tactics didn't load.");
    expect(liveReleaseFailedToast("Tactics")).toBe(text);
    expect(failed.id).toBe(options.id);
    expect(failed.duration).toBe(Number.POSITIVE_INFINITY);
    expect(failed.action.label).toBe("Reload");
    expect(toasts.dismiss).not.toHaveBeenCalled();

    click(failed.action);
    expect(onReload).toHaveBeenCalledTimes(2);
    expect(toasts.loading).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(toasts.dismiss).toHaveBeenCalledWith(options.id));
  });

  it("stays quiet when Reload settles after the frame went", async () => {
    let fail!: (error: Error) => void;
    const onReload = vi.fn(() => new Promise<unknown>((_, reject) => (fail = reject)));
    const { unmount } = render(<PlayFrame {...props({ live: SNAPSHOT, onReload })} />);
    act(() => liveClient().opts.onReleaseMoved());
    const [, options] = toasts.show.mock.calls[0] as [string, { action: ToastAction }];
    click(options.action);
    unmount();
    toasts.dismiss.mockReset();
    fail(new Error("offline"));
    await Promise.resolve();
    await Promise.resolve();
    expect(toasts.error).not.toHaveBeenCalled();
    expect(toasts.dismiss).not.toHaveBeenCalled();
  });

  it("takes the new-version toast back when the channel returns to this release", () => {
    render(<PlayFrame {...props({ live: SNAPSHOT })} />);
    act(() => liveClient().opts.onReleaseMoved());
    const [, options] = toasts.show.mock.calls[0] as [string, { id: string }];
    expect(toasts.dismiss).not.toHaveBeenCalled();
    act(() => liveClient().opts.onReleaseRestored?.());
    expect(toasts.dismiss).toHaveBeenCalledWith(options.id);
  });

  it("names the game's current title in the new-version toast", () => {
    const { rerender } = render(<PlayFrame {...props({ live: SNAPSHOT })} />);
    rerender(<PlayFrame {...props({ live: SNAPSHOT, title: "Tactics Deluxe" })} />);
    act(() => liveClient().opts.onReleaseMoved());
    expect(toasts.show.mock.calls[0]?.[0]).toBe("A new version of Tactics Deluxe is available.");
  });

  it("reloads the frame in place with the notice when staff removed a level it runs", () => {
    render(<PlayFrame {...props({ live: SNAPSHOT })} />);
    const iframe = screen.getByTitle("Tactics") as HTMLIFrameElement;
    const setSrc = vi.spyOn(iframe, "src", "set");
    act(() => liveClient().opts.onRemoved());
    expect(toasts.show).toHaveBeenCalledWith("A level in this game was removed by moderators.");
    expect(LIVE_REMOVED_NOTICE).toBe("A level in this game was removed by moderators.");
    expect(setSrc).toHaveBeenCalledWith(FRAME_URL);
    // The same host server welcomes the reloaded frame.
    expect(fakes.created).toHaveLength(1);
    expect(live.clients).toHaveLength(1);
  });

  it("withdraws a waiting new-version toast when the frame goes", () => {
    const { unmount } = render(<PlayFrame {...props({ live: SNAPSHOT })} />);
    act(() => liveClient().opts.onReleaseMoved());
    const [, options] = toasts.show.mock.calls[0] as [string, { id: string }];
    unmount();
    expect(toasts.dismiss).toHaveBeenCalledWith(options.id);
  });
});
