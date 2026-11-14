// @vitest-environment node
import { readFileSync } from "node:fs";

import { defineGame, Script, type EngineContext, type EntityTypeDef } from "@jams/engine/game";
import { runProbe } from "@jams/engine/headless";
import { createRegistry, expandScene, parseSceneOrThrow } from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import { platformerGame } from "..";
import type { GrappleAnchorSystem } from "../entities/grapple-anchor";
import {
  createPlayerEntity,
  PLAYER_HEIGHT,
  PLAYER_TYPE,
  type PlayerEntity,
} from "../entities/player";
import type { ConstructSystem } from "../entities/shaper-constructs";
import type { PlayerSystem } from "../systems/player";
import { TYPE } from "../type-names";
import { PLATFORMER_TYPES } from "../types";
import golden from "./fixtures/m1-golden.json";

/**
 * The player type's system rewritten as a script: the script makes the
 * actor when it attaches, writes its pose and destroys it when it leaves,
 * and the type keeps only a thin system that finds the scripts through
 * `ctx.entity` and `ctx.findBehaviors` for the runtime. The platformer
 * played that way must replay the golden traces bit for bit.
 */

/** How many actors the script made in a run, so a pass can't come from the original system. */
let made = 0;

class PlayerScript extends Script({
  name: "platformer/player-script",
  description: "The runner's actor: made at attach, posed from its body, destroyed at detach.",
  fields: {},
}) {
  actor: PlayerEntity | undefined;

  awake(): void {
    const [x, y] = this.entity.record.at as [number, number];
    this.actor = createPlayerEntity(
      this.ctx,
      { x, y },
      {
        anchors: this.ctx.system<GrappleAnchorSystem>(TYPE.anchor),
        forces: this.ctx.system<ConstructSystem>(TYPE.construct)?.forces,
      },
      this.entity.id,
    );
    made++;
    this.syncPose(true);
  }

  /** The actor's feet, as the pose. */
  syncPose(snap: boolean): void {
    if (!this.actor) return;
    const { x, y } = this.actor.getPosition();
    this.ctx.poses.set(this.entity.id, x, y + PLAYER_HEIGHT / 2, 0, snap ? { snap } : undefined);
  }

  onDestroy(): void {
    this.actor?.destroy();
    this.actor = undefined;
  }
}

/** What the platformer's runtime asks of the player type, answered from the scripts. */
function createScriptedPlayerSystem(ctx: EngineContext): PlayerSystem {
  return {
    spawn() {},
    despawn() {},
    clear() {},
    size: () => ctx.findBehaviors(PlayerScript).length,
    actor: (id) => ctx.entity(id)?.getBehavior(PlayerScript)?.actor,
    syncPoses() {
      for (const player of ctx.findBehaviors(PlayerScript)) player.syncPose(false);
    },
  };
}

const scriptedTypes: readonly EntityTypeDef[] = PLATFORMER_TYPES.map((t) =>
  t.type === PLAYER_TYPE
    ? {
        ...t,
        system: createScriptedPlayerSystem,
        behaviors: { required: { [PlayerScript.behavior.name]: {} } },
      }
    : t,
);

const scriptedGame = defineGame({
  ...platformerGame,
  types: scriptedTypes,
  behaviors: [...(platformerGame.behaviors ?? []), PlayerScript],
});

type Trace = (typeof golden.scripts)[keyof typeof golden.scripts];

/** Through JSON, as the golden file holds it. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const registry = createRegistry(scriptedGame);
const scene = expandScene(
  parseSceneOrThrow(
    readFileSync(new URL("../scenes/test-yard.json", import.meta.url), "utf8"),
    registry,
  ),
  registry,
);

describe("the platformer's player system as a script", () => {
  for (const [name, trace] of Object.entries(golden.scripts) as [string, Trace][]) {
    it(`replays the ${name} golden trace bit for bit`, async () => {
      made = 0;
      const report = runProbe({
        rapier: await import("@dimforge/rapier2d"),
        game: scriptedGame,
        registry,
        scene,
        ticks: trace.ticks,
        inputs: trace.inputs as [number, string, 0 | 1][],
      });
      expect(report.load.ok).toBe(true);
      expect(report.stats.perType.player).toBe(1);
      expect(made).toBeGreaterThan(0);
      expect(plain(report.final)).toEqual(trace.final);
      expect(plain(report.events)).toEqual(trace.events);
    });
  }
});
