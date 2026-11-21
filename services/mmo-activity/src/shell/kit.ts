import type { PuzzleLayout, PuzzleMove } from "../api.ts";

export type Status = 0 | 1 | 2; // going, done, broke: the kit's Status

export const GOING = 0;
export const DONE = 1;
export const BROKE = 2;

// The integer model of one family: sim/puzzle's Play, mirrored.
export interface Model {
  run(at: number): [Status, number];
  apply(m: PuzzleMove): Status;
  snapshot(): number[];
}

/** A machine played move by move: the clock does nothing to it. */
export abstract class Untimed {
  run(at: number): [Status, number] {
    return [GOING, at];
  }
}

/** Whether x is a whole number from 0 up to, not including, n. */
export function within(x: number, n: number): boolean {
  return Number.isInteger(x) && x >= 0 && x < n;
}

/** DONE once a solve is complete, GOING before. */
export function until(done: boolean): Status {
  return done ? DONE : GOING;
}

export interface SceneHost {
  readonly surface: HTMLElement; // the play area; the scene owns its children
  readonly layout: PuzzleLayout;
  // The shell's running model: never keep or step it. The shell may swap
  // it, so read it from the host each frame.
  readonly model: Model;
  readonly compact: boolean;
  readonly guide: PuzzleMove | undefined;
  // One input. The shell arms on the first call, stamps At, records the
  // log and applies the move to the model.
  move(a: number, b?: number, c?: number): Status;
  // Starts the clock with no move, for a gesture that is timed before its
  // first move exists. It does nothing once the machine is armed.
  arm(): void;
  now(): number; // ms since arming; 0 at rest
  // The hint lit now, if one is. The shell lights it and puts it out.
  hinted(): PuzzleMove | undefined;
  // How far a touch landed from its mark, for sizing pieces on real phones.
  dropped(missPx: number, hitPx: number, landed: boolean, ev: PointerEvent): void;
}

export interface Scene {
  frame(at: number): void; // draw the model at this ms
  destroy(): void;
}

export interface Family {
  readonly id: string;
  // How long this family's hints stay lit, when 3 s is too short.
  readonly hintMs?: number;
  start(layout: PuzzleLayout): Model;
  mount(host: SceneHost): Scene;
}
