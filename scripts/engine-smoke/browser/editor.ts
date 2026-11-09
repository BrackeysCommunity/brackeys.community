/**
 * The browser smoke's editor page: `dist`'s `@jams/engine/editor-ui` mounted
 * on the kitchen sink of a scratch copy of the engine project, served by
 * `listenSceneCollab` behind the preview server's proxy for
 * `/__scene-collab` and `/__project`. The runner drives the window and the
 * clicks; this page measures what they leave on screen, plays and stops the
 * scene and loads a long run to see the inspector keep its height, and reads
 * the crate's sprite back from the editor's own renderer.
 */
import "@fontsource-variable/rubik";
import "@jams/engine/editor-ui/style.css";
import * as hocuspocus from "@hocuspocus/provider";
import { devProjectHost, mountSceneEditor } from "@jams/engine/editor-ui";
import { RECORDING_VERSION } from "@jams/engine/scene";
import { Rectangle, type Application } from "pixi.js";

import {
  EDITOR_VIEWPORTS,
  HELD_RUN_MARKERS,
  judgeEditorRender,
  type EditorHeldProbe,
  type EditorLayoutProbe,
  type EditorTabProbe,
  type IslandBox,
  type RenderProbe,
  type Rgba,
} from "../browser-compare";
import { smokeGame } from "../game";
import { loadRapier } from "./run";
import { INSIDE_POINT, OUTSIDE_POINT, SINK_PROJECT, SINK_SCENE } from "./sink";

export type EngineEditorPage = {
  /** Set when the editor couldn't mount. */
  error: string | null;
  /**
   * The chrome in the current window, once two frames have settled it. In the
   * first window it also plays and stops the scene and loads a long run, and
   * measures the inspector group after each.
   */
  measure(): Promise<EditorLayoutProbe>;
  /** Whether the tab with this label is selected and its panel alone shown in its group. */
  tabShown(label: string): EditorTabProbe;
  /** Reads the crate's sprite back from the editor's renderer, waiting up to `ms` for its texture. */
  readSprite(ms: number): Promise<RenderProbe>;
};

declare global {
  interface Window {
    __engineEditor?: EngineEditorPage;
  }
}

type PixiHooks = { __PIXI_APP_INIT__?: (app: Application, version: string) => void };

/** Every Pixi application made from here on; the editor's game doesn't expose its own. */
const apps: Application[] = [];
const hooks = globalThis as PixiHooks;
const previous = hooks.__PIXI_APP_INIT__;
hooks.__PIXI_APP_INIT__ = (app, version) => {
  apps.push(app);
  previous?.(app, version);
};

/** What the frame lays out as separate chrome: islands, the host's corners, the prefab context. */
const ISLANDS = ".je-island, .je-host, .je-frame-context";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function drawn(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  if (getComputedStyle(el).visibility === "hidden") return false;
  return typeof el.checkVisibility === "function" ? el.checkVisibility() : true;
}

function nameOf(el: HTMLElement): string {
  const label = el.getAttribute("aria-label");
  if (label) return JSON.stringify(label);
  const classes = [...el.classList].filter((c) => c.startsWith("je-") && c !== "je-island");
  const tab = el.querySelector(".je-tab-label")?.textContent;
  return `${classes.length ? `.${classes.join(".")}` : el.tagName.toLowerCase()}${tab ? ` (${tab})` : ""}`;
}

/** The outermost drawn islands: one nested in another is part of it. */
function islands(): IslandBox[] {
  return [...document.querySelectorAll<HTMLElement>(ISLANDS)]
    .filter((el) => !el.parentElement?.closest(ISLANDS) && drawn(el))
    .map((el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { name: nameOf(el), rect: { x, y, width, height } };
    });
}

const tabLabel = (tab: Element) => tab.querySelector(".je-tab-label")?.textContent?.trim();

function tabNamed(label: string, root: ParentNode = document): HTMLElement | null {
  return (
    [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => tabLabel(t) === label) ??
    null
  );
}

function inspectorHeight(): number | null {
  const group = [...document.querySelectorAll<HTMLElement>(".je-panel-group")].find(
    (g) => drawn(g) && tabNamed("Inspector", g),
  );
  return group ? group.getBoundingClientRect().height : null;
}

function panelOf(tab: HTMLElement): HTMLElement | null {
  const controls = tab.getAttribute("aria-controls");
  const byId = controls ? document.getElementById(controls) : null;
  if (byId) return byId;
  return tab.id
    ? document.querySelector<HTMLElement>(
        `[role="tabpanel"][aria-labelledby="${CSS.escape(tab.id)}"]`,
      )
    : null;
}

const shows = (panel: HTMLElement | null) =>
  !!panel && !panel.hidden && drawn(panel) && (panel.textContent?.trim().length ?? 0) > 0;

function tabShown(label: string): EditorTabProbe {
  const tab = tabNamed(label);
  if (!tab) return { tab: label, selected: false, shown: false, siblingsHidden: false };
  const group = tab.closest(".je-panel-group") ?? document;
  const siblings = [...group.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
    (t) => t !== tab,
  );
  return {
    tab: label,
    selected: tab.getAttribute("aria-selected") === "true",
    shown: shows(panelOf(tab)),
    siblingsHidden: siblings.every((t) => !shows(panelOf(t))),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await nextFrame();
  // Column splits and the dock ease into place after a resize.
  await sleep(300);
  await nextFrame();
}

async function until<T>(what: string, read: () => T | null | undefined, ms = 15_000): Promise<T> {
  const end = performance.now() + ms;
  for (;;) {
    const value = read();
    if (value) return value;
    if (performance.now() >= end) throw new Error(`the editor never ${what}`);
    await sleep(50);
  }
}

const named = (el: Element, name: string) =>
  el.getAttribute("aria-label") === name || el.textContent?.trim() === name;

function buttonIn(root: ParentNode | null, name: string): HTMLButtonElement | null {
  if (!root) return null;
  return (
    [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => named(b, name) && !b.disabled,
    ) ?? null
  );
}

const toolbar = (label: string) =>
  document.querySelector(`[role="toolbar"][aria-label="${CSS.escape(label)}"]`);

/** Plays the scene from its spawn and stops it again, then reads the inspector group. */
async function inspectorAfterPlay(): Promise<number | null> {
  const play = await until("drew its Play button", () => buttonIn(toolbar("Editor"), "Play"));
  play.click();
  const stop = await until("entered play mode", () => buttonIn(toolbar("Play controls"), "Stop"));
  await settle();
  stop.click();
  await until("came back from play mode", () => buttonIn(toolbar("Editor"), "Play"));
  await settle();
  return inspectorHeight();
}

/** A run of the kitchen sink with `markers` markers, as the Run panel's paste box takes it. */
function longRun(markers: number): string {
  return JSON.stringify({
    v: RECORDING_VERSION,
    engine: { version: "0.0.0", physics: "rapier smoke" },
    scene: SINK_SCENE,
    sceneHash: "smoke",
    game: null,
    configHash: "smoke",
    tickRate: 60,
    start: {},
    actions: [],
    inputs: [],
    ticks: markers * 10 + 10,
    outcome: { result: "timeout", tick: markers * 10 + 9, at: null },
    markers: Array.from({ length: markers }, (_, i) => ({
      tick: i * 10,
      type: "touch",
      at: [900 + i, 1100],
    })),
    end: "smoke",
  });
}

/** Loads a long run through the Run panel's paste box, then reads the inspector group. */
async function inspectorAfterRun(markers: number): Promise<number | null> {
  const panel = await until("drew its Run panel", () =>
    document.querySelector('section[aria-label="Run"]'),
  );
  (await until("drew Load run", () => buttonIn(panel, "Load run"))).click();
  const paste = await until("opened the Load a run dialog", () =>
    document.querySelector<HTMLTextAreaElement>("textarea.je-run-paste"),
  );
  // React reads the value through the native setter, as typing would set it.
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
    paste,
    longRun(markers),
  );
  paste.dispatchEvent(new Event("input", { bubbles: true }));
  const dialog = paste.closest('[role="dialog"]');
  (await until("enabled Load", () => buttonIn(dialog, "Load"))).click();
  await until(
    `drew the run's ${markers} markers`,
    () =>
      document.querySelectorAll('ol[aria-label="Run markers"] > li.je-run-marker').length >=
      markers,
  );
  await until("closed the Load a run dialog", () => !paste.isConnected || !drawn(paste));
  await settle();
  return inspectorHeight();
}

let held: EditorHeldProbe | null = null;

async function measure(): Promise<EditorLayoutProbe> {
  await settle();
  const probe: EditorLayoutProbe = {
    width: window.innerWidth,
    height: window.innerHeight,
    islands: islands(),
    inspector: inspectorHeight(),
  };
  const [first] = EDITOR_VIEWPORTS;
  if (probe.width !== first.width || probe.height !== first.height) return probe;
  held ??= {
    play: await inspectorAfterPlay(),
    run: await inspectorAfterRun(HELD_RUN_MARKERS),
  };
  return { ...probe, held };
}

/** The editor's scene renderer: the newest application still drawing on a canvas in the page. */
function editorApp(): Application | null {
  for (let i = apps.length - 1; i >= 0; i--) {
    const app = apps[i]!;
    if (app.renderer && app.canvas.isConnected && app.stage.getChildByLabel("world")) return app;
  }
  return null;
}

/**
 * The two pixels with the world framed on the crate at scale 1, so the
 * reading doesn't hang on where the editor's camera stands; the camera's own
 * transform is put back before the next frame draws.
 */
function readPixels(app: Application): RenderProbe {
  const world = app.stage.getChildByLabel("world");
  if (!world) throw new Error("the editor's stage has no world container");
  const saved = { x: world.position.x, y: world.position.y, sx: world.scale.x, sy: world.scale.y };
  try {
    world.scale.set(1);
    world.position.set(
      Math.round(app.screen.width / 2 - INSIDE_POINT[0]),
      Math.round(app.screen.height / 2 - INSIDE_POINT[1]),
    );
    const pixel = ([x, y]: readonly [number, number]): Rgba => {
      const at = world.toGlobal({ x, y });
      const { pixels } = app.renderer.extract.pixels({
        target: app.stage,
        frame: new Rectangle(Math.floor(at.x), Math.floor(at.y), 1, 1),
        resolution: 1,
      });
      return [pixels[0] ?? 0, pixels[1] ?? 0, pixels[2] ?? 0, pixels[3] ?? 0];
    };
    return {
      renderer: app.renderer.name,
      inside: pixel(INSIDE_POINT),
      outside: pixel(OUTSIDE_POINT),
    };
  } finally {
    world.position.set(saved.x, saved.y);
    world.scale.set(saved.sx, saved.sy);
  }
}

async function readSprite(ms: number): Promise<RenderProbe> {
  const until = performance.now() + ms;
  for (;;) {
    const app = editorApp();
    const probe = app ? readPixels(app) : null;
    if (probe && judgeEditorRender(probe) === null) return probe;
    if (performance.now() >= until) {
      if (!probe) throw new Error("the editor drew no scene on a Pixi canvas");
      return probe;
    }
    await sleep(250);
  }
}

const page: EngineEditorPage = { error: null, measure, tabShown, readSprite };
window.__engineEditor = page;

try {
  const root = document.getElementById("editor");
  if (!root) throw new Error("the page has no #editor element");
  mountSceneEditor(root, {
    host: devProjectHost({ hocuspocus }),
    game: smokeGame,
    project: SINK_PROJECT,
    scene: SINK_SCENE,
    rapier: loadRapier,
  });
} catch (err) {
  page.error = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
}
