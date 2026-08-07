/**
 * Canonical-project writes, bound to the app's database.
 *
 * The implementations live in `project-sync.ts`, which takes the drizzle
 * handle as an argument and never imports `@/db` — the `itchio-library-sync`
 * cron service runs its own copy of the sync orchestration against its own
 * client and imports that module directly. This file is the app-side
 * convenience layer: same functions, `db` already applied.
 *
 * The pure vocabulary (kind mapping, `slugifyProjectTitle`, `pickReleasedAt`)
 * lives in `project-taxonomy.ts` so client code can label a project without
 * pulling `drizzle-orm/node-postgres` into the browser bundle.
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
import * as sync from "@/lib/project-sync";

export type {
  ContributorSeed,
  ItchGameFacts,
  JamEntryFacts,
  ProjectSeed,
} from "@/lib/project-sync";

/** @see {@link sync.findFreeProjectSlug} */
export function findFreeProjectSlug(title: string, attempts?: number): Promise<string> {
  return sync.findFreeProjectSlug(db, title, attempts);
}

/** @see {@link sync.insertProject} */
export function insertProject(
  seed: sync.ProjectSeed & { source?: "manual" | "itchio"; sourceGameId?: number | null },
): Promise<string> {
  return sync.insertProject(db, seed);
}

/** @see {@link sync.findProjectByGameId} */
export function findProjectByGameId(gameId: number): Promise<string | null> {
  return sync.findProjectByGameId(db, gameId);
}

/** @see {@link sync.upsertProjectForItchGame} */
export function upsertProjectForItchGame(gameId: number, seed: sync.ProjectSeed): Promise<string> {
  return sync.upsertProjectForItchGame(db, gameId, seed);
}

/** @see {@link sync.ensureProjectContributors} */
export function ensureProjectContributors(credits: sync.ContributorSeed[]): Promise<number> {
  return sync.ensureProjectContributors(db, credits);
}

/** @see {@link sync.ensureProfilePlacementProject} */
export function ensureProfilePlacementProject(placementId: string): Promise<string> {
  return sync.ensureProfilePlacementProject(db, placementId);
}

/** @see {@link sync.creditPlacementOwner} */
export function creditPlacementOwner(projectId: string, profileId: string): Promise<void> {
  return sync.creditPlacementOwner(db, projectId, profileId);
}

/** @see {@link sync.convergeLibraryPlacements} */
export function convergeLibraryPlacements(
  profileId: string,
  games: sync.ItchGameFacts[],
): Promise<{ linked: number; filled: number }> {
  return sync.convergeLibraryPlacements(db, profileId, games);
}

/** @see {@link sync.convergeJamPlacements} */
export function convergeJamPlacements(
  profileId: string,
  entries: sync.JamEntryFacts[],
): Promise<{ linked: number }> {
  return sync.convergeJamPlacements(db, profileId, entries);
}

/** @see {@link sync.ensureProjectForScrapedGame} */
export function ensureProjectForScrapedGame(
  gameId: number,
): Promise<{ id: string; slug: string; published: boolean } | null> {
  return sync.ensureProjectForScrapedGame(db, gameId);
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
 *
 * A scrape-minted row (`source = 'itchio'` with a `source_game_id`) is
 * **self-anchoring**: the scraped corpus is its anchor, and the corpus
 * fast-follow mints those rows unanchored by definition. Without this
 * exemption the sweep would delete every one of them.
 */
export async function projectHasAnchors(projectId: string): Promise<boolean> {
  const [project] = await db
    .select({ source: projects.source, sourceGameId: projects.sourceGameId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (project && project.source === "itchio" && project.sourceGameId != null) return true;
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
