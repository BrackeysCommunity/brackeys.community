import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

import { expect, it } from "vite-plus/test";

import type { Registry } from "../../../game/types";
import { formatScene } from "../../format";
import { MIGRATIONS } from "../../migrate";
import { parseScene } from "../../parse";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../types";

export interface MigrationHarnessOptions {
  /** The folder holding `v<n>/` subfolders of frozen scenes. */
  fixtures: URL;
  /** The registry a fixture's text parses against. */
  registryOf: (text: string) => Registry;
  /**
   * Current-version fixtures with no older source, written from these
   * definitions and checked against them.
   */
  sinks?: Record<string, SceneDefinition>;
  /**
   * Requires a fixture starting at every `MIGRATIONS` step. The engine's own
   * fixtures carry this; a game's set may start at only some steps.
   */
  everyStep?: boolean;
}

/** Every file under `<fixtures>/<folder>/`, as a path relative to it. */
function filesIn(fixtures: URL, folder: string, dir = ""): string[] {
  const root = new URL(`${folder}/${dir}`, fixtures);
  return readdirSync(root)
    .flatMap((f) =>
      statSync(new URL(f, root)).isDirectory()
        ? filesIn(fixtures, folder, `${dir}${f}/`)
        : [`${dir}${f}`],
    )
    .sort();
}

/**
 * Registers the migration harness's tests, inside the caller's `describe`:
 * every file under `v<n>/**` older than the current version parses with
 * `migratedFrom === n` and formats to the frozen `v<current>/<name>`; every
 * current-version file reads as current and round-trips byte for byte.
 *
 * `UPDATE_FIXTURES=1` writes a missing current-version fixture once. It never
 * rewrites one that exists: a frozen fixture is read-only.
 */
export function migrationHarness({
  fixtures,
  registryOf,
  sinks = {},
  everyStep = false,
}: MigrationHarnessOptions): void {
  const current = `v${SCENE_FORMAT_VERSION}`;
  const update = process.env.UPDATE_FIXTURES === "1";
  const read = (file: string) => readFileSync(new URL(file, fixtures), "utf8");
  const writeOnce = (name: string, text: string) => {
    const url = new URL(`${current}/${name}`, fixtures);
    if (update && !existsSync(url)) writeFileSync(url, text);
  };

  const sources = readdirSync(fixtures)
    .filter((f) => /^v\d+$/.test(f))
    .map((f) => Number(f.slice(1)))
    .filter((n) => n < SCENE_FORMAT_VERSION)
    .sort((a, b) => a - b)
    .flatMap((n) => filesIn(fixtures, `v${n}`).map((name) => ({ n, name })));

  it("has an older-version fixture", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  if (everyStep)
    it("has a fixture starting at every migration step", () => {
      const steps = Object.keys(MIGRATIONS).map(Number);
      expect(steps).toEqual(Array.from({ length: SCENE_FORMAT_VERSION - 1 }, (_, i) => i + 1));
      for (const step of steps)
        expect(
          sources.some((s) => s.n === step),
          `no v${step}/ fixture`,
        ).toBe(true);
    });

  it("names each source once across the older versions", () => {
    const names = sources.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const { n, name } of sources) {
    it(`v${n}/${name} migrates to the frozen ${current}/${name}`, () => {
      const text = read(`v${n}/${name}`);
      const parsed = parseScene(text, registryOf(text));
      expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.migratedFrom).toBe(n);
      expect(parsed.def.v).toBe(SCENE_FORMAT_VERSION);
      const out = formatScene(parsed.def).text;
      writeOnce(name, out);
      expect(
        existsSync(new URL(`${current}/${name}`, fixtures)),
        "run with UPDATE_FIXTURES=1",
      ).toBe(true);
      expect(out).toBe(read(`${current}/${name}`));
    });
  }

  for (const [name, def] of Object.entries(sinks)) {
    it(`${current}/${name} is written from its definition`, () => {
      expect(sources.some((s) => s.name === name)).toBe(false);
      writeOnce(name, formatScene(def).text);
      const text = read(`${current}/${name}`);
      const parsed = parseScene(text, registryOf(text));
      expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
      if (parsed.ok) expect(parsed.def).toEqual(def);
    });
  }

  it("reads every current-version fixture as current and round-trips it byte for byte", () => {
    const names = filesIn(fixtures, current);
    expect(names).toEqual(
      [...new Set([...sources.map((s) => s.name), ...Object.keys(sinks)])].sort(),
    );
    for (const name of names) {
      const text = read(`${current}/${name}`);
      const parsed = parseScene(text, registryOf(text));
      expect(parsed.ok, `${name}: ${JSON.stringify(parsed.issues)}`).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.migratedFrom, name).toBeUndefined();
      expect(formatScene(parsed.def).text, name).toBe(text);
    }
  });
}
