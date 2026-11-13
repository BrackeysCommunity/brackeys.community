import { z } from "zod";

import { AssetIdSchema } from "../game/fields";
import {
  swapStrategySchema,
  swapTimingSchema,
  type SwapStrategy,
  type SwapTiming,
} from "../game/live";
import { SLOT_PATTERN } from "../game/save-file";
import type { AssetId, Sha256 } from "../project/types";
import { sha256Field } from "../project/zod-fields";
import type { SceneIssue } from "../scene/types";

/**
 * The `jams-host` channel between a released game in a sandboxed frame and
 * the page that frames it. The frame posts `jams:frame-ready` to its parent;
 * the page answers `jams:host` with a `MessagePort`, and every message after
 * goes over that port. Requests carry an `id` and get one `reply`; events
 * carry none. Both sides validate every message with these schemas, since
 * neither trusts the other's code.
 */
export const HOST_PROTOCOL_VERSION = 1;

/** The most one message may take, as UTF-8 JSON; `download` is capped by its bytes instead. */
export const HOST_MESSAGE_MAX_BYTES = 65_536;

/** The most a `download` event's bytes may be. */
export const HOST_DOWNLOAD_MAX_BYTES = 16 * 1024 * 1024;

/** How long the frame waits for the page's `jams:host` before it plays without one. */
export const HOST_HANDSHAKE_TIMEOUT_MS = 2_000;

/**
 * How long the frame waits for `welcome` once the page has answered with its
 * port: a page that is there may be slow to answer `hello` (a cold browser
 * opening its save store), and giving up then would drop its saves.
 */
export const HOST_WELCOME_TIMEOUT_MS = 30_000;

/**
 * How long the frame waits for the page's reply to any later request before
 * it fails with `save-store-failed`: a page that never answers would
 * otherwise leave a save pending until the channel closes. A reply that
 * arrives after is dropped as a reply to nothing.
 */
export const HOST_REQUEST_TIMEOUT_MS = 30_000;

const protocol = z.literal(HOST_PROTOCOL_VERSION);
const sha256 = sha256Field();
const slot = z.string().regex(SLOT_PATTERN);
const gameId = z.string().min(1).max(64);
const requestId = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** A refusal as the engine reports it; the receiver keeps the fields it knows. */
export const hostIssueSchema = z.looseObject({
  severity: z.enum(["error", "warn", "info"]),
  code: z.string().min(1),
  message: z.string(),
  entityIds: z.array(z.string()).default([]),
}) as unknown as z.ZodType<SceneIssue>;

export const saveLimitsSchema = z.strictObject({
  maxBytes: z.number().int().min(0),
  maxSlots: z.number().int().min(0),
});

export const saveModeSchema = z.enum(["site", "own", "none"]);

/** What the page says about where saves go: shown by a save menu, and the limits `SaveSlots` takes. */
export const hostSavesSchema = z.object({
  describe: z.string(),
  limits: saveLimitsSchema,
  mode: saveModeSchema,
});

const saveMetaSchema = z.object({
  title: z.string().optional(),
  scene: z.string(),
  savedAt: z.number(),
  playTicks: z.number(),
});

export const saveSummarySchema = z.object({
  slot,
  meta: saveMetaSchema,
  bytes: z.number().int().min(0),
});

export const saveWriteResultSchema = z.union([
  z.object({ ok: z.literal(true), bytes: z.number().int().min(0) }),
  z.object({ ok: z.literal(false), issue: hostIssueSchema }),
]);

// ─── Live levels ─────────────────────────────────────────

/** One scene a channel runs a live version of. */
export type LiveSceneEntry = {
  scene: AssetId;
  version: Sha256;
  /** The version's number among the scene's versions, as the page shows it. */
  number: number;
  timing: SwapTiming;
  /** ISO time the pointer moved; the page uses it for "updated 3 min ago" in its chrome. */
  since: string;
};

/** The live versions a channel's release runs now: what the page hands the frame. */
export type LiveSnapshot = {
  channel: "preview" | "production";
  /** Grows with every move on the channel. */
  rev: number;
  release: Sha256;
  /** Only pointers that apply: compatible, listed, not collected, hidden or blocked. Sorted by scene. */
  scenes: readonly LiveSceneEntry[];
  /** Versions this channel still points at that were hidden: pages running one reload their frame. */
  removed: readonly Sha256[];
  /** Versions this channel still points at that were blocked: a frame running one goes back to the release's scene at its next load. */
  blocked?: readonly Sha256[];
};

/** Where a scene's version stands in the frame. */
export type LiveStatus = "staging" | "ready" | "waiting" | "applied" | "refused" | "failed";

/** The frame's report on one scene's version; `version` null means the release's own. */
export type LiveStateMessage = {
  scene: AssetId;
  version: Sha256 | null;
  status: LiveStatus;
  timing?: SwapTiming;
  strategy?: SwapStrategy;
  tick?: number;
  issue?: SceneIssue;
};

export const liveSceneEntrySchema: z.ZodType<LiveSceneEntry> = z.object({
  scene: AssetIdSchema,
  version: sha256,
  number: z.number().int().min(1),
  timing: swapTimingSchema,
  since: z.string().min(1).max(64),
});

export const liveSnapshotSchema: z.ZodType<LiveSnapshot> = z.object({
  channel: z.enum(["preview", "production"]),
  rev: z.number().int().min(0),
  release: sha256,
  scenes: z.array(liveSceneEntrySchema),
  removed: z.array(sha256),
  blocked: z.array(sha256).optional(),
});

export const liveStateMessageSchema = z.strictObject({
  scene: AssetIdSchema,
  version: sha256.nullable(),
  status: z.enum(["staging", "ready", "waiting", "applied", "refused", "failed"]),
  timing: swapTimingSchema.optional(),
  strategy: swapStrategySchema.optional(),
  tick: z.number().int().min(0).optional(),
  issue: hostIssueSchema.optional(),
});

/** What a frame says it supports in `hello`; absent means none. */
export const hostFeatureSchema = z.literal("live");
export type HostFeature = z.infer<typeof hostFeatureSchema>;

/** The page's answer to `hello`: who plays, where saves go, this browser's stored preferences, whether the game may go online, and the live versions it runs. */
export const welcomeSchema = z.object({
  player: z.object({ signedIn: z.boolean(), name: z.string().nullable() }),
  saves: hostSavesSchema,
  prefs: z.object({ remap: z.unknown(), prefs: z.unknown() }),
  online: z.boolean(),
  live: liveSnapshotSchema.nullable().optional(),
});

// ─── The handshake ───────────────────────────────────────

/** Frame → parent window, the first message. */
export const frameReadySchema = z.strictObject({
  type: z.literal("jams:frame-ready"),
  protocol,
});

/** Page → frame, carrying the port every later message goes over. */
export const hostHandshakeSchema = z.strictObject({
  type: z.literal("jams:host"),
  protocol,
});

// ─── Frame → page ────────────────────────────────────────

const request = <T extends string, P extends z.ZodType>(type: T, params: P) =>
  z.strictObject({ type: z.literal(type), id: requestId, params });

/** Each request the frame sends: its params, and the schema of the page's result. */
export const HOST_REQUESTS = {
  hello: {
    params: z.strictObject({
      engine: z.string().min(1).max(64),
      release: sha256,
      game: gameId,
      features: z.array(hostFeatureSchema).min(1).max(8).optional(),
    }),
    result: welcomeSchema,
  },
  "saves.list": { params: z.strictObject({ gameId }), result: z.array(saveSummarySchema) },
  "saves.read": { params: z.strictObject({ gameId, slot }), result: z.string().nullable() },
  "saves.write": {
    params: z.strictObject({ gameId, slot, text: z.string() }),
    result: saveWriteResultSchema,
  },
  "saves.remove": { params: z.strictObject({ gameId, slot }), result: z.null() },
  "prefs.save": {
    params: z.strictObject({ store: z.enum(["remap", "prefs"]), value: z.unknown() }),
    result: z.null(),
  },
  "session.token": {
    params: z.strictObject({ sessionId: z.string().min(1).max(128) }),
    result: z.object({ token: z.string(), url: z.string() }),
  },
} as const;

export type HostRequestMethod = keyof typeof HOST_REQUESTS;
export type HostRequestParams<M extends HostRequestMethod> = z.infer<
  (typeof HOST_REQUESTS)[M]["params"]
>;
export type HostRequestResult<M extends HostRequestMethod> = z.infer<
  (typeof HOST_REQUESTS)[M]["result"]
>;

const jamsState = z.enum(["loading", "ready", "error"]);

/** Every message the frame sends after the handshake: a request, or an event. */
export const frameMessageSchema = z.discriminatedUnion("type", [
  request("hello", HOST_REQUESTS.hello.params),
  request("saves.list", HOST_REQUESTS["saves.list"].params),
  request("saves.read", HOST_REQUESTS["saves.read"].params),
  request("saves.write", HOST_REQUESTS["saves.write"].params),
  request("saves.remove", HOST_REQUESTS["saves.remove"].params),
  request("prefs.save", HOST_REQUESTS["prefs.save"].params),
  request("session.token", HOST_REQUESTS["session.token"].params),
  z.strictObject({
    type: z.literal("state"),
    jamsState,
    issue: hostIssueSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("download"),
    name: z.string().min(1).max(255),
    contentType: z.string().min(1).max(255),
    bytes: z.instanceof(ArrayBuffer).refine((b) => b.byteLength <= HOST_DOWNLOAD_MAX_BYTES, {
      message: `a download is at most ${HOST_DOWNLOAD_MAX_BYTES} bytes`,
    }),
  }),
  liveStateMessageSchema.extend({ type: z.literal("live.state") }),
]);

export type FrameMessage = z.infer<typeof frameMessageSchema>;

// ─── Page → frame ────────────────────────────────────────

/** Every message the page sends after the handshake: a reply to a request, or an event. */
export const hostMessageSchema = z.discriminatedUnion("type", [
  z.discriminatedUnion("ok", [
    z.object({ type: z.literal("reply"), id: requestId, ok: z.literal(true), result: z.unknown() }),
    z.object({
      type: z.literal("reply"),
      id: requestId,
      ok: z.literal(false),
      issue: hostIssueSchema,
    }),
  ]),
  z.object({ type: z.literal("saves.changed"), saves: hostSavesSchema }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("resume") }),
  z.object({ type: z.literal("live.update"), live: liveSnapshotSchema }),
  z.object({ type: z.literal("recording.request") }),
]);

export type HostMessage = z.infer<typeof hostMessageSchema>;
export type HostWelcome = z.infer<typeof welcomeSchema>;
export type HostSaves = z.infer<typeof hostSavesSchema>;

/** The events the page sends, by type, as a frame listens for them. */
export type HostEvents = {
  "saves.changed": HostSaves;
  pause: undefined;
  resume: undefined;
  /** The whole live snapshot again; the frame diffs it against what it runs. */
  "live.update": LiveSnapshot;
  /** The page asks for the run's recording so far; the frame answers with a download. */
  "recording.request": undefined;
};

/**
 * The UTF-8 bytes `message` takes as JSON, a `download`'s buffer counted by
 * its length; `Infinity` for a value JSON can't hold.
 */
export function hostMessageBytes(message: unknown): number {
  let buffers = 0;
  let text: string | undefined;
  try {
    text = JSON.stringify(message, (_key, value: unknown) => {
      if (value instanceof ArrayBuffer) {
        buffers += value.byteLength;
        return null;
      }
      return value;
    });
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  if (text === undefined) return Number.POSITIVE_INFINITY;
  return new TextEncoder().encode(text).length + buffers;
}

/** Whether `message` fits the protocol's caps: 64 KiB, or a download's 16 MiB of bytes. */
export function withinHostMessageCap(message: unknown): boolean {
  const bytes = hostMessageBytes(message);
  const isDownload =
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "download";
  return isDownload
    ? bytes <= HOST_MESSAGE_MAX_BYTES + HOST_DOWNLOAD_MAX_BYTES
    : bytes <= HOST_MESSAGE_MAX_BYTES;
}
