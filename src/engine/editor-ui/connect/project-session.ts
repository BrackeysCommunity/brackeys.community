import * as Y from "yjs";

import {
  ASSET_CHANGED,
  createProjectSession,
  type AssetChangedMessage,
  type DocOrigin,
  type KeyGen,
  type OpenDoc,
  type OpenedDoc,
  type PrefabWriter,
} from "../../collab/index";
import type { ContentStore, KindRegistry, ProjectId } from "../../project/index";
import type { Registry } from "../../scene/index";
import type {
  CloseReason,
  MintProjectToken,
  ProjectAccess,
  ProjectConnection,
  ProjectConnectionState,
  ProjectConnectionStatus,
  ProjectSocket,
  ProjectTokenAnswer,
  ProjectTokenRequest,
  ProjectTransport,
} from "../host";

// ─── Tokens ──────────────────────────────────────────────

/** A token is minted afresh once less than this is left of its life. */
export const TOKEN_REFRESH_MARGIN_MS = 15_000;

/** How long a minted token lives when the host doesn't say. */
export const DEFAULT_TOKEN_TTL_MS = 60_000;

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
  mint: MintProjectToken,
  opts: { ttlMs: number; now?: () => number } = { ttlMs: DEFAULT_TOKEN_TTL_MS },
): ProjectTokens {
  const now = opts.now ?? Date.now;
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
          held = { answer, expiresAt: askedAt + opts.ttlMs };
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

// ─── The session link ────────────────────────────────────

export type ConnectProjectSessionOptions = {
  project: ProjectId;
  registry: Registry;
  kinds: KindRegistry;
  origin: DocOrigin;
  transport: ProjectTransport;
  /** Hosted servers: a token per doc open, and the socket URL. Null for the dev server. */
  tokens?: ProjectTokens | null;
  /** The access the tokens are asked for, reported until the first answer; default write. */
  access?: ProjectAccess;
  /** The server's close codes; default every close retries. */
  closeReason?: (code: number | null, reason?: string) => CloseReason;
  store?: ContentStore;
  /** The socket's URL where no token names one. */
  url?: string;
  /** Waits before re-attaching a doc the server refused for now. */
  retryMs?: readonly number[];
  isOnline?: () => boolean;
  /** When the host's build was made; stamped on what this session writes. */
  buildAt?: number;
  prefabWriter?: PrefabWriter;
  key?: KeyGen;
  cap?: number;
  now?: () => number;
};

const RETRY_MS = [2_000, 5_000, 15_000, 30_000];
const DESTROYED = "the project session was closed";

export const CONNECTION_OFF: ProjectConnectionState = {
  status: "off",
  session: null,
  access: "write",
  stopped: {},
  error: null,
  unsynced: 0,
};

/** A connection that opens nothing: for a host whose project is switched off. */
export function offConnection(access: ProjectAccess = "write"): ProjectConnection {
  const state: ProjectConnectionState = { ...CONNECTION_OFF, access };
  return {
    getState: () => state,
    subscribe: () => () => {},
    onAssetChanged: () => () => {},
    destroy() {},
  };
}

const retryAll = (): CloseReason => "retry";

/** A token refusal that means the project is gone or no longer this viewer's. */
const revokes = (code: string | undefined): boolean => code === "NOT_FOUND" || code === "FORBIDDEN";

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
 * `url`, or on the URL the first token names), and each doc the session
 * opens gets its own provider on it, closed when the session lets the doc
 * go. The transport reconnects the socket and re-authenticates every
 * attached doc; a doc the server refuses for now (rate limit, stale token,
 * dropped while the socket stays up) is re-attached after a backoff, and one
 * `closeReason` says is closed for good is detached and listed in `stopped`.
 * A socket's own close (a code under 4000, or none) is left to the transport.
 */
export function connectProjectSession(options: ConnectProjectSessionOptions): ProjectConnection {
  const {
    project,
    tokens = null,
    closeReason = retryAll,
    retryMs = RETRY_MS,
    isOnline = () => typeof navigator === "undefined" || navigator.onLine,
  } = options;
  const listeners = new Set<() => void>();
  const assetListeners = new Set<(message: AssetChangedMessage) => void>();
  const live = new Set<() => void>();
  const unsynced = new Map<string, number>();
  let state: ProjectConnectionState = {
    ...CONNECTION_OFF,
    status: "connecting",
    access: options.access ?? "write",
  };
  let socket: Promise<ProjectSocket> | null = null;
  let opened: ProjectSocket | null = null;
  let unwatchSocket: (() => void) | null = null;
  let destroyed = false;

  const set = (patch: Partial<ProjectConnectionState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };

  const connection = (): ProjectConnectionStatus => {
    if (state.status === "failed" || !state.session) return state.status;
    if (opened?.status() === "connected") return "live";
    return isOnline() ? "reconnecting" : "offline";
  };
  const refresh = () => {
    if (!destroyed) set({ status: connection() });
  };

  const countUnsynced = (name: string, count: number | null) => {
    if (count === null || count <= 0) unsynced.delete(name);
    else unsynced.set(name, count);
    let total = 0;
    for (const n of unsynced.values()) total += n;
    if (!destroyed && total !== state.unsynced) set({ unsynced: total });
  };

  const stop = (name: string, reason: Exclude<CloseReason, "retry">) => {
    if (state.stopped[name] === reason) return;
    set({ stopped: { ...state.stopped, [name]: reason } });
    if (name === state.session?.name) {
      set({ status: "failed", error: new Error(`The project was closed: ${reason}`) });
    }
  };

  function getSocket(): Promise<ProjectSocket> {
    socket ??= (async () => {
      const url = tokens ? (await tokens.get()).url : options.url;
      if (destroyed) throw new Error(DESTROYED);
      if (!url) throw new Error(`The project "${project}" has no server to connect to.`);
      const made = options.transport(url);
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
          if (revokes(errorCode(error))) stop(name, "revoked");
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
        countUnsynced(name, null);
        if (!synced) reject(new Error(DESTROYED));
      };
      const end = (reason: Exclude<CloseReason, "retry">) => {
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
          closed(code, socketOpen, reason) {
            if (closed || state.stopped[name]) return;
            const why = closeReason(code, reason);
            if (why !== "retry") return end(why);
            // A closed socket reconnects on its own and re-authenticates every attached doc.
            if (socketOpen || (code !== null && code >= 4000)) retry();
          },
          stateless(payload) {
            if (closed) return;
            const message = assetChangedOf(payload, project);
            if (message) for (const l of [...assetListeners]) l(message);
          },
          unsynced(count) {
            if (!closed) countUnsynced(name, count);
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
    ...(options.buildAt !== undefined ? { buildAt: options.buildAt } : {}),
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
