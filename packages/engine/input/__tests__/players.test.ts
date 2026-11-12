// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../../game/define";
import { bindingProblems, SEAT_LIMIT } from "../../game/input-bindings";
import type { ActionDef, Binding, PlayersDef } from "../../game/types";
import type { InputAction } from "../../types";
import { resolveBindings, seatTables } from "../bindings";
import {
  createSeatBook,
  createSeats,
  DEFAULT_PLAYERS,
  MAX_PLAYERS,
  resolvePlayers,
  seatProblem,
} from "../players";
import { createInputState } from "../state";
import type { SeatChange, TickInput } from "../stream";
import { createInputSystem } from "../system";

const key = (code: string, extra: Partial<Extract<Binding, { device: "key" }>> = {}): Binding => ({
  device: "key",
  code,
  ...extra,
});

const tick = (n: number, joins: SeatChange[] = [], actions: InputAction[] = []): TickInput => ({
  tick: n,
  actions,
  commands: [],
  pointers: [],
  joins,
});

const seated = (seats: { players: () => readonly { devices: readonly string[] }[] }) =>
  seats.players().map((p) => p.devices);

describe("resolvePlayers", () => {
  const game = defineGame({
    id: "duo",
    types: [],
    actions: [],
    input: { players: { max: 2, join: "press" } },
    createRuntime: () => ({ snapshot: () => null }),
  });

  it("takes the input map's, else the game's, else one seat", () => {
    expect(resolvePlayers({ players: { max: 4, join: "host" } }, game)).toEqual({
      max: 4,
      join: "host",
    });
    expect(resolvePlayers({}, game)).toEqual({ max: 2, join: "press" });
    expect(resolvePlayers(null, null)).toEqual(DEFAULT_PLAYERS);
  });
});

describe("createSeats: auto", () => {
  it("gives seat 0 the keyboard, pointer and touch, and pads the free seats in connection order", () => {
    const seats = createSeats({ max: 3, join: "auto" });
    expect(seated(seats)).toEqual([["keyboard", "pointer", "touch"], [], []]);
    seats.connect("pad:1");
    seats.connect("pad:0");
    seats.connect("pad:2");
    expect(seats.seatOf("pad:1")).toBe(1);
    expect(seats.seatOf("pad:0")).toBe(2);
    expect(seats.seatOf("pad:2")).toBeNull();
    expect(seats.drain()).toEqual([
      { player: 1, device: "pad:1", joined: true },
      { player: 2, device: "pad:0", joined: true },
    ]);
    expect(seats.drain()).toEqual([]);
  });

  it("with one seat, every device drives seat 0", () => {
    const seats = createSeats();
    seats.connect("pad:0");
    seats.connect("pad:1");
    for (const device of ["keyboard", "pointer", "touch", "pad:0", "pad:1"] as const)
      expect(seats.seatOf(device)).toBe(0);
    expect(seats.press("pad:1")).toBe(0);
  });

  it("a disconnect frees the seat, and the longest-waiting pad takes it", () => {
    const seats = createSeats({ max: 2, join: "auto" });
    seats.connect("pad:0");
    seats.connect("pad:1");
    seats.drain();
    seats.disconnect("pad:0");
    expect(seats.seatOf("pad:0")).toBeNull();
    expect(seats.seatOf("pad:1")).toBe(1);
    expect(seats.drain()).toEqual([
      { player: 1, device: "pad:0", joined: false },
      { player: 1, device: "pad:1", joined: true },
    ]);
    seats.disconnect("pad:1");
    expect(seats.players()[1]).toEqual({ index: 1, devices: [], joined: false });
  });

  it("a first press takes no seat", () => {
    const seats = createSeats({ max: 2, join: "auto" });
    expect(seats.press("keyboard")).toBe(0);
    expect(seats.drain()).toEqual([]);
  });
});

describe("createSeats: press", () => {
  it("a device's first press takes the lowest free seat", () => {
    const seats = createSeats({ max: 2, join: "press" });
    expect(seats.players().every((p) => !p.joined)).toBe(true);
    seats.connect("pad:0");
    expect(seats.seatOf("pad:0")).toBeNull();
    expect(seats.press("keyboard")).toBe(0);
    expect(seats.press("keyboard")).toBe(0);
    expect(seats.press("pad:0")).toBe(1);
    expect(seats.press("pointer")).toBeNull();
    expect(seats.drain()).toEqual([
      { player: 0, device: "keyboard", joined: true },
      { player: 1, device: "pad:0", joined: true },
    ]);
  });

  it("a pad's disconnect frees its seat for the next first press", () => {
    const seats = createSeats({ max: 2, join: "press" });
    seats.press("keyboard");
    seats.connect("pad:0");
    seats.press("pad:0");
    seats.disconnect("pad:0");
    expect(seats.players()[1]?.joined).toBe(false);
    seats.connect("pad:3");
    expect(seats.press("pad:3")).toBe(1);
  });
});

describe("createSeats: host", () => {
  it("seats only what the host assigns", () => {
    const seats = createSeats({ max: 2, join: "host" });
    seats.connect("pad:0");
    expect(seats.press("pad:0")).toBeNull();
    expect(seats.press("keyboard")).toBeNull();
    expect(seats.assign("pad:0", 1)).toBeNull();
    expect(seats.assign("keyboard", 0)).toBeNull();
    expect(seated(seats)).toEqual([["keyboard"], ["pad:0"]]);
    expect(seats.assign("keyboard", 1)).toBeNull();
    expect(seats.assign("pad:0", null)).toBeNull();
    expect(seated(seats)).toEqual([[], ["keyboard"]]);
    expect(seats.drain()).toEqual([
      { player: 1, device: "pad:0", joined: true },
      { player: 0, device: "keyboard", joined: true },
      { player: 0, device: "keyboard", joined: false },
      { player: 1, device: "keyboard", joined: true },
      { player: 1, device: "pad:0", joined: false },
    ]);
  });

  it("an assigned pad stays where the host put it under auto", () => {
    const seats = createSeats({ max: 3, join: "auto" });
    seats.connect("pad:0");
    seats.assign("pad:0", null);
    expect(seats.seatOf("pad:0")).toBeNull();
    seats.connect("pad:1");
    expect(seats.seatOf("pad:1")).toBe(1);
  });

  it("refuses a seat past max with player-unknown, changing nothing", () => {
    const seats = createSeats({ max: 2, join: "host" });
    const problem = seats.assign("pad:0", 2);
    expect(problem?.code).toBe("player-unknown");
    expect(problem?.message).toContain("past the last seat, 1");
    expect(seats.assign("pad:0", -1)?.code).toBe("player-unknown");
    expect(seats.drain()).toEqual([]);
  });
});

describe("the seat limit", () => {
  it("is the one input maps are judged against", () => {
    expect(MAX_PLAYERS).toBe(SEAT_LIMIT);
    expect(createSeatBook({ max: 99, join: "host" }).max).toBe(SEAT_LIMIT);
    expect(seatProblem(SEAT_LIMIT - 1, SEAT_LIMIT)).toBeNull();
  });
});

describe("player-unknown", () => {
  it("one rule for a key binding's seat and a named seat", () => {
    expect(seatProblem(1, 2)).toBeNull();
    expect(seatProblem(2, 2)?.code).toBe("player-unknown");
    expect(seatProblem(0.5, 2)?.code).toBe("player-unknown");
    const [binding] = bindingProblems(key("ArrowUp", { player: 2 }), { kind: "button", max: 2 });
    expect(seatProblem(2, 2)?.message).toBe(binding?.message);
  });
});

describe("createSeatBook", () => {
  it("ignores a seat that doesn't exist and changes already in place", () => {
    const book = createSeatBook({ max: 2, join: "host" });
    expect(book.apply({ player: 2, device: "pad:0", joined: true })).toEqual([]);
    expect(book.apply({ player: 0, device: "pad:0", joined: false })).toEqual([]);
    expect(book.apply({ player: 0, device: "pad:0", joined: true })).toHaveLength(1);
    expect(book.apply({ player: 0, device: "pad:0", joined: true })).toEqual([]);
  });

  it("caps the seats at 8", () => {
    expect(createSeatBook({ max: 20, join: "auto" }).max).toBe(8);
  });
});

describe("the state follows the seats", () => {
  const game = defineGame({
    id: "seats",
    types: [],
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  });
  const registry = createRegistry(game);

  it("rebuilds the live seats from the recorded changes", () => {
    const def: PlayersDef = { max: 3, join: "press" };
    const seats = createSeats(def);
    const state = createInputState(registry, def);
    seats.press("keyboard");
    seats.connect("pad:0");
    seats.press("pad:0");
    const first = state.update(tick(0, seats.drain()));
    expect(first).toEqual([
      { type: "player:joined", player: 0, at: { x: 0, y: 0 }, data: { device: "keyboard" } },
      { type: "player:joined", player: 1, at: { x: 0, y: 0 }, data: { device: "pad:0" } },
    ]);
    seats.disconnect("pad:0");
    expect(state.update(tick(1, seats.drain()))).toEqual([
      { type: "player:left", player: 1, at: { x: 0, y: 0 }, data: { device: "pad:0" } },
    ]);
    expect(state.players()).toEqual(seats.players());
  });
});

describe("two players on one keyboard", () => {
  const actions: ActionDef[] = [
    {
      action: "up",
      bindings: [key("KeyW", { player: 0 }), key("ArrowUp", { player: 1 })],
      description: "Up.",
    },
    {
      action: "fire",
      bindings: [key("Space"), { device: "pad", button: "south" }],
      description: "",
    },
  ];
  const resolved = resolveBindings({ game: actions, players: 2 });

  const press = (system: ReturnType<typeof createInputSystem>, code: string) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    system.attach(host);
    host.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code }));
    const raised = system.poll(0).map((a) => [a.action, a.player ?? 0]);
    system.destroy();
    host.remove();
    return raised;
  };

  it("WASD drives seat 0 and the arrows seat 1, whoever owns the keyboard", () => {
    for (const owner of [0, 1, null]) {
      const system = () => createInputSystem(seatTables(resolved.tables, { keyboard: owner }));
      expect(press(system(), "KeyW")).toEqual([["up", 0]]);
      expect(press(system(), "ArrowUp")).toEqual([["up", 1]]);
    }
  });

  it("an unseated binding follows the keyboard's owner, and nothing without one", () => {
    const system = (keyboard: number | null) =>
      createInputSystem(seatTables(resolved.tables, { keyboard }));
    expect(press(system(1), "Space")).toEqual([["fire", 1]]);
    expect(press(system(0), "Space")).toEqual([["fire", 0]]);
    expect(press(system(null), "Space")).toEqual([]);
  });

  it("a pad's tables drive its own seat and read no keys", () => {
    const tables = seatTables(resolved.tables, { pad: 1 });
    expect(tables.keys.size).toBe(0);
    expect(tables.padButtons.get("south")?.map((b) => [b.player, b.fixed])).toEqual([[1, true]]);
  });
});
