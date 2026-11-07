import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { bulkId, expandScene, parseBulkId } from "../expand";
import { parseSceneOrThrow } from "../parse";
import { BULK_KEYS, SPAWN_ORDER, type SceneDefinition } from "../types";

const yard = parseSceneOrThrow(
  readFileSync(new URL("../../scenes/test-yard.json", import.meta.url), "utf8"),
);

describe("expandScene", () => {
  it("expands test-yard in spawn order with bulk ids", () => {
    const scene = expandScene(yard);
    expect(scene.name).toBe("test-yard");
    expect(scene.bounds).toEqual([-2000, -500, 4000, 1200]);
    expect(scene.spawn).toEqual([[960, 1020]]);
    const ranks = scene.entities.map((e) => SPAWN_ORDER.indexOf(e.b));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    const ids = scene.entities.map((e) => e.id);
    expect(ids.slice(0, 2)).toEqual(["~solid:0", "~solid:1"]);
    expect(ids).toContain("~solid:ice:0");
    expect(ids.indexOf("~solid:ice:0")).toBe(14);
    expect(ids.slice(ids.indexOf("~cloud:0"), ids.indexOf("~cloud:0") + 3)).toEqual([
      "~cloud:0",
      "~cloud:1",
      "~cloud:2",
    ]);
    expect(ids.filter((id) => id.startsWith("~anchor"))).toEqual([
      "~anchor:0",
      "~anchor:1",
      "~anchor:2",
      "~anchor:3",
    ]);
    expect(ids.slice(-4)).toEqual(["~anchor:0", "~anchor:1", "~anchor:2", "~anchor:3"]);
    expect(scene.entities.length).toBe(14 + 3 + 3 + 4 + 3 + 2 + 3);
    expect(scene.entities.find((e) => e.id === "~solid:ice:0")).toEqual({
      id: "~solid:ice:0",
      b: "solid",
      material: "ice",
      shape: { type: "box", cx: 100, cy: 1000, hw: 100, hh: 8, rotDeg: 0 },
    });
    expect(scene.entities.find((e) => e.id === "~solid:0")).not.toHaveProperty("material");
    expect(scene.entities.find((e) => e.id === "elevator")).toEqual({
      id: "elevator",
      b: "mover",
      shape: { type: "box", cx: 0, cy: 0, hw: 40, hh: 6, rotDeg: 0 },
      path: {
        pts: [
          [1300, 1000],
          [1300, 700],
        ],
        mode: "ping_pong",
        speed: 100,
        pauseMs: 800,
      },
    });
  });

  it("puts bulk before entities within a behavior and drops off, notes and editor fields", () => {
    const def: SceneDefinition = {
      v: 1,
      name: "x",
      bounds: [0, 0, 100, 100],
      spawn: [[1, 1]],
      solid: [["box", 0, 0, 1, 1]],
      anchor: [[5, 5]],
      entities: [
        {
          id: "late",
          b: "solid",
          name: "Late",
          layer: "terrain",
          group: "g",
          shape: ["box", 1, 1, 1, 1],
        },
        { id: "gone", b: "solid", off: true, shape: ["box", 2, 2, 1, 1] },
        { id: "memo", b: "note", at: [0, 0], text: "hi" },
        { id: "a", b: "anchor", at: [6, 6] },
        { id: "w", b: "construct", type: "wind_zone", at: [3, 3] },
      ],
    };
    const scene = expandScene(def);
    expect(scene.entities.map((e) => e.id)).toEqual(["~solid:0", "late", "~anchor:0", "a", "w"]);
    expect(scene.entities[1]).toEqual({
      id: "late",
      b: "solid",
      shape: { type: "box", cx: 1, cy: 1, hw: 1, hh: 1, rotDeg: 0 },
    });
    expect(scene.entities[4]).toEqual({
      id: "w",
      b: "construct",
      type: "wind_zone",
      at: [3, 3],
      rot: 0,
    });
  });
});

describe("bulk ids", () => {
  it("round-trips every bulk key", () => {
    for (const key of BULK_KEYS) {
      expect(parseBulkId(bulkId(key, 3))).toEqual({ key, index: 3 });
    }
    expect(bulkId("solid:ice", 3)).toBe("~solid:ice:3");
    expect(parseBulkId("~solid:ice:3")).toEqual({ key: "solid:ice", index: 3 });
  });

  it("rejects ids and malformed refs", () => {
    for (const ref of [
      "solid:0",
      "~solid",
      "~solid:",
      "~solid:01",
      "~solid:-1",
      "~mud:0",
      "~solid:x",
      "pit-shuttle",
    ]) {
      expect(parseBulkId(ref)).toBeNull();
    }
  });
});
