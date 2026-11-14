import { describe, expect, it } from "vite-plus/test";

import { scopedRef } from "../../game/types";
import { expandScene } from "../expand";
import { prefabLibrary } from "../prefab";
import { translateEntityDef, translateFieldValue } from "../translate";
import type { EntityDef, Prefab, RuntimeEntity, SceneDefinition } from "../types";
import { engine } from "./fixtures/random-ops";

const PTS = [
  [0, 0],
  [2, 0],
];

const rider = (id: string): EntityDef => ({
  id,
  type: "marker",
  at: [0, 0],
  behaviors: { "path-follow": { path: { pts: structuredClone(PTS), speed: 1 } } },
});

const prefab: Prefab = {
  kind: "prefab",
  v: 4,
  id: "yard",
  entities: [
    rider("p"),
    { id: "flag", type: "marker", at: [3, 0] },
    { id: "agent", type: "marker", at: [1, 1], behaviors: { "nav-agent": { to: "flag" } } },
    { id: "far", type: "marker", at: [1, 2], behaviors: { "nav-agent": { to: "elsewhere" } } },
    { id: "walker", type: "marker", at: [0, 0], behaviors: { "nav-agent": { to: [2, 0] } } },
  ],
};

const scene = (body: Partial<SceneDefinition>): SceneDefinition => ({
  v: 4,
  name: "s",
  bounds: [0, 0, 100, 100],
  ...body,
});

const byId = (entities: RuntimeEntity[]) => new Map(entities.map((e) => [e.id, e]));
const pathOf = (e: RuntimeEntity | undefined) =>
  (e?.behaviors?.["path-follow"] as { path: { pts: unknown } } | undefined)?.path.pts;
const navTo = (e: RuntimeEntity | undefined) =>
  (e?.behaviors?.["nav-agent"] as { to?: unknown } | undefined)?.to;

describe("behavior geometry and refs under instances, parents and moves", () => {
  it("places a path-follow path with its instance and scopes nav-agent refs to siblings", () => {
    const out = expandScene(
      scene({ instances: [{ id: "i", prefab: "yard", at: [20, 10] }] }),
      engine,
      { prefabs: prefabLibrary([prefab]) },
    );
    const got = byId(out.entities);
    expect(got.get("i/p")?.at).toEqual([20, 10]);
    expect(pathOf(got.get("i/p"))).toEqual([
      [20, 10],
      [22, 10],
    ]);
    expect(navTo(got.get("i/agent"))).toBe("i/flag");
    expect(navTo(got.get("i/far"))).toBe("elsewhere");
  });

  it("turns a behavior path with a turned instance", () => {
    const out = expandScene(
      scene({ instances: [{ id: "i", prefab: "yard", at: [20, 10], rot: 90 }] }),
      engine,
      { prefabs: prefabLibrary([prefab]) },
    );
    expect(pathOf(byId(out.entities).get("i/p"))).toEqual([
      [20, 10],
      [20, 12],
    ]);
  });

  it("moves a behavior path with its parent node", () => {
    const out = expandScene(
      scene({
        entities: [
          { id: "g", type: "node", at: [5, 5] },
          { ...rider("p"), parent: "g" },
        ],
      }),
      engine,
    );
    expect(pathOf(byId(out.entities).get("p"))).toEqual([
      [5, 5],
      [7, 5],
    ]);
  });

  it("moves a behavior path with an editor move, and an update to it", () => {
    const moved = translateEntityDef(engine, rider("p"), [1, 2])!;
    expect(moved.at).toEqual([1, 2]);
    expect(pathOf(moved as RuntimeEntity)).toEqual([
      [1, 2],
      [3, 2],
    ]);
    expect(rider("p").behaviors).toEqual({
      "path-follow": { path: { pts: PTS, speed: 1 } },
    });
    expect(
      translateFieldValue(engine, rider("p"), "behaviors.path-follow.path.pts.1", [2, 0], [1, 2]),
    ).toEqual([3, 2]);
    expect(
      translateFieldValue(engine, rider("p"), "behaviors.path-follow.path.speed", 1, [1, 2]),
    ).toBe(1);
  });

  it("places a nav-agent point with its instance, turned and flipped, as a path is", () => {
    const placed = (inst: { rot?: number; flip?: true }) => {
      const out = expandScene(
        scene({ instances: [{ id: "i", prefab: "yard", at: [20, 10], ...inst }] }),
        engine,
        { prefabs: prefabLibrary([prefab]) },
      );
      const got = byId(out.entities);
      return { to: navTo(got.get("i/walker")), path: pathOf(got.get("i/p")) as number[][] };
    };
    expect(placed({}).to).toEqual([22, 10]);
    for (const inst of [{ rot: 90 }, { flip: true as const }, { rot: 270, flip: true as const }]) {
      const { to, path } = placed(inst);
      expect(to).toEqual(path[1]);
      expect(to).not.toEqual([2, 0]);
    }
  });

  it("moves a nav-agent point with an editor move and an update, and leaves an entity ref alone", () => {
    const walker: EntityDef = {
      id: "w",
      type: "marker",
      at: [0, 0],
      behaviors: { "nav-agent": { to: [2, 0] } },
    };
    expect(navTo(translateEntityDef(engine, walker, [1, 2]) as RuntimeEntity)).toEqual([3, 2]);
    expect(translateFieldValue(engine, walker, "behaviors.nav-agent.to", [2, 0], [1, 2])).toEqual([
      3, 2,
    ]);
    expect(translateFieldValue(engine, walker, "behaviors.nav-agent.to", "flag", [1, 2])).toBe(
      "flag",
    );
  });

  it("resolves a ref innermost instance first, then the scene's own id", () => {
    const ids = new Set(["a/b/x", "a/x", "x", "a/y"]);
    const has = (id: string) => ids.has(id);
    expect(scopedRef("a/b/me", "x", has)).toBe("a/b/x");
    expect(scopedRef("a/b/me", "y", has)).toBe("a/y");
    expect(scopedRef("a/b/me", "z", has)).toBe("z");
    expect(scopedRef("me", "x", has)).toBe("x");
    expect(scopedRef("a/me", "a/x", has)).toBe("a/x");
  });
});
