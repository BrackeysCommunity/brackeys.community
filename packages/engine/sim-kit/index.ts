/**
 * Deterministic simulation helpers: a seeded RNG, a canonical digest and
 * fixed-point maths, bit-identical across JS engines. No dependencies, and
 * every import keeps its `.ts` extension so the files run after plain type
 * stripping.
 */
export { canonicalize, digest32, digestOf } from "./digest.ts";
export {
  FP_HALF,
  FP_MAX_SAFE,
  FP_ONE,
  FP_SHIFT,
  fp,
  fpApply,
  fpClamp,
  fpDiv,
  fpLerp,
  fpMul,
  fpRatio,
  fpRound,
  fpToString,
} from "./fixed.ts";
export { Rng, type RngState, seedFromString } from "./rng.ts";
