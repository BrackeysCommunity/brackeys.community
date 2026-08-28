import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import {
  collabPostReports,
  collabPostRoles,
  collabRoles,
  commentReports,
  developerProfiles,
  moderationActions,
  moderationProposals,
  profileUrlStubs,
  session,
  skillRequests,
  skills,
  teamMembers,
  teamProjects,
  teamReports,
  teams,
  user,
  userSkills,
  type ModerationActionType,
  type ModerationProposalTargetType,
} from "@/db/schema";
import { isActiveBan } from "@/lib/ban-state";
import {
  isAdmin as checkIsAdmin,
  isStaffMember as checkIsStaff,
  purgeGuildBanCache,
} from "@/lib/discord";
import { memberName } from "@/lib/member-name";
import { recordModerationAction } from "@/lib/moderation-audit";
import { PROPOSABLE_ACTIONS, type ModOverride, type ModPowerAction } from "@/lib/moderation-policy";
import { notify } from "@/lib/notifications";
import { bestEffort } from "@/lib/posthog-server";
import { escapeLike, likeContains } from "@/lib/sql-like";
import { resolveUserRoles } from "@/lib/staff-roles";
import { authMiddleware, readSession, requireAdmin, requireStaff } from "@/orpc/middleware/auth";
import {
  profileIdentityColumns,
  profileNameSearch,
  profileStubJoin,
} from "@/orpc/profile-projection";
import {
  applyProfileStubReset,
  applyProfileUpdate,
  assertProfileModeratable,
  profileModerationPatchSchema,
} from "@/orpc/router/profile";
import {
  applyMemberRemoval,
  applyMemberTitle,
  applyOwnershipTransfer,
  applyTeamImageClear,
  applyTeamProjectRemoval,
  applyTeamProjectUpdate,
  applyTeamSlug,
  applyTeamUpdate,
  teamImageClearSchema,
  teamMemberRemoveSchema,
  teamProjectPatchSchema,
  teamProjectRemoveSchema,
  teamSlugPatchSchema,
  teamTitleEditSchema,
  teamTransferSchema,
  teamUpdatePatchSchema,
} from "@/orpc/router/team";

/**
 * Staff/admin surface. Everything here backs the `/admin` route; the
 * individual procedures are the real gate — the route's own check is UX.
 */

/** `urlStub` is here so every admin surface can link a person to their
 * profile under the handle they claimed — one left join, and `/admin`
 * stops being the one page in the app where a name is not a link. */
type ProfileSummary = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  urlStub: string | null;
};

async function profilesByIds(userIds: string[]): Promise<Map<string, ProfileSummary>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: developerProfiles.id, ...profileIdentityColumns })
    .from(developerProfiles)
    .leftJoin(profileUrlStubs, profileStubJoin)
    .where(inArray(developerProfiles.id, ids));
  return new Map(
    rows.map((p) => [
      p.id,
      {
        id: p.id,
        displayName: memberName(p, "Member"),
        avatarUrl: p.avatarUrl,
        urlStub: p.urlStub,
      },
    ]),
  );
}

/**
 * Whether the current viewer may see `/admin`. Anonymous and non-staff
 * callers get plain falses, never an error — the route turns that into a
 * 404 so the page's existence leaks nothing.
 */
export const getStaffStatus = os.use(authMiddleware).handler(async ({ context }) => {
  if (!context.user) return { isStaff: false, isAdmin: false };
  const guildRoles = await resolveUserRoles(context.user.id);
  return { isStaff: checkIsStaff(guildRoles), isAdmin: checkIsAdmin(guildRoles) };
});

// ── Bans ────────────────────────────────────────────────────────────────────

const banFields = {
  bannedAt: user.bannedAt,
  bannedUntil: user.bannedUntil,
  unbannedAt: user.unbannedAt,
  banReason: user.banReason,
  bannedById: user.bannedById,
};

export const banUser = os
  .use(requireAdmin)
  .input(
    z.object({
      userId: z.string().min(1),
      reason: z.string().trim().min(1).max(1000),
      /** Null is permanent. */
      durationDays: z.number().int().positive().max(3650).nullable().default(null),
    }),
  )
  .handler(async ({ input, context }) => {
    if (input.userId === context.user.id) {
      throw new ORPCError("BAD_REQUEST", { message: "You can't ban yourself." });
    }

    const [target] = await db
      .select({ id: user.id, ...banFields })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1);
    if (!target) throw new ORPCError("NOT_FOUND", { message: "User not found." });
    if (isActiveBan(target)) {
      throw new ORPCError("BAD_REQUEST", { message: "This user is already banned." });
    }

    // Admins are unbannable — a compromised or confused admin session must
    // not be able to lock the whole staff out.
    if (checkIsAdmin(await resolveUserRoles(input.userId))) {
      throw new ORPCError("BAD_REQUEST", { message: "Admins can't be banned." });
    }

    const now = new Date();
    const bannedUntil =
      input.durationDays == null
        ? null
        : new Date(now.getTime() + input.durationDays * 24 * 60 * 60 * 1000);

    await db
      .update(user)
      .set({
        bannedAt: now,
        bannedUntil,
        // Clear any earlier lift, or `isActiveBan` still reads "not banned".
        unbannedAt: null,
        banReason: input.reason,
        bannedById: context.user.id,
        updatedAt: now,
      })
      .where(eq(user.id, input.userId));

    // Revoke live sessions so the ban is immediate, not next-request-only.
    await db.delete(session).where(eq(session.userId, input.userId));

    await recordModerationAction({
      action: "user_banned",
      actorId: context.user.id,
      targetType: "user",
      targetId: input.userId,
      subjectUserId: input.userId,
      reason: input.reason,
      metadata: {
        durationDays: input.durationDays,
        bannedUntil: bannedUntil?.toISOString() ?? null,
      },
    });

    return { success: true, bannedUntil };
  });

export const unbanUser = os
  .use(requireAdmin)
  .input(z.object({ userId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const [target] = await db
      .select({ id: user.id, ...banFields })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1);
    if (!target) throw new ORPCError("NOT_FOUND", { message: "User not found." });
    if (!isActiveBan(target)) {
      throw new ORPCError("BAD_REQUEST", { message: "This user isn't banned." });
    }

    // Only the lifted-stamp is written; the ban fields stay as the history record.
    await db
      .update(user)
      .set({ unbannedAt: new Date(), updatedAt: new Date() })
      .where(eq(user.id, input.userId));

    // A stale "yes" in the guild-ban cache would re-apply the ban on next sign-in.
    const [profile] = await db
      .select({ discordId: developerProfiles.discordId })
      .from(developerProfiles)
      .where(eq(developerProfiles.id, input.userId))
      .limit(1);
    if (profile?.discordId) {
      await purgeGuildBanCache(profile.discordId).catch(() => {});
    }

    await recordModerationAction({
      action: "user_unbanned",
      actorId: context.user.id,
      targetType: "user",
      targetId: input.userId,
      subjectUserId: input.userId,
      metadata: {
        banReason: target.banReason,
        bannedAt: target.bannedAt?.toISOString() ?? null,
      },
    });

    return { success: true };
  });

/** Everyone who carries a ban record, in force or not. */
export const listBans = os.use(requireStaff).handler(async () => {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      ...banFields,
    })
    .from(user)
    .where(isNotNull(user.bannedAt))
    .orderBy(desc(user.bannedAt));

  const profiles = await profilesByIds(
    rows.flatMap((r) => [r.userId, ...(r.bannedById ? [r.bannedById] : [])]),
  );
  return rows.map((r) => ({
    ...r,
    isActive: isActiveBan(r),
    user: profiles.get(r.userId) ?? { id: r.userId, displayName: r.name, avatarUrl: null },
    bannedBy: r.bannedById ? (profiles.get(r.bannedById) ?? null) : null,
  }));
});

/** Staff-only member lookup. Unlike `searchProfiles`, it carries ban state. */
export const searchMembers = os
  .use(requireStaff)
  .input(
    z.object({
      search: z.string().trim().min(1).max(100),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(25).default(8),
    }),
  )
  .handler(async ({ input }) => {
    const pattern = likeContains(input.search)!;
    const where = or(
      profileNameSearch(pattern),
      eq(developerProfiles.id, input.search),
      eq(developerProfiles.discordId, input.search),
    );

    const [[totals], rows] = await Promise.all([
      db.select({ total: count() }).from(developerProfiles).where(where),
      db
        .select({
          id: developerProfiles.id,
          username: developerProfiles.discordUsername,
          guildNickname: developerProfiles.guildNickname,
          avatarUrl: developerProfiles.avatarUrl,
          guildJoinedAt: developerProfiles.guildJoinedAt,
          memberSince: user.createdAt,
          urlStub: profileUrlStubs.stub,
          ...banFields,
        })
        .from(developerProfiles)
        .innerJoin(user, eq(user.id, developerProfiles.id))
        .leftJoin(profileUrlStubs, profileStubJoin)
        .where(where)
        .orderBy(asc(developerProfiles.discordUsername))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
    ]);

    const total = totals?.total ?? 0;
    return {
      total,
      page: input.page,
      pageSize: input.pageSize,
      pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
      results: rows.map(({ guildNickname, ...row }) => ({
        ...row,
        displayName: memberName({ guildNickname, discordUsername: row.username }, "Member"),
        handle: row.username,
        isBanned: isActiveBan(row),
        wasBanned: row.bannedAt != null,
      })),
    };
  });

/**
 * Outside `authMiddleware` on purpose: it resolves a banned session as anonymous,
 * which is right everywhere but here. Anonymous and unbanned callers get a plain
 * `{ banned: false }`, never an error.
 */
export const getBanStatus = os.handler(async ({ context }) => {
  const session = await readSession(context);
  if (!session || !isActiveBan(session.user)) return { banned: false as const };

  const [row] = await db
    .select({ ...banFields })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  return {
    banned: true as const,
    bannedAt: row?.bannedAt ?? null,
    until: row?.bannedUntil ?? null,
    reason: row?.banReason ?? null,
  };
});

// ── Moderation log ──────────────────────────────────────────────────────────

/** `action` is a free string, not an enum, so a new action type is filterable
 * the day it ships; unknown values match nothing. */
export const listModerationActions = os
  .use(requireStaff)
  .input(
    z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(25),
      actorId: z.string().min(1).optional(),
      subjectUserId: z.string().min(1).optional(),
      action: z.string().min(1).max(64).optional(),
    }),
  )
  .handler(async ({ input }) => {
    const filters = [
      input.actorId ? eq(moderationActions.actorId, input.actorId) : undefined,
      input.subjectUserId ? eq(moderationActions.subjectUserId, input.subjectUserId) : undefined,
      input.action ? eq(moderationActions.action, input.action as ModerationActionType) : undefined,
    ].filter((f) => f != null);
    const where = filters.length > 0 ? and(...filters) : undefined;

    const [[totals], rows] = await Promise.all([
      db.select({ total: count() }).from(moderationActions).where(where),
      db
        .select()
        .from(moderationActions)
        .where(where)
        .orderBy(desc(moderationActions.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
    ]);

    const profiles = await profilesByIds(
      rows.flatMap((r) => [
        ...(r.actorId ? [r.actorId] : []),
        ...(r.subjectUserId ? [r.subjectUserId] : []),
      ]),
    );

    const total = totals?.total ?? 0;
    return {
      total,
      page: input.page,
      pageSize: input.pageSize,
      pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
      actions: rows.map((row) => ({
        ...row,
        actor: row.actorId ? (profiles.get(row.actorId) ?? null) : null,
        subject: row.subjectUserId ? (profiles.get(row.subjectUserId) ?? null) : null,
      })),
    };
  });

// ── Skill requests ──────────────────────────────────────────────────────────

const vocabNameSchema = z.string().trim().min(1).max(100);
const vocabCategorySchema = z
  .string()
  .trim()
  .max(100)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable();

/**
 * The catalogue name is unique but case-sensitively so — an exact `ilike`
 * (no wildcards, hence the escape) is what "already exists" actually means
 * to a moderator looking at "c#" next to "C#".
 */
async function findSkillByName(name: string) {
  const [match] = await db
    .select({ id: skills.id, name: skills.name, category: skills.category })
    .from(skills)
    .where(ilike(skills.name, escapeLike(name)))
    .limit(1);
  return match ?? null;
}

export const listSkillRequests = os
  .use(requireStaff)
  .input(
    z.object({
      status: z.enum(["pending", "handled"]).default("pending"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(10),
    }),
  )
  .handler(async ({ input }) => {
    // "handled" is the complement of "pending", not a superset of it: the
    // toggle is a filter, so the two views never show the same row twice.
    const where =
      input.status === "pending"
        ? eq(skillRequests.status, "pending")
        : ne(skillRequests.status, "pending");

    const [[totals], rows] = await Promise.all([
      db.select({ total: count() }).from(skillRequests).where(where),
      db
        .select()
        .from(skillRequests)
        .where(where)
        .orderBy(desc(skillRequests.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
    ]);

    const profiles = await profilesByIds(rows.map((r) => r.userId));

    // Which requests already have a catalogue entry under that name, so the
    // queue can say "this is a duplicate of C#" before anyone clicks approve.
    const names = rows.map((r) => r.name.toLowerCase());
    const matches = names.length
      ? await db
          .select({ id: skills.id, name: skills.name, category: skills.category })
          .from(skills)
          .where(inArray(sql`lower(${skills.name})`, names))
      : [];
    const matchByName = new Map(matches.map((m) => [m.name.toLowerCase(), m]));

    const total = totals?.total ?? 0;
    return {
      items: rows.map((r) => ({
        ...r,
        requester: profiles.get(r.userId) ?? null,
        existingSkill: matchByName.get(r.name.toLowerCase()) ?? null,
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
      pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
    };
  });

/**
 * Approve as-requested, under a corrected name, or against a skill that
 * already exists. All three land the same way for the requester — the skill
 * shows up on their profile — which is why they're one endpoint rather than
 * three: the request row is rewritten to record what was actually granted.
 */
export const approveSkillRequest = os
  .use(requireStaff)
  .input(
    z.object({
      requestId: z.number().int().positive(),
      /** Rename before approving. Ignored when `skillId` is given. */
      name: vocabNameSchema.optional(),
      category: vocabCategorySchema.optional(),
      /** Resolve against an existing catalogue entry instead of creating one. */
      skillId: z.number().int().positive().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [request] = await db
      .select()
      .from(skillRequests)
      .where(eq(skillRequests.id, input.requestId))
      .limit(1);
    if (!request) throw new ORPCError("NOT_FOUND", { message: "Skill request not found." });
    if (request.status !== "pending") {
      throw new ORPCError("BAD_REQUEST", { message: "This request was already handled." });
    }

    let resolved: { id: number; name: string; category: string | null } | null = null;
    if (input.skillId != null) {
      const [skill] = await db
        .select({ id: skills.id, name: skills.name, category: skills.category })
        .from(skills)
        .where(eq(skills.id, input.skillId))
        .limit(1);
      if (!skill) throw new ORPCError("NOT_FOUND", { message: "That skill no longer exists." });
      resolved = skill;
    } else {
      const name = input.name ?? request.name;
      const category = input.category === undefined ? request.category : input.category;
      // A name that already exists resolves to that entry rather than
      // erroring — approving a near-duplicate is the common case, not a
      // mistake, and the catalogue's unique index would reject it anyway.
      resolved = await findSkillByName(name);
      if (!resolved) {
        const [created] = await db
          .insert(skills)
          .values({ name, category })
          .onConflictDoNothing()
          .returning({ id: skills.id, name: skills.name, category: skills.category });
        resolved = created ?? (await findSkillByName(name));
      }
      if (!resolved) throw new Error(`skill "${name}" missing after upsert`);
    }

    const skill = resolved;
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: userSkills.id })
        .from(userSkills)
        .where(and(eq(userSkills.userId, request.userId), eq(userSkills.skillId, skill.id)))
        .limit(1);
      if (!existing) {
        await tx.insert(userSkills).values({ userId: request.userId, skillId: skill.id });
      }

      await tx
        .update(skillRequests)
        .set({ status: "approved", name: skill.name, category: skill.category })
        .where(eq(skillRequests.id, request.id));
    });

    await recordModerationAction({
      action: "skill_request_approved",
      actorId: context.user.id,
      targetType: "skill_request",
      targetId: request.id,
      subjectUserId: request.userId,
      metadata: {
        requestedName: request.name,
        grantedName: skill.name,
        skillId: skill.id,
        // The interesting case: what they asked for isn't what they got.
        renamed: skill.name !== request.name,
      },
    });

    // `requestedName` is what they typed; naming both sides is the point
    // when staff corrected the casing or matched an existing entry.
    await notifyRequester(request.userId, {
      type: "skill_request_approved",
      requestId: request.id,
      data: { skillName: skill.name, requestedName: request.name },
    });

    return { success: true, skill };
  });

/**
 * Outcome notice for a skill request. Best-effort: a decision that landed
 * in the DB must not report failure because the notify leg did. No actorId
 * — which moderator ruled is staff's business.
 */
async function notifyRequester(
  userId: string,
  params: {
    type: "skill_request_approved" | "skill_request_rejected";
    requestId: number;
    data: Record<string, unknown>;
  },
): Promise<void> {
  await bestEffort("admin.skill_request_notice", { request_id: params.requestId }, () =>
    notify({
      userId,
      type: params.type,
      entityType: "skill_request",
      entityId: String(params.requestId),
      data: params.data,
    }),
  );
}

export const rejectSkillRequest = os
  .use(requireStaff)
  .input(
    z.object({
      requestId: z.number().int().positive(),
      /** Shown to the requester in the outcome notice. */
      reason: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [updated] = await db
      .update(skillRequests)
      .set({ status: "rejected" })
      .where(and(eq(skillRequests.id, input.requestId), eq(skillRequests.status, "pending")))
      .returning();
    if (!updated) {
      throw new ORPCError("NOT_FOUND", { message: "No pending request with that id." });
    }

    await recordModerationAction({
      action: "skill_request_rejected",
      actorId: context.user.id,
      targetType: "skill_request",
      targetId: updated.id,
      subjectUserId: updated.userId,
      reason: input.reason,
      metadata: { requestedName: updated.name },
    });

    await notifyRequester(updated.userId, {
      type: "skill_request_rejected",
      requestId: updated.id,
      data: {
        requestedName: updated.name,
        ...(input.reason ? { reason: input.reason } : {}),
      },
    });

    return { success: true };
  });

// ── Vocabulary ──────────────────────────────────────────────────────────────

/**
 * Both controlled vocabularies with their usage counts, so a removal can say
 * what it's about to take down. Staff-only: the public `listSkills` /
 * `listCollabRoles` stay lean for the filter UIs that poll them.
 */
export const listVocabulary = os.use(requireStaff).handler(async () => {
  const [roles, skillRows] = await Promise.all([
    db
      .select({
        id: collabRoles.id,
        name: collabRoles.name,
        category: collabRoles.category,
        usageCount: count(collabPostRoles.id),
      })
      .from(collabRoles)
      .leftJoin(collabPostRoles, eq(collabPostRoles.roleId, collabRoles.id))
      .groupBy(collabRoles.id)
      .orderBy(asc(collabRoles.name)),
    db
      .select({
        id: skills.id,
        name: skills.name,
        category: skills.category,
        usageCount: count(userSkills.id),
      })
      .from(skills)
      .leftJoin(userSkills, eq(userSkills.skillId, skills.id))
      .groupBy(skills.id)
      .orderBy(asc(skills.name)),
  ]);
  return { roles, skills: skillRows };
});

async function assertSkillNameFree(name: string, exceptId?: number): Promise<void> {
  const match = await findSkillByName(name);
  if (match && match.id !== exceptId) {
    throw new ORPCError("CONFLICT", { message: `“${match.name}” already exists.` });
  }
}

export const createSkill = os
  .use(requireStaff)
  .input(z.object({ name: vocabNameSchema, category: vocabCategorySchema.optional() }))
  .handler(async ({ input, context }) => {
    await assertSkillNameFree(input.name);
    const [created] = await db
      .insert(skills)
      .values({ name: input.name, category: input.category ?? null })
      .returning();

    await recordModerationAction({
      action: "vocabulary_created",
      actorId: context.user.id,
      targetType: "skill",
      targetId: created?.id,
      metadata: { name: input.name, category: input.category ?? null },
    });
    return created;
  });

/**
 * Renaming is a catalogue-level edit: every profile carrying the skill holds
 * a FK, so the correction propagates without touching `user_skills`.
 */
export const updateSkill = os
  .use(requireStaff)
  .input(
    z.object({
      skillId: z.number().int().positive(),
      name: vocabNameSchema,
      category: vocabCategorySchema.optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    await assertSkillNameFree(input.name, input.skillId);
    const [before] = await db
      .select({ name: skills.name, category: skills.category })
      .from(skills)
      .where(eq(skills.id, input.skillId))
      .limit(1);
    const [updated] = await db
      .update(skills)
      .set({ name: input.name, category: input.category ?? null })
      .where(eq(skills.id, input.skillId))
      .returning();
    if (!updated) throw new ORPCError("NOT_FOUND", { message: "Skill not found." });

    await recordModerationAction({
      action: "vocabulary_renamed",
      actorId: context.user.id,
      targetType: "skill",
      targetId: updated.id,
      // Renames propagate to every profile by FK, so the previous name is
      // the only place it survives.
      metadata: {
        from: before?.name ?? null,
        to: updated.name,
        fromCategory: before?.category ?? null,
        toCategory: updated.category,
      },
    });
    return updated;
  });

export const deleteSkill = os
  .use(requireAdmin)
  .input(z.object({ skillId: z.number().int().positive() }))
  .handler(async ({ input, context }) => {
    const [deleted] = await db.delete(skills).where(eq(skills.id, input.skillId)).returning();
    if (!deleted) throw new ORPCError("NOT_FOUND", { message: "Skill not found." });

    await recordModerationAction({
      action: "vocabulary_deleted",
      actorId: context.user.id,
      targetType: "skill",
      targetId: deleted.id,
      metadata: { name: deleted.name, category: deleted.category },
    });
    return { success: true };
  });

/**
 * Put a resolved report back in the queue.
 *
 * Dismissal is the decision staff make fastest and regret most, and it was
 * the one the code treated as irreversible — both resolve handlers
 * early-return on `resolvedAt` and nothing ever cleared it. Reopening
 * returns the *report* to the queue; whatever the resolution did to the
 * content (a removed comment, a closed post) stays done, and the copy on
 * the button says so.
 */
export const reopenReport = os
  .use(requireStaff)
  .input(
    z.object({
      reportId: z.number().int().positive(),
      kind: z.enum(["post", "comment", "team"]),
      reason: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [report] =
      input.kind === "post"
        ? await db
            .select({
              id: collabPostReports.id,
              subjectId: sql<string | null>`${collabPostReports.postId}::text`,
              reporterId: collabPostReports.reporterId,
              resolvedAt: collabPostReports.resolvedAt,
            })
            .from(collabPostReports)
            .where(eq(collabPostReports.id, input.reportId))
            .limit(1)
        : input.kind === "comment"
          ? await db
              .select({
                id: commentReports.id,
                subjectId: sql<string | null>`${commentReports.commentId}::text`,
                reporterId: commentReports.reporterId,
                resolvedAt: commentReports.resolvedAt,
              })
              .from(commentReports)
              .where(eq(commentReports.id, input.reportId))
              .limit(1)
          : await db
              .select({
                id: teamReports.id,
                // Null when the team was deleted out from under the report.
                subjectId: teamReports.teamId,
                reporterId: teamReports.reporterId,
                resolvedAt: teamReports.resolvedAt,
              })
              .from(teamReports)
              .where(eq(teamReports.id, input.reportId))
              .limit(1);

    if (!report) throw new ORPCError("NOT_FOUND", { message: "Report not found." });
    if (!report.resolvedAt) {
      return { success: true, reopened: false, message: "That report is already open." };
    }

    // The report procedures only block a duplicate while an *open* report
    // exists, so the same person may have filed again since this one was
    // resolved. Reopening would give staff two live rows from one reporter
    // on one subject, which is the mess the dedupe exists to avoid.
    const [newer] =
      report.subjectId == null
        ? [undefined]
        : input.kind === "post"
          ? await db
              .select({ id: collabPostReports.id })
              .from(collabPostReports)
              .where(
                and(
                  eq(collabPostReports.postId, Number(report.subjectId)),
                  eq(collabPostReports.reporterId, report.reporterId),
                  isNull(collabPostReports.resolvedAt),
                  ne(collabPostReports.id, report.id),
                ),
              )
              .limit(1)
          : input.kind === "comment"
            ? await db
                .select({ id: commentReports.id })
                .from(commentReports)
                .where(
                  and(
                    eq(commentReports.commentId, Number(report.subjectId)),
                    eq(commentReports.reporterId, report.reporterId),
                    isNull(commentReports.resolvedAt),
                    ne(commentReports.id, report.id),
                  ),
                )
                .limit(1)
            : await db
                .select({ id: teamReports.id })
                .from(teamReports)
                .where(
                  and(
                    eq(teamReports.teamId, report.subjectId),
                    eq(teamReports.reporterId, report.reporterId),
                    isNull(teamReports.resolvedAt),
                    ne(teamReports.id, report.id),
                  ),
                )
                .limit(1);

    if (newer) {
      return {
        success: true,
        reopened: false,
        message: "The same reporter already has a newer open report on this — handle that one.",
      };
    }

    const cleared = { resolvedAt: null, resolvedById: null };
    if (input.kind === "post") {
      await db.update(collabPostReports).set(cleared).where(eq(collabPostReports.id, report.id));
    } else if (input.kind === "comment") {
      await db.update(commentReports).set(cleared).where(eq(commentReports.id, report.id));
    } else {
      await db.update(teamReports).set(cleared).where(eq(teamReports.id, report.id));
    }

    await recordModerationAction({
      action: "report_reopened",
      actorId: context.user.id,
      targetType:
        input.kind === "post"
          ? "post_report"
          : input.kind === "comment"
            ? "comment_report"
            : "team_report",
      targetId: report.id,
      subjectUserId: report.reporterId,
      reason: input.reason,
      metadata: { kind: input.kind, subjectId: report.subjectId },
    });

    return { success: true, reopened: true, message: "Report is back in the queue." };
  });

// ── Moderation proposals (plan 23) ──────────────────────────────────────────

/**
 * Payload contracts per proposable action — the same zod fragments the
 * direct procedures use, so an approved proposal can never write a row the
 * direct path would have refused.
 */
const PROPOSAL_SCHEMAS: Record<string, z.ZodType> = {
  team_update: teamUpdatePatchSchema,
  team_slug: teamSlugPatchSchema,
  team_image_clear: teamImageClearSchema,
  team_member_remove: teamMemberRemoveSchema,
  team_transfer: teamTransferSchema,
  team_title_edit: teamTitleEditSchema,
  team_project_update: teamProjectPatchSchema,
  team_project_remove: teamProjectRemoveSchema,
  profile_update: profileModerationPatchSchema,
  profile_stub_reset: z.object({}),
};

function proposalTargetType(action: ModPowerAction): ModerationProposalTargetType {
  return action.startsWith("profile_") ? "profile" : "team";
}

function parseProposalPayload(action: ModPowerAction, payload: unknown): Record<string, unknown> {
  const schema = PROPOSAL_SCHEMAS[action];
  if (!schema) {
    throw new ORPCError("BAD_REQUEST", { message: "That action can't be proposed." });
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ORPCError("BAD_REQUEST", { message: "Invalid proposal payload." });
  }
  return parsed.data as Record<string, unknown>;
}

/**
 * The target's current values for the fields this action touches. Serves
 * three moments: the propose-time `snapshot`, the reviewer's live-drift
 * diff, and `appliedPrevious` at apply time. Null = the target (or the
 * specific member/project the payload names) is gone.
 */
async function proposalSnapshot(
  action: ModPowerAction,
  targetId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (proposalTargetType(action) === "profile") {
    const [profile] = await db
      .select({
        bio: developerProfiles.bio,
        tagline: developerProfiles.tagline,
        lookingFor: developerProfiles.lookingFor,
        location: developerProfiles.location,
        githubUrl: developerProfiles.githubUrl,
        twitterUrl: developerProfiles.twitterUrl,
        websiteUrl: developerProfiles.websiteUrl,
        urlStub: profileUrlStubs.stub,
      })
      .from(developerProfiles)
      .leftJoin(profileUrlStubs, profileStubJoin)
      .where(eq(developerProfiles.id, targetId))
      .limit(1);
    if (!profile) return null;
    if (action === "profile_stub_reset") return { urlStub: profile.urlStub };
    const { urlStub: _urlStub, ...fields } = profile;
    return Object.fromEntries(Object.entries(fields).filter(([key]) => payload[key] !== undefined));
  }

  const [team] = await db.select().from(teams).where(eq(teams.id, targetId)).limit(1);
  if (!team) return null;

  switch (action) {
    case "team_update":
      return Object.fromEntries(
        (["name", "tagline", "bio", "websiteUrl", "itchUrl", "recruiting"] as const)
          .filter((key) => payload[key] !== undefined)
          .map((key) => [key, team[key]]),
      );
    case "team_slug":
      return { slug: team.slug };
    case "team_image_clear": {
      const kind = payload.kind === "banner" ? "banner" : "avatar";
      return kind === "banner" ? { bannerUrl: team.bannerUrl } : { avatarUrl: team.avatarUrl };
    }
    case "team_member_remove":
    case "team_transfer": {
      const [member] = await db
        .select({ userId: teamMembers.userId, role: teamMembers.role, title: teamMembers.title })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, String(payload.userId))))
        .limit(1);
      return member ? { member } : null;
    }
    case "team_title_edit": {
      const [member] = await db
        .select({ id: teamMembers.id, userId: teamMembers.userId, title: teamMembers.title })
        .from(teamMembers)
        .where(and(eq(teamMembers.id, Number(payload.memberId)), eq(teamMembers.teamId, team.id)))
        .limit(1);
      return member ? { title: member.title, memberUserId: member.userId } : null;
    }
    case "team_project_update":
    case "team_project_remove": {
      const [project] = await db
        .select({
          title: teamProjects.title,
          description: teamProjects.description,
          url: teamProjects.url,
          imageUrl: teamProjects.imageUrl,
          imageKey: teamProjects.imageKey,
        })
        .from(teamProjects)
        .where(
          and(eq(teamProjects.id, String(payload.projectId)), eq(teamProjects.teamId, team.id)),
        )
        .limit(1);
      return project ?? null;
    }
    default:
      return null;
  }
}

/** Thrown by the apply dispatch when the proposal's target vanished between
 * propose and approve — the CAS row flips to rejected instead of erroring. */
class ProposalTargetGone extends Error {}

async function applyProposalAction(
  proposal: { action: string; targetId: string; payload: Record<string, unknown> },
  mod: ModOverride,
): Promise<void> {
  const action = proposal.action as ModPowerAction;
  // Re-validated at apply time — the schema may have tightened since.
  const payload = parseProposalPayload(action, proposal.payload);

  if (proposalTargetType(action) === "profile") {
    // Roles may have changed since the proposal was filed.
    await assertProfileModeratable(proposal.targetId);
    if (action === "profile_stub_reset") {
      await applyProfileStubReset(proposal.targetId, mod);
    } else {
      await applyProfileUpdate(proposal.targetId, profileModerationPatchSchema.parse(payload), mod);
    }
    return;
  }

  const [team] = await db.select().from(teams).where(eq(teams.id, proposal.targetId)).limit(1);
  if (!team) throw new ProposalTargetGone();

  switch (action) {
    case "team_update":
      await applyTeamUpdate(team, teamUpdatePatchSchema.parse(payload), mod);
      return;
    case "team_slug":
      await applyTeamSlug(team, teamSlugPatchSchema.parse(payload).slug, mod);
      return;
    case "team_image_clear":
      await applyTeamImageClear(team, teamImageClearSchema.parse(payload).kind, mod);
      return;
    case "team_member_remove":
      await applyMemberRemoval(
        team,
        teamMemberRemoveSchema.parse(payload).userId,
        mod.actorId,
        mod,
      );
      return;
    case "team_transfer":
      await applyOwnershipTransfer(team, teamTransferSchema.parse(payload).userId, mod);
      return;
    case "team_title_edit": {
      const { memberId, title } = teamTitleEditSchema.parse(payload);
      await applyMemberTitle(team, memberId, title, mod);
      return;
    }
    case "team_project_update": {
      const { projectId, ...patch } = teamProjectPatchSchema.parse(payload);
      const [project] = await db
        .select()
        .from(teamProjects)
        .where(and(eq(teamProjects.id, projectId), eq(teamProjects.teamId, team.id)))
        .limit(1);
      if (!project) throw new ProposalTargetGone();
      await applyTeamProjectUpdate(team, project, patch, mod);
      return;
    }
    case "team_project_remove": {
      const { projectId } = teamProjectRemoveSchema.parse(payload);
      const [project] = await db
        .select({
          id: teamProjects.id,
          title: teamProjects.title,
          addedBy: teamProjects.addedBy,
          imageKey: teamProjects.imageKey,
        })
        .from(teamProjects)
        .where(and(eq(teamProjects.id, projectId), eq(teamProjects.teamId, team.id)))
        .limit(1);
      if (!project) throw new ProposalTargetGone();
      await applyTeamProjectRemoval(team, project, mod);
      return;
    }
    default:
      throw new ORPCError("BAD_REQUEST", { message: "That action can't be proposed." });
  }
}

export const proposeModerationEdit = os
  .use(requireStaff)
  .input(
    z.object({
      action: z.enum(PROPOSABLE_ACTIONS as [ModPowerAction, ...ModPowerAction[]]),
      targetId: z.string().min(1),
      payload: z.record(z.string(), z.unknown()),
      /** Mods must say why — this becomes the owner-facing explanation on apply. */
      reason: z.string().trim().min(1).max(500),
    }),
  )
  .handler(async ({ input, context }) => {
    const payload = parseProposalPayload(input.action, input.payload);
    const targetType = proposalTargetType(input.action);

    if (targetType === "profile") {
      if (input.targetId === context.user.id) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Edit your own profile directly instead of proposing.",
        });
      }
      await assertProfileModeratable(input.targetId);
    }

    const snapshot = await proposalSnapshot(input.action, input.targetId, payload);
    if (!snapshot) throw new ORPCError("NOT_FOUND", { message: "Target not found." });

    const proposer = (await profilesByIds([context.user.id])).get(context.user.id);

    // Supersede-then-insert in one transaction: mods iterate on a draft
    // without an admin having to reject the stale one first.
    const proposal = await db.transaction(async (tx) => {
      await tx
        .update(moderationProposals)
        .set({ status: "superseded", reviewedAt: new Date() })
        .where(
          and(
            eq(moderationProposals.targetType, targetType),
            eq(moderationProposals.targetId, input.targetId),
            eq(moderationProposals.action, input.action),
            eq(moderationProposals.status, "pending"),
          ),
        );
      const [inserted] = await tx
        .insert(moderationProposals)
        .values({
          action: input.action,
          targetType,
          targetId: input.targetId,
          payload,
          snapshot,
          reason: input.reason,
          proposedById: context.user.id,
          proposedByName: proposer?.displayName ?? null,
        })
        .returning();
      return inserted;
    });

    await recordModerationAction({
      action: "moderation_proposed",
      actorId: context.user.id,
      targetType: "moderation_proposal",
      targetId: proposal.id,
      subjectUserId: targetType === "profile" ? input.targetId : null,
      reason: input.reason,
      metadata: { action: input.action, targetType, targetId: input.targetId },
    });

    return proposal;
  });

export const listModerationProposals = os
  .use(requireStaff)
  .input(
    z.object({
      status: z.enum(["pending", "handled"]).default("pending"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(10),
    }),
  )
  .handler(async ({ input }) => {
    const where =
      input.status === "pending"
        ? eq(moderationProposals.status, "pending")
        : ne(moderationProposals.status, "pending");

    const [[totals], rows] = await Promise.all([
      db.select({ total: count() }).from(moderationProposals).where(where),
      db
        .select()
        .from(moderationProposals)
        .where(where)
        .orderBy(desc(moderationProposals.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
    ]);

    const profiles = await profilesByIds(
      rows.flatMap((r) => [
        ...(r.proposedById ? [r.proposedById] : []),
        ...(r.reviewedById ? [r.reviewedById] : []),
        ...(r.targetType === "profile" ? [r.targetId] : []),
      ]),
    );

    // Team identity + the reviewer's live values, so the queue can render
    // "TEAM name" rows and badge CHANGED SINCE PROPOSED without a second
    // round trip per card.
    const teamIds = [
      ...new Set(rows.filter((r) => r.targetType === "team").map((r) => r.targetId)),
    ];
    const teamRows =
      teamIds.length > 0
        ? await db
            .select({ id: teams.id, name: teams.name, slug: teams.slug })
            .from(teams)
            .where(inArray(teams.id, teamIds))
        : [];
    const teamById = new Map(teamRows.map((t) => [t.id, t]));

    const items = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        proposer: row.proposedById ? (profiles.get(row.proposedById) ?? null) : null,
        reviewer: row.reviewedById ? (profiles.get(row.reviewedById) ?? null) : null,
        targetProfile: row.targetType === "profile" ? (profiles.get(row.targetId) ?? null) : null,
        targetTeam: row.targetType === "team" ? (teamById.get(row.targetId) ?? null) : null,
        live:
          row.status === "pending"
            ? await proposalSnapshot(row.action as ModPowerAction, row.targetId, row.payload)
            : null,
      })),
    );

    const total = totals?.total ?? 0;
    return {
      items,
      total,
      page: input.page,
      pageSize: input.pageSize,
      pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
    };
  });

export const approveModerationProposal = os
  .use(requireAdmin)
  .input(
    z.object({
      proposalId: z.number().int().positive(),
      note: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    // Claim first — two admins racing get one winner and one "already handled".
    const [claimed] = await db
      .update(moderationProposals)
      .set({
        status: "approved",
        reviewedById: context.user.id,
        reviewedAt: new Date(),
        reviewNote: input.note ?? null,
      })
      .where(
        and(
          eq(moderationProposals.id, input.proposalId),
          eq(moderationProposals.status, "pending"),
        ),
      )
      .returning();
    if (!claimed) {
      throw new ORPCError("NOT_FOUND", { message: "No pending proposal with that id." });
    }

    const action = claimed.action as ModPowerAction;
    let appliedPrevious: Record<string, unknown> | null = null;
    try {
      appliedPrevious = await proposalSnapshot(action, claimed.targetId, claimed.payload);
      if (!appliedPrevious) throw new ProposalTargetGone();
      // The applied action carries the proposal's reason to the subject; its
      // own audit row fires inside the apply helper — one decision, two rows:
      // the ruling and the effect.
      await applyProposalAction(claimed, { actorId: context.user.id, reason: claimed.reason });
      await db
        .update(moderationProposals)
        .set({ appliedPrevious })
        .where(eq(moderationProposals.id, claimed.id));
    } catch (error) {
      if (error instanceof ProposalTargetGone) {
        await db
          .update(moderationProposals)
          .set({ status: "rejected", reviewNote: "target gone" })
          .where(eq(moderationProposals.id, claimed.id));
        return { success: true, applied: false, message: "Target is gone — proposal rejected." };
      }
      // Release the claim so a transient failure doesn't strand the row as
      // approved-but-unapplied.
      await db
        .update(moderationProposals)
        .set({ status: "pending", reviewedById: null, reviewedAt: null, reviewNote: null })
        .where(eq(moderationProposals.id, claimed.id));
      throw error;
    }

    await recordModerationAction({
      action: "moderation_proposal_approved",
      actorId: context.user.id,
      targetType: "moderation_proposal",
      targetId: claimed.id,
      subjectUserId: claimed.targetType === "profile" ? claimed.targetId : null,
      reason: input.note,
      metadata: { action, payload: claimed.payload, appliedPrevious },
    });

    return { success: true, applied: true };
  });

export const rejectModerationProposal = os
  .use(requireAdmin)
  .input(
    z.object({
      proposalId: z.number().int().positive(),
      note: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [rejected] = await db
      .update(moderationProposals)
      .set({
        status: "rejected",
        reviewedById: context.user.id,
        reviewedAt: new Date(),
        reviewNote: input.note ?? null,
      })
      .where(
        and(
          eq(moderationProposals.id, input.proposalId),
          eq(moderationProposals.status, "pending"),
        ),
      )
      .returning();
    if (!rejected) {
      throw new ORPCError("NOT_FOUND", { message: "No pending proposal with that id." });
    }

    await recordModerationAction({
      action: "moderation_proposal_rejected",
      actorId: context.user.id,
      targetType: "moderation_proposal",
      targetId: rejected.id,
      subjectUserId: rejected.targetType === "profile" ? rejected.targetId : null,
      reason: input.note,
      metadata: { action: rejected.action, targetId: rejected.targetId },
    });

    return { success: true };
  });

// ── Teams section ───────────────────────────────────────────────────────────

export const listTeamsAdmin = os
  .use(requireStaff)
  .input(
    z.object({
      search: z.string().trim().max(100).optional(),
      hiddenOnly: z.boolean().default(false),
      includeArchived: z.boolean().default(true),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(10),
    }),
  )
  .handler(async ({ input }) => {
    const filters = [
      input.search
        ? or(
            ilike(teams.name, `%${escapeLike(input.search)}%`),
            ilike(teams.slug, `%${escapeLike(input.search)}%`),
          )
        : undefined,
      input.hiddenOnly ? isNotNull(teams.hiddenAt) : undefined,
      input.includeArchived ? undefined : eq(teams.status, "active"),
    ].filter((f) => f != null);
    const where = filters.length > 0 ? and(...filters) : undefined;

    const [[totals], rows] = await Promise.all([
      db.select({ total: count() }).from(teams).where(where),
      db
        .select({
          id: teams.id,
          slug: teams.slug,
          name: teams.name,
          status: teams.status,
          hiddenAt: teams.hiddenAt,
          hiddenReason: teams.hiddenReason,
          createdAt: teams.createdAt,
        })
        .from(teams)
        .where(where)
        .orderBy(desc(teams.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
    ]);

    const teamIds = rows.map((r) => r.id);
    const [owners, openReports] = await Promise.all([
      teamIds.length > 0
        ? db
            .select({ teamId: teamMembers.teamId, userId: teamMembers.userId })
            .from(teamMembers)
            .where(and(inArray(teamMembers.teamId, teamIds), eq(teamMembers.role, "owner")))
        : Promise.resolve([]),
      teamIds.length > 0
        ? db
            .select({ teamId: teamReports.teamId, count: count() })
            .from(teamReports)
            .where(and(inArray(teamReports.teamId, teamIds), isNull(teamReports.resolvedAt)))
            .groupBy(teamReports.teamId)
        : Promise.resolve([]),
    ]);
    const ownerByTeam = new Map(owners.map((o) => [o.teamId, o.userId]));
    const reportsByTeam = new Map(openReports.map((r) => [r.teamId!, r.count]));
    const profiles = await profilesByIds(owners.map((o) => o.userId));

    const total = totals?.total ?? 0;
    return {
      items: rows.map((row) => ({
        ...row,
        owner: ownerByTeam.get(row.id) ? (profiles.get(ownerByTeam.get(row.id)!) ?? null) : null,
        openReportCount: reportsByTeam.get(row.id) ?? 0,
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
      pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
    };
  });
