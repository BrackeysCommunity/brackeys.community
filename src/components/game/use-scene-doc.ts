import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

import { sceneCollabUrl } from "./scene-collab";

/**
 * `connecting` until the first sync, then `live`; `reconnecting` after a
 * drop until a fresh connection syncs, or `offline` while the browser is.
 */
export type SceneDocStatus = "connecting" | "live" | "reconnecting" | "offline";

/** What a provider tells the link about its socket. */
export type SceneProviderEvents = {
  synced(): void;
  /** The socket closed or the server dropped the document. */
  closed(): void;
};

/** One provider on one doc; `scene-provider.ts` makes the Hocuspocus one. */
export type SceneProviderHandle = {
  doc: Y.Doc;
  awareness: Awareness | null;
  provider: unknown;
  destroy(): void;
};

export type ConnectSceneDoc = (args: {
  url: string;
  name: string;
  events: SceneProviderEvents;
}) => SceneProviderHandle;

export type SceneDocState = {
  /** The newest connection's doc and awareness, synced or not. */
  doc: Y.Doc | null;
  awareness: Awareness | null;
  provider: unknown;
  status: SceneDocStatus;
  /** The newest connection has synced with the server. */
  synced: boolean;
  /** The newest connection that synced; it stays while a later one connects. */
  ready: { doc: Y.Doc; awareness: Awareness | null } | null;
};

export type SceneDocLinkOptions = {
  name: string;
  url: string;
  connect: ConnectSceneDoc;
  /** Waits before each fresh connection after a drop. */
  retryMs?: readonly number[];
  isOnline?: () => boolean;
};

export type SceneDocLink = {
  getState(): SceneDocState;
  subscribe(listener: () => void): () => void;
  destroy(): void;
};

const RETRY_MS = [500, 1_000, 2_000, 5_000];

const EMPTY: SceneDocState = {
  doc: null,
  awareness: null,
  provider: null,
  status: "connecting",
  synced: false,
  ready: null,
};

/**
 * Keeps one scene doc connected. A connection that drops after syncing is
 * replaced by a fresh doc rather than reconnected: the dev server unloads a
 * doc once its last client leaves and seeds it again from the file with new
 * keys, so resending the old doc's state would duplicate every entity.
 * Before the first sync the provider retries on its own.
 */
export function createSceneDocLink({
  name,
  url,
  connect,
  retryMs = RETRY_MS,
  isOnline = () => typeof navigator === "undefined" || navigator.onLine,
}: SceneDocLinkOptions): SceneDocLink {
  const listeners = new Set<() => void>();
  let state: SceneDocState = EMPTY;
  let handle: SceneProviderHandle | null = null;
  let everSynced = false;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const set = (patch: Partial<SceneDocState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };

  const waiting = (): SceneDocStatus =>
    !isOnline() ? "offline" : everSynced ? "reconnecting" : "connecting";

  function open() {
    if (destroyed) return;
    let current: SceneProviderHandle | null = null;
    let synced = false;
    const events: SceneProviderEvents = {
      synced() {
        if (destroyed || synced || current !== handle || !current) return;
        synced = true;
        everSynced = true;
        retries = 0;
        set({
          synced: true,
          status: "live",
          ready: { doc: current.doc, awareness: current.awareness },
        });
      },
      closed() {
        if (destroyed || current !== handle || !current) return;
        if (!synced) return set({ status: waiting() });
        current.destroy();
        handle = null;
        set({ synced: false, status: waiting() });
        const delay = retryMs[Math.min(retries++, retryMs.length - 1)] ?? 1_000;
        timer = setTimeout(() => {
          timer = null;
          open();
        }, delay);
      },
    };
    current = connect({ url, name, events });
    handle = current;
    set({
      doc: current.doc,
      awareness: current.awareness,
      provider: current.provider,
      synced: false,
      status: waiting(),
    });
  }

  const onNetwork = () => {
    if (!state.synced) set({ status: waiting() });
  };
  if (typeof window !== "undefined") {
    window.addEventListener("online", onNetwork);
    window.addEventListener("offline", onNetwork);
  }
  open();

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onNetwork);
        window.removeEventListener("offline", onNetwork);
      }
      handle?.destroy();
      handle = null;
      listeners.clear();
    },
  };
}

/**
 * The scene `scene:<name>` on the dev server's collab endpoint. Null
 * `connect` (not loaded yet, or the editor is off) keeps it disconnected.
 * Only the server seeds a doc: wait for `ready` before reading it.
 */
export function useSceneDoc(
  name: string,
  connect: ConnectSceneDoc | null,
  url?: string,
): SceneDocState {
  const [state] = useState(() => new Store<SceneDocState>(EMPTY));

  useEffect(() => {
    if (!connect) return;
    const link = createSceneDocLink({ name, url: url ?? sceneCollabUrl(), connect });
    const copy = () => state.setState(() => link.getState());
    const unsubscribe = link.subscribe(copy);
    copy();
    return () => {
      unsubscribe();
      link.destroy();
      state.setState(() => EMPTY);
    };
  }, [state, name, connect, url]);

  return useStore(state);
}
