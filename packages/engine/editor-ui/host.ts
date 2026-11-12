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
  /**
   * A project picked in the switcher, or a scene's own project from the
   * fallback notice's action (with that `scene`): the host opens it by giving
   * the editor another `project`, on `scene` when one is given.
   */
  onProjectChange?: (id: ProjectId, opts?: { scene?: string }) => void;
  /** Which project holds a scene, by id or name, so a scene missing from this one can be pointed to. */
  findScene?: (scene: string) => Promise<SceneHome | null>;
  /** The tree, inspector and licence fields take no edits. */
  readOnly?: boolean;
  /** Releases, channels and usage for the open project; without it the Publish panel and the Usage section aren't shown. */
  publish?: EditorPublishHost;
};

export type EditorIdentityInput = { name: string; avatarUrl?: string | null };
export type EditorProjectChoice = { id: ProjectId; name: string };
/** A scene's project, and its id and display name there. */
export type SceneHome = { project: ProjectId; id: string; name: string };
export type NotifyOptions = {
  description?: string;
  id?: string;
  /** A button on the toast; sonner's `action` takes it as it is. A host whose toasts can't show one drops it. */
  action?: { label: string; onClick: () => void };
};
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

// ─── Publishing ──────────────────────────────────────────

/**
 * A host that publishes the project's releases. Every sentence that states
 * one of the host's own numbers (a quota, a save cap, a link's lifetime, a
 * cleanup grace) arrives already written, so the editor carries none of
 * them.
 */
export type EditorPublishHost = {
  /** The project these calls act on. */
  project: ProjectId;
  usage(): Promise<UsageView>;
  /** Newest first. */
  releases(): Promise<readonly ReleaseView[]>;
  promote(version: number, channel: PublishChannel): Promise<PointerMove>;
  /** Back to the channel's previous release, or to `to`. */
  rollback(channel: PublishChannel, to?: number): Promise<PointerMove>;
  settings(): Promise<GameSettingsView>;
  setSettings(patch: GameSettingsPatch): Promise<GameSettingsView>;
  /** Opens the host's agent token dialog, for the release command. */
  openTokenDialog(): void;
  wording: PublishWording;
};

export type PublishChannel = "preview" | "production";
export type GameVisibility = "private" | "team" | "unlisted" | "public";
export type GameSaveMode = "site" | "own" | "none";
export type UsageLevel = "ok" | "warn" | "full";

/** One quota's row: its line already written ("Release storage: 120 MB of 512 MB"), and where it stands. */
export type UsageLineView = {
  quota: string;
  text: string;
  used: number;
  max: number;
  /** used / max. */
  ratio: number;
  level: UsageLevel;
  /** A second line under the row, such as asset storage's breakdown. */
  detail?: string;
};

export type UsageView = {
  lines: readonly UsageLineView[];
  /** The nearly-full or full line, when a quota is at either. */
  notice: { level: Exclude<UsageLevel, "ok">; text: string } | null;
  /** The trash's assets, with the confirmation that emptying it asks; null when it is empty. */
  trash: { assets: number; bytes: number; confirm: string } | null;
  /** The cleanup rules, under the rows. */
  footer: string;
};

export type ReleaseView = {
  version: number;
  /** The release id: the SHA-256 of its `release.json`. */
  id: Sha256;
  /** ISO 8601, UTC. */
  createdAt: string;
  bytes: number;
  engine: string;
  channels: readonly PublishChannel[];
  /** The jams this release is pinned to, by title. */
  jams: readonly string[];
  /** When it was first on production; null for a preview-only release. ISO 8601, UTC. */
  firstPromotedAt: string | null;
  /** When the cleanup removes it unless pinned, with the sentence saying so; null when it is kept. */
  removal: { at: string; text: string } | null;
  /** Why staff hid it; null when it isn't hidden. */
  hidden: string | null;
  /** Its files are gone; the record stays. */
  collected: boolean;
  playUrl: string;
};

/** A channel's pointer before and after a promote or a rollback, by version. */
export type PointerMove = { from: number | null; to: number };

export type GameSettingsView = {
  visibility: GameVisibility;
  /** Public was asked for and waits for staff review; the game stays unlisted meanwhile. */
  reviewPending: boolean;
  saveMode: GameSaveMode;
  connectOrigins: readonly string[];
  online: boolean;
  /** The project's team, by name; null for a personal project, which can't be team-only. */
  team: string | null;
};

export type GameSettingsPatch = {
  visibility?: GameVisibility;
  saveMode?: GameSaveMode;
  connectOrigins?: readonly string[];
  online?: boolean;
};

/** The Publish panel's sentences that carry a host's numbers, written by the host. */
export type PublishWording = {
  /** The command that builds and uploads a release of this project. */
  command: string;
  /** Shown before the command while the project has no release. */
  noRelease: string;
  /** The agent token line beside the command. */
  token: string;
  visibility: Readonly<Record<GameVisibility, string>>;
  saveModes: Readonly<Record<GameSaveMode, string>>;
  connectsTo: string;
  /** How many origins the game may list under Connects to. */
  connectOriginsMax: number;
  privateLinks: string;
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
  stopped: Readonly<Record<string, Exclude<CloseReason, "retry" | "reload">>>;
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

/** What the server's close of a doc means: stop for good, reload the project from the server's state (this client's copy came from another seed), or try again. */
export type CloseReason = "revoked" | "too-large" | "reload" | "retry";

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
