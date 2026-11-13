import { and, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";

import { db as siteDb } from "@/db";
import {
  developerProfiles,
  engineProjects,
  engineReleaseChannels,
  engineReleaseReports,
  engineReleases,
  profileUrlStubs,
  projects,
  teams,
} from "@/db/schema";
import { purgeShell, type PurgeResult } from "@/lib/cloudflare-purge";
import { ENGINE_QUARANTINE_REASON } from "@/lib/image-quarantine";
import { CONTACT } from "@/lib/legal-meta";
import { memberName } from "@/lib/member-name";
import { checkRateLimit } from "@/lib/rate-limit";
import { profileIdentityColumns, profileStubJoin } from "@/orpc/profile-projection";

import { announceReleaseChange } from "./frame-cache-notice";
import { GAME_REPORTS_PER_DAY } from "./limits";
import { canDo, roleOf, type GameAction, type Viewer } from "./release-access";
import { writeAudit } from "./release-audit";
import { ReleaseError, type ReleaseApiError } from "./release-errors";
import type { Actor, ReleaseDeps, ReleaseTxDb } from "./release-upload";
import { releaseViewer, type ProjectRow } from "./release-viewer";

/** What moderation runs over; every field defaults to the site's own. */
export type ModerationDeps = {
  db?: ReleaseTxDb;
  now?: () => Date;
  /** The caller as the access rules see them; default read from the project, its team and the caller's roles. */
  viewer?: (userId: string, project: ProjectRow) => Promise<Viewer>;
  /** Drops releases from the frame route's cache; default this process's at once, and every other's through the release notice. */
  forget?: { release: (releaseId: string) => void; project: (projectId: string) => void };
  /** Purges a release's shell files at the edge; default Cloudflare when configured. */
  purge?: (releaseId: string) => Promise<PurgeResult>;
  rateLimit?: ReleaseDeps["rateLimit"];
};

/** What a hide did at the edge, for staff: purged, or why copies may persist. */
export type EdgeOutcome = { purged: boolean; note: string | null };

export type HideResult = {
  /** The project's releases the hide reaches: one, or every kept one for the whole project. */
  releaseIds: string[];
  edge: EdgeOutcome;
};

export type ReportResolution = "hidden-release" | "hidden-project" | "dismissed";

const DAY_SECONDS = 86_400;

const resolved = (deps: ModerationDeps) => ({
  db: deps.db ?? (siteDb as unknown as ReleaseTxDb),
  now: deps.now ?? (() => new Date()),
  forget: deps.forget ?? {
    release: (releaseId: string) =>
      void announceReleaseChange({ releaseIds: [releaseId], projectIds: [] }),
    project: (projectId: string) =>
      void announceReleaseChange({ releaseIds: [], projectIds: [projectId] }),
  },
  purge: deps.purge ?? ((releaseId: string) => purgeShell(releaseId)),
  rateLimit: deps.rateLimit ?? checkRateLimit,
});

function refuse(body: ReleaseApiError, status?: number): never {
  throw new ReleaseError(body, status);
}

function notFound(message: string): never {
  return refuse({ code: "not-found", message }, 404);
}

function staffOnly(): never {
  return refuse({
    code: "release-forbidden",
    message: "Only staff can hide, unhide or approve a game.",
    hint: `Publishers can write to ${CONTACT.abuse} about a hidden game.`,
  });
}

async function liveProject(db: ReleaseTxDb, projectId: string) {
  const [row] = await db
    .select({
      projectId: engineProjects.projectId,
      name: engineProjects.name,
      game: engineProjects.game,
      teamId: engineProjects.teamId,
      createdById: engineProjects.createdById,
      visibility: engineProjects.visibility,
      hiddenAt: engineProjects.hiddenAt,
      publicApprovedAt: engineProjects.publicApprovedAt,
      showcaseTitle: projects.title,
    })
    .from(engineProjects)
    .leftJoin(projects, eq(projects.id, engineProjects.showcaseProjectId))
    .where(and(eq(engineProjects.projectId, projectId), isNull(engineProjects.deletedAt)));
  return row ?? notFound(`There is no hosted game "${projectId}".`);
}

type LiveProject = Awaited<ReturnType<typeof liveProject>>;

async function assertStaff(
  deps: ModerationDeps,
  db: ReleaseTxDb,
  actor: Actor,
  project: LiveProject,
  action: GameAction,
): Promise<void> {
  if (actor.kind === "agent") staffOnly();
  if (actor.kind === "staff") {
    if (!canDo("staff", action)) staffOnly();
    return;
  }
  const viewer = await (deps.viewer ?? ((id, p) => releaseViewer(db, id, p)))(
    actor.userId,
    project,
  );
  if (!canDo(roleOf(viewer, project), action)) staffOnly();
}

async function releaseByVersion(db: ReleaseTxDb, projectId: string, version: number) {
  const [row] = await db
    .select({
      id: engineReleases.id,
      version: engineReleases.version,
      collectedAt: engineReleases.collectedAt,
      hiddenAt: engineReleases.hiddenAt,
    })
    .from(engineReleases)
    .where(and(eq(engineReleases.projectId, projectId), eq(engineReleases.version, version)));
  return row ?? notFound(`"${projectId}" has no v${version}.`);
}

async function keptReleaseIds(db: ReleaseTxDb, projectId: string): Promise<string[]> {
  const rows = await db
    .select({ id: engineReleases.id })
    .from(engineReleases)
    .where(and(eq(engineReleases.projectId, projectId), isNull(engineReleases.collectedAt)));
  return rows.map((r) => r.id);
}

/** Purges each release's shell; one failure or an unconfigured CDN is said once. */
async function purgeAll(
  purge: (releaseId: string) => Promise<PurgeResult>,
  releaseIds: readonly string[],
): Promise<EdgeOutcome> {
  let note: string | null = null;
  for (const id of releaseIds) {
    const result = await purge(id).catch(
      (): PurgeResult => ({ purged: false, reason: "The edge purge failed." }),
    );
    if (!result.purged) note ??= result.reason;
  }
  return { purged: note === null, note };
}

/**
 * Hides one release (`version`) or the whole project, with the reason its
 * publishers see. Staff only. The frame route answers 410 at once in this
 * process (other processes within its cache's lifetime), and the shells are
 * purged at the edge when that's configured.
 */
export async function hideRelease(
  input: { projectId: string; version?: number; reason: string; actor: Actor },
  deps: ModerationDeps = {},
): Promise<HideResult> {
  const { db, now, forget, purge } = resolved(deps);
  const reason = input.reason.trim();
  if (!reason)
    refuse({ code: "invalid-input", message: "Say why: its publishers see the reason." });
  const project = await liveProject(db, input.projectId);
  await assertStaff(deps, db, input.actor, project, "hide");
  const at = now();
  const by = input.actor.userId;

  if (input.version !== undefined) {
    const release = await releaseByVersion(db, project.projectId, input.version);
    await db.transaction(async (tx) => {
      await tx
        .update(engineReleases)
        .set({ hiddenAt: at, hiddenById: by, hiddenReason: reason })
        .where(eq(engineReleases.id, release.id));
      await writeAudit(tx, {
        projectId: project.projectId,
        actor: input.actor,
        action: "hide",
        releaseId: release.id,
        at,
        detail: { reason, version: release.version },
      });
    });
    forget.release(release.id);
    const reached = release.collectedAt === null ? [release.id] : [];
    return { releaseIds: [release.id], edge: await purgeAll(purge, reached) };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(engineProjects)
      .set({ hiddenAt: at, hiddenById: by, hiddenReason: reason, updatedAt: at })
      .where(eq(engineProjects.projectId, project.projectId));
    await writeAudit(tx, {
      projectId: project.projectId,
      actor: input.actor,
      action: "hide",
      at,
      detail: { reason, scope: "project" },
    });
  });
  forget.project(project.projectId);
  const kept = await keptReleaseIds(db, project.projectId);
  return { releaseIds: kept, edge: await purgeAll(purge, kept) };
}

/** Lifts a hide on one release or the whole project. A project's unhide leaves releases hidden one by one as they are. */
export async function unhideRelease(
  input: { projectId: string; version?: number; actor: Actor },
  deps: ModerationDeps = {},
): Promise<{ releaseIds: string[] }> {
  const { db, now, forget } = resolved(deps);
  const project = await liveProject(db, input.projectId);
  await assertStaff(deps, db, input.actor, project, "hide");
  const at = now();

  if (input.version !== undefined) {
    const release = await releaseByVersion(db, project.projectId, input.version);
    if (release.hiddenAt === null) return { releaseIds: [] };
    await db.transaction(async (tx) => {
      await tx
        .update(engineReleases)
        .set({ hiddenAt: null, hiddenById: null, hiddenReason: null })
        .where(eq(engineReleases.id, release.id));
      await writeAudit(tx, {
        projectId: project.projectId,
        actor: input.actor,
        action: "unhide",
        releaseId: release.id,
        at,
        detail: { version: release.version },
      });
    });
    forget.release(release.id);
    return { releaseIds: [release.id] };
  }

  if (project.hiddenAt === null) return { releaseIds: [] };
  await db.transaction(async (tx) => {
    await tx
      .update(engineProjects)
      .set({ hiddenAt: null, hiddenById: null, hiddenReason: null, updatedAt: at })
      .where(eq(engineProjects.projectId, project.projectId));
    await writeAudit(tx, {
      projectId: project.projectId,
      actor: input.actor,
      action: "unhide",
      at,
      detail: { scope: "project" },
    });
  });
  forget.project(project.projectId);
  return { releaseIds: await keptReleaseIds(db, project.projectId) };
}

/**
 * Staff's one-time review: the project goes public, and every later release
 * follows without another. Approving again changes nothing.
 */
export async function approvePublic(
  input: { projectId: string; actor: Actor },
  deps: ModerationDeps = {},
): Promise<{ approvedAt: Date; alreadyApproved: boolean }> {
  const { db, now, forget } = resolved(deps);
  const project = await liveProject(db, input.projectId);
  await assertStaff(deps, db, input.actor, project, "approve-public");
  if (project.publicApprovedAt !== null && project.visibility === "public") {
    return { approvedAt: project.publicApprovedAt, alreadyApproved: true };
  }
  const at = project.publicApprovedAt ?? now();
  await db.transaction(async (tx) => {
    await tx
      .update(engineProjects)
      .set({
        publicApprovedAt: at,
        publicApprovedById: input.actor.userId,
        visibility: "public",
        updatedAt: now(),
      })
      .where(eq(engineProjects.projectId, project.projectId));
    await writeAudit(tx, {
      projectId: project.projectId,
      actor: input.actor,
      action: "approve-public",
      detail: { from: project.visibility },
    });
  });
  forget.project(project.projectId);
  return { approvedAt: at, alreadyApproved: false };
}

const titleOf = (project: LiveProject) => project.showcaseTitle ?? project.name;

/**
 * A signed-in player's report on a game, or one of its versions (without
 * one, the version production plays). At most `GAME_REPORTS_PER_DAY` a day
 * per reporter. Games the reporter can't see are reported as not found.
 */
export async function reportGame(
  input: { projectId: string; version?: number; reason: string; reporterId: string },
  deps: ModerationDeps = {},
): Promise<{ id: number }> {
  const { db, rateLimit } = resolved(deps);
  const reason = input.reason.trim();
  if (!reason) refuse({ code: "invalid-input", message: "Say what's wrong with the game." });
  const project = await liveProject(db, input.projectId);
  const viewer = await (deps.viewer ?? ((id, p) => releaseViewer(db, id, p)))(
    input.reporterId,
    project,
  );
  const role = roleOf(viewer, project);
  const audience =
    project.visibility === "private"
      ? role === "staff" || role === "publisher"
      : project.visibility === "team"
        ? role !== "player"
        : true;
  if (!audience) notFound(`There is no hosted game "${input.projectId}".`);

  let release: { id: string; version: number } | null = null;
  if (input.version !== undefined) {
    release = await releaseByVersion(db, project.projectId, input.version);
  } else {
    const [live] = await db
      .select({ id: engineReleases.id, version: engineReleases.version })
      .from(engineReleaseChannels)
      .innerJoin(engineReleases, eq(engineReleases.id, engineReleaseChannels.releaseId))
      .where(
        and(
          eq(engineReleaseChannels.projectId, project.projectId),
          eq(engineReleaseChannels.channel, "production"),
        ),
      );
    release = live ?? null;
  }

  if (!(await rateLimit("engine-report", input.reporterId, GAME_REPORTS_PER_DAY, DAY_SECONDS))) {
    refuse({
      code: "release-rate-limited",
      message: `You've sent ${GAME_REPORTS_PER_DAY} reports today. Try again tomorrow.`,
    });
  }

  const [row] = await db
    .insert(engineReleaseReports)
    .values({
      projectId: project.projectId,
      releaseId: release?.id ?? null,
      version: release?.version ?? null,
      title: titleOf(project),
      reporterId: input.reporterId,
      reason,
    })
    .returning({ id: engineReleaseReports.id });
  if (!row) throw new Error("The report wasn't stored.");
  return { id: row.id };
}

/**
 * Staff resolve a report by hiding its release or its whole project with a
 * reason, or by dismissing it. A report already resolved is left alone.
 */
export async function resolveReport(
  input: {
    reportId: number;
    action: "hide-release" | "hide-project" | "dismiss";
    reason?: string;
    actor: Actor;
  },
  deps: ModerationDeps = {},
): Promise<{ resolved: boolean; resolution: ReportResolution | null; edge: EdgeOutcome | null }> {
  const { db, now } = resolved(deps);
  const [report] = await db
    .select({
      id: engineReleaseReports.id,
      projectId: engineReleaseReports.projectId,
      version: engineReleaseReports.version,
      resolvedAt: engineReleaseReports.resolvedAt,
    })
    .from(engineReleaseReports)
    .where(eq(engineReleaseReports.id, input.reportId));
  if (!report) return notFound(`There is no report ${input.reportId}.`);
  if (input.actor.kind !== "staff") {
    if (!report.projectId) staffOnly();
    else await assertStaff(deps, db, input.actor, await liveProject(db, report.projectId), "hide");
  }
  if (report.resolvedAt !== null) return { resolved: false, resolution: null, edge: null };

  let resolution: ReportResolution = "dismissed";
  let edge: EdgeOutcome | null = null;
  if (input.action !== "dismiss") {
    if (!report.projectId) notFound("The reported game was deleted; dismiss the report instead.");
    const reason = input.reason?.trim() ?? "";
    if (!reason)
      refuse({ code: "invalid-input", message: "Say why: its publishers see the reason." });
    if (input.action === "hide-release") {
      if (report.version === null) {
        refuse({
          code: "invalid-input",
          message: "This report names no version; hide the whole game instead.",
        });
      }
      edge = (
        await hideRelease(
          { projectId: report.projectId, version: report.version, reason, actor: input.actor },
          deps,
        )
      ).edge;
      resolution = "hidden-release";
    } else {
      edge = (await hideRelease({ projectId: report.projectId, reason, actor: input.actor }, deps))
        .edge;
      resolution = "hidden-project";
    }
  }

  const at = now();
  await db.transaction(async (tx) => {
    await tx
      .update(engineReleaseReports)
      .set({ resolvedAt: at, resolvedById: input.actor.userId, resolution })
      .where(and(eq(engineReleaseReports.id, report.id), isNull(engineReleaseReports.resolvedAt)));
    if (report.projectId) {
      await writeAudit(tx, {
        projectId: report.projectId,
        actor: input.actor,
        action: "report-resolved",
        at,
        detail: { reportId: report.id, resolution, version: report.version },
      });
    }
  });
  return { resolved: true, resolution, edge };
}

// ─── The admin queue ─────────────────────────────────────

export type ModerationPerson = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  urlStub: string | null;
};

export type GameReportRow = {
  id: number;
  /** Null once the game is deleted; `title` is the snapshot taken when it was reported. */
  projectId: string | null;
  version: number | null;
  title: string;
  reason: string;
  reporter: ModerationPerson | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolution: ReportResolution | null;
  releaseHiddenAt: Date | null;
  projectHiddenAt: Date | null;
};

export type PublicReviewRow = {
  projectId: string;
  name: string;
  teamName: string | null;
  visibility: string;
  requestedAt: Date;
  hiddenAt: Date | null;
};

export type HiddenGameRow = {
  projectId: string;
  title: string;
  /** Null when the whole project is hidden. */
  version: number | null;
  reason: string | null;
  hiddenAt: Date;
  /** Hidden by the image scan rather than by staff; dismissing the image's flag lifts it. */
  byImageScan: boolean;
};

export type ModerationQueue = {
  reports: GameReportRow[];
  reviews: PublicReviewRow[];
  hidden: HiddenGameRow[];
};

const RESOLVED_SHOWN = 100;

/**
 * The admin queue's reads: open reports (and the latest resolved ones with
 * `includeResolved`), first-public review requests, and what's hidden now.
 * Staff only. Flagged release images come from the site's image-flag queue.
 */
export async function moderationQueue(
  input: { includeResolved?: boolean; actor: Actor },
  deps: ModerationDeps = {},
): Promise<ModerationQueue> {
  const { db } = resolved(deps);
  if (input.actor.kind !== "staff") staffOnly();

  const reportColumns = {
    id: engineReleaseReports.id,
    projectId: engineReleaseReports.projectId,
    version: engineReleaseReports.version,
    title: engineReleaseReports.title,
    reason: engineReleaseReports.reason,
    reporterId: engineReleaseReports.reporterId,
    createdAt: engineReleaseReports.createdAt,
    resolvedAt: engineReleaseReports.resolvedAt,
    resolution: engineReleaseReports.resolution,
    releaseHiddenAt: engineReleases.hiddenAt,
    projectHiddenAt: engineProjects.hiddenAt,
  };
  const reportsWhere = (open: boolean) =>
    db
      .select(reportColumns)
      .from(engineReleaseReports)
      .leftJoin(engineReleases, eq(engineReleases.id, engineReleaseReports.releaseId))
      .leftJoin(engineProjects, eq(engineProjects.projectId, engineReleaseReports.projectId))
      .where(
        open ? isNull(engineReleaseReports.resolvedAt) : isNotNull(engineReleaseReports.resolvedAt),
      )
      .orderBy(desc(open ? engineReleaseReports.createdAt : engineReleaseReports.resolvedAt))
      .limit(open ? 500 : RESOLVED_SHOWN);
  const rows = [
    ...(await reportsWhere(true)),
    ...(input.includeResolved ? await reportsWhere(false) : []),
  ];

  const reporterIds = [...new Set(rows.map((r) => r.reporterId))];
  const people =
    reporterIds.length === 0
      ? []
      : await db
          .select({
            id: developerProfiles.id,
            ...profileIdentityColumns,
            urlStub: profileUrlStubs.stub,
          })
          .from(developerProfiles)
          .leftJoin(profileUrlStubs, profileStubJoin)
          .where(inArray(developerProfiles.id, reporterIds));
  const personOf = new Map<string, ModerationPerson>(
    people.map((p) => [
      p.id,
      {
        id: p.id,
        displayName: memberName(p, "Member"),
        avatarUrl: p.avatarUrl,
        urlStub: p.urlStub,
      },
    ]),
  );

  const reviews = await db
    .select({
      projectId: engineProjects.projectId,
      name: engineProjects.name,
      showcaseTitle: projects.title,
      teamName: teams.name,
      visibility: engineProjects.visibility,
      requestedAt: engineProjects.publicReviewRequestedAt,
      hiddenAt: engineProjects.hiddenAt,
    })
    .from(engineProjects)
    .leftJoin(projects, eq(projects.id, engineProjects.showcaseProjectId))
    .leftJoin(teams, eq(teams.id, engineProjects.teamId))
    .where(
      and(
        isNotNull(engineProjects.publicReviewRequestedAt),
        isNull(engineProjects.publicApprovedAt),
        isNull(engineProjects.deletedAt),
      ),
    )
    .orderBy(engineProjects.publicReviewRequestedAt);

  const hiddenRows = await db
    .select({
      projectId: engineProjects.projectId,
      name: engineProjects.name,
      showcaseTitle: projects.title,
      projectHiddenAt: engineProjects.hiddenAt,
      projectReason: engineProjects.hiddenReason,
      version: engineReleases.version,
      releaseHiddenAt: engineReleases.hiddenAt,
      releaseReason: engineReleases.hiddenReason,
      releaseHiddenBy: engineReleases.hiddenById,
    })
    .from(engineProjects)
    .leftJoin(
      engineReleases,
      and(
        eq(engineReleases.projectId, engineProjects.projectId),
        isNotNull(engineReleases.hiddenAt),
        isNull(engineReleases.collectedAt),
      ),
    )
    .leftJoin(projects, eq(projects.id, engineProjects.showcaseProjectId))
    .where(
      and(
        isNull(engineProjects.deletedAt),
        or(isNotNull(engineProjects.hiddenAt), isNotNull(engineReleases.hiddenAt)),
      ),
    );
  const hidden: HiddenGameRow[] = [];
  const projectsListed = new Set<string>();
  for (const row of hiddenRows) {
    const title = row.showcaseTitle ?? row.name;
    if (row.projectHiddenAt && !projectsListed.has(row.projectId)) {
      projectsListed.add(row.projectId);
      hidden.push({
        projectId: row.projectId,
        title,
        version: null,
        reason: row.projectReason,
        hiddenAt: row.projectHiddenAt,
        byImageScan: false,
      });
    }
    if (row.version !== null && row.releaseHiddenAt) {
      hidden.push({
        projectId: row.projectId,
        title,
        version: row.version,
        reason: row.releaseReason,
        hiddenAt: row.releaseHiddenAt,
        byImageScan: row.releaseHiddenBy === null && row.releaseReason === ENGINE_QUARANTINE_REASON,
      });
    }
  }
  hidden.sort((a, b) => b.hiddenAt.getTime() - a.hiddenAt.getTime());

  return {
    reports: rows.map(({ reporterId, resolution, ...row }) => ({
      ...row,
      resolution: resolution as ReportResolution | null,
      reporter: personOf.get(reporterId) ?? null,
    })),
    reviews: reviews.flatMap((r) =>
      r.requestedAt
        ? [
            {
              projectId: r.projectId,
              name: r.showcaseTitle ?? r.name,
              teamName: r.teamName,
              visibility: r.visibility,
              requestedAt: r.requestedAt,
              hiddenAt: r.hiddenAt,
            },
          ]
        : [],
    ),
    hidden,
  };
}
