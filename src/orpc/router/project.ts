import { os } from "@orpc/server";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import {
  developerProfiles,
  itchJamEntries,
  itchJamEntryResults,
  itchJams,
  profileUrlStubs,
  projectContributors,
  projectJamLinks,
  projectTeams,
  projects,
  teamMembers,
  teams,
} from "@/db/schema";
import {
  getProfileProjectImageUrl,
  resolveTeamAvatarUrl,
} from "@/lib/profile-project-image-storage";
import { authMiddleware } from "@/orpc/middleware/auth";

/**
 * A project's canonical page, in one round trip.
 *
 * Resolution is slug-then-id, the house pattern (`getTeam`, `getProfile`).
 * Everything below is a handful of rows per project, so there is no reason
 * to make the page wait on four requests.
 */
export const getProject = os
  .use(authMiddleware)
  .input(z.object({ idOrSlug: z.string().trim().min(1).max(300) }))
  .handler(async ({ input, context }) => {
    const [project] = await db
      .select()
      .from(projects)
      .where(or(eq(projects.slug, input.idOrSlug), eq(projects.id, input.idOrSlug)))
      .limit(1);
    if (!project) return null;

    const viewerId = context.user?.id ?? null;

    const [contributorRows, teamRows, derivedJams, explicitJams] = await Promise.all([
      db
        .select({
          id: projectContributors.id,
          profileId: projectContributors.profileId,
          displayName: projectContributors.displayName,
          role: projectContributors.role,
          source: projectContributors.source,
          sortOrder: projectContributors.sortOrder,
          avatarUrl: developerProfiles.avatarUrl,
          username: developerProfiles.guildNickname,
          discordUsername: developerProfiles.discordUsername,
          urlStub: profileUrlStubs.stub,
        })
        .from(projectContributors)
        // Left joins: a free-text credit has no profile to join to, and that
        // is the whole point — a contributor who was never on the platform
        // still gets their name on the page.
        .leftJoin(developerProfiles, eq(projectContributors.profileId, developerProfiles.id))
        .leftJoin(profileUrlStubs, eq(profileUrlStubs.profileId, developerProfiles.id))
        .where(eq(projectContributors.projectId, project.id))
        .orderBy(projectContributors.sortOrder, projectContributors.id),
      db
        .select({
          teamId: teams.id,
          name: teams.name,
          slug: teams.slug,
          tagline: teams.tagline,
          avatarUrl: teams.avatarUrl,
          avatarKey: teams.avatarKey,
        })
        .from(projectTeams)
        .innerJoin(teams, eq(projectTeams.teamId, teams.id))
        .where(eq(projectTeams.projectId, project.id)),
      // Derived jam record: every appearance of this *game* on itch, joined
      // by game id. Zero maintenance — a jam the game entered after import
      // shows up the next time the scraper sees it.
      project.sourceGameId != null
        ? db
            .select({
              entryId: itchJamEntries.entryId,
              jamId: itchJams.jamId,
              jamSlug: itchJams.slug,
              jamTitle: itchJams.title,
              jamEntriesCount: itchJams.entriesCount,
              submittedAt: itchJamEntries.submittedAt,
              submissionUrl: itchJamEntries.rateUrl,
              ratingCount: itchJamEntries.ratingCount,
              rank: itchJamEntryResults.rank,
            })
            .from(itchJamEntries)
            .innerJoin(itchJams, eq(itchJamEntries.jamId, itchJams.jamId))
            .leftJoin(
              itchJamEntryResults,
              and(
                eq(itchJamEntryResults.entryId, itchJamEntries.entryId),
                sql`lower(${itchJamEntryResults.criterion}) = 'overall'`,
              ),
            )
            .where(
              and(
                eq(itchJamEntries.gameId, project.sourceGameId),
                isNull(itchJamEntries.missingSince),
                isNull(itchJams.missingSince),
              ),
            )
            .orderBy(desc(itchJamEntries.submittedAt))
        : Promise.resolve([]),
      db
        .select({
          id: projectJamLinks.id,
          jamId: projectJamLinks.jamId,
          jamSlug: itchJams.slug,
          jamTitle: itchJams.title,
          jamEntriesCount: itchJams.entriesCount,
          jamName: projectJamLinks.jamName,
          jamUrl: projectJamLinks.jamUrl,
          submissionUrl: projectJamLinks.submissionUrl,
          result: projectJamLinks.result,
          participatedAt: projectJamLinks.participatedAt,
        })
        .from(projectJamLinks)
        .leftJoin(itchJams, eq(projectJamLinks.jamId, itchJams.jamId))
        .where(eq(projectJamLinks.projectId, project.id)),
    ]);

    // Editors = createdBy ∪ profile-linked contributors ∪ members of a
    // claiming team. Computed here so the page never has to guess.
    const viewerCanEdit = viewerId != null && (await canEditProject(project, viewerId, teamRows));

    // An unpublished project is only a page for the people who made it —
    // mirrors the profile rule ("unpublished titles only shown to the
    // owner"). A *restricted* one still renders: jam participation is public
    // record; the page suppresses its itch links instead.
    if (!project.published && !viewerCanEdit) return null;

    const contributors = contributorRows.map(({ discordUsername, username, ...row }) => ({
      ...row,
      // The credit's own display name always wins — that's the promise the
      // table makes. The profile name is only a fallback for a linked row
      // whose display name was somehow never set.
      displayName: row.displayName || username || discordUsername || "Unknown",
    }));

    const teamShelf = await Promise.all(
      teamRows.map(async ({ avatarKey, ...row }) => ({
        ...row,
        avatarUrl: await resolveTeamAvatarUrl({ avatarKey, avatarUrl: row.avatarUrl }),
      })),
    );

    // Explicit rows for a jam we can already derive would double the row on
    // the page; the derived one is richer (it carries the rank), so it wins.
    const derivedJamIds = new Set(derivedJams.map((row) => row.jamId));

    const jamRecord = [
      ...derivedJams.map((row) => ({
        key: `entry-${row.entryId}`,
        jamId: row.jamId as number | null,
        jamSlug: row.jamSlug as string | null,
        jamName: row.jamTitle as string | null,
        jamUrl: null as string | null,
        submissionUrl: row.submissionUrl as string | null,
        participatedAt: row.submittedAt as Date | null,
        rank: row.rank as number | null,
        entriesCount: row.jamEntriesCount as number | null,
        result: null as string | null,
      })),
      ...explicitJams
        .filter((row) => row.jamId == null || !derivedJamIds.has(row.jamId))
        .map((row) => ({
          key: `link-${row.id}`,
          jamId: row.jamId,
          jamSlug: row.jamSlug,
          // Free text coalesced over the join, same rule the placements use.
          jamName: row.jamName ?? row.jamTitle,
          jamUrl: row.jamUrl,
          submissionUrl: row.submissionUrl,
          participatedAt: row.participatedAt,
          rank: null as number | null,
          entriesCount: row.jamEntriesCount,
          result: row.result,
        })),
    ].sort((a, b) => (b.participatedAt?.getTime() ?? 0) - (a.participatedAt?.getTime() ?? 0));

    return {
      project: {
        ...project,
        // A project-scoped upload wins over the provider cover, same
        // precedence the placements use for their own images.
        imageUrl: (await getProfileProjectImageUrl(project.imageKey)) ?? project.imageUrl,
      },
      contributors,
      teams: teamShelf,
      jamRecord,
      viewerCanEdit,
    };
  });

/**
 * The §1.3 editor set: whoever created the row, anyone credited on it with a
 * live profile link, and any member of a team that claims it.
 *
 * Deliberately *not* "the owner": a canonical project is shared, and the
 * people who made a thing are the people who get to describe it.
 */
async function canEditProject(
  project: { id: string; createdBy: string | null },
  viewerId: string,
  teamRows: { teamId: string }[],
): Promise<boolean> {
  if (project.createdBy === viewerId) return true;

  const [credited] = await db
    .select({ id: projectContributors.id })
    .from(projectContributors)
    .where(
      and(
        eq(projectContributors.projectId, project.id),
        eq(projectContributors.profileId, viewerId),
      ),
    )
    .limit(1);
  if (credited) return true;

  if (teamRows.length === 0) return false;
  const [member] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(
      and(
        inArray(
          teamMembers.teamId,
          teamRows.map((row) => row.teamId),
        ),
        eq(teamMembers.userId, viewerId),
      ),
    )
    .limit(1);
  return member != null;
}

/**
 * Which of these itch games have a canonical project page.
 *
 * The jam page's entries grid calls this for the page of entries it just
 * rendered, so an entry that *is* one of our projects links inward instead
 * of straight off to itch. Most won't be — a project row only exists when
 * something local anchors it.
 */
export const listProjectsForGames = os
  .input(z.object({ gameIds: z.array(z.number().int()).max(96) }))
  .handler(async ({ input }) => {
    const gameIds = [...new Set(input.gameIds)];
    if (gameIds.length === 0) return { projects: [] };

    const rows = await db
      .select({
        id: projects.id,
        slug: projects.slug,
        title: projects.title,
        type: projects.type,
        sourceGameId: projects.sourceGameId,
      })
      .from(projects)
      .where(and(inArray(projects.sourceGameId, gameIds), eq(projects.published, true)));

    return { projects: rows };
  });
