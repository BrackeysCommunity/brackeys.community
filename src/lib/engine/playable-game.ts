import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  engineProjects,
  engineReleaseChannels,
  engineReleaseJamLinks,
  engineReleases,
  projects,
} from "@/db/schema";

import { engineGamesOpen } from "./guard-server";
import { canPlay, type GameVisibility, type Viewer } from "./release-access";
import type { ReleaseDb } from "./release-audit";

/**
 * A hosted game linked to a site project, as the project, team and jam
 * payloads show it. `playable` is a production release anyone may play;
 * `jamVersion` is the version pinned as the submission to the jam asked
 * about, when anyone may play that.
 */
export type PlayableGame = { projectId: string; playable: boolean; jamVersion?: number };

type SelectDb = Pick<ReleaseDb, "select">;

/**
 * These payloads are public reads, identical for every caller, so a game
 * shows only what a signed-out player may see: a public or unlisted game.
 */
const ANONYMOUS: Viewer = { userId: null, staff: false, teamRole: null, isCreator: false };

/** A release the visibility's audience plays, for asking whether the game itself is listed. */
const ONCE_LIVE = {
  hiddenAt: null,
  collectedAt: null,
  firstPromotedAt: new Date(0),
  jamPinned: false,
} as const;

const releaseState = {
  version: engineReleases.version,
  hiddenAt: engineReleases.hiddenAt,
  collectedAt: engineReleases.collectedAt,
  firstPromotedAt: engineReleases.firstPromotedAt,
};

type ReleaseState = {
  version: number;
  hiddenAt: Date | null;
  collectedAt: Date | null;
  firstPromotedAt: Date | null;
};

async function resolveGames(
  db: SelectDb,
  showcaseProjectIds: readonly string[],
  jamId: number | undefined,
): Promise<Map<string, PlayableGame>> {
  const games = new Map<string, PlayableGame>();
  const ids = [...new Set(showcaseProjectIds)];
  if (ids.length === 0) return games;

  const rows = await db
    .select({
      projectId: engineProjects.projectId,
      showcaseProjectId: engineProjects.showcaseProjectId,
      visibility: engineProjects.visibility,
      teamId: engineProjects.teamId,
      hiddenAt: engineProjects.hiddenAt,
      production: releaseState,
    })
    .from(engineProjects)
    .leftJoin(
      engineReleaseChannels,
      and(
        eq(engineReleaseChannels.projectId, engineProjects.projectId),
        eq(engineReleaseChannels.channel, "production"),
      ),
    )
    .leftJoin(engineReleases, eq(engineReleases.id, engineReleaseChannels.releaseId))
    .where(and(inArray(engineProjects.showcaseProjectId, ids), isNull(engineProjects.deletedAt)));

  const listed = rows.filter(
    (row) => row.showcaseProjectId !== null && canPlay(ANONYMOUS, project(row), ONCE_LIVE).ok,
  );
  if (listed.length === 0) return games;

  const pins =
    jamId === undefined
      ? []
      : await db
          .select({ projectId: engineReleaseJamLinks.projectId, release: releaseState })
          .from(engineReleaseJamLinks)
          .innerJoin(engineReleases, eq(engineReleases.id, engineReleaseJamLinks.releaseId))
          .where(
            and(
              eq(engineReleaseJamLinks.jamId, jamId),
              inArray(
                engineReleaseJamLinks.projectId,
                listed.map((row) => row.projectId),
              ),
            ),
          );
  const pinByProject = new Map(pins.map((pin) => [pin.projectId, pin.release]));

  for (const row of listed) {
    const production: ReleaseState | null = row.production;
    const playable =
      production !== null &&
      canPlay(ANONYMOUS, project(row), { ...production, jamPinned: false }).ok;
    const pin = pinByProject.get(row.projectId);
    const game: PlayableGame = { projectId: row.projectId, playable };
    if (pin && canPlay(ANONYMOUS, project(row), { ...pin, jamPinned: true }).ok) {
      game.jamVersion = pin.version;
    }
    games.set(row.showcaseProjectId as string, game);
  }
  return games;
}

function project(row: { visibility: string; teamId: string | null; hiddenAt: Date | null }) {
  return {
    visibility: row.visibility as GameVisibility,
    teamId: row.teamId,
    hiddenAt: row.hiddenAt,
  };
}

/**
 * The hosted game linked to each of these site projects, keyed by the site
 * project's id. A project with no link, or a link to a game that isn't public
 * or unlisted, has no entry. Empty while games are closed for the viewer
 * (production, or the `engine-games-enabled` flag off). With `jamId`, each
 * game also carries the version pinned to that jam.
 */
export async function playableGames(
  db: SelectDb,
  showcaseProjectIds: readonly string[],
  viewer: { userId: string | null },
  opts: { jamId?: number } = {},
): Promise<Map<string, PlayableGame>> {
  if (showcaseProjectIds.length === 0) return new Map();
  if (!(await engineGamesOpen(viewer.userId))) return new Map();
  return resolveGames(db, showcaseProjectIds, opts.jamId);
}

/**
 * `playableGames` for scraped itch games, keyed by itch game id: a game
 * resolves through the site project whose `source_game_id` it is.
 */
export async function playableGamesByItchGame(
  db: SelectDb,
  gameIds: readonly number[],
  viewer: { userId: string | null },
  opts: { jamId?: number } = {},
): Promise<Map<number, PlayableGame>> {
  const byGame = new Map<number, PlayableGame>();
  const ids = [...new Set(gameIds)];
  if (ids.length === 0) return byGame;
  if (!(await engineGamesOpen(viewer.userId))) return byGame;

  const rows = await db
    .select({ id: projects.id, gameId: projects.sourceGameId })
    .from(projects)
    .where(inArray(projects.sourceGameId, ids));
  const games = await resolveGames(
    db,
    rows.map((row) => row.id),
    opts.jamId,
  );
  for (const row of rows) {
    const game = games.get(row.id);
    if (game && row.gameId !== null) byGame.set(row.gameId, game);
  }
  return byGame;
}
