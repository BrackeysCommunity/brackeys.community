// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join, matchesGlob, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createRegistry,
  formatScene,
  opsJsonSchema,
  parseSceneOrThrow,
  sceneJsonSchema,
  undescribedProperties,
  untitledEntityFields,
} from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import { judgeScene, projectScenes, type ToolContext } from "../context";
import { discoverProjects } from "../projects";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PROJECTS = await discoverProjects(ROOT);
const ctx: ToolContext = {
  projects: PROJECTS,
  loadRapier: () => Promise.reject(new Error("unused")),
};
const SCENES = await Promise.all(
  PROJECTS.map(async (p) => ({ project: p, scenes: await projectScenes(p) })),
);

/** The string literals in root `vite.config.ts`'s `fmt.ignorePatterns`. */
function fmtIgnorePatterns(): string[] {
  const config = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
  const fmt = config.slice(config.indexOf("fmt: {"));
  const list = fmt.slice(fmt.indexOf("ignorePatterns: ["));
  const block = list.slice(0, list.indexOf("]"));
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe("the projects' scenes", () => {
  it("are found in both projects", () => {
    expect(SCENES.map((s) => [s.project.file.id, s.scenes.length > 0])).toEqual([
      ["engine", true],
      ["platformer", true],
    ]);
  });

  for (const { project, scenes } of SCENES) {
    const home = project.file.id;
    it(`${home}: every scene's folder is left to formatScene, not oxfmt`, () => {
      for (const scene of scenes) {
        const probe = relative(ROOT, join(dirname(scene.file), "x.json"));
        expect(
          fmtIgnorePatterns().some((p) => matchesGlob(probe, p)),
          probe,
        ).toBe(true);
      }
    });

    it(`${home}: each scene's $schema resolves to its registry's committed schema, and is canonical`, () => {
      for (const scene of scenes) {
        const text = readFileSync(scene.file, "utf8");
        const judged = judgeScene(ctx, text, undefined, project);
        if (!judged.ok) throw new Error(judged.issue.message);
        const def = parseSceneOrThrow(text, judged.registry);
        expect(def.$schema, scene.name).toBeDefined();
        const schemaFile = resolve(dirname(scene.file), def.$schema!);
        const schema = JSON.parse(readFileSync(schemaFile, "utf8")) as { $id: string };
        expect(schema.$id, scene.name).toBe(judged.registry.schemaId);
        expect(formatScene(def).text, `${scene.name} is not canonical`).toBe(text);
      }
    });
  }

  it("the frozen format fixtures are left alone by oxfmt too", () => {
    for (const probe of [
      "src/engine/scene/__tests__/fixtures/v1/engine-yard.json",
      "src/games/platformer/__tests__/fixtures/v1/test-yard.json",
    ])
      expect(
        fmtIgnorePatterns().some((p) => matchesGlob(probe, p)),
        probe,
      ).toBe(true);
  });
});

describe("every game's schemas read as documentation", () => {
  for (const game of PROJECTS.flatMap((p) => (p.game ? [p.game] : []))) {
    const registry = createRegistry(game);
    it(`${game.id}: every property is described and every entity field titled`, () => {
      expect(undescribedProperties(sceneJsonSchema(registry))).toEqual([]);
      expect(undescribedProperties(opsJsonSchema(registry))).toEqual([]);
      expect(untitledEntityFields(sceneJsonSchema(registry))).toEqual([]);
    });
  }
});
