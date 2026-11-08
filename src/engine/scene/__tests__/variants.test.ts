// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { applyOps } from "../ops";
import { prefabScene } from "../prefab";
import {
  localChild,
  localChildren,
  mapResolvedBatch,
  resolvePrefab,
  resolveScene,
  type ChildApply,
  type LocalChild,
} from "../resolve";
import {
  PREFAB_MAX_DEPTH,
  type EntityDef,
  type InstanceDef,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
} from "../types";
import { validateScene } from "../validate";
import { engine, fake } from "./fixtures/random-ops";

/** A library tests can add to. */
const library = (prefabs: Prefab[]) => new Map(prefabs.map((p) => [p.id, p]));

const prefab = (id: string, body: Partial<Prefab> = {}): Prefab => ({
  kind: "prefab",
  v: 3,
  id,
  entities: [],
  ...body,
});

const scene = (instances: InstanceDef[]): SceneDefinition => ({
  v: 3,
  name: "variants",
  bounds: [-2000, -2000, 2000, 2000],
  instances,
});

const byId = (entities: readonly EntityDef[] | undefined) =>
  new Map((entities ?? []).map((e) => [e.id, e]));

const refs = (children: readonly LocalChild[]) => children.map((c) => c.child);

const entity = (children: readonly LocalChild[], ref: string): EntityDef | undefined => {
  const c = children.find((x) => x.child === ref);
  return c?.kind === "entity" ? c.def : undefined;
};

const gate = () =>
  prefab("gate", {
    entities: [
      {
        id: "door",
        type: "follower",
        shape: ["box", 0, 0, 10, 40],
        path: { pts: [[0, 0]], mode: "loop", speed: 60 },
      },
      { id: "trigger", type: "sensor", shape: ["box", 60, 20, 20, 20], attach: "door" },
    ],
    bulk: { solid: [["box", 0, 50, 40, 6]] },
  });

const redGate = (body: Partial<Prefab> = {}) =>
  prefab("red-gate", {
    base: "gate",
    overrides: { "door.path.speed": 120 },
    entities: [{ id: "lamp", type: "marker", at: [5, -10] }],
    bulk: { solid: [["box", 0, 70, 40, 6]] },
    ...body,
  });

const resolved = (lib: PrefabLibrary, id: string) => {
  const r = resolvePrefab(id, lib, engine);
  if (!r.ok) throw new Error(r.issue.message);
  return r.prefab;
};

describe("variants: the base folds in", () => {
  it("lists the base's children with its overrides, then its own", () => {
    const lib = library([gate(), redGate()]);
    const p = resolved(lib, "red-gate");
    expect(refs(p.children)).toEqual(["door", "trigger", "~solid:0", "lamp", "~solid:1"]);
    expect(entity(p.children, "door")?.path).toEqual({ pts: [[0, 0]], mode: "loop", speed: 120 });
    expect(p.uses).toEqual(["red-gate", "gate"]);
    expect(entity(resolved(lib, "gate").children, "door")?.path).toMatchObject({ speed: 60 });
  });

  it("numbers its own bulk entries after the base's but keeps their file index", () => {
    const p = resolved(library([gate(), redGate()]), "red-gate");
    const own = p.children.find((c) => c.child === "~solid:1");
    expect(own).toMatchObject({
      kind: "bulk",
      key: "solid",
      index: 0,
      value: ["box", 0, 70, 40, 6],
    });
  });

  it("places as an instance with the base's children under the instance id", () => {
    const lib = library([gate(), redGate()]);
    const out = byId(
      resolveScene(scene([{ id: "r", prefab: "red-gate", at: [100, 0] }]), engine, lib).entities,
    );
    expect([...out.keys()].sort()).toEqual(
      ["r/door", "r/lamp", "r/trigger", "r/~solid:0", "r/~solid:1"].sort(),
    );
    expect(out.get("r/door")?.path).toMatchObject({ speed: 120 });
    expect(out.get("r/trigger")?.attach).toBe("r/door");
    expect(out.get("r/lamp")?.at).toEqual([105, -10]);
  });

  it("lets an instance's override beat the variant's", () => {
    const lib = library([gate(), redGate()]);
    const inst: InstanceDef = {
      id: "r",
      prefab: "red-gate",
      at: [0, 0],
      overrides: { "door.path.speed": 7 },
    };
    expect(entity(localChildren(lib.get("red-gate")!, inst, engine, lib), "door")?.path).toEqual({
      pts: [[0, 0]],
      mode: "loop",
      speed: 7,
    });
  });

  it("hides a base child with off: true, entity or bulk", () => {
    const lib = library([
      gate(),
      redGate({ overrides: { "trigger.off": true, "~solid:0.off": true } }),
    ]);
    const out = byId(
      resolveScene(scene([{ id: "r", prefab: "red-gate", at: [0, 0] }]), engine, lib).entities,
    );
    expect(out.get("r/trigger")?.off).toBe(true);
    expect(out.get("r/~solid:0")?.off).toBe(true);
    expect(out.get("r/door")?.off).toBeUndefined();
    expect(out.get("r/~solid:1")?.off).toBeUndefined();
  });

  it("can't remove a base child: the base's children are always there", () => {
    const lib = library([gate(), redGate({ overrides: { "door.off": true } })]);
    expect(refs(resolved(lib, "red-gate").children)).toContain("door");
  });

  it("appends its own nested instances after its entities", () => {
    const lib = library([
      gate(),
      redGate({ instances: [{ id: "g", prefab: "gate", at: [200, 0] }] }),
    ]);
    const p = resolved(lib, "red-gate");
    expect(refs(p.children)).toEqual([
      "door",
      "trigger",
      "~solid:0",
      "lamp",
      "~solid:1",
      "g/door",
      "g/trigger",
      "g/~solid:0",
    ]);
    expect(p.uses).toEqual(["red-gate", "gate"]);
  });

  it("picks up a new version of its base", () => {
    const lib = library([gate(), redGate()]);
    expect(refs(resolved(lib, "red-gate").children)).toContain("trigger");
    const next = new Map(lib);
    next.set("gate", prefab("gate", { entities: [{ id: "post", type: "marker", at: [0, 0] }] }));
    expect(refs(resolved(next, "red-gate").children)).toEqual(["post", "lamp", "~solid:0"]);
  });
});

describe("variants: a variant of a variant", () => {
  const lib = () =>
    library([
      gate(),
      redGate(),
      prefab("dark-red-gate", {
        base: "red-gate",
        overrides: { "door.path.mode": "ping_pong", "lamp.at": [0, 0] },
        entities: [{ id: "bell", type: "marker", at: [1, 1] }],
      }),
    ]);

  it("stacks the overrides, the outer variant's last", () => {
    const p = resolved(lib(), "dark-red-gate");
    expect(refs(p.children)).toEqual(["door", "trigger", "~solid:0", "lamp", "~solid:1", "bell"]);
    expect(entity(p.children, "door")?.path).toEqual({
      pts: [[0, 0]],
      mode: "ping_pong",
      speed: 120,
    });
    expect(entity(p.children, "lamp")?.at).toEqual([0, 0]);
    expect(p.uses).toEqual(["dark-red-gate", "red-gate", "gate"]);
  });

  it("lets an outer override of a field beat an inner one", () => {
    const l = lib();
    l.set(
      "dark-red-gate",
      prefab("dark-red-gate", { base: "red-gate", overrides: { "door.path.speed": 1 } }),
    );
    expect(entity(resolved(l, "dark-red-gate").children, "door")?.path).toMatchObject({ speed: 1 });
  });
});

describe("variants: of a prefab with nested instances", () => {
  const lib = () =>
    library([
      gate(),
      prefab("pair", {
        instances: [{ id: "g", prefab: "gate", at: [100, 0], rot: 1 }],
      }),
      prefab("pair-v", {
        base: "pair",
        overrides: { "g/door.path.speed": 5, "g.at": [300, 0] },
      }),
    ]);

  it("overrides a nested child in its own prefab's frame and a nested instance's field", () => {
    const p = resolved(lib(), "pair-v");
    expect(refs(p.children)).toEqual(["g/door", "g/trigger", "g/~solid:0"]);
    expect(entity(p.children, "g/door")?.path).toMatchObject({ speed: 5 });
    expect(entity(p.children, "g/trigger")?.attach).toBe("g/door");
    const plain = entity(resolved(lib(), "pair").children, "g/trigger")!.shape as unknown[];
    const moved = entity(p.children, "g/trigger")!.shape as unknown[];
    expect(moved[1]).toBe((plain[1] as number) + 200);
    expect(p.uses).toEqual(["pair-v", "pair", "gate"]);
  });

  it("takes an instance's override of the base's nested instance down to it", () => {
    const l = lib();
    const inst: InstanceDef = {
      id: "v",
      prefab: "pair-v",
      at: [0, 0],
      overrides: { "g.at": [0, 0], "g/door.path.speed": 9 },
    };
    const kids = localChildren(l.get("pair-v")!, inst, engine, l);
    expect(entity(kids, "g/door")?.path).toMatchObject({ speed: 9 });
    const atOrigin = localChildren(
      l.get("pair")!,
      { id: "p", prefab: "pair", at: [0, 0], overrides: { "g.at": [0, 0] } },
      engine,
      l,
    );
    expect(entity(kids, "g/trigger")?.shape).toEqual(entity(atOrigin, "g/trigger")?.shape);
  });

  it("maps a world edit of the base's nested child back to an override in its own frame", () => {
    const l = lib();
    const apply: ChildApply = (child, op) => {
      if (child.kind !== "entity" || op.op !== "update") throw new Error(op.op);
      return { ...child, def: { ...child.def, ...op.set } };
    };
    const def = scene([{ id: "v", prefab: "pair-v", at: [0, 0] }]);
    const r = mapResolvedBatch(
      def,
      { ops: [{ op: "update", ref: "v/g/door", set: { path: { pts: [[0, 0]], speed: 3 } } }] },
      engine,
      l,
      apply,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.batch.ops[0]).toMatchObject({ op: "override", ref: "v" });
    const op = r.batch.ops[0] as { set: Record<string, unknown> };
    expect(Object.keys(op.set)).toEqual(["g/door.path"]);
    expect(
      localChild(l.get("pair-v")!, { ...def.instances![0]!, overrides: {} }, "g/door", engine, l),
    ).not.toBeNull();
  });
});

describe("variants: depth, cycles and unknown bases", () => {
  /** A chain of `n` variants over a one-entity leaf: `v<n>` is `n + 1` levels deep. */
  const chain = (n: number) =>
    library([
      prefab("leaf", { entities: [{ id: "pin", type: "marker", at: [0, 0] }] }),
      ...Array.from({ length: n }, (_, i) =>
        prefab(`v${i + 1}`, { base: i === 0 ? "leaf" : `v${i}` }),
      ),
    ]);

  it("counts each base toward the depth limit", () => {
    const ok = resolvePrefab(`v${PREFAB_MAX_DEPTH - 1}`, chain(PREFAB_MAX_DEPTH - 1), engine);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(refs(ok.prefab.children)).toEqual(["pin"]);
    const deep = resolvePrefab(`v${PREFAB_MAX_DEPTH}`, chain(PREFAB_MAX_DEPTH), engine);
    expect(deep).toMatchObject({ ok: false, issue: { code: "prefab-depth" } });
  });

  it("counts bases and nested instances together", () => {
    const lib = chain(PREFAB_MAX_DEPTH - 1);
    lib.set(
      "holder",
      prefab("holder", {
        instances: [{ id: "x", prefab: `v${PREFAB_MAX_DEPTH - 1}`, at: [0, 0] }],
      }),
    );
    expect(resolvePrefab("holder", lib, engine)).toMatchObject({
      ok: false,
      issue: { code: "prefab-depth" },
    });
  });

  it("reports a cycle through bases as prefab-cycle", () => {
    const lib = library([prefab("a", { base: "b" }), prefab("b", { base: "a" })]);
    const r = resolvePrefab("a", lib, engine);
    expect(r).toMatchObject({ ok: false, issue: { code: "prefab-cycle", got: "a,b" } });
    expect(resolvePrefab("b", lib, engine)).toMatchObject({
      ok: false,
      issue: { code: "prefab-cycle", got: "a,b" },
    });
    expect(
      resolvePrefab("self", library([prefab("self", { base: "self" })]), engine),
    ).toMatchObject({ ok: false, issue: { code: "prefab-cycle" } });
  });

  it("reports a cycle through a base and an instance", () => {
    const lib = library([
      prefab("a", { base: "b" }),
      prefab("b", { instances: [{ id: "x", prefab: "a", at: [0, 0] }] }),
    ]);
    expect(resolvePrefab("a", lib, engine)).toMatchObject({
      ok: false,
      issue: { code: "prefab-cycle" },
    });
  });

  it("reports an unknown base as variant-base-unknown and places nothing", () => {
    const lib = library([prefab("orphan", { base: "nope" })]);
    expect(resolvePrefab("orphan", lib, engine)).toMatchObject({
      ok: false,
      issue: { code: "variant-base-unknown", got: "nope" },
    });
    const out = resolveScene(scene([{ id: "o", prefab: "orphan", at: [0, 0] }]), engine, lib);
    expect(out.entities).toBeUndefined();
  });
});

describe("child refs at every level", () => {
  /** inner: a peg and a lever on it; mid: inner as `i` and a lever on `i/pin`; top: mid as `m` and a lever on `m/i/pin`. */
  const lib = () =>
    library([
      prefab("inner", {
        entities: [
          { id: "pin", type: "peg", at: [0, 0] },
          { id: "lever", type: "lever", at: [1, 0], target: "pin" },
        ],
      }),
      prefab("mid", {
        entities: [{ id: "lever", type: "lever", at: [2, 0], target: "i/pin" }],
        instances: [{ id: "i", prefab: "inner", at: [10, 0] }],
      }),
      prefab("top", {
        entities: [{ id: "lever", type: "lever", at: [3, 0], target: "m/i/pin" }],
        instances: [{ id: "m", prefab: "mid", at: [100, 0] }],
      }),
      prefab("mid-v", {
        base: "mid",
        entities: [{ id: "extra", type: "lever", at: [4, 0], target: "i/lever" }],
      }),
    ]);

  it("maps a ref to a nested child at each level", () => {
    const out = byId(
      resolveScene(scene([{ id: "t", prefab: "top", at: [0, 0] }]), fake, lib()).entities,
    );
    expect(out.get("t/lever")?.target).toBe("t/m/i/pin");
    expect(out.get("t/m/lever")?.target).toBe("t/m/i/pin");
    expect(out.get("t/m/i/lever")?.target).toBe("t/m/i/pin");
  });

  it("maps a variant's own ref to a child its base gives it", () => {
    const out = byId(
      resolveScene(scene([{ id: "v", prefab: "mid-v", at: [0, 0] }]), fake, lib()).entities,
    );
    expect(out.get("v/extra")?.target).toBe("v/i/lever");
    expect(out.get("v/lever")?.target).toBe("v/i/pin");
  });

  it("leaves a ref that names no child as written", () => {
    const l = lib();
    l.set(
      "mid",
      prefab("mid", {
        entities: [{ id: "lever", type: "lever", at: [2, 0], target: "i/gone" }],
        instances: [{ id: "i", prefab: "inner", at: [10, 0] }],
      }),
    );
    const out = byId(
      resolveScene(scene([{ id: "t", prefab: "top", at: [0, 0] }]), fake, l).entities,
    );
    expect(out.get("t/m/lever")?.target).toBe("i/gone");
  });
});

describe("variants: their own overrides, validated in the variant's view", () => {
  const issuesOf = (lib: PrefabLibrary, id: string) => {
    const view = prefabScene(lib.get(id)!, [-512, -512, 512, 512]);
    return { view, issues: validateScene(view, engine, { prefabs: lib, prefab: id }) };
  };

  it("passes overrides that name a base child's field, nested ones included", () => {
    const holder = prefab("holder", {
      instances: [{ id: "g", prefab: "gate", at: [0, 0] }],
    });
    const lib = library([
      gate(),
      redGate(),
      holder,
      prefab("red-holder", {
        base: "holder",
        overrides: { "g/door.path.speed": 9, "g.at": [4, 4] },
      }),
    ]);
    expect(issuesOf(lib, "red-gate").issues).toEqual([]);
    expect(issuesOf(lib, "red-holder").issues).toEqual([]);
  });

  it("passes an off override on a base bulk child, as resolve hides it", () => {
    const lib = library([
      gate(),
      redGate({ overrides: { "trigger.off": true, "~solid:0.off": true } }),
    ]);
    expect(issuesOf(lib, "red-gate").issues).toEqual([]);
    const placed = scene([{ id: "r", prefab: "red-gate", at: [0, 0] }]);
    expect(
      validateScene(placed, engine, { prefabs: lib }).filter((i) => i.code === "unused-override"),
    ).toEqual([]);
  });

  it("reports a path naming no base child, or no field, with a fix that drops it", () => {
    const lib = library([
      gate(),
      redGate({
        overrides: { "door.path.speed": 120, "ghost.at": [1, 1], "door.color": "red" },
      }),
    ]);
    const { view, issues } = issuesOf(lib, "red-gate");
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ["unused-override", "/overrides/door.color"],
      ["unused-override", "/overrides/ghost.at"],
    ]);
    expect(issues[1]?.message).toContain('names no child of prefab "gate"');
    expect(issues.map((i) => i.fix?.ops)).toEqual([
      [{ op: "revertOverride", paths: ["door.color"] }],
      [{ op: "revertOverride", paths: ["ghost.at"] }],
    ]);
    const fixOnce = (lib: PrefabLibrary, def: SceneDefinition) => {
      const [first] = validateScene(def, engine, { prefabs: lib, prefab: "red-gate" });
      const r = applyOps(def, first!.fix!, engine, { prefabs: lib, prefab: "red-gate" });
      if (!r.ok) throw new Error(r.issue.message);
      return { lib: r.prefabs!, def: r.def };
    };
    const once = fixOnce(lib, view);
    const { lib: lib2, def } = fixOnce(once.lib, once.def);
    const after = lib2.get("red-gate")!;
    expect(after.overrides).toEqual({ "door.path.speed": 120 });
    expect(after.entities).toEqual(redGate().entities);
    expect(after.bulk).toEqual(redGate().bulk);
    expect(validateScene(def, engine, { prefabs: lib2, prefab: "red-gate" })).toEqual([]);
  });

  it("reports overrides on a prefab that has no base", () => {
    const lib = library([{ ...gate(), overrides: { "door.path.speed": 1 } }]);
    const { view, issues: all } = issuesOf(lib, "gate");
    const issues = all.filter((i) => i.code === "unused-override");
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ["unused-override", "/overrides/door.path.speed"],
    ]);
    const r = applyOps(view, issues[0]!.fix!, engine, { prefabs: lib, prefab: "gate" });
    if (!r.ok) throw new Error(r.issue.message);
    expect(r.prefabs?.get("gate")?.overrides).toBeUndefined();
    expect(r.prefabs?.get("gate")?.base).toBeUndefined();
  });
});
