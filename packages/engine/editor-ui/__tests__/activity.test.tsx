// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Activity, SaveState, saveState } from "../frame/Activity";
import type { EditorNotify } from "../host";
import { Button } from "../kit/button";
import { ACTIVITY_DELAY_MS, createPending, type PendingStep } from "../pending/pending";
import { PendingProvider } from "../pending/use-pending";

function fakeNotify(): EditorNotify {
  return Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn(), error: vi.fn() });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const activity = () => screen.getByRole("status");

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Activity", () => {
  it("stays empty for a task shorter than the delay and shows its label from the delay on", () => {
    const pending = createPending({ notify: fakeNotify() });
    render(
      <PendingProvider pending={pending}>
        <Activity />
      </PendingProvider>,
    );
    const work = deferred();
    act(
      () =>
        void pending.run(
          { label: "Importing crate.png", scope: "a", error: "x" },
          () => work.promise,
        ),
    );
    expect(activity().getAttribute("aria-live")).toBe("polite");
    act(() => vi.advanceTimersByTime(ACTIVITY_DELAY_MS - 1));
    expect(activity().textContent).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(activity().textContent).toBe("Importing crate.png");
  });

  it("never shows a task that settles before the delay", async () => {
    const pending = createPending({ notify: fakeNotify() });
    render(
      <PendingProvider pending={pending}>
        <Activity />
      </PendingProvider>,
    );
    const work = deferred();
    act(() => void pending.run({ label: "Renaming", scope: "a", error: "x" }, () => work.promise));
    act(() => vi.advanceTimersByTime(200));
    await act(async () => work.resolve());
    act(() => vi.advanceTimersByTime(500));
    expect(activity().textContent).toBe("");
  });

  it("counts progress with a bar and the other tasks as '+1 more'", () => {
    const pending = createPending({ notify: fakeNotify() });
    render(
      <PendingProvider pending={pending}>
        <Activity />
      </PendingProvider>,
    );
    let step!: PendingStep;
    act(
      () =>
        void pending.run(
          { label: "Checking physics", scope: "panel:problems", error: "x" },
          () => deferred().promise,
        ),
    );
    act(
      () =>
        void pending.run(
          { label: "Importing 5 files", scope: "project:import", total: 5, error: "x" },
          (s) => {
            step = s;
            return deferred().promise;
          },
        ),
    );
    act(() => step.progress(2));
    act(() => vi.advanceTimersByTime(ACTIVITY_DELAY_MS));
    expect(activity().textContent).toContain("Importing 5 files");
    expect(activity().textContent).toContain("2 of 5");
    expect(activity().textContent).toContain("+1 more");
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("5");
  });

  it("shows nothing outside a PendingProvider", () => {
    render(<Activity />);
    expect(activity().textContent).toBe("");
  });
});

describe("SaveState", () => {
  it("says Saving… while edits are unacknowledged and Saved once the server holds them", () => {
    const { rerender } = render(<SaveState connection="live" unsynced={2} />);
    expect(screen.getByText("Saving…")).toBeTruthy();
    rerender(<SaveState connection="live" unsynced={0} />);
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.queryByText("Saving…")).toBeNull();
  });

  it("uses the canvas editor's wording when the connection drops", () => {
    const { rerender } = render(<SaveState connection="reconnecting" unsynced={1} />);
    expect(screen.getByText("Reconnecting…")).toBeTruthy();
    rerender(<SaveState connection="offline" unsynced={3} />);
    expect(screen.getByText("Offline — changes will sync")).toBeTruthy();
    rerender(<SaveState connection="offline" unsynced={0} />);
    expect(screen.getByText("Offline")).toBeTruthy();
    rerender(<SaveState connection="connecting" unsynced={0} />);
    expect(screen.getByText("Connecting…")).toBeTruthy();
    rerender(<SaveState connection="failed" unsynced={0} />);
    expect(screen.getByText("Disconnected")).toBeTruthy();
  });
});

describe("SaveState at a narrow width", () => {
  const compact = () => document.querySelector<HTMLElement>(".je-save-state[data-compact]")!;

  it("draws only the dot while the edits are saved or saving, the words kept for screen readers", () => {
    const { rerender } = render(<SaveState connection="live" unsynced={0} compact />);
    expect(compact().querySelector(".je-status-dot")?.getAttribute("data-tone")).toBe("success");
    expect(compact().querySelector(".je-save-state-short")).toBeNull();
    expect(screen.getByText("Saved").className).toBe("je-sr-only");
    rerender(<SaveState connection="live" unsynced={2} compact />);
    expect(compact().querySelector(".je-save-state-short")).toBeNull();
    expect(screen.getByText("Saving…").className).toBe("je-sr-only");
  });

  it("names a connection that isn't live with a short word beside the dot", () => {
    const { rerender } = render(<SaveState connection="reconnecting" unsynced={1} compact />);
    const short = () => compact().querySelector<HTMLElement>(".je-save-state-short");
    expect(short()?.textContent).toBe("Retrying");
    expect(short()?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Reconnecting…").className).toBe("je-sr-only");
    rerender(<SaveState connection="offline" unsynced={3} compact />);
    expect(short()?.textContent).toBe("Offline");
    expect(screen.getByText("Offline — changes will sync").className).toBe("je-sr-only");
    rerender(<SaveState connection="failed" unsynced={0} compact />);
    expect(short()?.textContent).toBe("Disconnected");
    expect(compact().getAttribute("data-tone")).toBe("danger");
    rerender(<SaveState connection="connecting" unsynced={0} compact />);
    expect(short()?.textContent).toBe("Connecting");
  });

  it("keeps every short word shorter than its full words", () => {
    const states = ["connecting", "reconnecting", "offline", "failed", "live"] as const;
    for (const connection of states) {
      for (const unsynced of [0, 1]) {
        const { label, short } = saveState(connection, unsynced);
        if (short !== null) expect(short.length).toBeLessThanOrEqual(label.length);
        expect(short === null).toBe(connection === "live");
      }
    }
  });
});

describe("Button busyScope", () => {
  it("is busy while a task runs in its scope and ignores presses", async () => {
    const pending = createPending({ notify: fakeNotify() });
    const press = vi.fn();
    render(
      <PendingProvider pending={pending}>
        <Button busyScope="project:rename:crate" onClick={press}>
          Rename
        </Button>
      </PendingProvider>,
    );
    const button = screen.getByRole("button", { name: "Rename" });
    expect(button.getAttribute("aria-busy")).toBeNull();
    const work = deferred();
    act(
      () =>
        void pending.run(
          { label: "Renaming", scope: "project:rename:crate", error: "x" },
          () => work.promise,
        ),
    );
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(press).not.toHaveBeenCalled();
    await act(async () => work.resolve());
    expect(button.getAttribute("aria-busy")).toBeNull();
    fireEvent.click(button);
    expect(press).toHaveBeenCalledTimes(1);
  });
});
