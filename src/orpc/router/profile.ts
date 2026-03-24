import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
	englishDataset,
	englishRecommendedTransformers,
	RegExpMatcher,
} from "obscenity";
import * as z from "zod";
import { db } from "@/db";
import {
	developerProfiles,
	linkedAccounts,
	profileProjects,
	profileUrlStubs,
	skillRequests,
	skills,
	userSkills,
} from "@/db/schema";
import {
	getProfileProjectImageUrl,
	removeProfileProjectImageFromStorage,
} from "@/lib/profile-project-image-storage";
import { isOwnedProfileProjectImageKey } from "@/lib/profile-project-images";
import {
	MANUAL_PROFILE_PROJECT_TYPES,
	PROFILE_PROJECT_SUBTYPES,
	sanitizeProfileProjectSubTypes,
} from "@/lib/profile-projects";
import { authMiddleware, requireAuth } from "@/orpc/middleware/auth";

function escapeLike(str: string): string {
	return str.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

const profanityMatcher = new RegExpMatcher({
	...englishDataset.build(),
	...englishRecommendedTransformers,
});

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

const optionalUrlSchema = z.string().url().optional().or(z.literal(""));
const manualProjectTypeSchema = z.enum(MANUAL_PROFILE_PROJECT_TYPES);
const projectSubTypeSchema = z.enum(PROFILE_PROJECT_SUBTYPES);
const uploadedProjectImageSchema = z
	.object({
		key: z.string().min(1),
		url: z.string().url(),
		filename: z.string().min(1),
		mimeType: z.string().min(1),
		sizeBytes: z.number().int().positive(),
	})
	.optional();

function normalizeManualProjectSubTypes(
	type: z.infer<typeof manualProjectTypeSchema>,
	subTypes?: string[],
) {
	const normalized = sanitizeProfileProjectSubTypes(type, subTypes);
	if ((subTypes?.length ?? 0) !== normalized.length) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Selected sub-types do not match the chosen project type.",
		});
	}

	return normalized;
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

function serializeProfileProject<
	T extends {
		imageKey: string | null;
		imageUrl: string | null;
	},
>(project: T) {
	return {
		...project,
		imageUrl: getProfileProjectImageUrl(project.imageKey) ?? project.imageUrl,
	};
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
		const isOwner = context.user?.id === profileId;

		const [
			skillList,
			projects,
			urlStub,
			pendingSkillRequests,
			linkedAccountsList,
		] = await Promise.all([
			queryUserSkills(profileId),
			isOwner
				? db
						.select()
						.from(profileProjects)
						.where(eq(profileProjects.profileId, profileId))
				: db
						.select()
						.from(profileProjects)
						.where(
							and(
								eq(profileProjects.profileId, profileId),
								eq(profileProjects.status, "approved"),
							),
						),
			db
				.select()
				.from(profileUrlStubs)
				.where(eq(profileUrlStubs.profileId, profileId))
				.limit(1),
			isOwner
				? db
						.select()
						.from(skillRequests)
						.where(
							and(
								eq(skillRequests.userId, profileId),
								eq(skillRequests.status, "pending"),
							),
						)
				: Promise.resolve([]),
			db
				.select({
					id: linkedAccounts.id,
					provider: linkedAccounts.provider,
					providerUserId: linkedAccounts.providerUserId,
					providerUsername: linkedAccounts.providerUsername,
					providerAvatarUrl: linkedAccounts.providerAvatarUrl,
					providerProfileUrl: linkedAccounts.providerProfileUrl,
					linkedAt: linkedAccounts.linkedAt,
				})
				.from(linkedAccounts)
				.where(eq(linkedAccounts.profileId, profileId)),
		]);

		return {
			profile,
			skills: skillList,
			projects: projects.map(serializeProfileProject),
			isOwner,
			urlStub: urlStub[0]?.stub ?? null,
			pendingSkillRequests,
			linkedAccounts: linkedAccountsList,
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

		const [
			skillList,
			projects,
			pendingSkillRequests,
			urlStub,
			linkedAccountsList,
		] = await Promise.all([
			queryUserSkills(userId),
			db
				.select()
				.from(profileProjects)
				.where(eq(profileProjects.profileId, userId)),
			db
				.select()
				.from(skillRequests)
				.where(
					and(
						eq(skillRequests.userId, userId),
						eq(skillRequests.status, "pending"),
					),
				),
			db
				.select()
				.from(profileUrlStubs)
				.where(eq(profileUrlStubs.profileId, userId))
				.limit(1),
			db
				.select({
					id: linkedAccounts.id,
					provider: linkedAccounts.provider,
					providerUserId: linkedAccounts.providerUserId,
					providerUsername: linkedAccounts.providerUsername,
					providerAvatarUrl: linkedAccounts.providerAvatarUrl,
					providerProfileUrl: linkedAccounts.providerProfileUrl,
					linkedAt: linkedAccounts.linkedAt,
				})
				.from(linkedAccounts)
				.where(eq(linkedAccounts.profileId, userId)),
		]);

		return {
			profile,
			skills: skillList,
			projects: projects.map(serializeProfileProject),
			pendingSkillRequests,
			urlStub: urlStub[0]?.stub ?? null,
			isOwner: true,
			linkedAccounts: linkedAccountsList,
		};
	});

const rateTypeSchema = z.enum(["hourly", "fixed", "negotiable"]);
const availabilitySchema = z.enum(["full_time", "part_time", "limited"]);

export const updateProfile = os
	.use(requireAuth)
	.input(
		z.object({
			bio: z.string().optional(),
			tagline: z.string().optional(),
			githubUrl: z.string().optional(),
			twitterUrl: z.string().optional(),
			websiteUrl: z.string().optional(),
			availableForWork: z.boolean().optional(),
			availability: availabilitySchema.optional().nullable(),
			rateType: rateTypeSchema.optional().nullable(),
			rateMin: z.number().int().min(0).optional().nullable(),
			rateMax: z.number().int().min(0).optional().nullable(),
		}),
	)
	.handler(async ({ input, context }) => {
		const userId = context.user.id;

		const [updated] = await db
			.update(developerProfiles)
			.set({ ...input, updatedAt: new Date() })
			.where(eq(developerProfiles.id, userId))
			.returning();

		return updated;
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

export const addUserSkill = os
	.use(requireAuth)
	.input(z.object({ skillId: z.number() }))
	.handler(async ({ input, context }) => {
		const [inserted] = await db
			.insert(userSkills)
			.values({ userId: context.user.id, skillId: input.skillId })
			.returning();

		return inserted;
	});

export const removeUserSkill = os
	.use(requireAuth)
	.input(z.object({ userSkillId: z.number() }))
	.handler(async ({ input, context }) => {
		const [deleted] = await db
			.delete(userSkills)
			.where(
				and(
					eq(userSkills.id, input.userSkillId),
					eq(userSkills.userId, context.user.id),
				),
			)
			.returning();

		if (!deleted) {
			throw new ORPCError("NOT_FOUND", {
				message: "Skill not found or not owned by you.",
			});
		}

		return { success: true };
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
		}),
	)
	.handler(async ({ input, context }) => {
		const { image, ...projectInput } = input;
		if (image) {
			assertOwnedUploadedProjectImage(context.user.id, image);
		}

		const type = input.type ?? "game";
		const subTypes = normalizeManualProjectSubTypes(type, input.subTypes);

		const [project] = await db
			.insert(profileProjects)
			.values({
				profileId: context.user.id,
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
				type,
				subTypes,
				source: "manual",
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
		}),
	)
	.handler(async ({ input, context }) => {
		const { projectId, image, ...data } = input;
		const [existingProject] = await db
			.select({
				id: profileProjects.id,
				type: profileProjects.type,
				imageKey: profileProjects.imageKey,
			})
			.from(profileProjects)
			.where(
				and(
					eq(profileProjects.id, projectId),
					eq(profileProjects.profileId, context.user.id),
				),
			)
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

		const nextType = data.type ?? existingProject.type;
		const nextSubTypes =
			data.type !== undefined || data.subTypes !== undefined
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
				...(data.type !== undefined ? { type: data.type } : {}),
				...(nextSubTypes !== undefined ? { subTypes: nextSubTypes } : {}),
			})
			.where(
				and(
					eq(profileProjects.id, projectId),
					eq(profileProjects.profileId, context.user.id),
				),
			)
			.returning();

		if (!updated) {
			throw new ORPCError("NOT_FOUND", {
				message: "Project not found or not owned by you.",
			});
		}

		if (
			image &&
			existingProject.imageKey &&
			existingProject.imageKey !== image.key
		) {
			removeProfileProjectImageFromStorage(existingProject.imageKey).catch(
				console.error,
			);
		}

		return serializeProfileProject(updated);
	});

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
		const [participation] = await db
			.insert(profileProjects)
			.values({
				profileId: context.user.id,
				type: "jam",
				title: buildJamProjectTitle(input.jamName, input.submissionTitle),
				status: "approved",
				source: "manual",
				jamName: input.jamName,
				jamUrl: input.jamUrl,
				submissionTitle: input.submissionTitle,
				submissionUrl: input.submissionUrl,
				result: input.result,
				teamMembers: input.teamMembers,
				participatedAt: input.participatedAt
					? new Date(input.participatedAt)
					: null,
			})
			.returning();

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

		if (profanityMatcher.hasMatch(stub)) {
			throw new ORPCError("BAD_REQUEST", {
				message: "URL stub contains inappropriate language.",
			});
		}

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
	.use(authMiddleware)
	.input(
		z.object({
			search: z.string().optional(),
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

		const where = and(...conditions);
		const sortColumn =
			input.sortBy === "createdAt"
				? developerProfiles.createdAt
				: developerProfiles.updatedAt;
		const sortFn = input.sortOrder === "asc" ? asc : desc;

		const users = await db
			.select()
			.from(developerProfiles)
			.where(where)
			.orderBy(sortFn(sortColumn))
			.limit(input.limit)
			.offset(input.offset);

		const [totalResult] = await db
			.select({ count: count() })
			.from(developerProfiles)
			.where(where);

		// Fetch skills for all returned users
		const userIds = users.map((u) => u.id);
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
				skills: skillsByUser.get(u.id) ?? [],
			})),
			total: totalResult?.count ?? 0,
		};
	});
