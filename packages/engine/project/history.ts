import type { HashHistoryEntry, Sha256 } from "./types";

type Content = { sha256: Sha256; bytes: number };

/**
 * The hash history items one replacement appends: the outgoing hash
 * (when the asset had one) stamped with the replacement, so its newest
 * entry tells when it stopped being current, and the incoming hash the
 * first time the asset holds it.
 */
export function replacementHistory(
  held: readonly HashHistoryEntry[],
  previous: Content | null,
  next: Content,
  stamp: { at: number; by: string },
): HashHistoryEntry[] {
  const items: HashHistoryEntry[] = [];
  if (previous && previous.sha256 !== next.sha256) items.push({ ...previous, ...stamp });
  if (!held.some((h) => h.sha256 === next.sha256)) items.push({ ...next, ...stamp });
  return items;
}
