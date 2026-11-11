// @vitest-environment jsdom
import {
  mountUi,
  type ActionBindings,
  type GameInstance,
  type GameStoreState,
  type UiActionEvent,
  type UiHandle,
} from "@jams/engine";
import type { GameCommand } from "@jams/engine/game";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import inputMap from "../input-map.json";
import type { TacticsSlice, TacticsSnapshot, UnitState } from "../types";
import { actionKey, keyCap, playerLogLine } from "../ui/hud";
import { mountTacticsHud } from "../ui/index";
import { CLASSES, snapshot, unit } from "./fixtures";

const GRID: TacticsSlice["grid"] = { cols: 12, rows: 8, cell: 1, walls: [], costs: [] };

const sliceOf = (s: TacticsSnapshot, log: string[] = []): TacticsSlice => ({
  ...s,
  grid: GRID,
  classes: Object.fromEntries(
    Object.entries(CLASSES).map(([id, c]) => [
      id,
      { hp: c.hp, move: c.move, range: c.range, sight: c.sight },
    ]),
  ),
  log,
});

const START: Record<string, UnitState> = {
  "blue-knight-1/unit": unit("blue", "knight", [1, 1]),
  "blue-knight-2/unit": unit("blue", "knight", [1, 3]),
  "blue-archer/unit": unit("blue", "archer", [1, 5]),
  "red-knight/unit": unit("red", "knight", [5, 1]),
  "red-archer/unit": unit("red", "archer", [10, 6]),
};

const BINDINGS = Object.fromEntries(
  inputMap.actions.map((a) => [a.action, a.bindings]),
) as unknown as ActionBindings;

let canvas: HTMLCanvasElement;
let unmount: (() => void) | null = null;
let handle: UiHandle | null = null;
let sends: GameCommand[];
let emit: (e: Partial<UiActionEvent> & { action: string }) => void;
let setSlice: (s: TacticsSlice) => void;

function mount(initial: TacticsSlice = sliceOf(snapshot(START))) {
  let state = { game: initial } as unknown as GameStoreState;
  const subs = new Set<() => void>();
  const listeners = new Set<(e: UiActionEvent) => void>();
  sends = [];
  const game = {
    getStore: () => ({
      get state() {
        return state;
      },
      subscribe(fn: () => void) {
        subs.add(fn);
        return () => void subs.delete(fn);
      },
    }),
    project: () => null,
    send: (c: GameCommand) => (sends.push(c), true),
    worldToClient: (p: { x: number; y: number }) => p,
    clientToWorld: (x: number, y: number) => ({ x, y }),
    input: {
      bindings: () => BINDINGS,
      onAction(fn: (e: UiActionEvent) => void) {
        listeners.add(fn);
        return () => void listeners.delete(fn);
      },
    },
  } as unknown as GameInstance;
  emit = (e) => {
    for (const fn of [...listeners])
      fn({ player: 0, kind: "button", device: "keyboard", down: true, ...e } as UiActionEvent);
  };
  setSlice = (s) => {
    state = { ...state, game: s };
    for (const fn of [...subs]) fn();
  };
  unmount = mountUi<TacticsSlice>(game, canvas, (ctx) => (handle = mountTacticsHud(ctx)));
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const promptShown = () => {
  const p = q(".tactics-hud-prompt");
  return p.hidden ? "" : p.textContent;
};

beforeEach(() => {
  const frame = document.createElement("div");
  canvas = document.createElement("canvas");
  frame.appendChild(canvas);
  document.body.appendChild(frame);
});

afterEach(() => {
  unmount?.();
  unmount = null;
  handle = null;
  document.body.replaceChildren();
});

describe("the tactics HUD's Escape", () => {
  it("is claimed while a unit is selected or a target chosen, and declined when idle", () => {
    mount();
    expect(handle?.cancel?.()).toBe(false);

    emit({ action: "confirm" });
    expect(q(".tactics-hud").dataset.mode).toBe("selected");
    emit({ action: "cursor", kind: "vector", vector: { x: 1, y: 0 } });
    emit({ action: "cursor", kind: "vector", vector: { x: 0, y: 0 } });
    emit({ action: "confirm" });
    expect(q(".tactics-hud").dataset.mode).toBe("target");

    expect(handle?.cancel?.()).toBe(true);
    expect(q(".tactics-hud").dataset.mode).toBe("selected");
    expect(handle?.cancel?.()).toBe(true);
    expect(q(".tactics-hud").dataset.mode).toBe("idle");
    expect(handle?.cancel?.()).toBe(false);
    expect(sends).toEqual([]);
  });
});

describe("the tactics HUD's guidance", () => {
  it("prompts for the next step in each mode, with the bound keys", () => {
    mount();
    expect(promptShown()).toBe("Click a blue unit to give it orders · Q picks the next");
    emit({ action: "confirm" });
    expect(promptShown()).toBe(
      "Click a blue cell to move, or an enemy in red to attack · Esc to cancel",
    );
    emit({ action: "cursor", kind: "vector", vector: { x: 1, y: 0 } });
    emit({ action: "cursor", kind: "vector", vector: { x: 0, y: 0 } });
    emit({ action: "confirm" });
    expect(promptShown()).toBe("Click again or press Enter to move · Esc to cancel");
    // The banner keeps its own text.
    expect(q(".tactics-hud-banner").textContent).toBe("Turn 1 · Your orders");

    setSlice(sliceOf(snapshot(START, { side: "red", phase: "enemy" })));
    expect(promptShown()).toBe("");
  });

  it("shows the Wait and End turn keys on their buttons", () => {
    mount();
    const button = (order: string) => q<HTMLButtonElement>(`[data-order="${order}"]`);
    expect(button("wait").dataset.key).toBe("F");
    expect(button("wait").getAttribute("aria-keyshortcuts")).toBe("F");
    expect(button("end-turn").dataset.key).toBe("E");
    expect(button("move").dataset.key).toBeUndefined();
    expect(button("wait").textContent).toBe("Wait");
    expect(q("style").textContent).toContain("content: attr(data-key)");
  });

  it("names units in the log and the live region, never their ids or cells", () => {
    mount(
      sliceOf(snapshot(START), [
        "blue-knight-1/unit moves to 4,2",
        "blue-archer/unit hits red-knight/unit for 3 (crit)",
      ]),
    );
    const { "red-knight/unit": _fallen, ...left } = START;
    setSlice(
      sliceOf(snapshot(left), [
        "blue-knight-1/unit moves to 4,2",
        "blue-archer/unit hits red-knight/unit for 3 (crit)",
        "red-knight/unit falls",
      ]),
    );
    const lines = [...document.querySelectorAll(".tactics-hud-log li")].map((li) => li.textContent);
    expect(lines).toEqual([
      "Blue knight 1 moves",
      "Blue archer hits Red knight for 3, a critical hit",
      "Red knight falls",
    ]);
    expect(q('[role="log"]').textContent).toBe("Red knight falls");
    expect(q(".tactics-hud").textContent).not.toMatch(/\/unit|\d+,\d+/);
  });
});

describe("the HUD's text helpers", () => {
  const nameOf = (id: string) => ({ a: "Blue knight", b: "Red archer" })[id] ?? id;

  it("rewrites each rules line and leaves unknown ones alone", () => {
    expect(playerLogLine("a moves to 3,4", nameOf)).toBe("Blue knight moves");
    expect(playerLogLine("a waits", nameOf)).toBe("Blue knight waits");
    expect(playerLogLine("b hits a for 2", nameOf)).toBe("Red archer hits Blue knight for 2");
    expect(playerLogLine("b falls", nameOf)).toBe("Red archer falls");
    expect(playerLogLine("blue ends the turn", nameOf)).toBe("The blue side ends its turn");
    expect(playerLogLine("red wins", nameOf)).toBe("The red side wins");
    expect(playerLogLine("something else", nameOf)).toBe("something else");
  });

  it("turns key codes into caps and skips non-key bindings", () => {
    expect([keyCap("KeyF"), keyCap("Digit2"), keyCap("Escape"), keyCap("ArrowUp")]).toEqual([
      "F",
      "2",
      "Esc",
      "↑",
    ]);
    expect(actionKey(BINDINGS, "cancel")).toBe("Esc");
    expect(actionKey({ x: [{ device: "pad", button: "south" }] } as never, "x")).toBeNull();
    expect(actionKey(BINDINGS, "nothing")).toBeNull();
  });
});
