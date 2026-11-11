import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import type { SceneDefinition } from "../../scene/types";
import { buildInspectorModel } from "../inspector-model";
import { lookupRef } from "../refs";

describe("buildInspectorModel: a body's settings", () => {
  it("puts a prop's gravity, damping, rotation and CCD fields in Physics", () => {
    const doc: SceneDefinition = {
      v: 1,
      name: "b",
      bounds: [0, 0, 100, 100],
      entities: [
        {
          id: "crate",
          type: "prop",
          shape: ["box", 50, 50, 10, 10],
          density: 1,
          restitution: 0,
          gravityScale: 0.5,
          ccd: true,
        },
      ],
    };
    const model = buildInspectorModel(createRegistry(), [lookupRef(doc, "crate")!]);
    const section = (path: string) =>
      model.sections.find((s) => s.fields.some((f) => f.path === path))?.id;
    for (const path of [
      "gravityScale",
      "linearDamping",
      "angularDamping",
      "fixedRotation",
      "ccd",
    ]) {
      expect(section(path), path).toBe("physics");
    }
  });
});

describe("buildInspectorModel: a prop's mass and surface", () => {
  const doc: SceneDefinition = {
    v: 1,
    name: "b",
    bounds: [0, 0, 100, 100],
    entities: [
      { id: "crate", type: "prop", shape: ["box", 50, 50, 10, 10], density: 2, restitution: 0.5 },
    ],
  };
  const fields = () =>
    buildInspectorModel(createRegistry(), [lookupRef(doc, "crate")!]).sections.flatMap(
      (s) => s.fields,
    );
  const field = (path: string) => fields().find((f) => f.path === path)!;

  it("puts density, restitution and friction in Physics beside the body settings", () => {
    for (const path of ["density", "restitution", "friction"])
      expect(field(path).section, path).toBe("physics");
  });

  it("gives each unset body field its default, and friction what it falls back to", () => {
    expect(field("gravityScale").defaultValue).toBe(1);
    expect(field("linearDamping").defaultValue).toBe(0);
    expect(field("angularDamping").defaultValue).toBe(0);
    expect(field("fixedRotation").defaultValue).toBe(false);
    expect(field("ccd").defaultValue).toBe(false);
    expect(field("friction").defaultValue).toBeUndefined();
    expect(field("friction").placeholder).toBe("material's");
    expect(field("density").defaultValue).toBeUndefined();
  });
});
