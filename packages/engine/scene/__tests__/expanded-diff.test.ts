// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { diffExpanded } from "../expanded-diff";
import type { ExpandedScene, RuntimeEntity } from "../types";

const entity = (id: string, x = 0): RuntimeEntity => ({ id, type: "marker", at: [x, 0] });

function scene(entities: RuntimeEntity[], patch: Partial<ExpandedScene> = {}): ExpandedScene {
  return {
    name: "yard",
    bounds: [0, 0, 100, 100],
    settings: {
      gravity: [0, 9.8],
      physics: "none",
      grid: null,
      view: { projection: "orthogonal" },
    },
    entities,
    ...patch,
  };
}

describe("diffExpanded", () => {
  it("lists added, removed and changed ids", () => {
    const prev = scene([entity("a"), entity("b"), entity("c")]);
    const next = scene([entity("a"), entity("b", 5), entity("d")]);
    expect(diffExpanded(prev, next)).toEqual({
      added: ["d"],
      removed: ["c"],
      changed: ["b"],
      header: false,
    });
  });

  it("is empty for equal scenes, key order aside", () => {
    const reordered = { at: [0, 0], type: "marker", id: "a" } as RuntimeEntity;
    expect(diffExpanded(scene([entity("a")]), scene([reordered]))).toEqual({
      added: [],
      removed: [],
      changed: [],
      header: false,
    });
  });

  it("follows next's order for added and changed and prev's for removed", () => {
    const prev = scene([entity("r2"), entity("c1"), entity("r1"), entity("c2")]);
    const next = scene([entity("c2", 1), entity("n2"), entity("c1", 1), entity("n1")]);
    const diff = diffExpanded(prev, next);
    expect(diff.added).toEqual(["n2", "n1"]);
    expect(diff.changed).toEqual(["c2", "c1"]);
    expect(diff.removed).toEqual(["r2", "r1"]);
  });

  it("sets header when the name differs", () => {
    const diff = diffExpanded(scene([entity("a")]), scene([entity("a")], { name: "other" }));
    expect(diff).toEqual({ added: [], removed: [], changed: [], header: true });
  });

  it("sets header when the bounds differ", () => {
    const diff = diffExpanded(scene([]), scene([], { bounds: [0, 0, 200, 100] }));
    expect(diff.header).toBe(true);
  });

  it("sets header when a setting differs", () => {
    const base = scene([]);
    const next = scene([], { settings: { ...base.settings, gravity: [0, 20] } });
    expect(diffExpanded(base, next).header).toBe(true);
  });

  it("keeps the entity diff alongside a header change", () => {
    const diff = diffExpanded(scene([entity("a")]), scene([entity("b")], { name: "other" }));
    expect(diff).toEqual({ added: ["b"], removed: ["a"], changed: [], header: true });
  });

  it("ignores the settings' key order", () => {
    const base = scene([]);
    const { gravity, physics, grid, view } = base.settings;
    const next = scene([], { settings: { view, grid, physics, gravity } });
    expect(diffExpanded(base, next).header).toBe(false);
  });
});
