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
});
