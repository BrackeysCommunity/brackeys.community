/**
 * Recordings in format v1, written once by engine 0.10.0's `runPlaytest` (the
 * last v1 recorder, in world px) and frozen: nothing rewrites them. They prove
 * that a recording made before the format changed still migrates, parses and
 * replays, and say how each replay turns out now that the world is in metres
 * (`replays`). The v3 scenes they were made on are frozen beside them under
 * `scenes/`; the probes' scenes are built in code by their probe modules, as
 * they are now. A script holds world px, as 0.10.0 played it.
 *
 * Writing one takes a checkout of engine 0.10.0 with this directory copied
 * in, running its `runPlaytest` over the fixture.
 */
import { ENGINE_PARITY_SCRIPT } from "../../../../../__tests__/fixtures/parity-script";
import type { InputEdge, InputScript } from "../../../../playtest-types";

/** Where a fixture's run came from: a frozen scene file and a game, or a genre probe. */
export type V1Source =
  | {
      kind: "scene";
      /** The frozen scene, relative to this directory. */
      scene: string;
      /**
       * The engine's test game; `test-game-unjudged` is it without `play.outcome`
       * and `movementActions` (no win, no stuck verdict), so a run plays every
       * scripted tick as `runProbe` does; the platformer,
       * loaded through its project file; or none.
       */
      game: "test-game" | "test-game-unjudged" | "platformer" | null;
    }
  | {
      kind: "probe";
      probe: "turn-tactics" | "roguelike";
      /** Over the probe script's own, as a probe variant sets it. */
      seed?: number;
    };

export type V1Fixture = {
  /** The recording, relative to this directory. */
  file: string;
  source: V1Source;
  /**
   * How a replay on this engine turns out: every one is stale (its scene
   * hash is the v3 document's). `matches` reproduces the recorded end state;
   * `diverges` doesn't, because the simulation it ran changed with the move
   * to metres.
   */
  replays: "matches" | "diverges";
  /** The script `runPlaytest` played to make it; a probe plays its own. */
  script?: InputScript;
  /** How it was made, and what it covers. */
  made: string;
};

/** A list of edges as fixed-length steps: each span between edges holds what is down then. */
export function edgeScript(
  edges: readonly (readonly [number, string, 0 | 1])[],
  ticks: number,
): InputScript {
  const byTick = new Map<number, InputEdge[]>();
  for (const [tick, action, pressed] of edges) {
    byTick.set(tick, [...(byTick.get(tick) ?? []), [tick, action, pressed]]);
  }
  const steps: InputScript["steps"] = [];
  let held: string[] = [];
  let at = 0;
  const span = (until: number) => {
    if (until <= at) return;
    steps.push(held.length > 0 ? { hold: [...held], for: until - at } : { wait: until - at });
    at = until;
  };
  for (const tick of [...byTick.keys()].sort((a, b) => a - b)) {
    span(tick);
    for (const [, action, pressed] of byTick.get(tick)!) {
      held = held.filter((a) => a !== action);
      if (pressed) held.push(action);
    }
  }
  span(ticks);
  return { v: 1, scene: "engine-yard", steps };
}

const ENGINE_YARD = "scenes/engine-yard.json";

export const V1_FIXTURES: readonly V1Fixture[] = [
  {
    file: "engine-yard.parity.recording.json",
    replays: "diverges",
    source: { kind: "scene", scene: ENGINE_YARD, game: "test-game-unjudged" },
    script: edgeScript(
      ENGINE_PARITY_SCRIPT.inputs.map(([t, a, p]) => [t, a, p ? 1 : 0] as const),
      ENGINE_PARITY_SCRIPT.ticks,
    ),
    made: "The engine yard's parity script (__tests__/fixtures/parity-script.ts, 600 ticks) under the test game without its outcome and stuck verdicts on Rapier, its edges played as fixed-length hold steps: walks through the sensor both ways, shoves the crate, pushes up, and ends as script-end.",
  },
  {
    file: "engine-yard.settles.recording.json",
    replays: "matches",
    source: { kind: "scene", scene: ENGINE_YARD, game: null },
    script: { scene: "engine-yard", steps: [{ wait: 60 }], v: 1 },
    made: "The `settles` script of engine-yard.checks.json, gameless on Rapier: sixty idle ticks to script-end.",
  },
  {
    file: "engine-yard.times-out.recording.json",
    replays: "matches",
    source: { kind: "scene", scene: ENGINE_YARD, game: null },
    script: { maxTicks: 30, steps: [{ wait: 60 }], v: 1 },
    made: "The `times-out` script of engine-yard.checks.json, gameless on Rapier: maxTicks 30 cuts a 60-tick wait, ending as timeout.",
  },
  {
    file: "platformer.hop-left.recording.json",
    replays: "diverges",
    source: { kind: "scene", scene: "scenes/test-yard.json", game: "platformer" },
    script: {
      v: 1,
      scene: "test-yard",
      steps: [
        { hold: ["move_left"], for: 30 },
        { hold: ["move_left", "jump"], for: 14 },
        {
          hold: ["move_left"],
          until: { event: { type: "landed", entityId: "~solid:7" } },
          max: 90,
        },
        { wait: 30 },
      ],
    },
    made: "The platformer on its test-yard (scene v3, px) with scripts/scene/examples/hop-left.json on Rapier: runs left, hops and lands on a solid.",
  },
  {
    file: "platformer.start-at.recording.json",
    replays: "diverges",
    source: { kind: "scene", scene: "scenes/test-yard.json", game: "platformer" },
    script: {
      v: 1,
      scene: "test-yard",
      at: [1100, 900],
      steps: [{ hold: ["move_right"], for: 10 }, { wait: 50 }],
    },
    made: "The platformer on its test-yard (scene v3, px) started at a play start (1100, 900) px, above the floor between the spawn and a wall, on Rapier: drops, lands, steps right and stops, so `start.at` is recorded.",
  },
  {
    file: "turn-tactics.commands.recording.json",
    replays: "diverges",
    source: { kind: "probe", probe: "turn-tactics" },
    made: "The turn-tactics genre probe's script (game commands driving a physics-free turns game on a hex grid; its `inspect` edges wake nothing until a command), default seed.",
  },
  {
    file: "roguelike.seed-1.recording.json",
    replays: "matches",
    source: { kind: "probe", probe: "roguelike", seed: 1 },
    made: "The roguelike genre probe's script with seed 1 (its seed-1 variant): seeded room generation, prefabs placed by ctx.instantiate, a spawned explorer and a `descend` command, physics-free.",
  },
];
