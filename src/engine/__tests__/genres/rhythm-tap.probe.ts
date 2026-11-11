import { defineGame } from "../../game/define";
import type { EngineContext } from "../../game/types";
import type { TickInput } from "../../input/stream";
import type { SceneDefinition } from "../../scene/types";
import type { InputAction } from "../../types";
import { tickInput, type GenreProbe } from "./harness";

const ID = "rhythm-tap";
const TAP = "tap";
/** Raised once per beat, when it is judged. */
const JUDGED = `${ID}:judged`;

/** Every time below is in thousandths of a tick, the resolution a recording keeps offsets at. */
const TICK = 1000;
/** How far from its beat a tap may land, either way, for each grade. */
const WINDOWS = [
  ["perfect", 50],
  ["great", 250],
  ["good", 500],
] as const;
const LATEST = WINDOWS[WINDOWS.length - 1]![1];

type Grade = (typeof WINDOWS)[number][0] | "miss";

/** The chart: beats between ticks as well as on them, so only a tap's offset can hit one. */
const BEATS = [30_250, 60_500, 90_750, 120_000, 150_400, 180_600, 210_900, 240_000, 270_450];

/** Where each tap lands: a tick, and the offset inside it that a whole-tick clock would lose. */
const TAPS: readonly (readonly [tick: number, offset: number])[] = [
  [30, 0.27],
  [60, 0.7],
  [91, 0.1],
  [119, 0.95],
  // No tap near beat 150.4: it is missed.
  [180, 0.6],
  [211, 0.2],
  [240, 0],
  [270, 0],
];

/** What the taps above must earn, beat by beat; the 240 and 270 taps share an offset and differ only by their beat's. */
export const EXPECTED: readonly { beat: number; grade: Grade; delta: number | null }[] = [
  { beat: 0, grade: "perfect", delta: 20 },
  { beat: 1, grade: "great", delta: 200 },
  { beat: 2, grade: "good", delta: 350 },
  { beat: 3, grade: "perfect", delta: -50 },
  { beat: 4, grade: "miss", delta: null },
  { beat: 5, grade: "perfect", delta: 0 },
  { beat: 6, grade: "good", delta: 300 },
  { beat: 7, grade: "perfect", delta: 0 },
  { beat: 8, grade: "good", delta: -450 },
];

const LAST_TICK = Math.ceil((BEATS[BEATS.length - 1]! + LATEST) / TICK) + 10;

export type Judgement = { beat: number; grade: Grade; delta: number | null; tick: number };

export type RhythmSnapshot = {
  judged: Judgement[];
  /** Taps no beat was within reach of. */
  strays: number;
};

function gradeOf(delta: number): Grade | null {
  const d = Math.abs(delta);
  for (const [grade, window] of WINDOWS) if (d <= window) return grade;
  return null;
}

/**
 * The tap's time in thousandths of a tick, on the run's clock (`ctx.tick`,
 * which a world save puts back); the offset is already quantised to them.
 */
const tapTime = (tick: number, a: InputAction): number =>
  tick * TICK + Math.round((a.offset ?? 0) * TICK);

function mismatch(judged: readonly Judgement[]): string | null {
  for (const [i, want] of EXPECTED.entries()) {
    const got = judged.find((j) => j.beat === want.beat);
    if (!got) return `beat ${i} was never judged`;
    if (got.grade !== want.grade || got.delta !== want.delta) {
      return `beat ${i} was judged ${got.grade} (${got.delta}), not ${want.grade} (${want.delta})`;
    }
  }
  return null;
}

const game = defineGame<RhythmSnapshot>({
  id: ID,
  types: [],
  actions: [{ action: TAP, keys: [" "], description: "Tap on the beat." }],
  input: { subTick: true },
  time: { kind: "fixed" },
  play: {
    results: ["cleared", "lost"],
    outcome({ snapshot: s }) {
      if (s.strays > 0) return { result: "lost", cause: `${s.strays} taps fell between beats` };
      if (s.judged.length < BEATS.length) return null;
      const wrong = mismatch(s.judged);
      if (wrong) return { result: "lost", cause: wrong };
      return { result: "cleared", cause: "every beat earned its expected grade" };
    },
  },
  createRuntime(ctx: EngineContext) {
    let judged: Judgement[] = [];
    let open = new Set<number>();
    let strays = 0;

    function judge(beat: number, grade: Grade, delta: number | null) {
      open.delete(beat);
      judged.push({ beat, grade, delta, tick: ctx.tick });
      ctx.emit({ type: JUDGED, at: { x: 0, y: 0 }, data: { beat, grade, delta } });
    }

    /** The open beat nearest `at` within the widest window; the earlier on a tie. */
    function nearest(at: number): number | null {
      let best: number | null = null;
      for (const beat of open) {
        const d = Math.abs(at - BEATS[beat]!);
        if (d > LATEST) continue;
        if (best === null || d < Math.abs(at - BEATS[best]!)) best = beat;
      }
      return best;
    }

    return {
      onLoad() {
        judged = [];
        open = new Set(BEATS.keys());
        strays = 0;
      },
      beforeStep(_dtMs, actions) {
        for (const a of actions) {
          if (a.action !== TAP || !a.pressed) continue;
          const at = tapTime(ctx.tick, a);
          const beat = nearest(at);
          if (beat === null) {
            strays++;
            continue;
          }
          const delta = at - BEATS[beat]!;
          judge(beat, gradeOf(delta)!, delta);
        }
        // A beat whose latest window closes before the next tick starts can't be hit any more.
        const next = (ctx.tick + 1) * TICK;
        for (const beat of [...open].sort((a, b) => a - b)) {
          if (BEATS[beat]! + LATEST < next) judge(beat, "miss", null);
        }
      },
      snapshot() {
        return { judged: judged.map((j) => ({ ...j })), strays };
      },
      // Rebuilt field by field: the save's canonical text sorts keys, and the end digest reads them in order.
      restore(s) {
        judged = s.judged.map(({ beat, grade, delta, tick }) => ({ beat, grade, delta, tick }));
        open = new Set([...BEATS.keys()].filter((beat) => !judged.some((j) => j.beat === beat)));
        strays = s.strays;
      },
    };
  },
});

/**
 * The run's input: each tap pressed at its offset, and released half a tick
 * into the next slot. An input script steps whole ticks, so these offsets
 * reach the run only as `TickInput`s.
 */
export function rhythmTicks(): TickInput[] {
  return TAPS.flatMap(([tick, offset]) => [
    tickInput(tick, { actions: [{ action: TAP, pressed: true, offset }] }),
    tickInput(tick + 1, { actions: [{ action: TAP, pressed: false, offset: 0.5 }] }),
  ]);
}

/** An empty stage: the chart lives in the game, and nothing moves. */
const scene: SceneDefinition = {
  v: 4,
  game: ID,
  name: "rhythm-tap-probe",
  bounds: [0, 0, 8, 4.5],
  settings: { gravity: [0, 0], physics: "none" },
  entities: [],
};

/**
 * Sub-tick offsets on: nine beats, eight of them between ticks, tapped at
 * offsets inside the tick. Each tap is graded by how far its offset puts it
 * from the nearest open beat, an untapped beat is missed once its window
 * closes, and the run clears only when every grade and distance matches
 * `EXPECTED`, which the same taps on whole ticks would not. The judgements
 * are in the snapshot, so the replay check proves a replay reproduces each.
 */
export const rhythmTapProbe: GenreProbe<RhythmSnapshot> = {
  id: ID,
  rows: ["rhythm"],
  pending: { rhythm: "M23 (the audio clock, and offsets an input script can carry)" },
  game,
  scene,
  ticks: rhythmTicks(),
  script: { v: 2, scene: scene.name, maxTicks: LAST_TICK, steps: [{ wait: LAST_TICK }] },
  expect: { result: "cleared", maxTicks: LAST_TICK },
  // Between the third and fourth taps, three beats judged and six open.
  variants: [{ name: "saved-mid-chart", saveAt: 100 }],
  timeoutMs: 30_000,
};
