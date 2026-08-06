import { ORPCError } from "@orpc/client";
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
  teams,
} from "@/db/schema";
import {
  getProfileProjectImageUrl,
  resolveTeamAvatarUrl,
} from "@/lib/profile-project-image-storage";
import { canEditProject, loadProjectForEditor } from "@/lib/project-editors";
import { authMiddleware, requireAuth } from "@/orpc/middleware/auth";

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

// ── Credits ─────────────────────────────────────────────────────────────────
//
// The credits list is why the project page exists, so it's the first thing
// that had to become editable. Three rules run through all of it:
//
//  1. **Any editor may edit** (§1.3) — a project is shared by the people who
//     made it, and "the owner" isn't a concept here.
//  2. **`display_name` is the promise.** A credit is never rewritten by a
//     sync and never deleted by roster churn; `profile_id` is only the
//     optional live link, and a deleted account nulls it without touching
//     the name.
//  3. **Nothing here mints, merges, or renames a project.** These endpoints
//     only ever touch `project_contributors`.

/** The editor gate for a write, as a project row. Throws the way the rest of
 * the routers do rather than returning a verdict nobody checks. */
async function requireProjectEditor(projectId: string, viewerId: string) {
  const loaded = await loadProjectForEditor(projectId, viewerId);
  if (!loaded) throw new ORPCError("NOT_FOUND", { message: "Project not found." });
  if (!loaded.canEdit) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only the people credited on this project can edit it.",
    });
  }
  return loaded.project;
}

/** A credit row plus the profile fields the page renders it with. */
async function readContributor(contributorId: number) {
  const [row] = await db
    .select({
      id: projectContributors.id,
      projectId: projectContributors.projectId,
      profileId: projectContributors.profileId,
      displayName: projectContributors.displayName,
      role: projectContributors.role,
      source: projectContributors.source,
      sortOrder: projectContributors.sortOrder,
      avatarUrl: developerProfiles.avatarUrl,
      urlStub: profileUrlStubs.stub,
    })
    .from(projectContributors)
    .leftJoin(developerProfiles, eq(projectContributors.profileId, developerProfiles.id))
    .leftJoin(profileUrlStubs, eq(profileUrlStubs.profileId, developerProfiles.id))
    .where(eq(projectContributors.id, contributorId))
    .limit(1);
  return row ?? null;
}

const displayNameSchema = z.string().trim().min(1).max(120);
const roleSchema = z.string().trim().max(80);

export const addProjectContributor = os
  .use(requireAuth)
  .input(
    z.object({
      projectId: z.string(),
      displayName: displayNameSchema,
      role: roleSchema.optional(),
      /** Optional live link to a member's profile. Omitted for the free-text
       * case, which is the majority — most collaborators aren't here. */
      profileId: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireProjectEditor(input.projectId, context.user.id);

    if (input.profileId) {
      const [profile] = await db
        .select({ id: developerProfiles.id })
        .from(developerProfiles)
        .where(eq(developerProfiles.id, input.profileId))
        .limit(1);
      if (!profile) throw new ORPCError("NOT_FOUND", { message: "That member doesn't exist." });
    }

    // Same dedupe the syncs and the backfill use: by profile where there is
    // one, case-insensitively by name otherwise. The partial unique index
    // enforces the first; the second is ours to check.
    const existing = await db
      .select({
        id: projectContributors.id,
        profileId: projectContributors.profileId,
        displayName: projectContributors.displayName,
      })
      .from(projectContributors)
      .where(eq(projectContributors.projectId, input.projectId));

    const clash = existing.find(
      (row) =>
        (input.profileId != null && row.profileId === input.profileId) ||
        row.displayName.trim().toLowerCase() === input.displayName.toLowerCase(),
    );
    if (clash) {
      throw new ORPCError("CONFLICT", { message: "That person is already credited." });
    }

    const [created] = await db
      .insert(projectContributors)
      .values({
        projectId: input.projectId,
        profileId: input.profileId ?? null,
        displayName: input.displayName,
        role: input.role || null,
        // Hand-added, so a later sync's add-only pass leaves it alone.
        source: "manual",
        // New credits land at the end; the seeded rows keep their order.
        sortOrder: existing.length,
      })
      .returning({ id: projectContributors.id });
    if (!created)
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Could not add credit." });

    return await readContributor(created.id);
  });

export const updateProjectContributor = os
  .use(requireAuth)
  .input(
    z.object({
      contributorId: z.number().int(),
      displayName: displayNameSchema.optional(),
      role: roleSchema.nullable().optional(),
      sortOrder: z.number().int().min(0).max(999).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [row] = await db
      .select({ id: projectContributors.id, projectId: projectContributors.projectId })
      .from(projectContributors)
      .where(eq(projectContributors.id, input.contributorId))
      .limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Credit not found." });
    await requireProjectEditor(row.projectId, context.user.id);

    // A scraped `entry-contributors` row is editable too: the syncs only ever
    // *add* credits, so a corrected name or a filled-in role survives them.
    const [updated] = await db
      .update(projectContributors)
      .set({
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.role !== undefined ? { role: input.role || null } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projectContributors.id, input.contributorId))
      .returning({ id: projectContributors.id });
    if (!updated) throw new ORPCError("NOT_FOUND", { message: "Credit not found." });

    return await readContributor(updated.id);
  });

export const removeProjectContributor = os
  .use(requireAuth)
  .input(z.object({ contributorId: z.number().int() }))
  .handler(async ({ input, context }) => {
    const [row] = await db
      .select({ id: projectContributors.id, projectId: projectContributors.projectId })
      .from(projectContributors)
      .where(eq(projectContributors.id, input.contributorId))
      .limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Credit not found." });
    await requireProjectEditor(row.projectId, context.user.id);

    // Removing your own credit can remove your own edit rights — that's
    // allowed and intended (miscredited people can take themselves off), and
    // `createdBy` plus any team claim survive it.
    await db.delete(projectContributors).where(eq(projectContributors.id, input.contributorId));

    return { success: true };
  });

// Picking a member to credit reuses `searchProfiles` (team router) rather
// than minting a second member-search endpoint — it already answers exactly
// this question, and it now matches guild nicknames as well as handles.
