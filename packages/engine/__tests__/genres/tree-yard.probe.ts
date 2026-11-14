import { readdirSync, readFileSync } from "node:fs";

import { createRegistry, defineGame } from "../../game/define";
import type { EngineContext, GameDefinition, PlayState } from "../../game/types";
import type { InputScriptV2 } from "../../headless/playtest-types";
import { parseScene } from "../../scene/parse";
import { parsePrefab, prefabLibrary } from "../../scene/prefab";
import type { Prefab, SceneDefinition } from "../../scene/types";
import type { GenreProbe } from "./harness";
import { behaviorsGame, type BehaviorPoses } from "./side-view-behaviors.probe";

const YARD = "tree-yard";
const RIDER = "rider/hero";
/** How close the rider must come to lift-stop, m: the yard's script's `near`. */
const WITHIN = 0.3;
const scenesDir = new URL("../../scenes/", import.meta.url);

function carried(state: PlayState<BehaviorPoses>): boolean {
  const hero = state.world.pose?.(RIDER);
  const stop = state.world.pose?.("lift-stop");
  return !!hero && !!stop && Math.hypot(hero.x - stop.x, hero.y - stop.y) <= WITHIN;
}

const yard = behaviorsGame({
  id: YARD,
  seats: 1,
  join: "auto",
  physics: "rapier",
  results: ["carried"],
  focus: RIDER,
  outcome: (state) =>
    carried(state)
      ? { result: "carried", cause: "the lift carried the rider to lift-stop", entityId: RIDER }
      : null,
});

/** The behaviors-only game, which also places a turret under the tweening carrier as the scene loads. */
const yardGame: GameDefinition<BehaviorPoses> = defineGame<BehaviorPoses>({
  ...yard,
  createRuntime(ctx: EngineContext) {
    const runtime = yard.createRuntime(ctx);
    return {
      ...runtime,
      onLoad() {
        ctx.instantiate("turret", [0, 0.8], { parent: "carrier", local: true });
      },
    };
  },
});

function yardPrefabs() {
  const registry = createRegistry(yardGame);
  const dir = new URL("prefabs/", scenesDir);
  const prefabs: Prefab[] = [];
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".asset.json"))
    .sort()) {
    const parsed = parsePrefab(readFileSync(new URL(name, dir), "utf8"), registry);
    if (!parsed.ok) throw new Error(`${name}: ${JSON.stringify(parsed.issues)}`);
    prefabs.push(parsed.prefab);
  }
  return prefabLibrary(prefabs);
}

function yardScene(): SceneDefinition {
  const parsed = parseScene(
    readFileSync(new URL(`${YARD}.json`, scenesDir), "utf8"),
    createRegistry(yardGame),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return { ...parsed.def, game: YARD };
}

/**
 * The engine project's `tree-yard` played headless from its input script:
 * a rider carried on a follower's attached deck, a turret swinging under a
 * tweening marker, and a spawned room whose nested prefabs go with its node.
 */
export const treeYardProbe: GenreProbe<BehaviorPoses> = {
  id: YARD,
  rows: ["platformer"],
  pending: { platformer: "M23 (audio), M25 (tilemaps)" },
  game: yardGame,
  scene: yardScene(),
  prefabs: yardPrefabs(),
  script: JSON.parse(
    readFileSync(new URL(`${YARD}.script.json`, scenesDir), "utf8"),
  ) as InputScriptV2,
  expect: { result: "carried" },
};
