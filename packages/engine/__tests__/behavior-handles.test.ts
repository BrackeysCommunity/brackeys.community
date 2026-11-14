import { beforeAll, describe, expect, expectTypeOf, it, vi } from "vite-plus/test";

import type { BehaviorBlock } from "../game/behaviors";
import { ANIM, type AnimBlock, type AnimHandle } from "../game/behaviors/anim";
import { BODY, type BodyBlock, type BodyHandle } from "../game/behaviors/body";
import { CAMERA_TARGET, type CameraTargetBlock } from "../game/behaviors/camera-target";
import { CHARACTER_SIDE_VIEW } from "../game/behaviors/character-side-view";
import {
  CHARACTER_TOP_DOWN,
  type CharacterHandle,
  type CharacterTopDownBlock,
} from "../game/behaviors/character-top-down";
import { COLLIDER, type ColliderBlock, type ColliderHandle } from "../game/behaviors/collider";
import { EMITTER, type EmitterBlock } from "../game/behaviors/emitter";
import { FORCE_AREA, type ForceAreaBlock } from "../game/behaviors/force-area";
import { JOINT, type JointBlock, type JointHandle } from "../game/behaviors/joint";
import { LIFETIME, type LifetimeBlock } from "../game/behaviors/lifetime";
import { NAV_AGENT, type NavAgentBlock, type NavAgentHandle } from "../game/behaviors/nav-agent";
import { OCCUPANT, type OccupantBlock } from "../game/behaviors/occupant";
import {
  PATH_FOLLOW,
  type PathFollowBlock,
  type PathFollowHandle,
} from "../game/behaviors/path-follow";
import {
  PLAYER_INPUT,
  type PlayerInputBlock,
  type PlayerInputHandle,
} from "../game/behaviors/player-input";
import {
  SPAWNER,
  type SpawnerBlock,
  type SpawnerHandle,
  type SpawnerSystem,
} from "../game/behaviors/spawner";
import { SPRITE, type SpriteBlock } from "../game/behaviors/sprite";
import { TWEEN, type TweenBlock, type TweenHandle } from "../game/behaviors/tween";
import { createRegistry } from "../game/define";
import type { Entity } from "../game/entity";
import { inputFor } from "../game/input-for";
import type { EngineContext } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import type { RapierModule } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
import { recordingView } from "./fixtures/recording-view";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await loadCompatRapier();
});

const registry = createRegistry(testGame);

const box = (half = 0.25) => ["box", 0, 0, half, half];

const ENTITIES: EntityDef[] = [
  { id: "body", type: "marker", at: [0, 0], behaviors: { collider: { shape: box() }, body: {} } },
  {
    id: "pivot",
    type: "marker",
    at: [4, 0],
    behaviors: { collider: { shape: box() }, body: { kind: "static" } },
  },
  {
    id: "bob",
    type: "marker",
    at: [6, 0],
    behaviors: {
      collider: { shape: box() },
      body: {},
      joint: { kind: "revolute", to: "pivot", anchorA: [-2, 0] },
    },
  },
  { id: "seat", type: "marker", at: [0, 4], behaviors: { "player-input": { seat: 0 } } },
  {
    id: "spawner",
    type: "marker",
    at: [0, 6],
    behaviors: { spawner: { type: "marker", rate: 10, cap: 2 } },
  },
  { id: "lifetime", type: "marker", at: [1, 6], behaviors: { lifetime: { ticks: 600 } } },
  { id: "camera", type: "marker", at: [2, 6], behaviors: { "camera-target": { weight: 2 } } },
  {
    id: "area",
    type: "marker",
    at: [3, 8],
    behaviors: { collider: { shape: box(0.5), sensor: true }, "force-area": { force: [0, -1] } },
  },
  { id: "occupant", type: "marker", at: [4, 6], behaviors: { occupant: {} } },
  {
    id: "side",
    type: "marker",
    at: [-4, 0],
    behaviors: { collider: { shape: box(0.2) }, "character-side-view": {} },
  },
  {
    id: "top",
    type: "marker",
    at: [-6, 0],
    behaviors: { collider: { shape: ["circle", 0, 0, 0.2] }, "character-top-down": {} },
  },
  { id: "nav", type: "marker", at: [-8, 0], behaviors: { "nav-agent": {} } },
  {
    id: "path",
    type: "marker",
    at: [0, 10],
    behaviors: {
      "path-follow": {
        path: {
          mode: "loop",
          pts: [
            [0, 10],
            [3, 10],
          ],
          speed: 1,
        },
      },
    },
  },
  {
    id: "tween",
    type: "marker",
    at: [2, 10],
    behaviors: { tween: { tweens: [{ duration: { ms: 800 }, to: { y: 11 }, repeat: -1 }] } },
  },
  {
    id: "anim",
    type: "marker",
    at: [4, 10],
    behaviors: { sprite: { size: [1, 1] }, anim: { source: "walker", clip: "idle" } },
  },
  {
    id: "emitter",
    type: "marker",
    at: [6, 10],
    behaviors: { emitter: { preset: "sparks" } },
  },
];

function load(opts: { view?: boolean } = {}): SceneRuntimeHandle {
  const rt = createSceneRuntime({
    rapier: opts.view ? null : rapier,
    view: opts.view ? recordingView({ sprites: true }).view : null,
    game: testGame,
  });
  const scene: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    game: "test-game",
    name: "handles",
    bounds: [-20, -20, 20, 20],
    settings: { physics: opts.view ? "none" : "rapier", gravity: [0, 0] },
    entities: opts.view
      ? ENTITIES.filter((e) => e.id === "anim" || e.id === "emitter" || e.id === "lifetime")
      : ENTITIES,
  };
  const report = rt.load(expandScene(scene, registry));
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const step = (rt: SceneRuntimeHandle, n = 1) => {
  for (let i = 0; i < n; i++) rt.step(rt.ctx.time.tickMs, []);
};

const entity = (rt: SceneRuntimeHandle, id: string): Entity => {
  const e = rt.ctx.entity(id);
  if (!e) throw new Error(`no handle for ${id}`);
  return e;
};

type Call = { readonly args: readonly unknown[] };
type ByIdCase = {
  readonly name: string;
  readonly id: string;
  /** What the handle's methods call through, by id. */
  readonly source: (ctx: EngineContext) => object;
  readonly calls: Readonly<Record<string, Call>>;
};

const none: Call = { args: [] };

/** Each behavior whose handle binds by-id methods, and the calls to make through it. */
const BY_ID: readonly ByIdCase[] = [
  {
    name: BODY.name,
    id: "body",
    source: (ctx) => ctx.bodies,
    calls: {
      kind: none,
      velocity: none,
      setVelocity: { args: [{ x: 1, y: 0 }] },
      angularVelocity: none,
      setAngularVelocity: { args: [2] },
      applyImpulse: {
        args: [
          { x: 0, y: 1 },
          { x: 0, y: 0 },
        ],
      },
      applyForce: {
        args: [
          { x: 1, y: 1 },
          { x: 0.5, y: 0 },
        ],
      },
      applyTorque: { args: [3] },
      mass: none,
      wake: none,
    },
  },
  {
    name: COLLIDER.name,
    id: "body",
    source: (ctx) => ctx.behavior(COLLIDER.name)!,
    calls: { rebuild: none },
  },
  ...[CHARACTER_SIDE_VIEW, CHARACTER_TOP_DOWN].map(
    (def): ByIdCase => ({
      name: def.name,
      id: def === CHARACTER_TOP_DOWN ? "top" : "side",
      source: (ctx) => ctx.behavior(def.name)!,
      calls: {
        grounded: none,
        launch: { args: [{ x: 0, y: -2 }] },
        setIntent: { args: [{ x: 1, y: 0 }] },
        velocity: none,
      },
    }),
  ),
  {
    name: NAV_AGENT.name,
    id: "nav",
    source: (ctx) => ctx.behavior(NAV_AGENT.name)!,
    calls: { path: none, setDestination: { args: [{ x: 1, y: 1 }] }, stop: none },
  },
  {
    name: PATH_FOLLOW.name,
    id: "path",
    source: (ctx) => ctx.behavior(PATH_FOLLOW.name)!,
    calls: { position: none, frameDelta: none },
  },
  {
    name: SPAWNER.name,
    id: "spawner",
    source: (ctx) => ctx.behavior(SPAWNER.name)!,
    calls: { live: none },
  },
  {
    name: JOINT.name,
    id: "bob",
    source: (ctx) => ctx.behavior(JOINT.name)!,
    calls: { joined: none },
  },
  {
    name: ANIM.name,
    id: "anim",
    source: (ctx) => ctx.behavior(ANIM.name)!,
    calls: {
      play: { args: ["run", { restart: true }] },
      stop: none,
      state: none,
      shapes: { args: ["hit"] },
    },
  },
  {
    name: TWEEN.name,
    id: "tween",
    source: (ctx) => ctx.behavior(TWEEN.name)!,
    calls: { to: { args: [{ to: { x: 3 }, duration: { ms: 100 } }] }, cancelAll: none },
  },
];

/** Behaviors whose handle is `fields` alone, and the runtime that builds their system. */
const FIELDS_ONLY = [
  { name: LIFETIME.name, id: "lifetime", view: false },
  { name: CAMERA_TARGET.name, id: "camera", view: false },
  { name: FORCE_AREA.name, id: "area", view: false },
  { name: OCCUPANT.name, id: "occupant", view: false },
  { name: SPRITE.name, id: "anim", view: true },
  { name: EMITTER.name, id: "emitter", view: true },
] as const;

describe("behavior handles", () => {
  it("covers all 17 standard behaviors", () => {
    const covered = new Set([
      ...BY_ID.map((c) => c.name),
      ...FIELDS_ONLY.map((c) => c.name),
      PLAYER_INPUT.name,
    ]);
    const standard = [...registry.behaviors.values()].filter((b) => b.origin === "engine");
    expect(standard).toHaveLength(17);
    expect([...covered].sort()).toEqual(standard.map((b) => b.name).sort());
  });

  describe.each(BY_ID)("$name", ({ name, id, source, calls }) => {
    it("binds each by-id method to the entity: the call reaches the system with the id first", () => {
      const rt = load();
      const handle = entity(rt, id).getBehavior(name) as unknown as Record<string, unknown>;
      expect(handle).toBeDefined();
      expect(Object.keys(handle).sort()).toEqual([...Object.keys(calls), "fields"].sort());
      const target = source(rt.ctx) as Record<string, (...args: unknown[]) => unknown>;
      for (const [method, { args }] of Object.entries(calls)) {
        const answer = Symbol(method);
        const spy = vi.spyOn(target, method).mockReturnValue(answer);
        expect((handle[method] as (...a: unknown[]) => unknown)(...args), method).toBe(answer);
        expect(spy, method).toHaveBeenCalledExactlyOnceWith(id, ...args);
        spy.mockRestore();
      }
      rt.destroy();
    });

    it("is asked once per attach: the same object until the block detaches", () => {
      const rt = load();
      const e = entity(rt, id);
      const handle = e.getBehavior(name);
      expect(e.getBehavior(name) === handle).toBe(true);
      expect(handle?.fields).toBe(rt.get(id)?.behaviors?.[name]);
      rt.destroy();
    });
  });

  it("player-input: the seat the block names and that seat's input", () => {
    const rt = load();
    const handle = entity(rt, "seat").getBehavior(PLAYER_INPUT)!;
    expect(handle.seat).toBe(0);
    expect(handle.input).toBe(inputFor(rt.ctx, "seat"));
    expect(handle.input.held("jump")).toBe(false);
    expect(handle.fields.seat).toBe(0);
    rt.destroy();
  });

  it.each(FIELDS_ONLY)(
    "$name: fields alone, read from the block as it is now",
    ({ name, id, view }) => {
      const rt = load({ view });
      const handle = entity(rt, id).getBehavior(name)!;
      expect(Object.keys(handle)).toEqual(["fields"]);
      expect(handle.fields).toBe(rt.get(id)?.behaviors?.[name]);
      rt.destroy();
    },
  );

  it("does real work through the system: velocity, joints and spawns", () => {
    const rt = load();
    const body = entity(rt, "body").getBehavior(BODY)!;
    expect(body.kind()).toBe("dynamic");
    body.setVelocity({ x: 2, y: 0 });
    expect(body.velocity()).toEqual({ x: 2, y: 0 });
    expect(body.mass()).toBeGreaterThan(0);
    expect(entity(rt, "bob").getBehavior(JOINT)!.joined()).toBe(true);
    step(rt, 30);
    const spawner = entity(rt, "spawner").getBehavior(SPAWNER)!;
    expect(spawner.live()).toHaveLength(2);
    expect(spawner.live()).toEqual(rt.ctx.behavior<SpawnerSystem>(SPAWNER.name)!.live("spawner"));
    rt.destroy();
  });

  it("is undefined headless for a visual-only behavior, which builds no system there", () => {
    const rt = load();
    expect(entity(rt, "anim").getBehavior(SPRITE)).toBeUndefined();
    expect(entity(rt, "emitter").getBehavior(EMITTER)).toBeUndefined();
    expect(entity(rt, "anim").getBehavior(ANIM)).toBeDefined();
    rt.destroy();
  });

  it("types each standard behavior's handle from its definition, without a cast", () => {
    const rt = load();
    const e = entity(rt, "body");
    const types = () => {
      expectTypeOf(e.getBehavior(BODY)!).toEqualTypeOf<
        Readonly<{ fields: Readonly<BodyBlock> }> & BodyHandle
      >();
      expectTypeOf(e.getBehavior(BODY)!.velocity()).toEqualTypeOf<{ x: number; y: number }>();
      expectTypeOf(e.getBehavior(COLLIDER)!.fields).toEqualTypeOf<Readonly<ColliderBlock>>();
      expectTypeOf(e.getBehavior(COLLIDER)!).toExtend<ColliderHandle>();
      expectTypeOf(e.getBehavior(CHARACTER_SIDE_VIEW)!).toExtend<CharacterHandle>();
      expectTypeOf(e.getBehavior(CHARACTER_TOP_DOWN)!).toExtend<CharacterHandle>();
      expectTypeOf(e.getBehavior(CHARACTER_TOP_DOWN)!.fields).toEqualTypeOf<
        Readonly<CharacterTopDownBlock>
      >();
      expectTypeOf(e.getBehavior(PLAYER_INPUT)!).toExtend<PlayerInputHandle>();
      expectTypeOf(e.getBehavior(PLAYER_INPUT)!.fields).toEqualTypeOf<Readonly<PlayerInputBlock>>();
      expectTypeOf(e.getBehavior(NAV_AGENT)!).toExtend<NavAgentHandle>();
      expectTypeOf(e.getBehavior(NAV_AGENT)!.fields).toEqualTypeOf<Readonly<NavAgentBlock>>();
      expectTypeOf(e.getBehavior(PATH_FOLLOW)!).toExtend<PathFollowHandle>();
      expectTypeOf(e.getBehavior(PATH_FOLLOW)!.fields).toEqualTypeOf<Readonly<PathFollowBlock>>();
      expectTypeOf(e.getBehavior(SPAWNER)!).toExtend<SpawnerHandle>();
      expectTypeOf(e.getBehavior(SPAWNER)!.fields).toEqualTypeOf<Readonly<SpawnerBlock>>();
      expectTypeOf(e.getBehavior(JOINT)!).toExtend<JointHandle>();
      expectTypeOf(e.getBehavior(JOINT)!.fields).toEqualTypeOf<Readonly<JointBlock>>();
      expectTypeOf(e.getBehavior(ANIM)!).toExtend<AnimHandle>();
      expectTypeOf(e.getBehavior(ANIM)!.fields).toEqualTypeOf<Readonly<AnimBlock>>();
      expectTypeOf(e.getBehavior(TWEEN)!).toExtend<TweenHandle>();
      expectTypeOf(e.getBehavior(TWEEN)!.fields).toEqualTypeOf<Readonly<TweenBlock>>();
      expectTypeOf(e.getBehavior(SPRITE)!.fields).toEqualTypeOf<Readonly<SpriteBlock>>();
      expectTypeOf(e.getBehavior(EMITTER)!.fields).toEqualTypeOf<Readonly<EmitterBlock>>();
      expectTypeOf(e.getBehavior(LIFETIME)!.fields).toEqualTypeOf<Readonly<LifetimeBlock>>();
      expectTypeOf(e.getBehavior(CAMERA_TARGET)!.fields).toEqualTypeOf<
        Readonly<CameraTargetBlock>
      >();
      expectTypeOf(e.getBehavior(FORCE_AREA)!.fields).toEqualTypeOf<Readonly<ForceAreaBlock>>();
      expectTypeOf(e.getBehavior(OCCUPANT)!.fields).toEqualTypeOf<Readonly<OccupantBlock>>();
      expectTypeOf(e.getBehavior("body")!.fields).toEqualTypeOf<BehaviorBlock>();
    };
    expect(types).toBeTypeOf("function");
    rt.destroy();
  });
});
