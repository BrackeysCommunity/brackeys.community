# @jams/engine/sim-kit

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`FP_HALF`](#fp_half) · [`FP_MAX_SAFE`](#fp_max_safe) · [`FP_ONE`](#fp_one) · [`FP_SHIFT`](#fp_shift) · [`Rng`](#rng) · [`RngState`](#rngstate) · [`canonicalize`](#canonicalize) · [`digest32`](#digest32) · [`digestOf`](#digestof) · [`fp`](#fp) · [`fpApply`](#fpapply) · [`fpClamp`](#fpclamp) · [`fpDiv`](#fpdiv) · [`fpLerp`](#fplerp) · [`fpMul`](#fpmul) · [`fpRatio`](#fpratio) · [`fpRound`](#fpround) · [`fpToString`](#fptostring) · [`seedFromString`](#seedfromstring)

## `FP_HALF`

_const_ in `sim-kit/fixed.ts`

```ts
declare const FP_HALF: number;
```

## `FP_MAX_SAFE`

_const_ in `sim-kit/fixed.ts`

The largest fixed-point magnitude two of which can be multiplied without
leaving exact integer arithmetic: sqrt(2^53) rounded down to a round
number. Nothing in a sim should come near it; the guard is for modifier
stacks that multiply without bound.

```ts
declare const FP_MAX_SAFE = 90000000;
```

## `FP_ONE`

_const_ in `sim-kit/fixed.ts`

```ts
declare const FP_ONE = 1000000;
```

## `FP_SHIFT`

_const_ in `sim-kit/fixed.ts`

Fixed-point arithmetic for anything that decides an outcome.

Values are plain integers scaled by `FP_ONE`, not a wrapper type — a
branded number would be nicer but it does not survive the JSON round trip
through the input log, and the lint guard plus these helpers are what
actually keep floats out.

Six decimal places: `fpMul` peaks at 1e6 × 1e6 = 1e12, well inside the
2^53 exact-integer range, so every operation here is exact as long as
callers keep magnitudes under `FP_MAX_SAFE`. `assertFp` is the check.

```ts
declare const FP_SHIFT = 6;
```

## `Rng`

_class_ in `sim-kit/rng.ts`

```ts
declare class Rng {
    private a;
    private b;
    private c;
    private d;
    private constructor();
    /** A stream from a seed word or a seed string. */
    static from(seed: number | string): Rng;
    static restore(state: RngState): Rng;
    snapshot(): RngState;
    clone(): Rng;
    /**
     * A named substream. Two stages that both draw from the parent would
     * shift each other's numbers whenever one of them changes how many draws
     * it makes; a fork per stage means adding a roll to scatter cannot move
     * the settle roll, which keeps old replays valid across sim patches more
     * often than not.
     */
    fork(label: string): Rng;
    nextU32(): number;
    /**
     * A uniform integer in `[0, bound)`, rejection-sampled so the tail of the
     * u32 range does not bias low values. Never touches a float.
     */
    below(bound: number): number;
    /** A uniform integer in `[lo, hi]`, both ends included. */
    range(lo: number, hi: number): number;
    /**
     * A fixed-point probability test. `probability` is in FP_ONE units, so
     * `chance(FP_ONE / 4)` is a quarter. Clamped rather than thrown on, since
     * modifier stacks routinely push a probability past either end.
     */
    chance(probability: number, one: number): boolean;
    /**
     * Index into a weight table. Weights are integers; a zero weight is never
     * picked. Throws on an all-zero table rather than silently returning 0,
     * because that is always a modifier bug and it is much cheaper to find
     * here than in a validator mismatch.
     */
    weighted(weights: readonly number[]): number;
    /** One element of a non-empty array. */
    pick<T>(items: readonly T[]): T;
}
```

Refers to [`RngState`](#rngstate).

## `RngState`

_type_ in `sim-kit/rng.ts`

The seeded RNG the arcade's sims and the engine's fuzz draw from.

sfc32 over four uint32 words, seeded through splitmix32. Both are pure
32-bit integer algorithms — `Math.imul`, `>>>`, `<<`, `^` and nothing
else — which is the whole reason they were picked over PCG or a
float-based LCG: the validator re-runs this in Bun and the client runs it
in Safari and Chrome, and 32-bit integer ops are the only arithmetic all
three agree on bit for bit.

State is four words and nothing more, so `snapshot`/`restore` is enough
to resume a stream mid-spin — which is what a co-op spectator joining
late needs.

```ts
type RngState = readonly [
    number,
    number,
    number,
    number
];
```

## `canonicalize`

_function_ in `sim-kit/digest.ts`

Canonical JSON: object keys sorted, no whitespace, and non-integer
numbers refused outright. A sim result that carries a float is a
determinism bug, and the digest is the last place it can be caught before
it becomes an unexplainable validator mismatch.

```ts
declare function canonicalize(value: unknown): string;
```

## `digest32`

_function_ in `sim-kit/digest.ts`

A 32-bit digest over a canonical string, used to compare a client's
declared spin result against the validator's re-simulation without
shipping the whole trace back.

FNV-1a again, and deliberately the same function the RNG seeds through:
one integer hash in the kit means one thing to keep engine-identical.

```ts
declare function digest32(canonical: string): number;
```

## `digestOf`

_function_ in `sim-kit/digest.ts`

```ts
declare function digestOf(value: unknown): number;
```

## `fp`

_function_ in `sim-kit/fixed.ts`

```ts
declare function fp(whole: number): number;
```

## `fpApply`

_function_ in `sim-kit/fixed.ts`

Applies a fixed-point multiplier to a whole-number quantity (chips, ticks).

```ts
declare function fpApply(value: number, multiplier: number): number;
```

## `fpClamp`

_function_ in `sim-kit/fixed.ts`

```ts
declare function fpClamp(value: number, lo: number, hi: number): number;
```

## `fpDiv`

_function_ in `sim-kit/fixed.ts`

```ts
declare function fpDiv(a: number, b: number): number;
```

## `fpLerp`

_function_ in `sim-kit/fixed.ts`

Linear interpolation, `t` in FP_ONE units and clamped to [0, 1].

```ts
declare function fpLerp(a: number, b: number, t: number): number;
```

## `fpMul`

_function_ in `sim-kit/fixed.ts`

```ts
declare function fpMul(a: number, b: number): number;
```

## `fpRatio`

_function_ in `sim-kit/fixed.ts`

A ratio as fixed point: `fpRatio(1, 3)` is a third.

```ts
declare function fpRatio(numerator: number, denominator: number): number;
```

## `fpRound`

_function_ in `sim-kit/fixed.ts`

Rounds a fixed-point value to a whole number, half away from zero.

```ts
declare function fpRound(value: number): number;
```

## `fpToString`

_function_ in `sim-kit/fixed.ts`

```ts
declare function fpToString(value: number): string;
```

## `seedFromString`

_function_ in `sim-kit/rng.ts`

FNV-1a over the UTF-16 code units of a seed string. Daily seeds and run
seeds arrive as text from Postgres; this is how they become a word.
Code units, not code points, so the same string hashes the same whether
or not the engine normalises it.

```ts
declare function seedFromString(seed: string): number;
```
