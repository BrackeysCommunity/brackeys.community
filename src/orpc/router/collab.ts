import { ORPCError } from '@orpc/client'
import { os } from '@orpc/server'
import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from 'obscenity'
import * as z from 'zod'
import { and, eq, ilike, inArray, or, desc, asc, count } from 'drizzle-orm'
import { db } from '@/db'
import {
  collabPosts,
  collabRoles,
  collabPostRoles,
  collabResponses,
  collabPostImages,
  collabPostReports,
  developerProfiles,
} from '@/db/schema'
import { isStaffMember } from '@/lib/discord'
import { authMiddleware, requireAuth, requireAuthWithPermissions, requireStaff, requireAdmin } from '@/orpc/middleware/auth'

const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
})

function checkProfanity(text: string, fieldName: string) {
  if (profanityMatcher.hasMatch(text)) {
    throw new ORPCError('BAD_REQUEST', {
      message: `${fieldName} contains inappropriate language.`,
    })
  }
}

// ── Post CRUD ────────────────────────────────────────────────────────────────

export const createPost = os
  .use(requireAuth)
  .input(
    z.object({
      type: z.enum(['paid', 'hobby', 'playtest', 'mentor']),
      subtype: z.enum(['hiring', 'offering']).optional(),
      title: z.string().min(1).max(200),
      description: z.string().min(1).max(5000),
      projectName: z.string().max(200).optional(),
      compensation: z.string().max(500).optional(),
      teamSize: z.string().max(50).optional(),
      projectLength: z.string().max(100).optional(),
      platforms: z.array(z.string()).optional(),
      experience: z.string().max(1000).optional(),
      portfolioUrl: z.string().url().max(500).optional(),
      contactMethod: z.string().max(500).optional(),
      roleIds: z.array(z.number()).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    checkProfanity(input.title, 'Title')
    checkProfanity(input.description, 'Description')

    const { roleIds, ...postData } = input

    const [post] = await db
      .insert(collabPosts)
      .values({
        authorId: context.user.id,
        ...postData,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    if (roleIds && roleIds.length > 0) {
      await db.insert(collabPostRoles).values(
        roleIds.map((roleId) => ({ postId: post.id, roleId })),
      )
    }

    return post
  })

export const updatePost = os
  .use(requireAuthWithPermissions)
  .input(
    z.object({
      postId: z.number(),
      title: z.string().min(1).max(200).optional(),
      description: z.string().min(1).max(5000).optional(),
      subtype: z.enum(['hiring', 'offering']).optional(),
      projectName: z.string().max(200).optional(),
      compensation: z.string().max(500).optional(),
      teamSize: z.string().max(50).optional(),
      projectLength: z.string().max(100).optional(),
      platforms: z.array(z.string()).optional(),
      experience: z.string().max(1000).optional(),
      portfolioUrl: z.string().url().max(500).optional(),
      contactMethod: z.string().max(500).optional(),
      roleIds: z.array(z.number()).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1)

    if (!post) {
      throw new ORPCError('NOT_FOUND', { message: 'Post not found.' })
    }

    const isOwner = post.authorId === context.user.id
    if (!isOwner && !context.isStaff) {
      throw new ORPCError('FORBIDDEN', { message: 'You can only edit your own posts.' })
    }

    if (input.title) checkProfanity(input.title, 'Title')
    if (input.description) checkProfanity(input.description, 'Description')

    const { postId, roleIds, ...data } = input

    const [updated] = await db
      .update(collabPosts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(collabPosts.id, postId))
      .returning()

    if (roleIds !== undefined) {
      await db.delete(collabPostRoles).where(eq(collabPostRoles.postId, postId))
      if (roleIds.length > 0) {
        await db.insert(collabPostRoles).values(
          roleIds.map((roleId) => ({ postId, roleId })),
        )
      }
    }

    return updated
  })

export const deletePost = os
  .use(requireAuthWithPermissions)
  .input(z.object({ postId: z.number() }))
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1)

    if (!post) {
      throw new ORPCError('NOT_FOUND', { message: 'Post not found.' })
    }

    const isOwner = post.authorId === context.user.id
    if (!isOwner && !context.isStaff) {
      throw new ORPCError('FORBIDDEN', { message: 'You can only delete your own posts.' })
    }

    await db.delete(collabPosts).where(eq(collabPosts.id, input.postId))
    return { success: true }
  })

export const closePost = os
  .use(requireAuthWithPermissions)
  .input(z.object({ postId: z.number() }))
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1)

    if (!post) {
      throw new ORPCError('NOT_FOUND', { message: 'Post not found.' })
    }

    const isOwner = post.authorId === context.user.id
    if (!isOwner && !context.isStaff) {
      throw new ORPCError('FORBIDDEN', { message: 'You can only close your own posts.' })
    }

    const [updated] = await db
      .update(collabPosts)
      .set({ status: 'party_full', updatedAt: new Date() })
      .where(eq(collabPosts.id, input.postId))
      .returning()

    return updated
  })

export const reopenPost = os
  .use(requireAuthWithPermissions)
  .input(z.object({ postId: z.number() }))
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1)

    if (!post) {
      throw new ORPCError('NOT_FOUND', { message: 'Post not found.' })
    }

    const isOwner = post.authorId === context.user.id
    if (!isOwner && !context.isStaff) {
      throw new ORPCError('FORBIDDEN', { message: 'You can only reopen your own posts.' })
    }

    const [updated] = await db
      .update(collabPosts)
      .set({ status: 'recruiting', updatedAt: new Date() })
      .where(eq(collabPosts.id, input.postId))
      .returning()

    return updated
  })

export const getPost = os
  .use(authMiddleware)
  .input(z.object({ postId: z.number() }))
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1)

    if (!post) return null

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
    ])

    const isOwner = context.user?.id === post.authorId
    let responses = null

    if (isOwner || (context.user && await userIsStaff(context.user.id))) {
      responses = await db
        .select()
        .from(collabResponses)
        .where(eq(collabResponses.postId, input.postId))
        .orderBy(desc(collabResponses.createdAt))
    }

    return {
      ...post,
      roles,
      images,
      responseCount: responseCount?.count ?? 0,
      responses,
      isOwner,
    }
  })

async function userIsStaff(userId: string): Promise<boolean> {
  const [profile] = await db
    .select({ guildRoles: developerProfiles.guildRoles })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, userId))
    .limit(1)
  return isStaffMember(profile?.guildRoles ?? null)
}

export const listPosts = os
  .use(authMiddleware)
  .input(
    z.object({
      type: z.enum(['paid', 'hobby', 'playtest', 'mentor']).optional(),
      subtype: z.enum(['hiring', 'offering']).optional(),
      roleIds: z.array(z.number()).optional(),
      status: z.enum(['recruiting', 'party_full']).optional(),
      search: z.string().optional(),
      sortBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'),
      sortOrder: z.enum(['asc', 'desc']).default('desc'),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }),
  )
  .handler(async ({ input }) => {
    const conditions = []

    if (input.type) conditions.push(eq(collabPosts.type, input.type))
    if (input.subtype) conditions.push(eq(collabPosts.subtype, input.subtype))
    if (input.status) conditions.push(eq(collabPosts.status, input.status))
    if (input.search) {
      conditions.push(
        or(
          ilike(collabPosts.title, `%${input.search}%`),
          ilike(collabPosts.description, `%${input.search}%`),
        ),
      )
    }

    let query = db.select().from(collabPosts)

    if (input.roleIds && input.roleIds.length > 0) {
      const postIdsWithRoles = db
        .select({ postId: collabPostRoles.postId })
        .from(collabPostRoles)
        .where(inArray(collabPostRoles.roleId, input.roleIds))
      conditions.push(inArray(collabPosts.id, postIdsWithRoles))
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const sortColumn = input.sortBy === 'updatedAt' ? collabPosts.updatedAt : collabPosts.createdAt
    const sortFn = input.sortOrder === 'asc' ? asc : desc

    const posts = await query
      .where(where)
      .orderBy(sortFn(sortColumn))
      .limit(input.limit)
      .offset(input.offset)

    const [totalResult] = await db
      .select({ count: count() })
      .from(collabPosts)
      .where(where)

    return {
      posts,
      total: totalResult?.count ?? 0,
    }
  })

export const featurePost = os
  .use(requireStaff)
  .input(z.object({ postId: z.number(), featured: z.boolean() }))
  .handler(async ({ input }) => {
    const [updated] = await db
      .update(collabPosts)
      .set({ featuredAt: input.featured ? new Date() : null, updatedAt: new Date() })
      .where(eq(collabPosts.id, input.postId))
      .returning()

    if (!updated) {
      throw new ORPCError('NOT_FOUND', { message: 'Post not found.' })
    }

    return updated
  })

// ── Responses ────────────────────────────────────────────────────────────────

export const respondToPost = os
  .use(requireAuth)
  .input(
    z.object({
      postId: z.number(),
      message: z.string().min(1).max(2000),
      portfolioUrl: z.string().url().max(500).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    checkProfanity(input.message, 'Message')

    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1)

    if (!post) {
      throw new ORPCError('NOT_FOUND', { message: 'Post not found.' })
    }

    if (post.status === 'party_full') {
      throw new ORPCError('BAD_REQUEST', { message: 'This post is no longer accepting responses.' })
    }

    if (post.authorId === context.user.id) {
      throw new ORPCError('BAD_REQUEST', { message: 'You cannot respond to your own post.' })
    }

    const [response] = await db
      .insert(collabResponses)
      .values({
        postId: input.postId,
        responderId: context.user.id,
        message: input.message,
        portfolioUrl: input.portfolioUrl,
      })
      .returning()

    return response
  })

export const listResponses = os
  .use(requireAuthWithPermissions)
  .input(z.object({ postId: z.number() }))
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1)

    if (!post) {
      throw new ORPCError('NOT_FOUND', { message: 'Post not found.' })
    }

    const isOwner = post.authorId === context.user.id
    if (!isOwner && !context.isStaff) {
      throw new ORPCError('FORBIDDEN', { message: 'Only the post owner or staff can view responses.' })
    }

    return db
      .select()
      .from(collabResponses)
      .where(eq(collabResponses.postId, input.postId))
      .orderBy(desc(collabResponses.createdAt))
  })

export const updateResponseStatus = os
  .use(requireAuthWithPermissions)
  .input(
    z.object({
      responseId: z.number(),
      status: z.enum(['accepted', 'declined']),
    }),
  )
  .handler(async ({ input, context }) => {
    const [response] = await db
      .select()
      .from(collabResponses)
      .where(eq(collabResponses.id, input.responseId))
      .limit(1)

    if (!response) {
      throw new ORPCError('NOT_FOUND', { message: 'Response not found.' })
    }

    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, response.postId))
      .limit(1)

    const isOwner = post?.authorId === context.user.id
    if (!isOwner && !context.isStaff) {
      throw new ORPCError('FORBIDDEN', { message: 'Only the post owner or staff can manage responses.' })
    }

    const [updated] = await db
      .update(collabResponses)
      .set({ status: input.status })
      .where(eq(collabResponses.id, input.responseId))
      .returning()

    return updated
  })

// ── Roles ────────────────────────────────────────────────────────────────────

export const listCollabRoles = os
  .input(z.object({ search: z.string().optional() }))
  .handler(async ({ input }) => {
    if (input.search) {
      return db
        .select()
        .from(collabRoles)
        .where(ilike(collabRoles.name, `%${input.search}%`))
    }
    return db.select().from(collabRoles)
  })

export const addCollabRole = os
  .use(requireStaff)
  .input(z.object({ name: z.string().min(1).max(100), category: z.string().max(100).optional() }))
  .handler(async ({ input }) => {
    const [role] = await db
      .insert(collabRoles)
      .values({ name: input.name, category: input.category })
      .returning()

    return role
  })

export const removeCollabRole = os
  .use(requireAdmin)
  .input(z.object({ roleId: z.number() }))
  .handler(async ({ input }) => {
    await db.delete(collabRoles).where(eq(collabRoles.id, input.roleId))
    return { success: true }
  })

// ── Images ───────────────────────────────────────────────────────────────────

export const addPostImage = os
  .use(requireAuth)
  .input(
    z.object({
      postId: z.number(),
      strapiMediaId: z.string(),
      url: z.string().url(),
      alt: z.string().max(500).optional(),
      sortOrder: z.number().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, input.postId))
      .limit(1)

    if (!post) {
      throw new ORPCError('NOT_FOUND', { message: 'Post not found.' })
    }

    if (post.authorId !== context.user.id) {
      throw new ORPCError('FORBIDDEN', { message: 'Only the post owner can add images.' })
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
      .returning()

    return image
  })

export const removePostImage = os
  .use(requireAuthWithPermissions)
  .input(z.object({ imageId: z.number() }))
  .handler(async ({ input, context }) => {
    const [image] = await db
      .select()
      .from(collabPostImages)
      .where(eq(collabPostImages.id, input.imageId))
      .limit(1)

    if (!image) {
      throw new ORPCError('NOT_FOUND', { message: 'Image not found.' })
    }

    const [post] = await db
      .select()
      .from(collabPosts)
      .where(eq(collabPosts.id, image.postId))
      .limit(1)

    const isOwner = post?.authorId === context.user.id
    if (!isOwner && !context.isStaff) {
      throw new ORPCError('FORBIDDEN', { message: 'Only the post owner or staff can remove images.' })
    }

    await db.delete(collabPostImages).where(eq(collabPostImages.id, input.imageId))
    return { success: true }
  })

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
      .limit(1)

    if (!post) {
      throw new ORPCError('NOT_FOUND', { message: 'Post not found.' })
    }

    const [report] = await db
      .insert(collabPostReports)
      .values({
        postId: input.postId,
        reporterId: context.user.id,
        reason: input.reason,
      })
      .returning()

    return report
  })

export const listReports = os
  .use(requireStaff)
  .input(z.object({ postId: z.number().optional() }))
  .handler(async ({ input }) => {
    if (input.postId) {
      return db
        .select()
        .from(collabPostReports)
        .where(eq(collabPostReports.postId, input.postId))
        .orderBy(desc(collabPostReports.createdAt))
    }
    return db
      .select()
      .from(collabPostReports)
      .orderBy(desc(collabPostReports.createdAt))
  })

export const deleteReport = os
  .use(requireAdmin)
  .input(z.object({ reportId: z.number() }))
  .handler(async ({ input }) => {
    await db.delete(collabPostReports).where(eq(collabPostReports.id, input.reportId))
    return { success: true }
  })
