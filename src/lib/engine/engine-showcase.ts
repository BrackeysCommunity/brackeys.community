import { and, eq, isNull } from "drizzle-orm";

import { db as siteDb } from "@/db";
import { engineProjects, projectTeams, projects } from "@/db/schema";
import { isUniqueViolation } from "@/lib/pg-errors";
import { loadProjectForEditor } from "@/lib/project-editors";
import { creditPlacementOwner, insertProject, type ProjectDb } from "@/lib/project-sync";

import { canDo, roleOf, type GameRole } from "./release-access";
import { writeAudit, type ReleaseDb } from "./release-audit";
import { ReleaseError, releaseForbidden, type ReleaseApiError } from "./release-errors";
import { releaseViewer, type Actor, type ReleaseTxDb } from "./release-upload";

export type { Actor } from "./release-upload";

export type ShowcaseDeps = {
  db?: ReleaseTxDb;
  now?: () => Date;
};

export function showcaseNotFound(showcaseProjectId: string): ReleaseApiError {
  return {
    code: "not-found",
    message: `There is no project page "${showcaseProjectId}".`,
  };
}

export function showcaseNotEditable(title: string): ReleaseApiError {
  return {
    code: "release-forbidden",
    message: `Only the people credited on ${title} can link a game to it.`,
    hint: "Ask someone credited on the page to add you, or create a new page for the game.",
  };
}

export function showcaseTaken(title: string): ReleaseApiError {
  return {
    code: "game-showcase-taken",
    message: `${title} already shows another game.`,
    hint: "A project page shows one game. Unlink it there first, or create a new page.",
  };
}

export function showcaseAlreadyLinked(title: string): ReleaseApiError {
  return {
    code: "game-showcase-linked",
    message: `This game already has a project page: ${title}.`,
    hint: "Unlink it first to create a new one.",
  };
}

const CONFLICT = 409;

type EngineRow = {
  projectId: string;
  name: string;
  game: string | null;
  teamId: string | null;
  createdById: string | null;
  showcaseProjectId: string | null;
};

const engineColumns = {
  projectId: engineProjects.projectId,
  name: engineProjects.name,
  game: engineProjects.game,
  teamId: engineProjects.teamId,
  createdById: engineProjects.createdById,
  showcaseProjectId: engineProjects.showcaseProjectId,
};

const liveProject = (projectId: string) =>
  and(eq(engineProjects.projectId, projectId), isNull(engineProjects.deletedAt));

function notFound(projectId: string): never {
  throw new ReleaseError(
    { code: "not-found", message: `There is no hosted project "${projectId}".` },
    404,
  );
}

async function loadEngineProject(db: ReleaseDb, projectId: string): Promise<EngineRow> {
  const [row] = await db.select(engineColumns).from(engineProjects).where(liveProject(projectId));
  if (!row) notFound(projectId);
  return row;
}

/** The showcase link is a publisher's setting, never an agent token's. */
async function assertPublisher(db: ReleaseDb, actor: Actor, row: EngineRow): Promise<void> {
  let role: GameRole | "agent";
  if (actor.kind === "agent") role = "agent";
  else if (actor.kind === "staff") role = "staff";
  else role = roleOf(await releaseViewer(db, actor.userId, row), row);
  if (!canDo(role, "settings")) throw new ReleaseError(releaseForbidden("role"));
}

async function titleOf(db: ReleaseDb, showcaseProjectId: string): Promise<string> {
  const [row] = await db
    .select({ title: projects.title })
    .from(projects)
    .where(eq(projects.id, showcaseProjectId));
  return row?.title ?? showcaseProjectId;
}

const showcaseDetail = (before: string | null, after: string | null, created = false) => ({
  before: { showcaseProjectId: before },
  after: { showcaseProjectId: after },
  ...(created ? { created: true } : {}),
});

/**
 * Links an existing project page as the game's showcase: the caller must be
 * one of the game's publishers and able to edit that page. A page shows one
 * game; linking another page replaces the game's current link.
 */
export async function linkShowcase(
  input: { projectId: string; showcaseProjectId: string; actor: Actor },
  deps: ShowcaseDeps = {},
): Promise<void> {
  const db = deps.db ?? (siteDb as unknown as ReleaseTxDb);
  const now = deps.now ?? (() => new Date());
  const { projectId, showcaseProjectId, actor } = input;

  const current = await loadEngineProject(db, projectId);
  await assertPublisher(db, actor, current);
  const loaded = await loadProjectForEditor(showcaseProjectId, actor.userId);
  if (!loaded) throw new ReleaseError(showcaseNotFound(showcaseProjectId), 404);
  if (!loaded.canEdit) throw new ReleaseError(showcaseNotEditable(loaded.project.title));
  const title = loaded.project.title;

  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select(engineColumns)
        .from(engineProjects)
        .where(liveProject(projectId))
        .for("update");
      if (!row) notFound(projectId);
      if (row.showcaseProjectId === showcaseProjectId) return;
      const [holder] = await tx
        .select({ projectId: engineProjects.projectId })
        .from(engineProjects)
        .where(eq(engineProjects.showcaseProjectId, showcaseProjectId));
      if (holder) throw new ReleaseError(showcaseTaken(title), CONFLICT);

      await tx
        .update(engineProjects)
        .set({ showcaseProjectId, updatedAt: now() })
        .where(eq(engineProjects.projectId, projectId));
      await writeAudit(tx, {
        projectId,
        actor,
        action: "settings",
        at: now(),
        detail: showcaseDetail(row.showcaseProjectId, showcaseProjectId),
      });
    });
  } catch (error) {
    // Two games linking the same page at once: the unique column settles it.
    if (isUniqueViolation(error)) throw new ReleaseError(showcaseTaken(title), CONFLICT);
    throw error;
  }
}

/**
 * Makes a project page for the game and links it: a manual `game` row of
 * the `web` kind titled with the engine project's name, the caller credited
 * on it and the engine project's team claiming it.
 */
export async function createShowcase(
  input: { projectId: string; actor: Actor },
  deps: ShowcaseDeps = {},
): Promise<{ showcaseProjectId: string }> {
  const db = deps.db ?? (siteDb as unknown as ReleaseTxDb);
  const now = deps.now ?? (() => new Date());
  const { projectId, actor } = input;

  const current = await loadEngineProject(db, projectId);
  await assertPublisher(db, actor, current);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select(engineColumns)
      .from(engineProjects)
      .where(liveProject(projectId))
      .for("update");
    if (!row) notFound(projectId);
    if (row.showcaseProjectId) {
      throw new ReleaseError(
        showcaseAlreadyLinked(await titleOf(tx, row.showcaseProjectId)),
        CONFLICT,
      );
    }

    const projectDb = tx as unknown as ProjectDb;
    const showcaseProjectId = await insertProject(projectDb, {
      title: row.name,
      type: "game",
      subTypes: ["web"],
      createdBy: actor.userId,
      source: "manual",
    });
    await creditPlacementOwner(projectDb, showcaseProjectId, actor.userId);
    if (row.teamId) {
      await tx
        .insert(projectTeams)
        .values({ projectId: showcaseProjectId, teamId: row.teamId })
        .onConflictDoNothing();
    }

    await tx
      .update(engineProjects)
      .set({ showcaseProjectId, updatedAt: now() })
      .where(eq(engineProjects.projectId, projectId));
    await writeAudit(tx, {
      projectId,
      actor,
      action: "settings",
      at: now(),
      detail: showcaseDetail(null, showcaseProjectId, true),
    });
    return { showcaseProjectId };
  });
}

/** Clears the game's showcase link; the project page itself stays. */
export async function unlinkShowcase(
  input: { projectId: string; actor: Actor },
  deps: ShowcaseDeps = {},
): Promise<void> {
  const db = deps.db ?? (siteDb as unknown as ReleaseTxDb);
  const now = deps.now ?? (() => new Date());
  const { projectId, actor } = input;

  const current = await loadEngineProject(db, projectId);
  await assertPublisher(db, actor, current);

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select(engineColumns)
      .from(engineProjects)
      .where(liveProject(projectId))
      .for("update");
    if (!row) notFound(projectId);
    if (row.showcaseProjectId === null) return;
    await tx
      .update(engineProjects)
      .set({ showcaseProjectId: null, updatedAt: now() })
      .where(eq(engineProjects.projectId, projectId));
    await writeAudit(tx, {
      projectId,
      actor,
      action: "settings",
      at: now(),
      detail: showcaseDetail(row.showcaseProjectId, null),
    });
  });
}
