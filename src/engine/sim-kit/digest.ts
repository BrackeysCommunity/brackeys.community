/**
 * A 32-bit digest over a canonical string, used to compare a client's
 * declared spin result against the validator's re-simulation without
 * shipping the whole trace back.
 *
 * FNV-1a again, and deliberately the same function the RNG seeds through:
 * one integer hash in the kit means one thing to keep engine-identical.
 */

export function digest32(canonical: string): number {
  let h = 0x811c_9dc5;
  for (let i = 0; i < canonical.length; i++) {
    const code = canonical.charCodeAt(i);
    h ^= code & 0xff;
    h = Math.imul(h, 0x0100_0193) >>> 0;
    h ^= (code >>> 8) & 0xff;
    h = Math.imul(h, 0x0100_0193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Canonical JSON: object keys sorted, no whitespace, and non-integer
 * numbers refused outright. A sim result that carries a float is a
 * determinism bug, and the digest is the last place it can be caught before
 * it becomes an unexplainable validator mismatch.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new TypeError(`canonicalize refuses a non-integer number: ${value}`);
    }
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new TypeError(`canonicalize cannot encode ${typeof value}`);
}

export function digestOf(value: unknown): number {
  return digest32(canonicalize(value));
}
