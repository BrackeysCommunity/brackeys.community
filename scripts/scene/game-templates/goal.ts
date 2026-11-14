import type { GameNames } from ".";

/** The goal script's behavior name, as the scene's goal sensor carries it. */
export const goalScriptName = (names: Pick<GameNames, "id">): string => `${names.id}/goal`;

/**
 * `goal.ts`, a behavior preset's win as a script on the goal sensor: the
 * hero entering it raises `REACHED` once and loses its seat, so its
 * character slows to a stop. It saves whether it fired.
 */
export function goalFile(): string {
  return [
    `import {`,
    `  PLAYER_INPUT,`,
    `  Script,`,
    `  type Entity,`,
    `  type JsonValue,`,
    `  type PlayerInputSystem,`,
    `  type StepEvent,`,
    `} from "@jams/engine/game";`,
    ``,
    `import { GAME_ID, HERO, REACHED } from "./types";`,
    ``,
    `/** On a goal sensor: the hero entering it wins the run. */`,
    `export class Goal extends Script({`,
    `  name: \`\${GAME_ID}/goal\`,`,
    `  description: "Wins the run when the hero enters this sensor.",`,
    `  fields: {},`,
    `}) {`,
    `  reached = false;`,
    ``,
    `  onSensorEnter(other: Entity, e: StepEvent) {`,
    `    if (this.reached || other.type !== HERO) return;`,
    `    this.reached = true;`,
    `    this.ctx.emit({ type: REACHED, entityId: this.entity.id, other: other.id, at: e.at });`,
    `    // The win freezes the hero: with no seat, its character slows to a stop.`,
    `    this.ctx.behavior<PlayerInputSystem>(PLAYER_INPUT.name)?.detach(other.id);`,
    `  }`,
    ``,
    `  // A world save keeps whether this goal has fired.`,
    `  save() {`,
    `    return this.reached;`,
    `  }`,
    ``,
    `  restore(state: JsonValue) {`,
    `    this.reached = state === true;`,
    `  }`,
    `}`,
    ``,
  ].join("\n");
}
