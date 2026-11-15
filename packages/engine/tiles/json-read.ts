/** Readers for untrusted JSON (Tiled and LDtk files): each yields a typed value or a fallback, never throws. */
import { ID_PATTERN } from "../game/fields";
import { isPlainObject } from "../project/kinds/define";

export type Json = Record<string, unknown>;

export const isObj = (v: unknown): v is Json => isPlainObject(v);

/** `v` when it's a plain object, else an empty one. */
export const obj = (v: unknown): Json => (isObj(v) ? v : {});

export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export const optNum = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** A finite number, else `fallback`. */
export const num = (v: unknown, fallback = 0): number => optNum(v) ?? fallback;

/**
 * A file's name as an asset or entity id: lower-case, a dash for each run of
 * anything else, at most 40 characters. `splitCamel` turns `DarkCave` into
 * `dark-cave`; a name with nothing left becomes `fallback`.
 */
export function assetSlug(
  name: string,
  { fallback, splitCamel = false }: { fallback: string; splitCamel?: boolean },
): string {
  const s = (splitCamel ? name.replace(/([a-z0-9])([A-Z])/g, "$1-$2") : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return ID_PATTERN.test(s) ? s : fallback;
}
