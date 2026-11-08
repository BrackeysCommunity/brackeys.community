// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { applyOps } from "../ops";
import { prefabLibrary } from "../prefab";
import {
  localChildren,
  paramOverrides,
  resolvePrefab,
  resolveScene,
  type LocalChild,
} from "../resolve";
import type {
  EntityDef,
  InstanceDef,
  Prefab,
  PrefabLibrary,
  PrefabParam,
  SceneDefinition,
} from "../types";
import { engine } from "./fixtures/random-ops";

const prefab = (id: string, body: Partial<Prefab> = {}): Prefab => ({
  kind: "prefab",
  v: 3,
  id,
  entities: [],
  ...body,
});

const speed = (extra: Partial<PrefabParam> = {}): PrefabParam => ({
  description: "How fast the door moves.",
  targets: ["door.path.speed"],
  ...extra,
});

const gate = (params: Record<string, PrefabParam> = { speed: speed() }) =>
  prefab("gate", {
    entities: [
      {
        id: "door",
        type: "follower",
        shape: ["box", 0, 0, 10, 40],
        path: { pts: [[0, 0]], mode: "loop", speed: 60 },
      },
      {
        id: "door2",
        type: "follower",
        shape: ["box", 20, 0, 10, 40],
        path: { pts: [[0, 0]], mode: "loop", speed: 60 },
      },
    ],
    params,
  });

const entity = (children: readonly LocalChild[], ref: string): EntityDef | undefined => {
  const c = children.find((x) => x.child === ref);
  return c?.kind === "entity" ? c.def : undefined;
};

const speedOf = (children: readonly LocalChild[], ref = "door") =>
  (entity(children, ref)?.path as { speed?: number } | undefined)?.speed;

const kids = (lib: PrefabLibrary, inst: Partial<InstanceDef> & { prefab: string }) =>
  localChildren(lib.get(inst.prefab)!, { id: "x", at: [0, 0], ...inst }, engine, lib);

describe("params: precedence", () => {
  it("keeps the prefab's value when the instance sets none and there is no default", () => {
    expect(speedOf(kids(prefabLibrary([gate()]), { prefab: "gate" }))).toBe(60);
  });

  it("applies a param over the prefab's value", () => {
    const lib = prefabLibrary([gate()]);
    expect(speedOf(kids(lib, { prefab: "gate", params: { speed: 90 } }))).toBe(90);
  });

  it("lets an override beat the param", () => {
    const lib = prefabLibrary([gate()]);
    const out = kids(lib, {
      prefab: "gate",
      params: { speed: 90 },
      overrides: { "door.path.speed": 30 },
    });
    expect(speedOf(out)).toBe(30);
  });

  it("feeds every target", () => {
    const lib = prefabLibrary([
      gate({ speed: speed({ targets: ["door.path.speed", "door2.path.speed"] }) }),
    ]);
    const out = kids(lib, { prefab: "gate", params: { speed: 15 } });
    expect(speedOf(out, "door")).toBe(15);
    expect(speedOf(out, "door2")).toBe(15);
  });

  it("uses the default when the instance sets none", () => {
    const lib = prefabLibrary([gate({ speed: speed({ default: 45 }) })]);
    expect(speedOf(kids(lib, { prefab: "gate" }))).toBe(45);
    expect(speedOf(kids(lib, { prefab: "gate", params: { speed: 5 } }))).toBe(5);
  });

  it("ignores a name the prefab doesn't expose", () => {
    const lib = prefabLibrary([gate()]);
    expect(speedOf(kids(lib, { prefab: "gate", params: { nope: 1 } }))).toBe(60);
  });

  it("reaches the resolved scene", () => {
    const def: SceneDefinition = {
      v: 3,
      name: "params",
      bounds: [-500, -500, 500, 500],
      instances: [{ id: "g", prefab: "gate", at: [0, 0], params: { speed: 33 } }],
    };
    const out = resolveScene(def, engine, prefabLibrary([gate()]));
    const door = out.entities?.find((e) => e.id === "g/door");
    expect(door?.path).toMatchObject({ speed: 33 });
  });

  it("lists each target of each param that has a value", () => {
    expect(
      paramOverrides(
        {
          a: { description: "", targets: ["p.x", "q.x"] },
          b: { description: "", targets: ["p.y"], default: 2 },
          c: { description: "", targets: ["p.z"] },
        },
        { a: 1 },
      ),
    ).toEqual([
      ["p.x", 1],
      ["q.x", 1],
      ["p.y", 2],
    ]);
  });
});

describe("params: inheritance", () => {
  it("inherits the base's params", () => {
    const lib = prefabLibrary([gate(), prefab("red-gate", { base: "gate" })]);
    const r = resolvePrefab("red-gate", lib, engine);
    expect(r.ok && r.prefab.params).toEqual({ speed: speed() });
    expect(speedOf(kids(lib, { prefab: "red-gate", params: { speed: 70 } }))).toBe(70);
  });

  it("replaces a redeclared param whole", () => {
    const lib = prefabLibrary([
      gate(),
      prefab("red-gate", {
        base: "gate",
        params: {
          speed: speed({ targets: ["door2.path.speed"], default: 11 }),
          tint: { description: "Lamp color.", targets: ["lamp.at"] },
        },
        entities: [{ id: "lamp", type: "marker", at: [0, 0] }],
      }),
    ]);
    const r = resolvePrefab("red-gate", lib, engine);
    expect(r.ok && Object.keys(r.prefab.params)).toEqual(["speed", "tint"]);
    const out = kids(lib, { prefab: "red-gate" });
    expect(speedOf(out, "door")).toBe(60);
    expect(speedOf(out, "door2")).toBe(11);
    expect(entity(kids(lib, { prefab: "red-gate", params: { tint: [4, 4] } }), "lamp")?.at).toEqual(
      [4, 4],
    );
  });

  it("lets an instance's param beat its variant's override of the target", () => {
    const lib = prefabLibrary([
      gate(),
      prefab("red-gate", { base: "gate", overrides: { "door.path.speed": 120 } }),
    ]);
    expect(speedOf(kids(lib, { prefab: "red-gate" }))).toBe(120);
    expect(speedOf(kids(lib, { prefab: "red-gate", params: { speed: 1 } }))).toBe(1);
  });
});

describe("params: nested levels", () => {
  const lib = () =>
    prefabLibrary([
      gate(),
      prefab("pair", {
        instances: [{ id: "g", prefab: "gate", at: [100, 0], params: { speed: 20 } }],
        params: {
          inner: { description: "The gate's speed.", targets: ["g.params.speed"] },
          direct: { description: "The door's speed.", targets: ["g/door.path.speed"] },
        },
      }),
    ]);

  it("applies a nested instance's own params", () => {
    expect(speedOf(kids(lib(), { prefab: "pair" }), "g/door")).toBe(20);
  });

  it("lets an outer param set an inner instance's param", () => {
    expect(speedOf(kids(lib(), { prefab: "pair", params: { inner: 25 } }), "g/door")).toBe(25);
  });

  it("lets an outer param target a nested child, beating the inner level", () => {
    expect(speedOf(kids(lib(), { prefab: "pair", params: { direct: 26 } }), "g/door")).toBe(26);
  });

  it("lets an outer override beat the outer param", () => {
    const out = kids(lib(), {
      prefab: "pair",
      params: { inner: 25 },
      overrides: { "g.params.speed": 27 },
    });
    expect(speedOf(out, "g/door")).toBe(27);
    const direct = kids(lib(), {
      prefab: "pair",
      params: { direct: 26 },
      overrides: { "g/door.path.speed": 28 },
    });
    expect(speedOf(direct, "g/door")).toBe(28);
  });
});

describe("params: unpack", () => {
  const lib = () =>
    prefabLibrary([
      gate(),
      prefab("pair", {
        entities: [
          {
            id: "post",
            type: "follower",
            shape: ["box", 0, 0, 10, 10],
            path: { pts: [[0, 0]], mode: "loop", speed: 60 },
          },
        ],
        instances: [{ id: "g", prefab: "gate", at: [100, 0] }],
        params: {
          inner: { description: "The gate's speed.", targets: ["g.params.speed"], default: 25 },
          direct: { description: "The second door's speed.", targets: ["g/door2.path.speed"] },
          turn: { description: "The gate's turn.", targets: ["g.rot"], default: 1 },
          post: { description: "The post's speed.", targets: ["post.path.speed"], default: 5 },
        },
      }),
    ]);

  const view = (def: SceneDefinition, prefabs: PrefabLibrary, prefix = "") =>
    new Map(
      (resolveScene(def, engine, prefabs).entities ?? []).map(({ id, group: _, ...rest }) => [
        id.startsWith(prefix) ? id.slice(prefix.length) : id,
        rest,
      ]),
    );

  for (const [params, label] of [
    [{ direct: 26 }, "defaulted"],
    [{ direct: 26, inner: 30, turn: 2, post: 7 }, "set"],
  ] as const) {
    it(`keeps the resolved scene when the outer params are ${label}`, () => {
      const prefabs = lib();
      const def: SceneDefinition = {
        v: 3,
        name: "params",
        bounds: [-500, -500, 500, 500],
        instances: [
          {
            id: "x",
            prefab: "pair",
            at: [10, 20],
            params: { ...params },
            overrides: { "g/door2.shape": ["box", 20, 0, 12, 40] },
          },
        ],
      };
      const before = view(def, prefabs, "x/");
      expect((before.get("g/door")?.path as { speed?: number } | undefined)?.speed).toBe(
        "inner" in params ? params.inner : 25,
      );
      expect((before.get("g/door2")?.path as { speed?: number } | undefined)?.speed).toBe(26);
      const r = applyOps(def, { ops: [{ op: "unpack", ref: "x" }] }, engine, { prefabs });
      if (!r.ok) throw new Error(r.issue.message);
      expect(r.def.instances!.map((n) => n.id)).toEqual(["g"]);
      expect(view(r.def, prefabs)).toEqual(before);
    });
  }
});
