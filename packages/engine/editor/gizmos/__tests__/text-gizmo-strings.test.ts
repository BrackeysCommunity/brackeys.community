import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../../game/define";
import { pxPerMetreOf } from "../../../game/units";
import { memoryRuntimeView } from "../../../headless/runtime-view";
import { textBoxOf } from "../../../scene/svg";
import type { EntityDef, SceneDefinition } from "../../../scene/types";
import { targetsOf } from "../../commands";
import { gizmoTarget, gizmoTextEnv } from "../target";

const registry = createRegistry(null);
const ppm = pxPerMetreOf(registry);
const VIEW = memoryRuntimeView({
  engine: { locales: { default: "en", available: ["en", "fr"] } },
  docs: {
    strings: {
      signs: {
        kind: "strings",
        v: 1,
        strings: [{ key: "sign.welcome", en: "Welcome to the kitchen", fr: "Bienvenue" }],
      },
    },
  },
});
const block = { key: "sign.welcome", size: 20 };
const sign: EntityDef = { id: "sign", type: "marker", at: [4, 2], behaviors: { text: block } };
const def = { name: "t", entities: [sign] } as SceneDefinition;
const source = (locale?: string) => ({ doc: def, text: gizmoTextEnv(VIEW, locale) });

describe("a keyed text's gizmo box", () => {
  it("is measured in the locale's text, as the scene view draws it", () => {
    const shown = gizmoTarget(def, registry, "sign", source())!.text!;
    const exact = textBoxOf(
      block,
      { at: [4, 2] },
      { pxPerUnit: ppm, strings: { "sign.welcome": "Welcome to the kitchen" } },
    )!.shape;
    expect(shown).toEqual(exact);

    const bracketed = gizmoTarget(def, registry, "sign")!.text!;
    expect(bracketed.hw).not.toBeCloseTo(shown.hw);
    const fr = gizmoTarget(def, registry, "sign", source("fr"))!.text!;
    expect(fr.hw).toBeLessThan(shown.hw);
  });

  it("reaches a selection's targets through targetsOf", () => {
    const [t] = targetsOf(def, registry, ["sign"], source());
    expect(t!.text).toEqual(gizmoTarget(def, registry, "sign", source())!.text);
  });

  it("holds the shown locale's strings, and no font where the locale names none", () => {
    const env = gizmoTextEnv(VIEW);
    expect(env.font).toBeNull();
    expect(env.strings).toEqual({ "sign.welcome": "Welcome to the kitchen" });
    expect(gizmoTextEnv(VIEW, "fr").strings).toEqual({ "sign.welcome": "Bienvenue" });
  });
});
