import type { PuzzleLayout, PuzzleLog, PuzzleMove, PuzzleResult } from "../api.ts";
import { BROKE, DONE, GOING, type Family, type Model, type Status } from "./kit.ts";

// Where a log left the machine: the family model's own answer, before a
// countdown is read against it. It is for drawing and for the golden
// vectors; the server's reply is the only result shown as final.
export interface Outcome {
  status: Status;
  at: number;
  master: boolean;
}

export type See = (at: number, state: number[]) => void;

/**
 * Plays a log against a layout, and what is left of it after the solve
 * against the inner panel when there is one: sim/puzzle's RunLog, mirrored
 * move for move. No move stamped past the horizon is played.
 */
export function play(
  family: Family,
  layout: PuzzleLayout,
  inner: PuzzleLayout | undefined,
  log: PuzzleLog,
  horizon: number,
  see?: See,
): Outcome {
  const end = log.end ?? 0;
  const [status, at, used] = feed(family.start(layout), log.moves, end, horizon, 0, see);
  const out: Outcome = { status, at, master: false };
  if (status === DONE && inner && used < log.moves.length) {
    const [last] = feed(family.start(inner), log.moves.slice(used), end, horizon, at, see);
    out.master = last === DONE;
  }
  return out;
}

/**
 * What an outcome counts as against a countdown: sim/puzzle's judge,
 * mirrored. fail unless solved, and clean when cleanPct of the countdown
 * was left. With a server clock (elapsed >= 0) the solve counts from no
 * earlier than the grace before the log arrived.
 */
export function judge(
  out: Outcome,
  fail: PuzzleResult,
  countdown: number,
  elapsed: number,
  grace: number,
  cleanPct: number,
): PuzzleResult {
  if (out.status !== DONE) return fail;
  const seen = elapsed >= 0 ? Math.max(out.at, elapsed - grace) : out.at;
  const clean = countdown > 0 && (countdown - seen) * 100 >= countdown * cleanPct;
  return { solved: true, clean, master: out.master, at: out.at };
}

/** The cells a limited play is read by, as sim/puzzle reads them; times in ms. */
export interface PlaySheet {
  grace: number;
  cleanPct: number;
  maxPlay: number;
  maxMoves: number;
}

/** What one play is held to: sim/puzzle's Limits. elapsed < 0 is no server clock. */
export interface PlayLimits {
  countdown: number;
  elapsed: number;
  bench?: boolean;
  /** The haywire a failed machine does; a bench rig has none. */
  haywire?: string;
}

/**
 * A log against a machine within its limits: sim/puzzle's Play, mirrored
 * line for line. Late past the limit, a failure past the most moves a log
 * may hold, and otherwise the replay to the horizon, judged. inner is the
 * master's hidden panel; a bench rig has none.
 */
export function playLimited(
  family: Family,
  layout: PuzzleLayout,
  inner: PuzzleLayout | undefined,
  log: PuzzleLog,
  lim: PlayLimits,
  sheet: PlaySheet,
): PuzzleResult {
  const fail: PuzzleResult = { solved: false, clean: false, at: 0 };
  let limit = sheet.maxPlay;
  if (!lim.bench) {
    fail.haywire = lim.haywire;
    limit = lim.countdown + sheet.grace;
  }
  if (lim.elapsed >= 0 && lim.elapsed > limit) return { ...fail, late: true };
  if (log.moves.length > sheet.maxMoves) return fail;
  const horizon = lim.elapsed >= 0 ? Math.min(limit, lim.elapsed + sheet.grace) : limit;
  const out = play(family, layout, lim.bench ? undefined : inner, log, horizon);
  return judge(out, fail, lim.countdown, lim.elapsed, sheet.grace, sheet.cleanPct);
}

// feed plays moves into one panel that was started at base ms, and reports
// its status, the ms it changed or stopped at, and the moves it took.
function feed(
  model: Model,
  moves: PuzzleMove[],
  end: number,
  horizon: number,
  base: number,
  see: See | undefined,
): [Status, number, number] {
  const stop = (st: Status, at: number, used: number): [Status, number, number] => {
    see?.(base + at, model.snapshot());
    return [st, base + at, used];
  };
  let last = 0;
  for (const [i, move] of moves.entries()) {
    const m = { ...move, at: move.at - base };
    if (m.at < last || m.at > horizon - base) return stop(GOING, last, i);
    const [st, at, took] = take(model, m);
    if (!took) return stop(st, at, i);
    last = m.at;
    see?.(base + m.at, model.snapshot());
    if (st !== GOING) return stop(st, m.at, i + 1);
  }
  const [st, at] = model.run(Math.min(Math.max(end - base, last), horizon - base));
  return stop(st, at, moves.length);
}

// take plays one move into a model as the server's replay does: the model
// runs to the stamp, then takes the move. took is false when the clock
// ended the machine first, and the move was never played.
function take(model: Model, m: PuzzleMove): [Status, number, boolean] {
  const [ran, at] = model.run(m.at);
  if (ran !== GOING) return [ran, at, false];
  return [model.apply(m), m.at, true];
}

/**
 * One play as it happens: the model on screen, and the hand-off from a
 * solved machine to the hidden panel behind it, which starts at the ms of
 * the solve. Stamps in and out are ms since arming.
 */
export class Run {
  /** 0 the machine, 1 a master's hidden panel. */
  panel: 0 | 1 = 0;
  /** The ms the panel on screen started at. */
  base = 0;
  model: Model;

  constructor(
    private readonly family: Family,
    layout: PuzzleLayout,
    private readonly inner?: PuzzleLayout,
  ) {
    this.model = family.start(layout);
  }

  /** Runs the clock to a ms. GOING with the panel changed is the hidden panel opening. */
  run(at: number): [Status, number] {
    const [st, when] = this.model.run(at - this.base);
    return this.settle(st, this.base + when);
  }

  /** Plays one stamped move. took is false when the clock ended the panel before it. */
  feed(m: PuzzleMove): [Status, number, boolean] {
    const [st, when, took] = take(this.model, { ...m, at: m.at - this.base });
    return [...this.settle(st, this.base + when), took];
  }

  private settle(st: Status, at: number): [Status, number] {
    if (st !== DONE || this.panel === 1 || !this.inner) return [st, at];
    this.panel = 1;
    this.base = at;
    this.model = this.family.start(this.inner);
    return [GOING, at];
  }
}

// How many moves of a log moved back may keep their own stamps.
const KEPT_STAMPS = 8;

/**
 * The stamps of a log moved back by lead ms, never out of order, tried on
 * a fresh run. A move that breaks the machine only because it was moved (a
 * swipe timed from the first touch no longer fits the gap before it) keeps
 * its own stamp.
 */
export function movedBack(fresh: () => Run, moves: PuzzleMove[], lead: number): number[] {
  const kept = new Set<number>();
  for (;;) {
    const stamps: number[] = [];
    const run = fresh();
    let floor = 0;
    let live = true;
    let broke = -1;
    for (const [i, m] of moves.entries()) {
      floor = Math.max(floor, kept.has(i) ? m.at : Math.trunc(m.at - lead), 0);
      stamps.push(floor);
      if (!live) continue;
      const [st, , took] = run.feed({ ...m, at: floor });
      if (st === GOING) continue;
      live = false;
      if (st === BROKE && took) broke = i;
    }
    if (broke < 0 || kept.has(broke) || kept.size >= KEPT_STAMPS) return stamps;
    kept.add(broke);
  }
}
