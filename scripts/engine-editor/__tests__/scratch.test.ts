// @vitest-environment node
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { applyOpsToDoc } from "../../../src/engine/collab/apply";
import { createRegistry } from "../../../src/engine/game/index";
import { docNameOf } from "../../../src/engine/project/doc-names";
import { connect, pushed, until } from "../../../src/engine/vite/__tests__/dev-server-fixture";
import { createProjectFileAdapter, readFileProject } from "../../../src/engine/vite/project-files";
import { engineEditorGame } from "../main";
import { engineScenes, REPO_SCENES, startEngineEditor, type EngineEditor } from "../run";

/** Every file under `dir` with its content hash, by relative path. */
async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out[relative(dir, path)] = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  }
  return out;
}

/** A file's text, or null while it's missing (the server replaces files by rename). */
const readOrNull = (path: string) =>
  readFile(path, "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });

const SINK = "kitchen-sink.json";

let editor: EngineEditor | null = null;
const clients: HocuspocusProvider[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.destroy();
  await editor?.close();
  editor = null;
});

describe("the standalone editor's page", () => {
  it("reaches the engine only by its package names, never the site", async () => {
    for (const file of ["main.ts", "vite.config.ts", "run.ts"]) {
      const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
      expect(text, file).not.toMatch(/from "@\/|import\("@\/|src\/(components|lib|routes)\//);
    }
  });
});

describe("the standalone editor's scratch copy", () => {
  it("copies the engine project whole and removes only the copy", async () => {
    const scenes = await engineScenes();
    try {
      expect(scenes.inPlace).toBe(false);
      expect(scenes.dir).not.toBe(REPO_SCENES);
      expect(await tree(scenes.dir)).toEqual(await tree(REPO_SCENES));
      // The editor's game reads every file of the project, its data tables among them.
      const project = await readFileProject(scenes.dir, {
        game: engineEditorGame,
        cacheDir: scenes.cacheDir,
      });
      expect((await createProjectFileAdapter(project).scan()).problems).toEqual([]);
    } finally {
      await scenes.remove();
    }
    await expect(stat(scenes.dir)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(join(REPO_SCENES, SINK))).isFile()).toBe(true);
  });

  it("edits the repo's own files with --in-place, and removing it keeps them", async () => {
    const scenes = await engineScenes({ inPlace: true });
    expect(scenes.dir).toBe(REPO_SCENES);
    await scenes.remove();
    expect((await stat(join(REPO_SCENES, SINK))).isFile()).toBe(true);
  });

  it("serves the page and writes an edit through its collab to the copy, never the repo", async () => {
    const before = await tree(REPO_SCENES);
    const warnings: string[] = [];
    editor = await startEngineEditor({
      port: 0,
      host: "127.0.0.1",
      warn: (m) => warnings.push(m),
    });
    const { origin, scenes } = editor;

    const page = await fetch(`${origin}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('id="editor"');
    const listed = await fetch(`${origin}/__scene`).then((r) => r.json());
    expect(listed.scenes).toEqual(expect.arrayContaining(["kitchen-sink", "engine-yard"]));

    const scratchSink = join(scenes.dir, SINK);
    const original = await readFile(scratchSink, "utf8");
    const name = docNameOf({ kind: "scene", project: "engine", key: "kitchen-sink" });
    const { doc, provider } = await connect(
      `${origin.replace(/^http/, "ws")}/__scene-collab`,
      name,
      clients,
    );
    const applied = applyOpsToDoc(
      doc,
      { ops: [{ op: "add", entity: { id: "scratch-flag", type: "marker", at: [12, 34] } }] },
      { kind: "user", userId: "scratch-test" },
      createRegistry(engineEditorGame),
    );
    expect(applied.ok).toBe(true);
    await pushed(provider);
    await until(
      async () => (await readOrNull(scratchSink))?.includes('"scratch-flag"') ?? false,
      "the edit in the scratch copy",
      15_000,
    );

    expect(original).not.toContain('"scratch-flag"');
    // Every file of the project reads under the editor's game.
    expect(warnings).toEqual([]);
    expect(await tree(REPO_SCENES)).toEqual(before);
  }, 60_000);
});
