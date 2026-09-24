/**
 * Client-side fuzzy matching for short vocabularies (skills, roles) the
 * pickers already hold in memory. Diacritics are ignored — the catalogue
 * says "LÖVE", people type "love" — and typos are forgiven, so "love2d"
 * finds LÖVE and "godto" finds Godot. The server's `sql-fuzzy` does the
 * same job in Postgres; the two agree on the common cases, not every edge.
 */
import Fuse from "fuse.js";

/** Lowercased, with diacritics stripped: "LÖVE" → "love". */
export function foldText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * The entries of `items` that match `query`, best first. An empty query
 * returns `items` untouched.
 */
export function fuzzyFilter<T extends { name: string }>(items: readonly T[], query: string): T[] {
  const q = query.trim();
  if (!q) return [...items];
  const fuse = new Fuse(items, {
    keys: ["name"],
    ignoreDiacritics: true,
    ignoreLocation: true,
    threshold: 0.4,
  });
  return fuse.search(q).map((result) => result.item);
}
