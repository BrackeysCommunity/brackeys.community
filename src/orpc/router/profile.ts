import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import * as z from "zod";

import { db } from "@/db";
import {
  collabRoles,
  developerProfiles,
  itchJamEntryResults,
  itchJams,
  linkedAccounts,
  profileProjects,
  profileUrlStubs,
  projectContributors,
  projectJamLinks,
  projectTeams,
  projects,
  skillRequests,
  skills,
  teamMembers,
  teams,
  threads,
  userRoles,
  userSkills,
} from "@/db/schema";
import { EVENTS } from "@/lib/analytics-events";
import { applyRoleOverrides, isAdmin as checkIsAdmin, isStaffMember } from "@/lib/discord";
import { jamUrl } from "@/lib/jam-links";
import { captureServerEvent } from "@/lib/posthog-server";
import { checkProfanity } from "@/lib/profanity";
import {
  getProfileProjectImageUrl,
  removeProfileProjectImageFromStorage,
} from "@/lib/profile-project-image-storage";
import {
  isOwnedProfileProjectImageKey,
  uploadedImageUrlSchema,
} from "@/lib/profile-project-images";
import {
  PROFILE_PROJECT_SUBTYPES,
  type ProfileProjectSubType,
  getAllowedSubTypesForProjectType,
  placementTypeForProjectType,
} from "@/lib/profile-projects";
import { MANUAL_PROJECT_TYPES } from "@/lib/project-taxonomy";
import { creditPlacementOwner, ensureProjectContributors, insertProject } from "@/lib/projects";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidTimezone } from "@/lib/timezones";
import { requireAuth } from "@/orpc/middleware/auth";

function escapeLike(str: string): string {
  return str.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// Imported jam rows (source `itchio-jam`) carry only a jam_id reference;
// their display name/URL come from the scraped `itch.jams` row. Manual rows
// keep their free-text jamName/jamUrl, which always wins in the coalesce.
async function queryProfileProjects(where: SQL | undefined) {
  const rows = await db
    .select({
      project: profileProjects,
      itchJamTitle: itchJams.title,
      itchJamSlug: itchJams.slug,
      // The jam log dates rows by when the jam ran, not when the entry was
      // submitted; entry counts turn a bare rank into "#12 / 312".
      jamStartsAt: itchJams.startsAt,
      jamEntriesCount: itchJams.entriesCount,
      // The canonical project this row is a placement of, when it has one —
      // what turns a showcase card from an exit to itch into a link to the
      // project's own page. Both joins are on unique keys, so neither can
      // multiply the placement rows.
      canonicalSlug: projects.slug,
      // …and the kind it says it is. The placement's own `type` is a pg enum
      // that can't hold `assets` / `web` / `other`, so a canonical row always
      // knows better about what the thing *is*.
      canonicalType: projects.type,
      canonicalLinks: projects.links,
      // Provider-derived facts that only exist canonically: platform badges
      // and the PAID chip read these.
      canonicalPlatforms: projects.platforms,
      canonicalMinPrice: sql<number | null>`(${projects.providerStats}->>'minPrice')::int`,
    })
    .from(profileProjects)
    .leftJoin(itchJams, eq(profileProjects.jamId, itchJams.jamId))
    .leftJoin(projects, eq(profileProjects.projectId, projects.id))
    .where(where);

  // Overall placement lives in the scraped per-criterion results, keyed on the
  // itch entry id that imported jam rows carry as `sourceId`. Fetched
  // separately rather than joined so a jam with several scraped criteria
  // can't multiply the project rows.
  const entryIds = rows
    .filter((r) => r.project.source === "itchio-jam" && /^\d+$/.test(r.project.sourceId ?? ""))
    .map((r) => Number(r.project.sourceId));
  const overallRows =
    entryIds.length > 0
      ? await db
          .select({ entryId: itchJamEntryResults.entryId, rank: itchJamEntryResults.rank })
          .from(itchJamEntryResults)
          .where(
            and(
              inArray(itchJamEntryResults.entryId, entryIds),
              sql`lower(${itchJamEntryResults.criterion}) = 'overall'`,
            ),
          )
      : [];
  const rankByEntryId = new Map(overallRows.map((r) => [String(r.entryId), r.rank]));

  // New manual rows stop carrying the free-text jam columns (plan step 6) —
  // the facts live on `project_jam_links` — so rows with a canonical project
  // and no jam facts of their own coalesce them back from there. Fetched
  // separately for the same reason as the ranks: a project with several jam
  // links must not multiply the placement rows.
  //
  // Scoped to `type === "jam"` placements on purpose: the adapter's jam-log
  // split treats any row with a jamName as a participation and pulls it out
  // of SHIPPED WORK, so coalescing onto a *game* placement whose project
  // also has a jam record would silently move the game off the showcase.
  const linkProjectIds = [
    ...new Set(
      rows
        .filter(
          (r) =>
            r.project.type === "jam" &&
            r.project.projectId != null &&
            r.project.jamName == null &&
            r.project.jamId == null,
        )
        .map((r) => r.project.projectId as string),
    ),
  ];
  const jamLinkRows =
    linkProjectIds.length > 0
      ? await db
          .select({
            projectId: projectJamLinks.projectId,
            jamName: projectJamLinks.jamName,
            jamUrl: projectJamLinks.jamUrl,
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

  return rows.map(
    ({
      project,
      itchJamTitle,
      itchJamSlug,
      jamStartsAt,
      jamEntriesCount,
      canonicalSlug,
      canonicalType,
      canonicalLinks,
      canonicalPlatforms,
      canonicalMinPrice,
    }) => {
      // The link that matches this placement's own date, or the only one —
      // a legacy row never reaches here (its own columns win the coalesce).
      const links = project.projectId ? jamLinksByProject.get(project.projectId) : undefined;
      const jamLink =
        links?.find(
          (link) => link.participatedAt?.getTime() === project.participatedAt?.getTime(),
        ) ??
        links?.[0] ??
        null;
      return {
        ...project,
        projectSlug: canonicalSlug,
        // Surfaced beside the placement's own `type` rather than replacing it:
        // the jam-log split reads `type === "jam"`, which is placement
        // provenance, while the card's label wants the artifact's kind.
        canonicalType,
        canonicalLinks,
        canonicalPlatforms,
        canonicalMinPrice,
        jamName: project.jamName ?? itchJamTitle ?? jamLink?.jamName ?? null,
        jamUrl:
          project.jamUrl ?? (itchJamSlug ? jamUrl(itchJamSlug) : null) ?? jamLink?.jamUrl ?? null,
        result: project.result ?? jamLink?.result ?? null,
        // Without this a coalesced row's log date falls through to
        // `createdAt` — when the row landed in our DB, not when the jam ran.
        participatedAt: project.participatedAt ?? jamLink?.participatedAt ?? null,
        // The scraped slug, so the log row can link to the jam's page *here*
        // rather than only off to itch. Null for manual rows with no linked jam.
        jamSlug: itchJamSlug,
        jamStartsAt,
        jamEntriesCount,
        // Guarded on source: a library row's `sourceId` is a game id, which can
        // collide numerically with an unrelated entry id.
        jamOverallRank:
          project.source === "itchio-jam" && project.sourceId
            ? (rankByEntryId.get(project.sourceId) ?? null)
            : null,
      };
    },
  );
}

/**
 * Projects this member is credited on — the portfolio-for-free surface.
 *
 * Joins `project_contributors` by profile id, so it covers work credited by
 * teammates, syncs, and the backfill alike; the caller filters out projects
 * the member already showcases as placements, since a CREDITS row under an
 * identical SHIPPED WORK card says nothing new. Unpublished projects stay
 * out (their pages 404 for everyone but editors).
 */
async function queryProfileCredits(profileId: string) {
  const rows = await db
    .select({
      id: projectContributors.id,
      role: projectContributors.role,
      projectId: projects.id,
      slug: projects.slug,
      title: projects.title,
      type: projects.type,
      releasedAt: projects.releasedAt,
      createdAt: projects.createdAt,
    })
    .from(projectContributors)
    .innerJoin(projects, eq(projectContributors.projectId, projects.id))
    .where(and(eq(projectContributors.profileId, profileId), eq(projects.published, true)));
  if (rows.length === 0) return [];

  // "with Night Shift Crew" — the first claiming team, when there is one.
  const teamRows = await db
    .select({ projectId: projectTeams.projectId, name: teams.name, slug: teams.slug })
    .from(projectTeams)
    .innerJoin(teams, eq(projectTeams.teamId, teams.id))
    .where(
      inArray(
        projectTeams.projectId,
        rows.map((row) => row.projectId),
      ),
    );
  const teamByProject = new Map<string, { name: string; slug: string }>();
  for (const row of teamRows) {
    if (!teamByProject.has(row.projectId)) {
      teamByProject.set(row.projectId, { name: row.name, slug: row.slug });
    }
  }

  return rows
    .sort(
      (a, b) => (b.releasedAt ?? b.createdAt).getTime() - (a.releasedAt ?? a.createdAt).getTime(),
    )
    .map(({ createdAt: _createdAt, ...row }) => ({
      ...row,
      team: teamByProject.get(row.projectId) ?? null,
    }));
}

/**
 * People this member met through the collab loop: distinct teammates on a
 * roster where *either* side's seat came from an accepted collab response.
 *
 * Symmetric on purpose. The plan specced "distinct accepted-response team
 * joins", which only ever counts the applicant — a post author who matched
 * ten people but never joined anyone else's team would read 0, which is
 * backwards for the person doing the recruiting. Counting the edge instead
 * of the seat gives both sides the same number for the same collaboration.
 *
 * Not a reputation score: it counts introductions that stuck, and the ship
 * is still the proof (`project_contributors` renders the actual credits).
 */
async function countCollabCollaborators(profileId: string): Promise<number> {
  const theirs = alias(teamMembers, "theirs");
  const [row] = await db
    .select({ value: countDistinct(theirs.userId) })
    .from(teamMembers)
    .innerJoin(
      theirs,
      and(eq(theirs.teamId, teamMembers.teamId), ne(theirs.userId, teamMembers.userId)),
    )
    .where(
      and(
        eq(teamMembers.userId, profileId),
        or(isNotNull(teamMembers.sourceResponseId), isNotNull(theirs.sourceResponseId)),
      ),
    );
  return row?.value ?? 0;
}

function queryUserSkills(userId: string) {
  return db
    .select({
      id: userSkills.id,
      skillId: skills.id,
      name: skills.name,
      category: skills.category,
    })
    .from(userSkills)
    .innerJoin(skills, eq(userSkills.skillId, skills.id))
    .where(eq(userSkills.userId, userId));
}

/** The member's craft claims — same `collab_roles` vocabulary the board
 *  hires against. */
function queryUserRoles(userId: string) {
  return db
    .select({
      id: collabRoles.id,
      name: collabRoles.name,
      category: collabRoles.category,
    })
    .from(userRoles)
    .innerJoin(collabRoles, eq(userRoles.roleId, collabRoles.id))
    .where(eq(userRoles.userId, userId));
}

const optionalUrlSchema = z.url().optional().or(z.literal(""));
/** The *canonical* kind the member picked. The placement stores a lossy
 * stand-in for it (`placementTypeForProjectType`) because its column is a pg
 * enum; `project.projects.type` is the real answer. */
const manualProjectTypeSchema = z.enum(MANUAL_PROJECT_TYPES);
const projectSubTypeSchema = z.enum(PROFILE_PROJECT_SUBTYPES);
/** Secondary links — repo, live site, store page. The primary `url` is the
 * CTA; these are the rail beside it, and they live on the canonical row
 * because they're identity, not surface. */
const projectLinksSchema = z
  .array(
    z.object({
      label: z.string().trim().min(1).max(40),
      url: z.url(),
    }),
  )
  .max(6)
  .optional();
const uploadedProjectImageSchema = z
  .object({
    key: z.string().min(1),
    url: uploadedImageUrlSchema,
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().positive(),
  })
  .optional();

/** Sub-types are validated against the *canonical* kind the member picked,
 * then stored on both rows — `web` has none of its own now that it's a kind
 * rather than an `app` sub-type. */
function normalizeManualProjectSubTypes(
  type: z.infer<typeof manualProjectTypeSchema>,
  subTypes?: string[],
) {
  const allowed = new Set<string>(getAllowedSubTypesForProjectType(type));
  const normalized = (subTypes ?? []).filter((subType) => allowed.has(subType));
  if ((subTypes?.length ?? 0) !== normalized.length) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Selected sub-types do not match the chosen project type.",
    });
  }

  return normalized as ProfileProjectSubType[];
}

function buildJamProjectTitle(jamName: string, submissionTitle?: string) {
  return submissionTitle?.trim() || jamName.trim();
}

function assertOwnedUploadedProjectImage(
  userId: string,
  image: Exclude<z.infer<typeof uploadedProjectImageSchema>, undefined>,
) {
  if (!isOwnedProfileProjectImageKey(userId, image.key)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Uploaded image does not belong to the current user.",
    });
  }
}

async function serializeProfileProject<
  T extends {
    imageKey: string | null;
    imageUrl: string | null;
  },
>(project: T) {
  const presigned = await getProfileProjectImageUrl(project.imageKey);
  return {
    ...project,
    imageUrl: presigned ?? project.imageUrl,
  };
}

async function serializeProfileProjects<
  T extends {
    imageKey: string | null;
    imageUrl: string | null;
  },
>(projects: T[]) {
  return Promise.all(projects.map(serializeProfileProject));
}

/**
 * A member's profile as everyone sees it: approved, published work only,
 * and nothing about the viewer. The owner's own view is `getMyProfile`,
 * which the profile page layers on top when you are looking at yourself —
 * that split is what lets this response be identical for every caller and
 * cached at the edge.
 */
export const getProfile = os
  .route({ method: "GET" })
  .input(z.object({ userId: z.string() }))
  .handler(async ({ input }) => {
    // Try direct ID lookup first, then fall back to URL stub resolution
    let [profile] = await db
      .select()
      .from(developerProfiles)
      .where(eq(developerProfiles.id, input.userId))
      .limit(1);

    if (!profile) {
      const [stub] = await db
        .select()
        .from(profileUrlStubs)
        .where(eq(profileUrlStubs.stub, input.userId.toLowerCase()))
        .limit(1);

      if (stub) {
        [profile] = await db
          .select()
          .from(developerProfiles)
          .where(eq(developerProfiles.id, stub.profileId))
          .limit(1);
      }
    }

    if (!profile) return null;

    const profileId = profile.id;

    const [
      skillList,
      roleList,
      projects,
      urlStub,
      linkedAccountsList,
      creditRows,
      wallThread,
      collabsCount,
    ] = await Promise.all([
      queryUserSkills(profileId),
      queryUserRoles(profileId),
      queryProfileProjects(
        and(
          eq(profileProjects.profileId, profileId),
          eq(profileProjects.status, "approved"),
          // Unpublished titles (e.g. itch.io drafts) are owner-only.
          eq(profileProjects.published, true),
          // itch.io "Restricted" pages report published=true from the
          // API but 404 for anonymous visitors; the library-sync
          // sweep's URL probe records that here. Owner-only too.
          isNull(profileProjects.restrictedAt),
          // Games that vanished from the linked library (deleted on
          // itch, or access lost) are owner-only until removed.
          isNull(profileProjects.missingSince),
        ),
      ),
      db.select().from(profileUrlStubs).where(eq(profileUrlStubs.profileId, profileId)).limit(1),
      // Display-safe columns only. `tokenInvalidAt` says whether someone's
      // linked account needs reconnecting, which is between them and the
      // provider — only the owner's own `getMyProfile` carries it, and the
      // page's "reconnect" prompt already reads it from there.
      db
        .select({
          id: linkedAccounts.id,
          provider: linkedAccounts.provider,
          providerUsername: linkedAccounts.providerUsername,
          providerProfileUrl: linkedAccounts.providerProfileUrl,
          linkedAt: linkedAccounts.linkedAt,
        })
        .from(linkedAccounts)
        .where(eq(linkedAccounts.profileId, profileId)),
      queryProfileCredits(profileId),
      db
        .select({ commentCount: threads.commentCount })
        .from(threads)
        .where(eq(threads.profileUserId, profileId))
        .limit(1),
      countCollabCollaborators(profileId),
    ]);

    // A credit on a project the member already showcases would repeat the
    // SHIPPED WORK card one section down; the credits list is for the work
    // that reaches their profile *only* through `project_contributors`.
    const placedProjectIds = new Set(
      projects.map((p) => p.projectId).filter((id): id is string => id != null),
    );

    return {
      profile,
      skills: skillList,
      roles: roleList,
      projects: await serializeProfileProjects(projects),
      credits: creditRows.filter((credit) => !placedProjectIds.has(credit.projectId)).slice(0, 12),
      urlStub: urlStub[0]?.stub ?? null,
      linkedAccounts: linkedAccountsList,
      wallNotesCount: wallThread[0]?.commentCount ?? 0,
      collabsCount,
    };
  });

export const getMyProfile = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const userId = context.user.id;

    const [profile] = await db
      .select()
      .from(developerProfiles)
      .where(eq(developerProfiles.id, userId))
      .limit(1);

    if (!profile) return null;

    const roleNames = applyRoleOverrides(profile.discordId, profile.guildRoles ?? []);

    const [skillList, roleList, projects, pendingSkillRequests, urlStub, linkedAccountsList] =
      await Promise.all([
        queryUserSkills(userId),
        queryUserRoles(userId),
        queryProfileProjects(eq(profileProjects.profileId, userId)),
        db
          .select()
          .from(skillRequests)
          .where(and(eq(skillRequests.userId, userId), eq(skillRequests.status, "pending"))),
        db.select().from(profileUrlStubs).where(eq(profileUrlStubs.profileId, userId)).limit(1),
        db
          .select({
            id: linkedAccounts.id,
            provider: linkedAccounts.provider,
            providerUserId: linkedAccounts.providerUserId,
            providerUsername: linkedAccounts.providerUsername,
            providerAvatarUrl: linkedAccounts.providerAvatarUrl,
            providerProfileUrl: linkedAccounts.providerProfileUrl,
            tokenInvalidAt: linkedAccounts.tokenInvalidAt,
            linkedAt: linkedAccounts.linkedAt,
          })
          .from(linkedAccounts)
          .where(eq(linkedAccounts.profileId, userId)),
      ]);

    return {
      profile,
      skills: skillList,
      roles: roleList,
      projects: await serializeProfileProjects(projects),
      pendingSkillRequests,
      urlStub: urlStub[0]?.stub ?? null,
      isOwner: true,
      linkedAccounts: linkedAccountsList,
      // Rides along on the row we already read so the nav can offer /admin
      // without a second round trip. UX only — every staff procedure and the
      // route's own loader re-check server-side.
      isStaff: isStaffMember(roleNames),
      isAdmin: checkIsAdmin(roleNames),
    };
  });

/**
 * Just the viewer's own skill ids — the smallest private read that lets an
 * anonymous, edge-cached `listPosts` still render "you match 3/5" on the
 * board. Fetched once per session rather than folded into every listing
 * response, which is what keeps that listing identical for every caller.
 */
export const getMySkillIds = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const rows = await db
      .select({ skillId: userSkills.skillId })
      .from(userSkills)
      .where(eq(userSkills.userId, context.user.id));

    return rows.map((row) => row.skillId);
  });

const rateTypeSchema = z.enum(["hourly", "fixed", "negotiable"]);
const availabilitySchema = z.enum(["full_time", "part_time", "limited"]);
const collabPreferenceSchema = z.enum(["paid", "hobby", "either"]);

/** Nobody on this board bills more than this, and the cap is what keeps
 *  the display's million tier from being reachable by leaning on a key. */
export const MAX_RATE = 1_000_000;
const rateAmountSchema = z.number().int().min(0).max(MAX_RATE).optional().nullable();

/**
 * The rate bounds arrive as two independent saves, so the server never sees
 * them together and a `$10000K – $150K` row was the result. Either half of
 * the pair is therefore checked against whatever the other half already is.
 */
async function assertRatePairOrdered(
  userId: string,
  input: { rateMin?: number | null; rateMax?: number | null },
) {
  const touchesMin = input.rateMin !== undefined;
  const touchesMax = input.rateMax !== undefined;
  // Nothing to compare: the save skips the pair, or clears one side of it,
  // or carries both (which the input schema already ordered).
  if (!touchesMin && !touchesMax) return;
  if (touchesMin && touchesMax) return;
  if (input.rateMin === null || input.rateMax === null) return;

  const [stored] = await db
    .select({ rateMin: developerProfiles.rateMin, rateMax: developerProfiles.rateMax })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, userId))
    .limit(1);
  if (!stored) return;

  const min = touchesMin ? input.rateMin! : stored.rateMin;
  const max = touchesMax ? input.rateMax! : stored.rateMax;
  if (min == null || max == null || max >= min) return;

  throw new ORPCError("BAD_REQUEST", {
    message: touchesMin
      ? `Minimum rate can't be above your maximum of ${max}.`
      : `Maximum rate can't be below your minimum of ${min}.`,
  });
}

export const updateProfile = os
  .use(requireAuth)
  .input(
    z
      .object({
        bio: z.string().optional(),
        tagline: z.string().optional(),
        githubUrl: z.string().max(500).optional().nullable(),
        twitterUrl: z.string().max(500).optional().nullable(),
        websiteUrl: z.string().max(500).optional().nullable(),
        availableForWork: z.boolean().optional(),
        availability: availabilitySchema.optional().nullable(),
        rateType: rateTypeSchema.optional().nullable(),
        rateMin: rateAmountSchema,
        rateMax: rateAmountSchema,
        // The people lane is the availability listing, so what an "I'm
        // available" post would have said lives on the profile instead.
        lookingFor: z.string().max(280).optional().nullable(),
        collabPreference: collabPreferenceSchema.optional().nullable(),
        profileNotesEnabled: z.boolean().optional(),
        // IANA name, validated below — a zod enum over ~430 zone names would
        // hard-code one runtime's list into the API contract.
        timezone: z.string().max(64).optional().nullable(),
        location: z.string().trim().max(100).optional().nullable(),
      })
      .superRefine((value, ctx) => {
        // Only catches the pair when one save carries both. The editor saves
        // field by field, so the usual shape is a partial update that has to
        // be checked against the stored row — see the handler.
        if (value.rateMin != null && value.rateMax != null && value.rateMax < value.rateMin) {
          ctx.addIssue({
            code: "custom",
            path: ["rateMax"],
            message: "Maximum rate can't be below the minimum.",
          });
        }
      }),
  )
  .handler(async ({ input, context }) => {
    const userId = context.user.id;

    checkProfanity(input.bio, "Bio");
    checkProfanity(input.tagline, "Tagline");
    checkProfanity(input.lookingFor, "Looking for");
    checkProfanity(input.location, "Location");

    if (input.timezone != null && !isValidTimezone(input.timezone)) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Unknown timezone — pick an IANA zone like Europe/Madrid.",
      });
    }

    // Anti-runaway, not anti-user — the editor autosaves field by field.
    if (!(await checkRateLimit("profile-update", userId, 120))) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "Too many profile updates — try again in a bit.",
      });
    }

    await assertRatePairOrdered(userId, input);

    const [updated] = await db
      .update(developerProfiles)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(developerProfiles.id, userId))
      .returning();

    captureServerEvent(EVENTS.profileSaved, userId, {
      // Which fields the save actually carried — the profile flyout saves
      // per-step, so this is what makes "which step do people give up on"
      // answerable from the outcome side as well as the client's step events.
      has_bio: Boolean(input.bio),
      has_tagline: Boolean(input.tagline),
      has_location: Boolean(input.location),
      has_timezone: input.timezone != null,
    });

    return updated;
  });

/** How many craft claims a profile can carry — a claim, not a tag cloud. */
export const MAX_PROFILE_ROLES = 3;

/**
 * Replace-set of the member's role claims. One mutation rather than
 * add/remove pairs because the editor is a chip row with a hard cap —
 * the client always knows the whole intended set.
 */
export const setMyRoles = os
  .use(requireAuth)
  .input(z.object({ roleIds: z.array(z.number().int().positive()).max(MAX_PROFILE_ROLES) }))
  .handler(async ({ input, context }) => {
    const userId = context.user.id;
    const roleIds = [...new Set(input.roleIds)];

    if (roleIds.length > 0) {
      const found = await db
        .select({ id: collabRoles.id })
        .from(collabRoles)
        .where(inArray(collabRoles.id, roleIds));
      if (found.length !== roleIds.length) {
        throw new ORPCError("BAD_REQUEST", { message: "One or more roles do not exist." });
      }
    }

    await db.transaction(async (tx) => {
      await tx.delete(userRoles).where(eq(userRoles.userId, userId));
      if (roleIds.length > 0) {
        await tx.insert(userRoles).values(roleIds.map((roleId) => ({ userId, roleId })));
      }
    });

    return queryUserRoles(userId);
  });

export const syncDiscordData = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const userId = context.user.id;
    const user = context.user;

    const [upserted] = await db
      .insert(developerProfiles)
      .values({
        id: userId,
        discordUsername: user.name ?? null,
        avatarUrl: user.image ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: developerProfiles.id,
        set: {
          discordUsername: user.name ?? null,
          avatarUrl: user.image ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return upserted;
  });

export const listSkills = os
  .route({ method: "GET" })
  .input(z.object({ search: z.string().optional() }))
  .handler(async ({ input }) => {
    if (input.search) {
      return db
        .select()
        .from(skills)
        .where(ilike(skills.name, `%${escapeLike(input.search)}%`));
    }
    return db.select().from(skills);
  });

/** Returns the resulting set rather than the row it touched, so the editor
 *  can seed its cache with it instead of trusting the refetch — see
 *  `setMyRoles`. */
export const addUserSkill = os
  .use(requireAuth)
  .input(z.object({ skillId: z.number() }))
  .handler(async ({ input, context }) => {
    await db.insert(userSkills).values({ userId: context.user.id, skillId: input.skillId });

    return queryUserSkills(context.user.id);
  });

export const removeUserSkill = os
  .use(requireAuth)
  .input(z.object({ userSkillId: z.number() }))
  .handler(async ({ input, context }) => {
    const [deleted] = await db
      .delete(userSkills)
      .where(and(eq(userSkills.id, input.userSkillId), eq(userSkills.userId, context.user.id)))
      .returning();

    if (!deleted) {
      throw new ORPCError("NOT_FOUND", {
        message: "Skill not found or not owned by you.",
      });
    }

    return queryUserSkills(context.user.id);
  });

export const requestSkill = os
  .use(requireAuth)
  .input(z.object({ name: z.string(), category: z.string().optional() }))
  .handler(async ({ input, context }) => {
    const [request] = await db
      .insert(skillRequests)
      .values({
        userId: context.user.id,
        name: input.name,
        category: input.category,
      })
      .returning();

    return request;
  });

export const cancelSkillRequest = os
  .use(requireAuth)
  .input(z.object({ name: z.string() }))
  .handler(async ({ input, context }) => {
    const [deleted] = await db
      .delete(skillRequests)
      .where(
        and(
          eq(skillRequests.userId, context.user.id),
          eq(skillRequests.name, input.name),
          eq(skillRequests.status, "pending"),
        ),
      )
      .returning();

    if (!deleted) {
      throw new ORPCError("NOT_FOUND", { message: "Skill request not found." });
    }

    return { success: true };
  });

export const addProject = os
  .use(requireAuth)
  .input(
    z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      url: optionalUrlSchema,
      image: uploadedProjectImageSchema,
      tags: z.array(z.string()).optional(),
      pinned: z.boolean().optional(),
      type: manualProjectTypeSchema.optional(),
      subTypes: z.array(projectSubTypeSchema).optional(),
      links: projectLinksSchema,
    }),
  )
  .handler(async ({ input, context }) => {
    const { image, links, ...projectInput } = input;
    if (image) {
      assertOwnedUploadedProjectImage(context.user.id, image);
    }

    const type = input.type ?? "game";
    const subTypes = normalizeManualProjectSubTypes(type, input.subTypes);

    // The canonical row is minted first so the placement is born linked.
    // Failing this way round leaves an unanchored project for the orphan
    // sweep; the other way round leaves a placement that no project page can
    // be made of, which is exactly what this step exists to stop.
    const projectId = await insertProject({
      title: input.title,
      description: input.description,
      // The kind the member actually picked. The placement below stores the
      // nearest enum value it can hold, and every surface that wants the
      // real answer reads it back from here.
      type,
      subTypes,
      url: input.url || null,
      links: links ?? [],
      // No canonical cover: an uploaded image lives in this user's own MinIO
      // namespace and would inherit their account's lifecycle. It stays the
      // placement's override; the project-scoped upload is the cover.
      createdBy: context.user.id,
      source: "manual",
    });
    await creditPlacementOwner(projectId, context.user.id);

    const [project] = await db
      .insert(profileProjects)
      .values({
        profileId: context.user.id,
        projectId,
        ...projectInput,
        ...(image
          ? {
              imageUrl: null,
              imageKey: image.key,
              imageFilename: image.filename,
              imageMimeType: image.mimeType,
              imageSizeBytes: image.sizeBytes,
            }
          : {}),
        type: placementTypeForProjectType(type),
        subTypes,
        source: "manual",
        status: "approved",
      })
      .returning();

    return serializeProfileProject(project);
  });

export const updateProject = os
  .use(requireAuth)
  .input(
    z.object({
      projectId: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      url: optionalUrlSchema,
      image: uploadedProjectImageSchema,
      tags: z.array(z.string()).optional(),
      pinned: z.boolean().optional(),
      type: manualProjectTypeSchema.optional(),
      subTypes: z.array(projectSubTypeSchema).optional(),
      links: projectLinksSchema,
    }),
  )
  .handler(async ({ input, context }) => {
    // `type` is pulled out of the spread: it now names a *canonical* kind,
    // which the placement's enum column can't hold.
    const { projectId, image, links, type, ...data } = input;
    const [existingProject] = await db
      .select({
        id: profileProjects.id,
        type: profileProjects.type,
        imageKey: profileProjects.imageKey,
        canonicalId: profileProjects.projectId,
        canonicalType: projects.type,
      })
      .from(profileProjects)
      .leftJoin(projects, eq(projects.id, profileProjects.projectId))
      .where(and(eq(profileProjects.id, projectId), eq(profileProjects.profileId, context.user.id)))
      .limit(1);

    if (!existingProject) {
      throw new ORPCError("NOT_FOUND", {
        message: "Project not found or not owned by you.",
      });
    }

    if (existingProject.type === "jam") {
      throw new ORPCError("BAD_REQUEST", {
        message: "Jam entries cannot be edited through the project editor.",
      });
    }

    if (image) {
      assertOwnedUploadedProjectImage(context.user.id, image);
    }

    // The kind is now canonical-first: the placement's enum can't hold
    // `assets`/`web`/`other`, so the picked kind lives on `project.projects`
    // and the placement stores the nearest stand-in.
    const nextType = type ?? existingProject.canonicalType ?? existingProject.type;
    const nextSubTypes =
      type !== undefined || data.subTypes !== undefined
        ? normalizeManualProjectSubTypes(nextType, data.subTypes ?? [])
        : undefined;

    const [updated] = await db
      .update(profileProjects)
      .set({
        ...data,
        ...(image
          ? {
              imageUrl: null,
              imageKey: image.key,
              imageFilename: image.filename,
              imageMimeType: image.mimeType,
              imageSizeBytes: image.sizeBytes,
            }
          : {}),
        ...(type !== undefined ? { type: placementTypeForProjectType(type) } : {}),
        ...(nextSubTypes !== undefined ? { subTypes: nextSubTypes } : {}),
      })
      .where(and(eq(profileProjects.id, projectId), eq(profileProjects.profileId, context.user.id)))
      .returning();

    // Identity lives on the canonical row, so editing "my project" edits it.
    // The placement owner is a credited contributor by construction, which is
    // exactly the §1.3 editor set — no second permission check needed.
    if (existingProject.canonicalId) {
      await db
        .update(projects)
        .set({
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.url !== undefined ? { url: data.url || null } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(nextSubTypes !== undefined ? { subTypes: nextSubTypes } : {}),
          ...(links !== undefined ? { links } : {}),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, existingProject.canonicalId));
    }

    if (!updated) {
      throw new ORPCError("NOT_FOUND", {
        message: "Project not found or not owned by you.",
      });
    }

    if (image && existingProject.imageKey && existingProject.imageKey !== image.key) {
      removeProfileProjectImageFromStorage(existingProject.imageKey).catch(console.error);
    }

    return serializeProfileProject(updated);
  });

/**
 * Un-showcase a project from the owner's profile.
 *
 * **Deletes the placement, never the canonical project.** Other
 * contributors' pages, a team's showcase, and jam backlinks all point at
 * `project.projects`, so one member removing their copy must not take the
 * shared row with it — which is exactly why `profile_projects.project_id`
 * is `ON DELETE SET NULL` in the other direction and why nothing here
 * touches the `project` schema. A project that loses its last anchor is an
 * orphan for a periodic sweep to consider, not something to cascade-collect
 * synchronously (race-prone, and the volume doesn't justify it).
 *
 * The MinIO delete below is safe for the same reason: the key is in this
 * user's own namespace, and canonical rows never reference a user-scoped
 * key — they carry provider CDN URLs or a project-scoped upload.
 */
export const removeProject = os
  .use(requireAuth)
  .input(z.object({ projectId: z.string() }))
  .handler(async ({ input, context }) => {
    const [deleted] = await db
      .delete(profileProjects)
      .where(
        and(
          eq(profileProjects.id, input.projectId),
          eq(profileProjects.profileId, context.user.id),
        ),
      )
      .returning();

    if (!deleted) {
      throw new ORPCError("NOT_FOUND", {
        message: "Project not found or not owned by you.",
      });
    }

    removeProfileProjectImageFromStorage(deleted.imageKey).catch(console.error);

    return { success: true };
  });

export const addJamParticipation = os
  .use(requireAuth)
  .input(
    z.object({
      jamName: z.string().min(1),
      jamUrl: optionalUrlSchema,
      submissionTitle: z.string().optional(),
      submissionUrl: optionalUrlSchema,
      result: z.string().optional(),
      teamMembers: z.array(z.string()).optional(),
      participatedAt: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const participatedAt = input.participatedAt ? new Date(input.participatedAt) : null;

    // A hand-logged jam entry is a project like any other: the *submission*
    // is the artifact ("jam" was never a kind of thing), and the jam itself
    // becomes a record on it. Explicit, not derived — a manual row has no
    // `source_game_id` for the entries join to key on.
    const projectId = await insertProject({
      title: input.submissionTitle?.trim() || input.jamName,
      url: input.submissionUrl || null,
      releasedAt: participatedAt,
      createdBy: context.user.id,
      source: "manual",
    });
    await creditPlacementOwner(projectId, context.user.id);
    await ensureProjectContributors(
      (input.teamMembers ?? []).map((name) => ({
        projectId,
        displayName: name,
        source: "manual" as const,
      })),
    );
    await db.insert(projectJamLinks).values({
      projectId,
      jamName: input.jamName,
      jamUrl: input.jamUrl || null,
      submissionUrl: input.submissionUrl || null,
      result: input.result,
      participatedAt,
    });

    // The placement is surface-only now (plan step 6): the jam facts live on
    // the canonical row's `project_jam_links` and the teammates are credits,
    // so the legacy free-text columns stay null on new rows and the reads
    // coalesce them back in for old ones.
    const [participation] = await db
      .insert(profileProjects)
      .values({
        profileId: context.user.id,
        projectId,
        type: "jam",
        title: buildJamProjectTitle(input.jamName, input.submissionTitle),
        status: "approved",
        source: "manual",
        submissionTitle: input.submissionTitle,
        submissionUrl: input.submissionUrl,
        participatedAt,
      })
      .returning();

    captureServerEvent(EVENTS.jamParticipationAdded, context.user.id, {
      has_submission_url: Boolean(input.submissionUrl),
      result: input.result,
    });

    return serializeProfileProject(participation);
  });

export const removeJamParticipation = os
  .use(requireAuth)
  .input(z.object({ jamId: z.string() }))
  .handler(async ({ input, context }) => {
    const [deleted] = await db
      .delete(profileProjects)
      .where(
        and(
          eq(profileProjects.id, input.jamId),
          eq(profileProjects.profileId, context.user.id),
          eq(profileProjects.type, "jam"),
        ),
      )
      .returning();

    if (!deleted) {
      throw new ORPCError("NOT_FOUND", {
        message: "Jam participation not found or not owned by you.",
      });
    }

    return { success: true };
  });

const STUB_REGEX = /^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/;

export const setUrlStub = os
  .use(requireAuth)
  .input(z.object({ stub: z.string().min(3).max(32) }))
  .handler(async ({ input, context }) => {
    const userId = context.user.id;
    const stub = input.stub.toLowerCase().trim();

    if (!STUB_REGEX.test(stub)) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "URL stub must be 3-32 characters, start and end with a letter or number, and contain only lowercase letters, numbers, hyphens, and underscores.",
      });
    }

    checkProfanity(stub, "URL stub");

    // Check if stub is already taken by another user
    const [existing] = await db
      .select()
      .from(profileUrlStubs)
      .where(eq(profileUrlStubs.stub, stub))
      .limit(1);

    if (existing && existing.profileId !== userId) {
      throw new ORPCError("CONFLICT", {
        message: "This URL stub is already taken.",
      });
    }

    const [upserted] = await db
      .insert(profileUrlStubs)
      .values({
        profileId: userId,
        stub,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: profileUrlStubs.profileId,
        set: {
          stub,
          updatedAt: new Date(),
        },
      })
      .returning();

    return upserted;
  });

export const listAvailableUsers = os
  .route({ method: "GET" })
  .input(
    z.object({
      search: z.string().optional(),
      skillIds: z.array(z.number().int().positive()).optional(),
      collabPreference: collabPreferenceSchema.optional(),
      sortBy: z.enum(["updatedAt", "createdAt"]).default("updatedAt"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }),
  )
  .handler(async ({ input }) => {
    const conditions = [eq(developerProfiles.availableForWork, true)];

    if (input.search) {
      const escaped = escapeLike(input.search);
      const searchCondition = or(
        ilike(developerProfiles.discordUsername, `%${escaped}%`),
        ilike(developerProfiles.tagline, `%${escaped}%`),
      );
      if (searchCondition) conditions.push(searchCondition);
    }

    // Same subquery shape the collab board uses for post stacks, so a
    // "who knows Godot" question reads the same on both lanes.
    if (input.skillIds && input.skillIds.length > 0) {
      const matchingUserIds = db
        .select({ userId: userSkills.userId })
        .from(userSkills)
        .where(inArray(userSkills.skillId, input.skillIds));
      conditions.push(inArray(developerProfiles.id, matchingUserIds));
    }

    // "either" is the accommodating answer, so it belongs in the results
    // for both a paid search and a hobby one.
    if (input.collabPreference) {
      const pref = or(
        eq(developerProfiles.collabPreference, input.collabPreference),
        eq(developerProfiles.collabPreference, "either"),
      );
      if (pref) conditions.push(pref);
    }

    const where = and(...conditions);
    const sortColumn =
      input.sortBy === "createdAt" ? developerProfiles.createdAt : developerProfiles.updatedAt;
    const sortFn = input.sortOrder === "asc" ? asc : desc;

    const users = await db
      .select()
      .from(developerProfiles)
      .where(where)
      .orderBy(sortFn(sortColumn))
      .limit(input.limit)
      .offset(input.offset);

    const [totalResult] = await db.select({ count: count() }).from(developerProfiles).where(where);

    // Fetch skills for all returned users
    const userIds = users.map((u) => u.id);

    // Vanity stubs, so links can prefer `/profile/handle` over the raw id.
    const stubRows =
      userIds.length > 0
        ? await db
            .select({ profileId: profileUrlStubs.profileId, stub: profileUrlStubs.stub })
            .from(profileUrlStubs)
            .where(inArray(profileUrlStubs.profileId, userIds))
        : [];
    const stubByUser = new Map(stubRows.map((r) => [r.profileId, r.stub]));

    const allSkills =
      userIds.length > 0
        ? await db
            .select({
              userId: userSkills.userId,
              skillId: skills.id,
              name: skills.name,
              category: skills.category,
            })
            .from(userSkills)
            .innerJoin(skills, eq(userSkills.skillId, skills.id))
            .where(sql`${userSkills.userId} IN ${userIds}`)
        : [];

    const skillsByUser = new Map<
      string,
      { skillId: number; name: string; category: string | null }[]
    >();
    for (const s of allSkills) {
      const list = skillsByUser.get(s.userId) ?? [];
      list.push({ skillId: s.skillId, name: s.name, category: s.category });
      skillsByUser.set(s.userId, list);
    }

    return {
      users: users.map((u) => ({
        ...u,
        urlStub: stubByUser.get(u.id) ?? null,
        skills: skillsByUser.get(u.id) ?? [],
      })),
      total: totalResult?.count ?? 0,
    };
  });
