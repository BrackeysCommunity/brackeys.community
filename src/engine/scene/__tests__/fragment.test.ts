import { describe, expect, it } from "vite-plus/test";

import { fragmentBounds, fragmentOf, fragmentSchemaFor, parseFragment } from "../fragment";
import type { SceneDefinition } from "../types";
import { engine, fake } from "./fixtures/fake-game";

const def: SceneDefinition = {
  v: 2,
  game: "fake",
  name: "f",
  bounds: [0, 0, 1000, 1000],
  solid: [
    ["box", 100, 100, 50, 10],
    ["box", 300, 100, 50, 10],
  ],
  flag: [
    [10, 10],
    [20, 20],
  ],
  entities: [
    { id: "door", type: "door", shape: ["box", 500, 500, 10, 40], opens: "btn", speed: 60 },
    { id: "btn", type: "button", shape: ["box", 400, 540, 10, 4] },
    {
      id: "lift",
      type: "follower",
      shape: ["box", 0, 0, 40, 6],
      path: {
        pts: [
          [600, 300],
          [600, 100],
        ],
        mode: "ping_pong",
        speed: 80,
      },
    },
  ],
};

describe("fragmentOf", () => {
  it("takes entities in document order and bulk entries under their key", () => {
    const f = fragmentOf(def, ["btn", "~solid:1", "door", "~flag:0", "nope", "~nope:0"], fake);
    expect(f).toEqual({
      kind: "scene-fragment",
      v: 2,
      game: "fake",
      entities: [def.entities![0], def.entities![1]],
      bulk: { flag: [[10, 10]], solid: [["box", 300, 100, 50, 10]] },
    });
    expect(f.entities[0]).not.toBe(def.entities![0]);
    expect(fragmentSchemaFor(fake).safeParse(f).success).toBe(true);
  });

  it("leaves out empty parts", () => {
    expect(fragmentOf({ ...def, game: undefined }, ["lift"], fake)).toEqual({
      kind: "scene-fragment",
      v: 2,
      entities: [def.entities![2]],
    });
  });
});

describe("fragmentSchemaFor", () => {
  it("checks entities and bulk entries against the registry", () => {
    const schema = fragmentSchemaFor(fake);
    const base = { kind: "scene-fragment", v: 2 };
    expect(schema.safeParse({ ...base, entities: [] }).success).toBe(true);
    expect(schema.safeParse({ ...base, bulk: { pad: [["box", 0, 0, 1, 1]] } }).success).toBe(true);
    expect(schema.safeParse({ ...base, bulk: { pad: [["circle", 0, 0, 1]] } }).success).toBe(false);
    expect(schema.safeParse({ ...base, entities: [{ id: "x", type: "crate" }] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...base, game: "other", entities: [] }).success).toBe(false);
  });
});

describe("parseFragment", () => {
  const text = JSON.stringify(fragmentOf(def, ["door", "btn", "~solid:0"], fake));

  it("round-trips copied text", () => {
    const r = parseFragment(text, fake);
    expect(r).toEqual({ ok: true, fragment: JSON.parse(text), issues: [] });
  });

  it("judges a fragment naming no game by the registry it's pasted into", () => {
    const { game: _, ...gameless } = JSON.parse(text) as Record<string, unknown>;
    const r = parseFragment(gameless, fake);
    expect(r.ok && r.fragment.game).toBe(undefined);
    expect(r.ok && r.fragment.entities.map((e) => e.type)).toEqual(["door", "button"]);
  });

  it("refuses another game's fragment", () => {
    const r = parseFragment(text, engine);
    expect(!r.ok && r.issues.map((i) => i.code)).toEqual(["unknown-game"]);
  });

  it("maps schema problems to scene issues pointing into the fragment", () => {
    const bad = {
      kind: "scene-fragment",
      v: 2,
      entities: [{ id: "door", type: "door", shape: ["box", 0, 0, 1, 1], speed: 1, sped: 2 }],
      bulk: { flag: [[1, "x"]] },
    };
    const r = parseFragment(bad, fake);
    expect(!r.ok && r.issues.map((i) => [i.code, i.path])).toEqual(
      expect.arrayContaining([
        ["unknown-key", "/entities/0/sped"],
        ["schema", "/bulk/flag/0/1"],
      ]),
    );
  });

  it("rejects text that isn't a fragment", () => {
    for (const input of ["{", "[]", '{"kind":"scene"}', { kind: "scene-fragment", v: 1, x: 1 }]) {
      const r = parseFragment(input, fake);
      expect(r.ok, JSON.stringify(input)).toBe(false);
    }
    const dup = { kind: "scene-fragment", v: 1, entities: [def.entities![1], def.entities![1]] };
    const r = parseFragment(dup, fake);
    expect(!r.ok && r.issues.map((i) => i.code)).toEqual(["dup-id"]);
  });

  it("refuses a fragment from a newer format", () => {
    const r = parseFragment({ kind: "scene-fragment", v: 99, entities: [] }, fake);
    expect(!r.ok && r.issues.map((i) => i.code)).toEqual(["version-newer"]);
  });
});

describe("fragmentBounds", () => {
  it("covers shapes, points and a path rider along its path", () => {
    const all = fragmentOf(def, ["~solid:0", "~flag:1", "lift"], fake);
    expect(fragmentBounds(all, fake)).toEqual({ minX: 20, minY: 20, maxX: 640, maxY: 306 });
    expect(fragmentBounds({ kind: "scene-fragment", v: 1, entities: [] }, fake)).toBeNull();
  });
});
