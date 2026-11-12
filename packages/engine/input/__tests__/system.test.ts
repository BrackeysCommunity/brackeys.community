// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { createRegistry, defineGame } from "../../game/define";
import { isUiAction } from "../../game/input-bindings";
import { KEY_TO_CODE } from "../../game/input-codes";
import type { ActionDef } from "../../game/types";
import { createSceneRuntime } from "../../runtime/runtime";
import type { ExpandedScene } from "../../scene/types";
import { createToolRouter } from "../../tool-router";
import type { InputAction, InputBinding, RapierModule, UiActionEvent } from "../../types";
import { resolveBindings } from "../bindings";
import { createGamepadReader, type PadSnapshot } from "../gamepad";
import { createInputSystem } from "../system";

const game = defineGame({
  id: "input-test",
  types: [],
  actions: [
    { action: "left", keys: ["ArrowLeft", "a"], description: "Move left." },
    { action: "right", keys: ["ArrowRight", "d"], description: "Move right." },
    { action: "push", keys: [" "], description: "Push." },
  ],
  createRuntime: () => ({ snapshot: () => null }),
});

/** The code a US keyboard sends with `key`, as a browser fills it in. */
function usCode(key: string | undefined): string {
  return (key && KEY_TO_CODE[key]?.[0]) || "";
}

function setup(bindings: readonly InputBinding[] = game.actions) {
  const host = document.createElement("div");
  const field = document.createElement("input");
  host.appendChild(field);
  document.body.appendChild(host);
  const input = createInputSystem(resolveBindings({ host: bindings, game: [] }).tables);
  input.attach(host);
  const key = (type: "keydown" | "keyup", init: KeyboardEventInit, on: Element = host) => {
    const event = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      code: usCode(init.key),
      ...init,
    });
    on.dispatchEvent(event);
    return event;
  };
  return {
    host,
    field,
    input,
    key,
    cleanup() {
      input.destroy();
      host.remove();
    },
  };
}

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function harness(bindings: readonly InputBinding[] = game.actions) {
  const s = setup(bindings);
  cleanups.push(() => s.cleanup());
  return s;
}

describe("createInputSystem", () => {
  it("generates actions from key presses using the game's bindings", () => {
    const { input, key } = harness();
    key("keydown", { key: "ArrowRight" });
    const actions = input.poll(1);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ action: "right", pressed: true, tick: 1 });
  });

  it("generates release actions on keyup", () => {
    const { input, key } = harness();
    key("keydown", { key: "a" });
    key("keyup", { key: "a" });
    const actions = input.poll(1);
    expect(actions.map((a) => [a.action, a.pressed])).toEqual([
      ["left", true],
      ["left", false],
    ]);
  });

  it("ignores key repeat events", () => {
    const { input, key } = harness();
    key("keydown", { key: "d" });
    key("keydown", { key: "d", repeat: true });
    key("keydown", { key: "d", repeat: true });
    const actions = input.poll(1);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.pressed).toBe(true);
  });

  it("poll drains the queue", () => {
    const { input, key } = harness();
    key("keydown", { key: " " });
    expect(input.poll(1)).toHaveLength(1);
    expect(input.poll(2)).toHaveLength(0);
  });

  it("supports custom bindings", () => {
    const { input, key } = harness([
      { action: "shoot", keys: ["f"] },
      { action: "dash", keys: ["Shift"] },
    ]);
    key("keydown", { key: "f" });
    key("keydown", { key: "Shift" });
    expect(input.poll(1).map((a) => a.action)).toEqual(["shoot", "dash"]);
  });

  it("matches a shifted letter's keyup to its keydown by code", () => {
    const { input, key } = harness();
    key("keydown", { key: "d" });
    key("keyup", { key: "D", code: "KeyD" });
    expect(input.isKeyDown("KeyD")).toBe(false);
    expect(input.poll(1).map((a) => a.pressed)).toEqual([true, false]);
  });

  it("ignores unbound keys", () => {
    const { input, key } = harness();
    key("keydown", { key: "z" });
    expect(input.poll(1)).toHaveLength(0);
  });

  it("tracks the pointer relative to a target offset from the page origin", () => {
    const { host, input } = harness();
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(new DOMRect(40, 25, 800, 600));
    host.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 150, clientY: 300 }),
    );
    expect(input.getMousePosition()).toEqual({ x: 110, y: 275 });
  });

  it("releaseAll lets go of every held key once", () => {
    const { input, key } = harness();
    key("keydown", { key: "a" });
    key("keydown", { key: "d" });
    input.poll(1);
    input.releaseAll();
    expect(input.poll(2).map((a) => [a.action, a.pressed])).toEqual([
      ["left", false],
      ["right", false],
    ]);
    expect(input.isKeyDown("KeyA")).toBe(false);
    input.releaseAll();
    expect(input.poll(3)).toHaveLength(0);
  });

  it("isKeyDown tracks current key state", () => {
    const { input, key } = harness();
    expect(input.isKeyDown("KeyA")).toBe(false);
    key("keydown", { key: "a" });
    expect(input.isKeyDown("KeyA")).toBe(true);
    key("keyup", { key: "a" });
    expect(input.isKeyDown("KeyA")).toBe(false);
  });

  it("destroy removes listeners and clears state", () => {
    const { input, key } = harness();
    key("keydown", { key: "a" });
    input.destroy();
    expect(input.poll(1)).toHaveLength(0);
    key("keydown", { key: "a" });
    expect(input.poll(2)).toHaveLength(0);
  });

  it("detach stops listening until attached again", () => {
    const { host, input, key } = harness();
    input.detach();
    key("keydown", { key: "a" });
    expect(input.poll(1)).toHaveLength(0);
    input.attach(host);
    key("keydown", { key: "a" });
    expect(input.poll(2)).toHaveLength(1);
  });

  it("fires a KeyW binding on an AZERTY z, and not on its w", () => {
    const { input, key } = harness([{ action: "up", bindings: [{ device: "key", code: "KeyW" }] }]);
    key("keydown", { key: "z", code: "KeyW" });
    key("keyup", { key: "z", code: "KeyW" });
    key("keydown", { key: "w", code: "KeyZ" });
    expect(input.poll(1).map((a) => [a.action, a.pressed])).toEqual([
      ["up", true],
      ["up", false],
    ]);
  });

  it("reads 0.x keys through the US table: the space bar and either Shift", () => {
    const { input, key } = harness([
      { action: "jump", keys: [" "] },
      { action: "dash", keys: ["Shift"] },
    ]);
    key("keydown", { key: " ", code: "Space" });
    key("keydown", { key: "Shift", code: "ShiftLeft" });
    key("keyup", { key: "Shift", code: "ShiftLeft" });
    key("keydown", { key: "Shift", code: "ShiftRight" });
    expect(input.poll(1).map((a) => [a.action, a.pressed])).toEqual([
      ["jump", true],
      ["dash", true],
      ["dash", false],
      ["dash", true],
    ]);
  });

  it("reads a key with no physical code (a virtual keyboard) by its US-layout key", () => {
    const { input, key } = harness();
    key("keydown", { key: "D", code: "" });
    key("keyup", { key: "d", code: "" });
    expect(input.poll(1).map((a) => [a.action, a.pressed])).toEqual([
      ["right", true],
      ["right", false],
    ]);
  });

  it("raises each action once for a codeless key every code of which is bound", () => {
    const { input, key } = harness([{ action: "dash", keys: ["Shift"] }]);
    key("keydown", { key: "Shift", code: "" });
    expect(input.poll(1).map((a) => a.action)).toEqual(["dash"]);
    expect(input.isKeyDown("ShiftLeft") && input.isKeyDown("ShiftRight")).toBe(true);
    input.releaseAll();
    expect(input.poll(2).map((a) => [a.action, a.pressed])).toEqual([["dash", false]]);
  });

  it("plays the host's binding of an action over the game's, and the game's for the rest", () => {
    const tables = resolveBindings({
      host: [{ action: "push", bindings: [{ device: "key", code: "KeyJ" }] }],
      game: game.actions,
    }).tables;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const input = createInputSystem(tables);
    input.attach(host);
    cleanups.push(() => (input.destroy(), host.remove()));
    for (const [key, code] of [
      [" ", "Space"],
      ["j", "KeyJ"],
      ["a", "KeyA"],
    ]) {
      host.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true }));
    }
    expect(input.poll(1).map((a) => a.action)).toEqual(["push", "left"]);
  });

  it("preventDefault is called for bound keys only", () => {
    const { key } = harness();
    expect(key("keydown", { key: " " }).defaultPrevented).toBe(true);
    expect(key("keydown", { key: "z" }).defaultPrevented).toBe(false);
    // Bound by code: an AZERTY q is the a key.
    expect(key("keydown", { key: "q", code: "KeyA" }).defaultPrevented).toBe(true);
  });

  it.each([
    ["a Mod chord", { key: "d", metaKey: true }],
    ["a Ctrl chord", { key: "d", ctrlKey: true }],
    ["an Alt chord", { key: "d", altKey: true }],
  ])("leaves %s alone", (_, init) => {
    const { input, key } = harness();
    expect(key("keydown", init).defaultPrevented).toBe(false);
    expect(input.poll(1)).toEqual([]);
  });

  it("typing in an <input> inside the target emits no action", () => {
    const { field, input, key } = harness();
    const event = key("keydown", { key: "d" }, field);
    expect(event.defaultPrevented).toBe(false);
    expect(input.poll(1)).toEqual([]);
    expect(input.isKeyDown("KeyD")).toBe(false);
  });

  it("typing in a contenteditable emits no action", () => {
    const { host, input, key } = harness();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editable.appendChild(inner);
    host.appendChild(editable);
    key("keydown", { key: "ArrowLeft" }, inner);
    expect(input.poll(1)).toEqual([]);
  });

  it("ignores key presses while disabled", () => {
    const { input, key } = harness();
    input.setEnabled(false);
    expect(key("keydown", { key: "d" }).defaultPrevented).toBe(false);
    expect(input.poll(1)).toEqual([]);

    input.setEnabled(true);
    key("keydown", { key: "d" });
    expect(input.poll(2).map((a) => a.action)).toEqual(["right"]);
  });

  it("feeds a shared router as its play consumer", () => {
    const { host, input, key } = harness();
    input.detach();
    const router = createToolRouter();
    router.register(input.consumer());
    router.attach(host);
    cleanups.push(() => router.destroy());

    key("keydown", { key: "d" });
    expect(input.poll(1).map((a) => a.action)).toEqual(["right"]);
    key("keydown", { key: "a" }, host.querySelector("input")!);
    expect(input.poll(2)).toEqual([]);
  });
});

describe("createInputSystem: combining bindings", () => {
  const vecKey = (code: string, axis: "x" | "y", value: number) =>
    ({ device: "key", code, axis, value }) as const;
  const WASD: ActionDef = {
    action: "move",
    kind: "vector",
    description: "Move.",
    bindings: [
      vecKey("KeyW", "y", -1),
      vecKey("KeyS", "y", 1),
      vecKey("KeyA", "x", -1),
      vecKey("KeyD", "x", 1),
    ],
  };

  function combined(layers: Parameters<typeof resolveBindings>[0]) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const input = createInputSystem(resolveBindings(layers).tables);
    input.attach(host);
    cleanups.push(() => (input.destroy(), host.remove()));
    const key = (type: "keydown" | "keyup", code: string) =>
      host.dispatchEvent(
        new KeyboardEvent(type, { code, key: "", bubbles: true, cancelable: true }),
      );
    const shape = (a: InputAction) => {
      const { tick: _t, timestamp: _ts, ...rest } = a;
      return rest;
    };
    return { input, key, take: (tick: number) => input.poll(tick).map(shape) };
  }

  it("drives a vector from WASD, clamping a diagonal to the unit disc", () => {
    const { key, take } = combined({ game: [WASD] });
    key("keydown", "KeyW");
    key("keydown", "KeyD");
    key("keyup", "KeyW");
    key("keyup", "KeyD");
    expect(take(1)).toEqual([
      { action: "move", pressed: true, x: 0, y: -1 },
      { action: "move", pressed: true, x: 0.707, y: -0.707 },
      { action: "move", pressed: true, x: 1, y: 0 },
      { action: "move", pressed: false, x: 0, y: 0 },
    ]);
  });

  it("raises a vector only when its value changes", () => {
    const { key, take } = combined({ game: [WASD] });
    key("keydown", "KeyA");
    key("keydown", "KeyD");
    key("keydown", "KeyW");
    key("keyup", "KeyA");
    expect(take(1)).toEqual([
      { action: "move", pressed: true, x: -1, y: 0 },
      { action: "move", pressed: false, x: 0, y: 0 },
      { action: "move", pressed: true, x: 0, y: -1 },
      { action: "move", pressed: true, x: 0.707, y: -0.707 },
    ]);
  });

  it("makes an axis from two keys", () => {
    const { key, take } = combined({
      game: [
        {
          action: "steer",
          kind: "axis",
          description: "Steer.",
          bindings: [
            { device: "key", code: "ArrowLeft", value: -1 },
            { device: "key", code: "ArrowRight" },
          ],
        },
      ],
    });
    key("keydown", "ArrowLeft");
    key("keydown", "ArrowRight");
    key("keyup", "ArrowLeft");
    key("keyup", "ArrowRight");
    expect(take(1)).toEqual([
      { action: "steer", pressed: true, value: -1 },
      { action: "steer", pressed: false, value: 0 },
      { action: "steer", pressed: true, value: 1 },
      { action: "steer", pressed: false, value: 0 },
    ]);
  });

  it("ORs a button's keys: one press while any is held, one release when the last lets go", () => {
    const { key, take } = combined({
      game: [{ action: "jump", keys: [" ", "w"], description: "Jump." }],
    });
    key("keydown", "Space");
    key("keydown", "KeyW");
    key("keyup", "Space");
    expect(take(1)).toEqual([{ action: "jump", pressed: true }]);
    key("keyup", "KeyW");
    expect(take(2)).toEqual([{ action: "jump", pressed: false }]);
  });

  it("names the seat a fixed key binding drives, combining each seat on its own", () => {
    const { key, take } = combined({
      players: 2,
      game: [
        {
          action: "move",
          kind: "vector",
          description: "Move.",
          bindings: [
            { device: "key", code: "KeyD", axis: "x", value: 1, player: 0 },
            { device: "key", code: "ArrowRight", axis: "x", value: 1, player: 1 },
          ],
        },
      ],
    });
    key("keydown", "KeyD");
    key("keydown", "ArrowRight");
    expect(take(1)).toEqual([
      { action: "move", pressed: true, x: 1, y: 0 },
      { action: "move", pressed: true, x: 1, y: 0, player: 1 },
    ]);
  });

  it("plays the input map's bindings over the game's, and the host's over the map's", () => {
    const map = {
      actions: [
        { action: "move", bindings: [vecKey("KeyI", "y", -1)] },
        { action: "jump", bindings: [{ device: "key", code: "KeyK" } as const] },
      ],
    };
    const game: ActionDef[] = [WASD, { action: "jump", keys: [" "], description: "Jump." }];
    const { key, take } = combined({
      game,
      map,
      host: [{ action: "jump", bindings: [{ device: "key", code: "KeyH" }] }],
    });
    for (const code of ["KeyW", "Space", "KeyK", "KeyI", "KeyH"]) key("keydown", code);
    expect(take(1)).toEqual([
      { action: "move", pressed: true, x: 0, y: -1 },
      { action: "jump", pressed: true },
    ]);
  });

  it("forgets held keys on flush, so a later release raises nothing", () => {
    const { input, key, take } = combined({ game: [WASD] });
    key("keydown", "KeyD");
    input.flush();
    key("keyup", "KeyD");
    expect(take(1)).toEqual([]);
    key("keydown", "KeyA");
    expect(take(2)).toEqual([{ action: "move", pressed: true, x: -1, y: 0 }]);
  });

  it("releaseAll returns an axis or vector to zero", () => {
    const { input, key, take } = combined({ game: [WASD] });
    key("keydown", "KeyW");
    key("keydown", "KeyA");
    take(1);
    input.releaseAll();
    expect(take(2)).toEqual([{ action: "move", pressed: false, x: 0, y: 0 }]);
  });
});

describe("createInputSystem: pointer buttons and touch", () => {
  const actions: ActionDef[] = [
    { action: "fire", description: "Fire.", bindings: [{ device: "pointer", button: "primary" }] },
    { action: "aim", description: "Aim.", bindings: [{ device: "pointer", button: "secondary" }] },
    { action: "jump", description: "Jump.", bindings: [{ device: "touch", control: "jump" }] },
    {
      action: "move",
      kind: "vector",
      description: "Move.",
      bindings: [{ device: "touch", control: "stick" }],
    },
  ];

  type PointerInit = MouseEventInit & { pointerType?: string; pointerId?: number };

  function pointers() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const input = createInputSystem(resolveBindings({ game: actions }).tables);
    input.attach(host);
    cleanups.push(() => (input.destroy(), host.remove()));
    const fire = (type: string, init: PointerInit = {}) => {
      const { pointerType = "mouse", pointerId = 1, ...rest } = init;
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...rest });
      Object.defineProperties(e, {
        pointerType: { value: pointerType },
        pointerId: { value: pointerId },
      });
      host.dispatchEvent(e);
    };
    const touch = (type: string, x: number, y: number, pointerId = 1) =>
      fire(type, { pointerType: "touch", pointerId, clientX: x, clientY: y, button: 0 });
    const take = (tick: number) =>
      input.poll(tick).map((a) => {
        const { tick: _t, timestamp: _ts, ...rest } = a;
        return rest;
      });
    return { input, fire, touch, take };
  }

  it("raises a pointer button binding on each edge of its own button", () => {
    const { input, fire, take } = pointers();
    fire("pointerdown", { button: 0, buttons: 1 });
    fire("pointerdown", { button: 2, buttons: 3 });
    expect(input.getPointer().buttons).toBe(3);
    fire("pointerdown", { button: 1, buttons: 7 });
    fire("pointerup", { button: 0, buttons: 6 });
    fire("pointerup", { button: 1, buttons: 2 });
    fire("pointerup", { button: 2, buttons: 0 });
    expect(take(1)).toEqual([
      { action: "fire", pressed: true },
      { action: "aim", pressed: true },
      { action: "fire", pressed: false },
      { action: "aim", pressed: false },
    ]);
    expect(input.getPointer().buttons).toBe(0);
  });

  it("reads a button pressed while another is held from the move that carries it", () => {
    const { input, fire, take } = pointers();
    fire("pointerdown", { button: 0, buttons: 1 });
    fire("pointermove", { button: 2, buttons: 3 });
    fire("pointermove", { button: -1, buttons: 3, clientX: 4 });
    fire("pointermove", { button: 2, buttons: 1, clientX: 4 });
    expect(take(1)).toEqual([
      { action: "fire", pressed: true },
      { action: "aim", pressed: true },
      { action: "aim", pressed: false },
    ]);
    expect(input.getPointer()).toMatchObject({ x: 4, buttons: 1 });
  });

  it("ignores a press while disabled, and still lets go of one held from before", () => {
    const { input, fire, take } = pointers();
    fire("pointerdown", { button: 0, buttons: 1 });
    input.setEnabled(false);
    fire("pointerdown", { button: 2, buttons: 3 });
    fire("pointerup", { button: 0, buttons: 2 });
    expect(take(1)).toEqual([
      { action: "fire", pressed: true },
      { action: "fire", pressed: false },
    ]);
  });

  it("tracks the pointer's position and whether it is over the target", () => {
    const { input, fire } = pointers();
    expect(input.getPointer()).toEqual({ x: 0, y: 0, buttons: 0, over: false });
    fire("pointermove", { clientX: 30, clientY: 40, button: -1 });
    expect(input.getPointer()).toEqual({ x: 30, y: 40, buttons: 0, over: true });
    fire("pointerleave", { clientX: 31, clientY: 0, button: -1 });
    expect(input.getPointer()).toEqual({ x: 31, y: 0, buttons: 0, over: false });
  });

  it("routes a touch that starts on a control to the control, even as it slides off", () => {
    const { input, touch, take } = pointers();
    const driven: unknown[] = [];
    input.setTouchControls({
      controlAt: (at) => (at.x < 50 ? "jump" : null),
      drive: (control, t) => driven.push([control, t.phase, t.screen.x, t.id]),
    });
    touch("pointerdown", 10, 10, 7);
    touch("pointermove", 80, 10, 7);
    touch("pointerup", 80, 10, 7);
    expect(driven).toEqual([
      ["jump", "start", 10, 7],
      ["jump", "move", 80, 7],
      ["jump", "end", 80, 7],
    ]);
    expect(input.getPointer()).toEqual({ x: 0, y: 0, buttons: 0, over: false });
    expect(input.hasPointer()).toBe(false);
    expect(take(1)).toEqual([]);

    input.setControl("jump", { down: true });
    input.setControl("stick", { x: 0.5, y: 0 });
    input.setControl("stick", { x: 0, y: 0 });
    input.setControl("jump", { down: false });
    expect(take(2)).toEqual([
      { action: "jump", pressed: true },
      { action: "move", pressed: true, x: 0.5, y: 0 },
      { action: "move", pressed: false, x: 0, y: 0 },
      { action: "jump", pressed: false },
    ]);
  });

  it("makes the first touch off every control the pointer, holding its primary button", () => {
    const { input, touch, take } = pointers();
    input.setTouchControls({ controlAt: (at) => (at.x < 50 ? "jump" : null) });
    touch("pointerdown", 200, 100, 1);
    expect(input.getPointer()).toEqual({ x: 200, y: 100, buttons: 1, over: true });
    // A second finger elsewhere is not a second pointer.
    touch("pointerdown", 300, 50, 2);
    touch("pointermove", 310, 60, 2);
    touch("pointermove", 210, 90, 1);
    touch("pointerup", 300, 50, 2);
    expect(input.getPointer()).toEqual({ x: 210, y: 90, buttons: 1, over: true });
    touch("pointerup", 210, 90, 1);
    expect(input.getPointer()).toEqual({ x: 210, y: 90, buttons: 0, over: false });
    expect(take(1)).toEqual([
      { action: "fire", pressed: true },
      { action: "fire", pressed: false },
    ]);
  });

  it("makes every first touch the pointer when there are no on-screen controls", () => {
    const { input, touch, take } = pointers();
    touch("pointerdown", 10, 10);
    expect(input.getPointer()).toMatchObject({ x: 10, y: 10, buttons: 1 });
    touch("pointercancel", 10, 10);
    expect(take(1).map((a) => a.pressed)).toEqual([true, false]);
  });

  it("releaseAll lets go of the pointer's buttons and ends every control touch", () => {
    const { input, fire, touch, take } = pointers();
    const ended: string[] = [];
    input.setTouchControls({
      controlAt: () => "jump",
      drive: (control, t) => void (t.phase === "end" && ended.push(control)),
    });
    fire("pointerdown", { button: 0, buttons: 1 });
    touch("pointerdown", 10, 10, 3);
    input.setControl("jump", { down: true });
    take(1);
    input.releaseAll();
    expect(ended).toEqual(["jump"]);
    expect(take(2)).toEqual([
      { action: "fire", pressed: false },
      { action: "jump", pressed: false },
    ]);
    expect(input.getPointer().buttons).toBe(0);
  });
});

describe("game actions reach the runtime", () => {
  let rapier: RapierModule;
  beforeAll(async () => {
    rapier = await import("@dimforge/rapier2d");
  });

  const scene: ExpandedScene = {
    name: "empty",
    bounds: [0, 0, 100, 100],
    settings: {
      gravity: [0, 0],
      physics: "rapier",
      grid: null,
      view: { projection: "orthogonal" },
    },
    entities: [],
  };

  function pushRuntime() {
    const seen: InputAction[][] = [];
    const pushGame = defineGame({
      ...game,
      createRuntime: () => ({
        beforeStep: (_dt, actions) => void seen.push(actions),
        snapshot: () => seen.length,
      }),
    });
    const runtime = createSceneRuntime({ rapier, view: null, game: pushGame });
    expect(runtime.load(scene).ok).toBe(true);
    cleanups.push(() => runtime.destroy());
    return { seen, runtime, actions: pushGame.actions };
  }

  it("delivers an action the engine has no meaning for to the game's beforeStep", () => {
    const { seen, runtime, actions } = pushRuntime();
    const { input, key } = harness(actions);

    key("keydown", { key: " " });
    const result = runtime.step(1000 / 60, input.poll(0));

    expect(seen).toEqual([[expect.objectContaining({ action: "push", pressed: true, tick: 0 })]]);
    expect(result.game).toBe(1);
  });

  it("typing in an <input> doesn't reach the game", () => {
    const { seen, runtime, actions } = pushRuntime();
    const { field, input, key } = harness(actions);

    key("keydown", { key: "d" }, field);
    key("keydown", { key: " " }, field);
    runtime.step(1000 / 60, input.poll(0));

    expect(seen).toEqual([[]]);
  });
});

describe("createInputSystem: onAction and UI-only actions", () => {
  const uiGame = defineGame({
    id: "ui-input-test",
    types: [],
    actions: [
      {
        action: "jump",
        description: "Jump.",
        bindings: [
          { device: "key", code: "Space" },
          { device: "pad", button: "south" },
        ],
      },
      {
        action: "confirm",
        ui: true,
        description: "Confirm the menu choice.",
        bindings: [
          { device: "key", code: "Enter" },
          { device: "pad", button: "east" },
        ],
      },
      {
        action: "cursor",
        ui: true,
        kind: "vector",
        description: "Move the cursor.",
        bindings: [
          { device: "key", code: "ArrowRight", axis: "x", value: 1 },
          { device: "key", code: "ArrowDown", axis: "y", value: 1 },
          { device: "pad", button: "dpad-right", axis: "x", value: 1 },
        ],
      },
      {
        action: "zoom",
        kind: "axis",
        description: "Zoom.",
        bindings: [
          { device: "key", code: "Equal", value: 1 },
          { device: "key", code: "Minus", value: -1 },
        ],
      },
    ],
    createRuntime: () => ({ snapshot: () => null }),
  });
  const registry = createRegistry(uiGame);

  function listened() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const resolved = resolveBindings({ game: uiGame.actions! });
    const input = createInputSystem(resolved.tables, {
      isUi: (action) => isUiAction(registry, action),
    });
    input.attach(host);
    cleanups.push(() => (input.destroy(), host.remove()));
    const events: UiActionEvent[] = [];
    const key = (type: "keydown" | "keyup", code: string, repeat = false) =>
      host.dispatchEvent(
        new KeyboardEvent(type, { code, key: "", repeat, bubbles: true, cancelable: true }),
      );
    return { input, key, events, listen: () => input.onAction((e) => void events.push(e)) };
  }

  it("delivers keyboard edges and the OS's key repeat to listeners, never to the tick queue for a UI action", () => {
    const { input, key, events, listen } = listened();
    listen();
    key("keydown", "Enter");
    key("keydown", "Enter", true);
    key("keydown", "Enter", true);
    key("keyup", "Enter");
    expect(events).toEqual([
      { action: "confirm", player: 0, kind: "button", device: "keyboard", down: true },
      {
        action: "confirm",
        player: 0,
        kind: "button",
        device: "keyboard",
        down: true,
        repeat: true,
      },
      {
        action: "confirm",
        player: 0,
        kind: "button",
        device: "keyboard",
        down: true,
        repeat: true,
      },
      { action: "confirm", player: 0, kind: "button", device: "keyboard", down: false },
    ]);
    expect(input.poll(1)).toEqual([]);
  });

  it("delivers a simulation action to both, and its repeat to the listeners alone", () => {
    const { input, key, events, listen } = listened();
    listen();
    key("keydown", "Space");
    key("keydown", "Space", true);
    expect(events.map((e) => [e.action, e.down, e.repeat ?? false])).toEqual([
      ["jump", true, false],
      ["jump", true, true],
    ]);
    expect(input.poll(1).map((a) => [a.action, a.pressed])).toEqual([["jump", true]]);
  });

  it("delivers an axis's and a vector's quantised value changes", () => {
    const { input, key, events, listen } = listened();
    listen();
    key("keydown", "Equal");
    key("keydown", "Minus");
    key("keyup", "Equal");
    key("keydown", "ArrowRight");
    key("keydown", "ArrowDown");
    expect(events).toEqual([
      { action: "zoom", player: 0, kind: "axis", device: "keyboard", value: 1 },
      { action: "zoom", player: 0, kind: "axis", device: "keyboard", value: 0 },
      { action: "zoom", player: 0, kind: "axis", device: "keyboard", value: -1 },
      { action: "cursor", player: 0, kind: "vector", device: "keyboard", vector: { x: 1, y: 0 } },
      {
        action: "cursor",
        player: 0,
        kind: "vector",
        device: "keyboard",
        vector: { x: 0.707, y: 0.707 },
      },
    ]);
    expect(input.poll(1).map((a) => a.action)).toEqual(["zoom", "zoom", "zoom"]);
  });

  it("filters by `actions`, and stops on unsubscribe", () => {
    const { input, key } = listened();
    const seen: string[] = [];
    expect(input.listening()).toBe(false);
    const off = input.onAction((e) => void seen.push(`${e.action}:${e.down}`), {
      actions: ["confirm"],
    });
    expect(input.listening()).toBe(true);
    key("keydown", "Space");
    key("keydown", "Enter");
    off();
    expect(input.listening()).toBe(false);
    key("keyup", "Enter");
    expect(seen).toEqual(["confirm:true"]);
  });

  it("keeps delivering to the others when a listener throws", () => {
    const { input, key, events, listen } = listened();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    input.onAction(() => {
      throw new Error("boom");
    });
    listen();
    key("keydown", "Enter");
    expect(events.map((e) => e.action)).toEqual(["confirm"]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("never queues a UI action for the tick, whatever the device", () => {
    const { input, key } = listened();
    let pads: PadSnapshot[] = [];
    const reader = createGamepadReader({ getGamepads: () => pads });
    const pad = (pressed: number[]): PadSnapshot => ({
      index: 0,
      id: "pad",
      mapping: "standard",
      connected: true,
      buttons: Array.from({ length: 17 }, (_, i) => ({
        pressed: pressed.includes(i),
        value: pressed.includes(i) ? 1 : 0,
      })),
      axes: [0, 0, 0, 0],
    });
    key("keydown", "Enter");
    key("keydown", "ArrowRight");
    pads = [pad([1, 15])];
    input.setPads(reader.poll(0), reader);
    expect(input.poll(0)).toEqual([]);
    pads = [pad([0, 1, 15])];
    input.setPads(reader.poll(1), reader);
    expect(input.poll(1).map((a) => a.action)).toEqual(["jump"]);
  });

  it("feeds pads to listeners from the frame poll and to the tick from the tick poll, one edge each", () => {
    const { input, events, listen } = listened();
    listen();
    let pads: PadSnapshot[] = [];
    const reader = createGamepadReader({ getGamepads: () => pads });
    const pad = (pressed: number[]): PadSnapshot => ({
      index: 2,
      id: "pad",
      mapping: "standard",
      connected: true,
      buttons: Array.from({ length: 17 }, (_, i) => ({
        pressed: pressed.includes(i),
        value: pressed.includes(i) ? 1 : 0,
      })),
      axes: [0, 0, 0, 0],
    });
    pads = [pad([])];
    input.setFramePads(reader.pollFrame(), reader.frame);
    input.setPads(reader.poll(0), reader);
    pads = [pad([0, 1])];
    // Frames run ahead of the tick: two frame polls, then the tick's.
    input.setFramePads(reader.pollFrame(), reader.frame);
    input.setFramePads(reader.pollFrame(), reader.frame);
    expect(input.poll(0)).toEqual([]);
    input.setPads(reader.poll(1), reader);
    expect(events).toEqual([
      { action: "jump", player: 0, kind: "button", device: "pad:2", down: true },
      { action: "confirm", player: 0, kind: "button", device: "pad:2", down: true },
    ]);
    expect(input.poll(1).map((a) => [a.action, a.pressed])).toEqual([["jump", true]]);

    pads = [pad([])];
    input.setPads(reader.poll(2), reader);
    expect(input.poll(2).map((a) => [a.action, a.pressed])).toEqual([["jump", false]]);
    expect(events).toHaveLength(2);
    input.setFramePads(reader.pollFrame(), reader.frame);
    expect(events.slice(2).map((e) => [e.action, e.down])).toEqual([
      ["jump", false],
      ["confirm", false],
    ]);
  });

  it("releaseAll lets go of a held UI action for the listeners", () => {
    const { input, key, events, listen } = listened();
    listen();
    key("keydown", "Enter");
    input.releaseAll();
    expect(events.map((e) => [e.action, e.down])).toEqual([
      ["confirm", true],
      ["confirm", false],
    ]);
    expect(input.poll(0)).toEqual([]);
  });
});
