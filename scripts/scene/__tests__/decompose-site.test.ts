// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { loadCompatRapier } from "../rapier-compat";
import { copyProject, ENGINE_SCENES, tempProject } from "./fixtures";

const SCENE = "kitchen-sink";
const ELL = ["poly", 40, 0, 44, 0, 44, 1, 41, 1, 41, 3, 40, 3];
const NOTCH = ["poly", 0, 0, 2, 0, 1, 0.5, 2, 1, 0, 1];

describe("scene decompose picks the shape the split takes", { timeout: 60_000 }, () => {
  it("measures a behavior block's concave collider, and refuses a nav area's polygon", async () => {
    const root = await mkdtemp(join(tmpdir(), "scene-decompose-site-"));
    try {
      const dir = join(root, "engine");
      await copyProject(ENGINE_SCENES, dir);
      const ctx: ToolContext = {
        projects: [await tempProject(dir, { id: "engine" })],
        loadRapier: loadCompatRapier,
      };
      // A concave collider is already an error, which `apply` refuses, so it goes in as text.
      const file = join(dir, `${SCENE}.json`);
      const doc = JSON.parse(await readFile(file, "utf8")) as { entities: object[] };
      doc.entities.push(
        { id: "hall", type: "nav", shape: ELL },
        { id: "lump", type: "marker", at: [30, 2], behaviors: { collider: { shape: NOTCH } } },
      );
      await writeFile(file, JSON.stringify(doc));

      const lump = await runCli(["decompose", SCENE, "lump", "--dry-run", "--json"], ctx);
      expect(lump.exitCode, lump.stdout + lump.stderr).toBe(0);
      expect(JSON.parse(lump.stdout)).toMatchObject({ area: 1.5, piecesArea: 1.5 });

      const hall = await runCli(["decompose", SCENE, "hall", "--dry-run"], ctx);
      expect(hall.exitCode).toBe(1);
      expect(hall.stdout + hall.stderr).toContain("poly-invalid");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
