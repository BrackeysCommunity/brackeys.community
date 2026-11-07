import { describe, expect, it } from "vite-plus/test";

import { engine, engineYard, fake, fakeYard } from "../../scene/__tests__/fixtures/random-ops";
import { createSceneUndo } from "../undo";
import { validateDoc } from "../watch-issues";
import { ada, apply, bo, entity, ids, pair, sync, text } from "./helpers";

describe("conflicts", () => {
  it("update against delete: the delete wins, and only undo brings it back", () => {
    const [a, b] = pair(engineYard());
    const undo = createSceneUndo(a, ada);
    apply(a, { ops: [{ op: "remove", refs: ["crate"] }] }, ada, engine);
    undo.commit({ before: [], after: [] });
    apply(b, { ops: [{ op: "update", ref: "crate", set: { density: 9 } }] }, bo, engine);
    sync(a, b);
    expect(entity(a, "crate")).toBeUndefined();
    expect(entity(b, "crate")).toBeUndefined();
    expect(text(a)).toBe(text(b));

    undo.undo();
    sync(a, b);
    expect(entity(a, "crate")).toMatchObject({ id: "crate", density: 2 });
    expect(text(a)).toBe(text(b));
  });

  it("two creates with one id stay two entities, and validation reports dup-id", () => {
    const [a, b] = pair(engineYard());
    apply(
      a,
      { ops: [{ op: "add", entity: { id: "elevator", type: "marker", at: [10, 10] } }] },
      ada,
      engine,
    );
    apply(
      b,
      { ops: [{ op: "add", entity: { id: "elevator", type: "marker", at: [90, 90] } }] },
      bo,
      engine,
    );
    sync(a, b);
    expect(ids(a).filter((id) => id === "elevator")).toHaveLength(2);
    expect(text(a)).toBe(text(b));
    const codes = validateDoc(a, engine).map((i) => i.code);
    expect(codes).toContain("dup-id");
  });

  it("a reference to an entity someone else deleted becomes a dangling-ref issue", () => {
    const [a, b] = pair(fakeYard());
    apply(a, { ops: [{ op: "remove", refs: ["lift"] }] }, ada, fake);
    apply(
      b,
      { ops: [{ op: "add", entity: { id: "pull2", type: "lever", at: [5, 5], target: "lift" } }] },
      bo,
      fake,
    );
    sync(a, b);
    const issues = validateDoc(a, fake);
    expect(issues.some((i) => i.code === "dangling-ref" && i.entityIds.includes("pull2"))).toBe(
      true,
    );
  });

  it("concurrent inserts and moves in one list neither duplicate nor lose entries", () => {
    const [a, b] = pair(engineYard());
    const before = ids(a);
    apply(
      a,
      {
        ops: [0, 1, 2].map((i) => ({
          op: "add" as const,
          entity: { id: `a${i}`, type: "marker", at: [i, 0] },
          index: 1,
        })),
      },
      ada,
      engine,
    );
    apply(
      b,
      {
        ops: [0, 1, 2].map((i) => ({
          op: "add" as const,
          entity: { id: `b${i}`, type: "marker", at: [i, 0] },
          index: 1,
        })),
      },
      bo,
      engine,
    );
    apply(
      a,
      { ops: [{ op: "addBulk", key: "solid", shapes: [["box", 1, 1, 1, 1]], index: 0 }] },
      ada,
      engine,
    );
    apply(
      b,
      {
        ops: [
          { op: "addBulk", key: "solid", shapes: [["box", 2, 2, 2, 2]], index: 0 },
          { op: "remove", refs: ["~solid:2"] },
        ],
      },
      bo,
      engine,
    );
    sync(a, b);
    const after = ids(a);
    expect(text(a)).toBe(text(b));
    expect(new Set(after).size).toBe(after.length);
    expect(after.sort()).toEqual([...before, "a0", "a1", "a2", "b0", "b1", "b2"].sort());
    expect((JSON.parse(text(a)) as { solid: unknown[] }).solid).toHaveLength(4);
    // Each side's own inserts keep their relative order (each went in at index 1, ahead of the last).
    const merged = ids(a);
    expect(merged.indexOf("a2")).toBeLessThan(merged.indexOf("a1"));
    expect(merged.indexOf("a1")).toBeLessThan(merged.indexOf("a0"));
    expect(merged.indexOf("b2")).toBeLessThan(merged.indexOf("b1"));
  });

  it("concurrent edits to one shape: one whole shape wins", () => {
    const [a, b] = pair(engineYard());
    apply(
      a,
      { ops: [{ op: "update", ref: "crate", set: { shape: ["circle", 1, 2, 30] } }] },
      ada,
      engine,
    );
    apply(
      b,
      { ops: [{ op: "update", ref: "crate", set: { shape: ["box", 7, 8, 9, 10] } }] },
      bo,
      engine,
    );
    sync(a, b);
    const shape = entity(a, "crate")!.shape;
    expect([JSON.stringify(["circle", 1, 2, 30]), JSON.stringify(["box", 7, 8, 9, 10])]).toContain(
      JSON.stringify(shape),
    );
    expect(text(a)).toBe(text(b));
  });

  it("edits to different fields of one entity both survive", () => {
    const [a, b] = pair(engineYard());
    apply(a, { ops: [{ op: "update", ref: "crate", set: { density: 5 } }] }, ada, engine);
    apply(b, { ops: [{ op: "update", ref: "crate", set: { restitution: 0.9 } }] }, bo, engine);
    sync(a, b);
    expect(entity(a, "crate")).toMatchObject({ density: 5, restitution: 0.9 });
  });
});
