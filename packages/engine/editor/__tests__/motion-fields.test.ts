import { describe, expect, it } from "vite-plus/test";

import { tweenChannels } from "../../game/behaviors/tween";
import { createRegistry } from "../../game/define";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import {
  articled,
  buildInspectorModel,
  kindsPhrase,
  withArticle,
  type ModelField,
} from "../inspector-model";
import { lookupRef } from "../refs";

const engine = createRegistry();

const scene = (entity: Record<string, unknown>): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "motion",
  bounds: [0, 0, 20, 20],
  entities: [{ id: "it", ...entity } as NonNullable<SceneDefinition["entities"]>[number]],
});

const fieldsOf = (def: SceneDefinition): ModelField[] => {
  const all: ModelField[] = [];
  const walk = (f: ModelField) => {
    all.push(f);
    for (const c of f.children ?? []) walk(c);
  };
  for (const s of buildInspectorModel(engine, [lookupRef(def, "it")!], { def }).sections)
    for (const f of s.fields) walk(f);
  return all;
};

const field = (def: SceneDefinition, path: string) => {
  const found = fieldsOf(def).find((f) => f.path === path);
  expect(found, path).toBeDefined();
  return found!;
};

describe("motion behavior fields", () => {
  const tweened = scene({
    type: "marker",
    at: [5, 3],
    behaviors: { tween: { tweens: [{ to: { y: 4 }, duration: 30 }] } },
  });
  const tween = (path: string) => field(tweened, `behaviors.tween.tweens.0.${path}`);

  it("shows an unset tween's delay, repeat, ease and yoyo at their defaults", () => {
    expect(tween("delay").defaultValue).toBe(0);
    expect(tween("repeat").defaultValue).toBe(0);
    expect(tween("ease").defaultValue).toBe("linear");
    expect(tween("yoyo").defaultValue).toBe(false);
  });

  it("labels each ease in words, the name after it", () => {
    const ease = tween("ease").widget;
    expect(ease.kind).toBe("select");
    const labels = (ease as { options: { value: unknown; label: string }[] }).options;
    expect(labels.find((o) => o.value === "linear")?.label).toBe("Linear");
    expect(labels.find((o) => o.value === "sineInOut")?.label).toBe("Sine in-out (sineInOut)");
    expect(labels.find((o) => o.value === "quadIn")?.label).toBe("Quad in (quadIn)");
  });

  it("names the event an unset emit raises", () => {
    expect(tween("emit.type").placeholder).toBe("tween:end");
  });

  it("numbers list items from 1", () => {
    expect(field(tweened, "behaviors.tween.tweens.0").title).toBe("Tween 1");
  });

  it("shows an unset anim offset at 0 and an unset emitter rate as the preset's", () => {
    const def = scene({
      type: "marker",
      at: [5, 3],
      behaviors: {
        sprite: { asset: "hero" },
        anim: { source: "hero", clip: "idle" },
        emitter: { preset: "sparks" },
      },
    });
    expect(field(def, "behaviors.anim.offset").defaultValue).toBe(0);
    expect(field(def, "behaviors.emitter.rate").placeholder).toBe("from preset");
  });

  it("titles a camera region's ease by what it measures, and says it frames its bounds", () => {
    const def = scene({ type: "camera-region", shape: ["box", 5, 5, 3, 2, 0] });
    expect(field(def, "ease").title).toBe("Ease time");
    expect(field(def, "shape").description).toMatch(/axis-aligned/);
  });
});

describe("tweenChannels", () => {
  it("names only the channels `to` gives, since a `from` alone never moves one", () => {
    expect(tweenChannels({ to: { x: 1 }, from: { alpha: 0 } } as never)).toEqual(["x"]);
    expect(tweenChannels({ to: { x: 1, alpha: undefined } })).toEqual(["x"]);
  });
});

describe("kind phrases", () => {
  it("puts the right article before each word, and none in the bare form", () => {
    expect(withArticle("atlas")).toBe("an atlas");
    expect(withArticle("Entity")).toBe("an Entity");
    expect(withArticle("sensor")).toBe("a sensor");
    expect(articled(["animation", "atlas"])).toBe("an animation or an atlas");
    expect(articled([])).toBe("an asset");
    expect(kindsPhrase(["animation", "atlas"])).toBe("animation or atlas");
    expect(kindsPhrase([])).toBe("asset");
  });
});
