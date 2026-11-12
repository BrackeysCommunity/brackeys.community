import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";
import { z } from "zod";

import { sequentialKeys } from "../../collab/keys";
import { layoutToDoc } from "../../collab/layout";
import { applyProjectBatch, applyRegistryBatch } from "../../collab/project-apply";
import {
  projectAssetsMap,
  projectHistoryMap,
  readProject,
  seedProjectDoc,
} from "../../collab/project-doc";
import { createProjectSession, memoryDocHost } from "../../collab/project-session";
import type { DocOrigin } from "../../collab/types";
import { createUndoCoordinator } from "../../collab/undo-coordinator";
import { createRegistry } from "../../game/define";
import { createKindRegistry, defineAssetKind } from "../kinds";
import { checkProjectBatch, type ProjectBatchCheck, type ProjectOp } from "../ops";
import type { AssetEntry, ProjectState } from "../types";
import { unreferencedBlobs } from "../usage";
import { projectView } from "../view";

const note = defineAssetKind({
  storage: "doc",
  kind: "note",
  title: "Note",
  description: "A note.",
  match: { suffixes: [".note.json"] },
  version: 1,
  schemaId: "urn:jams-engine:note:v1",
  schema: () => z.looseObject({ v: z.literal(1) }),
  layout: { as: "map", rest: { as: "atomic" } },
  empty: () => ({ v: 1 }),
});
const texture = defineAssetKind({
  storage: "blob",
  kind: "texture",
  title: "Texture",
  description: "An image.",
  match: { suffixes: [".png"] },
  contentTypes: ["image/png"],
  maxBytes: 1 << 20,
  settings: z.strictObject({}),
  meta: z.looseObject({}),
  inspect: () => ({ ok: true as const, meta: {} }),
});
const kinds = createKindRegistry(null, [note, texture]);
const registry = createRegistry();

const H = (c: string) => c.repeat(64);

const entry = (key: string, extra: Omit<AssetEntry, "key" | "created">): AssetEntry => ({
  key,
  created: { at: 1, by: "seed" },
  ...extra,
});

const state: ProjectState = {
  meta: { projectId: "p", layout: 1, name: "P" },
  assets: {
    crate: entry("crate", {
      id: "crate",
      kind: "texture",
      path: "art/crate.png",
      sha256: H("a"),
      bytes: 10,
      deleted: { at: 5, by: "bo" },
    }),
    barrel: entry("barrel", {
      id: "barrel",
      kind: "texture",
      path: "art/barrel.png",
      sha256: H("c"),
      bytes: 4,
    }),
    plan: entry("plan", { id: "plan", kind: "note", path: "plan.note.json" }),
  },
  history: {
    crate: [{ sha256: H("b"), bytes: 8, at: 3, by: "bo" }],
    barrel: [],
  },
  code: {},
  build: {},
};

const env = () => ({ registry, kinds, now: 100, by: "ada", newKey: sequentialKeys("n") });

function run(ops: ProjectOp[], from = state): ProjectBatchCheck {
  return checkProjectBatch(from, new Map([["plan", { v: 1 }]]), { v: 1, ops }, env());
}

describe("purgeAsset", () => {
  it("removes a trashed entry and its hash history, so its blobs become unreferenced", () => {
    const check = run([{ op: "purgeAsset", id: "crate" }]);
    if (!check.ok) throw new Error(check.issue.message);
    expect(check.registry).toBe(true);
    expect(check.purged).toEqual(["crate"]);
    expect(check.state.assets.crate).toBeUndefined();
    expect(check.state.history.crate).toBeUndefined();
    expect(check.state.history.barrel).toEqual([]);
    expect(state.assets.crate, "the input state stays as it was").toBeDefined();

    const stored = [H("a"), H("b"), H("c")];
    const opts = { now: 100, graceMs: 1_000, pinned: [] };
    expect(unreferencedBlobs(projectView(state, kinds), stored, opts)).toEqual([]);
    expect(unreferencedBlobs(projectView(check.state, kinds), stored, opts)).toEqual([
      H("a"),
      H("b"),
    ]);
  });

  it("refuses a live asset, and an id the trash doesn't hold, with asset-not-trashed", () => {
    for (const id of ["barrel", "plan", "crat"]) {
      const check = run([{ op: "purgeAsset", id }]);
      expect(check.ok).toBe(false);
      if (check.ok) continue;
      expect(check.issue).toMatchObject({
        code: "asset-not-trashed",
        path: "/ops/0/id",
        got: id,
      });
    }
    const typo = run([{ op: "purgeAsset", id: "crat" }]);
    expect(!typo.ok && typo.issue.message).toMatch(/did you mean "crate"/);
    const live = run([{ op: "purgeAsset", id: "barrel" }]);
    expect(!live.ok && live.issue.message).toMatch(/deleteAsset first/);
  });

  it("purges an asset the same batch trashed, and refuses a second purge of it", () => {
    const check = run([
      { op: "deleteAsset", id: "barrel" },
      { op: "purgeAsset", id: "barrel" },
    ]);
    if (!check.ok) throw new Error(check.issue.message);
    expect(check.purged).toEqual(["barrel"]);
    expect(check.state.assets.barrel).toBeUndefined();
    const twice = run([
      { op: "purgeAsset", id: "crate" },
      { op: "purgeAsset", id: "crate" },
    ]);
    expect(twice).toMatchObject({ ok: false, opIndex: 1, issue: { code: "asset-not-trashed" } });
  });

  it("takes the most recently trashed entry of an id first", () => {
    const again = run([
      { op: "importAsset", path: "art/crate.png", sha256: H("d"), bytes: 2 },
      { op: "deleteAsset", id: "crate" },
    ]);
    if (!again.ok) throw new Error(again.issue.message);
    const first = run([{ op: "purgeAsset", id: "crate" }], again.state);
    if (!first.ok) throw new Error(first.issue.message);
    expect(first.purged).toEqual(["n0000"]);
    expect(first.state.assets.crate?.deleted).toBeDefined();
    const second = run([{ op: "purgeAsset", id: "crate" }], first.state);
    expect(second.ok && second.purged).toEqual(["crate"]);
  });

  it("refuses a purge of an asset an earlier op of the batch wrote", () => {
    const check = run([
      { op: "editAsset", id: "plan", edits: [{ set: "/text", value: "x" }] },
      { op: "deleteAsset", id: "plan" },
      { op: "purgeAsset", id: "plan" },
    ]);
    expect(check).toMatchObject({ ok: false, opIndex: 2, issue: { code: "op-invalid" } });
  });
});

describe("purgeAsset in a project doc", () => {
  const ada: DocOrigin = { kind: "user", userId: "ada" };

  function seeded(): Y.Doc {
    const doc = new Y.Doc();
    seedProjectDoc(doc, state, { kind: "migration" });
    return doc;
  }

  it("deletes the entry and its history array from the doc", () => {
    const doc = seeded();
    const r = applyRegistryBatch(
      doc,
      { v: 1, ops: [{ op: "purgeAsset", id: "crate" }] },
      ada,
      env(),
    );
    expect(r.ok).toBe(true);
    expect(projectAssetsMap(doc).has("crate")).toBe(false);
    expect(projectHistoryMap(doc).has("crate")).toBe(false);
    const after = readProject(doc);
    expect(Object.keys(after.assets).sort()).toEqual(["barrel", "plan"]);
    expect(after.history.barrel).toEqual([]);
  });

  it("has no inverse: an undo stack tracking the writer never holds the purge", () => {
    const doc = seeded();
    const undo = createUndoCoordinator(ada);
    undo.attach("project:p", doc);
    const trash = applyRegistryBatch(
      doc,
      { v: 1, ops: [{ op: "deleteAsset", id: "barrel" }] },
      ada,
      env(),
    );
    expect(trash.ok).toBe(true);
    undo.commit({ docs: ["project:p"], label: "Delete barrel" });
    expect(undo.undoLabel()).toBe("Delete barrel");

    const purge = applyRegistryBatch(
      doc,
      { v: 1, ops: [{ op: "purgeAsset", id: "barrel" }] },
      ada,
      env(),
    );
    expect(purge.ok).toBe(true);
    undo.commit({ docs: ["project:p"], label: "Purge barrel" });
    expect(undo.undoLabel(), "the purge added no step").toBe("Delete barrel");

    undo.undo();
    expect(projectAssetsMap(doc).has("barrel"), "undo never brings a purged entry back").toBe(
      false,
    );
    expect(readProject(doc).assets.barrel).toBeUndefined();
    undo.destroy();
  });

  it("reports the stale step as refused, once, instead of undoing the step below it", () => {
    const doc = seeded();
    const undo = createUndoCoordinator(ada);
    undo.attach("project:p", doc);
    for (const id of ["plan", "barrel"]) {
      const trashed = applyRegistryBatch(
        doc,
        { v: 1, ops: [{ op: "deleteAsset", id }] },
        ada,
        env(),
      );
      expect(trashed.ok).toBe(true);
      undo.commit({ docs: ["project:p"], label: `Delete ${id}` });
    }
    applyRegistryBatch(doc, { v: 1, ops: [{ op: "purgeAsset", id: "barrel" }] }, ada, env());
    undo.refuseStale("project:p", "Permanently deleted");

    expect(undo.undo()).toEqual({
      label: "Delete barrel",
      docs: [],
      refused: "Permanently deleted",
    });
    expect(readProject(doc).assets.plan?.deleted, "the step below is untouched").toBeDefined();
    expect(undo.undoLabel()).toBe("Delete plan");
    expect(undo.undo()?.label).toBe("Delete plan");
    expect(readProject(doc).assets.plan?.deleted).toBeUndefined();
    undo.destroy();
  });

  it('answers undo with "Permanently deleted" in a session after its trash is emptied', async () => {
    const host = memoryDocHost();
    seedProjectDoc(host.doc("project:p"), state, { kind: "migration" });
    layoutToDoc(host.doc("asset:p.plan"), { as: "map", rest: { as: "atomic" } }, { v: 1 });
    const session = await createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin: ada,
      registry,
      kinds,
    });
    try {
      for (const id of ["plan", "barrel"]) {
        const trashed = await applyProjectBatch(
          session,
          { v: 1, label: `Delete ${id}`, ops: [{ op: "deleteAsset", id }] },
          session.origin,
        );
        expect(trashed.ok).toBe(true);
      }
      const purged = await applyProjectBatch(
        session,
        { v: 1, label: "Empty the trash", ops: [{ op: "purgeAsset", id: "barrel" }] },
        session.origin,
      );
      expect(purged.ok).toBe(true);
      expect(session.undoLabel()).toBe("Delete barrel");

      expect(session.undo()).toMatchObject({
        label: "Delete barrel",
        refused: "Permanently deleted",
      });
      expect(readProject(session.projectDoc).assets.plan?.deleted).toBeDefined();
      expect(session.undo()?.refused).toBeUndefined();
      expect(readProject(session.projectDoc).assets.plan?.deleted).toBeUndefined();
    } finally {
      session.destroy();
    }
  });
});
