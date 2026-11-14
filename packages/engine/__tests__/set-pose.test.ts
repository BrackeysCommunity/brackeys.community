import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { BehaviorBlock } from "../game/behaviors";
import type { CharacterSystem } from "../game/behaviors/character-top-down";
import type { PathFollowSystem } from "../game/behaviors/path-follow";
import { DEFAULT_ACTIONS } from "../game/defaults";
import { createRegistry, defineEntityType, defineGame } from "../game/define";
import { pointField } from "../game/fields";
import { heldProject } from "../project/runtime-view";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type SceneDefinition,
  type SceneSettings,
} from "../scene/types";
import { createDataSystem } from "../systems/data";
import type { RapierModule } from "../types";
import { readHeld } from "./fixtures/held-project";
import { engineErrorCode, stepEvents } from "./fixtures/tree-rig";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

/** A game type whose entities are data: `createDataSystem` gives it `setPose`. */
const BEACON = defineEntityType({
  type: "beacon",
  description: "A point a game reads.",
  system: createDataSystem,
  fields: { at: pointField("Where it is.") },
});

/** A game type whose own system has no `setPose`. */
const STATUE = defineEntityType({
  type: "statue",
  description: "Something nothing may move.",
  system: () => ({
    spawn() {},
    despawn() {},
    clear() {},
    size: () => 0,
  }),
  fields: { at: pointField("Where it stands.") },
});

const game = defineGame({
  id: "posers",
  types: [BEACON, STATUE],
  actions: [...DEFAULT_ACTIONS],
  input: { players: { max: 1, join: "auto" } },
  time: { kind: "fixed", rate: 60 },
  createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
});
const registry = createRegistry(game);

/** The engine project's hero atlas and kitchen animation, for an `anim` carrier. */
const engineArt = heldProject(
  readHeld(fileURLToPath(new URL("../scenes/", import.meta.url)), (path) =>
    ["art/hero.json", "art/kitchen.animation.json"].includes(path),
  ).files,
  registry,
  { projectId: "p", name: "P" },
).runtime;

const BACKENDS = ["none", "rapier"] as const;
type Physics = (typeof BACKENDS)[number];

const BOX = ["box", 0, 0, 0.25, 0.25];

const marker = (id: string, at: [number, number], behaviors: Record<string, BehaviorBlock>) =>
  ({ id, type: "marker", at, behaviors }) as EntityDef;

/** One entity per standard behavior that runs headless, each on its own row. */
function carriers(physics: Physics): EntityDef[] {
  const row = (i: number): [number, number] => [0, i * 2];
  return [
    { id: "floor", type: "nav", shape: ["box", 0, -2, 60, 40] } as EntityDef,
    marker("fixed", row(0), { collider: { shape: BOX } }),
    marker("kinematic", row(1), { collider: { shape: BOX }, body: { kind: "kinematic" } }),
    ...(physics === "rapier"
      ? [
          marker("dynamic", row(2), { collider: { shape: BOX }, body: { kind: "dynamic" } }),
          marker("tether", row(14), { collider: { shape: BOX }, body: { kind: "kinematic" } }),
          marker("roped", row(15), {
            collider: { shape: BOX },
            body: { kind: "dynamic" },
            joint: { kind: "rope", to: "tether", length: 3 },
          }),
        ]
      : []),
    marker("walker", row(3), { collider: { shape: BOX }, "character-top-down": {} }),
    marker("jumper", row(4), { collider: { shape: BOX }, "character-side-view": {} }),
    marker("agent", row(5), { collider: { shape: BOX }, "nav-agent": {} }),
    marker("seated", row(6), { collider: { shape: BOX }, "player-input": { seat: 0 } }),
    marker("timed", row(7), { lifetime: { ticks: 1000 } }),
    marker("area", row(8), {
      collider: { shape: BOX, sensor: true },
      "force-area": { force: [1, 0] },
    }),
    marker("framed", row(9), { "camera-target": {} }),
    marker("tweened", row(10), {
      collider: { shape: BOX },
      tween: { tweens: [{ to: { rot: 0 }, duration: 1 }] },
    }),
    { id: "prop", type: "prop", shape: ["box", 0, 22, 0.25, 0.25], density: 1, restitution: 0 },
    { id: "beacon", type: BEACON.type, at: [0, 24] } as EntityDef,
    marker("spawning", row(13), { spawner: { type: "marker", rate: 2, cap: 10 } }),
    marker("animated", row(16), {
      sprite: { asset: "hero", frame: "hero-0" },
      anim: { source: "kitchen-animation", clip: "idle" },
    }),
  ].filter((e) => physics === "rapier" || e.type !== "prop");
}

function scene(
  entities: EntityDef[],
  physics: Physics,
  settings: Partial<SceneSettings> = {},
): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: "posers",
    name: "posers",
    bounds: [-60, -60, 60, 60],
    settings: { physics, gravity: [0, 0], ...settings },
    entities,
  };
}

function load(entities: EntityDef[], physics: Physics, settings: Partial<SceneSettings> = {}) {
  const rt = createSceneRuntime({
    rapier: physics === "rapier" ? rapier : null,
    view: null,
    game,
    project: engineArt,
  });
  const report = rt.load(expandScene(scene(entities, physics, settings), registry));
  if (!report.ok) throw new Error(report.error);
  const steps = (n: number) => void stepEvents(rt, n);
  return { rt, steps };
}

/** What the space finds at a point: the collider ids there. */
function idsAt(rt: ReturnType<typeof load>["rt"], x: number, y: number): string[] {
  const probe = { type: "circle" as const, cx: x, cy: y, r: 0.05 };
  return rt.ctx.space
    .overlaps(probe, { group: "dynamic" })
    .map((h) => h.tag.entityId)
    .sort();
}

/** Where `teleportHolds` puts the `i`th entity it moves. */
const target = (i: number) => ({ x: 30, y: i * 2 + 1, rot: 0.5 });

/** Sets each of `ids` to its own `target`, steps 60 ticks, and checks each stayed there. */
function teleportHolds(rt: SceneRuntimeHandle, steps: (n: number) => void, ids: string[]): void {
  ids.forEach((id, i) => {
    const t = target(i);
    rt.ctx.setPose(id, t.x, t.y, t.rot);
  });
  for (const [i, id] of ids.entries()) expect(rt.ctx.poses.get(id), id).toMatchObject(target(i));
  steps(60);
  for (const [i, id] of ids.entries()) {
    const t = target(i);
    const p = rt.ctx.poses.get(id)!;
    expect(p.x, id).toBeCloseTo(t.x, 6);
    expect(p.y, id).toBeCloseTo(t.y, 6);
  }
}

for (const physics of BACKENDS) {
  describe(`ctx.setPose on physics: ${physics}`, () => {
    it("moves an entity carrying each standard behavior, and nothing snaps back", () => {
      const entities = carriers(physics);
      const { rt, steps } = load(entities, physics);
      expect(rt.stats().behaviors).toMatchObject({
        spawner: 1,
        anim: 1,
        ...(physics === "rapier" ? { joint: 1 } : {}),
      });
      steps(2);
      const moved = entities.filter((e) => e.type !== "nav").map((e) => e.id);
      teleportHolds(rt, steps, moved);
      // Every collider is where its entity went, and none is left where it was.
      for (const id of ["fixed", "kinematic", "walker", "jumper", "agent", "seated", "tweened"]) {
        const t = target(moved.indexOf(id));
        const [x0, y0] = entities.find((e) => e.id === id)!.at as [number, number];
        expect(idsAt(rt, t.x, t.y), id).toContain(id);
        expect(idsAt(rt, x0, y0), id).not.toContain(id);
      }
      const characters = rt.ctx.behavior<CharacterSystem>("character-top-down")!;
      expect(characters.velocity("walker")).toEqual({ x: 0, y: 0 });
      const placed = new Set(entities.map((e) => e.id));
      const spawns = rt.ctx.entities().filter((e) => !placed.has(e.id));
      expect(spawns.length).toBeGreaterThan(0);
      const at = target(moved.indexOf("spawning"));
      for (const e of spawns)
        expect(rt.ctx.poses.get(e.id), e.id).toMatchObject({ x: at.x, y: at.y });
      rt.destroy();
    });

    it("moves an occupant's grid cell with it, and nothing snaps back", () => {
      const { rt, steps } = load(
        [
          marker("standing", [0.5, 0.5], { occupant: {} }),
          marker("walking", [0.5, 2.5], {
            collider: { shape: BOX },
            "character-top-down": {},
            occupant: {},
          }),
        ],
        physics,
        { grid: { kind: "square", cell: [1, 1] } },
      );
      steps(2);
      const occupancy = rt.ctx.grid!.occupancy;
      expect(occupancy.at([0, 0])).toEqual(["standing"]);
      teleportHolds(rt, steps, ["standing", "walking"]);
      expect(occupancy.cellOf("standing")).toEqual([30, 1]);
      expect(occupancy.cellOf("walking")).toEqual([30, 3]);
      expect(occupancy.at([0, 0])).toEqual([]);
      expect(occupancy.at([0, 2])).toEqual([]);
      rt.destroy();
    });

    it("snaps the pose with `snap`, and eases it without", () => {
      const { rt, steps } = load(
        [marker("walker", [0, 0], { collider: { shape: BOX }, "character-top-down": {} })],
        physics,
      );
      steps(1);
      rt.ctx.setPose("walker", 3, 0);
      expect(rt.ctx.poses.prev("walker")).toMatchObject({ x: 0, y: 0 });
      rt.ctx.setPose("walker", 5, 0, undefined, { snap: true });
      expect(rt.ctx.poses.prev("walker")).toMatchObject({ x: 5, y: 0 });
      rt.destroy();
    });

    it("moves a game type built on createDataSystem in the pose index", () => {
      const { rt, steps } = load(
        [{ id: "b", type: BEACON.type, at: [1, 1] } as EntityDef],
        physics,
      );
      rt.ctx.setPose("b", 4, -2, 1);
      steps(10);
      expect(rt.ctx.poses.get("b")).toEqual({ x: 4, y: -2, rot: 1 });
      rt.destroy();
    });

    it("refuses a follower, a nav area, a camera region and a type with no setPose", () => {
      const { rt } = load(
        [
          {
            id: "lift",
            type: "follower",
            shape: ["box", 0, 0, 0.5, 0.1],
            path: {
              pts: [
                [0, 0],
                [4, 0],
              ],
              mode: "loop",
              speed: 1,
            },
          } as EntityDef,
          { id: "floor", type: "nav", shape: ["box", 0, 0, 10, 10] } as EntityDef,
          { id: "room", type: "camera-region", shape: ["box", 0, 0, 10, 10] } as EntityDef,
          { id: "statue", type: STATUE.type, at: [0, 0] } as EntityDef,
        ],
        physics,
      );
      for (const id of ["lift", "floor", "room", "statue"])
        expect(
          engineErrorCode(() => rt.ctx.setPose(id, 1, 1)),
          id,
        ).toBe("pose-not-settable");
      expect(engineErrorCode(() => rt.ctx.setPose("nobody", 1, 1))).toBe("entity-gone");
      rt.destroy();
    });

    it("takes path-follow's last position from the pose, so the jump is no travel", () => {
      const path = {
        pts: [
          [0, 0],
          [10, 0],
        ],
        mode: "loop",
        speed: 1,
      };
      const riders = [
        marker("rider", [0, 0], { "path-follow": { path } }),
        marker("platform", [0, 2], {
          collider: { shape: BOX },
          body: { kind: "kinematic" },
          "path-follow": {
            path: {
              ...path,
              pts: [
                [0, 2],
                [10, 2],
              ],
            },
          },
        }),
      ];
      const { rt, steps } = load(riders, physics);
      const twin = load(riders, physics);
      const follow = rt.ctx.behavior<PathFollowSystem>("path-follow")!;
      steps(30);
      twin.steps(30);
      rt.ctx.setPose("rider", 5, 7);
      rt.ctx.setPose("platform", 5, 9);
      expect(follow.position("rider")).toEqual({ x: 5, y: 7 });
      expect(follow.position("platform")).toEqual({ x: 5, y: 9 });
      expect(follow.frameDelta("platform") ?? { x: 0, y: 0 }).toEqual({ x: 0, y: 0 });
      expect(idsAt(rt, 5, 9)).toContain("platform");
      // Its path still owns it: it goes on from where an untouched twin is.
      steps(60);
      twin.steps(60);
      for (const id of ["rider", "platform"]) {
        const got = rt.ctx.poses.get(id)!;
        const want = twin.rt.ctx.poses.get(id)!;
        expect(got.x, id).toBeCloseTo(want.x, 6);
        expect(got.y, id).toBeCloseTo(want.y, 6);
      }
      rt.destroy();
      twin.rt.destroy();
    });

    it("moves a tweened entity's collider through setPose", () => {
      const { rt, steps } = load(
        [
          marker("door", [0, 0], {
            collider: { shape: BOX },
            tween: { tweens: [{ to: { x: 6 }, duration: 10 }] },
          }),
        ],
        physics,
      );
      steps(12);
      expect(rt.ctx.poses.get("door")).toMatchObject({ x: 6, y: 0 });
      expect(idsAt(rt, 6, 0)).toContain("door");
      expect(idsAt(rt, 0, 0)).not.toContain("door");
      rt.destroy();
    });
  });
}

describe("ctx.setPose on bodies", () => {
  it("brings an entity posed while disabled back where it was put", () => {
    const { rt, steps } = load(
      [
        { id: "crate", type: "prop", shape: BOX, density: 1, restitution: 0 } as EntityDef,
        marker("walker", [0, 4], { collider: { shape: BOX }, "character-top-down": {} }),
        marker("lift", [0, 8], { collider: { shape: BOX }, body: { kind: "kinematic" } }),
      ],
      "rapier",
    );
    steps(1);
    for (const [id, y] of [
      ["crate", 0],
      ["walker", 4],
      ["lift", 8],
    ] as const) {
      rt.ctx.setEnabled(id, false);
      rt.ctx.setPose(id, 20, y);
      rt.ctx.setEnabled(id, true);
    }
    steps(1);
    for (const [id, y] of [
      ["crate", 0],
      ["walker", 4],
      ["lift", 8],
    ] as const) {
      expect(rt.ctx.poses.get(id), id).toMatchObject({ x: 20 });
      expect(idsAt(rt, 20, y), id).toEqual([id]);
      expect(idsAt(rt, 0, y), id).toEqual([]);
    }
    rt.destroy();
  });

  it("keeps a prop's velocity and wakes it", () => {
    const { rt, steps } = load(
      [{ id: "crate", type: "prop", shape: BOX, density: 1, restitution: 0 } as EntityDef],
      "rapier",
    );
    rt.ctx.bodies.setVelocity("crate", { x: 1, y: 0 });
    steps(1);
    rt.ctx.setPose("crate", 10, 5, 0);
    expect(rt.ctx.bodies.velocity("crate").x).toBeCloseTo(1, 6);
    steps(60);
    const p = rt.ctx.poses.get("crate")!;
    expect(p.x).toBeCloseTo(11, 2);
    expect(p.y).toBeCloseTo(5, 6);
    rt.destroy();
  });

  it("keeps a dynamic collider body's velocity", () => {
    const { rt, steps } = load(
      [marker("ball", [0, 0], { collider: { shape: BOX }, body: { kind: "dynamic" } })],
      "rapier",
    );
    rt.ctx.bodies.setVelocity("ball", { x: 0, y: 2 });
    steps(1);
    rt.ctx.setPose("ball", -8, 0);
    expect(rt.ctx.bodies.velocity("ball").y).toBeCloseTo(2, 6);
    steps(30);
    const p = rt.ctx.poses.get("ball")!;
    expect(p.x).toBeCloseTo(-8, 6);
    expect(p.y).toBeCloseTo(1, 2);
    rt.destroy();
  });

  it("keeps a kinematic collider body's velocity on both backends", () => {
    for (const physics of BACKENDS) {
      const { rt, steps } = load(
        [marker("lift", [0, 0], { collider: { shape: BOX }, body: { kind: "kinematic" } })],
        physics,
      );
      rt.ctx.bodies.setVelocity("lift", { x: 0, y: 1 });
      steps(1);
      rt.ctx.setPose("lift", 4, 0);
      steps(60);
      const p = rt.ctx.poses.get("lift")!;
      expect(p.x, physics).toBeCloseTo(4, 6);
      expect(p.y, physics).toBeCloseTo(1, 2);
      rt.destroy();
    }
  });
});
