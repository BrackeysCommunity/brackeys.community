import { parseReleaseManifest, type ExportBudgetReport } from "@jams/engine/project";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { db as siteDb } from "@/db";
import {
  engineProjects,
  engineReleaseAudit,
  engineReleaseChannels,
  engineReleaseJamLinks,
  engineReleases,
  itchJams,
} from "@/db/schema";
import { siteUrl } from "@/env";

import { collectionForecast } from "./collect-plan";
import {
  canDo,
  canPlay,
  roleOf,
  type GameAction,
  type GameRole,
  type GameVisibility,
  type Viewer,
} from "./release-access";
import { writeAudit, type AuditActor, type ReleaseDb } from "./release-audit";
import {
  releaseForbidden,
  ReleaseError,
  releaseHidden,
  releaseRemoved,
  type ReleaseApiError,
} from "./release-errors";
import type { Actor, ReleaseTxDb } from "./release-upload";
import { releaseViewer } from "./release-viewer";

export type ReleaseChannel = "preview" | "production";

/** Where version `version` of a hosted game plays. */
export const playUrlOf = (projectId: string, version: number): string =>
  siteUrl(`/games/${encodeURIComponent(projectId)}/play/${version}`);

export type PointerMoveInput = {
  project: string;
  channel: ReleaseChannel;
  /** The release id the channel moves to. */
  release: string;
  actor: AuditActor;
  action: "promote" | "rollback";
  detail?: Record<string, unknown>;
  /** The caller's clock: the pointer's `updated_at`, `first_promoted_at` and the audit row's time. */
  at: Date;
};

/** The release ids the channel named before and after; `moved` is false when it already named this one. */
export type PointerMoved = { from: string | null; to: string; moved: boolean };

/**
 * The one writer of `engine_release_channels`: points the channel at
 * `release`, stamps `first_promoted_at` the first time production does,
 * and writes one audit row. A channel already there is left as it is,
 * with no row. Run it inside the caller's transaction, which holds the
 * project's lock.
 */
export async function movePointer(tx: ReleaseDb, input: PointerMoveInput): Promise<PointerMoved> {
  const { project, channel, release, actor } = input;
  const [current] = await tx
    .select({ releaseId: engineReleaseChannels.releaseId })
    .from(engineReleaseChannels)
    .where(
      and(eq(engineReleaseChannels.projectId, project), eq(engineReleaseChannels.channel, channel)),
    )
    .for("update");
  const from = current?.releaseId ?? null;
  if (from === release) return { from, to: release, moved: false };

  const by = actor.kind === "system" ? null : actor.userId;
  const now = input.at;
  await tx
    .insert(engineReleaseChannels)
    .values({ projectId: project, channel, releaseId: release, updatedById: by, updatedAt: now })
    .onConflictDoUpdate({
      target: [engineReleaseChannels.projectId, engineReleaseChannels.channel],
      set: { releaseId: release, updatedById: by, updatedAt: now },
    });
  if (channel === "production") {
    await tx
      .update(engineReleases)
      .set({ firstPromotedAt: now })
      .where(
        and(
          eq(engineReleases.id, release),
          eq(engineReleases.projectId, project),
          isNull(engineReleases.firstPromotedAt),
        ),
      );
  }
  await writeAudit(tx, {
    projectId: project,
    actor,
    action: input.action,
    releaseId: release,
    channel,
    fromRelease: from,
    toRelease: release,
    ...(input.detail ? { detail: input.detail } : {}),
    at: now,
  });
  return { from, to: release, moved: true };
}

/**
 * Who may play a release now, from `canPlay`: anyone (`unlisted`, `public`),
 * the project's team, its publishers and staff, or nobody (hidden or
 * collected).
 */
export type ReleaseAudience = "public" | "unlisted" | "team" | "publishers" | "none";

/** A release in the project's list: newest first, with its pins, its audience and when the cleanup removes it. */
export type ReleaseSummary = {
  version: number;
  id: string;
  createdAt: Date;
  totalBytes: number;
  fileCount: number;
  engineVersion: string;
  target: string;
  channels: ReleaseChannel[];
  jams: { jamId: number; title: string }[];
  firstPromotedAt: Date | null;
  collectedAt: Date | null;
  hidden: { at: Date; reason: string | null } | null;
  audience: ReleaseAudience;
  /** When the collector removes it unless something pins it; null when it is kept. */
  removalAt: Date | null;
  playUrl: string;
};

/** What `get` adds to a summary, from the manifest; empty once the release is collected. */
export type ReleaseDetail = ReleaseSummary & {
  start: string | null;
  scenes: { id: string; title?: string; physics: "rapier" | "none" }[];
  budget: ExportBudgetReport | null;
  /** Shipped assets with no licence recorded. */
  creditsMissing: number;
};

/** What the channel calls run over; both default to the site's own. */
export type ChannelDeps = { db?: ReleaseTxDb; now?: () => Date };

const resolved = (deps: ChannelDeps) => ({
  db: deps.db ?? (siteDb as unknown as ReleaseTxDb),
  now: deps.now ?? (() => new Date()),
});

type Project = {
  projectId: string;
  game: string | null;
  teamId: string | null;
  createdById: string | null;
  visibility: GameVisibility;
  hiddenAt: Date | null;
};

type ReleaseRef = {
  id: string;
  version: number;
  collectedAt: Date | null;
  hiddenAt: Date | null;
  hiddenReason: string | null;
};

function refuse(body: ReleaseApiError, status?: number): never {
  throw new ReleaseError(body, status);
}

function notFound(message: string): never {
  return refuse({ code: "not-found", message }, 404);
}

async function liveProject(db: ReleaseDb, projectId: string): Promise<Project> {
  const [row] = await db
    .select({
      projectId: engineProjects.projectId,
      game: engineProjects.game,
      teamId: engineProjects.teamId,
      createdById: engineProjects.createdById,
      visibility: engineProjects.visibility,
      hiddenAt: engineProjects.hiddenAt,
    })
    .from(engineProjects)
    .where(and(eq(engineProjects.projectId, projectId), isNull(engineProjects.deletedAt)));
  if (!row) notFound(`There is no hosted project "${projectId}".`);
  return { ...row, visibility: row.visibility as GameVisibility };
}

async function roleFor(db: ReleaseDb, actor: Actor, project: Project): Promise<GameRole | "agent"> {
  if (actor.kind === "agent") return "agent";
  if (actor.kind === "staff") return "staff";
  return roleOf(await releaseViewer(db, actor.userId, project), project);
}

/** Refuses a move the caller's role can't make: an agent on production is sent to the game's page. */
async function assertMayMove(
  db: ReleaseDb,
  actor: Actor,
  project: Project,
  kind: "promote" | "rollback",
  channel: ReleaseChannel,
): Promise<void> {
  const role = await roleFor(db, actor, project);
  const action: GameAction = `${kind}-${channel}`;
  if (canDo(role, action)) return;
  refuse(
    role === "agent"
      ? releaseForbidden(
          "agent-production",
          siteUrl(`/games/${encodeURIComponent(project.projectId)}`),
        )
      : releaseForbidden("role"),
  );
}

/** The release list and its details are for the people who make the game, and its agents. */
async function assertMayRead(db: ReleaseDb, actor: Actor, project: Project): Promise<void> {
  if ((await roleFor(db, actor, project)) === "player") refuse(releaseForbidden("role"));
}

const releaseRef = {
  id: engineReleases.id,
  version: engineReleases.version,
  collectedAt: engineReleases.collectedAt,
  hiddenAt: engineReleases.hiddenAt,
  hiddenReason: engineReleases.hiddenReason,
};

async function releaseByVersion(
  db: ReleaseDb,
  projectId: string,
  version: number,
): Promise<ReleaseRef> {
  const [row] = await db
    .select(releaseRef)
    .from(engineReleases)
    .where(and(eq(engineReleases.projectId, projectId), eq(engineReleases.version, version)));
  return row ?? notFound(`There is no v${version} of "${projectId}".`);
}

async function releaseById(db: ReleaseDb, id: string): Promise<ReleaseRef> {
  const [row] = await db.select(releaseRef).from(engineReleases).where(eq(engineReleases.id, id));
  return row ?? notFound("The release the channel named before is gone.");
}

/** A channel may only point at a release whose files are still stored and that staff haven't hidden. */
function assertMovable(release: ReleaseRef): void {
  if (release.collectedAt) refuse(releaseRemoved(release.version, release.collectedAt));
  if (release.hiddenAt) refuse(releaseHidden(release.version, release.hiddenReason));
}

/** Locks the project row, so pointer moves and commits on one project run one at a time. */
async function lockProject(tx: ReleaseDb, projectId: string): Promise<void> {
  await tx
    .select({ projectId: engineProjects.projectId })
    .from(engineProjects)
    .where(eq(engineProjects.projectId, projectId))
    .for("update");
}

async function pointerOf(
  tx: ReleaseDb,
  projectId: string,
  channel: ReleaseChannel,
): Promise<string | null> {
  const [row] = await tx
    .select({ releaseId: engineReleaseChannels.releaseId })
    .from(engineReleaseChannels)
    .where(
      and(
        eq(engineReleaseChannels.projectId, projectId),
        eq(engineReleaseChannels.channel, channel),
      ),
    );
  return row?.releaseId ?? null;
}

const versionOf = async (tx: ReleaseDb, id: string | null): Promise<number | null> =>
  id === null ? null : (await releaseById(tx, id)).version;

/**
 * Points `channel` at `version`. Production needs a person with the
 * publisher role; preview takes editors and agent tokens too. A collected
 * release is `release-immutable` and a hidden one `release-forbidden`.
 * One pointer update and one audit row; promoting the release a channel
 * already names changes nothing.
 */
export async function promote(
  input: { projectId: string; version: number; channel: ReleaseChannel; actor: Actor },
  deps: ChannelDeps = {},
): Promise<{ from: number | null; to: number }> {
  const { db, now } = resolved(deps);
  const { projectId, version, channel, actor } = input;
  const project = await liveProject(db, projectId);
  await assertMayMove(db, actor, project, "promote", channel);
  return db.transaction(async (tx) => {
    await lockProject(tx, projectId);
    const release = await releaseByVersion(tx, projectId, version);
    assertMovable(release);
    const moved = await movePointer(tx, {
      project: projectId,
      channel,
      release: release.id,
      actor,
      action: "promote",
      at: now(),
    });
    return { from: await versionOf(tx, moved.from), to: version };
  });
}

/**
 * Moves `channel` back: without `to`, to the release it named before its
 * last move, read from the audit log (so rolling back twice returns to
 * where it started); with `to`, to any kept version. The release it leaves
 * stays as it is. One pointer update and one audit row.
 */
export async function rollback(
  input: { projectId: string; channel: ReleaseChannel; to?: number; actor: Actor },
  deps: ChannelDeps = {},
): Promise<{ from: number; to: number }> {
  const { db, now } = resolved(deps);
  const { projectId, channel, actor } = input;
  const project = await liveProject(db, projectId);
  await assertMayMove(db, actor, project, "rollback", channel);
  return db.transaction(async (tx) => {
    await lockProject(tx, projectId);
    const current = await pointerOf(tx, projectId, channel);
    if (current === null) notFound(`${channel} doesn't name a release yet.`);

    let target: ReleaseRef;
    if (input.to !== undefined) {
      target = await releaseByVersion(tx, projectId, input.to);
    } else {
      const [last] = await tx
        .select({ fromRelease: engineReleaseAudit.fromRelease })
        .from(engineReleaseAudit)
        .where(
          and(
            eq(engineReleaseAudit.projectId, projectId),
            eq(engineReleaseAudit.channel, channel),
            inArray(engineReleaseAudit.action, ["promote", "rollback"]),
          ),
        )
        .orderBy(desc(engineReleaseAudit.id))
        .limit(1);
      const previous = last?.fromRelease ?? null;
      if (previous === null) notFound(`${channel} has no earlier release to go back to.`);
      target = await releaseById(tx, previous);
    }
    assertMovable(target);
    const moved = await movePointer(tx, {
      project: projectId,
      channel,
      release: target.id,
      actor,
      action: "rollback",
      at: now(),
    });
    return { from: (await versionOf(tx, moved.from)) ?? target.version, to: target.version };
  });
}

const ANYONE: Viewer = { userId: null, staff: false, teamRole: null, isCreator: false };
const TEAM_MEMBER: Viewer = {
  userId: "member",
  staff: false,
  teamRole: "member",
  isCreator: false,
};
const PUBLISHER: Viewer = { userId: "publisher", staff: false, teamRole: null, isCreator: true };

/** The widest audience `canPlay` lets in, so the list and the play page never disagree. */
function audienceOf(project: Project, release: Parameters<typeof canPlay>[2]): ReleaseAudience {
  if (canPlay(ANYONE, project, release).ok)
    return project.visibility === "public" ? "public" : "unlisted";
  if (canPlay(TEAM_MEMBER, project, release).ok) return "team";
  if (canPlay(PUBLISHER, project, release).ok) return "publishers";
  return "none";
}

async function summaries(
  db: ReleaseDb,
  project: Project,
  now: Date,
  version?: number,
): Promise<ReleaseSummary[]> {
  const { projectId } = project;
  const [rows, channels, jams] = await Promise.all([
    db
      .select({
        id: engineReleases.id,
        version: engineReleases.version,
        createdAt: engineReleases.createdAt,
        totalBytes: engineReleases.totalBytes,
        fileCount: engineReleases.fileCount,
        engineVersion: engineReleases.engineVersion,
        target: engineReleases.target,
        firstPromotedAt: engineReleases.firstPromotedAt,
        collectedAt: engineReleases.collectedAt,
        hiddenAt: engineReleases.hiddenAt,
        hiddenReason: engineReleases.hiddenReason,
      })
      .from(engineReleases)
      .where(eq(engineReleases.projectId, projectId))
      .orderBy(desc(engineReleases.version)),
    db
      .select({
        channel: engineReleaseChannels.channel,
        releaseId: engineReleaseChannels.releaseId,
      })
      .from(engineReleaseChannels)
      .where(eq(engineReleaseChannels.projectId, projectId)),
    db
      .select({
        jamId: engineReleaseJamLinks.jamId,
        releaseId: engineReleaseJamLinks.releaseId,
        title: itchJams.title,
      })
      .from(engineReleaseJamLinks)
      .innerJoin(itchJams, eq(itchJams.jamId, engineReleaseJamLinks.jamId))
      .where(eq(engineReleaseJamLinks.projectId, projectId))
      .orderBy(engineReleaseJamLinks.jamId),
  ]);

  const removals = new Map(
    collectionForecast(
      rows,
      { channels: channels.map((c) => c.releaseId), jams: jams.map((j) => j.releaseId) },
      now,
    ).map((f) => [f.version, f.at]),
  );

  return rows
    .filter((r) => version === undefined || r.version === version)
    .map((r) => {
      const pinnedJams = jams.filter((j) => j.releaseId === r.id);
      return {
        version: r.version,
        id: r.id,
        createdAt: r.createdAt,
        totalBytes: r.totalBytes,
        fileCount: r.fileCount,
        engineVersion: r.engineVersion,
        target: r.target,
        channels: channels
          .filter((c) => c.releaseId === r.id)
          .map((c) => c.channel as ReleaseChannel)
          .sort(),
        jams: pinnedJams.map(({ jamId, title }) => ({ jamId, title })),
        firstPromotedAt: r.firstPromotedAt,
        collectedAt: r.collectedAt,
        hidden: r.hiddenAt ? { at: r.hiddenAt, reason: r.hiddenReason } : null,
        audience: audienceOf(project, { ...r, jamPinned: pinnedJams.length > 0 }),
        removalAt: removals.get(r.version) ?? null,
        playUrl: playUrlOf(projectId, r.version),
      };
    });
}

/** Every release of the project, newest first, with its channels, jams, audience and removal date. */
export async function listReleases(
  input: { projectId: string; actor: Actor },
  deps: ChannelDeps = {},
): Promise<ReleaseSummary[]> {
  const { db, now } = resolved(deps);
  const project = await liveProject(db, input.projectId);
  await assertMayRead(db, input.actor, project);
  return summaries(db, project, now());
}

/** One release's summary and what its manifest says: the scene list and physics, the budget, the credits gaps. */
export async function getRelease(
  input: { projectId: string; version: number; actor: Actor },
  deps: ChannelDeps = {},
): Promise<ReleaseDetail> {
  const { db, now } = resolved(deps);
  const { projectId, version } = input;
  const project = await liveProject(db, projectId);
  await assertMayRead(db, input.actor, project);
  const [summary] = await summaries(db, project, now(), version);
  if (!summary) notFound(`There is no v${version} of "${projectId}".`);

  const [stored] = await db
    .select({ manifest: engineReleases.manifest })
    .from(engineReleases)
    .where(eq(engineReleases.id, summary.id));
  const parsed = stored?.manifest ? parseReleaseManifest(stored.manifest) : null;
  if (!parsed?.ok) return { ...summary, start: null, scenes: [], budget: null, creditsMissing: 0 };
  const { manifest } = parsed;
  return {
    ...summary,
    start: manifest.flow.start,
    scenes: manifest.flow.scenes.map((s) => ({
      id: s.id,
      ...(s.title !== undefined ? { title: s.title } : {}),
      physics: s.physics,
    })),
    budget: manifest.budget,
    creditsMissing: manifest.credits.missing.length,
  };
}
