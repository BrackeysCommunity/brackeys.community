import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { materialField, shapeField } from "../../game/fields";
import { makeIssue } from "../../scene/issues";
import { createKindRegistry, defineAssetKind } from "../kinds";
import {
  checkProjectBatch,
  type ProjectBatchCheck,
  type ProjectBatchEnv,
  type ProjectOp,
} from "../ops";
import type { AssetEntry, ProjectState } from "../types";

// ─── Test kinds ──────────────────────────────────────────

const note = defineAssetKind({
  storage: "doc",
  kind: "note",
  title: "Note",
  description: "A note.",
  match: { jsonKind: "note" },
  version: 1,
  schemaId: "urn:jams-engine:note:v1",
  schema: () =>
    z.strictObject({ kind: z.literal("note"), v: z.literal(1), text: z.string().optional() }),
  layout: { as: "map", rest: { as: "atomic" } },
  empty: () => ({ kind: "note", v: 1 }),
});

const tally = defineAssetKind({
  storage: "doc",
  kind: "tally",
  title: "Tally",
  description: "Counts beside a scene.",
  match: { suffixes: [".tally.json"] },
  version: 1,
  schemaId: "urn:jams-engine:tally:v1",
  schema: () => z.looseObject({ v: z.literal(1) }),
  layout: { as: "map", rest: { as: "atomic" } },
  defaultFolder: () => "tallies",
  empty: () => ({ v: 1, counts: [] }),
});

const piece = defineAssetKind({
  storage: "doc",
  kind: "piece",
  title: "Piece",
  description: "A doc that names itself.",
  match: { jsonKind: "piece" },
  version: 1,
  schemaId: "urn:jams-engine:piece:v1",
  schema: () => z.looseObject({ kind: z.literal("piece"), v: z.literal(1), id: z.string() }),
  layout: { as: "map", rest: { as: "atomic" } },
  idField: "id",
  empty: (_env, { id }) => ({ kind: "piece", v: 1, id }),
});

const blob = (kind: string, suffixes: string[], maxBytes = 1000) =>
  defineAssetKind({
    storage: "blob",
    kind,
    title: kind,
    description: `A ${kind}.`,
    match: { suffixes },
    contentTypes: ["application/octet-stream"],
    maxBytes,
    settings: z.strictObject({
      filter: z.enum(["nearest", "linear"]).optional(),
      pivot: z.tuple([z.number(), z.number()]).optional(),
    }),
    meta: z.looseObject({}),
    inspect: () => ({ ok: true as const, meta: {} }),
  });

const kinds = createKindRegistry(null, [
  note,
  tally,
  piece,
  blob("texture", [".png"]),
  blob("sheet", [".sheet.json"]),
  blob("recording", [".recording.json"]),
]);
const registry = createRegistry();

// ─── Helpers ─────────────────────────────────────────────

const H = (c: string) => c.repeat(64);

function keyGen() {
  let n = 0;
  return () => `new${n++}`;
}

function env(extra: Partial<ProjectBatchEnv> = {}): ProjectBatchEnv {
  return { registry, kinds, now: 100, by: "ada", newKey: keyGen(), ...extra };
}

function entry(key: string, extra: Partial<AssetEntry> & Pick<AssetEntry, "id" | "path" | "kind">) {
  return { key, created: { at: 1, by: "seed" }, ...extra } satisfies AssetEntry;
}

const base: ProjectState = {
  meta: { projectId: "p", layout: 1, name: "P" },
  assets: {
    crate: entry("crate", {
      id: "crate",
      kind: "texture",
      path: "art/crate.png",
      sha256: H("a"),
      bytes: 10,
      import: { filter: "nearest" },
      meta: { w: 4 },
    }),
    intro: entry("intro", { id: "intro", kind: "note", path: "notes/intro.json" }),
    old: entry("old", {
      id: "old",
      kind: "note",
      path: "notes/old.json",
      deleted: { at: 5, by: "bo" },
    }),
    take: entry("take", {
      id: "take",
      kind: "recording",
      path: "take.recording.json",
      sha256: H("c"),
      bytes: 3,
    }),
  },
  history: {},
  code: {},
  build: {},
};

const frozen = JSON.stringify(base);

function run(ops: ProjectOp[], state = base, e = env()): ProjectBatchCheck {
  const result = checkProjectBatch(state, new Map(), { v: 1, ops }, e);
  expect(JSON.stringify(base), "the input state is never mutated").toBe(frozen);
  return result;
}

function ok(ops: ProjectOp[], state = base, e = env()) {
  const result = run(ops, state, e);
  if (!result.ok) throw new Error(`op ${result.opIndex}: ${result.issue.message}`);
  return result;
}

function refused(ops: ProjectOp[], state = base, e = env()) {
  const result = run(ops, state, e);
  if (result.ok) throw new Error("expected the batch to be refused");
  return result;
}

const byId = (state: ProjectState, id: string) =>
  Object.values(state.assets).find((e) => e.id === id && !e.deleted);

// ─── Tests ───────────────────────────────────────────────

describe("createAsset", () => {
  it("takes its id from the file stem and writes the kind's empty value", () => {
    const r = ok([{ op: "createAsset", kind: "note", path: "notes/Big Idea.json" }]);
    expect(r.created).toEqual(["big-idea"]);
    expect(r.state.assets.new0).toEqual({
      key: "new0",
      id: "big-idea",
      kind: "note",
      path: "notes/Big Idea.json",
      created: { at: 100, by: "ada" },
    });
    expect(r.values.get("new0")).toEqual({ kind: "note", v: 1 });
    expect(r.written).toEqual(["new0"]);
    expect(r.registry).toBe(true);
  });

  it("takes content and a licence", () => {
    const r = ok([
      {
        op: "createAsset",
        kind: "note",
        path: "a.json",
        id: "first",
        content: { kind: "note", v: 1, text: "hi" },
        licence: { spdx: "CC0-1.0", author: "Ana" },
      },
    ]);
    expect(r.state.assets.new0!.licence).toEqual({ spdx: "CC0-1.0", author: "Ana" });
    expect(r.values.get("new0")).toEqual({ kind: "note", v: 1, text: "hi" });
  });

  it("puts a folder path's file at <id><extension>, and an empty path in the kind's default folder", () => {
    const r = ok([
      { op: "createAsset", kind: "tally", path: "levels/", id: "yard" },
      { op: "createAsset", kind: "tally", path: "" },
      { op: "createAsset", kind: "tally", path: "" },
    ]);
    expect(
      Object.values(r.state.assets)
        .slice(-3)
        .map((e) => [e.id, e.path]),
    ).toEqual([
      ["yard", "levels/yard.tally.json"],
      ["tally-1", "tallies/tally-1.tally.json"],
      ["tally-2", "tallies/tally-2.tally.json"],
    ]);
  });

  it("uses and fills a kind's own id field", () => {
    const r = ok([
      {
        op: "createAsset",
        kind: "piece",
        path: "p/x.json",
        content: { kind: "piece", v: 1, id: "gate" },
      },
      { op: "createAsset", kind: "piece", path: "p/post.json" },
    ]);
    expect(r.created).toEqual(["gate", "post"]);
    expect(r.values.get("new1")).toEqual({ kind: "piece", v: 1, id: "post" });
    const clash = refused([
      {
        op: "createAsset",
        kind: "piece",
        path: "p/x.json",
        id: "a",
        content: { kind: "piece", v: 1, id: "b" },
      },
    ]);
    expect(clash.issue.code).toBe("op-invalid");
  });

  it("refuses unknown kinds, binary kinds, and a path whose name doesn't fit the kind", () => {
    const unknown = refused([{ op: "createAsset", kind: "nots", path: "a.json" }]);
    expect(unknown.issue.code).toBe("asset-kind");
    expect(unknown.issue.message).toContain('did you mean "note"?');
    expect(unknown.issue.path).toBe("/ops/0/kind");
    expect(refused([{ op: "createAsset", kind: "texture", path: "a.png" }]).issue.message).toMatch(
      /importAsset/,
    );
    const misfit = refused([{ op: "createAsset", kind: "note", path: "a.tally.json" }]);
    expect(misfit.issue.code).toBe("asset-kind");
    expect(misfit.issue.message).toMatch(/reads as tally/);
    expect(refused([{ op: "createAsset", kind: "note", path: "a.txt" }]).issue.code).toBe(
      "asset-kind",
    );
  });

  it("refuses taken ids and taken paths, case-only and folder clashes included", () => {
    const id = refused([{ op: "createAsset", kind: "note", path: "x/intro.json" }]);
    expect([id.issue.code, id.issue.path]).toEqual(["asset-id-taken", "/ops/0/id"]);
    const cases = [
      ["notes/intro.json", /is taken by "intro"/],
      ["Notes/Intro.json", /differs only in case/],
      ["art/crate.png/x.json", /folder where the file/],
      ["notes", /folder that holds/],
      ["Notes/fresh.json", /the folder "Notes" differs only in case from "notes"/],
      ["ART/sub/fresh.json", /the folder "ART" differs only in case from "art"/],
    ] as const;
    for (const [path, message] of cases) {
      const r = refused([{ op: "createAsset", kind: "note", path, id: "fresh" }]);
      expect(r.issue.code, path).toBe("path-taken");
      expect(r.issue.message).toMatch(message);
    }
  });

  it("frees an id and a path by trashing their holder", () => {
    const r = ok([{ op: "createAsset", kind: "note", path: "notes/old.json" }]);
    expect(r.created).toEqual(["old"]);
  });

  it("refuses bad paths, paths that are never assets, and content its schema refuses", () => {
    for (const path of ["/abs.json", "a/../b.json", "x/__tests__/a.json", "a.schema.json"])
      expect(refused([{ op: "createAsset", kind: "note", path, id: "z" }]).issue.code, path).toBe(
        "op-invalid",
      );
    const bad = refused([
      { op: "createAsset", kind: "note", path: "a.json", content: { kind: "note", v: 1, text: 3 } },
    ]);
    expect(bad.issue.code).toBe("schema");
    expect(bad.issue.path).toBe("/ops/0/content/text");
    expect(bad.issue.entityIds).toEqual(["a"]);
    expect(refused([{ op: "createAsset", kind: "note", path: "___.json" }]).issue.path).toBe(
      "/ops/0/id",
    );
  });
});

describe("importAsset", () => {
  it("adds a blob entry with its hash, settings and an empty history", () => {
    const r = ok([
      {
        op: "importAsset",
        path: "art/Hero.png",
        sha256: H("b"),
        bytes: 20,
        settings: { filter: "linear" },
      },
    ]);
    expect(r.state.assets.new0).toEqual({
      key: "new0",
      id: "hero",
      kind: "texture",
      path: "art/Hero.png",
      sha256: H("b"),
      bytes: 20,
      import: { filter: "linear" },
      created: { at: 100, by: "ada" },
    });
    expect(r.state.history.new0).toEqual([]);
    expect(r.written).toEqual([]);
  });

  it("fills meta through the host's inspector, and fails with its issue", () => {
    const seen: string[] = [];
    const inspect: ProjectBatchEnv["inspect"] = (def, e) => {
      seen.push(`${def.kind}:${e.sha256}`);
      return { ok: true, meta: { w: 8 }, import: { pivot: [0, 0] } };
    };
    const r = ok(
      [
        {
          op: "importAsset",
          path: "a.png",
          sha256: H("b"),
          bytes: 1,
          settings: { filter: "linear" },
        },
      ],
      base,
      env({ inspect }),
    );
    expect(seen).toEqual([`texture:${H("b")}`]);
    expect(r.state.assets.new0!.meta).toEqual({ w: 8 });
    expect(r.state.assets.new0!.import).toEqual({ pivot: [0, 0], filter: "linear" });
    const failing = refused(
      [{ op: "importAsset", path: "a.png", sha256: H("b"), bytes: 1 }],
      base,
      env({
        inspect: () => ({
          ok: false,
          issue: { severity: "error", code: "import-failed", message: "not a PNG", entityIds: [] },
        }),
      }),
    );
    expect([failing.issue.code, failing.issue.path]).toEqual(["import-failed", "/ops/0/id"]);
  });

  it("checks the kind against the path, the size and the settings", () => {
    expect(
      refused([{ op: "importAsset", path: "a.wav", sha256: H("b"), bytes: 1 }]).issue.code,
    ).toBe("asset-kind");
    expect(
      refused([{ op: "importAsset", path: "a.png", sha256: H("b"), bytes: 1, kind: "sheet" }]).issue
        .code,
    ).toBe("asset-kind");
    const json = ok([
      { op: "importAsset", path: "a.json", sha256: H("b"), bytes: 1, kind: "sheet" },
    ]);
    expect(json.state.assets.new0!.kind).toBe("sheet");
    expect(
      refused([{ op: "importAsset", path: "n.json", sha256: H("b"), bytes: 1, kind: "note" }]).issue
        .code,
    ).toBe("asset-kind");
    expect(
      refused([{ op: "importAsset", path: "a.png", sha256: H("b"), bytes: 5000 }]).issue.code,
    ).toBe("asset-too-large");
    const settings = refused([
      { op: "importAsset", path: "a.png", sha256: H("b"), bytes: 1, settings: { filter: "fuzzy" } },
    ]);
    expect([settings.issue.code, settings.issue.path]).toEqual(["op-invalid", "/ops/0/settings"]);
  });
});

describe("renameAsset and moveAsset", () => {
  it("sets and clears the display name", () => {
    const named = ok([{ op: "renameAsset", id: "crate", name: "Wooden crate" }]);
    expect(byId(named.state, "crate")!.name).toBe("Wooden crate");
    const cleared = ok([{ op: "renameAsset", id: "crate", name: null }], named.state);
    expect(byId(cleared.state, "crate")!.name).toBeUndefined();
  });

  it("renames the file in its folder, keeping its id and its kind's suffix", () => {
    const r = ok([{ op: "renameAsset", id: "crate", file: "box.png" }]);
    expect(byId(r.state, "crate")!.path).toBe("art/box.png");
    expect(ok([{ op: "renameAsset", id: "crate", file: "Crate.png" }]).registry).toBe(true);
    expect(refused([{ op: "renameAsset", id: "crate", file: "box.wav" }]).issue.code).toBe(
      "asset-kind",
    );
    expect(refused([{ op: "renameAsset", id: "crate", file: "a/box.png" }]).issue.code).toBe(
      "op-invalid",
    );
    expect(refused([{ op: "renameAsset", id: "crate" }]).issue.code).toBe("op-invalid");
  });

  it("moves several assets into a folder, refusing a clash among them", () => {
    const r = ok([{ op: "moveAsset", ids: ["crate", "intro"], to: "misc/" }]);
    expect([byId(r.state, "crate")!.path, byId(r.state, "intro")!.path]).toEqual([
      "misc/crate.png",
      "misc/intro.json",
    ]);
    expect(byId(ok([{ op: "moveAsset", ids: ["crate"], to: "" }]).state, "crate")!.path).toBe(
      "crate.png",
    );
    const twins = ok([
      { op: "createAsset", kind: "note", path: "a/x.json", id: "x1" },
      { op: "createAsset", kind: "note", path: "b/x.json", id: "x2" },
    ]);
    const clash = refused([{ op: "moveAsset", ids: ["x1", "x2"], to: "c/" }], twins.state);
    expect([clash.issue.code, clash.issue.path]).toEqual(["path-taken", "/ops/0/to"]);
    expect(refused([{ op: "moveAsset", ids: ["crate"], to: "misc" }]).issue.code).toBe(
      "op-invalid",
    );
    const missing = refused([{ op: "moveAsset", ids: ["crate", "crat"], to: "m/" }]);
    expect([missing.issue.code, missing.issue.path]).toEqual(["ref-not-found", "/ops/0/ids/1"]);
    expect(missing.issue.message).toContain('did you mean "crate"?');
  });

  it("is a no-op for a move into the asset's own folder", () => {
    expect(ok([{ op: "moveAsset", ids: ["crate"], to: "art/" }]).registry).toBe(false);
  });
});

describe("deleteAsset and restoreAsset", () => {
  it("trashes with a stamp and restores the most recently trashed", () => {
    const gone = ok([{ op: "deleteAsset", id: "intro" }]);
    expect(gone.state.assets.intro!.deleted).toEqual({ at: 100, by: "ada" });
    expect(
      refused([{ op: "renameAsset", id: "intro", name: "x" }], gone.state).issue.message,
    ).toMatch(/in the trash/);
    const twice = ok(
      [
        { op: "createAsset", kind: "note", path: "notes/old.json" },
        { op: "deleteAsset", id: "old" },
      ],
      base,
      env({ now: 200 }),
    );
    const back = ok([{ op: "restoreAsset", id: "old" }], twice.state);
    expect(back.state.assets.new0!.deleted).toBeUndefined();
    expect(back.state.assets.old!.deleted).toBeDefined();
  });

  it("refuses a restore while its id or path is taken, or of a live asset", () => {
    const idTaken = ok([{ op: "createAsset", kind: "note", path: "x/old.json" }]);
    expect(refused([{ op: "restoreAsset", id: "old" }], idTaken.state).issue.code).toBe(
      "asset-id-taken",
    );
    const pathTaken = ok([
      { op: "createAsset", kind: "note", path: "notes/old.json", id: "other" },
    ]);
    expect(refused([{ op: "restoreAsset", id: "old" }], pathTaken.state).issue.code).toBe(
      "path-taken",
    );
    expect(refused([{ op: "restoreAsset", id: "intro" }]).issue.code).toBe("op-invalid");
    expect(refused([{ op: "restoreAsset", id: "nope" }]).issue.code).toBe("ref-not-found");
  });
});

describe("setImport, replaceContent and setLicence", () => {
  it("merges settings per field, null resetting one", () => {
    const r = ok([{ op: "setImport", id: "crate", set: { pivot: [1, 2] } }]);
    expect(byId(r.state, "crate")!.import).toEqual({ filter: "nearest", pivot: [1, 2] });
    expect(byId(r.state, "crate")!.meta).toEqual({ w: 4 });
    const reset = ok([{ op: "setImport", id: "crate", set: { filter: null } }]);
    expect(byId(reset.state, "crate")!.import).toBeUndefined();
    expect(refused([{ op: "setImport", id: "crate", set: { nope: 1 } }]).issue.path).toBe(
      "/ops/0/set",
    );
    expect(refused([{ op: "setImport", id: "intro", set: {} }]).issue.code).toBe("asset-kind");
    const inspected = ok(
      [{ op: "setImport", id: "crate", set: { filter: "linear" } }],
      base,
      env({ inspect: (_d, e) => ({ ok: true, meta: { filter: e.import?.filter } }) }),
    );
    expect(byId(inspected.state, "crate")!.meta).toEqual({ filter: "linear" });
  });

  it("replaces content, keeping every hash the asset held in its history", () => {
    const one = ok([{ op: "replaceContent", id: "crate", sha256: H("b"), bytes: 11 }]);
    const crate = byId(one.state, "crate")!;
    expect([crate.sha256, crate.bytes, crate.meta]).toEqual([H("b"), 11, undefined]);
    expect(one.state.history.crate).toEqual([
      { sha256: H("a"), bytes: 10, at: 100, by: "ada" },
      { sha256: H("b"), bytes: 11, at: 100, by: "ada" },
    ]);
    const two = ok(
      [{ op: "replaceContent", id: "crate", sha256: H("d"), bytes: 12 }],
      one.state,
      env({ now: 200 }),
    );
    expect(two.state.history.crate!.map((h) => [h.sha256, h.at])).toEqual([
      [H("a"), 100],
      [H("b"), 100],
      [H("b"), 200],
      [H("d"), 200],
    ]);
    const back = ok(
      [{ op: "replaceContent", id: "crate", sha256: H("b"), bytes: 11 }],
      two.state,
      env({ now: 300 }),
    );
    expect(back.state.history.crate!.slice(4)).toEqual([
      { sha256: H("d"), bytes: 12, at: 300, by: "ada" },
    ]);
    expect(ok([{ op: "replaceContent", id: "crate", sha256: H("a"), bytes: 10 }]).registry).toBe(
      false,
    );
  });

  it("refuses new content for an immutable kind or past the kind's size", () => {
    const r = refused([{ op: "replaceContent", id: "take", sha256: H("e"), bytes: 1 }]);
    expect(r.issue.code).toBe("asset-kind");
    expect(
      refused([{ op: "replaceContent", id: "crate", sha256: H("e"), bytes: 1001 }]).issue.code,
    ).toBe("asset-too-large");
  });

  it("sets the whole licence or clears it", () => {
    const set = ok([{ op: "setLicence", id: "intro", licence: { spdx: "MIT", author: "Bo" } }]);
    expect(byId(set.state, "intro")!.licence).toEqual({ spdx: "MIT", author: "Bo" });
    const narrowed = ok([{ op: "setLicence", id: "intro", licence: { spdx: "MIT" } }], set.state);
    expect(byId(narrowed.state, "intro")!.licence).toEqual({ spdx: "MIT" });
    const cleared = ok([{ op: "setLicence", id: "intro", licence: null }], set.state);
    expect(byId(cleared.state, "intro")!.licence).toBeUndefined();
  });
});

describe("batches", () => {
  it("applies ops in order against the batch's own earlier ops", () => {
    const r = ok([
      { op: "createAsset", kind: "note", path: "a.json", id: "fresh" },
      { op: "moveAsset", ids: ["fresh"], to: "later/" },
      { op: "setLicence", id: "fresh", licence: { author: "Ana" } },
    ]);
    expect(byId(r.state, "fresh")).toMatchObject({
      path: "later/a.json",
      licence: { author: "Ana" },
    });
  });

  it("refuses the whole batch at the failing op", () => {
    const r = refused([
      { op: "deleteAsset", id: "crate" },
      { op: "createAsset", kind: "note", path: "a.json", id: "fresh" },
      { op: "moveAsset", ids: ["missing"], to: "" },
    ]);
    expect(r.opIndex).toBe(2);
  });

  it("refuses doc edits whose content wasn't given", () => {
    const edit = refused([{ op: "editAsset", id: "intro", edits: [{ set: "/text", value: "x" }] }]);
    expect([edit.issue.code, edit.issue.path]).toEqual(["op-invalid", "/ops/0/id"]);
    const scene = refused([{ op: "editScene", id: "yard", ops: [{ op: "remove", refs: ["a"] }] }]);
    expect(scene.issue.code).toBe("ref-not-found");
  });

  it("checks the batch's shape first, naming the nearest op or key", () => {
    const typo = refused([{ op: "moveAset", ids: ["crate"], to: "" } as unknown as ProjectOp]);
    expect(typo.issue.message).toContain('did you mean "moveAsset"?');
    const extra = refused([
      { op: "deleteAsset", id: "crate", forse: true } as unknown as ProjectOp,
    ]);
    expect(extra.issue.message).toContain('did you mean "force"?');
    expect(extra.issue.path).toBe("/ops/0/forse");
    const noV = checkProjectBatch(base, new Map(), { ops: [] } as never, env());
    expect(noV.ok).toBe(false);
    const badHash = refused([{ op: "replaceContent", id: "crate", sha256: "abc", bytes: 1 }]);
    expect(badHash.issue.path).toBe("/ops/0/sha256");
  });

  it("reports the issues the batch leaves", () => {
    const dup: ProjectState = {
      ...base,
      assets: {
        ...base.assets,
        twin: entry("twin", { id: "crate", kind: "texture", path: "art/twin.png" }),
      },
    };
    expect(ok([], dup).issues.map((i) => i.code)).toEqual(["asset-id-taken"]);
  });
});

// ─── References ──────────────────────────────────────────

describe("references", () => {
  const surfaces = defineGame({
    id: "surfaces",
    types: [
      defineEntityType({
        type: "pad",
        description: "A pad with a label.",
        base: "solid",
        fields: (fieldEnv) => ({
          shape: shapeField("Its shape."),
          top: materialField(fieldEnv, "Top surface."),
          label: z.string().optional().describe("A name, not a material."),
        }),
      }),
    ],
    materials: { ice: { friction: 0, restitution: 0, description: "Slippery." } },
    settings: {},
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  });
  const game = createRegistry(surfaces, {
    materials: {
      rubber: { description: "Bouncy.", physics: { friction: 1, restitution: 0.9 } },
    },
  });
  const engineKinds = createKindRegistry(null);

  const yard = {
    v: 2,
    game: "surfaces",
    name: "yard",
    bounds: [0, 0, 1000, 1000],
    instances: [{ id: "g1", prefab: "gate", at: [100, 100] }],
    entities: [
      { id: "floor", type: "solid", shape: ["box", 500, 900, 500, 20], material: "rubber" },
      { id: "p", type: "pad", shape: ["box", 100, 800, 20, 4], top: "ice", label: "rubber" },
    ],
  };
  const gate = {
    kind: "prefab",
    v: 2,
    game: "surfaces",
    id: "gate",
    entities: [{ id: "slope", type: "solid", shape: ["box", 0, 0, 10, 10], material: "rubber" }],
  };
  const walk = { v: 1, scene: "yard", steps: [{ wait: 60 }] };
  const checks = {
    v: 1,
    checks: [
      { id: "valid", kind: "valid" },
      {
        id: "settles",
        kind: "reaches",
        result: "script-end",
        script: { v: 1, scene: "yard", steps: [{ wait: 60 }] },
      },
    ],
  };
  const rubber = {
    kind: "material",
    v: 1,
    description: "Bouncy.",
    physics: { friction: 1, restitution: 0.9 },
  };

  const refState: ProjectState = {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: {
      yard: entry("yard", { id: "yard", kind: "scene", path: "levels/yard.json" }),
      gate: entry("gate", { id: "gate", kind: "prefab", path: "levels/prefabs/gate.json" }),
      rubber: entry("rubber", { id: "rubber", kind: "material", path: "materials/rubber.json" }),
      walk: entry("walk", { id: "walk", kind: "input-script", path: "levels/walk.script.json" }),
      checks: entry("checks", { id: "checks", kind: "checks", path: "levels/yard.checks.json" }),
      tiles: entry("tiles", {
        id: "tiles",
        kind: "texture",
        path: "art/tiles.png",
        sha256: H("a"),
        bytes: 10,
      }),
      sheet: entry("sheet", {
        id: "sheet",
        kind: "atlas",
        path: "art/sheet.atlas.json",
        sha256: H("b"),
        bytes: 10,
        import: { texture: "tiles" },
      }),
      pixel: entry("pixel", {
        id: "pixel",
        kind: "font",
        path: "art/pixel.fnt",
        sha256: H("c"),
        bytes: 10,
        import: { pages: ["tiles"] },
      }),
    },
    history: {},
    code: {},
    build: {},
  };
  const take = entry("take", {
    id: "take",
    kind: "recording",
    path: "levels/yard.recording.json",
    sha256: H("d"),
    bytes: 10,
    meta: { scene: "yard", ticks: 60, sceneHash: "0".repeat(16) },
  });

  const docs = (): Map<string, unknown> =>
    new Map<string, unknown>(
      Object.entries({ yard, gate, walk, checks, rubber }).map(([k, v]) => [k, structuredClone(v)]),
    );

  function check(
    ops: ProjectOp[],
    opts: {
      state?: ProjectState;
      docs?: Map<string, unknown>;
      env?: Partial<ProjectBatchEnv>;
    } = {},
  ): ProjectBatchCheck {
    return checkProjectBatch(
      opts.state ?? refState,
      opts.docs ?? docs(),
      { v: 1, ops },
      env({ registry: game, kinds: engineKinds, ...opts.env }),
    );
  }
  const good = (...args: Parameters<typeof check>) => {
    const r = check(...args);
    if (!r.ok) throw new Error(`op ${r.opIndex}: ${r.issue.message}`);
    return r;
  };
  const bad = (...args: Parameters<typeof check>) => {
    const r = check(...args);
    if (r.ok) throw new Error("expected the batch to be refused");
    return r;
  };
  const valueOf = (r: Extract<ProjectBatchCheck, { ok: true }>, key: string) =>
    r.values.get(key) as Record<string, any>;

  describe("deleteAsset", () => {
    it("refuses an asset other assets name, listing each referrer and pointer", () => {
      const r = bad([{ op: "deleteAsset", id: "gate" }]);
      expect([r.issue.code, r.issue.path, r.issue.entityIds]).toEqual([
        "asset-in-use",
        "/ops/0/id",
        ["gate"],
      ]);
      expect(r.issue.detail).toEqual({
        referrers: [{ id: "yard", pointer: "/instances/@g1/prefab" }],
      });
      expect(r.issue.message).toContain('"yard"');

      const blob = bad([{ op: "deleteAsset", id: "tiles" }], { docs: new Map() });
      expect(blob.issue.detail).toEqual({
        referrers: [
          { id: "pixel", pointer: "/import/pages/0" },
          { id: "sheet", pointer: "/import/texture" },
        ],
      });
    });

    it("trashes it with force, and the referrers report asset-missing", () => {
      const r = good([{ op: "deleteAsset", id: "gate", force: true }]);
      expect(r.state.assets.gate!.deleted).toEqual({ at: 100, by: "ada" });
      expect(r.issues.map((i) => [i.code, i.got, i.entityIds, i.path])).toEqual([
        ["asset-missing", "gate", ["yard"], "/instances/@g1/prefab"],
      ]);
      expect(r.issues[0]!.message).toContain("in the trash");
    });

    it("lets an asset go once the batch has removed its last referrer", () => {
      const r = good([
        { op: "deleteAsset", id: "sheet" },
        { op: "deleteAsset", id: "pixel" },
        { op: "deleteAsset", id: "tiles" },
      ]);
      expect(r.state.assets.tiles!.deleted).toBeDefined();
      expect(r.issues).toEqual([]);
      const unused = good([{ op: "deleteAsset", id: "walk" }]);
      expect(unused.state.assets.walk!.deleted).toBeDefined();
    });

    it("counts a material field only when a material asset has the name", () => {
      const r = good([{ op: "deleteAsset", id: "rubber", force: true }]);
      expect(r.issues.map((i) => [i.got, i.entityIds])).toEqual([
        ["rubber", ["gate"]],
        ["rubber", ["yard"]],
      ]);
      expect(bad([{ op: "deleteAsset", id: "rubber" }]).issue.detail).toEqual({
        referrers: [
          { id: "gate", pointer: "/entities/@slope/material" },
          { id: "yard", pointer: "/entities/@floor/material" },
        ],
      });
    });
  });

  describe("a scene's checks file", () => {
    const plain = { v: 1, checks: [{ id: "valid", kind: "valid" }] };
    const pairState = (extra: Record<string, AssetEntry> = {}): ProjectState => ({
      ...refState,
      assets: {
        yard: refState.assets.yard!,
        checks: refState.assets.checks!,
        field: entry("field", { id: "field", kind: "scene", path: "levels/field.json" }),
        ...extra,
      },
    });
    const pairDocs = (checks: unknown = plain) =>
      new Map<string, unknown>([
        ["yard", structuredClone(yard)],
        ["field", { ...structuredClone(yard), name: "field", instances: [], entities: [] }],
        ["checks", structuredClone(checks)],
      ]);
    const paths = (r: Extract<ProjectBatchCheck, { ok: true }>) =>
      Object.fromEntries(Object.values(r.state.assets).map((e) => [e.id, e.path]));
    const lost = entry("lost", { id: "lost", kind: "checks", path: "levels/lost.checks.json" });

    it("moves with its scene, whichever of the two the op lists first", () => {
      for (const ids of [["yard"], ["yard", "checks"], ["checks", "yard"]]) {
        const r = good([{ op: "moveAsset", ids, to: "arena/" }], {
          state: pairState(),
          docs: pairDocs(),
        });
        expect(paths(r)).toMatchObject({
          yard: "arena/yard.json",
          checks: "arena/yard.checks.json",
          field: "levels/field.json",
        });
      }
    });

    it("takes the scene's new stem on a rename, and stays put for a display name", () => {
      const r = good([{ op: "renameAsset", id: "yard", file: "court.json" }], {
        state: pairState(),
        docs: pairDocs(),
      });
      expect(paths(r)).toMatchObject({
        yard: "levels/court.json",
        checks: "levels/court.checks.json",
      });
      const named = good([{ op: "renameAsset", id: "yard", name: "The yard" }], {
        state: pairState(),
        docs: pairDocs(),
      });
      expect(paths(named).checks).toBe("levels/yard.checks.json");
    });

    it("leaves other assets alone when a scene has no checks file", () => {
      const state = pairState();
      const moved = good([{ op: "moveAsset", ids: ["field"], to: "arena/" }], {
        state,
        docs: pairDocs(),
      });
      expect(paths(moved)).toEqual({ ...paths(good([], { state })), field: "arena/field.json" });
      const renamed = good([{ op: "renameAsset", id: "field", file: "meadow.json" }], {
        state,
        docs: pairDocs(),
      });
      expect(paths(renamed)).toMatchObject({
        field: "levels/meadow.json",
        checks: "levels/yard.checks.json",
      });
    });

    it("refuses the op when the checks file's new path is taken", () => {
      const taken = entry("other", { id: "other", kind: "checks", path: "arena/yard.checks.json" });
      const moved = bad([{ op: "moveAsset", ids: ["yard"], to: "arena/" }], {
        state: pairState({ other: taken }),
        docs: pairDocs(),
      });
      expect([moved.issue.code, moved.issue.path, moved.issue.got]).toEqual([
        "path-taken",
        "/ops/0/to",
        "arena/yard.checks.json",
      ]);
      const renamed = bad([{ op: "renameAsset", id: "yard", file: "field.json" }], {
        state: pairState(),
        docs: pairDocs(),
      });
      expect([renamed.issue.code, renamed.issue.got]).toEqual(["path-taken", "levels/field.json"]);
      const beside = entry("court", {
        id: "court",
        kind: "checks",
        path: "levels/court.checks.json",
      });
      const onto = bad([{ op: "renameAsset", id: "yard", file: "court.json" }], {
        state: pairState({ court: beside }),
        docs: pairDocs(),
      });
      expect([onto.issue.code, onto.issue.path, onto.issue.got]).toEqual([
        "path-taken",
        "/ops/0/file",
        "levels/court.checks.json",
      ]);
    });

    it("names the checks file as a referrer of its scene's delete, by path", () => {
      const r = bad([{ op: "deleteAsset", id: "yard" }], {
        state: pairState(),
        docs: pairDocs(),
      });
      expect([r.issue.code, r.issue.path, r.issue.detail]).toEqual([
        "asset-in-use",
        "/ops/0/id",
        { referrers: [{ id: "checks", pointer: "" }] },
      ]);
      expect(r.issue.message).toContain('"checks"');
      const scripted = bad([{ op: "deleteAsset", id: "yard" }], {
        state: pairState(),
        docs: pairDocs(checks),
      });
      expect(scripted.issue.detail).toEqual({
        referrers: [
          { id: "checks", pointer: "" },
          { id: "checks", pointer: "/checks/@settles/script/scene" },
        ],
      });
      expect(
        bad([{ op: "deleteAsset", id: "yard" }], { state: pairState(), docs: new Map() }).issue
          .detail,
        "the pairing needs no doc values",
      ).toEqual({ referrers: [{ id: "checks", pointer: "" }] });
    });

    it("lets the scene go with force, with its checks file, or once nothing sits beside it", () => {
      const opts = () => ({ state: pairState(), docs: pairDocs() });
      const forced = good([{ op: "deleteAsset", id: "yard", force: true }], opts());
      expect(forced.state.assets.yard!.deleted).toBeDefined();
      expect(forced.state.assets.checks!.deleted).toBeUndefined();
      const both = good(
        [
          { op: "deleteAsset", id: "yard" },
          { op: "deleteAsset", id: "checks" },
        ],
        opts(),
      );
      expect(both.state.assets.checks!.deleted).toBeDefined();
      const away = good(
        [
          { op: "deleteAsset", id: "yard" },
          { op: "moveAsset", ids: ["checks"], to: "spare/" },
        ],
        opts(),
      );
      expect(paths(away).checks).toBe("spare/yard.checks.json");
      const replaced = good(
        [
          { op: "deleteAsset", id: "yard" },
          {
            op: "createAsset",
            kind: "scene",
            path: "levels/yard.json",
            id: "yard2",
            content: yard,
          },
        ],
        opts(),
      );
      expect(replaced.state.assets.yard!.deleted).toBeDefined();
      expect(good([{ op: "deleteAsset", id: "field" }], opts()).ok).toBe(true);
    });

    it("leaves a checks file whose scene is missing alone, and lets it move and go", () => {
      const state = pairState({ lost });
      const opts = () => ({ state, docs: pairDocs() });
      const moved = good([{ op: "moveAsset", ids: ["yard", "field"], to: "arena/" }], opts());
      expect(paths(moved).lost).toBe("levels/lost.checks.json");
      expect(
        good([{ op: "moveAsset", ids: ["lost"], to: "arena/" }], opts()).state.assets.lost!.path,
      ).toBe("arena/lost.checks.json");
      expect(
        good([{ op: "renameAsset", id: "lost", file: "found.checks.json" }], opts()).state.assets
          .lost!.path,
      ).toBe("levels/found.checks.json");
      expect(good([{ op: "deleteAsset", id: "field" }], opts()).ok).toBe(true);
      expect(
        good([{ op: "deleteAsset", id: "lost" }], opts()).state.assets.lost!.deleted,
      ).toBeDefined();
    });

    it("moves the checks file alone, leaving its scene where it is", () => {
      const r = good([{ op: "moveAsset", ids: ["checks"], to: "spare/" }], {
        state: pairState(),
        docs: pairDocs(),
      });
      expect(paths(r)).toMatchObject({
        yard: "levels/yard.json",
        checks: "spare/yard.checks.json",
      });
    });
  });

  describe("editScene removing a prefab", () => {
    const field = { ...yard, name: "field", entities: [] };
    const sharedState: ProjectState = {
      ...refState,
      assets: {
        ...refState.assets,
        field: entry("field", { id: "field", kind: "scene", path: "levels/field.json" }),
      },
    };
    const shared = (over: Record<string, unknown> = {}) => {
      const d = docs();
      d.set("field", structuredClone(field));
      for (const [k, v] of Object.entries(over)) {
        if (v === undefined) d.delete(k);
        else d.set(k, v);
      }
      return d;
    };
    const delegated: Partial<ProjectBatchEnv> = {
      prefabsFor: () => new Map([["gate", structuredClone(gate) as never]]),
      prefabEdit: () => null,
    };
    const drop: ProjectOp = {
      op: "editScene",
      id: "yard",
      ops: [
        { op: "remove", refs: ["g1"] },
        { op: "definePrefab", id: "gate", prefab: null },
      ],
    };
    const run = (ops: ProjectOp[], d = shared()) =>
      check(ops, { state: sharedState, docs: d, env: delegated });

    it("refuses one another scene still places, naming it", () => {
      const r = run([drop]);
      if (r.ok) throw new Error("expected asset-in-use");
      expect([r.opIndex, r.issue.code, r.issue.path, r.issue.detail]).toEqual([
        0,
        "asset-in-use",
        "/ops/0/ops",
        { referrers: [{ id: "field", pointer: "/instances/@g1/prefab" }] },
      ]);
      expect(run([drop], shared({ field: { ...field, instances: [] } })).ok).toBe(true);
    });

    it("refuses a later editScene that defines it again, and judges a removal after a define", () => {
      const again: ProjectOp = {
        op: "editScene",
        id: "field",
        ops: [{ op: "definePrefab", id: "gate", prefab: { entities: gate.entities as never } }],
      };
      const r = run([drop, again]);
      if (r.ok) throw new Error("expected op-invalid");
      expect([r.opIndex, r.issue.code, r.issue.path, r.issue.entityIds]).toEqual([
        1,
        "op-invalid",
        "/ops/1/ops",
        ["gate"],
      ]);
      expect(r.issue.message).toContain("removed by op 0");
      const onPrefab: ProjectOp = {
        op: "editScene",
        id: "gate",
        ops: [{ op: "update", ref: "slope", set: { at: [0, 0] } }],
      };
      expect(run([drop, onPrefab], shared({ field: { ...field, instances: [] } }))).toMatchObject({
        ok: false,
        opIndex: 1,
        issue: { code: "op-invalid" },
      });
      const r2 = run([again, drop]);
      expect(r2.ok ? undefined : r2.issue.code).toBe("asset-in-use");
    });

    it("refuses scene ops that don't apply to what the batch's earlier ops leave the scene", () => {
      const first: ProjectOp = {
        op: "editScene",
        id: "yard",
        ops: [{ op: "remove", refs: ["g1"] }],
      };
      const r = run([first, drop]);
      if (r.ok) throw new Error("expected a refusal");
      expect([r.opIndex, r.issue.code, r.issue.path]).toEqual([1, "ref-not-found", "/ops/1/ops/0"]);
      expect(run([first, drop], shared({ field: { ...field, instances: [] } })).ok).toBe(false);
      // Written after the batch's other edits of the scene, the delegated ops run on what they leave.
      const later: ProjectOp = {
        op: "editScene",
        id: "yard",
        ops: [{ op: "definePrefab", id: "gate", prefab: null }],
      };
      const freed = shared({ field: { ...field, instances: [] } });
      expect(run([later, first], freed).ok).toBe(true);
      expect(run([later], freed).ok).toBe(false);
    });

    it("judges a later delegated op against the prefabs earlier ones leave", () => {
      const unpack: ProjectOp = {
        op: "editScene",
        id: "field",
        ops: [{ op: "unpack", ref: "g1" }],
      };
      const r = run([drop, unpack]);
      if (r.ok) throw new Error("expected prefab-unknown");
      expect([r.opIndex, r.issue.code, r.issue.got]).toEqual([1, "prefab-unknown", "gate"]);
      expect(run([unpack, drop]).ok).toBe(true);
    });

    it("refuses a scene it can't replay once the batch has changed the prefabs it may read", () => {
      const unread = shared({ field: undefined });
      const onField = (ops: unknown[]): ProjectOp => ({
        op: "editScene",
        id: "field",
        ops: ops as never,
      });
      const unpack = run([drop, onField([{ op: "unpack", ref: "g1" }])], unread);
      if (unpack.ok) throw new Error("expected op-invalid");
      expect([unpack.opIndex, unpack.issue.code, unpack.issue.entityIds]).toEqual([
        1,
        "op-invalid",
        ["field"],
      ]);
      const create = run(
        [drop, onField([{ op: "createPrefab", refs: ["floor"], id: "gate" }])],
        unread,
      );
      expect(create.ok ? "" : create.issue.message).toContain("removed by op 0");

      const after = run(
        [
          onField([{ op: "applyToPrefab", ref: "g1" }]),
          { op: "editScene", id: "yard", ops: [{ op: "unpack", ref: "g1" }] },
        ],
        unread,
      );
      if (after.ok) throw new Error("expected op-invalid");
      expect([after.opIndex, after.issue.code]).toEqual([1, "op-invalid"]);
      expect(after.issue.message).toContain("op 0");
    });

    it("still judges the removal when the batch isn't given the scene's value", () => {
      const r = run([drop], shared({ yard: undefined }));
      if (r.ok) throw new Error("expected asset-in-use");
      expect([r.issue.code, r.issue.detail]).toEqual([
        "asset-in-use",
        { referrers: [{ id: "field", pointer: "/instances/@g1/prefab" }] },
      ]);
    });
  });

  describe("changeAssetId", () => {
    it("rewrites a scene's references in its docs that name it, at the atomic value that holds them", () => {
      const r = good([{ op: "changeAssetId", id: "yard", to: "court" }]);
      expect(byId(r.state, "court")).toMatchObject({ key: "yard", path: "levels/yard.json" });
      expect(byId(r.state, "yard")).toBeUndefined();
      expect(r.written).toEqual(["checks", "walk"]);
      expect(valueOf(r, "walk")).toEqual({ ...walk, scene: "court" });
      expect(valueOf(r, "checks").checks[1].script).toEqual({
        ...checks.checks[1]!.script,
        scene: "court",
      });
      expect(valueOf(r, "checks").checks[0]).toEqual(checks.checks[0]);
      expect([...r.writtenBy]).toEqual([
        ["checks", 0],
        ["walk", 0],
      ]);
    });

    it("rewrites a texture's binary referrers' import settings", () => {
      const r = good([{ op: "changeAssetId", id: "tiles", to: "tileset" }]);
      expect(byId(r.state, "sheet")!.import).toEqual({ texture: "tileset" });
      expect(byId(r.state, "pixel")!.import).toEqual({ pages: ["tileset"] });
      expect(r.written).toEqual([]);
      expect(r.registry).toBe(true);
    });

    it("renames a prefab's own id and points the scene's instances at it with update ops", () => {
      const library = new Map([["gate", gate as never]]);
      for (const prefabsFor of [() => library, () => new Map()]) {
        const r = good([{ op: "changeAssetId", id: "gate", to: "door" }], { env: { prefabsFor } });
        expect(valueOf(r, "gate").id).toBe("door");
        expect(valueOf(r, "yard").instances).toEqual([
          { id: "g1", prefab: "door", at: [100, 100] },
        ]);
        const scene = r.scenes.get("yard")!;
        expect(scene.ops).toEqual([{ op: "update", ref: "g1", set: { prefab: "door" } }]);
        expect(scene.prefabs?.get("door")?.id).toBe("door");
      }
    });

    it("gives a renamed material to scenes under its new id, and asks the prefab writer about prefabs", () => {
      const asked: unknown[] = [];
      const r = good([{ op: "changeAssetId", id: "rubber", to: "bouncy" }], {
        env: {
          prefabEdit: (op, ctx) => {
            asked.push([op, ctx.entry.id, ctx.index]);
            return null;
          },
        },
      });
      expect(asked).toEqual([
        [
          {
            op: "editScene",
            id: "gate",
            ops: [{ op: "update", ref: "slope", set: { material: "bouncy" } }],
          },
          "gate",
          0,
        ],
      ]);
      expect(r.delegated).toEqual([0]);
      const floor = valueOf(r, "yard").entities;
      expect(floor).toEqual([{ ...yard.entities[0], material: "bouncy" }, yard.entities[1]]);
      const scene = r.scenes.get("yard")!;
      expect(scene.ops).toEqual([{ op: "update", ref: "floor", set: { material: "bouncy" } }]);
      expect(scene.registry.materialNames).toEqual(["ice", "rubber", "bouncy"]);

      const refusal = bad([{ op: "changeAssetId", id: "rubber", to: "bouncy" }], {
        env: { prefabEdit: () => makeIssue("op-invalid", { message: "no prefab docs here" }) },
      });
      expect([refusal.opIndex, refusal.issue.code, refusal.issue.entityIds]).toEqual([
        0,
        "op-invalid",
        ["gate"],
      ]);
      expect(refusal.issue.message).toBe(
        '"gate" can\'t follow "rubber" to "bouncy": no prefab docs here',
      );
      expect(refusal.issue.detail).toEqual({ referrer: "gate" });
    });

    it("fails the whole batch when a referrer can't take the new id", () => {
      const state = { ...refState, assets: { ...refState.assets, take } };
      const r = bad([{ op: "changeAssetId", id: "yard", to: "court" }], { state });
      expect([r.issue.code, r.issue.path, r.issue.entityIds]).toEqual([
        "asset-kind",
        "/ops/0/to",
        ["take"],
      ]);
      expect(r.issue.message).toContain("/meta/scene");
    });

    it("needs every doc that can hold a reference, a free id, and a different one", () => {
      const partial = docs();
      partial.delete("checks");
      const missing = bad([{ op: "changeAssetId", id: "tiles", to: "tileset" }], { docs: partial });
      expect([missing.issue.code, missing.issue.entityIds]).toEqual(["op-invalid", ["checks"]]);
      expect(bad([{ op: "changeAssetId", id: "tiles", to: "sheet" }]).issue.code).toBe(
        "asset-id-taken",
      );
      expect(bad([{ op: "changeAssetId", id: "tiles", to: "tiles" }]).issue.code).toBe(
        "op-invalid",
      );
      expect(bad([{ op: "changeAssetId", id: "nope", to: "x" }]).issue.code).toBe("ref-not-found");
    });

    it("lets later ops address the asset and its content by the new id", () => {
      const r = good([
        { op: "changeAssetId", id: "walk", to: "stroll" },
        { op: "editAsset", id: "stroll", edits: [{ set: "/maxTicks", value: 100 }] },
        { op: "changeAssetId", id: "yard", to: "court" },
      ]);
      expect(valueOf(r, "walk")).toEqual({ ...walk, scene: "court", maxTicks: 100 });
      expect(byId(r.state, "stroll")!.key).toBe("walk");
    });

    describe("material references outside fields", () => {
      const bulky = {
        ...yard,
        instances: [
          { id: "g1", prefab: "gate", at: [100, 100], overrides: { "slope.material": "rubber" } },
        ],
        "solid:rubber": [
          ["box", 10, 10, 5, 5],
          ["box", 30, 10, 5, 5],
        ],
      };
      const bulkGate = { ...gate, bulk: { "solid:rubber": [["box", 0, 20, 4, 4]] } };
      const bulkDocs = () => {
        const d = docs();
        d.set("yard", structuredClone(bulky));
        d.set("gate", structuredClone(bulkGate));
        return d;
      };
      const library = () => new Map([["gate", structuredClone(bulkGate) as never]]);

      it("counts bulk keys and instance overrides as referrers", () => {
        expect(
          bad([{ op: "deleteAsset", id: "rubber" }], { docs: bulkDocs() }).issue.detail,
        ).toEqual({
          referrers: [
            { id: "gate", pointer: "/entities/@slope/material" },
            { id: "gate", pointer: "/bulk/solid:rubber" },
            { id: "yard", pointer: "/instances/@g1/overrides/slope.material" },
            { id: "yard", pointer: "/entities/@floor/material" },
            { id: "yard", pointer: "/solid:rubber" },
          ],
        });
        const onlyBulk = docs();
        onlyBulk.set("yard", {
          v: 2,
          game: "surfaces",
          name: "yard",
          bounds: [0, 0, 100, 100],
          "solid:rubber": [["box", 5, 5, 2, 2]],
        });
        onlyBulk.set("gate", { ...gate, entities: [] });
        const r = bad([{ op: "deleteAsset", id: "rubber" }], { docs: onlyBulk });
        expect([r.issue.code, r.issue.detail]).toEqual([
          "asset-in-use",
          { referrers: [{ id: "yard", pointer: "/solid:rubber" }] },
        ]);
        const forced = good([{ op: "deleteAsset", id: "rubber", force: true }], { docs: onlyBulk });
        expect(forced.issues.map((i) => [i.code, i.got, i.path])).toEqual([
          ["asset-missing", "rubber", "/solid:rubber"],
        ]);
      });

      it("moves bulk entries to the new key and rewrites overrides, in scenes and prefabs", () => {
        const asked: unknown[] = [];
        const r = good([{ op: "changeAssetId", id: "rubber", to: "bouncy" }], {
          docs: bulkDocs(),
          env: {
            prefabsFor: library,
            prefabEdit: (op) => {
              asked.push(op);
              return null;
            },
          },
        });
        const scene = valueOf(r, "yard");
        expect(scene["solid:bouncy"]).toEqual(bulky["solid:rubber"]);
        expect(scene["solid:rubber"]).toBeUndefined();
        expect(scene.instances[0].overrides).toEqual({ "slope.material": "bouncy" });
        expect(scene.entities[0].material).toBe("bouncy");
        expect(r.scenes.get("yard")!.ops).toEqual([
          { op: "update", ref: "floor", set: { material: "bouncy" } },
          { op: "override", ref: "g1", set: { "slope.material": "bouncy" } },
          { op: "addBulk", key: "solid:bouncy", shapes: bulky["solid:rubber"] },
          { op: "remove", refs: ["~solid:rubber:0", "~solid:rubber:1"] },
        ]);
        expect(asked).toEqual([
          {
            op: "editScene",
            id: "gate",
            ops: [
              { op: "update", ref: "slope", set: { material: "bouncy" } },
              { op: "addBulk", key: "solid:bouncy", shapes: [["box", 0, 20, 4, 4]] },
              { op: "remove", refs: ["~solid:rubber:0"] },
            ],
          },
        ]);
      });

      it("fails when a doc the new id leaves behind wouldn't read", () => {
        const nested = createRegistry(
          defineGame({
            id: "surfaces",
            types: [
              defineEntityType({
                type: "sign",
                description: "A sign whose face names a material inside an object.",
                base: "solid",
                fields: (fieldEnv) => ({
                  shape: shapeField("Its shape."),
                  face: z.object({ top: materialField(fieldEnv, "Its face.") }).optional(),
                }),
              }),
            ],
            materials: {},
            settings: {},
            actions: [],
            createRuntime: () => ({ snapshot: () => null }),
          }),
          {
            materials: {
              rubber: { description: "Bouncy.", physics: { friction: 1, restitution: 0.9 } },
            },
          },
        );
        const d = docs();
        d.set("yard", {
          v: 2,
          game: "surfaces",
          name: "yard",
          bounds: [0, 0, 100, 100],
          entities: [
            { id: "s", type: "sign", shape: ["box", 5, 5, 2, 2], face: { top: "rubber" } },
          ],
        });
        d.set("gate", { ...gate, entities: [] });
        const r = bad([{ op: "changeAssetId", id: "rubber", to: "bouncy" }], {
          docs: d,
          env: { registry: nested },
        });
        expect([r.issue.entityIds, r.issue.detail]).toEqual([["yard"], { referrer: "yard" }]);
        expect(r.issue.message).toMatch(
          /^"yard" can't follow "rubber" to "bouncy": it wouldn't read afterwards/,
        );
      });

      it("doesn't blame the batch for a doc that didn't read before it", () => {
        const d = docs();
        d.set("yard", {
          ...yard,
          entities: [{ ...yard.entities[0], material: "ghost" }],
        });
        const r = good([{ op: "changeAssetId", id: "gate", to: "door" }], { docs: d });
        expect(valueOf(r, "yard").instances[0].prefab).toBe("door");
      });
    });

    it("leaves a site that names the id as another kind alone", () => {
      const named = docs();
      named.set("yard", { ...yard, instances: [{ id: "g1", prefab: "walk", at: [0, 0] }] });
      const r = good([{ op: "changeAssetId", id: "walk", to: "stroll" }], { docs: named });
      expect(r.written).toEqual([]);
      expect(good([{ op: "deleteAsset", id: "walk" }], { docs: named }).issues).toEqual([]);
    });
  });
});

// ─── Project-wide rules ──────────────────────────────────

describe("project-wide rules", () => {
  const cards = defineGame({
    id: "cards",
    types: [],
    materials: {},
    settings: {},
    actions: [],
    tables: { card: { description: "A card.", row: { cost: z.number().int() } } },
    createRuntime: () => ({ snapshot: () => null }),
  });
  const cardEnv = env({ registry: createRegistry(cards), kinds: createKindRegistry(cards) });
  const deck = (rows: string[]) => ({
    kind: "data-table",
    v: 1,
    table: "card",
    rows: rows.map((id) => ({ id, cost: 1 })),
  });
  const state: ProjectState = {
    ...base,
    assets: {
      settings: entry("settings", {
        id: "settings",
        kind: "game-settings",
        path: "game-settings.json",
      }),
      red: entry("red", { id: "red", kind: "data-table", path: "data/red.json" }),
      blue: entry("blue", { id: "blue", kind: "data-table", path: "data/blue.json" }),
      gone: entry("gone", {
        id: "gone",
        kind: "game-settings",
        path: "old/settings.json",
        deleted: { at: 5, by: "bo" },
      }),
    },
  };
  const docs = () =>
    new Map<string, unknown>([
      ["red", deck(["fireball"])],
      ["blue", deck(["heal"])],
    ]);
  const check = (ops: ProjectOp[], s = state) =>
    checkProjectBatch(s, docs(), { v: 1, ops }, cardEnv);

  it("refuses a second game-settings asset, created or restored", () => {
    const created = check([
      { op: "createAsset", kind: "game-settings", path: "more/settings2.json" },
    ]);
    expect(created.ok || [created.issue.code, created.issue.path, created.issue.entityIds]).toEqual(
      ["asset-kind", "/ops/0/kind", ["settings"]],
    );
    const restored = check([{ op: "restoreAsset", id: "gone" }]);
    expect(restored.ok || [restored.issue.code, restored.issue.path]).toEqual([
      "asset-kind",
      "/ops/0/id",
    ]);
    const swapped = check([
      { op: "deleteAsset", id: "settings" },
      { op: "restoreAsset", id: "gone" },
    ]);
    expect(swapped.ok).toBe(true);
  });

  it("reports a row id two assets of one table hold as dup-id on the later by path, for tables the batch wrote", () => {
    const edited = check([
      {
        op: "editAsset",
        id: "blue",
        edits: [{ insert: "/rows", value: { id: "fireball", cost: 2 } }],
      },
    ]);
    if (!edited.ok) throw new Error(edited.issue.message);
    expect(edited.issues.map((i) => [i.code, i.entityIds, i.path, i.detail])).toEqual([
      ["dup-id", ["red", "fireball"], "/rows/0/id", { table: "card", first: "blue" }],
    ]);
    const created = check([
      { op: "createAsset", kind: "data-table", path: "data/green.json", content: deck(["heal"]) },
    ]);
    if (!created.ok) throw new Error(created.issue.message);
    expect(created.issues.map((i) => [i.code, i.entityIds])).toEqual([
      ["dup-id", ["new0", "heal"]],
    ]);
    const untouched = check([{ op: "setLicence", id: "red", licence: { spdx: "CC0-1.0" } }]);
    expect(untouched.ok && untouched.issues).toEqual([]);
  });
});

describe("changeAssetId in keyed collections with their own id field", () => {
  const roster = defineAssetKind({
    storage: "doc",
    kind: "roster",
    title: "Roster",
    description: "Players by name, each naming a skin.",
    match: { jsonKind: "roster" },
    version: 1,
    schemaId: "urn:jams-engine:roster:v1",
    schema: () =>
      z.looseObject({
        kind: z.literal("roster"),
        v: z.literal(1),
        players: z.array(z.looseObject({ name: z.string(), skin: z.string() })),
      }),
    layout: {
      as: "map",
      fields: { players: { as: "keyed", id: "name", item: { as: "map", rest: { as: "atomic" } } } },
      rest: { as: "atomic" },
    },
    empty: () => ({ kind: "roster", v: 1, players: [] }),
    refs: (value: { players: { name: string; skin: string }[] }) =>
      value.players.map((p) => ({ pointer: `/players/@${p.name}/skin`, id: p.skin, kinds: [] })),
  });
  const rosterKinds = createKindRegistry(null, [roster, note]);
  const state: ProjectState = {
    ...base,
    assets: {
      team: entry("team", { id: "team", kind: "roster", path: "team.json" }),
      intro: entry("intro", { id: "intro", kind: "note", path: "notes/intro.json" }),
    },
  };
  const team = {
    kind: "roster",
    v: 1,
    players: [
      { name: "ada", skin: "intro" },
      { name: "bo", skin: "other" },
    ],
  };

  it("rewrites the item its id field names", () => {
    const r = checkProjectBatch(
      state,
      new Map<string, unknown>([["team", team]]),
      { v: 1, ops: [{ op: "changeAssetId", id: "intro", to: "opening" }] },
      env({ kinds: rosterKinds }),
    );
    if (!r.ok) throw new Error(r.issue.message);
    expect(r.values.get("team")).toEqual({
      ...team,
      players: [{ name: "ada", skin: "opening" }, team.players[1]],
    });
  });
});
