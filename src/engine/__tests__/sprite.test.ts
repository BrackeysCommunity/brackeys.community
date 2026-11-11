// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { SpriteVisual } from "../context";
import { LIFETIME } from "../game/behaviors/lifetime";
import { OCCUPANT } from "../game/behaviors/occupant";
import { SPRITE, spriteAssets, spriteGeometry, spriteOffset } from "../game/behaviors/sprite";
import {
  createRegistry,
  defineGame,
  ENGINE_BEHAVIORS,
  type ProjectMaterialDef,
} from "../game/define";
import { PRIMITIVES } from "../game/primitives";
import type { Registry } from "../game/types";
import { assetInfo } from "../project/asset-info";
import { runtimeView, type ProjectRuntimeView } from "../project/runtime-view";
import type { AssetEntry } from "../project/types";
import { projectView } from "../project/view";
import { ENGINE_BEHAVIOR_SYSTEMS } from "../runtime/behaviors/index";
import { createSpriteSystem, spriteViewId } from "../runtime/behaviors/sprite";
import { createSceneRuntime } from "../runtime/runtime";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";
import type { RapierModule } from "../types";
import { recordingView, type ViewCall } from "./fixtures/recording-view";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;
const TEX = "a".repeat(64);
const SHEET = "c".repeat(64);
const ATLAS = "b".repeat(64);

const entry = (id: string, kind: string, extra: Partial<AssetEntry> = {}): AssetEntry => ({
  key: `k-${id}`,
  id,
  kind,
  path: `${id}.${kind}`,
  created: { at: 0, by: "t" },
  ...extra,
});

/** Within a micrometre: frame px over px per metre needn't be exact in binary. */
function expectNear(actual: readonly number[] | undefined, expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v, i) => expect(actual![i]).toBeCloseTo(v, 6));
}

/** The test project, each entry's fields overridden by `over[id]`. */
const viewOf = (over: Record<string, Partial<AssetEntry>> = {}) =>
  projectView({
    meta: { projectId: "p", layout: 2, name: "P" },
    assets: Object.fromEntries(
      [
        entry("crate", "texture", {
          sha256: TEX,
          meta: { format: "png", width: 40, height: 20 },
          import: { pivot: [0.5, 1], filter: "nearest", nineSlice: [1, 2, 3, 4] },
        }),
        entry("sheet", "texture", {
          sha256: SHEET,
          meta: { format: "png", width: 64, height: 64 },
        }),
        entry("hero", "atlas", {
          sha256: ATLAS,
          meta: {
            tool: "aseprite",
            frames: {
              "idle-0": { x: 0, y: 0, w: 16, h: 24, pivot: [0.5, 1] },
              "run-0": { x: 16, y: 0, w: 16, h: 24 },
            },
            tags: [],
            slices: [],
            order: ["idle-0", "run-0"],
          },
          import: { texture: "sheet" },
        }),
      ].map((e) => {
        const own = { ...e, ...over[e.id] };
        return [own.key, own];
      }),
    ),
    history: {},
    code: {},
    build: {},
  });

const view = viewOf();

const GLASS: ProjectMaterialDef = {
  description: "Tinted glass.",
  physics: { friction: 0.1, restitution: 0 },
  tint: 0x00ff00,
  blend: "add",
};
const PAINT: ProjectMaterialDef = { description: "Render only.", tint: 0xff0000, blend: "screen" };

function project(registry: Registry): ProjectRuntimeView {
  return runtimeView(view, new Map(), registry);
}

function scene(entities: RuntimeEntity[]): ExpandedScene {
  return {
    name: "t",
    bounds: [-10, -10, 10, 10],
    settings: {
      gravity: [0, 0],
      physics: "rapier",
      grid: null,
      view: { projection: "orthogonal" },
    },
    entities,
  };
}

const marker = (id: string, sprite: Record<string, unknown>, over: Partial<RuntimeEntity> = {}) =>
  ({ id, type: "marker", at: [1, 2], behaviors: { sprite }, ...over }) as RuntimeEntity;

/** A gameless-like game drawn at `lengthUnit` px per metre. */
const gameAt = (lengthUnit: number) =>
  defineGame({
    id: `px-${lengthUnit}`,
    types: [],
    actions: [],
    world: { lengthUnit },
    createRuntime: () => ({ snapshot: () => null }),
  });

function loaded(
  entities: RuntimeEntity[],
  opts: {
    sprites?: boolean;
    sampling?: "linear" | "nearest";
    withProject?: boolean;
    lengthUnit?: number;
  } = {},
) {
  const rec = recordingView({ sprites: opts.sprites ?? true });
  const game = opts.lengthUnit === undefined ? null : gameAt(opts.lengthUnit);
  const registry = createRegistry(game, { materials: { glass: GLASS, paint: PAINT } });
  const rt = createSceneRuntime({
    rapier,
    view: rec.view,
    registry,
    project: opts.withProject === false ? null : project(registry),
    ...(opts.sampling ? { sampling: opts.sampling } : {}),
  });
  const report = rt.load(scene(entities));
  expect(report.ok, JSON.stringify(report)).toBe(true);
  return { rt, ...rec };
}

const visualOf = (live: ReturnType<typeof loaded>["live"], id: string): SpriteVisual => {
  const visual = live.get(spriteViewId(id))?.sprite;
  expect(visual, id).toBeDefined();
  return visual!;
};

const poseCalls = (calls: ViewCall[], id: string) =>
  calls.filter(
    (c): c is Extract<ViewCall, { op: "pose" }> => c.op === "pose" && c.id === spriteViewId(id),
  );

describe("the sprite behavior", () => {
  it("is the engine's first behavior, visual-only, with a system", () => {
    expect(ENGINE_BEHAVIORS).toEqual([SPRITE, OCCUPANT, LIFETIME]);
    expect(SPRITE.visualOnly).toBe(true);
    expect(ENGINE_BEHAVIOR_SYSTEMS.sprite).toBe(createSpriteSystem);
  });

  it("builds no system headless, and one with a view", () => {
    const registry = createRegistry();
    const headless = createSceneRuntime({ rapier, view: null, registry });
    headless.load(scene([marker("pic", { asset: "crate" })]));
    expect(headless.ctx.behavior(SPRITE.name)).toBeUndefined();
    expect(headless.stats().behaviors).toEqual({});
    const { rt } = loaded([marker("pic", { asset: "crate" })]);
    expect(rt.ctx.behavior(SPRITE.name)?.size()).toBe(1);
  });
});

describe("the sprite's visual", () => {
  it("comes from the texture's info and import settings", () => {
    const { live, callsFor } = loaded([marker("pic", { asset: "crate", scale: 2 }, { z: 3 })]);
    const sid = spriteViewId("pic");
    expect(visualOf(live, "pic")).toEqual({
      texture: TEX,
      // 40 × 20 px at 100 px per metre, times the scale.
      size: [0.8, 0.4],
      anchor: [0.5, 1],
      nineSlice: [1, 2, 3, 4],
      sampling: "nearest",
      fallback: {
        shape: { type: "box", cx: 0, cy: -0.2, hw: 0.4, hh: 0.2, rotDeg: 0 },
        style: PRIMITIVES.marker.style ?? {},
      },
    });
    expect(live.get(sid)).toMatchObject({ layer: 10, depth: 3, pose: { x: 1, y: 2, rot: 0 } });
    expect(callsFor(sid, "pose")).toEqual([
      { op: "pose", id: sid, x: 1, y: 2, rot: 0, snap: true },
    ]);
  });

  it("sizes a frame by the game's px per metre: 40 × 20 px is 1.25 × 0.625 m at 32", () => {
    const { live } = loaded(
      [marker("pic", { asset: "crate" }), marker("a", { asset: "hero", frame: "idle-0" })],
      {
        lengthUnit: 32,
      },
    );
    expectNear(visualOf(live, "pic").size, [1.25, 0.625]);
    expectNear(visualOf(live, "a").size, [0.5, 0.75]);
    // Texture px and insets stay px.
    expect(visualOf(live, "pic").nineSlice).toEqual([1, 2, 3, 4]);
  });

  it("takes the block's fields over the info's", () => {
    const { live } = loaded([
      marker("pic", {
        asset: "crate",
        size: [0.1, 0.12],
        anchor: [0, 0],
        nineSlice: [0, 0, 0, 0],
        alpha: 0.5,
        tile: true,
        flipY: true,
      }),
    ]);
    expect(visualOf(live, "pic")).toMatchObject({
      size: [0.1, 0.12],
      anchor: [0, 0],
      nineSlice: [0, 0, 0, 0],
      alpha: 0.5,
      tile: true,
      flipY: true,
      fallback: { shape: { type: "box", cx: 0.05, cy: -0.06, hw: 0.05, hh: 0.06 } },
    });
  });

  it("draws an atlas frame at its size and pivot, cut from the atlas's texture", () => {
    const { live } = loaded([
      marker("a", { asset: "hero", frame: "idle-0" }),
      marker("b", { asset: "hero", frame: "run-0" }),
    ]);
    expect(visualOf(live, "a")).toMatchObject({
      texture: SHEET,
      size: [0.16, 0.24],
      anchor: [0.5, 1],
    });
    expect(visualOf(live, "b")).toMatchObject({ texture: SHEET, anchor: [0.5, 0.5] });
    expect(visualOf(live, "a").nineSlice).toBeUndefined();
  });

  it("draws only the fallback box without a usable asset, sampled as the context says", () => {
    const { live } = loaded(
      [
        marker("none", {}),
        marker("frameless", { asset: "hero" }),
        marker("unknown", { asset: "hero", frame: "nope" }),
      ],
      { sampling: "nearest" },
    );
    for (const id of ["none", "frameless", "unknown"]) {
      expect(visualOf(live, id)).toMatchObject({
        texture: null,
        size: [0.32, 0.32],
        anchor: [0.5, 0.5],
        sampling: "nearest",
      });
    }
    const bare = loaded([marker("pic", { asset: "sheet" })], { withProject: false });
    expect(visualOf(bare.live, "pic")).toMatchObject({ texture: null, sampling: "linear" });
  });

  it("draws on its layer's draw order", () => {
    const { live } = loaded([
      marker("back", { asset: "crate" }, { layer: "decor" }),
      marker("front", { asset: "crate" }),
    ]);
    expect(live.get(spriteViewId("back"))?.layer).toBe(5);
    expect(live.get(spriteViewId("front"))?.layer).toBe(10);
  });

  it("draws where its entity's own visuals would, falling back to its type's default layer", () => {
    const box = { type: "box", cx: 0, cy: 0, hw: 0.1, hh: 0.1, rotDeg: 0 } as const;
    const wall = (id: string, layer?: string, sprite?: Record<string, unknown>): RuntimeEntity => ({
      id,
      type: "solid",
      shape: box,
      ...(layer ? { layer } : {}),
      ...(sprite ? { behaviors: { sprite } } : {}),
    });
    const { live } = loaded([
      marker("named", { asset: "crate" }, { layer: "decor" }),
      marker("unknown", { asset: "crate" }, { layer: "nowhere" }),
      marker("bare", { asset: "crate" }),
      wall("decor-sprite", "decor", { asset: "crate" }),
      wall("decor-shape", "decor"),
      wall("unknown-sprite", "nowhere", { asset: "crate" }),
      wall("bare-sprite", undefined, { asset: "crate" }),
    ]);
    const order = (id: string) => live.get(spriteViewId(id))?.layer;
    // The same orders as before: a named layer's, else the type's default (gameplay, or terrain for walls).
    expect([order("named"), order("unknown"), order("bare")]).toEqual([5, 10, 10]);
    expect([order("decor-sprite"), order("unknown-sprite"), order("bare-sprite")]).toEqual([
      5, 10, 10,
    ]);
    // On the layer the entity's own visuals draw on.
    expect(order("decor-sprite")).toBe(live.get("decor-shape")?.layer);
  });
});

describe("tint and blend", () => {
  const solid = (
    id: string,
    sprite: Record<string, unknown>,
    material?: string,
  ): RuntimeEntity => ({
    id,
    type: "solid",
    shape: { type: "box", cx: 0, cy: 0, hw: 0.1, hh: 0.1, rotDeg: 0 },
    ...(material ? { material } : {}),
    behaviors: { sprite },
  });

  it("are the block's, else the material's, else unset", () => {
    const { live } = loaded([
      solid("own", { asset: "crate", tint: 0x123456, blend: "multiply" }, "glass"),
      solid("mat", { asset: "crate" }, "glass"),
      solid("bare", { asset: "crate" }),
    ]);
    expect(visualOf(live, "own")).toMatchObject({ tint: 0x123456, blend: "multiply" });
    expect(visualOf(live, "mat")).toMatchObject({ tint: 0x00ff00, blend: "add" });
    expect(visualOf(live, "bare").tint).toBeUndefined();
    expect(visualOf(live, "bare").blend).toBeUndefined();
  });

  it("a render-only project material lends none: it never reaches registry.materials", () => {
    const registry = createRegistry(null, { materials: { glass: GLASS, paint: PAINT } });
    expect(registry.materials.get("glass")).toMatchObject({ tint: 0x00ff00, blend: "add" });
    expect(registry.materials.has("paint")).toBe(false);
  });

  it("an entity with a sprite isn't drawn in its type's style", () => {
    const { live } = loaded([solid("own", { asset: "crate" })]);
    expect(live.has("own")).toBe(false);
    expect(live.has(spriteViewId("own"))).toBe(true);
    const unsprited = loaded([{ ...solid("x", {}), behaviors: undefined } as RuntimeEntity]);
    expect(unsprited.live.has("x")).toBe(true);
    expect(unsprited.live.has(spriteViewId("x"))).toBe(false);
  });
});

describe("transforms", () => {
  it("a flipped instance draws a mirrored sprite, its offset mirrored", () => {
    const { live } = loaded([
      marker(
        "flip",
        { asset: "crate", offset: [0.1, -0.04] },
        { transform: { turn: 0, flip: true } },
      ),
      marker("both", { asset: "crate", flipX: true }, { transform: { turn: 0, flip: true } }),
      marker("plain", { asset: "crate", offset: [0.1, -0.04], anchor: [0, 0] }),
    ]);
    const xyr = (id: string) => {
      const { x, y, rot } = live.get(spriteViewId(id))!.pose;
      return [x, y, rot];
    };
    expect(visualOf(live, "flip").flipX).toBe(true);
    expectNear(xyr("flip"), [0.9, 1.96, 0]);
    expect(visualOf(live, "both").flipX).toBeUndefined();
    expect(visualOf(live, "plain").flipX).toBeUndefined();
    expectNear(xyr("plain"), [1.1, 1.96, 0]);
  });

  it("a turned box draws a turned sprite, its offset turned", () => {
    const turned: RuntimeEntity = {
      id: "wall",
      type: "solid",
      shape: { type: "box", cx: 0.5, cy: 0.6, hw: 0.1, hh: 0.2, rotDeg: 90 },
      transform: { turn: 1, flip: false },
      behaviors: { sprite: { asset: "crate", offset: [0.1, 0] } },
    };
    const { live } = loaded([turned]);
    const pose = live.get(spriteViewId("wall"))!.pose;
    expect(pose.rot).toBeCloseTo(Math.PI / 2);
    expect(pose.x).toBeCloseTo(0.5, 6);
    expect(pose.y).toBeCloseTo(0.7, 6);
  });

  it("with turn: false, stays upright and turns its offset by the quarter turns only", () => {
    const { live } = loaded([
      marker(
        "up",
        { asset: "crate", offset: [0.1, 0], turn: false },
        { transform: { turn: 1, flip: false } },
      ),
    ]);
    const up = live.get(spriteViewId("up"))!.pose;
    expectNear([up.x, up.y, up.rot], [1, 2.1, 0]);
  });

  it("a sprite on a prop rotates with its body", () => {
    const prop: RuntimeEntity = {
      id: "crate",
      type: "prop",
      shape: { type: "box", cx: 0, cy: 0, hw: 0.1, hh: 0.1, rotDeg: 0 },
      density: 1,
      restitution: 0,
      behaviors: { sprite: { asset: "crate", offset: [0, -0.1] } },
    };
    const { rt, live, calls } = loaded([prop]);
    rt.ctx.physics!.world.forEachRigidBody((b) => {
      if (b.isDynamic()) b.setAngvel(3, true);
    });
    for (let i = 0; i < 10; i++) rt.step(DT, []);
    const body = rt.ctx.poses.get("crate")!;
    expect(body.rot).toBeGreaterThan(0.3);
    const pose = live.get(spriteViewId("crate"))!.pose;
    expect(pose.rot).toBeCloseTo(body.rot);
    expect(pose.x).toBeCloseTo(body.x + 0.1 * Math.sin(body.rot), 6);
    expect(pose.y).toBeCloseTo(body.y - 0.1 * Math.cos(body.rot), 6);
    expect(
      poseCalls(calls, "crate")
        .slice(1)
        .every((c) => c.snap === false),
    ).toBe(true);
  });
});

describe("posing", () => {
  it("re-poses only when the pose changes, snapping on a teleport", () => {
    const { rt, calls } = loaded([marker("pic", { asset: "crate" })]);
    rt.step(DT, []);
    expect(poseCalls(calls, "pic")).toHaveLength(1);
    rt.ctx.poses.set("pic", 3, 3, 0, { snap: true });
    rt.step(DT, []);
    rt.ctx.poses.set("pic", 3.1, 3, 0);
    rt.step(DT, []);
    rt.step(DT, []);
    expect(poseCalls(calls, "pic").map(({ x, snap }) => [x, snap])).toEqual([
      [1, true],
      [3, true],
      [3.1, false],
    ]);
  });

  it("update redraws, detach removes, unload clears", () => {
    const { rt, live, callsFor } = loaded([marker("pic", { asset: "crate" })]);
    const sid = spriteViewId("pic");
    rt.update([marker("pic", { asset: "crate", tint: 0xabcdef })]);
    expect(callsFor(sid, "sprite")).toHaveLength(2);
    expect(visualOf(live, "pic").tint).toBe(0xabcdef);
    rt.update([{ id: "pic", type: "marker", at: [1, 2] } as RuntimeEntity]);
    expect(live.has(sid)).toBe(false);
    rt.update([marker("pic", { asset: "crate" })]);
    expect(live.has(sid)).toBe(true);
    rt.unload();
    expect(live.has(sid)).toBe(false);
    expect(rt.ctx.behavior(SPRITE.name)?.size()).toBe(0);
  });
});

describe("spriteGeometry", () => {
  it("falls back from the block's size to the info's px over px per metre times scale to 0.32 m", () => {
    expect(spriteGeometry({ size: [4, 6], scale: 3 }, { size: [10, 10] }).size).toEqual([4, 6]);
    expect(spriteGeometry({ scale: 3 }, { size: [10, 20] }).size).toEqual([0.3, 0.6]);
    expectNear(spriteGeometry({ scale: 3 }, { size: [10, 20] }, 32).size, [0.9375, 1.875]);
    expect(spriteGeometry({ scale: 3 }).size).toEqual([0.32, 0.32]);
  });

  it("anchors at the block's, else the pivot, else the centre, and mirrors its box with the flips", () => {
    expect(spriteGeometry({}, { pivot: [0, 1] }).anchor).toEqual([0, 1]);
    expect(spriteGeometry({ anchor: [1, 0] }, { pivot: [0, 1] }).anchor).toEqual([1, 0]);
    const g = spriteGeometry({ size: [20, 10], anchor: [0, 0], offset: [3, 4] });
    expect(g).toEqual({
      size: [20, 10],
      anchor: [0, 0],
      offset: [3, 4],
      box: { type: "box", cx: 10, cy: 5, hw: 10, hh: 5, rotDeg: 0 },
    });
    expect(
      spriteGeometry({ size: [20, 10], anchor: [0, 0], flipX: true, flipY: true }).box,
    ).toEqual({ type: "box", cx: -10, cy: -5, hw: 10, hh: 5, rotDeg: 0 });
  });

  it("carries a frame's rectangle when the info has one", () => {
    const rect = { x: 16, y: 0, w: 16, h: 24 };
    expect(spriteGeometry({}, { size: [16, 24], rect }).frame).toEqual(rect);
    expect(spriteGeometry({}, { size: [16, 24] }).frame).toBeUndefined();
  });
});

describe("spriteAssets", () => {
  const lookupOf = (v: typeof view) => (id: string, frame?: string) => assetInfo(v, id, frame);

  it("gives a texture as both info and texture, an atlas its frame and its texture, and nothing without a frame", () => {
    const lookup = lookupOf(view);
    const pic = spriteAssets(lookup, { asset: "crate" });
    expect(pic.info).toBe(pic.texture);
    expect(pic.info?.size).toEqual([40, 20]);
    const cut = spriteAssets(lookup, { asset: "hero", frame: "run-0" });
    expect(cut.info).toMatchObject({ size: [16, 24], rect: { x: 16, y: 0, w: 16, h: 24 } });
    expect(cut.texture?.id).toBe("sheet");
    expect(spriteAssets(lookup, { asset: "hero" })).toEqual({});
    expect(spriteAssets(lookup, { asset: "hero", frame: "nope" })).toEqual({});
    expect(spriteAssets(undefined, { asset: "crate" })).toEqual({});
  });

  it("anchors an atlas frame at its pivot, else its texture's import pivot, else the centre", () => {
    const lookup = lookupOf(viewOf({ sheet: { import: { pivot: [0, 1] } } }));
    const anchor = (frame: string) =>
      spriteGeometry({}, spriteAssets(lookup, { asset: "hero", frame }).info).anchor;
    expect(anchor("idle-0")).toEqual([0.5, 1]);
    expect(anchor("run-0")).toEqual([0, 1]);
    const bare = (id: string, frame?: string) => assetInfo(view, id, frame);
    expect(
      spriteGeometry({}, spriteAssets(bare, { asset: "hero", frame: "run-0" }).info).anchor,
    ).toEqual([0.5, 0.5]);
  });
});

describe("spriteOffset", () => {
  it("mirrors with the flip, then turns with the pose, else with the quarter turns only", () => {
    expect(spriteOffset([3, 4], undefined, 0)).toEqual([3, 4]);
    expect(spriteOffset([3, 4], { turn: 0, flip: true }, 0)).toEqual([-3, 4]);
    expect(spriteOffset([3, 4], undefined, Math.PI / 2)).toEqual([-4, 3]);
    expect(spriteOffset([3, 4], { turn: 1, flip: false }, null)).toEqual([-4, 3]);
    expect(spriteOffset([3, 4], { turn: 2, flip: true }, null)).toEqual([3, -4]);
    const [x, y] = spriteOffset([10, 0], undefined, Math.PI / 6);
    expect(x).toBeCloseTo(10 * Math.cos(Math.PI / 6));
    expect(y).toBeCloseTo(5);
  });
});

describe("hot reload", () => {
  const NEW_TEX = "d".repeat(64);
  const NEW_SHEET = "e".repeat(64);

  it("re-attaches the sprites naming a changed asset with its new info, and only those", () => {
    const { rt, live, callsFor } = loaded([
      marker("pic", { asset: "crate" }),
      marker("hero", { asset: "hero", frame: "idle-0" }),
      marker("plain", {}),
    ]);
    rt.step(DT, []);
    const tick = rt.ctx.tick;
    const next = viewOf({
      crate: { sha256: NEW_TEX, meta: { format: "png", width: 50, height: 20 } },
    });
    rt.reloadAssets(runtimeView(next, new Map(), rt.ctx.registry), ["crate"]);
    expect(visualOf(live, "pic")).toMatchObject({ texture: NEW_TEX, size: [0.5, 0.2] });
    expect(callsFor(spriteViewId("pic"), "sprite")).toHaveLength(2);
    expect(callsFor(spriteViewId("hero"), "sprite")).toHaveLength(1);
    expect(callsFor(spriteViewId("plain"), "sprite")).toHaveLength(1);
    expect(rt.ctx.tick).toBe(tick);
    expect(rt.ctx.project?.asset("crate")?.sha256).toBe(NEW_TEX);
  });

  it("redraws an atlas's sprites when its texture changes", () => {
    const { rt, live, callsFor } = loaded([marker("hero", { asset: "hero", frame: "idle-0" })]);
    const next = viewOf({ sheet: { sha256: NEW_SHEET } });
    rt.reloadAssets(runtimeView(next, new Map(), rt.ctx.registry), ["sheet"]);
    expect(visualOf(live, "hero")).toMatchObject({ texture: NEW_SHEET, size: [0.16, 0.24] });
    expect(callsFor(spriteViewId("hero"), "sprite")).toHaveLength(2);
  });

  it("keeps an updated entity's latest block and pose", () => {
    const { rt, live } = loaded([marker("pic", { asset: "crate" })]);
    rt.update([marker("pic", { asset: "crate", tint: 0x123456 }, { at: [0.1, 0.2] })]);
    const next = viewOf({ crate: { sha256: NEW_TEX } });
    rt.reloadAssets(runtimeView(next, new Map(), rt.ctx.registry), ["crate"]);
    expect(visualOf(live, "pic")).toMatchObject({ texture: NEW_TEX, tint: 0x123456 });
    expect(live.get(spriteViewId("pic"))?.pose).toMatchObject({ x: 0.1, y: 0.2 });
  });
});
