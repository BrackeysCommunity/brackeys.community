import { describe, expect, it } from "vite-plus/test";

import { EntityTable } from "../runtime/entity-table";
import { marker } from "./fixtures/tree-rig";

describe("EntityTable", () => {
  it("keeps spawn order", () => {
    const table = new EntityTable();
    for (const id of ["b", "a/x", "c", "a/y"]) table.set(id, marker(id));
    expect([...table.keys()]).toEqual(["b", "a/x", "c", "a/y"]);
  });

  it("reads nothing into an id: what sits under an entity is the scene tree's to say", () => {
    const table = new EntityTable();
    table.set("room-1/lamp", marker("room-1/lamp"));
    expect("hasUnder" in table).toBe(false);
    expect(table.has("room-1")).toBe(false);
  });
});
