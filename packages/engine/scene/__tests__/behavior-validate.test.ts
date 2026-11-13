// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineBehavior } from "../../game/behaviors";
import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { shapeField } from "../../game/fields";
import { inputScriptSchemaFor } from "../input-script";
import type { EntityDef, Prefab, PrefabLibrary, SceneDefinition, SceneIssue } from "../types";
import { validateScene } from "../validate";

const engine = createRegistry();

const box = ["box", 0, 0, 0.2, 0.2];

function scene(entities: EntityDef[], over: Partial<SceneDefinition> = {}): SceneDefinition {
  return { v: 4, name: "t", bounds: [0, 0, 20, 20], entities, ...over };
}

const marker = (id: string, behaviors?: Record<string, unknown>, at = [1, 1]): EntityDef => ({
  id,
  type: "marker",
  at,
  ...(behaviors ? { behaviors } : {}),
});

const walkArea: EntityDef = {
  id: "floor",
  type: "nav",
  shape: ["poly", 0, 0, 10, 0, 10, 10, 0, 10],
};

const codes = (issues: SceneIssue[], code: string) => issues.filter((i) => i.code === code);

describe("behavior-conflict", () => {
  it("names both behaviors, once per pair", () => {
    const issues = validateScene(
      scene([
        marker("hero", {
          collider: { shape: box },
          "character-top-down": {},
          "character-side-view": {},
        }),
      ]),
      engine,
    );
    const hits = codes(issues, "behavior-conflict");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('"character-top-down"');
    expect(hits[0]!.message).toContain('"character-side-view"');
    expect(hits[0]!.path).toBe("/entities/0/behaviors/character-side-view");
  });

  it("raises one issue per conflicting pair, declared on either side", () => {
    const game = defineGame({
      id: "pairs",
      types: [],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
      behaviors: [
        defineBehavior({
          name: "pairs/a",
          description: "A.",
          fields: {},
          conflicts: ["pairs/b", "pairs/c"],
        }),
        defineBehavior({ name: "pairs/b", description: "B.", fields: {} }),
        defineBehavior({
          name: "pairs/c",
          description: "C.",
          fields: {},
          conflicts: ["pairs/a"],
        }),
      ],
    });
    const registry = createRegistry(game);
    const issues = validateScene(
      scene([marker("x", { "pairs/a": {}, "pairs/b": {}, "pairs/c": {} })], { game: "pairs" }),
      registry,
    );
    const pairs = codes(issues, "behavior-conflict").map((i) => i.message);
    expect(pairs).toHaveLength(2);
    expect(pairs.some((m) => m.includes('"pairs/a"') && m.includes('"pairs/b"'))).toBe(true);
    expect(pairs.some((m) => m.includes('"pairs/a"') && m.includes('"pairs/c"'))).toBe(true);
  });

  it("leaves one character alone", () => {
    const issues = validateScene(
      scene([marker("hero", { collider: { shape: box }, "character-top-down": {} })]),
      engine,
    );
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("character-body-kind", () => {
  it("refuses a character on a body that is dynamic by default", () => {
    const issues = validateScene(
      scene([marker("hero", { collider: { shape: box }, body: {}, "character-side-view": {} })]),
      engine,
    );
    const [hit] = codes(issues, "character-body-kind");
    expect(hit?.path).toBe("/entities/0/behaviors/body");
    expect(hit?.fix?.ops).toEqual([
      { op: "update", ref: "hero", set: { "behaviors.body.kind": "kinematic" } },
    ]);
  });

  it("accepts a character on a kinematic body, or on none", () => {
    for (const behaviors of [
      { collider: { shape: box }, body: { kind: "kinematic" }, "character-top-down": {} },
      { collider: { shape: box }, "character-side-view": {} },
    ]) {
      const issues = validateScene(scene([marker("hero", behaviors)]), engine);
      expect(codes(issues, "character-body-kind")).toEqual([]);
    }
  });

  it("never refuses a dynamic body that carries no character", () => {
    const issues = validateScene(
      scene([marker("crate", { collider: { shape: box }, body: {}, "player-input": {} })]),
      engine,
    );
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("joints", () => {
  const link = (to: string, kind = "revolute") =>
    marker("link", { collider: { shape: box }, body: {}, joint: { kind, to } });

  it("joint-self when `to` is its own entity", () => {
    const [hit] = codes(validateScene(scene([link("link")]), engine), "joint-self");
    expect(hit?.path).toBe("/entities/0/behaviors/joint/to");
  });

  it("joint-ref-type when `to` has no body, or only a sensor", () => {
    for (const target of [
      marker("post"),
      marker("post", { collider: { shape: box, sensor: true } }),
      { id: "post", type: "sensor", shape: ["box", 2, 2, 0.5, 0.5] } satisfies EntityDef,
    ]) {
      const issues = validateScene(scene([target, link("post")]), engine);
      const [hit] = codes(issues, "joint-ref-type");
      expect(hit?.entityIds, JSON.stringify(target)).toEqual(["link", "post"]);
    }
  });

  it("accepts a body, a solid collider, a solid, a prop or a follower at `to`", () => {
    for (const target of [
      marker("post", { collider: { shape: box }, body: { kind: "static" } }),
      marker("post", { collider: { shape: box } }),
      { id: "post", type: "solid", shape: ["box", 5, 5, 1, 0.2] } satisfies EntityDef,
      {
        id: "post",
        type: "prop",
        shape: ["box", 5, 5, 0.2, 0.2],
        density: 1,
        restitution: 0,
      } satisfies EntityDef,
    ]) {
      const issues = validateScene(scene([target, link("post")]), engine);
      expect(
        issues.filter((i) => i.code.startsWith("joint") || i.code === "dangling-ref"),
        JSON.stringify(target),
      ).toEqual([]);
    }
  });

  it("dangling-ref when `to` names nothing, with a fix that unsets the joint", () => {
    const [hit] = codes(validateScene(scene([link("ghost")]), engine), "dangling-ref");
    expect(hit?.path).toBe("/entities/0/behaviors/joint/to");
    expect(hit?.fix?.ops).toEqual([{ op: "update", ref: "link", unset: ["behaviors.joint"] }]);
  });

  it("finds a sibling inside an instance by its id in the prefab", () => {
    const chain: Prefab = {
      kind: "prefab",
      v: 4,
      id: "chain",
      entities: [
        marker("anchor", { collider: { shape: box } }, [0, 0]),
        marker(
          "link",
          { collider: { shape: box }, body: {}, joint: { kind: "rope", to: "anchor", length: 1 } },
          [0, 1],
        ),
      ],
    };
    const prefabs: PrefabLibrary = new Map([["chain", chain]]);
    const issues = validateScene(
      scene([], { instances: [{ id: "c1", prefab: "chain", at: [3, 3] }] }),
      engine,
      { prefabs },
    );
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("types based on a body-owning primitive", () => {
  const registry = createRegistry(
    defineGame({
      id: "based",
      types: [
        defineEntityType({
          type: "pellet",
          description: "A prop of the game's.",
          base: "prop",
          fields: {
            shape: shapeField("Its shape."),
            density: z.number(),
            restitution: z.number(),
          },
        }),
        defineEntityType({
          type: "goal",
          description: "A finish zone.",
          base: "sensor",
          fields: { shape: shapeField("Its shape.") },
        }),
      ],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    }),
  );

  it("refuses collider and body with behavior-forbidden", () => {
    const behaviors = { collider: { shape: box }, body: {} };
    for (const target of [
      { id: "p", type: "pellet", shape: box, density: 1, restitution: 0, behaviors },
      { id: "g", type: "goal", shape: box, behaviors },
    ] satisfies EntityDef[]) {
      const issues = validateScene(scene([target], { game: "based" }), registry);
      expect(new Set(codes(issues, "behavior-forbidden").map((i) => i.got)), target.type).toEqual(
        new Set(["body", "collider"]),
      );
    }
  });
});

describe("collision groups", () => {
  const groups = createRegistry(
    defineGame({
      id: "grouped",
      types: [],
      actions: [],
      collisionGroups: { avatar: { collidesWith: ["static", "dynamic"] } },
      createRuntime: () => ({ snapshot: () => null }),
    }),
  );
  const unknownGroup = (issues: SceneIssue[]) =>
    codes(issues, "schema").filter((i) => i.message.includes("collision group"));

  it("refuses a collider group the game doesn't declare, with the groups it does", () => {
    const issues = validateScene(
      scene([marker("m", { collider: { shape: box, group: "avatr" } })], { game: "grouped" }),
      groups,
    );
    const [hit] = unknownGroup(issues);
    expect(hit?.severity).toBe("error");
    expect(hit?.path).toBe("/entities/0/behaviors/collider/group");
    expect(hit?.got).toBe("avatr");
    expect(hit?.expected).toBe(groups.collisionGroupNames.join(" | "));
    expect(hit?.message).toContain('did you mean "avatar"');
    expect(hit?.hint).toContain("avatar");
  });

  it("accepts a declared group, and an engine one in a gameless scene", () => {
    expect(
      unknownGroup(
        validateScene(
          scene([marker("m", { collider: { shape: box, group: "avatar" } })], { game: "grouped" }),
          groups,
        ),
      ),
    ).toEqual([]);
    expect(
      unknownGroup(
        validateScene(scene([marker("m", { collider: { shape: box, group: "static" } })]), engine),
      ),
    ).toEqual([]);
    expect(
      unknownGroup(
        validateScene(scene([marker("m", { collider: { shape: box, group: "bogus" } })]), engine),
      ),
    ).toHaveLength(1);
  });

  it("warns on a force area that affects a group the game doesn't declare", () => {
    const issues = validateScene(
      scene(
        [
          marker("wind", {
            collider: { shape: box, sensor: true },
            "force-area": { affects: { groups: ["avatar", "ghost"] } },
          }),
        ],
        { game: "grouped" },
      ),
      groups,
    );
    const hits = unknownGroup(issues);
    expect(hits.map((i) => [i.severity, i.path, i.got])).toEqual([
      ["warn", "/entities/0/behaviors/force-area/affects/groups/1", "ghost"],
    ]);
  });
});

describe("nav-missing", () => {
  const walker = marker("walker", { "nav-agent": {} });

  it("warns on an agent in a scene with no walk area", () => {
    const [hit] = codes(validateScene(scene([walker]), engine), "nav-missing");
    expect(hit?.severity).toBe("warn");
    expect(hit?.path).toBe("/entities/0/behaviors/nav-agent");
  });

  it("is quiet with a walk area, and for a block area alone it still warns", () => {
    expect(codes(validateScene(scene([walkArea, walker]), engine), "nav-missing")).toEqual([]);
    const hole = { ...walkArea, id: "hole", mode: "block" };
    expect(codes(validateScene(scene([hole, walker]), engine), "nav-missing")).toHaveLength(1);
  });

  it("leaves a prefab's agents to the scene that places it", () => {
    const issues = validateScene(scene([walker]), engine, { prefab: "p" });
    expect(codes(issues, "nav-missing")).toEqual([]);
  });
});

describe("spawner", () => {
  it("unknown-type when it names a type that isn't registered or never loads", () => {
    const issues = validateScene(
      scene([
        marker("a", { spawner: { type: "markr" } }),
        marker("b", { spawner: { type: "note" } }),
        marker("c", { spawner: { type: "prop" } }),
      ]),
      engine,
    );
    const hits = codes(issues, "unknown-type");
    expect(hits.map((i) => i.path)).toEqual([
      "/entities/0/behaviors/spawner/type",
      "/entities/1/behaviors/spawner/type",
    ]);
    expect(hits[0]!.message).toContain('did you mean "marker"');
  });

  it("takes exactly one of type or prefab", () => {
    const issues = validateScene(scene([marker("a", { spawner: { rate: 2 } })]), engine);
    expect(codes(issues, "schema")[0]?.message).toContain("exactly one of `type` or `prefab`");
  });
});

describe("physics", () => {
  it("physics-required for a dynamic body or a joint without physics; a kinematic body loads", () => {
    const issues = validateScene(
      scene(
        [
          marker("crate", { collider: { shape: box }, body: {} }),
          marker("lift", { collider: { shape: box }, body: { kind: "kinematic" } }),
          marker("link", {
            collider: { shape: box },
            body: { kind: "kinematic" },
            joint: { kind: "weld", to: "lift" },
          }),
        ],
        { settings: { physics: "none" } },
      ),
      engine,
    );
    expect(codes(issues, "physics-required").map((i) => i.path)).toEqual([
      "/entities/0/behaviors/body",
      "/entities/2/behaviors/joint",
    ]);
  });

  it("the four types that own a body refuse body and collider", () => {
    const entities: EntityDef[] = [
      { id: "ground", type: "solid", shape: ["box", 5, 9, 5, 0.5], behaviors: { body: {} } },
      {
        id: "zone",
        type: "sensor",
        shape: ["box", 5, 5, 1, 1],
        behaviors: { collider: { shape: box } },
      },
      {
        id: "crate",
        type: "prop",
        shape: ["box", 5, 5, 0.2, 0.2],
        density: 1,
        restitution: 0,
        behaviors: { collider: { shape: box } },
      },
      {
        id: "lift",
        type: "follower",
        shape: ["box", 0, 0, 0.4, 0.06],
        path: {
          pts: [
            [1, 1],
            [3, 1],
          ],
          mode: "ping_pong",
          speed: 1,
        },
        behaviors: { body: {} },
      },
    ];
    const hits = codes(validateScene(scene(entities), engine), "behavior-forbidden");
    expect(hits.map((i) => i.entityIds[0])).toEqual(["ground", "zone", "crate", "lift"]);
  });
});

describe("until.near", () => {
  it("parses its shape: an id, a point or an entity id, and a positive distance", () => {
    const schema = inputScriptSchemaFor(engine);
    const script = (near: unknown) => ({ v: 2, steps: [{ hold: [], until: { near } }] });
    expect(schema.safeParse(script({ id: "hero", to: [1, 2], within: 0.5 })).success).toBe(true);
    expect(schema.safeParse(script({ id: "hero", to: "post", within: 0.5 })).success).toBe(true);
    const bad = schema.safeParse(script({ id: "hero", to: [1, 2] }));
    expect(JSON.stringify(bad.error?.issues)).toContain("within");
  });

  it("is an engine predicate, so a game can't take the name", () => {
    expect(() =>
      createRegistry(
        defineGame({
          id: "near-game",
          types: [],
          actions: [],
          createRuntime: () => ({ snapshot: () => null }),
          play: {
            predicates: { near: { description: "x", arg: z.unknown(), test: () => true } },
          },
        }),
      ),
    ).toThrow(/script predicate "near" is the engine's/);
  });
});
