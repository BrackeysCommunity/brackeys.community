import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { and, eq, ilike, inArray, or, desc, asc, count, sql } from "drizzle-orm";
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";
import * as z from "zod";

import { db } from "@/db";
import {
  collabPosts,
  collabRoles,
  collabPostRoles,
  collabResponses,
  collabPostImages,
  collabPostReports,
  developerProfiles,
  userSkills,
  skills,
} from "@/db/schema";
import { isStaffMember } from "@/lib/discord";
import {
  authMiddleware,
  requireAuth,
  requireGuildMember,
  requireAuthWithPermissions,
  requireStaff,
  requireAdmin,
} from "@/orpc/middleware/auth";

function escapeLike(str: string): string {
  return str.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

function checkProfanity(text: string, fieldName: string) {
  if (profanityMatcher.hasMatch(text)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${fieldName} contains inappropriate language.`,
    });
  }
}

const compensationTypeSchema = z.enum(["hourly", "fixed", "rev_share", "negotiable"]);
const teamSizeSchema = z.enum(["solo", "2-3", "4-6", "7+"]);
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

// ── Post CRUD ────────────────────────────────────────────────────────────────

export const createPost = os
  .use(requireGuildMember)
  .input(
    z.object({
      type: z.enum(["paid", "hobby", "playtest", "mentor"]),
      title: z.string().min(1).max(200),
      description: z.string().min(1).max(5000),
      projectName: z.string().max(200).optional(),
      compensation: z.string().max(500).optional(),
      compensationType: compensationTypeSchema.optional(),
      teamSize: teamSizeSchema.optional(),
      projectLength: projectLengthSchema.optional(),
      platforms: z.array(z.string()).optional(),
      experience: z.string().max(1000).optional(),
      experienceLevel: experienceLevelSchema.optional(),
      portfolioUrl: z.url().max(500).optional().or(z.literal("")),
      contactMethod: z.string().max(500).optional(),
      contactType: contactTypeSchema.optional(),
      isIndividual: z.boolean().optional(),
      roleIds: z.array(z.number()).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    checkProfanity(input.title, "Title");
    checkProfanity(input.description, "Description");
    if (input.projectName) checkProfanity(input.projectName, "Project name");
    if (input.compensation) checkProfanity(input.compensation, "Compensation");
    if (input.experience) checkProfanity(input.experience, "Experience");
    if (input.contactMethod) checkProfanity(input.contactMethod, "Contact method");

    const { roleIds, ...postData } = input;

    const [post] = await db
      .insert(collabPosts)
      .values({
        authorId: context.user.id,
        ...postData,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    if (roleIds && roleIds.length > 0) {
      await db
        .insert(collabPostRoles)
        .values(roleIds.map((roleId) => ({ postId: post.id, roleId })));
    }

    return post;
  });

export const updatePost = os
  .use(requireAuthWithPermissions)
  .input(
    z.object({
      postId: z.number(),
      title: z.string().min(1).max(200).optional(),
      description: z.string().min(1).max(5000).optional(),
      projectName: z.string().max(200).optional(),
      compensation: z.string().max(500).optional(),
      compensationType: compensationTypeSchema.optional(),
      teamSize: teamSizeSchema.optional(),
      projectLength: projectLengthSchema.optional(),
      platforms: z.array(z.string()).optional(),
      experience: z.string().max(1000).optional(),
      experienceLevel: experienceLevelSchema.optional(),
      portfolioUrl: z.url().max(500).optional().or(z.literal("")),
      contactMethod: z.string().max(500).optional(),
      contactType: contactTypeSchema.optional(),
      isIndividual: z.boolean().optional(),
      roleIds: z.array(z.number()).optional(),
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

    const isOwner = post.authorId === context.user.id;
    if (!isOwner && !context.isStaff) {
      throw new ORPCError("FORBIDDEN", { message: "You can only edit your own posts." });
    }

    if (input.title) checkProfanity(input.title, "Title");
    if (input.description) checkProfanity(input.description, "Description");
    if (input.projectName) checkProfanity(input.projectName, "Project name");
    if (input.compensation) checkProfanity(input.compensation, "Compensation");
    if (input.experience) checkProfanity(input.experience, "Experience");
    if (input.contactMethod) checkProfanity(input.contactMethod, "Contact method");

    const { postId, roleIds, ...data } = input;

    const [updated] = await db
      .update(collabPosts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(collabPosts.id, postId))
      .returning();

    if (roleIds !== undefined) {
      await db.delete(collabPostRoles).where(eq(collabPostRoles.postId, postId));
      if (roleIds.length > 0) {
        await db.insert(collabPostRoles).values(roleIds.map((roleId) => ({ postId, roleId })));
      }
    }

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
      .set({ status: "recruiting", updatedAt: new Date() })
      .where(eq(collabPosts.id, input.postId))
      .returning();

    return updated;
  });

export const getPost = os
  .use(authMiddleware)
  .input(z.object({ postId: z.number() }))
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1);

    if (!post) return null;

    const [roles, images, [responseCount]] = await Promise.all([
      db
        .select({ id: collabRoles.id, name: collabRoles.name, category: collabRoles.category })
        .from(collabPostRoles)
        .innerJoin(collabRoles, eq(collabPostRoles.roleId, collabRoles.id))
        .where(eq(collabPostRoles.postId, input.postId)),
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
        avatarUrl: developerProfiles.avatarUrl,
        discordUsername: developerProfiles.discordUsername,
        tagline: developerProfiles.tagline,
        bio: developerProfiles.bio,
        githubUrl: developerProfiles.githubUrl,
        twitterUrl: developerProfiles.twitterUrl,
        websiteUrl: developerProfiles.websiteUrl,
      })
      .from(developerProfiles)
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

    const isOwner = context.user?.id === post.authorId;
    let responses:
      | {
          id: number;
          responderId: string;
          message: string;
          portfolioUrl: string | null;
          status: string;
          createdAt: Date | null;
          responderUsername: string | null;
          responderAvatar: string | null;
        }[]
      | null = null;

    if (isOwner || (context.user && (await userIsStaff(context.user.id)))) {
      responses = await db
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
    }

    return {
      ...post,
      roles,
      images,
      responseCount: responseCount?.count ?? 0,
      responses,
      isOwner,
      author,
    };
  });

async function userIsStaff(userId: string): Promise<boolean> {
  const [profile] = await db
    .select({ guildRoles: developerProfiles.guildRoles })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, userId))
    .limit(1);
  return isStaffMember(profile?.guildRoles ?? null);
}

export const listPosts = os
  .use(authMiddleware)
  .input(
    z.object({
      type: z.enum(["paid", "hobby", "playtest", "mentor"]).optional(),
      roleIds: z.array(z.number()).optional(),
      status: z.enum(["recruiting", "party_full"]).optional(),
      search: z.string().optional(),
      experienceLevel: experienceLevelSchema.optional(),
      compensationType: compensationTypeSchema.optional(),
      isIndividual: z.boolean().optional(),
      sortBy: z.enum(["createdAt", "updatedAt"]).default("createdAt"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }),
  )
  .handler(async ({ input }) => {
    const conditions = [];

    if (input.type) conditions.push(eq(collabPosts.type, input.type));
    if (input.status) conditions.push(eq(collabPosts.status, input.status));
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

    let query = db.select().from(collabPosts);

    if (input.roleIds && input.roleIds.length > 0) {
      const postIdsWithRoles = db
        .select({ postId: collabPostRoles.postId })
        .from(collabPostRoles)
        .where(inArray(collabPostRoles.roleId, input.roleIds));
      conditions.push(inArray(collabPosts.id, postIdsWithRoles));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const sortColumn = input.sortBy === "updatedAt" ? collabPosts.updatedAt : collabPosts.createdAt;
    const sortFn = input.sortOrder === "asc" ? asc : desc;

    const posts = await query
      .where(where)
      .orderBy(sortFn(sortColumn))
      .limit(input.limit)
      .offset(input.offset);

    const [totalResult] = await db.select({ count: count() }).from(collabPosts).where(where);

    return {
      posts,
      total: totalResult?.count ?? 0,
    };
  });

export const featurePost = os
  .use(requireStaff)
  .input(z.object({ postId: z.number(), featured: z.boolean() }))
  .handler(async ({ input }) => {
    const [updated] = await db
      .update(collabPosts)
      .set({ featuredAt: input.featured ? new Date() : null, updatedAt: new Date() })
      .where(eq(collabPosts.id, input.postId))
      .returning();

    if (!updated) {
      throw new ORPCError("NOT_FOUND", { message: "Post not found." });
    }

    return updated;
  });

// ── Responses ────────────────────────────────────────────────────────────────

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

    if (post.status === "party_full") {
      throw new ORPCError("BAD_REQUEST", {
        message: "This post is no longer accepting responses.",
      });
    }

    if (post.authorId === context.user.id) {
      throw new ORPCError("BAD_REQUEST", { message: "You cannot respond to your own post." });
    }

    const [response] = await db
      .insert(collabResponses)
      .values({
        postId: input.postId,
        responderId: context.user.id,
        message: input.message,
        portfolioUrl: input.portfolioUrl,
      })
      .returning();

    return response;
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

    return db
      .select()
      .from(collabResponses)
      .where(eq(collabResponses.postId, input.postId))
      .orderBy(desc(collabResponses.createdAt));
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

    const [updated] = await db
      .update(collabResponses)
      .set({ status: input.status })
      .where(eq(collabResponses.id, input.responseId))
      .returning();

    return updated;
  });

// ── Roles ────────────────────────────────────────────────────────────────────

export const listCollabRoles = os
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

export const addCollabRole = os
  .use(requireStaff)
  .input(z.object({ name: z.string().min(1).max(100), category: z.string().max(100).optional() }))
  .handler(async ({ input }) => {
    const [role] = await db
      .insert(collabRoles)
      .values({ name: input.name, category: input.category })
      .returning();

    return role;
  });

export const removeCollabRole = os
  .use(requireAdmin)
  .input(z.object({ roleId: z.number() }))
  .handler(async ({ input }) => {
    await db.delete(collabRoles).where(eq(collabRoles.id, input.roleId));
    return { success: true };
  });

// ── Images ───────────────────────────────────────────────────────────────────

export const addPostImage = os
  .use(requireAuth)
  .input(
    z.object({
      postId: z.number(),
      strapiMediaId: z.string(),
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
        strapiMediaId: input.strapiMediaId,
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
  .input(z.object({ postId: z.number().optional() }))
  .handler(async ({ input }) => {
    if (input.postId) {
      return db
        .select()
        .from(collabPostReports)
        .where(eq(collabPostReports.postId, input.postId))
        .orderBy(desc(collabPostReports.createdAt));
    }
    return db.select().from(collabPostReports).orderBy(desc(collabPostReports.createdAt));
  });

export const deleteReport = os
  .use(requireAdmin)
  .input(z.object({ reportId: z.number() }))
  .handler(async ({ input }) => {
    await db.delete(collabPostReports).where(eq(collabPostReports.id, input.reportId));
    return { success: true };
  });
