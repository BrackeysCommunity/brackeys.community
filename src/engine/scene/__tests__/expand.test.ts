import { describe, expect, it } from "vite-plus/test";

import { bulkId, bulkKeyType, expandScene, parseBulkId } from "../expand";
import { parseSceneOrThrow } from "../parse";
import type { PathDef, Pt, SceneDefinition } from "../types";
import { engine, engineYardText, fake } from "./fixtures/fake-game";

const yard = parseSceneOrThrow(engineYardText, engine);

describe("expandScene", () => {
  it("expands engine-yard in spawn-group order with bulk ids", () => {
    const scene = expandScene(yard, engine);
    expect(scene.name).toBe("engine-yard");
    expect(scene).not.toHaveProperty("game");
    expect(scene.bounds).toEqual([0, 0, 2000, 1000]);
    expect(scene.settings).toEqual({ gravity: [0, 1200] });
    expect(scene.entities.map((e) => e.id)).toEqual([
      "~solid:0",
      "~solid:1",
      "~solid:2",
      "ledge",
      "zone",
      "start",
      "avatar",
      "crate",
      "lift",
    ]);
    const byId = Object.fromEntries(scene.entities.map((e) => [e.id, e]));
    expect(byId["~solid:0"]).toEqual({
      id: "~solid:0",
      type: "solid",
      shape: { type: "box", cx: 1000, cy: 980, hw: 1000, hh: 20, rotDeg: 0 },
    });
    expect(byId.ledge).toEqual({
      id: "ledge",
      type: "solid",
      shape: { type: "box", cx: 1400, cy: 800, hw: 120, hh: 10, rotDeg: 0 },
      oneWay: true,
    });
    expect(byId.crate).toEqual({
      id: "crate",
      type: "prop",
      shape: { type: "circle", cx: 1200, cy: 940, r: 20 },
      density: 2,
      restitution: 0.3,
    });
    expect(byId.lift).toEqual({
      id: "lift",
      type: "follower",
      shape: { type: "box", cx: 0, cy: 0, hw: 60, hh: 8, rotDeg: 0 },
      path: {
        pts: [
          [1700, 900],
          [1700, 600],
        ],
        mode: "ping_pong",
        speed: 80,
        pauseMs: 400,
      },
    });
    expect(byId.start).toEqual({ id: "start", type: "marker", at: [300, 960], tags: ["spawn"] });
    expect(byId.zone).toMatchObject({ tags: ["goal"] });
  });

  it("defaults gravity and keeps a game's settings", () => {
    const bare: SceneDefinition = { v: 1, name: "x", bounds: [0, 0, 10, 10] };
    expect(expandScene(bare, engine).settings).toEqual({ gravity: [0, 1200] });
    const def: SceneDefinition = { ...bare, game: "fake", settings: { lives: 3 } };
    expect(expandScene(def, fake)).toMatchObject({
      game: "fake",
      settings: { gravity: [0, 1200], lives: 3 },
    });
  });

  it("does not alias the definition", () => {
    const before = structuredClone(yard);
    const byId = Object.fromEntries(expandScene(yard, engine).entities.map((e) => [e.id, e]));
    (byId.lift!.path as PathDef).pts[0]![0] = 0;
    (byId.start!.at as Pt)[0] = 0;
    expect(yard).toEqual(before);
  });

  it("puts bulk before entities within a group and drops off, notes and editor fields", () => {
    const def: SceneDefinition = {
      v: 1,
      game: "fake",
      name: "x",
      bounds: [0, 0, 100, 100],
      "pad:mud": [["box", 9, 9, 1, 1]],
      pad: [["box", 8, 8, 1, 1]],
      solid: [["box", 0, 0, 1, 1]],
      flag: [[5, 5]],
      entities: [
        { id: "door", type: "door", shape: ["box", 3, 3, 1, 1], speed: 4 },
        {
          id: "late",
          type: "solid",
          name: "Late",
          layer: "terrain",
          group: "g",
          shape: ["box", 1, 1, 1, 1],
        },
        { id: "gone", type: "solid", off: true, shape: ["box", 2, 2, 1, 1] },
        { id: "memo", type: "note", at: [0, 0], text: "hi" },
        { id: "f", type: "flag", at: [6, 6] },
      ],
    };
    const scene = expandScene(def, fake);
    expect(scene.entities.map((e) => e.id)).toEqual([
      "~solid:0",
      "late",
      "~pad:0",
      "~pad:mud:0",
      "~flag:0",
      "f",
      "door",
    ]);
    expect(scene.entities[1]).toEqual({
      id: "late",
      type: "solid",
      shape: { type: "box", cx: 1, cy: 1, hw: 1, hh: 1, rotDeg: 0 },
    });
    expect(scene.entities[3]).toMatchObject({ type: "pad", material: "mud" });
    expect(scene.entities[4]).toEqual({ id: "~flag:0", type: "flag", at: [5, 5] });
  });

  it("refuses another game's scene and unregistered types", () => {
    expect(() => expandScene({ ...yard, game: "fake" }, engine)).toThrow(/for game "fake"/);
    const def: SceneDefinition = {
      ...yard,
      entities: [{ id: "x", type: "cloud", shape: ["box", 0, 0, 1, 1] }],
    };
    expect(() => expandScene(def, engine)).toThrow(/unregistered type "cloud"/);
  });
});

describe("bulk ids", () => {
  it("round-trips every registered bulk key", () => {
    for (const { key } of fake.bulkKeys)
      expect(parseBulkId(bulkId(key, 3))).toEqual({ key, index: 3 });
    expect(bulkId("solid:ice", 3)).toBe("~solid:ice:3");
    expect(parseBulkId("~solid:ice:3")).toEqual({ key: "solid:ice", index: 3 });
    expect(parseBulkId("~mud:0")).toEqual({ key: "mud", index: 0 });
  });

  it("rejects ids and malformed refs", () => {
    for (const ref of [
      "solid:0",
      "~solid",
      "~solid:",
      "~solid:01",
      "~solid:-1",
      "~solid:x",
      "~Solid:0",
      "~a:b:c:0",
      "~:0",
      "pit-shuttle",
    ]) {
      expect(parseBulkId(ref), ref).toBeNull();
    }
  });

  it("reads a bulk key's type without a registry", () => {
    expect(bulkKeyType("solid")).toBe("solid");
    expect(bulkKeyType("solid:ice")).toBe("solid");
    for (const b of fake.bulkKeys) expect(bulkKeyType(b.key)).toBe(b.type);
  });
});
