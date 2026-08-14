import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { and, eq, ilike, inArray, isNull, or, desc, asc, count, sql } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import {
  collabPosts,
  collabRoles,
  collabPostRoles,
  collabPostSkills,
  collabResponses,
  collabPostImages,
  collabPostReports,
  developerProfiles,
  itchJams,
  profileUrlStubs,
  projects,
  teamInvites,
  teamMembers,
  teams,
  userSkills,
  skills,
} from "@/db/schema";
import {
  daysFromNow,
  EXTEND_DAYS,
  initialPostExpiry,
  REOPEN_EXTENSION_DAYS,
} from "@/lib/collab-lifecycle";
import { recordModerationAction } from "@/lib/moderation-audit";
import { notify } from "@/lib/notifications";
import { checkProfanity } from "@/lib/profanity";
import {
  getProfileProjectImageUrl,
  resolveTeamAvatarUrl,
} from "@/lib/profile-project-image-storage";
import { loadProjectForEditor } from "@/lib/project-editors";
import { checkRateLimit } from "@/lib/rate-limit";
import { escapeLike } from "@/lib/sql-like";
import { stackOverlap } from "@/lib/stack-overlap";
import { touchTeamActivity } from "@/lib/team-activity";
import { blockPairExists } from "@/lib/user-blocks";
import {
  requireAuth,
  requireGuildMember,
  requireAuthWithPermissions,
  userIsGuildMember,
  requireStaff,
  requireAdmin,
} from "@/orpc/middleware/auth";

const compensationTypeSchema = z.enum(["hourly", "fixed", "rev_share", "negotiable"]);
const projectLengthSchema = z.enum([
  "<1 week",
  "1-4 weeks",
  "1-3 months",
  "3-6 months",
  "6+ months",
  "ongoing",
]);
const experienceLevelSchema = z.enum(["any", "beginner", "intermediate", "experienced"]);
const contactTypeSchema = z.enum(["discord_dm", "discord_server", "email", "other"]);

/**
 * v1 ships paid + hobby only. Playtest and mentor are deferred, not
 * deleted: `collab_posts.type` stays `text` and every consumer reads the
 * value through lookup maps, so both return as pure additions here.
 */
const postTypeSchema = z.enum(["paid", "hobby"]);

/** A post's stack is a shortlist, not a tag dump. */
const MAX_POST_SKILLS = 10;

// ── Post CRUD ────────────────────────────────────────────────────────────────

/**
 * The full post payload, shared by create and edit. Every constraint the
 * wizard enforces client-side is expressed here too — before this, the
 * RPC accepted `min(1)` titles and no roles at all, so a direct caller
 * could create posts the board's own components don't expect to render.
 */
const postContentShape = {
  type: postTypeSchema,
  title: z.string().trim().min(10).max(200),
  description: z.string().trim().min(30).max(5000),
  projectName: z.string().trim().min(3).max(200),
  // null unlinks on edit; undefined leaves the post jam-less on create.
  jamId: z.number().int().positive().nullish(),
  // The named team behind the post; null unlinks on edit. Nullish in
  // the shape, but team posts must link one — enforced in
  // `assertTeamRequired`, handler-level because the legacy escape hatch
  // needs the stored row, which a zod refine can't see.
  teamId: z.string().nullish(),
  // The canonical project the post recruits for; null unlinks on edit.
  // Always optional (a lot of posts are pre-project) and never minted
  // here — "something new" stays free text in `projectName`.
  projectId: z.string().nullish(),
  compensationType: compensationTypeSchema.optional(),
  compensationMin: z.number().int().min(0).max(1_000_000).optional(),
  compensationMax: z.number().int().min(0).max(1_000_000).optional(),
  projectLength: projectLengthSchema,
  platforms: z.array(z.string().max(50)).min(1).max(20),
  experienceLevel: experienceLevelSchema,
  portfolioUrl: z.url().max(500).optional().or(z.literal("")),
  contactMethod: z.string().max(500).optional(),
  contactType: contactTypeSchema.optional(),
  isIndividual: z.boolean().optional(),
  roleIds: z.array(z.number().int().positive()).min(1).max(20),
  skillIds: z.array(z.number().int().positive()).max(MAX_POST_SKILLS).optional(),
};

/** The cross-field rules the wizard enforces, shared by create and edit. */
function refinePostContent(
  v: {
    type: string;
    compensationType?: string;
    compensationMin?: number;
    compensationMax?: number;
    isIndividual?: boolean;
    teamId?: string | null;
    contactType?: string;
    contactMethod?: string;
  },
  ctx: z.RefinementCtx,
) {
  if (v.isIndividual && v.teamId != null) {
    ctx.addIssue({
      code: "custom",
      path: ["teamId"],
      message: "A solo post cannot also be linked to a team.",
    });
  }
  if (v.type === "paid") {
    if (!v.compensationType) {
      ctx.addIssue({
        code: "custom",
        path: ["compensationType"],
        message: "Paid posts need a compensation type.",
      });
    } else if (v.compensationType !== "negotiable" && v.compensationMin === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["compensationMin"],
        message: "Please provide a compensation range.",
      });
    }
  }
  if (
    v.compensationMin !== undefined &&
    v.compensationMax !== undefined &&
    v.compensationMin > v.compensationMax
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["compensationMax"],
      message: "Compensation maximum must be at least the minimum.",
    });
  }
  // Solo posters fall back to a Discord DM (their profile handle is the
  // contact), so only team posts must spell a channel out.
  if (!v.isIndividual) {
    if (!v.contactType) {
      ctx.addIssue({
        code: "custom",
        path: ["contactType"],
        message: "Please choose a contact type.",
      });
    }
    if (!v.contactMethod?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["contactMethod"],
        message: "Please provide contact info.",
      });
    }
  }
}

/**
 * The full post payload. Every constraint the wizard enforces
 * client-side is expressed here too — before this, the RPC accepted
 * `min(1)` titles and no roles at all, so a direct caller could create
 * posts the board's own components don't expect to render.
 */
export const postContentSchema = z.object(postContentShape).superRefine(refinePostContent);

/**
 * The same payload plus the post being edited. Spread from the shared
 * shape rather than intersected with the schema above so the input stays
 * a plain object — oRPC's OpenAPI generation reads it far better.
 */
const updatePostSchema = z
  .object({ ...postContentShape, postId: z.number() })
  .superRefine(refinePostContent);

type PostContent = z.infer<typeof postContentSchema>;

function checkPostProfanity(input: PostContent) {
  checkProfanity(input.title, "Title");
  checkProfanity(input.description, "Description");
  checkProfanity(input.projectName, "Project name");
  if (input.contactMethod) checkProfanity(input.contactMethod, "Contact method");
}

/** Ids the caller supplied but that don't exist, as a clean 400 rather
 *  than the FK violation (a raw 500) the insert would otherwise throw. */
async function resolveReferences(input: PostContent) {
  const roleIds = [...new Set(input.roleIds)];
  const skillIds = [...new Set(input.skillIds ?? [])];

  const [foundRoles, foundSkills, jam] = await Promise.all([
    db.select({ id: collabRoles.id }).from(collabRoles).where(inArray(collabRoles.id, roleIds)),
    skillIds.length > 0
      ? db.select({ id: skills.id }).from(skills).where(inArray(skills.id, skillIds))
      : Promise.resolve([] as { id: number }[]),
    input.jamId != null
      ? db
          .select({ jamId: itchJams.jamId, status: itchJams.status, endsAt: itchJams.endsAt })
          .from(itchJams)
          .where(eq(itchJams.jamId, input.jamId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  if (foundRoles.length !== roleIds.length) {
    throw new ORPCError("BAD_REQUEST", { message: "One or more roles no longer exist." });
  }
  if (foundSkills.length !== skillIds.length) {
    throw new ORPCError("BAD_REQUEST", { message: "One or more stack entries no longer exist." });
  }
  if (input.jamId != null && !jam) {
    throw new ORPCError("BAD_REQUEST", { message: "That jam no longer exists." });
  }

  // Linking a finished jam isn't an error — teams do post retrospectively
  // and the jam link is still the right metadata — but the client should
  // be able to say so.
  const jamWarning =
    jam && (jam.status === "over" || (jam.endsAt && jam.endsAt.getTime() < Date.now()))
      ? "This jam has already ended."
      : null;

  return { roleIds, skillIds, jamWarning, jam };
}

/**
 * v2: a team post must name its team — the accept → invite loop and
 * `/teams` discovery both hang off the link. One escape hatch: a legacy
 * pre-v2 unlinked team post may be *edited* without linking (an old
 * post's typo fix must not demand a team), but creates never exempt and
 * flipping a solo post to a team post always requires the link.
 */
export function assertTeamRequired(
  input: { isIndividual?: boolean; teamId?: string | null },
  existing?: { isIndividual: boolean | null; teamId: string | null },
) {
  if (input.isIndividual || input.teamId != null) return;
  if (existing && !existing.isIndividual && existing.teamId === null) return;
  throw new ORPCError("BAD_REQUEST", {
    message: "Team posts need a team page — pick or create one.",
  });
}

/**
 * A post may only be pinned to a team its *author* belongs to (checked
 * against the author, not the caller, so a staff edit doesn't trip over
 * a membership the staffer doesn't have), and never to an archived one.
 */
async function assertTeamLinkable(teamId: string, authorId: string) {
  const [team] = await db
    .select({ id: teams.id, status: teams.status })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) {
    throw new ORPCError("BAD_REQUEST", { message: "That team no longer exists." });
  }
  if (team.status !== "active") {
    throw new ORPCError("BAD_REQUEST", { message: "That team has been archived." });
  }
  const [membership] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, authorId)))
    .limit(1);
  if (!membership) {
    throw new ORPCError("FORBIDDEN", { message: "The author is not a member of that team." });
  }
}

/**
 * A post may only link a project its *author* can edit — the projects
 * plan's §1.3 union (created it, credited on it, or on a claiming team),
 * reused rather than a new permission concept. Checked against the
 * author, not the caller, so a staff edit doesn't trip over rights the
 * staffer doesn't have — same shape as `assertTeamLinkable`.
 */
async function assertProjectLinkable(projectId: string, authorId: string) {
  const loaded = await loadProjectForEditor(projectId, authorId);
  if (!loaded) {
    throw new ORPCError("BAD_REQUEST", { message: "That project no longer exists." });
  }
  if (!loaded.canEdit) {
    throw new ORPCError("FORBIDDEN", {
      message: "Posts can only recruit for a project the author can edit.",
    });
  }
}

/**
 * The linked project's own title, which is what a linked post displays.
 *
 * A post that names a project is not free to call it something else: the
 * canonical row owns its identity, and renaming happens on the project page.
 * So `project_name` is *derived* here rather than taken from the payload —
 * the wizard locks the field, and this is what makes that lock real for
 * anything talking to the RPC directly.
 */
async function linkedProjectName(projectId: string): Promise<string> {
  const [row] = await db
    .select({ title: projects.title })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row) {
    throw new ORPCError("BAD_REQUEST", { message: "That project no longer exists." });
  }
  return row.title;
}

/** Columns of `collab_posts` the payload writes, minus the link tables.
 *  `projectName` is overridden when the post links a canonical project. */
function postColumns(input: PostContent, projectName?: string) {
  return {
    type: input.type,
    jamId: input.jamId ?? null,
    teamId: input.teamId ?? null,
    projectId: input.projectId ?? null,
    title: input.title,
    description: input.description,
    projectName: projectName ?? input.projectName,
    compensationType: input.compensationType ?? null,
    compensationMin: input.compensationMin ?? null,
    compensationMax: input.compensationMax ?? null,
    projectLength: input.projectLength,
    platforms: input.platforms,
    experienceLevel: input.experienceLevel,
    portfolioUrl: input.portfolioUrl || null,
    contactMethod: input.contactMethod ?? null,
    contactType: input.contactType ?? null,
    isIndividual: input.isIndividual ?? false,
  };
}

export const createPost = os
  .use(requireGuildMember)
  .input(postContentSchema)
  .handler(async ({ input, context }) => {
    checkPostProfanity(input);
    assertTeamRequired(input);
    if (!(await checkRateLimit("collab-post", context.user.id, 10, 86400))) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "You've created a lot of posts today — try again tomorrow.",
      });
    }
    const { roleIds, skillIds, jamWarning, jam } = await resolveReferences(input);
    if (input.teamId != null) {
      await assertTeamLinkable(input.teamId, context.user.id);
    }
    let projectName: string | undefined;
    if (input.projectId != null) {
      await assertProjectLinkable(input.projectId, context.user.id);
      projectName = await linkedProjectName(input.projectId);
    }

    const [post] = await db
      .insert(collabPosts)
      .values({
        authorId: context.user.id,
        ...postColumns(input, projectName),
        expiresAt: initialPostExpiry(jam?.endsAt),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await touchTeamActivity(post.teamId);

    await db.insert(collabPostRoles).values(roleIds.map((roleId) => ({ postId: post.id, roleId })));
    if (skillIds.length > 0) {
      await db
        .insert(collabPostSkills)
        .values(skillIds.map((skillId) => ({ postId: post.id, skillId })));
    }

    return { ...post, jamWarning };
  });

export const updatePost = os
  .use(requireAuthWithPermissions)
  .input(updatePostSchema)
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1);

    if (!post) {
      throw new ORPCError("NOT_FOUND", { message: "Post not found." });
    }

    const isOwner = post.authorId === context.user.id;
    if (!isOwner && !context.isStaff) {
      throw new ORPCError("FORBIDDEN", { message: "You can only edit your own posts." });
    }

    checkPostProfanity(input);
    assertTeamRequired(input, post);
    const { roleIds, skillIds, jamWarning } = await resolveReferences(input);
    // Only a *changed* link needs re-verifying — an author who has since
    // left the team (or a staff edit) can still save with the existing
    // link intact.
    if (input.teamId != null && input.teamId !== post.teamId) {
      await assertTeamLinkable(input.teamId, post.authorId);
    }
    let projectName: string | undefined;
    if (input.projectId != null) {
      // Only a *changed* link is re-verified (same rule as the team link
      // above), but the name is re-derived either way — the project may have
      // been renamed since this post was written, and the post follows it.
      if (input.projectId !== post.projectId) {
        await assertProjectLinkable(input.projectId, post.authorId);
      }
      projectName = await linkedProjectName(input.projectId);
    }
    const postId = input.postId;

    const [updated] = await db
      .update(collabPosts)
      .set({
        ...postColumns(input, projectName),
        // The legacy display string can't round-trip through the sliders,
        // so an edited post stops carrying one and renders from the
        // numbers like every post created since v1.
        compensation: null,
        updatedAt: new Date(),
      })
      .where(eq(collabPosts.id, postId))
      .returning();

    // Roles and skills are replaced wholesale — the payload is the post's
    // complete state, same as the columns above.
    await db.delete(collabPostRoles).where(eq(collabPostRoles.postId, postId));
    await db.insert(collabPostRoles).values(roleIds.map((roleId) => ({ postId, roleId })));

    await db.delete(collabPostSkills).where(eq(collabPostSkills.postId, postId));
    if (skillIds.length > 0) {
      await db.insert(collabPostSkills).values(skillIds.map((skillId) => ({ postId, skillId })));
    }

    return { ...updated, jamWarning };
  });

/**
 * Sets just the team link on a legacy unlinked post. Exists so the
 * accept-time fix (§3.2 of the v2 plan) is one call — `updatePost`
 * requires the full payload and would force the client to reconstruct
 * it for what is a single-FK change.
 */
export const linkPostTeam = os
  .use(requireAuth)
  .input(z.object({ postId: z.number(), teamId: z.string() }))
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1);

    if (!post) {
      throw new ORPCError("NOT_FOUND", { message: "Post not found." });
    }
    if (post.authorId !== context.user.id) {
      throw new ORPCError("FORBIDDEN", { message: "You can only link your own posts." });
    }
    if (post.isIndividual) {
      throw new ORPCError("BAD_REQUEST", {
        message: "A solo post cannot also be linked to a team.",
      });
    }
    await assertTeamLinkable(input.teamId, post.authorId);

    const [updated] = await db
      .update(collabPosts)
      .set({ teamId: input.teamId, updatedAt: new Date() })
      .where(eq(collabPosts.id, input.postId))
      .returning();

    return updated;
  });

export const deletePost = os
  .use(requireAuthWithPermissions)
  .input(z.object({ postId: z.number() }))
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1);

    if (!post) {
      throw new ORPCError("NOT_FOUND", { message: "Post not found." });
    }

    const isOwner = post.authorId === context.user.id;
    if (!isOwner && !context.isStaff) {
      throw new ORPCError("FORBIDDEN", { message: "You can only delete your own posts." });
    }

    await db.delete(collabPosts).where(eq(collabPosts.id, input.postId));
    return { success: true };
  });

export const closePost = os
  .use(requireAuthWithPermissions)
  .input(z.object({ postId: z.number() }))
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1);

    if (!post) {
      throw new ORPCError("NOT_FOUND", { message: "Post not found." });
    }

    const isOwner = post.authorId === context.user.id;
    if (!isOwner && !context.isStaff) {
      throw new ORPCError("FORBIDDEN", { message: "You can only close your own posts." });
    }

    const [updated] = await db
      .update(collabPosts)
      .set({ status: "party_full", updatedAt: new Date() })
      .where(eq(collabPosts.id, input.postId))
      .returning();

    if (!isOwner && context.isStaff) {
      await notify({
        userId: post.authorId,
        type: "collab_post_closed_by_staff",
        actorId: context.user.id,
        entityType: "collab_post",
        entityId: String(post.id),
        data: { postId: post.id, postTitle: post.title },
      });
    }

    return updated;
  });

export const reopenPost = os
  .use(requireAuthWithPermissions)
  .input(z.object({ postId: z.number() }))
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1);

    if (!post) {
      throw new ORPCError("NOT_FOUND", { message: "Post not found." });
    }

    const isOwner = post.authorId === context.user.id;
    if (!isOwner && !context.isStaff) {
      throw new ORPCError("FORBIDDEN", { message: "You can only reopen your own posts." });
    }

    const [updated] = await db
      .update(collabPosts)
      .set({
        status: "recruiting",
        // A reopened post starts a fresh (shorter) recruiting window, and
        // the cleared stamp re-arms the closes-soon nudge for it.
        expiresAt: daysFromNow(REOPEN_EXTENSION_DAYS),
        expiryNotifiedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(collabPosts.id, input.postId))
      .returning();

    await touchTeamActivity(post.teamId);

    return updated;
  });

/**
 * The owner's "still looking" lever — pushes `expires_at` out without
 * the close-and-reopen dance. Staff get it too, same as every other
 * post control.
 */
export const extendPost = os
  .use(requireAuthWithPermissions)
  .input(z.object({ postId: z.number() }))
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1);

    if (!post) {
      throw new ORPCError("NOT_FOUND", { message: "Post not found." });
    }

    const isOwner = post.authorId === context.user.id;
    if (!isOwner && !context.isStaff) {
      throw new ORPCError("FORBIDDEN", { message: "You can only extend your own posts." });
    }
    if (post.status !== "recruiting") {
      throw new ORPCError("BAD_REQUEST", {
        message: "Only an open post can be extended — reopen it instead.",
      });
    }

    const [updated] = await db
      .update(collabPosts)
      .set({
        expiresAt: daysFromNow(EXTEND_DAYS),
        expiryNotifiedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(collabPosts.id, input.postId))
      .returning();

    await touchTeamActivity(post.teamId);

    return updated;
  });

/**
 * A post as everyone sees it. Viewer-specific state lives in companions —
 * `getPostViewerState` for the viewer's own application, `listResponses`
 * for the owner/staff applicant list — which is what lets this response be
 * identical for every caller and cached at the edge.
 */
export const getPost = os
  .route({ method: "GET" })
  .input(z.object({ postId: z.number() }))
  .handler(async ({ input }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1);

    if (!post) return null;

    const [roles, postSkills, jam, team, project, images, [responseCount]] = await Promise.all([
      db
        .select({ id: collabRoles.id, name: collabRoles.name, category: collabRoles.category })
        .from(collabPostRoles)
        .innerJoin(collabRoles, eq(collabPostRoles.roleId, collabRoles.id))
        .where(eq(collabPostRoles.postId, input.postId)),
      db
        .select({ id: skills.id, name: skills.name, category: skills.category })
        .from(collabPostSkills)
        .innerJoin(skills, eq(collabPostSkills.skillId, skills.id))
        .where(eq(collabPostSkills.postId, input.postId)),
      post.jamId != null
        ? db
            .select({
              jamId: itchJams.jamId,
              title: itchJams.title,
              slug: itchJams.slug,
              startsAt: itchJams.startsAt,
              endsAt: itchJams.endsAt,
              status: itchJams.status,
              bannerUrl: itchJams.bannerUrl,
            })
            .from(itchJams)
            .where(eq(itchJams.jamId, post.jamId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      post.teamId != null
        ? db
            .select({
              id: teams.id,
              slug: teams.slug,
              name: teams.name,
              avatarUrl: teams.avatarUrl,
              avatarKey: teams.avatarKey,
              status: teams.status,
            })
            .from(teams)
            .where(eq(teams.id, post.teamId))
            .limit(1)
            .then(async (rows) => {
              if (!rows[0]) return null;
              const { avatarKey, ...row } = rows[0];
              return {
                ...row,
                avatarUrl: await resolveTeamAvatarUrl({ avatarKey, avatarUrl: row.avatarUrl }),
              };
            })
        : Promise.resolve(null),
      // The project panel — cover, kind, and the canonical page to link
      // to. Unpublished projects still render here: the link is the
      // author's own claim, and the project page enforces its own gate.
      post.projectId != null
        ? db
            .select({
              id: projects.id,
              slug: projects.slug,
              title: projects.title,
              type: projects.type,
              classification: projects.classification,
              imageUrl: projects.imageUrl,
              imageKey: projects.imageKey,
            })
            .from(projects)
            .where(eq(projects.id, post.projectId))
            .limit(1)
            .then(async (rows) => {
              if (!rows[0]) return null;
              const { imageKey, ...row } = rows[0];
              return {
                ...row,
                imageUrl: (await getProfileProjectImageUrl(imageKey)) ?? row.imageUrl,
              };
            })
        : Promise.resolve(null),
      db
        .select()
        .from(collabPostImages)
        .where(eq(collabPostImages.postId, input.postId))
        .orderBy(asc(collabPostImages.sortOrder)),
      db
        .select({ count: count() })
        .from(collabResponses)
        .where(eq(collabResponses.postId, input.postId)),
    ]);

    const [authorProfile] = await db
      .select({
        id: developerProfiles.id,
        avatarUrl: developerProfiles.avatarUrl,
        discordUsername: developerProfiles.discordUsername,
        tagline: developerProfiles.tagline,
        bio: developerProfiles.bio,
        githubUrl: developerProfiles.githubUrl,
        twitterUrl: developerProfiles.twitterUrl,
        websiteUrl: developerProfiles.websiteUrl,
        // Vanity handle, so the byline can link to /profile/handle.
        urlStub: profileUrlStubs.stub,
      })
      .from(developerProfiles)
      .leftJoin(profileUrlStubs, eq(profileUrlStubs.profileId, developerProfiles.id))
      .where(eq(developerProfiles.id, post.authorId))
      .limit(1);

    let author = null;
    if (authorProfile) {
      const authorSkills = post.isIndividual
        ? await db
            .select({ id: skills.id, name: skills.name })
            .from(userSkills)
            .innerJoin(skills, eq(userSkills.skillId, skills.id))
            .where(eq(userSkills.userId, post.authorId))
        : [];
      author = { ...authorProfile, skills: authorSkills };
    }

    // Re-presign each image's URL — `images.url` was generated at
    // upload time and the presigned link inside it has likely expired.
    const presignedImages = await Promise.all(
      images.map(async (img) => ({
        ...img,
        url: (await getProfileProjectImageUrl(img.imageKey)) ?? img.url,
      })),
    );

    // Contact details never ride this response. It carries no auth
    // middleware and is edge-cached, so anything in it is public to the
    // internet by construction — `getPostViewerState` serves the contact
    // block to signed-in guild members instead.
    const { contactType: _contactType, contactMethod: _contactMethod, ...publicPost } = post;

    return {
      ...publicPost,
      // Whether there is a contact block behind the gate, so the anonymous
      // render can offer the sign-in affordance only when it leads somewhere.
      hasContact: Boolean(post.contactType || post.contactMethod),
      roles,
      skills: postSkills,
      jam,
      team,
      project,
      images: presignedImages,
      responseCount: responseCount?.count ?? 0,
      author,
    };
  });

/**
 * The viewer's own application to a post plus the gated contact block, so a
 * returning responder sees what they sent and its status instead of a blank
 * form. The companion to `getPost`'s anonymous core, and deliberately
 * narrow: whether the viewer owns the post follows from the post's public
 * `authorId`, and the match badge is a set intersection the browser does
 * itself.
 *
 * The guild check is a predicate here rather than `requireGuildMember`
 * middleware: someone who applied and later left the server still needs to
 * see their own application, they just stop seeing contact details.
 */
export const getPostViewerState = os
  .use(requireAuth)
  .input(z.object({ postId: z.number() }))
  .handler(async ({ input, context }) => {
    const [[own], [post], inGuild] = await Promise.all([
      db
        .select({
          id: collabResponses.id,
          message: collabResponses.message,
          portfolioUrl: collabResponses.portfolioUrl,
          status: collabResponses.status,
          createdAt: collabResponses.createdAt,
        })
        .from(collabResponses)
        .where(
          and(
            eq(collabResponses.postId, input.postId),
            eq(collabResponses.responderId, context.user.id),
          ),
        )
        .limit(1),
      db
        .select({
          authorId: collabPosts.authorId,
          contactType: collabPosts.contactType,
          contactMethod: collabPosts.contactMethod,
        })
        .from(collabPosts)
        .where(eq(collabPosts.id, input.postId))
        .limit(1),
      userIsGuildMember(context.user.id),
    ]);

    // The author always sees their own contact block, guild or not. Not a
    // courtesy: `updatePost` writes the post's complete state, so an author
    // who left the server would otherwise open the edit wizard to a blank
    // contact step and silently wipe the field on save.
    const canSeeContact = post != null && (inGuild || post.authorId === context.user.id);

    return {
      viewerResponse: own ?? null,
      contact: canSeeContact
        ? { contactType: post.contactType, contactMethod: post.contactMethod }
        : null,
    };
  });

/** The team-invite handoff state of an accepted response. */
export type ResponseInvite = { status: string; teamId: string };

/**
 * Latest team invite per response, keyed by `sourceResponseId`. A response
 * can accumulate invites over time (revoked, then re-sent); the newest one
 * is the state the triage list renders, so INVITE buttons survive reloads
 * instead of living in component state.
 */
async function latestInvitesByResponse(
  responseIds: number[],
): Promise<Map<number, ResponseInvite>> {
  if (responseIds.length === 0) return new Map();
  const rows = await db
    .select({
      sourceResponseId: teamInvites.sourceResponseId,
      status: teamInvites.status,
      teamId: teamInvites.teamId,
    })
    .from(teamInvites)
    .where(inArray(teamInvites.sourceResponseId, responseIds))
    .orderBy(desc(teamInvites.createdAt));

  const latest = new Map<number, ResponseInvite>();
  for (const row of rows) {
    if (row.sourceResponseId != null && !latest.has(row.sourceResponseId)) {
      latest.set(row.sourceResponseId, { status: row.status, teamId: row.teamId });
    }
  }
  return latest;
}

async function skillIdsByUser(userIds: string[]): Promise<Map<string, Set<number>>> {
  const unique = [...new Set(userIds)];
  const byUser = new Map<string, Set<number>>();
  if (unique.length === 0) return byUser;

  const rows = await db
    .select({ userId: userSkills.userId, skillId: userSkills.skillId })
    .from(userSkills)
    .where(inArray(userSkills.userId, unique));

  for (const row of rows) {
    const set = byUser.get(row.userId) ?? new Set<number>();
    set.add(row.skillId);
    byUser.set(row.userId, set);
  }
  return byUser;
}

/** Filters that apply across types — the facets a count can vary over. */
const postFacetSchema = {
  roleIds: z.array(z.number()).optional(),
  skillIds: z.array(z.number()).optional(),
  jamId: z.number().int().positive().optional(),
  teamId: z.string().optional(),
  projectId: z.string().optional(),
  status: z.enum(["recruiting", "party_full", "expired"]).optional(),
  search: z.string().optional(),
  experienceLevel: experienceLevelSchema.optional(),
  compensationType: compensationTypeSchema.optional(),
  isIndividual: z.boolean().optional(),
};

const postFilterSchema = {
  ...postFacetSchema,
  type: postTypeSchema.optional(),
};

type PostFilterInput = {
  [K in keyof typeof postFilterSchema]?: z.infer<(typeof postFilterSchema)[K]>;
};

/**
 * Shared WHERE builder for the board listing and its facet counts. Both
 * go through this so a tab count can never disagree with the list it
 * labels. Pass `{ ...input, type: undefined }` to count across types.
 */
function buildPostFilter(input: PostFilterInput) {
  const conditions = [];

  if (input.type) conditions.push(eq(collabPosts.type, input.type));
  if (input.status === "party_full") {
    // The board's CLOSED filter sends `party_full` and means "not
    // recruiting" — owner-closed and sweep-expired posts both qualify.
    conditions.push(inArray(collabPosts.status, ["party_full", "expired"]));
  } else if (input.status) {
    conditions.push(eq(collabPosts.status, input.status));
  }
  if (input.experienceLevel)
    conditions.push(eq(collabPosts.experienceLevel, input.experienceLevel));
  if (input.compensationType)
    conditions.push(eq(collabPosts.compensationType, input.compensationType));
  if (input.isIndividual === true) {
    conditions.push(eq(collabPosts.isIndividual, true));
  } else if (input.isIndividual === false) {
    conditions.push(
      or(eq(collabPosts.isIndividual, false), sql`${collabPosts.isIndividual} IS NULL`),
    );
  }
  if (input.search) {
    const escaped = escapeLike(input.search);
    const searchCondition = or(
      ilike(collabPosts.title, `%${escaped}%`),
      ilike(collabPosts.description, `%${escaped}%`),
    );
    if (searchCondition) conditions.push(searchCondition);
  }
  if (input.jamId) conditions.push(eq(collabPosts.jamId, input.jamId));
  if (input.teamId) conditions.push(eq(collabPosts.teamId, input.teamId));
  if (input.projectId) conditions.push(eq(collabPosts.projectId, input.projectId));
  if (input.roleIds && input.roleIds.length > 0) {
    const postIdsWithRoles = db
      .select({ postId: collabPostRoles.postId })
      .from(collabPostRoles)
      .where(inArray(collabPostRoles.roleId, input.roleIds));
    conditions.push(inArray(collabPosts.id, postIdsWithRoles));
  }
  // Same shape as roles: "uses any of these" rather than "uses all", so
  // adding a second engine widens the board instead of emptying it.
  if (input.skillIds && input.skillIds.length > 0) {
    const postIdsWithSkills = db
      .select({ postId: collabPostSkills.postId })
      .from(collabPostSkills)
      .where(inArray(collabPostSkills.skillId, input.skillIds));
    conditions.push(inArray(collabPosts.id, postIdsWithSkills));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * Per-type post counts for the board's type tabs. Applies every filter
 * *except* `type`, so each tab reports how many results picking it would
 * yield under the filters already in force — that's what stops users
 * clicking into an empty board.
 */
export const countPostsByType = os
  .route({ method: "GET" })
  .input(z.object(postFacetSchema))
  .handler(async ({ input }) => {
    const rows = await db
      .select({ type: collabPosts.type, count: count() })
      .from(collabPosts)
      .where(buildPostFilter(input))
      .groupBy(collabPosts.type);

    // `all` sums every row, including any pre-v1 playtest/mentor posts
    // still on the board — the ALL tab shows what it says it shows even
    // though those types no longer have a tab of their own.
    const counts = { paid: 0, hobby: 0, all: 0 };
    for (const row of rows) {
      const n = Number(row.count);
      counts.all += n;
      if (row.type === "paid" || row.type === "hobby") counts[row.type] = n;
    }
    return counts;
  });

/**
 * The readout behind the board's idle sidebar: what's open, what those
 * open posts are built in, and which seats they're hiring for. Every
 * figure counts *recruiting* posts only — a stack that's only present on
 * closed posts is history, not a lead — and it's one round trip because
 * the pane renders the three together or not at all.
 */
export const getBoardStats = os.route({ method: "GET" }).handler(async () => {
  const openOnly = eq(collabPosts.status, "recruiting");

  const [typeRows, skillRows, roleRows, freshRow] = await Promise.all([
    db
      .select({ type: collabPosts.type, count: count() })
      .from(collabPosts)
      .where(openOnly)
      .groupBy(collabPosts.type),
    db
      .select({ id: skills.id, name: skills.name, count: count() })
      .from(collabPostSkills)
      .innerJoin(collabPosts, eq(collabPostSkills.postId, collabPosts.id))
      .innerJoin(skills, eq(collabPostSkills.skillId, skills.id))
      .where(openOnly)
      .groupBy(skills.id, skills.name)
      .orderBy(desc(count()))
      .limit(5),
    db
      .select({ id: collabRoles.id, name: collabRoles.name, count: count() })
      .from(collabPostRoles)
      .innerJoin(collabPosts, eq(collabPostRoles.postId, collabPosts.id))
      .innerJoin(collabRoles, eq(collabPostRoles.roleId, collabRoles.id))
      .where(openOnly)
      .groupBy(collabRoles.id, collabRoles.name)
      .orderBy(desc(count()))
      .limit(6),
    db
      .select({ count: count() })
      .from(collabPosts)
      .where(and(openOnly, sql`${collabPosts.createdAt} > now() - interval '7 days'`))
      .then((rows) => rows[0]),
  ]);

  const open = { paid: 0, hobby: 0, all: 0 };
  for (const row of typeRows) {
    const n = Number(row.count);
    open.all += n;
    if (row.type === "paid" || row.type === "hobby") open[row.type] = n;
  }

  return {
    open,
    topSkills: skillRows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) })),
    topRoles: roleRows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) })),
    newThisWeek: Number(freshRow?.count ?? 0),
  };
});

/**
 * How many open team posts a jam has attracted. Drives the jam modal's
 * "N TEAM POSTS" line, which only appears when the answer is non-zero —
 * so it counts recruiting posts only; a wall of closed ones would
 * advertise a dead end.
 */
export const countPostsForJam = os
  .route({ method: "GET" })
  .input(z.object({ jamId: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const [row] = await db
      .select({ count: count() })
      .from(collabPosts)
      .where(and(eq(collabPosts.jamId, input.jamId), eq(collabPosts.status, "recruiting")));
    return { count: row?.count ?? 0 };
  });

export const listPosts = os
  .route({ method: "GET" })
  .input(
    z.object({
      ...postFilterSchema,
      sortBy: z.enum(["createdAt", "updatedAt"]).default("createdAt"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }),
  )
  .handler(async ({ input }) => {
    const query = db.select().from(collabPosts);
    const where = buildPostFilter(input);

    const sortColumn = input.sortBy === "updatedAt" ? collabPosts.updatedAt : collabPosts.createdAt;
    const sortFn = input.sortOrder === "asc" ? asc : desc;

    const posts = await query
      .where(where)
      .orderBy(sortFn(sortColumn))
      .limit(input.limit)
      .offset(input.offset);

    const [totalResult] = await db.select({ count: count() }).from(collabPosts).where(where);

    // Fetch the primary (first by sortOrder) image per post in a single
    // query, keyed by post id. The card view only needs one preview
    // image, so we don't bother joining the full images relation here.
    // We presign each URL fresh here — the `url` column captured on
    // upload is a presigned link that expires after 24h, and even when
    // unexpired we re-stamp so the response always carries a usable
    // link.
    const postIds = posts.map((p) => p.id);
    const primaryImagesByPostId = new Map<number, string>();
    if (postIds.length > 0) {
      const images = await db
        .select({
          postId: collabPostImages.postId,
          objectKey: collabPostImages.imageKey,
          fallbackUrl: collabPostImages.url,
          sortOrder: collabPostImages.sortOrder,
        })
        .from(collabPostImages)
        .where(inArray(collabPostImages.postId, postIds))
        .orderBy(asc(collabPostImages.sortOrder));
      const seen = new Set<number>();
      const primaries = images.filter((img) => {
        if (seen.has(img.postId)) return false;
        seen.add(img.postId);
        return true;
      });
      const presigned = await Promise.all(
        primaries.map(async (img) => ({
          postId: img.postId,
          url: (await getProfileProjectImageUrl(img.objectKey)) ?? img.fallbackUrl,
        })),
      );
      for (const { postId, url } of presigned) {
        primaryImagesByPostId.set(postId, url);
      }
    }

    // Jam chips and stack chips for the whole page in one query each. The
    // card's "you match 4/5" hint is computed in the browser from the
    // viewer's own skill ids (`getMySkillIds`), which is what keeps this
    // response identical for every caller and therefore edge-cacheable.
    const jamIds = [...new Set(posts.map((p) => p.jamId).filter((id): id is number => id != null))];
    const teamIds = [
      ...new Set(posts.map((p) => p.teamId).filter((id): id is string => id != null)),
    ];
    const projectIds = [
      ...new Set(posts.map((p) => p.projectId).filter((id): id is string => id != null)),
    ];
    const [jamRows, teamRows, projectRows, skillRows] = await Promise.all([
      jamIds.length > 0
        ? db
            .select({
              jamId: itchJams.jamId,
              title: itchJams.title,
              slug: itchJams.slug,
              startsAt: itchJams.startsAt,
              endsAt: itchJams.endsAt,
              status: itchJams.status,
            })
            .from(itchJams)
            .where(inArray(itchJams.jamId, jamIds))
        : Promise.resolve([]),
      teamIds.length > 0
        ? db
            .select({
              id: teams.id,
              slug: teams.slug,
              name: teams.name,
              avatarUrl: teams.avatarUrl,
              avatarKey: teams.avatarKey,
            })
            .from(teams)
            .where(inArray(teams.id, teamIds))
            .then((rows) =>
              Promise.all(
                rows.map(async ({ avatarKey, ...row }) => ({
                  ...row,
                  avatarUrl: await resolveTeamAvatarUrl({ avatarKey, avatarUrl: row.avatarUrl }),
                })),
              ),
            )
        : Promise.resolve([]),
      projectIds.length > 0
        ? db
            .select({
              id: projects.id,
              slug: projects.slug,
              title: projects.title,
              type: projects.type,
              imageUrl: projects.imageUrl,
              imageKey: projects.imageKey,
            })
            .from(projects)
            .where(inArray(projects.id, projectIds))
            .then((rows) =>
              Promise.all(
                rows.map(async ({ imageKey, ...row }) => ({
                  ...row,
                  imageUrl: (await getProfileProjectImageUrl(imageKey)) ?? row.imageUrl,
                })),
              ),
            )
        : Promise.resolve([]),
      postIds.length > 0
        ? db
            .select({ postId: collabPostSkills.postId, id: skills.id, name: skills.name })
            .from(collabPostSkills)
            .innerJoin(skills, eq(collabPostSkills.skillId, skills.id))
            .where(inArray(collabPostSkills.postId, postIds))
        : Promise.resolve([]),
    ]);

    const jamById = new Map(jamRows.map((j) => [j.jamId, j]));
    const teamById = new Map(teamRows.map((t) => [t.id, t]));
    const projectById = new Map(projectRows.map((p) => [p.id, p]));
    const skillsByPost = new Map<number, { id: number; name: string }[]>();
    for (const row of skillRows) {
      const list = skillsByPost.get(row.postId) ?? [];
      list.push({ id: row.id, name: row.name });
      skillsByPost.set(row.postId, list);
    }

    return {
      posts: posts.map((p) => {
        const postSkills = skillsByPost.get(p.id) ?? [];
        const project = p.projectId != null ? (projectById.get(p.projectId) ?? null) : null;
        return {
          ...p,
          // A linked project's cover stands in when the poster uploaded
          // nothing — the §8.3 payoff: picking a project makes the card
          // look right with zero uploads.
          primaryImageUrl: primaryImagesByPostId.get(p.id) ?? project?.imageUrl ?? null,
          jam: p.jamId != null ? (jamById.get(p.jamId) ?? null) : null,
          team: p.teamId != null ? (teamById.get(p.teamId) ?? null) : null,
          project,
          skills: postSkills,
        };
      }),
      total: totalResult?.count ?? 0,
    };
  });

export const featurePost = os
  .use(requireStaff)
  .input(z.object({ postId: z.number(), featured: z.boolean() }))
  .handler(async ({ input, context }) => {
    const [updated] = await db
      .update(collabPosts)
      .set({ featuredAt: input.featured ? new Date() : null, updatedAt: new Date() })
      .where(eq(collabPosts.id, input.postId))
      .returning();

    if (!updated) {
      throw new ORPCError("NOT_FOUND", { message: "Post not found." });
    }

    if (input.featured) {
      await notify({
        userId: updated.authorId,
        type: "collab_post_featured",
        actorId: context.user.id,
        entityType: "collab_post",
        entityId: String(updated.id),
        data: { postId: updated.id, postTitle: updated.title },
      });
    }

    return updated;
  });

// ── Responses ────────────────────────────────────────────────────────────────

const ALREADY_RESPONDED = "You've already responded to this post.";

/** Postgres `unique_violation`. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}

export const respondToPost = os
  .use(requireGuildMember)
  .input(
    z.object({
      postId: z.number(),
      message: z.string().min(1).max(2000),
      portfolioUrl: z.url().max(500).optional().or(z.literal("")),
    }),
  )
  .handler(async ({ input, context }) => {
    checkProfanity(input.message, "Message");

    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1);

    if (!post) {
      throw new ORPCError("NOT_FOUND", { message: "Post not found." });
    }

    // Anything other than open recruiting rejects — `party_full` and the
    // sweep's `expired` both mean "no longer taking responses".
    if (post.status !== "recruiting") {
      throw new ORPCError("BAD_REQUEST", {
        message: "This post is no longer accepting responses.",
      });
    }

    if (post.authorId === context.user.id) {
      throw new ORPCError("BAD_REQUEST", { message: "You cannot respond to your own post." });
    }

    // Neutral on purpose — never reveal a block or its direction.
    if (await blockPairExists(post.authorId, context.user.id)) {
      throw new ORPCError("FORBIDDEN", { message: "You can't respond to this post." });
    }

    if (!(await checkRateLimit("collab-response", context.user.id, 30, 86400))) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "You've sent a lot of responses today — try again tomorrow.",
      });
    }

    // `collab_responses` is unique on (post_id, responder_id). Without a
    // pre-check the second application surfaced as the raw DB error,
    // which the response form rendered verbatim.
    const [existing] = await db
      .select({ id: collabResponses.id })
      .from(collabResponses)
      .where(
        and(
          eq(collabResponses.postId, input.postId),
          eq(collabResponses.responderId, context.user.id),
        ),
      )
      .limit(1);

    if (existing) {
      throw new ORPCError("BAD_REQUEST", { message: ALREADY_RESPONDED });
    }

    // Two submits racing past the check above land here; map the unique
    // violation to the same message rather than a 500.
    const [response] = await db
      .insert(collabResponses)
      .values({
        postId: input.postId,
        responderId: context.user.id,
        message: input.message,
        portfolioUrl: input.portfolioUrl,
      })
      .returning()
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) {
          throw new ORPCError("BAD_REQUEST", { message: ALREADY_RESPONDED });
        }
        throw err;
      });

    await notify({
      userId: post.authorId,
      type: "collab_response_received",
      actorId: context.user.id,
      entityType: "collab_post",
      entityId: String(post.id),
      data: { postId: post.id, postTitle: post.title, responseId: response.id },
    });

    return response;
  });

/**
 * A responder revising their pending application. Reviewed responses
 * (accepted/declined) are frozen — the owner already acted on what was
 * written, and acceptance has team-invite side effects.
 */
export const updateMyResponse = os
  .use(requireAuth)
  .input(
    z.object({
      postId: z.number(),
      message: z.string().min(1).max(2000),
      portfolioUrl: z.url().max(500).optional().or(z.literal("")),
    }),
  )
  .handler(async ({ input, context }) => {
    checkProfanity(input.message, "Message");

    const [response] = await db
      .select()
      .from(collabResponses)
      .where(
        and(
          eq(collabResponses.postId, input.postId),
          eq(collabResponses.responderId, context.user.id),
        ),
      )
      .limit(1);

    if (!response) {
      throw new ORPCError("NOT_FOUND", { message: "You haven't responded to this post." });
    }
    if (response.status !== "pending") {
      throw new ORPCError("BAD_REQUEST", {
        message: "This response has already been reviewed and can't be edited.",
      });
    }

    const [updated] = await db
      .update(collabResponses)
      .set({ message: input.message, portfolioUrl: input.portfolioUrl || null })
      .where(eq(collabResponses.id, response.id))
      .returning();

    return updated;
  });

/** Pending-only for the same reason as edit: a reviewed response is a
 * decision record, not a draft. Withdrawing frees the unique
 * (post, responder) slot, so re-responding later works. */
export const withdrawResponse = os
  .use(requireAuth)
  .input(z.object({ postId: z.number() }))
  .handler(async ({ input, context }) => {
    const [response] = await db
      .select()
      .from(collabResponses)
      .where(
        and(
          eq(collabResponses.postId, input.postId),
          eq(collabResponses.responderId, context.user.id),
        ),
      )
      .limit(1);

    if (!response) {
      throw new ORPCError("NOT_FOUND", { message: "You haven't responded to this post." });
    }
    if (response.status !== "pending") {
      throw new ORPCError("BAD_REQUEST", {
        message: "This response has already been reviewed and can't be withdrawn.",
      });
    }

    await db.delete(collabResponses).where(eq(collabResponses.id, response.id));
    return { success: true };
  });

export const listResponses = os
  .use(requireAuthWithPermissions)
  .input(z.object({ postId: z.number() }))
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1);

    if (!post) {
      throw new ORPCError("NOT_FOUND", { message: "Post not found." });
    }

    const isOwner = post.authorId === context.user.id;
    if (!isOwner && !context.isStaff) {
      throw new ORPCError("FORBIDDEN", {
        message: "Only the post owner or staff can view responses.",
      });
    }

    const rows = await db
      .select({
        id: collabResponses.id,
        responderId: collabResponses.responderId,
        message: collabResponses.message,
        portfolioUrl: collabResponses.portfolioUrl,
        status: collabResponses.status,
        createdAt: collabResponses.createdAt,
        responderUsername: developerProfiles.discordUsername,
        responderAvatar: developerProfiles.avatarUrl,
      })
      .from(collabResponses)
      .leftJoin(developerProfiles, eq(collabResponses.responderId, developerProfiles.id))
      .where(eq(collabResponses.postId, input.postId))
      .orderBy(desc(collabResponses.createdAt));

    // Applicant triage: which of the post's stack each responder already
    // knows, so a long list is scannable as chips instead of paragraphs.
    const postSkills = await db
      .select({ id: skills.id, name: skills.name })
      .from(collabPostSkills)
      .innerJoin(skills, eq(collabPostSkills.skillId, skills.id))
      .where(eq(collabPostSkills.postId, input.postId));

    const [skillsByResponder, invitesByResponse] = await Promise.all([
      skillIdsByUser(rows.map((r) => r.responderId)),
      latestInvitesByResponse(rows.map((r) => r.id)),
    ]);

    return rows.map((r) => ({
      ...r,
      stackOverlap: stackOverlap(postSkills, skillsByResponder.get(r.responderId)),
      invite: invitesByResponse.get(r.id) ?? null,
    }));
  });

export const updateResponseStatus = os
  .use(requireAuthWithPermissions)
  .input(
    z.object({
      responseId: z.number(),
      status: z.enum(["accepted", "declined"]),
    }),
  )
  .handler(async ({ input, context }) => {
    const [response] = await db
      .select()
      .from(collabResponses)
      .where(eq(collabResponses.id, input.responseId))
      .limit(1);

    if (!response) {
      throw new ORPCError("NOT_FOUND", { message: "Response not found." });
    }

    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, response.postId))
      .limit(1);

    const isOwner = post?.authorId === context.user.id;
    if (!isOwner && !context.isStaff) {
      throw new ORPCError("FORBIDDEN", {
        message: "Only the post owner or staff can manage responses.",
      });
    }

    // Accepting onto a team post without a team is a notification
    // dead-end — the accept → invite handoff has nowhere to point. The
    // client renders an inline link-or-create flow on this error, then
    // retries via `linkPostTeam`.
    if (input.status === "accepted" && post && !post.isIndividual && post.teamId === null) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Link your team page before accepting — accepted members get invited to it.",
      });
    }

    const [updated] = await db
      .update(collabResponses)
      .set({ status: input.status })
      .where(eq(collabResponses.id, input.responseId))
      .returning();

    if (post) {
      await notify({
        userId: response.responderId,
        type: input.status === "accepted" ? "collab_response_accepted" : "collab_response_declined",
        actorId: context.user.id,
        entityType: "collab_response",
        entityId: String(response.id),
        data: { postId: post.id, postTitle: post.title, responseId: response.id },
      });
    }

    return updated;
  });

// ── Roles ────────────────────────────────────────────────────────────────────

export const listCollabRoles = os
  .route({ method: "GET" })
  .input(z.object({ search: z.string().optional() }))
  .handler(async ({ input }) => {
    if (input.search) {
      return db
        .select()
        .from(collabRoles)
        .where(ilike(collabRoles.name, `%${escapeLike(input.search)}%`));
    }
    return db.select().from(collabRoles);
  });

const roleNameSchema = z.string().trim().min(1).max(100);
const roleCategorySchema = z
  .string()
  .trim()
  .max(100)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable();

/**
 * Names are unique case-sensitively in the DB, which isn't what "already in
 * the vocabulary" means to a moderator — an exact `ilike` (no wildcards,
 * hence the escape) is.
 */
async function assertRoleNameFree(name: string, exceptId?: number): Promise<void> {
  const [match] = await db
    .select({ id: collabRoles.id, name: collabRoles.name })
    .from(collabRoles)
    .where(ilike(collabRoles.name, escapeLike(name)))
    .limit(1);
  if (match && match.id !== exceptId) {
    throw new ORPCError("CONFLICT", { message: `“${match.name}” already exists.` });
  }
}

export const addCollabRole = os
  .use(requireStaff)
  .input(z.object({ name: roleNameSchema, category: roleCategorySchema.optional() }))
  .handler(async ({ input, context }) => {
    await assertRoleNameFree(input.name);
    const [role] = await db
      .insert(collabRoles)
      .values({ name: input.name, category: input.category ?? null })
      .returning();

    await recordModerationAction({
      action: "vocabulary_created",
      actorId: context.user.id,
      targetType: "collab_role",
      targetId: role?.id,
      metadata: { name: input.name, category: input.category ?? null },
    });
    return role;
  });

/** Posts reference roles by id, so a correction propagates on its own. */
export const updateCollabRole = os
  .use(requireStaff)
  .input(
    z.object({
      roleId: z.number(),
      name: roleNameSchema,
      category: roleCategorySchema.optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    await assertRoleNameFree(input.name, input.roleId);
    const [before] = await db
      .select({ name: collabRoles.name, category: collabRoles.category })
      .from(collabRoles)
      .where(eq(collabRoles.id, input.roleId))
      .limit(1);
    const [updated] = await db
      .update(collabRoles)
      .set({ name: input.name, category: input.category ?? null })
      .where(eq(collabRoles.id, input.roleId))
      .returning();
    if (!updated) throw new ORPCError("NOT_FOUND", { message: "Role not found." });

    await recordModerationAction({
      action: "vocabulary_renamed",
      actorId: context.user.id,
      targetType: "collab_role",
      targetId: updated.id,
      metadata: {
        from: before?.name ?? null,
        to: updated.name,
        fromCategory: before?.category ?? null,
        toCategory: updated.category,
      },
    });
    return updated;
  });

export const removeCollabRole = os
  .use(requireAdmin)
  .input(z.object({ roleId: z.number() }))
  .handler(async ({ input, context }) => {
    const [deleted] = await db
      .delete(collabRoles)
      .where(eq(collabRoles.id, input.roleId))
      .returning();

    if (deleted) {
      await recordModerationAction({
        action: "vocabulary_deleted",
        actorId: context.user.id,
        targetType: "collab_role",
        targetId: deleted.id,
        metadata: { name: deleted.name, category: deleted.category },
      });
    }
    return { success: true };
  });

// ── Images ───────────────────────────────────────────────────────────────────

export const addPostImage = os
  .use(requireAuth)
  .input(
    z.object({
      postId: z.number(),
      imageKey: z.string(),
      url: z.url(),
      alt: z.string().max(500).optional(),
      sortOrder: z.number().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1);

    if (!post) {
      throw new ORPCError("NOT_FOUND", { message: "Post not found." });
    }

    if (post.authorId !== context.user.id) {
      throw new ORPCError("FORBIDDEN", { message: "Only the post owner can add images." });
    }

    const [image] = await db
      .insert(collabPostImages)
      .values({
        postId: input.postId,
        imageKey: input.imageKey,
        url: input.url,
        alt: input.alt,
        sortOrder: input.sortOrder,
      })
      .returning();

    return image;
  });

export const removePostImage = os
  .use(requireAuthWithPermissions)
  .input(z.object({ imageId: z.number() }))
  .handler(async ({ input, context }) => {
    const [image] = await db
      .select()
      .from(collabPostImages)
      .where(eq(collabPostImages.id, input.imageId))
      .limit(1);

    if (!image) {
      throw new ORPCError("NOT_FOUND", { message: "Image not found." });
    }

    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, image.postId))
      .limit(1);

    const isOwner = post?.authorId === context.user.id;
    if (!isOwner && !context.isStaff) {
      throw new ORPCError("FORBIDDEN", {
        message: "Only the post owner or staff can remove images.",
      });
    }

    await db.delete(collabPostImages).where(eq(collabPostImages.id, input.imageId));
    return { success: true };
  });

// ── Reports ──────────────────────────────────────────────────────────────────

export const reportPost = os
  .use(requireAuth)
  .input(
    z.object({
      postId: z.number(),
      reason: z.string().min(1).max(1000),
    }),
  )
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1);

    if (!post) {
      throw new ORPCError("NOT_FOUND", { message: "Post not found." });
    }

    checkProfanity(input.reason, "Report reason");

    const [open] = await db
      .select({ id: collabPostReports.id })
      .from(collabPostReports)
      .where(
        and(
          eq(collabPostReports.postId, input.postId),
          eq(collabPostReports.reporterId, context.user.id),
          isNull(collabPostReports.resolvedAt),
        ),
      )
      .limit(1);
    if (open) {
      throw new ORPCError("BAD_REQUEST", { message: "You've already reported this post." });
    }

    // Same bucket as `reportComment`, so a spammer gets 10/hr total across
    // both surfaces rather than 10+10.
    if (!(await checkRateLimit("report", context.user.id, 10))) {
      throw new ORPCError("TOO_MANY_REQUESTS", { message: "Too many reports — try again later." });
    }

    const [report] = await db
      .insert(collabPostReports)
      .values({
        postId: input.postId,
        reporterId: context.user.id,
        reason: input.reason,
      })
      .returning();

    return report;
  });

export const listReports = os
  .use(requireStaff)
  .input(z.object({ postId: z.number().optional(), includeResolved: z.boolean().default(false) }))
  .handler(async ({ input }) => {
    const conditions = [
      input.postId ? eq(collabPostReports.postId, input.postId) : undefined,
      input.includeResolved ? undefined : isNull(collabPostReports.resolvedAt),
    ].filter((c) => c != null);

    const rows = await db
      .select({
        id: collabPostReports.id,
        postId: collabPostReports.postId,
        reporterId: collabPostReports.reporterId,
        reason: collabPostReports.reason,
        createdAt: collabPostReports.createdAt,
        resolvedAt: collabPostReports.resolvedAt,
        resolvedById: collabPostReports.resolvedById,
        postTitle: collabPosts.title,
        postStatus: collabPosts.status,
        postAuthorId: collabPosts.authorId,
      })
      .from(collabPostReports)
      .innerJoin(collabPosts, eq(collabPostReports.postId, collabPosts.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        sql`${collabPostReports.resolvedAt} ASC NULLS FIRST`,
        desc(collabPostReports.createdAt),
      );

    const profiles = await db
      .select({
        id: developerProfiles.id,
        discordUsername: developerProfiles.discordUsername,
        guildNickname: developerProfiles.guildNickname,
        avatarUrl: developerProfiles.avatarUrl,
      })
      .from(developerProfiles)
      .where(
        inArray(developerProfiles.id, [
          ...new Set(rows.flatMap((r) => [r.reporterId, r.postAuthorId])),
        ]),
      );
    const byId = new Map(
      profiles.map((p) => [
        p.id,
        {
          id: p.id,
          displayName: p.guildNickname ?? p.discordUsername ?? "Member",
          avatarUrl: p.avatarUrl,
        },
      ]),
    );

    return rows.map((r) => ({
      ...r,
      reporter: byId.get(r.reporterId) ?? null,
      postAuthor: byId.get(r.postAuthorId) ?? null,
    }));
  });

/**
 * Mirrors `resolveCommentReport`: dismiss clears the queue entry;
 * `close_post` also stops the post from recruiting (same effect and author
 * notification as a staff `closePost`). Hard-delete of junk reports stays
 * admin-only via `deleteReport`.
 */
export const resolvePostReport = os
  .use(requireStaff)
  .input(
    z.object({
      reportId: z.number().int().positive(),
      action: z.enum(["dismiss", "close_post"]),
      /** Recorded in the moderation log; the close notice stays generic. */
      reason: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [report] = await db
      .select()
      .from(collabPostReports)
      .where(eq(collabPostReports.id, input.reportId))
      .limit(1);
    if (!report) throw new ORPCError("NOT_FOUND", { message: "Report not found." });
    if (report.resolvedAt) return { success: true };

    if (input.action === "close_post") {
      const [closed] = await db
        .update(collabPosts)
        .set({ status: "party_full", updatedAt: new Date() })
        .where(and(eq(collabPosts.id, report.postId), eq(collabPosts.status, "recruiting")))
        .returning();
      if (closed) {
        await notify({
          userId: closed.authorId,
          type: "collab_post_closed_by_staff",
          actorId: context.user.id,
          entityType: "collab_post",
          entityId: String(closed.id),
          data: { postId: closed.id, postTitle: closed.title },
        });
      }
    }

    await db
      .update(collabPostReports)
      .set({ resolvedAt: new Date(), resolvedById: context.user.id })
      .where(eq(collabPostReports.id, report.id));

    await recordModerationAction({
      action: input.action === "close_post" ? "post_closed" : "post_report_dismissed",
      actorId: context.user.id,
      targetType: input.action === "close_post" ? "collab_post" : "post_report",
      targetId: input.action === "close_post" ? report.postId : report.id,
      subjectUserId: report.reporterId,
      reason: input.reason,
      metadata: { reportId: report.id, postId: report.postId, reportReason: report.reason },
    });
    return { success: true };
  });

export const deleteReport = os
  .use(requireAdmin)
  .input(z.object({ reportId: z.number() }))
  .handler(async ({ input, context }) => {
    const [deleted] = await db
      .delete(collabPostReports)
      .where(eq(collabPostReports.id, input.reportId))
      .returning();

    // A hard delete is the one action that destroys its own evidence, so
    // the log keeps what the row said.
    if (deleted) {
      await recordModerationAction({
        action: "post_report_deleted",
        actorId: context.user.id,
        targetType: "post_report",
        targetId: deleted.id,
        metadata: {
          postId: deleted.postId,
          reporterId: deleted.reporterId,
          reportReason: deleted.reason,
        },
      });
    }
    return { success: true };
  });
