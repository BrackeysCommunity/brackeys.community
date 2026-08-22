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
  profileUrlStubs,
  session,
  skillRequests,
  skills,
  user,
  userSkills,
  type ModerationActionType,
} from "@/db/schema";
import { isActiveBan } from "@/lib/ban-state";
import {
  isAdmin as checkIsAdmin,
  isStaffMember as checkIsStaff,
  purgeGuildBanCache,
} from "@/lib/discord";
import { memberName } from "@/lib/member-name";
import { recordModerationAction } from "@/lib/moderation-audit";
import { notify } from "@/lib/notifications";
import { bestEffort } from "@/lib/posthog-server";
import { escapeLike } from "@/lib/sql-like";
import { resolveUserRoles } from "@/lib/staff-roles";
import { authMiddleware, readSession, requireAdmin, requireStaff } from "@/orpc/middleware/auth";

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
    .select({
      id: developerProfiles.id,
      discordUsername: developerProfiles.discordUsername,
      guildNickname: developerProfiles.guildNickname,
      avatarUrl: developerProfiles.avatarUrl,
      urlStub: profileUrlStubs.stub,
    })
    .from(developerProfiles)
    .leftJoin(profileUrlStubs, eq(profileUrlStubs.profileId, developerProfiles.id))
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
    const pattern = `%${escapeLike(input.search)}%`;
    const where = or(
      ilike(developerProfiles.guildNickname, pattern),
      ilike(developerProfiles.discordUsername, pattern),
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
        .leftJoin(profileUrlStubs, eq(profileUrlStubs.profileId, developerProfiles.id))
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
      kind: z.enum(["post", "comment"]),
      reason: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const isPost = input.kind === "post";
    const [report] = isPost
      ? await db
          .select({
            id: collabPostReports.id,
            subjectId: collabPostReports.postId,
            reporterId: collabPostReports.reporterId,
            resolvedAt: collabPostReports.resolvedAt,
          })
          .from(collabPostReports)
          .where(eq(collabPostReports.id, input.reportId))
          .limit(1)
      : await db
          .select({
            id: commentReports.id,
            subjectId: commentReports.commentId,
            reporterId: commentReports.reporterId,
            resolvedAt: commentReports.resolvedAt,
          })
          .from(commentReports)
          .where(eq(commentReports.id, input.reportId))
          .limit(1);

    if (!report) throw new ORPCError("NOT_FOUND", { message: "Report not found." });
    if (!report.resolvedAt) {
      return { success: true, reopened: false, message: "That report is already open." };
    }

    // `reportPost` and `reportComment` only block a duplicate while an *open*
    // report exists, so the same person may have filed again since this one
    // was resolved. Reopening would give staff two live rows from one
    // reporter on one subject, which is the mess the dedupe exists to avoid.
    const [newer] = isPost
      ? await db
          .select({ id: collabPostReports.id })
          .from(collabPostReports)
          .where(
            and(
              eq(collabPostReports.postId, report.subjectId),
              eq(collabPostReports.reporterId, report.reporterId),
              isNull(collabPostReports.resolvedAt),
              ne(collabPostReports.id, report.id),
            ),
          )
          .limit(1)
      : await db
          .select({ id: commentReports.id })
          .from(commentReports)
          .where(
            and(
              eq(commentReports.commentId, report.subjectId),
              eq(commentReports.reporterId, report.reporterId),
              isNull(commentReports.resolvedAt),
              ne(commentReports.id, report.id),
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
    if (isPost) {
      await db.update(collabPostReports).set(cleared).where(eq(collabPostReports.id, report.id));
    } else {
      await db.update(commentReports).set(cleared).where(eq(commentReports.id, report.id));
    }

    await recordModerationAction({
      action: "report_reopened",
      actorId: context.user.id,
      targetType: isPost ? "post_report" : "comment_report",
      targetId: report.id,
      subjectUserId: report.reporterId,
      reason: input.reason,
      metadata: { kind: input.kind, subjectId: report.subjectId },
    });

    return { success: true, reopened: true, message: "Report is back in the queue." };
  });
