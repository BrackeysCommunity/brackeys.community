// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";

import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { loadCompatRapier } from "../rapier-compat";
import { copyProject, ENGINE_SCENES, tempProject } from "./fixtures";

// A split whose pieces come up short, as a broken triangulation would give.
vi.mock("@jams/engine/scene", async (importOriginal) => {
  const real = await importOriginal<typeof import("@jams/engine/scene")>();
  return {
    ...real,
    decomposeBatch: (...args: Parameters<typeof real.decomposeBatch>) => {
      const made = real.decomposeBatch(...args);
      return made.ok ? { ...made, pieceArea2: made.pieceArea2.slice(1) } : made;
    },
  };
});

const SCENE = "kitchen-sink";

describe("scene decompose's area check", { timeout: 60_000 }, () => {
  it("writes nothing and exits 1 when the pieces don't cover the shape", async () => {
    const root = await mkdtemp(join(tmpdir(), "scene-decompose-area-"));
    try {
      const dir = join(root, "engine");
      await copyProject(ENGINE_SCENES, dir);
      const ctx: ToolContext = {
        projects: [await tempProject(dir, { id: "engine" })],
        loadRapier: loadCompatRapier,
      };
      // A concave poly is already an error, which `apply` refuses, so it goes in as text.
      const file = join(dir, `${SCENE}.json`);
      const doc = JSON.parse(await readFile(file, "utf8")) as { entities: object[] };
      doc.entities.push({
        id: "ell",
        type: "solid",
        shape: ["poly", 40, 0, 44, 0, 44, 1, 41, 1, 41, 3, 40, 3],
      });
      await writeFile(file, JSON.stringify(doc));
      const before = await readFile(file, "utf8");

      const r = await runCli(["decompose", SCENE, "ell", "--json"], ctx);
      expect(r.exitCode).toBe(1);
      expect(JSON.parse(r.stdout)).toMatchObject({ written: false, area: 6 });
      expect(await readFile(file, "utf8")).toBe(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
