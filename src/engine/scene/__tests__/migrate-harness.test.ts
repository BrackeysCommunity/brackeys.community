// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import type { Registry } from "../../game/types";
import { formatScene } from "../format";
import { MIGRATIONS } from "../migrate";
import { parseScene } from "../parse";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../types";
import { engine } from "./fixtures/fake-game";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const CURRENT = `v${SCENE_FORMAT_VERSION}`;

/**
 * `UPDATE_FIXTURES=1` writes a missing current-version fixture once. It never
 * rewrites one that exists: a frozen fixture is read-only.
 */
const UPDATE = process.env.UPDATE_FIXTURES === "1";

const registries: Record<string, Registry> = { "test-game": createRegistry(testGame) };
const registryOf = (text: string): Registry => {
  const game = (JSON.parse(text) as { game?: unknown }).game;
  return typeof game === "string" ? (registries[game] ?? engine) : engine;
};

/** Every file under `fixtures/<folder>/`, as a path relative to it. */
function filesIn(folder: string, dir = ""): string[] {
  const root = new URL(`${folder}/${dir}`, FIXTURES);
  return readdirSync(root)
    .flatMap((f) =>
      statSync(new URL(f, root)).isDirectory() ? filesIn(folder, `${dir}${f}/`) : [`${dir}${f}`],
    )
    .sort();
}

const versionFolders = readdirSync(FIXTURES)
  .filter((f) => /^v\d+$/.test(f))
  .map((f) => Number(f.slice(1)))
  .sort((a, b) => a - b);
const olderFolders = versionFolders.filter((n) => n < SCENE_FORMAT_VERSION);
const sources = olderFolders.flatMap((n) => filesIn(`v${n}`).map((name) => ({ n, name })));

const read = (file: string) => readFileSync(new URL(file, FIXTURES), "utf8");

/** Writes `text` to a current-version fixture only when there is none yet. */
function writeOnce(name: string, text: string) {
  const url = new URL(`${CURRENT}/${name}`, FIXTURES);
  if (UPDATE && !existsSync(url)) writeFileSync(url, text);
}

/**
 * The current-version sinks: files with no older source, written from these
 * definitions. Together they hold every v3 field that has no v1 or v2 form.
 */
const SINKS: Record<string, SceneDefinition> = {
  "kitchen-sink.json": {
    v: 3,
    name: "kitchen-sink",
    bounds: [0, 0, 4000, 2000],
    settings: {
      gravity: [0, 1200],
      physics: "rapier",
      grid: { kind: "square", cell: [32, 32] },
      view: { projection: "orthogonal" },
    },
    assets: ["boom", "crates"],
    groups: {
      "left-wing": { at: [400, 0], rot: 2, flip: true, name: "Left wing" },
      shelf: { at: [1400, 700], rot: 1 },
    },
    instances: [
      { id: "gate-1", prefab: "gate", at: [800, 900] },
      {
        id: "gate-2",
        prefab: "gate",
        z: 5,
        at: [1600, 900],
        rot: 1,
        flip: true,
        params: { speed: 120 },
      },
      {
        id: "post-1",
        prefab: "post",
        group: "left-wing",
        z: -3,
        at: [100, 900],
        rot: 3,
        overrides: { "bar.oneWay": true },
      },
    ],
    solid: [["box", 2000, 1980, 2000, 20]],
    entities: [
      {
        id: "lever",
        type: "sensor",
        z: 2,
        shape: ["box", 700, 950, 10, 20],
        tags: ["switch"],
      },
      {
        id: "crate",
        type: "prop",
        layer: "gameplay",
        shape: ["box", 1200, 940, 20, 20],
        density: 2,
        restitution: 0.3,
      },
      {
        id: "shelf-mark",
        type: "marker",
        layer: "decor",
        group: "shelf",
        z: -7,
        at: [40, -20],
        tags: ["shelf"],
      },
    ],
  },
  "test-game-sink.json": {
    v: 3,
    game: "test-game",
    name: "test-game-sink",
    bounds: [0, 0, 2000, 1000],
    settings: { grid: { kind: "square", cell: [32, 32] } },
    entities: [
      {
        id: "lamp",
        type: "lamp",
        at: [200, 900],
        behaviors: { "test-game/glow": { color: "#ffcc00", intensity: 2 } },
      },
      {
        id: "spinner",
        type: "lamp",
        z: 1,
        at: [400, 900],
        behaviors: {
          "test-game/glow": { color: "#00ccff", intensity: 3 },
          "test-game/spin": { speed: 45 },
        },
      },
      {
        id: "floor",
        type: "paint",
        layer: "backdrop",
        at: [0, 640],
        cells: { "-1,0": ["0*31,3"], "0,0": ["1*32", "1*32", "0*4,2*24"], "1,0": ["1*8"] },
      },
    ],
  },
};

describe("the migration harness", () => {
  it("has a fixture starting at every migration step", () => {
    const steps = Object.keys(MIGRATIONS).map(Number);
    expect(steps).toEqual(Array.from({ length: SCENE_FORMAT_VERSION - 1 }, (_, i) => i + 1));
    for (const step of steps)
      expect(
        sources.some((s) => s.n === step),
        `no fixtures/v${step}/ fixture`,
      ).toBe(true);
  });

  it("names each source once across the older versions", () => {
    const names = sources.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const { n, name } of sources) {
    it(`v${n}/${name} migrates to the frozen ${CURRENT}/${name}`, () => {
      const text = read(`v${n}/${name}`);
      const parsed = parseScene(text, registryOf(text));
      expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.migratedFrom).toBe(n);
      expect(parsed.def.v).toBe(SCENE_FORMAT_VERSION);
      const out = formatScene(parsed.def).text;
      writeOnce(name, out);
      expect(
        existsSync(new URL(`${CURRENT}/${name}`, FIXTURES)),
        "run with UPDATE_FIXTURES=1",
      ).toBe(true);
      expect(out).toBe(read(`${CURRENT}/${name}`));
    });
  }

  for (const [name, def] of Object.entries(SINKS)) {
    it(`${CURRENT}/${name} is written from its definition`, () => {
      expect(sources.some((s) => s.name === name)).toBe(false);
      writeOnce(name, formatScene(def).text);
      const text = read(`${CURRENT}/${name}`);
      const parsed = parseScene(text, registryOf(text));
      expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
      if (parsed.ok) expect(parsed.def).toEqual(def);
    });
  }

  it("reads every current-version fixture as current and round-trips it byte for byte", () => {
    const current = filesIn(CURRENT);
    expect(current).toEqual(
      [...new Set([...sources.map((s) => s.name), ...Object.keys(SINKS)])].sort(),
    );
    for (const name of current) {
      const text = read(`${CURRENT}/${name}`);
      const parsed = parseScene(text, registryOf(text));
      expect(parsed.ok, `${name}: ${JSON.stringify(parsed.issues)}`).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.migratedFrom, name).toBeUndefined();
      expect(formatScene(parsed.def).text, name).toBe(text);
    }
  });
});
