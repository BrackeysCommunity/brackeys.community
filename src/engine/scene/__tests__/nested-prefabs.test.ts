// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { localPrefabSource } from "../../collab/prefab-source";
import { expandScene } from "../expand";
import { prefabLibrary } from "../prefab";
import {
  localChild,
  localChildren,
  mapResolvedBatch,
  resolvePrefab,
  resolveScene,
  resolveSceneDetailed,
  type ChildApply,
} from "../resolve";
import { applyPt, dihedral } from "../transform";
import {
  PREFAB_MAX_DEPTH,
  type EntityDef,
  type InstanceDef,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
} from "../types";
import { validateScene } from "../validate";
import door from "./fixtures/prefabs/door.json";
import gate from "./fixtures/prefabs/gate.json";
import room from "./fixtures/prefabs/room.json";
import { engine, fake } from "./fixtures/random-ops";

const prefab = (id: string, body: Partial<Prefab> = {}): Prefab => ({
  kind: "prefab",
  v: 3,
  id,
  entities: [],
  ...body,
});

/** The room fixture: two gates and a door that holds a gate, three levels. */
const fixtures = () => prefabLibrary([room, door, gate] as unknown as Prefab[]);

const scene = (instances: InstanceDef[], game?: string): SceneDefinition => ({
  v: 3,
  ...(game !== undefined ? { game } : {}),
  name: "nest",
  bounds: [-2000, -2000, 2000, 2000],
  instances,
});

const byId = (entities: readonly EntityDef[] | undefined) =>
  new Map((entities ?? []).map((e) => [e.id, e]));

/** leaf: a pin and a follower; mid: one leaf; top: one mid and its own marker. */
function nest(over: { mid?: Partial<InstanceDef>; top?: Partial<InstanceDef> } = {}) {
  return prefabLibrary([
    prefab("leaf", {
      entities: [
        { id: "pin", type: "marker", at: [1, 2] },
        {
          id: "box",
          type: "follower",
          shape: ["box", 0, 0, 4, 4],
          path: { pts: [[0, 0]], mode: "loop", speed: 10 },
        },
      ],
      bulk: { solid: [["box", 0, 20, 8, 2]] },
    }),
    prefab("mid", {
      instances: [{ id: "l", prefab: "leaf", at: [100, 0], ...over.mid }],
    }),
    prefab("top", {
      entities: [{ id: "flag", type: "marker", at: [0, -5] }],
      instances: [{ id: "m", prefab: "mid", at: [0, 1000], ...over.top }],
    }),
  ]);
}

const resolved = (lib: PrefabLibrary, inst: Partial<InstanceDef> = {}) =>
  byId(
    resolveScene(scene([{ id: "t", prefab: "top", at: [10, 20], ...inst }]), engine, lib).entities,
  );

describe("nested prefabs: ids", () => {
  it("names a nested child by the instances above it", () => {
    const r = resolvePrefab("top", nest(), engine);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.prefab.children.map((c) => c.child)).toEqual([
      "flag",
      "m/l/pin",
      "m/l/box",
      "m/l/~solid:0",
    ]);
    expect(r.prefab.uses).toEqual(["top", "mid", "leaf"]);
  });

  it("gives expandScene and the resolved view the same a/b/c ids", () => {
    const lib = fixtures();
    const def = scene([{ id: "r", prefab: "room", at: [0, 0] }]);
    const view = resolveSceneDetailed(def, engine, lib);
    const viewIds = (view.def.entities ?? []).map((e) => e.id);
    expect(viewIds).toContain("r/door-1/latch/door");
    expect(viewIds).toContain("r/door-1/panel");
    expect(viewIds).toContain("r/gate-2/~solid:0");
    expect(
      [...expandScene(def, engine, { prefabs: lib }).entities.map((e) => e.id)].sort(),
    ).toEqual([...viewIds].sort());
    const i = viewIds.indexOf("r/door-1/latch/door");
    expect(view.origins[i]).toMatchObject({
      kind: "child",
      instance: 0,
      child: "door-1/latch/door",
      path: ["r", "door-1", "latch"],
    });
  });

  it("gives the prefab docs' library the same ids and children", () => {
    const lib = fixtures();
    const docs = localPrefabSource(lib).library();
    const def = scene([{ id: "r", prefab: "room", at: [0, 0] }]);
    const fromDocs = resolveScene(def, engine, docs).entities;
    expect(fromDocs).toEqual(resolveScene(def, engine, lib).entities);
    expect(expandScene(def, engine, { prefabs: docs })).toEqual(
      expandScene(def, engine, { prefabs: lib }),
    );
  });

  it("applies each level's overrides in the fixtures, outermost last", () => {
    const lib = fixtures();
    const e = byId(
      resolveScene(scene([{ id: "r", prefab: "room", at: [0, 0] }]), engine, lib).entities,
    );
    const speed = (id: string) => (e.get(id)?.path as { speed?: number } | undefined)?.speed;
    expect(speed("r/door-1/latch/door")).toBe(30);
    expect(speed("r/door-1/panel")).toBe(50);
    expect(speed("r/gate-2/door")).toBe(90);
    expect(speed("r/gate-1/door")).toBe(60);
    expect(e.get("r/door-1/panel")?.z).toBe(2);
  });
});

describe("nested prefabs: placement", () => {
  it("translates through every level and adds each z", () => {
    const e = resolved(nest({ mid: { z: 2 }, top: { z: 3 } }), { z: 1 });
    expect(e.get("t/m/l/pin")).toMatchObject({ at: [111, 1022], z: 6 });
    expect(e.get("t/flag")).toMatchObject({ at: [10, 15], z: 1 });
  });

  it("turns and flips through every level and records the composed transform", () => {
    const lib = nest({ mid: { rot: 1 }, top: { flip: true } });
    const def = scene([{ id: "t", prefab: "top", at: [10, 20], rot: 2 }]);
    const view = resolveSceneDetailed(def, engine, lib);
    const i = view.def.entities!.findIndex((e) => e.id === "t/m/l/pin");
    const expected = applyPt(
      dihedral({ rot: 2, flip: false }, [10, 20]),
      applyPt(
        dihedral({ rot: 0, flip: true }, [0, 1000]),
        applyPt(dihedral({ rot: 1, flip: false }, [100, 0]), [1, 2]),
      ),
    );
    expect(view.def.entities![i]!.at).toEqual(expected);
    const pin = expandScene(def, engine, { prefabs: lib }).entities.find(
      (e) => e.id === "t/m/l/pin",
    );
    expect(pin?.transform).toEqual({ turn: 1, flip: true });
  });

  it("inherits layer and off from the nearest instance that sets them", () => {
    const e = resolved(nest({ mid: { layer: "inner", off: true }, top: { layer: "outer" } }));
    expect(e.get("t/m/l/pin")).toMatchObject({ layer: "inner", off: true });
    expect(e.get("t/flag")?.layer).toBeUndefined();
    const lit = resolved(nest({ top: { layer: "outer" } }), { layer: "scene" });
    expect(lit.get("t/m/l/pin")?.layer).toBe("outer");
    expect(lit.get("t/flag")?.layer).toBe("scene");
  });
});

describe("nested prefabs: precedence", () => {
  const speed = (e: Map<string, EntityDef>) =>
    (e.get("t/m/l/box")?.path as { speed?: number } | undefined)?.speed;

  it("lets each level beat the one inside it, and the outermost beat them all", () => {
    expect(speed(resolved(nest()))).toBe(10);
    const mid = { overrides: { "box.path.speed": 20 } };
    expect(speed(resolved(nest({ mid })))).toBe(20);
    const top = { overrides: { "l/box.path.speed": 30 } };
    expect(speed(resolved(nest({ mid, top })))).toBe(30);
    const outer = { overrides: { "m/l/box.path.speed": 40 } };
    expect(speed(resolved(nest({ mid, top }), outer))).toBe(40);
    expect(speed(resolved(nest({ mid }), outer))).toBe(40);
  });

  it("applies a whole-field override at an outer level over a deeper one inside", () => {
    const mid = { overrides: { "box.path.speed": 20 } };
    const e = resolved(nest({ mid }), {
      overrides: { "m/l/box.path": { pts: [[0, 0]], mode: "once", speed: 5 } },
    });
    expect(e.get("t/m/l/box")?.path).toEqual({ pts: [[110, 1020]], mode: "once", speed: 5 });
  });

  it("sets a nested instance's own fields, outer levels first", () => {
    const top = { overrides: { "l.at": [200, 0], "l.z": 4 } };
    expect(resolved(nest({ top })).get("t/m/l/pin")).toMatchObject({ at: [211, 1022], z: 4 });
    const scene = { overrides: { "m/l.at": [300, 0], "m.at": [0, 0], "m.layer": "x" } };
    expect(resolved(nest({ top }), scene).get("t/m/l/pin")).toMatchObject({
      at: [311, 22],
      z: 4,
      layer: "x",
    });
    expect(resolved(nest(), { overrides: { "m.off": true } }).get("t/m/l/pin")?.off).toBe(true);
    expect(resolved(nest(), { overrides: { "m/l.rot": 2 } }).get("t/m/l/pin")?.at).toEqual([
      10 + 100 - 1,
      20 + 1000 - 2,
    ]);
  });

  it("takes an override's value in the frame of the child's own prefab", () => {
    const e = resolved(nest({ top: { rot: 2 } }), {
      overrides: { "m/l/~solid:0.shape": ["box", 0, 0, 1, 1], "m/l/pin.at": [5, 0] },
    });
    expect(e.get("t/m/l/~solid:0")).toMatchObject({
      type: "solid",
      shape: ["box", -90, 1020, 1, 1, 180],
    });
    expect(e.get("t/m/l/pin")?.at).toEqual([-95, 1020]);
  });

  it("reads one nested child through localChild, overrides applied", () => {
    const lib = nest();
    const inst: InstanceDef = {
      id: "t",
      prefab: "top",
      at: [0, 0],
      overrides: { "m/l/pin.at": [7, 7] },
    };
    expect(localChild(lib.get("top")!, inst, "m/l/pin", engine, lib)).toMatchObject({
      kind: "entity",
      child: "m/l/pin",
      def: { id: "pin", at: [107, 1007] },
    });
    expect(localChildren(lib.get("top")!, inst, engine).map((c) => c.child)).toEqual(["flag"]);
  });

  it("keeps a nested bulk entry a bulk child, with what its instances give it", () => {
    const lib = nest({ mid: { z: 2, layer: "inner" }, top: { off: true, rot: 2 } });
    const inst: InstanceDef = { id: "t", prefab: "top", at: [0, 0] };
    expect(localChild(lib.get("top")!, inst, "m/l/~solid:0", engine, lib)).toEqual({
      kind: "bulk",
      child: "m/l/~solid:0",
      key: "solid",
      index: 0,
      value: ["box", -100, 980, 8, 2, 180],
      turn: { rot: 2, flip: false },
      placed: { z: 2, layer: "inner", off: true },
    });
  });
});

describe("nested prefabs: refs", () => {
  it("maps refs to a sibling and to a nested child at every level", () => {
    const lib = prefabLibrary([
      prefab("leaf", {
        game: "fake",
        entities: [
          { id: "peg", type: "peg", at: [0, 0] },
          { id: "lever", type: "lever", at: [5, 0], target: "peg" },
        ],
      }),
      prefab("mid", {
        game: "fake",
        entities: [{ id: "boss", type: "lever", at: [0, 0], target: "l/peg" }],
        instances: [{ id: "l", prefab: "leaf", at: [0, 0] }],
      }),
    ]);
    const e = byId(
      resolveScene(scene([{ id: "s", prefab: "mid", at: [0, 0] }], "fake"), fake, lib).entities,
    );
    expect(e.get("s/l/lever")?.target).toBe("s/l/peg");
    expect(e.get("s/boss")?.target).toBe("s/l/peg");
  });
});

describe("nested prefabs: depth", () => {
  const chain = (n: number) =>
    prefabLibrary(
      Array.from({ length: n }, (_, i) =>
        prefab(`p${i + 1}`, {
          entities: [{ id: "pin", type: "marker", at: [i, 0] }],
          ...(i + 1 < n ? { instances: [{ id: "n", prefab: `p${i + 2}`, at: [1, 0] }] } : {}),
        }),
      ),
    );

  it(`allows ${PREFAB_MAX_DEPTH} levels and refuses ${PREFAB_MAX_DEPTH + 1}`, () => {
    const ok = resolvePrefab("p1", chain(PREFAB_MAX_DEPTH), engine);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.prefab.children.at(-1)?.child).toBe("n/n/n/n/n/n/n/pin");
    const deep = chain(PREFAB_MAX_DEPTH + 1);
    const bad = resolvePrefab("p1", deep, engine);
    expect(bad).toMatchObject({ ok: false, issue: { code: "prefab-depth" } });
    expect(resolvePrefab("p2", deep, engine).ok).toBe(true);
  });

  it("refuses the depth whichever prefab was resolved first", () => {
    const deep = chain(PREFAB_MAX_DEPTH + 1);
    for (let i = PREFAB_MAX_DEPTH + 1; i >= 2; i--)
      expect(resolvePrefab(`p${i}`, deep, engine).ok).toBe(true);
    expect(resolvePrefab("p1", deep, engine)).toMatchObject({
      ok: false,
      issue: { code: "prefab-depth" },
    });
  });

  it("loads nothing for an instance of a prefab nested too deep", () => {
    const def = scene([{ id: "s", prefab: "p1", at: [0, 0] }]);
    expect(expandScene(def, engine, { prefabs: chain(PREFAB_MAX_DEPTH + 1) }).entities).toEqual([]);
    expect(expandScene(def, engine, { prefabs: chain(PREFAB_MAX_DEPTH) }).entities).toHaveLength(
      PREFAB_MAX_DEPTH,
    );
  });
});

describe("nested prefabs: cycles and missing prefabs", () => {
  const loop = prefabLibrary([
    prefab("a", { instances: [{ id: "to-b", prefab: "b", at: [0, 0] }] }),
    prefab("b", {
      entities: [{ id: "pin", type: "marker", at: [0, 0] }],
      instances: [{ id: "to-c", prefab: "c", at: [0, 0] }],
    }),
    prefab("c", { instances: [{ id: "to-a", prefab: "a", at: [0, 0] }] }),
    prefab("self", { instances: [{ id: "me", prefab: "self", at: [0, 0] }] }),
    prefab("outside", { instances: [{ id: "x", prefab: "b", at: [0, 0] }] }),
  ]);

  it("reports a cycle through instances the same from every prefab on it", () => {
    for (const id of ["a", "b", "c", "outside"]) {
      const r = resolvePrefab(id, loop, engine);
      expect(r, id).toMatchObject({
        ok: false,
        issue: { code: "prefab-cycle", message: 'Prefab "a" contains itself: a → b → c → a.' },
      });
    }
    expect(resolvePrefab("self", loop, engine)).toMatchObject({
      ok: false,
      issue: { code: "prefab-cycle", message: 'Prefab "self" contains itself: self → self.' },
    });
  });

  it("loads nothing for an instance on a cycle, and the rest of the scene", () => {
    const def: SceneDefinition = {
      ...scene([{ id: "s", prefab: "b", at: [0, 0] }]),
      entities: [{ id: "keep", type: "marker", at: [0, 0] }],
    };
    expect(expandScene(def, engine, { prefabs: loop }).entities.map((e) => e.id)).toEqual(["keep"]);
  });

  it("reports the cycle when a scene placing it loads", () => {
    const issues = validateScene(scene([{ id: "s", prefab: "a", at: [0, 0] }]), engine, {
      prefabs: loop,
    });
    expect(issues.map((i) => i.code)).toContain("prefab-cycle");
  });

  it("reports a missing nested prefab", () => {
    const lib = prefabLibrary([
      prefab("a", { instances: [{ id: "x", prefab: "gone", at: [0, 0] }] }),
    ]);
    expect(resolvePrefab("a", lib, engine)).toMatchObject({
      ok: false,
      issue: { code: "prefab-unknown", got: "gone" },
    });
    expect(resolvePrefab("nope", lib, engine)).toMatchObject({
      ok: false,
      issue: { code: "prefab-unknown", got: "nope" },
    });
  });

  it("finds a cycle through a working copy that isn't the library's", () => {
    const lib = prefabLibrary([
      prefab("a"),
      prefab("b", { instances: [{ id: "x", prefab: "a", at: [0, 0] }] }),
    ]);
    const edited = prefab("a", { instances: [{ id: "y", prefab: "b", at: [0, 0] }] });
    const inst: InstanceDef = { id: "s", prefab: "a", at: [0, 0] };
    expect(localChildren(edited, inst, engine, lib)).toEqual([]);
    expect(resolvePrefab("b", lib, engine).ok).toBe(true);
    resolvePrefab("b", lib, engine);
    expect(localChildren(edited, inst, engine, lib)).toEqual([]);
  });
});

describe("nested prefabs: memoisation", () => {
  it("returns the same resolution for the same library and registry", () => {
    const lib = nest();
    const first = resolvePrefab("top", lib, engine);
    const prefabOf = (r: ReturnType<typeof resolvePrefab>) => (r.ok ? r.prefab : null);
    expect(prefabOf(first)).not.toBeNull();
    expect(prefabOf(resolvePrefab("top", lib, engine))).toBe(prefabOf(first));
    expect(prefabOf(resolvePrefab("top", nest(), engine))).not.toBe(prefabOf(first));
    expect(prefabOf(resolvePrefab("top", lib, fake))).not.toBe(prefabOf(first));
    expect(prefabOf(resolvePrefab("top", lib, engine, { cells: true }))).not.toBe(prefabOf(first));
  });

  it("notices a prefab replaced in place", () => {
    const lib = new Map(nest());
    const before = resolvePrefab("top", lib, engine);
    expect(before.ok).toBe(true);
    lib.set("leaf", prefab("leaf", { entities: [{ id: "only", type: "marker", at: [0, 0] }] }));
    const after = resolvePrefab("top", lib, engine);
    expect(after.ok && after.prefab).not.toBe(before.ok && before.prefab);
    expect(after.ok && after.prefab.children.map((c) => c.child)).toEqual(["flag", "m/l/only"]);
  });

  it("hands out children a caller may change without touching the cache", () => {
    const lib = nest();
    const inst: InstanceDef = { id: "t", prefab: "top", at: [0, 0] };
    const c = localChild(lib.get("top")!, inst, "m/l/pin", engine, lib)!;
    if (c.kind === "entity") c.def.at = [9, 9];
    expect(localChild(lib.get("top")!, inst, "m/l/pin", engine, lib)).toMatchObject({
      def: { at: [101, 1002] },
    });
  });
});

describe("nested prefabs: edits on the resolved view", () => {
  /** Applies an update's set to a scratch child, as the op engine would for these fields. */
  const apply: ChildApply = (child, op) => {
    if (child.kind !== "entity" || op.op !== "update") throw new Error(op.op);
    expect(op.ref).not.toContain("/");
    return { ...child, def: { ...child.def, ...op.set } };
  };

  it("maps a world edit of a nested child to an override on the scene instance", () => {
    const lib = nest();
    const def = scene([{ id: "t", prefab: "top", at: [10, 20] }]);
    const r = mapResolvedBatch(
      def,
      { ops: [{ op: "update", ref: "t/m/l/pin", set: { at: [50, 60] } }] },
      engine,
      lib,
      apply,
    );
    expect(r).toEqual({
      ok: true,
      batch: { ops: [{ op: "override", ref: "t", set: { "m/l/pin.at": [-60, -960] } }] },
    });
    const after = scene([
      { id: "t", prefab: "top", at: [10, 20], overrides: { "m/l/pin.at": [-60, -960] } },
    ]);
    expect(byId(resolveScene(after, engine, lib).entities).get("t/m/l/pin")?.at).toEqual([50, 60]);
  });

  it("reverts the override when the child goes back to its prefab's value", () => {
    const lib = nest();
    const def = scene([
      { id: "t", prefab: "top", at: [0, 0], overrides: { "m/l/pin.at": [40, 40] } },
    ]);
    const r = mapResolvedBatch(
      def,
      { ops: [{ op: "update", ref: "t/m/l/pin", set: { at: [101, 1002] } }] },
      engine,
      lib,
      apply,
    );
    expect(r).toEqual({
      ok: true,
      batch: { ops: [{ op: "revertOverride", ref: "t", paths: ["m/l/pin.at"] }] },
    });
  });
});
