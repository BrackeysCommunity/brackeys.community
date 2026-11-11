// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listenSceneCollab, readFileProject } from "@jams/engine/vite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { ToolContext } from "../context";
import { loadCompatRapier } from "../rapier-compat";
import { apply } from "../tools/apply";
import { applyLive } from "../tools/apply-live";
import { list } from "../tools/list";
import { validate } from "../tools/validate";
import { tempProject } from "./fixtures";

/** A scene with no `settings.physics`: only the project's engine block says "none". */
const FREE_YARD = {
  v: 1,
  name: "free-yard",
  bounds: [0, 0, 640, 480],
  entities: [{ id: "start", type: "marker", at: [100, 100], tags: ["spawn"] }],
};
const CRATE = {
  id: "crate",
  type: "prop",
  shape: ["box", 200, 200, 20, 20],
  density: 1,
  restitution: 0,
};
const ADD_CRATE = { ops: [{ op: "add", entity: CRATE }] };

type Issue = { code: string; entityIds: string[]; line?: number };
const physicsRequired = (data: unknown) =>
  ((data as { issues?: Issue[] }).issues ?? []).filter((i) => i.code === "physics-required");

let root: string;
let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-engine-block-"));
  dir = join(root, "free");
  await mkdir(dir);
  await writeFile(join(dir, "free-yard.json"), JSON.stringify(FREE_YARD, null, 2));
  await writeFile(
    join(dir, "game-settings.json"),
    JSON.stringify({ kind: "game-settings", v: 1, engine: { physics: "none" }, game: {} }),
  );
  ctx = { projects: [await tempProject(dir)], loadRapier: loadCompatRapier };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function opsFile(batch: unknown): Promise<string> {
  const file = join(root, `ops-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(file, JSON.stringify(batch));
  return file;
}

describe("the project's engine block on every path that judges a scene", () => {
  it("apply reports physics-required for a prop and writes nothing, as validate does", async () => {
    const before = await readFile(join(dir, "free-yard.json"), "utf8");
    const r = await apply({ scene: "free-yard", ops: await opsFile(ADD_CRATE) }, ctx);
    expect(r.exitCode, r.text).toBe(1);
    expect(r.data).toMatchObject({ written: false });
    expect(physicsRequired(r.data)).toEqual([expect.objectContaining({ entityIds: ["crate"] })]);
    expect(await readFile(join(dir, "free-yard.json"), "utf8")).toBe(before);

    await writeFile(
      join(dir, "free-yard.json"),
      JSON.stringify({ ...FREE_YARD, entities: [...FREE_YARD.entities, CRATE] }, null, 2),
    );
    const judged = await validate({ target: "free-yard" }, ctx);
    const unlined = (data: unknown) => physicsRequired(data).map(({ line: _, ...i }) => i);
    expect(unlined(judged.data)).toEqual(unlined(r.data));
  });

  it("list counts the same errors validate reports", async () => {
    await writeFile(
      join(dir, "free-yard.json"),
      JSON.stringify({ ...FREE_YARD, entities: [...FREE_YARD.entities, CRATE] }, null, 2),
    );
    const judged = await validate({ target: "free-yard" }, ctx);
    const counts = (judged.data as { counts: Record<string, number> }).counts;
    expect(counts.error).toBeGreaterThan(0);
    const listed = await list({}, ctx);
    const row = (listed.data as { scenes: { name: string; issues: unknown }[] }).scenes.find(
      (s) => s.name === "free-yard",
    );
    expect(row?.issues).toEqual(counts);
  });

  it("apply --live judges the batch with the engine block the server holds", async () => {
    const server = await listenSceneCollab({
      projects: [await readFileProject(dir, { cacheDir: join(root, "server-cache") })],
      debounceMs: 50,
      warn: () => undefined,
    });
    try {
      const before = await readFile(join(dir, "free-yard.json"), "utf8");
      const r = await applyLive(
        { scene: "free-yard", ops: await opsFile(ADD_CRATE), url: server.url, dryRun: true },
        ctx,
      );
      expect(r.exitCode, r.text).toBe(1);
      expect(r.data).toMatchObject({ written: false });
      expect(physicsRequired(r.data)).toEqual([expect.objectContaining({ entityIds: ["crate"] })]);
      expect(await readFile(join(dir, "free-yard.json"), "utf8")).toBe(before);
    } finally {
      await server.close();
    }
  });
});
