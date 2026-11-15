import { describe, expect, it } from "vite-plus/test";

import { TEXT_SIZE_DEFAULT, TEXT_SIZE_MAX, TEXT_SIZE_MIN } from "../../game/behaviors/text";
import { createRegistry } from "../../game/define";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import { buildInspectorModel } from "../inspector-model";
import { lookupRef } from "../refs";

const def: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "sign",
  bounds: [0, 0, 20, 20],
  entities: [
    { id: "it", type: "marker", at: [5, 3], behaviors: { text: { text: "Hi", size: 20 } } },
  ] as NonNullable<SceneDefinition["entities"]>,
};

describe("the text behavior's size field", () => {
  it("is a whole-pixel slider from 1 to 128 px, so everyday sizes sit inside the track", () => {
    const model = buildInspectorModel(createRegistry(), [lookupRef(def, "it")!], { def });
    const size = model.sections
      .flatMap((s) => s.fields)
      .flatMap((f) => [f, ...(f.children ?? [])])
      .find((f) => f.path === "behaviors.text.size");
    expect(size?.widget).toMatchObject({
      kind: "number",
      unit: "px",
      min: TEXT_SIZE_MIN,
      max: TEXT_SIZE_MAX,
      step: 1,
    });
    expect(size?.widget).not.toHaveProperty("exclusiveMin");
    expect(size?.defaultValue).toBe(TEXT_SIZE_DEFAULT);
    expect(size?.value).toBe(20);
  });
});
