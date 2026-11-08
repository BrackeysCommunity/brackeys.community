import { describe, expect, it } from "vite-plus/test";

import { canonicalJson } from "../canonical";
import { applyJsonEdits, keyedItemPointer, parseJsonPointer, readPointer } from "../json-edit";
import type { DocLayout } from "../kinds";
import type { JsonEdit } from "../ops";

const atomic: DocLayout = { as: "atomic" };
const table: DocLayout = {
  as: "map",
  fields: {
    table: atomic,
    note: { as: "text" },
    rows: { as: "keyed", item: { as: "map", rest: atomic } },
    steps: { as: "list", item: atomic },
    cards: {
      as: "keyed",
      id: "key",
      item: { as: "map", fields: { tags: { as: "list", item: atomic } } },
    },
  },
  rest: atomic,
};

const doc = () => ({
  kind: "data-table",
  v: 1,
  table: "card",
  note: "hi",
  rows: [
    { id: "fireball", cost: 3, damage: 5, fx: { color: "red" } },
    { id: "heal", cost: 2, damage: 0 },
  ],
  steps: [{ wait: 1 }, { press: "jump" }],
  physics: { friction: 0.4 },
});

function ok(value: unknown, edits: JsonEdit[], layout: DocLayout = table) {
  const result = applyJsonEdits(value, layout, edits);
  if (!result.ok) throw new Error(`refused: ${result.issue.code} ${result.issue.message}`);
  return result.value as any;
}

function refused(value: unknown, edits: JsonEdit[], layout: DocLayout = table) {
  const result = applyJsonEdits(value, layout, edits);
  if (result.ok) throw new Error("applied");
  return result;
}

describe("parseJsonPointer", () => {
  it("unescapes RFC 6901 tokens", () => {
    expect(parseJsonPointer("")).toEqual([]);
    expect(parseJsonPointer("/")).toEqual([""]);
    expect(parseJsonPointer("/a~1b/c~0d/~01")).toEqual(["a/b", "c~d", "~1"]);
    expect(parseJsonPointer("/rows/@fireball/cost")).toEqual(["rows", "@fireball", "cost"]);
  });

  it("refuses a pointer without a leading slash or with a bad escape", () => {
    for (const bad of ["rows", "#/rows", "/a~2", "/a~"])
      expect(parseJsonPointer(bad), bad).toBeNull();
  });

  it("builds a keyed item's pointer that parses back to its id", () => {
    const pointer = keyedItemPointer("/rows", "a/b~c");
    expect(pointer).toBe("/rows/@a~1b~0c");
    expect(parseJsonPointer(pointer)).toEqual(["rows", "@a/b~c"]);
  });
});

describe("readPointer", () => {
  it("reads through @id and index segments", () => {
    expect(readPointer(doc(), table, "/rows/@heal/cost")).toMatchObject({ ok: true, value: 2 });
    expect(readPointer(doc(), table, "/rows/0/id")).toMatchObject({ ok: true, value: "fireball" });
    expect(readPointer(doc(), table, "/steps/1")).toMatchObject({
      ok: true,
      value: { press: "jump" },
    });
    expect(readPointer(doc(), table, "/rows/@nope")).toMatchObject({
      ok: false,
      issue: { code: "ref-not-found" },
    });
  });
});

describe("applyJsonEdits", () => {
  it("sets a field of a keyed item by id, and leaves the input alone", () => {
    const before = doc();
    const after = ok(before, [{ set: "/rows/@heal/cost", value: 4 }]);
    expect(after.rows[1]).toEqual({ id: "heal", cost: 4, damage: 0 });
    expect(before.rows[1]!.cost).toBe(2);
    expect(after.physics).not.toBe(before.physics);
  });

  it("sets and unsets map keys, an unset of an absent key doing nothing", () => {
    const after = ok(doc(), [
      { set: "/description", value: "Cards." },
      { unset: "/physics" },
      { unset: "/absent" },
      { set: "/table", value: "deck" },
    ]);
    expect(after.description).toBe("Cards.");
    expect(after.table).toBe("deck");
    expect("physics" in after).toBe(false);
  });

  it("replaces a whole atomic value, a list item, a keyed item and the root", () => {
    const after = ok(doc(), [
      { set: "/physics", value: { friction: 1 } },
      { set: "/steps/0", value: { wait: 9 } },
      { set: "/rows/@fireball", value: { id: "fireball", cost: 1 } },
    ]);
    expect(after.physics).toEqual({ friction: 1 });
    expect(after.steps[0]).toEqual({ wait: 9 });
    expect(after.rows[0]).toEqual({ id: "fireball", cost: 1 });
    expect(ok(doc(), [{ set: "", value: { kind: "x" } }])).toEqual({ kind: "x" });
  });

  it("refuses a pointer into an atomic or text value with op-invalid", () => {
    for (const pointer of [
      "/physics/friction",
      "/rows/@fireball/fx/color",
      "/note/0",
      "/table/x",
    ]) {
      const result = refused(doc(), [{ set: pointer, value: 1 }]);
      expect(result.issue.code, pointer).toBe("op-invalid");
      expect(result.issue.path).toBe("/0/set");
    }
    expect(refused(doc(), [{ unset: "/physics/friction" }]).issue.code).toBe("op-invalid");
    expect(refused(doc(), [{ remove: "/steps/0/wait" }]).issue.code).toBe("op-invalid");
  });

  it("inserts at the end by default, before a sibling id, or before an index", () => {
    const after = ok(doc(), [
      { insert: "/rows", value: { id: "zap", cost: 1 } },
      { insert: "/rows", value: { id: "first", cost: 0 }, before: "fireball" },
      { insert: "/rows", value: { id: "mid", cost: 0 }, before: 2 },
      { insert: "/steps", value: { wait: 0 }, before: 0 },
      { insert: "/steps", value: { press: "end" } },
    ]);
    expect(after.rows.map((r: { id: string }) => r.id)).toEqual([
      "first",
      "fireball",
      "mid",
      "heal",
      "zap",
    ]);
    expect(after.steps).toEqual([{ wait: 0 }, { wait: 1 }, { press: "jump" }, { press: "end" }]);
  });

  it("creates an absent collection on its first insert", () => {
    const after = ok({ kind: "x" }, [
      { insert: "/rows", value: { id: "a" } },
      { insert: "/cards", value: { key: "c", tags: ["t"] } },
    ]);
    expect(after).toEqual({ kind: "x", rows: [{ id: "a" }], cards: [{ key: "c", tags: ["t"] }] });
  });

  it("uses a keyed layout's own id field", () => {
    const after = ok({ cards: [{ key: "a", tags: [] }] }, [
      { insert: "/cards/@a/tags", value: "red" },
      { insert: "/cards", value: { key: "b" }, before: "a" },
      { set: "/cards/@a/tags/0", value: "blue" },
    ]);
    expect(after.cards).toEqual([{ key: "b" }, { key: "a", tags: ["blue"] }]);
    expect(refused(after, [{ insert: "/cards", value: { id: "c" } }]).issue.code).toBe(
      "op-invalid",
    );
  });

  it("refuses inserting a repeated id, an item without one, or into a non-collection", () => {
    const taken = refused(doc(), [{ insert: "/rows", value: { id: "heal" } }]);
    expect(taken.issue.code).toBe("id-taken");
    expect(taken.issue.path).toBe("/0/value");
    expect(refused(doc(), [{ insert: "/rows", value: { cost: 1 } }]).issue.code).toBe("op-invalid");
    expect(refused(doc(), [{ insert: "/rows", value: "row" }]).issue.code).toBe("op-invalid");
    expect(refused(doc(), [{ insert: "/physics", value: 1 }]).issue.code).toBe("op-invalid");
    expect(refused(doc(), [{ insert: "/table", value: 1 }]).issue.code).toBe("op-invalid");
  });

  it("refuses a before that names no sibling or is out of range", () => {
    const missing = refused(doc(), [{ insert: "/rows", value: { id: "x" }, before: "nope" }]);
    expect(missing.issue.code).toBe("ref-not-found");
    expect(missing.issue.path).toBe("/0/before");
    for (const before of [-1, 3, 1.5]) {
      expect(refused(doc(), [{ insert: "/rows", value: { id: "x" }, before }]).issue.code).toBe(
        "op-invalid",
      );
    }
    expect(refused(doc(), [{ insert: "/steps", value: 1, before: "a" }]).issue.code).toBe(
      "op-invalid",
    );
  });

  it("removes keyed items by id or index and list items by index", () => {
    const after = ok(doc(), [{ remove: "/rows/@fireball" }, { remove: "/steps/1" }]);
    expect(after.rows).toEqual([{ id: "heal", cost: 2, damage: 0 }]);
    expect(after.steps).toEqual([{ wait: 1 }]);
    expect(ok(doc(), [{ remove: "/rows/1" }]).rows.map((r: { id: string }) => r.id)).toEqual([
      "fireball",
    ]);
  });

  it("refuses removing a map key, unsetting an item, and missing targets", () => {
    expect(refused(doc(), [{ remove: "/physics" }]).issue.code).toBe("op-invalid");
    expect(refused(doc(), [{ unset: "/rows/@heal" }]).issue.code).toBe("op-invalid");
    expect(refused(doc(), [{ remove: "/rows/@nope" }]).issue.code).toBe("ref-not-found");
    expect(refused(doc(), [{ remove: "/steps/9" }]).issue.code).toBe("ref-not-found");
    expect(refused(doc(), [{ set: "/steps/2", value: 1 }]).issue.code).toBe("ref-not-found");
    expect(refused(doc(), [{ set: "/rows/@nope/cost", value: 1 }]).issue.code).toBe(
      "ref-not-found",
    );
    expect(refused(doc(), [{ set: "/absent/x", value: 1 }]).issue.code).toBe("ref-not-found");
    expect(refused(doc(), [{ set: "/steps/x", value: 1 }]).issue.code).toBe("op-invalid");
    expect(refused(doc(), [{ set: "/rows/fireball", value: 1 }]).issue.code).toBe("op-invalid");
    expect(refused(doc(), [{ unset: "" }]).issue.code).toBe("op-invalid");
  });

  it("keeps keyed ids distinct and present", () => {
    expect(refused(doc(), [{ set: "/rows/@heal/id", value: "fireball" }]).issue.code).toBe(
      "id-taken",
    );
    expect(refused(doc(), [{ set: "/rows/@heal/id", value: 3 }]).issue.code).toBe("op-invalid");
    expect(refused(doc(), [{ unset: "/rows/@heal/id" }]).issue.code).toBe("op-invalid");
    expect(refused(doc(), [{ set: "/rows/@heal", value: { id: "fireball" } }]).issue.code).toBe(
      "id-taken",
    );
    const renamed = ok(doc(), [
      { set: "/rows/@heal/id", value: "cure" },
      { set: "/rows/@cure/cost", value: 7 },
    ]);
    expect(renamed.rows[1]).toEqual({ id: "cure", cost: 7, damage: 0 });
  });

  it("refuses values that don't fit the layout or aren't plain JSON", () => {
    expect(refused(doc(), [{ set: "/note", value: 1 }]).issue.code).toBe("op-invalid");
    expect(refused(doc(), [{ set: "/steps", value: {} }]).issue.code).toBe("op-invalid");
    expect(refused(doc(), [{ set: "/rows", value: [{ id: "a" }, { id: "a" }] }]).issue.code).toBe(
      "op-invalid",
    );
    expect(refused(doc(), [{ set: "", value: [] }]).issue.code).toBe("op-invalid");
    for (const value of [undefined, Number.NaN, () => 1, new Date(0), { a: Infinity }]) {
      expect(refused(doc(), [{ set: "/x", value }]).issue.code).toBe("op-invalid");
    }
    const both = { set: "/x", value: 1, remove: "/x" } as unknown as JsonEdit;
    expect(refused(doc(), [both]).issue).toMatchObject({ code: "op-invalid", path: "/0" });
    expect(refused(doc(), [{} as JsonEdit]).issue.code).toBe("op-invalid");
    expect(refused(doc(), [{ set: "x", value: 1 }]).issue.code).toBe("op-invalid");
  });

  it("is atomic: the first refused edit leaves nothing applied and names its index", () => {
    const before = doc();
    const result = refused(before, [
      { set: "/table", value: "deck" },
      { remove: "/rows/@heal" },
      { set: "/physics/friction", value: 1 },
    ]);
    expect(result.index).toBe(2);
    expect(result.issue.path).toBe("/2/set");
    expect(before).toEqual(doc());
  });

  it("treats @ as an ordinary key in a map, and __proto__ as a key", () => {
    const after = ok({}, [
      { set: "/@odd", value: 1 },
      { set: "/__proto__", value: { polluted: true } },
    ]);
    expect(after["@odd"]).toBe(1);
    expect(Object.getPrototypeOf(after)).toBe(Object.prototype);
    expect(Object.hasOwn(after, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("keeps edited docs canonical-formattable", () => {
    const after = ok(doc(), [{ insert: "/rows", value: { damage: 1, id: "a" }, before: "heal" }]);
    expect(canonicalJson(after, table)).toContain('    { "id": "a", "damage": 1 },\n');
  });
});
