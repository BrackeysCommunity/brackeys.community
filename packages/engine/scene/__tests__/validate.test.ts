import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { GLOW, LAMP, PLAIN, testGame } from "../../__tests__/fixtures/test-game";
import { defineBehavior } from "../../game/behaviors";
import { OCCUPANT } from "../../game/behaviors/occupant";
import { posableType } from "../../game/behaviors/tween";
import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { assetField, gridField, pointField } from "../../game/fields";
import type { SceneLibrary } from "../../game/flow";
import { PRIMITIVES, primitiveFields, typePhysics } from "../../game/primitives";
import type { FieldEnv, Registry } from "../../game/types";
import type { AnimationFile } from "../../project/kinds/animation";
import type { AssetEntry } from "../../project/types";
import { projectView } from "../../project/view";
import { createDataSystem } from "../../systems/data";
import { parseBulkId } from "../expand";
import { formatScene } from "../format";
import { sceneHash } from "../hash";
import { applyOps } from "../ops";
import { parseScene, parseSceneOrThrow } from "../parse";
import { prefabScene } from "../prefab";
import type { EntityDef, IssueCode, OpBatch, Prefab, SceneDefinition, SceneIssue } from "../types";
import { sublevelIssue, sublevelUseIssues, validateScene } from "../validate";
import { engine, engineYardText, fake } from "./fixtures/fake-game";
import { yardPrefabs } from "./fixtures/random-ops";

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

  describe("nav-invalid", () => {
    const nav = (id: string, pts: number[], mode?: "walk" | "block"): EntityDef => ({
      id,
      type: "nav",
      shape: ["poly", ...pts],
      ...(mode ? { mode } : {}),
    });
    const navIssues = (...extra: EntityDef[]) =>
      validateScene(scene({}, extra), engine).filter(
        (i) => i.code === "nav-invalid" || i.code === "poly-invalid",
      );
    const ell = [100, 100, 500, 100, 500, 300, 300, 300, 300, 600, 100, 600];

    it("takes a concave walk area, a hole inside it, and areas that share an edge", () => {
      expect(
        navIssues(
          nav("room", ell),
          nav("pillar", [150, 150, 250, 150, 250, 250, 150, 250], "block"),
          nav("hall", [500, 100, 800, 100, 800, 300, 500, 300]),
        ),
      ).toEqual([]);
    });

    it("refuses a self-intersecting polygon, without poly-invalid", () => {
      const issues = navIssues(nav("bowtie", [100, 100, 300, 300, 300, 100, 100, 300]));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        code: "nav-invalid",
        severity: "error",
        path: "/entities/1/shape",
        entityIds: ["bowtie"],
      });
    });

    it("refuses a hole outside every walk area, or across an area's edge", () => {
      const outside = navIssues(
        nav("room", ell),
        nav("stray", [700, 700, 800, 700, 800, 800, 700, 800], "block"),
      );
      expect(outside).toEqual([
        expect.objectContaining({
          code: "nav-invalid",
          path: "/entities/2/shape",
          entityIds: ["stray"],
        }),
      ]);
      const across = navIssues(
        nav("room", ell),
        nav("ledge", [450, 150, 550, 150, 550, 250, 450, 250], "block"),
      );
      expect(across.map((i) => i.entityIds)).toEqual([["ledge"]]);
    });

    it("refuses two walk areas whose interiors overlap, naming both", () => {
      const issues = navIssues(
        nav("room", ell),
        nav("annex", [400, 200, 700, 200, 700, 400, 400, 400]),
      );
      expect(issues).toEqual([
        expect.objectContaining({
          code: "nav-invalid",
          path: "/entities/2/shape",
          entityIds: ["room", "annex"],
        }),
      ]);
    });

    it("skips nav entities that are off", () => {
      expect(
        navIssues({ ...nav("bowtie", [100, 100, 300, 300, 300, 100, 100, 300]), off: true }),
      ).toEqual([]);
    });
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

  it("non-integer on shape and point bulk, entity points and paths: lengths off whole px", () => {
    const def = gameScene({ solid: [["box", 500.005, 920, 400, 20]], flag: [[800, 900.0025]] }, [
      lift([
        [200, 700],
        [400.005, 700],
      ]),
      { id: "spot", type: "marker", at: [10.005, 10] },
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
      { id: "spot", type: "marker", at: [10.005, 10] },
    ]);
    const issues = validateScene(def, fake, { lines: formatScene(def).lines });
    expect(issues.map((i) => [i.severity, i.code])).toEqual([
      ["error", "dup-id"],
      ["warn", "fake/no-flag"],
      ["warn", "non-integer"],
    ]);
    expect(issues.every((i) => typeof i.line === "number")).toBe(true);
  });

  it("layer-unknown on entities and instances, with a did-you-mean and a fix that unsets it", () => {
    const def = scene({}, [
      { id: "spot", type: "marker", at: [10, 10], layer: "gamplay" as never },
    ]);
    const issue = only(validateScene(def, engine), "layer-unknown");
    expect(issue).toMatchObject({
      path: "/entities/1/layer",
      entityIds: ["spot"],
      got: "gamplay",
      expected: "terrain | decor | gameplay | editor",
    });
    expect(issue.message).toContain('did you mean "gameplay"?');
    expect(issue.fix?.ops).toEqual([{ op: "update", ref: "spot", unset: ["layer"] }]);
    expectFixClears(def, issue);

    const placed = scene({
      instances: [{ id: "p", prefab: "post", at: [100, 100], layer: "sky" as never }],
    });
    const prefabs = yardPrefabs();
    const onInstance = only(validateScene(placed, engine, { prefabs }), "layer-unknown");
    expect(onInstance).toMatchObject({ path: "/instances/0/layer", entityIds: ["p"] });
    expect(onInstance.message).not.toContain("did you mean");
    const applied = applyOps(placed, onInstance.fix!, engine, { prefabs });
    expect(applied.ok && applied.def.instances?.[0]?.layer).toBe(undefined);
  });

  it("takes a game's own layers", () => {
    const layered = createRegistry(
      defineGame({
        id: "layered",
        types: [],
        layers: [
          { name: "back", description: "Back.", draw: 0 },
          { name: "front", description: "Front.", draw: 10 },
        ],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const ok = scene({ game: "layered" }, [
      { id: "a", type: "marker", at: [1, 1], layer: "front" as never },
    ]);
    expect(validateScene(ok, layered).filter((i) => i.code === "layer-unknown")).toEqual([]);
    const bad = scene({ game: "layered" }, [
      { id: "a", type: "marker", at: [1, 1], layer: "gameplay" as never },
    ]);
    expect(only(validateScene(bad, layered), "layer-unknown").expected).toBe("back | front");
  });

  it("grid-invalid on settings.grid's values, never on a good grid", () => {
    const hex = (grid: Record<string, unknown>) =>
      scene({
        settings: {
          grid: {
            kind: "hex",
            cell: [0.32, 0.28],
            side: 0.16,
            stagger: "x",
            index: "odd",
            ...grid,
          },
        } as never,
      });
    const codes = (def: SceneDefinition) =>
      validateScene(def, engine).filter((i) => i.code === "grid-invalid");
    expect(codes(hex({}))).toEqual([]);
    expect(codes(hex({ side: 0 }))).toEqual([]);
    expect(codes(hex({ side: 0.32 }))).toEqual([]);
    expect(codes(hex({ stagger: "y", side: 0.28, origin: [-0.04, 0.08] }))).toEqual([]);
    expect(
      codes(scene({ settings: { grid: { kind: "square", cell: [0.16, 0.16] } } as never })),
    ).toEqual([]);

    const tooWide = only(validateScene(hex({ side: 0.33 }), engine), "grid-invalid");
    expect(tooWide).toMatchObject({
      path: "/settings/grid/side",
      expected: "a whole number of px in [0, 0.32] m",
      got: "0.33",
    });
    expect(tooWide.fix).toBeUndefined();
    expect(
      only(validateScene(hex({ stagger: "y", side: 0.3 }), engine), "grid-invalid"),
    ).toMatchObject({
      path: "/settings/grid/side",
      expected: "a whole number of px in [0, 0.28] m",
    });
    expect(only(validateScene(hex({ side: 0.0755 }), engine), "grid-invalid").path).toBe(
      "/settings/grid/side",
    );
    expect(only(validateScene(hex({ side: -0.01 }), engine), "grid-invalid").path).toBe(
      "/settings/grid/side",
    );

    const square = scene({
      settings: { grid: { kind: "square", cell: [0, 0.125], origin: [0.005, 0.03] } } as never,
    });
    expect(
      validateScene(square, engine)
        .filter((i) => i.code === "grid-invalid")
        .map((i) => i.path),
    ).toEqual(["/settings/grid/cell/0", "/settings/grid/cell/1", "/settings/grid/origin/0"]);
  });

  it("non-integer judges whole px at the game's px per metre, and its fix snaps to them", () => {
    const at32 = createRegistry(
      defineGame({
        id: "coarse",
        types: [],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
        world: { lengthUnit: 32 },
      }),
    );
    const def: SceneDefinition = {
      v: 1,
      game: "coarse",
      name: "t",
      bounds: [0, 0, 10, 10],
      solid: [["box", 5, 9.5, 4, 0.25, 45]],
      entities: [
        { id: "on", type: "marker", at: [0.03125, 1.5] },
        { id: "off", type: "marker", at: [0.32, 1] },
      ],
    };
    const issues = validateScene(def, at32).filter((i) => i.code === "non-integer");
    expect(issues.map((i) => [i.path, i.entityIds])).toEqual([["/entities/1/at/0", ["off"]]]);
    expect(issues[0]?.message).toContain("at 32 px per metre");
    expect(issues[0]?.fix?.ops).toEqual([{ op: "update", ref: "off", set: { at: [0.3125, 1] } }]);
    const turned = validateScene({ ...def, solid: [["box", 5, 9.5, 4, 0.25, 45.5]] }, at32).filter(
      (i) => i.code === "non-integer",
    );
    expect(turned.map((i) => i.path)).toContain("/solid/0/5");
    const far = validateScene(
      { ...def, solid: [], entities: [{ id: "far", type: "marker", at: [10.04, -0.01] }] },
      at32,
    ).find((i) => i.code === "out-of-bounds");
    expect(far?.fix?.ops).toEqual([
      { op: "setScene", set: { bounds: [0, -0.03125, 10.0625, 10] } },
    ]);
  });

  it("schema on a duplicated id in the assets header, with or without a project", () => {
    const def = scene({ assets: ["hit", "hit", "jump"] });
    const issue = only(validateScene(def, engine), "schema");
    expect(issue).toMatchObject({ path: "/assets/1", got: "hit" });
    expect(validateScene(scene({ assets: ["hit", "jump"] }), engine)).toEqual([]);
  });

  describe("asset ids", () => {
    const env: FieldEnv = { materials: [], materialDefs: new Map(), types: [], assets: () => [] };
    const painting = defineEntityType({
      type: "painting",
      description: "A framed picture.",
      system: createDataSystem,
      fields: (fieldEnv) => ({
        at: pointField("Where it hangs."),
        skin: assetField(fieldEnv, "texture", "Its picture.").optional(),
        cues: z
          .array(assetField(fieldEnv, ["sound", "music"], "A sound it plays."))
          .optional()
          .describe("Sounds it plays.")
          .meta({ title: "Cues" }),
      }),
    });
    const art = createRegistry(
      defineGame({
        id: "art",
        types: [painting],
        settings: { theme: assetField(env, "music", "The scene's music.").optional() },
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    let n = 0;
    const entry = (id: string, kind: string, extra: Partial<AssetEntry> = {}): AssetEntry => ({
      key: `k${n++}`,
      id,
      kind,
      path: `${id}.${kind}`,
      created: { at: n, by: "t" },
      ...extra,
    });
    const project = projectView({
      meta: { projectId: "p", layout: 2, name: "P" },
      assets: Object.fromEntries(
        [
          entry("sunset", "texture"),
          entry("boom", "sound"),
          entry("theme", "music"),
          entry("gone", "texture", { deleted: { at: 9, by: "t" } }),
        ].map((e) => [e.key, e]),
      ),
      history: {},
      code: {},
      build: {},
    });
    const artScene = (paint: Record<string, unknown>, over: Partial<SceneDefinition> = {}) =>
      scene({ game: "art", ...over }, [{ id: "pic", type: "painting", at: [10, 10], ...paint }]);
    const assetIssues = (def: SceneDefinition, withProject = true) =>
      validateScene(def, art, withProject ? { project } : {}).filter(
        (i) => i.code === "asset-missing" || i.code === "asset-kind",
      );

    it("pass when every id is live and of its field's kinds", () => {
      const def = artScene(
        { skin: "sunset", cues: ["boom", "theme"] },
        { settings: { theme: "theme" }, assets: ["boom", "sunset"] },
      );
      expect(assetIssues(def)).toEqual([]);
    });

    it("asset-missing with a did-you-mean over the live ids of the field's kinds", () => {
      const def = artScene({ skin: "sunst", cues: ["bom"] });
      const issues = assetIssues(def);
      expect(issues.map((i) => [i.code, i.path, i.got])).toEqual([
        ["asset-missing", "/entities/1/cues/0", "bom"],
        ["asset-missing", "/entities/1/skin", "sunst"],
      ]);
      const [cue, skin] = issues;
      expect(skin?.message).toBe(
        'pic.skin names texture "sunst", which the project doesn\'t have; did you mean "sunset"?',
      );
      expect(skin?.expected).toBe("texture");
      expect(skin?.entityIds).toEqual(["pic"]);
      expect(cue?.message).toContain('did you mean "boom"?');
      expect(cue?.expected).toBe("sound or music");
    });

    it("asset-missing for a trashed id, and none suggested from other kinds", () => {
      const [issue] = assetIssues(artScene({ skin: "gone" }));
      expect(issue?.code).toBe("asset-missing");
      expect(issue?.message).toContain("in the trash");
      expect(issue?.message).not.toContain("did you mean");
      const [other] = assetIssues(artScene({ skin: "bomb" }));
      expect(other?.message).not.toContain("did you mean");
    });

    it("asset-kind for a live id of the wrong kind", () => {
      const [issue, ...rest] = assetIssues(artScene({ skin: "boom" }));
      expect(rest).toEqual([]);
      expect(issue).toMatchObject({
        code: "asset-kind",
        path: "/entities/1/skin",
        expected: "texture",
        got: "sound",
        entityIds: ["pic"],
      });
    });

    it("checks settings fields and the assets header (any kind)", () => {
      const def = artScene({}, { settings: { theme: "boom" }, assets: ["sunset", "nope"] });
      expect(assetIssues(def).map((i) => [i.code, i.path, i.entityIds])).toEqual([
        ["asset-kind", "/settings/theme", []],
        ["asset-missing", "/assets/1", []],
      ]);
    });

    it("aren't checked without a project", () => {
      const def = artScene(
        { skin: "nope", cues: ["boom"] },
        { settings: { theme: "boom" }, assets: ["nope"] },
      );
      expect(assetIssues(def, false)).toEqual([]);
      expect(assetIssues(def).length).toBeGreaterThan(0);
    });
  });
});

describe("behaviors", () => {
  const HALO = defineBehavior({
    name: "test-game/halo",
    description: "A ring drawn around the glow.",
    fields: { radius: z.number().positive().default(8).describe("Px; default 8.") },
    requires: [GLOW.name],
  });
  const games = createRegistry(
    defineGame({ ...testGame, behaviors: [...(testGame.behaviors ?? []), HALO] }),
  );
  const behaviorScene = (extra: EntityDef[], over: Partial<SceneDefinition> = {}) =>
    scene({ game: "test-game", ...over }, extra);
  const lamp = (behaviors?: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    ({
      id: "lamp",
      type: LAMP.type,
      at: [100, 100],
      ...(behaviors ? { behaviors } : {}),
      ...over,
    }) as EntityDef;
  const codes = ["behavior-unknown", "behavior-forbidden", "behavior-missing", "schema"];
  const behaviorIssues = (def: SceneDefinition, prefabs?: ReadonlyMap<string, Prefab>) =>
    validateScene(def, games, { prefabs }).filter((i) => codes.includes(i.code));

  /** The fix goes through applyOps and leaves no issue of its code at its path. */
  function fixClears(def: SceneDefinition, issue: SceneIssue) {
    expect(issue.fix, issue.code).toBeDefined();
    const applied = applyOps(def, issue.fix!, games);
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    if (!applied.ok) return;
    const left = validateScene(applied.def, games).filter(
      (i) => i.code === issue.code && i.path === issue.path,
    );
    expect(left).toEqual([]);
  }

  it("pass carried blocks, required blocks left out, and type defaults under a block", () => {
    expect(behaviorIssues(behaviorScene([lamp()]))).toEqual([]);
    expect(
      behaviorIssues(
        behaviorScene([
          lamp({ "test-game/spin": {}, "test-game/halo": { radius: 4 } }),
          { id: "bare", type: "marker", at: [200, 100], behaviors: { "test-game/glow": {} } },
        ]),
      ),
    ).toEqual([]);
  });

  it("behavior-unknown with a did-you-mean among the type's behaviors, fixed by unsetting it", () => {
    const def = behaviorScene([lamp({ "test-game/spn": { speed: 3 } })]);
    const issue = only(behaviorIssues(def), "behavior-unknown");
    expect(issue).toMatchObject({
      path: "/entities/1/behaviors/test-game~1spn",
      entityIds: ["lamp"],
      got: "test-game/spn",
    });
    expect(issue.message).toContain('did you mean "test-game/spin"?');
    expect(issue.fix?.ops).toEqual([
      { op: "update", ref: "lamp", unset: ["behaviors.test-game/spn"] },
    ]);
    fixClears(def, issue);
  });

  it("behavior-unknown for a name outside the grammar rewrites the whole field", () => {
    const def = behaviorScene([lamp({ "Glow!": {}, "test-game/spin": {} })]);
    const issue = only(behaviorIssues(def), "behavior-unknown");
    expect(issue.fix?.ops).toEqual([
      { op: "update", ref: "lamp", set: { behaviors: { "test-game/spin": {} } } },
    ]);
  });

  it("behavior-forbidden on a type that forbids it, and on one that never loads", () => {
    const def = behaviorScene([
      { id: "plain", type: PLAIN.type, at: [100, 100], behaviors: { "test-game/spin": {} } },
      {
        id: "readme",
        type: "note",
        at: [200, 200],
        text: "hi",
        behaviors: { "test-game/glow": {} },
      },
    ]);
    const issues = behaviorIssues(def).filter((i) => i.code === "behavior-forbidden");
    expect(issues.map((i) => [i.path, i.entityIds])).toEqual([
      ["/entities/1/behaviors/test-game~1spin", ["plain"]],
      ["/entities/2/behaviors/test-game~1glow", ["readme"]],
    ]);
    expect(issues[0]?.message).toContain("doesn't allow");
    expect(issues[1]?.message).toContain("never loads");
    for (const issue of issues) fixClears(def, issue);
  });

  it("behavior-missing counts the type's required blocks, and its fix adds the block", () => {
    expect(behaviorIssues(behaviorScene([lamp({ "test-game/halo": {} })]))).toEqual([]);
    const def = behaviorScene([
      { id: "ring", type: "marker", at: [100, 100], behaviors: { "test-game/halo": {} } },
    ]);
    const issue = only(behaviorIssues(def), "behavior-missing");
    expect(issue).toMatchObject({
      path: "/entities/1/behaviors/test-game~1halo",
      entityIds: ["ring"],
      expected: "test-game/glow",
    });
    expect(issue.fix?.ops).toEqual([
      { op: "update", ref: "ring", set: { "behaviors.test-game/glow": {} } },
    ]);
    fixClears(def, issue);
  });

  it("behavior-missing has no fix when the type can't carry what's required", () => {
    const fussy = defineEntityType({
      type: "fussy",
      description: "Spins and haloes, never glows.",
      base: "marker",
      fields: { at: pointField("Where it stands.") },
      behaviors: { forbidden: [GLOW.name] },
    });
    const r = createRegistry(
      defineGame({
        ...testGame,
        types: [...testGame.types, fussy],
        behaviors: [...(testGame.behaviors ?? []), HALO],
      }),
    );
    const def = behaviorScene([
      { id: "f", type: "fussy", at: [100, 100], behaviors: { "test-game/halo": {} } },
    ]);
    const issue = only(validateScene(def, r), "behavior-missing");
    expect(issue.fix).toBeUndefined();
    expect(issue.message).toContain("doesn't allow");
  });

  it("schema inside a block at its field, the type's defaults under it, with a did-you-mean for keys", () => {
    const def = behaviorScene([
      lamp({ "test-game/glow": { color: "red" }, "test-game/spin": { sped: 4 } }),
    ]);
    const issues = behaviorIssues(def);
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ["schema", "/entities/1/behaviors/test-game~1glow/color"],
      ["schema", "/entities/1/behaviors/test-game~1spin/sped"],
    ]);
    expect(issues[0]?.message).toContain("lamp.behaviors.test-game/glow.color");
    expect(issues[0]?.got).toBe('"red"');
    expect(issues[1]?.message).toContain('did you mean "speed"?');
    const notBlock = behaviorScene([lamp({ "test-game/spin": 3 })]);
    expect(only(behaviorIssues(notBlock), "schema").path).toBe(
      "/entities/1/behaviors/test-game~1spin",
    );
  });

  it("checks instance children where they land, pointing at the instance", () => {
    const prefabs = new Map<string, Prefab>([
      [
        "post",
        {
          kind: "prefab",
          v: 3,
          id: "post",
          game: "test-game",
          entities: [{ id: "cap", type: "marker", at: [0, 0], behaviors: { "test-game/glw": {} } }],
        },
      ],
    ]);
    const def = behaviorScene([], { instances: [{ id: "p1", prefab: "post", at: [300, 300] }] });
    const issue = only(behaviorIssues(def, prefabs), "behavior-unknown");
    expect(issue.path).toBe("/instances/0");
    expect(issue.entityIds).toEqual(["p1/cap"]);
  });

  it("asset fields inside a block are asset-missing and asset-kind", () => {
    const FRAME = defineBehavior({
      name: "framed/frame",
      description: "A picture frame.",
      fields: (env) => ({ skin: assetField(env, "texture", "The frame's look.").optional() }),
    });
    const framed = createRegistry(
      defineGame({
        id: "framed",
        types: [],
        behaviors: [FRAME],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const asset = (id: string, kind: string): AssetEntry => ({
      key: `k-${id}`,
      id,
      kind,
      path: `${id}.${kind}`,
      created: { at: 0, by: "t" },
    });
    const project = projectView({
      meta: { projectId: "p", layout: 2, name: "P" },
      assets: { "k-oak": asset("oak", "texture"), "k-boom": asset("boom", "sound") },
      history: {},
      code: {},
      build: {},
    });
    const at = (skin: string) =>
      scene({ game: "framed" }, [
        { id: "pic", type: "marker", at: [10, 10], behaviors: { "framed/frame": { skin } } },
      ]);
    const assetIssues = (def: SceneDefinition) =>
      validateScene(def, framed, { project }).filter((i) => i.code.startsWith("asset-"));
    expect(assetIssues(at("oak"))).toEqual([]);
    const [missing] = assetIssues(at("oakk"));
    expect(missing).toMatchObject({
      code: "asset-missing",
      path: "/entities/1/behaviors/framed~1frame/skin",
      entityIds: ["pic"],
    });
    expect(missing?.message).toContain('did you mean "oak"?');
    expect(assetIssues(at("boom"))).toMatchObject([{ code: "asset-kind", got: "sound" }]);
  });
});

describe("tween blocks", () => {
  const tweened = (
    id: string,
    type: string,
    to: Record<string, number>,
    more: Partial<EntityDef> = {},
  ): EntityDef =>
    ({
      id,
      type,
      ...(type === "marker" || type === "decor" ? { at: [100, 100] } : {}),
      ...(type === "solid" || type === "sensor" || type === "prop"
        ? { shape: ["box", 100, 100, 10, 10] }
        : {}),
      ...more,
      behaviors: {
        ...(more.behaviors as Record<string, unknown> | undefined),
        tween: {
          tweens: [
            { to: { x: 1 }, duration: 10 },
            { to, duration: 10 },
          ],
        },
      },
    }) as EntityDef;
  const tweenIssues = (def: SceneDefinition, registry: Registry = engine) =>
    validateScene(def, registry, { lines: formatScene(def).lines }).filter(
      (i) => i.code === "tween-target-invalid",
    );

  it("pass on a marker, decor, solid or sensor, and visual channels beside a sprite", () => {
    const def = scene({}, [
      tweened("a", "marker", { rot: 1 }),
      tweened("b", "decor", { y: 2 }),
      tweened("c", "solid", { x: 3 }),
      tweened("d", "sensor", { x: 3 }),
      tweened("e", "marker", { alpha: 0, tint: 0xff0000, scale: 2 }, { behaviors: { sprite: {} } }),
    ]);
    expect(tweenIssues(def)).toEqual([]);
  });

  it("tween-target-invalid on a type that can't be posed, at the entry", () => {
    const def = scene({ settings: { physics: "rapier" } }, [
      tweened("crate", "prop", { y: 2 }, { density: 1, restitution: 0 } as Partial<EntityDef>),
    ]);
    const issues = tweenIssues(def);
    expect(issues.map((i) => [i.path, i.severity, i.entityIds, i.message])).toEqual([
      [
        "/entities/1/behaviors/tween/tweens/0",
        "error",
        ["crate"],
        "crate's tween 1 can't play: it is a prop, which can't be posed, so a tween can't move its x",
      ],
      [
        "/entities/1/behaviors/tween/tweens/1",
        "error",
        ["crate"],
        "crate's tween 2 can't play: it is a prop, which can't be posed, so a tween can't move its y",
      ],
    ]);
    expect(issues[0]!.line).toBeTypeOf("number");
  });

  it("tween-target-invalid on the pose of a solid or sensor riding a host, as the run refuses it", () => {
    const def = scene({ settings: { physics: "rapier" } }, [
      lift([
        [0, 0],
        [200, 0],
      ]),
      tweened("plank", "solid", { y: 3 }, { attach: "lift" } as Partial<EntityDef>),
      tweened("gate", "sensor", { y: 3 }, { attach: "lift" } as Partial<EntityDef>),
      tweened("door", "solid", { y: 3 }),
    ]);
    const issues = tweenIssues(def);
    expect(issues.map((i) => [i.path, i.entityIds])).toEqual([
      ["/entities/2/behaviors/tween/tweens/0", ["plank"]],
      ["/entities/2/behaviors/tween/tweens/1", ["plank"]],
      ["/entities/3/behaviors/tween/tweens/0", ["gate"]],
      ["/entities/3/behaviors/tween/tweens/1", ["gate"]],
    ]);
    expect(issues[1]!.message).toBe(
      `plank's tween 2 can't play: it is a solid riding "lift", which can't be posed, so a tween can't move its y`,
    );
  });

  it("tween-target-invalid for a visual channel on an entity without a sprite", () => {
    const def = scene({}, [tweened("spot", "marker", { alpha: 0.5, tint: 0 })]);
    expect(tweenIssues(def).map((i) => [i.path, i.message])).toEqual([
      [
        "/entities/1/behaviors/tween/tweens/1",
        "spot's tween 2 can't play: it has no sprite, so a tween can't animate its alpha, tint",
      ],
    ]);
  });

  it("judges a game type by its base, and leaves one with its own system to the run", () => {
    const registry = createRegistry(testGame);
    const def = scene({ game: "test-game" }, [{ ...tweened("l", LAMP.type, { rot: 1 }) }]);
    expect(tweenIssues(def, registry)).toEqual([]);
    const types = registry.types;
    expect(posableType(types.get("follower")!)).toBe(false);
    expect(posableType(types.get("prop")!)).toBe(false);
    expect(posableType(types.get("decor")!)).toBe(true);
    expect(posableType(types.get(LAMP.type)!)).toBe(true);
    expect(posableType({ type: "own", origin: "g", system: () => ({}) as never })).toBeNull();
    expect(posableType({ type: "on-prop", origin: "g", base: "prop" })).toBe(false);
  });
});

describe("sprite blocks", () => {
  const entry = (id: string, kind: string, extra: Partial<AssetEntry> = {}): AssetEntry => ({
    key: `k-${id}`,
    id,
    kind,
    path: `${id}.${kind}`,
    created: { at: 0, by: "t" },
    ...extra,
  });
  const frame = (x: number) => ({ x, y: 0, w: 16, h: 16 });
  const project = projectView({
    meta: { projectId: "p", layout: 2, name: "P" },
    assets: Object.fromEntries(
      [
        entry("crate", "texture", {
          sha256: "a".repeat(64),
          meta: { format: "png", width: 32, height: 32 },
        }),
        entry("hero", "atlas", {
          sha256: "b".repeat(64),
          meta: {
            tool: "aseprite",
            frames: { "idle-0": frame(0), "idle-1": frame(16), "run-0": frame(32) },
            tags: [],
            slices: [],
            order: ["idle-0", "idle-1", "run-0"],
          },
          import: { texture: "crate" },
        }),
        entry("boom", "sound"),
      ].map((e) => [e.key, e]),
    ),
    history: {},
    code: {},
    build: {},
  });
  const spriteScene = (sprite: Record<string, unknown>) =>
    scene({}, [{ id: "pic", type: "marker", at: [10, 10], behaviors: { sprite } }]);
  const spriteIssues = (def: SceneDefinition, withProject = true) =>
    validateScene(def, engine, withProject ? { project } : {}).filter(
      (i) => i.code === "asset-frame-unknown" || i.code === "sprite-no-asset",
    );

  it("pass for a texture, and for an atlas with one of its frames", () => {
    expect(spriteIssues(spriteScene({ asset: "crate" }))).toEqual([]);
    expect(spriteIssues(spriteScene({ asset: "hero", frame: "run-0" }))).toEqual([]);
  });

  it("asset-frame-unknown for a frame the atlas lacks, with a did-you-mean", () => {
    const issue = only(
      spriteIssues(spriteScene({ asset: "hero", frame: "idle-2" })),
      "asset-frame-unknown",
    );
    expect(issue).toMatchObject({
      severity: "error",
      path: "/entities/1/behaviors/sprite/frame",
      entityIds: ["pic"],
      got: "idle-2",
      expected: "idle-0 | idle-1 | run-0",
    });
    expect(issue.message).toBe(
      'pic\'s sprite names frame "idle-2", which atlas "hero" doesn\'t have; did you mean "idle-0"?',
    );
  });

  it("asset-frame-unknown for an atlas without a frame", () => {
    const issue = only(spriteIssues(spriteScene({ asset: "hero" })), "asset-frame-unknown");
    expect(issue).toMatchObject({ path: "/entities/1/behaviors/sprite", entityIds: ["pic"] });
    expect(issue.message).toContain("names no frame");
  });

  it("sprite-no-asset, a warning, for a block without an asset", () => {
    const issue = only(spriteIssues(spriteScene({ scale: 2 })), "sprite-no-asset");
    expect(issue).toMatchObject({
      severity: "warn",
      path: "/entities/1/behaviors/sprite",
      entityIds: ["pic"],
    });
  });

  it("leaves a missing or wrong-kind asset to the asset checks", () => {
    const missing = validateScene(spriteScene({ asset: "hro", frame: "x" }), engine, { project });
    expect(missing.map((i) => i.code)).toContain("asset-missing");
    const wrong = validateScene(spriteScene({ asset: "boom" }), engine, { project });
    expect(wrong.map((i) => i.code)).toContain("asset-kind");
    expect(spriteIssues(spriteScene({ asset: "hro", frame: "x" }))).toEqual([]);
    expect(spriteIssues(spriteScene({ asset: "boom" }))).toEqual([]);
  });

  it("aren't checked without a project", () => {
    expect(spriteIssues(spriteScene({}), false)).toEqual([]);
    expect(spriteIssues(spriteScene({ asset: "hero" }), false)).toEqual([]);
  });

  it("check a block a type requires, pointing at the entity", () => {
    const decal = defineEntityType({
      type: "decal",
      description: "A picture on the wall.",
      system: createDataSystem,
      fields: { at: pointField("Where it hangs.") },
      behaviors: { required: { sprite: {} } },
    });
    const walls = createRegistry(
      defineGame({
        id: "walls",
        types: [decal],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const def = scene({ game: "walls" }, [{ id: "d", type: "decal", at: [5, 5] }]);
    const issue = only(validateScene(def, walls, { project }), "sprite-no-asset");
    expect(issue.path).toBe("/entities/1");
  });
});

describe("anim blocks", () => {
  const entry = (id: string, kind: string, extra: Partial<AssetEntry> = {}): AssetEntry => ({
    key: `k-${id}`,
    id,
    kind,
    path: `${id}.${kind}`,
    created: { at: 0, by: "t" },
    ...extra,
  });
  const frame = (x: number) => ({ x, y: 0, w: 16, h: 16 });
  const project = projectView({
    meta: { projectId: "p", layout: 2, name: "P" },
    assets: Object.fromEntries(
      [
        entry("hero", "atlas", {
          sha256: "b".repeat(64),
          meta: {
            tool: "aseprite",
            frames: { "idle-0": frame(0), "run-0": frame(16) },
            tags: [
              { name: "idle", from: 0, to: 0, direction: "forward" },
              { name: "run", from: 1, to: 1, direction: "forward" },
            ],
            slices: [],
            order: ["idle-0", "run-0"],
          },
        }),
        entry("moves", "animation"),
      ].map((e) => [e.key, e]),
    ),
    history: {},
    code: {},
    build: {},
  });
  const moves: AnimationFile = {
    kind: "animation",
    v: 1,
    atlas: "hero",
    clips: [
      { name: "jab", frames: [{ frame: "idle-0" }] },
      { name: "kick", tag: "run" },
    ],
  };
  const runtime = {
    doc: <T>(kind: string, id: string): T | undefined =>
      kind === "animation" && id === "moves" ? (moves as T) : undefined,
  };
  const animScene = (anim: Record<string, unknown>) =>
    scene({}, [
      {
        id: "pic",
        type: "marker",
        at: [10, 10],
        behaviors: { sprite: { asset: "hero", frame: "idle-0" }, anim },
      },
    ]);
  const clipIssues = (def: SceneDefinition, withRuntime = true) =>
    validateScene(def, engine, withRuntime ? { project, runtime } : { project }).filter(
      (i) => i.code === "anim-clip-unknown",
    );

  it("pass for an atlas's tag and an animation's clip", () => {
    expect(clipIssues(animScene({ source: "hero", clip: "run" }))).toEqual([]);
    expect(clipIssues(animScene({ source: "moves", clip: "kick" }))).toEqual([]);
  });

  it("anim-clip-unknown for a clip an atlas source has no tag for, with a did-you-mean", () => {
    const issue = only(clipIssues(animScene({ source: "hero", clip: "rum" })), "anim-clip-unknown");
    expect(issue).toMatchObject({
      severity: "error",
      path: "/entities/1/behaviors/anim/clip",
      entityIds: ["pic"],
      got: "rum",
      expected: "idle | run",
    });
    expect(issue.message).toBe(
      'pic\'s anim plays clip "rum", which atlas "hero" doesn\'t have; did you mean "run"?',
    );
  });

  it("anim-clip-unknown for a clip an animation source lacks, read through the runtime view", () => {
    const issue = only(
      clipIssues(animScene({ source: "moves", clip: "jabb" })),
      "anim-clip-unknown",
    );
    expect(issue).toMatchObject({ got: "jabb", expected: "jab | kick" });
    expect(issue.message).toBe(
      'pic\'s anim plays clip "jabb", which animation "moves" doesn\'t have; did you mean "jab"?',
    );
  });

  it("leave an animation source unchecked without the runtime view, and a missing source to the asset checks", () => {
    expect(clipIssues(animScene({ source: "moves", clip: "jabb" }), false)).toEqual([]);
    const missing = validateScene(animScene({ source: "mvoes", clip: "jab" }), engine, {
      project,
      runtime,
    });
    expect(missing.map((i) => i.code)).toContain("asset-missing");
    expect(missing.map((i) => i.code)).not.toContain("anim-clip-unknown");
  });
});

describe("grid fields", () => {
  const PAINT = defineEntityType({
    type: "paint",
    description: "Painted cells.",
    base: "marker",
    fields: { at: pointField("The grid's corner."), cells: gridField("The cells.").optional() },
  });
  const painter = createRegistry(
    defineGame({
      id: "painter",
      types: [PAINT],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    }),
  );
  const cells = { "0,0": ["1*4", "", "2"] };
  const square = { kind: "square", cell: [32, 32] } as const;
  const floor = (over: Record<string, unknown> = {}): EntityDef => ({
    id: "floor",
    type: "paint",
    at: [64, 64],
    cells,
    ...over,
  });
  const prefabs = new Map<string, Prefab>([
    [
      "tiles",
      { kind: "prefab", v: 3, id: "tiles", game: "painter", entities: [floor({ at: [0, 0] })] },
    ],
    [
      "nest",
      {
        kind: "prefab",
        v: 3,
        id: "nest",
        game: "painter",
        entities: [],
        instances: [{ id: "inner", prefab: "tiles", at: [0, 0], rot: 2 }],
      },
    ],
  ]);
  const gridScene = (
    settings: Record<string, unknown> | undefined,
    over: Partial<SceneDefinition> = {},
    extra: EntityDef[] = [],
  ) =>
    scene(
      { game: "painter", ...(settings ? { settings: { grid: settings } as never } : {}), ...over },
      extra,
    );
  const gridIssues = (def: SceneDefinition) =>
    validateScene(def, painter, { prefabs }).filter((i) => i.code === "grid-invalid");

  it("pass on a scene with a grid, turned or not, when its cells are square", () => {
    expect(gridIssues(gridScene(square, {}, [floor()]))).toEqual([]);
    expect(
      gridIssues(
        gridScene(square, {
          groups: { g: { at: [0, 0], rot: 1 } },
          instances: [{ id: "t1", prefab: "tiles", at: [128, 128], flip: true, group: "g" }],
        }),
      ),
    ).toEqual([]);
    expect(gridIssues(gridScene(undefined, {}, [floor({ cells: undefined })]))).toEqual([]);
  });

  it("a grid field in a scene without settings.grid", () => {
    const [issue, ...rest] = gridIssues(gridScene(undefined, {}, [floor()]));
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ path: "/entities/1/cells", entityIds: ["floor"] });
    expect(issue?.message).toContain("no settings.grid");
    const child = gridIssues(
      gridScene(undefined, { instances: [{ id: "t1", prefab: "tiles", at: [128, 128] }] }),
    );
    expect(child.map((i) => [i.path, i.entityIds])).toEqual([["/instances/0", ["t1/floor"]]]);
  });

  it("a prefab view's grid children need no settings.grid: the placing scene sizes them", () => {
    for (const id of ["tiles", "nest"]) {
      const view = prefabScene(prefabs.get(id)!, [-512, -512, 512, 512]);
      expect(validateScene(view, painter, { prefabs, prefab: id })).toEqual([]);
    }
  });

  it("a prefab view judges a turned nested instance over grid children against the game's grid", () => {
    const view = prefabScene(prefabs.get("nest")!, [-512, -512, 512, 512]);
    const judged = (grid: Record<string, unknown> | undefined) =>
      validateScene(view, painter, {
        prefabs,
        prefab: "nest",
        ...(grid ? { settings: { game: { grid: grid as never } } } : {}),
      });
    const flagged = judged({ kind: "square", cell: [32, 16] });
    expect(flagged.map((i) => [i.code, i.path, i.entityIds])).toEqual([
      ["grid-invalid", "/instances/0/rot", ["inner"]],
    ]);
    expect(flagged[0]?.message).toContain("inner/floor");
    expect(flagged[0]?.message).toContain("the game's grid");
    expect(
      validateScene(view, painter, {
        prefabs,
        prefab: "nest",
        settings: {
          game: { grid: { kind: "hex", cell: [32, 28], side: 16, stagger: "x", index: "odd" } },
        },
      }).map((i) => i.code),
    ).toEqual(["grid-invalid"]);
    expect(judged(square)).toEqual([]);
    expect(judged(undefined)).toEqual([]);
  });

  const painterWith = (world: { grid: Record<string, unknown> }) =>
    createRegistry(
      defineGame({
        id: "painter",
        types: [PAINT],
        actions: [],
        world: world as never,
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );

  it("a game's world.grid sizes grid fields in a scene without settings.grid", () => {
    const world = painterWith({ grid: square });
    const def = gridScene(undefined, {}, [floor()]);
    expect(validateScene(def, world, { prefabs }).filter((i) => i.code === "grid-invalid")).toEqual(
      [],
    );
  });

  it("ValidateOptions.engine resolves as expandScene does: the project block gives no grid", () => {
    const def = gridScene(undefined, {}, [floor()]);
    const issues = validateScene(def, painter, { prefabs, engine: { grid: square } }).filter(
      (i) => i.code === "grid-invalid",
    );
    expect(issues.map((i) => i.path)).toEqual(["/entities/1/cells"]);
    expect(
      validateScene(def, painterWith({ grid: square }), {
        prefabs,
        engine: { gravity: [0, 0], physics: "none" },
      }).filter((i) => i.code === "grid-invalid"),
    ).toEqual([]);
  });

  it("judges a turned instance over grid children against the game's world.grid", () => {
    const def = gridScene(undefined, {
      instances: [{ id: "t1", prefab: "tiles", at: [128, 128], rot: 1 }],
    });
    const flagged = validateScene(def, painterWith({ grid: { kind: "square", cell: [32, 16] } }), {
      prefabs,
    }).filter((i) => i.code === "grid-invalid");
    expect(flagged.map((i) => [i.path, i.entityIds])).toEqual([["/instances/0/rot", ["t1"]]]);
    expect(
      validateScene(def, painterWith({ grid: square }), { prefabs }).filter(
        (i) => i.code === "grid-invalid",
      ),
    ).toEqual([]);
    const view = prefabScene(prefabs.get("nest")!, [-512, -512, 512, 512]);
    expect(
      validateScene(view, painterWith({ grid: { kind: "square", cell: [32, 16] } }), {
        prefabs,
        prefab: "nest",
      }).map((i) => i.code),
    ).toEqual(["grid-invalid"]);
  });

  it("an override naming a grid field, with a fix that drops it", () => {
    const def = gridScene(square, {
      instances: [
        {
          id: "t1",
          prefab: "tiles",
          at: [128, 128],
          overrides: { "floor.cells": { "0,0": ["3"] }, "floor.at": [8, 8] },
        },
      ],
    });
    const [issue, ...rest] = gridIssues(def);
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({
      path: "/instances/0/overrides/floor.cells",
      entityIds: ["t1"],
      fix: { ops: [{ op: "revertOverride", ref: "t1", paths: ["floor.cells"] }] },
    });
    expect(validateScene(def, painter, { prefabs }).map((i) => i.code)).not.toContain(
      "unused-override",
    );
  });

  it("a variant's override naming a grid field, judged in the variant's own view", () => {
    const lib = new Map(prefabs);
    lib.set("tiles-red", {
      kind: "prefab",
      v: 3,
      id: "tiles-red",
      game: "painter",
      base: "tiles",
      entities: [],
      overrides: { "floor.cells": { "0,0": ["3"] }, "floor.at": [8, 8] },
    });
    const view = prefabScene(lib.get("tiles-red")!, [-512, -512, 512, 512]);
    const issues = validateScene(view, painter, { prefabs: lib, prefab: "tiles-red" });
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ["grid-invalid", "/overrides/floor.cells"],
    ]);
    const fix = issues[0]!.fix!;
    expect(fix.ops).toEqual([{ op: "revertOverride", paths: ["floor.cells"] }]);
    const fixed = applyOps(view, fix, painter, { prefabs: lib, prefab: "tiles-red" });
    if (!fixed.ok) throw new Error(fixed.issue.message);
    expect(fixed.prefabs?.get("tiles-red")?.overrides).toEqual({ "floor.at": [8, 8] });
    expect(
      validateScene(fixed.def, painter, { prefabs: fixed.prefabs!, prefab: "tiles-red" }),
    ).toEqual([]);
  });

  it("a turned or flipped instance or group over a grid, unless its cells are square", () => {
    const tall = { kind: "square", cell: [32, 16] };
    const hex = { kind: "hex", cell: [32, 28], side: 16, stagger: "y", index: "odd" };
    const turned = gridIssues(
      gridScene(tall, { instances: [{ id: "t1", prefab: "tiles", at: [128, 128], rot: 1 }] }),
    );
    expect(turned.map((i) => [i.path, i.entityIds])).toEqual([["/instances/0/rot", ["t1"]]]);
    expect(turned[0]?.message).toContain("t1/floor");
    expect(turned[0]?.message).toContain("32×16");

    const grouped = gridIssues(
      gridScene(hex, { groups: { g: { at: [0, 0], flip: true } } }, [floor({ group: "g" })]),
    );
    expect(grouped.map((i) => [i.path, i.entityIds])).toEqual([["/groups/g/flip", ["g"]]]);
    expect(grouped[0]?.message).toContain("hex");

    const viaGroup = gridIssues(
      gridScene(tall, {
        groups: { g: { at: [0, 0], rot: 3 } },
        instances: [{ id: "t1", prefab: "tiles", at: [128, 128], group: "g" }],
      }),
    );
    expect(viaGroup.map((i) => i.path)).toEqual(["/instances/0"]);
  });

  it("follows nested instances, where turns compose and may cancel", () => {
    const tall = { kind: "square", cell: [32, 16] };
    const nested = gridIssues(
      gridScene(tall, { instances: [{ id: "n1", prefab: "nest", at: [0, 0] }] }),
    );
    expect(nested.map((i) => [i.path, i.message.includes("n1/inner/floor")])).toEqual([
      ["/instances/0", true],
    ]);
    const cancelled = gridIssues(
      gridScene(tall, { instances: [{ id: "n1", prefab: "nest", at: [0, 0], rot: 2 }] }),
    );
    expect(cancelled).toEqual([]);
  });
});

describe("physics-required", () => {
  const crate: EntityDef = {
    id: "crate",
    type: "prop",
    shape: ["box", 200, 200, 20, 20],
    density: 1,
    restitution: 0,
  };
  const none = { physics: "none" } as const;
  const required = (def: SceneDefinition, registry: Registry = engine, opts = {}) =>
    validateScene(def, registry, opts).filter((i) => i.code === "physics-required");

  it("sets each primitive's physics: only prop requires it", () => {
    expect(
      Object.fromEntries(Object.entries(PRIMITIVES).map(([name, def]) => [name, typePhysics(def)])),
    ).toEqual({
      solid: "optional",
      sensor: "optional",
      marker: "optional",
      prop: "required",
      follower: "optional",
      decor: "optional",
      nav: "optional",
      "camera-region": "optional",
      note: "optional",
    });
  });

  it("flags a prop in a scene whose physics is none, and only then", () => {
    const [issue, ...rest] = required(scene({ settings: none }, [crate]));
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({
      severity: "error",
      path: "/entities/1",
      entityIds: ["crate"],
    });
    expect(issue?.message).toContain('"none"');
    expect(required(scene({}, [crate]))).toEqual([]);
    expect(required(scene({ settings: { physics: "rapier" } }, [crate]))).toEqual([]);
    expect(required(scene({ settings: none }, [{ ...crate, off: true }]))).toEqual([]);
    expect(required(scene({ settings: none }))).toEqual([]);
  });

  it("fixes by setting the scene's physics to rapier, over a project that says none", () => {
    const def = scene({ settings: { ...none, gravity: [0, 900] } }, [
      crate,
      { ...crate, id: "crate-2" },
    ]);
    const issues = required(def);
    expect(issues).toHaveLength(2);
    expect(engine.issueCodes["physics-required"]?.fixable).toBe(true);
    for (const issue of issues) {
      expect(issue.fix).toEqual({
        label: 'Set the scene\'s physics to "rapier"',
        ops: [{ op: "setSettings", set: { physics: "rapier" } }],
      });
    }
    const applied = applyOps(def, issues[0]!.fix!, engine);
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    if (!applied.ok) return;
    expect(applied.def.settings).toEqual({ physics: "rapier", gravity: [0, 900] });
    expect(required(applied.def)).toEqual([]);
    expect(required(applied.def, engine, { engine: none })).toEqual([]);

    const rider = scene({}, [
      lift([
        [100, 100],
        [300, 100],
      ]),
      { id: "deck", type: "sensor", shape: ["box", 100, 100, 20, 5], attach: "lift" },
    ]);
    const [attach] = required(rider, engine, { engine: none });
    const fixed = applyOps(rider, attach!.fix!, engine);
    expect(fixed.ok).toBe(true);
    if (fixed.ok) expect(required(fixed.def, engine, { engine: none })).toEqual([]);
  });

  it("resolves physics through the project's engine block and the game's world", () => {
    expect(required(scene({}, [crate]), engine, { engine: none }).map((i) => i.path)).toEqual([
      "/entities/1",
    ]);
    expect(
      required(scene({ settings: { physics: "rapier" } }, [crate]), engine, { engine: none }),
    ).toEqual([]);
    const still = createRegistry(
      defineGame({
        id: "still",
        types: [],
        actions: [],
        world: { physics: "none" },
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    expect(required(scene({ game: "still" }, [crate]), still)).toHaveLength(1);
    expect(
      required(scene({ game: "still" }, [crate]), still, { engine: { physics: "rapier" } }),
    ).toEqual([]);
  });

  it("a game type requires physics as its base primitive does, unless it says otherwise", () => {
    const fields = (env: FieldEnv) => primitiveFields("prop", env);
    const crates = createRegistry(
      defineGame({
        id: "crates",
        types: [
          defineEntityType({ type: "box", description: "A box.", base: "prop", fields }),
          defineEntityType({
            type: "ghost",
            description: "Drawn where a box would be.",
            base: "prop",
            physics: "optional",
            fields,
          }),
          defineEntityType({
            type: "anchor",
            description: "Needs a world to hang from.",
            base: "marker",
            physics: "required",
            fields: (env) => primitiveFields("marker", env),
          }),
        ],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const def = scene({ game: "crates", settings: none }, [
      { ...crate, id: "a", type: "box" },
      { ...crate, id: "b", type: "ghost" },
      { id: "c", type: "anchor", at: [10, 10] },
    ]);
    expect(required(def, crates).map((i) => i.entityIds)).toEqual([["a"], ["c"]]);
  });

  it("flags an attach, pointing at the field, but not the follower it rides", () => {
    const rider: EntityDef = {
      id: "deck",
      type: "sensor",
      shape: ["box", 100, 100, 20, 5],
      attach: "lift",
    };
    const def = scene({ settings: none }, [
      lift([
        [100, 100],
        [300, 100],
      ]),
      rider,
    ]);
    const [issue, ...rest] = required(def);
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ path: "/entities/2/attach", entityIds: ["deck"] });
    expect(issue?.message).toContain("lift");
    expect(required({ ...def, settings: {} })).toEqual([]);
  });

  it("judges instance children in the placing scene, not in the prefab's view", () => {
    const prefabs = new Map<string, Prefab>([
      [
        "crate",
        {
          kind: "prefab",
          v: 3,
          id: "crate",
          entities: [{ ...crate, shape: ["box", 0, 0, 20, 20] }],
        },
      ],
    ]);
    const def = scene({
      settings: none,
      instances: [{ id: "c1", prefab: "crate", at: [300, 300] }],
    });
    expect(required(def, engine, { prefabs }).map((i) => [i.path, i.entityIds])).toEqual([
      ["/instances/0", ["c1/crate"]],
    ]);
    const view = prefabScene(prefabs.get("crate")!, [-512, -512, 512, 512]);
    expect(required(view, engine, { prefabs, prefab: "crate", engine: none })).toEqual([]);
  });
});

describe("the occupant behavior needs a grid", () => {
  const piece = (over: Partial<EntityDef> = {}): EntityDef => ({
    id: "piece",
    type: "marker",
    at: [64, 64],
    behaviors: { [OCCUPANT.name]: {} },
    ...over,
  });
  const square = { kind: "square" as const, cell: [32, 32] as [number, number] };
  const gridIssues = (def: SceneDefinition, registry: Registry = engine, opts = {}) =>
    validateScene(def, registry, opts).filter((i) => i.code === "grid-invalid");

  it("an occupant in a scene with no grid is grid-invalid", () => {
    const [issue, ...rest] = gridIssues(scene({}, [piece()]));
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({
      severity: "error",
      path: `/entities/1/behaviors/${OCCUPANT.name}`,
      entityIds: ["piece"],
    });
    expect(issue?.message).toContain("no settings.grid");
    expect(gridIssues(scene({}, [piece({ off: true })]))).toEqual([]);
  });

  it("passes with the scene's grid or the game's world.grid, but not the project's", () => {
    expect(gridIssues(scene({ settings: { grid: square } }, [piece()]))).toEqual([]);
    const gridded = createRegistry(
      defineGame({
        id: "gridded",
        types: [],
        actions: [],
        world: { grid: square },
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    expect(gridIssues(scene({ game: "gridded" }, [piece()]), gridded)).toEqual([]);
    expect(gridIssues(scene({}, [piece()]), engine, { engine: { grid: square } })).toHaveLength(1);
  });

  it("judges an instance's occupant in the placing scene, not in the prefab's view", () => {
    const prefabs = new Map<string, Prefab>([
      ["token", { kind: "prefab", v: 3, id: "token", entities: [piece({ at: [0, 0] })] }],
    ]);
    const def = scene({ instances: [{ id: "t1", prefab: "token", at: [128, 128] }] });
    expect(gridIssues(def, engine, { prefabs }).map((i) => [i.path, i.entityIds])).toEqual([
      ["/instances/0", ["t1/piece"]],
    ]);
    const view = prefabScene(prefabs.get("token")!, [-512, -512, 512, 512]);
    expect(gridIssues(view, engine, { prefabs, prefab: "token" })).toEqual([]);
  });
});

describe("prefab nesting", () => {
  const NESTING: readonly IssueCode[] = ["prefab-unknown", "prefab-cycle", "prefab-depth"];
  const pf = (id: string, over: Partial<Prefab> = {}): Prefab => ({
    kind: "prefab",
    v: 3,
    id,
    entities: [{ id: "m", type: "marker", at: [0, 0] }],
    ...over,
  });
  const holds = (id: string, prefab: string, over: Partial<Prefab> = {}): Prefab =>
    pf(id, { instances: [{ id: `${prefab}-1`, prefab, at: [10, 0] }], ...over });
  const lib = (...prefabs: Prefab[]) => new Map(prefabs.map((p) => [p.id, p]));
  /** `p1` holds `p2` … holds `p<n>`: `n` levels. */
  const chain = (n: number) =>
    lib(
      ...Array.from({ length: n }, (_, k) =>
        k + 1 < n ? holds(`p${k + 1}`, `p${k + 2}`) : pf(`p${n}`),
      ),
    );
  const placing = (prefab: string) => scene({ instances: [{ id: "i1", prefab, at: [300, 300] }] });
  const nesting = (def: SceneDefinition, prefabs: ReadonlyMap<string, Prefab>, prefab?: string) =>
    validateScene(def, engine, { prefabs, ...(prefab !== undefined ? { prefab } : {}) }).filter(
      (i) => NESTING.includes(i.code),
    );
  /** A prefab as the scene its view validates: its children around the origin. */
  const view = (p: Prefab): SceneDefinition => ({
    v: 3,
    name: p.id,
    bounds: [-500, -500, 500, 500],
    entities: p.entities,
    ...(p.instances ? { instances: p.instances } : {}),
  });

  it("allows 8 levels and reports a 9th as prefab-depth on the instance", () => {
    expect(nesting(placing("p1"), chain(8))).toEqual([]);
    const issue = only(nesting(placing("p1"), chain(9)), "prefab-depth");
    expect(issue).toMatchObject({
      severity: "error",
      path: "/instances/0/prefab",
      entityIds: ["i1"],
      got: "p1",
    });
    expect(issue.message).toMatch(/^i1 places prefab "p1": /);
  });

  it("reports a cycle through instances", () => {
    const viaInstances = nesting(placing("a"), lib(holds("a", "b"), holds("b", "a")));
    expect(only(viaInstances, "prefab-cycle")).toMatchObject({
      path: "/instances/0/prefab",
      entityIds: ["i1"],
    });
  });

  it("reports a missing nested prefab as prefab-unknown on the outer instance", () => {
    const issue = only(nesting(placing("room"), lib(holds("room", "door"))), "prefab-unknown");
    expect(issue).toMatchObject({ path: "/instances/0/prefab", entityIds: ["i1"], got: "room" });
    expect(issue.message).toContain("door");
  });

  it("skips override checks on an instance whose prefab can't resolve", () => {
    const def = scene({
      instances: [{ id: "i1", prefab: "a", at: [300, 300], overrides: { "nope.at": [1, 1] } }],
    });
    const issues = validateScene(def, engine, { prefabs: lib(holds("a", "a")) });
    expect(issues.map((i) => i.code)).toEqual(["prefab-cycle"]);
  });

  it("checks a prefab view one level down: itself, its cycles and its depth", () => {
    const self = holds("loop", "loop");
    expect(only(nesting(view(self), lib(), "loop"), "prefab-cycle")).toMatchObject({
      path: "/instances/0/prefab",
      entityIds: ["loop-1"],
    });
    expect(only(nesting(view(self), lib(self), "loop"), "prefab-cycle").path).toBe(
      "/instances/0/prefab",
    );

    // the library's copy of x predates the view's instance of y, which holds x
    const x = holds("x", "y");
    expect(only(nesting(view(x), lib(pf("x"), holds("y", "x")), "x"), "prefab-cycle").path).toBe(
      "/instances/0/prefab",
    );

    const top = holds("top", "p1");
    expect(nesting(view(top), new Map([...chain(7), ["top", top]]), "top")).toEqual([]);
    expect(
      only(nesting(view(top), new Map([...chain(8), ["top", top]]), "top"), "prefab-depth"),
    ).toMatchObject({ path: "/instances/0/prefab", entityIds: ["p1-1"] });
  });
});

describe("variants, params and child refs", () => {
  const pf = (id: string, over: Partial<Prefab> = {}): Prefab => ({
    kind: "prefab",
    v: 3,
    id,
    entities: [{ id: "door", type: "sensor", shape: ["box", 0, 0, 10, 10] }],
    ...over,
  });
  const lib = (...prefabs: Prefab[]) => new Map(prefabs.map((p) => [p.id, p]));
  const view = (p: Prefab): SceneDefinition => ({
    v: 3,
    name: p.id,
    bounds: [-500, -500, 500, 500],
    entities: p.entities,
    ...(p.instances ? { instances: p.instances } : {}),
  });
  const gate = pf("gate", {
    entities: [
      { id: "door", type: "sensor", shape: ["box", 0, 0, 10, 10] },
      { id: "post", type: "marker", at: [20, 0] },
    ],
    params: { size: { description: "Door size.", targets: ["door.shape"] } },
  });
  const opener = (opens: string | string[]): EntityDef => ({
    id: "opener",
    type: "door",
    shape: ["box", 100, 800, 10, 40],
    speed: 5,
    opens: opens as string,
  });
  const gateScene = (opens: string, over: Partial<SceneDefinition> = {}) =>
    gameScene({ instances: [{ id: "gate-2", prefab: "gate", at: [300, 300] }], ...over }, [
      opener(opens),
    ]);

  it("a ref to an instance's child validates; a missing instance is dangling-ref", () => {
    expect(validateScene(gateScene("gate-2/door"), fake, { prefabs: lib(gate) })).toEqual([]);

    const dangling = only(
      validateScene(gateScene("gate-9/door"), fake, { prefabs: lib(gate) }),
      "dangling-ref",
    );
    expect(dangling).toMatchObject({ path: "/entities/1/opens", entityIds: ["opener"] });
    expect(dangling.fix?.ops).toEqual([{ op: "update", ref: "opener", unset: ["opens"] }]);
  });

  it("ref-child-unknown for a child the prefab lacks, with a did-you-mean fix", () => {
    const issue = only(
      validateScene(gateScene("gate-2/dor"), fake, { prefabs: lib(gate) }),
      "ref-child-unknown",
    );
    expect(issue).toMatchObject({
      severity: "error",
      path: "/entities/1/opens",
      entityIds: ["opener"],
      got: "gate-2/dor",
    });
    expect(issue.message).toContain('did you mean "gate-2/door"?');
    expect(issue.fix?.ops).toEqual([
      { op: "update", ref: "opener", set: { opens: "gate-2/door" } },
    ]);
    expectFixClearsWith(gateScene("gate-2/dor"), issue);

    const far = only(
      validateScene(gateScene("gate-2/elsewhere"), fake, { prefabs: lib(gate) }),
      "ref-child-unknown",
    );
    expect(far.fix?.ops).toEqual([{ op: "update", ref: "opener", unset: ["opens"] }]);
  });

  it("ref-type for a child of the wrong type; nothing for an instance whose prefab is missing", () => {
    const typed = only(
      validateScene(gateScene("gate-2/post"), fake, { prefabs: lib(gate) }),
      "ref-type",
    );
    expect(typed).toMatchObject({ entityIds: ["opener", "gate-2/post"], got: "marker" });

    const codes = validateScene(gateScene("gate-2/door"), fake, { prefabs: lib() }).map(
      (i) => i.code,
    );
    expect(codes).toEqual(["prefab-unknown"]);
  });

  it("reaches children of nested instances", () => {
    const room = pf("room", {
      entities: [],
      instances: [{ id: "gate-1", prefab: "gate", at: [0, 0] }],
    });
    const def = gameScene({ instances: [{ id: "room-1", prefab: "room", at: [300, 300] }] }, [
      opener("room-1/gate-1/door"),
    ]);
    expect(validateScene(def, fake, { prefabs: lib(gate, room) })).toEqual([]);
    const bad = { ...def, entities: [def.entities![0]!, opener("room-1/gate-1/dor")] };
    const issue = only(validateScene(bad, fake, { prefabs: lib(gate, room) }), "ref-child-unknown");
    expect(issue.message).toContain('"room-1/gate-1/door"');
  });

  it("param-unknown on a param the prefab doesn't expose, fixed by setParam to null", () => {
    const def = scene({
      instances: [
        {
          id: "g1",
          prefab: "gate",
          at: [300, 300],
          params: { sise: 3, size: ["box", 0, 0, 20, 20] },
        },
      ],
    });
    const issue = only(validateScene(def, engine, { prefabs: lib(gate) }), "param-unknown");
    expect(issue).toMatchObject({
      severity: "error",
      path: "/instances/0/params/sise",
      entityIds: ["g1"],
      got: "sise",
      expected: "size",
    });
    expect(issue.message).toContain('did you mean "size"?');
    expect(issue.fix?.ops).toEqual([{ op: "setParam", ref: "g1", name: "sise", value: null }]);

    const red = pf("red-gate", { base: "gate", entities: [] });
    const inherited = scene({
      instances: [
        {
          id: "r1",
          prefab: "red-gate",
          at: [300, 300],
          params: { size: ["box", 0, 0, 20, 20] },
          overrides: { "post.at": [1, 1] },
        },
      ],
    });
    expect(validateScene(inherited, engine, { prefabs: lib(gate, red) })).toEqual([]);

    const bad = scene({
      instances: [{ id: "g1", prefab: "gate", at: [300, 300], params: { size: 7 } }],
    });
    expect(only(validateScene(bad, engine, { prefabs: lib(gate) }), "schema")).toMatchObject({
      path: "/instances/0/params/size",
      entityIds: ["g1"],
    });
  });

  it("a param target naming no child is unused-override on the prefab's view", () => {
    const loose = pf("loose", {
      params: {
        size: { description: "Size.", targets: ["door.shape", "gone.shape"] },
        only: { description: "Only.", targets: ["nope.at"] },
      },
    });
    const issues = validateScene(view(loose), engine, {
      prefabs: lib(loose),
      prefab: "loose",
    }).filter((i) => i.code === "unused-override");
    expect(issues.map((i) => i.path)).toEqual(["/params/only/targets/0", "/params/size/targets/1"]);
    const size = issues.find((i) => i.path === "/params/size/targets/1")!;
    expect(size.fix?.ops).toEqual([
      {
        op: "exposeParam",
        name: "size",
        param: { description: "Size.", targets: ["door.shape"] },
      },
    ]);
    expect(issues[0]!.fix?.ops).toEqual([{ op: "exposeParam", name: "only", param: null }]);

    const nested = pf("nest", {
      entities: [],
      instances: [{ id: "gate-1", prefab: "gate", at: [0, 0] }],
      params: {
        at: { description: "Where.", targets: ["gate-1.at", "gate-1/door.shape"] },
      },
    });
    const ok = validateScene(view(nested), engine, { prefabs: lib(gate, nested), prefab: "nest" });
    expect(ok.filter((i) => i.code === "unused-override")).toEqual([]);
  });

  it("variant-base-unknown on a variant's view, with a did-you-mean setPrefabBase fix", () => {
    const red = pf("red-gate", { base: "gat", entities: [] });
    const issue = only(
      validateScene(view(red), engine, { prefabs: lib(gate, red), prefab: "red-gate" }),
      "variant-base-unknown",
    );
    expect(issue).toMatchObject({ severity: "error", path: "/base", got: "gat" });
    expect(issue.message).toContain('did you mean "gate"?');
    expect(issue.fix?.ops).toEqual([{ op: "setPrefabBase", base: "gate" }]);

    const lone = pf("lone", { base: "zzzzzzzz", entities: [] });
    const cleared = only(
      validateScene(view(lone), engine, { prefabs: lib(lone), prefab: "lone" }),
      "variant-base-unknown",
    );
    expect(cleared.fix?.ops).toEqual([{ op: "setPrefabBase", base: null }]);
  });

  it("variant-base-unknown on a scene instance whose prefab reaches a variant with a missing base", () => {
    const red = pf("red-gate", { base: "gone", entities: [] });
    const def = scene({ instances: [{ id: "r1", prefab: "red-gate", at: [300, 300] }] });
    const issue = only(validateScene(def, engine, { prefabs: lib(red) }), "variant-base-unknown");
    expect(issue).toMatchObject({ path: "/instances/0/prefab", entityIds: ["r1"], got: "gone" });
  });

  it("dup-id where a variant's own child takes an id its base has", () => {
    const red = pf("red-gate", {
      base: "gate",
      entities: [
        { id: "post", type: "marker", at: [0, 0] },
        { id: "lamp", type: "marker", at: [5, 0] },
      ],
    });
    const prefabs = lib(gate, red);
    const onView = only(
      validateScene(view(red), engine, { prefabs, prefab: "red-gate" }),
      "dup-id",
    );
    expect(onView).toMatchObject({ path: "/entities/0/id", entityIds: ["post"] });

    const def = scene({ instances: [{ id: "r1", prefab: "red-gate", at: [300, 300] }] });
    const onInstance = validateScene(def, engine, { prefabs }).filter((i) => i.code === "dup-id");
    expect(onInstance.map((i) => i.path)).toContain("/instances/0/prefab");

    const clean = pf("blue-gate", {
      base: "gate",
      entities: [{ id: "lamp", type: "marker", at: [5, 0] }],
    });
    expect(
      validateScene(view(clean), engine, { prefabs: lib(gate, clean), prefab: "blue-gate" }).filter(
        (i) => i.code === "dup-id",
      ),
    ).toEqual([]);
  });

  it("an override of a nested instance's field or child isn't unused", () => {
    const room = pf("room", {
      entities: [],
      instances: [{ id: "gate-1", prefab: "gate", at: [0, 0] }],
    });
    const def = scene({
      instances: [
        {
          id: "r1",
          prefab: "room",
          at: [300, 300],
          overrides: { "gate-1.at": [5, 5], "gate-1/post.at": [1, 1] },
        },
      ],
    });
    expect(
      validateScene(def, engine, { prefabs: lib(gate, room) }).filter(
        (i) => i.code === "unused-override",
      ),
    ).toEqual([]);
  });

  it("an off override on a bulk child is used; another field of it isn't", () => {
    const bulky = pf("bulky", { bulk: { solid: [["box", 0, 0, 10, 10]] } });
    const def = scene({
      instances: [
        {
          id: "b1",
          prefab: "bulky",
          at: [300, 300],
          overrides: { "~solid:0.off": true, "~solid:0.layer": "fg" },
        },
      ],
    });
    expect(
      validateScene(def, engine, { prefabs: lib(bulky) })
        .filter((i) => i.code === "unused-override")
        .map((i) => i.path),
    ).toEqual(["/instances/0/overrides/~0solid:0.layer"]);
  });
});

/** `expectFixClears` for a fake-game scene whose instances need the gate prefab. */
function expectFixClearsWith(def: SceneDefinition, issue: SceneIssue) {
  const fixed = applyFix(def, issue.fix!, fake);
  const prefabs = new Map<string, Prefab>([
    [
      "gate",
      {
        kind: "prefab",
        v: 3,
        id: "gate",
        entities: [{ id: "door", type: "sensor", shape: ["box", 0, 0, 10, 10] }],
      },
    ],
  ]);
  expect(validateScene(fixed, fake, { prefabs }).filter((i) => i.code === issue.code)).toEqual([]);
}

describe("spawn-only types", () => {
  const ember = defineEntityType({
    type: "ember",
    description: "A spark game code makes.",
    base: "marker",
    spawnOnly: true,
    fields: { at: pointField("Where it glows.") },
  });
  const r = createRegistry({ ...testGame, types: [...testGame.types, ember] });
  const yard = (over: Partial<SceneDefinition> = {}): SceneDefinition => ({
    v: 3,
    game: "test-game",
    name: "embers",
    bounds: [0, 0, 1000, 1000],
    ...over,
  });
  const typeIssues = (def: SceneDefinition, prefabs?: ReadonlyMap<string, Prefab>) =>
    validateScene(def, r, prefabs ? { prefabs } : {}).filter((i) => i.code === "unknown-type");

  it("reports a scene entity of one as unknown-type, spawned by game code only", () => {
    const [issue, ...rest] = typeIssues(
      yard({ entities: [{ id: "e", type: "ember", at: [10, 10] }] }),
    );
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({
      severity: "error",
      path: "/entities/0/type",
      entityIds: ["e"],
      got: "ember",
    });
    expect(issue!.message).toContain("spawned by game code only");
    expect(issue!.expected!.split(" | ")).not.toContain("ember");
    expect(typeIssues(yard({ entities: [{ id: "l", type: "lamp", at: [10, 10] }] }))).toEqual([]);
  });

  it("reports a prefab child of one on the instance placing it", () => {
    const prefabs = new Map<string, Prefab>([
      [
        "hearth",
        {
          kind: "prefab",
          v: 3,
          game: "test-game",
          id: "hearth",
          entities: [{ id: "spark", type: "ember", at: [0, 0] }],
        },
      ],
    ]);
    const [issue] = typeIssues(
      yard({ instances: [{ id: "h1", prefab: "hearth", at: [100, 100] }] }),
      prefabs,
    );
    expect(issue).toMatchObject({ code: "unknown-type", entityIds: ["h1/spark"] });
    expect(issue!.path).toMatch(/^\/instances\/0/);
  });
});

describe("sublevelIssue", () => {
  const list = [{ scene: "hall" }, { scene: "cellar", sublevel: true as const }];
  const settings = (over: Record<string, unknown> = {}) => ({
    settings: {
      physics: "none" as const,
      gravity: [0, 9.8] as [number, number],
      grid: { kind: "square" as const, cell: [0.32, 0.32] as [number, number] },
      ...over,
    },
  });
  const judge = (sub = settings(), opts: Partial<Parameters<typeof sublevelIssue>[2]> = {}) => {
    const issue = sublevelIssue(settings(), sub, {
      scene: "cellar",
      list,
      label: "cellar",
      pxPerMetre: 100,
      ...opts,
    });
    if (issue) expect(issue).toMatchObject({ code: "sublevel-invalid", severity: "error" });
    return (issue?.detail as { reason?: string } | undefined)?.reason ?? null;
  };

  it("accepts a listed scene on the main scene's physics, cells and gravity", () => {
    expect(judge()).toBeNull();
    expect(judge(settings(), { at: [3.2, -0.64] })).toBeNull();
  });

  it("judges each reason through the one rule", () => {
    expect(judge(settings(), { scene: "attic" })).toBe("unlisted");
    expect(judge(settings(), { label: "Cellar" })).toBe("label");
    expect(judge(settings(), { taken: (l) => l === "cellar" })).toBe("label");
    expect(judge(settings({ physics: "rapier" }))).toBe("physics");
    expect(judge(settings({ grid: null }))).toBe("grid");
    expect(judge(settings({ grid: { kind: "square", cell: [0.16, 0.16] } }))).toBe("grid");
    expect(judge(settings(), { at: [0.16, 0] })).toBe("grid");
    expect(judge(settings(), { at: [0.3205, 0] })).toBe("grid");
    expect(judge(settings({ gravity: [0, 0] }))).toBe("settings");
  });

  it("judges at against the main grid's origin and a hex grid's repeat", () => {
    const shifted = settings({
      grid: { kind: "square", cell: [0.32, 0.32], origin: [0.16, 0] },
    });
    expect(judge(shifted)).toBe("grid");
    expect(judge(shifted, { at: [0.16, 0] })).toBeNull();
    const hex = { kind: "hex", cell: [0.32, 0.28], side: 0.14, stagger: "y", index: "odd" };
    const main = settings({ grid: hex });
    const at = (p: [number, number]) =>
      sublevelIssue(main, main, { scene: "cellar", list, label: "c", at: p, pxPerMetre: 100 });
    expect(at([0.32, 0.42])).toBeNull();
    expect(at([0, 0.21])?.detail).toMatchObject({ reason: "grid" });
  });
});

describe("sublevelUseIssues", () => {
  const def = (name: string, over: Partial<SceneDefinition> = {}): SceneDefinition => ({
    v: 1,
    name,
    bounds: [0, 0, 1000, 1000],
    settings: { physics: "none" },
    entities: [{ id: "start", type: "marker", at: [500, 900] }],
    ...over,
  });
  const library: SceneLibrary = {
    list: [
      { scene: "hall" },
      { scene: "cellar", sublevel: true },
      { scene: "heavy", sublevel: true },
      { scene: "lost", sublevel: true },
    ],
    scenes: new Map([
      ["hall", { def: def("hall"), prefabs: new Map() }],
      ["cellar", { def: def("cellar"), prefabs: new Map() }],
      ["heavy", { def: def("heavy", { settings: { physics: "rapier" } }), prefabs: new Map() }],
    ]),
  };

  it("reports sublevel-invalid at each use that names a sublevel it can't attach, labels taken in order", () => {
    const issues = sublevelUseIssues(
      def("hall"),
      [
        { scene: "cellar", label: "cellar", path: "/checks/0/attach", line: 4 },
        { scene: "cellar", label: "cellar", path: "/checks/1/attach", line: 9 },
        { scene: "heavy", label: "heavy", path: "/checks/2/attach" },
        { scene: "attic", label: "attic", path: "/checks/3/attach" },
        { scene: "lost", label: "lost", path: "/checks/4/attach" },
      ],
      { registry: engine, library },
    );
    expect(
      issues.map((i) => [
        i.code,
        (i.detail as { reason?: string } | undefined)?.reason,
        i.path,
        i.line,
      ]),
    ).toEqual([
      ["sublevel-invalid", "label", "/checks/1/attach", 9],
      ["sublevel-invalid", "physics", "/checks/2/attach", undefined],
      ["sublevel-invalid", "unlisted", "/checks/3/attach", undefined],
      ["asset-missing", undefined, "/checks/4/attach", undefined],
    ]);
  });
});
