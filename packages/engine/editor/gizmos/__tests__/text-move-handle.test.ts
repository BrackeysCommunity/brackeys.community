import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../../game/define";
import { pxPerMetreOf } from "../../../game/units";
import { textBoxOf } from "../../../scene/svg";
import type { EntityDef, SceneDefinition } from "../../../scene/types";
import { HANDLE_PX, targetHandles } from "../handles";
import { gizmoTarget } from "../target";

/** Screen px per metre at zoom 1. */
const S = 100;

const registry = createRegistry(null);
const ppm = pxPerMetreOf(registry);
const sceneOf = (...entities: EntityDef[]): SceneDefinition =>
  ({ name: "t", entities }) as SceneDefinition;
const moveOf = (def: SceneDefinition, ref: string) =>
  targetHandles(gizmoTarget(def, registry, ref)!, { scale: S }).find((h) => h.id === "move")!;

describe("a text marker's move handle", () => {
  it("sits under the text in line with its anchor, so it covers none of the glyphs", () => {
    const text = { text: "Évier de cuisine", size: 20 };
    const sign: EntityDef = { id: "sign", type: "marker", at: [4, 2], behaviors: { text } };
    const box = textBoxOf(text, { at: [4, 2] }, { pxPerUnit: ppm })!.shape;
    const move = moveOf(sceneOf(sign), "sign");
    expect(move.at[0]).toBeCloseTo(4);
    expect(move.at[1] - HANDLE_PX / 2 / S).toBeGreaterThan(box.cy + box.hh);
  });

  it("follows the anchor: a bottom-anchored text's handle sits just under its point", () => {
    const sign: EntityDef = {
      id: "sign",
      type: "marker",
      at: [4, 2],
      behaviors: { text: { text: "Hi", size: 20, anchor: [0, 1] } },
    };
    const move = moveOf(sceneOf(sign), "sign");
    expect(move.at[0]).toBeCloseTo(4);
    expect(move.at[1]).toBeGreaterThan(2);
    expect(move.at[1] - 2).toBeLessThan(HANDLE_PX / S);
  });

  it("stays on the point of a marker without text", () => {
    const plain: EntityDef = { id: "m", type: "marker", at: [1, 1] };
    expect(moveOf(sceneOf(plain), "m").at).toEqual([1, 1]);
  });
});
