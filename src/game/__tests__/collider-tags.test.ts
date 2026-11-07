import { describe, expect, it } from "vite-plus/test";

import { createColliderTags } from "../collider-tags";

describe("createColliderTags", () => {
  it("sets and gets a tag by handle", () => {
    const tags = createColliderTags();
    tags.set(4, { entityId: "~solid:ice:0", behavior: "solid", material: "ice" });
    expect(tags.get(4)).toEqual({ entityId: "~solid:ice:0", behavior: "solid", material: "ice" });
    expect(tags.get(5)).toBeUndefined();
    expect(tags.size).toBe(1);
  });

  it("indexes handles by entity id", () => {
    const tags = createColliderTags();
    tags.set(1, { entityId: "lift", behavior: "mover" });
    tags.set(2, { entityId: "lift", behavior: "mover" });
    tags.set(3, { entityId: "cheese", behavior: "sensor", sensor: "goal" });
    expect(tags.handlesOf("lift").sort((a, b) => a - b)).toEqual([1, 2]);
    expect(tags.handlesOf("cheese")).toEqual([3]);
    expect(tags.handlesOf("nope")).toEqual([]);
  });

  it("re-tagging a handle moves it to the new entity", () => {
    const tags = createColliderTags();
    tags.set(1, { entityId: "a", behavior: "solid" });
    tags.set(1, { entityId: "b", behavior: "solid" });
    expect(tags.handlesOf("a")).toEqual([]);
    expect(tags.handlesOf("b")).toEqual([1]);
    expect(tags.size).toBe(1);
  });

  it("deletes by handle and ignores unknown handles", () => {
    const tags = createColliderTags();
    tags.set(1, { entityId: "a", behavior: "solid" });
    tags.delete(1);
    tags.delete(99);
    expect(tags.get(1)).toBeUndefined();
    expect(tags.handlesOf("a")).toEqual([]);
    expect(tags.size).toBe(0);
  });

  it("clears everything", () => {
    const tags = createColliderTags();
    tags.set(1, { entityId: "a", behavior: "solid" });
    tags.set(2, { entityId: "player", behavior: "player" });
    tags.clear();
    expect(tags.size).toBe(0);
    expect(tags.handlesOf("a")).toEqual([]);
  });

  it("separate tables share nothing", () => {
    const a = createColliderTags();
    const b = createColliderTags();
    a.set(1, { entityId: "x", behavior: "solid" });
    expect(b.get(1)).toBeUndefined();
    expect(b.size).toBe(0);
  });
});
