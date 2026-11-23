import { createHash } from "node:crypto";

import type { ModelId, UseId, UseSpec } from "./types.ts";
import { USE_CONFIG } from "./uses.ts";

/** Every narration key in the store starts here. */
export const KEY_PREFIX = "mmo-narr:";

/**
 * JSON with object keys sorted and no spaces, so equal inputs give equal
 * bytes whatever order their keys were built in. Array order is kept.
 */
export function canonical(v: unknown): string {
  if (v === null || v === undefined) return "null";
  switch (typeof v) {
    case "number":
      return Number.isFinite(v) ? JSON.stringify(v === 0 ? 0 : v) : "null";
    case "string":
    case "boolean":
      return JSON.stringify(v);
    case "object":
      break;
    default:
      throw new TypeError(`canonical: cannot encode a ${typeof v}`);
  }
  if (Array.isArray(v)) {
    return `[${v.map((x) => (x === undefined || typeof x === "function" ? "null" : canonical(x))).join(",")}]`;
  }
  const o = v as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(o).sort()) {
    const x = o[k];
    if (x === undefined || typeof x === "function") continue;
    parts.push(`${JSON.stringify(k)}:${canonical(x)}`);
  }
  return `{${parts.join(",")}}`;
}

/** sha256 hex of the canonical form. */
export function digestOf(v: unknown): string {
  return createHash("sha256").update(canonical(v)).digest("hex");
}

/** The cache key: the use's prompt version, the use, the model and the digest of its input. */
export function cacheKey<I, O>(
  spec: UseSpec<I, O>,
  input: I,
  model: ModelId = USE_CONFIG[spec.use].model,
): string {
  return `${KEY_PREFIX}v${spec.version}:${spec.use}:${model}:${digestOf(spec.input(input))}`;
}

/** A failed check under a cache key, so the same input is not paid for again. */
export const failKey = (key: string) =>
  `${KEY_PREFIX}fail:${key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key}`;

/** Model calls a player or NPC made for a use on a world day. */
export const capKey = (use: UseId, who: string, day: number) =>
  `${KEY_PREFIX}cap:${use}:${who}:${day}`;

/** The day ledger, a hash of micro-dollars and counts. */
export const costKey = (day: number) => `${KEY_PREFIX}cost:${day}`;
