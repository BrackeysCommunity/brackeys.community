import type { Document } from "@hocuspocus/server";

import type { SyncContext } from "./auth.ts";

/**
 * Who is connected to each document on this instance, published so the
 * web app can show "Live now" without opening a socket per document.
 */
export interface PresenceRoster {
  /** This instance's connected user ids on a document; empty clears it. */
  record(documentName: string, userIds: string[]): void;
  close(): Promise<void>;
}

export const localRoster: PresenceRoster = {
  record: () => {},
  close: async () => {},
};

export function connectedUsers(document: Document): string[] {
  const ids = new Set<string>();
  for (const connection of document.getConnections()) {
    const userId = (connection.context as SyncContext | undefined)?.userId;
    if (userId) ids.add(userId);
  }
  return [...ids].sort();
}
