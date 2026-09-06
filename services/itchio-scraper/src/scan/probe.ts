import probe from "./nsfw-probe.json";

/**
 * The NSFW scorer: a logistic-regression probe over the SigLIP2 image
 * embedding. Zero-shot prompt contrast (still computed in nsfw.ts as
 * evidence) was ~5% precise on the real corpus — mannequins, animals, text
 * containing "body", and landscapes all outscored actual nudity — so the
 * verdict comes from weights fit on the corpus itself: creator-tagged adult
 * covers (self-cleaned, since the tag is game-level and a quarter of tagged
 * covers are clean art) plus hand-labeled explicit, suggestive, and
 * hard-negative covers. Training data and script: docs/research/nsfw-probe.
 *
 * Because the score is a pure function of the stored embedding, a new set
 * of weights re-scores the whole corpus from the DB (`bun run rescore`)
 * with no cover re-fetch. Swap the weights file, not DETECTOR_VERSION.
 */

/** Identifies the weights that produced a score; written into flag evidence. */
export const PROBE_VERSION: string = probe.version;

/** The image encoder the weights were fit against; must match NSFW_MODEL. */
export const PROBE_MODEL: string = probe.model;

const WEIGHTS = Float32Array.from(probe.weights);
const BIAS: number = probe.bias;

/**
 * Probability that a cover is sexual content (explicit or suggestive), from
 * its L2-normalized embedding. Null when the vector isn't the probe's
 * dimensionality — a different encoder's output must never be scored.
 */
export function probeScore(embedding: ArrayLike<number>): number | null {
  if (embedding.length !== WEIGHTS.length) return null;
  let z = BIAS;
  for (let i = 0; i < WEIGHTS.length; i++) {
    z += (WEIGHTS[i] ?? 0) * (embedding[i] ?? 0);
  }
  if (!Number.isFinite(z)) return null;
  return 1 / (1 + Math.exp(-z));
}

/** Probe dimensionality, for callers validating stored vectors. */
export const PROBE_DIMS = WEIGHTS.length;
