// @vitest-environment node
import { describe } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import type { Registry } from "../../game/types";
import type { SceneDefinition } from "../types";
import { engine } from "./fixtures/fake-game";
import { migrationHarness } from "./fixtures/migration-harness";

const registries: Record<string, Registry> = { "test-game": createRegistry(testGame) };
const registryOf = (text: string): Registry => {
  const game = (JSON.parse(text) as { game?: unknown }).game;
  return typeof game === "string" ? (registries[game] ?? engine) : engine;
};

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
  migrationHarness({
    fixtures: new URL("./fixtures/", import.meta.url),
    registryOf,
    sinks: SINKS,
    everyStep: true,
  });
});
