// @vitest-environment node
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { ProjectOp } from "../../project/ops";
import { applyProjectBatchToFiles } from "../apply-files";
import { engineProjectCopy, type ProjectCopy } from "./dev-server-fixture";

const agent = { kind: "agent", agentId: "cli" } as const;
let copy: ProjectCopy;

beforeEach(async () => {
  copy = await engineProjectCopy([
    "engine-yard.json",
    "kitchen-sink.json",
    "prefabs/post.json",
    "prefabs/gate.json",
  ]);
  await writeFile(
    copy.file("field.json"),
    `${JSON.stringify({ v: 2, name: "field", bounds: [0, 0, 1000, 1000] }, null, 2)}\n`,
  );
});

afterEach(() => copy.remove());

const apply = (ops: ProjectOp[]) =>
  applyProjectBatchToFiles(copy.project, { v: 1, ops }, { origin: agent });

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

describe("file batches whose scene ops write prefabs", () => {
  it("refuses defining a prefab again after an earlier op removed it, and writes nothing", async () => {
    const before = await files();
    const gate = JSON.parse(before["prefabs/gate.json"]!) as { entities: unknown[] };
    const drop: ProjectOp = {
      op: "editScene",
      id: "engine-yard",
      ops: [{ op: "definePrefab", id: "gate", prefab: null }],
    };
    const again = (id: string): ProjectOp => ({
      op: "editScene",
      id,
      ops: [{ op: "definePrefab", id: "gate", prefab: { entities: gate.entities as never } }],
    });
    for (const id of ["field", "engine-yard"]) {
      const result = await apply([drop, again(id)]);
      expect(result).toMatchObject({
        ok: false,
        opIndex: 1,
        issue: { code: "op-invalid", path: "/ops/1/ops", entityIds: ["gate"] },
      });
      expect(await files()).toEqual(before);
    }

    // Defined first and removed after, the removal is judged: kitchen-sink still places it.
    const reversed = await apply([again("field"), drop]);
    expect(reversed).toMatchObject({ ok: false, opIndex: 1, issue: { code: "asset-in-use" } });
    expect(await files()).toEqual(before);
  });

  it("refuses scene ops that don't apply after the batch's earlier edits of that scene, and writes nothing", async () => {
    const before = await files();
    const first: ProjectOp = {
      op: "editScene",
      id: "kitchen-sink",
      ops: [{ op: "remove", refs: ["post-1", "post-2"] }],
    };
    const drop: ProjectOp = {
      op: "editScene",
      id: "kitchen-sink",
      ops: [
        { op: "remove", refs: ["post-1", "post-2"] },
        { op: "definePrefab", id: "post", prefab: null },
      ],
    };
    const result = await apply([first, drop]);
    expect(result).toMatchObject({ ok: false, opIndex: 1 });
    expect(result.ok ? "" : result.issue.path).toMatch(/^\/ops\/1\/ops\/0/);
    expect(await files()).toEqual(before);

    // The delegated op is written after the other one, so it sees what that one left.
    const placed: ProjectOp = {
      op: "editScene",
      id: "kitchen-sink",
      ops: [{ op: "remove", refs: ["post-2"] }],
    };
    const later: ProjectOp = {
      op: "editScene",
      id: "kitchen-sink",
      ops: [
        { op: "remove", refs: ["post-1"] },
        { op: "definePrefab", id: "post", prefab: null },
      ],
    };
    expect(await apply([later, placed])).toMatchObject({ ok: true });
    const after = await files();
    expect(after["prefabs/post.json"]).toBeUndefined();
    expect(after["kitchen-sink.json"]).not.toContain('"post"');
  });

  const unpackPost: ProjectOp = {
    op: "editScene",
    id: "kitchen-sink",
    ops: [{ op: "unpack", ref: "post-1" }],
  };
  /** Gives gate-1's sensor trigger a shape, in a delegated op: valid only while trigger has one. */
  const overrideTrigger: ProjectOp = {
    op: "editScene",
    id: "kitchen-sink",
    ops: [
      { op: "override", ref: "gate-1", set: { "trigger.shape": ["box", 0, -60, 40, 20] } },
      { op: "unpack", ref: "post-1" },
    ],
  };

  it("refuses a delegated op that reads a prefab an earlier op removed, without throwing or writing", async () => {
    await writeFile(
      copy.file("field.json"),
      `${JSON.stringify(
        {
          v: 2,
          name: "field",
          bounds: [0, 0, 1000, 1000],
          instances: [{ id: "g1", prefab: "gate", at: [100, 100] }],
        },
        null,
        2,
      )}\n`,
    );
    const before = await files();
    const result = await apply([
      {
        op: "editScene",
        id: "kitchen-sink",
        ops: [
          { op: "remove", refs: ["gate-1", "gate-2"] },
          { op: "definePrefab", id: "gate", prefab: null },
        ],
      },
      { op: "editScene", id: "field", ops: [{ op: "unpack", ref: "g1" }] },
    ]);
    expect(result).toMatchObject({
      ok: false,
      opIndex: 1,
      issue: { code: "prefab-unknown", got: "gate" },
    });
    expect(await files()).toEqual(before);
  });

  it("refuses a second delegated op on a scene that doesn't apply after the first, without throwing or writing", async () => {
    const before = await files();
    const result = await apply([unpackPost, unpackPost]);
    expect(result).toMatchObject({ ok: false, opIndex: 1, issue: { code: "ref-not-found" } });
    expect(result.ok ? "" : result.issue.path).toMatch(/^\/ops\/1\/ops\/0/);
    expect(await files()).toEqual(before);
  });

  it("judges delegated ops against the prefabs earlier delegated ops change", async () => {
    const before = await files();
    const gate = JSON.parse(before["prefabs/gate.json"]!) as { entities: { id: string }[] };
    const note = { id: "trigger", type: "note", at: [0, -60], text: "A note now." };
    const redefine: ProjectOp = {
      op: "editScene",
      id: "field",
      ops: [
        {
          op: "definePrefab",
          id: "gate",
          prefab: { entities: [...gate.entities.filter((e) => e.id === "bar"), note] as never },
        },
      ],
    };
    const noteTrigger: ProjectOp = {
      op: "editScene",
      id: "gate",
      ops: [
        { op: "remove", refs: ["trigger"] },
        { op: "add", entity: note as never },
      ],
    };
    const touchTrigger: ProjectOp = {
      op: "editScene",
      id: "gate",
      ops: [{ op: "update", ref: "trigger", set: { shape: ["box", 0, -60, 40, 20] } }],
    };
    for (const ops of [
      [redefine, overrideTrigger],
      [noteTrigger, overrideTrigger],
      [noteTrigger, touchTrigger],
    ]) {
      const result = await apply(ops);
      expect(result).toMatchObject({ ok: false, opIndex: 1 });
      expect(await files()).toEqual(before);
    }

    // In the other order each op runs before the trigger changes.
    expect(await apply([touchTrigger, noteTrigger])).toMatchObject({ ok: true });
    const after = await files();
    expect(after["prefabs/gate.json"]).toContain("A note now.");
    expect(after["kitchen-sink.json"]).toEqual(before["kitchen-sink.json"]);
  });

  it("refuses a delegated op that reads a prefab by the new id an earlier op of the batch gives it", async () => {
    const before = await files();
    const result = await apply([
      { op: "changeAssetId", id: "gate", to: "door" },
      { op: "editScene", id: "kitchen-sink", ops: [{ op: "unpack", ref: "gate-1" }] },
    ]);
    expect(result).toMatchObject({
      ok: false,
      opIndex: 1,
      issue: { code: "op-invalid", got: "door" },
    });
    expect(await files()).toEqual(before);

    // One that doesn't read it goes through, after the rename.
    expect(
      await apply([
        { op: "changeAssetId", id: "gate", to: "door" },
        { op: "editScene", id: "kitchen-sink", ops: [{ op: "unpack", ref: "post-1" }] },
      ]),
    ).toMatchObject({ ok: true });
    const after = await files();
    expect(after["kitchen-sink.json"]).toContain('"prefab": "door"');
    expect(after["kitchen-sink.json"]).not.toContain('"post-1"');
  });
});
