import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { formatScene } from "../../scene/format";
import { sceneHash } from "../../scene/hash";
import { parseSceneOrThrow } from "../../scene/parse";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import { sceneNameOf } from "../../vite/scene-paths";
import { docLayout, docPrefabs, docToScene, sceneToDoc } from "../convert";
import { COLLAB_LAYOUT_VERSION } from "../types";

const dir = (rel: string) => new URL(rel, import.meta.url);
const jsonIn = (rel: string) =>
  readdirSync(dir(rel))
    .filter((f) => sceneNameOf(f) !== null)
    .map((f) => [`${rel}${f}`, readFileSync(dir(`${rel}${f}`), "utf8")] as const)
    .filter(([, text]) => !("kind" in (JSON.parse(text) as object)));

const CURRENT = `../../scene/__tests__/fixtures/v${SCENE_FORMAT_VERSION}/`;

/**
 * Every scene file and current-version frozen fixture the engine owns (other
 * project files name their kind); the platformer checks its own. An older
 * doc is lifted by `migrateDoc` before it is read as a file.
 */
const FILES = [...jsonIn("../../scenes/"), ...jsonIn(CURRENT)];

describe(`file → doc → file, on layout ${COLLAB_LAYOUT_VERSION}`, () => {
  it("covers the engine yard, the frozen fixtures and both current sinks", () => {
    const names = FILES.map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        "../../scenes/engine-yard.json",
        "../../scenes/kitchen-sink.json",
        `${CURRENT}kitchen-sink.json`,
        `${CURRENT}test-game-sink.json`,
      ]),
    );
  });

  it("the kitchen sink it round-trips carries a sprite and a decor", () => {
    const text = FILES.find(([name]) => name === "../../scenes/kitchen-sink.json")![1];
    const entities = (JSON.parse(text) as SceneDefinition).entities ?? [];
    const sprites = entities.filter(
      (e) => (e.behaviors as Record<string, unknown> | undefined)?.sprite !== undefined,
    );
    expect(sprites.length).toBeGreaterThan(0);
    expect(sprites.some((e) => e.type === "decor")).toBe(true);
    expect(sprites.some((e) => e.type !== "decor")).toBe(true);
  });

  it("reads the sinks as the current format", () => {
    for (const name of ["kitchen-sink", "test-game-sink"]) {
      const def = JSON.parse(
        readFileSync(dir(`${CURRENT}${name}.json`), "utf8"),
      ) as SceneDefinition;
      expect(def.v).toBe(SCENE_FORMAT_VERSION);
    }
  });

  for (const [name, text] of FILES) {
    it(`is byte-identical for ${name}, also after the doc crosses the wire`, () => {
      const doc = sceneToDoc(JSON.parse(text) as SceneDefinition);
      expect(docLayout(doc)).toBe(COLLAB_LAYOUT_VERSION);
      expect(formatScene(docToScene(doc)).text).toBe(text);
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      expect(formatScene(docToScene(remote)).text).toBe(text);
      expect([docLayout(remote), docPrefabs(remote).size]).toEqual([COLLAB_LAYOUT_VERSION, 0]);
    });
  }

  it("reads empty nested maps as absent in the file, the doc and the hash alike", () => {
    const parseable: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      game: "test-game",
      name: "empties",
      bounds: [0, 0, 640, 480],
      settings: {},
      instances: [{ id: "room-1", prefab: "room", at: [64, 64], params: {}, overrides: {} }],
      entities: [
        { id: "lamp", type: "lamp", at: [10, 10], behaviors: {} },
        { id: "lit", type: "lamp", at: [20, 20], behaviors: { "test-game/glow": {} } },
      ],
    };
    const lift = { id: "lift", type: "follower", shape: ["box", 0, 0, 40, 6] } as const;
    // A path is required wherever it is a field, so an empty one never parses; it can still reach the doc from an edit.
    const written: SceneDefinition = {
      ...parseable,
      entities: [...parseable.entities!, { ...lift, path: {} }],
    };
    const registry = createRegistry(testGame);
    const parsed = parseSceneOrThrow(JSON.stringify(parseable, null, 2), registry);
    const text = formatScene({ ...parsed, entities: [...parsed.entities!, lift] }).text;
    expect(text).not.toMatch(/"(settings|behaviors|path|params|overrides)": \{\}/);
    expect(parsed.settings).toBeUndefined();
    expect(text).toContain('"behaviors": { "test-game/glow": {} }');
    expect(formatScene(written).text).toBe(text);
    const expected = JSON.parse(text) as SceneDefinition;
    for (const def of [expected, written]) {
      const doc = sceneToDoc(def);
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      for (const d of [doc, remote]) {
        expect(formatScene(docToScene(d)).text).toBe(text);
        expect(sceneHash(docToScene(d))).toBe(sceneHash(expected));
      }
    }
    expect(sceneHash(written)).toBe(sceneHash(expected));
    expect(sceneHash(parseable)).toBe(sceneHash(parsed));
    expect(docToScene(sceneToDoc(parsed))).toEqual(parsed);
  });
});
