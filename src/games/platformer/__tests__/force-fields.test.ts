import { describe, expect, it } from "vite-plus/test";

import { createForceFields, type ForceZone } from "../force-fields";

const UP: ForceZone = {
  center: { x: 0, y: 0 },
  hw: 50,
  hh: 80,
  rotation: 0,
  force: { x: 0, y: -800 },
};

describe("createForceFields", () => {
  it("samples zero outside every zone", () => {
    const fields = createForceFields();
    fields.add("wind", UP);
    expect(fields.sample({ x: 200, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("samples a zone's force inside it", () => {
    const fields = createForceFields();
    fields.add("wind", UP);
    expect(fields.sample({ x: 10, y: 10 })).toEqual({ x: 0, y: -800 });
  });

  it("sums overlapping zones", () => {
    const fields = createForceFields();
    fields.add("a", UP);
    fields.add("b", { ...UP, force: { x: 100, y: 0 } });
    expect(fields.sample({ x: 0, y: 0 })).toEqual({ x: 100, y: -800 });
  });

  it("removes by id, even when two zones share a position", () => {
    const fields = createForceFields();
    fields.add("a", UP);
    fields.add("b", { ...UP, force: { x: 100, y: 0 } });
    fields.remove("a");
    expect(fields.size).toBe(1);
    expect(fields.sample({ x: 0, y: 0 })).toEqual({ x: 100, y: 0 });
    fields.remove("a");
    expect(fields.size).toBe(1);
  });

  it("honours rotation when testing containment", () => {
    const fields = createForceFields();
    // A tall zone turned 90° becomes wide
    fields.add("turned", { ...UP, rotation: Math.PI / 2 });
    expect(fields.sample({ x: 70, y: 0 }).y).toBe(-800);
    expect(fields.sample({ x: 0, y: 70 })).toEqual({ x: 0, y: 0 });
  });

  it("does not alias the zone it was given", () => {
    const fields = createForceFields();
    const zone = structuredClone(UP);
    fields.add("wind", zone);
    zone.center.x = 1000;
    expect(fields.sample({ x: 0, y: 0 }).y).toBe(-800);
  });

  it("clears", () => {
    const fields = createForceFields();
    fields.add("a", UP);
    fields.clear();
    expect(fields.size).toBe(0);
  });
});
