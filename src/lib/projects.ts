/**
 * Canonical-project writes: slug allocation and the by-game-id upsert.
 *
 * **Server only** — it opens the database. The pure vocabulary (kind
 * mapping, `slugifyProjectTitle`, `pickReleasedAt`) lives in
 * `project-taxonomy.ts` so client code can label a project without pulling
 * `drizzle-orm/node-postgres` into the browser bundle.
 *
 * Lives in `lib/` beside `src/db/schema.ts` on purpose — the
 * `itchio-library-sync` service runs its own copy of the sync orchestration
 * and imports the schema by relative path; it has to be able to import the
 * upsert the same way, or the cron sweep keeps minting placements with no
 * canonical row behind them.
 */
import { eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  type ProjectType,
  itchJamEntries,
  profileProjects,
  projects,
  teamProjects,
} from "@/db/schema";
import { slugifyProjectTitle } from "@/lib/project-taxonomy";

/** 4 hex chars — enough to separate same-titled projects without turning
 * the URL into an id. */
function slugSuffix(): string {
  return Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, "0");
}

/**
 * A free slug for `title`. Checks the base form first, then appends a hex
 * suffix.
 *
 * Advisory only: `projects.slug` is UNIQUE, so a concurrent insert can
 * still lose the race. Callers insert with a retry rather than trusting
 * this to hold.
 */
export async function findFreeProjectSlug(title: string, attempts = 5): Promise<string> {
  const base = slugifyProjectTitle(title);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${slugSuffix()}`;
    const [taken] = await db
      .select({ slug: projects.slug })
      .from(projects)
      .where(eq(projects.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  // Every candidate collided — fall back to something that effectively
  // cannot, rather than failing the insert.
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Postgres unique-violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

export interface ProjectSeed {
  title: string;
  description?: string | null;
  type?: ProjectType;
  subTypes?: string[];
  url?: string | null;
  imageUrl?: string | null;
  classification?: string | null;
  embedType?: string | null;
  releaseStatus?: string | null;
  published?: boolean;
  restrictedAt?: Date | null;
  releasedAt?: Date | null;
  createdBy?: string | null;
}

/**
 * Insert a project, retrying on a slug collision the pre-check missed.
 * Returns the new row's id.
 */
export async function insertProject(
  seed: ProjectSeed & { source?: "manual" | "itchio"; sourceGameId?: number | null },
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = await findFreeProjectSlug(seed.title);
    try {
      const [row] = await db
        .insert(projects)
        .values({
          slug,
          title: seed.title,
          description: seed.description ?? null,
          type: seed.type ?? "game",
          subTypes: seed.subTypes ?? [],
          url: seed.url ?? null,
          imageUrl: seed.imageUrl ?? null,
          classification: seed.classification ?? null,
          embedType: seed.embedType ?? null,
          releaseStatus: seed.releaseStatus ?? null,
          published: seed.published ?? true,
          restrictedAt: seed.restrictedAt ?? null,
          releasedAt: seed.releasedAt ?? null,
          createdBy: seed.createdBy ?? null,
          source: seed.source ?? "manual",
          sourceGameId: seed.sourceGameId ?? null,
        })
        .returning({ id: projects.id });
      if (row) return row.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Either the slug or the game id collided. A game-id collision means
      // someone else just created this exact project — the caller's
      // `findProjectByGameId` will now find it, so surface the race.
      if (seed.sourceGameId != null) {
        const existing = await findProjectByGameId(seed.sourceGameId);
        if (existing) return existing;
      }
      // Otherwise it was the slug: loop and take a fresh suffix.
    }
  }
  throw new Error(`could not allocate a slug for project "${seed.title}"`);
}

/** The canonical project for an itch game id, if one exists. */
export async function findProjectByGameId(gameId: number): Promise<string | null> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.sourceGameId, gameId))
    .limit(1);
  return row?.id ?? null;
}

/**
 * The canonical project for an itch game, created if it doesn't exist yet.
 *
 * `source_game_id` is the dedupe key: one game on itch is one project row
 * however many members import it. The partial unique index is what makes
 * the concurrent case safe — two members syncing the same game at once
 * race, and the loser reads back the winner's row.
 */
export async function upsertProjectForItchGame(gameId: number, seed: ProjectSeed): Promise<string> {
  const existing = await findProjectByGameId(gameId);
  if (existing) return existing;
  return insertProject({ ...seed, source: "itchio", sourceGameId: gameId });
}

/**
 * Resolve `profile_projects` / `team_projects` `sourceId` values to itch
 * game ids.
 *
 * A library row's `sourceId` *is* the game id. A jam row's is an **entry**
 * id, which only `itch.jam_entries` can turn into a game id — and the two
 * id spaces overlap numerically, so the source column has to be consulted
 * rather than guessed at.
 */
export async function resolveEntryIdsToGameIds(entryIds: number[]): Promise<Map<number, number>> {
  if (entryIds.length === 0) return new Map();
  const rows = await db
    .select({ entryId: itchJamEntries.entryId, gameId: itchJamEntries.gameId })
    .from(itchJamEntries)
    .where(inArray(itchJamEntries.entryId, entryIds));
  return new Map(rows.map((row) => [row.entryId, row.gameId]));
}

/**
 * Whether a project still has anything anchoring it: a profile placement, a
 * team placement, a team credit, or a profile-linked contributor.
 *
 * A project that loses its last anchor is an **orphan**. The rule (see the
 * lifecycle notes on `removeProject`) is that placement deletion only ever
 * deletes the placement — never the project, which other people's pages and
 * jam backlinks point at. Orphans with free-text credits or jam links are
 * kept (it's still someone's shipped work); never-anchored empties are for a
 * periodic sweep to collect, not a synchronous cascade.
 */
export async function projectHasAnchors(projectId: string): Promise<boolean> {
  const [profileRow] = await db
    .select({ id: profileProjects.id })
    .from(profileProjects)
    .where(eq(profileProjects.projectId, projectId))
    .limit(1);
  if (profileRow) return true;
  const [teamRow] = await db
    .select({ id: teamProjects.id })
    .from(teamProjects)
    .where(eq(teamProjects.projectId, projectId))
    .limit(1);
  return teamRow != null;
}

/** Placements with no canonical row yet — what the backfill and the
 * convergence step both need to find. */
export function unlinkedProfilePlacements() {
  return db.select().from(profileProjects).where(isNull(profileProjects.projectId));
}

export function unlinkedTeamPlacements() {
  return db.select().from(teamProjects).where(isNull(teamProjects.projectId));
}

/** Re-exported so a server caller can take the whole vocabulary from one
 * import rather than reaching into two modules. */
export {
  pickReleasedAt,
  projectTypeFromClassification,
  projectTypeFromPlacement,
  slugifyProjectTitle,
} from "@/lib/project-taxonomy";
export type { ProjectType };
