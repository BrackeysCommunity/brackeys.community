import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { BehaviorBlock } from "../game/behaviors";
import type { CharacterSystem } from "../game/behaviors/character-top-down";
import type { ForceAreaSystem } from "../game/behaviors/force-area";
import { DEFAULT_ACTIONS } from "../game/defaults";
import { createRegistry, defineGame } from "../game/define";
import type { LibraryScene, SceneLibrary } from "../game/flow";
import { formatSaveFile, parseSaveFile } from "../game/save-file";
import type { TickInput } from "../input/stream";
import { createCharacterTopDownSystem } from "../runtime/behaviors/character-top-down";
import { ENGINE_BEHAVIOR_SYSTEMS } from "../runtime/behaviors/index";
import { loadListed } from "../runtime/flow";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreSave } from "../runtime/save-state";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { hashText } from "../scene/hash";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import { validateScene } from "../scene/validate";
import type { InputAction, RapierModule } from "../types";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

/** Two seats on the default move action, nothing of its own to save. */
const game = defineGame({
  id: "walkers",
  types: [],
  actions: [...DEFAULT_ACTIONS],
  input: { players: { max: 2, join: "auto" } },
  time: { kind: "fixed", rate: 60 },
  createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
});
const registry = createRegistry(game);

const BACKENDS = ["none", "rapier"] as const;
type Physics = (typeof BACKENDS)[number];

function scene(entities: EntityDef[], physics: Physics): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: "walkers",
    name: "walkers",
    bounds: [-20, -20, 20, 20],
    settings: { physics, gravity: [0, 0] },
    entities,
  };
}

const HALF = 0.25;

const hero = (
  id: string,
  at: [number, number],
  character: BehaviorBlock = {},
  more: Record<string, BehaviorBlock> = {},
): EntityDef => ({
  id,
  type: "marker",
  at,
  behaviors: {
    collider: { shape: ["box", 0, 0, HALF, HALF] },
    "character-top-down": character,
    ...more,
  },
});

const seated = (id: string, at: [number, number], seat: number, character: BehaviorBlock = {}) =>
  hero(id, at, character, { "player-input": { seat } });

const wall = (id: string, at: [number, number], hw: number, hh: number): EntityDef => ({
  id,
  type: "marker",
  at,
  behaviors: { collider: { shape: ["box", 0, 0, hw, hh] } },
});

/** Entities as a load gives them to the runtime, defaults applied: what `update` takes. */
const expanded = (entities: EntityDef[], physics: Physics) =>
  expandScene(scene(entities, physics), registry).entities;

function load(entities: EntityDef[], physics: Physics) {
  const rt = createSceneRuntime({ rapier: physics === "rapier" ? rapier : null, view: null, game });
  const report = rt.load(expandScene(scene(entities, physics), registry));
  if (!report.ok) throw new Error(report.error);
  const characters = rt.ctx.behavior<CharacterSystem>("character-top-down")!;
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
  };
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) step();
  };
  const pos = (id: string) => {
    const p = rt.ctx.poses.get(id)!;
    return { x: p.x, y: p.y };
  };
  return { rt, characters, step, steps, pos };
}

const move = (x: number, y: number, tick: number, player = 0): InputAction => ({
  action: "move",
  pressed: x !== 0 || y !== 0,
  x,
  y,
  tick,
  timestamp: (tick * 1000) / 60,
  ...(player === 0 ? {} : { player }),
});

const joinPad = (player: number, joined = true) => ({ player, device: "pad:0" as const, joined });

describe("character-top-down", () => {
  it("maps its system", () => {
    expect(ENGINE_BEHAVIOR_SYSTEMS["character-top-down"]).toBe(createCharacterTopDownSystem);
  });

  for (const physics of BACKENDS) {
    describe(`on physics: ${physics}`, () => {
      it("reaches maxSpeed in the time accel implies, then holds it", () => {
        const { rt, characters, step, steps } = load(
          [seated("hero", [0, 0], 0, { maxSpeed: 4, accel: 40 })],
          physics,
        );
        step({ actions: [move(1, 0, 0)] });
        steps(4);
        // 4 m/s at 40 m/s² is 0.1 s: six ticks at 60 Hz.
        expect(characters.velocity("hero").x).toBeCloseTo((40 * 5) / 60, 6);
        step();
        expect(characters.velocity("hero").x).toBeCloseTo(4, 9);
        steps(30);
        expect(characters.velocity("hero")).toEqual({ x: 4, y: 0 });
        expect(characters.grounded("hero")).toBe(true);
        expect(rt.ctx.bodies.kind("hero")).toBe("kinematic");
        expect(rt.ctx.bodies.velocity("hero")).toEqual({ x: 4, y: 0 });
        rt.destroy();
      });

      it("stops against a wall and slides along it", () => {
        const { rt, characters, step, steps, pos } = load(
          [seated("hero", [0, 0], 0), wall("wall", [2, 0], 0.1, 10)],
          physics,
        );
        step({ actions: [move(1, 1, 0)] });
        steps(60);
        const touching = 2 - 0.1 - HALF;
        expect(pos("hero").x).toBeLessThanOrEqual(touching);
        expect(pos("hero").x).toBeCloseTo(touching, 2);
        const y = pos("hero").y;
        steps(30);
        expect(pos("hero").x).toBeCloseTo(touching, 2);
        // Clamped to the unit disc, the diagonal's y share of 4 m/s carries on along the wall.
        const along = 4 * Math.SQRT1_2;
        expect(pos("hero").y - y).toBeCloseTo(along / 2, 1);
        // Rapier's controller turns a little at each contact; the geometry sweep doesn't.
        const v = characters.velocity("hero");
        expect(Math.abs(v.x)).toBeLessThan(physics === "none" ? 1e-6 : 0.5);
        expect(v.y).toBeGreaterThan(0.95 * along);
        expect(v.y).toBeLessThanOrEqual(along + 1e-9);
        rt.destroy();
      });

      it("drives two characters from two seats, and stops the one whose seat leaves", () => {
        const { rt, characters, step, steps, pos } = load(
          [seated("one", [0, 0], 0), seated("two", [0, 5], 1)],
          physics,
        );
        step({ joins: [joinPad(1)], actions: [move(1, 0, 0), move(0, -1, 0, 1)] });
        steps(29);
        expect(pos("one").y).toBe(0);
        expect(pos("one").x).toBeGreaterThan(1.5);
        expect(pos("two").x).toBe(0);
        expect(pos("two").y).toBeLessThan(3.5);
        expect(characters.velocity("two")).toEqual({ x: 0, y: -4 });

        step({ joins: [joinPad(1, false)] });
        steps(6);
        expect(characters.velocity("two")).toEqual({ x: 0, y: 0 });
        const still = pos("two");
        const running = pos("one");
        steps(30);
        expect(pos("two")).toEqual(still);
        expect(pos("one").x).toBeCloseTo(running.x + 2, 6);
        rt.destroy();
      });

      it("walks one with no player-input by setIntent, which seats don't reach", () => {
        const { rt, characters, step, steps, pos } = load(
          [hero("npc", [0, 0], { maxSpeed: 2 })],
          physics,
        );
        characters.setIntent("npc", { move: { x: 0, y: -1 } });
        step({ actions: [move(1, 0, 0)] });
        steps(59);
        expect(pos("npc").x).toBe(0);
        expect(pos("npc").y).toBeLessThan(-1.8);
        expect(characters.velocity("npc")).toEqual({ x: 0, y: -2 });
        characters.setIntent("npc", { move: { x: 0, y: 0 } });
        steps(30);
        expect(characters.velocity("npc")).toEqual({ x: 0, y: 0 });
        expect(() => characters.setIntent("ghost", { move: { x: 1, y: 0 } })).toThrow(
          /carries no character-top-down/,
        );
        rt.destroy();
      });

      it("launches at a velocity it then eases out of at decel", () => {
        const { rt, characters, steps, pos } = load([hero("npc", [0, 0])], physics);
        characters.launch("npc", { x: 0, y: 6 });
        steps(1);
        expect(characters.velocity("npc").y).toBeCloseTo(6 - 40 / 60, 6);
        steps(20);
        expect(characters.velocity("npc")).toEqual({ x: 0, y: 0 });
        expect(pos("npc").y).toBeGreaterThan(0.3);
        rt.destroy();
      });

      it("takes a force area's acceleration, held back by its decel", () => {
        const { rt, characters, steps } = load([hero("npc", [0, 0])], physics);
        const forces = rt.ctx.behavior<ForceAreaSystem>("force-area")!;
        forces.sample = (p) => (p.x < 100 ? { x: 100, y: 0 } : { x: 0, y: 0 });
        steps(30);
        expect(characters.velocity("npc").x).toBeCloseTo(((100 - 40) * 30) / 60, 6);
        rt.destroy();
      });

      it("leaves its collider's own body out of the world, and puts it back when it detaches", () => {
        const { rt, characters, steps, pos } = load(
          [hero("npc", [0, 0]), hero("other", [3, 0])],
          physics,
        );
        characters.setIntent("npc", { move: { x: 0, y: -1 } });
        steps(60);
        characters.setIntent("npc", { move: { x: 0, y: 0 } });
        characters.setIntent("other", { move: { x: -1, y: 0 } });
        steps(120);
        // Through where npc spawned: npc's collider left no body behind there.
        expect(pos("other").x).toBeLessThan(-4);
        expect(pos("other").y).toBe(0);
        expect(rt.update(expanded([wall("npc", [0, 0], HALF, HALF)], physics))).toEqual({
          ok: true,
        });
        expect(characters.size()).toBe(1);
        const at = pos("npc");
        const hits = rt.ctx.space.overlaps({ type: "circle", cx: at.x, cy: at.y, r: 0.05 });
        expect(hits.map((h) => h.tag.entityId)).toEqual(["npc"]);
        expect(rt.ctx.tags.handlesOf("npc")).toHaveLength(1);
        rt.destroy();
      });

      it("gives an unmoved entity's collider body back to ctx.bodies when it detaches", () => {
        const { rt, characters } = load([hero("npc", [0, 0])], physics);
        expect(rt.ctx.bodies.kind("npc")).toBe("kinematic");
        expect(rt.update(expanded([wall("npc", [0, 0], HALF, HALF)], physics))).toEqual({
          ok: true,
        });
        expect(characters.size()).toBe(0);
        if (physics === "rapier") expect(rt.ctx.bodies.kind("npc")).toBe("static");
        else expect(rt.ctx.bodies.has("npc")).toBe(false);
        const hits = rt.ctx.space.overlaps({ type: "circle", cx: 0, cy: 0, r: 0.05 });
        expect(hits.map((h) => h.tag.entityId)).toEqual(["npc"]);
        rt.destroy();
      });

      it("keeps its place and velocity through an update of its block", () => {
        const { rt, characters, step, steps, pos } = load([seated("hero", [0, 0], 0)], physics);
        step({ actions: [move(1, 0, 0)] });
        steps(29);
        const at = pos("hero");
        expect(rt.update(expanded([seated("hero", [0, 0], 0, { maxSpeed: 6 })], physics))).toEqual({
          ok: true,
        });
        expect(pos("hero")).toEqual(at);
        expect(characters.velocity("hero")).toEqual({ x: 4, y: 0 });
        expect(rt.ctx.bodies.velocity("hero")).toEqual({ x: 4, y: 0 });
        steps(12);
        expect(characters.velocity("hero")).toEqual({ x: 6, y: 0 });
        rt.destroy();
      });

      it("stops while disabled and walks on when enabled", () => {
        const { rt, characters, steps, pos } = load([hero("npc", [0, 0])], physics);
        characters.setIntent("npc", { move: { x: 1, y: 0 } });
        steps(10);
        rt.ctx.setEnabled("npc", false);
        const at = pos("npc");
        steps(10);
        expect(pos("npc")).toEqual(at);
        rt.ctx.setEnabled("npc", true);
        steps(10);
        expect(pos("npc").x).toBeGreaterThan(at.x);
        rt.destroy();
      });
    });
  }

  it("pushes a dynamic body crate when pushDynamic, and stops at it otherwise", () => {
    const crate: EntityDef = {
      id: "crate",
      type: "marker",
      at: [1.5, 0],
      behaviors: {
        collider: { shape: ["box", 0, 0, 0.25, 0.25] },
        body: { kind: "dynamic", fixedRotation: true },
      },
    };
    const run = (pushDynamic: boolean) => {
      const { rt, characters, step, steps, pos } = load(
        [seated("hero", [0, 0], 0, { pushDynamic }), crate],
        "rapier",
      );
      step({ actions: [move(1, 0, 0)] });
      steps(59);
      const out = { hero: pos("hero"), crate: pos("crate"), v: characters.velocity("hero") };
      rt.destroy();
      return out;
    };
    const pushing = run(true);
    expect(pushing.crate.x).toBeGreaterThan(3);
    expect(pushing.hero.x).toBeGreaterThan(2.5);
    expect(pushing.crate.x - pushing.hero.x).toBeGreaterThanOrEqual(2 * HALF - 0.01);
    expect(Math.abs(pushing.crate.y)).toBeLessThan(0.05);

    const blocked = run(false);
    expect(blocked.crate.x).toBeCloseTo(1.5, 2);
    expect(blocked.hero.x).toBeCloseTo(1.5 - 2 * HALF, 2);
    expect(blocked.v.x).toBeCloseTo(0, 6);
  });

  it("is a playable hero on a marker in a scene with no game", () => {
    const bare = createRegistry();
    const { game: _game, ...def } = scene([seated("hero", [0, 0], 0)], "none");
    expect(validateScene(def, bare)).toEqual([]);
    const rt = createSceneRuntime({ rapier: null, view: null, game: null, registry: bare });
    const report = rt.load(expandScene(def, bare));
    if (!report.ok) throw new Error(report.error);
    rt.step(rt.ctx.time.tickMs, {
      tick: 0,
      actions: [move(0, 1, 0)],
      commands: [],
      pointers: [],
      joins: [],
    });
    for (let i = 1; i < 60; i++) rt.step(rt.ctx.time.tickMs, []);
    expect(rt.ctx.poses.get("hero")!.y).toBeGreaterThan(3);
    rt.destroy();
  });

  it("refuses a dynamic body with character-body-kind, at validation and at load", () => {
    const def = scene([hero("hero", [0, 0], {}, { body: { kind: "dynamic" } })], "rapier");
    expect(validateScene(def, registry).map((i) => i.code)).toContain("character-body-kind");
    const rt = createSceneRuntime({ rapier, view: null, game });
    const report = rt.load(expandScene(def, registry));
    expect(report.ok).toBe(false);
    expect(!report.ok && report.error).toMatch(/dynamic body/);
    rt.destroy();
  });

  it("takes a kinematic body as its own", () => {
    const { rt, characters, steps, pos } = load(
      [hero("hero", [0, 0], {}, { body: { kind: "kinematic" } })],
      "rapier",
    );
    characters.setIntent("hero", { move: { x: 1, y: 0 } });
    steps(60);
    expect(pos("hero").x).toBeGreaterThan(3);
    expect(rt.ctx.bodies.velocity("hero")).toEqual({ x: 4, y: 0 });
    rt.destroy();
  });

  it("conflicts with character-side-view", () => {
    const def = scene([hero("hero", [0, 0], {}, { "character-side-view": {} })], "rapier");
    expect(validateScene(def, registry).map((i) => i.code)).toContain("behavior-conflict");
  });

  it("saves and restores on the geometry backend, to the same digest 300 ticks on", () => {
    const def = scene(
      [
        hero("npc", [0, 0], { maxSpeed: 3 }),
        hero("other", [-4, 2]),
        wall("wall", [3, 0], 0.1, 4),
        wall("floor", [0, 4], 6, 0.1),
      ],
      "none",
    );
    const library: SceneLibrary = {
      list: [{ scene: "walkers" }],
      scenes: new Map<string, LibraryScene>([["walkers", { def, prefabs: new Map() }]]),
    };
    const runtime = () => createSceneRuntime({ rapier: null, view: null, game, scenes: library });
    const run = (rt: SceneRuntimeHandle, from: number, ticks: number) => {
      const characters = rt.ctx.behavior<CharacterSystem>("character-top-down")!;
      const frames: unknown[] = [];
      for (let t = from; t < from + ticks; t++) {
        if (t === 5) characters.setIntent("npc", { move: { x: 1, y: 0.6 } });
        if (t === 10) characters.setIntent("other", { move: { x: 0.3, y: 1 } });
        if (t === 200) characters.setIntent("npc", { move: { x: -1, y: -1 } });
        if (t === 250) characters.launch("other", { x: 5, y: -5 });
        const result = rt.step(rt.ctx.time.tickMs, []);
        const poses = [...rt.ctx.poses.ids()].sort().map((id) => {
          const p = rt.ctx.poses.get(id)!;
          return [id, p.x, p.y, p.rot];
        });
        frames.push([result.tick, result.events, poses, characters.velocity("npc")]);
      }
      return hashText(JSON.stringify(frames));
    };

    const a = runtime();
    expect(loadListed(a, "walkers").ok).toBe(true);
    run(a, 0, 60);
    const captured = captureSave(a, { depth: "world", slot: "s", now: 1 });
    if (!captured.ok) throw new Error(captured.issue.message);
    expect(captured.file.world!.systems).toMatchObject({
      npc: { "character-top-down": { intent: [1, 0.6] } },
    });
    const digest = run(a, 60, 300);

    const parsed = parseSaveFile(formatSaveFile(captured.file), game);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const b = runtime();
    const restored = restoreSave(b, parsed.file);
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(run(b, 60, 300)).toBe(digest);
  });
});
