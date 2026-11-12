import { describe, expect, it } from "vite-plus/test";

import { EntityTable } from "../runtime/entity-table";
import type { RuntimeEntity } from "../scene/types";

const marker = (id: string): RuntimeEntity => ({ id, type: "marker", at: [0, 0] });

describe("EntityTable", () => {
  it("knows which instance ids have something live under them, at any depth", () => {
    const table = new EntityTable();
    table.set("crate#1", marker("crate#1"));
    table.set("room-1/lamp", marker("room-1/lamp"));
    table.set("room-1/door-1/panel", marker("room-1/door-1/panel"));

    expect(table.hasUnder("crate#1")).toBe(false);
    expect(table.hasUnder("room-1")).toBe(true);
    expect(table.hasUnder("room-1/door-1")).toBe(true);
    expect(table.hasUnder("room")).toBe(false);
    expect(table.hasUnder("room-1/door")).toBe(false);

    table.delete("room-1/door-1/panel");
    expect(table.hasUnder("room-1/door-1")).toBe(false);
    expect(table.hasUnder("room-1")).toBe(true);
    table.delete("room-1/lamp");
    expect(table.hasUnder("room-1")).toBe(false);
  });

  it("counts an id once however often it is set, and forgets everything on clear", () => {
    const table = new EntityTable();
    table.set("gate-1/bar", marker("gate-1/bar"));
    table.set("gate-1/bar", marker("gate-1/bar"));
    expect(table.delete("gate-1/bar")).toBe(true);
    expect(table.hasUnder("gate-1")).toBe(false);
    expect(table.delete("gate-1/bar")).toBe(false);
    expect(table.hasUnder("gate-1")).toBe(false);

    table.set("gate-2/bar", marker("gate-2/bar"));
    table.clear();
    expect(table.size).toBe(0);
    expect(table.hasUnder("gate-2")).toBe(false);
  });

  it("keeps spawn order", () => {
    const table = new EntityTable();
    for (const id of ["b", "a/x", "c", "a/y"]) table.set(id, marker(id));
    expect([...table.keys()]).toEqual(["b", "a/x", "c", "a/y"]);
  });
});
