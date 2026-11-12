import { and, eq, isNull, ne } from "drizzle-orm";

import { db as siteDb } from "@/db";
import {
  engineProjects,
  engineReleaseJamLinks,
  engineReleases,
  itchJams,
  projectJamLinks,
} from "@/db/schema";
import { siteUrl } from "@/env";
import { releaseDay } from "@/lib/jam-links";

import { checkJamPinQuota } from "./quota";
import { canDo, roleOf, type GameRole, type GameVisibility } from "./release-access";
import { writeAudit, type ReleaseDb } from "./release-audit";
import {
  ReleaseError,
  releaseForbidden,
  releaseHidden,
  releaseRemoved,
  type ReleaseApiError,
} from "./release-errors";
import { playUrlOf, releaseViewer, type Actor, type ReleaseTxDb } from "./release-upload";

/** What the jam-link calls run over; both default to the site's own. */
export type JamLinkDeps = { db?: ReleaseTxDb; now?: () => Date };

/** The versions the jam's link named before and after; `moved` is false when it already named this one. */
export type JamLinked = { jamId: number; from: number | null; to: number; moved: boolean };

const resolved = (deps: JamLinkDeps) => ({
  db: deps.db ?? (siteDb as unknown as ReleaseTxDb),
  now: deps.now ?? (() => new Date()),
});

type Project = {
  projectId: string;
  teamId: string | null;
  createdById: string | null;
  game: string | null;
  visibility: GameVisibility;
  hiddenAt: Date | null;
  showcaseProjectId: string | null;
};

type Jam = { jamId: number; title: string; startsAt: Date | null; endsAt: Date | null };

function refuse(body: ReleaseApiError, status?: number): never {
  throw new ReleaseError(body, status);
}

function notFound(message: string): never {
  return refuse({ code: "not-found", message }, 404);
}

export function jamLinkNotListed(): ReleaseApiError {
  return {
    code: "release-forbidden",
    message: "Only a public or unlisted game can link a version to a jam.",
    hint: "Judges play jam versions signed out: set the game to unlisted or public first.",
  };
}

export function jamLinkGameHidden(): ReleaseApiError {
  return {
    code: "release-forbidden",
    message: "This game is hidden, so none of its versions can be linked to a jam.",
    hint: "Staff hid it; its publishers see the reason on the game's page.",
  };
}

export function jamVersionFrozen(title: string, endedAt: Date): ReleaseApiError {
  return {
    code: "release-forbidden",
    message: `${title} ended on ${releaseDay(endedAt)}, so its jam version can't change.`,
    hint: "After a jam ends, only staff can change the version submitted to it.",
  };
}

/** The project row; `lock` holds it for the transaction, so links on one project change one at a time. */
async function liveProject(db: ReleaseDb, projectId: string, lock = false): Promise<Project> {
  const query = db
    .select({
      projectId: engineProjects.projectId,
      teamId: engineProjects.teamId,
      createdById: engineProjects.createdById,
      game: engineProjects.game,
      visibility: engineProjects.visibility,
      hiddenAt: engineProjects.hiddenAt,
      showcaseProjectId: engineProjects.showcaseProjectId,
    })
    .from(engineProjects)
    .where(and(eq(engineProjects.projectId, projectId), isNull(engineProjects.deletedAt)));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) notFound(`There is no hosted project "${projectId}".`);
  return { ...row, visibility: row.visibility as GameVisibility };
}

async function jamOf(db: ReleaseDb, jamId: number): Promise<Jam> {
  const [row] = await db
    .select({
      jamId: itchJams.jamId,
      title: itchJams.title,
      startsAt: itchJams.startsAt,
      endsAt: itchJams.endsAt,
    })
    .from(itchJams)
    .where(eq(itchJams.jamId, jamId));
  return row ?? notFound(`There is no jam ${jamId}.`);
}

async function roleFor(db: ReleaseDb, actor: Actor, project: Project): Promise<GameRole | "agent"> {
  if (actor.kind === "agent") return "agent";
  if (actor.kind === "staff") return "staff";
  return roleOf(await releaseViewer(db, actor.userId, project), project);
}

/** Publishers and staff link jam versions; once the jam has ended only staff may change one. */
async function assertMayLink(
  db: ReleaseDb,
  actor: Actor,
  project: Project,
  jam: Jam,
  now: Date,
): Promise<void> {
  const role = await roleFor(db, actor, project);
  if (!canDo(role, "jam-link")) refuse(releaseForbidden("role"));
  if (role !== "staff" && jam.endsAt !== null && now.getTime() >= jam.endsAt.getTime())
    refuse(jamVersionFrozen(jam.title, jam.endsAt));
}

async function currentLink(
  db: ReleaseDb,
  projectId: string,
  jamId: number,
): Promise<{ releaseId: string; version: number } | null> {
  const [row] = await db
    .select({ releaseId: engineReleaseJamLinks.releaseId, version: engineReleases.version })
    .from(engineReleaseJamLinks)
    .innerJoin(engineReleases, eq(engineReleases.id, engineReleaseJamLinks.releaseId))
    .where(
      and(eq(engineReleaseJamLinks.projectId, projectId), eq(engineReleaseJamLinks.jamId, jamId)),
    );
  return row ?? null;
}

const playUrlPrefix = (projectId: string) =>
  siteUrl(`/games/${encodeURIComponent(projectId)}/play/`);

/** The showcase project's jam row, with the jam version's play URL as its submission. */
async function writeShowcaseJamLink(
  db: ReleaseDb,
  showcaseProjectId: string,
  jam: Jam,
  submissionUrl: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: projectJamLinks.id })
    .from(projectJamLinks)
    .where(
      and(eq(projectJamLinks.projectId, showcaseProjectId), eq(projectJamLinks.jamId, jam.jamId)),
    );
  if (existing) {
    await db
      .update(projectJamLinks)
      .set({ submissionUrl })
      .where(eq(projectJamLinks.id, existing.id));
    return;
  }
  await db.insert(projectJamLinks).values({
    projectId: showcaseProjectId,
    jamId: jam.jamId,
    submissionUrl,
    participatedAt: jam.startsAt ?? jam.endsAt,
  });
}

/**
 * Pins `version` as the project's submission to a jam, or moves the pin to
 * it. The game must be public or unlisted and the release neither hidden nor
 * removed; a project pins at most `jamPins` jams. After the jam's `ends_at`
 * (UTC) only staff may change it. A linked showcase project's
 * `project_jam_links` row gets the version's play URL. One audit row;
 * linking the version already pinned changes nothing.
 */
export async function linkJam(
  input: { projectId: string; version: number; jamId: number; actor: Actor },
  deps: JamLinkDeps = {},
): Promise<JamLinked> {
  const { db, now } = resolved(deps);
  const { projectId, version, jamId, actor } = input;
  const project = await liveProject(db, projectId);
  const jam = await jamOf(db, jamId);
  await assertMayLink(db, actor, project, jam, now());
  return db.transaction(async (tx) => {
    const locked = await liveProject(tx, projectId, true);
    if (locked.hiddenAt !== null) refuse(jamLinkGameHidden());
    if (locked.visibility !== "public" && locked.visibility !== "unlisted")
      refuse(jamLinkNotListed());

    const [release] = await tx
      .select({
        id: engineReleases.id,
        collectedAt: engineReleases.collectedAt,
        hiddenAt: engineReleases.hiddenAt,
        hiddenReason: engineReleases.hiddenReason,
      })
      .from(engineReleases)
      .where(and(eq(engineReleases.projectId, projectId), eq(engineReleases.version, version)));
    if (!release) notFound(`There is no v${version} of "${projectId}".`);
    if (release.collectedAt) refuse(releaseRemoved(version, release.collectedAt));
    if (release.hiddenAt) refuse(releaseHidden(version, release.hiddenReason));

    const current = await currentLink(tx, projectId, jamId);
    if (current?.releaseId === release.id)
      return { jamId, from: version, to: version, moved: false };
    if (current === null) {
      const others = await tx
        .select({ jamId: engineReleaseJamLinks.jamId })
        .from(engineReleaseJamLinks)
        .where(
          and(
            eq(engineReleaseJamLinks.projectId, projectId),
            ne(engineReleaseJamLinks.jamId, jamId),
          ),
        );
      const verdict = checkJamPinQuota(others.length);
      if (!verdict.ok)
        refuse({
          code: "quota-exceeded",
          message: verdict.message,
          hint: verdict.hint,
          limit: verdict.limit,
          used: verdict.used,
          max: verdict.max,
        });
    }

    const by = actor.userId;
    const at = now();
    await tx
      .insert(engineReleaseJamLinks)
      .values({ projectId, jamId, releaseId: release.id, linkedById: by, linkedAt: at })
      .onConflictDoUpdate({
        target: [engineReleaseJamLinks.projectId, engineReleaseJamLinks.jamId],
        set: { releaseId: release.id, linkedById: by, linkedAt: at },
      });
    if (locked.showcaseProjectId !== null)
      await writeShowcaseJamLink(tx, locked.showcaseProjectId, jam, playUrlOf(projectId, version));
    await writeAudit(tx, {
      projectId,
      actor,
      action: "jam-link",
      releaseId: release.id,
      fromRelease: current?.releaseId ?? null,
      toRelease: release.id,
      detail: { jamId },
      at,
    });
    return { jamId, from: current?.version ?? null, to: version, moved: true };
  });
}

/**
 * Removes the project's jam version for `jamId`, on the same terms as
 * moving it. The showcase project's jam row stays, as a record of taking
 * part, but loses a submission URL that pointed at this game's versions.
 */
export async function unlinkJam(
  input: { projectId: string; jamId: number; actor: Actor },
  deps: JamLinkDeps = {},
): Promise<{ jamId: number; version: number }> {
  const { db, now } = resolved(deps);
  const { projectId, jamId, actor } = input;
  const project = await liveProject(db, projectId);
  const jam = await jamOf(db, jamId);
  await assertMayLink(db, actor, project, jam, now());
  return db.transaction(async (tx) => {
    const { showcaseProjectId } = await liveProject(tx, projectId, true);
    const current = await currentLink(tx, projectId, jamId);
    if (current === null) notFound(`"${projectId}" has no version linked to ${jam.title}.`);

    await tx
      .delete(engineReleaseJamLinks)
      .where(
        and(eq(engineReleaseJamLinks.projectId, projectId), eq(engineReleaseJamLinks.jamId, jamId)),
      );
    if (showcaseProjectId !== null) {
      const [row] = await tx
        .select({ id: projectJamLinks.id, submissionUrl: projectJamLinks.submissionUrl })
        .from(projectJamLinks)
        .where(
          and(eq(projectJamLinks.projectId, showcaseProjectId), eq(projectJamLinks.jamId, jamId)),
        );
      if (row?.submissionUrl?.startsWith(playUrlPrefix(projectId)))
        await tx
          .update(projectJamLinks)
          .set({ submissionUrl: null })
          .where(eq(projectJamLinks.id, row.id));
    }
    await writeAudit(tx, {
      projectId,
      actor,
      action: "jam-unlink",
      releaseId: current.releaseId,
      fromRelease: current.releaseId,
      toRelease: null,
      detail: { jamId },
    });
    return { jamId, version: current.version };
  });
}
