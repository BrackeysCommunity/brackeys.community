import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import {
  collabPosts,
  developerProfiles,
  itchJamEntries,
  itchJamEntryResults,
  itchJams,
  profileProjects,
  profileUrlStubs,
  projectContributors,
  projectJamLinks,
  projectTeams,
  projects,
  teamMembers,
  teamProjects,
  teams,
} from "@/db/schema";
import { checkProfanity } from "@/lib/profanity";
import {
  getProfileProjectImageUrl,
  resolveTeamAvatarUrl,
} from "@/lib/profile-project-image-storage";
import { PROFILE_PROJECT_SUBTYPES, getAllowedSubTypesForProjectType } from "@/lib/profile-projects";
import { canEditProject, loadProjectForEditor } from "@/lib/project-editors";
import {
  MANUAL_PROJECT_TYPES,
  RELEASE_STATUSES,
  RESERVED_PROJECT_SLUGS,
} from "@/lib/project-taxonomy";
import { ensureProjectForScrapedGame } from "@/lib/projects";
import { requireAuth } from "@/orpc/middleware/auth";

/**
 * A project's canonical page, in one round trip.
 *
 * Resolution is slug-then-id, the house pattern (`getTeam`, `getProfile`).
 * Everything below is a handful of rows per project, so there is no reason
 * to make the page wait on four requests.
 */
async function resolveProject(idOrSlug: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(or(eq(projects.slug, idOrSlug), eq(projects.id, idOrSlug)))
    .limit(1);
  return project ?? null;
}

/**
 * Everything the project page renders, for an already-resolved row. Shared
 * by the public read and the editor fallback below, so an unpublished
 * project's page can never drift from a published one's.
 */
async function buildProjectDetail(project: typeof projects.$inferSelect) {
  const [
    contributorRows,
    teamRows,
    derivedJams,
    explicitJams,
    profileAnchor,
    teamAnchor,
    openPostRow,
  ] = await Promise.all([
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
    // Anchor probes for the indexability rule below — a placement anywhere
    // counts even when its owner's credit row was since removed.
    db
      .select({ id: profileProjects.id })
      .from(profileProjects)
      .where(eq(profileProjects.projectId, project.id))
      .limit(1),
    db
      .select({ id: teamProjects.id })
      .from(teamProjects)
      .where(eq(teamProjects.projectId, project.id))
      .limit(1),
    // Open collab posts recruiting for this project — drives the page's
    // RECRUITING section, which (like the jam page's post count) only
    // renders when the answer is non-zero.
    db
      .select({ count: count() })
      .from(collabPosts)
      .where(and(eq(collabPosts.projectId, project.id), eq(collabPosts.status, "recruiting")))
      .then((rows) => rows[0]),
  ]);

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

  // Indexing follows anchoring, not existence (§7.4.3): a lazily-minted
  // single-jam stranger's game is real but thin, so it stays `noindex`
  // until something local claims it — or until a second jam appearance
  // gives the page content no jam page has.
  const anchored =
    project.createdBy != null ||
    profileAnchor.length > 0 ||
    teamAnchor.length > 0 ||
    teamRows.length > 0 ||
    contributorRows.some((row) => row.profileId != null) ||
    derivedJams.length > 1;

  // Internal provider bookkeeping stays server-side: the raw payload and
  // the refresh-gate snapshot are never a read-path surface.
  const { providerRaw: _providerRaw, sourceSnapshot: _sourceSnapshot, ...projectPublic } = project;

  return {
    indexable: project.published && anchored,
    project: {
      ...projectPublic,
      // A project-scoped upload wins over the provider cover, same
      // precedence the placements use for their own images.
      imageUrl: (await getProfileProjectImageUrl(project.imageKey)) ?? project.imageUrl,
    },
    contributors,
    teams: teamShelf,
    jamRecord,
    openPostCount: Number(openPostRow?.count ?? 0),
  };
}

/**
 * A project's canonical page, in one round trip — published rows only.
 *
 * An unpublished project is a page for the people who made it, mirroring the
 * profile rule; they get it from `getProjectViewerState` instead. A
 * *restricted* one still renders: jam participation is public record, and the
 * page suppresses its itch links instead.
 */
export const getProject = os
  .route({ method: "GET" })
  .input(z.object({ idOrSlug: z.string().trim().min(1).max(300) }))
  .handler(async ({ input }) => {
    const project = await resolveProject(input.idOrSlug);
    if (!project?.published) return null;
    return buildProjectDetail(project);
  });

/**
 * Whether the viewer may edit this project, and — for an editor of an
 * unpublished one — the page the public read refuses to serve.
 *
 * Editors are `createdBy` ∪ profile-linked contributors ∪ members of a
 * claiming team (§1.3), resolved server-side so the page never guesses.
 */
export const getProjectViewerState = os
  .use(requireAuth)
  .input(z.object({ idOrSlug: z.string().trim().min(1).max(300) }))
  .handler(async ({ input, context }) => {
    const project = await resolveProject(input.idOrSlug);
    if (!project) return { viewerCanEdit: false, detail: null };

    const teamRows = await db
      .select({ teamId: projectTeams.teamId })
      .from(projectTeams)
      .where(eq(projectTeams.projectId, project.id));
    const viewerCanEdit = await canEditProject(project, context.user.id, teamRows);

    return {
      viewerCanEdit,
      detail: !project.published && viewerCanEdit ? await buildProjectDetail(project) : null,
    };
  });

/**
 * Every project the caller can edit — the §1.3 union (created it, credited
 * on it, or a member of a team that claims it), which is also the pickable
 * set for the collab wizard's project picker: no new permission concept.
 *
 * Unpublished rows are included on purpose — recruiting for your own
 * unshipped thing is the normal case, and only its editors ever see it
 * here. `teamIds` carries each project's claims so the picker can group
 * the selected team's projects first.
 */
export const listEditableProjects = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const userId = context.user.id;

    const rows = await db
      .select()
      .from(projects)
      .where(
        or(
          eq(projects.createdBy, userId),
          inArray(
            projects.id,
            db
              .select({ projectId: projectContributors.projectId })
              .from(projectContributors)
              .where(eq(projectContributors.profileId, userId)),
          ),
          inArray(
            projects.id,
            db
              .select({ projectId: projectTeams.projectId })
              .from(projectTeams)
              .where(
                inArray(
                  projectTeams.teamId,
                  db
                    .select({ teamId: teamMembers.teamId })
                    .from(teamMembers)
                    .where(eq(teamMembers.userId, userId)),
                ),
              ),
          ),
        ),
      )
      .orderBy(desc(projects.updatedAt))
      .limit(100);

    const claims =
      rows.length > 0
        ? await db
            .select({ projectId: projectTeams.projectId, teamId: projectTeams.teamId })
            .from(projectTeams)
            .where(
              inArray(
                projectTeams.projectId,
                rows.map((row) => row.id),
              ),
            )
        : [];
    const teamIdsByProject = new Map<string, string[]>();
    for (const claim of claims) {
      const list = teamIdsByProject.get(claim.projectId) ?? [];
      list.push(claim.teamId);
      teamIdsByProject.set(claim.projectId, list);
    }

    return {
      projects: await Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          slug: row.slug,
          title: row.title,
          type: row.type,
          classification: row.classification,
          embedType: row.embedType,
          url: row.url,
          published: row.published,
          imageUrl: (await getProfileProjectImageUrl(row.imageKey)) ?? row.imageUrl,
          teamIds: teamIdsByProject.get(row.id) ?? [],
        })),
      ),
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
  .route({ method: "GET" })
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

/**
 * The project page for a scraped itch game, minted on first visit.
 *
 * The `/projects/game/$gameId` route calls this and redirects to the
 * canonical slug. Anonymous on purpose — the visit *is* the trigger — and
 * safe at scale: minting is idempotent (the partial unique index on
 * `source_game_id` absorbs races), the route is `noindex, nofollow`, and a
 * game we hold no live entry for mints nothing.
 *
 * Returns null for an unpublished row too: that's the staff kill switch
 * (§7.5) reading as "no page here" rather than as a redirect to a 404.
 */
export const resolveProjectForGame = os
  .input(z.object({ gameId: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const project = await ensureProjectForScrapedGame(input.gameId);
    if (!project || !project.published) return null;
    return { slug: project.slug };
  });

// ── Canonical fields ────────────────────────────────────────────────────────

/**
 * Edit what the project *is* — the fields that live on the canonical row
 * rather than on anyone's placement.
 *
 * Named `updateProjectDetails` because `updateProject` is the profile
 * router's placement editor; the two are genuinely different acts, and the
 * flat router namespace makes the distinction explicit rather than
 * accidental.
 *
 * Not editable here: `published` / `restrictedAt` (provider truth and the
 * staff hide, §7.5), the cover (its own upload endpoint, since it writes to
 * MinIO), `sourceGameId` (identity), and the slug — a rename is
 * `setProjectSlug`, its own explicit act.
 */
export const updateProjectDetails = os
  .use(requireAuth)
  .input(
    z.object({
      projectId: z.string(),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().trim().max(2000).nullable().optional(),
      url: z.url().nullable().optional().or(z.literal("")),
      type: z.enum(MANUAL_PROJECT_TYPES).optional(),
      subTypes: z.array(z.enum(PROFILE_PROJECT_SUBTYPES)).optional(),
      links: z
        .array(z.object({ label: z.string().trim().min(1).max(40), url: z.url() }))
        .max(6)
        .optional(),
      releaseStatus: z.enum(RELEASE_STATUSES).nullable().optional(),
      releasedAt: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const project = await requireProjectEditor(input.projectId, context.user.id);
    checkProfanity(input.title, "Title");
    checkProfanity(input.description, "Description");

    // `release_status` is provider truth for an imported project — the itch
    // API says whether a game is in development, and the next sync would
    // disagree with whatever was typed here. Manual projects own theirs (D7:
    // a website wants "in development" too).
    if (input.releaseStatus !== undefined && project.source !== "manual") {
      throw new ORPCError("BAD_REQUEST", {
        message: "Release status comes from itch.io for imported projects.",
      });
    }

    const releasedAt =
      input.releasedAt === undefined
        ? undefined
        : input.releasedAt
          ? new Date(input.releasedAt)
          : null;
    if (releasedAt != null && Number.isNaN(releasedAt.getTime())) {
      throw new ORPCError("BAD_REQUEST", { message: "That release date isn't a date." });
    }

    // Sub-types follow the kind: validated against the kind being saved, and
    // silently shed when a kind change makes them meaningless (a `web`
    // project has no `music`). Same rule the profile placement editor
    // enforces — this endpoint just finally applies it to the canonical row.
    const nextType = input.type ?? project.type;
    let nextSubTypes: string[] | undefined;
    if (input.subTypes !== undefined) {
      const allowed = new Set<string>(getAllowedSubTypesForProjectType(nextType));
      if (input.subTypes.some((subType) => !allowed.has(subType))) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Selected sub-types do not match the chosen project type.",
        });
      }
      nextSubTypes = [...new Set(input.subTypes)];
    } else if (input.type !== undefined) {
      const allowed = new Set<string>(getAllowedSubTypesForProjectType(nextType));
      const kept = project.subTypes.filter((subType) => allowed.has(subType));
      if (kept.length !== project.subTypes.length) nextSubTypes = kept;
    }

    const [updated] = await db
      .update(projects)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.url !== undefined ? { url: input.url || null } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(nextSubTypes !== undefined ? { subTypes: nextSubTypes } : {}),
        ...(input.links !== undefined ? { links: input.links } : {}),
        ...(input.releaseStatus !== undefined ? { releaseStatus: input.releaseStatus } : {}),
        ...(releasedAt !== undefined ? { releasedAt } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, input.projectId))
      .returning({ id: projects.id, slug: projects.slug });

    return updated ?? null;
  });

// A rename is first-come-first-served with no staff gating, same policy as
// team handles. Longer ceiling than a team's 32 because generated slugs run
// to 60 chars plus a collision suffix, and a rename must be able to keep one.
const SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{1,78}[a-z0-9]$/;

/**
 * Rename a project's URL handle. Its own endpoint rather than a field on
 * `updateProjectDetails` so an ordinary details save can never move the URL
 * the viewer is sitting on — a rename is an explicit act.
 */
export const setProjectSlug = os
  .use(requireAuth)
  .input(z.object({ projectId: z.string(), slug: z.string().min(3).max(80) }))
  .handler(async ({ input, context }) => {
    await requireProjectEditor(input.projectId, context.user.id);

    const slug = input.slug.toLowerCase().trim();
    if (!SLUG_REGEX.test(slug)) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Handle must be 3-80 characters, start and end with a letter or number, and contain only lowercase letters, numbers, hyphens, and underscores.",
      });
    }
    if (RESERVED_PROJECT_SLUGS.has(slug)) {
      throw new ORPCError("BAD_REQUEST", { message: "That handle is reserved." });
    }
    checkProfanity(slug, "Handle");

    const [existing] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (existing && existing.id !== input.projectId) {
      throw new ORPCError("CONFLICT", { message: "This handle is already taken." });
    }

    const [updated] = await db
      .update(projects)
      .set({ slug, updatedAt: new Date() })
      .where(eq(projects.id, input.projectId))
      .returning({ id: projects.id, slug: projects.slug });
    return updated ?? null;
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
