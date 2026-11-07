import { generateNKeysBetween } from "fractional-indexing";

/**
 * Fractional `z` order. On disk an entry's position is its index; in the doc
 * it is `(z, key)`, so concurrent inserts and moves never duplicate or lose
 * an entry, and two inserts at one spot (equal `z`) order by key.
 */

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Doc order: `z`, then key. */
export function compareZ(a: { z: string; key: string }, b: { z: string; key: string }): number {
  return byCodeUnit(a.z, b.z) || byCodeUnit(a.key, b.key);
}

/** `n` evenly spread keys for a fresh list. */
export function initialZ(n: number): string[] {
  return generateNKeysBetween(null, null, n);
}

/**
 * The `z` each entry of a list should have so the list sorts in the given
 * order, changing as few as possible: the longest run of existing values that
 * already increase strictly is kept, and the others get new keys between
 * their kept neighbours. `undefined` means the entry has no usable `z` yet.
 */
export function assignZ(current: readonly (string | undefined)[]): string[] {
  const kept = longestIncreasing(current);
  const out: string[] = new Array<string>(current.length);
  let i = 0;
  while (i < current.length) {
    if (kept.has(i)) {
      out[i] = current[i]!;
      i++;
      continue;
    }
    let j = i;
    while (j < current.length && !kept.has(j)) j++;
    const lo = i > 0 ? out[i - 1]! : null;
    const hi = j < current.length ? current[j]! : null;
    const keys = generateNKeysBetween(lo, hi, j - i);
    for (let k = i; k < j; k++) out[k] = keys[k - i]!;
    i = j;
  }
  return out;
}

/** Indices of one longest strictly increasing subsequence of the defined values. */
function longestIncreasing(values: readonly (string | undefined)[]): Set<number> {
  const tails: number[] = [];
  const prev = new Array<number>(values.length).fill(-1);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === undefined || !validKey(v)) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]!]! < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const out = new Set<number>();
  let k = tails.length > 0 ? tails[tails.length - 1]! : -1;
  while (k >= 0) {
    out.add(k);
    k = prev[k]!;
  }
  return out;
}

/** A key `generateNKeysBetween` accepts as a bound. */
function validKey(z: string): boolean {
  try {
    generateNKeysBetween(z, null, 1);
    return true;
  } catch {
    return false;
  }
}
