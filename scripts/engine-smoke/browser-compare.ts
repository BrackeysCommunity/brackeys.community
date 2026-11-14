/**
 * The browser smoke's verdicts, kept free of Playwright and Vite so the
 * runner's rules (a digest must equal Bun's, the physics-free run must
 * never load Rapier, the tactics replay must give its golden pin with no
 * Rapier, the contact read must start on its pinned tick, the
 * sprite's pixel must be drawn and the empty one blank, each half of the split
 * screen must draw its sprite and the animated one change a clip frame later,
 * the editor's islands must keep apart and
 * inside the window, a page must answer in time, a missing browser is never
 * a pass) are unit-tested without a browser.
 */
import { TACTICS_GOLDEN_DIGEST } from "../../src/games/tactics/__tests__/pins";
import { judgeContact, type ContactRead } from "./browser/contact";
import type { EngineSmokeResult } from "./browser/main";
import {
  ANIM_COLOURS,
  ANIM_FRAME_TICKS,
  INSIDE_COLOUR,
  SMOKE_BACKGROUND,
  SPLIT_VIEWPORTS,
} from "./browser/sink";
import type { TacticsProbe } from "./browser/tactics";

export const BROWSERS = ["chromium", "firefox", "webkit"] as const;
export type BrowserName = (typeof BROWSERS)[number];

export const PAGE_TIMEOUT_MS = 60_000;

/** One pixel as the renderer's extract reads it, 0–255 per channel. */
export type Rgba = readonly [r: number, g: number, b: number, a: number];

/** The page's render run: which renderer drew, and the two pixels it read. */
export type RenderProbe = { renderer: string; inside: Rgba; outside: Rgba };

/** One pixel the split run read where a viewport draws a world point: canvas CSS px, and its colour. */
export type ViewportPixel = { viewport: number; at: readonly [x: number, y: number]; pixel: Rgba };

/**
 * The split run: the canvas's size, the crate's pixel through the left
 * viewport, and the animated sprite's through the right one before and after
 * `ticks` more ticks.
 */
export type SplitProbe = {
  renderer: string;
  width: number;
  height: number;
  crate: ViewportPixel;
  anim: readonly [before: ViewportPixel, after: ViewportPixel];
  ticks: number;
};

/** What the physics-free run gives, beside where it ran. */
export type PhysicsFreeRun = {
  /** The scene's physics as it resolved before anything loaded. */
  physics: "rapier" | "none";
  ticks: number;
  result: string;
  /** The replay of the run's recording ended as the run did. */
  replayMatches: boolean;
  digest: string;
};

/** The physics-free run as one runtime saw it: how often its Rapier loader was called, and the shell's ticks (null without a page). */
export type PhysicsFreeProbe = PhysicsFreeRun & { rapierLoads: number; shellTicks: number | null };

/** Ticks the page's shell steps the physics-free scene. */
export const SHELL_TICKS = 30;

/** How the physics-free run must end. */
export const PHYSICS_FREE_RESULT = "won";

/**
 * Why a physics-free run fails, or null: it resolved to no physics, never
 * called its Rapier loader, reached its result, replayed to the same end,
 * stepped the shell when it had one, and gave the `expected` digest.
 */
export function judgePhysicsFree(
  probe: PhysicsFreeProbe | undefined,
  expected: string,
  shell: boolean,
): string | null {
  if (!probe) return "the page ran no physics-free run";
  if (probe.physics !== "none")
    return `the physics-free scene resolved to ${probe.physics}, not none`;
  if (probe.rapierLoads !== 0)
    return `the physics-free run loaded Rapier ${probe.rapierLoads} time(s)`;
  if (probe.result !== PHYSICS_FREE_RESULT)
    return `the physics-free run ended ${probe.result} at tick ${probe.ticks}, not ${PHYSICS_FREE_RESULT}`;
  if (!probe.replayMatches) return "the physics-free run's replay didn't match it";
  if (shell && probe.shellTicks !== SHELL_TICKS)
    return `the shell stepped the physics-free scene ${probe.shellTicks ?? "no"} ticks, not ${SHELL_TICKS}`;
  if (probe.digest !== expected)
    return `physics-free digest ${probe.digest} differs from the in-process run's ${expected}`;
  return null;
}

/** How the tactics replay must end. */
export const TACTICS_RESULT = "won";

/**
 * Why a tactics replay fails, or null: it resolved to no physics, never
 * called its Rapier loader, won, ended as its recording did, and gave the
 * golden pin, the one digest every platform must reproduce.
 */
export function judgeTactics(
  probe: TacticsProbe | undefined,
  pin: string = TACTICS_GOLDEN_DIGEST,
): string | null {
  if (!probe) return "the page ran no tactics replay";
  if (probe.physics !== "none") return `the tactics scene resolved to ${probe.physics}, not none`;
  if (probe.rapierLoads !== 0)
    return `the tactics replay loaded Rapier ${probe.rapierLoads} time(s)`;
  if (probe.result !== TACTICS_RESULT)
    return `the tactics replay ended ${probe.result} at tick ${probe.tick}, not ${TACTICS_RESULT}`;
  if (!probe.replayMatches) return "the tactics replay didn't end as its recording did";
  if (probe.digest !== pin) return `tactics digest ${probe.digest} differs from the pin ${pin}`;
  return null;
}

/** The digests every browser must reproduce, from the runner's own runs. */
export type SmokeExpected = { digest: string; physicsFree: string };

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

/** Why a read isn't inside its viewport's rectangle of a `width` × `height` canvas, or null. */
function outsideViewport(read: ViewportPixel, width: number, height: number): string | null {
  const def = SPLIT_VIEWPORTS[read.viewport];
  if (!def) return `viewport ${read.viewport} isn't one of the split run's`;
  const [rx, ry, rw, rh] = def.rect;
  const [x, y] = read.at;
  const inside =
    x >= rx * width && x < (rx + rw) * width && y >= ry * height && y < (ry + rh) * height;
  const n = (v: number) => Math.round(v * 10) / 10;
  return inside
    ? null
    : `viewport ${read.viewport} drew its point at (${n(x)}, ${n(y)}), outside its rectangle [${def.rect.join(", ")}] of ${width}×${height}`;
}

/** Why `read` isn't an opaque pixel of `colour`, or null. */
function notColour(
  read: ViewportPixel,
  colour: number,
  what: string,
  renderer: string,
): string | null {
  if (read.pixel[3] < 255 - PIXEL_TOLERANCE)
    return `${what} isn't opaque: ${show(read.pixel)} on ${renderer}`;
  if (near(read.pixel, SMOKE_BACKGROUND))
    return `${what} is blank (the background, ${show(read.pixel)}) on ${renderer}`;
  if (!near(read.pixel, colour))
    return `${what} is ${show(read.pixel)}, not ${hexOf(colour)}, on ${renderer}`;
  return null;
}

/**
 * Why the split screen failed, or null: each viewport drew its point inside
 * its own half, the left half the crate's colour, the right the animated
 * sprite's first frame and then, a clip frame's ticks later, its second.
 */
export function judgeSplit(split: SplitProbe | undefined): string | null {
  if (!split) return "the page ran no split screen";
  const { renderer, width, height, crate } = split;
  const [before, after] = split.anim;
  for (const read of [crate, before, after]) {
    const wrong = outsideViewport(read, width, height);
    if (wrong) return wrong;
  }
  if (crate.viewport === before.viewport)
    return `the crate and the animated sprite were both read through viewport ${crate.viewport}`;
  const left = notColour(crate, INSIDE_COLOUR, "the left half's crate pixel", renderer);
  if (left) return left;
  if (split.ticks !== ANIM_FRAME_TICKS)
    return `the animated sprite was read ${split.ticks} ticks apart, not a clip frame's ${ANIM_FRAME_TICKS}`;
  if (before.pixel.every((c, i) => Math.abs(c - (after.pixel[i] ?? -1)) <= PIXEL_TOLERANCE))
    return `the animated sprite didn't change in ${split.ticks} ticks: ${show(before.pixel)} both times on ${renderer}`;
  return (
    notColour(before, ANIM_COLOURS[0], "the animated sprite's first frame", renderer) ??
    notColour(after, ANIM_COLOURS[1], "the animated sprite's next frame", renderer)
  );
}

export type BrowserOutcome = {
  browser: BrowserName;
  status: "pass" | "fail" | "skipped";
  digest?: string;
  userAgent?: string;
  render?: RenderProbe;
  split?: SplitProbe;
  physicsFree?: PhysicsFreeProbe;
  contact?: ContactRead;
  tactics?: TacticsProbe;
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

/** The page's answer against the digests the same runs gave in-process. */
export function judgeResult(
  browser: BrowserName,
  result: EngineSmokeResult | undefined,
  expected: SmokeExpected,
): BrowserOutcome {
  if (!result) return { browser, status: "fail", reason: "the page set no window.__engineSmoke" };
  if (!result.ok) return { browser, status: "fail", reason: `the page failed: ${result.error}` };
  const seen = {
    browser,
    digest: result.digest,
    userAgent: result.userAgent,
    ...(result.render ? { render: result.render } : {}),
    ...(result.split ? { split: result.split } : {}),
    ...(result.physicsFree ? { physicsFree: result.physicsFree } : {}),
    ...(result.contact !== undefined ? { contact: result.contact } : {}),
    ...(result.tactics ? { tactics: result.tactics } : {}),
  };
  if (result.flavour !== "rapier2d-compat" || result.ticks !== 120) {
    return {
      ...seen,
      status: "fail",
      reason: `the page ran ${result.ticks} ticks on ${result.flavour}, not 120 on rapier2d-compat`,
    };
  }
  if (result.digest !== expected.digest) {
    return {
      ...seen,
      status: "fail",
      reason: `digest ${result.digest} differs from the in-process run's ${expected.digest}`,
    };
  }
  const drawn = judgeRender(result.render);
  if (drawn) return { ...seen, status: "fail", reason: drawn };
  const split = judgeSplit(result.split);
  if (split) return { ...seen, status: "fail", reason: split };
  const free = judgePhysicsFree(result.physicsFree, expected.physicsFree, true);
  if (free) return { ...seen, status: "fail", reason: free };
  const touched = judgeContact(result.contact);
  if (touched) return { ...seen, status: "fail", reason: touched };
  const second = judgeTactics(result.tactics);
  if (second) return { ...seen, status: "fail", reason: second };
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
