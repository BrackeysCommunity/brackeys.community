// @vitest-environment node
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { ProjectHandle } from "../projects";
import { projectIssues } from "../tools/game-build";
import { docTexts, loadProject } from "../tools/project-show";
import { tempProject } from "./fixtures";

const FIXTURE = fileURLToPath(new URL("./fixtures/strings", import.meta.url));

let root: string;
let dir: string;
let project: ProjectHandle;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-doc-texts-"));
  dir = join(root, "lines");
  await cp(FIXTURE, dir, { recursive: true });
  await rm(join(dir, "fr.csv"));
  project = await tempProject(dir, { id: "lines" });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const idAt = (loaded: Awaited<ReturnType<typeof loadProject>>, path: string) => {
  const entry = loaded.view.byPath.get(path);
  if (!entry) throw new Error(`no asset at ${path}`);
  return entry.id;
};

describe("the project's doc texts", () => {
  it("are read once by loadProject, a doc that doesn't parse kept for validateProject", async () => {
    const broken = '{ "kind": "strings", "v": 1, "strings": [{ "key": 3 }] }\n';
    await writeFile(join(dir, "strings/ui.json"), broken);
    const loaded = await loadProject(project);
    const ui = idAt(loaded, "strings/ui.json");
    const extra = idAt(loaded, "strings/extra.json");

    expect(loaded.sources.get(ui)).toBe(broken);
    expect(loaded.texts.has(ui)).toBe(false);
    expect(loaded.sources.get(extra)).toBe(await readFile(join(dir, "strings/extra.json"), "utf8"));
    expect([...loaded.sources.keys()].sort()).toEqual([...loaded.view.byId.keys()].sort());

    const errors = projectIssues(loaded).filter((i) => i.severity === "error");
    expect(errors.some((i) => i.entityIds[0] === ui)).toBe(true);
  });

  it("take an entry's own text in place of its file's and leave out a file gone since the scan", async () => {
    const loaded = await loadProject(project);
    const sign = idAt(loaded, "sign.json");
    const hit = idAt(loaded, "hit.json");
    await rm(join(dir, "hit.json"));

    const texts = await docTexts(project, loaded.view, (e) => (e.id === sign ? "{}" : undefined));
    expect(texts.get(sign)).toBe("{}");
    expect(texts.has(hit)).toBe(false);
    expect(texts.get(idAt(loaded, "intro.json"))).toBe(
      loaded.sources.get(idAt(loaded, "intro.json")),
    );
  });
});
