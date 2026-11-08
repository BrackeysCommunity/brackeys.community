import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import type { DocLayout } from "../../project/kinds";
import { rng } from "../../scene/__tests__/fixtures/random-ops";
import { sequentialKeys } from "../keys";
import {
  contentMap,
  KEYED_ITEM,
  KEYED_Z,
  layoutFromDoc,
  layoutPatch,
  layoutToDoc,
} from "../layout";
import { genMap, genValue, mutateRoot } from "./fixtures/layout-gen";

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

function counted(doc: Y.Doc) {
  const counts = { transactions: 0, updates: 0 };
  doc.on("beforeTransaction", () => counts.transactions++);
  doc.on("update", () => counts.updates++);
  return counts;
}

describe("layout round trips", () => {
  it("maps generated layouts and values to a doc and back, through an update too", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed * 104729);
      const layout = genMap(rand, 3);
      const value = genValue(rand, layout);
      if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
      const doc = layoutToDoc(new Y.Doc(), layout, value, "seed", { key: sequentialKeys() });
      expect(layoutFromDoc(doc, layout), `seed ${seed}`).toEqual(json(value));
      const copy = new Y.Doc();
      Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
      expect(layoutFromDoc(copy, layout), `seed ${seed} copy`).toEqual(json(value));
    }
  });

  it("patches to generated next values in exactly one transaction, and a repeat writes nothing", () => {
    let wrote = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rand = rng(seed * 15485863);
      const layout = genMap(rand, 3);
      const first = genValue(rand, layout);
      if (first === null || typeof first !== "object" || Array.isArray(first)) continue;
      const doc = layoutToDoc(new Y.Doc(), layout, first, "seed", { key: sequentialKeys() });
      const counts = counted(doc);
      let value: unknown = first;
      for (let step = 0; step < 15; step++) {
        const next = mutateRoot(rand, layout, value);
        const before = counts.transactions;
        const changed = layoutPatch(doc, layout, next, "user", {
          key: sequentialKeys(`p${step}-`),
        });
        expect(counts.transactions - before, `seed ${seed} step ${step}`).toBe(1);
        expect(layoutFromDoc(doc, layout), `seed ${seed} step ${step}`).toEqual(json(next));
        if (changed) wrote++;
        const updates = counts.updates;
        expect(layoutPatch(doc, layout, next, "user")).toBe(false);
        expect(counts.updates, `seed ${seed} step ${step} repeat`).toBe(updates);
        value = next;
      }
    }
    expect(wrote).toBeGreaterThan(1000);
  });

  it("gives the same value with keys in the same order whatever order updates arrived in", () => {
    const layout: DocLayout = { as: "map", fields: { b: { as: "atomic" }, a: { as: "atomic" } } };
    const a = new Y.Doc();
    const b = new Y.Doc();
    layoutPatch(a, layout, { b: 1, q: 1, a: 1 }, "x");
    layoutPatch(b, layout, { p: 2 }, "y");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(Object.keys(layoutFromDoc(a, layout))).toEqual(["b", "a", "p", "q"]);
    expect(Object.keys(layoutFromDoc(b, layout))).toEqual(["b", "a", "p", "q"]);
  });
});

describe("each layout form", () => {
  const layout: DocLayout = {
    as: "map",
    fields: {
      title: { as: "text" },
      tags: { as: "list", item: { as: "atomic" } },
      settings: { as: "map", rest: { as: "atomic" } },
      rows: { as: "keyed", item: { as: "map", rest: { as: "atomic" } } },
    },
  };
  const value = {
    title: "Deck",
    tags: ["red", "blue"],
    settings: { size: 3, style: { fill: "#fff" } },
    rows: [
      { id: "fireball", cost: 3 },
      { id: "heal", cost: 2 },
    ],
    other: { kept: [1, 2] },
  };
  const seeded = () => layoutToDoc(new Y.Doc(), layout, value, "seed", { key: sequentialKeys() });

  it("holds each form as its Yjs type", () => {
    const content = contentMap(seeded());
    expect(content.get("title")).toBeInstanceOf(Y.Text);
    expect(content.get("tags")).toBeInstanceOf(Y.Array);
    const settings = content.get("settings") as Y.Map<unknown>;
    expect(settings).toBeInstanceOf(Y.Map);
    expect(settings.get("style")).toEqual({ fill: "#fff" });
    expect(content.get("other")).toEqual({ kept: [1, 2] });
    const rows = content.get("rows") as Y.Map<Y.Map<unknown>>;
    expect([...rows.keys()].sort()).toEqual(["k0000", "k0001"]);
    const entry = rows.get("k0000")!;
    expect(typeof entry.get(KEYED_Z)).toBe("string");
    expect(entry.get(KEYED_ITEM)).toBeInstanceOf(Y.Map);
    expect((entry.get(KEYED_ITEM) as Y.Map<unknown>).toJSON()).toEqual({ id: "fireball", cost: 3 });
  });

  it("holds a value that doesn't fit its layout atomically, and round-trips it", () => {
    const odd = { title: 7, tags: "none", settings: [1], rows: { id: "x" } };
    const doc = layoutToDoc(new Y.Doc(), layout, odd);
    expect(contentMap(doc).get("title")).toBe(7);
    expect(layoutFromDoc(doc, layout)).toEqual(odd);
    layoutPatch(doc, layout, value, "user");
    expect(layoutFromDoc(doc, layout)).toEqual(value);
    layoutPatch(doc, layout, odd, "user");
    expect(layoutFromDoc(doc, layout)).toEqual(odd);
  });

  it("refuses a non-map root, a non-object value and a seeded doc", () => {
    const list: DocLayout = { as: "list", item: { as: "atomic" } };
    expect(() => layoutToDoc(new Y.Doc(), list, {})).toThrow(/root must be a "map"/);
    expect(() => layoutToDoc(new Y.Doc(), layout, [])).toThrow(/must be an object/);
    expect(() => layoutPatch(new Y.Doc(), layout, null)).toThrow(/must be an object/);
    expect(() => layoutToDoc(seeded(), layout, value)).toThrow(/isn't empty/);
  });

  it("writes only the changed map key", () => {
    const doc = seeded();
    const content = contentMap(doc);
    const title = content.get("title");
    const tags = content.get("tags");
    const rows = content.get("rows");
    const changed: string[] = [];
    content.observeDeep((events) => {
      for (const e of events)
        for (const k of e.changes.keys.keys()) changed.push(`${e.path.join("/")}:${k}`);
    });
    layoutPatch(doc, layout, { ...value, settings: { size: 4, style: { fill: "#fff" } } }, "u");
    expect(changed).toEqual(["settings:size"]);
    expect(content.get("title")).toBe(title);
    expect(content.get("tags")).toBe(tags);
    expect(content.get("rows")).toBe(rows);
  });

  it("edits text by its changed span", () => {
    const doc = seeded();
    const text = contentMap(doc).get("title") as Y.Text;
    const deltas: unknown[] = [];
    text.observe((e) => deltas.push(e.delta));
    layoutPatch(doc, layout, { ...value, title: "Red Deck" }, "u");
    expect(contentMap(doc).get("title")).toBe(text);
    expect(deltas).toEqual([[{ insert: "Red " }]]);
    layoutPatch(doc, layout, { ...value, title: "Red Duck" }, "u");
    expect(deltas[1]).toEqual([{ retain: 5 }, { delete: 1 }, { insert: "u" }]);
  });

  it("never splits a surrogate pair", () => {
    const doc = layoutToDoc(new Y.Doc(), layout, { title: "a🎮b" });
    const deltas: unknown[] = [];
    (contentMap(doc).get("title") as Y.Text).observe((e) => deltas.push(e.delta));
    layoutPatch(doc, layout, { title: "a🎲b" }, "u");
    expect(layoutFromDoc(doc, layout)).toEqual({ title: "a🎲b" });
    expect(deltas).toEqual([[{ retain: 1 }, { delete: 2 }, { insert: "🎲" }]]);
  });

  it("inserts into a list without rewriting its other items", () => {
    const doc = seeded();
    const tags = contentMap(doc).get("tags") as Y.Array<unknown>;
    const deltas: unknown[] = [];
    tags.observe((e) => deltas.push(e.delta));
    layoutPatch(doc, layout, { ...value, tags: ["red", "green", "blue"] }, "u");
    layoutPatch(doc, layout, { ...value, tags: ["green", "blue", "red"] }, "u");
    expect(deltas).toEqual([
      [{ retain: 1 }, { insert: ["green"] }],
      [{ delete: 1 }, { retain: 2 }, { insert: ["red"] }],
    ]);
    expect(layoutFromDoc(doc, layout).tags).toEqual(["green", "blue", "red"]);
  });

  it("replaces an edited list item whole", () => {
    const nested: DocLayout = {
      as: "map",
      fields: { steps: { as: "list", item: { as: "map", rest: { as: "atomic" } } } },
    };
    const doc = layoutToDoc(new Y.Doc(), nested, { steps: [{ t: 1 }, { t: 2 }] });
    const steps = contentMap(doc).get("steps") as Y.Array<Y.Map<unknown>>;
    const first = steps.get(0);
    const second = steps.get(1);
    layoutPatch(doc, nested, { steps: [{ t: 1 }, { t: 3 }] }, "u");
    expect(steps.get(0)).toBe(first);
    expect(steps.get(1)).not.toBe(second);
    expect(steps.get(1).toJSON()).toEqual({ t: 3 });
  });

  describe("keyed", () => {
    const rowsOf = (doc: Y.Doc) => contentMap(doc).get("rows") as Y.Map<Y.Map<unknown>>;
    const keysInOrder = (doc: Y.Doc) =>
      [...rowsOf(doc).entries()]
        .map(([k, e]) => ({ k, z: e.get(KEYED_Z) as string }))
        .sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.k < b.k ? -1 : 1))
        .map((e) => e.k);
    const rows = (...r: object[]) => ({ ...value, rows: r });

    it("keeps an item's key when its id matches, patching only its changed field", () => {
      const doc = seeded();
      const fireball = rowsOf(doc).get("k0000")!;
      const item = fireball.get(KEYED_ITEM) as Y.Map<unknown>;
      const changed: string[] = [];
      contentMap(doc).observeDeep((events) => {
        for (const e of events)
          for (const k of e.changes.keys.keys()) changed.push(`${e.path.join("/")}:${k}`);
      });
      layoutPatch(doc, layout, rows({ id: "fireball", cost: 4 }, { id: "heal", cost: 2 }), "u");
      expect(changed).toEqual(["rows/k0000/item:cost"]);
      expect(rowsOf(doc).get("k0000")).toBe(fireball);
      expect(fireball.get(KEYED_ITEM)).toBe(item);
    });

    it("reorders by z alone, keeping keys", () => {
      const doc = seeded();
      const changed: string[] = [];
      contentMap(doc).observeDeep((events) => {
        for (const e of events)
          for (const k of e.changes.keys.keys()) changed.push(`${e.path.join("/")}:${k}`);
      });
      layoutPatch(doc, layout, rows({ id: "heal", cost: 2 }, { id: "fireball", cost: 3 }), "u");
      expect(keysInOrder(doc)).toEqual(["k0001", "k0000"]);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toMatch(/^rows\/k000[01]:@z$/);
      expect(layoutFromDoc(doc, layout).rows).toEqual([
        { id: "heal", cost: 2 },
        { id: "fireball", cost: 3 },
      ]);
    });

    it("gives an inserted item a new key between its neighbours and drops a removed one", () => {
      const doc = seeded();
      layoutPatch(
        doc,
        layout,
        rows({ id: "fireball", cost: 3 }, { id: "bolt", cost: 1 }, { id: "heal", cost: 2 }),
        "u",
        { key: sequentialKeys("n") },
      );
      expect(keysInOrder(doc)).toEqual(["k0000", "n0000", "k0001"]);
      layoutPatch(doc, layout, rows({ id: "bolt", cost: 1 }, { id: "heal", cost: 2 }), "u");
      expect(keysInOrder(doc)).toEqual(["n0000", "k0001"]);
    });

    it("never reuses a key the collection already holds", () => {
      const doc = seeded();
      layoutPatch(
        doc,
        layout,
        rows({ id: "fireball", cost: 3 }, { id: "heal", cost: 2 }, { id: "x" }),
        "u",
        {
          key: sequentialKeys(),
        },
      );
      expect(keysInOrder(doc)).toEqual(["k0000", "k0001", "k0002"]);
    });

    it("keeps two items with one id as two, each with its own key", () => {
      const doc = seeded();
      layoutPatch(
        doc,
        layout,
        rows({ id: "fireball", cost: 3 }, { id: "heal", cost: 2 }, { id: "heal", cost: 9 }),
        "u",
        { key: sequentialKeys("n") },
      );
      expect(keysInOrder(doc)).toEqual(["k0000", "k0001", "n0000"]);
      layoutPatch(
        doc,
        layout,
        rows({ id: "fireball", cost: 3 }, { id: "heal", cost: 2 }, { id: "heal", cost: 10 }),
        "u",
      );
      expect(keysInOrder(doc)).toEqual(["k0000", "k0001", "n0000"]);
      expect(layoutFromDoc(doc, layout).rows).toEqual([
        { id: "fireball", cost: 3 },
        { id: "heal", cost: 2 },
        { id: "heal", cost: 10 },
      ]);
    });

    it("matches id-less items by position among the id-less", () => {
      const doc = layoutToDoc(
        new Y.Doc(),
        layout,
        rows({ cost: 1 }, { id: "a" }, { cost: 2 }),
        "s",
        {
          key: sequentialKeys(),
        },
      );
      layoutPatch(doc, layout, rows({ cost: 5 }, { id: "a" }, { cost: 2 }), "u");
      expect(keysInOrder(doc)).toEqual(["k0000", "k0001", "k0002"]);
    });

    it("uses the layout's id field", () => {
      const named: DocLayout = {
        as: "map",
        fields: { cards: { as: "keyed", id: "name", item: { as: "map" } } },
      };
      const doc = layoutToDoc(
        new Y.Doc(),
        named,
        { cards: [{ name: "a" }, { name: "b", id: "q" }] },
        "s",
        {
          key: sequentialKeys(),
        },
      );
      layoutPatch(doc, named, { cards: [{ name: "b", id: "r" }, { name: "a" }] }, "u");
      const cards = contentMap(doc).get("cards") as Y.Map<Y.Map<unknown>>;
      expect((cards.get("k0001")!.get(KEYED_ITEM) as Y.Map<unknown>).get("id")).toBe("r");
      expect([...cards.keys()].sort()).toEqual(["k0000", "k0001"]);
    });
  });
});
