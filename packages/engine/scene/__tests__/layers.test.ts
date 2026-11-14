import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import {
  DEFAULT_LAYERS,
  defaultLayer,
  editorGlyphLayer,
  editorLayerOf,
  type SceneLayerDef,
} from "../layers";

const registry = createRegistry();
const note = registry.types.get("note");
const solid = registry.types.get("solid");

const layer = (name: string, draw: number): SceneLayerDef => ({ name, description: "", draw });

describe("DEFAULT_LAYERS", () => {
  it("lists the four engine layers bottom to top, editor-only last", () => {
    expect(DEFAULT_LAYERS.map((l) => l.name)).toEqual(["terrain", "decor", "gameplay", "editor"]);
    expect(DEFAULT_LAYERS.map((l) => l.draw)).toEqual([0, 5, 10, 60]);
    expect(DEFAULT_LAYERS.filter((l) => l.editorOnly).map((l) => l.name)).toEqual(["editor"]);
    expect(Object.isFrozen(DEFAULT_LAYERS)).toBe(true);
  });
});

describe("defaultLayer", () => {
  it("puts notes on editor, bulk entries on terrain and other entities on gameplay", () => {
    expect(defaultLayer(note, false)).toBe("editor");
    expect(defaultLayer(note, true)).toBe("editor");
    expect(defaultLayer(solid, true)).toBe("terrain");
    expect(defaultLayer(solid, false)).toBe("gameplay");
    expect(defaultLayer(undefined, false)).toBe("gameplay");
  });

  it("matches the two-argument answer when given DEFAULT_LAYERS", () => {
    for (const [type, bulk] of [
      [note, false],
      [solid, true],
      [solid, false],
    ] as const) {
      expect(defaultLayer(type, bulk, DEFAULT_LAYERS)).toBe(defaultLayer(type, bulk));
    }
  });

  it("keeps a game's layers that carry the default names", () => {
    const layers = [
      layer("sky", -10),
      layer("terrain", 0),
      layer("gameplay", 10),
      layer("editor", 60),
    ];
    expect(defaultLayer(solid, true, layers)).toBe("terrain");
    expect(defaultLayer(solid, false, layers)).toBe("gameplay");
    expect(defaultLayer(note, false, layers)).toBe("editor");
  });

  it("falls back to the first layer, and editor-only types to the last", () => {
    const layers = [layer("back", 0), layer("middle", 5), layer("front", 10)];
    expect(defaultLayer(solid, true, layers)).toBe("back");
    expect(defaultLayer(solid, false, layers)).toBe("back");
    expect(defaultLayer(undefined, false, layers)).toBe("back");
    expect(defaultLayer(note, false, layers)).toBe("front");
  });

  it("falls back per name: a missing terrain doesn't move gameplay", () => {
    const layers = [layer("floor", 0), layer("gameplay", 10)];
    expect(defaultLayer(solid, true, layers)).toBe("floor");
    expect(defaultLayer(solid, false, layers)).toBe("gameplay");
    expect(defaultLayer(note, false, layers)).toBe("gameplay");
  });
});

describe("editorLayerOf", () => {
  it("gives the editor-only layer's draw order, or undefined without one", () => {
    expect(editorLayerOf(DEFAULT_LAYERS)).toBe(60);
    expect(editorLayerOf([layer("back", 0), { ...layer("notes", 40), editorOnly: true }])).toBe(40);
    expect(editorLayerOf([layer("back", 0), layer("front", 10)])).toBeUndefined();
    expect(editorLayerOf([])).toBeUndefined();
  });
});

describe("editorGlyphLayer", () => {
  it("draws on the editor-only layer only for a view that can order visuals", () => {
    const depth = () => {};
    expect(editorGlyphLayer({ depth }, DEFAULT_LAYERS)).toBe(60);
    expect(editorGlyphLayer({}, DEFAULT_LAYERS)).toBeUndefined();
    expect(editorGlyphLayer(null, DEFAULT_LAYERS)).toBeUndefined();
    expect(editorGlyphLayer({ depth }, [layer("back", 0)])).toBeUndefined();
  });
});
