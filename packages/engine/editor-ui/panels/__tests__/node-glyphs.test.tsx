// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { testGame } from "../../../__tests__/fixtures/test-game";
import { sceneToDoc, sequentialKeys } from "../../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../../editor/index";
import { createRegistry, defineEntityType, defineGame } from "../../../game/define";
import { pointField } from "../../../game/fields";
import type { GameStoreState } from "../../../index";
import { SCENE_FORMAT_VERSION } from "../../../scene/index";
import { EditorCanvasOverlay } from "../EditorCanvasOverlay";

const PIVOT = defineEntityType({
  type: "pivot",
  description: "A hub based on the node primitive.",
  base: "node",
  fields: { at: pointField("Its origin.") },
  style: { stroke: 0xff0000 },
});
const game = defineGame({ ...testGame, types: [...testGame.types, PIVOT] });

const scene = (): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "glyphs",
  bounds: [0, 0, 20, 20],
  entities: [
    { id: "Pivot", type: "node", at: [2, 3], rot: 30 },
    { id: "pivot-mark", type: "marker", parent: "Pivot", at: [1, 0] },
    { id: "mirror", type: "node", at: [4, 4], flip: true },
    { id: "hinge", type: "pivot", at: [6, 6] },
  ],
});

const sessions: { destroy(): void }[] = [];
afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
});

function draw(registry = createRegistry(game)) {
  const session = createEditorSession({
    doc: sceneToDoc(scene(), { key: sequentialKeys("g") }),
    origin: { kind: "user", userId: "ada", name: "Ada" },
    name: "glyphs",
    registry,
    issuesDebounceMs: 0,
  });
  sessions.push(session);
  const store = new Store({ camera: { position: { x: 0, y: 0 }, scale: 50 } } as GameStoreState);
  render(<EditorCanvasOverlay session={session} store={store} />);
}

const glyph = (id: string) => document.querySelector<SVGGElement>(`[data-node="${id}"]`);

describe("node glyphs on the canvas", () => {
  it("draw each node's axis at its angle, mirrored by its flip, and nothing for other types", () => {
    draw();
    expect(glyph("Pivot")?.getAttribute("transform")).toMatch(/ rotate\(30\)$/);
    expect(glyph("mirror")?.getAttribute("transform")).toMatch(/ rotate\(0\) scale\(-1 1\)$/);
    expect(glyph("pivot-mark")).toBeNull();
  });

  it("draw types based on node too, in their own colour", () => {
    draw();
    expect(glyph("hinge")?.getAttribute("style")).toContain("--je-ov-tone: #ff0000");
  });

  it("sit at the node's origin on screen", () => {
    draw();
    const at = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(
      glyph("Pivot")?.getAttribute("transform") ?? "",
    );
    const width = window.innerWidth;
    const height = window.innerHeight;
    expect(Number(at?.[1])).toBeCloseTo(width / 2 + 2 * 50);
    expect(Number(at?.[2])).toBeCloseTo(height / 2 + 3 * 50);
  });
});
