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
import { describe, expect, it, vi } from "vite-plus/test";

import { judgeScene, projectScenes, type ToolContext } from "../context";
import { discoverProjects } from "../projects";
import { loadCompatRapier } from "../rapier-compat";
import { check } from "../tools/check";
import { validate } from "../tools/validate";

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
  it("are found in every project", () => {
    expect(SCENES.map((s) => [s.project.file.id, s.scenes.length > 0])).toEqual([
      ["engine", true],
      ["platformer", true],
      ["stress", true],
      ["tactics", true],
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
      "packages/engine/scene/__tests__/fixtures/v1/engine-yard.json",
      "src/games/platformer/__tests__/fixtures/v1/test-yard.json",
    ])
      expect(
        fmtIgnorePatterns().some((p) => matchesGlob(probe, p)),
        probe,
      ).toBe(true);
  });
});

describe("grid-yard, the engine's physics-free scene", () => {
  const noRapier = () => {
    const loadRapier = vi.fn(() => Promise.reject(new Error("grid-yard loaded Rapier")));
    return { ctx: { projects: PROJECTS, loadRapier } satisfies ToolContext, loadRapier };
  };
  const file = join(ROOT, "packages/engine/scenes/grid-yard.json");
  const def = () => {
    const text = readFileSync(file, "utf8");
    const judged = judgeScene(ctx, text);
    if (!judged.ok) throw new Error(judged.issue.message);
    return parseSceneOrThrow(text, judged.registry);
  };

  it("runs without physics on a square grid, with solids, markers and sensors and no game", () => {
    const scene = def();
    expect(scene.game).toBeUndefined();
    expect(scene.settings?.physics).toBe("none");
    expect(scene.settings?.grid?.kind).toBe("square");
    const types = new Set((scene.entities ?? []).map((e) => e.type));
    for (const t of ["solid", "marker", "sensor"]) expect(types.has(t), t).toBe(true);
    const start = scene.entities?.find((e) => e.id === "start");
    expect(start).toMatchObject({ behaviors: { occupant: {} } });
  });

  it("validates, structural and physical, with no issue and without loading Rapier", async () => {
    const { ctx, loadRapier } = noRapier();
    const result = await validate({ target: "grid-yard", physical: true }, ctx);
    expect(result.exitCode, result.text).toBe(0);
    expect((result.data as { issues: unknown[] }).issues).toEqual([]);
    expect(loadRapier).not.toHaveBeenCalled();
  });

  it("asks for Rapier where a physical scene does, so the spy above can see a load", async () => {
    const loadRapier = vi.fn(loadCompatRapier);
    await validate({ target: "kitchen-sink", physical: true }, { projects: PROJECTS, loadRapier });
    expect(loadRapier).toHaveBeenCalled();
  });

  it("passes every check headless, a connected check among them, without loading Rapier", async () => {
    const { ctx, loadRapier } = noRapier();
    const result = await check({ scene: "grid-yard" }, ctx);
    expect(result.exitCode, result.text).toBe(0);
    const results = (
      result.data as { results: { id: string; kind: string; pass: boolean; skipped?: string }[] }
    ).results;
    expect(results.map((r) => r.kind)).toContain("connected");
    for (const r of results) {
      expect(r.skipped, r.id).toBeUndefined();
      expect(r.pass, r.id).toBe(true);
    }
    expect(loadRapier).not.toHaveBeenCalled();
  });
});

describe("kitchen-sink, the engine's feature scene", () => {
  it("passes its checks through the CLI, a lifetime entity gone by the time its expect is judged", async () => {
    const result = await check(
      { scene: "kitchen-sink" },
      { projects: PROJECTS, loadRapier: loadCompatRapier },
    );
    expect(result.exitCode, result.text).toBe(0);
    const results = (
      result.data as { results: { id: string; pass: boolean; skipped?: string; message: string }[] }
    ).results;
    const fades = results.find((r) => r.id === "fades");
    expect(fades?.pass, fades?.message).toBe(true);
    expect(fades?.message).toContain("expect holds (count, exists)");
    for (const r of results.filter((r) => r.skipped === undefined)) expect(r.pass, r.id).toBe(true);
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
