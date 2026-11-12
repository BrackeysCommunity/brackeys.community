import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry } from "../../game/define";
import { createKindRegistry, defineAssetKind, type DocLayout } from "../../project/kinds";
import type { ProjectOp } from "../../project/ops";
import { buildRefIndex } from "../../project/refs";
import type { AssetEntry, AssetId } from "../../project/types";
import { layoutFromDoc, layoutToDoc } from "../layout";
import { applyProjectBatch } from "../project-apply";
import { readProject, seedProjectDoc } from "../project-doc";
import { createProjectSession, memoryDocHost, type ProjectSession } from "../project-session";
import type { DocOrigin } from "../types";
import { ada, bo } from "./helpers";

const layout: DocLayout = { as: "map", rest: { as: "atomic" } };
const card = defineAssetKind({
  storage: "doc",
  kind: "card",
  title: "Card",
  description: "A card that may name another.",
  match: { suffixes: [".card.json"] },
  version: 1,
  schemaId: "urn:jams-engine:card:v1",
  schema: () => z.looseObject({ v: z.literal(1) }),
  layout,
  empty: () => ({ v: 1 }),
  refs: (value: { link?: unknown }) =>
    typeof value.link === "string" ? [{ pointer: "/link", id: value.link, kinds: ["card"] }] : [],
});
const kinds = createKindRegistry(null, [card]);
const registry = createRegistry();

/** `gate` names `post`, which is in the trash (trashed with force, so gate reports it missing). */
function world() {
  const host = memoryDocHost();
  const entry = (id: string, extra: Partial<AssetEntry> = {}): AssetEntry => ({
    key: id,
    id,
    kind: "card",
    path: `${id}.card.json`,
    created: { at: 0, by: "seed" },
    ...extra,
  });
  seedProjectDoc(
    host.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: { post: entry("post", { deleted: { at: 1, by: "ada" } }), gate: entry("gate") },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  layoutToDoc(host.doc("asset:p.post"), layout, { v: 1 });
  layoutToDoc(host.doc("asset:p.gate"), layout, { v: 1, link: "post" });
  const join = async (origin: DocOrigin) => {
    const client = host.client();
    const session = await createProjectSession({
      project: "p",
      openDoc: client.openDoc,
      origin,
      registry,
      kinds,
    });
    await session.open("asset:p.gate");
    return { session, client };
  };
  return { host, join };
}

const run = (s: ProjectSession, op: ProjectOp) =>
  applyProjectBatch(s, { v: 1, ops: [op] }, s.origin);

/** What the session's live assets leave dangling: gate's link while post is gone. */
function missing(s: ProjectSession): { code: string; got?: string; from?: AssetId }[] {
  const view = s.view();
  const values = new Map<AssetId, unknown>([
    ["gate", layoutFromDoc(s.get("asset:p.gate")!.doc, layout)],
  ]);
  return buildRefIndex(view, values, kinds, { registry, project: view })
    .dangling()
    .map((i) => ({ code: i.code, got: i.got, from: i.entityIds[0] }));
}

describe("purge while another client restores", () => {
  it("the restore wins when it lands first: the purge is refused", async () => {
    const { host, join } = world();
    const a = await join(ada);
    const b = await join(bo);
    expect(missing(b.session)).toEqual([{ code: "asset-missing", got: "post", from: "gate" }]);

    expect((await run(b.session, { op: "restoreAsset", id: "post" })).ok).toBe(true);
    const purge = await run(a.session, { op: "purgeAsset", id: "post" });
    expect(purge).toMatchObject({ ok: false, issue: { code: "asset-not-trashed" } });

    for (const s of [a.session, b.session]) {
      expect(s.view().byId.has("post")).toBe(true);
      expect(missing(s)).toEqual([]);
    }
    expect(readProject(host.doc("project:p")).assets.post?.deleted).toBeUndefined();
    a.session.destroy();
    b.session.destroy();
  });

  it("the purge wins when it lands first: the restore is lost and reports asset-missing", async () => {
    const { host, join } = world();
    const a = await join(ada);
    const b = await join(bo);

    b.client.setOnline(false);
    expect((await run(b.session, { op: "restoreAsset", id: "post" })).ok).toBe(true);
    expect(missing(b.session), "restored while offline").toEqual([]);
    expect((await run(a.session, { op: "purgeAsset", id: "post" })).ok).toBe(true);
    b.client.setOnline(true);

    expect(readProject(host.doc("project:p")).assets.post).toBeUndefined();
    for (const s of [a.session, b.session]) {
      expect(readProject(s.projectDoc).assets.post).toBeUndefined();
      expect(missing(s)).toEqual([{ code: "asset-missing", got: "post", from: "gate" }]);
    }
    expect(a.session.canUndo(), "the purge is on no undo stack").toBe(false);
    a.session.destroy();
    b.session.destroy();
  });

  it("a restore after the purge has landed finds nothing in the trash", async () => {
    const { join } = world();
    const a = await join(ada);
    const b = await join(bo);
    expect((await run(a.session, { op: "purgeAsset", id: "post" })).ok).toBe(true);
    const restore = await run(b.session, { op: "restoreAsset", id: "post" });
    expect(restore.ok).toBe(false);
    if (!restore.ok) expect(restore.issue.message).toMatch(/trash holds no "post"/);
    expect(missing(b.session)).toEqual([{ code: "asset-missing", got: "post", from: "gate" }]);
    a.session.destroy();
    b.session.destroy();
  });
});
