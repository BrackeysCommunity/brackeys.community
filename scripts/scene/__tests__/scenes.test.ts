// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
import { sceneNameOf } from "@jams/engine/vite";
import { describe, expect, it } from "vite-plus/test";

import { registryOf, type ToolContext } from "../context";
import { GAMES, gameSchemaFiles, gameScenesDirs } from "../games";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIRS = gameScenesDirs(GAMES);
const SCHEMAS = gameSchemaFiles(GAMES);
const ctx = { games: GAMES, scenesDirs: DIRS } as ToolContext;

/** The string literals in root `vite.config.ts`'s `fmt.ignorePatterns`. */
function fmtIgnorePatterns(): string[] {
  const config = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
  const fmt = config.slice(config.indexOf("fmt: {"));
  const list = fmt.slice(fmt.indexOf("ignorePatterns: ["));
  const block = list.slice(0, list.indexOf("]"));
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe("scene homes", () => {
  for (const [home, dir] of Object.entries(DIRS)) {
    const registry = registryOf(ctx, home === "engine" ? undefined : home)!;

    it(`${home}: the scenes directory is left to formatScene, not oxfmt`, () => {
      const probe = relative(ROOT, join(dir, "x.json"));
      expect(
        fmtIgnorePatterns().some((p) => matchesGlob(probe, p)),
        probe,
      ).toBe(true);
    });

    it(`${home}: each scene's $schema resolves to the home's schema, and is canonical`, () => {
      const schemaFile = SCHEMAS[home]!;
      const schema = JSON.parse(readFileSync(schemaFile, "utf8")) as { $id: string };
      expect(schema.$id).toBe(registry.schemaId);
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => sceneNameOf(f) !== null) : [];
      for (const file of files) {
        const text = readFileSync(join(dir, file), "utf8");
        const def = parseSceneOrThrow(text, registry);
        expect(def.$schema, file).toBeDefined();
        expect(resolve(dirname(join(dir, file)), def.$schema!), file).toBe(schemaFile);
        expect(formatScene(def).text, `${file} is not canonical`).toBe(text);
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
  for (const id of Object.keys(GAMES)) {
    const registry = createRegistry(GAMES[id]!);
    it(`${id}: every property is described and every entity field titled`, () => {
      expect(undescribedProperties(sceneJsonSchema(registry))).toEqual([]);
      expect(undescribedProperties(opsJsonSchema(registry))).toEqual([]);
      expect(untitledEntityFields(sceneJsonSchema(registry))).toEqual([]);
    });
  }
});
