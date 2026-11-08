import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { formatScene } from "../../scene/format";
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

const V3 = "../../scene/__tests__/fixtures/v3/";

/** Every scene file and frozen fixture the engine owns (other project files name their kind); the platformer checks its own. */
const FILES = [
  ...jsonIn("../../scenes/"),
  ...jsonIn("../../scene/__tests__/fixtures/v1/"),
  ...jsonIn(V3),
];

describe(`file → doc → file, on layout ${COLLAB_LAYOUT_VERSION}`, () => {
  it("covers the engine yard, the frozen fixtures and both v3 sinks", () => {
    const names = FILES.map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        "../../scenes/engine-yard.json",
        "../../scenes/kitchen-sink.json",
        `${V3}kitchen-sink.json`,
        `${V3}test-game-sink.json`,
      ]),
    );
  });

  it("reads the v3 sinks as the current format", () => {
    for (const name of ["kitchen-sink", "test-game-sink"]) {
      const def = JSON.parse(readFileSync(dir(`${V3}${name}.json`), "utf8")) as SceneDefinition;
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
});
