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
  collabPostSkills,
  collabResponses,
  collabPostImages,
  collabPostReports,
  developerProfiles,
  itchJams,
  profileUrlStubs,
  userSkills,
  skills,
} from "@/db/schema";
import { isStaffMember } from "@/lib/discord";
import { notify } from "@/lib/notifications";
import { getProfileProjectImageUrl } from "@/lib/profile-project-image-storage";
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
  compensationType: compensationTypeSchema.optional(),
  compensationMin: z.number().int().min(0).max(1_000_000).optional(),
  compensationMax: z.number().int().min(0).max(1_000_000).optional(),
  teamSize: teamSizeSchema,
  projectLength: projectLengthSchema,
  platforms: z.array(z.string().max(50)).min(1).max(20),
  experience: z.string().max(1000).optional(),
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
    contactType?: string;
    contactMethod?: string;
  },
  ctx: z.RefinementCtx,
) {
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
  if (input.experience) checkProfanity(input.experience, "Experience");
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

  return { roleIds, skillIds, jamWarning };
}

/** Columns of `collab_posts` the payload writes, minus the link tables. */
function postColumns(input: PostContent) {
  return {
    type: input.type,
    jamId: input.jamId ?? null,
    title: input.title,
    description: input.description,
    projectName: input.projectName,
    compensationType: input.compensationType ?? null,
    compensationMin: input.compensationMin ?? null,
    compensationMax: input.compensationMax ?? null,
    teamSize: input.teamSize,
    projectLength: input.projectLength,
    platforms: input.platforms,
    experience: input.experience ?? null,
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
    const { roleIds, skillIds, jamWarning } = await resolveReferences(input);

    const [post] = await db
      .insert(collabPosts)
      .values({
        authorId: context.user.id,
        ...postColumns(input),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

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
    const { roleIds, skillIds, jamWarning } = await resolveReferences(input);
    const postId = input.postId;

    const [updated] = await db
      .update(collabPosts)
      .set({
        ...postColumns(input),
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

    const [roles, postSkills, jam, images, [responseCount]] = await Promise.all([
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
          stackOverlap: StackOverlap | null;
        }[]
      | null = null;

    if (isOwner || (context.user && (await userIsStaff(context.user.id)))) {
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

      // Applicant triage: which of the post's stack each responder
      // already knows, so a long list is scannable as chips instead of
      // paragraphs.
      const skillsByResponder = await skillIdsByUser(rows.map((r) => r.responderId));
      responses = rows.map((r) => ({
        ...r,
        stackOverlap: stackOverlap(postSkills, skillsByResponder.get(r.responderId)),
      }));
    }

    // Match hint for a signed-in browser looking at someone else's post.
    let viewerOverlap: StackOverlap | null = null;
    if (context.user && !isOwner && postSkills.length > 0) {
      const viewerSkills = await skillIdsByUser([context.user.id]);
      viewerOverlap = stackOverlap(postSkills, viewerSkills.get(context.user.id));
    }

    // Re-presign each image's URL — `images.url` was generated at
    // upload time and the presigned link inside it has likely expired.
    // The `strapiMediaId` column doubles as the MinIO object key.
    const presignedImages = await Promise.all(
      images.map(async (img) => ({
        ...img,
        url: (await getProfileProjectImageUrl(img.strapiMediaId)) ?? img.url,
      })),
    );

    return {
      ...post,
      roles,
      skills: postSkills,
      jam,
      images: presignedImages,
      responseCount: responseCount?.count ?? 0,
      responses,
      viewerOverlap,
      isOwner,
      author,
    };
  });

/** How a person's skills line up with a post's stack. */
export type StackOverlap = { matched: string[]; missing: string[]; total: number };

function stackOverlap(
  stack: { id: number; name: string }[],
  userSkillIds: Set<number> | undefined,
): StackOverlap {
  const matched: string[] = [];
  const missing: string[] = [];
  for (const s of stack) {
    (userSkillIds?.has(s.id) ? matched : missing).push(s.name);
  }
  return { matched, missing, total: stack.length };
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

async function userIsStaff(userId: string): Promise<boolean> {
  const [profile] = await db
    .select({ guildRoles: developerProfiles.guildRoles })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, userId))
    .limit(1);
  return isStaffMember(profile?.guildRoles ?? null);
}

/** Filters that apply across types — the facets a count can vary over. */
const postFacetSchema = {
  roleIds: z.array(z.number()).optional(),
  skillIds: z.array(z.number()).optional(),
  jamId: z.number().int().positive().optional(),
  status: z.enum(["recruiting", "party_full"]).optional(),
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
  if (input.jamId) conditions.push(eq(collabPosts.jamId, input.jamId));
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
  .use(authMiddleware)
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
 * How many open team posts a jam has attracted. Drives the jam modal's
 * "N TEAM POSTS" line, which only appears when the answer is non-zero —
 * so it counts recruiting posts only; a wall of closed ones would
 * advertise a dead end.
 */
export const countPostsForJam = os
  .input(z.object({ jamId: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const [row] = await db
      .select({ count: count() })
      .from(collabPosts)
      .where(and(eq(collabPosts.jamId, input.jamId), eq(collabPosts.status, "recruiting")));
    return { count: row?.count ?? 0 };
  });

export const listPosts = os
  .use(authMiddleware)
  .input(
    z.object({
      ...postFilterSchema,
      sortBy: z.enum(["createdAt", "updatedAt"]).default("createdAt"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }),
  )
  .handler(async ({ input, context }) => {
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
    // link. `strapiMediaId` doubles as the MinIO object key.
    const postIds = posts.map((p) => p.id);
    const primaryImagesByPostId = new Map<number, string>();
    if (postIds.length > 0) {
      const images = await db
        .select({
          postId: collabPostImages.postId,
          objectKey: collabPostImages.strapiMediaId,
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

    // Jam chips and stack chips for the whole page in one query each,
    // plus the viewer's own skills once — the card's "you match 4/5"
    // hint is a set intersection, not a per-row round trip.
    const jamIds = [...new Set(posts.map((p) => p.jamId).filter((id): id is number => id != null))];
    const [jamRows, skillRows, viewerSkills] = await Promise.all([
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
      postIds.length > 0
        ? db
            .select({ postId: collabPostSkills.postId, id: skills.id, name: skills.name })
            .from(collabPostSkills)
            .innerJoin(skills, eq(collabPostSkills.skillId, skills.id))
            .where(inArray(collabPostSkills.postId, postIds))
        : Promise.resolve([]),
      context.user ? skillIdsByUser([context.user.id]) : Promise.resolve(null),
    ]);

    const jamById = new Map(jamRows.map((j) => [j.jamId, j]));
    const skillsByPost = new Map<number, { id: number; name: string }[]>();
    for (const row of skillRows) {
      const list = skillsByPost.get(row.postId) ?? [];
      list.push({ id: row.id, name: row.name });
      skillsByPost.set(row.postId, list);
    }
    const viewerSkillIds = context.user ? viewerSkills?.get(context.user.id) : undefined;

    return {
      posts: posts.map((p) => {
        const postSkills = skillsByPost.get(p.id) ?? [];
        return {
          ...p,
          primaryImageUrl: primaryImagesByPostId.get(p.id) ?? null,
          jam: p.jamId != null ? (jamById.get(p.jamId) ?? null) : null,
          skills: postSkills,
          viewerOverlap:
            context.user && p.authorId !== context.user.id && postSkills.length > 0
              ? stackOverlap(postSkills, viewerSkillIds)
              : null,
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

    if (post.status === "party_full") {
      throw new ORPCError("BAD_REQUEST", {
        message: "This post is no longer accepting responses.",
      });
    }

    if (post.authorId === context.user.id) {
      throw new ORPCError("BAD_REQUEST", { message: "You cannot respond to your own post." });
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
