import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { expandScene } from "../../scene/expand";
import { parseSceneOrThrow } from "../../scene/parse";
import type { RuntimeEntity, SceneDefinition } from "../../scene/types";
import yard from "../../scenes/engine-yard.json";
import { createGesturePreview, expandRefs } from "../gesture";

const registry = createRegistry();
const doc: SceneDefinition = parseSceneOrThrow(yard, registry);

/** A runtime mirroring the doc's expansion that records every call. */
function fakeRuntime(def: SceneDefinition) {
  const held = new Map(expandScene(def, registry).entities.map((e) => [e.id, e]));
  const calls: { op: string; ids: string[] }[] = [];
  return {
    held,
    calls,
    update(entities: RuntimeEntity[]) {
      calls.push({ op: "update", ids: entities.map((e) => e.id) });
      for (const e of entities) held.set(e.id, e);
      return { ok: true };
    },
    add(entities: RuntimeEntity[]) {
      calls.push({ op: "add", ids: entities.map((e) => e.id) });
      for (const e of entities) held.set(e.id, e);
      return { ok: true };
    },
    remove(ids: string[]) {
      calls.push({ op: "remove", ids });
      for (const id of ids) held.delete(id);
    },
  };
}

describe("expandRefs", () => {
  it("expands only the refs asked for, bulk entries keeping their index", () => {
    const out = expandRefs(doc, registry, ["~solid:2", "lift", "readme", "nope"]);
    const full = new Map(expandScene(doc, registry).entities.map((e) => [e.id, e]));
    expect([...out.keys()].sort()).toEqual(["lift", "~solid:2"]);
    expect(out.get("~solid:2")).toEqual(full.get("~solid:2"));
    expect(out.get("lift")).toEqual(full.get("lift"));
  });
});

describe("createGesturePreview", () => {
  it("pushes a move through update only, and restores it on null", () => {
    const runtime = fakeRuntime(doc);
    const preview = createGesturePreview({ registry, getDoc: () => doc, runtime });
    const before = runtime.held.get("crate");
    expect(preview.preview({ ops: [{ op: "move", refs: ["crate"], by: [0.64, 0] }] })).toBe(true);
    expect(runtime.calls).toEqual([{ op: "update", ids: ["crate"] }]);
    expect(runtime.held.get("crate")).toMatchObject({ shape: { cx: 12.64, cy: 9.4 } });
    expect(preview.def()?.entities?.find((e) => e.id === "crate")?.shape).toEqual([
      "circle",
      12.64,
      9.4,
      0.2,
    ]);

    preview.preview({ ops: [{ op: "move", refs: ["crate"], by: [1.28, 0] }] });
    expect(runtime.held.get("crate")).toMatchObject({ shape: { cx: 13.28 } });

    preview.preview(null);
    expect(runtime.held.get("crate")).toEqual(before);
    expect(runtime.calls.every((c) => c.op === "update")).toBe(true);
    expect(preview.active()).toBe(false);
    expect(doc.entities?.find((e) => e.id === "crate")?.shape).toEqual(["circle", 12, 9.4, 0.2]);
  });

  it("puts back what a new preview no longer changes", () => {
    const runtime = fakeRuntime(doc);
    const preview = createGesturePreview({ registry, getDoc: () => doc, runtime });
    const avatar = runtime.held.get("avatar");
    preview.preview({ ops: [{ op: "move", refs: ["avatar"], by: [0.1, 0] }] });
    preview.preview({ ops: [{ op: "move", refs: ["crate"], by: [0.1, 0] }] });
    expect(runtime.held.get("avatar")).toEqual(avatar);
    expect(runtime.calls.at(-1)?.op).toBe("update");
    expect(runtime.calls.at(-1)?.ids.sort()).toEqual(["avatar", "crate"]);
  });

  it("previews bulk refs without a base, and adds and removes when a batch does", () => {
    const runtime = fakeRuntime(doc);
    const preview = createGesturePreview({ registry, getDoc: () => doc, runtime });
    preview.preview({ ops: [{ op: "move", refs: ["~solid:1"], by: [0, -0.32] }] });
    expect(runtime.held.get("~solid:1")).toMatchObject({ shape: { cy: 4.68 } });

    preview.preview({ ops: [{ op: "remove", refs: ["~solid:0"] }] });
    // Removing the first entry shifts the rest down one index.
    expect(runtime.held.has("~solid:2")).toBe(false);
    expect(runtime.held.get("~solid:0")).toMatchObject({ shape: { cx: 0.2 } });

    preview.preview(null);
    const restored = new Map(expandScene(doc, registry).entities.map((e) => [e.id, e]));
    expect(runtime.held).toEqual(restored);
  });

  it("puts the runtime back and reports false for a batch that doesn't apply", () => {
    const runtime = fakeRuntime(doc);
    const preview = createGesturePreview({ registry, getDoc: () => doc, runtime });
    preview.preview({ ops: [{ op: "move", refs: ["crate"], by: [0.1, 0] }] });
    expect(preview.preview({ ops: [{ op: "move", refs: ["missing"], by: [0.01, 0] }] })).toBe(
      false,
    );
    expect(runtime.held.get("crate")).toMatchObject({ shape: { cx: 12 } });
    expect(preview.def()).toBeNull();
  });

  it("restores against the document as it is now, after a commit moved it", () => {
    let current = doc;
    const runtime = fakeRuntime(doc);
    const preview = createGesturePreview({ registry, getDoc: () => current, runtime });
    preview.preview({ ops: [{ op: "move", refs: ["crate"], by: [0.64, 0] }] });
    const moved = structuredClone(doc);
    moved.entities!.find((e) => e.id === "crate")!.shape = ["circle", 12.64, 9.4, 0.2];
    current = moved;
    const calls = runtime.calls.length;
    preview.preview(null);
    // The runtime already shows what the commit wrote, so nothing is pushed.
    expect(runtime.calls).toHaveLength(calls);
  });
});
