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
  or,
  sql,
} from "drizzle-orm";
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
  teamReports,
  teams,
  userSkills,
  type ModerationActionType,
  type ModerationTargetType,
  type NotificationType,
} from "@/db/schema";
import { EVENTS } from "@/lib/event-taxonomy";
import { jamUrl } from "@/lib/jam-links";
import { memberName } from "@/lib/member-name";
import { recordModerationAction } from "@/lib/moderation-audit";
import { canOverride, type ModOverride, type ModPowerAction } from "@/lib/moderation-policy";
import { notify } from "@/lib/notifications";
import { bestEffort, captureServerEvent } from "@/lib/posthog-server";
import { checkProfanity } from "@/lib/profanity";
import {
  getProfileProjectImageUrl,
  removeProfileProjectImageFromStorage,
  resolveTeamAvatarUrl,
  resolveTeamBannerUrl,
} from "@/lib/profile-project-image-storage";
import { ensureProfilePlacementProject, insertProject } from "@/lib/projects";
import { assertRateLimit } from "@/lib/rate-limit";
import { notifyReporters, resolveReportsForSubject } from "@/lib/report-resolution";
// The house home for LIKE escaping — this file carried its own copy, which
// (unlike the shared one) left a backslash in the search term unescaped.
import { escapeLike } from "@/lib/sql-like";
import { isTeamProjectImageKey } from "@/lib/stored-image-keys";
import { uploadedImageUrlSchema } from "@/lib/stored-image-urls";
import { touchTeamActivity } from "@/lib/team-activity";
import { slugifyTeamName } from "@/lib/team-links";
import { blockPairExists } from "@/lib/user-blocks";
import {
  requireAuth,
  requireAuthWithPermissions,
  requireGuildMember,
  requireStaff,
} from "@/orpc/middleware/auth";
import { profileNameSearch, profileStubJoin } from "@/orpc/profile-projection";

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
 * Either the shared connection or a transaction handle — the drizzle
 * surface the helpers below write through, so a caller that already holds
 * a transaction (accept-time crew minting) can keep the team insert inside
 * it.
 */
export type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

async function claimSlug(executor: DbExecutor, name: string): Promise<string> {
  const base = slugifyTeamName(name);
  const taken = new Set(
    (
      await executor
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

// ── Staff overrides (plan 23) ────────────────────────────────────────────────

type OverrideCaller = { user: { id: string }; isStaff: boolean; isAdmin: boolean };

const overrideReasonSchema = z.string().trim().max(500).optional();

const TEAM_UNDER_REVIEW = "This team is under review.";

/**
 * The evidence-preservation lever: while hidden, a team is frozen for its
 * own members so an owner can't scrub or delete it mid-investigation.
 * Overrides pass — moderation must reach the page it hid.
 */
function assertNotFrozen(team: { hiddenAt: Date | null }, isOverride: boolean): void {
  if (!isOverride && team.hiddenAt) {
    throw new ORPCError("FORBIDDEN", { message: TEAM_UNDER_REVIEW });
  }
}

/**
 * Owner passes as themselves (unlogged, whatever roles they hold); staff
 * and admins pass as an override when `MOD_POWERS` admits them. Everyone
 * else gets the exact pre-override refusals.
 */
async function requireOwnershipOrOverride(
  action: ModPowerAction,
  teamId: string,
  context: OverrideCaller,
) {
  const membership = await getMembership(teamId, context.user.id);
  if (membership?.role === "owner") return { membership, isOverride: false as const };
  if (canOverride(action, context)) return { membership, isOverride: true as const };
  if (!membership) {
    throw new ORPCError("FORBIDDEN", { message: "You are not a member of this team." });
  }
  throw new ORPCError("FORBIDDEN", { message: "Only the team owner can do that." });
}

async function requireMembershipOrOverride(
  action: ModPowerAction,
  teamId: string,
  context: OverrideCaller,
) {
  const membership = await getMembership(teamId, context.user.id);
  if (membership) return { membership, isOverride: false as const };
  if (canOverride(action, context)) return { membership: null, isOverride: true as const };
  throw new ORPCError("FORBIDDEN", { message: "You are not a member of this team." });
}

async function getTeamOwnerId(teamId: string): Promise<string | null> {
  const [owner] = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "owner")))
    .limit(1);
  return owner?.userId ?? null;
}

type TeamIdentity = { id: string; name: string; slug: string };

async function recordTeamModAction(params: {
  action: ModerationActionType;
  mod: ModOverride;
  team: TeamIdentity;
  /** Defaults to the team's owner — the person affected. */
  subjectUserId?: string | null;
  targetType?: ModerationTargetType;
  targetId?: string | number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await recordModerationAction({
    action: params.action,
    actorId: params.mod.actorId,
    targetType: params.targetType ?? "team",
    targetId: params.targetId ?? params.team.id,
    subjectUserId:
      params.subjectUserId !== undefined
        ? params.subjectUserId
        : await getTeamOwnerId(params.team.id),
    reason: params.mod.reason,
    metadata: { teamName: params.team.name, teamSlug: params.team.slug, ...params.metadata },
  });
}

/**
 * Reason included; actor deliberately not — which moderator ruled is
 * staff's business (same rule as `notifyRequester`).
 */
async function notifyTeamOwner(
  team: TeamIdentity,
  type: NotificationType,
  mod: ModOverride,
  data: Record<string, unknown> = {},
): Promise<void> {
  const ownerId = await getTeamOwnerId(team.id);
  if (!ownerId || ownerId === mod.actorId) return;
  await bestEffort("team_moderation.owner_notice", { team_id: team.id, type }, () =>
    notify({
      userId: ownerId,
      type,
      entityType: "team",
      entityId: team.id,
      data: {
        teamId: team.id,
        teamSlug: team.slug,
        teamName: team.name,
        ...(mod.reason ? { reason: mod.reason } : {}),
        ...data,
      },
    }),
  );
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

/** The name-and-tagline subset a crew is minted from at accept time. */
export const teamQuickCreateSchema = z.object({
  name: teamContentShape.name,
  tagline: teamContentShape.tagline,
});

type TeamContent = z.infer<z.ZodObject<typeof teamContentShape>>;

/**
 * Inserts a team owned by `userId` and seats them as its owner. The one
 * team-minting path: `createTeam` wraps it for the directory and the
 * wizard, and `acceptAndInvite` runs it inside the accept transaction so a
 * crew that fails to link never exists.
 *
 * The name only is profanity-checked: it is the team's identity and titles
 * every invite and membership notification. Tagline and bio are prose,
 * stored as written and censored at render.
 */
export async function createTeamForUser(
  executor: DbExecutor,
  userId: string,
  input: Partial<TeamContent> & Pick<TeamContent, "name">,
): Promise<TeamRow> {
  checkProfanity(input.name, "Team name");

  // A slug race between the pre-check and the insert lands on the
  // unique constraint; retry once with a fresh suffix before giving up.
  let team: TeamRow | undefined;
  for (let attempt = 0; attempt < 2 && !team; attempt++) {
    const slug = await claimSlug(executor, input.name);
    [team] = await executor
      .insert(teams)
      .values({
        slug,
        name: input.name,
        tagline: input.tagline || null,
        bio: input.bio || null,
        websiteUrl: input.websiteUrl || null,
        itchUrl: input.itchUrl || null,
        recruiting: input.recruiting ?? false,
        createdBy: userId,
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

  await executor.insert(teamMembers).values({
    teamId: team.id,
    userId,
    role: "owner",
  });

  return team;
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
    const team = await createTeamForUser(db, context.user.id, input);
    captureServerEvent(EVENTS.teamCreated, context.user.id, { team_id: team.id });
    return team;
  });

type TeamRow = typeof teams.$inferSelect;

/** Shared by the direct procedure and the proposal executor — the one
 * validation contract for a staff content edit. */
export const teamUpdatePatchSchema = z.object({
  name: teamContentShape.name.optional(),
  tagline: z.string().trim().max(200).optional().nullable(),
  bio: z.string().max(5000).optional().nullable(),
  websiteUrl: z.url().max(500).optional().nullable().or(z.literal("")),
  itchUrl: z.url().max(500).optional().nullable().or(z.literal("")),
  recruiting: z.boolean().optional(),
});
export type TeamUpdatePatch = z.infer<typeof teamUpdatePatchSchema>;

export async function applyTeamUpdate(team: TeamRow, patch: TeamUpdatePatch, mod?: ModOverride) {
  checkProfanity(patch.name, "Team name");

  const [updated] = await db
    .update(teams)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.tagline !== undefined ? { tagline: patch.tagline || null } : {}),
      ...(patch.bio !== undefined ? { bio: patch.bio || null } : {}),
      ...(patch.websiteUrl !== undefined ? { websiteUrl: patch.websiteUrl || null } : {}),
      ...(patch.itchUrl !== undefined ? { itchUrl: patch.itchUrl || null } : {}),
      ...(patch.recruiting !== undefined ? { recruiting: patch.recruiting } : {}),
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(teams.id, team.id))
    .returning();

  if (mod) {
    const touched = (Object.keys(patch) as (keyof TeamUpdatePatch)[]).filter(
      (key) => patch[key] !== undefined,
    );
    await recordTeamModAction({
      action: "team_updated",
      mod,
      team,
      metadata: {
        fields: touched,
        previous: Object.fromEntries(touched.map((key) => [key, team[key]])),
      },
    });
    await notifyTeamOwner(team, "team_updated_by_staff", mod);
  }

  return updated;
}

export const updateTeam = os
  .use(requireAuthWithPermissions)
  .input(
    z.object({ teamId: z.string(), reason: overrideReasonSchema, ...teamUpdatePatchSchema.shape }),
  )
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);
    const { isOverride } = await requireOwnershipOrOverride("team_update", team.id, context);
    assertNotFrozen(team, isOverride);

    const { teamId: _teamId, reason, ...patch } = input;
    return applyTeamUpdate(
      team,
      patch,
      isOverride ? { actorId: context.user.id, reason: reason ?? null } : undefined,
    );
  });

export const teamSlugPatchSchema = z.object({ slug: z.string().min(3).max(32) });

/** Handle checks (shape, reserved words, profanity, collision) run here so
 * they hold on the owner path, a staff override, and an approved proposal. */
export async function applyTeamSlug(team: TeamRow, slugInput: string, mod?: ModOverride) {
  const slug = slugInput.toLowerCase().trim();
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
  if (existing && existing.id !== team.id) {
    throw new ORPCError("CONFLICT", { message: "This handle is already taken." });
  }

  const [updated] = await db
    .update(teams)
    .set({ slug, updatedAt: new Date() })
    .where(eq(teams.id, team.id))
    .returning();

  if (mod) {
    await recordTeamModAction({
      action: "team_slug_updated",
      mod,
      team,
      metadata: { from: team.slug, to: slug },
    });
    await notifyTeamOwner(team, "team_updated_by_staff", mod, { field: "handle" });
  }
  return updated;
}

export const setTeamSlug = os
  .use(requireAuthWithPermissions)
  .input(
    z.object({ teamId: z.string(), reason: overrideReasonSchema, ...teamSlugPatchSchema.shape }),
  )
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);
    const { isOverride } = await requireOwnershipOrOverride("team_slug", team.id, context);
    assertNotFrozen(team, isOverride);

    return applyTeamSlug(
      team,
      input.slug,
      isOverride ? { actorId: context.user.id, reason: input.reason ?? null } : undefined,
    );
  });

export const teamImageClearSchema = z.object({ kind: z.enum(["avatar", "banner"]) });

/** Today an offensive banner is irremovable by anyone but the owner — and
 * even the owner can only replace it. Nulls the image and sweeps the object. */
export async function applyTeamImageClear(
  team: TeamRow,
  kind: "avatar" | "banner",
  mod?: ModOverride,
) {
  const previousKey = kind === "banner" ? team.bannerKey : team.avatarKey;
  const previousUrl = kind === "banner" ? team.bannerUrl : team.avatarUrl;

  await db
    .update(teams)
    .set({
      ...(kind === "banner"
        ? { bannerKey: null, bannerUrl: null }
        : { avatarKey: null, avatarUrl: null }),
      updatedAt: new Date(),
    })
    .where(eq(teams.id, team.id));

  if (previousKey) {
    await bestEffort("storage.image_cleanup", { key: previousKey, on: "team_image_clear" }, () =>
      removeProfileProjectImageFromStorage(previousKey),
    );
  }

  if (mod) {
    await recordTeamModAction({
      action: "team_image_cleared",
      mod,
      team,
      metadata: { kind, previousUrl, previousKey },
    });
    await notifyTeamOwner(team, "team_updated_by_staff", mod, { field: kind });
  }
  return { success: true };
}

export const clearTeamImage = os
  .use(requireAuthWithPermissions)
  .input(
    z.object({ teamId: z.string(), reason: overrideReasonSchema, ...teamImageClearSchema.shape }),
  )
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);
    const { isOverride } = await requireOwnershipOrOverride("team_image_clear", team.id, context);
    assertNotFrozen(team, isOverride);

    return applyTeamImageClear(
      team,
      input.kind,
      isOverride ? { actorId: context.user.id, reason: input.reason ?? null } : undefined,
    );
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
    const team = await getTeamRow(input.teamId);
    await requireOwnership(input.teamId, context.user.id);
    assertNotFrozen(team, false);

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
export async function applyTeamDelete(team: TeamRow, mod?: ModOverride) {
  // Showcase covers in the team's namespace go down with the team; the
  // rows cascade, so collect keys first. Imported rows keep user-scoped
  // keys and are filtered out by the namespace check.
  const showcaseImages = await db
    .select({ imageKey: teamProjects.imageKey })
    .from(teamProjects)
    .where(eq(teamProjects.teamId, team.id));
  const showcaseKeys = showcaseImages
    .map(({ imageKey }) => imageKey)
    .filter((key): key is string => !!key && isTeamProjectImageKey(team.id, key));

  const roster = mod
    ? await db
        .select({ userId: teamMembers.userId, role: teamMembers.role })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, team.id))
    : [];

  // An admin delete closes the report queue's book first — the hard delete
  // would orphan the rows a moment later, and the reporters deserve the
  // "actioned" answer. Owner deletes leave their reports orphaned via
  // SET NULL, which is the queue's cue to render "TEAM DELETED".
  let resolvedReportIds: number[] = [];
  if (mod) {
    const resolved = await resolveReportsForSubject({
      kind: "team",
      subjectId: team.id,
      actorId: mod.actorId,
    });
    resolvedReportIds = resolved.map((r) => r.id);
    await notifyReporters({
      reports: resolved,
      actorId: mod.actorId,
      outcome: "actioned",
      entityType: "team",
      entityId: team.id,
      subjectTitle: team.name,
      subjectUrl: null,
    });
  }

  await db.delete(teams).where(eq(teams.id, team.id));

  // Replaced images are cleaned at replace time, so the current keys are
  // the only objects this team owns. Best-effort — an orphaned object is
  // a storage leak, not a correctness problem.
  for (const key of [team.avatarKey, team.bannerKey, ...showcaseKeys]) {
    if (key) {
      await bestEffort("storage.image_cleanup", { key, on: "team_delete" }, () =>
        removeProfileProjectImageFromStorage(key),
      );
    }
  }

  if (mod) {
    // The hard delete destroys its own evidence, so the log keeps the row.
    await recordTeamModAction({
      action: "team_deleted",
      mod,
      team,
      subjectUserId: roster.find((m) => m.role === "owner")?.userId ?? null,
      metadata: {
        team: { ...team, hiddenAt: team.hiddenAt?.toISOString() ?? null },
        roster,
        ...(resolvedReportIds.length > 0 ? { resolvedReportIds } : {}),
      },
    });
    for (const member of roster) {
      if (member.userId === mod.actorId) continue;
      await bestEffort("team_moderation.delete_notice", { team_id: team.id }, () =>
        notify({
          userId: member.userId,
          type: "team_deleted_by_staff",
          entityType: "team",
          entityId: team.id,
          data: {
            teamName: team.name,
            ...(mod.reason ? { reason: mod.reason } : {}),
          },
        }),
      );
    }
  }
  return { success: true };
}

export const deleteTeam = os
  .use(requireAuthWithPermissions)
  .input(z.object({ teamId: z.string(), reason: overrideReasonSchema }))
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);
    const { isOverride } = await requireOwnershipOrOverride("team_delete", team.id, context);
    assertNotFrozen(team, isOverride);
    if (isOverride && !input.reason) {
      throw new ORPCError("BAD_REQUEST", { message: "A reason is required to delete a team." });
    }

    return applyTeamDelete(
      team,
      isOverride ? { actorId: context.user.id, reason: input.reason ?? null } : undefined,
    );
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

/** The full team-page payload, shared by the public read and the insider
 * fallback so a hidden team renders identically for those allowed to see it. */
async function buildTeamPagePayload(team: TeamRow) {
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
      .leftJoin(profileUrlStubs, profileStubJoin)
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
}

/**
 * A team as everyone sees it. The viewer's own standing — their role, a
 * pending invite, the owner's invite queue — lives in
 * `getTeamViewerState`, which is what lets this response be identical for
 * every caller and cached at the edge. A hidden team does not exist here:
 * members and staff reach it through `getTeamForInsider` instead.
 */
export const getTeam = os
  .route({ method: "GET" })
  .input(z.object({ teamId: z.string() }))
  .handler(async ({ input }) => {
    const team = await resolveTeam(input.teamId);
    if (!team || team.hiddenAt) return null;
    return buildTeamPagePayload(team);
  });

/**
 * The team page's fallback when `getTeam` misses and a session exists:
 * the full payload for the team's own members and for staff, null for
 * everyone else — so a hidden page stays reachable by exactly the people
 * investigating it or being investigated.
 */
export const getTeamForInsider = os
  .use(requireAuthWithPermissions)
  .input(z.object({ teamId: z.string() }))
  .handler(async ({ input, context }) => {
    const team = await resolveTeam(input.teamId);
    if (!team) return null;
    const membership = await getMembership(team.id, context.user.id);
    if (!membership && !context.isStaff) return null;
    // Which moderator hid it stays out of the payload — same rule as the
    // owner notification; the moderation log is the place for that.
    const { hiddenById: _hiddenById, ...payload } = await buildTeamPagePayload(team);
    return {
      ...payload,
      viewerIsMember: membership != null,
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
  .use(requireAuthWithPermissions)
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
      // What lets the page show MANAGE to staff non-members, and the
      // flyout know to render staff mode.
      isStaffViewer: context.isStaff,
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
        // Members deserve to see the state, so a hidden team stays on this
        // list flagged — the wizard picker filters it out client-side and
        // `assertTeamLinkable` re-checks server-side.
        hiddenAt: teams.hiddenAt,
        role: teamMembers.role,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(and(eq(teamMembers.userId, context.user.id), eq(teams.status, "active")))
      .orderBy(asc(teams.name));
    return (await withTeamCardExtras(rows)).map(({ hiddenAt, ...row }) => ({
      ...row,
      hidden: hiddenAt != null,
    }));
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
  const conditions = [eq(teams.status, "active"), isNull(teams.hiddenAt)];
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
    .where(and(eq(teams.status, "active"), isNull(teams.hiddenAt)));

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
      .where(
        and(
          eq(teamMembers.userId, input.userId),
          eq(teams.status, "active"),
          isNull(teams.hiddenAt),
        ),
      )
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
 * Matches **both** names a profile can carry, because searching for the name you
 * can see is the only thing anyone tries: `memberName` shows the nickname ahead
 * of the handle, so a nickname-only match was invisible to a username search.
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
      .where(profileNameSearch(pattern))
      .limit(8);

    return rows.map(({ guildNickname, ...row }) => ({
      ...row,
      // The name the rest of the app shows. `username` stays for the invite
      // picker, which renders the handle deliberately.
      displayName: memberName({ guildNickname, discordUsername: row.username }, "Unknown"),
    }));
  });

const ALREADY_INVITED = "That person already has a pending invite.";

/**
 * Any active member can invite — jam crews are flat, and the accept →
 * invite handoff comes from post authors who may not be the owner.
 * Removal and role changes stay owner-only.
 */
/**
 * Who may be invited where. Shared by the direct invite and the accept-time
 * handoff so the two can't drift: never yourself, only people with a
 * profile, nobody already seated, nobody across a block, and one live
 * invite per person per team. `teamId` is omitted when the team is about to
 * be minted in the same transaction — the roster and invite checks have
 * nothing to read yet.
 */
export async function assertCanInvite(params: {
  teamId?: string;
  inviterId: string;
  inviteeId: string;
}): Promise<void> {
  if (params.inviteeId === params.inviterId) {
    throw new ORPCError("BAD_REQUEST", { message: "You are already on this team." });
  }

  const [inviteeProfile] = await db
    .select({ id: developerProfiles.id })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, params.inviteeId))
    .limit(1);
  if (!inviteeProfile) {
    throw new ORPCError("BAD_REQUEST", { message: "That person doesn't have a profile." });
  }

  // Neutral on purpose — never reveal a block or its direction.
  if (await blockPairExists(params.inviteeId, params.inviterId)) {
    throw new ORPCError("FORBIDDEN", { message: "You can't invite this person." });
  }

  if (params.teamId === undefined) return;

  if (await getMembership(params.teamId, params.inviteeId)) {
    throw new ORPCError("BAD_REQUEST", { message: "That person is already on this team." });
  }

  const [existing] = await db
    .select({ id: teamInvites.id })
    .from(teamInvites)
    .where(
      and(
        eq(teamInvites.teamId, params.teamId),
        eq(teamInvites.inviteeId, params.inviteeId),
        eq(teamInvites.status, "pending"),
      ),
    )
    .limit(1);
  if (existing) {
    throw new ORPCError("BAD_REQUEST", { message: ALREADY_INVITED });
  }
}

/** The invite row itself; racing duplicates land on the partial unique
 *  index and read back as the same "already invited" the pre-check gives. */
export async function insertTeamInvite(
  executor: DbExecutor,
  values: {
    teamId: string;
    inviteeId: string;
    invitedBy: string;
    sourceResponseId?: number;
    message?: string;
  },
) {
  const [invite] = await executor
    .insert(teamInvites)
    .values(values)
    .returning()
    .catch((err: unknown) => {
      if (isUniqueViolation(err)) {
        throw new ORPCError("BAD_REQUEST", { message: ALREADY_INVITED });
      }
      throw err;
    });
  return invite!;
}

/** The invitee's notification — one shape for every invite path. */
export async function notifyTeamInvite(
  team: { id: string; slug: string; name: string },
  invite: { id: number; inviteeId: string },
  actorId: string,
): Promise<void> {
  await notify({
    userId: invite.inviteeId,
    type: "team_invite_received",
    actorId,
    entityType: "team_invite",
    entityId: String(invite.id),
    data: { teamId: team.id, teamSlug: team.slug, teamName: team.name, inviteId: invite.id },
  });
}

export const inviteToTeam = os
  .use(requireAuthWithPermissions)
  .input(
    z.object({
      teamId: z.string(),
      inviteeId: z.string(),
      message: z.string().max(1000).optional(),
      sourceResponseId: z.number().int().positive().optional(),
      reason: overrideReasonSchema,
    }),
  )
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);
    // Archived stays a hard stop for everyone — accepting the invite would
    // refuse anyway. Hidden freezes the member path only.
    if (team.status !== "active") {
      throw new ORPCError("BAD_REQUEST", { message: "This team is archived." });
    }
    // Staff "forcefully add" is invite-on-behalf: consent survives because
    // the invitee still accepts, and `invitedBy` names the staff member —
    // the invitee sees who invited them.
    const { isOverride } = await requireMembershipOrOverride("team_invite", team.id, context);
    assertNotFrozen(team, isOverride);

    await assertCanInvite({
      teamId: input.teamId,
      inviterId: context.user.id,
      inviteeId: input.inviteeId,
    });

    await assertRateLimit(
      "team-invite",
      context.user.id,
      50,
      "You've sent a lot of invites today — try again tomorrow.",
      86400,
    );

    const invite = await insertTeamInvite(db, {
      teamId: input.teamId,
      inviteeId: input.inviteeId,
      invitedBy: context.user.id,
      sourceResponseId: input.sourceResponseId,
      message: input.message,
    });

    await notifyTeamInvite(team, invite, context.user.id);

    await touchTeamActivity(input.teamId);

    if (isOverride) {
      await recordTeamModAction({
        action: "team_member_invited",
        mod: { actorId: context.user.id, reason: input.reason ?? null },
        team,
        subjectUserId: input.inviteeId,
        metadata: { inviteId: invite.id, inviteeId: input.inviteeId },
      });
    }

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
    // Neutral on purpose — the hide and its reason are the owner's notice,
    // not the invitee's. Decline still works.
    if (input.accept && team.hiddenAt) {
      throw new ORPCError("BAD_REQUEST", { message: "This team is unavailable right now." });
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

export const teamMemberRemoveSchema = z.object({ userId: z.string() });

export async function applyMemberRemoval(
  team: TeamRow,
  userId: string,
  actorId: string,
  mod?: ModOverride,
) {
  const target = await getMembership(team.id, userId);
  if (!target) {
    throw new ORPCError("NOT_FOUND", { message: "That person is not on this team." });
  }
  if (mod) {
    // Staff removing an owner or the last member is a team takedown wearing
    // the wrong verb — transfer or hide/delete are the honest tools.
    if (target.role === "owner") {
      throw new ORPCError("BAD_REQUEST", { message: "Transfer ownership first." });
    }
    const [{ memberCount }] = await db
      .select({ memberCount: count() })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, team.id));
    if (memberCount <= 1) {
      throw new ORPCError("BAD_REQUEST", { message: "Hide or delete the team instead." });
    }
  }

  await db.delete(teamMembers).where(eq(teamMembers.id, target.id));

  // On the staff path the actor is deliberately absent — the removed member
  // sees the staff reason, not the staff member.
  await notify({
    userId,
    type: "team_member_removed",
    ...(mod ? {} : { actorId }),
    entityType: "team",
    entityId: team.id,
    data: {
      teamId: team.id,
      teamSlug: team.slug,
      teamName: team.name,
      ...(mod ? { byStaff: true, ...(mod.reason ? { reason: mod.reason } : {}) } : {}),
    },
  });

  await touchTeamActivity(team.id);

  if (mod) {
    await recordTeamModAction({
      action: "team_member_removed",
      mod,
      team,
      subjectUserId: userId,
      metadata: { removedUserId: userId, role: target.role, title: target.title },
    });
    await notifyTeamOwner(team, "team_member_removed_by_staff", mod, { removedUserId: userId });
  }

  return { success: true };
}

export const removeMember = os
  .use(requireAuthWithPermissions)
  .input(z.object({ teamId: z.string(), userId: z.string(), reason: overrideReasonSchema }))
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);
    const { isOverride } = await requireOwnershipOrOverride("team_member_remove", team.id, context);
    assertNotFrozen(team, isOverride);

    if (input.userId === context.user.id) {
      throw new ORPCError("BAD_REQUEST", { message: "Use leave team instead." });
    }

    return applyMemberRemoval(
      team,
      input.userId,
      context.user.id,
      isOverride ? { actorId: context.user.id, reason: input.reason ?? null } : undefined,
    );
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
    // Never trap a user in a team: leaving stays allowed even while hidden.
    const team = await getTeamRow(input.teamId);
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
      // A hidden team's posts are already degraded, and `party_full` is a
      // one-way door the unhide couldn't reopen.
      if (!team.hiddenAt) {
        await db
          .update(collabPosts)
          .set({ status: "party_full", updatedAt: new Date() })
          .where(and(eq(collabPosts.teamId, input.teamId), eq(collabPosts.status, "recruiting")));
      }
    }

    captureServerEvent(EVENTS.teamLeft, context.user.id, {
      team_id: input.teamId,
      team_archived: memberCount === 1,
    });

    return { success: true };
  });

export const teamTransferSchema = z.object({ userId: z.string() });

export async function applyOwnershipTransfer(team: TeamRow, userId: string, mod?: ModOverride) {
  const target = await getMembership(team.id, userId);
  if (!target) {
    throw new ORPCError("BAD_REQUEST", { message: "That person is not on this team." });
  }
  if (target.role === "owner") {
    throw new ORPCError("BAD_REQUEST", { message: "That person already owns this team." });
  }

  const previousOwnerId = await getTeamOwnerId(team.id);
  await db.update(teamMembers).set({ role: "owner" }).where(eq(teamMembers.id, target.id));
  if (previousOwnerId) {
    await db
      .update(teamMembers)
      .set({ role: "member" })
      .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, previousOwnerId)));
  }

  if (mod) {
    await recordTeamModAction({
      action: "team_ownership_transferred",
      mod,
      team,
      subjectUserId: previousOwnerId,
      metadata: { from: previousOwnerId, to: userId },
    });
    if (previousOwnerId && previousOwnerId !== mod.actorId) {
      await bestEffort("team_moderation.owner_notice", { team_id: team.id }, () =>
        notify({
          userId: previousOwnerId,
          type: "team_ownership_transferred_by_staff",
          entityType: "team",
          entityId: team.id,
          data: {
            teamId: team.id,
            teamSlug: team.slug,
            teamName: team.name,
            ...(mod.reason ? { reason: mod.reason } : {}),
          },
        }),
      );
    }
  }

  return { success: true };
}

export const transferOwnership = os
  .use(requireAuthWithPermissions)
  .input(z.object({ teamId: z.string(), userId: z.string(), reason: overrideReasonSchema }))
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);
    const { isOverride } = await requireOwnershipOrOverride("team_transfer", team.id, context);
    assertNotFrozen(team, isOverride);

    return applyOwnershipTransfer(
      team,
      input.userId,
      isOverride ? { actorId: context.user.id, reason: input.reason ?? null } : undefined,
    );
  });

export const teamTitleEditSchema = z.object({
  memberId: z.number().int().positive(),
  title: z.string().trim().max(100).nullable(),
});

export async function applyMemberTitle(
  team: TeamRow,
  membershipId: number,
  title: string | null,
  mod?: ModOverride,
) {
  const [target] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.id, membershipId), eq(teamMembers.teamId, team.id)))
    .limit(1);
  if (!target) {
    throw new ORPCError("NOT_FOUND", { message: "That person is not on this team." });
  }

  const [updated] = await db
    .update(teamMembers)
    .set({ title: title || null })
    .where(eq(teamMembers.id, target.id))
    .returning();

  if (mod) {
    await recordTeamModAction({
      action: "team_member_title_updated",
      mod,
      team,
      subjectUserId: target.userId,
      metadata: { memberId: target.id, from: target.title, to: title || null },
    });
  }
  return updated;
}

/**
 * Self-edit stays open to any member; the owner and staff overrides may
 * edit anyone's roster title — offensive craft labels were previously
 * self-edit-only, i.e. unfixable.
 */
export const updateMemberTitle = os
  .use(requireAuthWithPermissions)
  .input(
    z.object({
      teamId: z.string(),
      title: z.string().trim().max(100).nullable(),
      memberId: z.number().int().positive().optional(),
      reason: overrideReasonSchema,
    }),
  )
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);

    if (input.memberId == null) {
      const membership = await requireMembership(input.teamId, context.user.id);
      assertNotFrozen(team, false);
      const [updated] = await db
        .update(teamMembers)
        .set({ title: input.title || null })
        .where(eq(teamMembers.id, membership.id))
        .returning();
      return updated;
    }

    const own = await getMembership(team.id, context.user.id);
    if (own && own.id === input.memberId) {
      assertNotFrozen(team, false);
      const [updated] = await db
        .update(teamMembers)
        .set({ title: input.title || null })
        .where(eq(teamMembers.id, own.id))
        .returning();
      return updated;
    }

    const { isOverride } = await requireOwnershipOrOverride("team_title_edit", team.id, context);
    assertNotFrozen(team, isOverride);
    return applyMemberTitle(
      team,
      input.memberId,
      input.title,
      isOverride ? { actorId: context.user.id, reason: input.reason ?? null } : undefined,
    );
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
    assertNotFrozen(team, false);
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
    assertNotFrozen(team, false);

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

/** The patch a proposal can carry: the prose and the cover-clear, without
 * the upload plumbing a live editor session needs. */
export const teamProjectPatchSchema = z.object({
  projectId: z.string(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  url: optionalUrlSchema.nullable().optional(),
  /** `null` clears the cover; omitted leaves it untouched. */
  image: z.null().optional(),
});

type TeamProjectRow = typeof teamProjects.$inferSelect;
type TeamProjectPatch = {
  title?: string;
  description?: string | null;
  url?: string | null;
  image?: { key: string; filename: string; mimeType: string; sizeBytes: number } | null;
  pinned?: boolean;
  sortOrder?: number;
};

export async function applyTeamProjectUpdate(
  team: TeamRow,
  project: TeamProjectRow,
  input: TeamProjectPatch,
  mod?: ModOverride,
) {
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
    .where(eq(teamProjects.id, project.id))
    .returning();

  // Only objects in this team's namespace are swept — an imported row can
  // share its key with the source profile project, and that object belongs
  // to the member's own placement.
  const previousKey = project.imageKey;
  if (
    input.image !== undefined &&
    previousKey &&
    previousKey !== input.image?.key &&
    isTeamProjectImageKey(team.id, previousKey)
  ) {
    await bestEffort("storage.image_cleanup", { key: previousKey, on: "team_project_update" }, () =>
      removeProfileProjectImageFromStorage(previousKey),
    );
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

  if (mod) {
    await recordTeamModAction({
      action: "team_project_updated",
      mod,
      team,
      subjectUserId: project.addedBy,
      targetId: project.id,
      metadata: {
        projectId: project.id,
        previous: { title: project.title, description: project.description, url: project.url },
        ...(input.image === null ? { coverCleared: true } : {}),
      },
    });
    await notifyTeamOwner(team, "team_updated_by_staff", mod, { projectTitle: project.title });
  }

  return serializeTeamProject(updated);
}

export const updateTeamProject = os
  .use(requireAuthWithPermissions)
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
      reason: overrideReasonSchema,
    }),
  )
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);
    const { membership, isOverride } = await requireMembershipOrOverride(
      "team_project_update",
      team.id,
      context,
    );
    assertNotFrozen(team, isOverride);

    const [project] = await db
      .select()
      .from(teamProjects)
      .where(and(eq(teamProjects.id, input.projectId), eq(teamProjects.teamId, input.teamId)))
      .limit(1);
    if (!project) {
      throw new ORPCError("NOT_FOUND", { message: "Project not found." });
    }
    if (!isOverride && membership!.role !== "owner" && project.addedBy !== context.user.id) {
      throw new ORPCError("FORBIDDEN", {
        message: "Only the owner or whoever added this project can edit it.",
      });
    }
    if (input.image && !isTeamProjectImageKey(input.teamId, input.image.key)) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Uploaded image does not belong to this team.",
      });
    }

    const { teamId: _teamId, projectId: _projectId, reason, ...patch } = input;
    return applyTeamProjectUpdate(
      team,
      project,
      patch,
      isOverride ? { actorId: context.user.id, reason: reason ?? null } : undefined,
    );
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
export const teamProjectRemoveSchema = z.object({ projectId: z.string() });

export async function applyTeamProjectRemoval(
  team: TeamRow,
  project: { id: string; title: string; addedBy: string | null; imageKey: string | null },
  mod?: ModOverride,
) {
  await db.delete(teamProjects).where(eq(teamProjects.id, project.id));
  // Only team-namespace objects are swept: imported rows share their image
  // object with the source profile project, and that key stays theirs.
  if (project.imageKey && isTeamProjectImageKey(team.id, project.imageKey)) {
    const key = project.imageKey;
    await bestEffort("storage.image_cleanup", { key, on: "team_project_delete" }, () =>
      removeProfileProjectImageFromStorage(key),
    );
  }

  if (mod) {
    await recordTeamModAction({
      action: "team_project_removed",
      mod,
      team,
      subjectUserId: project.addedBy,
      targetId: project.id,
      metadata: { projectId: project.id, projectTitle: project.title },
    });
    await notifyTeamOwner(team, "team_updated_by_staff", mod, { projectTitle: project.title });
  }
  return { success: true };
}

export const removeTeamProject = os
  .use(requireAuthWithPermissions)
  .input(z.object({ teamId: z.string(), projectId: z.string(), reason: overrideReasonSchema }))
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);
    const { membership, isOverride } = await requireMembershipOrOverride(
      "team_project_remove",
      team.id,
      context,
    );
    assertNotFrozen(team, isOverride);

    const [project] = await db
      .select({
        id: teamProjects.id,
        title: teamProjects.title,
        addedBy: teamProjects.addedBy,
        imageKey: teamProjects.imageKey,
      })
      .from(teamProjects)
      .where(and(eq(teamProjects.id, input.projectId), eq(teamProjects.teamId, input.teamId)))
      .limit(1);
    if (!project) {
      throw new ORPCError("NOT_FOUND", { message: "Project not found." });
    }
    if (!isOverride && membership!.role !== "owner" && project.addedBy !== context.user.id) {
      throw new ORPCError("FORBIDDEN", {
        message: "Only the owner or whoever added this project can remove it.",
      });
    }

    return applyTeamProjectRemoval(
      team,
      project,
      isOverride ? { actorId: context.user.id, reason: input.reason ?? null } : undefined,
    );
  });

// ── Moderation: hide + reports (plan 23) ─────────────────────────────────────

/**
 * The urgent, reversible tool — for investigations or preparing for
 * removal. A guarded update so double-hides no-op; only a real transition
 * logs and notifies. Deliberately does not resolve open reports: hide is
 * often mid-investigation, and the report resolution is the closing act.
 */
export async function applySetTeamHidden(
  team: TeamRow,
  hidden: boolean,
  mod: ModOverride,
  extraMetadata: Record<string, unknown> = {},
) {
  const [updated] = await db
    .update(teams)
    .set(
      hidden
        ? {
            hiddenAt: new Date(),
            hiddenById: mod.actorId,
            hiddenReason: mod.reason,
            updatedAt: new Date(),
          }
        : { hiddenAt: null, hiddenById: null, hiddenReason: null, updatedAt: new Date() },
    )
    .where(and(eq(teams.id, team.id), hidden ? isNull(teams.hiddenAt) : isNotNull(teams.hiddenAt)))
    .returning();
  if (!updated) return { success: true, changed: false };

  await recordTeamModAction({
    action: hidden ? "team_hidden" : "team_unhidden",
    mod,
    team,
    metadata: extraMetadata,
  });
  await notifyTeamOwner(team, hidden ? "team_hidden_by_staff" : "team_unhidden_by_staff", mod);

  return { success: true, changed: true };
}

export const setTeamHidden = os
  .use(requireStaff)
  .input(
    z.object({
      teamId: z.string(),
      hidden: z.boolean(),
      reason: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const team = await getTeamRow(input.teamId);
    if (input.hidden && !input.reason) {
      throw new ORPCError("BAD_REQUEST", { message: "A reason is required to hide a team." });
    }
    return applySetTeamHidden(team, input.hidden, {
      actorId: context.user.id,
      reason: input.reason ?? null,
    });
  });

export const reportTeam = os
  .use(requireAuth)
  .input(z.object({ teamId: z.string(), reason: z.string().trim().min(1).max(1000) }))
  .handler(async ({ input, context }) => {
    const [team] = await db.select().from(teams).where(eq(teams.id, input.teamId)).limit(1);
    // A hidden team is not publicly visible, so it is not publicly
    // reportable either — same 404 as the page.
    if (!team || team.hiddenAt) {
      throw new ORPCError("NOT_FOUND", { message: "Team not found." });
    }

    // No profanity check here: a report reason is staff-only text about
    // something abusive, so quoting the abuse must not block the report.

    const [open] = await db
      .select({ id: teamReports.id })
      .from(teamReports)
      .where(
        and(
          eq(teamReports.teamId, team.id),
          eq(teamReports.reporterId, context.user.id),
          isNull(teamReports.resolvedAt),
        ),
      )
      .limit(1);
    if (open) {
      throw new ORPCError("BAD_REQUEST", { message: "You've already reported this team." });
    }

    // Same bucket as `reportPost` and `reportComment`, so a spammer gets
    // 10/hr total across all three surfaces.
    await assertRateLimit("report", context.user.id, 10, "Too many reports — try again later.");

    const [report] = await db
      .insert(teamReports)
      .values({
        teamId: team.id,
        teamName: team.name,
        reporterId: context.user.id,
        reason: input.reason,
      })
      .returning();

    return report;
  });

export const listTeamReports = os
  .use(requireStaff)
  .input(z.object({ includeResolved: z.boolean().default(false) }))
  .handler(async ({ input }) => {
    const rows = await db
      .select({
        id: teamReports.id,
        teamId: teamReports.teamId,
        teamName: teamReports.teamName,
        reporterId: teamReports.reporterId,
        reason: teamReports.reason,
        createdAt: teamReports.createdAt,
        resolvedAt: teamReports.resolvedAt,
        resolvedById: teamReports.resolvedById,
        // Live state beside the snapshot, so the queue can show what the
        // team is *now* — or that it is gone.
        liveName: teams.name,
        liveSlug: teams.slug,
        liveStatus: teams.status,
        liveHiddenAt: teams.hiddenAt,
      })
      .from(teamReports)
      .leftJoin(teams, eq(teamReports.teamId, teams.id))
      .where(input.includeResolved ? undefined : isNull(teamReports.resolvedAt))
      .orderBy(sql`${teamReports.resolvedAt} ASC NULLS FIRST`, desc(teamReports.createdAt));

    const reporterIds = [...new Set(rows.map((r) => r.reporterId))];
    const profiles =
      reporterIds.length > 0
        ? await db
            .select({
              id: developerProfiles.id,
              discordUsername: developerProfiles.discordUsername,
              guildNickname: developerProfiles.guildNickname,
              avatarUrl: developerProfiles.avatarUrl,
            })
            .from(developerProfiles)
            .where(inArray(developerProfiles.id, reporterIds))
        : [];
    const byId = new Map(
      profiles.map((p) => [
        p.id,
        { id: p.id, displayName: memberName(p, "Member"), avatarUrl: p.avatarUrl },
      ]),
    );

    return rows.map((r) => ({ ...r, reporter: byId.get(r.reporterId) ?? null }));
  });

/**
 * Mirrors `resolvePostReport`: dismiss clears the queue entry; `hide_team`
 * also runs the Phase 2 hide via its guarded update, so resolving an
 * already-hidden team's report just closes the report.
 */
export const resolveTeamReport = os
  .use(requireStaff)
  .input(
    z.object({
      reportId: z.number().int().positive(),
      action: z.enum(["dismiss", "hide_team"]),
      /** Recorded in the moderation log and the owner's hide notice. */
      reason: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [report] = await db
      .select()
      .from(teamReports)
      .where(eq(teamReports.id, input.reportId))
      .limit(1);
    if (!report) throw new ORPCError("NOT_FOUND", { message: "Report not found." });
    if (report.resolvedAt) return { success: true };

    const [team] = report.teamId
      ? await db.select().from(teams).where(eq(teams.id, report.teamId)).limit(1)
      : [undefined];

    if (input.action === "hide_team") {
      if (!team) {
        throw new ORPCError("BAD_REQUEST", { message: "That team no longer exists." });
      }
      await applySetTeamHidden(
        team,
        true,
        { actorId: context.user.id, reason: input.reason ?? null },
        { reportId: report.id, reportReason: report.reason },
      );
    }

    // Everyone who reported this team, not just the row that was clicked —
    // orphaned reports (team already deleted) resolve alone.
    const resolved = report.teamId
      ? await resolveReportsForSubject({
          kind: "team",
          subjectId: report.teamId,
          actorId: context.user.id,
        })
      : await db
          .update(teamReports)
          .set({ resolvedAt: new Date(), resolvedById: context.user.id })
          .where(and(eq(teamReports.id, report.id), isNull(teamReports.resolvedAt)))
          .returning({ id: teamReports.id, reporterId: teamReports.reporterId });

    if (input.action === "dismiss") {
      await recordModerationAction({
        action: "team_report_dismissed",
        actorId: context.user.id,
        targetType: "team_report",
        targetId: report.id,
        subjectUserId: report.reporterId,
        reason: input.reason,
        metadata: {
          teamId: report.teamId,
          teamName: report.teamName,
          reportReason: report.reason,
          ...(resolved.length > 1
            ? { alsoResolved: resolved.filter((r) => r.id !== report.id).map((r) => r.id) }
            : {}),
        },
      });
    }

    // Each sibling gets its own row, pointing at the decision that closed it.
    for (const sibling of resolved) {
      if (sibling.id === report.id) continue;
      await recordModerationAction({
        action: input.action === "hide_team" ? "team_hidden" : "team_report_dismissed",
        actorId: context.user.id,
        targetType: "team_report",
        targetId: sibling.id,
        subjectUserId: sibling.reporterId,
        reason: input.reason,
        metadata: { teamId: report.teamId, resolvedVia: report.id },
      });
    }

    await notifyReporters({
      reports: resolved,
      actorId: context.user.id,
      outcome: input.action === "hide_team" ? "actioned" : "no_action",
      entityType: "team",
      entityId: report.teamId ?? report.id,
      subjectTitle: team?.name ?? report.teamName,
      // No link to a page the reporter can no longer see.
      subjectUrl:
        input.action === "dismiss" && team && !team.hiddenAt ? `/teams/${team.slug}` : null,
    });

    return { success: true };
  });
