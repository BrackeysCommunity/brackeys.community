import { describe, expect, it, vi } from "vite-plus/test";

import { PAGE_TIMEOUT_MS } from "../browser-compare";
import { settledWithin, UNLOCK_CAP_MS } from "../browser/audio";
import { judgeAudio, judgeMedia } from "../browser/media-compare";
import { PAGE_BUDGET_MS, pageSteps } from "../browser/run";
import { audioPlayed, signsDrawn, tilemapsDrawn } from "./media-probes";

describe("pageSteps", () => {
  it("names the run the page is stuck in, when it began, and the runs done before it", async () => {
    let now = 1_000;
    const steps = pageSteps(() => now);
    expect(steps.stuck()).toBe("after 0.0 s the page was still in between runs");
    await steps.run("the digest", () => {
      now += 400;
      return 1;
    });
    const hung = steps.run("the audio run", () => new Promise<never>(() => {}));
    now += 50_000;
    expect(steps.stuck()).toBe(
      "after 50.4 s the page was still in the audio run, begun at 0.4 s; done: the digest 0.4 s",
    );
    void hung;
  });

  it("returns each run's value and lets its error through", async () => {
    const steps = pageSteps();
    await expect(steps.run("a", async () => "value")).resolves.toBe("value");
    await expect(steps.run("b", () => Promise.reject(new Error("broke")))).rejects.toThrow("broke");
  });

  it("reports inside the runner's wait, with room for the audio run's unlock cap", () => {
    expect(PAGE_BUDGET_MS).toBeLessThan(PAGE_TIMEOUT_MS);
    expect(UNLOCK_CAP_MS).toBeLessThan(PAGE_BUDGET_MS / 2);
  });
});

describe("settledWithin", () => {
  it("resolves at the cap when the work never settles, and sooner when it does", async () => {
    vi.useFakeTimers();
    try {
      let capped = false;
      void settledWithin(new Promise(() => {}), UNLOCK_CAP_MS).then(() => (capped = true));
      await vi.advanceTimersByTimeAsync(UNLOCK_CAP_MS - 1);
      expect(capped).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(capped).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    await expect(settledWithin(Promise.resolve(), 60_000)).resolves.toBeUndefined();
    await expect(settledWithin(Promise.reject(new Error("denied")), 60_000)).rejects.toThrow(
      "denied",
    );
  });
});

describe("the audio run with no output device", () => {
  const stopped = {
    ...audioPlayed,
    context: "suspended",
    backend: "suspended",
    maxChannels: 0,
    endedMs: null,
    held: true,
  };
  const noDevice =
    "after the click the context is suspended and the backend suspended, not running (its destination has no output device to run on)";

  it("fails naming the missing device in Chromium and WebKit, which fake one", () => {
    expect(judgeAudio(stopped)).toBe(noDevice);
    expect(judgeAudio(stopped, "chromium")).toBe(noDevice);
    expect(judgeAudio(stopped, "webkit")).toBe(noDevice);
  });

  it("passes Firefox's stopped context when the unlocked voice waits on its clock", () => {
    expect(judgeAudio(stopped, "firefox")).toBeNull();
    expect(
      judgeMedia({ browser: "firefox", status: "pass" }, {
        ok: true,
        tilemaps: tilemapsDrawn,
        signs: signsDrawn,
        audio: stopped,
      } as Parameters<typeof judgeMedia>[1]),
    ).toMatchObject({ status: "pass", audio: { held: true } });
  });

  it("still fails Firefox when the voice didn't wait, the gesture didn't unlock, or the offline render is wrong", () => {
    expect(judgeAudio({ ...stopped, held: false }, "firefox")).toBe(
      "with no output device the patch's voice didn't wait on the stopped context clock",
    );
    expect(judgeAudio({ ...stopped, backend: "locked" }, "firefox")).toMatch(/backend locked/);
    expect(judgeAudio({ ...stopped, maxChannels: 2 }, "firefox")).toBe(
      "after the click the context is suspended and the backend suspended, not running",
    );
    expect(judgeAudio({ ...stopped, offlineChannels: 1 }, "firefox")).toMatch(
      /offline render has 1 channel/,
    );
    expect(judgeAudio({ ...stopped, leftShare: 0.5 }, "firefox")).toMatch(/50\.0% of the energy/);
  });

  it("passes a running context whose destination reports no device count, as WebKit's does", () => {
    expect(judgeAudio({ ...audioPlayed, maxChannels: 0 }, "webkit")).toBeNull();
  });
});
