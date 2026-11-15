import { z } from "zod";

import { musicClock } from "../../audio/clock";
import { LATENCY_COMMAND } from "../../game/commands";
import { defineGame } from "../../game/define";
import type { EngineContext, GameCommand } from "../../game/types";
import type { TickInput } from "../../input/stream";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import type { InputAction } from "../../types";
import { tickInput, type GenreProbe, type ViewRun } from "./harness";

const ID = "rhythm-tap";
const TAP = "tap";
const CHART = "chart";
/** Raised once per beat, when it is judged. */
const JUDGED = `${ID}:judged`;

const SONG = "song";
const SONG_PATCH = "song-click";

/** How far from its beat a tap may land, either way, for each grade; whole ms. */
const WINDOWS = [
  ["perfect", 5],
  ["great", 15],
  ["good", 30],
] as const;
const LATEST = WINDOWS[WINDOWS.length - 1]![1];

type Grade = (typeof WINDOWS)[number][0] | "miss";

type ChartRow = { id: string; ms: number };

/** The chart table: each beat's time into the song, ms, off the tick grid so only a tap's offset reaches one. */
export const CHART_ROWS: readonly ChartRow[] = [
  500, 1000, 1520, 2010, 2500, 3030, 3500, 4000, 4480,
].map((ms, i) => ({ id: `b${i}`, ms }));

/**
 * The chart plays twice, the song restarted at each pass's tick. The same
 * taps fall at the same song times in both; only the `@latency` in force
 * differs, so the passes judge them differently.
 */
const PASSES = [
  { songAt: 20, latencyAt: 0, latencyMs: 25 },
  { songAt: 350, latencyAt: 330, latencyMs: 40 },
] as const;

/**
 * Each tap of a pass: ticks after the song's start, and the offset inside
 * the tick. They land 25 ms behind the beats they aim at, as a player
 * hearing the song 25 ms late taps, so the first pass's calibration puts
 * them back on the beat. No tap aims at beat 4.
 */
const TAPS: readonly (readonly [ticks: number, offset: number])[] = [
  [31, 0.5],
  [62, 0.22],
  [91, 0.08],
  [122, 0.28],
  [183, 0.24],
  [212, 0.7],
  [241, 0.98],
  [270, 0.3],
];

type Expected = { grade: Grade; delta: number | null };

/**
 * What each pass must earn, beat by beat, and how many of its taps no beat
 * was within reach of. Under the second pass's 40 ms the third tap lands
 * 42 ms early and strays, so beat 2 is missed with beat 4.
 */
export const EXPECTED: readonly { beats: readonly Expected[]; strays: number }[] = [
  {
    beats: [
      { grade: "perfect", delta: 0 },
      { grade: "great", delta: 12 },
      { grade: "good", delta: -27 },
      { grade: "perfect", delta: 3 },
      { grade: "miss", delta: null },
      { grade: "perfect", delta: -1 },
      { grade: "good", delta: 20 },
      { grade: "great", delta: 8 },
      { grade: "perfect", delta: 0 },
    ],
    strays: 0,
  },
  {
    beats: [
      { grade: "great", delta: -15 },
      { grade: "perfect", delta: -3 },
      { grade: "miss", delta: null },
      { grade: "great", delta: -12 },
      { grade: "miss", delta: null },
      { grade: "good", delta: -16 },
      { grade: "perfect", delta: 5 },
      { grade: "great", delta: -7 },
      { grade: "great", delta: -15 },
    ],
    strays: 1,
  },
];

/** Past the last pass's song start, longer than the chart: its last window closes 273 ticks in. */
const LAST_TICK = PASSES[PASSES.length - 1]!.songAt + 300;

export type Judgement = {
  pass: number;
  beat: number;
  grade: Grade;
  delta: number | null;
  tick: number;
};

export type RhythmSnapshot = {
  /** The pass whose song is playing; -1 before the first. */
  pass: number;
  /** The tick the playing song started on; null before the first. */
  songStart: number | null;
  /**
   * The latency taps are judged with, ms: `ctx.input.latencyMs()` as the
   * last `@latency` left it. Kept here because a world save doesn't carry
   * the input's own, so a restored run judges as the live one did.
   */
  latencyMs: number;
  judged: Judgement[];
  /** Per pass, taps no beat was within reach of. */
  strays: number[];
};

function gradeOf(delta: number): Grade | null {
  const d = Math.abs(delta);
  for (const [grade, window] of WINDOWS) if (d <= window) return grade;
  return null;
}

/** Whole ms; `|| 0` keeps a rounded -0 from differing from the 0 a save reads back. */
const wholeMs = (ms: number): number => Math.round(ms) || 0;

function mismatch(s: RhythmSnapshot): string | null {
  for (const [pass, want] of EXPECTED.entries()) {
    if (s.strays[pass] !== want.strays)
      return `pass ${pass} had ${s.strays[pass]} strays, not ${want.strays}`;
    for (const [beat, w] of want.beats.entries()) {
      const got = s.judged.find((j) => j.pass === pass && j.beat === beat);
      if (!got) return `pass ${pass} never judged beat ${beat}`;
      if (got.grade !== w.grade || got.delta !== w.delta)
        return `pass ${pass} judged beat ${beat} ${got.grade} (${got.delta}), not ${w.grade} (${w.delta})`;
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
  tables: {
    [CHART]: {
      description: "The beats to tap, in song order.",
      row: { ms: z.number().int().nonnegative().describe("The beat's time into the song, ms.") },
    },
  },
  play: {
    results: ["cleared", "lost"],
    outcome({ snapshot: s }) {
      const beats = CHART_ROWS.length * PASSES.length;
      if (s.judged.length < beats) return null;
      const wrong = mismatch(s);
      if (wrong) return { result: "lost", cause: wrong };
      return { result: "cleared", cause: "each pass earned its expected grades" };
    },
  },
  createRuntime(ctx: EngineContext) {
    let pass = -1;
    let songStart: number | null = null;
    let latencyMs = 0;
    let judged: Judgement[] = [];
    let open = new Set<number>();
    let strays: number[] = [];

    // The song plays at its own rate from its first tick: the position the shell's audio clock gives it.
    const clock = musicClock({
      tickMs: ctx.time.tickMs,
      anchor: () =>
        songStart === null ? null : { startTick: songStart, startTime: 0, offsetMs: 0, rate: 1 },
      driftMs: () => 0,
      latencyMs: () => latencyMs,
    });

    const chart = (): readonly ChartRow[] =>
      (ctx.project?.table(CHART) ?? []) as readonly ChartRow[];

    function judge(beat: number, grade: Grade, delta: number | null) {
      open.delete(beat);
      judged.push({ pass, beat, grade, delta, tick: ctx.tick });
      ctx.emit({ type: JUDGED, at: { x: 0, y: 0 }, data: { pass, beat, grade, delta } });
    }

    /** The open beat nearest `at` (song ms) within the widest window; the earlier on a tie. */
    function nearest(at: number, rows: readonly ChartRow[]): number | null {
      let best: number | null = null;
      for (const beat of open) {
        const d = Math.abs(at - rows[beat]!.ms);
        if (d > LATEST) continue;
        if (best === null || d < Math.abs(at - rows[best]!.ms)) best = beat;
      }
      return best;
    }

    /** Where a tap fell in the song, judged: its tick's song position, its offset into the tick, less the latency. */
    const tapMs = (a: InputAction, songMs: number): number =>
      songMs + (a.offset ?? 0) * ctx.time.tickMs - clock.latencyMs;

    return {
      onLoad() {
        pass = -1;
        songStart = null;
        latencyMs = 0;
        judged = [];
        open = new Set();
        strays = PASSES.map(() => 0);
      },
      beforeStep(_dtMs, actions) {
        if (ctx.input.commands().some((c) => c.name === LATENCY_COMMAND))
          latencyMs = ctx.input.latencyMs();
        const rows = chart();
        const next = PASSES[pass + 1];
        if (next && ctx.tick === next.songAt) {
          pass++;
          songStart = ctx.tick;
          open = new Set(rows.keys());
          if (pass > 0) ctx.present.audio.music(null, { fadeMs: 0 });
          ctx.present.audio.music(SONG, { at: "tick" });
        }
        const songMs = clock.simPositionMs(ctx.tick);
        if (songMs === null) return;
        for (const a of actions) {
          if (a.action !== TAP || !a.pressed) continue;
          const at = tapMs(a, songMs);
          const beat = nearest(at, rows);
          if (beat === null) {
            strays[pass]!++;
            continue;
          }
          const delta = wholeMs(at - rows[beat]!.ms);
          judge(beat, gradeOf(delta)!, delta);
        }
        // A beat whose latest window closes before the next tick's earliest tap can't be hit any more.
        const nextMs = clock.simPositionMs(ctx.tick + 1)! - clock.latencyMs;
        for (const beat of [...open].sort((a, b) => a - b)) {
          if (rows[beat]!.ms + LATEST < nextMs) judge(beat, "miss", null);
        }
      },
      snapshot() {
        return {
          pass,
          songStart,
          latencyMs,
          judged: judged.map((j) => ({ ...j })),
          strays: [...strays],
        };
      },
      // Rebuilt field by field: the save's canonical text sorts keys, and the end digest reads them in order.
      restore(s) {
        pass = s.pass;
        songStart = s.songStart;
        latencyMs = s.latencyMs;
        judged = s.judged.map(({ pass, beat, grade, delta, tick }) => ({
          pass,
          beat,
          grade,
          delta,
          tick,
        }));
        open = new Set(
          pass < 0
            ? []
            : [...chart().keys()].filter(
                (beat) => !judged.some((j) => j.pass === pass && j.beat === beat),
              ),
        );
        strays = [...s.strays];
      },
    };
  },
});

const latency = (ms: number): GameCommand => ({ name: LATENCY_COMMAND, args: { ms } });

/**
 * The run's input: each pass's `@latency`, as a host sends one at start and
 * after a calibration, then each tap pressed at its offset and released
 * half a tick into the next slot. An input script steps whole ticks, so
 * these offsets reach the run only as `TickInput`s.
 */
export function rhythmTicks(): TickInput[] {
  return PASSES.flatMap(({ songAt, latencyAt, latencyMs }) => [
    tickInput(latencyAt, { commands: [latency(latencyMs)] }),
    ...TAPS.flatMap(([ticks, offset]) => [
      tickInput(songAt + ticks, { actions: [{ action: TAP, pressed: true, offset }] }),
      tickInput(songAt + ticks + 1, { actions: [{ action: TAP, pressed: false, offset: 0.5 }] }),
    ]),
  ]);
}

/** A click every half second, looped: the song, made from a patch so the probe ships no audio file. */
const SONG_FILES = [
  {
    path: `audio/${SONG}.json`,
    json: { kind: "sound", v: 1, bus: "music", loop: true, variants: [{ clip: SONG_PATCH }] },
  },
  {
    path: `audio/${SONG_PATCH}.json`,
    json: { kind: "synth", v: 1, wave: "square", freq: 660, sustainMs: 40, decayMs: 460 },
  },
];

/** An empty stage: the chart is a data table, and nothing moves. */
const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name: "rhythm-tap-probe",
  bounds: [0, 0, 8, 4.5],
  settings: { gravity: [0, 0], physics: "none" },
  entities: [],
};

/**
 * Where the view run's fake backend differs from what the simulation asked
 * of the audio: each pass's song must start on the music bus at the
 * context time its tick began (a tick steps one frame in, so tick `t` is
 * at `t / rate` seconds), the first stopped before the second plays.
 * Null when they agree.
 */
export function rhythmAudioMismatch(view: ViewRun, rate: number): string | null {
  const log = view.audio;
  if (!log) return "the view run had no audio backend";
  const plays = log.flatMap((c) => (c.op === "play" && c.opts.bus === "music" ? [c] : []));
  if (plays.length !== PASSES.length)
    return `the song played ${plays.length} times, not ${PASSES.length}`;
  for (const [i, play] of plays.entries()) {
    const want = PASSES[i]!.songAt / rate;
    const when = play.opts.when ?? play.at;
    if (Math.abs(when - want) > 1e-9) return `pass ${i}'s song starts at ${when}s, not ${want}s`;
  }
  const first = plays[0]!;
  const stopped = log.findIndex((c) => c.op === "stop" && c.voice === first.voice);
  if (stopped < 0 || stopped > log.indexOf(plays[1]!))
    return "the first pass's song wasn't stopped before the second";
  return null;
}

/**
 * Sub-tick offsets and the audio clock: nine beats of a chart table, eight
 * of them between ticks, tapped at offsets inside the tick and judged in
 * song ms against the clock's `simPositionMs` less `ctx.input.latencyMs()`.
 * The chart plays twice with the same taps under two `@latency`s, and the
 * run clears only when each pass's grades, distances and strays match
 * `EXPECTED`, which whole ticks or one latency for both would not. The
 * judgements are in the snapshot, so the replay check proves a replay
 * reproduces each; the view run plays the song through a fake backend.
 */
export const rhythmTapProbe: GenreProbe<RhythmSnapshot> = {
  id: ID,
  rows: ["rhythm"],
  game,
  scene,
  project: { tables: { [CHART]: CHART_ROWS }, files: SONG_FILES },
  ticks: rhythmTicks(),
  script: { v: 2, scene: scene.name, maxTicks: LAST_TICK, steps: [{ wait: LAST_TICK }] },
  expect: { result: "cleared", maxTicks: LAST_TICK },
  variants: [
    // In the first pass, three beats judged: the restored run keeps its 25 ms.
    { name: "saved-mid-chart", saveAt: 100 },
    // Between the passes, after the second `@latency` and before its song.
    { name: "saved-between-passes", saveAt: 340 },
  ],
  recordPresentation: true,
  view: true,
  audio: true,
  timeoutMs: 60_000,
};
