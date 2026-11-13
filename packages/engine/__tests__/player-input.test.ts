import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { BehaviorBlock } from "../game/behaviors";
import { PLAYER_INPUT } from "../game/behaviors/player-input";
import { defineEntityType, defineGame, ENGINE_BEHAVIORS } from "../game/define";
import { pointField } from "../game/fields";
import { inputFor, type PlayerInputSystem } from "../game/input-for";
import type { EngineContext, GameDefinition, SceneSystem } from "../game/types";
import { encodeTick, decodeStreams, type TickInput } from "../input/stream";
import { ENGINE_BEHAVIOR_SYSTEMS } from "../runtime/behaviors/index";
import { createPlayerInputSystem } from "../runtime/behaviors/player-input";
import { createSceneRuntime } from "../runtime/runtime";
import type { RecordingStream } from "../scene/recording-schema";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";
import type { InputAction, RapierModule } from "../types";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const BACKENDS = ["none", "rapier"] as const;
type Backend = (typeof BACKENDS)[number];

/** What one entity read through `inputFor` in one tick's `afterStep`. */
type Read = {
  seat: number | null;
  jump: boolean;
  pressed: boolean;
  move: { x: number; y: number };
};

const IDS = ["p1", "p2", "loose"] as const;

function seatsGame(log: Read[][]): GameDefinition {
  const dot = defineEntityType({
    type: "dot",
    description: "A point with no state of its own.",
    fields: { at: pointField("Where it stands.") },
    system: (): SceneSystem => {
      const live = new Set<string>();
      return {
        spawn: (e) => void live.add(e.id),
        despawn: (id) => void live.delete(id),
        clear: () => live.clear(),
        size: () => live.size,
      };
    },
  });
  return defineGame({
    id: "seats",
    types: [dot],
    actions: [
      { action: "jump", bindings: [{ device: "key", code: "Space" }], description: "Jump." },
      {
        action: "move",
        kind: "vector",
        bindings: [{ device: "pad", stick: "left" }],
        description: "Move.",
      },
    ],
    input: { players: { max: 2, join: "auto" } },
    time: { kind: "fixed", rate: 60 },
    createRuntime: (ctx: EngineContext) => ({
      snapshot: () => null,
      restore: () => {},
      afterStep() {
        log.push(
          IDS.map((id) => {
            const input = inputFor(ctx, id);
            const v = input.vector("move");
            return {
              seat: input.seat,
              jump: input.held("jump"),
              pressed: input.pressed("jump"),
              move: { x: v.x, y: v.y },
            };
          }),
        );
      },
    }),
  });
}

const dot = (id: string, playerInput?: BehaviorBlock): RuntimeEntity => ({
  id,
  type: "dot",
  at: [0, 0],
  ...(playerInput ? { behaviors: { "player-input": playerInput } } : {}),
});

function scene(backend: Backend, entities: RuntimeEntity[]): ExpandedScene {
  return {
    name: "seats",
    bounds: [-100, -100, 100, 100],
    settings: { gravity: [0, 0], physics: backend, grid: null, view: { projection: "orthogonal" } },
    entities,
  };
}

const ENTITIES = (): RuntimeEntity[] => [
  dot("p1", { seat: 0 }),
  dot("p2", { seat: 1 }),
  dot("loose"),
];

function setup(backend: Backend, entities: RuntimeEntity[] = ENTITIES()) {
  const log: Read[][] = [];
  const rt = createSceneRuntime({
    rapier: backend === "rapier" ? rapier : undefined,
    view: null,
    game: seatsGame(log),
  });
  expect(rt.load(scene(backend, entities))).toMatchObject({ ok: true });
  const step = (input: Partial<TickInput> = {}) => {
    const tick = rt.ctx.tick;
    rt.step(rt.ctx.time.tickMs, {
      tick,
      actions: [],
      commands: [],
      pointers: [],
      joins: [],
      ...input,
    });
    return log.at(-1)!;
  };
  return { rt, ctx: rt.ctx, log, step };
}

const button = (action: string, pressed: boolean, tick: number, player = 0): InputAction => ({
  action,
  pressed,
  tick,
  timestamp: tick * (1000 / 60),
  ...(player === 0 ? {} : { player }),
});

const vector = (x: number, y: number, tick: number, player = 0): InputAction => ({
  action: "move",
  pressed: x !== 0 || y !== 0,
  x,
  y,
  tick,
  timestamp: tick * (1000 / 60),
  ...(player === 0 ? {} : { player }),
});

const joinPad = (player: number, joined = true) => ({ player, device: "pad:0" as const, joined });

const NOTHING_HELD = { jump: false, pressed: false, move: { x: 0, y: 0 } };

describe("the player-input behavior", () => {
  it("is an engine behavior with its system mapped", () => {
    expect(ENGINE_BEHAVIORS).toContain(PLAYER_INPUT);
    expect(ENGINE_BEHAVIOR_SYSTEMS["player-input"]).toBe(createPlayerInputSystem);
  });

  for (const backend of BACKENDS) {
    describe(`on physics: ${backend}`, () => {
      it("reads two seats separately in one tick", () => {
        const { step, rt } = setup(backend);
        const [p1, p2, loose] = step({
          joins: [joinPad(1)],
          actions: [button("jump", true, 0), vector(1, 0, 0, 1)],
        });
        expect(p1).toEqual({ seat: 0, jump: true, pressed: true, move: { x: 0, y: 0 } });
        expect(p2).toEqual({ seat: 1, jump: false, pressed: false, move: { x: 1, y: 0 } });
        expect(loose).toEqual({ seat: null, ...NOTHING_HELD });
        expect(rt.stats().behaviors).toEqual({ "player-input": 2 });
        rt.destroy();
      });

      it("reads an unjoined seat as nothing held, though its input arrives", () => {
        const { step, ctx, rt } = setup(backend);
        const [, p2] = step({ actions: [button("jump", true, 0, 1), vector(0, 1, 0, 1)] });
        expect(ctx.input.held("jump", 1)).toBe(true);
        expect(p2).toEqual({ seat: null, ...NOTHING_HELD });
        expect(ctx.behavior<PlayerInputSystem>("player-input")?.seatOf("p2")).toBe(1);
        rt.destroy();
      });

      it("moves an entity to another seat on the tick after a block update", () => {
        const { step, rt } = setup(backend);
        const both = (tick: number) => [button("jump", true, tick), button("jump", false, tick, 1)];
        expect(step({ joins: [joinPad(1)], actions: both(0) })[1]).toMatchObject({
          seat: 1,
          jump: false,
        });
        expect(rt.update([dot("p2", { seat: 0 })])).toEqual({ ok: true });
        expect(step({ actions: both(1) })[1]).toMatchObject({ seat: 0, jump: true });
        rt.destroy();
      });

      it("reads a seat that leaves mid-run as nothing held from then on", () => {
        const { step, rt } = setup(backend);
        step({ joins: [joinPad(1)], actions: [vector(1, 0, 0, 1)] });
        expect(step()[1]).toMatchObject({ seat: 1, move: { x: 1, y: 0 } });
        expect(step({ joins: [joinPad(1, false)] })[1]).toEqual({ seat: null, ...NOTHING_HELD });
        for (let i = 0; i < 5; i++) expect(step()[1]).toEqual({ seat: null, ...NOTHING_HELD });
        rt.destroy();
      });

      it("replays a recorded two-seat input to the same reads", () => {
        const ticks: TickInput[] = [];
        for (let t = 0; t < 120; t++) {
          const actions: InputAction[] = [];
          if (t % 7 === 0) actions.push(button("jump", (t / 7) % 2 === 0, t));
          if (t % 5 === 0) actions.push(vector(((t % 3) - 1) * 0.5, 0.25, t, 1));
          if (t % 11 === 0) actions.push(button("jump", t % 2 === 0, t, 1));
          const joins = t === 3 ? [joinPad(1)] : t === 90 ? [joinPad(1, false)] : [];
          ticks.push({ tick: t, actions, commands: [], pointers: [], joins });
        }
        const live = setup(backend);
        for (const input of ticks) live.step(input);
        live.rt.destroy();

        const rec: RecordingStream = {
          actions: ["jump", "move"],
          commands: [],
          inputs: [],
          system: [],
        };
        for (const input of ticks) {
          const { seats, system } = encodeTick(input, rec);
          seats.forEach((events, seat) => {
            while (rec.inputs.length <= seat) rec.inputs.push([]);
            rec.inputs[seat]!.push(...events);
          });
          rec.system.push(...system);
        }
        const decoded = decodeStreams(rec);
        const replay = setup(backend);
        for (let t = 0; t < ticks.length; t++) replay.step(decoded.get(t) ?? {});
        replay.rt.destroy();

        expect(replay.log).toEqual(live.log);
        expect(live.log.some(([, p2]) => p2!.seat === 1 && p2!.move.x !== 0)).toBe(true);
        expect(live.log.at(-1)![1]!.seat).toBeNull();
      });
    });
  }

  it("hands out one view per entity, kept across calls and dropped on detach", () => {
    const { ctx, step, rt } = setup("none");
    step({ joins: [joinPad(1)] });
    const first = inputFor(ctx, "p2");
    expect(inputFor(ctx, "p2")).toBe(first);
    expect(inputFor(ctx, "loose")).toBe(inputFor(ctx, "nobody"));
    expect(inputFor(ctx, "loose").seat).toBeNull();

    expect(rt.update([dot("p2")])).toEqual({ ok: true });
    expect(first.seat).toBeNull();
    expect(inputFor(ctx, "p2")).toBe(inputFor(ctx, "loose"));
    expect(ctx.behavior<PlayerInputSystem>("player-input")?.seatOf("p2")).toBeNull();

    expect(rt.update([dot("p2", { seat: 1 })])).toEqual({ ok: true });
    expect(inputFor(ctx, "p2")).not.toBe(first);
    expect(inputFor(ctx, "p2").seat).toBe(1);
    rt.destroy();
  });

  it("reads nothing held on a disabled entity", () => {
    const { ctx, step, rt } = setup("none");
    ctx.setEnabled("p1", false);
    expect(step({ actions: [button("jump", true, 0)] })[0]).toEqual({
      seat: null,
      ...NOTHING_HELD,
    });
    ctx.setEnabled("p1", true);
    expect(step()[0]).toMatchObject({ seat: 0, jump: true });
    rt.destroy();
  });
});
