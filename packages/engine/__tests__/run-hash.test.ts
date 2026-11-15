// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import { resolveTime } from "../game/time";
import type { GameSettingsEngine } from "../project/kinds/game-settings";
import { heldProject } from "../project/runtime-view";
import { runHash } from "../runtime/play-session";
import { expandScene } from "../scene/expand";
import { physicsFreeFiles, scene, withHeldDoc } from "./fixtures/held-project";

const registry = createRegistry();
const yard = expandScene(scene("yard"), registry);
const time = resolveTime({});

const hashWith = (engine: GameSettingsEngine) => {
  const held = withHeldDoc(physicsFreeFiles(), "game-settings.json", {
    kind: "game-settings",
    v: 2,
    engine,
    game: {},
  });
  const view = heldProject(held.files, registry, { projectId: "free", name: "Free" }).runtime;
  return runHash(yard, time, registry, view);
};

describe("the game settings' engine block in a run's hash", () => {
  const base = hashWith({});

  it("leaves out the presentation-only locales", () => {
    expect(hashWith({ locales: { available: ["en", "fr"], default: "en" } })).toBe(base);
    expect(
      hashWith({
        locales: {
          available: ["en", "fr"],
          default: "fr",
          fallback: { fr: ["en"] },
          fonts: { fr: "f" },
        },
      }),
    ).toBe(base);
  });

  it("still joins the settings a run reads", () => {
    expect(hashWith({ physics: "none" })).not.toBe(base);
    expect(hashWith({ tickRate: 30 })).not.toBe(base);
    expect(hashWith({ tickRate: 30, locales: { available: ["en"], default: "en" } })).toBe(
      hashWith({ tickRate: 30 }),
    );
  });
});
