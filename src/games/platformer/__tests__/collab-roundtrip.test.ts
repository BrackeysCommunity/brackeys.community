import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { docToScene, sceneToDoc } from "@jams/engine/collab";
import { formatAssetDoc, type DocKindDef } from "@jams/engine/project";
import { formatScene, type SceneDefinition } from "@jams/engine/scene";
import {
  createProjectFileAdapter,
  readFileProject,
  type FileProject,
  type ProjectFileAdapter,
  type ProjectScan,
} from "@jams/engine/vite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { platformerGame } from "../index";

const home = fileURLToPath(new URL("../", import.meta.url));

let cacheDir: string;
let project: FileProject;
let adapter: ProjectFileAdapter;
let scan: ProjectScan;

beforeAll(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "platformer-project-"));
  project = await readFileProject(home, { game: platformerGame, cacheDir });
  adapter = createProjectFileAdapter(project);
  scan = await adapter.scan();
});

afterAll(() => rm(cacheDir, { recursive: true, force: true }));

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

describe("the platformer project", () => {
  it("scans with no problems, its scenes keyed by id, with no sidecars", async () => {
    expect(scan.problems).toEqual([]);
    expect(scan.state.meta).toMatchObject({ projectId: "platformer", name: "Platformer" });
    const entries = Object.values(scan.state.assets);
    expect(entries.map((e) => e.id)).toContain("test-yard");
    for (const e of entries) {
      expect(e.key, e.path).toBe(e.id);
      expect(e.path.startsWith("scenes/"), e.path).toBe(true);
      expect(e.created).toEqual({ at: 0, by: "disk" });
    }
    expect((await walk(join(home, "scenes"))).filter((p) => p.endsWith(".asset.json"))).toEqual([]);
  });

  it("round-trips every doc asset byte for byte through its doc and back, also across the wire", async () => {
    for (const entry of Object.values(scan.state.assets)) {
      const kind = project.kinds.get(entry.kind) as DocKindDef;
      const file = await readFile(join(home, entry.path), "utf8");
      const name = adapter.docNameOf(entry);
      const doc = new Y.Doc();
      await adapter.loadDoc(name, doc);
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      for (const d of [doc, remote])
        expect(formatAssetDoc(kind, adapter.valueOf(name, d)), entry.path).toBe(file);
    }
  });
});

describe("platformer scenes through the shared doc", () => {
  it("round-trip the frozen v1 test-yard byte for byte", () => {
    const text = readFileSync(new URL("./fixtures/v1/test-yard.json", import.meta.url), "utf8");
    const doc = sceneToDoc(JSON.parse(text) as SceneDefinition);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    expect(formatScene(docToScene(remote)).text).toBe(text);
  });
});
