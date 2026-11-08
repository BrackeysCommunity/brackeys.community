// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { defineGame } from "../game/define";
import { createInputSystem } from "../input";
import { createSceneRuntime } from "../runtime/runtime";
import type { ExpandedScene } from "../scene/types";
import { createToolRouter } from "../tool-router";
import type { InputAction, InputBinding, RapierModule } from "../types";

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

function setup(bindings: readonly InputBinding[] = game.actions) {
  const host = document.createElement("div");
  const field = document.createElement("input");
  host.appendChild(field);
  document.body.appendChild(host);
  const input = createInputSystem(bindings);
  input.attach(host);
  const key = (type: "keydown" | "keyup", init: KeyboardEventInit, on: Element = host) => {
    const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
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

  it("folds a shifted letter's keyup onto its keydown", () => {
    const { input, key } = harness();
    key("keydown", { key: "d" });
    key("keyup", { key: "D" });
    expect(input.isKeyDown("d")).toBe(false);
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
    expect(input.isKeyDown("a")).toBe(false);
    input.releaseAll();
    expect(input.poll(3)).toHaveLength(0);
  });

  it("isKeyDown tracks current key state", () => {
    const { input, key } = harness();
    expect(input.isKeyDown("a")).toBe(false);
    key("keydown", { key: "a" });
    expect(input.isKeyDown("a")).toBe(true);
    key("keyup", { key: "a" });
    expect(input.isKeyDown("a")).toBe(false);
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

  it("preventDefault is called for bound keys only", () => {
    const { key } = harness();
    expect(key("keydown", { key: " " }).defaultPrevented).toBe(true);
    expect(key("keydown", { key: "z" }).defaultPrevented).toBe(false);
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
    expect(input.isKeyDown("d")).toBe(false);
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
