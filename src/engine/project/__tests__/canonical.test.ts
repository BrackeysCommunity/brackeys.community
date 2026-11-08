import { describe, expect, it } from "vite-plus/test";

import { canonicalJson, stableJson } from "../canonical";
import type { DocLayout } from "../kinds";

type MapLayout = Extract<DocLayout, { as: "map" }>;

const atomic: DocLayout = { as: "atomic" };
const material: MapLayout = { as: "map", rest: atomic };
const gameSettings: MapLayout = {
  as: "map",
  fields: { engine: { as: "map", rest: atomic }, game: { as: "map", rest: atomic } },
};
const dataTable: MapLayout = {
  as: "map",
  fields: { table: atomic, rows: { as: "keyed", item: { as: "map", rest: atomic } } },
};
const inputScript: MapLayout = {
  as: "map",
  fields: { scene: atomic, steps: { as: "list", item: atomic } },
};

/** Mulberry32: a small seeded generator, so a failing case reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = ReturnType<typeof rng>;
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const KEYS = ["a", "b", "z", "id", "kind", "v", "$schema", "é", "a b", "~/", "10", "2", "__x"];
const STRINGS = ["", "x", "fireball", 'quote " and \\', "line\nbreak", "漢字", "🎮", " "];

function randomAtomic(r: Rand, depth: number): unknown {
  const roll = r();
  if (depth <= 0 || roll < 0.5) {
    return pick(r, [null, true, false, 0, -1, 3.25, 1e21, -0.5, ...STRINGS]);
  }
  if (roll < 0.75)
    return Array.from({ length: Math.floor(r() * 4) }, () => randomAtomic(r, depth - 1));
  const obj: Record<string, unknown> = {};
  for (let i = Math.floor(r() * 4); i > 0; i--) obj[pick(r, KEYS)] = randomAtomic(r, depth - 1);
  return obj;
}

function randomLayout(r: Rand, depth: number): DocLayout {
  const roll = r();
  if (depth <= 0 || roll < 0.35) return roll < 0.1 ? { as: "text" } : atomic;
  if (roll < 0.55) return { as: "list", item: randomLayout(r, depth - 1) };
  if (roll < 0.75) return { as: "keyed", item: randomMapLayout(r, depth - 1) };
  return randomMapLayout(r, depth - 1);
}

function randomMapLayout(r: Rand, depth: number): MapLayout {
  const fields: Record<string, DocLayout> = {};
  for (let i = Math.floor(r() * 3); i > 0; i--) fields[pick(r, KEYS)] = randomLayout(r, depth);
  return r() < 0.5 ? { as: "map", fields } : { as: "map", fields, rest: randomLayout(r, depth) };
}

function randomValue(r: Rand, layout: DocLayout, depth: number): unknown {
  switch (layout.as) {
    case "atomic":
      return randomAtomic(r, depth);
    case "text":
      return pick(r, STRINGS);
    case "list":
      return Array.from({ length: Math.floor(r() * 4) }, () =>
        randomValue(r, layout.item, depth - 1),
      );
    case "keyed":
      return Array.from({ length: Math.floor(r() * 4) }, (_, i) => ({
        ...(randomValue(r, layout.item, depth - 1) as object),
        [layout.id ?? "id"]: `item-${i}`,
      }));
    case "map": {
      const obj: Record<string, unknown> = {};
      for (const key of Object.keys(layout.fields ?? {})) {
        if (r() < 0.7) obj[key] = randomValue(r, layout.fields![key]!, depth - 1);
      }
      if (layout.rest) {
        for (let i = Math.floor(r() * 3); i > 0; i--) {
          const key = pick(r, KEYS);
          if (!(key in obj)) obj[key] = randomValue(r, layout.rest, depth - 1);
        }
      }
      return obj;
    }
  }
}

/** The same value with every object's keys in a shuffled order. */
function shuffleKeys(r: Rand, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => shuffleKeys(r, v));
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value);
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [entries[i], entries[j]] = [entries[j]!, entries[i]!];
  }
  return Object.fromEntries(entries.map(([k, v]) => [k, shuffleKeys(r, v)]));
}

describe("canonicalJson", () => {
  it("writes a material: header keys first, then the rest sorted, atomic values inline", () => {
    const text = canonicalJson(
      {
        render: { style: { fill: "#e05a5a" } },
        physics: { restitution: 0.9, friction: 0.4 },
        description: "Bouncy rubber.",
        v: 1,
        kind: "material",
        $schema: "../material.schema.json",
      },
      material,
    );
    expect(text).toBe(
      [
        "{",
        '  "$schema": "../material.schema.json",',
        '  "kind": "material",',
        '  "v": 1,',
        '  "description": "Bouncy rubber.",',
        '  "physics": { "friction": 0.4, "restitution": 0.9 },',
        '  "render": { "style": { "fill": "#e05a5a" } }',
        "}",
        "",
      ].join("\n"),
    );
  });

  it("writes keyed items one per line, the id first, declared fields before sorted ones", () => {
    const text = canonicalJson(
      {
        rows: [
          { damage: 5, cost: 3, id: "fireball" },
          { id: "heal", damage: 0, cost: 2 },
        ],
        table: "card",
        v: 1,
        kind: "data-table",
      },
      dataTable,
    );
    expect(text).toBe(
      [
        "{",
        '  "kind": "data-table",',
        '  "v": 1,',
        '  "table": "card",',
        '  "rows": [',
        '    { "id": "fireball", "cost": 3, "damage": 5 },',
        '    { "id": "heal", "cost": 2, "damage": 0 }',
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("indents nested maps and writes empty ones and empty collections short", () => {
    expect(
      canonicalJson(
        { kind: "game-settings", v: 1, engine: {}, game: { startLives: 3 } },
        gameSettings,
      ),
    ).toBe(
      [
        "{",
        '  "kind": "game-settings",',
        '  "v": 1,',
        '  "engine": {},',
        '  "game": {',
        '    "startLives": 3',
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    expect(canonicalJson({ steps: [], scene: "a" }, inputScript)).toBe(
      '{\n  "scene": "a",\n  "steps": []\n}\n',
    );
    expect(canonicalJson({}, material)).toBe("{}\n");
  });

  it("writes list items one per line in their order", () => {
    expect(
      canonicalJson({ scene: "s", steps: [{ wait: 2 }, { press: "jump", at: 1 }] }, inputScript),
    ).toBe(
      '{\n  "scene": "s",\n  "steps": [\n    { "wait": 2 },\n    { "at": 1, "press": "jump" }\n  ]\n}\n',
    );
  });

  it("leads with the id in a keyed collection nested inside a one-line item", () => {
    const layout: MapLayout = {
      as: "map",
      fields: {
        lanes: {
          as: "list",
          item: {
            as: "map",
            fields: { cards: { as: "keyed", item: { as: "map", rest: atomic } } },
          },
        },
      },
    };
    expect(canonicalJson({ lanes: [{ cards: [{ z: 1, id: "c" }] }] }, layout)).toBe(
      '{\n  "lanes": [\n    { "cards": [{ "id": "c", "z": 1 }] }\n  ]\n}\n',
    );
  });

  it("writes a value that doesn't fit its layout as an atomic one", () => {
    expect(canonicalJson({ rows: "not rows", table: { b: 1, a: 2 } }, dataTable)).toBe(
      '{\n  "table": { "a": 2, "b": 1 },\n  "rows": "not rows"\n}\n',
    );
  });

  it("leaves out undefined members and writes undefined items as null", () => {
    expect(canonicalJson({ a: undefined, b: [undefined, 1] }, material)).toBe(
      '{\n  "b": [null, 1]\n}\n',
    );
  });

  it("is idempotent, parses back to the value, and ignores key order (property)", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed);
      const layout = randomMapLayout(r, 4);
      const value = randomValue(r, layout, 4);
      const text = canonicalJson(value, layout);
      const parsed = JSON.parse(text);
      expect(text.endsWith("}\n"), `seed ${seed}`).toBe(true);
      expect(stableJson(parsed), `seed ${seed}`).toBe(stableJson(value));
      expect(canonicalJson(parsed, layout), `seed ${seed}`).toBe(text);
      expect(canonicalJson(shuffleKeys(r, value), layout), `seed ${seed}`).toBe(text);
    }
  });

  it("writes every line of a block with two spaces per level and no trailing spaces", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const r = rng(seed * 7919);
      const layout = randomMapLayout(r, 4);
      const text = canonicalJson(randomValue(r, layout, 4), layout);
      for (const line of text.slice(0, -1).split("\n")) {
        expect(line, `seed ${seed}`).toMatch(/^( {2})*\S(.*\S)?$/s);
      }
    }
  });
});
