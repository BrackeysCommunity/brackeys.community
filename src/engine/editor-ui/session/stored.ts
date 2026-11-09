import type { EditorStorage } from "../host";

/**
 * Per-viewer editor state (panel sizes, collapsed rows, the outline's view)
 * is a convenience: every read falls back and every write may be refused,
 * and the editor keeps working either way.
 */

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** A stored `{ key: boolean }` map, keeping only its boolean entries. */
export function storedFlags(v: unknown): Record<string, boolean> | null {
  if (!isRecord(v)) return null;
  const out: Record<string, boolean> = {};
  for (const [k, flag] of Object.entries(v)) if (typeof flag === "boolean") out[k] = flag;
  return out;
}

/**
 * The JSON value stored at `key` as `parse` reads it, or `fallback` when the
 * storage is absent, the value is missing or unreadable, or `parse` returns null.
 */
export function readStored<T>(
  storage: EditorStorage | null,
  key: string,
  fallback: T,
  parse: (value: unknown) => T | null,
): T {
  if (!storage) return fallback;
  try {
    const raw = storage.get(key);
    if (raw === null || raw === "") return fallback;
    return parse(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Stores `value` as JSON; a null or refusing storage keeps it for the page's life only. */
export function writeStored(storage: EditorStorage | null, key: string, value: unknown): void {
  try {
    storage?.set(key, JSON.stringify(value));
  } catch {
    // Storage is per-viewer and optional.
  }
}
