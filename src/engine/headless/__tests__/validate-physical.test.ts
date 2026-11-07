// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { AVATAR_FLOATING, checkedTestGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { createSceneRuntime } from "../../runtime/runtime";
import { expandScene } from "../../scene/expand";
import { formatScene } from "../../scene/format";
import { parseSceneOrThrow } from "../../scene/parse";
import type { EntityDef, SceneDefinition } from "../../scene/types";
import type { RapierModule } from "../../types";
import { physicalEnv, runPhysicalChecks, validatePhysical } from "../validate-physical";

const engine = createRegistry();
const game = createRegistry(checkedTestGame);
const yardText = readFileSync(new URL("../../scenes/engine-yard.json", import.meta.url), "utf8");
const yard: SceneDefinition = parseSceneOrThrow(yardText, engine);

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

function scene(over: Partial<SceneDefinition> = {}, entities: EntityDef[] = []): SceneDefinition {
  return {
    v: 1,
    name: "t",
    bounds: [0, 0, 1000, 1000],
    solid: [["box", 500, 920, 400, 20]],
    entities,
    ...over,
  };
}

const lift = (pts: [number, number][], mode: "loop" | "ping_pong"): EntityDef => ({
  id: "lift",
  type: "follower",
  shape: ["box", 0, 0, 40, 8],
  path: { pts, mode, speed: 60 },
});

const check = (def: SceneDefinition, registry = engine) =>
  validatePhysical({ rapier, scene: def, registry, lines: formatScene(def).lines });

describe("validatePhysical", () => {
  it("reports engine-yard's walls standing in its floor, and nothing else", () => {
    const issues = check(yard);
    expect(issues.map((i) => [i.code, i.entityIds])).toEqual([
      ["solid-overlap", ["~solid:1", "~solid:0"]],
      ["solid-overlap", ["~solid:2", "~solid:0"]],
    ]);
    expect(issues[0]).toMatchObject({ severity: "info", path: "/solid/1", at: [20, 962] });
    expect(issues[0]!.line).toBeTypeOf("number");
  });

  it("follower-hits-solid: a segment that runs into a static solid, with the impact point", () => {
    const issues = check(
      scene({}, [
        lift(
          [
            [500, 600],
            [500, 920],
          ],
          "ping_pong",
        ),
      ]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "follower-hits-solid",
      severity: "warn",
      path: "/entities/0/path/pts/0",
      entityIds: ["lift", "~solid:0"],
    });
    expect(issues[0]!.at![1]).toBe(900);
    expect(issues[0]!.message).toContain("segment 0 ([500, 600] → [500, 920])");
  });

  it("follower-hits-solid: checks a loop's closing segment, and not a flush slide", () => {
    // The lift's bottom is flush with the floor's top on the first segment.
    const pts: [number, number][] = [
      [200, 892],
      [800, 892],
      [800, 500],
    ];
    expect(check(scene({}, [lift(pts, "ping_pong")]))).toEqual([]);
    const issues = check(
      scene(
        {
          solid: [
            ["box", 500, 920, 400, 20],
            ["box", 500, 700, 20, 20],
          ],
        },
        [lift(pts, "loop")],
      ),
    );
    expect(issues.map((i) => [i.code, i.path, i.entityIds])).toEqual([
      ["follower-hits-solid", "/entities/0/path/pts/2", ["lift", "~solid:1"]],
    ]);
    expect(issues[0]!.message).toContain("closing segment 2");
  });

  it("solid-overlap: only solids that could merge (same type, material, one-way)", () => {
    const def = scene({
      solid: [
        ["box", 500, 920, 400, 20],
        ["box", 880, 900, 40, 40],
      ],
    });
    expect(check(def).map((i) => [i.code, i.path])).toEqual([["solid-overlap", "/solid/1"]]);
    const oneWay = scene({}, [
      { id: "ledge", type: "solid", shape: ["box", 880, 900, 40, 40], oneWay: true },
    ]);
    expect(check(oneWay)).toEqual([]);
    const touching = scene({
      solid: [
        ["box", 500, 920, 400, 20],
        ["box", 940, 920, 40, 20],
      ],
    });
    expect(check(touching)).toEqual([]);
  });

  it("runs the game's physical checks after the engine's", () => {
    const floating = parseSceneOrThrow(
      JSON.stringify({
        ...JSON.parse(yardText),
        solid: [["box", 20, 500, 20, 500]],
        entities: [
          {
            id: "avatar",
            type: "prop",
            shape: ["box", 300, 940, 20, 20],
            density: 1,
            restitution: 0,
          },
        ],
      }),
      game,
    );
    expect(check(floating, game).map((i) => i.code)).toEqual([AVATAR_FLOATING]);
    expect(check(yard, game)).toHaveLength(2);
  });

  it("returns nothing for a scene that doesn't load or names another game", () => {
    expect(check({ ...yard, game: "other" })).toEqual([]);
  });

  it("runs on an already loaded world, which it leaves as it found it", () => {
    const runtime = createSceneRuntime({ rapier, view: null, registry: engine });
    try {
      runtime.load(expandScene(yard, engine));
      const before = runtime.stats();
      const env = physicalEnv(runtime, yard)!;
      expect(runPhysicalChecks(env)).toHaveLength(2);
      expect(env.overlaps({ type: "circle", cx: 900, cy: 930, r: 5 })).toEqual([]);
      expect(
        env
          .overlaps({ type: "circle", cx: 900, cy: 930, r: 5 }, { sensors: true })
          .map((h) => h.tag.entityId),
      ).toEqual(["zone"]);
      const hit = env.cast(
        { type: "box", cx: 600, cy: 900, hw: 10, hh: 10, rotDeg: 0 },
        { x: 0, y: 100 },
      );
      expect(hit?.tag.entityId).toBe("~solid:0");
      expect(hit!.toi).toBeCloseTo(0.5);
      expect(runtime.stats()).toEqual(before);
    } finally {
      runtime.destroy();
    }
  });
});
