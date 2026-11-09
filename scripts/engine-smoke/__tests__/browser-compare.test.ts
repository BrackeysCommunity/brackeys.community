// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  EDITOR_VIEWPORTS,
  judgeEditor,
  judgeEditorLayout,
  judgeEditorRender,
  judgeLaunchFailure,
  judgeRender,
  judgeResult,
  leavesWindow,
  overallOk,
  PAGE_TIMEOUT_MS,
  parseBrowsers,
  rectsIntersect,
  SmokeTimeoutError,
  withTimeout,
  type BrowserOutcome,
  type EditorLayoutProbe,
  type EditorSmokeResult,
  type IslandBox,
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
  it("skips a missing browser locally, with the install command, for the editor run too", () => {
    const out = judgeLaunchFailure("firefox", MISSING, false);
    expect(out.status).toBe("skipped");
    expect(out.reason).toContain("vp exec playwright install firefox");
    expect(out.editor).toEqual({ browser: "firefox", status: "skipped", reason: out.reason });
  });

  it("fails a missing browser in CI, the editor run with it", () => {
    const out = judgeLaunchFailure("firefox", MISSING, true);
    expect(out.status).toBe("fail");
    expect(out.editor?.status).toBe("fail");
  });

  it("fails any other launch error, locally too", () => {
    const out = judgeLaunchFailure("webkit", "browserType.launch: Target crashed\nlog…", false);
    const reason = "couldn't launch: browserType.launch: Target crashed";
    expect(out).toEqual({
      browser: "webkit",
      status: "fail",
      reason,
      editor: { browser: "webkit", status: "fail", reason },
    });
  });
});

describe("overallOk", () => {
  const o = (
    status: BrowserOutcome["status"],
    editor: BrowserOutcome["status"] | null = status,
  ): BrowserOutcome => ({
    browser: "chromium",
    status,
    ...(editor ? { editor: { browser: "chromium", status: editor } } : {}),
  });

  it("passes when every browser passed, or passed and skipped", () => {
    expect(overallOk([o("pass"), o("pass")])).toBe(true);
    expect(overallOk([o("pass"), o("skipped")])).toBe(true);
  });

  it("fails on any failure, and when nothing ran", () => {
    expect(overallOk([o("pass"), o("fail")])).toBe(false);
    expect(overallOk([o("skipped"), o("skipped")])).toBe(false);
    expect(overallOk([])).toBe(false);
  });

  it("fails when a browser's editor run failed, or never ran, though its engine page passed", () => {
    expect(overallOk([o("pass", "fail")])).toBe(false);
    expect(overallOk([o("pass"), o("pass", "fail")])).toBe(false);
    expect(overallOk([o("pass", null)])).toBe(false);
    expect(overallOk([o("pass", "skipped")])).toBe(false);
  });
});

const box = (name: string, x: number, y: number, width: number, height: number): IslandBox => ({
  name,
  rect: { x, y, width, height },
});

/** The default layout's islands at a window size: two columns, the dock between them. */
function layoutAt(
  width: number,
  height: number,
  inspector: number | null = 520,
): EditorLayoutProbe {
  return {
    width,
    height,
    inspector,
    ...(width === 1440 && height === 900 ? { held: { play: inspector, run: inspector } } : {}),
    islands: [
      box(".je-panel-group.je-frame-group-left-0", 8, 8, 280, height / 2 - 12),
      box(".je-panel-group.je-frame-group-left-1", 8, height / 2 + 4, 280, height / 2 - 12),
      box(".je-panel-group.je-frame-group-right-0", width - 328, 8, 320, height - 260),
      box(".je-panel-group.je-frame-group-right-1", width - 328, height - 244, 320, 236),
      box('"Play controls"', width / 2 - 50, height - 48, 100, 40),
    ],
  };
}

const editorPassed = (over: Partial<Extract<EditorSmokeResult, { ok: true }>> = {}) =>
  ({
    ok: true,
    layouts: EDITOR_VIEWPORTS.map((v) => layoutAt(v.width, v.height)),
    tab: { tab: "Run", selected: true, shown: true, siblingsHidden: true },
    render: { renderer: "webgl", inside: [255, 136, 0, 255], outside: [0, 0, 0, 0] },
    userAgent: "test-agent",
    ...over,
  }) satisfies EditorSmokeResult;

describe("rectsIntersect and leavesWindow", () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };

  it("counts shared area, not shared edges or a sub-pixel graze", () => {
    expect(rectsIntersect(a, { x: 50, y: 50, width: 100, height: 100 })).toBe(true);
    expect(rectsIntersect(a, { x: 100, y: 0, width: 50, height: 100 })).toBe(false);
    expect(rectsIntersect(a, { x: 99.7, y: 0, width: 50, height: 100 })).toBe(false);
    expect(rectsIntersect(a, { x: 0, y: 120, width: 100, height: 10 })).toBe(false);
  });

  it("flags a rectangle past any edge of the window", () => {
    expect(leavesWindow(a, 100, 100)).toBe(false);
    expect(leavesWindow({ ...a, x: -2 }, 100, 100)).toBe(true);
    expect(leavesWindow(a, 99, 100)).toBe(true);
    expect(leavesWindow(a, 100, 98)).toBe(true);
  });
});

describe("judgeEditorLayout", () => {
  it("passes islands that keep apart inside the window", () => {
    for (const v of EDITOR_VIEWPORTS)
      expect(judgeEditorLayout(layoutAt(v.width, v.height))).toBeNull();
  });

  it("fails two islands that overlap, naming both and the window", () => {
    const layout = layoutAt(1024, 700);
    layout.islands.push(box('"Play controls"', 700, 300, 200, 40));
    const why = judgeEditorLayout(layout);
    expect(why).toMatch(/je-frame-group-right-0.*overlaps.*Play controls.*1024×700/);
  });

  it("fails an island that leaves the window", () => {
    const layout = layoutAt(760, 700);
    layout.islands.push(box(".je-frame-rail", 740, 8, 40, 300));
    expect(judgeEditorLayout(layout)).toMatch(/je-frame-rail leaves the window at 760×700/);
  });

  it("fails a window with no island drawn", () => {
    expect(judgeEditorLayout({ ...layoutAt(1440, 900), islands: [] })).toMatch(/no island/);
  });
});

describe("judgeEditorRender", () => {
  const render: RenderProbe = {
    renderer: "webgpu",
    inside: [255, 136, 0, 255],
    outside: [0, 0, 0, 0],
  };

  it("passes crate-0's colour on the sprite over any background beside it", () => {
    expect(judgeEditorRender(render)).toBeNull();
    expect(judgeEditorRender({ ...render, outside: [11, 11, 16, 255] })).toBeNull();
  });

  it("fails a sprite pixel that's blank, translucent or another colour", () => {
    expect(judgeEditorRender({ ...render, inside: [0, 0, 0, 0] })).toMatch(/isn't opaque/);
    expect(judgeEditorRender({ ...render, inside: [0, 200, 160, 255] })).toMatch(/not crate-0's/);
  });

  it("fails crate-0's colour in the empty air too", () => {
    expect(judgeEditorRender({ ...render, outside: [255, 136, 0, 255] })).toMatch(/empty pixel/);
  });

  it("fails a page that read nothing", () => {
    expect(judgeEditorRender(undefined)).toBe("the editor ran no render");
  });
});

describe("judgeEditor", () => {
  it("passes a mounted editor whose every check held", () => {
    const result = editorPassed();
    expect(judgeEditor("webkit", result)).toEqual({
      browser: "webkit",
      status: "pass",
      layouts: result.layouts,
      render: result.render,
    });
  });

  it("fails a page that couldn't mount the editor, or answered nothing", () => {
    expect(judgeEditor("firefox", { ok: false, error: "socket closed" })).toMatchObject({
      status: "fail",
      reason: expect.stringContaining("socket closed"),
    });
    expect(judgeEditor("firefox", undefined).status).toBe("fail");
  });

  it("fails a window the editor wasn't measured at", () => {
    const out = judgeEditor("chromium", editorPassed({ layouts: [layoutAt(1440, 900)] }));
    expect(out).toMatchObject({ status: "fail", reason: expect.stringContaining("1024×700") });
  });

  it("fails overlapping islands in any of the windows", () => {
    const layouts = EDITOR_VIEWPORTS.map((v) => layoutAt(v.width, v.height));
    layouts[2]!.islands.push(box(".je-frame-context", 0, 0, 300, 40));
    const out = judgeEditor("chromium", editorPassed({ layouts }));
    expect(out).toMatchObject({
      status: "fail",
      reason: expect.stringMatching(/overlaps.*760×700/),
    });
  });

  it("fails an inspector group under 500 px at 1440×900, and one not drawn", () => {
    const short = EDITOR_VIEWPORTS.map((v) =>
      layoutAt(v.width, v.height, v.width === 1440 ? 165 : 520),
    );
    expect(judgeEditor("chromium", editorPassed({ layouts: short }))).toMatchObject({
      status: "fail",
      reason: "the inspector group is 165 px tall at 1440×900, under 500",
    });
    const none = EDITOR_VIEWPORTS.map((v) => layoutAt(v.width, v.height, null));
    expect(judgeEditor("chromium", editorPassed({ layouts: none })).reason).toMatch(
      /no inspector group/,
    );
  });

  it("fails an inspector group that changes height after a Play and Stop or a 50-marker run", () => {
    const at = (held: { play: number | null; run: number | null } | undefined) =>
      EDITOR_VIEWPORTS.map((v) => {
        const layout = layoutAt(v.width, v.height);
        return v.width === 1440 ? { ...layout, held } : layout;
      });
    expect(
      judgeEditor("chromium", editorPassed({ layouts: at({ play: 520, run: 520 }) })).status,
    ).toBe("pass");
    expect(
      judgeEditor("chromium", editorPassed({ layouts: at({ play: 360, run: 520 }) })).reason,
    ).toBe("the inspector group is 360 px tall after a Play and Stop, not 520, at 1440×900");
    expect(
      judgeEditor("chromium", editorPassed({ layouts: at({ play: 520, run: 300 }) })).reason,
    ).toBe(
      "the inspector group is 300 px tall after loading a 50-marker run, not 520, at 1440×900",
    );
    expect(
      judgeEditor("chromium", editorPassed({ layouts: at({ play: null, run: 520 }) })).reason,
    ).toMatch(/no inspector group is drawn after a Play and Stop/);
    expect(judgeEditor("chromium", editorPassed({ layouts: at(undefined) })).reason).toMatch(
      /wasn't measured after a Play/,
    );
  });

  it("judges the inspector only at 1440×900", () => {
    const layouts = EDITOR_VIEWPORTS.map((v) =>
      layoutAt(v.width, v.height, v.width === 1440 ? 500 : 120),
    );
    expect(judgeEditor("chromium", editorPassed({ layouts })).status).toBe("pass");
  });

  it("fails a tab switch that didn't select the tab or show its panel alone", () => {
    const tab = { tab: "Run", selected: true, shown: true, siblingsHidden: true };
    for (const [broken, why] of [
      [{ ...tab, selected: false }, /isn't selected/],
      [{ ...tab, shown: false }, /panel isn't shown/],
      [{ ...tab, siblingsHidden: false }, /another panel/],
    ] as const)
      expect(judgeEditor("chromium", editorPassed({ tab: broken })).reason).toMatch(why);
  });

  it("fails when the crate's sprite isn't drawn under the editor", () => {
    const render: RenderProbe = { renderer: "webgl", inside: [0, 0, 0, 0], outside: [0, 0, 0, 0] };
    expect(judgeEditor("chromium", editorPassed({ render }))).toMatchObject({
      status: "fail",
      reason: expect.stringContaining("under the editor"),
      render,
    });
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
