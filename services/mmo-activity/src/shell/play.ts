import type { PuzzleLayout, PuzzleLog, PuzzleMove } from "../api.ts";
import { DONE, GOING, type Family, type Model, type Status } from "./kit.ts";

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
    const [ran, at] = model.run(m.at);
    if (ran !== GOING) return stop(ran, at, i);
    last = m.at;
    const st = model.apply(m);
    see?.(base + m.at, model.snapshot());
    if (st !== GOING) return stop(st, m.at, i + 1);
  }
  const [st, at] = model.run(Math.min(Math.max(end - base, last), horizon - base));
  return stop(st, at, moves.length);
}
