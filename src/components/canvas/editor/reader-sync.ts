import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import { deriveSnapshot, type JsonCanvas } from "@/lib/canvas/json-canvas";
import { presenceColor } from "@/lib/canvas/presence";
import { documentName, SYNC_CLOSE, syncCloseCode } from "@/lib/canvas/sync-channels";
import { client } from "@/orpc/client";

import { PresenceStore } from "./presence-store";
import type { SyncSession } from "./use-canvas-sync";

/** Live edits redraw the reader's view at most this often. */
const SNAPSHOT_THROTTLE_MS = 250;

export interface ReaderConnection {
  presence: PresenceStore | null;
  destroy(): void;
}

/**
 * A reader's read-only seat on a live canvas: everyone's cursors and chat
 * over awareness, and the doc as it changes, drawn by the snapshot view.
 * The service drops anything but awareness from a read token. Stops for
 * good on a revoke or an oversize canvas; `onStop` lets the page re-read
 * what's left.
 */
export function connectReader(
  canvasId: string,
  first: SyncSession,
  onSnapshot: (snapshot: JsonCanvas) => void,
  onStop: () => void,
): ReaderConnection {
  const doc = new Y.Doc();
  let pendingToken: string | null = first.token;
  let synced = false;
  let stopped = false;
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const emit = () => {
    timer = null;
    if (!stopped) onSnapshot(deriveSnapshot(doc));
  };
  const onUpdate = () => {
    if (synced && !timer) timer = setTimeout(emit, SNAPSHOT_THROTTLE_MS);
  };
  doc.on("update", onUpdate);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    provider.disconnect();
    onStop();
  };
  const handleCode = (code: number | null) => {
    if (code === SYNC_CLOSE.revoked || code === SYNC_CLOSE.tooLarge) stop();
  };

  const provider = new HocuspocusProvider({
    url: first.url,
    name: documentName("canvas", canvasId),
    document: doc,
    token: async () => {
      if (pendingToken) {
        const token = pendingToken;
        pendingToken = null;
        return token;
      }
      try {
        return (await client.getCanvasSyncToken({ canvasId })).token;
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code === "NOT_FOUND" || code === "FORBIDDEN") stop();
        throw error;
      }
    },
    onAuthenticationFailed: ({ reason }) => handleCode(syncCloseCode({ reason })),
    onClose: ({ event }) => handleCode(syncCloseCode(event)),
    onSynced: () => {
      synced = true;
      emit();
    },
  });

  const presence = provider.awareness
    ? new PresenceStore(provider.awareness, { ...first.self, ...presenceColor(first.self.id) })
    : null;

  return {
    presence,
    destroy: () => {
      if (destroyed) return;
      destroyed = stopped = true;
      if (timer) clearTimeout(timer);
      doc.off("update", onUpdate);
      presence?.destroy();
      provider.destroy();
      doc.destroy();
    },
  };
}
