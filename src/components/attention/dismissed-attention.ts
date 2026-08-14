import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { useMemo } from "react";

/**
 * Which attention items the viewer has waved away, and for how long.
 *
 * localStorage rather than a table: this is a per-device view preference over
 * data that lives on the server anyway, and nothing is lost if it never
 * reaches another browser — the invite is still on the team page, the
 * applicants are still on the post. A `dismissals` table would put a write
 * path, a migration and an endpoint behind a "hide this row" button.
 *
 * A module-level store rather than per-component state so the header badge
 * and the dashboard strip can never disagree about what's hidden.
 */

const STORAGE_KEY = "brackeys-attention-dismissed";

/**
 * Dismissals expire. Without a TTL the key set grows forever, and a key
 * suppressing a row from a post deleted months ago is dead weight that only
 * ever costs storage and confusion.
 */
const DISMISSAL_TTL_DAYS = 30;
const DAY_MS = 86_400_000;

/** Key → when it was dismissed. */
type DismissalMap = Record<string, number>;

function readStored(): DismissalMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    // Prune on read, which is the only moment we're guaranteed to get.
    const cutoff = Date.now() - DISMISSAL_TTL_DAYS * DAY_MS;
    const kept: DismissalMap = {};
    for (const [key, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === "number" && at > cutoff) kept[key] = at;
    }
    return kept;
  } catch {
    // Unparseable or storage-denied (private mode, quota): dismissals are a
    // convenience, so losing them is never worth breaking the page over.
    return {};
  }
}

function persist(next: DismissalMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // See readStored — best effort, in memory for this session either way.
  }
}

/**
 * Read at module init rather than hydrated in an effect. Safe here because
 * every attention surface is gated on a client-resolved session, so none of
 * this renders on the server and there is no markup to mismatch — and it
 * avoids the alternative's flash of a row the viewer already dismissed.
 */
export const dismissedAttentionStore = new Store<DismissalMap>(readStored());

export function dismissAttentionItem(key: string): void {
  dismissedAttentionStore.setState((current) => {
    const next = { ...current, [key]: Date.now() };
    persist(next);
    return next;
  });
}

export function restoreDismissedAttention(): void {
  dismissedAttentionStore.setState(() => {
    persist({});
    return {};
  });
}

/** The dismissed keys, as the set the filters want. */
export function useDismissedAttention(): ReadonlySet<string> {
  const map = useStore(dismissedAttentionStore);
  return useMemo(() => new Set(Object.keys(map)), [map]);
}
