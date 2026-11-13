import type { SwapTiming } from "@jams/engine/game";
import { parseSceneVersion, type AssetId, type Sha256 } from "@jams/engine/project";
import { and, count, desc, eq, inArray, isNotNull, isNull, lte, max, or, sql } from "drizzle-orm";

import { db as siteDb } from "@/db";
import {
  developerProfiles,
  engineLiveReports,
  engineReleaseAudit,
  engineReleases,
  engineSceneChannels,
  engineSceneVersionFiles,
  engineSceneVersions,
} from "@/db/schema";
import { memberName } from "@/lib/member-name";

import { sceneVersionForecast } from "./collect-plan";
import { LIVE_OUTCOMES, type LiveOutcome } from "./live-outcomes";
import {
  channelRelease,
  DEFAULT_SWAP_TIMING,
  moveScenePointer,
  noVersion,
  sceneVersionMisfit,
  type ChannelRelease,
  type LiveChannel,
  type ScenePointerMoved,
} from "./live-pointers";
import { effectiveLive, type LivePointerRow, type LiveSnapshot } from "./live-state";
import type { Viewer } from "./release-access";
import type { Actor, ReleaseDb } from "./release-audit";
import type { ReleaseApiError } from "./release-errors";
import type { ReleaseObjectStore } from "./release-storage";
import {
  heldHashes,
  notFound,
  readableProject,
  readStored,
  refuse,
  servedFrom,
  type ReleaseDeps,
  type ReleaseTxDb,
} from "./release-upload";
import type { ProjectRow } from "./release-viewer";

export { channelRelease, type ChannelRelease, type LiveChannel };

/** A pointer at a version: where, how players get it, since when and who moved it. */
export type SceneVersionPointer = {
  channel: LiveChannel;
  timing: SwapTiming;
  since: Date;
  /** The mover's display name; null for an agent's move or a deleted account. */
  by: string | null;
};

/** A scene version in the project's list: newest first, with its pointers, its state and when the cleanup removes it. */
export type SceneVersionSummary = {
  scene: AssetId;
  number: number;
  id: Sha256;
  createdAt: Date;
  /** The publisher's display name; null for an agent's or a deleted account's. */
  createdBy: string | null;
  note: string | null;
  physics: "rapier" | "none";
  /** The version file, the scene text and the prefab texts. */
  dataBytes: number;
  compatKey: Sha256;
  /** The release it was made against, when known. */
  baseReleaseId: Sha256 | null;
  pointers: SceneVersionPointer[];
  blocked: { at: Date; by: "system" | "user"; reason: string | null } | null;
  hidden: { at: Date; reason: string | null } | null;
  collectedAt: Date | null;
  /** Every player's outcomes, signed in or not. */
  reports: { ok: number; failed: number };
  /** When the collector removes it unless a channel points at it; null when it is kept. */
  removalAt: Date | null;
};

/** One file a version lists. */
export type SceneVersionFile = {
  sha256: Sha256;
  bytes: number;
  role: "version" | "scene" | "prefab" | "doc" | "blob";
  ext: string;
  source: "release" | "blob";
};

/** What `getSceneVersion` adds to a summary; `files` and `compat` are empty once the version is collected. */
export type SceneVersionDetail = SceneVersionSummary & {
  sceneHash: Sha256;
  files: SceneVersionFile[];
  /** Signed-in players' latest outcomes, by outcome. */
  outcomes: Readonly<Record<LiveOutcome, number>>;
  /** Whether it fits each kept release, newest first, with the first issue when it doesn't. */
  compat: { version: number; releaseId: Sha256; fits: boolean; issue: ReleaseApiError | null }[];
};

/**
 * What the Publish scene checks compare against on a channel: its release
 * (for `checkSceneVersion`) and the scene as players have it now (for the
 * diff), the live version's when a pointer applies, else the release's.
 */
export type LiveBase = {
  channel: LiveChannel;
  /** Null when nothing is on the channel yet. */
  release: { id: Sha256; version: number; manifest: string } | null;
  /** The scene's pointer on the channel, with its `scene-version.json`; null when the release's scene plays. */
  live: {
    number: number;
    versionId: Sha256;
    timing: SwapTiming;
    since: Date;
    descriptor: string;
  } | null;
  /** The scene's and its prefabs' texts that `live` (or the release) names, by hash. */
  texts: Readonly<Record<Sha256, string>>;
  /** The latest version's number for the scene on any channel, for "Edited since level-1@3"; null before the first. */
  latest: number | null;
};

/** What the reads run over; each defaults to the site's own. */
export type LiveReadDeps = {
  db?: ReleaseTxDb;
  now?: () => Date;
  /** The caller as the access rules see them; default read from the project, its team and the caller's roles. */
  viewer?: (userId: string, project: ProjectRow) => Promise<Viewer>;
};

const dbOf = (deps: LiveReadDeps): ReleaseDb => deps.db ?? (siteDb as unknown as ReleaseDb);

// ─── A channel's live state ─────────────────────────────

/** The channel's scene pointers joined to their versions, as `effectiveLive` reads them. */
export async function channelPointers(
  db: ReleaseDb,
  projectId: string,
  channel: LiveChannel,
  scene?: AssetId,
): Promise<LivePointerRow[]> {
  const rows = await db
    .select({
      scene: engineSceneChannels.sceneId,
      versionId: engineSceneChannels.versionId,
      number: engineSceneVersions.number,
      timing: engineSceneChannels.timing,
      since: engineSceneChannels.updatedAt,
      compatKey: engineSceneVersions.compatKey,
      collectedAt: engineSceneVersions.collectedAt,
      hiddenAt: engineSceneVersions.hiddenAt,
      blockedAt: engineSceneVersions.blockedAt,
    })
    .from(engineSceneChannels)
    .innerJoin(engineSceneVersions, eq(engineSceneVersions.id, engineSceneChannels.versionId))
    .where(
      and(
        eq(engineSceneChannels.projectId, projectId),
        eq(engineSceneChannels.channel, channel),
        ...(scene !== undefined ? [eq(engineSceneChannels.sceneId, scene)] : []),
      ),
    );
  return rows.map((r) => ({ ...r, timing: r.timing as SwapTiming }));
}

/** What a channel plays: its release and the live scenes that apply over it; null with no release. */
export async function channelLive(
  db: ReleaseDb,
  projectId: string,
  channel: LiveChannel,
  scene?: AssetId,
): Promise<{ release: ChannelRelease; snapshot: LiveSnapshot } | null> {
  const release = await channelRelease(db, projectId, channel);
  if (!release) return null;
  const pointers = await channelPointers(db, projectId, channel, scene);
  const snapshot = effectiveLive(
    {
      id: release.id,
      liveCompatKey: release.liveCompatKey,
      scenes: release.manifest.flow.scenes.map((s) => s.id),
    },
    pointers,
    release.rev,
    channel,
  );
  return { release, snapshot };
}

// ─── The list and one version ───────────────────────────

const summaryColumns = {
  id: engineSceneVersions.id,
  scene: engineSceneVersions.sceneId,
  number: engineSceneVersions.number,
  createdAt: engineSceneVersions.createdAt,
  createdById: engineSceneVersions.createdById,
  agentTokenId: engineSceneVersions.agentTokenId,
  note: engineSceneVersions.note,
  physics: engineSceneVersions.physics,
  dataBytes: engineSceneVersions.dataBytes,
  compatKey: engineSceneVersions.compatKey,
  baseReleaseId: engineSceneVersions.baseReleaseId,
  collectedAt: engineSceneVersions.collectedAt,
  hiddenAt: engineSceneVersions.hiddenAt,
  hiddenReason: engineSceneVersions.hiddenReason,
  blockedAt: engineSceneVersions.blockedAt,
  blockedBy: engineSceneVersions.blockedBy,
  blockReason: engineSceneVersions.blockReason,
  reportsOk: engineSceneVersions.reportsOk,
  reportsFailed: engineSceneVersions.reportsFailed,
};

const MOVE_ACTIONS = ["scene-promote", "scene-rollback"];

/** Display names by user id, as staff surfaces show them. */
async function namesOf(db: ReleaseDb, ids: readonly (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map<string, string | null>();
  const rows = await db
    .select({
      id: developerProfiles.id,
      guildNickname: developerProfiles.guildNickname,
      discordUsername: developerProfiles.discordUsername,
    })
    .from(developerProfiles)
    .where(inArray(developerProfiles.id, unique));
  return new Map(rows.map((r) => [r.id, memberName(r)]));
}

/** How many removed versions of each scene the list still shows, newest first. */
const REMOVED_LISTED_PER_SCENE = 5;

/**
 * The project's versions (one scene's with `scene`), newest first, with
 * their pointers and removal dates: every version not yet removed, and
 * each scene's newest removed ones (or the one `number` asks for).
 */
async function summaries(
  db: ReleaseDb,
  projectId: string,
  now: Date,
  only: { scene?: AssetId; number?: number } = {},
): Promise<SceneVersionSummary[]> {
  const ofProject = and(
    eq(engineSceneVersions.projectId, projectId),
    ...(only.scene !== undefined ? [eq(engineSceneVersions.sceneId, only.scene)] : []),
  );
  const removed = db
    .select({
      id: engineSceneVersions.id,
      rank: sql<number>`row_number() over (partition by ${engineSceneVersions.sceneId} order by ${engineSceneVersions.number} desc)`.as(
        "rank",
      ),
    })
    .from(engineSceneVersions)
    .where(and(ofProject, isNotNull(engineSceneVersions.collectedAt)))
    .as("removed");
  const [rows, pointers, moves] = await Promise.all([
    db
      .select(summaryColumns)
      .from(engineSceneVersions)
      .where(
        and(
          ofProject,
          or(
            isNull(engineSceneVersions.collectedAt),
            inArray(
              engineSceneVersions.id,
              db
                .select({ id: removed.id })
                .from(removed)
                .where(lte(removed.rank, REMOVED_LISTED_PER_SCENE)),
            ),
            ...(only.number !== undefined ? [eq(engineSceneVersions.number, only.number)] : []),
          ),
        ),
      )
      .orderBy(desc(engineSceneVersions.createdAt), desc(engineSceneVersions.number)),
    db
      .select({
        channel: engineSceneChannels.channel,
        scene: engineSceneChannels.sceneId,
        versionId: engineSceneChannels.versionId,
        timing: engineSceneChannels.timing,
        since: engineSceneChannels.updatedAt,
        updatedById: engineSceneChannels.updatedById,
      })
      .from(engineSceneChannels)
      .where(eq(engineSceneChannels.projectId, projectId))
      .orderBy(engineSceneChannels.channel),
    // Only the latest move of each scene that has a pointer.
    db
      .select({
        channel: engineReleaseAudit.channel,
        scene: engineReleaseAudit.sceneId,
        actorKind: engineReleaseAudit.actorKind,
      })
      .from(engineReleaseAudit)
      .where(
        inArray(
          engineReleaseAudit.id,
          db
            .select({ id: sql<number>`max(${engineReleaseAudit.id})` })
            .from(engineReleaseAudit)
            .innerJoin(
              engineSceneChannels,
              and(
                eq(engineSceneChannels.projectId, engineReleaseAudit.projectId),
                eq(engineSceneChannels.channel, engineReleaseAudit.channel),
                eq(engineSceneChannels.sceneId, engineReleaseAudit.sceneId),
              ),
            )
            .where(
              and(
                eq(engineReleaseAudit.projectId, projectId),
                inArray(engineReleaseAudit.action, MOVE_ACTIONS),
              ),
            )
            .groupBy(engineReleaseAudit.channel, engineReleaseAudit.sceneId),
        ),
      ),
  ]);

  // A pointer's mover is the latest move's actor; an agent's move names nobody.
  const lastMover = new Map<string, string>();
  for (const m of moves) {
    const key = `${m.channel}:${m.scene}`;
    if (!lastMover.has(key)) lastMover.set(key, m.actorKind);
  }
  const movedByAgent = (p: { channel: string; scene: string }) =>
    lastMover.get(`${p.channel}:${p.scene}`) === "agent";

  const removals = new Map(
    sceneVersionForecast(
      rows,
      pointers.map((p) => p.versionId),
      now,
    ).map((f) => [`${f.scene}@${f.number}`, f.at]),
  );

  const shown = rows.filter(
    (r) =>
      (only.scene === undefined || r.scene === only.scene) &&
      (only.number === undefined || r.number === only.number),
  );
  const names = await namesOf(db, [
    ...shown.map((r) => (r.agentTokenId === null ? r.createdById : null)),
    ...pointers.map((p) => (movedByAgent(p) ? null : p.updatedById)),
  ]);
  const nameOf = (id: string | null) => (id === null ? null : (names.get(id) ?? null));

  return shown.map((r) => ({
    scene: r.scene,
    number: r.number,
    id: r.id,
    createdAt: r.createdAt,
    createdBy: r.agentTokenId === null ? nameOf(r.createdById) : null,
    note: r.note,
    physics: r.physics as "rapier" | "none",
    dataBytes: r.dataBytes,
    compatKey: r.compatKey,
    baseReleaseId: r.baseReleaseId,
    pointers: pointers
      .filter((p) => p.versionId === r.id)
      .map((p) => ({
        channel: p.channel as LiveChannel,
        timing: p.timing as SwapTiming,
        since: p.since,
        by: movedByAgent(p) ? null : nameOf(p.updatedById),
      })),
    blocked: r.blockedAt
      ? { at: r.blockedAt, by: r.blockedBy === "system" ? "system" : "user", reason: r.blockReason }
      : null,
    hidden: r.hiddenAt ? { at: r.hiddenAt, reason: r.hiddenReason } : null,
    collectedAt: r.collectedAt,
    reports: { ok: r.reportsOk, failed: r.reportsFailed },
    removalAt: removals.get(`${r.scene}@${r.number}`) ?? null,
  }));
}

/** Every scene version of the project (one scene's with `scene`), newest first, with its pointers, state and removal date. */
export async function listSceneVersions(
  input: { projectId: string; scene?: AssetId; actor: Actor },
  deps: LiveReadDeps = {},
): Promise<SceneVersionSummary[]> {
  const db = dbOf(deps);
  await readableProject(deps, db, input);
  const now = (deps.now ?? (() => new Date()))();
  return summaries(db, input.projectId, now, {
    ...(input.scene !== undefined ? { scene: input.scene } : {}),
  });
}

/** Whether `version` fits each kept release of the project, newest first, with the first error when it doesn't. */
async function compatPerRelease(
  db: ReleaseDb,
  projectId: string,
  version: { scene: AssetId; number: number; descriptor: string; compatKey: string },
): Promise<SceneVersionDetail["compat"]> {
  const releases = await db
    .select({
      id: engineReleases.id,
      version: engineReleases.version,
      manifest: engineReleases.manifest,
      liveCompatKey: engineReleases.liveCompatKey,
    })
    .from(engineReleases)
    .where(and(eq(engineReleases.projectId, projectId), isNull(engineReleases.collectedAt)))
    .orderBy(desc(engineReleases.version));
  return releases.map((r) => {
    const issue = sceneVersionMisfit(version, r);
    return { version: r.version, releaseId: r.id, fits: issue === null, issue };
  });
}

/** One version's summary, its files, its players' outcomes and whether it fits each kept release. */
export async function getSceneVersion(
  input: { projectId: string; scene: AssetId; number: number; actor: Actor },
  deps: LiveReadDeps = {},
): Promise<SceneVersionDetail> {
  const db = dbOf(deps);
  const { projectId, scene, number } = input;
  await readableProject(deps, db, input);
  const now = (deps.now ?? (() => new Date()))();
  const [summary] = await summaries(db, projectId, now, { scene, number });
  if (!summary) refuse(noVersion(scene, number), 404);

  const [[stored], files, outcomes] = await Promise.all([
    db
      .select({
        descriptor: engineSceneVersions.descriptor,
        sceneHash: engineSceneVersions.sceneHash,
      })
      .from(engineSceneVersions)
      .where(eq(engineSceneVersions.id, summary.id)),
    db
      .select({
        sha256: engineSceneVersionFiles.sha256,
        bytes: engineSceneVersionFiles.bytes,
        role: engineSceneVersionFiles.role,
        ext: engineSceneVersionFiles.ext,
        source: engineSceneVersionFiles.source,
      })
      .from(engineSceneVersionFiles)
      .where(eq(engineSceneVersionFiles.versionId, summary.id))
      .orderBy(engineSceneVersionFiles.role, engineSceneVersionFiles.sha256),
    db
      .select({ outcome: engineLiveReports.outcome, n: count() })
      .from(engineLiveReports)
      .where(eq(engineLiveReports.versionId, summary.id))
      .groupBy(engineLiveReports.outcome),
  ]);

  const byOutcome = new Map(outcomes.map((o) => [o.outcome, o.n]));
  return {
    ...summary,
    sceneHash: stored?.sceneHash ?? "",
    files: summary.collectedAt
      ? []
      : files.map((f) => ({
          ...f,
          role: f.role as SceneVersionFile["role"],
          source: f.source as SceneVersionFile["source"],
        })),
    outcomes: Object.fromEntries(
      LIVE_OUTCOMES.map((o) => [o, byOutcome.get(o) ?? 0]),
    ) as SceneVersionDetail["outcomes"],
    compat:
      stored?.descriptor && !summary.collectedAt
        ? await compatPerRelease(db, projectId, {
            scene,
            number,
            descriptor: stored.descriptor,
            compatKey: summary.compatKey,
          })
        : [],
  };
}

// ─── The Publish scene checks' base ─────────────────────

/** The texts `assets` names for the scene and its prefabs, read from the project's stored objects. */
async function storedTexts(
  db: ReleaseDb,
  store: ReleaseObjectStore,
  projectId: string,
  hashes: readonly Sha256[],
): Promise<Record<Sha256, string>> {
  const held = await heldHashes(db, projectId, hashes);
  const texts: Record<Sha256, string> = {};
  await Promise.all(
    [...new Set(hashes)].map(async (sha256) => {
      const at = servedFrom(held, sha256);
      const bytes = at ? await readStored(store, at.storageKey, null) : null;
      if (bytes) texts[sha256] = new TextDecoder().decode(bytes);
    }),
  );
  return Object.fromEntries(Object.entries(texts).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The hashes of `scene`'s text and its prefabs' among `assets`. */
function sceneHashes(
  scene: AssetId,
  prefabs: readonly AssetId[],
  assets: Readonly<Record<AssetId, { sha256: Sha256 }>>,
): Sha256[] {
  return [scene, ...prefabs].flatMap((id) => {
    const asset = Object.hasOwn(assets, id) ? assets[id] : undefined;
    return asset ? [asset.sha256] : [];
  });
}

/**
 * What the editor's Publish scene checks and diffs `scene` against on
 * `channel`: the channel's release with its canonical manifest, the scene's
 * pointer when it applies (`effectiveLive`), and the scene's and its
 * prefabs' canonical texts that the pointed version, else the release, holds.
 */
export async function liveBase(
  input: { projectId: string; scene: AssetId; channel: LiveChannel; actor: Actor },
  deps: LiveReadDeps & { store: ReleaseObjectStore },
): Promise<LiveBase> {
  const db = dbOf(deps);
  const { projectId, scene, channel } = input;
  await readableProject(deps, db, input);

  const [[top], live] = await Promise.all([
    db
      .select({ number: max(engineSceneVersions.number) })
      .from(engineSceneVersions)
      .where(
        and(eq(engineSceneVersions.projectId, projectId), eq(engineSceneVersions.sceneId, scene)),
      ),
    channelLive(db, projectId, channel, scene),
  ]);
  const latest = top?.number ?? null;
  if (!live) return { channel, release: null, live: null, texts: {}, latest };

  const { release, snapshot } = live;
  const base = {
    channel,
    release: { id: release.id, version: release.version, manifest: release.manifestText },
    latest,
  };
  const entry = snapshot.scenes.find((s) => s.scene === scene);
  if (entry) {
    const [row] = await db
      .select({ descriptor: engineSceneVersions.descriptor })
      .from(engineSceneVersions)
      .where(eq(engineSceneVersions.id, entry.version));
    const parsed = row?.descriptor ? parseSceneVersion(row.descriptor) : null;
    if (row?.descriptor && parsed?.ok) {
      const { version } = parsed;
      return {
        ...base,
        live: {
          number: entry.number,
          versionId: entry.version,
          timing: entry.timing,
          since: new Date(entry.since),
          descriptor: row.descriptor,
        },
        texts: await storedTexts(
          db,
          deps.store,
          projectId,
          sceneHashes(scene, version.entry.prefabs, version.assets),
        ),
      };
    }
  }

  const own = release.manifest.flow.scenes.find((s) => s.id === scene);
  return {
    ...base,
    live: null,
    texts: own
      ? await storedTexts(
          db,
          deps.store,
          projectId,
          sceneHashes(scene, own.prefabs, release.manifest.assets),
        )
      : {},
  };
}

// ─── Pointer moves, as the transports call them ─────────

type MoveInput = { projectId: string; scene: AssetId; channel: LiveChannel; actor: Actor };

/** Points `channel`'s scene at version `number`; the timing defaults to the next load. */
export async function promoteScene(
  deps: ReleaseDeps,
  input: MoveInput & { number: number; timing?: SwapTiming },
): Promise<{ from: number | null; to: number; timing: SwapTiming }> {
  const timing = input.timing ?? DEFAULT_SWAP_TIMING;
  const moved = await moveScenePointer(deps, {
    ...moveOf(input),
    to: { number: input.number },
    timing,
    action: "scene-promote",
  });
  return { from: moved.from, to: input.number, timing };
}

/**
 * Back to the scene's previous pointer on the channel (or the release's
 * scene), or to version `to`. `from` is null when the release's scene
 * played. Going back to the release's scene ignores `timing`: players go
 * back at the removed pointer's timing.
 */
export async function rollbackScene(
  deps: ReleaseDeps,
  input: MoveInput & { to?: number; timing?: SwapTiming },
): Promise<ScenePointerMoved> {
  return moveScenePointer(deps, {
    ...moveOf(input),
    to: input.to === undefined ? "previous" : { number: input.to },
    timing: input.timing ?? DEFAULT_SWAP_TIMING,
    action: "scene-rollback",
  });
}

/** "Stop": the channel plays the release's own scene again, at the removed pointer's timing; `timing` is ignored. */
export async function clearScene(
  deps: ReleaseDeps,
  input: MoveInput & { timing?: SwapTiming },
): Promise<{ from: number }> {
  const moved = await moveScenePointer(deps, {
    ...moveOf(input),
    to: null,
    timing: input.timing ?? DEFAULT_SWAP_TIMING,
    action: "scene-clear",
  });
  return { from: playing(moved.from, input) };
}

const moveOf = ({ projectId, scene, channel, actor }: MoveInput) => ({
  projectId,
  scene,
  channel,
  actor,
});

/** The version a channel played before a stop: with none, there was nothing to stop and nothing moved. */
function playing(from: number | null, input: MoveInput): number {
  return from ?? notFound(`${input.channel} doesn't play a live version of "${input.scene}".`);
}
