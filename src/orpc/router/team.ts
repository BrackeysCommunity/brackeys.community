import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { and, asc, count, countDistinct, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import {
  collabPosts,
  collabRoles,
  collabPostRoles,
  developerProfiles,
  itchJams,
  profileProjects,
  profileUrlStubs,
  projectJamLinks,
  projectTeams,
  projects,
  skills,
  teamInvites,
  teamMembers,
  teamProjects,
  teams,
  userSkills,
} from "@/db/schema";
import { EVENTS } from "@/lib/analytics-events";
import { jamUrl } from "@/lib/jam-links";
import { notify } from "@/lib/notifications";
import { captureServerEvent } from "@/lib/posthog-server";
import { checkProfanity } from "@/lib/profanity";
import {
  getProfileProjectImageUrl,
  removeProfileProjectImageFromStorage,
  resolveTeamAvatarUrl,
  resolveTeamBannerUrl,
} from "@/lib/profile-project-image-storage";
import { isTeamProjectImageKey, uploadedImageUrlSchema } from "@/lib/profile-project-images";
import { ensureProfilePlacementProject, insertProject } from "@/lib/projects";
import { checkRateLimit } from "@/lib/rate-limit";
// The house home for LIKE escaping — this file carried its own copy, which
// (unlike the shared one) left a backslash in the search term unescaped.
import { escapeLike } from "@/lib/sql-like";
import { touchTeamActivity } from "@/lib/team-activity";
import { blockPairExists } from "@/lib/user-blocks";
import { requireAuth, requireGuildMember } from "@/orpc/middleware/auth";

/** Postgres `unique_violation`. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}

// Same shape the profile stub enforces, so the two handle namespaces
// follow one grammar.
const SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/;

/** Handles that would shadow real or future routes under /teams. */
const RESERVED_SLUGS = new Set(["new", "index", "all", "mine", "settings", "archive"]);

/**
 * Derives a claimable slug from a team name: kebab-case the name, then
 * suffix -2, -3… past collisions. Raced claims fall through to the
 * unique constraint, which callers map back through `insertTeamRow`.
 */
export function slugifyTeamName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/^-+|-+$/g, "");
  // Too short/degenerate names ("!!", "无") fall back to a generic stem.
  return base.length >= 3 ? base : `team${base ? `-${base}` : ""}`;
}

async function claimSlug(name: string): Promise<string> {
  const base = slugifyTeamName(name);
  const taken = new Set(
    (
      await db
        .select({ slug: teams.slug })
        .from(teams)
        .where(sql`${teams.slug} LIKE ${base + "%"}`)
    ).map((r) => r.slug),
  );
  if (!taken.has(base) && !RESERVED_SLUGS.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 32 - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ── Membership helpers ───────────────────────────────────────────────────────

async function getTeamRow(teamId: string) {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) {
    throw new ORPCError("NOT_FOUND", { message: "Team not found." });
  }
  return team;
}

async function getMembership(teamId: string, userId: string) {
  const [membership] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  return membership ?? null;
}

async function requireMembership(teamId: string, userId: string) {
  const membership = await getMembership(teamId, userId);
  if (!membership) {
    throw new ORPCError("FORBIDDEN", { message: "You are not a member of this team." });
  }
  return membership;
}

async function requireOwnership(teamId: string, userId: string) {
  const membership = await requireMembership(teamId, userId);
  if (membership.role !== "owner") {
    throw new ORPCError("FORBIDDEN", { message: "Only the team owner can do that." });
  }
  return membership;
}

// ── Team CRUD ────────────────────────────────────────────────────────────────

const teamContentShape = {
  name: z.string().trim().min(2).max(100),
  tagline: z.string().trim().max(200).optional(),
  bio: z.string().max(5000).optional(),
  websiteUrl: z.url().max(500).optional().or(z.literal("")),
  itchUrl: z.url().max(500).optional().or(z.literal("")),
  recruiting: z.boolean().optional(),
};

function checkTeamProfanity(input: { name?: string; tagline?: string; bio?: string }) {
  checkProfanity(input.name, "Team name");
  checkProfanity(input.tagline, "Tagline");
  checkProfanity(input.bio, "Bio");
}

/**
 * Creating a team is deliberately cheap — a name is enough — because the
 * wizard's quick-create path must not turn posting into a detour. The
 * creator becomes the sole `owner` member.
 */
export const createTeam = os
  .use(requireGuildMember)
  .input(z.object(teamContentShape))
  .handler(async ({ input, context }) => {
    checkTeamProfanity(input);

    // A slug race between the pre-check and the insert lands on the
    // unique constraint; retry once with a fresh suffix before giving up.
    let team;
    for (let attempt = 0; attempt < 2 && !team; attempt++) {
      const slug = await claimSlug(input.name);
      [team] = await db
        .insert(teams)
        .values({
          slug,
          name: input.name,
          tagline: input.tagline || null,
          bio: input.bio || null,
          websiteUrl: input.websiteUrl || null,
          itchUrl: input.itchUrl || null,
          recruiting: input.recruiting ?? false,
          createdBy: context.user.id,
        })
        .returning()
        .catch((err: unknown) => {
          if (isUniqueViolation(err) && attempt === 0) return [undefined];
          throw err;
        });
    }
    if (!team) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Could not claim a team handle." });
    }

    await db.insert(teamMembers).values({
      teamId: team.id,
      userId: context.user.id,
      role: "owner",
    });

    captureServerEvent(EVENTS.teamCreated, context.user.id, { team_id: team.id });

    return team;
  });

export const updateTeam = os
  .use(requireAuth)
  .input(
    z.object({
      teamId: z.string(),
      ...teamContentShape,
      name: teamContentShape.name.optional(),
      tagline: z.string().trim().max(200).optional().nullable(),
      bio: z.string().max(5000).optional().nullable(),
      websiteUrl: z.url().max(500).optional().nullable().or(z.literal("")),
      itchUrl: z.url().max(500).optional().nullable().or(z.literal("")),
    }),
  )
  .handler(async ({ input, context }) => {
    await getTeamRow(input.teamId);
    await requireOwnership(input.teamId, context.user.id);
    checkTeamProfanity({
      name: input.name,
      tagline: input.tagline ?? undefined,
      bio: input.bio ?? undefined,
    });

    const { teamId: _teamId, ...fields } = input;
    const [updated] = await db
      .update(teams)
      .set({
        ...(fields.name !== undefined ? { name: fields.name } : {}),
        ...(fields.tagline !== undefined ? { tagline: fields.tagline || null } : {}),
        ...(fields.bio !== undefined ? { bio: fields.bio || null } : {}),
        ...(fields.websiteUrl !== undefined ? { websiteUrl: fields.websiteUrl || null } : {}),
        ...(fields.itchUrl !== undefined ? { itchUrl: fields.itchUrl || null } : {}),
        ...(fields.recruiting !== undefined ? { recruiting: fields.recruiting } : {}),
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(teams.id, input.teamId))
      .returning();

    return updated;
  });

export const setTeamSlug = os
  .use(requireAuth)
  .input(z.object({ teamId: z.string(), slug: z.string().min(3).max(32) }))
  .handler(async ({ input, context }) => {
    await getTeamRow(input.teamId);
    await requireOwnership(input.teamId, context.user.id);

    const slug = input.slug.toLowerCase().trim();
    if (!SLUG_REGEX.test(slug)) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Handle must be 3-32 characters, start and end with a letter or number, and contain only lowercase letters, numbers, hyphens, and underscores.",
      });
    }
    if (RESERVED_SLUGS.has(slug)) {
      throw new ORPCError("BAD_REQUEST", { message: "That handle is reserved." });
    }
    checkProfanity(slug, "Handle");

    const [existing] = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
    if (existing && existing.id !== input.teamId) {
      throw new ORPCError("CONFLICT", { message: "This handle is already taken." });
    }

    const [updated] = await db
      .update(teams)
      .set({ slug, updatedAt: new Date() })
      .where(eq(teams.id, input.teamId))
      .returning();
    return updated;
  });

/**
 * Archive is the promoted exit — the page stays up read-only, the team
 * drops out of the wizard picker, and open posts close (a recruiting
 * post for an archived team advertises a dead end). Restore reopens
 * nothing: closed posts stay closed until reopened by hand.
 */
export const setTeamArchived = os
  .use(requireAuth)
  .input(z.object({ teamId: z.string(), archived: z.boolean() }))
  .handler(async ({ input, context }) => {
    await getTeamRow(input.teamId);
    await requireOwnership(input.teamId, context.user.id);

    const [updated] = await db
      .update(teams)
      .set({
        status: input.archived ? "archived" : "active",
        // Restoring is activity, and it disarms a pending auto-archive
        // warning — otherwise the sweep could re-archive a team the owner
        // just deliberately brought back.
        ...(input.archived ? {} : { archiveWarnedAt: null, lastActivityAt: new Date() }),
        updatedAt: new Date(),
      })
      .where(eq(teams.id, input.teamId))
      .returning();

    if (input.archived) {
      await db
        .update(collabPosts)
        .set({ status: "party_full", updatedAt: new Date() })
        .where(and(eq(collabPosts.teamId, input.teamId), eq(collabPosts.status, "recruiting")));
    }

    return updated;
  });

/** Members/invites/projects cascade; posts degrade to the legacy
 *  unlinked-team state via ON DELETE SET NULL. */
export const deleteTeam = os
  .use(requireAuth)
  .input(z.object({ teamId: z.string() }))
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);
    await requireOwnership(input.teamId, context.user.id);
    // Showcase covers in the team's namespace go down with the team; the
    // rows cascade, so collect keys first. Imported rows keep user-scoped
    // keys and are filtered out by the namespace check.
    const showcaseImages = await db
      .select({ imageKey: teamProjects.imageKey })
      .from(teamProjects)
      .where(eq(teamProjects.teamId, input.teamId));
    const showcaseKeys = showcaseImages
      .map(({ imageKey }) => imageKey)
      .filter((key): key is string => !!key && isTeamProjectImageKey(input.teamId, key));
    await db.delete(teams).where(eq(teams.id, input.teamId));
    // Replaced images are cleaned at replace time, so the current keys are
    // the only objects this team owns. Best-effort — an orphaned object is
    // a storage leak, not a correctness problem.
    for (const key of [team.avatarKey, team.bannerKey, ...showcaseKeys]) {
      if (key) {
        await removeProfileProjectImageFromStorage(key).catch((error: unknown) => {
          console.error("Failed to delete team image on team delete", { key, error });
        });
      }
    }
    return { success: true };
  });

// ── Reads ────────────────────────────────────────────────────────────────────

async function serializeTeamProject<T extends { imageKey: string | null; imageUrl: string | null }>(
  project: T,
) {
  const presigned = await getProfileProjectImageUrl(project.imageKey);
  return { ...project, imageUrl: presigned ?? project.imageUrl };
}

/** Direct id first, then slug — same resolution order as getProfile. */
async function resolveTeam(idOrSlug: string) {
  const [byId] = await db.select().from(teams).where(eq(teams.id, idOrSlug)).limit(1);
  if (byId) return byId;

  const [bySlug] = await db
    .select()
    .from(teams)
    .where(eq(teams.slug, idOrSlug.toLowerCase()))
    .limit(1);
  return bySlug ?? null;
}

/**
 * A team as everyone sees it. The viewer's own standing — their role, a
 * pending invite, the owner's invite queue — lives in
 * `getTeamViewerState`, which is what lets this response be identical for
 * every caller and cached at the edge.
 */
export const getTeam = os
  .route({ method: "GET" })
  .input(z.object({ teamId: z.string() }))
  .handler(async ({ input }) => {
    const team = await resolveTeam(input.teamId);
    if (!team) return null;

    const [memberRows, projectRows, openPostRows] = await Promise.all([
      db
        .select({
          id: teamMembers.id,
          userId: teamMembers.userId,
          role: teamMembers.role,
          title: teamMembers.title,
          sortOrder: teamMembers.sortOrder,
          joinedAt: teamMembers.joinedAt,
          username: developerProfiles.discordUsername,
          avatarUrl: developerProfiles.avatarUrl,
          tagline: developerProfiles.tagline,
          urlStub: profileUrlStubs.stub,
        })
        .from(teamMembers)
        .innerJoin(developerProfiles, eq(teamMembers.userId, developerProfiles.id))
        .leftJoin(profileUrlStubs, eq(profileUrlStubs.profileId, teamMembers.userId))
        .where(eq(teamMembers.teamId, team.id))
        .orderBy(asc(teamMembers.sortOrder), asc(teamMembers.joinedAt)),
      db
        .select({
          project: teamProjects,
          itchJamTitle: itchJams.title,
          itchJamSlug: itchJams.slug,
          // The canonical project this showcase row is a placement of, when
          // it has one — what makes a showcase tile a link to the project's
          // own page rather than an exit to itch, and (since plan step 6)
          // where the tile's identity comes from: `importMemberProject` no
          // longer copies surface fields, so the canonical row is the only
          // fresh source. Both joins are on unique keys, so neither can
          // multiply the placement rows.
          canonicalSlug: projects.slug,
          canonicalTitle: projects.title,
          canonicalDescription: projects.description,
          canonicalUrl: projects.url,
          canonicalImageUrl: projects.imageUrl,
          canonicalImageKey: projects.imageKey,
          canonicalType: projects.type,
        })
        .from(teamProjects)
        .leftJoin(itchJams, eq(teamProjects.jamId, itchJams.jamId))
        .leftJoin(projects, eq(teamProjects.projectId, projects.id))
        .where(eq(teamProjects.teamId, team.id))
        .orderBy(
          desc(teamProjects.pinned),
          asc(teamProjects.sortOrder),
          desc(teamProjects.createdAt),
        ),
      db
        .select({
          id: collabPosts.id,
          title: collabPosts.title,
          type: collabPosts.type,
          status: collabPosts.status,
          createdAt: collabPosts.createdAt,
        })
        .from(collabPosts)
        .where(and(eq(collabPosts.teamId, team.id), eq(collabPosts.status, "recruiting")))
        .orderBy(desc(collabPosts.createdAt)),
    ]);

    // The team's stack is its members' skills, counted — derived at read
    // time so it can never drift from the roster.
    const memberIds = memberRows.map((m) => m.userId);
    const skillRows =
      memberIds.length > 0
        ? await db
            .select({
              id: skills.id,
              name: skills.name,
              category: skills.category,
              memberCount: count(),
            })
            .from(userSkills)
            .innerJoin(skills, eq(userSkills.skillId, skills.id))
            .where(inArray(userSkills.userId, memberIds))
            .groupBy(skills.id, skills.name, skills.category)
            .orderBy(desc(count()), asc(skills.name))
        : [];

    // Role chips for open posts, one query for the page.
    const postIds = openPostRows.map((p) => p.id);
    const roleRows =
      postIds.length > 0
        ? await db
            .select({ postId: collabPostRoles.postId, id: collabRoles.id, name: collabRoles.name })
            .from(collabPostRoles)
            .innerJoin(collabRoles, eq(collabPostRoles.roleId, collabRoles.id))
            .where(inArray(collabPostRoles.postId, postIds))
        : [];
    const rolesByPost = new Map<number, { id: number; name: string }[]>();
    for (const row of roleRows) {
      const list = rolesByPost.get(row.postId) ?? [];
      list.push({ id: row.id, name: row.name });
      rolesByPost.set(row.postId, list);
    }

    // Rows that carry no jam facts of their own (post-step-6 placements)
    // coalesce them from the canonical row's `project_jam_links` — fetched
    // separately so a project with several links can't multiply the tiles.
    const linkProjectIds = [
      ...new Set(
        projectRows
          .filter(
            (row) =>
              row.project.projectId != null &&
              row.project.jamName == null &&
              row.project.jamId == null,
          )
          .map((row) => row.project.projectId as string),
      ),
    ];
    const jamLinkRows =
      linkProjectIds.length > 0
        ? await db
            .select({
              projectId: projectJamLinks.projectId,
              jamName: projectJamLinks.jamName,
              jamUrl: projectJamLinks.jamUrl,
              submissionUrl: projectJamLinks.submissionUrl,
              result: projectJamLinks.result,
              participatedAt: projectJamLinks.participatedAt,
            })
            .from(projectJamLinks)
            .where(inArray(projectJamLinks.projectId, linkProjectIds))
        : [];
    const jamLinksByProject = new Map<string, typeof jamLinkRows>();
    for (const link of jamLinkRows) {
      const list = jamLinksByProject.get(link.projectId) ?? [];
      list.push(link);
      jamLinksByProject.set(link.projectId, list);
    }

    return {
      ...team,
      avatarUrl: await resolveTeamAvatarUrl(team),
      bannerUrl: await resolveTeamBannerUrl(team),
      members: memberRows,
      skills: skillRows,
      projects: await Promise.all(
        projectRows.map(
          ({
            project,
            itchJamTitle,
            itchJamSlug,
            canonicalSlug,
            canonicalTitle,
            canonicalDescription,
            canonicalUrl,
            canonicalImageUrl,
            canonicalImageKey,
            canonicalType,
          }) => {
            const links = project.projectId ? jamLinksByProject.get(project.projectId) : undefined;
            const jamLink =
              links?.find(
                (link) => link.participatedAt?.getTime() === project.participatedAt?.getTime(),
              ) ??
              links?.[0] ??
              null;
            // A placement's own upload stays its override (surface beats
            // canonical for covers, per D2); everything identity-shaped
            // prefers the canonical row, which is the only fresh source for
            // a placement-only import.
            const hasPlacementImage = project.imageKey != null || project.imageUrl != null;
            return serializeTeamProject({
              ...project,
              title: canonicalTitle ?? project.title,
              description: canonicalDescription ?? project.description,
              url: canonicalUrl ?? project.url,
              imageKey: hasPlacementImage ? project.imageKey : canonicalImageKey,
              imageUrl: hasPlacementImage ? project.imageUrl : canonicalImageUrl,
              projectSlug: canonicalSlug,
              canonicalType,
              jamName: project.jamName ?? itchJamTitle ?? jamLink?.jamName ?? null,
              jamUrl:
                project.jamUrl ??
                (itchJamSlug ? jamUrl(itchJamSlug) : null) ??
                jamLink?.jamUrl ??
                null,
              submissionUrl: project.submissionUrl ?? jamLink?.submissionUrl ?? null,
              result: project.result ?? jamLink?.result ?? null,
              // A coalesced row's date should be when the jam ran, not when
              // the placement landed in our DB.
              participatedAt: project.participatedAt ?? jamLink?.participatedAt ?? null,
              // The scraped slug, so the jam log can link to the jam's page
              // here rather than only off to itch.
              jamSlug: itchJamSlug,
            });
          },
        ),
      ),
      openPosts: openPostRows.map((p) => ({ ...p, roles: rolesByPost.get(p.id) ?? [] })),
    };
  });

/**
 * Where the viewer stands with a team: their role on the roster, a pending
 * invite waiting for them, and — for the owner — the invites still
 * outstanding. The companion to `getTeam`'s anonymous core.
 *
 * The owner gate stays here rather than in the caller: `pendingInvites`
 * names people who have been invited but haven't answered, which is the
 * owner's business alone.
 */
export const getTeamViewerState = os
  .use(requireAuth)
  .input(z.object({ teamId: z.string() }))
  .handler(async ({ input, context }) => {
    const team = await resolveTeam(input.teamId);
    if (!team) return null;

    const viewerId = context.user.id;
    const [membership] = await db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, viewerId)))
      .limit(1);

    const isOwner = membership?.role === "owner";

    // A signed-in non-member sees their own pending invite so the page can
    // offer the accept/decline bar; the owner sees all of them.
    const [viewerInvite, pendingInvites] = await Promise.all([
      !membership
        ? db
            .select()
            .from(teamInvites)
            .where(
              and(
                eq(teamInvites.teamId, team.id),
                eq(teamInvites.inviteeId, viewerId),
                eq(teamInvites.status, "pending"),
              ),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      isOwner
        ? db
            .select({
              id: teamInvites.id,
              inviteeId: teamInvites.inviteeId,
              status: teamInvites.status,
              createdAt: teamInvites.createdAt,
              inviteeUsername: developerProfiles.discordUsername,
              inviteeAvatar: developerProfiles.avatarUrl,
            })
            .from(teamInvites)
            .innerJoin(developerProfiles, eq(teamInvites.inviteeId, developerProfiles.id))
            .where(and(eq(teamInvites.teamId, team.id), eq(teamInvites.status, "pending")))
            .orderBy(desc(teamInvites.createdAt))
        : Promise.resolve([]),
    ]);

    return {
      viewerRole: membership?.role ?? null,
      isOwner,
      viewerInvite,
      pendingInvites,
    };
  });

/** Faces and stack chips a directory card can show before it gets busy. */
const CARD_AVATARS = 5;
const CARD_SKILLS = 3;

/**
 * Everything a directory card shows beyond the team row itself: roster
 * faces, ship count, open posts, and the stack derived from the roster.
 * Four queries batched on the page's ids — the same no-N+1 shape
 * `listPosts` uses — shared so the viewer's own teams and the public
 * listing return one card shape rather than two near-identical ones.
 */
async function withTeamCardExtras<
  T extends { id: string; avatarUrl: string | null; avatarKey: string | null },
>(rows: T[]) {
  const teamIds = rows.map((r) => r.id);
  if (teamIds.length === 0) return [];

  const [memberRows, projectCounts, openPostCounts, skillRows] = await Promise.all([
    // Rosters come back whole rather than as a count plus a capped
    // faces query — jam crews are small, and one pass answers both.
    db
      .select({
        teamId: teamMembers.teamId,
        userId: teamMembers.userId,
        role: teamMembers.role,
        username: developerProfiles.discordUsername,
        avatarUrl: developerProfiles.avatarUrl,
      })
      .from(teamMembers)
      .innerJoin(developerProfiles, eq(teamMembers.userId, developerProfiles.id))
      .where(inArray(teamMembers.teamId, teamIds))
      .orderBy(asc(teamMembers.sortOrder), asc(teamMembers.joinedAt)),
    db
      .select({ teamId: teamProjects.teamId, count: count() })
      .from(teamProjects)
      .where(inArray(teamProjects.teamId, teamIds))
      .groupBy(teamProjects.teamId),
    db
      .select({ teamId: collabPosts.teamId, count: count() })
      .from(collabPosts)
      .where(and(inArray(collabPosts.teamId, teamIds), eq(collabPosts.status, "recruiting")))
      .groupBy(collabPosts.teamId),
    db
      .select({
        teamId: teamMembers.teamId,
        id: skills.id,
        name: skills.name,
        memberCount: count(),
      })
      .from(teamMembers)
      .innerJoin(userSkills, eq(userSkills.userId, teamMembers.userId))
      .innerJoin(skills, eq(userSkills.skillId, skills.id))
      .where(inArray(teamMembers.teamId, teamIds))
      .groupBy(teamMembers.teamId, skills.id, skills.name)
      .orderBy(desc(count()), asc(skills.name)),
  ]);

  const membersByTeam = new Map<string, typeof memberRows>();
  for (const row of memberRows) {
    const list = membersByTeam.get(row.teamId) ?? [];
    list.push(row);
    membersByTeam.set(row.teamId, list);
  }
  const skillsByTeam = new Map<string, { id: number; name: string }[]>();
  for (const row of skillRows) {
    const list = skillsByTeam.get(row.teamId) ?? [];
    if (list.length < CARD_SKILLS) list.push({ id: row.id, name: row.name });
    skillsByTeam.set(row.teamId, list);
  }
  const projectCountByTeam = new Map(projectCounts.map((r) => [r.teamId, r.count]));
  const openPostCountByTeam = new Map(openPostCounts.map((r) => [r.teamId!, r.count]));

  return Promise.all(
    rows.map(async ({ avatarKey, ...row }) => {
      const members = membersByTeam.get(row.id) ?? [];
      return {
        ...row,
        avatarUrl: await resolveTeamAvatarUrl({ avatarKey, avatarUrl: row.avatarUrl }),
        memberCount: members.length,
        members: members.slice(0, CARD_AVATARS).map(({ teamId: _teamId, ...m }) => m),
        projectCount: projectCountByTeam.get(row.id) ?? 0,
        openPostCount: openPostCountByTeam.get(row.id) ?? 0,
        skills: skillsByTeam.get(row.id) ?? [],
      };
    }),
  );
}

/**
 * Active teams the caller belongs to — the wizard picker's source, and
 * the `/teams` shelf's. Returns the full card payload so the shelf can
 * render the same tile as the directory below it; the picker just reads
 * the identity fields off the front of it.
 */
export const listMyTeams = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const rows = await db
      .select({
        id: teams.id,
        slug: teams.slug,
        name: teams.name,
        tagline: teams.tagline,
        avatarUrl: teams.avatarUrl,
        avatarKey: teams.avatarKey,
        recruiting: teams.recruiting,
        status: teams.status,
        lastActivityAt: teams.lastActivityAt,
        // The sweep's archive warning currently only reaches a notification;
        // the home dashboard's team cards surface it as a badge.
        archiveWarnedAt: teams.archiveWarnedAt,
        role: teamMembers.role,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(and(eq(teamMembers.userId, context.user.id), eq(teams.status, "active")))
      .orderBy(asc(teams.name));
    return withTeamCardExtras(rows);
  });

/**
 * The public directory behind `/teams`. Recruiting teams lead by
 * default — an open crew is what a visitor came for — with most
 * recently active as the tiebreak.
 *
 * Card extras are four batched queries keyed on the page's ids, the
 * same no-N+1 shape `listPosts` uses for its jam/team/skill chips.
 */
const teamFacetSchema = {
  search: z.string().trim().max(100).optional(),
  /** Derived from the roster's skills — a team has no stack of its own. */
  skillIds: z.array(z.number().int().positive()).optional(),
  recruiting: z.boolean().optional(),
  hasShipped: z.boolean().optional(),
};

type TeamFilterInput = {
  [K in keyof typeof teamFacetSchema]?: z.infer<(typeof teamFacetSchema)[K]>;
};

/**
 * Shared WHERE builder for the directory listing and its facet counts, so
 * a number on the stack picker can never disagree with the list it
 * labels. Pass `{ ...input, skillIds: undefined }` to count across stacks.
 */
function buildTeamFilter(input: TeamFilterInput) {
  const conditions = [eq(teams.status, "active")];
  if (input.search) {
    const pattern = `%${escapeLike(input.search)}%`;
    conditions.push(or(ilike(teams.name, pattern), ilike(teams.tagline, pattern))!);
  }
  if (input.recruiting) conditions.push(eq(teams.recruiting, true));
  if (input.hasShipped) {
    conditions.push(
      sql`exists (select 1 from ${teamProjects} where ${teamProjects.teamId} = ${teams.id})`,
    );
  }
  if (input.skillIds && input.skillIds.length > 0) {
    conditions.push(
      sql`exists (
        select 1 from ${teamMembers}
        join ${userSkills} on ${userSkills.userId} = ${teamMembers.userId}
        where ${teamMembers.teamId} = ${teams.id}
          and ${inArray(userSkills.skillId, input.skillIds)}
      )`,
    );
  }
  return and(...conditions);
}

/**
 * Per-skill team counts for the stack picker — see `countPostsBySkill`.
 * A team is counted once per distinct skill on its roster, however many
 * members hold it: the picker's question is "how many teams would this
 * turn up", not "how many people there know it".
 */
export const countTeamsBySkill = os
  .route({ method: "GET" })
  .input(z.object(teamFacetSchema))
  .handler(async ({ input }) => {
    const rows = await db
      .select({ skillId: userSkills.skillId, count: countDistinct(teams.id) })
      .from(userSkills)
      .innerJoin(teamMembers, eq(teamMembers.userId, userSkills.userId))
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(buildTeamFilter({ ...input, skillIds: undefined }))
      .groupBy(userSkills.skillId);

    return Object.fromEntries(rows.map((row) => [row.skillId, Number(row.count)]));
  });

export const listTeams = os
  .route({ method: "GET" })
  .input(
    z.object({
      ...teamFacetSchema,
      sort: z.enum(["active", "shipped", "newest"]).default("active"),
      limit: z.number().min(1).max(50).default(24),
      offset: z.number().min(0).default(0),
    }),
  )
  .handler(async ({ input }) => {
    const where = buildTeamFilter(input);

    // Ship date falls back to when the row landed: `released_at` is
    // owner-entered and mostly null on older showcase entries, and a
    // "recently shipped" sort that hides them isn't the honest answer.
    const lastShipped = sql`(
      select max(coalesce(${teamProjects.releasedAt}, ${teamProjects.createdAt}))
      from ${teamProjects} where ${teamProjects.teamId} = ${teams.id}
    )`;
    const orderBy =
      input.sort === "newest"
        ? [desc(teams.createdAt)]
        : input.sort === "shipped"
          ? [sql`${lastShipped} desc nulls last`, desc(teams.lastActivityAt)]
          : [desc(teams.recruiting), desc(teams.lastActivityAt)];

    const [rows, [totals]] = await Promise.all([
      db
        .select({
          id: teams.id,
          slug: teams.slug,
          name: teams.name,
          tagline: teams.tagline,
          avatarUrl: teams.avatarUrl,
          avatarKey: teams.avatarKey,
          recruiting: teams.recruiting,
          createdAt: teams.createdAt,
          lastActivityAt: teams.lastActivityAt,
        })
        .from(teams)
        .where(where)
        .orderBy(...orderBy)
        .limit(input.limit)
        .offset(input.offset),
      db.select({ count: count() }).from(teams).where(where),
    ]);

    return { teams: await withTeamCardExtras(rows), total: totals?.count ?? 0 };
  });

/**
 * Two counts for the home page's teams tile. Deliberately not `listTeams`
 * with `limit: 1` — that pays for the four card-extras round trips to read
 * a number the caller already gets here in one.
 */
export const getTeamStats = os.route({ method: "GET" }).handler(async () => {
  const [row] = await db
    .select({
      active: count(),
      recruiting: sql<number>`count(*) filter (where ${teams.recruiting})`.mapWith(Number),
    })
    .from(teams)
    .where(eq(teams.status, "active"));

  return { active: row?.active ?? 0, recruiting: row?.recruiting ?? 0 };
});

/** Active teams a profile belongs to — the profile page's TEAMS strip. */
export const listUserTeams = os
  .route({ method: "GET" })
  .input(z.object({ userId: z.string() }))
  .handler(async ({ input }) => {
    const rows = await db
      .select({
        id: teams.id,
        slug: teams.slug,
        name: teams.name,
        avatarUrl: teams.avatarUrl,
        avatarKey: teams.avatarKey,
        role: teamMembers.role,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(and(eq(teamMembers.userId, input.userId), eq(teams.status, "active")))
      .orderBy(asc(teams.name));
    return Promise.all(
      rows.map(async ({ avatarKey: _avatarKey, ...row }) => ({
        ...row,
        avatarUrl: await resolveTeamAvatarUrl({ avatarKey: _avatarKey, avatarUrl: row.avatarUrl }),
      })),
    );
  });

/**
 * A settled invite stays on the viewer's list this long, so accepting or
 * declining leaves a trace instead of blanking the row that was just acted on.
 */
const RESOLVED_INVITE_DAYS = 30;

/**
 * Every team invite pointed at the viewer: the pending ones they still owe an
 * answer to, plus recently settled ones for context.
 *
 * `getTeamViewerState.viewerInvite` already renders an accept/decline bar —
 * but only for someone who happens to open the team page or follow the
 * notification. An invitee had no surface that simply listed what was waiting
 * on them, which is the gap this closes.
 *
 * Revoked invites are left out on purpose: the team withdrew it, the viewer
 * never had a decision to make, and a REVOKED row on a personal inbox reads as
 * something to act on.
 */
export const listMyInvites = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const rows = await db
      .select({
        id: teamInvites.id,
        status: teamInvites.status,
        message: teamInvites.message,
        createdAt: teamInvites.createdAt,
        respondedAt: teamInvites.respondedAt,
        teamId: teams.id,
        teamSlug: teams.slug,
        teamName: teams.name,
        teamAvatarUrl: teams.avatarUrl,
        teamAvatarKey: teams.avatarKey,
        teamStatus: teams.status,
        inviterId: teamInvites.invitedBy,
        inviterUsername: developerProfiles.discordUsername,
        inviterNickname: developerProfiles.guildNickname,
        inviterAvatar: developerProfiles.avatarUrl,
      })
      .from(teamInvites)
      .innerJoin(teams, eq(teamInvites.teamId, teams.id))
      .leftJoin(developerProfiles, eq(teamInvites.invitedBy, developerProfiles.id))
      .where(
        and(
          eq(teamInvites.inviteeId, context.user.id),
          or(
            eq(teamInvites.status, "pending"),
            and(
              inArray(teamInvites.status, ["accepted", "declined"]),
              // `make_interval` rather than `$1 * interval '1 day'`: a bound
              // parameter multiplied by an interval leaves Postgres with an
              // ambiguous `unknown * interval`, which fails at plan time.
              sql`${teamInvites.respondedAt} > now() - make_interval(days => ${RESOLVED_INVITE_DAYS})`,
            ),
          ),
        ),
      )
      .orderBy(sql`(${teamInvites.status} = 'pending') desc`, desc(teamInvites.createdAt));

    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        status: row.status,
        message: row.message,
        createdAt: row.createdAt,
        respondedAt: row.respondedAt,
        team: {
          id: row.teamId,
          slug: row.teamSlug,
          name: row.teamName,
          status: row.teamStatus,
          avatarUrl: await resolveTeamAvatarUrl({
            avatarKey: row.teamAvatarKey,
            avatarUrl: row.teamAvatarUrl,
          }),
        },
        inviter: {
          id: row.inviterId,
          // The name the rest of the app shows — see `searchProfiles`.
          displayName: row.inviterNickname || row.inviterUsername || "A member",
          avatarUrl: row.inviterAvatar,
        },
      })),
    );
  });

// ── Roster ───────────────────────────────────────────────────────────────────

/**
 * Member lookup for the pickers: the team invite flow, and the project
 * page's credits editor.
 *
 * Distinct from `listAvailableUsers`, which is scoped to the for-hire
 * directory — a team can invite, and a project can credit, any member of the
 * community rather than just the ones advertising availability.
 *
 * Matches **both** names a profile can carry, because searching for the name
 * you can see is the only thing anyone tries: the app renders
 * `guildNickname ?? discordUsername` everywhere, so a nickname-only match was
 * invisible to a username-only search.
 */
export const searchProfiles = os
  .use(requireAuth)
  .input(z.object({ search: z.string().trim().min(2).max(100) }))
  .handler(async ({ input }) => {
    const pattern = `%${escapeLike(input.search)}%`;
    const rows = await db
      .select({
        id: developerProfiles.id,
        username: developerProfiles.discordUsername,
        guildNickname: developerProfiles.guildNickname,
        avatarUrl: developerProfiles.avatarUrl,
      })
      .from(developerProfiles)
      .where(
        or(
          ilike(developerProfiles.guildNickname, pattern),
          ilike(developerProfiles.discordUsername, pattern),
        ),
      )
      .limit(8);

    return rows.map(({ guildNickname, ...row }) => ({
      ...row,
      // The name the rest of the app shows. `username` stays for the invite
      // picker, which renders the handle deliberately.
      displayName: guildNickname || row.username || "Unknown",
    }));
  });

const ALREADY_INVITED = "That person already has a pending invite.";

/**
 * Any active member can invite — jam crews are flat, and the accept →
 * invite handoff comes from post authors who may not be the owner.
 * Removal and role changes stay owner-only.
 */
export const inviteToTeam = os
  .use(requireAuth)
  .input(
    z.object({
      teamId: z.string(),
      inviteeId: z.string(),
      message: z.string().max(1000).optional(),
      sourceResponseId: z.number().int().positive().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);
    if (team.status !== "active") {
      throw new ORPCError("BAD_REQUEST", { message: "This team is archived." });
    }
    await requireMembership(input.teamId, context.user.id);
    if (input.message) checkProfanity(input.message, "Message");

    if (input.inviteeId === context.user.id) {
      throw new ORPCError("BAD_REQUEST", { message: "You are already on this team." });
    }

    const [inviteeProfile] = await db
      .select({ id: developerProfiles.id })
      .from(developerProfiles)
      .where(eq(developerProfiles.id, input.inviteeId))
      .limit(1);
    if (!inviteeProfile) {
      throw new ORPCError("BAD_REQUEST", { message: "That person doesn't have a profile." });
    }

    if (await getMembership(input.teamId, input.inviteeId)) {
      throw new ORPCError("BAD_REQUEST", { message: "That person is already on this team." });
    }

    // Neutral on purpose — never reveal a block or its direction.
    if (await blockPairExists(input.inviteeId, context.user.id)) {
      throw new ORPCError("FORBIDDEN", { message: "You can't invite this person." });
    }

    if (!(await checkRateLimit("team-invite", context.user.id, 50, 86400))) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "You've sent a lot of invites today — try again tomorrow.",
      });
    }

    const [existing] = await db
      .select({ id: teamInvites.id })
      .from(teamInvites)
      .where(
        and(
          eq(teamInvites.teamId, input.teamId),
          eq(teamInvites.inviteeId, input.inviteeId),
          eq(teamInvites.status, "pending"),
        ),
      )
      .limit(1);
    if (existing) {
      throw new ORPCError("BAD_REQUEST", { message: ALREADY_INVITED });
    }

    // Racing duplicates land on the partial unique index; same message.
    const [invite] = await db
      .insert(teamInvites)
      .values({
        teamId: input.teamId,
        inviteeId: input.inviteeId,
        invitedBy: context.user.id,
        sourceResponseId: input.sourceResponseId,
        message: input.message,
      })
      .returning()
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) {
          throw new ORPCError("BAD_REQUEST", { message: ALREADY_INVITED });
        }
        throw err;
      });

    await notify({
      userId: input.inviteeId,
      type: "team_invite_received",
      actorId: context.user.id,
      entityType: "team_invite",
      entityId: String(invite.id),
      data: { teamId: team.id, teamSlug: team.slug, teamName: team.name, inviteId: invite.id },
    });

    await touchTeamActivity(input.teamId);

    captureServerEvent(EVENTS.teamInviteSent, context.user.id, { team_id: input.teamId });

    return invite;
  });

export const respondToInvite = os
  .use(requireAuth)
  .input(z.object({ inviteId: z.number(), accept: z.boolean() }))
  .handler(async ({ input, context }) => {
    const [invite] = await db
      .select()
      .from(teamInvites)
      .where(eq(teamInvites.id, input.inviteId))
      .limit(1);

    if (!invite || invite.inviteeId !== context.user.id) {
      throw new ORPCError("NOT_FOUND", { message: "Invite not found." });
    }
    if (invite.status !== "pending") {
      throw new ORPCError("BAD_REQUEST", { message: "This invite has already been settled." });
    }

    const team = await getTeamRow(invite.teamId);
    if (input.accept && team.status !== "active") {
      throw new ORPCError("BAD_REQUEST", { message: "This team has been archived." });
    }

    const [updated] = await db
      .update(teamInvites)
      .set({ status: input.accept ? "accepted" : "declined", respondedAt: new Date() })
      .where(and(eq(teamInvites.id, input.inviteId), eq(teamInvites.status, "pending")))
      .returning();
    if (!updated) {
      throw new ORPCError("BAD_REQUEST", { message: "This invite has already been settled." });
    }

    if (input.accept) {
      await db
        .insert(teamMembers)
        .values({
          teamId: invite.teamId,
          userId: context.user.id,
          // Carries the collab provenance onto the roster, where it
          // outlives the invite row's `status` churn and becomes the
          // "we worked together" fact both profiles count.
          sourceResponseId: invite.sourceResponseId,
        })
        .onConflictDoNothing();
      await touchTeamActivity(invite.teamId);
    }

    await notify({
      userId: invite.invitedBy,
      type: input.accept ? "team_invite_accepted" : "team_invite_declined",
      actorId: context.user.id,
      entityType: "team",
      entityId: team.id,
      data: { teamId: team.id, teamSlug: team.slug, teamName: team.name, inviteId: invite.id },
    });

    captureServerEvent(EVENTS.teamInviteAnswered, context.user.id, {
      team_id: team.id,
      accepted: input.accept,
    });

    return { ...updated, teamSlug: team.slug };
  });

export const revokeInvite = os
  .use(requireAuth)
  .input(z.object({ inviteId: z.number() }))
  .handler(async ({ input, context }) => {
    const [invite] = await db
      .select()
      .from(teamInvites)
      .where(eq(teamInvites.id, input.inviteId))
      .limit(1);
    if (!invite) {
      throw new ORPCError("NOT_FOUND", { message: "Invite not found." });
    }
    if (invite.status !== "pending") {
      throw new ORPCError("BAD_REQUEST", { message: "This invite has already been settled." });
    }

    // The inviter can take back their own invite; the owner can prune any.
    if (invite.invitedBy !== context.user.id) {
      await requireOwnership(invite.teamId, context.user.id);
    }

    const [updated] = await db
      .update(teamInvites)
      .set({ status: "revoked", respondedAt: new Date() })
      .where(eq(teamInvites.id, input.inviteId))
      .returning();
    return updated;
  });

export const removeMember = os
  .use(requireAuth)
  .input(z.object({ teamId: z.string(), userId: z.string() }))
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);
    await requireOwnership(input.teamId, context.user.id);

    if (input.userId === context.user.id) {
      throw new ORPCError("BAD_REQUEST", { message: "Use leave team instead." });
    }

    const [deleted] = await db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, input.teamId), eq(teamMembers.userId, input.userId)))
      .returning();
    if (!deleted) {
      throw new ORPCError("NOT_FOUND", { message: "That person is not on this team." });
    }

    await notify({
      userId: input.userId,
      type: "team_member_removed",
      actorId: context.user.id,
      entityType: "team",
      entityId: team.id,
      data: { teamId: team.id, teamSlug: team.slug, teamName: team.name },
    });

    await touchTeamActivity(input.teamId);

    return { success: true };
  });

/**
 * The owner can only leave a populated team by transferring first; the
 * last member out archives the team so its page survives as history
 * rather than 404ing every link.
 */
export const leaveTeam = os
  .use(requireAuth)
  .input(z.object({ teamId: z.string() }))
  .handler(async ({ input, context }) => {
    await getTeamRow(input.teamId);
    const membership = await requireMembership(input.teamId, context.user.id);

    const [{ memberCount }] = await db
      .select({ memberCount: count() })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, input.teamId));

    if (membership.role === "owner" && memberCount > 1) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Transfer ownership before leaving the team.",
      });
    }

    await db.delete(teamMembers).where(eq(teamMembers.id, membership.id));
    await touchTeamActivity(input.teamId);

    if (memberCount === 1) {
      await db
        .update(teams)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(teams.id, input.teamId));
      await db
        .update(collabPosts)
        .set({ status: "party_full", updatedAt: new Date() })
        .where(and(eq(collabPosts.teamId, input.teamId), eq(collabPosts.status, "recruiting")));
    }

    return { success: true };
  });

export const transferOwnership = os
  .use(requireAuth)
  .input(z.object({ teamId: z.string(), userId: z.string() }))
  .handler(async ({ input, context }) => {
    await getTeamRow(input.teamId);
    const ownerMembership = await requireOwnership(input.teamId, context.user.id);

    const target = await getMembership(input.teamId, input.userId);
    if (!target) {
      throw new ORPCError("BAD_REQUEST", { message: "That person is not on this team." });
    }
    if (target.role === "owner") {
      throw new ORPCError("BAD_REQUEST", { message: "That person already owns this team." });
    }

    await db.update(teamMembers).set({ role: "owner" }).where(eq(teamMembers.id, target.id));
    await db
      .update(teamMembers)
      .set({ role: "member" })
      .where(eq(teamMembers.id, ownerMembership.id));

    return { success: true };
  });

export const updateMemberTitle = os
  .use(requireAuth)
  .input(z.object({ teamId: z.string(), title: z.string().trim().max(100).nullable() }))
  .handler(async ({ input, context }) => {
    await getTeamRow(input.teamId);
    const membership = await requireMembership(input.teamId, context.user.id);
    if (input.title) checkProfanity(input.title, "Title");

    const [updated] = await db
      .update(teamMembers)
      .set({ title: input.title || null })
      .where(eq(teamMembers.id, membership.id))
      .returning();
    return updated;
  });

// ── Showcase ─────────────────────────────────────────────────────────────────

const optionalUrlSchema = z.url().optional().or(z.literal(""));

const teamProjectShape = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  url: optionalUrlSchema,
  image: z
    .object({
      key: z.string().min(1),
      url: uploadedImageUrlSchema,
      filename: z.string().min(1),
      mimeType: z.string().min(1),
      sizeBytes: z.number().int().positive(),
    })
    .optional(),
  pinned: z.boolean().optional(),
  jamName: z.string().max(200).optional(),
  jamUrl: optionalUrlSchema,
  submissionUrl: optionalUrlSchema,
  result: z.string().max(200).optional(),
  participatedAt: z.string().optional(),
};

/** Members add to the showcase; the owner curates (edit/remove all). */
export const addTeamProject = os
  .use(requireAuth)
  .input(z.object({ teamId: z.string(), ...teamProjectShape }))
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);
    if (team.status !== "active") {
      throw new ORPCError("BAD_REQUEST", { message: "This team is archived." });
    }
    await requireMembership(input.teamId, context.user.id);
    checkProfanity(input.title, "Title");
    if (input.description) checkProfanity(input.description, "Description");
    // Team-scoped namespace (minted by `/api/team/avatar` kind=project), so
    // the showcase image survives the uploader's account and can be swept
    // with the row — never a user-scoped key.
    if (input.image && !isTeamProjectImageKey(input.teamId, input.image.key)) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Uploaded image does not belong to this team.",
      });
    }

    const participatedAt = input.participatedAt ? new Date(input.participatedAt) : null;

    // Canonical row first, so the placement is born linked (same order and
    // same reasoning as `addProject`). The team's *claim* is a separate,
    // credit-level fact: `project_teams` survives the team later
    // un-showcasing the work, which is why it isn't derived from the
    // placement.
    const projectId = await insertProject({
      title: input.title,
      description: input.description,
      url: input.url || null,
      releasedAt: participatedAt,
      createdBy: context.user.id,
      source: "manual",
    });
    // The claim goes to the *team*, not to whoever typed the row in: a member
    // curating the showcase didn't necessarily make the thing, and a credit
    // is a claim about authorship. `createdBy` plus team membership already
    // put them in the editor set (§1.3), so nothing is lost by not asserting
    // it. Personal credits are explicit, via the credits editor.
    await db.insert(projectTeams).values({ projectId, teamId: input.teamId }).onConflictDoNothing();
    if (input.jamName) {
      // Free-text jam record: a manual row has no `source_game_id`, so the
      // entries join can't derive the appearance.
      await db.insert(projectJamLinks).values({
        projectId,
        jamName: input.jamName,
        jamUrl: input.jamUrl || null,
        submissionUrl: input.submissionUrl || null,
        result: input.result,
        participatedAt,
      });
    }

    // The placement stays surface-only (plan step 6): the jam facts just
    // landed on `project_jam_links`, so the legacy free-text columns stay
    // null on new rows and the reads coalesce them back in for old ones.
    const [project] = await db
      .insert(teamProjects)
      .values({
        teamId: input.teamId,
        projectId,
        title: input.title,
        description: input.description,
        url: input.url || null,
        ...(input.image
          ? {
              imageKey: input.image.key,
              imageFilename: input.image.filename,
              imageMimeType: input.image.mimeType,
              imageSizeBytes: input.image.sizeBytes,
            }
          : {}),
        pinned: input.pinned ?? false,
        submissionUrl: input.submissionUrl || null,
        participatedAt,
        addedBy: context.user.id,
        source: "manual",
      })
      .returning();

    await touchTeamActivity(input.teamId);

    return serializeTeamProject(project);
  });

/**
 * Copies one of the caller's own profile projects onto the team's
 * showcase — the common "our jam game is already on my profile" case.
 * A copy, not a link: the team's showcase must survive the member (or
 * their copy) leaving.
 *
 * Placement-only since plan step 6: both placements point at the same
 * canonical project and the showcase reads identity (title, description,
 * url, cover) from it, so nothing here can drift. What the copy keeps is
 * surface and provenance — curation order, the source pointer, and the
 * jam FK the team jam log dates itself by. `title` snapshots too, but only
 * because the column is NOT NULL; the reads prefer the canonical one.
 */
export const importMemberProject = os
  .use(requireAuth)
  .input(z.object({ teamId: z.string(), projectId: z.string() }))
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);
    if (team.status !== "active") {
      throw new ORPCError("BAD_REQUEST", { message: "This team is archived." });
    }
    await requireMembership(input.teamId, context.user.id);

    const [source] = await db
      .select()
      .from(profileProjects)
      .where(
        and(
          eq(profileProjects.id, input.projectId),
          eq(profileProjects.profileId, context.user.id),
        ),
      )
      .limit(1);
    if (!source) {
      throw new ORPCError("NOT_FOUND", { message: "Project not found or not owned by you." });
    }

    const [existing] = await db
      .select({ id: teamProjects.id })
      .from(teamProjects)
      .where(
        and(
          eq(teamProjects.teamId, input.teamId),
          eq(teamProjects.sourceProfileProjectId, source.id),
        ),
      )
      .limit(1);
    if (existing) {
      throw new ORPCError("BAD_REQUEST", { message: "That project is already on the showcase." });
    }

    // The member's row may predate convergence, so mint on demand rather than
    // trusting `source.projectId` — but never mint a *second* project for
    // work that already has one.
    const projectId = await ensureProfilePlacementProject(source.id);
    await db.insert(projectTeams).values({ projectId, teamId: input.teamId }).onConflictDoNothing();

    const [project] = await db
      .insert(teamProjects)
      .values({
        teamId: input.teamId,
        projectId,
        type: source.type,
        title: source.title,
        source: source.source,
        sourceId: source.sourceId,
        sourceProfileProjectId: source.id,
        jamId: source.jamId,
        participatedAt: source.participatedAt,
        addedBy: context.user.id,
      })
      .returning();

    await touchTeamActivity(input.teamId);

    return serializeTeamProject(project);
  });

export const updateTeamProject = os
  .use(requireAuth)
  .input(
    z.object({
      teamId: z.string(),
      projectId: z.string(),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(2000).optional().nullable(),
      url: optionalUrlSchema.nullable(),
      // `null` clears the cover; omitted leaves it untouched.
      image: z
        .object({
          key: z.string().min(1),
          url: uploadedImageUrlSchema,
          filename: z.string().min(1),
          mimeType: z.string().min(1),
          sizeBytes: z.number().int().positive(),
        })
        .optional()
        .nullable(),
      pinned: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    await getTeamRow(input.teamId);
    const membership = await requireMembership(input.teamId, context.user.id);

    const [project] = await db
      .select()
      .from(teamProjects)
      .where(and(eq(teamProjects.id, input.projectId), eq(teamProjects.teamId, input.teamId)))
      .limit(1);
    if (!project) {
      throw new ORPCError("NOT_FOUND", { message: "Project not found." });
    }
    if (membership.role !== "owner" && project.addedBy !== context.user.id) {
      throw new ORPCError("FORBIDDEN", {
        message: "Only the owner or whoever added this project can edit it.",
      });
    }
    if (input.title) checkProfanity(input.title, "Title");
    if (input.description) checkProfanity(input.description, "Description");
    if (input.image && !isTeamProjectImageKey(input.teamId, input.image.key)) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Uploaded image does not belong to this team.",
      });
    }

    const [updated] = await db
      .update(teamProjects)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.url !== undefined ? { url: input.url || null } : {}),
        ...(input.image !== undefined
          ? {
              imageUrl: null,
              imageKey: input.image?.key ?? null,
              imageFilename: input.image?.filename ?? null,
              imageMimeType: input.image?.mimeType ?? null,
              imageSizeBytes: input.image?.sizeBytes ?? null,
            }
          : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      })
      .where(eq(teamProjects.id, input.projectId))
      .returning();

    // Only objects in this team's namespace are swept — an imported row can
    // share its key with the source profile project, and that object belongs
    // to the member's own placement.
    const previousKey = project.imageKey;
    if (
      input.image !== undefined &&
      previousKey &&
      previousKey !== input.image?.key &&
      isTeamProjectImageKey(input.teamId, previousKey)
    ) {
      await removeProfileProjectImageFromStorage(previousKey).catch((error: unknown) => {
        console.error("Failed to delete replaced team project cover", { key: previousKey, error });
      });
    }

    // Identity lives on the canonical row and the showcase reads it from
    // there, so the edit has to land there to be visible — same write-through
    // the profile's `updateProject` does. The editor is a member of a team
    // that claims the project, which is exactly the §1.3 editor set.
    const touchesIdentity =
      input.title !== undefined || input.description !== undefined || input.url !== undefined;
    if (project.projectId && touchesIdentity) {
      await db
        .update(projects)
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description || null } : {}),
          ...(input.url !== undefined ? { url: input.url || null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, project.projectId));
    }

    return serializeTeamProject(updated);
  });

/**
 * Remove a project from the team's showcase.
 *
 * **Deletes the placement, never the canonical project** — same rule as
 * `removeProject`: contributors' profile pages and jam backlinks point at
 * the shared `project.projects` row. The team's *claim* on the work
 * (`project_teams`) is a separate, credit-level fact and also survives:
 * a team un-showcasing a game didn't stop having made it.
 */
export const removeTeamProject = os
  .use(requireAuth)
  .input(z.object({ teamId: z.string(), projectId: z.string() }))
  .handler(async ({ input, context }) => {
    await getTeamRow(input.teamId);
    const membership = await requireMembership(input.teamId, context.user.id);

    const [project] = await db
      .select({
        id: teamProjects.id,
        addedBy: teamProjects.addedBy,
        imageKey: teamProjects.imageKey,
      })
      .from(teamProjects)
      .where(and(eq(teamProjects.id, input.projectId), eq(teamProjects.teamId, input.teamId)))
      .limit(1);
    if (!project) {
      throw new ORPCError("NOT_FOUND", { message: "Project not found." });
    }
    if (membership.role !== "owner" && project.addedBy !== context.user.id) {
      throw new ORPCError("FORBIDDEN", {
        message: "Only the owner or whoever added this project can remove it.",
      });
    }

    await db.delete(teamProjects).where(eq(teamProjects.id, input.projectId));
    // Only team-namespace objects are swept: imported rows share their image
    // object with the source profile project, and that key stays theirs.
    if (project.imageKey && isTeamProjectImageKey(input.teamId, project.imageKey)) {
      const key = project.imageKey;
      await removeProfileProjectImageFromStorage(key).catch((error: unknown) => {
        console.error("Failed to delete team project cover", { key, error });
      });
    }
    return { success: true };
  });
