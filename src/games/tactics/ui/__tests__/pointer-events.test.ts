// @vitest-environment jsdom
/**
 * The HUD and the menu over the UI layer, with only their own stylesheets
 * loaded, as a standalone export runs them: the layer takes no pointer
 * events, and the site's global rules (buttons back to `auto`, `[hidden]`
 * forced to `display: none`) aren't there to cover for a view that leaves
 * either to the host.
 */
import { mountUi, type GameInstance, type GameStoreState } from "@jams/engine";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { CLASSES, snapshot, unit } from "../../__tests__/fixtures";
import type { TacticsFlowSlice } from "../../runtime";
import type { TacticsSnapshot } from "../../types";
import { mountTacticsHud } from "../index";
import { MENU_CLS } from "../menu";
import { CLS } from "../styles";

const GRID = { cols: 12, rows: 8, cell: 1, walls: [], costs: [] };

function sliceOf(s: TacticsSnapshot, flow?: TacticsFlowSlice["flow"]): TacticsFlowSlice {
  return {
    ...s,
    grid: GRID,
    classes: Object.fromEntries(
      Object.entries(CLASSES).map(([id, c]) => [
        id,
        { hp: c.hp, move: c.move, range: c.range, sight: c.sight },
      ]),
    ),
    log: [],
    ...(flow ? { flow } : {}),
  } as TacticsFlowSlice;
}

const LEVEL = sliceOf(
  snapshot({ "blue-1": unit("blue", "knight", [1, 1]), "red-1": unit("red", "knight", [5, 1]) }),
);
const flowOf = (screen: "menu" | "level", scene: string): TacticsFlowSlice["flow"] => ({
  screen,
  scene,
  progress: { cleared: [], roster: [], last: null },
  stairs: [],
  next: null,
});

/** The pointer-events a click meets at `el`: its own value, else the nearest ancestor's. */
function pointerEventsAt(el: Element): string {
  for (let at: Element | null = el; at; at = at.parentElement) {
    const own = getComputedStyle(at).pointerEvents;
    if (own !== "" && own !== "inherit") return own;
  }
  return "auto";
}

/** Whether `el` or an ancestor is laid out as `display: none`. */
const undisplayed = (el: Element): boolean => {
  for (let at: Element | null = el; at; at = at.parentElement)
    if (getComputedStyle(at).display === "none") return true;
  return false;
};

let unmount: (() => void) | null = null;

function mount(slice: TacticsFlowSlice): HTMLElement {
  const frame = document.createElement("div");
  const canvas = document.createElement("canvas");
  frame.append(canvas);
  document.body.append(frame);
  const state = { game: slice, camera: { position: { x: 0, y: 0 } } } as unknown as GameStoreState;
  const game = {
    getStore: () => ({ state, subscribe: () => () => {} }),
    project: () => null,
    flow: { start: null, scenes: [] },
    send: () => true,
    worldToClient: (p: { x: number; y: number }) => ({ x: p.x * 48, y: p.y * 48 }),
    clientToWorld: (x: number, y: number) => ({ x: x / 48, y: y / 48 }),
    input: { onAction: () => () => {} },
    saves: { list: async () => [], load: async () => ({ ok: true }), store: {} },
  } as unknown as GameInstance;
  unmount = mountUi(game, canvas, mountTacticsHud);
  return frame.querySelector<HTMLElement>("[data-jams-ui]")!;
}

afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.replaceChildren();
});

describe("the tactics UI under the pointer-events: none layer", () => {
  it("passes the board's clicks to the canvas and takes its own on every order and Save", () => {
    const layer = mount({ ...LEVEL, flow: flowOf("level", "level-1") });
    expect(pointerEventsAt(layer)).toBe("none");
    const hud = layer.querySelector<HTMLElement>(`.${CLS.root}`)!;
    expect(undisplayed(hud)).toBe(false);
    expect(pointerEventsAt(hud)).toBe("none");
    expect(pointerEventsAt(layer.querySelector(`.${CLS.cells}`)!)).toBe("none");
    expect(pointerEventsAt(layer.querySelector(`.${CLS.top}`)!)).toBe("none");

    const buttons = [...hud.querySelectorAll("button")];
    expect(buttons.map((b) => b.dataset.order ?? b.dataset.action)).toContain("save");
    expect(buttons.length).toBeGreaterThan(1);
    for (const b of buttons) {
      expect(undisplayed(b), b.textContent ?? "").toBe(false);
      expect(pointerEventsAt(b), b.textContent ?? "").toBe("auto");
    }
  });

  it("hides the Save group by its own rule while no level offers it", () => {
    const layer = mount(LEVEL);
    const tools = layer.querySelector<HTMLElement>(`.${CLS.tools}`)!;
    expect(undisplayed(layer.querySelector(`.${CLS.root}`)!)).toBe(false);
    expect(tools.hidden).toBe(true);
    expect(getComputedStyle(tools).display).toBe("none");
  });

  it("takes every click on the title screen, its buttons and links included", () => {
    const layer = mount({ ...LEVEL, flow: flowOf("menu", "menu") });
    const menu = layer.querySelector<HTMLElement>(`.${MENU_CLS.root}`)!;
    expect(pointerEventsAt(menu)).toBe("auto");
    const controls = [...menu.querySelectorAll("button, a")];
    expect(controls.map((c) => (c as HTMLElement).dataset.command)).toContain("start");
    for (const c of controls) expect(pointerEventsAt(c), c.textContent ?? "").toBe("auto");
    expect(undisplayed(layer.querySelector(`.${CLS.root}`)!)).toBe(true);
  });
});
