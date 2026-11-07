import { readFileSync } from "node:fs";

import { docToScene, sceneToDoc } from "@jams/engine/collab";
import { formatScene, type SceneDefinition } from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

const FILES = [
  ["scenes/test-yard.json", "../scenes/test-yard.json"],
  ["frozen v1/test-yard.json", "./fixtures/v1/test-yard.json"],
] as const;

describe("platformer scenes through the shared doc", () => {
  for (const [name, rel] of FILES) {
    it(`round-trip ${name} byte for byte`, () => {
      const text = readFileSync(new URL(rel, import.meta.url), "utf8");
      const doc = sceneToDoc(JSON.parse(text) as SceneDefinition);
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      expect(formatScene(docToScene(remote)).text).toBe(text);
    });
  }
});
