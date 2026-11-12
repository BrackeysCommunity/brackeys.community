import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { memoryContentStore } from "../../project/content-store";
import { createKindRegistry, defineAssetKind, type DocLayout } from "../../project/kinds";
import { sceneKind } from "../../project/kinds/scene";
import type { ProjectOpBatch } from "../../project/ops";
import type { AssetEntry } from "../../project/types";
import { engine, engineYard } from "../../scene/__tests__/fixtures/random-ops";
import { sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { layoutToDoc } from "../layout";
import { sessionPrefabSource } from "../prefab-source";
import { applyProjectBatch } from "../project-apply";
import { seedProjectDoc } from "../project-doc";
import {
  createProjectSession,
  memoryDocHost,
  NO_PREFAB_WRITER,
  type OpenDoc,
  type PrefabWriter,
  type ProjectSessionEvent,
} from "../project-session";
import { ada, bo } from "./helpers";

const layout: DocLayout = { as: "map", rest: { as: "atomic" } };
const card = defineAssetKind({
  storage: "doc",
  kind: "card",
  title: "Card",
  description: "A card.",
  match: { suffixes: [".card.json"] },
  version: 1,
  schemaId: "urn:jams-engine:card:v1",
  schema: () => z.looseObject({ v: z.literal(1) }),
  layout,
  empty: () => ({ v: 1 }),
});
const tex = defineAssetKind({
  storage: "blob",
  kind: "tex",
  title: "Tex",
  description: "Bytes.",
  match: { suffixes: [".tex"] },
  contentTypes: ["application/octet-stream"],
  maxBytes: 100,
  settings: z.strictObject({}),
  meta: z.looseObject({}),
  inspect: () => ({ ok: true as const, meta: {} }),
});
const kinds = createKindRegistry(null, [sceneKind, card, tex]);
const IDS = ["a", "b", "c"] as const;

function world() {
  const host = memoryDocHost();
  const entry = (id: string, kind: string, path: string): AssetEntry => ({
    key: id,
    id,
    kind,
    path,
    created: { at: 0, by: "seed" },
  });
  seedProjectDoc(
    host.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: {
        ...Object.fromEntries(IDS.map((id) => [id, entry(id, "card", `${id}.card.json`)])),
        yard: entry("yard", "scene", "yard.json"),
        img: { ...entry("img", "tex", "img.tex"), sha256: "a".repeat(64), bytes: 1 },
      },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  for (const id of IDS) layoutToDoc(host.doc(`asset:p.${id}`), layout, { v: 1, n: 0 });
  sceneToDoc(engineYard(), { doc: host.doc("scene:p.yard"), key: sequentialKeys("srv") });
  return host;
}

const set = (id: string, n: number): ProjectOpBatch => ({
  v: 1,
  label: `Set ${id}`,
  ops: [{ op: "editAsset", id, edits: [{ set: "/n", value: n }] }],
});

describe("project session", () => {
  it("opens docs lazily through the host's openDoc, once per name", async () => {
    const host = world();
    const client = host.client();
    let closed = 0;
    const openDoc: OpenDoc = async (name) => {
      const opened = await client.openDoc(name);
      return {
        ...opened,
        close() {
          closed++;
          opened.close();
        },
      };
    };
    const store = memoryContentStore();
    const s = await createProjectSession({
      project: "p",
      openDoc,
      origin: ada,
      registry: engine,
      kinds,
      store,
      buildAt: 42,
    });
    expect(client.opened).toEqual(["project:p"]);
    expect([s.name, s.store, s.buildAt, s.prefabWriter]).toEqual([
      "project:p",
      store,
      42,
      NO_PREFAB_WRITER,
    ]);

    const events: ProjectSessionEvent[] = [];
    s.subscribe((e) => events.push(e));
    const [one, two] = await Promise.all([s.open("asset:p.a"), s.open("asset:p.a")]);
    expect(one).toBe(two);
    expect(one).toMatchObject({
      name: "asset:p.a",
      key: "a",
      kind: "card",
      layout,
      readOnly: false,
    });
    expect(client.opened).toEqual(["project:p", "asset:p.a"]);
    expect(s.openDocs()).toEqual(["project:p", "asset:p.a"]);
    expect(s.docNameFor(s.view().byId.get("yard")!)).toBe("scene:p.yard");
    expect(s.docNameFor(s.view().byId.get("img")!)).toBeNull();
    expect((await s.open("scene:p.yard")).layout).toBeUndefined();

    s.release("asset:p.a");
    expect(s.get("asset:p.a"), "still held once").toBeDefined();
    s.release("asset:p.a");
    expect(s.get("asset:p.a")).toBeUndefined();
    expect(closed).toBe(1);
    expect(events.filter((e) => e.type !== "access")).toEqual([
      { type: "open", doc: "asset:p.a" },
      { type: "open", doc: "scene:p.yard" },
      { type: "close", doc: "asset:p.a" },
    ]);

    await expect(s.open("asset:q.a")).rejects.toThrow(/isn't a doc of project "p"/);
    await expect(s.open("project:p")).resolves.toMatchObject({ name: "project:p" });
    s.destroy();
    expect(closed, "the scene and the project doc").toBe(3);
    await expect(s.open("asset:p.a")).rejects.toThrow(/destroyed/);
  });

  it("keeps docs with undo steps open until their steps leave the stack", async () => {
    const host = world();
    const s = await createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin: ada,
      registry: engine,
      kinds,
      cap: 2,
    });
    for (const [i, id] of IDS.entries()) {
      const r = await applyProjectBatch(s, set(id, i + 1), ada);
      expect(r.ok).toBe(true);
    }
    expect(s.pinned()).toEqual(["asset:p.b", "asset:p.c"]);
    expect(s.openDocs()).toEqual(["project:p", "asset:p.b", "asset:p.c"]);

    await applyProjectBatch(s, set("a", 9), bo);
    expect(s.get("asset:p.a"), "another origin's batch leaves no step").toBeUndefined();

    expect(s.undo()).toEqual({ label: "Set c", docs: ["asset:p.c"] });
    expect(s.undo()).toEqual({ label: "Set b", docs: ["asset:p.b"] });
    expect(s.pinned(), "redo steps pin too").toEqual(["asset:p.b", "asset:p.c"]);
    expect(s.undo()).toBeNull();

    await applyProjectBatch(s, set("a", 4), ada);
    expect(s.openDocs(), "a new step drops the redo stack and its docs").toEqual([
      "project:p",
      "asset:p.a",
    ]);
    s.destroy();
  });

  it("peeks at the step undo and redo would take, without taking it", async () => {
    const host = world();
    const s = await createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin: ada,
      registry: engine,
      kinds,
    });
    expect([s.peekUndo(), s.peekRedo()]).toEqual([null, null]);
    await applyProjectBatch(s, set("a", 1), ada);
    await applyProjectBatch(s, set("b", 2), ada);
    expect(s.peekUndo()).toEqual({ label: "Set b", docs: ["asset:p.b"] });
    expect(s.peekUndo(), "peeking takes nothing").toEqual(s.peekUndo());
    expect(s.undoLabel()).toBe("Set b");
    expect(s.undo()).toEqual({ label: "Set b", docs: ["asset:p.b"] });
    expect(s.peekUndo()).toEqual({ label: "Set a", docs: ["asset:p.a"] });
    expect(s.peekRedo()).toEqual({ label: "Set b", docs: ["asset:p.b"] });

    // A write not yet committed is what undo takes first, and it would clear the redo stack.
    const c = await s.open("asset:p.c");
    c.doc.transact(() => c.doc.getMap("scratch").set("n", 1), ada);
    expect(s.peekUndo()).toEqual({ label: "Edit", docs: ["asset:p.c"] });
    expect(s.peekRedo()).toBeNull();
    expect(s.undo()).toEqual({ label: "Edit", docs: ["asset:p.c"] });
    s.release("asset:p.c");
    s.destroy();
  });

  it("refuses editScene's prefab ops until a prefab writer fills the slot", async () => {
    const host = world();
    const s = await createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin: ada,
      registry: engine,
      kinds,
    });
    for (const op of [
      { op: "createPrefab", id: "boxes", refs: ["crate"] },
      { op: "applyToPrefab", ref: "gate-1" },
    ]) {
      const r = await applyProjectBatch(
        s,
        { v: 1, ops: [{ op: "editScene", id: "yard", ops: [op as never] }] },
        ada,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.issue.code).toBe("op-invalid");
        expect(r.issue.message).toMatch(/needs the project/);
      }
    }
    s.destroy();
  });

  it("has its prefab slots filled by the first sessionPrefabSource, and keeps a writer it was given", async () => {
    const host = world();
    const join = (prefabWriter?: PrefabWriter) =>
      createProjectSession({
        project: "p",
        openDoc: host.client().openDoc,
        origin: ada,
        registry: engine,
        kinds,
        ...(prefabWriter ? { prefabWriter } : {}),
      });
    const s = await join();
    expect(s.prefabLibrary().size).toBe(0);
    const source = sessionPrefabSource(s);
    expect(s.prefabWriter).not.toBe(NO_PREFAB_WRITER);
    expect(s.prefabLibrary()).toBe(source.library());
    const writer = s.prefabWriter;
    sessionPrefabSource(s);
    expect(s.prefabWriter).toBe(writer);
    const own: PrefabWriter = { plan: async () => ({ ok: true, docs: [], write: () => [] }) };
    const t = await join(own);
    sessionPrefabSource(t);
    expect(t.prefabWriter).toBe(own);
    s.destroy();
    t.destroy();
  });
});
