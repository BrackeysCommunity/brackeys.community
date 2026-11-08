// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  judgeLaunchFailure,
  judgeRender,
  judgeResult,
  overallOk,
  PAGE_TIMEOUT_MS,
  parseBrowsers,
  SmokeTimeoutError,
  withTimeout,
  type BrowserOutcome,
  type RenderProbe,
} from "../browser-compare";
import type { EngineSmokeResult } from "../browser/main";
import { runSmokeDigest } from "../browser/run";

const drawn: RenderProbe = {
  renderer: "webgl",
  inside: [255, 136, 0, 255],
  outside: [26, 26, 46, 255],
};

const passed = (digest: string, render: RenderProbe = drawn): EngineSmokeResult => ({
  ok: true,
  flavour: "rapier2d-compat",
  ticks: 120,
  digest,
  render,
  userAgent: "test-agent",
});

const MISSING = `browserType.launch: Executable doesn't exist at /ms-playwright/firefox-1555/firefox
Looks like Playwright was just installed or updated.
Please run the following command to download new browsers:
    npx playwright install`;

describe("judgeResult", () => {
  it("passes a digest equal to the in-process one", () => {
    expect(judgeResult("webkit", passed("abc"), "abc")).toEqual({
      browser: "webkit",
      status: "pass",
      digest: "abc",
      userAgent: "test-agent",
      render: drawn,
    });
  });

  it("fails a digest that differs, naming both", () => {
    const out = judgeResult("chromium", passed("abc"), "def");
    expect(out.status).toBe("fail");
    expect(out.digest).toBe("abc");
    expect(out.reason).toContain("abc");
    expect(out.reason).toContain("def");
  });

  it("fails a page that reported an error", () => {
    const out = judgeResult("firefox", { ok: false, error: "wasm init failed" }, "abc");
    expect(out).toMatchObject({ status: "fail", reason: expect.stringContaining("wasm init") });
  });

  it("fails a page that set nothing", () => {
    expect(judgeResult("firefox", undefined, "abc").status).toBe("fail");
  });

  it("fails a run of the wrong length or flavour even when the digest matches", () => {
    const short = { ...passed("abc"), ticks: 60 } as unknown as EngineSmokeResult;
    expect(judgeResult("chromium", short, "abc").status).toBe("fail");
  });

  it("fails a matching digest when the sprite wasn't drawn", () => {
    const blank = { ...drawn, inside: drawn.outside };
    const out = judgeResult("firefox", passed("abc", blank), "abc");
    expect(out).toMatchObject({ status: "fail", reason: expect.stringContaining("blank") });
  });

  it("fails a page that ran no render", () => {
    const { render: _, ...bare } = passed("abc") as Extract<EngineSmokeResult, { ok: true }>;
    const out = judgeResult("chromium", bare as unknown as EngineSmokeResult, "abc");
    expect(out).toMatchObject({ status: "fail", reason: "the page ran no render" });
  });
});

describe("judgeRender", () => {
  it("passes crate-0's colour inside and the background outside, within the tolerance", () => {
    expect(judgeRender(drawn)).toBeNull();
    expect(
      judgeRender({ ...drawn, inside: [250, 140, 4, 255], outside: [30, 22, 50, 255] }),
    ).toBeNull();
  });

  it("fails a translucent sprite pixel", () => {
    expect(judgeRender({ ...drawn, inside: [255, 136, 0, 128] })).toMatch(/isn't opaque/);
  });

  it("fails a sprite pixel of another colour: the fallback box, a body's fill, the wrong frame", () => {
    expect(judgeRender({ ...drawn, inside: [0, 200, 160, 255] })).toMatch(/not crate-0's #ff8800/);
  });

  it("fails an empty pixel that something drew on", () => {
    expect(judgeRender({ ...drawn, outside: [255, 136, 0, 255] })).toMatch(/not the background/);
  });
});

describe("judgeLaunchFailure", () => {
  it("skips a missing browser locally, with the install command", () => {
    const out = judgeLaunchFailure("firefox", MISSING, false);
    expect(out.status).toBe("skipped");
    expect(out.reason).toContain("vp exec playwright install firefox");
  });

  it("fails a missing browser in CI", () => {
    expect(judgeLaunchFailure("firefox", MISSING, true).status).toBe("fail");
  });

  it("fails any other launch error, locally too", () => {
    const out = judgeLaunchFailure("webkit", "browserType.launch: Target crashed\nlog…", false);
    expect(out).toEqual({
      browser: "webkit",
      status: "fail",
      reason: "couldn't launch: browserType.launch: Target crashed",
    });
  });
});

describe("overallOk", () => {
  const o = (status: BrowserOutcome["status"]): BrowserOutcome => ({ browser: "chromium", status });

  it("passes when every browser passed, or passed and skipped", () => {
    expect(overallOk([o("pass"), o("pass")])).toBe(true);
    expect(overallOk([o("pass"), o("skipped")])).toBe(true);
  });

  it("fails on any failure, and when nothing ran", () => {
    expect(overallOk([o("pass"), o("fail")])).toBe(false);
    expect(overallOk([o("skipped"), o("skipped")])).toBe(false);
    expect(overallOk([])).toBe(false);
  });
});

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a page that never answers once the 60 s limit passes", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const raced = withTimeout(never, PAGE_TIMEOUT_MS, "chromium's window.__engineSmoke");
    const caught = raced.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(PAGE_TIMEOUT_MS - 1);
    let settled = false;
    void raced.then(
      () => (settled = true),
      () => (settled = true),
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await caught;
    expect(err).toBeInstanceOf(SmokeTimeoutError);
    expect((err as Error).message).toBe("chromium's window.__engineSmoke timed out after 60 s");
  });

  it("resolves with the answer and clears its timer", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve("ok"), PAGE_TIMEOUT_MS, "x")).resolves.toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes the work's own rejection through", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000, "x")).rejects.toThrow("boom");
  });
});

describe("parseBrowsers", () => {
  it("defaults to all three and dedupes a list", () => {
    expect(parseBrowsers(undefined)).toEqual(["chromium", "firefox", "webkit"]);
    expect(parseBrowsers("webkit, chromium,webkit")).toEqual(["webkit", "chromium"]);
  });

  it("rejects an unknown browser", () => {
    expect(() => parseBrowsers("chromium,edge")).toThrow(/edge/);
  });
});

describe("runSmokeDigest", () => {
  it("runs 120 ticks and gives the same digest every time", async () => {
    const a = await runSmokeDigest();
    const b = await runSmokeDigest();
    expect(a.ticks).toBe(120);
    expect(a.digest).toMatch(/^[0-9a-f]+$/);
    expect(b.digest).toBe(a.digest);
  });
});
