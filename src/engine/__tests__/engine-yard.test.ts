// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import { runProbe } from "../headless/headless";
import { SENSOR_ENTER } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { formatScene } from "../scene/format";
import { parseScene } from "../scene/parse";
import type { SceneDefinition } from "../scene/types";
import { validateScene } from "../scene/validate";
import type { RapierModule } from "../types";
import { engineYard } from "./fixtures/engine-yard.expanded";
import { testGame, type TestGameSnapshot } from "./fixtures/test-game";

const text = readFileSync(new URL("../scenes/engine-yard.json", import.meta.url), "utf8");
const engine = createRegistry();
const game = createRegistry(testGame);

let rapier: RapierModule;
let def: SceneDefinition;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
  const parsed = parseScene(text, engine);
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => i.message).join("\n"));
  def = parsed.def;
});

describe("engine-yard.json", () => {
  it("is canonical", () => {
    expect(formatScene(def).text).toBe(text);
  });

  it("expands to the hand-built runtime fixture under any registry", () => {
    expect(expandScene(def, engine)).toEqual(engineYard());
    expect(expandScene(def, game)).toEqual(engineYard());
  });

  it("validates clean", () => {
    expect(validateScene(def, engine)).toEqual([]);
    expect(validateScene(def, game)).toEqual([]);
  });

  it("walks the test game's avatar right into the zone", () => {
    const report = runProbe<TestGameSnapshot>({
      rapier,
      game: testGame,
      registry: game,
      scene: expandScene(def, game),
      ticks: 180,
      hold: ["right"],
    });
    expect(report.load.ok).toBe(true);
    expect(report.final!.position.x).toBeGreaterThan(3);
    expect(report.events).toContainEqual(
      expect.objectContaining({ type: SENSOR_ENTER, entityId: "zone", other: "avatar" }),
    );
  });
});
