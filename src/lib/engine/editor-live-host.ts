import type {
  EditorLiveHost,
  LiveBaseView,
  LiveMove,
  LivePublished,
  LiveUsageView,
  LiveVersionView,
  LiveWording,
  PublishChannel,
} from "@jams/engine/editor-ui";
import { arrivalWords, sceneVersionName, type SwapTiming } from "@jams/engine/game";
import type { AssetId, ProjectId, Sha256 } from "@jams/engine/project";
import { plural, shortId } from "@jams/engine/scene";
import { ORPCError } from "@orpc/client";

import { formatBytes, formatCount } from "@/lib/format-bytes";
import { releaseDay } from "@/lib/jam-links";

import { LIVE_LIMITS, RELEASE_GRACE_DAYS } from "./limits";
import { breakerReason } from "./live-outcomes";
import { quotaAmount } from "./quota";
import { engineReleaseFilePath } from "./route-paths";

// ─── Refusals ────────────────────────────────────────────

/** A refusal from the site, its message for people and its hint for developers. */
export class PublishHostError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  constructor(message: string, code: string, hint?: string) {
    super(message);
    this.name = "PublishHostError";
    this.code = code;
    this.hint = hint;
  }
}

/** A refusal's body as the site words it, read from an oRPC error's `data` or a route's JSON. */
function refusalOf(body: unknown, fallback: { message: string; code: string }): PublishHostError {
  const data = (body ?? {}) as { code?: unknown; message?: unknown; hint?: unknown };
  return new PublishHostError(
    typeof data.message === "string" ? data.message : fallback.message,
    typeof data.code === "string" ? data.code : fallback.code,
    typeof data.hint === "string" ? data.hint : undefined,
  );
}

/** An oRPC refusal as the host's error; anything else passes through. */
export function publishError(error: unknown): unknown {
  if (!(error instanceof ORPCError)) return error;
  return refusalOf(error.data, { message: error.message, code: String(error.code) });
}

/** A production publish whose version was stored but whose move to production was refused. */
function savedNotPromoted(name: string, error: unknown): PublishHostError {
  const why = error instanceof Error ? error.message : String(error);
  return new PublishHostError(
    `${name} was saved but isn't on production: ${why}`,
    error instanceof PublishHostError ? error.code : "live-promote-failed",
    `Promote ${name} from Live scenes in the Publish panel, or publish again: the same version isn't stored twice.`,
  );
}

/** Runs one site call, its refusal turned into a `PublishHostError`. */
export async function hostCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw publishError(error);
  }
}

// ─── The words ───────────────────────────────────────────

const n = formatCount;

/** "level-1@1 will be removed on 3 Dec 2026. Point a channel at it to keep it.", the date in UTC. */
export const liveRemovalText = (scene: AssetId, number: number, at: Date | string): string =>
  `${sceneVersionName(scene, number)} will be removed on ${releaseDay(at)}. Point a channel at it to keep it.`;

/** Why a version is blocked, said beside its blocked badge: the breaker's count, or the reason a person gave. */
export function liveBlockedText(
  blocked: { by: "system" | "user"; reason: string | null },
  reports: { ok: number; failed: number },
): string {
  if (blocked.by === "system")
    return `${breakerReason(reports.failed, reports.ok + reports.failed)}.`;
  return blocked.reason ?? "Blocked by a publisher.";
}

/** Usage's line under release storage: what the live scenes hold, and how long they're kept. */
export const liveUsageText = (versions: { kept: number; bytes: number }): string =>
  `of which live scenes: ${formatBytes(versions.bytes)} in ${plural(versions.kept, "version", "versions", n)}. Each scene keeps its ${n(LIVE_LIMITS.keptPerScene)} newest versions plus those on a channel; others go ${n(RELEASE_GRACE_DAYS)} days after publishing.`;

/** The Publish scene dialog's and Live scenes' sentences, every number from `limits.ts`. */
export function liveWording(): LiveWording {
  return {
    noteMaxChars: LIVE_LIMITS.noteChars,
    notePlaceholder: `What changed, for your team (up to ${n(LIVE_LIMITS.noteChars)} characters)`,
    dataMaxBytes: LIVE_LIMITS.versionDataBytes,
    versionsPerDay: LIVE_LIMITS.versionsPerDay,
    data: (bytes) =>
      `Data: ${quotaAmount("liveVersionBytes", bytes)} of ${quotaAmount("liveVersionBytes", LIVE_LIMITS.versionDataBytes)}`,
    today: (count) =>
      `Today: ${quotaAmount("liveVersionsPerDay", count)} of ${quotaAmount("liveVersionsPerDay", LIVE_LIMITS.versionsPerDay)} versions`,
    stopConfirm: ({ release, scene, timing }) =>
      `Players go back to v${n(release)}'s version of ${scene} ${arrivalWords(timing)}.`,
  };
}

// ─── Views ───────────────────────────────────────────────

/** A wire date as ISO 8601, UTC. */
export const iso = (at: Date | string): string => new Date(at).toISOString();

/** What `listSceneVersions` answers with per version, dates as the wire carries them. */
export type SceneVersionSummaryInput = {
  scene: string;
  number: number;
  id: string;
  createdAt: Date | string;
  createdBy: string | null;
  note: string | null;
  dataBytes: number;
  pointers: readonly {
    channel: PublishChannel;
    timing: SwapTiming;
    since: Date | string;
    by: string | null;
  }[];
  blocked: { by: "system" | "user"; reason: string | null } | null;
  hidden: { reason: string | null } | null;
  collectedAt: Date | string | null;
  reports: { ok: number; failed: number };
  removalAt: Date | string | null;
};

export function liveVersionView(v: SceneVersionSummaryInput): LiveVersionView {
  return {
    scene: v.scene,
    number: v.number,
    id: v.id as Sha256,
    createdAt: iso(v.createdAt),
    createdBy: v.createdBy,
    note: v.note,
    dataBytes: v.dataBytes,
    pointers: v.pointers.map((p) => ({
      channel: p.channel,
      timing: p.timing,
      since: iso(p.since),
      by: p.by,
    })),
    blocked:
      v.blocked === null ? null : { by: v.blocked.by, text: liveBlockedText(v.blocked, v.reports) },
    hidden: v.hidden === null ? null : (v.hidden.reason ?? "Hidden by staff."),
    collected: v.collectedAt !== null,
    removal:
      v.removalAt === null
        ? null
        : { at: iso(v.removalAt), text: liveRemovalText(v.scene, v.number, v.removalAt) },
  };
}

/** What `getLiveBase` answers with, dates as the wire carries them. */
export type LiveBaseInput = Omit<LiveBaseView, "live"> & {
  live: (Omit<NonNullable<LiveBaseView["live"]>, "since"> & { since: Date | string }) | null;
};

export const liveBaseView = (b: LiveBaseInput): LiveBaseView => ({
  ...b,
  live: b.live === null ? null : { ...b.live, since: iso(b.live.since) },
});

// ─── The host ────────────────────────────────────────────

type SiteClient = (typeof import("@/orpc/client"))["client"];

/** The procedures the live host calls; the site's oRPC client by default. */
export type LiveRpc = Pick<
  SiteClient,
  | "beginSceneVersion"
  | "commitSceneVersion"
  | "promoteSceneVersion"
  | "rollbackSceneVersion"
  | "clearSceneVersion"
  | "listSceneVersions"
  | "getLiveBase"
  | "unblockSceneVersion"
  | "getProjectUsage"
>;

export type EditorLiveHostOptions = {
  project: ProjectId;
  /** The site's oRPC client, or a loader for it. */
  rpc: () => Promise<LiveRpc>;
  /** Whether this viewer may move production: the project's publishers and staff. */
  publisher: boolean;
  /** Sends one text to the release file route; default the browser's `fetch` with the session cookie. */
  fetch?: SendText;
};

/** The `fetch` the upload uses: a path and its request. */
export type SendText = (path: string, init: RequestInit) => Promise<Response>;

/** `PUT`s one text of an upload; a refusal comes back as the route's `{ code, message, hint }`. */
async function putText(
  send: SendText,
  uploadId: string,
  sha256: Sha256,
  text: string,
): Promise<void> {
  let response: Response;
  try {
    response = await send(engineReleaseFilePath(uploadId, sha256), {
      method: "PUT",
      body: text,
      credentials: "same-origin",
    });
  } catch {
    throw new PublishHostError(
      "The upload couldn't reach the site.",
      "network",
      "Check the connection, then publish again.",
    );
  }
  if (response.ok) return;
  const body: unknown = await response.json().catch(() => null);
  throw refusalOf(body, {
    message: `The upload was refused (${response.status}).`,
    code: String(response.status),
  });
}

/**
 * jams.team as the editor's live scene publisher: the Publish scene upload
 * (begin, each missing text through the release file route, commit, and the
 * production move when chosen), the pointer moves, the version list and
 * the live usage, over the site's oRPC procedures. Every sentence stating
 * a site number is written in `wording`; a refusal comes back as a
 * `PublishHostError` carrying the site's code, message and hint.
 */
export function editorLiveHost(opts: EditorLiveHostOptions): EditorLiveHost {
  const { project: projectId, rpc } = opts;
  const { publisher } = opts;
  const send: SendText = opts.fetch ?? ((path, init) => fetch(path, init));
  const listeners = new Set<(published: LivePublished) => void>();
  const announce = (published: LivePublished): LivePublished => {
    for (const listener of listeners) listener(published);
    return published;
  };

  return {
    async base(scene, channel) {
      const api = await rpc();
      return liveBaseView(await hostCall(() => api.getLiveBase({ projectId, scene, channel })));
    },

    async publish(versionText, texts, { channel, timing, note }, onProgress) {
      const api = await rpc();
      const production = channel === "production";
      onProgress?.({ step: "begin" });
      // Production is checked against production's release and leaves preview where it is.
      const begun = await hostCall(() =>
        api.beginSceneVersion({
          projectId,
          version: versionText,
          channel: production ? "none" : "preview",
          ...(production ? {} : { timing }),
          ...(note ? { note } : {}),
        }),
      );

      const total = begun.missing.reduce((sum, m) => sum + m.bytes, 0);
      let sent = 0;
      onProgress?.({ step: "upload", sent, total });
      for (const missing of begun.missing) {
        const text = texts[missing.sha256];
        if (text === undefined)
          throw new PublishHostError(
            `The site asked for a text this scene version doesn't carry (${shortId(missing.sha256)}).`,
            "live-text-missing",
            "Build the scene version again from the open scene, then publish it.",
          );
        await putText(send, begun.uploadId, missing.sha256, text);
        sent += missing.bytes;
        onProgress?.({ step: "upload", sent, total });
      }

      onProgress?.({ step: "commit" });
      const committed = await hostCall(() => api.commitSceneVersion({ uploadId: begun.uploadId }));
      const published: LivePublished = {
        versionId: committed.versionId,
        scene: committed.scene,
        number: committed.number,
        created: committed.created,
        channel: committed.liveOn,
      };
      if (!production) return announce(published);

      onProgress?.({ step: "promote" });
      try {
        await hostCall(() =>
          api.promoteSceneVersion({
            projectId,
            scene: committed.scene,
            number: committed.number,
            channel: "production",
            timing,
          }),
        );
      } catch (error) {
        // The version is stored either way: the lists show it, and the error says so.
        announce({ ...published, channel: null });
        throw savedNotPromoted(sceneVersionName(committed.scene, committed.number), error);
      }
      return announce({ ...published, channel: "production" });
    },

    async list(scene) {
      const api = await rpc();
      const versions = await hostCall(() =>
        api.listSceneVersions({ projectId, ...(scene !== undefined ? { scene } : {}) }),
      );
      return versions.map((v) => liveVersionView(v));
    },

    async promote(scene, number, channel, timing): Promise<LiveMove> {
      const api = await rpc();
      const moved = await hostCall(() =>
        api.promoteSceneVersion({ projectId, scene, number, channel, timing }),
      );
      return { from: moved.from, to: moved.to };
    },

    async rollback(scene, channel, moveOpts): Promise<LiveMove> {
      const api = await rpc();
      const moved = await hostCall(() =>
        api.rollbackSceneVersion({
          projectId,
          scene,
          channel,
          ...(moveOpts?.to !== undefined ? { to: moveOpts.to } : {}),
          ...(moveOpts?.timing !== undefined ? { timing: moveOpts.timing } : {}),
        }),
      );
      return { from: moved.from, to: moved.to };
    },

    async clear(scene, channel, timing): Promise<LiveMove> {
      const api = await rpc();
      const moved = await hostCall(() =>
        api.clearSceneVersion({
          projectId,
          scene,
          channel,
          ...(timing !== undefined ? { timing } : {}),
        }),
      );
      return { from: moved.from, to: null };
    },

    async unblock(scene, number) {
      const api = await rpc();
      await hostCall(() => api.unblockSceneVersion({ projectId, scene, number }));
    },

    async usage(): Promise<LiveUsageView> {
      const api = await rpc();
      const { usage } = await hostCall(() => api.getProjectUsage({ projectId }));
      return {
        today: usage.liveToday,
        versions: usage.liveVersions.kept,
        bytes: usage.liveVersions.bytes,
      };
    },

    role: () => ({ publisher }),

    wording: liveWording(),

    onPublished(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
