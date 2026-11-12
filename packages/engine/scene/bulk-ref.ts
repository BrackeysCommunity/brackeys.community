import { ID_PATTERN } from "../game/fields";
import type { BulkKey, EntityTypeName, Ref } from "./types";

export function bulkId(key: BulkKey, index: number): Ref {
  return `~${key}:${index}`;
}

const SEGMENT = ID_PATTERN.source.slice(1, -1);
/** `<type>` or `<type>:<material>`, each an id. */
const BULK_KEY_PATTERN = new RegExp(`^${SEGMENT}(?::${SEGMENT})?$`);

/**
 * Splits `~solid:ice:3` on its last colon; `null` for anything that isn't
 * shaped like a bulk reference. Format only: whether the key is registered
 * is the registry's question (`registry.bulkKey`).
 */
export function parseBulkId(ref: Ref): { key: BulkKey; index: number } | null {
  if (!ref.startsWith("~")) return null;
  const colon = ref.lastIndexOf(":");
  if (colon < 0) return null;
  const key = ref.slice(1, colon);
  const digits = ref.slice(colon + 1);
  if (!/^(0|[1-9]\d*)$/.test(digits) || !BULK_KEY_PATTERN.test(key)) return null;
  return { key, index: Number(digits) };
}

/** The entity type a bulk key holds: the part before the first `:`. */
export function bulkKeyType(key: BulkKey): EntityTypeName {
  const colon = key.indexOf(":");
  return colon < 0 ? key : key.slice(0, colon);
}
