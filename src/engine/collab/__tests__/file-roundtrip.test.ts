import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { formatScene } from "../../scene/format";
import type { SceneDefinition } from "../../scene/types";
import { docToScene, sceneToDoc } from "../convert";

const dir = (rel: string) => new URL(rel, import.meta.url);
const jsonIn = (rel: string) =>
  readdirSync(dir(rel))
    .filter((f) => f.endsWith(".json") && !f.endsWith(".checks.json"))
    .map((f) => [`${rel}${f}`, readFileSync(dir(`${rel}${f}`), "utf8")] as const);

/** Every scene file and frozen fixture the engine owns; the platformer checks its own. */
const FILES = [...jsonIn("../../scenes/"), ...jsonIn("../../scene/__tests__/fixtures/v1/")];

describe("file → doc → file", () => {
  it("covers at least the engine yard and its frozen fixture", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(2);
  });
  for (const [name, text] of FILES) {
    it(`is byte-identical for ${name}, also after the doc crosses the wire`, () => {
      const doc = sceneToDoc(JSON.parse(text) as SceneDefinition);
      expect(formatScene(docToScene(doc)).text).toBe(text);
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      expect(formatScene(docToScene(remote)).text).toBe(text);
    });
  }
});
