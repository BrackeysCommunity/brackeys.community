import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";

import { STORAGE_KEYS } from "@/lib/storage-keys";
import { client } from "@/orpc/client";

/**
 * What the viewer has done with each banner: when it was first shown (which
 * starts its per-viewer lifetime) and whether it was closed, either by
 * dismissing it or following its CTA. Kept in this browser, and for a
 * signed-in viewer synced with the account so a banner closed on one device
 * stays closed on the rest.
 */
export interface AnnouncementRecord {
  firstSeen: number;
  closed?: true;
}

export type AnnouncementHistory = Record<string, AnnouncementRecord>;

const STORAGE_KEY = STORAGE_KEYS.announcements;

function readStored(): AnnouncementHistory {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const history: AnnouncementHistory = {};
    for (const [id, record] of Object.entries(parsed as Record<string, unknown>)) {
      const r = record as Partial<AnnouncementRecord> | null;
      if (typeof r?.firstSeen === "number") {
        history[id] = r.closed
          ? { firstSeen: r.firstSeen, closed: true }
          : { firstSeen: r.firstSeen };
      }
    }
    return history;
  } catch {
    return {};
  }
}

export const announcementHistoryStore = new Store<AnnouncementHistory>(readStored());

function persist(history: AnnouncementHistory) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Storage denied: remembered for this session only.
  }
}

/** The account whose history this browser is synced with, once its sync has landed. */
export const syncedAccountStore = new Store<string | null>(null);
let account: string | null = null;

function toRecords(history: AnnouncementHistory) {
  return Object.entries(history).map(([id, r]) => ({
    id,
    firstSeen: r.firstSeen,
    closed: r.closed === true,
  }));
}

/** Earliest sighting wins and a close sticks, whichever side it came from. */
export function mergeHistories(
  a: AnnouncementHistory,
  b: AnnouncementHistory,
): AnnouncementHistory {
  const merged: AnnouncementHistory = { ...a };
  for (const [id, r] of Object.entries(b)) {
    const current = merged[id];
    const firstSeen = current ? Math.min(current.firstSeen, r.firstSeen) : r.firstSeen;
    merged[id] = current?.closed || r.closed ? { firstSeen, closed: true } : { firstSeen };
  }
  return merged;
}

/**
 * Uploads this browser's records to `userId` and folds the account's back in.
 * Banners wait on it (`syncedAccountStore`) so a new device doesn't flash one
 * already closed elsewhere; a failed sync releases them on local history.
 */
export async function syncAnnouncementHistory(userId: string | null): Promise<void> {
  if (userId === account) return;
  account = userId;
  if (!userId) {
    syncedAccountStore.setState(() => null);
    return;
  }
  try {
    const remote = await client.syncBannerHistory({
      records: toRecords(announcementHistoryStore.state),
    });
    if (account !== userId) return;
    const fromAccount: AnnouncementHistory = {};
    for (const r of remote) {
      fromAccount[r.id] = r.closed
        ? { firstSeen: r.firstSeen, closed: true }
        : { firstSeen: r.firstSeen };
    }
    const merged = mergeHistories(announcementHistoryStore.state, fromAccount);
    persist(merged);
    announcementHistoryStore.setState(() => merged);
  } catch {
    // Offline or rejected: this browser's own record still applies.
  }
  if (account === userId) syncedAccountStore.setState(() => userId);
}

function update(id: string, next: (current: AnnouncementRecord | undefined) => AnnouncementRecord) {
  const record = next(announcementHistoryStore.state[id]);
  const updated = { ...announcementHistoryStore.state, [id]: record };
  persist(updated);
  announcementHistoryStore.setState(() => updated);
  if (account) {
    client.syncBannerHistory({ records: toRecords({ [id]: record }) }).catch(() => {});
  }
}

export function markAnnouncementSeen(id: string, now: number): void {
  if (announcementHistoryStore.state[id]) return;
  update(id, () => ({ firstSeen: now }));
}

export function closeAnnouncement(id: string, now: number): void {
  update(id, (current) => ({ firstSeen: current?.firstSeen ?? now, closed: true }));
}

export function useAnnouncementHistory(): AnnouncementHistory {
  return useStore(announcementHistoryStore);
}

export function useSyncedAccount(): string | null {
  return useStore(syncedAccountStore);
}
