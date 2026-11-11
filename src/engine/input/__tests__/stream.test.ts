import { describe, expect, it } from "vite-plus/test";

import type { DeviceId, GameCommand } from "../../game/types";
import type { RecordingStream } from "../../scene/recording-schema";
import type { InputAction } from "../../types";
import { q, qPointer, qVector } from "../quantize";
import type { PointerState } from "../state";
import { decodeStreams, encodeTick, mergeTick, type StreamTables, type TickInput } from "../stream";

const tables: StreamTables = {
  actions: ["jump", "steer", "move"],
  commands: ["move-unit", "end-turn"],
};
const tickMs = 1000 / 60;

const tick = (n: number, parts: Partial<TickInput> = {}): TickInput => ({
  tick: n,
  actions: [],
  commands: [],
  pointers: [],
  joins: [],
  ...parts,
});

const stamp = (n: number, offset?: number) => ({
  tick: n,
  timestamp: (n + (offset ?? 0)) * tickMs,
  ...(offset === undefined ? {} : { offset }),
});

/** Decodes one encoded tick back, as a recording of just that tick. */
function roundTrip(input: TickInput, subTick = false): TickInput | undefined {
  const { seats, system } = encodeTick(input, tables, { subTick });
  const decoded = decodeStreams(
    { actions: [...tables.actions], commands: [...tables.commands], inputs: seats, system },
    { tickMs, subTick },
  );
  return decoded.get(input.tick);
}

describe("encodeTick", () => {
  it("writes every seat event kind by table index, analog × 1000 and pointer × 10,000", () => {
    const { seats, system } = encodeTick(
      tick(7, {
        actions: [
          { action: "jump", pressed: true, ...stamp(7) },
          { action: "steer", pressed: true, value: -0.25, ...stamp(7) },
          { action: "move", pressed: true, x: 0.707, y: -0.707, ...stamp(7) },
          { action: "jump", pressed: false, player: 1, ...stamp(7) },
        ],
        pointers: [{ x: 4.125, y: 2.2, buttons: 1, over: true }],
        commands: [
          { name: "move-unit", args: { unit: "u1", to: [3, 4] } },
          { name: "end-turn", player: 1 },
        ],
      }),
      tables,
    );
    expect(system).toEqual([]);
    expect(seats).toEqual([
      [
        [7, "b", 0, 1],
        [7, "a", 1, -250],
        [7, "v", 2, 707, -707],
        [7, "p", 41250, 22000, 1, 1],
        [7, "c", 0, { unit: "u1", to: [3, 4] }],
      ],
      [
        [7, "b", 0, 0],
        [7, "c", 1],
      ],
    ]);
  });

  it("puts seat changes and @elapsed on the system stream, changes first", () => {
    const { seats, system } = encodeTick(
      tick(900, {
        commands: [{ name: "@elapsed", args: { ms: 3_600_000 } }],
        joins: [
          { player: 1, device: "pad:0", joined: true },
          { player: 2, device: "keyboard", joined: false },
        ],
      }),
      tables,
    );
    expect(seats).toEqual([]);
    expect(system).toEqual([
      [900, "j", 1, "pad:0"],
      [900, "l", 2, "keyboard"],
      [900, "w", 3_600_000],
    ]);
  });

  it("writes sub-tick offsets in thousandths only when asked", () => {
    const input = tick(120, { actions: [{ action: "jump", pressed: true, ...stamp(120, 0.375) }] });
    expect(encodeTick(input, tables).seats).toEqual([[[120, "b", 0, 1]]]);
    expect(encodeTick(input, tables, { subTick: true }).seats).toEqual([[[120.375, "b", 0, 1]]]);
    const late = tick(3, { actions: [{ action: "jump", pressed: true, ...stamp(3, 0.9999) }] });
    expect(encodeTick(late, tables, { subTick: true }).seats).toEqual([[[3.999, "b", 0, 1]]]);
  });

  it("leaves seats without events empty up to the highest one used", () => {
    const { seats } = encodeTick(
      tick(1, { actions: [{ action: "jump", pressed: true, player: 2, ...stamp(1) }] }),
      tables,
    );
    expect(seats).toEqual([[], [], [[1, "b", 0, 1]]]);
  });

  it("copies command args, so later changes don't reach the stream", () => {
    const args = { unit: "u1" };
    const { seats } = encodeTick(tick(0, { commands: [{ name: "move-unit", args }] }), tables);
    args.unit = "u2";
    expect(seats[0]?.[0]).toEqual([0, "c", 0, { unit: "u1" }]);
  });

  it("throws on a name the tables don't hold and on a malformed @elapsed", () => {
    expect(() =>
      encodeTick(tick(0, { actions: [{ action: "dash", pressed: true, ...stamp(0) }] }), tables),
    ).toThrow(/action "dash"/);
    expect(() => encodeTick(tick(0, { commands: [{ name: "undo" }] }), tables)).toThrow(
      /command "undo"/,
    );
    expect(() => encodeTick(tick(0, { commands: [{ name: "@elapsed" }] }), tables)).toThrow(
      /@elapsed/,
    );
  });
});

describe("decodeStreams", () => {
  const rec: RecordingStream = {
    actions: ["move", "fire"],
    commands: ["move-unit", "end-turn"],
    inputs: [
      [
        [0, "b", 1, 1],
        [3, "v", 0, 707, -707],
        [10, "p", 41250, 22000, 1, 1],
        [12, "c", 0, { unit: "u1", to: [3, 4] }],
        [12, "a", 0, -500],
      ],
      [
        [5, "b", 1, 1],
        [12, "c", 1],
        [12, "p", 10000, -5, 0, 0],
      ],
    ],
    system: [
      [0, "j", 1, "pad:0"],
      [12, "w", 250],
      [12, "l", 1, "pad:0"],
    ],
  };

  it("decodes every event kind into one TickInput per tick, in tick order", () => {
    const decoded = decodeStreams(rec, { tickMs });
    expect([...decoded.keys()]).toEqual([0, 3, 5, 10, 12]);
    expect(decoded.get(0)).toEqual(
      tick(0, {
        actions: [{ action: "fire", pressed: true, ...stamp(0) }],
        joins: [{ player: 1, device: "pad:0", joined: true }],
      }),
    );
    expect(decoded.get(3)?.actions).toEqual([
      { action: "move", pressed: true, x: 0.707, y: -0.707, ...stamp(3) },
    ]);
    expect(decoded.get(5)?.actions).toEqual([
      { action: "fire", pressed: true, player: 1, ...stamp(5) },
    ]);
    expect(decoded.get(10)?.pointers).toEqual([{ x: 4.125, y: 2.2, buttons: 1, over: true }]);
  });

  it("merges a tick system first, then seats in order, each in stream order", () => {
    const merged = decodeStreams(rec, { tickMs }).get(12);
    expect(merged).toEqual(
      tick(12, {
        actions: [{ action: "move", pressed: true, value: -0.5, ...stamp(12) }],
        commands: [
          { name: "@elapsed", args: { ms: 250 } },
          { name: "move-unit", args: { unit: "u1", to: [3, 4] } },
          { name: "end-turn", player: 1 },
        ],
        pointers: [undefined, { x: 1, y: -0.0005, buttons: 0, over: false }],
        joins: [{ player: 1, device: "pad:0", joined: false }],
      }),
    );
  });

  it("stamps on the engine's clock by default and reads sub-tick fractions", () => {
    const decoded = decodeStreams({
      actions: ["jump"],
      commands: [],
      inputs: [
        [
          [120.375, "b", 0, 1],
          [121, "b", 0, 0],
        ],
      ],
      system: [],
    });
    expect(decoded.get(120)?.actions).toEqual([
      { action: "jump", pressed: true, tick: 120, timestamp: 120.375 * tickMs, offset: 0.375 },
    ]);
    expect(decoded.get(121)?.actions[0]).not.toHaveProperty("offset");
    const sub = decodeStreams(
      { actions: ["jump"], commands: [], inputs: [[[121, "b", 0, 0]]], system: [] },
      { subTick: true },
    );
    expect(sub.get(121)?.actions[0]?.offset).toBe(0);
  });

  it("hands out copies of command args", () => {
    const first = decodeStreams(rec).get(12)?.commands[1]?.args as { unit: string };
    first.unit = "changed";
    expect(decodeStreams(rec).get(12)?.commands[1]?.args).toEqual({ unit: "u1", to: [3, 4] });
  });

  it("throws on an index past a table, an unknown kind or a bad tick, naming the event", () => {
    const bad =
      (inputs: unknown[][], system: unknown[] = []) =>
      () =>
        decodeStreams({ ...rec, inputs, system } as RecordingStream);
    expect(bad([[[0, "b", 9, 1]]])).toThrow(/inputs\[0\]\[0\].*action 9/);
    expect(bad([[], [[0, "c", 5]]])).toThrow(/inputs\[1\]\[0\].*command 5/);
    expect(bad([[[0, "x", 0]]])).toThrow(/unknown kind "x"/);
    expect(bad([[[-1, "b", 0, 1]]])).toThrow(/tick -1/);
    expect(bad([], [[0, "q", 1]])).toThrow(/system\[0\].*unknown kind/);
  });
});

describe("mergeTick", () => {
  it("is the order decoding gives a live tick", () => {
    const live = tick(4, {
      actions: [
        { action: "jump", pressed: true, player: 1, ...stamp(4) },
        { action: "steer", pressed: true, value: 0.5, ...stamp(4) },
        { action: "jump", pressed: false, player: 1, ...stamp(4) },
      ],
      commands: [
        { name: "end-turn", player: 1 },
        { name: "move-unit" },
        { name: "@elapsed", args: { ms: 16 } },
      ],
    });
    const merged = mergeTick(live);
    expect(merged.actions.map((a) => a.player ?? 0)).toEqual([0, 1, 1]);
    expect(merged.actions[1]?.pressed).toBe(true);
    expect(merged.commands.map((c) => c.name)).toEqual(["@elapsed", "move-unit", "end-turn"]);
    expect(roundTrip(live)).toEqual(merged);
  });
});

/** A small seeded generator, so a failure names a reproducible case. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("a random stream", () => {
  it("round-trips through encodeTick and decodeStreams, tick for tick", { timeout: 30_000 }, () => {
    for (const subTick of [false, true]) {
      const r = rng(subTick ? 2 : 1);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
      const int = (n: number) => Math.floor(r() * n);
      const devices: DeviceId[] = ["keyboard", "pointer", "touch", "pad:0", "pad:3"];
      const expected = new Map<number, TickInput>();
      const inputs: RecordingStream["inputs"] = [];
      const system: RecordingStream["system"] = [];
      let n = 0;
      for (let i = 0; i < 2000; i++) {
        n += int(3);
        if (expected.has(n)) n += 1;
        const actions: InputAction[] = [];
        const commands: GameCommand[] = [];
        const pointers: (PointerState | undefined)[] = [];
        const joins: TickInput["joins"] = [];
        const seats = 1 + int(4);
        if (r() < 0.1) commands.push({ name: "@elapsed", args: { ms: int(100_000) } });
        for (let p = 0; p < seats; p++) {
          const seat = p === 0 ? {} : { player: p };
          for (let k = int(3); k > 0; k--) {
            const offset = subTick ? int(1000) / 1000 : undefined;
            const at = stamp(n, offset);
            const kind = int(3);
            if (kind === 0) {
              actions.push({ action: pick(tables.actions), pressed: r() < 0.5, ...seat, ...at });
            } else if (kind === 1) {
              const value = q(r() * 2 - 1);
              actions.push({ action: "steer", pressed: value !== 0, value, ...seat, ...at });
            } else {
              const v = qVector({ x: r() * 2 - 1, y: r() * 2 - 1 });
              actions.push({
                action: "move",
                pressed: v.x !== 0 || v.y !== 0,
                x: v.x,
                y: v.y,
                ...seat,
                ...at,
              });
            }
          }
          if (r() < 0.3) {
            while (pointers.length < p) pointers.push(undefined);
            pointers[p] = {
              x: qPointer((r() - 0.5) * 200),
              y: qPointer((r() - 0.5) * 200),
              buttons: int(8),
              over: r() < 0.8,
            };
          }
          for (let k = int(2); k > 0; k--) {
            commands.push(
              r() < 0.5
                ? { name: pick(tables.commands), ...seat }
                : {
                    name: pick(tables.commands),
                    args: { n: int(10), to: [int(5), int(5)] },
                    ...seat,
                  },
            );
          }
        }
        if (r() < 0.05) joins.push({ player: int(4), device: pick(devices), joined: r() < 0.5 });
        const input = tick(n, { actions, commands, pointers, joins });
        const empty =
          actions.length + commands.length + joins.length === 0 && pointers.every((p) => !p);
        const encoded = encodeTick(input, tables, { subTick });
        encoded.seats.forEach((events, p) => {
          while (inputs.length <= p) inputs.push([]);
          inputs[p]?.push(...events);
        });
        system.push(...encoded.system);
        if (!empty) expected.set(n, input);
      }
      const decoded = decodeStreams(
        { actions: [...tables.actions], commands: [...tables.commands], inputs, system },
        { tickMs, subTick },
      );
      expect([...decoded.keys()]).toEqual([...expected.keys()]);
      for (const [t, input] of expected) expect(decoded.get(t)).toEqual(input);
    }
  });
});
