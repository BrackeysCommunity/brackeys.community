declare module "virtual:pack" {
  export const palette: Record<string, string>;
  export const names: Record<string, string>;
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
