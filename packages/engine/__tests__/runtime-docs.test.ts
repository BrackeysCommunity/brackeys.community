// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { planContent } from "../export/content";
import { createRegistry, defineGame } from "../game/define";
import type { GameDefinition } from "../game/types";
import { memoryRuntimeView } from "../headless/runtime-view";
import { createKindRegistry, defineAssetKind } from "../project/kinds";
import { runtimeKindNames } from "../project/kinds/define";
import { heldProject, type ProjectRuntimeView } from "../project/runtime-view";
import { validateProject } from "../project/validate-project";
import { preparePlay } from "../runtime/play-session";
import { makeIssue } from "../scene/issues";
import { manifestRuntimeView } from "../standalone/manifest-view";
import {
  CC0,
  FREE_PROJECT,
  heldDocs,
  heldInput,
  png,
  releaseFiles,
  scene,
  type HeldFiles,
} from "./fixtures/held-project";
import { CARD_TABLE, testGame } from "./fixtures/test-game";

const CURVE = "test-game/curve";
const TINT = "test-game/tint";

type CurveFile = { v: 1; points: number[]; art?: string; after?: string };

/** A `sim` kind: a curve game code reads, which may name a texture and another curve. */
const curveKind = defineAssetKind({
  kind: CURVE,
  title: "Curve",
  description: "A test game's curve.",
  match: { suffixes: [".curve.json"] },
  storage: "doc",
  version: 1,
  schemaId: "urn:test:test-game:curve:v1",
  schema: () =>
    z.strictObject({
      v: z.literal(1),
      points: z.array(z.number()),
      art: z.string().optional(),
      after: z.string().optional(),
    }) as z.ZodType<CurveFile>,
  layout: { as: "map", rest: { as: "atomic" } },
  empty: () => ({ v: 1, points: [] }),
  refs: (value: CurveFile) =>
    value.art === undefined ? [] : [{ pointer: "/art", id: value.art, kinds: ["texture"] }],
  crossValidate: (value: CurveFile, lookup) =>
    value.after === undefined || lookup.read(CURVE, value.after) !== undefined
      ? []
      : [
          makeIssue("asset-missing", {
            message: `the curve follows "${value.after}", which isn't a curve`,
            path: "/after",
            got: value.after,
            expected: lookup.ids(CURVE).join(", "),
          }),
        ],
  runtime: "sim",
});

/** A `view` kind: a tint only drawing reads. */
const tintKind = defineAssetKind({
  kind: TINT,
  title: "Tint",
  description: "A test game's tint.",
  match: { suffixes: [".tint.json"] },
  storage: "doc",
  version: 1,
  schemaId: "urn:test:test-game:tint:v1",
  schema: () => z.strictObject({ v: z.literal(1), color: z.string() }),
  layout: { as: "map", rest: { as: "atomic" } },
  empty: () => ({ v: 1 as const, color: "#000000" }),
  runtime: "view",
});

const kindsGame: GameDefinition = defineGame({ ...testGame, assetKinds: [curveKind, tintKind] });

/** What a project made before runtime kinds had: settings, a table, an input map, a scene list. */
const PRE_KINDS_DOCS: Record<string, unknown> = {
  "game-settings.json": { kind: "game-settings", v: 2, engine: {}, game: { avatarSpeed: 4 } },
  "cards.json": {
    kind: "data-table",
    v: 1,
    table: CARD_TABLE,
    rows: [{ id: "ace", cost: 1, damage: 3 }],
  },
  "input-map.json": {
    kind: "input-map",
    v: 1,
    players: { max: 1, join: "press" },
    deadzone: 0.2,
    actions: [{ action: "push", bindings: [{ device: "key", code: "Space" }] }],
    touch: [],
  },
  "scene-list.json": { kind: "scene-list", v: 1, start: "yard", scenes: [{ scene: "yard" }] },
  "yard.json": scene("yard"),
};

/** The run hash `preparePlay` gives the yard with `project`. */
function runHashWith(game: GameDefinition, project: ProjectRuntimeView | null): string {
  const prepared = preparePlay(scene("yard"), createRegistry(game), { project });
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.issues));
  return prepared.runHash;
}

const heldRuntime = (game: GameDefinition, docs: Record<string, unknown>) =>
  heldProject(heldDocs(docs).files, createRegistry(game), { projectId: "test", name: "Test" })
    .runtime;

describe("runHash over runtime docs", () => {
  it("changes with a sim doc's edit and not with a view doc's", () => {
    const docs = (points: number[], color: string) => ({
      ...PRE_KINDS_DOCS,
      "path.curve.json": { v: 1, points },
      "glow.tint.json": { v: 1, color },
    });
    const base = runHashWith(kindsGame, heldRuntime(kindsGame, docs([0, 1], "#ff0000")));
    expect(runHashWith(kindsGame, heldRuntime(kindsGame, docs([0, 1], "#00ff00")))).toBe(base);
    expect(runHashWith(kindsGame, heldRuntime(kindsGame, docs([0, 2], "#ff0000")))).not.toBe(base);
  });

  it("reads a memory view's docs the same way", () => {
    const view = (points: number[], color: string) =>
      memoryRuntimeView({
        settings: { avatarSpeed: 4 },
        docs: {
          [CURVE]: { "path-curve": { v: 1, points } },
          [TINT]: { "glow-tint": { v: 1, color } },
        },
      });
    const base = runHashWith(kindsGame, view([0, 1], "#ff0000"));
    expect(runHashWith(kindsGame, view([0, 1], "#00ff00"))).toBe(base);
    expect(runHashWith(kindsGame, view([0, 2], "#ff0000"))).not.toBe(base);
    expect(runHashWith(kindsGame, memoryRuntimeView({ settings: { avatarSpeed: 4 } }))).not.toBe(
      base,
    );
  });

  it("keeps a project with no other sim docs at its pinned hash, whatever kinds the game adds", () => {
    const PINNED = "7cbbb850d2532847";
    expect(runHashWith(testGame, heldRuntime(testGame, PRE_KINDS_DOCS))).toBe(PINNED);
    expect(runHashWith(kindsGame, heldRuntime(kindsGame, PRE_KINDS_DOCS))).toBe(PINNED);
    const tinted = { ...PRE_KINDS_DOCS, "glow.tint.json": { v: 1, color: "#ff0000" } };
    expect(runHashWith(kindsGame, heldRuntime(kindsGame, tinted))).toBe(PINNED);
  });
});

/** A physics-free project of the kinds game: a curve naming a texture no scene names, and a tint. */
function curveProject(): HeldFiles {
  const held = heldDocs({
    "scene-list.json": { kind: "scene-list", v: 1, start: "yard", scenes: [{ scene: "yard" }] },
    "game-settings.json": { kind: "game-settings", v: 2, engine: {}, game: {} },
    "yard.json": scene("yard", ["tiles"]),
    "path.curve.json": { v: 1, points: [0, 1], art: "ramp" },
    "glow.tint.json": { v: 1, color: "#ff0000" },
  });
  held.files.push(
    { path: "art/tiles.png", sidecar: png("tiles", "a".repeat(64), 300, 16, CC0) },
    { path: "art/ramp.png", sidecar: png("ramp", "b".repeat(64), 200, 16, CC0) },
  );
  return held;
}

describe("what an export ships of runtime docs", () => {
  it("ships a blob reached only through a runtime doc, in no bundle", async () => {
    const plan = await planContent(await heldInput(FREE_PROJECT, curveProject(), kindsGame));
    expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(plan.assets["path-curve"]?.kind).toBe(CURVE);
    expect(plan.assets["glow-tint"]?.kind).toBe(TINT);
    expect(plan.assets.ramp?.storage).toBe("blob");
    for (const s of plan.scenes) expect(s.bundle.entries, s.id).not.toContain("ramp");
    expect(plan.projectBundle.entries).not.toContain("ramp");
    expect(plan.scenes.find((s) => s.id === "yard")?.bundle.entries).toEqual(["tiles"]);
  });

  it("loads every runtime kind of a planned build into manifestRuntimeView", async () => {
    const { manifest, files } = await releaseFiles(
      await heldInput(FREE_PROJECT, curveProject(), kindsGame),
    );
    const texts = new Map<string, string>();
    for (const [id, asset] of Object.entries(manifest.assets))
      if (asset.storage === "doc") texts.set(id, files.get(asset.file)!);
    const view = manifestRuntimeView(manifest, texts, kindsGame);
    const shipped = (kind: string) =>
      Object.keys(manifest.assets).filter((id) => manifest.assets[id]!.kind === kind);
    for (const kind of runtimeKindNames(createKindRegistry(kindsGame)))
      expect(view.docs!(kind), kind).toEqual(shipped(kind));
    expect(view.docs!(CURVE)).toEqual(["path-curve"]);
    expect(view.docs!(TINT)).toEqual(["glow-tint"]);
    expect(view.doc!(CURVE, "path-curve")).toEqual({ v: 1, points: [0, 1], art: "ramp" });
    expect(view.doc!(TINT, "glow-tint")).toEqual({ v: 1, color: "#ff0000" });
  });
});

describe("validateProject", () => {
  const project = (docs: Record<string, unknown>) => {
    const held = heldDocs(docs);
    const registry = createRegistry(kindsGame);
    const { view, kinds } = heldProject(held.files, registry, { projectId: "test", name: "Test" });
    const texts = new Map<string, string>();
    for (const entry of view.byId.values()) {
      const text = held.texts.get(entry.path);
      if (text !== undefined) texts.set(entry.id, text);
    }
    return validateProject(view, texts, kinds, { registry, project: view });
  };

  it("runs a kind's crossValidate over the other docs, naming the doc", () => {
    const ok = project({
      "first.curve.json": { v: 1, points: [0] },
      "second.curve.json": { v: 1, points: [1], after: "first-curve" },
    });
    expect(ok).toEqual([]);
    const issues = project({
      "first.curve.json": { v: 1, points: [0] },
      "second.curve.json": { v: 1, points: [1], after: "missing" },
    });
    expect(issues).toEqual([
      expect.objectContaining({
        code: "asset-missing",
        entityIds: ["second-curve"],
        path: "/after",
        got: "missing",
        expected: "first-curve, second-curve",
      }),
    ]);
  });

  it("runs every doc's own checks first, and cross-validates only docs that parse", () => {
    const issues = project({
      "bad.curve.json": { v: 1, points: "no", after: "missing" },
      "glow.tint.json": { v: 1, color: 3 },
    });
    expect(issues.map((i) => [i.code, i.entityIds[0]])).toEqual([
      ["schema", "bad-curve"],
      ["schema", "glow-tint"],
    ]);
  });

  it("never throws: a check that throws reports on its doc", () => {
    const throwing = defineAssetKind({
      ...curveKind,
      crossValidate: () => {
        throw new Error("boom");
      },
    });
    const game = defineGame({ ...testGame, assetKinds: [throwing] });
    const registry = createRegistry(game);
    const held = heldDocs({ "first.curve.json": { v: 1, points: [0] } });
    const { view, kinds } = heldProject(held.files, registry, { projectId: "t", name: "T" });
    const texts = new Map([["first-curve", held.texts.get("first.curve.json")!]]);
    const issues = validateProject(view, texts, kinds, { registry, project: view });
    expect(issues).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "schema",
        entityIds: ["first-curve"],
        message: expect.stringContaining("boom") as string,
      }),
    ]);
  });
});
