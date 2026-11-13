import type { AssetId, Sha256 } from "@jams/engine/project";
import { and, desc, eq, inArray, isNull, max, or, sql } from "drizzle-orm";

import { db as siteDb } from "@/db";
import {
  engineLiveReports,
  engineProjects,
  engineReleaseAudit,
  engineReleaseChannels,
  engineReleaseJamLinks,
  engineReleases,
  engineSceneChannels,
  engineSceneVersions,
  projects,
} from "@/db/schema";
import { siteUrl } from "@/env";
import { gamePagePath } from "@/lib/og/game-links";
import { checkRateLimit } from "@/lib/rate-limit";

import { announceReleaseChange } from "./frame-cache-notice";
import { LIVE_REPORTS_PER_HOUR } from "./limits";
import { shouldBlock } from "./live-breaker";
import { breakerReason, isFailedOutcome, type LiveOutcome } from "./live-outcomes";
import {
  announceLiveMove,
  lockProject,
  noVersion,
  setLiveRev,
  type LiveChannel,
} from "./live-pointers";
import type { LiveReadDeps } from "./live-versions";
import { canDo, canPlay, refusalFor, roleOf, type GameVisibility } from "./release-access";
import { writeAudit, type Actor, type ReleaseDb } from "./release-audit";
import { releaseForbidden } from "./release-errors";
import { actorRole, liveProject, notFound, refuse, type ReleaseTxDb } from "./release-upload";
import { releaseViewer } from "./release-viewer";
import { viewerOf } from "./viewer";

/** What the moderation of scene versions runs over; each field defaults to the site's own. */
export type LiveModerationDeps = LiveReadDeps & {
  /** A fixed-window limiter: true while `key` has made fewer than `limit` calls in the window. */
  rateLimit?: (
    bucket: string,
    key: string,
    limit: number,
    windowSeconds: number,
  ) => Promise<boolean>;
  /** Drops a project's cached frame lookups; default this process's at once, and every other's through the release notice. */
  forgetProject?: (projectId: string) => void;
};

export type { LiveOutcome };

/** A play page's report of what its frame did with a version. */
export type LiveReport = {
  projectId: string;
  versionId: Sha256;
  channel: LiveChannel;
  outcome: LiveOutcome;
  issueCode?: string;
  /** The signed-in player; null for a signed-out one. */
  userId: string | null;
  /** A signed-out player's anonymous id, the UUID the browser keeps. */
  anonId?: string;
};

/** A scene version in staff's queue, across projects. */
export type SceneVersionQueueItem = {
  projectId: string;
  projectName: string;
  scene: AssetId;
  number: number;
  id: Sha256;
  createdAt: Date;
  compatKey: Sha256;
  pointers: LiveChannel[];
  reports: { ok: number; failed: number };
  blocked: { at: Date; by: "system" | "user"; reason: string | null } | null;
  hidden: { at: Date; reason: string | null } | null;
};

const HOUR_SECONDS = 3600;
const QUEUE_MAX = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const resolved = (deps: LiveModerationDeps) => ({
  db: deps.db ?? (siteDb as unknown as ReleaseTxDb),
  now: deps.now ?? (() => new Date()),
  rateLimit: deps.rateLimit ?? checkRateLimit,
  forgetProject:
    deps.forgetProject ??
    ((projectId: string) =>
      void announceReleaseChange({ releaseIds: [], projectIds: [projectId] })),
});

/**
 * Whose window a report counts against: the signed-in player, or a
 * signed-out one's anonymous id as `mintPlayerToken` names it. Signed-out
 * reports without a usable id share one window.
 */
export function liveReportKey(userId: string | null, anonId?: string): string {
  if (userId !== null) return userId;
  if (anonId !== undefined && UUID.test(anonId)) return `anon:${anonId.toLowerCase()}`;
  return "anon";
}

const versionColumns = {
  id: engineSceneVersions.id,
  scene: engineSceneVersions.sceneId,
  number: engineSceneVersions.number,
  collectedAt: engineSceneVersions.collectedAt,
  hiddenAt: engineSceneVersions.hiddenAt,
  blockedAt: engineSceneVersions.blockedAt,
};

async function versionByNumber(db: ReleaseDb, projectId: string, scene: AssetId, number: number) {
  const [row] = await db
    .select(versionColumns)
    .from(engineSceneVersions)
    .where(
      and(
        eq(engineSceneVersions.projectId, projectId),
        eq(engineSceneVersions.sceneId, scene),
        eq(engineSceneVersions.number, number),
      ),
    );
  return row ?? refuse(noVersion(scene, number), 404);
}

/** The channels whose pointers name the version. */
async function pointedOn(db: ReleaseDb, versionId: string): Promise<LiveChannel[]> {
  const rows = await db
    .select({ channel: engineSceneChannels.channel })
    .from(engineSceneChannels)
    .where(eq(engineSceneChannels.versionId, versionId))
    .orderBy(engineSceneChannels.channel);
  return rows.map((r) => r.channel as LiveChannel);
}

/**
 * Inside the caller's transaction, which holds the project's lock: stores
 * the audit row's id as `live_rev` on every channel whose pointer names the
 * version, and answers those channels for the caller to announce once it
 * commits.
 */
async function bumpPointedChannels(
  tx: ReleaseDb,
  projectId: string,
  versionId: string,
  rev: number,
): Promise<LiveChannel[]> {
  const channels = await pointedOn(tx, versionId);
  await setLiveRev(tx, projectId, channels, rev);
  return channels;
}

async function announceAll(
  projectId: string,
  moved: { channels: readonly LiveChannel[]; rev: number } | null,
): Promise<void> {
  if (!moved) return;
  for (const channel of moved.channels) await announceLiveMove(projectId, channel, moved.rev);
}

// ─── Reports and the breaker ─────────────────────────────

/** Whether this viewer plays the channel, as the play page decides for `latest` and `preview`. */
async function playsChannel(
  deps: LiveModerationDeps,
  db: ReleaseDb,
  input: { projectId: string; channel: LiveChannel; userId: string | null },
): Promise<boolean> {
  const [row] = await db
    .select({
      projectId: engineProjects.projectId,
      game: engineProjects.game,
      teamId: engineProjects.teamId,
      createdById: engineProjects.createdById,
      visibility: engineProjects.visibility,
      projectHiddenAt: engineProjects.hiddenAt,
      releaseId: engineReleases.id,
      hiddenAt: engineReleases.hiddenAt,
      collectedAt: engineReleases.collectedAt,
      firstPromotedAt: engineReleases.firstPromotedAt,
    })
    .from(engineReleaseChannels)
    .innerJoin(engineProjects, eq(engineProjects.projectId, engineReleaseChannels.projectId))
    .innerJoin(engineReleases, eq(engineReleases.id, engineReleaseChannels.releaseId))
    .where(
      and(
        eq(engineReleaseChannels.projectId, input.projectId),
        eq(engineReleaseChannels.channel, input.channel),
        isNull(engineProjects.deletedAt),
      ),
    );
  if (!row) return false;
  const project = {
    projectId: row.projectId,
    game: row.game,
    teamId: row.teamId,
    createdById: row.createdById,
  };
  const viewer =
    input.userId === null
      ? await viewerOf(null, input.projectId, db)
      : await (deps.viewer ?? ((id, p) => releaseViewer(db, id, p)))(input.userId, project);
  if (input.channel === "preview" && roleOf(viewer, project) === "player") return false;
  const [pin] = await db
    .select({ jamId: engineReleaseJamLinks.jamId })
    .from(engineReleaseJamLinks)
    .where(eq(engineReleaseJamLinks.releaseId, row.releaseId))
    .limit(1);
  return canPlay(
    viewer,
    {
      visibility: row.visibility as GameVisibility,
      teamId: row.teamId,
      hiddenAt: row.projectHiddenAt,
    },
    { ...row, jamPinned: pin !== undefined },
  ).ok;
}

/**
 * When the breaker starts counting for a version on a channel: the later
 * of its pointer's last move and its last unblock. Null when the channel
 * doesn't point at it, so there's nothing to block.
 */
async function breakerSince(
  db: ReleaseDb,
  input: { projectId: string; channel: LiveChannel; versionId: string },
): Promise<Date | null> {
  const [pointer] = await db
    .select({ at: engineSceneChannels.updatedAt })
    .from(engineSceneChannels)
    .where(
      and(
        eq(engineSceneChannels.projectId, input.projectId),
        eq(engineSceneChannels.channel, input.channel),
        eq(engineSceneChannels.versionId, input.versionId),
      ),
    );
  if (!pointer) return null;
  const [unblock] = await db
    .select({ at: max(engineReleaseAudit.at) })
    .from(engineReleaseAudit)
    .where(
      and(
        eq(engineReleaseAudit.projectId, input.projectId),
        eq(engineReleaseAudit.sceneVersionId, input.versionId),
        eq(engineReleaseAudit.action, "scene-unblock"),
      ),
    );
  const unblocked = unblock?.at ?? null;
  return unblocked && unblocked > pointer.at ? unblocked : pointer.at;
}

/** Runs the breaker over the version's signed-in reports on the channel, and blocks it when it trips. */
async function runBreaker(
  db: ReleaseTxDb,
  input: { projectId: string; channel: LiveChannel; versionId: string; scene: AssetId },
  now: Date,
): Promise<void> {
  const since = await breakerSince(db, input);
  if (!since) return;
  const rows = await db
    .select({
      userId: engineLiveReports.userId,
      outcome: engineLiveReports.outcome,
      at: engineLiveReports.at,
    })
    .from(engineLiveReports)
    .where(
      and(
        eq(engineLiveReports.versionId, input.versionId),
        eq(engineLiveReports.channel, input.channel),
      ),
    );
  const verdict = shouldBlock(rows, since, now);
  if (!verdict.block) return;

  const reason = breakerReason(verdict.failed, verdict.total);
  const moved = await db.transaction(async (tx) => {
    await lockProject(tx, input.projectId);
    const [blocked] = await tx
      .update(engineSceneVersions)
      .set({ blockedAt: now, blockedBy: "system", blockedById: null, blockReason: reason })
      .where(
        and(
          eq(engineSceneVersions.id, input.versionId),
          isNull(engineSceneVersions.blockedAt),
          isNull(engineSceneVersions.hiddenAt),
        ),
      )
      .returning({ id: engineSceneVersions.id });
    if (!blocked) return null;
    const rev = await writeAudit(tx, {
      projectId: input.projectId,
      actor: { kind: "system" },
      action: "scene-block",
      channel: input.channel,
      sceneId: input.scene,
      sceneVersionId: input.versionId,
      detail: { reason, failed: verdict.failed, total: verdict.total },
      at: now,
    });
    return { rev, channels: await bumpPointedChannels(tx, input.projectId, input.versionId, rev) };
  });
  await announceAll(input.projectId, moved);
}

/**
 * Moves one count on a version's report counters: up on `to`'s side, and
 * down on `from`'s when the player had reported before (null: they hadn't).
 */
async function countReport(
  db: ReleaseDb,
  versionId: string,
  from: boolean | null,
  to: boolean,
): Promise<void> {
  if (from === to) return;
  const { reportsOk: ok, reportsFailed: failed } = engineSceneVersions;
  await db
    .update(engineSceneVersions)
    .set({
      ...(to ? { reportsFailed: sql`${failed} + 1` } : { reportsOk: sql`${ok} + 1` }),
      ...(from === null
        ? {}
        : from
          ? { reportsFailed: sql`greatest(${failed} - 1, 0)` }
          : { reportsOk: sql`greatest(${ok} - 1, 0)` }),
    })
    .where(eq(engineSceneVersions.id, versionId));
}

/**
 * A play page's report of what its frame did with a version, once per
 * version per page load. At most `LIVE_REPORTS_PER_HOUR` an hour per
 * player (or anonymous id); over that it is dropped without a word, as is
 * a report on a version no pointer on the channel names. A signed-in
 * report keeps its player's latest outcome (one row per version and
 * player, the last channel winning) and the counters count that player
 * once, by that outcome; an anonymous one only bumps a counter. The
 * breaker runs over the signed-in rows for the channel.
 */
export async function reportLiveOutcome(
  input: LiveReport,
  deps: LiveModerationDeps = {},
): Promise<null> {
  const { db, now, rateLimit } = resolved(deps);
  const key = liveReportKey(input.userId, input.anonId);
  if (!(await rateLimit("engine-live-report", key, LIVE_REPORTS_PER_HOUR, HOUR_SECONDS)))
    return null;

  const notHere = () => notFound("That scene version isn't on this game.");
  if (!(await playsChannel(deps, db, input))) notHere();
  const [version] = await db
    .select({ id: engineSceneVersions.id, scene: engineSceneVersions.sceneId })
    .from(engineSceneVersions)
    .where(
      and(
        eq(engineSceneVersions.id, input.versionId),
        eq(engineSceneVersions.projectId, input.projectId),
        isNull(engineSceneVersions.collectedAt),
      ),
    );
  if (!version) return notHere();
  if (!(await pointedOn(db, version.id)).includes(input.channel)) return null;

  const at = now();
  const failed = isFailedOutcome(input.outcome);
  const userId = input.userId;
  if (userId === null) {
    await countReport(db, version.id, null, failed);
    return null;
  }

  const row = {
    channel: input.channel,
    outcome: input.outcome,
    issueCode: input.issueCode ?? null,
    at,
  };
  await db.transaction(async (tx) => {
    const [first] = await tx
      .insert(engineLiveReports)
      .values({ versionId: version.id, userId, ...row })
      .onConflictDoNothing()
      .returning({ outcome: engineLiveReports.outcome });
    if (first) return countReport(tx, version.id, null, failed);
    const [before] = await tx
      .select({ outcome: engineLiveReports.outcome })
      .from(engineLiveReports)
      .where(and(eq(engineLiveReports.versionId, version.id), eq(engineLiveReports.userId, userId)))
      .for("update");
    await tx
      .insert(engineLiveReports)
      .values({ versionId: version.id, userId, ...row })
      .onConflictDoUpdate({
        target: [engineLiveReports.versionId, engineLiveReports.userId],
        set: row,
      });
    await countReport(tx, version.id, before ? isFailedOutcome(before.outcome) : null, failed);
  });

  if (failed)
    await runBreaker(
      db,
      {
        projectId: input.projectId,
        channel: input.channel,
        versionId: version.id,
        scene: version.scene,
      },
      at,
    );
  return null;
}

// ─── Block and unblock ───────────────────────────────────

type VersionAt = { projectId: string; scene: AssetId; number: number; actor: Actor };

/** The project and version, once the caller's role may block it where it's pointed at. */
async function blockable(deps: LiveModerationDeps, db: ReleaseDb, input: VersionAt) {
  const project = await liveProject(db, input.projectId);
  const version = await versionByNumber(db, project.projectId, input.scene, input.number);
  const refusal = refusalFor(await actorRole(deps, db, input.actor, project), "live-block", {
    gameUrl: siteUrl(gamePagePath(project.projectId)),
    target: { pointedOn: await pointedOn(db, version.id) },
  });
  if (refusal) refuse(refusal);
  return version;
}

/**
 * Stops every channel from playing a version until it is unblocked; the
 * pointers stay where they are. Blocking a version production points at
 * takes a publisher. Blocking a blocked version changes nothing.
 */
export async function blockSceneVersion(
  input: VersionAt & { reason?: string },
  deps: LiveModerationDeps = {},
): Promise<null> {
  const { db, now } = resolved(deps);
  const version = await blockable(deps, db, input);
  if (version.blockedAt) return null;
  const reason = input.reason?.trim() || null;
  const at = now();
  const moved = await db.transaction(async (tx) => {
    await lockProject(tx, input.projectId);
    await tx
      .update(engineSceneVersions)
      .set({
        blockedAt: at,
        blockedBy: "user",
        blockedById: input.actor.userId,
        blockReason: reason,
      })
      .where(eq(engineSceneVersions.id, version.id));
    const rev = await writeAudit(tx, {
      projectId: input.projectId,
      actor: input.actor,
      action: "scene-block",
      sceneId: version.scene,
      sceneVersionId: version.id,
      detail: { reason, number: version.number },
      at,
    });
    return { rev, channels: await bumpPointedChannels(tx, input.projectId, version.id, rev) };
  });
  await announceAll(input.projectId, moved);
  return null;
}

/** Lets a blocked version play again; the breaker counts afresh from now. */
export async function unblockSceneVersion(
  input: VersionAt,
  deps: LiveModerationDeps = {},
): Promise<null> {
  const { db, now } = resolved(deps);
  const version = await blockable(deps, db, input);
  if (!version.blockedAt) return null;
  const at = now();
  const moved = await db.transaction(async (tx) => {
    await lockProject(tx, input.projectId);
    await tx
      .update(engineSceneVersions)
      .set({ blockedAt: null, blockedBy: null, blockedById: null, blockReason: null })
      .where(eq(engineSceneVersions.id, version.id));
    const rev = await writeAudit(tx, {
      projectId: input.projectId,
      actor: input.actor,
      action: "scene-unblock",
      sceneId: version.scene,
      sceneVersionId: version.id,
      detail: { number: version.number },
      at,
    });
    return { rev, channels: await bumpPointedChannels(tx, input.projectId, version.id, rev) };
  });
  await announceAll(input.projectId, moved);
  return null;
}

// ─── Staff's hide ────────────────────────────────────────

function staffOnly(): never {
  return refuse(releaseForbidden("role"));
}

async function hideable(deps: LiveModerationDeps, db: ReleaseDb, input: VersionAt) {
  if (input.actor.kind === "agent") staffOnly();
  const project = await liveProject(db, input.projectId);
  if (!canDo(await actorRole(deps, db, input.actor, project), "live-hide")) staffOnly();
  return versionByNumber(db, project.projectId, input.scene, input.number);
}

function requiredReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed)
    refuse({ code: "invalid-input", message: "Say why: the game's publishers see the reason." });
  return trimmed;
}

/**
 * Staff's hide: the version's files answer 410, no channel plays it, and
 * play pages running it reload their frame (it is listed in `removed`).
 * Hiding a hidden version changes nothing.
 */
export async function hideSceneVersion(
  input: VersionAt & { reason: string },
  deps: LiveModerationDeps = {},
): Promise<null> {
  const { db, now, forgetProject } = resolved(deps);
  const reason = requiredReason(input.reason);
  const version = await hideable(deps, db, input);
  if (version.hiddenAt) return null;
  const at = now();
  const moved = await db.transaction(async (tx) => {
    await lockProject(tx, input.projectId);
    await tx
      .update(engineSceneVersions)
      .set({ hiddenAt: at, hiddenById: input.actor.userId, hiddenReason: reason })
      .where(eq(engineSceneVersions.id, version.id));
    const rev = await writeAudit(tx, {
      projectId: input.projectId,
      actor: input.actor,
      action: "scene-hide",
      sceneId: version.scene,
      sceneVersionId: version.id,
      detail: { reason, number: version.number },
      at,
    });
    return { rev, channels: await bumpPointedChannels(tx, input.projectId, version.id, rev) };
  });
  forgetProject(input.projectId);
  await announceAll(input.projectId, moved);
  return null;
}

/** Lifts staff's hide, with the reason the audit keeps. */
export async function unhideSceneVersion(
  input: VersionAt & { reason: string },
  deps: LiveModerationDeps = {},
): Promise<null> {
  const { db, now, forgetProject } = resolved(deps);
  const reason = requiredReason(input.reason);
  const version = await hideable(deps, db, input);
  if (!version.hiddenAt) return null;
  const at = now();
  const moved = await db.transaction(async (tx) => {
    await lockProject(tx, input.projectId);
    await tx
      .update(engineSceneVersions)
      .set({ hiddenAt: null, hiddenById: null, hiddenReason: null })
      .where(eq(engineSceneVersions.id, version.id));
    const rev = await writeAudit(tx, {
      projectId: input.projectId,
      actor: input.actor,
      action: "scene-unhide",
      sceneId: version.scene,
      sceneVersionId: version.id,
      detail: { reason, number: version.number },
      at,
    });
    return { rev, channels: await bumpPointedChannels(tx, input.projectId, version.id, rev) };
  });
  forgetProject(input.projectId);
  await announceAll(input.projectId, moved);
  return null;
}

// ─── Staff's queue ───────────────────────────────────────

/**
 * Kept scene versions across projects for staff, newest first, with those
 * reported as failing, blocked or hidden ahead of the rest. Hidden ones
 * only with `includeHidden`.
 */
export async function sceneVersionQueue(
  input: { includeHidden: boolean; actor: Actor },
  deps: LiveModerationDeps = {},
): Promise<SceneVersionQueueItem[]> {
  const { db } = resolved(deps);
  if (input.actor.kind !== "staff") staffOnly();
  const flagged = or(
    sql`${engineSceneVersions.blockedAt} is not null`,
    sql`${engineSceneVersions.hiddenAt} is not null`,
    sql`${engineSceneVersions.reportsFailed} > 0`,
  );
  const rows = await db
    .select({
      projectId: engineSceneVersions.projectId,
      projectName: engineProjects.name,
      showcaseTitle: projects.title,
      scene: engineSceneVersions.sceneId,
      number: engineSceneVersions.number,
      id: engineSceneVersions.id,
      createdAt: engineSceneVersions.createdAt,
      compatKey: engineSceneVersions.compatKey,
      reportsOk: engineSceneVersions.reportsOk,
      reportsFailed: engineSceneVersions.reportsFailed,
      blockedAt: engineSceneVersions.blockedAt,
      blockedBy: engineSceneVersions.blockedBy,
      blockReason: engineSceneVersions.blockReason,
      hiddenAt: engineSceneVersions.hiddenAt,
      hiddenReason: engineSceneVersions.hiddenReason,
    })
    .from(engineSceneVersions)
    .innerJoin(engineProjects, eq(engineProjects.projectId, engineSceneVersions.projectId))
    .leftJoin(projects, eq(projects.id, engineProjects.showcaseProjectId))
    .where(
      and(
        isNull(engineProjects.deletedAt),
        isNull(engineSceneVersions.collectedAt),
        ...(input.includeHidden ? [] : [isNull(engineSceneVersions.hiddenAt)]),
      ),
    )
    .orderBy(
      desc(sql`(${flagged})`),
      desc(engineSceneVersions.createdAt),
      desc(engineSceneVersions.number),
    )
    .limit(QUEUE_MAX);

  const pointers =
    rows.length === 0
      ? []
      : await db
          .select({
            versionId: engineSceneChannels.versionId,
            channel: engineSceneChannels.channel,
          })
          .from(engineSceneChannels)
          .where(
            inArray(
              engineSceneChannels.versionId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(engineSceneChannels.channel);

  return rows.map((r) => ({
    projectId: r.projectId,
    projectName: r.showcaseTitle ?? r.projectName,
    scene: r.scene,
    number: r.number,
    id: r.id,
    createdAt: r.createdAt,
    compatKey: r.compatKey,
    pointers: pointers.filter((p) => p.versionId === r.id).map((p) => p.channel as LiveChannel),
    reports: { ok: r.reportsOk, failed: r.reportsFailed },
    blocked: r.blockedAt
      ? {
          at: r.blockedAt,
          by: r.blockedBy === "system" ? "system" : "user",
          reason: r.blockReason,
        }
      : null,
    hidden: r.hiddenAt ? { at: r.hiddenAt, reason: r.hiddenReason } : null,
  }));
}
