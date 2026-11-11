import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../../game/define";
import type { InputAction } from "../../types";
import { createInputState, type PointerState } from "../state";
import type { TickInput } from "../stream";

const game = defineGame({
  id: "state",
  types: [],
  actions: [
    { action: "jump", bindings: [{ device: "key", code: "Space" }], description: "Jump." },
    {
      action: "steer",
      kind: "axis",
      bindings: [
        { device: "key", code: "KeyA", value: -1 },
        { device: "key", code: "KeyD", value: 1 },
      ],
      description: "Steer.",
    },
    {
      action: "move",
      kind: "vector",
      bindings: [{ device: "pad", stick: "left" }],
      description: "Move.",
    },
  ],
  createRuntime: () => ({ snapshot: () => null }),
});

const registry = createRegistry(game);

const act = (action: string, fields: Partial<InputAction> = {}): InputAction => ({
  action,
  pressed: true,
  tick: 0,
  timestamp: 0,
  ...fields,
});

const tick = (
  n: number,
  actions: InputAction[] = [],
  pointers: (PointerState | undefined)[] = [],
): TickInput => ({ tick: n, actions, commands: [], pointers, joins: [] });

describe("createInputState", () => {
  it("starts with nothing held, every value 0 and no pointer", () => {
    const s = createInputState(registry);
    expect(s.held("jump")).toBe(false);
    expect(s.pressed("jump")).toBe(false);
    expect(s.value("steer")).toBe(0);
    expect(s.vector("move")).toEqual({ x: 0, y: 0 });
    expect(s.pointer()).toBeNull();
    expect(s.players()).toEqual([
      { index: 0, devices: ["keyboard", "pointer", "touch"], joined: true },
    ]);
  });

  it("tracks a button across ticks: pressed once, held, released once", () => {
    const s = createInputState(registry);
    const seen: [boolean, boolean, boolean, number][] = [];
    const read = () =>
      seen.push([s.pressed("jump"), s.held("jump"), s.released("jump"), s.value("jump")]);
    s.update(tick(0, [act("jump")]));
    read();
    s.update(tick(1));
    read();
    s.update(tick(2, [act("jump", { pressed: false })]));
    read();
    s.update(tick(3));
    read();
    expect(seen).toEqual([
      [true, true, false, 1],
      [false, true, false, 1],
      [false, false, true, 0],
      [false, false, false, 0],
    ]);
  });

  it("sees a press and release inside one tick as both edges, nothing held", () => {
    const s = createInputState(registry);
    s.update(tick(0, [act("jump"), act("jump", { pressed: false })]));
    expect([s.pressed("jump"), s.released("jump"), s.held("jump")]).toEqual([true, true, false]);
  });

  it("a repeated down is no new press", () => {
    const s = createInputState(registry);
    s.update(tick(0, [act("jump")]));
    s.update(tick(1, [act("jump")]));
    expect(s.pressed("jump")).toBe(false);
    expect(s.held("jump")).toBe(true);
  });

  it("an axis is held while non-zero and keeps its value until it changes", () => {
    const s = createInputState(registry);
    s.update(tick(0, [act("steer", { value: -0.5 })]));
    expect([s.pressed("steer"), s.held("steer"), s.value("steer")]).toEqual([true, true, -0.5]);
    s.update(tick(1, [act("steer", { value: 0.25 })]));
    expect([s.pressed("steer"), s.held("steer"), s.value("steer")]).toEqual([false, true, 0.25]);
    s.update(tick(2));
    expect(s.value("steer")).toBe(0.25);
    s.update(tick(3, [act("steer", { value: 0, pressed: false })]));
    expect([s.released("steer"), s.held("steer"), s.value("steer")]).toEqual([true, false, 0]);
  });

  it("quantises and clamps what arrives", () => {
    const s = createInputState(registry);
    s.update(tick(0, [act("steer", { value: 1.7 }), act("move", { x: 3, y: 4 })]));
    expect(s.value("steer")).toBe(1);
    expect(s.vector("move")).toEqual({ x: 0.6, y: 0.8 });
    s.update(tick(1, [act("steer", { value: 0.12345 }), act("move", { x: 0.33333, y: 0 })]));
    expect(s.value("steer")).toBe(0.123);
    expect(s.vector("move")).toEqual({ x: 0.333, y: 0 });
  });

  it("a vector's value is its length; it is released when it returns to the centre", () => {
    const s = createInputState(registry);
    s.update(tick(0, [act("move", { x: 0.6, y: -0.8 })]));
    expect([s.pressed("move"), s.value("move"), s.vector("move")]).toEqual([
      true,
      1,
      { x: 0.6, y: -0.8 },
    ]);
    s.update(tick(1, [act("move", { x: 0, y: 0, pressed: false })]));
    expect([s.released("move"), s.held("move"), s.vector("move")]).toEqual([
      true,
      false,
      { x: 0, y: 0 },
    ]);
  });

  it("keeps each seat apart", () => {
    const s = createInputState(registry);
    s.update(tick(0, [act("jump", { player: 1 }), act("steer", { value: -1 })]));
    expect([s.pressed("jump", 1), s.pressed("jump"), s.pressed("jump", 0)]).toEqual([
      true,
      false,
      false,
    ]);
    expect([s.value("steer"), s.value("steer", 1)]).toEqual([-1, 0]);
    s.update(tick(1, [act("jump", { player: 0 })]));
    expect([s.pressed("jump", 0), s.pressed("jump", 1), s.held("jump", 1)]).toEqual([
      true,
      false,
      true,
    ]);
    s.update(tick(2, [act("jump", { player: 1, pressed: false })]));
    expect([s.released("jump", 1), s.held("jump", 0)]).toEqual([true, true]);
  });

  it("keeps a seat's pointer until a tick brings a new one, quantised to 1/10,000 m", () => {
    const s = createInputState(registry);
    s.update(tick(0, [], [{ x: 1.234567, y: -0.5, buttons: 1, over: true }]));
    expect(s.pointer()).toEqual({ x: 1.2346, y: -0.5, buttons: 1, over: true });
    s.update(tick(1));
    expect(s.pointer(0)).toEqual({ x: 1.2346, y: -0.5, buttons: 1, over: true });
    s.update(tick(2, [], [undefined, { x: 2, y: 3, buttons: 0, over: false }]));
    expect(s.pointer(0)?.x).toBe(1.2346);
    expect(s.pointer(1)).toEqual({ x: 2, y: 3, buttons: 0, over: false });
    expect(s.pointer(2)).toBeNull();
  });

  it("reads an undeclared action by what it carries", () => {
    const s = createInputState(registry);
    s.update(tick(0, [act("aim", { x: 0.5, y: 0.5 }), act("throttle", { value: 0.4 })]));
    expect(s.vector("aim")).toEqual({ x: 0.5, y: 0.5 });
    expect(s.value("throttle")).toBe(0.4);
    expect(s.value("unknown")).toBe(0);
  });

  it("raises no seat events while seat 0 owns every device", () => {
    const s = createInputState(registry);
    expect(s.update({ ...tick(0), joins: [{ player: 1, device: "pad:0", joined: true }] })).toEqual(
      [],
    );
    expect(s.players()).toHaveLength(1);
  });

  it("turns a tick's seat changes into player events, before its actions", () => {
    const s = createInputState(registry, { max: 2, join: "press" });
    expect(s.players()).toEqual([
      { index: 0, devices: [], joined: false },
      { index: 1, devices: [], joined: false },
    ]);
    const events = s.update({
      ...tick(0, [act("jump", { player: 1 })]),
      joins: [
        { player: 0, device: "keyboard", joined: true },
        { player: 1, device: "pad:0", joined: true },
      ],
    });
    expect(events).toEqual([
      { type: "player:joined", player: 0, at: { x: 0, y: 0 }, data: { device: "keyboard" } },
      { type: "player:joined", player: 1, at: { x: 0, y: 0 }, data: { device: "pad:0" } },
    ]);
    expect(s.pressed("jump", 1)).toBe(true);
    expect(s.players()[1]).toEqual({ index: 1, devices: ["pad:0"], joined: true });
    expect(
      s.update({ ...tick(1), joins: [{ player: 1, device: "pad:0", joined: false }] }),
    ).toEqual([{ type: "player:left", player: 1, at: { x: 0, y: 0 }, data: { device: "pad:0" } }]);
    expect(s.players()[1]?.joined).toBe(false);
  });

  it("a device joining another seat leaves its old one first", () => {
    const s = createInputState(registry, { max: 2, join: "auto" });
    const events = s.update({
      ...tick(0),
      joins: [{ player: 1, device: "keyboard", joined: true }],
    });
    expect(events.map((e) => [e.type, e.player])).toEqual([
      ["player:left", 0],
      ["player:joined", 1],
    ]);
    expect(s.players().map((p) => p.devices)).toEqual([["pointer", "touch"], ["keyboard"]]);
  });

  it("takes its seats from the game when none are given", () => {
    const duo = createRegistry(
      defineGame({
        id: "duo",
        types: [],
        actions: [],
        input: { players: { max: 3, join: "host" } },
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    expect(createInputState(duo).players()).toHaveLength(3);
  });
});
