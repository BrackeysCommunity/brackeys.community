// @vitest-environment jsdom
import { mountUi, type GameInstance, type GameStoreState, type UiActionEvent } from "@jams/engine";
import type { Cell, GameCommand } from "@jams/engine/game";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { tacticsBoard, type TacticsSlice, type TacticsSnapshot, type UnitState } from "../types";
import { mountTacticsHud } from "../ui/index";
import { CLASSES, snapshot, unit } from "./fixtures";

const GRID: TacticsSlice["grid"] = { cols: 12, rows: 8, cell: 1, walls: [], costs: [] };
const BOARD = tacticsBoard(GRID);
const ORIGIN = { x: 10, y: 20 };
const PX = 48;

function sliceOf(s: TacticsSnapshot, log: string[] = []): TacticsSlice {
  return {
    ...s,
    grid: GRID,
    classes: Object.fromEntries(
      Object.entries(CLASSES).map(([id, c]) => [id, { move: c.move, range: c.range }]),
    ),
    log,
  };
}

const START: Record<string, UnitState> = {
  "blue-1": unit("blue", "knight", [1, 1]),
  "blue-2": unit("blue", "archer", [1, 4]),
  "red-1": unit("red", "knight", [5, 1]),
};

/** What a HUD may touch on the instance: anything else throws, so the test proves it sends only commands. */
const ALLOWED = new Set(["getStore", "project", "send", "clientToWorld", "worldToClient", "input"]);

type Fake = {
  game: GameInstance;
  sends: GameCommand[];
  setSlice(s: TacticsSlice | null): void;
  emit(e: Partial<UiActionEvent> & { action: string }): void;
  listeners: number;
};

function fakeGame(initial: TacticsSlice | null): Fake {
  let state = { game: initial, camera: { position: { x: 0, y: 0 } } } as unknown as GameStoreState;
  const subs = new Set<() => void>();
  const store = {
    get state() {
      return state;
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
  const listeners = new Set<{ fn: (e: UiActionEvent) => void; actions?: readonly string[] }>();
  const sends: GameCommand[] = [];
  const impl = {
    getStore: () => store,
    project: () => null,
    send: (c: GameCommand) => {
      sends.push(structuredClone(c));
      return true;
    },
    worldToClient: (p: { x: number; y: number }) => ({
      x: ORIGIN.x + p.x * PX,
      y: ORIGIN.y + p.y * PX,
    }),
    clientToWorld: (x: number, y: number) => ({ x: (x - ORIGIN.x) / PX, y: (y - ORIGIN.y) / PX }),
    input: {
      onAction(fn: (e: UiActionEvent) => void, opts?: { actions?: readonly string[] }) {
        const l = { fn, actions: opts?.actions };
        listeners.add(l);
        return () => void listeners.delete(l);
      },
    },
  };
  const game = new Proxy(impl, {
    get(target, key) {
      if (typeof key === "string" && !ALLOWED.has(key))
        throw new Error(`the HUD reached game.${key}`);
      return target[key as keyof typeof target];
    },
  }) as unknown as GameInstance;
  return {
    game,
    sends,
    setSlice(s) {
      state = { ...state, game: s };
      for (const fn of [...subs]) fn();
    },
    emit(e) {
      const event = { player: 0, kind: "button", device: "keyboard", ...e } as UiActionEvent;
      for (const l of [...listeners])
        if (!l.actions || l.actions.includes(event.action)) l.fn(event);
    },
    get listeners() {
      return listeners.size;
    },
  };
}

let canvas: HTMLCanvasElement;
let unmount: (() => void) | null = null;

beforeEach(() => {
  const frame = document.createElement("div");
  canvas = document.createElement("canvas");
  frame.appendChild(canvas);
  document.body.appendChild(frame);
});

afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.replaceChildren();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

function mount(initial: TacticsSlice | null = sliceOf(snapshot(START))): Fake {
  const fake = fakeGame(initial);
  unmount = mountUi(fake.game, canvas, mountTacticsHud);
  return fake;
}

const hud = () => document.querySelector<HTMLElement>(".tactics-hud")!;
const cursorCell = () => hud().dataset.cursor;
const cellsOf = (kind: string) =>
  [...document.querySelectorAll<HTMLElement>(`[data-highlight="${kind}"]`)].map(
    (el) => el.dataset.cell,
  );

/** A held direction and its release, as the input system reports a vector action. */
function step(fake: Fake, x: number, y: number, device: UiActionEvent["device"] = "keyboard") {
  fake.emit({ action: "cursor", kind: "vector", device, vector: { x, y } });
  fake.emit({ action: "cursor", kind: "vector", device, vector: { x: 0, y: 0 } });
}
const press = (fake: Fake, action: string, device: UiActionEvent["device"] = "keyboard") => {
  fake.emit({ action, device, down: true });
  fake.emit({ action, device, down: false });
};

function click(cell: Cell) {
  const [x, y] = BOARD.geometry.center(cell);
  const p = { x: ORIGIN.x + x * PX, y: ORIGIN.y + y * PX };
  canvas.dispatchEvent(new MouseEvent("click", { clientX: p.x, clientY: p.y, button: 0 }));
}

/** The move landed and its walk finished: the slice the runtime would publish next. */
function afterMove(fake: Fake, id: string, to: Cell, log: string) {
  const units = { ...START, [id]: { ...START[id]!, cell: to, moved: true } };
  fake.setSlice(sliceOf(snapshot(units, { phase: "moving" }), [log]));
  fake.setSlice(sliceOf(snapshot(units), [log]));
}

describe("the tactics HUD", () => {
  it("drives a turn by keyboard: select, move, attack", () => {
    const fake = mount();
    expect(fake.listeners).toBe(1);
    expect(cursorCell()).toBe("1,1");

    press(fake, "confirm");
    expect(hud().dataset.mode).toBe("selected");
    expect(document.querySelector<HTMLElement>(".tactics-hud-card")!.hidden).toBe(false);
    expect(document.querySelector(".tactics-hud-card")!.textContent).toContain("Knight blue-1");
    expect(cellsOf("reach")).toContain("4,1");
    expect(cellsOf("attack")).toEqual(expect.arrayContaining(["0,1", "1,0", "1,2", "2,1"]));
    expect(cellsOf("attack")).toHaveLength(4);

    for (let i = 0; i < 3; i++) step(fake, 1, 0);
    expect(cursorCell()).toBe("4,1");
    press(fake, "confirm");
    expect(hud().dataset.mode).toBe("target");
    expect(cellsOf("target")).toEqual(["4,1"]);
    expect(fake.sends).toEqual([]);
    press(fake, "confirm");
    expect(fake.sends).toEqual([{ name: "move", args: { unit: "blue-1", to: [4, 1] } }]);
    expect(hud().dataset.mode).toBe("sent");

    afterMove(fake, "blue-1", [4, 1], "blue-1 moves to 4,1");
    expect(hud().dataset.mode).toBe("selected");
    expect(cellsOf("reach")).toEqual([]);
    expect(document.querySelector('[role="log"]')!.textContent).toBe("blue-1 moves to 4,1");

    step(fake, 1, 0);
    press(fake, "confirm");
    press(fake, "confirm");
    expect(fake.sends.at(-1)).toEqual({
      name: "attack",
      args: { unit: "blue-1", target: "red-1" },
    });

    // Cancel steps back: the target, then the selection.
    fake.setSlice(sliceOf(snapshot(START)));
    press(fake, "next-unit");
    expect(hud().dataset.mode).toBe("selected");
    step(fake, 1, 0);
    press(fake, "confirm");
    expect(hud().dataset.mode).toBe("target");
    press(fake, "cancel");
    expect(hud().dataset.mode).toBe("selected");
    press(fake, "cancel");
    expect(hud().dataset.mode).toBe("idle");

    press(fake, "end-turn");
    expect(fake.sends.at(-1)).toEqual({ name: "end-turn" });
  });

  it("drives the same turn by pointer clicks at worldToClient cell centres", () => {
    const fake = mount();
    click([1, 1]);
    expect(hud().dataset.mode).toBe("selected");
    click([4, 1]);
    expect(hud().dataset.mode).toBe("target");
    click([4, 1]);
    expect(fake.sends).toEqual([{ name: "move", args: { unit: "blue-1", to: [4, 1] } }]);

    afterMove(fake, "blue-1", [4, 1], "blue-1 moves to 4,1");
    click([5, 1]);
    click([5, 1]);
    expect(fake.sends.at(-1)).toEqual({
      name: "attack",
      args: { unit: "blue-1", target: "red-1" },
    });

    // The pointer's own confirm press is the click's, so it never confirms twice.
    fake.setSlice(sliceOf(snapshot(START)));
    press(fake, "cancel");
    expect(hud().dataset.mode).toBe("idle");
    press(fake, "confirm", "pointer");
    expect(hud().dataset.mode).toBe("idle");
    press(fake, "confirm");
    expect(hud().dataset.mode).toBe("selected");
  });

  it("follows the pointer over the board and keeps highlights on their cells", () => {
    const fake = mount();
    const [x, y] = BOARD.geometry.center([3, 2]);
    canvas.dispatchEvent(
      new MouseEvent("pointermove", { clientX: ORIGIN.x + x * PX, clientY: ORIGIN.y + y * PX }),
    );
    expect(cursorCell()).toBe("3,2");
    const cursor = document.querySelector<HTMLElement>('[data-highlight="cursor"]')!;
    expect(cursor.dataset.cell).toBe("3,2");
    expect(cursor.style.transform).toBe(
      `translate(${ORIGIN.x + x * PX}px, ${ORIGIN.y + y * PX}px)`,
    );
    const layer = document.querySelector<HTMLElement>(".tactics-hud-cells")!;
    expect(layer.style.getPropertyValue("--tactics-cell-w")).toBe(`${PX}px`);
    expect(fake.sends).toEqual([]);
  });

  it("drives the cursor from a pad's d-pad with no tick running", () => {
    vi.useFakeTimers();
    try {
      const fake = mount();
      const pad = "pad:0" as const;
      step(fake, 1, 0, pad);
      step(fake, 0, 1, pad);
      expect(cursorCell()).toBe("2,2");
      step(fake, -1, 0, pad);
      step(fake, 0, -1, pad);
      press(fake, "confirm", pad);
      expect(hud().dataset.mode).toBe("selected");
      step(fake, 1, 0, pad);
      step(fake, 1, 0, pad);
      press(fake, "confirm", pad);
      press(fake, "confirm", pad);
      expect(fake.sends).toEqual([{ name: "move", args: { unit: "blue-1", to: [3, 1] } }]);

      // A stick held past the threshold steps once until it comes back.
      fake.setSlice(sliceOf(snapshot(START)));
      fake.emit({ action: "cursor", kind: "vector", device: pad, vector: { x: 0.6, y: 0 } });
      fake.emit({ action: "cursor", kind: "vector", device: pad, vector: { x: 0.9, y: 0 } });
      expect(cursorCell()).toBe("2,1");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers real, labelled, focusable menu buttons and no title attributes", () => {
    const fake = mount();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".tactics-hud-menu button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Move", "Attack", "Wait", "End turn"]);
    expect(document.querySelector(".tactics-hud-menu")!.getAttribute("aria-label")).toBe("Orders");
    for (const b of buttons) {
      expect(b.type).toBe("button");
      expect(b.disabled).toBe(false);
      expect(b.tabIndex).toBe(0);
      b.focus();
      expect(document.activeElement).toBe(b);
    }
    expect(document.querySelectorAll(".tactics-hud [title]")).toHaveLength(0);

    const banner = document.querySelector(".tactics-hud-banner")!;
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(banner.textContent).toBe("Turn 1 · Your orders");

    const [move, attack, wait, end] = buttons as [
      HTMLButtonElement,
      HTMLButtonElement,
      HTMLButtonElement,
      HTMLButtonElement,
    ];
    expect(wait.getAttribute("aria-disabled")).toBe("true");
    wait.click();
    expect(fake.sends).toEqual([]);

    // Enter on a focused button is the button's; the board's confirm waits.
    end.focus();
    press(fake, "confirm");
    expect(hud().dataset.mode).toBe("idle");
    end.blur();

    press(fake, "confirm");
    expect(move.getAttribute("aria-disabled")).toBe("false");
    attack.click();
    expect(attack.getAttribute("aria-pressed")).toBe("true");
    expect(cellsOf("reach")).toEqual([]);
    move.click();
    expect(move.getAttribute("aria-pressed")).toBe("true");
    expect(cellsOf("attack")).toEqual([]);
    wait.click();
    expect(fake.sends).toEqual([{ name: "wait", args: { unit: "blue-1" } }]);

    fake.setSlice(
      sliceOf(snapshot({ ...START, "blue-1": { ...START["blue-1"]!, moved: true, acted: true } })),
    );
    expect(hud().dataset.mode).toBe("idle");
    end.click();
    expect(fake.sends.at(-1)).toEqual({ name: "end-turn" });

    fake.setSlice(sliceOf(snapshot(START, { side: "red", phase: "enemy" })));
    expect(banner.textContent).toBe("Turn 1 · The red side acts");
    expect(end.getAttribute("aria-disabled")).toBe("true");
    press(fake, "confirm");
    expect(hud().dataset.mode).toBe("idle");
  });

  it("shades cells no blue unit can see", () => {
    mount();
    const fog = cellsOf("fog");
    expect(fog).toContain("11,7");
    expect(fog).not.toContain("1,1");
    expect(fog).not.toContain("5,1");
  });

  it("pulses highlights unless the page prefers reduced motion", () => {
    const fake = mount();
    press(fake, "confirm");
    expect(hud().dataset.motion).toBe("full");
    expect(document.querySelectorAll('[data-highlight="reach"].tactics-hud-pulse').length).toBe(
      cellsOf("reach").length,
    );
    unmount!();
    unmount = null;
    expect(document.querySelector(".tactics-hud")).toBeNull();

    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q })) as never;
    const reduced = mount();
    press(reduced, "confirm");
    expect(hud().dataset.motion).toBe("reduced");
    expect(cellsOf("reach").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".tactics-hud-pulse")).toHaveLength(0);
  });

  it("waits for the first slice and unmounts cleanly", () => {
    const fake = mount(null);
    expect(document.querySelector(".tactics-hud-banner")!.textContent).toBe("Setting up the board");
    press(fake, "confirm");
    expect(fake.sends).toEqual([]);
    fake.setSlice(sliceOf(snapshot(START)));
    expect(cursorCell()).toBe("1,1");
    unmount!();
    unmount = null;
    expect(fake.listeners).toBe(0);
    expect(document.querySelector("[data-jams-ui]")).toBeNull();
  });
});
