// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { AVATAR_FLOATING, checkedTestGame } from "../../__tests__/fixtures/test-game";
import { createRegistry, defineGame } from "../../game/define";
import { createSceneRuntime } from "../../runtime/runtime";
import { expandScene } from "../../scene/expand";
import { formatScene } from "../../scene/format";
import { makeIssue } from "../../scene/issues";
import { parseSceneOrThrow } from "../../scene/parse";
import type { EntityDef, SceneDefinition, SceneIssue } from "../../scene/types";
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

const physicsFree = (def: SceneDefinition): SceneDefinition => ({
  ...def,
  settings: { ...def.settings, physics: "none" },
});

/** The same scene checked on the geometry backend: no Rapier at all. */
const checkFree = (def: SceneDefinition, registry = engine) => {
  const free = physicsFree(def);
  return validatePhysical({ rapier: null, scene: free, registry, lines: formatScene(free).lines });
};

const summary = (issues: readonly SceneIssue[]) =>
  issues.map((i) => ({ code: i.code, path: i.path, entityIds: i.entityIds, at: i.at }));

/** engine-yard without its props, which need physics. */
const yardWithoutProps: SceneDefinition = {
  ...yard,
  entities: (yard.entities ?? []).filter((e) => e.type !== "prop"),
};

const PROBE = "needy/probe";

/** A game with one check that needs physics and one that runs on either backend. */
const needy = createRegistry(
  defineGame({
    id: "needy",
    types: [],
    actions: [],
    issues: {
      [PROBE]: {
        severity: "info",
        summary: "The probe found the floor.",
        hint: "Nothing to do.",
        fixable: false,
      },
    },
    physicalChecks: [
      {
        id: "rapier-only",
        description: "Reads the Rapier world.",
        needsPhysics: true,
        run: (env) => [
          makeIssue(
            PROBE,
            { message: `${env.physics!.world.colliders.len()} colliders`, path: "" },
            env.registry.issueCodes,
          ),
        ],
      },
      {
        id: "floor",
        description: "Finds the floor under the middle of the bounds.",
        run(env) {
          const hit = env.cast({ type: "circle", cx: 500, cy: 500, r: 5 }, { x: 0, y: 500 });
          return hit
            ? [
                makeIssue(
                  PROBE,
                  { message: `floor ${hit.tag.entityId}`, path: "", entityIds: [hit.tag.entityId] },
                  env.registry.issueCodes,
                ),
              ]
            : [];
        },
      },
    ],
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

describe("validatePhysical", () => {
  it("reports engine-yard's walls standing in its floor, and nothing else", () => {
    const issues = check(yard);
    expect(issues.map((i) => [i.code, i.entityIds])).toEqual([
      ["solid-overlap", ["~solid:1", "~solid:0"]],
      ["solid-overlap", ["~solid:2", "~solid:0"]],
    ]);
    expect(issues[0]).toMatchObject({
      severity: "info",
      path: "/solid/1",
      at: [0.2, 9.8],
      message: "~solid:1 overlaps ~solid:0 by 0.4 m at [0.2, 9.8]",
    });
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
        // engine-yard is metric (v4), so the replacements are metres too.
        ...JSON.parse(yardText),
        solid: [["box", 0.2, 5, 0.2, 5]],
        entities: [
          {
            id: "avatar",
            type: "prop",
            shape: ["box", 3, 9.4, 0.2, 0.2],
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

  it("needs Rapier for a scene with physics", () => {
    expect(() => validatePhysical({ rapier: null, scene: yard, registry: engine })).toThrow(
      /physical validation needs physics/,
    );
    expect(() => validatePhysical({ scene: yard, registry: engine })).toThrow(
      /physical validation needs physics/,
    );
  });

  it("runs on an already loaded world, which it leaves as it found it", () => {
    const runtime = createSceneRuntime({ rapier, view: null, registry: engine });
    try {
      runtime.load(expandScene(yard, engine));
      const before = runtime.stats();
      const env = physicalEnv(runtime, yard)!;
      expect(runPhysicalChecks(env)).toHaveLength(2);
      expect(env.overlaps({ type: "circle", cx: 9, cy: 9.3, r: 0.05 })).toEqual([]);
      expect(
        env
          .overlaps({ type: "circle", cx: 9, cy: 9.3, r: 0.05 }, { sensors: true })
          .map((h) => h.tag.entityId),
      ).toEqual(["zone"]);
      const hit = env.cast(
        { type: "box", cx: 6, cy: 9, hw: 0.1, hh: 0.1, rotDeg: 0 },
        { x: 0, y: 1 },
      );
      expect(hit?.tag.entityId).toBe("~solid:0");
      expect(hit!.toi).toBeCloseTo(0.5);
      expect(runtime.stats()).toEqual(before);
    } finally {
      runtime.destroy();
    }
  });
});

describe("validatePhysical on a scene without physics", () => {
  it("runs the engine's checks on the geometry backend, with Rapier's answers", () => {
    const onRapier = check(yardWithoutProps);
    expect(onRapier.map((i) => i.code)).toEqual(["solid-overlap", "solid-overlap"]);
    const free = checkFree(yardWithoutProps);
    expect(free.map((i) => i.message)).toEqual(onRapier.map((i) => i.message));
    expect(summary(free)).toEqual(summary(onRapier));
    expect(free[0]!.line).toBeTypeOf("number");
  });

  it("follower-hits-solid on geometry: the same segment, solid and impact", () => {
    const def = scene({}, [
      lift(
        [
          [500, 600],
          [500, 920],
        ],
        "ping_pong",
      ),
    ]);
    const free = checkFree(def);
    const onRapier = check(def);
    // A face meeting a face has no one impact point: each backend picks its own along the edge.
    const where = (issues: readonly SceneIssue[]) =>
      issues.map((i) => [i.code, i.path, i.entityIds, i.at![1]]);
    expect(where(free)).toEqual(where(onRapier));
    expect(free[0]).toMatchObject({
      code: "follower-hits-solid",
      path: "/entities/0/path/pts/0",
      entityIds: ["lift", "~solid:0"],
    });
    expect(free[0]!.at![1]).toBe(900);
  });

  it("follower-hits-solid on geometry: a loop's closing segment, and not a flush slide", () => {
    const pts: [number, number][] = [
      [200, 892],
      [800, 892],
      [800, 500],
    ];
    expect(checkFree(scene({}, [lift(pts, "ping_pong")]))).toEqual([]);
    const issues = checkFree(
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
  });

  it("solid-overlap on geometry: only solids that could merge, and not touching ones", () => {
    const def = scene({
      solid: [
        ["box", 500, 920, 400, 20],
        ["box", 880, 900, 40, 40],
      ],
    });
    expect(checkFree(def).map((i) => [i.code, i.path])).toEqual([["solid-overlap", "/solid/1"]]);
    const oneWay = scene({}, [
      { id: "ledge", type: "solid", shape: ["box", 880, 900, 40, 40], oneWay: true },
    ]);
    expect(checkFree(oneWay)).toEqual([]);
    const touching = scene({
      solid: [
        ["box", 500, 920, 400, 20],
        ["box", 940, 920, 40, 20],
      ],
    });
    expect(checkFree(touching)).toEqual([]);
  });

  it("skips a game check that needs physics, with an info issue, and runs the rest", () => {
    const def = scene({ game: "needy" });
    const free = checkFree(def, needy);
    expect(free.map((i) => [i.code, i.severity, i.message])).toEqual([
      [PROBE, "info", "floor ~solid:0"],
      [
        "physics-skipped",
        "info",
        "physical check needy/rapier-only needs physics and was skipped: the scene runs without it",
      ],
    ]);
    expect(free[1]!.path).toBe("/settings/physics");
    const onRapier = check(def, needy);
    expect(onRapier.map((i) => i.code)).toEqual([PROBE, PROBE]);
    expect(onRapier.map((i) => i.message)).toContain("floor ~solid:0");
  });

  it("gives physicalEnv's queries on a geometry world, with no Rapier", () => {
    const free = physicsFree(yardWithoutProps);
    const runtime = createSceneRuntime({ rapier: null, view: null, registry: engine });
    try {
      expect(runtime.load(expandScene(free, engine)).ok).toBe(true);
      const env = physicalEnv(runtime, free)!;
      expect(env.physics).toBeNull();
      expect(env.space.backend).toBe("geometry");
      expect(runPhysicalChecks(env)).toHaveLength(2);
      expect(env.overlaps({ type: "circle", cx: 9, cy: 9.3, r: 0.05 })).toEqual([]);
      expect(
        env
          .overlaps({ type: "circle", cx: 9, cy: 9.3, r: 0.05 }, { sensors: true })
          .map((h) => h.tag.entityId),
      ).toEqual(["zone"]);
      // Resting on the floor's top edge touches it; touching isn't overlapping.
      expect(env.overlaps({ type: "box", cx: 6, cy: 9.5, hw: 0.1, hh: 0.1, rotDeg: 0 })).toEqual(
        [],
      );
      const hit = env.cast(
        { type: "box", cx: 6, cy: 9, hw: 0.1, hh: 0.1, rotDeg: 0 },
        { x: 0, y: 1 },
      );
      expect(hit?.tag.entityId).toBe("~solid:0");
      expect(hit!.toi).toBeCloseTo(0.5, 2);
      expect(env.cast({ type: "circle", cx: 9, cy: 9.3, r: 0.05 }, { x: 0, y: -1 })).toBeNull();
    } finally {
      runtime.destroy();
    }
  });
});
