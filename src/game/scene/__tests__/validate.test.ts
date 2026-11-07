import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { parseBulkId } from "../expand";
import { formatScene } from "../format";
import { sceneHash } from "../hash";
import { ISSUE_CODES } from "../issues";
import { parseScene, parseSceneOrThrow } from "../parse";
import type { EntityDef, IssueCode, OpBatch, SceneDefinition, SceneIssue } from "../types";
import { validateScene } from "../validate";

const yard = parseSceneOrThrow(
  readFileSync(new URL("../../scenes/test-yard.json", import.meta.url), "utf8"),
);

/** A clean scene: one spawn on a floor, a goal, a full-width hazard. */
function scene(over: Partial<SceneDefinition> = {}, extra: EntityDef[] = []): SceneDefinition {
  return {
    v: 1,
    name: "t",
    bounds: [0, 0, 1000, 1000],
    spawn: [[500, 900]],
    solid: [["box", 500, 920, 400, 20]],
    entities: [
      { id: "goal", b: "sensor", kind: "goal", shape: ["circle", 800, 850, 10] },
      { id: "pit", b: "sensor", kind: "hazard", shape: ["box", 500, 990, 500, 10] },
      ...extra,
    ],
    ...over,
  };
}

/** Applies the op subset validator fixes use, without the editor's applyOps. */
function applyFix(def: SceneDefinition, batch: OpBatch): SceneDefinition {
  const next = structuredClone(def);
  for (const op of batch.ops) {
    if (op.op === "setScene") Object.assign(next, op.set);
    else if (op.op === "setSpawn") next.spawn[op.index ?? next.spawn.length] = op.at;
    else if (op.op === "update") {
      const bulk = parseBulkId(op.ref);
      let target: Record<string, unknown>;
      if (bulk) {
        expect(batch.base).toBe(sceneHash(def));
        const rows = next[bulk.key] as unknown[];
        target = bulk.key === "anchor" ? { at: rows[bulk.index] } : { shape: rows[bulk.index] };
        for (const [field, value] of Object.entries(op.set ?? {})) target[field] = value;
        rows[bulk.index] = bulk.key === "anchor" ? target.at : target.shape;
        continue;
      }
      const found = next.entities?.find((e) => e.id === op.ref);
      expect(found, op.ref).toBeDefined();
      target = found as Record<string, unknown>;
      for (const [field, value] of Object.entries(op.set ?? {})) {
        const keys = field.split(".");
        let obj = target;
        for (const k of keys.slice(0, -1)) obj = obj[k] as Record<string, unknown>;
        obj[keys[keys.length - 1]] = value;
      }
      for (const field of op.unset ?? []) delete target[field];
    } else throw new Error(`unexpected op ${op.op}`);
  }
  return next;
}

function only(issues: SceneIssue[], code: IssueCode): SceneIssue {
  const hits = issues.filter((i) => i.code === code);
  expect(hits, code).toHaveLength(1);
  return hits[0];
}

/** The fix parses, applies, and clears the issue it was offered for. */
function expectFixClears(def: SceneDefinition, issue: SceneIssue) {
  expect(issue.fix, issue.code).toBeDefined();
  expect(ISSUE_CODES[issue.code].fixable).toBe(true);
  const fixed = applyFix(def, issue.fix!);
  expect(parseScene(JSON.parse(formatScene(fixed).text)).ok).toBe(true);
  const same = (i: SceneIssue) => i.code === issue.code && i.path === issue.path;
  expect(validateScene(fixed).filter(same)).toEqual([]);
}

describe("validateScene", () => {
  it("passes the clean fixture and test-yard has no errors", () => {
    expect(validateScene(scene())).toEqual([]);
    const issues = validateScene(yard);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(issues.map((i) => i.code)).toEqual(["no-kill-plane"]);
  });

  it("dup-id", () => {
    const def = scene({}, [{ id: "goal", b: "anchor", at: [10, 10] }]);
    const issue = only(validateScene(def), "dup-id");
    expect(issue).toMatchObject({ severity: "error", path: "/entities/2/id", entityIds: ["goal"] });
    expect(issue.hint).toContain('"goal-2"');
  });

  it("spawn-missing", () => {
    expect(only(validateScene(scene({ spawn: [] })), "spawn-missing").path).toBe("/spawn");
  });

  it("spawn-overlap", () => {
    const issue = only(
      validateScene(
        scene({
          spawn: [
            [500, 900],
            [540, 900],
          ],
        }),
      ),
      "spawn-overlap",
    );
    expect(issue).toMatchObject({ path: "/spawn/1", at: [540, 900] });
    expect(
      validateScene(
        scene({
          spawn: [
            [500, 900],
            [560, 900],
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("poly-invalid, with a chain fix on solids only", () => {
    const concave = ["poly", 100, 800, 300, 800, 200, 850, 300, 900, 100, 900] as const;
    const def = scene({ solid: [["box", 500, 920, 400, 20], [...concave]] });
    const issue = only(validateScene(def), "poly-invalid");
    expect(issue).toMatchObject({ path: "/solid/1", entityIds: ["~solid:1"] });
    expect(issue.fix?.base).toBe(sceneHash(def));
    expect(issue.fix?.ops[0]).toEqual({
      op: "update",
      ref: "~solid:1",
      set: { shape: ["chain", ...concave.slice(1), 100, 800] },
    });
    expectFixClears(def, issue);

    const prop = scene({}, [
      { id: "rock", b: "prop", shape: [...concave], density: 1, restitution: 0 },
    ]);
    const propIssue = only(validateScene(prop), "poly-invalid");
    expect(propIssue.path).toBe("/entities/2/shape");
    expect(propIssue.fix).toBeUndefined();
  });

  it("chain-invalid", () => {
    const def = scene({}, [
      { id: "ridge", b: "solid", shape: ["chain", 100, 800, 200, 800, 200, 800, 300, 750] },
    ]);
    const issue = only(validateScene(def), "chain-invalid");
    expect(issue).toMatchObject({ entityIds: ["ridge"], at: [200, 800] });
    expect(issue.fix?.base).toBeUndefined();
    expectFixClears(def, issue);
  });

  it("path-invalid", () => {
    const slow = scene({}, [
      {
        id: "lift",
        b: "mover",
        shape: ["box", 0, 0, 20, 5],
        path: {
          pts: [
            [200, 700],
            [400, 700],
          ],
          mode: "loop",
          speed: 0,
        },
      },
    ]);
    expect(only(validateScene(slow), "path-invalid").path).toBe("/entities/2/path/speed");
    const short = scene({}, [
      {
        id: "lift",
        b: "mover",
        shape: ["box", 0, 0, 20, 5],
        path: { pts: [[200, 700]], mode: "loop", speed: 5 },
      },
    ]);
    expect(only(validateScene(short), "path-invalid").path).toBe("/entities/2/path/pts");
  });

  it("path-degenerate, including loop's closing segment", () => {
    const def = scene({}, [
      {
        id: "lift",
        b: "mover",
        shape: ["box", 0, 0, 20, 5],
        path: {
          pts: [
            [200, 700],
            [400, 700],
            [400, 700],
            [600, 650],
          ],
          mode: "ping_pong",
          speed: 50,
        },
      },
    ]);
    const issue = only(validateScene(def), "path-degenerate");
    expect(issue).toMatchObject({ severity: "warn", path: "/entities/2/path/pts/2" });
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
      {
        id: "ring",
        b: "mover",
        shape: ["box", 0, 0, 20, 5],
        path: {
          pts: [
            [200, 700],
            [400, 700],
            [200, 700],
          ],
          mode: "loop",
          speed: 50,
        },
      },
    ]);
    expectFixClears(loop, only(validateScene(loop), "path-degenerate"));
  });

  it("non-integer on bulk, entity and spawn", () => {
    const def = scene(
      { solid: [["box", 500.5, 920, 400, 20]], anchor: [[100, 100.25]], spawn: [[500, 900.5]] },
      [
        {
          id: "lift",
          b: "mover",
          shape: ["box", 0, 0, 20, 5],
          path: {
            pts: [
              [200, 700],
              [400.5, 700],
            ],
            mode: "loop",
            speed: 50,
          },
        },
      ],
    );
    const issues = validateScene(def, { lines: formatScene(def).lines }).filter(
      (i) => i.code === "non-integer",
    );
    expect(issues.map((i) => i.path)).toEqual([
      "/solid/0/1",
      "/anchor/0/1",
      "/entities/2/path/pts/1",
      "/spawn/0",
    ]);
    expect(issues.map((i) => i.entityIds)).toEqual([["~solid:0"], ["~anchor:0"], ["lift"], []]);
    expect(issues.every((i) => i.line !== undefined && i.severity === "warn")).toBe(true);
    let fixed = def;
    for (const issue of issues)
      fixed = applyFix(fixed, { ...issue.fix!, base: issue.fix!.base && sceneHash(fixed) });
    expect(validateScene(fixed).filter((i) => i.code === "non-integer")).toEqual([]);
    expectFixClears(def, issues[0]);
  });

  it("out-of-bounds, for shapes, mover paths and spawns", () => {
    const def = scene({}, [
      { id: "far", b: "solid", shape: ["box", 1100, 500, 50, 10] },
      {
        id: "lift",
        b: "mover",
        shape: ["box", 0, 0, 20, 5],
        path: {
          pts: [
            [200, 700],
            [200, -10],
          ],
          mode: "loop",
          speed: 50,
        },
      },
    ]);
    const issues = validateScene(def).filter((i) => i.code === "out-of-bounds");
    expect(issues.map((i) => i.entityIds[0])).toEqual(["far", "lift"]);
    expect(issues[0].fix?.ops[0]).toEqual({ op: "setScene", set: { bounds: [0, 0, 1150, 1000] } });
    expect(issues[1].fix?.ops[0]).toEqual({
      op: "setScene",
      set: { bounds: [0, -15, 1000, 1000] },
    });
    for (const issue of issues) {
      const fixed = applyFix(def, issue.fix!);
      expect(
        validateScene(fixed).some(
          (i) => i.code === "out-of-bounds" && i.entityIds[0] === issue.entityIds[0],
        ),
      ).toBe(false);
    }
    const spawn = only(validateScene(scene({ spawn: [[500, 30]] })), "out-of-bounds");
    expect(spawn.path).toBe("/spawn/0");
    expectFixClears(scene({ spawn: [[500, 30]] }), spawn);
  });

  it("wind-rotation", () => {
    const def = scene({}, [
      { id: "gust", b: "construct", type: "wind_zone", at: [300, 800], rot: 45 },
    ]);
    const issue = only(validateScene(def), "wind-rotation");
    expect(issue).toMatchObject({ path: "/entities/2/rot", entityIds: ["gust"] });
    expectFixClears(def, issue);
    expect(
      validateScene(
        scene({}, [{ id: "gust", b: "construct", type: "wind_zone", at: [300, 800], rot: 360 }]),
      ),
    ).toEqual([]);
  });

  it("no-goal ignores off sensors", () => {
    const def = scene();
    def.entities![0] = { ...def.entities![0], off: true } as EntityDef;
    expect(only(validateScene(def), "no-goal").severity).toBe("warn");
  });

  it("no-kill-plane needs a hazard spanning the bounds' width", () => {
    const def = scene();
    def.entities = def.entities!.filter((e) => e.id !== "pit");
    expect(only(validateScene(def), "no-kill-plane").severity).toBe("info");
  });

  it("orders errors before warnings before info, and adds lines", () => {
    const def = scene({ spawn: [] }, [
      { id: "gust", b: "construct", type: "wind_zone", at: [300, 800], rot: 45 },
    ]);
    def.entities = def.entities!.filter((e) => e.b !== "sensor");
    const issues = validateScene(def, { lines: formatScene(def).lines });
    expect(issues.map((i) => i.severity)).toEqual(["error", "warn", "warn", "info"]);
    expect(issues.every((i) => typeof i.line === "number")).toBe(true);
  });
});
