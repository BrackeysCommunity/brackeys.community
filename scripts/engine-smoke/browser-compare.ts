/**
 * The browser smoke's verdicts, kept free of Playwright and Vite so the
 * runner's rules (a digest must equal Node's, the sprite's pixel must be
 * drawn and the empty one blank, the editor's islands must keep apart and
 * inside the window, a page must answer in time, a missing browser is never
 * a pass) are unit-tested without a browser.
 */
import type { EngineSmokeResult } from "./browser/main";
import { INSIDE_COLOUR, SMOKE_BACKGROUND } from "./browser/sink";

export const BROWSERS = ["chromium", "firefox", "webkit"] as const;
export type BrowserName = (typeof BROWSERS)[number];

export const PAGE_TIMEOUT_MS = 60_000;

/** One pixel as the renderer's extract reads it, 0–255 per channel. */
export type Rgba = readonly [r: number, g: number, b: number, a: number];

/** The page's render run: which renderer drew, and the two pixels it read. */
export type RenderProbe = { renderer: string; inside: Rgba; outside: Rgba };

/** How far a channel may stray from the colour expected of it. */
export const PIXEL_TOLERANCE = 8;

const rgbOf = (hex: number): [number, number, number] => [
  (hex >> 16) & 0xff,
  (hex >> 8) & 0xff,
  hex & 0xff,
];

const near = (px: Rgba, hex: number) =>
  rgbOf(hex).every((c, i) => Math.abs((px[i] ?? -1) - c) <= PIXEL_TOLERANCE);

const show = (px: Rgba) => `rgba(${px.join(", ")})`;
const hexOf = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/**
 * Why the render run failed, or null when it passed: the pixel inside the
 * sprite must be opaque, the sprite frame's colour and not the background;
 * the one outside every sprite must be the background.
 */
export function judgeRender(render: RenderProbe | undefined): string | null {
  if (!render) return "the page ran no render";
  const { inside, outside } = render;
  if (inside[3] < 255 - PIXEL_TOLERANCE)
    return `the sprite's pixel isn't opaque: ${show(inside)} on ${render.renderer}`;
  if (near(inside, SMOKE_BACKGROUND))
    return `the sprite's pixel is blank (the background, ${show(inside)}) on ${render.renderer}`;
  if (!near(inside, INSIDE_COLOUR))
    return `the sprite's pixel is ${show(inside)}, not crate-0's ${hexOf(INSIDE_COLOUR)}, on ${render.renderer}`;
  if (!near(outside, SMOKE_BACKGROUND))
    return `the empty pixel is ${show(outside)}, not the background ${hexOf(SMOKE_BACKGROUND)}, on ${render.renderer}`;
  return null;
}

export type BrowserOutcome = {
  browser: BrowserName;
  status: "pass" | "fail" | "skipped";
  digest?: string;
  userAgent?: string;
  render?: RenderProbe;
  reason?: string;
  ms?: number;
  /** The editor page's run in the same browser. */
  editor?: EditorOutcome;
};

export class SmokeTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms / 1000} s`);
    this.name = "SmokeTimeoutError";
  }
}

/** Rejects with a `SmokeTimeoutError` when `work` hasn't settled within `ms`. */
export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SmokeTimeoutError(label, ms)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export function parseBrowsers(arg: string | undefined): BrowserName[] {
  if (!arg) return [...BROWSERS];
  const names = arg
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = names.filter((n) => !(BROWSERS as readonly string[]).includes(n));
  if (unknown.length || names.length === 0) {
    throw new Error(`--browsers takes a list of ${BROWSERS.join(", ")}; got ${arg}`);
  }
  return [...new Set(names)] as BrowserName[];
}

/** The page's answer against the digest the same run gave in-process. */
export function judgeResult(
  browser: BrowserName,
  result: EngineSmokeResult | undefined,
  expected: string,
): BrowserOutcome {
  if (!result) return { browser, status: "fail", reason: "the page set no window.__engineSmoke" };
  if (!result.ok) return { browser, status: "fail", reason: `the page failed: ${result.error}` };
  const seen = {
    browser,
    digest: result.digest,
    userAgent: result.userAgent,
    ...(result.render ? { render: result.render } : {}),
  };
  if (result.flavour !== "rapier2d-compat" || result.ticks !== 120) {
    return {
      ...seen,
      status: "fail",
      reason: `the page ran ${result.ticks} ticks on ${result.flavour}, not 120 on rapier2d-compat`,
    };
  }
  if (result.digest !== expected) {
    return {
      ...seen,
      status: "fail",
      reason: `digest ${result.digest} differs from the in-process run's ${expected}`,
    };
  }
  const drawn = judgeRender(result.render);
  if (drawn) return { ...seen, status: "fail", reason: drawn };
  return { ...seen, status: "pass" };
}

/** Playwright's launch error when the browser build it pins isn't installed. */
export function isMissingBrowser(message: string): boolean {
  return /Executable doesn't exist|playwright install/i.test(message);
}

export function installCommand(browser: BrowserName): string {
  return `vp exec playwright install ${browser}`;
}

/** A browser that couldn't launch: skipped locally when it isn't installed, a failure in CI or for any other reason. */
export function judgeLaunchFailure(
  browser: BrowserName,
  message: string,
  ci: boolean,
): BrowserOutcome {
  const missing = isMissingBrowser(message);
  const reason = missing
    ? `not installed; run \`${installCommand(browser)}\``
    : `couldn't launch: ${firstLine(message)}`;
  const status = missing && !ci ? "skipped" : "fail";
  return { browser, status, reason, editor: { browser, status, reason } };
}

/**
 * The run passes when nothing failed and at least one browser actually ran;
 * every browser that ran the engine page ran the editor page too.
 */
export function overallOk(outcomes: readonly BrowserOutcome[]): boolean {
  const failed = outcomes.some((o) => o.status === "fail" || o.editor?.status === "fail");
  const editorless = outcomes.some((o) => o.status === "pass" && o.editor?.status !== "pass");
  return !failed && !editorless && outcomes.some((o) => o.status === "pass");
}

function firstLine(message: string): string {
  return message.split("\n").find((l) => l.trim()) ?? message;
}

// ─── The editor run ──────────────────────────────────────

/** The windows the editor is measured at, in order; the first is also where its tab and pixel checks run. */
export const EDITOR_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
  { width: 760, height: 700 },
] as const;

/** The inspector group's least height at 1440×900. */
export const INSPECTOR_MIN_PX = 500;

/** The markers in the run the editor run loads, to see the inspector keep its height beside it. */
export const HELD_RUN_MARKERS = 50;

/** The tab the editor run switches to: the right column's bottom group opens on Problems. */
export const EDITOR_TAB = "Run";

/** How far, in CSS px, rectangles may touch or graze the window's edge before they count as overlapping or outside. */
export const RECT_TOLERANCE = 0.5;

export type Rect = { x: number; y: number; width: number; height: number };

/** One island of the editor's chrome as the page measured it. */
export type IslandBox = { name: string; rect: Rect };

/** The inspector group's height after a Play and Stop, and after loading a long run (null when it isn't drawn). */
export type EditorHeldProbe = { play: number | null; run: number | null };

/** The editor's chrome in one window: its islands and the inspector group's height (null when it isn't drawn). */
export type EditorLayoutProbe = {
  width: number;
  height: number;
  islands: IslandBox[];
  inspector: number | null;
  /** In the first window only. */
  held?: EditorHeldProbe;
};

/** The tab switch: whether the tab is selected and its panel shown with content, every sibling panel hidden. */
export type EditorTabProbe = {
  tab: string;
  selected: boolean;
  shown: boolean;
  siblingsHidden: boolean;
};

export type EditorSmokeResult =
  | {
      ok: true;
      layouts: EditorLayoutProbe[];
      tab: EditorTabProbe;
      /** The kitchen sink's crate as the editor's own renderer draws it. */
      render: RenderProbe;
      userAgent: string;
    }
  | { ok: false; error: string };

export type EditorOutcome = {
  browser: BrowserName;
  status: "pass" | "fail" | "skipped";
  layouts?: EditorLayoutProbe[];
  render?: RenderProbe;
  reason?: string;
  ms?: number;
};

const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;
const size = (v: { width: number; height: number }) => `${v.width}×${v.height}`;

/** Whether two rectangles share more than a hairline of area. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  const w = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
  const h = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  return w > RECT_TOLERANCE && h > RECT_TOLERANCE;
}

/** Whether a rectangle reaches past any edge of a window of this size. */
export function leavesWindow(r: Rect, width: number, height: number): boolean {
  return (
    r.x < -RECT_TOLERANCE ||
    r.y < -RECT_TOLERANCE ||
    right(r) > width + RECT_TOLERANCE ||
    bottom(r) > height + RECT_TOLERANCE
  );
}

/** Why one window's chrome fails, or null: islands drawn, none overlapping another or leaving the window. */
export function judgeEditorLayout(layout: EditorLayoutProbe): string | null {
  const at = size(layout);
  if (layout.islands.length === 0) return `no island is drawn at ${at}`;
  for (const island of layout.islands)
    if (leavesWindow(island.rect, layout.width, layout.height))
      return `${island.name} leaves the window at ${at}: ${showRect(island.rect)}`;
  for (let i = 0; i < layout.islands.length; i++)
    for (let j = i + 1; j < layout.islands.length; j++) {
      const a = layout.islands[i]!;
      const b = layout.islands[j]!;
      if (rectsIntersect(a.rect, b.rect))
        return `${a.name} ${showRect(a.rect)} overlaps ${b.name} ${showRect(b.rect)} at ${at}`;
    }
  return null;
}

/**
 * Why the editor's render fails, or null: the crate's sprite pixel opaque and
 * crate-0's colour, and the empty pixel beside it not that colour. The
 * editor's background is the game's, not the smoke's, so only the sprite's
 * own colour is judged there.
 */
export function judgeEditorRender(render: RenderProbe | undefined): string | null {
  if (!render) return "the editor ran no render";
  const { inside, outside } = render;
  if (inside[3] < 255 - PIXEL_TOLERANCE)
    return `the sprite's pixel isn't opaque under the editor: ${show(inside)} on ${render.renderer}`;
  if (!near(inside, INSIDE_COLOUR))
    return `the sprite's pixel is ${show(inside)} under the editor, not crate-0's ${hexOf(INSIDE_COLOUR)}, on ${render.renderer}`;
  if (near(outside, INSIDE_COLOUR))
    return `the empty pixel is crate-0's colour too under the editor (${show(outside)}) on ${render.renderer}`;
  return null;
}

/**
 * The editor page's answers: mounted, every window's chrome sound, the
 * inspector tall enough and the same height after a Play and Stop and a long
 * run, the tab switch shown, the crate drawn.
 */
export function judgeEditor(
  browser: BrowserName,
  result: EditorSmokeResult | undefined,
): EditorOutcome {
  if (!result) return { browser, status: "fail", reason: "the editor page answered nothing" };
  if (!result.ok) return { browser, status: "fail", reason: `the editor failed: ${result.error}` };
  const seen = { browser, layouts: result.layouts, render: result.render };
  const fail = (reason: string): EditorOutcome => ({ ...seen, status: "fail", reason });
  for (const viewport of EDITOR_VIEWPORTS) {
    const layout = result.layouts.find(
      (l) => l.width === viewport.width && l.height === viewport.height,
    );
    if (!layout) return fail(`the editor wasn't measured at ${size(viewport)}`);
    const wrong = judgeEditorLayout(layout);
    if (wrong) return fail(wrong);
  }
  const [first] = EDITOR_VIEWPORTS;
  const wide = result.layouts.find((l) => l.width === first.width && l.height === first.height);
  if (wide?.inspector == null) return fail(`no inspector group is drawn at ${size(first)}`);
  if (wide.inspector < INSPECTOR_MIN_PX)
    return fail(
      `the inspector group is ${Math.round(wide.inspector)} px tall at ${size(first)}, under ${INSPECTOR_MIN_PX}`,
    );
  if (!wide.held)
    return fail(`the inspector wasn't measured after a Play and a long run at ${size(first)}`);
  const after = [
    ["a Play and Stop", wide.held.play],
    [`loading a ${HELD_RUN_MARKERS}-marker run`, wide.held.run],
  ] as const;
  for (const [what, height] of after) {
    if (height === null) return fail(`no inspector group is drawn after ${what} at ${size(first)}`);
    if (Math.abs(height - wide.inspector) > RECT_TOLERANCE)
      return fail(
        `the inspector group is ${Math.round(height)} px tall after ${what}, not ${Math.round(wide.inspector)}, at ${size(first)}`,
      );
  }
  const { tab } = result;
  if (!tab.selected) return fail(`the ${tab.tab} tab isn't selected after a click on it`);
  if (!tab.shown) return fail(`the ${tab.tab} tab is selected but its panel isn't shown`);
  if (!tab.siblingsHidden) return fail(`another panel still shows beside the ${tab.tab} tab's`);
  const drawn = judgeEditorRender(result.render);
  if (drawn) return fail(drawn);
  return { ...seen, status: "pass" };
}

function showRect(r: Rect): string {
  const n = (v: number) => Math.round(v * 10) / 10;
  return `(${n(r.x)}, ${n(r.y)}, ${n(r.width)}×${n(r.height)})`;
}
