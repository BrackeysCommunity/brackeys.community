declare module "virtual:pack" {
  export const palette: Record<string, string>;
  export const names: Record<string, string>;
}

declare module "virtual:puzzle-sheet" {
  /** The sheet cells the mock gateway plays by. Times in ms. */
  const sheet: {
    grace: number;
    cleanPct: number;
    maxPlay: number;
    maxMoves: number;
    practiceUses: number;
    practiceMax: number;
    gifts: { practice: number; gives: string }[];
  };
  export default sheet;
}

declare module "virtual:rigs" {
  import type { PuzzleLayout, PuzzleMove } from "./api.ts";

  export interface GoldenRig {
    level: number;
    tier: number;
    compact: boolean;
    countdown: number;
    layout: PuzzleLayout;
    inner: PuzzleLayout;
    /** The first moves of the kit's own solve. */
    hints: PuzzleMove[];
  }
  const rigs: Record<string, GoldenRig[]>;
  export default rigs;
}

declare module "virtual:party-rigs" {
  import type { PuzzleLayout, PuzzleMove } from "./api.ts";

  export interface PartyRig {
    family: string;
    seats: number;
    shape: number;
    level: number;
    tier: number;
    countdown: number;
    /** The whole layout. */
    layout: PuzzleLayout;
    /** Each seat's dealt part, seat 0 first. */
    parts: PuzzleLayout[];
    /** The rule's own merged solve, every move seated. */
    solve: PuzzleMove[];
  }
  const rigs: Record<string, PartyRig[]>;
  export default rigs;
}
