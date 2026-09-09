/**
 * The cross-engine determinism check `docs/game-drafts/05-arcade-on-brackeys.md`
 * gates every other arcade milestone on: the same seed and input log must
 * produce byte-identical output in the browser the player runs and in the
 * Bun container the validator runs, or a run that was played honestly gets
 * rejected and nobody can reproduce why.
 *
 * It prints one digest per vector and a digest over all of them. Run it
 * under each engine and compare the last line:
 *
 *   bun scripts/arcade-determinism.ts
 *   node --experimental-strip-types scripts/arcade-determinism.ts
 *
 * For a browser engine, import `runVectors` in a page and compare the same
 * digest by eye. The committed fixture at
 * `src/arcade/en-prison/sim/__tests__/golden-vectors.json` is what the test
 * suite checks against on every run, so a drift caught in one engine is
 * caught in CI too.
 *
 * `--write` regenerates the fixture. Do that only when a sim change is
 * meant to change results, and say so in the commit: every stored run and
 * every leaderboard entry validated against the old numbers is invalidated
 * by it, which is what `sim_version` in the schema is for.
 */

import { writeFileSync } from "node:fs";

import type { Bet } from "../src/arcade/en-prison/sim/bets.ts";
import {
  nextTable,
  openRun,
  runSummary,
  settleTable,
  spinSeed,
} from "../src/arcade/en-prison/sim/run.ts";
import { type SpinInput, spin, spinSummary } from "../src/arcade/en-prison/sim/spin.ts";
import { plainWheel, ROTOR_SPEEDS, type WheelState } from "../src/arcade/en-prison/sim/state.ts";
import {
  checkBets,
  closeTable,
  openTable,
  playSpin,
  tableSummary,
} from "../src/arcade/en-prison/sim/table.ts";
import {
  plainDeflectors,
  plainPockets,
  withGaff,
  withTrait,
} from "../src/arcade/en-prison/sim/upgrades.ts";
import { canonicalize, digest32 } from "../src/arcade/sim-kit/digest.ts";

const FIXTURE = new URL(
  "../src/arcade/en-prison/sim/__tests__/golden-vectors.json",
  import.meta.url,
);

const SPREAD: readonly Bet[] = [
  { kind: "straight", amount: 5, number: 17 },
  { kind: "split", amount: 2, numbers: [17, 18] },
  { kind: "corner", amount: 2, corner: 17 },
  { kind: "dozen", amount: 3, dozen: 1 },
  { kind: "evenMoney", amount: 10, pick: "red" },
];

function gaffedWheel(): WheelState {
  // A funnel, as `07` describes it: a spring on 16 throwing into a sticky
  // gaff on 17, with a dominant diamond aiming the drop at the pair.
  let pockets = withGaff(plainPockets(), 17, 3);
  pockets = withTrait(pockets, 17, "sticky");
  pockets = withTrait(pockets, 16, "spring", 1);
  pockets = withGaff(pockets, 32, 2);
  pockets = withTrait(pockets, 32, "hot");
  const deflectors = plainDeflectors();
  deflectors[2] = { kind: "dominant", sector: "voisins" };
  return plainWheel({ pockets, deflectors, zeroRule: "la-partage", nudgesPerTable: 2 });
}

function twoBallWheel(): WheelState {
  return plainWheel({
    balls: [
      { id: "ball-1", material: "rubber", size: "small", chipped: false },
      { id: "ball-2", material: "lead", size: "large", chipped: true },
    ],
    rotorSpeed: ROTOR_SPEEDS.fast,
    zeroRule: "en-prison",
    nudgesPerTable: 2,
  });
}

/**
 * Every vector exercises a different corner of the stage graph: a plain
 * spin, a nudged one, a gaffed wheel, a slow rotor, and a two-ball spin
 * with two materials, a chipped ball and a jackpot chance.
 */
export const VECTORS: ReadonlyArray<{
  name: string;
  wheel: WheelState;
  input: SpinInput;
  seed: string;
}> = [
  {
    name: "plain / perfect launch",
    wheel: plainWheel(),
    input: { bets: SPREAD, balls: [{ ballId: "ball-1", launchTick: 0 }] },
    seed: "en-prison:golden:1",
  },
  {
    name: "plain / missed launch",
    wheel: plainWheel(),
    input: { bets: SPREAD, balls: [{ ballId: "ball-1", launchTick: 119 }] },
    seed: "en-prison:golden:2",
  },
  {
    name: "plain / nudged",
    wheel: plainWheel(),
    input: { bets: SPREAD, balls: [{ ballId: "ball-1", launchTick: 0, nudgeTicks: [493, 500] }] },
    seed: "en-prison:golden:3",
  },
  {
    name: "gaffed pockets / la partage",
    wheel: gaffedWheel(),
    input: { bets: SPREAD, balls: [{ ballId: "ball-1", launchTick: 42, nudgeTicks: [497] }] },
    seed: "en-prison:golden:4",
  },
  {
    name: "slow rotor",
    wheel: plainWheel({ rotorSpeed: ROTOR_SPEEDS.slow }),
    input: { bets: SPREAD, balls: [{ ballId: "ball-1", launchTick: 7 }] },
    seed: "en-prison:golden:5",
  },
  {
    name: "two balls / fast rotor / en prison",
    wheel: twoBallWheel(),
    input: {
      bets: SPREAD,
      balls: [
        { ballId: "ball-1", launchTick: 0, nudgeTicks: [495] },
        { ballId: "ball-2", launchTick: 61 },
      ],
    },
    seed: "en-prison:golden:6",
  },
];

/**
 * A whole run, played by a fixed policy: a sixth of the bankroll on red and
 * a chip on 17 every spin, the same launch ticks every table, a nudge on
 * the fourth spin.
 *
 * The policy is not meant to be good. It is meant to be *fixed*, so this
 * vector exercises what the spin vectors cannot — the table loop, the
 * imprisoned stakes, the nudge allowance draining across spins, the quota
 * check and the run ending on it — and produces one number that moves if
 * any of them changes.
 */
export function scriptedRun(seed: string) {
  let run = openRun(seed);
  const tables: ReturnType<typeof tableSummary>[] = [];

  while (run.status === "playing") {
    const next = nextTable(run);
    let table = openTable(plainWheel({ zeroRule: "en-prison" }), next.rules, run.bankroll);

    for (let s = 0; s < next.rules.spins; s++) {
      const outside = Math.max(next.rules.minimumBet, Math.floor(table.bankroll / 6));
      const bets: Bet[] = [
        { kind: "evenMoney", amount: outside, pick: "red" },
        { kind: "straight", amount: 1, number: 17 },
      ];
      const balls = [
        { ballId: "ball-1", launchTick: s * 13, nudgeTicks: s === 3 ? [s * 13 + 495] : undefined },
      ];
      if (checkBets(table, bets, balls)) break;
      table = playSpin(table, bets, balls, spinSeed(run, next.index, s));
    }

    const close = closeTable(table);
    tables.push(tableSummary(table, close));
    run = settleTable(run, close);
  }

  return { run: runSummary(run), tables };
}

export function runVectors(): { vectors: Array<{ name: string; digest: number }>; digest: number } {
  const vectors = VECTORS.map((vector) => ({
    name: vector.name,
    digest: digest32(canonicalize(spinSummary(spin(vector.wheel, vector.input, vector.seed)))),
  }));
  vectors.push({
    name: "scripted run / twelve tables",
    digest: digest32(canonicalize(scriptedRun("en-prison:golden:run"))),
  });
  return { vectors, digest: digest32(canonicalize(vectors)) };
}

if (import.meta.main ?? process.argv[1]?.includes("arcade-determinism")) {
  const result = runVectors();
  for (const vector of result.vectors) {
    console.log(`${String(vector.digest).padStart(10)}  ${vector.name}`);
  }
  console.log(`\nall vectors: ${result.digest}`);

  if (process.argv.includes("--write")) {
    writeFileSync(FIXTURE, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`\nwrote ${FIXTURE.pathname}`);
  }
}
