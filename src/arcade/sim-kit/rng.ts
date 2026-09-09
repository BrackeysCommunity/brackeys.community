/**
 * The seeded RNG every arcade sim draws from.
 *
 * sfc32 over four uint32 words, seeded through splitmix32. Both are pure
 * 32-bit integer algorithms — `Math.imul`, `>>>`, `<<`, `^` and nothing
 * else — which is the whole reason they were picked over PCG or a
 * float-based LCG: the validator re-runs this in Bun and the client runs it
 * in Safari and Chrome, and 32-bit integer ops are the only arithmetic all
 * three agree on bit for bit.
 *
 * State is four words and nothing more, so `snapshot`/`restore` is enough
 * to resume a stream mid-spin — which is what a co-op spectator joining
 * late needs.
 */

const U32 = 0x1_0000_0000;

export type RngState = readonly [number, number, number, number];

/** splitmix32: one word in, one well-mixed word out. Seeds the four sfc32 words. */
function splitmix32(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x9e37_79b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x21f0_aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a_2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

/**
 * FNV-1a over the UTF-16 code units of a seed string. Daily seeds and run
 * seeds arrive as text from Postgres; this is how they become a word.
 * Code units, not code points, so the same string hashes the same whether
 * or not the engine normalises it.
 */
export function seedFromString(seed: string): number {
  let h = 0x811c_9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x0100_0193) >>> 0;
    h ^= (seed.charCodeAt(i) >>> 8) & 0xff;
    h = Math.imul(h, 0x0100_0193) >>> 0;
  }
  return h >>> 0;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  private constructor(state: RngState) {
    [this.a, this.b, this.c, this.d] = state;
  }

  /** A stream from a seed word or a seed string. */
  static from(seed: number | string): Rng {
    const next = splitmix32(typeof seed === "string" ? seedFromString(seed) : seed >>> 0);
    const rng = new Rng([next(), next(), next(), next()]);
    // sfc32's authors discard the first rounds so a low-entropy seed word
    // does not show through in the first few draws.
    for (let i = 0; i < 12; i++) rng.nextU32();
    return rng;
  }

  static restore(state: RngState): Rng {
    return new Rng(state);
  }

  snapshot(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  clone(): Rng {
    return new Rng(this.snapshot());
  }

  /**
   * A named substream. Two stages that both draw from the parent would
   * shift each other's numbers whenever one of them changes how many draws
   * it makes; a fork per stage means adding a roll to scatter cannot move
   * the settle roll, which keeps old replays valid across sim patches more
   * often than not.
   */
  fork(label: string): Rng {
    const [a, b, c, d] = this.snapshot();
    const mixed = (seedFromString(label) ^ Math.imul(a ^ b ^ c ^ d, 0x9e37_79b9)) >>> 0;
    return Rng.from(mixed);
  }

  nextU32(): number {
    const t = (this.a + this.b + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /**
   * A uniform integer in `[0, bound)`, rejection-sampled so the tail of the
   * u32 range does not bias low values. Never touches a float.
   */
  below(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0) {
      throw new RangeError(`Rng.below needs a positive integer bound, got ${bound}`);
    }
    if (bound === 1) return 0;
    const limit = U32 - (U32 % bound);
    for (;;) {
      const v = this.nextU32();
      if (v < limit) return v % bound;
    }
  }

  /** A uniform integer in `[lo, hi]`, both ends included. */
  range(lo: number, hi: number): number {
    if (hi < lo) throw new RangeError(`Rng.range needs lo <= hi, got ${lo}..${hi}`);
    return lo + this.below(hi - lo + 1);
  }

  /**
   * A fixed-point probability test. `probability` is in FP_ONE units, so
   * `chance(FP_ONE / 4)` is a quarter. Clamped rather than thrown on, since
   * modifier stacks routinely push a probability past either end.
   */
  chance(probability: number, one: number): boolean {
    if (probability <= 0) return false;
    if (probability >= one) return true;
    return this.below(one) < probability;
  }

  /**
   * Index into a weight table. Weights are integers; a zero weight is never
   * picked. Throws on an all-zero table rather than silently returning 0,
   * because that is always a modifier bug and it is much cheaper to find
   * here than in a validator mismatch.
   */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) {
      if (!Number.isInteger(w) || w < 0) {
        throw new RangeError(`Rng.weighted needs non-negative integer weights, got ${w}`);
      }
      total += w;
    }
    if (total === 0) throw new RangeError("Rng.weighted got an all-zero weight table");
    let roll = this.below(total);
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i]!;
      if (roll < 0) return i;
    }
    /* c8 ignore next */
    throw new Error("unreachable: weighted roll fell through its table");
  }

  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("Rng.pick got an empty array");
    return items[this.below(items.length)]!;
  }
}
