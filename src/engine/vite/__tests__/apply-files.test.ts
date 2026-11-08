// @vitest-environment node
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { memoryContentStore } from "../../project/content-store";
import { sha256 } from "../../project/hash";
import type { ProjectOp } from "../../project/ops";
import { applyProjectBatchToFiles, snapshotFiles } from "../apply-files";
import { engineProjectCopy, type ProjectCopy } from "./dev-server-fixture";

const agent = { kind: "agent", agentId: "cli" } as const;
let copy: ProjectCopy;

beforeEach(async () => {
  copy = await engineProjectCopy([
    "engine-yard.json",
    "engine-yard.checks.json",
    "kitchen-sink.json",
    "prefabs/post.json",
    "prefabs/gate.json",
  ]);
});

afterEach(() => copy.remove());

const apply = (ops: ProjectOp[], extra: { base?: string; dryRun?: boolean } = {}) =>
  applyProjectBatchToFiles(
    copy.project,
    { v: 1, ops, ...(extra.base ? { base: extra.base } : {}) },
    { origin: agent, ...(extra.dryRun ? { dryRun: true } : {}) },
  );

async function files(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (rel: string) => {
    for (const e of await readdir(join(copy.dir, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path);
      else out[path] = await copy.read(path);
    }
  };
  await walk("");
  return out;
}

describe("applyProjectBatchToFiles", () => {
  it("writes a scene edit as canonical text, and nothing else", async () => {
    const before = await files();
    const result = await apply([
      { op: "editScene", id: "engine-yard", ops: [{ op: "setScene", set: { name: "Renamed" } }] },
    ]);
    expect(result).toMatchObject({ ok: true, docs: ["scene:engine.engine-yard"] });
    const after = await files();
    expect(JSON.parse(after["engine-yard.json"]!).name).toBe("Renamed");
    expect({ ...after, "engine-yard.json": "" }).toEqual({ ...before, "engine-yard.json": "" });
  });

  it("writes a declarative doc's edit and a prefab's edit", async () => {
    const result = await apply([
      {
        op: "editAsset",
        id: "engine-yard-checks",
        edits: [{ set: "/checks/@valid/physical", value: false }],
      },
      {
        op: "editScene",
        id: "post",
        ops: [{ op: "update", ref: "cap", set: { at: [0, -140] } }],
      },
    ]);
    expect(result.ok).toBe(true);
    expect(JSON.parse(await copy.read("engine-yard.checks.json")).checks[0].physical).toBe(false);
    expect(JSON.parse(await copy.read("prefabs/post.json")).entities[1].at).toEqual([0, -140]);
  });

  it("creates, deletes and restores files through the registry", async () => {
    const created = await apply([{ op: "createAsset", kind: "scene", path: "levels/fresh.json" }]);
    expect(created).toMatchObject({ ok: true, created: ["fresh"] });
    expect(JSON.parse(await copy.read("levels/fresh.json")).v).toBe(2);

    expect((await apply([{ op: "deleteAsset", id: "fresh" }])).ok).toBe(true);
    expect((await files())["levels/fresh.json"]).toBeUndefined();
    expect((await apply([{ op: "restoreAsset", id: "fresh" }])).ok).toBe(true);
    expect(JSON.parse(await copy.read("levels/fresh.json")).v).toBe(2);
  });

  it("changes an id across docs: the prefab's file and every scene that names it", async () => {
    const result = await apply([{ op: "changeAssetId", id: "gate", to: "door" }]);
    expect(result.ok || result.issue).toBe(true);
    expect(JSON.parse(await copy.read("prefabs/gate.json")).id).toBe("door");
    const sink = JSON.parse(await copy.read("kitchen-sink.json"));
    expect(sink.instances.map((i: { prefab: string }) => i.prefab)).toEqual([
      "post",
      "post",
      "door",
      "door",
    ]);
  });

  it("writes nothing when an op fails or on a dry run", async () => {
    const before = await files();
    const failed = await apply([
      { op: "editScene", id: "engine-yard", ops: [{ op: "setScene", set: { name: "Renamed" } }] },
      { op: "deleteAsset", id: "gate" },
    ]);
    expect(failed).toMatchObject({ ok: false, opIndex: 1, issue: { code: "asset-in-use" } });
    const dry = await apply(
      [{ op: "editScene", id: "engine-yard", ops: [{ op: "setScene", set: { name: "Dry" } }] }],
      { dryRun: true },
    );
    expect(dry.ok).toBe(true);
    expect(await files()).toEqual(before);
  });

  const placePost: ProjectOp = {
    op: "editScene",
    id: "engine-yard",
    ops: [{ op: "instantiate", instance: { id: "post-9", prefab: "post", at: [400, 400] } }],
  };
  const clearSink: ProjectOp = {
    op: "editScene",
    id: "kitchen-sink",
    ops: [{ op: "remove", refs: ["post-1", "post-2"] }],
  };

  it("refuses removing a prefab another scene places, also when the batch places it", async () => {
    const before = await files();
    const dropGate: ProjectOp = {
      op: "editScene",
      id: "engine-yard",
      ops: [{ op: "definePrefab", id: "gate", prefab: null }],
    };
    for (const dryRun of [true, false]) {
      const shared = await apply([dropGate], { dryRun });
      expect(shared).toMatchObject({
        ok: false,
        opIndex: 0,
        issue: { code: "asset-in-use", entityIds: ["gate"] },
      });
      const referrers = shared.ok
        ? []
        : (shared.issue.detail as { referrers: { id: string }[] }).referrers;
      expect(new Set(referrers.map((r) => r.id))).toEqual(new Set(["kitchen-sink"]));
    }

    const dropPost: ProjectOp = {
      op: "editScene",
      id: "kitchen-sink",
      ops: [
        { op: "remove", refs: ["post-1", "post-2"] },
        { op: "definePrefab", id: "post", prefab: null },
      ],
    };
    const placedFirst = await apply([placePost, dropPost]);
    expect(placedFirst).toMatchObject({
      ok: false,
      opIndex: 1,
      issue: {
        code: "asset-in-use",
        detail: { referrers: [{ id: "engine-yard", pointer: "/instances/@post-9/prefab" }] },
      },
    });
    expect(await files()).toEqual(before);

    expect((await apply([dropPost])).ok).toBe(true);
    expect((await files())["prefabs/post.json"]).toBeUndefined();
  });

  it("refuses deleting a prefab the batch then places, and writes nothing", async () => {
    expect((await apply([clearSink])).ok).toBe(true);
    const before = await files();
    const result = await apply([{ op: "deleteAsset", id: "post" }, placePost]);
    expect(result).toMatchObject({
      ok: false,
      opIndex: 0,
      issue: {
        code: "asset-in-use",
        entityIds: ["post"],
        detail: { referrers: [{ id: "engine-yard", pointer: "/instances/@post-9/prefab" }] },
      },
    });
    expect(await files()).toEqual(before);
  });

  it("removes a prefab once the batch clears its last referrer elsewhere", async () => {
    expect((await apply([placePost])).ok).toBe(true);
    const result = await apply([
      { op: "editScene", id: "engine-yard", ops: [{ op: "remove", refs: ["post-9"] }] },
      {
        op: "editScene",
        id: "kitchen-sink",
        ops: [
          { op: "remove", refs: ["post-1", "post-2"] },
          { op: "definePrefab", id: "post", prefab: null },
        ],
      },
    ]);
    expect(result.ok || result.issue).toBe(true);
    expect((await files())["prefabs/post.json"]).toBeUndefined();
  });

  it("refuses a stale base with stale-base and applies against the current one", async () => {
    const { hash } = await snapshotFiles(copy.project);
    expect((await snapshotFiles(copy.project)).hash).toBe(hash);
    const ops: ProjectOp[] = [
      { op: "editScene", id: "engine-yard", ops: [{ op: "setScene", set: { name: "One" } }] },
    ];
    expect((await apply(ops, { base: hash })).ok).toBe(true);
    const stale = await apply(ops, { base: hash });
    expect(stale).toMatchObject({
      ok: false,
      issue: { code: "stale-base", expected: hash, path: "/base" },
    });
    expect(stale.ok || stale.issue.got).toBe((await snapshotFiles(copy.project)).hash);
  });

  it("a dry run inspects blobs from the store it is given and leaves the cache alone", async () => {
    // A 1x1 PNG.
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    );
    const store = memoryContentStore();
    const hash = await store.put(png);
    expect(hash).toBe(await sha256(png));
    const before = await files();
    const result = await applyProjectBatchToFiles(
      copy.project,
      {
        v: 1,
        ops: [{ op: "importAsset", path: "art/dot.png", sha256: hash, bytes: png.byteLength }],
      },
      { origin: agent, dryRun: true, store },
    );
    expect(result).toMatchObject({ ok: true, created: ["dot"] });
    expect(await files()).toEqual(before);
    const blobs = await readdir(join(copy.cacheDir, "blobs")).catch(() => [] as string[]);
    expect(blobs).not.toContain(hash);
  });
});
