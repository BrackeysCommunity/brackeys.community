/**
 * Fixed-point arithmetic for anything that decides an outcome.
 *
 * Values are plain integers scaled by `FP_ONE`, not a wrapper type — a
 * branded number would be nicer but it does not survive the JSON round trip
 * through the input log, and the lint guard plus these helpers are what
 * actually keep floats out.
 *
 * Six decimal places: `fpMul` peaks at 1e6 × 1e6 = 1e12, well inside the
 * 2^53 exact-integer range, so every operation here is exact as long as
 * callers keep magnitudes under `FP_MAX_SAFE`. `assertFp` is the check.
 */

export const FP_SHIFT = 6;
export const FP_ONE = 1_000_000;
export const FP_HALF = FP_ONE / 2;

/**
 * The largest fixed-point magnitude two of which can be multiplied without
 * leaving exact integer arithmetic: sqrt(2^53) rounded down to a round
 * number. Nothing in a sim should come near it; the guard is for modifier
 * stacks that multiply without bound.
 */
export const FP_MAX_SAFE = 90_000_000;

export function fp(whole: number): number {
  return Math.round(whole * FP_ONE);
}

/** A ratio as fixed point: `fpRatio(1, 3)` is a third. */
export function fpRatio(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError("fpRatio got a zero denominator");
  return Math.round((numerator * FP_ONE) / denominator);
}

export function fpMul(a: number, b: number): number {
  assertFp(a);
  assertFp(b);
  // Truncation, not rounding: `Math.round` on a negative half is
  // engine-consistent but asymmetric, and a sim that halves a penalty
  // should not gain a unit from the sign.
  return trunc((a * b) / FP_ONE);
}

export function fpDiv(a: number, b: number): number {
  if (b === 0) throw new RangeError("fpDiv got a zero divisor");
  assertFp(a);
  return trunc((a * FP_ONE) / b);
}

/** Applies a fixed-point multiplier to a whole-number quantity (chips, ticks). */
export function fpApply(value: number, multiplier: number): number {
  return trunc((value * multiplier) / FP_ONE);
}

export function fpClamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/** Linear interpolation, `t` in FP_ONE units and clamped to [0, 1]. */
export function fpLerp(a: number, b: number, t: number): number {
  const k = fpClamp(t, 0, FP_ONE);
  return a + trunc(((b - a) * k) / FP_ONE);
}

/** Rounds a fixed-point value to a whole number, half away from zero. */
export function fpRound(value: number): number {
  return value < 0 ? -Math.round(-value / FP_ONE) : Math.round(value / FP_ONE);
}

export function fpToString(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const whole = trunc(abs / FP_ONE);
  const frac = String(abs % FP_ONE)
    .padStart(FP_SHIFT, "0")
    .replace(/0+$/, "");
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

/**
 * `Math.trunc` returns `-0` for anything in `(-1, 0]`, and a `-0` that
 * reaches a spin summary compares unequal under `Object.is` to the `0` the
 * validator computes from the same log while looking identical in every
 * log line. Adding zero collapses it; every truncation in this file goes
 * through here.
 */
function trunc(value: number): number {
  return Math.trunc(value) + 0;
}

function assertFp(value: number): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`fixed-point value must be an integer, got ${value}`);
  }
  if (Math.abs(value) > FP_MAX_SAFE) {
    throw new RangeError(`fixed-point value ${value} exceeds FP_MAX_SAFE (${FP_MAX_SAFE})`);
  }
}
