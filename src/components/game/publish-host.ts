import type {
  EditorNotify,
  EditorPublishHost,
  GameSettingsView,
  PublishChannel,
  PublishWording,
  ReleaseView,
  UsageLevel,
  UsageLineView,
  UsageView,
} from "@jams/engine/editor-ui";
import type { ProjectId, Sha256 } from "@jams/engine/project";

import {
  editorLiveHost,
  hostCall,
  iso,
  liveUsageText,
  type LiveRpc,
  type SendText,
} from "@/lib/engine/editor-live-host";
import { engineGamesAllowed } from "@/lib/engine/guard";
import {
  BLOB_GRACE_DAYS,
  CONNECT_ORIGINS_MAX,
  FRAME_TOKEN_HOURS,
  PROJECT_QUOTA,
  RELEASE_GRACE_DAYS,
  SITE_SAVE_EXPIRY_DAYS,
  SITE_SAVE_LIMITS,
} from "@/lib/engine/limits";
import { quotaAmount, quotaLabel, usageNotice, type UsageLine } from "@/lib/engine/quota";
import type { StoredUsage } from "@/lib/engine/usage";
import { formatBytes, formatCount } from "@/lib/format-bytes";
import { releaseDay } from "@/lib/jam-links";
import { SITE } from "@/lib/legal-meta";

/** The flag the editor's Publish panel and Usage section open behind, with the production guard. */
export const ENGINE_GAMES_FLAG = "engine-games-enabled";

/** Whether this viewer and deployment may see publishing at all. */
export const publishAllowed = (flag: (name: string) => boolean): boolean =>
  flag(ENGINE_GAMES_FLAG) && engineGamesAllowed();

type SiteClient = (typeof import("@/orpc/client"))["client"];

export { PublishHostError, publishError } from "@/lib/engine/editor-live-host";

/** The release procedures the publish host calls; the site's oRPC client by default. */
export type PublishRpc = Pick<
  SiteClient,
  | "getProjectUsage"
  | "listReleases"
  | "promoteRelease"
  | "rollbackRelease"
  | "getGameSettings"
  | "setGameSettings"
>;

/** Every procedure the publish host and its `live` member call. */
export type SitePublishRpc = PublishRpc & LiveRpc;

// ─── The words ───────────────────────────────────────────

const site = SITE.name;
const bytes = formatBytes;
const n = formatCount;

/** A quota's label at the start of a row: "Asset storage". */
const rowLabel = (quota: UsageLine["quota"]): string => {
  const label = quotaLabel(quota);
  return label.charAt(0).toUpperCase() + label.slice(1);
};

/** "12 MB of 64 MB" in the quota's own unit. */
const ofMax = (l: UsageLine): string =>
  `${quotaAmount(l.quota, l.used)} of ${quotaAmount(l.quota, l.max)}`;

/** The Publish panel's sentences, every number from `limits.ts`. */
export function publishWording(project: ProjectId, team: string | null = null): PublishWording {
  return {
    command: `vp run scene game release create ${project}`,
    noRelease:
      "Releases are built on your machine and uploaded. Run this in the project's repository:",
    token: "It needs an agent token with write access:",
    visibility: {
      private: "Private: only publishers and staff can play.",
      team: `Team: everyone on ${team ?? "the project's team"} can play.`,
      unlisted: "Unlisted: anyone with the link can play; it isn't listed anywhere.",
      public:
        "Public: listed on the project, team and jam pages. The first time a game goes public, staff review it; until then it stays unlisted.",
    },
    saveModes: {
      site: `On ${site} (players who sign in get ${n(SITE_SAVE_LIMITS.maxSlots)} saves of ${bytes(SITE_SAVE_LIMITS.maxBytes)}, deleted after ${n(SITE_SAVE_EXPIRY_DAYS)} days unused)`,
      own: "On its own servers (list them under Connects to)",
      none: "Nowhere",
    },
    connectsTo: `Origins this game may contact, up to ${n(CONNECT_ORIGINS_MAX)}. They are shown on the game page.`,
    connectOriginsMax: CONNECT_ORIGINS_MAX,
    privateLinks: `A private or team release opens through a link that works for ${n(FRAME_TOKEN_HOURS)} hours.`,
  };
}

/** "v2 will be removed on 3 Dec 2026. …" */
export const removalText = (version: number, at: Date | string): string =>
  `v${version} will be removed on ${releaseDay(at)}. Pin it to a jam or move a channel to it to keep it.`;

/** The confirmation Empty trash asks. */
export const emptyTrashConfirm = (assets: number, trashBytes: number): string =>
  `Permanently delete ${n(assets)} ${assets === 1 ? "asset" : "assets"} in the trash (${bytes(trashBytes)})? This can't be undone.`;

/** The cleanup rules under the usage rows. */
export const USAGE_FOOTER = `These limits are per project. Cleanup runs every day: releases outside the ${n(PROJECT_QUOTA.releasesKept)} newest ${n(RELEASE_GRACE_DAYS)} days after publishing, replaced asset versions after ${n(BLOB_GRACE_DAYS)} days. Pinned releases are never removed.`;

const LEVEL_RANK: Readonly<Record<UsageLevel, number>> = { ok: 0, warn: 1, full: 2 };

const worse = (a: UsageLevel, b: UsageLevel): UsageLevel => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a);

/** The stored usage `getProjectUsage` answers with. */
export type UsageReportInput = {
  usage: StoredUsage;
  lines: readonly UsageLine[];
};

const CHANNEL_ORDER: readonly PublishChannel[] = ["production", "preview"];

/** "production, preview, 1 jam version"; channels by name when the release list gave them. */
function pinnedText(
  usage: StoredUsage,
  channels: readonly PublishChannel[] | null,
): string | undefined {
  const parts: string[] = [];
  if (channels) parts.push(...CHANNEL_ORDER.filter((c) => channels.includes(c)));
  else if (usage.pinned.channels > 0)
    parts.push(
      `${n(usage.pinned.channels)} ${usage.pinned.channels === 1 ? "channel" : "channels"}`,
    );
  if (usage.pinned.jams > 0)
    parts.push(
      `${n(usage.pinned.jams)} ${usage.pinned.jams === 1 ? "jam version" : "jam versions"}`,
    );
  return parts.length > 0 ? `Pinned: ${parts.join(", ")}` : undefined;
}

/**
 * The Usage section's and the Publish panel's rows: one per quota, each
 * written with its numbers, the asset breakdown under asset storage, the
 * nearly-full or full notice, the trash and the cleanup rules. `channels`
 * names the pinned channels when the release list answered.
 */
export function usageView(
  report: UsageReportInput,
  channels: readonly PublishChannel[] | null = null,
): UsageView {
  const { usage } = report;
  const byQuota = new Map(report.lines.map((l) => [l.quota, l] as const));
  const row = (
    quota: UsageLine["quota"],
    text: (l: UsageLine) => string,
    detail?: string,
  ): UsageLineView | null => {
    const l = byQuota.get(quota);
    if (!l) return null;
    return {
      quota,
      text: text(l),
      used: l.used,
      max: l.max,
      ratio: l.ratio,
      level: l.level,
      ...(detail !== undefined ? { detail } : {}),
    };
  };

  const docs = byQuota.get("docs");
  const docBytes = byQuota.get("docBytes");
  const documents: UsageLineView | null =
    docs && docBytes
      ? (() => {
          const governing = docBytes.ratio > docs.ratio ? docBytes : docs;
          return {
            quota: "docs",
            text: `${rowLabel("docs")}: ${ofMax(docs)} · ${ofMax(docBytes)}`,
            used: governing.used,
            max: governing.max,
            ratio: governing.ratio,
            level: worse(docs.level, docBytes.level),
          };
        })()
      : null;

  const kept = PROJECT_QUOTA.releasesKept;
  const pinned = pinnedText(usage, channels);
  const keptRow: UsageLineView = {
    quota: "releasesKept",
    text: `Releases kept: ${n(usage.keptReleases)} of ${n(kept)} (plus pinned)`,
    used: usage.keptReleases,
    max: kept,
    ratio: usage.keptReleases / kept,
    // Releases past the newest are cleaned up, never refused, so this row never warns.
    level: "ok",
    ...(pinned !== undefined ? { detail: pinned } : {}),
  };

  const lines = [
    row(
      "assetBytes",
      (l) => `${rowLabel(l.quota)}: ${ofMax(l)}`,
      `${bytes(usage.liveBlobBytes)} in use · ${bytes(usage.trashBytes)} in the trash · ${bytes(usage.historyBytes)} replaced versions (deleted ${n(BLOB_GRACE_DAYS)} days after replacement)`,
    ),
    documents,
    row(
      "releaseStorageBytes",
      (l) => `${rowLabel(l.quota)}: ${ofMax(l)}`,
      liveUsageText(usage.liveVersions),
    ),
    row("releaseBytes", (l) =>
      usage.largestRelease
        ? `Largest release: v${usage.largestRelease.version}, ${bytes(l.used)} of ${bytes(l.max)} per release`
        : `Largest release: none yet, up to ${bytes(l.max)} per release`,
    ),
    keptRow,
    row("jamPins", (l) => `${rowLabel(l.quota)}: ${ofMax(l)}`),
    row("releasesPerDay", (l) => `Today: ${n(l.used)} of ${n(l.max)} releases`),
  ].filter((l): l is UsageLineView => l !== null);

  const level = lines.reduce<UsageLevel>((at, l) => worse(at, l.level), "ok");
  const notice = level === "ok" ? null : { level, text: usageNotice(level) ?? "" };
  const trash =
    usage.trashBytes > 0 || usage.trashAssets > 0
      ? {
          assets: usage.trashAssets,
          bytes: usage.trashBytes,
          confirm: emptyTrashConfirm(usage.trashAssets, usage.trashBytes),
        }
      : null;
  return { lines, notice, trash, footer: USAGE_FOOTER };
}

// ─── Releases and settings ───────────────────────────────

/** What `listReleases` answers with per release, dates as the wire carries them. */
export type ReleaseSummaryInput = {
  version: number;
  id: string;
  createdAt: Date | string;
  totalBytes: number;
  engineVersion: string;
  channels: readonly PublishChannel[];
  jams: readonly { title: string }[];
  firstPromotedAt: Date | string | null;
  collectedAt: Date | string | null;
  hidden: { reason: string | null } | null;
  removalAt: Date | string | null;
  playUrl: string;
};

export function releaseView(r: ReleaseSummaryInput): ReleaseView {
  return {
    version: r.version,
    id: r.id as Sha256,
    createdAt: iso(r.createdAt),
    bytes: r.totalBytes,
    engine: r.engineVersion,
    channels: r.channels,
    jams: r.jams.map((j) => j.title),
    firstPromotedAt: r.firstPromotedAt === null ? null : iso(r.firstPromotedAt),
    removal:
      r.removalAt === null
        ? null
        : { at: iso(r.removalAt), text: removalText(r.version, r.removalAt) },
    hidden: r.hidden === null ? null : (r.hidden.reason ?? "Hidden by staff."),
    collected: r.collectedAt !== null,
    playUrl: r.playUrl,
  };
}

export type SitePublishHostOptions = {
  project: ProjectId;
  /** The project's team by name; null for a personal project. */
  team?: string | null;
  /** Opens the site's agent token dialog for this project. */
  openTokenDialog: () => void;
  /** Where a change's side notes go, such as old copies left at the edge; default nowhere. */
  notify?: EditorNotify;
  /** Whether this viewer may move production; default true, since only publishers and staff read the settings this host opens behind. */
  publisher?: boolean;
  /** Default: the site's oRPC client, loaded on the first call. */
  rpc?: SitePublishRpc | (() => Promise<SitePublishRpc>);
  /** The live host's file uploads; default the browser's `fetch`. */
  fetch?: SendText;
};

const siteRpc = (): Promise<SitePublishRpc> => import("@/orpc/client").then((m) => m.client);

/**
 * jams.team as the editor's publisher: the project's usage, releases and
 * channels, its game settings and its live scene versions (`live`), over
 * the site's oRPC procedures, with every sentence that states a site
 * number written here. A refusal comes back as a `PublishHostError`
 * carrying the site's message and hint.
 */
export function sitePublishHost(opts: SitePublishHostOptions): EditorPublishHost {
  const { project } = opts;
  const team = opts.team ?? null;
  const source = opts.rpc ?? siteRpc;
  const rpc = typeof source === "function" ? source : () => Promise.resolve(source);
  const projectId = project;

  return {
    project,
    async usage() {
      const api = await rpc();
      const [report, releases] = await Promise.all([
        hostCall(() => api.getProjectUsage({ projectId })),
        hostCall(() => api.listReleases({ projectId })).catch(() => null),
      ]);
      const channels = releases
        ? [...new Set(releases.flatMap((r) => r.channels as readonly PublishChannel[]))]
        : null;
      return usageView(report, channels);
    },
    async releases() {
      const api = await rpc();
      const list = await hostCall(() => api.listReleases({ projectId }));
      return list.map((r) => releaseView(r));
    },
    async promote(version, channel, promoteOpts) {
      const api = await rpc();
      const keep = promoteOpts?.keepScenes;
      return hostCall(() =>
        api.promoteRelease({
          projectId,
          version,
          channel,
          ...(keep !== undefined ? { keepScenes: [...keep] } : {}),
        }),
      );
    },
    async rollback(channel, to) {
      const api = await rpc();
      return hostCall(() =>
        api.rollbackRelease({ projectId, channel, ...(to !== undefined ? { to } : {}) }),
      );
    },
    async settings(): Promise<GameSettingsView> {
      const api = await rpc();
      const saved = await hostCall(() => api.getGameSettings({ projectId }));
      return { ...saved, team };
    },
    async setSettings(patch): Promise<GameSettingsView> {
      const api = await rpc();
      const { connectOrigins, ...rest } = patch;
      const { edgeNote, ...saved } = await hostCall(() =>
        api.setGameSettings({
          projectId,
          ...rest,
          ...(connectOrigins ? { connectOrigins: [...connectOrigins] } : {}),
        }),
      );
      if (edgeNote) {
        opts.notify?.warning("Old public copies may stay cached for a while", {
          description: edgeNote,
        });
      }
      return { ...saved, team };
    },
    openTokenDialog: () => opts.openTokenDialog(),
    wording: publishWording(project, team),
    live: editorLiveHost({
      project,
      rpc,
      ...(opts.publisher !== undefined ? { publisher: opts.publisher } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    }),
  };
}
