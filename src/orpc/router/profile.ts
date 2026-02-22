import { ORPCError } from '@orpc/client'
import { os } from '@orpc/server'
import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from 'obscenity'
import * as z from 'zod'
import { and, eq, ilike } from 'drizzle-orm'
import { db } from '@/db'
import {
  developerProfiles,
  skills,
  userSkills,
  skillRequests,
  profileProjects,
  profileUrlStubs,
  jamParticipations,
} from '@/db/schema'
import { authMiddleware, requireAuth } from '@/orpc/middleware/auth'

const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
})

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
    .where(eq(userSkills.userId, userId))
}

export const getProfile = os
  .use(authMiddleware)
  .input(z.object({ userId: z.string() }))
  .handler(async ({ input, context }) => {
    // Try direct ID lookup first, then fall back to URL stub resolution
    let [profile] = await db
      .select()
      .from(developerProfiles)
      .where(eq(developerProfiles.id, input.userId))
      .limit(1)

    if (!profile) {
      const [stub] = await db
        .select()
        .from(profileUrlStubs)
        .where(eq(profileUrlStubs.stub, input.userId.toLowerCase()))
        .limit(1)

      if (stub) {
        ;[profile] = await db
          .select()
          .from(developerProfiles)
          .where(eq(developerProfiles.id, stub.profileId))
          .limit(1)
      }
    }

    if (!profile) return null

    const profileId = profile.id
    const isOwner = context.user?.id === profileId

    const [skillList, projects, jams, urlStub] = await Promise.all([
      queryUserSkills(profileId),
      isOwner
        ? db.select().from(profileProjects).where(eq(profileProjects.profileId, profileId))
        : db.select().from(profileProjects).where(and(eq(profileProjects.profileId, profileId), eq(profileProjects.status, 'approved'))),
      db.select().from(jamParticipations).where(eq(jamParticipations.profileId, profileId)),
      db.select().from(profileUrlStubs).where(eq(profileUrlStubs.profileId, profileId)).limit(1),
    ])

    return { profile, skills: skillList, projects, jams, isOwner, urlStub: urlStub[0]?.stub ?? null }
  })

export const getMyProfile = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const userId = context.user.id

    const [profile] = await db
      .select()
      .from(developerProfiles)
      .where(eq(developerProfiles.id, userId))
      .limit(1)

    if (!profile) return null

    const [skillList, projects, jams, pendingSkillRequests, urlStub] = await Promise.all([
      queryUserSkills(userId),
      db.select().from(profileProjects).where(eq(profileProjects.profileId, userId)),
      db.select().from(jamParticipations).where(eq(jamParticipations.profileId, userId)),
      db.select().from(skillRequests).where(and(eq(skillRequests.userId, userId), eq(skillRequests.status, 'pending'))),
      db.select().from(profileUrlStubs).where(eq(profileUrlStubs.profileId, userId)).limit(1),
    ])

    return { profile, skills: skillList, projects, jams, pendingSkillRequests, urlStub: urlStub[0]?.stub ?? null, isOwner: true }
  })

export const updateProfile = os
  .use(requireAuth)
  .input(
    z.object({
      bio: z.string().optional(),
      tagline: z.string().optional(),
      githubUrl: z.string().optional(),
      twitterUrl: z.string().optional(),
      websiteUrl: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const userId = context.user.id

    const [updated] = await db
      .update(developerProfiles)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(developerProfiles.id, userId))
      .returning()

    return updated
  })

export const syncDiscordData = os
  .use(requireAuth)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const userId = context.user.id
    const user = context.user

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
      .returning()

    return upserted
  })

export const listSkills = os
  .input(z.object({ search: z.string().optional() }))
  .handler(async ({ input }) => {
    if (input.search) {
      return db
        .select()
        .from(skills)
        .where(ilike(skills.name, `%${input.search}%`))
    }
    return db.select().from(skills)
  })

export const addUserSkill = os
  .use(requireAuth)
  .input(z.object({ skillId: z.number() }))
  .handler(async ({ input, context }) => {
    const [inserted] = await db
      .insert(userSkills)
      .values({ userId: context.user.id, skillId: input.skillId })
      .returning()

    return inserted
  })

export const removeUserSkill = os
  .use(requireAuth)
  .input(z.object({ userSkillId: z.number() }))
  .handler(async ({ input }) => {
    await db
      .delete(userSkills)
      .where(eq(userSkills.id, input.userSkillId))

    return { success: true }
  })

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
      .returning()

    return request
  })

export const addProject = os
  .use(requireAuth)
  .input(
    z.object({
      title: z.string(),
      description: z.string().optional(),
      url: z.string().optional(),
      screenshotUrl: z.string().optional(),
      imageUrl: z.string().optional(),
      tags: z.array(z.string()).optional(),
      pinned: z.boolean().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [project] = await db
      .insert(profileProjects)
      .values({ profileId: context.user.id, ...input })
      .returning()

    return project
  })

export const updateProject = os
  .use(requireAuth)
  .input(
    z.object({
      projectId: z.number(),
      title: z.string().optional(),
      description: z.string().optional(),
      url: z.string().optional(),
      screenshotUrl: z.string().optional(),
      imageUrl: z.string().optional(),
      tags: z.array(z.string()).optional(),
      pinned: z.boolean().optional(),
    }),
  )
  .handler(async ({ input }) => {
    const { projectId, ...data } = input

    const [updated] = await db
      .update(profileProjects)
      .set(data)
      .where(eq(profileProjects.id, projectId))
      .returning()

    return updated
  })

export const removeProject = os
  .use(requireAuth)
  .input(z.object({ projectId: z.number() }))
  .handler(async ({ input }) => {
    await db
      .delete(profileProjects)
      .where(eq(profileProjects.id, input.projectId))

    return { success: true }
  })

export const addJamParticipation = os
  .use(requireAuth)
  .input(
    z.object({
      jamName: z.string(),
      jamUrl: z.string().optional(),
      submissionTitle: z.string().optional(),
      submissionUrl: z.string().optional(),
      result: z.string().optional(),
      teamMembers: z.array(z.string()).optional(),
      participatedAt: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const [participation] = await db
      .insert(jamParticipations)
      .values({
        profileId: context.user.id,
        ...input,
        participatedAt: input.participatedAt ? new Date(input.participatedAt) : null,
      })
      .returning()

    return participation
  })

export const removeJamParticipation = os
  .use(requireAuth)
  .input(z.object({ jamId: z.number() }))
  .handler(async ({ input }) => {
    await db
      .delete(jamParticipations)
      .where(eq(jamParticipations.id, input.jamId))

    return { success: true }
  })

const STUB_REGEX = /^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/

export const setUrlStub = os
  .use(requireAuth)
  .input(z.object({ stub: z.string().min(3).max(32) }))
  .handler(async ({ input, context }) => {
    const userId = context.user.id
    const stub = input.stub.toLowerCase().trim()

    if (!STUB_REGEX.test(stub)) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'URL stub must be 3-32 characters, start and end with a letter or number, and contain only lowercase letters, numbers, hyphens, and underscores.',
      })
    }

    if (profanityMatcher.hasMatch(stub)) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'URL stub contains inappropriate language.',
      })
    }

    // Check if stub is already taken by another user
    const [existing] = await db
      .select()
      .from(profileUrlStubs)
      .where(eq(profileUrlStubs.stub, stub))
      .limit(1)

    if (existing && existing.profileId !== userId) {
      throw new ORPCError('CONFLICT', {
        message: 'This URL stub is already taken.',
      })
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
      .returning()

    return upserted
  })
