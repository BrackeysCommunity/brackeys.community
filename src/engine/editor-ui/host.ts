import type { ReactNode } from "react";
import type { Doc } from "yjs";

import type {
  AssetChangedMessage,
  AwarenessLike,
  DocOrigin,
  ProjectSession,
} from "../collab/index";
import type { AssetUrl } from "../index";
import type { AssetKindName, ProjectId, Sha256 } from "../project/index";
import type { Registry } from "../scene/index";

// ─── The host seam ───────────────────────────────────────

/** Everything site-specific the editor uses; nothing else reaches a server, a flag or storage. */
export type EditorHost = {
  /** Opens the project's session for this editor; called again only when `project` changes. */
  connect(args: { project: ProjectId; registry: Registry; origin: DocOrigin }): ProjectConnection;
  /** Where the asset loader fetches a blob: the dev route, the site's engine route, or an export's files. */
  assetUrl: AssetUrl;
  /** Who is editing; default "Guest <n>" with a per-tab id. */
  identity?: EditorIdentityInput;
  /** A peer's colour by id, for cursors, faces and history dots; default a fixed palette by hash. */
  peerColor?: (id: string) => string;
  /** Toasts, read once when the editor mounts; default the editor's own toast region. Sonner's `toast` fits as it is. */
  notify?: EditorNotify;
  /** Interaction sounds; default silent. */
  cue?: (cue: EditorCue) => void;
  /** Feature gates the editor asks about; default every flag off. */
  flag?: (name: string) => boolean;
  /** Per-viewer storage; default `window.localStorage`, every call in try/catch; null keeps nothing. */
  storage?: EditorStorage | null;
  /** The host's own islands in the frame's top corners: a site menu, a title, a way out. */
  chrome?: { topLeft?: ReactNode; topRight?: ReactNode };
  /** The editor opened another scene (a fallback, or a scene picker), so a route can follow. */
  onSceneChange?: (id: string) => void;
  /** The projects the host can open; with two or more the Project panel offers a switcher. */
  projects?: readonly EditorProjectChoice[];
  /** A project picked in the switcher: the host opens it by giving the editor another `project`. */
  onProjectChange?: (id: ProjectId) => void;
  /** Which project holds a scene, by id or name, so a scene missing from this one can be pointed to. */
  findScene?: (scene: string) => Promise<SceneHome | null>;
  /** The tree, inspector and licence fields take no edits. */
  readOnly?: boolean;
};

export type EditorIdentityInput = { name: string; avatarUrl?: string | null };
export type EditorProjectChoice = { id: ProjectId; name: string };
/** A scene's project, and its id and display name there. */
export type SceneHome = { project: ProjectId; id: string; name: string };
export type NotifyOptions = { description?: string; id?: string };
export type EditorNotify = ((message: string, opts?: NotifyOptions) => unknown) & {
  success(message: string, opts?: NotifyOptions): unknown;
  warning(message: string, opts?: NotifyOptions): unknown;
  error(message: string, opts?: NotifyOptions): unknown;
};
export type EditorCue = "press" | "toggle" | "tab" | "drop" | "error";
export type EditorStorage = {
  get(key: string): string | null;
  set(key: string, value: string): void;
};

// ─── Defaults ────────────────────────────────────────────

/** Every key the editor stores under; older `game-editor:*` keys are ignored. */
export const STORAGE_PREFIX = "jams-editor:";

/** Peer colours when the host has none of its own. */
export const PEER_PALETTE = [
  "#f05252",
  "#f2994a",
  "#f2c94c",
  "#3ecf8e",
  "#2dd4bf",
  "#38bdf8",
  "#6d6cf6",
  "#a78bfa",
  "#f472b6",
] as const;

/** A colour from `PEER_PALETTE`, the same for an id on every client. */
export function defaultPeerColor(id: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return PEER_PALETTE[(hash >>> 0) % PEER_PALETTE.length] ?? PEER_PALETTE[0];
}

/** The name an editor without a host identity goes by. */
export function guestName(random: () => number = Math.random): string {
  return `Guest ${Math.floor(random() * 99) + 1}`;
}

const keepNothing: EditorStorage = { get: () => null, set: () => {} };

function browserStorage(): EditorStorage {
  return {
    get(key) {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        // Private windows and blocked site data keep the value for the page's life only.
      }
    },
  };
}

/** The host's storage, or the browser's; reads and writes never throw. */
export function hostStorage(host: Pick<EditorHost, "storage">): EditorStorage {
  const storage = host.storage;
  if (storage === null) return keepNothing;
  if (storage === undefined) return browserStorage();
  return {
    get(key) {
      try {
        return storage.get(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        storage.set(key, value);
      } catch {
        // As for the browser's storage: the value lives until the page closes.
      }
    },
  };
}

export const hostCue =
  (host: Pick<EditorHost, "cue">) =>
  (cue: EditorCue): void =>
    host.cue?.(cue);

export const hostPeerColor = (host: Pick<EditorHost, "peerColor">): ((id: string) => string) =>
  host.peerColor ?? defaultPeerColor;

// ─── Connections ─────────────────────────────────────────

export type ProjectAccess = "read" | "write";

export type ProjectConnectionStatus =
  /** No project, or the host's gate is off. */
  | "off"
  /** Opening the session: the first token, the socket and the project doc. */
  | "connecting"
  | "live"
  /** The socket dropped; the transport reconnects it and every attached doc resumes. */
  | "reconnecting"
  | "offline"
  /** The session couldn't open, or the project doc was closed for good. */
  | "failed";

export type ProjectConnectionState = {
  status: ProjectConnectionStatus;
  session: ProjectSession | null;
  /** What the session's token grants; the dev server grants writes. */
  access: ProjectAccess;
  /** Docs the server closed for good; the session keeps their last state. */
  stopped: Readonly<Record<string, Exclude<CloseReason, "retry">>>;
  error: Error | null;
  /** Updates no server has acknowledged yet, across the session's docs. */
  unsynced: number;
};

/** An open project session, as `EditorHost.connect` hands it to the editor. */
export type ProjectConnection = {
  getState(): ProjectConnectionState;
  subscribe(listener: () => void): () => void;
  /** Fires for each `asset:changed` message the server sends about this project. */
  onAssetChanged(listener: (message: AssetChangedMessage) => void): () => void;
  /** Where imports upload; a connection without it takes no imports. */
  blobs?: ProjectBlobs;
  destroy(): void;
};

export type UploadedBlob = { sha256: Sha256; bytes: number };

/** A project's blob route as the editor uses it. */
export type ProjectBlobs = {
  /** Stores `bytes`, refused unless the server hashes them as this client did. */
  upload(
    bytes: Uint8Array,
    opts?: {
      kind?: AssetKindName;
      contentType?: string;
      onProgress?: (sent: number, total: number) => void;
    },
  ): Promise<UploadedBlob>;
  read(hash: Sha256): Promise<Uint8Array | null>;
};

/** What the server's close of a doc means: stop for good, or try again. */
export type CloseReason = "revoked" | "too-large" | "retry";

export type ProjectSocketStatus = "connecting" | "connected" | "disconnected";

/** What a doc's provider reports. */
export type ProjectDocEvents = {
  /** The doc holds the server's state. */
  synced(): void;
  /** The server refused or closed the doc, or the socket closed under it; `socketOpen` says the socket is still up. */
  closed(code: number | null, socketOpen: boolean, reason?: string): void;
  /** A stateless message the server sent on the doc, as it came. */
  stateless?(payload: string): void;
  /** The doc's updates the server hasn't acknowledged yet. */
  unsynced?(count: number): void;
};

/** The one socket a session's docs share. */
export type ProjectSocket = {
  /** A doc's provider, attached; its events arrive after this returns. */
  provider(args: {
    name: string;
    doc: Doc;
    /** Null where the server takes no token (the dev server). */
    token: (() => Promise<string>) | null;
    events: ProjectDocEvents;
  }): {
    awareness: AwarenessLike;
    detach(): void;
    attach(): void;
    destroy(): void;
  };
  status(): ProjectSocketStatus;
  subscribe(listener: () => void): () => void;
  destroy(): void;
};

/** Opens the session's socket on `url`. */
export type ProjectTransport = (url: string) => ProjectSocket;

export type ProjectTokenRequest = {
  projectId: ProjectId;
  formatVersion: number;
  layoutVersion: number;
  access: ProjectAccess;
};

export type ProjectTokenAnswer = { token: string; url: string; access: ProjectAccess };

export type MintProjectToken = (request: ProjectTokenRequest) => Promise<ProjectTokenAnswer>;

/** `@hocuspocus/provider`, which the host loads and passes in; the package never imports it. */
export type HocuspocusModule = typeof import("@hocuspocus/provider");
