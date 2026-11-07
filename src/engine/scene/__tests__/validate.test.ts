import { describe, expect, it } from "vite-plus/test";

import type { Registry } from "../../game/types";
import { parseBulkId } from "../expand";
import { formatScene } from "../format";
import { sceneHash } from "../hash";
import { parseScene, parseSceneOrThrow } from "../parse";
import type { EntityDef, IssueCode, OpBatch, SceneDefinition, SceneIssue } from "../types";
import { validateScene } from "../validate";
import { engine, engineYardText, fake } from "./fixtures/fake-game";

/** A clean engine-only scene: a floor and a marker. */
function scene(over: Partial<SceneDefinition> = {}, extra: EntityDef[] = []): SceneDefinition {
  return {
    v: 1,
    name: "t",
    bounds: [0, 0, 1000, 1000],
    solid: [["box", 500, 920, 400, 20]],
    entities: [{ id: "start", type: "marker", at: [500, 900], tags: ["spawn"] }, ...extra],
    ...over,
  };
}

/** The same, for the fake game, which wants a flag. */
function gameScene(over: Partial<SceneDefinition> = {}, extra: EntityDef[] = []): SceneDefinition {
  return scene({ game: "fake", flag: [[800, 900]], ...over }, extra);
}

const lift = (pts: [number, number][], over: Record<string, unknown> = {}): EntityDef => ({
  id: "lift",
  type: "follower",
  shape: ["box", 0, 0, 20, 5],
  path: { pts, mode: "loop", speed: 50, ...over },
});

/** Applies the op subset validator fixes use, without the editor's applyOps. */
function applyFix(def: SceneDefinition, batch: OpBatch, registry: Registry): SceneDefinition {
  const next = structuredClone(def);
  for (const op of batch.ops) {
    if (op.op === "setScene") Object.assign(next, op.set);
    else if (op.op === "update") {
      const bulk = parseBulkId(op.ref);
      if (bulk) {
        expect(batch.base).toBe(sceneHash(def));
        const field = registry.bulkKey(bulk.key)!.field;
        const rows = next[bulk.key] as unknown[];
        for (const [f, value] of Object.entries(op.set ?? {})) {
          expect(f).toBe(field);
          rows[bulk.index] = value;
        }
        continue;
      }
      const target = next.entities?.find((e) => e.id === op.ref) as Record<string, unknown>;
      expect(target, op.ref).toBeDefined();
      for (const [field, value] of Object.entries(op.set ?? {})) {
        const keys = field.split(".");
        let obj = target;
        for (const k of keys.slice(0, -1)) obj = obj[k] as Record<string, unknown>;
        obj[keys[keys.length - 1]!] = value;
      }
      for (const field of op.unset ?? []) delete target[field];
    } else throw new Error(`unexpected op ${op.op}`);
  }
  return next;
}

function only(issues: SceneIssue[], code: IssueCode): SceneIssue {
  const hits = issues.filter((i) => i.code === code);
  expect(hits, code).toHaveLength(1);
  return hits[0]!;
}

/** The fix parses, applies, and clears the issue it was offered for. */
function expectFixClears(def: SceneDefinition, issue: SceneIssue, registry: Registry = engine) {
  expect(issue.fix, issue.code).toBeDefined();
  expect(registry.issueCodes[issue.code]?.fixable).toBe(true);
  const fixed = applyFix(def, issue.fix!, registry);
  expect(parseScene(JSON.parse(formatScene(fixed).text), registry).ok).toBe(true);
  const same = (i: SceneIssue) => i.code === issue.code && i.path === issue.path;
  expect(validateScene(fixed, registry).filter(same)).toEqual([]);
}

describe("validateScene", () => {
  it("passes the clean scenes and engine-yard", () => {
    expect(validateScene(scene(), engine)).toEqual([]);
    expect(validateScene(gameScene(), fake)).toEqual([]);
    const yard = parseSceneOrThrow(engineYardText, engine);
    expect(validateScene(yard, engine)).toEqual([]);
    expect(validateScene(yard, fake)).toEqual([]);
  });

  it("unknown-game", () => {
    const issue = only(validateScene(gameScene(), engine), "unknown-game");
    expect(issue).toMatchObject({ severity: "error", path: "/game" });
    expect(only(validateScene({ ...scene(), game: "other" }, fake), "unknown-game").got).toBe(
      '"other"',
    );
  });

  it("runs the game's validators on its scenes only, with namespaced codes", () => {
    const issue = only(validateScene(gameScene({ flag: [] }), fake), "fake/no-flag");
    expect(issue).toMatchObject({ severity: "warn", hint: "Add a flag." });
    expect(validateScene(scene(), fake)).toEqual([]);
  });

  it("dup-id", () => {
    const def = scene({}, [{ id: "start", type: "marker", at: [10, 10] }]);
    const issue = only(validateScene(def, engine), "dup-id");
    expect(issue).toMatchObject({
      severity: "error",
      path: "/entities/1/id",
      entityIds: ["start"],
    });
    expect(issue.hint).toContain('"start-2"');
  });

  it("dangling-ref and ref-type from the type's refs, with a type's base as a target", () => {
    const door = (opens: string): EntityDef => ({
      id: "door",
      type: "door",
      shape: ["box", 100, 800, 10, 40],
      speed: 5,
      opens,
    });
    const zone: EntityDef = { id: "zone", type: "sensor", shape: ["box", 200, 800, 10, 10] };
    const button: EntityDef = { id: "knob", type: "button", shape: ["circle", 300, 800, 5] };
    expect(validateScene(gameScene({}, [zone, button, door("zone")]), fake)).toEqual([]);
    expect(validateScene(gameScene({}, [zone, button, door("knob")]), fake)).toEqual([]);

    const dangling = gameScene({}, [door("nope")]);
    const missing = only(validateScene(dangling, fake), "dangling-ref");
    expect(missing).toMatchObject({ path: "/entities/1/opens", entityIds: ["door"] });
    expectFixClears(dangling, missing, fake);

    const wrong = gameScene({}, [door("start")]);
    const typed = only(validateScene(wrong, fake), "ref-type");
    expect(typed).toMatchObject({
      entityIds: ["door", "start"],
      expected: "sensor",
      got: "marker",
    });
    expectFixClears(wrong, typed, fake);
  });

  it("poly-invalid, with a chain fix where the field allows a chain", () => {
    const concave = ["poly", 100, 800, 300, 800, 200, 850, 300, 900, 100, 900] as const;
    const def = scene({ solid: [["box", 500, 920, 400, 20], [...concave]] });
    const issue = only(validateScene(def, engine), "poly-invalid");
    expect(issue).toMatchObject({ path: "/solid/1", entityIds: ["~solid:1"] });
    expect(issue.fix?.base).toBe(sceneHash(def));
    expect(issue.fix?.ops[0]).toEqual({
      op: "update",
      ref: "~solid:1",
      set: { shape: ["chain", ...concave.slice(1), 100, 800] },
    });
    expectFixClears(def, issue);

    const prop = scene({}, [
      { id: "rock", type: "prop", shape: [...concave], density: 1, restitution: 0 },
    ]);
    const propIssue = only(validateScene(prop, engine), "poly-invalid");
    expect(propIssue.path).toBe("/entities/1/shape");
    expect(propIssue.hint).toContain("prop's shape can't be a chain");
    expect(propIssue.fix?.ops[0]).toEqual({
      op: "update",
      ref: "rock",
      set: { shape: ["poly", 100, 800, 300, 800, 300, 900, 100, 900] },
    });
    expectFixClears(prop, propIssue);

    const flat = scene({}, [
      { id: "flat", type: "prop", shape: ["poly", 0, 0, 10, 0, 20, 0], density: 1, restitution: 0 },
    ]);
    const flatIssue = only(validateScene(flat, engine), "poly-invalid");
    expect(flatIssue.fix).toBeUndefined();
    expect(flatIssue.hint).toContain("one line");
  });

  it("chain-invalid", () => {
    const def = scene({}, [
      { id: "ridge", type: "solid", shape: ["chain", 100, 800, 200, 800, 200, 800, 300, 750] },
    ]);
    const issue = only(validateScene(def, engine), "chain-invalid");
    expect(issue).toMatchObject({
      entityIds: ["ridge"],
      at: [200, 800],
      path: "/entities/1/shape",
    });
    expect(issue.fix?.base).toBeUndefined();
    expectFixClears(def, issue);
  });

  it("path-invalid", () => {
    const slow = scene({}, [
      lift(
        [
          [200, 700],
          [400, 700],
        ],
        { speed: 0 },
      ),
    ]);
    expect(only(validateScene(slow, engine), "path-invalid").path).toBe("/entities/1/path/speed");
    const short = scene({}, [lift([[200, 700]])]);
    expect(only(validateScene(short, engine), "path-invalid").path).toBe("/entities/1/path/pts");
  });

  it("path-degenerate, including loop's closing segment", () => {
    const def = scene({}, [
      lift(
        [
          [200, 700],
          [400, 700],
          [400, 700],
          [600, 650],
        ],
        { mode: "ping_pong" },
      ),
    ]);
    const issue = only(validateScene(def, engine), "path-degenerate");
    expect(issue).toMatchObject({ severity: "warn", path: "/entities/1/path/pts/2" });
    expect(issue.fix?.ops[0]).toEqual({
      op: "update",
      ref: "lift",
      set: {
        "path.pts": [
          [200, 700],
          [400, 700],
          [600, 650],
        ],
      },
    });
    expectFixClears(def, issue);

    const loop = scene({}, [
      lift([
        [200, 700],
        [400, 700],
        [200, 700],
      ]),
    ]);
    expectFixClears(loop, only(validateScene(loop, engine), "path-degenerate"));
  });

  it("non-integer on shape and point bulk, entity points and paths", () => {
    const def = gameScene({ solid: [["box", 500.5, 920, 400, 20]], flag: [[800, 900.25]] }, [
      lift([
        [200, 700],
        [400.5, 700],
      ]),
      { id: "spot", type: "marker", at: [10.5, 10] },
    ]);
    const issues = validateScene(def, fake, { lines: formatScene(def).lines }).filter(
      (i) => i.code === "non-integer",
    );
    expect(issues.map((i) => i.path)).toEqual([
      "/flag/0/1",
      "/solid/0/1",
      "/entities/1/path/pts/1",
      "/entities/2/at/0",
    ]);
    expect(issues.map((i) => i.entityIds)).toEqual([["~flag:0"], ["~solid:0"], ["lift"], ["spot"]]);
    expect(issues.every((i) => i.line !== undefined && i.severity === "warn")).toBe(true);
    let fixed = def;
    for (const issue of issues)
      fixed = applyFix(fixed, { ...issue.fix!, base: issue.fix!.base && sceneHash(fixed) }, fake);
    expect(validateScene(fixed, fake).filter((i) => i.code === "non-integer")).toEqual([]);
    expectFixClears(def, issues[0]!, fake);
  });

  it("out-of-bounds for shapes, paths and points, but not notes", () => {
    const def = scene({}, [
      { id: "far", type: "solid", shape: ["box", 1100, 500, 50, 10] },
      lift([
        [200, 700],
        [200, -10],
      ]),
      { id: "spot", type: "marker", at: [-5, 500] },
      { id: "memo", type: "note", at: [-100, -100], text: "off the map" },
    ]);
    const issues = validateScene(def, engine).filter((i) => i.code === "out-of-bounds");
    expect(issues.map((i) => i.entityIds[0])).toEqual(["far", "lift", "spot"]);
    expect(issues[0]?.fix?.ops[0]).toEqual({ op: "setScene", set: { bounds: [0, 0, 1150, 1000] } });
    expect(issues[1]?.fix?.ops[0]).toEqual({
      op: "setScene",
      set: { bounds: [0, -15, 1000, 1000] },
    });
    for (const issue of issues) {
      const fixed = applyFix(def, issue.fix!, engine);
      expect(
        validateScene(fixed, engine).some(
          (i) => i.code === "out-of-bounds" && i.entityIds[0] === issue.entityIds[0],
        ),
      ).toBe(false);
    }
  });

  it("orders by severity, then engine and game issues together in document order, and adds lines", () => {
    const def = gameScene({ flag: [] }, [
      { id: "start", type: "marker", at: [1, 1] },
      { id: "spot", type: "marker", at: [10.5, 10] },
    ]);
    const issues = validateScene(def, fake, { lines: formatScene(def).lines });
    expect(issues.map((i) => [i.severity, i.code])).toEqual([
      ["error", "dup-id"],
      ["warn", "fake/no-flag"],
      ["warn", "non-integer"],
    ]);
    expect(issues.every((i) => typeof i.line === "number")).toBe(true);
  });
});
