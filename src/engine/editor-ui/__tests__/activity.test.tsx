// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Activity, SaveState } from "../frame/Activity";
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
