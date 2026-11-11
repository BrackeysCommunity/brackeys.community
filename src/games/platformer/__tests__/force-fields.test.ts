import { describe, expect, it } from "vite-plus/test";

import { createForceFields, type ForceZone } from "../force-fields";

const UP: ForceZone = {
  center: { x: 0, y: 0 },
  hw: 0.5,
  hh: 0.8,
  rotation: 0,
  force: { x: 0, y: -8 },
};

describe("createForceFields", () => {
  it("samples zero outside every zone", () => {
    const fields = createForceFields();
    fields.add("wind", UP);
    expect(fields.sample({ x: 2, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("samples a zone's force inside it", () => {
    const fields = createForceFields();
    fields.add("wind", UP);
    expect(fields.sample({ x: 0.1, y: 0.1 })).toEqual({ x: 0, y: -8 });
  });

  it("sums overlapping zones", () => {
    const fields = createForceFields();
    fields.add("a", UP);
    fields.add("b", { ...UP, force: { x: 1, y: 0 } });
    expect(fields.sample({ x: 0, y: 0 })).toEqual({ x: 1, y: -8 });
  });

  it("removes by id, even when two zones share a position", () => {
    const fields = createForceFields();
    fields.add("a", UP);
    fields.add("b", { ...UP, force: { x: 1, y: 0 } });
    fields.remove("a");
    expect(fields.size).toBe(1);
    expect(fields.sample({ x: 0, y: 0 })).toEqual({ x: 1, y: 0 });
    fields.remove("a");
    expect(fields.size).toBe(1);
  });

  it("honours rotation when testing containment", () => {
    const fields = createForceFields();
    // A tall zone turned 90° becomes wide
    fields.add("turned", { ...UP, rotation: Math.PI / 2 });
    expect(fields.sample({ x: 0.7, y: 0 }).y).toBe(-8);
    expect(fields.sample({ x: 0, y: 0.7 })).toEqual({ x: 0, y: 0 });
  });

  it("does not alias the zone it was given", () => {
    const fields = createForceFields();
    const zone = structuredClone(UP);
    fields.add("wind", zone);
    zone.center.x = 10;
    expect(fields.sample({ x: 0, y: 0 }).y).toBe(-8);
  });

  it("clears", () => {
    const fields = createForceFields();
    fields.add("a", UP);
    fields.clear();
    expect(fields.size).toBe(0);
  });
});
