import { SEARCH_KINDS, type RankedHit, type SearchHit } from "@/lib/search-hits";

/**
 * What the palette remembers between visits: the last few searches and
 * the last few results opened from it. Per-browser conveniences, so they
 * live in localStorage and every read and write tolerates it being absent,
 * full or blocked.
 */
const SEARCHES_KEY = "palette:recent-searches";
const OPENED_KEY = "palette:recent-opened";
const MAX_SEARCHES = 5;
const MAX_OPENED = 6;

function read(key: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: forgetting is fine.
  }
}

function isStoredHit(value: unknown): value is SearchHit {
  if (typeof value !== "object" || value === null) return false;
  const { kind, id } = value as { kind?: unknown; id?: unknown };
  return (
    SEARCH_KINDS.includes(kind as SearchHit["kind"]) &&
    (typeof id === "string" || typeof id === "number")
  );
}

export function readRecentSearches(): string[] {
  return read(SEARCHES_KEY).filter((q): q is string => typeof q === "string");
}

export function readRecentlyOpened(): SearchHit[] {
  return read(OPENED_KEY).filter(isStoredHit);
}

export function rememberSearch(query: string) {
  const q = query.trim();
  if (q.length < 2) return;
  const rest = readRecentSearches().filter((s) => s.toLowerCase() !== q.toLowerCase());
  write(SEARCHES_KEY, [q, ...rest].slice(0, MAX_SEARCHES));
}

/** Stores the hit's own fields: a score or href belongs to one answer, not the hit. */
export function rememberOpened(hit: SearchHit) {
  const {
    score: _score,
    href: _href,
    highlight: _highlight,
    ...stored
  } = hit as Partial<RankedHit> & SearchHit;
  const rest = readRecentlyOpened().filter((h) => !(h.kind === hit.kind && h.id === hit.id));
  write(OPENED_KEY, [stored, ...rest].slice(0, MAX_OPENED));
}
