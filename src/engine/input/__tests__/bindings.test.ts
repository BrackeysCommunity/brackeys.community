// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import type { ActionDef, Binding } from "../../game/types";
import type { InputMapFile } from "../../project/kinds/input-map";
import {
  actionBindings,
  actionValueChanged,
  combineAction,
  deviceClass,
  resolveBindings,
  seatTables,
} from "../bindings";
import type { RemapState } from "../remap";

const key = (code: string, extra: Partial<Extract<Binding, { device: "key" }>> = {}): Binding => ({
  device: "key",
  code,
  ...extra,
});

const GAME: readonly ActionDef[] = [
  { action: "jump", keys: [" ", "w"], description: "Jump." },
  { action: "dash", keys: ["Shift"], description: "Dash." },
  {
    action: "move",
    kind: "vector",
    description: "Move.",
    bindings: [key("KeyA", { axis: "x", value: -1 }), key("KeyD", { axis: "x", value: 1 })],
  },
];

const map = (actions: InputMapFile["actions"]): Pick<InputMapFile, "actions"> => ({ actions });
const remap = (players: RemapState["players"]): RemapState => ({ v: 1, players });

describe("actionBindings", () => {
  it("maps 0.x keys through KEY_TO_CODE, one key to every code it names", () => {
    expect(actionBindings({ action: "dash", keys: ["Shift", " ", "1"] })).toEqual([
      key("ShiftLeft"),
      key("ShiftRight"),
      key("Space"),
      key("Digit1"),
      key("Numpad1"),
    ]);
  });

  it("prefers bindings over keys, and binds nothing for a key the table doesn't know", () => {
    expect(actionBindings({ action: "a", bindings: [key("KeyQ")], keys: ["w"] })).toEqual([
      key("KeyQ"),
    ]);
    expect(actionBindings({ action: "a", keys: ["Spacebar"] })).toEqual([]);
  });
});

describe("resolveBindings", () => {
  it("uses the game's actions when no other layer names one", () => {
    const r = resolveBindings({ game: GAME });
    expect(r.actions).toEqual(["jump", "dash", "move"]);
    expect(r.bindings()).toEqual({
      jump: [key("Space"), key("KeyW")],
      dash: [key("ShiftLeft"), key("ShiftRight")],
      move: GAME[2]!.bindings,
    });
    expect(r.source("jump")).toBe("game");
    expect(r.kindOf("move")).toBe("vector");
    expect(r.tables.keys.get("Space")).toEqual([
      { action: "jump", kind: "button", player: 0, fixed: false, binding: key("Space") },
    ]);
    expect(r.tables.keys.get("ShiftRight")?.map((t) => t.action)).toEqual(["dash"]);
  });

  it("takes each action from the first layer that names it: remap, host, map, game", () => {
    const r = resolveBindings({
      game: GAME,
      map: map([
        { action: "jump", bindings: [key("KeyJ")] },
        { action: "dash", bindings: [key("KeyK")] },
        { action: "move", bindings: [{ device: "pad", stick: "left" }] },
      ]),
      host: [
        { action: "jump", bindings: [key("KeyH")] },
        { action: "dash", keys: ["l"] },
      ],
      remap: remap({ 0: { jump: [key("KeyR")] } }),
    });
    expect(r.bindings()).toEqual({
      jump: [key("KeyR")],
      dash: [key("KeyL")],
      move: [{ device: "pad", stick: "left" }],
    });
    expect(["jump", "dash", "move"].map((a) => r.source(a))).toEqual(["remap", "host", "map"]);
  });

  it("replaces an action's bindings whole, never merging layers", () => {
    const r = resolveBindings({
      game: GAME,
      map: map([{ action: "jump", bindings: [{ device: "pad", button: "south" }] }]),
    });
    expect(r.bindings().jump).toEqual([{ device: "pad", button: "south" }]);
    expect(r.tables.keys.has("Space")).toBe(false);
    expect(r.tables.keys.has("KeyW")).toBe(false);
    expect(r.tables.padButtons.get("south")?.map((t) => t.action)).toEqual(["jump"]);
    // An action a layer names with no bindings is unbound, not the game's.
    const cleared = resolveBindings({ game: GAME, remap: remap({ 0: { dash: [] } }) });
    expect(cleared.bindings().dash).toEqual([]);
    expect(cleared.tables.keys.has("ShiftLeft")).toBe(false);
  });

  it("resolves each seat on its own: a remap of seat 1 leaves seat 0 on the shared layers", () => {
    const r = resolveBindings({
      game: GAME,
      players: 2,
      map: map([{ action: "jump", bindings: [key("KeyJ")] }]),
      remap: remap({ 1: { jump: [{ device: "pad", button: "east" }] } }),
    });
    expect(r.bindings(0).jump).toEqual([key("KeyJ")]);
    expect(r.bindings(1).jump).toEqual([{ device: "pad", button: "east" }]);
    expect([r.source("jump", 0), r.source("jump", 1)]).toEqual(["map", "remap"]);
    expect(r.tables.keys.get("KeyJ")?.map((t) => t.player)).toEqual([0]);
    expect(r.tables.padButtons.get("east")?.map((t) => t.player)).toEqual([1]);
    // Shared bindings with no seat drive whichever seat owns the device.
    expect(r.tables.keys.get("ShiftLeft")?.map((t) => [t.player, t.fixed])).toEqual([
      [0, false],
      [1, false],
    ]);
  });

  it("gives a key binding naming its seat to that seat alone, fixed", () => {
    const r = resolveBindings({
      game: [
        {
          action: "jump",
          description: "Jump.",
          bindings: [key("KeyW", { player: 0 }), key("ArrowUp", { player: 1 })],
        },
      ],
      players: 2,
    });
    expect(r.tables.keys.get("KeyW")).toEqual([
      {
        action: "jump",
        kind: "button",
        player: 0,
        fixed: true,
        binding: key("KeyW", { player: 0 }),
      },
    ]);
    expect(r.tables.keys.get("ArrowUp")?.map((t) => [t.player, t.fixed])).toEqual([[1, true]]);
    expect(r.bindings(0).jump).toEqual([key("KeyW", { player: 0 })]);
    expect(r.bindings(1).jump).toEqual([key("ArrowUp", { player: 1 })]);
  });

  it("indexes every device and keeps actions only another layer names, as buttons", () => {
    const r = resolveBindings({
      game: [
        { action: "fire", description: "Fire.", keys: [] },
        { action: "aim", kind: "vector", description: "Aim.", keys: [] },
        { action: "throttle", kind: "axis", description: "Throttle.", keys: [] },
      ],
      map: map([
        {
          action: "fire",
          bindings: [
            { device: "pointer", button: "primary" },
            { device: "touch", control: "fire" },
          ],
        },
        { action: "aim", bindings: [{ device: "pad", stick: "right" }] },
        { action: "throttle", bindings: [{ device: "pad", axis: "rt" }] },
      ]),
      host: [{ action: "pause", bindings: [key("Escape")] }],
    });
    expect(r.actions).toEqual(["fire", "aim", "throttle", "pause"]);
    expect(r.kindOf("pause")).toBe("button");
    expect(r.tables.pointer.get("primary")?.[0]?.action).toBe("fire");
    expect(r.tables.touch.get("fire")?.[0]?.action).toBe("fire");
    expect(r.tables.padSticks.get("right")?.[0]).toMatchObject({ action: "aim", kind: "vector" });
    expect(r.tables.padAxes.get("rt")?.[0]).toMatchObject({ action: "throttle", kind: "axis" });
    expect(r.tables.keys.get("Escape")?.[0]?.action).toBe("pause");
    expect(r.source("nothing")).toBeNull();
  });
});

describe("seatTables", () => {
  const r = resolveBindings({
    game: [
      {
        action: "jump",
        description: "Jump.",
        bindings: [
          key("Space"),
          key("ArrowUp", { player: 1 }),
          { device: "pad", button: "south" },
          { device: "pointer", button: "primary" },
        ],
      },
    ],
    players: 2,
  });

  it("keeps the owner's bindings and every seat-named one, all fixed", () => {
    const t = seatTables(r.tables, { keyboard: 1, pointer: 0 });
    expect(t.keys.get("Space")?.map((b) => [b.player, b.fixed])).toEqual([[1, true]]);
    expect(t.keys.get("ArrowUp")?.map((b) => [b.player, b.fixed])).toEqual([[1, true]]);
    expect(t.pointer.get("primary")?.map((b) => [b.player, b.fixed])).toEqual([[0, true]]);
    expect(t.padButtons.size).toBe(0);
  });

  it("an unowned device keeps only the seat-named bindings", () => {
    const t = seatTables(r.tables, { keyboard: null, pad: null });
    expect([...t.keys.keys()]).toEqual(["ArrowUp"]);
    expect(t.padButtons.size).toBe(0);
  });

  it("names a device's class", () => {
    expect(["keyboard", "pointer", "touch", "pad:3"].map((d) => deviceClass(d as never))).toEqual([
      "keyboard",
      "pointer",
      "touch",
      "pad",
    ]);
  });
});

describe("resolveBindings: the project's input map", () => {
  const inputMap: InputMapFile = {
    kind: "input-map",
    v: 1,
    players: { max: 1, join: "auto" },
    deadzone: 0.15,
    actions: [
      {
        action: "move",
        kind: "vector",
        bindings: [
          key("KeyW", { axis: "y", value: -1 }),
          key("KeyS", { axis: "y", value: 1 }),
          { device: "pad", stick: "left" },
        ],
      },
      { action: "jump", bindings: [{ device: "pad", button: "south" }, key("KeyK")] },
    ],
  };

  it("beats the game's bindings, replacing an action's whole, and leaves the actions it omits", () => {
    const r = resolveBindings({ game: GAME, map: inputMap });
    expect(r.source("move")).toBe("map");
    expect(r.bindings().move).toEqual(inputMap.actions![0]!.bindings);
    // The game's A and D are gone, not merged in.
    expect(r.tables.keys.has("KeyA")).toBe(false);
    expect(r.tables.keys.get("KeyW")?.map((t) => [t.action, t.kind])).toEqual([["move", "vector"]]);
    expect(r.bindings().jump).toEqual([{ device: "pad", button: "south" }, key("KeyK")]);
    expect(r.tables.keys.has("Space")).toBe(false);
    expect(r.source("dash")).toBe("game");
    expect(r.bindings().dash).toEqual([key("ShiftLeft"), key("ShiftRight")]);
  });

  it("loses to the host's bindings and to the player's remap", () => {
    const r = resolveBindings({
      game: GAME,
      map: inputMap,
      host: [{ action: "jump", bindings: [key("KeyH")] }],
      remap: remap({ 0: { move: [{ device: "pad", stick: "right" }] } }),
    });
    expect(r.source("jump")).toBe("host");
    expect(r.bindings().jump).toEqual([key("KeyH")]);
    expect(r.tables.padButtons.has("south")).toBe(false);
    expect(r.source("move")).toBe("remap");
    expect(r.tables.keys.has("KeyW")).toBe(false);
    expect(r.tables.padSticks.get("right")?.[0]?.action).toBe("move");
  });

  it("keeps the game's kind for an action the map rebinds", () => {
    const r = resolveBindings({
      game: GAME,
      map: { actions: [{ action: "move", bindings: [key("KeyW", { axis: "y", value: -1 })] }] },
    });
    expect(r.kindOf("move")).toBe("vector");
  });

  it("an empty or absent map changes nothing", () => {
    const plain = resolveBindings({ game: GAME }).bindings();
    expect(resolveBindings({ game: GAME, map: null }).bindings()).toEqual(plain);
    const empty: InputMapFile = { kind: "input-map", v: 1 };
    expect(resolveBindings({ game: GAME, map: empty }).bindings()).toEqual(plain);
  });
});

describe("combineAction", () => {
  const held = (binding: Binding, reading: number | { x: number; y: number } = 1) => ({
    binding,
    reading,
  });
  const W = key("KeyW", { axis: "y", value: -1 });
  const A = key("KeyA", { axis: "x", value: -1 });
  const S = key("KeyS", { axis: "y", value: 1 });
  const D = key("KeyD", { axis: "x", value: 1 });

  it("ORs a button's bindings", () => {
    expect(combineAction("button", [])).toEqual({ pressed: false });
    expect(combineAction("button", [held(key("Space"), 0), held(key("KeyW"))])).toEqual({
      pressed: true,
    });
    expect(
      combineAction("button", [held({ device: "touch", control: "b" }, { x: 0, y: 0 })]),
    ).toEqual({ pressed: false });
  });

  it("sums WASD into a vector and clamps a diagonal to the unit disc", () => {
    expect(combineAction("vector", [])).toEqual({ pressed: false, x: 0, y: 0 });
    expect(combineAction("vector", [held(W)])).toEqual({ pressed: true, x: 0, y: -1 });
    const diagonal = combineAction("vector", [held(W), held(D)]);
    expect(diagonal).toEqual({ pressed: true, x: 0.707, y: -0.707 });
    expect(diagonal.x! ** 2 + diagonal.y! ** 2).toBeLessThanOrEqual(1);
    expect(combineAction("vector", [held(W), held(S)])).toEqual({ pressed: false, x: 0, y: 0 });
    expect(combineAction("vector", [held(W), held(S), held(A)])).toEqual({
      pressed: true,
      x: -1,
      y: 0,
    });
    // A key's value scales its contribution.
    expect(combineAction("vector", [held(key("KeyD", { axis: "x", value: 0.5 }))])).toEqual({
      pressed: true,
      x: 0.5,
      y: 0,
    });
  });

  it("takes the largest-magnitude stick, adds the keys and clamps", () => {
    const left = { device: "pad", stick: "left" } as const;
    const right = { device: "pad", stick: "right" } as const;
    expect(
      combineAction("vector", [held(left, { x: 0.2, y: 0 }), held(right, { x: 0, y: -0.6 })]),
    ).toEqual({ pressed: true, x: 0, y: -0.6 });
    expect(combineAction("vector", [held(left, { x: 0.3, y: 0 }), held(W)])).toEqual({
      pressed: true,
      x: 0.287,
      y: -0.957,
    });
    expect(combineAction("vector", [held(left, { x: 0.12345, y: 0 })])).toEqual({
      pressed: true,
      x: 0.123,
      y: 0,
    });
  });

  it("makes an axis from two keys, the larger magnitude winning and a tie cancelling", () => {
    const left = key("ArrowLeft", { value: -1 });
    const right = key("ArrowRight");
    expect(combineAction("axis", [])).toEqual({ pressed: false, value: 0 });
    expect(combineAction("axis", [held(left)])).toEqual({ pressed: true, value: -1 });
    expect(combineAction("axis", [held(right)])).toEqual({ pressed: true, value: 1 });
    expect(combineAction("axis", [held(left), held(right)])).toEqual({ pressed: false, value: 0 });
    const walk = key("ArrowRight", { value: 0.5 });
    expect(combineAction("axis", [held(walk), held(left)])).toEqual({ pressed: true, value: -1 });
    expect(combineAction("axis", [held(walk), held(key("KeyD", { value: 0.5 }))])).toEqual({
      pressed: true,
      value: 0.5,
    });
  });

  it("scales a pad axis, quantises it and clamps it to −1…1", () => {
    const trigger = { device: "pad", axis: "rt" } as const;
    const inverted = { device: "pad", axis: "left-y", scale: -1 } as const;
    expect(combineAction("axis", [held(trigger, 0.33333)])).toEqual({
      pressed: true,
      value: 0.333,
    });
    expect(combineAction("axis", [held(inverted, 0.4)])).toEqual({ pressed: true, value: -0.4 });
    expect(combineAction("axis", [held(trigger, 0.25), held(inverted, 0.4)])).toEqual({
      pressed: true,
      value: -0.4,
    });
    expect(combineAction("axis", [held({ device: "pad", axis: "rt", scale: 3 }, 0.5)])).toEqual({
      pressed: true,
      value: 1,
    });
    expect(combineAction("axis", [held(trigger, 0.0004)])).toEqual({ pressed: false, value: 0 });
  });

  it("tells a changed state from an unchanged one", () => {
    expect(actionValueChanged({ pressed: true, value: 0.5 }, { pressed: true, value: 0.5 })).toBe(
      false,
    );
    expect(actionValueChanged({ pressed: true, value: 0.5 }, { pressed: true, value: 0.6 })).toBe(
      true,
    );
    expect(
      actionValueChanged({ pressed: true, x: 1, y: 0 }, { pressed: true, x: 1, y: 0.001 }),
    ).toBe(true);
  });
});
