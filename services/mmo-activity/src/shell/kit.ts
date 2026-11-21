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

export interface SceneHost {
  readonly surface: HTMLElement; // the play area; the scene owns its children
  readonly layout: PuzzleLayout;
  // The shell's running model; read it, never step it. The shell may swap
  // it for a fresh one, so read it from the host each frame.
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
}

export interface Scene {
  frame(at: number): void; // draw the model at this ms
  hint(m: PuzzleMove): void; // show one hint move
  destroy(): void;
}

export interface Family {
  readonly id: string;
  start(layout: PuzzleLayout): Model;
  mount(host: SceneHost): Scene;
}
