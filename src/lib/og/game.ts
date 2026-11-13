/**
 * Which hosted games may be shared outside the site. The OG card and the
 * sitemap ask `shareableGameFilter`; the Discord preview, built from a game
 * page that already resolved, asks `isShareableVisibility` (`./game-links.ts`)
 * for the visibility and the deployment guard.
 *
 * Shareable means public (and approved by staff), neither the project nor
 * its live release hidden, a production release that isn't collected, and
 * games open to signed-out visitors here: crawlers and unfurlers are signed
 * out, and the game page answers them `NotFoundPage` otherwise. Unlisted,
 * team and private games are never shared.
 */
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  engineProjects,
  engineReleaseChannels,
  engineReleases,
  projects,
  teams,
} from "@/db/schema";
import { engineGamesOpen } from "@/lib/engine/guard-server";
import { gamePagePath } from "@/lib/engine/route-paths";

/** The SQL half. Needs the production pointer and its release joined. */
function shareableGameFilter() {
  return and(
    eq(engineProjects.visibility, "public"),
    isNotNull(engineProjects.publicApprovedAt),
    isNull(engineProjects.hiddenAt),
    isNull(engineProjects.deletedAt),
    isNull(engineReleases.hiddenAt),
    isNull(engineReleases.collectedAt),
  );
}

function productionPointer() {
  return and(
    eq(engineReleaseChannels.projectId, engineProjects.projectId),
    eq(engineReleaseChannels.channel, "production"),
  );
}

function liveRelease() {
  return eq(engineReleases.id, engineReleaseChannels.releaseId);
}

export interface ShareableGame {
  projectId: string;
  title: string;
  description: string | null;
  imageKey: string | null;
  imageUrl: string | null;
  teamName: string | null;
  version: number;
}

/** The game's identity for its card, or null when it isn't shareable. */
export async function shareableGame(projectId: string): Promise<ShareableGame | null> {
  if (!(await engineGamesOpen(null))) return null;
  const [row] = await db
    .select({
      projectId: engineProjects.projectId,
      name: engineProjects.name,
      showcaseTitle: projects.title,
      description: projects.description,
      imageKey: projects.imageKey,
      imageUrl: projects.imageUrl,
      teamName: teams.name,
      version: engineReleases.version,
    })
    .from(engineProjects)
    .innerJoin(engineReleaseChannels, productionPointer())
    .innerJoin(engineReleases, liveRelease())
    .leftJoin(projects, eq(projects.id, engineProjects.showcaseProjectId))
    .leftJoin(teams, eq(teams.id, engineProjects.teamId))
    .where(and(eq(engineProjects.projectId, projectId), shareableGameFilter()))
    .limit(1);
  if (!row) return null;
  return {
    projectId: row.projectId,
    title: row.showcaseTitle ?? row.name,
    description: row.description,
    imageKey: row.imageKey,
    imageUrl: row.imageUrl,
    teamName: row.teamName,
    version: row.version,
  };
}

/** How many games the sitemap lists; zero while games are closed to signed-out visitors. */
export async function gameSitemapCount(): Promise<number> {
  if (!(await engineGamesOpen(null))) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(engineProjects)
    .innerJoin(engineReleaseChannels, productionPointer())
    .innerJoin(engineReleases, liveRelease())
    .where(shareableGameFilter());
  return Number(row?.count ?? 0);
}

/** One sitemap page of game pages, `lastmod` from the production pointer's last move. */
export async function gameSitemapUrls(
  page: number,
  pageSize: number,
): Promise<{ path: string; lastmod: Date; changefreq: "weekly" }[]> {
  if (!(await engineGamesOpen(null))) return [];
  const rows = await db
    .select({ projectId: engineProjects.projectId, updatedAt: engineReleaseChannels.updatedAt })
    .from(engineProjects)
    .innerJoin(engineReleaseChannels, productionPointer())
    .innerJoin(engineReleases, liveRelease())
    .where(shareableGameFilter())
    .orderBy(asc(engineProjects.projectId))
    .limit(pageSize)
    .offset(page * pageSize);
  return rows.map((row) => ({
    path: gamePagePath(row.projectId),
    lastmod: row.updatedAt,
    changefreq: "weekly",
  }));
}
