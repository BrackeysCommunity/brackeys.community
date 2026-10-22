import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import * as Y from "yjs";

import { CANVAS_LIMITS } from "@/lib/canvas/limits";
import { documentName, SYNC_CLOSE, syncCloseCode } from "@/lib/canvas/sync-channels";
import type { SyncAccess } from "@/lib/canvas/token";
import { client } from "@/orpc/client";

import { canvasQueryOptions } from "../canvas-queries";
import type { SaveStatus } from "./use-canvas-save";

export interface SyncSession {
  token: string;
  url: string;
  access: SyncAccess;
}

/** How long `save()` waits for the server to acknowledge every local change. */
const FLUSH_TIMEOUT_MS = 10_000;
/** Backoff before reconnecting after a rate limit or a refused token. */
const RETRY_MS = [2_000, 5_000, 15_000, 30_000];
/** A revoked editor tries once more after the page has re-read its access. */
const MAX_REVOKE_RETRIES = 1;
/**
 * And waits this long first: the service refuses tokens minted within a
 * couple of seconds of a revoke, in case the two clocks disagree.
 */
const REVOKE_RETRY_MS = 3_000;

type StopReason = "too-large" | "revoked";

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

/**
 * The first sync token, which decides the editor's mode before it mounts:
 * a session means live, null means the solo save (flag off for this
 * member, the service not set up here, or the call failing for any reason,
 * since the solo save is always safe).
 */
export async function firstSyncSession(canvasId: string): Promise<SyncSession | null> {
  try {
    const { token, url, access } = await client.getCanvasSyncToken({ canvasId });
    return { token, url, access };
  } catch {
    return null;
  }
}

/**
 * Live persistence through `canvas-sync`, with the same shape as
 * `useCanvasSave` so the editor doesn't care which one it has. The server
 * merges and stores; this only keeps the provider connected and reports
 * status. It never calls `saveCanvas`.
 *
 * - 4413 (too large): stop for good. Reconnecting would resend the same
 *   update forever.
 * - 4403 (revoked), a token refused with NOT_FOUND/FORBIDDEN, or a token
 *   that only reads: stop and re-read the canvas so the page can show
 *   what's left (read-only, or gone).
 * - A local change over the message cap: stop before it is sent. The server
 *   would refuse it with 4413, or, past the websocket frame cap, drop the
 *   socket without a code, and the provider would resend it forever.
 * - 4429 and 4401: back off, then reconnect with a fresh token.
 */
export function useCanvasSync(doc: Y.Doc, canvasId: string, first: SyncSession) {
  const queryClient = useQueryClient();
  const state = useRef({
    provider: null as HocuspocusProvider | null,
    pendingToken: first.token as string | null,
    stopped: null as StopReason | null,
    revokeRetries: 0,
    everSynced: false,
    retries: 0,
    retryTimer: null as ReturnType<typeof setTimeout> | null,
    status: "connecting" as SaveStatus,
    listeners: new Set<() => void>(),
  });

  const setStatus = useCallback((status: SaveStatus) => {
    const s = state.current;
    if (s.status === status) return;
    s.status = status;
    for (const listener of s.listeners) listener();
  }, []);

  useEffect(() => {
    const s = state.current;
    let destroyed = false;

    const refresh = () => {
      const provider = s.provider;
      if (!provider || destroyed) return;
      if (s.stopped) return setStatus(s.stopped === "too-large" ? "too-large" : "offline");
      if (!provider.isSynced) {
        const socket = provider.configuration.websocketProvider.status;
        return setStatus(
          socket === WebSocketStatus.Disconnected && s.everSynced ? "offline" : "connecting",
        );
      }
      setStatus(provider.unsyncedChanges > 0 ? "saving" : "saved");
    };

    const reconnectLater = (delay: number) => {
      if (s.retryTimer) clearTimeout(s.retryTimer);
      s.provider?.disconnect();
      s.retryTimer = setTimeout(() => {
        s.retryTimer = null;
        if (!destroyed && !s.stopped) void s.provider?.connect();
      }, delay);
    };

    const backoff = () => RETRY_MS[Math.min(s.retries++, RETRY_MS.length - 1)]!;

    const stop = (reason: StopReason) => {
      if (s.retryTimer) clearTimeout(s.retryTimer);
      s.stopped = reason;
      s.provider?.disconnect();
      refresh();
      if (reason !== "revoked") return;
      // The page decides what's left: a read view, a deleted canvas, or —
      // if access came back — an editor this hook reconnects once more.
      void queryClient
        .invalidateQueries({ queryKey: canvasQueryOptions(canvasId).queryKey })
        .then(() => {
          if (destroyed || s.revokeRetries >= MAX_REVOKE_RETRIES) return;
          s.revokeRetries++;
          s.retryTimer = setTimeout(() => {
            s.retryTimer = null;
            if (destroyed || s.stopped !== "revoked") return;
            s.stopped = null;
            void s.provider?.connect();
            refresh();
          }, REVOKE_RETRY_MS);
        });
    };

    const handleCode = (code: number | null) => {
      if (s.stopped) return;
      if (code === SYNC_CLOSE.tooLarge) return stop("too-large");
      if (code === SYNC_CLOSE.revoked) return stop("revoked");
      if (code === SYNC_CLOSE.rateLimited || code === SYNC_CLOSE.unauthorized) {
        return reconnectLater(backoff());
      }
    };

    // Registered before the provider's own listener, so an oversize change
    // stops the provider before it tries to send it.
    const guardSize = (update: Uint8Array, origin: unknown) => {
      if (s.stopped || origin === s.provider) return;
      if (update.byteLength > CANVAS_LIMITS.maxMessageBytes) stop("too-large");
    };
    doc.on("update", guardSize);

    const provider = new HocuspocusProvider({
      url: first.url,
      name: documentName("canvas", canvasId),
      document: doc,
      token: async () => {
        if (s.pendingToken) {
          const token = s.pendingToken;
          s.pendingToken = null;
          return token;
        }
        let minted: { token: string; access: SyncAccess };
        try {
          minted = await client.getCanvasSyncToken({ canvasId });
        } catch (error) {
          const code = errorCode(error);
          if (code === "NOT_FOUND" || code === "FORBIDDEN") stop("revoked");
          else if (!s.stopped) reconnectLater(backoff());
          throw error;
        }
        if (minted.access !== "write") {
          stop("revoked");
          throw new Error("edit access was revoked");
        }
        return minted.token;
      },
      onAuthenticationFailed: ({ reason }) => {
        handleCode(syncCloseCode({ reason }));
        refresh();
      },
      onClose: ({ event }) => {
        const code = syncCloseCode(event);
        if (code !== null) handleCode(code);
        else if (
          !s.stopped &&
          !s.retryTimer &&
          event.code === 1000 &&
          provider.configuration.websocketProvider.status === WebSocketStatus.Connected
        ) {
          // The server dropped this document but kept the socket (it's shutting
          // down, or reset the session); start a clean one.
          reconnectLater(1_000);
        }
        refresh();
      },
      onSynced: () => {
        s.retries = 0;
        s.everSynced = true;
        refresh();
      },
      onStatus: refresh,
      onUnsyncedChanges: refresh,
    });
    s.provider = provider;
    if (first.access !== "write") {
      s.pendingToken = null;
      stop("revoked");
    }
    refresh();

    return () => {
      destroyed = true;
      doc.off("update", guardSize);
      if (s.retryTimer) clearTimeout(s.retryTimer);
      provider.destroy();
      if (s.provider === provider) s.provider = null;
    };
  }, [canvasId, doc, first.url, first.access, queryClient, setStatus]);

  /** Resolves once the server has every local change, or after a timeout. */
  const save = useCallback(async (): Promise<void> => {
    const started = Date.now();
    for (;;) {
      const provider = state.current.provider;
      if (!provider || state.current.stopped || !provider.hasUnsyncedChanges) return;
      if (Date.now() - started > FLUSH_TIMEOUT_MS) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }, []);

  /**
   * A restore the server already stored, and is applying to the live doc
   * itself (the restore's apply publish). Applied here too for an instant
   * view, as the provider's own: so the size guard lets it through and the
   * provider doesn't send it back. Anything the service lacks comes back
   * through its next store's merge or this client's next sync.
   */
  const applyRestored = useCallback(
    (update: Uint8Array, _vector: Uint8Array) => {
      Y.applyUpdate(doc, update, state.current.provider);
    },
    [doc],
  );

  const status = useSyncExternalStore(
    (listener) => {
      state.current.listeners.add(listener);
      return () => state.current.listeners.delete(listener);
    },
    () => state.current.status,
    () => "connecting" as SaveStatus,
  );

  return {
    status,
    save,
    applyRestored,
    hasUnsaved: () => {
      const provider = state.current.provider;
      return provider != null && (provider.hasUnsyncedChanges || !provider.isSynced);
    },
  };
}
