import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { BehaviorBlock } from "../game/behaviors";
import { CHARACTER_SIDE_VIEW } from "../game/behaviors/character-side-view";
import type { CharacterSystem } from "../game/behaviors/character-top-down";
import { createRegistry, defineGame, ENGINE_BEHAVIORS } from "../game/define";
import type { LibraryScene, SceneLibrary } from "../game/flow";
import { formatSaveFile, parseSaveFile } from "../game/save-file";
import { EngineError, type GameDefinition } from "../game/types";
import type { TickInput } from "../input/stream";
import { createCharacterSideViewSystem } from "../runtime/behaviors/character-side-view";
import { ENGINE_BEHAVIOR_SYSTEMS } from "../runtime/behaviors/index";
import { loadListed } from "../runtime/flow";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreSave } from "../runtime/save-state";
import type { SceneRuntimeHandle, StepEvent } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { hashText } from "../scene/hash";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import { validateScene } from "../scene/validate";
import type { InputAction, RapierModule } from "../types";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const BACKENDS = ["none", "rapier"] as const;
type Backend = (typeof BACKENDS)[number];

const game: GameDefinition = defineGame({
  id: "side-chars",
  types: [],
  actions: [
    {
      action: "move",
      kind: "vector",
      bindings: [{ device: "pad", stick: "left" }],
      description: "Move.",
    },
    { action: "jump", bindings: [{ device: "key", code: "Space" }], description: "Jump." },
  ],
  input: { players: { max: 2, join: "auto" } },
  time: { kind: "fixed", rate: 60 },
  createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
});
const registry = createRegistry(game);

const GRAVITY = 20;
const HW = 0.2;
const HH = 0.4;
/** The floor's top. */
const FLOOR = 5;
/** The centre's y standing on the floor. */
const STANDING = FLOOR - HH;
const floor: EntityDef = { id: "floor", type: "solid", shape: ["box", 0, FLOOR + 0.5, 20, 0.5] };

function hero(
  id: string,
  at: [number, number],
  opts: { seat?: number; block?: BehaviorBlock; body?: BehaviorBlock } = {},
): EntityDef {
  return {
    id,
    type: "marker",
    at,
    behaviors: {
      collider: { shape: ["box", 0, 0, HW, HH] },
      "character-side-view": opts.block ?? {},
      ...(opts.seat !== undefined ? { "player-input": { seat: opts.seat } } : {}),
      ...(opts.body ? { body: opts.body } : {}),
    },
  } as EntityDef;
}

/** Standing on the floor at x. */
const standing = (x: number): [number, number] => [x, STANDING - 0.0005];

function sceneDef(entities: EntityDef[], physics: Backend): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: "side-chars",
    name: "side",
    bounds: [-20, -20, 20, 20],
    settings: { physics, gravity: [0, GRAVITY] },
    entities,
  };
}

function load(entities: EntityDef[], physics: Backend): SceneRuntimeHandle {
  const rt = createSceneRuntime({ rapier: physics === "rapier" ? rapier : null, view: null, game });
  const report = rt.load(expandScene(sceneDef(entities, physics), registry));
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const tickMs = 1000 / 60;
const button = (action: string, pressed: boolean, tick: number, player = 0): InputAction => ({
  action,
  pressed,
  tick,
  timestamp: tick * tickMs,
  ...(player === 0 ? {} : { player }),
});
const vector = (x: number, y: number, tick: number, player = 0): InputAction => ({
  action: "move",
  pressed: x !== 0 || y !== 0,
  x,
  y,
  tick,
  timestamp: tick * tickMs,
  ...(player === 0 ? {} : { player }),
});
const joinPad = (player: number, joined = true) => ({ player, device: "pad:0" as const, joined });

/** Steps one tick with `input`, returning its events. */
function step(rt: SceneRuntimeHandle, input: Partial<TickInput> = {}): StepEvent[] {
  return rt.step(rt.ctx.time.tickMs, {
    tick: rt.ctx.tick,
    actions: [],
    commands: [],
    pointers: [],
    joins: [],
    ...input,
  }).events;
}

function steps(rt: SceneRuntimeHandle, n: number, input?: (tick: number) => Partial<TickInput>) {
  const events: StepEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...step(rt, input?.(rt.ctx.tick)));
  return events;
}

const characters = (rt: SceneRuntimeHandle) =>
  rt.ctx.behavior<CharacterSystem>(CHARACTER_SIDE_VIEW.name)!;
const pose = (rt: SceneRuntimeHandle, id: string) => rt.ctx.poses.get(id)!;
const named = (events: StepEvent[], type: string) => events.filter((e) => e.type === type);

describe("character-side-view", () => {
  it("is an engine behavior with its system mapped", () => {
    expect(ENGINE_BEHAVIORS).toContain(CHARACTER_SIDE_VIEW);
    expect(ENGINE_BEHAVIOR_SYSTEMS["character-side-view"]).toBe(createCharacterSideViewSystem);
  });

  for (const backend of BACKENDS) {
    describe(`on physics: ${backend}`, () => {
      it("walks to max speed, jumps its jump height and lands on a solid", () => {
        const rt = load([floor, hero("hero", standing(0), { seat: 0 })], backend);
        const sys = characters(rt);
        expect(sys.grounded("hero")).toBe(true);
        steps(rt, 30, (t) => (t === 0 ? { actions: [vector(1, 0, t)] } : {}));
        expect(sys.velocity("hero").x).toBeCloseTo(6, 5);
        expect(pose(rt, "hero").x).toBeGreaterThan(2);
        expect(pose(rt, "hero").y).toBeCloseTo(STANDING, 2);
        steps(rt, 30, (t) => (t === 30 ? { actions: [vector(0, 0, t)] } : {}));
        expect(sys.velocity("hero").x).toBe(0);

        const startY = pose(rt, "hero").y;
        let top = startY;
        step(rt, { actions: [button("jump", true, rt.ctx.tick)] });
        expect(sys.grounded("hero")).toBe(false);
        for (let i = 0; i < 120 && !sys.grounded("hero"); i++) {
          step(rt);
          top = Math.min(top, pose(rt, "hero").y);
        }
        expect(startY - top).toBeGreaterThan(1.15);
        expect(startY - top).toBeLessThan(1.25);
        expect(sys.grounded("hero")).toBe(true);
        expect(pose(rt, "hero").y).toBeCloseTo(STANDING, 2);
        rt.destroy();
      });

      it("passes up through a one-way solid, lands on it, and drops through holding down", () => {
        const plankTop = 3;
        const plank: EntityDef = {
          id: "plank",
          type: "solid",
          shape: ["box", 0, plankTop + 0.05, 2, 0.05],
          oneWay: true,
        } as EntityDef;
        const rt = load(
          [floor, plank, hero("hero", standing(0), { seat: 0, block: { jumpHeight: 2.6 } })],
          backend,
        );
        const sys = characters(rt);
        const events = steps(rt, 120, (t) =>
          t === 0 ? { actions: [button("jump", true, t)] } : {},
        );
        expect(sys.grounded("hero")).toBe(true);
        expect(pose(rt, "hero").y).toBeCloseTo(plankTop - HH, 3);
        expect(named(events, "character:landed").map((e) => e.other)).toEqual(["plank"]);

        const dropped = steps(rt, 90, (t) => (t === 120 ? { actions: [vector(0, 1, t)] } : {}));
        expect(pose(rt, "hero").y).toBeCloseTo(STANDING, 3);
        expect(named(dropped, "character:landed").map((e) => e.other)).toEqual(["floor"]);
        rt.destroy();
      });

      it("rides a follower without sliding", () => {
        const deck: EntityDef = {
          id: "deck",
          type: "follower",
          shape: ["box", 0, 0, 1.5, 0.1],
          path: {
            pts: [
              [0, 4],
              [3, 2.5],
            ],
            mode: "ping_pong",
            speed: 1.5,
          },
        } as EntityDef;
        const rt = load([deck, hero("hero", [0.3, 4 - 0.1 - HH - 0.0005], { seat: 0 })], backend);
        const offset = () => {
          const h = pose(rt, "hero");
          const d = pose(rt, "deck");
          return { x: h.x - d.x, y: h.y - d.y };
        };
        steps(rt, 2);
        const start = offset();
        let drift = 0;
        for (let i = 0; i < 360; i++) {
          step(rt);
          const now = offset();
          drift = Math.max(drift, Math.abs(now.x - start.x), Math.abs(now.y - start.y));
        }
        expect(pose(rt, "deck").x).not.toBeCloseTo(0, 1);
        expect(drift).toBeLessThan(0.03);
        expect(Math.abs(offset().x - start.x)).toBeLessThan(0.005);
        expect(characters(rt).grounded("hero")).toBe(true);
        rt.destroy();
      });

      it("rides a path-follow platform without sliding", () => {
        const lift: EntityDef = {
          id: "lift",
          type: "marker",
          at: [0, 4],
          behaviors: {
            collider: { shape: ["box", 0, 0, 1.5, 0.1] },
            body: { kind: "kinematic" },
            "path-follow": {
              path: {
                pts: [
                  [0, 4],
                  [3, 4],
                ],
                mode: "ping_pong",
                speed: 1.5,
              },
            },
          },
        } as EntityDef;
        const rt = load([lift, hero("hero", [0.3, 4 - 0.1 - HH - 0.0005], { seat: 0 })], backend);
        const offset = () => pose(rt, "hero").x - pose(rt, "lift").x;
        steps(rt, 2);
        const start = offset();
        steps(rt, 90);
        expect(pose(rt, "lift").x).toBeGreaterThan(2);
        expect(Math.abs(offset() - start)).toBeLessThan(0.005);
        steps(rt, 120);
        expect(pose(rt, "lift").x).toBeLessThan(2);
        expect(Math.abs(offset() - start)).toBeLessThan(0.005);
        expect(characters(rt).grounded("hero")).toBe(true);
        rt.destroy();
      });

      it("is pushed by a force area: lifted off the ground, and pushed along in the air", () => {
        const area = (id: string, at: [number, number], force: [number, number]): EntityDef =>
          ({
            id,
            type: "marker",
            at,
            behaviors: {
              collider: { shape: ["box", 0, 0, 1, 1], sensor: true },
              "force-area": { force },
            },
          }) as EntityDef;
        const rt = load(
          [
            floor,
            area("upward", [0, 4], [0, -30]),
            area("sideways", [6, -3], [80, 0]),
            hero("hero", standing(0), { seat: 0 }),
            hero("faller", [6, -3.5], { seat: 1 }),
          ],
          backend,
        );
        const lifted = steps(rt, 20);
        expect(pose(rt, "hero").y).toBeLessThan(STANDING - 0.2);
        expect(named(lifted, "character:left-ground").map((e) => e.entityId)).toContain("hero");
        expect(characters(rt).velocity("faller").x).toBeGreaterThan(1);
        expect(pose(rt, "faller").x).toBeGreaterThan(6.2);
        rt.destroy();
      });

      it("raises jumped, left-ground and landed once per occurrence", () => {
        const ledge: EntityDef = {
          id: "ledge",
          type: "solid",
          shape: ["box", -2, FLOOR - 0.5, 2, 0.5],
        } as EntityDef;
        const rt = load(
          [floor, ledge, hero("hero", [-3, FLOOR - 1 - HH - 0.0005], { seat: 0 })],
          backend,
        );
        const walked = steps(rt, 90, (t) => (t === 0 ? { actions: [vector(1, 0, t)] } : {}));
        expect(named(walked, "character:jumped")).toEqual([]);
        expect(named(walked, "character:left-ground")).toHaveLength(1);
        expect(named(walked, "character:landed").map((e) => [e.entityId, e.other])).toEqual([
          ["hero", "floor"],
        ]);

        const jumped = steps(rt, 90, (t) =>
          t === 90
            ? { actions: [vector(0, 0, t), button("jump", true, t)] }
            : t === 92
              ? { actions: [button("jump", false, t)] }
              : {},
        );
        expect(named(jumped, "character:jumped")).toHaveLength(1);
        expect(named(jumped, "character:left-ground")).toHaveLength(1);
        expect(named(jumped, "character:landed").map((e) => e.other)).toEqual(["floor"]);
        expect(jumped.findIndex((e) => e.type === "character:jumped")).toBeLessThan(
          jumped.findIndex((e) => e.type === "character:left-ground"),
        );
        rt.destroy();
      });

      it("stays on the ground down a step within snapToGround, and leaves it with snapToGround 0", () => {
        const DROP = 0.03;
        const lower: EntityDef = {
          id: "lower",
          type: "solid",
          shape: ["box", 4, FLOOR + DROP + 0.5, 2, 0.5],
        } as EntityDef;
        const upper: EntityDef = {
          id: "upper",
          type: "solid",
          shape: ["box", -2, FLOOR + 0.5, 4, 0.5],
        } as EntityDef;
        const walk = (block: BehaviorBlock) => {
          const rt = load([upper, lower, hero("npc", standing(0), { block })], backend);
          characters(rt).setIntent("npc", { move: { x: 1, y: 0 } });
          const seen: string[] = [];
          for (let i = 0; i < 40; i++)
            for (const e of step(rt))
              if (e.type === "character:left-ground" || e.type === "character:landed")
                seen.push(`${e.type} ${i}`);
          const y = pose(rt, "npc").y;
          rt.destroy();
          return { seen, y };
        };
        // The block's default snapToGround, 0.04 m, reaches past the 0.03 m step.
        const stuck = walk({});
        expect(stuck.seen).toEqual([]);
        expect(stuck.y).toBeCloseTo(STANDING + DROP, 2);
        const dropped = walk({ snapToGround: 0 });
        expect(dropped.seen).toEqual(["character:left-ground 24", "character:landed 28"]);
        expect(dropped.y).toBeCloseTo(STANDING + DROP, 2);
      });

      it("drives two characters from two seats, and stops one whose seat leaves", () => {
        const rt = load(
          [floor, hero("one", standing(-12), { seat: 0 }), hero("two", standing(12), { seat: 1 })],
          backend,
        );
        const sys = characters(rt);
        step(rt, { joins: [joinPad(1)], actions: [vector(1, 0, 0), vector(-1, 0, 0, 1)] });
        steps(rt, 29);
        expect(sys.velocity("one").x).toBeCloseTo(6, 5);
        expect(sys.velocity("two").x).toBeCloseTo(-6, 5);
        step(rt, { joins: [joinPad(1, false)] });
        steps(rt, 20);
        expect(sys.velocity("two").x).toBe(0);
        expect(sys.velocity("one").x).toBeCloseTo(6, 5);
        const at = pose(rt, "two").x;
        steps(rt, 10);
        expect(pose(rt, "two").x).toBe(at);
        rt.destroy();
      });

      it("runs from setIntent without a player-input, and launch sets its velocity", () => {
        const rt = load([floor, hero("npc", standing(0))], backend);
        const sys = characters(rt);
        sys.setIntent("npc", { move: { x: -1, y: 0 } });
        steps(rt, 30);
        expect(sys.velocity("npc").x).toBeCloseTo(-6, 5);
        sys.setIntent("npc", { move: { x: 0, y: 0 }, jump: true });
        const held = steps(rt, 5);
        expect(named(held, "character:jumped")).toHaveLength(1);
        steps(rt, 120);
        expect(sys.grounded("npc")).toBe(true);
        const left = steps(rt, 5);
        expect(named(left, "character:jumped")).toEqual([]);

        sys.setIntent("npc", { move: { x: 0, y: 0 } });
        steps(rt, 2);
        sys.launch("npc", { x: 0, y: -8 });
        expect(sys.velocity("npc")).toEqual({ x: 0, y: -8 });
        expect(rt.ctx.bodies.velocity("npc")).toEqual({ x: 0, y: -8 });
        const launched = steps(rt, 2);
        expect(named(launched, "character:left-ground")).toHaveLength(1);
        expect(named(launched, "character:jumped")).toEqual([]);
        rt.destroy();
      });

      it("is the entity's only body: one collider in the world, and ctx.bodies is kinematic", () => {
        const rt = load(
          [floor, hero("hero", standing(0), { seat: 0, body: { kind: "kinematic" } })],
          backend,
        );
        expect(rt.ctx.bodies.kind("hero")).toBe("kinematic");
        steps(rt, 30, (t) => (t === 0 ? { actions: [vector(1, 0, t)] } : {}));
        const at = pose(rt, "hero");
        const filter = { group: "dynamic" };
        expect(
          rt.ctx.space.overlaps({ type: "circle", cx: 0, cy: STANDING, r: 0.05 }, filter),
        ).toEqual([]);
        expect(
          rt.ctx.space
            .overlaps({ type: "circle", cx: at.x, cy: at.y, r: 0.05 }, filter)
            .map((h) => h.tag.entityId),
        ).toEqual(["hero"]);
        expect(rt.ctx.bodies.velocity("hero").x).toBeCloseTo(6, 5);
        rt.destroy();
      });
    });
  }

  describe("jump timing, through the seat (geometry backend)", () => {
    /** The ledge's right edge is x = 0; the floor below it is 1 m lower. */
    const ledge: EntityDef = {
      id: "ledge",
      type: "solid",
      shape: ["box", -2, FLOOR - 0.5, 2, 0.5],
    } as EntityDef;
    const onLedge = (x: number): [number, number] => [x, FLOOR - 1 - HH - 0.0005];

    /** Runs right off the ledge and presses jump `after` ticks past the last grounded one. */
    function offLedge(after: number) {
      const rt = load([floor, ledge, hero("hero", onLedge(-0.5), { seat: 0 })], "none");
      const sys = characters(rt);
      step(rt, { actions: [vector(1, 0, 0)] });
      while (sys.grounded("hero")) step(rt);
      for (let i = 1; i < after; i++) step(rt);
      const events = step(rt, { actions: [button("jump", true, rt.ctx.tick)] });
      rt.destroy();
      return named(events, "character:jumped").length;
    }

    it("jumps in coyote time, 100 ms = 6 ticks after the ledge, and not after", () => {
      expect(offLedge(1)).toBe(1);
      expect(offLedge(6)).toBe(1);
      expect(offLedge(7)).toBe(0);
    });

    it("keeps a press made up to 6 ticks before landing for the landing", () => {
      const fall = (early: number) => {
        const rt = load([floor, hero("hero", [0, STANDING - 2], { seat: 0 })], "none");
        const sys = characters(rt);
        let ticks = 0;
        while (!sys.grounded("hero")) {
          step(rt);
          ticks++;
        }
        rt.destroy();
        const again = load([floor, hero("hero", [0, STANDING - 2], { seat: 0 })], "none");
        const events = steps(again, ticks + 2, (t) =>
          t === ticks - early ? { actions: [button("jump", true, t)] } : {},
        );
        again.destroy();
        return named(events, "character:jumped").length;
      };
      expect(fall(1)).toBe(1);
      expect(fall(6)).toBe(1);
      expect(fall(8)).toBe(0);
    });

    it("cuts a jump released early to a lower one", () => {
      const peak = (holdTicks: number) => {
        const rt = load([floor, hero("hero", standing(0), { seat: 0 })], "none");
        const start = pose(rt, "hero").y;
        let top = start;
        steps(rt, 60, (t) => {
          top = Math.min(top, pose(rt, "hero").y);
          if (t === 0) return { actions: [button("jump", true, t)] };
          if (t === holdTicks) return { actions: [button("jump", false, t)] };
          return {};
        });
        rt.destroy();
        return start - top;
      };
      const full = peak(60);
      expect(full).toBeGreaterThan(1.15);
      expect(peak(4)).toBeLessThan(full * 0.6);
    });
  });

  it("holds one character on a one-way solid while another passes up through it, in one tick", () => {
    const plank: EntityDef = {
      id: "plank",
      type: "solid",
      shape: ["box", 0, 3.05, 3, 0.05],
      oneWay: true,
    } as EntityDef;
    for (const backend of BACKENDS) {
      const rt = load(
        [
          floor,
          plank,
          hero("top", [1, 3 - HH - 0.0005], { seat: 0 }),
          hero("below", standing(-1), { seat: 1, block: { jumpHeight: 2.6 } }),
        ],
        backend,
      );
      const sys = characters(rt);
      const events = steps(rt, 120, (t) =>
        t === 0 ? { joins: [joinPad(1)], actions: [button("jump", true, t, 1)] } : {},
      );
      expect(pose(rt, "top").y).toBeCloseTo(3 - HH, 3);
      expect(sys.grounded("below")).toBe(true);
      expect(pose(rt, "below").y).toBeCloseTo(3 - HH, 3);
      expect(named(events, "character:landed").map((e) => [e.entityId, e.other])).toEqual([
        ["below", "plank"],
      ]);
      rt.destroy();
    }
  });

  it("keeps its place and velocity through a block update, and gives the collider back when the block goes", () => {
    for (const backend of BACKENDS) {
      const rt = load([floor, hero("hero", standing(0), { seat: 0 })], backend);
      steps(rt, 20, (t) => (t === 0 ? { actions: [vector(1, 0, t)] } : {}));
      const at = pose(rt, "hero");
      const blocks = rt.ctx.get("hero")!.behaviors!;
      expect(
        rt.update([
          {
            ...rt.ctx.get("hero")!,
            behaviors: { ...blocks, "character-side-view": { maxSpeed: 3 } },
          },
        ]),
      ).toEqual({ ok: true });
      expect(pose(rt, "hero")).toMatchObject({ x: at.x, y: at.y });
      expect(characters(rt).velocity("hero").x).toBeCloseTo(6, 5);
      steps(rt, 20);
      expect(characters(rt).velocity("hero").x).toBeCloseTo(3, 5);

      const {
        "character-side-view": _gone,
        "player-input": _seat,
        ...rest
      } = rt.ctx.get("hero")!.behaviors!;
      expect(rt.update([{ ...rt.ctx.get("hero")!, behaviors: rest }])).toEqual({ ok: true });
      expect(characters(rt).size()).toBe(0);
      const now = pose(rt, "hero");
      expect(
        rt.ctx.space
          .overlaps({ type: "circle", cx: now.x, cy: now.y, r: 0.05 })
          .map((h) => h.tag.entityId),
      ).toEqual(["hero"]);
      expect(rt.ctx.tags.handlesOf("hero")).toHaveLength(1);
      expect(rt.ctx.bodies.kind("hero")).toBe(backend === "rapier" ? "static" : null);
      rt.destroy();
    }
  });

  it("stops while its entity is disabled and carries on when enabled", () => {
    const rt = load([floor, hero("hero", standing(0), { seat: 0 })], "none");
    steps(rt, 10, (t) => (t === 0 ? { actions: [vector(1, 0, t)] } : {}));
    rt.ctx.setEnabled("hero", false);
    const at = pose(rt, "hero").x;
    steps(rt, 10);
    expect(pose(rt, "hero").x).toBe(at);
    rt.ctx.setEnabled("hero", true);
    steps(rt, 10);
    expect(pose(rt, "hero").x).toBeGreaterThan(at + 0.5);
    rt.destroy();
  });

  it("refuses a dynamic body with character-body-kind", () => {
    const entities = [floor, hero("hero", standing(0), { body: { kind: "dynamic" } })];
    const issues = validateScene(sceneDef(entities, "rapier"), registry);
    expect(issues.map((i) => i.code)).toContain("character-body-kind");
    const rt = load([floor], "rapier");
    let thrown: unknown;
    try {
      rt.ctx.spawn({
        type: "marker",
        id: "marker#late",
        at: [0, 0],
        behaviors: {
          collider: { shape: ["box", 0, 0, HW, HH] },
          body: {},
          "character-side-view": {},
        },
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(EngineError);
    expect((thrown as EngineError).code).toBe("character-body-kind");
    expect(rt.ctx.exists("marker#late")).toBe(false);
    rt.destroy();
  });

  it("saves mid-jump on the geometry backend and restores to the same digest", () => {
    const def = sceneDef(
      [
        floor,
        {
          id: "plank",
          type: "solid",
          shape: ["box", 3, 3.05, 2, 0.05],
          oneWay: true,
        } as EntityDef,
        hero("hero", standing(0), { block: { jumpHeight: 2.6 } }),
      ],
      "none",
    );
    const library: SceneLibrary = {
      list: [{ scene: "side" }],
      scenes: new Map<string, LibraryScene>([["side", { def, prefabs: new Map() }]]),
    };
    const runtime = () => createSceneRuntime({ rapier: null, view: null, game, scenes: library });
    const drive = (rt: SceneRuntimeHandle, t: number) => {
      const sys = characters(rt);
      if (t === 2) sys.setIntent("hero", { move: { x: 1, y: 0 }, jump: true });
      if (t === 50) sys.setIntent("hero", { move: { x: 0.3, y: 0 } });
      if (t === 150) sys.setIntent("hero", { move: { x: -1, y: 0 }, jump: true });
      if (t === 156) sys.setIntent("hero", { move: { x: -1, y: 0 } });
    };
    const run = (rt: SceneRuntimeHandle, from: number, ticks: number) => {
      const frames: unknown[] = [];
      for (let t = from; t < from + ticks; t++) {
        drive(rt, t);
        const result = rt.step(rt.ctx.time.tickMs, []);
        const poses = [...rt.ctx.poses.ids()].sort().map((id) => {
          const p = rt.ctx.poses.get(id)!;
          return [id, p.x, p.y, p.rot];
        });
        frames.push([result.tick, result.events, poses, characters(rt).velocity("hero")]);
      }
      return hashText(JSON.stringify(frames));
    };

    const a = runtime();
    expect(loadListed(a, "side").ok).toBe(true);
    run(a, 0, 12);
    expect(characters(a).grounded("hero")).toBe(false);
    expect(characters(a).velocity("hero").y).toBeLessThan(0);
    const captured = captureSave(a, { depth: "world", slot: "s", now: 1 });
    if (!captured.ok) throw new Error(captured.issue.message);
    const digest = run(a, 12, 300);
    expect(captured.file.world!.systems).toMatchObject({
      hero: { "character-side-view": { i: { m: [1, 0], j: true }, h: true } },
    });

    const parsed = parseSaveFile(formatSaveFile(captured.file), game);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const b = runtime();
    const restored = restoreSave(b, parsed.file);
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(run(b, 12, 300)).toBe(digest);
  });
});
