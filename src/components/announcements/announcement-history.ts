import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";

import { STORAGE_KEYS } from "@/lib/storage-keys";

/**
 * What this browser has done with each announcement: when it was first shown
 * (which starts its per-viewer lifetime) and whether it was closed, either by
 * dismissing it or following its CTA. Per browser, like the attention
 * dismissals — a banner seen again on a second device costs one click.
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

function update(id: string, next: (current: AnnouncementRecord | undefined) => AnnouncementRecord) {
  announcementHistoryStore.setState((history) => {
    const updated = { ...history, [id]: next(history[id]) };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Storage denied: remembered for this session only.
    }
    return updated;
  });
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
