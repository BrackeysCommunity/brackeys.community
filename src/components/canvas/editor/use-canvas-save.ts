import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import * as Y from "yjs";

import { base64ToBytes, bytesToBase64 } from "@/lib/canvas/encoding";
import { reportMutationError } from "@/lib/product-insights";
import { client } from "@/orpc/client";

import { SERVER } from "./canvas-doc";

export type SaveStatus = "saved" | "pending" | "saving" | "offline" | "too-large";

const DEBOUNCE_MS = 1_500;
const MAX_WAIT_MS = 10_000;
const RETRY_MS = [2_000, 5_000, 15_000, 30_000];
/** What `fetch(…, { keepalive: true })` will carry. */
const KEEPALIVE_BYTES = 64 * 1024;

/**
 * Solo persistence: every local change is sent as the diff the server
 * lacks (against the state vector it last reported), and the reply's
 * update, another tab's work, is applied back. The server merges, so a
 * resend after a failure is always safe.
 */
export function useCanvasSave(doc: Y.Doc, canvasId: string, initialServerVector: Uint8Array) {
  const state = useRef({
    serverVector: initialServerVector,
    status: "saved" as SaveStatus,
    dirty: false,
    inFlight: null as Promise<void> | null,
    debounce: null as ReturnType<typeof setTimeout> | null,
    firstDirtyAt: 0,
    retries: 0,
    listeners: new Set<() => void>(),
  });

  const setStatus = useCallback((status: SaveStatus) => {
    const s = state.current;
    if (s.status === status) return;
    s.status = status;
    for (const listener of s.listeners) listener();
  }, []);

  const save = useCallback(async (): Promise<void> => {
    const s = state.current;
    if (s.debounce) clearTimeout(s.debounce);
    s.debounce = null;
    if (s.inFlight) {
      await s.inFlight;
      if (s.dirty) return save();
      return;
    }
    if (!s.dirty || s.status === "too-large") return;

    s.dirty = false;
    s.firstDirtyAt = 0;
    setStatus("saving");
    s.inFlight = (async () => {
      try {
        const result = await client.saveCanvas({
          canvasId,
          update: bytesToBase64(Y.encodeStateAsUpdate(doc, s.serverVector)),
          stateVector: bytesToBase64(Y.encodeStateVector(doc)),
        });
        Y.applyUpdate(doc, base64ToBytes(result.update), SERVER);
        s.serverVector = base64ToBytes(result.stateVector);
        s.retries = 0;
        setStatus(s.dirty ? "pending" : "saved");
      } catch (error) {
        s.dirty = true;
        const code = (error as { code?: string }).code;
        if (code === "PAYLOAD_TOO_LARGE") {
          setStatus("too-large");
          return;
        }
        reportMutationError(error, "canvas.save", { canvas_id: canvasId });
        setStatus("offline");
        const delay = RETRY_MS[Math.min(s.retries++, RETRY_MS.length - 1)]!;
        s.debounce = setTimeout(() => void save(), delay);
      } finally {
        s.inFlight = null;
      }
    })();
    await s.inFlight;
    // Edits made while the request was out go in the next one.
    if (s.dirty && s.status === "pending") {
      s.debounce = setTimeout(() => void save(), DEBOUNCE_MS);
    }
  }, [canvasId, doc, setStatus]);

  const schedule = useCallback(() => {
    const s = state.current;
    const now = Date.now();
    if (!s.firstDirtyAt) s.firstDirtyAt = now;
    if (s.debounce) clearTimeout(s.debounce);
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, s.firstDirtyAt + MAX_WAIT_MS - now));
    s.debounce = setTimeout(() => void save(), wait);
  }, [save]);

  /** Adopts a state vector the server reported outside `save` (a restore). */
  const acknowledge = useCallback((vector: Uint8Array) => {
    state.current.serverVector = vector;
  }, []);

  useEffect(() => {
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin === SERVER) return;
      const s = state.current;
      s.dirty = true;
      if (s.status === "saved") setStatus("pending");
      if (s.status !== "offline" && s.status !== "too-large") schedule();
    };
    doc.on("update", onUpdate);
    return () => doc.off("update", onUpdate);
  }, [doc, schedule, setStatus]);

  useEffect(() => {
    const s = state.current;
    const onHidden = () => {
      if (document.visibilityState === "hidden") void save();
    };
    // The tab is going away: one last keepalive POST, if the diff fits.
    const onPageHide = () => {
      if (!s.dirty) return;
      const body = JSON.stringify({
        canvasId,
        update: bytesToBase64(Y.encodeStateAsUpdate(doc, s.serverVector)),
        stateVector: bytesToBase64(Y.encodeStateVector(doc)),
      });
      if (body.length > KEEPALIVE_BYTES) return;
      void fetch("/api/canvas-save", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body,
      });
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      if (s.debounce) clearTimeout(s.debounce);
    };
  }, [canvasId, doc, save]);

  const status = useSyncExternalStore(
    (listener) => {
      state.current.listeners.add(listener);
      return () => state.current.listeners.delete(listener);
    },
    () => state.current.status,
    () => "saved" as SaveStatus,
  );

  return {
    status,
    save,
    acknowledge,
    hasUnsaved: () => state.current.dirty || state.current.inFlight != null,
  };
}
