import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { formatScene } from "../../scene/format";
import type { SceneDefinition } from "../../scene/types";
import { sceneNameOf } from "../../vite/scene-paths";
import { docLayout, docPrefabs, docToScene, sceneToDoc } from "../convert";

const dir = (rel: string) => new URL(rel, import.meta.url);
const jsonIn = (rel: string) =>
  readdirSync(dir(rel))
    .filter((f) => sceneNameOf(f) !== null)
    .map((f) => [`${rel}${f}`, readFileSync(dir(`${rel}${f}`), "utf8")] as const)
    .filter(([, text]) => !("kind" in (JSON.parse(text) as object)));

/** Every scene file and frozen fixture the engine owns (other project files name their kind); the platformer checks its own. */
const FILES = [...jsonIn("../../scenes/"), ...jsonIn("../../scene/__tests__/fixtures/v1/")];

describe("file → doc → file, on layout 2", () => {
  it("covers at least the engine yard and its frozen fixture", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(2);
  });
  for (const [name, text] of FILES) {
    it(`is byte-identical for ${name}, also after the doc crosses the wire`, () => {
      const doc = sceneToDoc(JSON.parse(text) as SceneDefinition);
      expect(docLayout(doc)).toBe(2);
      expect(formatScene(docToScene(doc)).text).toBe(text);
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      expect(formatScene(docToScene(remote)).text).toBe(text);
      expect([docLayout(remote), docPrefabs(remote).size]).toEqual([2, 0]);
    });
  }
});
