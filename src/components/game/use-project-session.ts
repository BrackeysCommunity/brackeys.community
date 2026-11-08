import type * as Hocuspocus from "@hocuspocus/provider";
import {
  ASSET_CHANGED,
  buildAtFrom,
  COLLAB_LAYOUT_VERSION,
  createProjectSession,
  type AssetChangedMessage,
  type AwarenessLike,
  type DocOrigin,
  type KeyGen,
  type OpenDoc,
  type OpenedDoc,
  type PrefabWriter,
  type ProjectSession,
  type SessionDoc,
} from "@jams/engine/collab";
import type { ContentStore, KindRegistry, ProjectId } from "@jams/engine/project";
import { SCENE_FORMAT_VERSION, type Registry } from "@jams/engine/scene";
import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";

import { SYNC_LIMITS } from "@/lib/canvas/limits";
import { SYNC_CLOSE, syncCloseCode, type SyncCloseCode } from "@/lib/canvas/sync-channels";
import type { SyncAccess } from "@/lib/canvas/token";
import { useFlag } from "@/lib/hooks/use-flag";
import { client } from "@/orpc/client";

import { sceneCollabUrl } from "./scene-collab";

// ─── Transport ───────────────────────────────────────────

export type ProjectSocketStatus = "connecting" | "connected" | "disconnected";

/** What a doc's provider reports. */
export type ProjectDocEvents = {
  /** The doc holds the server's state. */
  synced(): void;
  /**
   * The server refused or closed the doc, or the socket closed under it.
   * `code` is the sync close code, if there is one; `socketOpen` says the
   * socket itself is still up (the server dropped only this doc).
   */
  closed(code: SyncCloseCode | null, socketOpen: boolean): void;
  /** A stateless message the server sent on the doc, as it came. */
  stateless?(payload: string): void;
};

/** One doc's provider on the session's socket. */
export type ProjectDocProvider = {
  awareness: AwarenessLike;
  /** Takes the doc off the socket; nothing is sent or received until `attach`. */
  detach(): void;
  /** Puts it back, authenticating afresh. */
  attach(): void;
  destroy(): void;
};

/** The one socket a session's docs share. */
export type ProjectSocket = {
  /** A doc's provider, attached; its events arrive after this returns. */
  provider(args: {
    name: string;
    doc: Y.Doc;
    /** Null where the server takes no token (the dev server). */
    token: (() => Promise<string>) | null;
    events: ProjectDocEvents;
  }): ProjectDocProvider;
  status(): ProjectSocketStatus;
  subscribe(listener: () => void): () => void;
  destroy(): void;
};

/** Opens the session's socket on `url`. */
export type ProjectTransport = (url: string) => ProjectSocket;

/** One `HocuspocusProviderWebsocket`, with a `HocuspocusProvider` per doc attached to it. */
export function hocuspocusTransport(mod: typeof Hocuspocus): ProjectTransport {
  return (url) => {
    const listeners = new Set<() => void>();
    const socket = new mod.HocuspocusProviderWebsocket({
      url,
      onStatus: () => {
        for (const l of listeners) l();
      },
    });
    const status = (): ProjectSocketStatus =>
      socket.status === mod.WebSocketStatus.Connected
        ? "connected"
        : socket.status === mod.WebSocketStatus.Connecting
          ? "connecting"
          : "disconnected";
    return {
      status,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      provider({ name, doc, token, events }) {
        const provider = new mod.HocuspocusProvider({
          websocketProvider: socket,
          name,
          document: doc,
          token,
          onSynced: ({ state }) => {
            if (state) events.synced();
          },
          onAuthenticationFailed: ({ reason }) =>
            events.closed(syncCloseCode({ reason }), status() === "connected"),
          onClose: ({ event }) => events.closed(syncCloseCode(event), status() === "connected"),
          onStateless: ({ payload }) => events.stateless?.(payload),
        });
        const awareness = provider.awareness;
        if (!awareness) throw new Error(`"${name}": the provider has no awareness`);
        provider.attach();
        return {
          awareness,
          attach: () => provider.attach(),
          detach: () => provider.detach(),
          destroy: () => provider.destroy(),
        };
      },
      destroy() {
        listeners.clear();
        socket.destroy();
      },
    };
  };
}

const loadHocuspocus = (): Promise<ProjectTransport> =>
  import("@hocuspocus/provider").then(hocuspocusTransport);

// ─── Tokens ──────────────────────────────────────────────

export type ProjectTokenRequest = {
  projectId: ProjectId;
  formatVersion: number;
  layoutVersion: number;
  access: SyncAccess;
};

export type ProjectTokenAnswer = { token: string; url: string; access: SyncAccess };

export type MintProjectToken = (request: ProjectTokenRequest) => Promise<ProjectTokenAnswer>;

const mintWithOrpc: MintProjectToken = (request) => client.getProjectSyncToken(request);

/** A token is minted afresh once less than this is left of its life. */
export const TOKEN_REFRESH_MARGIN_MS = 15_000;

export type ProjectTokens = {
  /** A token with at least `TOKEN_REFRESH_MARGIN_MS` left, minting one when the last is too old. */
  get(): Promise<ProjectTokenAnswer>;
};

/**
 * One project-scoped token for every doc of the session, reused until it
 * nears its expiry. A token's life is counted from when its mint was asked
 * for, so a slow answer only shortens it. Concurrent asks share one mint.
 */
export function createProjectTokens(
  request: ProjectTokenRequest,
  mint: MintProjectToken = mintWithOrpc,
  now: () => number = Date.now,
): ProjectTokens {
  let held: { answer: ProjectTokenAnswer; expiresAt: number } | null = null;
  let pending: Promise<ProjectTokenAnswer> | null = null;
  return {
    get() {
      if (held && now() < held.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
        return Promise.resolve(held.answer);
      }
      if (pending) return pending;
      const askedAt = now();
      const minting = mint(request).then(
        (answer) => {
          held = { answer, expiresAt: askedAt + SYNC_LIMITS.tokenTtlMs };
          pending = null;
          return answer;
        },
        (error: unknown) => {
          pending = null;
          throw error;
        },
      );
      pending = minting;
      return minting;
    },
  };
}

// ─── Build time ──────────────────────────────────────────

const BUILD_AT = buildAtFrom(import.meta.env.VITE_BUILD_AT);

// ─── The session link ────────────────────────────────────

export type ProjectSessionStatus =
  /** Hosted with the `engine-projects` flag off, or no project. */
  | "off"
  /** Opening the session: the first token, the socket and the project doc. */
  | "connecting"
  | "live"
  /** The socket dropped; Hocuspocus reconnects it and every attached doc resumes. */
  | "reconnecting"
  | "offline"
  /** The session couldn't open, or the project doc was closed for good. */
  | "failed";

/** Why the service closed a doc for good. */
export type DocStopReason = "revoked" | "too-large";

export type ProjectSessionState = {
  status: ProjectSessionStatus;
  session: ProjectSession | null;
  /** What the session's token grants; the dev server grants writes. */
  access: SyncAccess;
  /** Docs the service closed for good; the session keeps their last state. */
  stopped: Readonly<Record<string, DocStopReason>>;
  error: Error | null;
};

/** What the session itself is made from; read once, when it opens. */
export type ProjectSessionSetup = {
  registry: Registry;
  kinds: KindRegistry;
  origin: DocOrigin;
  store?: ContentStore;
  prefabWriter?: PrefabWriter;
  key?: KeyGen;
  cap?: number;
  now?: () => number;
  /** When this build was made; default `VITE_BUILD_AT`. */
  buildAt?: number;
};

export type ProjectSessionHost =
  /** The dev server's collab endpoint: no tokens. */
  | { kind: "dev"; url?: string }
  /** `canvas-sync`, with project tokens from `getProjectSyncToken`. */
  | { kind: "hosted"; access?: SyncAccess; mint?: MintProjectToken };

export type ProjectSessionLinkOptions = ProjectSessionSetup & {
  project: ProjectId;
  host: ProjectSessionHost;
  /** Default: Hocuspocus, loaded on first use. */
  transport?: ProjectTransport;
  /** Waits before re-authenticating a doc the service refused for now. */
  retryMs?: readonly number[];
  isOnline?: () => boolean;
};

export type ProjectSessionLink = {
  getState(): ProjectSessionState;
  subscribe(listener: () => void): () => void;
  /**
   * Fires for each `asset:changed` message the server sends about this
   * project: a binary's bytes changed. Only the dev server sends them.
   */
  onAssetChanged(listener: (message: AssetChangedMessage) => void): () => void;
  destroy(): void;
};

const RETRY_MS = [2_000, 5_000, 15_000, 30_000];
const DESTROYED = "the project session was closed";

const OFF: ProjectSessionState = {
  status: "off",
  session: null,
  access: "write",
  stopped: {},
  error: null,
};

const errorCode = (error: unknown): string | undefined => (error as { code?: string } | null)?.code;

/** `payload` as an `asset:changed` message about `project`; null for anything else. */
function assetChangedOf(payload: string, project: ProjectId): AssetChangedMessage | null {
  let message: unknown;
  try {
    message = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null) return null;
  const m = message as Partial<AssetChangedMessage>;
  if (m.type !== ASSET_CHANGED || m.project !== project) return null;
  if (typeof m.id !== "string" || typeof m.sha256 !== "string") return null;
  return m as AssetChangedMessage;
}

/**
 * A project session over one socket: the first doc opened creates it (on
 * the dev endpoint, or on the URL the first hosted token names), and each
 * doc the session opens gets its own provider on it, closed when the
 * session lets the doc go. Hocuspocus reconnects the socket and
 * re-authenticates every attached doc; a doc the service refuses for now
 * (rate limit, stale token, dropped while the socket stays up) is
 * re-attached after a backoff, and one it closes for good (revoked, too
 * large) is detached and listed in `stopped`.
 */
export function connectProjectSession(options: ProjectSessionLinkOptions): ProjectSessionLink {
  const {
    project,
    host,
    retryMs = RETRY_MS,
    isOnline = () => typeof navigator === "undefined" || navigator.onLine,
  } = options;
  const access: SyncAccess = host.kind === "hosted" ? (host.access ?? "write") : "write";
  const tokens =
    host.kind === "hosted"
      ? createProjectTokens(
          {
            projectId: project,
            formatVersion: SCENE_FORMAT_VERSION,
            layoutVersion: COLLAB_LAYOUT_VERSION,
            access,
          },
          host.mint,
        )
      : null;
  const listeners = new Set<() => void>();
  const assetListeners = new Set<(message: AssetChangedMessage) => void>();
  const live = new Set<() => void>();
  let state: ProjectSessionState = { ...OFF, status: "connecting", access };
  let socket: Promise<ProjectSocket> | null = null;
  let opened: ProjectSocket | null = null;
  let unwatchSocket: (() => void) | null = null;
  let destroyed = false;

  const set = (patch: Partial<ProjectSessionState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };

  const connection = (): ProjectSessionStatus => {
    if (state.status === "failed" || !state.session) return state.status;
    if (opened?.status() === "connected") return "live";
    return isOnline() ? "reconnecting" : "offline";
  };
  const refresh = () => {
    if (!destroyed) set({ status: connection() });
  };

  const stop = (name: string, reason: DocStopReason) => {
    if (state.stopped[name] === reason) return;
    set({ stopped: { ...state.stopped, [name]: reason } });
    if (name === state.session?.name) {
      set({ status: "failed", error: new Error(`The project was closed: ${reason}`) });
    }
  };

  function getSocket(): Promise<ProjectSocket> {
    socket ??= (async () => {
      const url = tokens ? (await tokens.get()).url : host.kind === "dev" ? host.url : undefined;
      const transport = options.transport ?? (await loadHocuspocus());
      if (destroyed) throw new Error(DESTROYED);
      const made = transport(url ?? sceneCollabUrl());
      opened = made;
      unwatchSocket = made.subscribe(refresh);
      return made;
    })();
    return socket;
  }

  const token = tokens
    ? (name: string) => async () => {
        try {
          const answer = await tokens.get();
          if (answer.access !== state.access) set({ access: answer.access });
          return answer.token;
        } catch (error) {
          const code = errorCode(error);
          if (code === "NOT_FOUND" || code === "FORBIDDEN") stop(name, "revoked");
          throw error;
        }
      }
    : null;

  const openDoc: OpenDoc = async (name) => {
    const on = await getSocket();
    if (destroyed) throw new Error(DESTROYED);
    return new Promise<OpenedDoc>((resolve, reject) => {
      const doc = new Y.Doc();
      let synced = false;
      let closed = false;
      let retries = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const close = () => {
        if (closed) return;
        closed = true;
        live.delete(close);
        if (timer) clearTimeout(timer);
        provider.destroy();
        doc.destroy();
        if (!synced) reject(new Error(DESTROYED));
      };
      const end = (reason: DocStopReason) => {
        provider.detach();
        stop(name, reason);
        if (!synced) {
          reject(new Error(`"${name}" was closed: ${reason}`));
          close();
        }
      };
      const retry = () => {
        if (timer) return;
        provider.detach();
        const delay = retryMs[Math.min(retries++, retryMs.length - 1)] ?? 1_000;
        timer = setTimeout(() => {
          timer = null;
          if (!closed && !state.stopped[name]) provider.attach();
        }, delay);
      };

      const provider = on.provider({
        name,
        doc,
        token: token ? token(name) : null,
        events: {
          synced() {
            if (closed) return;
            retries = 0;
            if (synced) return;
            synced = true;
            resolve({ doc, awareness: provider.awareness, close });
          },
          closed(code, socketOpen) {
            if (closed || state.stopped[name]) return;
            if (code === SYNC_CLOSE.revoked || code === SYNC_CLOSE.tooLarge) {
              return end(code === SYNC_CLOSE.revoked ? "revoked" : "too-large");
            }
            // A closed socket reconnects on its own and re-authenticates every attached doc.
            if (code !== null || socketOpen) retry();
          },
          stateless(payload) {
            if (closed) return;
            const message = assetChangedOf(payload, project);
            if (message) for (const l of [...assetListeners]) l(message);
          },
        },
      });
      live.add(close);
    });
  };

  const onNetwork = () => refresh();
  if (typeof window !== "undefined") {
    window.addEventListener("online", onNetwork);
    window.addEventListener("offline", onNetwork);
  }

  createProjectSession({
    project,
    openDoc,
    origin: options.origin,
    registry: options.registry,
    kinds: options.kinds,
    buildAt: options.buildAt ?? BUILD_AT,
    ...(options.store ? { store: options.store } : {}),
    ...(options.prefabWriter ? { prefabWriter: options.prefabWriter } : {}),
    ...(options.key ? { key: options.key } : {}),
    ...(options.cap !== undefined ? { cap: options.cap } : {}),
    ...(options.now ? { now: options.now } : {}),
  }).then(
    (session) => {
      if (destroyed) return session.destroy();
      set({ session });
      refresh();
    },
    (error: unknown) => {
      if (destroyed) return;
      set({ status: "failed", error: error instanceof Error ? error : new Error(String(error)) });
    },
  );

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onAssetChanged(listener) {
      assetListeners.add(listener);
      return () => assetListeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      assetListeners.clear();
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onNetwork);
        window.removeEventListener("offline", onNetwork);
      }
      state.session?.destroy();
      for (const close of [...live]) close();
      unwatchSocket?.();
      opened?.destroy();
      listeners.clear();
    },
  };
}

// ─── Hooks ───────────────────────────────────────────────

export type UseProjectSessionOptions = ProjectSessionSetup & {
  /** Null keeps the session closed. */
  project: ProjectId | null;
  host: ProjectSessionHost;
  transport?: ProjectTransport;
  /** Called with each `asset:changed` message on the project; the latest callback is used. */
  onAssetChanged?: (message: AssetChangedMessage) => void;
};

/**
 * The live project `project` as a `ProjectSession`, open while the
 * component is mounted. Hosted projects open only while the
 * `engine-projects` flag is on. The session is rebuilt when the project,
 * host kind, dev URL or access changes; the rest of the options are read
 * when it opens.
 */
export function useProjectSession(options: UseProjectSessionOptions): ProjectSessionState {
  const [store] = useState(() => new Store<ProjectSessionState>(OFF));
  const latest = useRef(options);
  // Declared before the connecting effect, so it sees this render's options.
  useEffect(() => {
    latest.current = options;
  });
  const flagOn = useFlag("engine-projects");
  const { project, host } = options;
  const enabled = project !== null && (host.kind === "dev" || flagOn);
  const url = host.kind === "dev" ? host.url : undefined;
  const access = host.kind === "hosted" ? (host.access ?? "write") : "write";

  useEffect(() => {
    if (!enabled || project === null) return;
    const link = connectProjectSession({ ...latest.current, project });
    const copy = () => store.setState(() => link.getState());
    const unsubscribe = link.subscribe(copy);
    const unwatch = link.onAssetChanged((message) => latest.current.onAssetChanged?.(message));
    copy();
    return () => {
      unsubscribe();
      unwatch();
      link.destroy();
      store.setState(() => OFF);
    };
  }, [store, enabled, project, host.kind, url, access]);

  return useStore(store);
}

/**
 * Holds one doc of the session open while the component is mounted. When
 * it unmounts the session lets the doc go, and closes it unless an undo
 * step still names it.
 */
export function useSessionDoc(
  session: ProjectSession | null,
  name: string | null,
): { doc: SessionDoc | null; error: Error | null } {
  const [held, setHeld] = useState<{
    key: string;
    doc: SessionDoc | null;
    error: Error | null;
  } | null>(null);
  const key = session && name ? `${session.name}\n${name}` : null;

  useEffect(() => {
    if (!session || !name || key === null) return;
    let gone = false;
    let holds = false;
    session.open(name).then(
      (doc) => {
        if (gone) return session.release(name);
        holds = true;
        setHeld({ key, doc, error: null });
      },
      (error: unknown) => {
        if (!gone) {
          setHeld({
            key,
            doc: null,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      },
    );
    return () => {
      gone = true;
      if (holds) session.release(name);
    };
  }, [session, name, key]);

  return held && held.key === key ? held : { doc: null, error: null };
}
