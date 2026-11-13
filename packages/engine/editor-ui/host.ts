import type { ReactNode } from "react";
import type { Doc } from "yjs";

import type {
  AssetChangedMessage,
  AwarenessLike,
  DocOrigin,
  ProjectSession,
} from "../collab/index";
import type { SwapTiming } from "../game/index";
import type { AssetUrl } from "../index";
import type { AssetId, AssetKindName, ProjectId, Sha256 } from "../project/index";
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
  /** `keepScenes`: live scenes on the channel that stay on it over the new release. */
  promote(
    version: number,
    channel: PublishChannel,
    opts?: { keepScenes?: readonly AssetId[] },
  ): Promise<PointerMove>;
  /** Back to the channel's previous release, or to `to`, with the live scenes the undone promote replaced. */
  rollback(channel: PublishChannel, to?: number): Promise<ReleaseRollback>;
  settings(): Promise<GameSettingsView>;
  setSettings(patch: GameSettingsPatch): Promise<GameSettingsView>;
  /** Opens the host's agent token dialog, for the release command. */
  openTokenDialog(): void;
  wording: PublishWording;
  /** Live scene versions; without it the editor shows no Publish scene entry and no Live scenes section. */
  live?: EditorLiveHost;
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

/** A release rollback, with the live scenes it put back and those it couldn't, each with its sentence. */
export type ReleaseRollback = PointerMove & {
  restored?: readonly AssetId[];
  skipped?: readonly { scene: AssetId; reason: string }[];
};

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

// ─── Live scenes ─────────────────────────────────────────

/**
 * A host that publishes single scenes live over a channel's release. As
 * with `PublishWording`, every sentence stating one of the host's numbers
 * arrives written in `wording`.
 */
export type EditorLiveHost = {
  /** What the Publish scene checks compare against on `channel`. */
  base(scene: AssetId, channel: PublishChannel): Promise<LiveBaseView>;
  /**
   * Begins the upload of `versionText` (a canonical `scene-version.json`),
   * sends each text the host is missing from `texts` (by hash), commits,
   * and promotes to production when `opts.channel` asks for it.
   */
  publish(
    versionText: string,
    texts: Readonly<Record<Sha256, string>>,
    opts: LivePublishOptions,
    onProgress?: (progress: LivePublishProgress) => void,
  ): Promise<LivePublished>;
  /** Newest first; one scene's with `scene`. */
  list(scene?: AssetId): Promise<readonly LiveVersionView[]>;
  promote(
    scene: AssetId,
    version: number,
    channel: PublishChannel,
    timing: SwapTiming,
  ): Promise<LiveMove>;
  /** Back to the scene's previous pointer on the channel (or the release's scene), or to `to`. */
  rollback(
    scene: AssetId,
    channel: PublishChannel,
    opts?: { to?: number; timing?: SwapTiming },
  ): Promise<LiveMove>;
  /** "Stop": the channel plays the release's scene again, at the removed pointer's own timing. */
  clear(scene: AssetId, channel: PublishChannel): Promise<LiveMove>;
  unblock(scene: AssetId, version: number): Promise<void>;
  usage(): Promise<LiveUsageView>;
  /** Publishers may choose production, `now` there, and keep live scenes over a release. */
  role(): { publisher: boolean };
  wording: LiveWording;
  /**
   * Calls `listener` after each `publish` that went through, whichever view
   * started it, so the Live scenes list can show the new version; returns
   * the unsubscribe. Without it the list refreshes on its own moves only.
   */
  onPublished?(listener: (published: LivePublished) => void): () => void;
};

export type LivePublishOptions = {
  channel: PublishChannel;
  timing: SwapTiming;
  note?: string;
};

export type LivePublishProgress =
  | { step: "begin" }
  | { step: "upload"; sentBytes: number; totalBytes: number }
  | { step: "commit" }
  | { step: "promote" };

export type LivePublished = {
  versionId: Sha256;
  scene: AssetId;
  number: number;
  /** False when the host already held this exact version. */
  created: boolean;
  /** Where it now plays; null when nothing points at it. */
  channel: PublishChannel | null;
};

/** A scene pointer before and after a move, by version number; null is the release's own scene. */
export type LiveMove = { from: number | null; to: number | null };

/** What the Publish scene checks compare against, as `EditorLiveHost.base` answers. */
export type LiveBaseView = {
  channel: PublishChannel;
  /**
   * Null when nothing is on the channel yet. `liveCompatKey` is the key a
   * version must be built for to go live on it, `""` when it takes no live
   * scenes; without it the editor leaves that rule to the host's move.
   */
  release: { id: Sha256; version: number; manifest: string; liveCompatKey?: string } | null;
  /**
   * The scene's live version on the channel, with its `scene-version.json`
   * and the compat key it was built for; null when the release's scene plays.
   */
  live: {
    number: number;
    versionId: Sha256;
    timing: SwapTiming;
    /** ISO 8601, UTC. */
    since: string;
    descriptor: string;
    compatKey?: Sha256;
  } | null;
  /** The scene's and its prefabs' texts that `live` (or the release) names, by hash. */
  texts: Readonly<Record<Sha256, string>>;
  /** The scene's newest version number on any channel; null before the first. */
  latest: number | null;
};

/** A scene pointer as the Live scenes rows show it. */
export type LivePointerView = {
  channel: PublishChannel;
  timing: SwapTiming;
  /** ISO 8601, UTC. */
  since: string;
  /** Who moved it; null for an agent or a deleted account. */
  by: string | null;
};

export type LiveVersionView = {
  scene: AssetId;
  number: number;
  id: Sha256;
  /** ISO 8601, UTC. */
  createdAt: string;
  createdBy: string | null;
  note: string | null;
  dataBytes: number;
  pointers: readonly LivePointerView[];
  /** The blocked badge's sentence and who blocked it; null when it isn't blocked. */
  blocked: { by: "system" | "user"; text: string } | null;
  /** Why staff hid it; null when it isn't hidden. */
  hidden: string | null;
  collected: boolean;
  /** When the cleanup removes it unless a channel points at it, with the forecast's sentence; null when it is kept. */
  removal: { at: string; text: string } | null;
};

/** Today's count and what the project's versions hold; the release storage row of `UsageView` carries the live line. */
export type LiveUsageView = {
  today: number;
  versions: number;
  bytes: number;
};

/** The Publish scene dialog's and Live scenes' sentences that carry a host's numbers, written by the host. */
export type LiveWording = {
  /** The longest note, in characters. */
  noteMaxChars: number;
  /** "What changed, for your team (up to 200 characters)". */
  notePlaceholder: string;
  /** The largest a version's data may be, and the most versions a day, for the checks' levels. */
  dataMaxBytes: number;
  versionsPerDay: number;
  /** Where `used` of `max` stands, by the host's own warning rule: what tone the checks' Data and Today lines take. */
  level(used: number, max: number): UsageLevel;
  /** "Data: 14 KB of 2 MB". */
  data(bytes: number): string;
  /** "Today: 6 of 100 versions". */
  today(count: number): string;
  /** The Stop confirm: "Players go back to v7's version of The ford the next time the level loads." */
  stopConfirm(args: { release: number; scene: string; timing: SwapTiming }): string;
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
