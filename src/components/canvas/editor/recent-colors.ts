import { STORAGE_KEYS } from "@/lib/storage-keys";

import { isHexColor } from "../canvas-cards";

/**
 * The last few custom colors picked, newest first. A per-browser
 * convenience shared by every swatch row on the page, so it lives in
 * localStorage behind a tiny store and tolerates storage being blocked.
 */
const KEY = STORAGE_KEYS.canvasRecentColors;
const MAX_RECENT = 4;

const listeners = new Set<() => void>();
let cache: string[] | null = null;

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === "string" && isHexColor(c))
      : [];
  } catch {
    return [];
  }
}

const NONE: string[] = [];

/** The server snapshot: nothing until the browser's list is read. */
export const noRecentColors = (): string[] => NONE;

export function readRecentColors(): string[] {
  if (typeof window === "undefined") return NONE;
  cache ??= load();
  return cache;
}

export function subscribeRecentColors(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function rememberColor(hex: string) {
  if (!isHexColor(hex)) return;
  const color = hex.toLowerCase();
  const rest = readRecentColors().filter((c) => c !== color);
  cache = [color, ...rest].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Storage full or blocked: the list still holds for this visit.
  }
  for (const listener of listeners) listener();
}
