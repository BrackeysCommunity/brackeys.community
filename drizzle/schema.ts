import { pgSchema, unique, integer, text, jsonb, timestamp, foreignKey, bigserial, bigint, serial, boolean, index, primaryKey, numeric } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const user = pgSchema("user");
export const itch = pgSchema("itch");
export const hammer = pgSchema("hammer");
export const auth = pgSchema("auth");
export const collab = pgSchema("collab");
export const profileProjectSourceInUser = user.enum("profile_project_source", ['manual', 'itchio'])
export const profileProjectTypeInUser = user.enum("profile_project_type", ['jam', 'game', 'audio', 'tool', 'app'])

export const profileUrlStubsIdSeqInUser = user.sequence("profile_url_stubs_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const skillRequestsIdSeqInUser = user.sequence("skill_requests_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const skillsIdSeqInUser = user.sequence("skills_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const notificationsIdSeqInUser = user.sequence("notifications_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "9223372036854775807", cache: "1", cycle: false })
export const userSkillsIdSeqInUser = user.sequence("user_skills_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const linkedAccountsIdSeqInUser = user.sequence("linked_accounts_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })

export const jamsInItch = itch.table("jams", {
	jamId: integer("jam_id").primaryKey().notNull(),
	slug: text().notNull(),
	title: text().notNull(),
	bannerUrl: text("banner_url"),
	hashtag: text(),
	hosts: jsonb().default([]).notNull(),
	status: text().notNull(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'string' }),
	votingEndsAt: timestamp("voting_ends_at", { withTimezone: true, mode: 'string' }),
	entriesCount: integer("entries_count"),
	ratingsCount: integer("ratings_count"),
	contentHtml: text("content_html"),
	scrapedAt: timestamp("scraped_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	joinedCount: integer("joined_count"),
}, (table) => [
	unique("jams_slug_unique").on(table.slug),
]);

export const deletedMessagesInHammer = hammer.table("deleted_messages", {
	messageId: bigserial("message_id", { mode: "bigint" }).primaryKey().notNull(),
	attachments: text().notNull(),
	authorId: text("author_id").notNull(),
	channelId: text("channel_id").notNull(),
	content: text(),
	creationTimestamp: timestamp("creation_timestamp", { mode: 'string' }).notNull(),
	deletionTimestamp: timestamp("deletion_timestamp", { mode: 'string' }).notNull(),
	guildId: text("guild_id").notNull(),
	staffMemberId: text("staff_member_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "deleted_messages_author_id_developer_profiles_discord_id_fk"
		}),
	foreignKey({
			columns: [table.staffMemberId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "deleted_messages_staff_member_id_developer_profiles_discord_id_"
		}),
]);

export const sessionInAuth = auth.table("session", {
	id: text().primaryKey().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	token: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [userInAuth.id],
			name: "session_user_id_user_id_fk"
		}).onDelete("cascade"),
	unique("session_token_unique").on(table.token),
]);

export const jamEntriesInItch = itch.table("jam_entries", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entryId: bigint("entry_id", { mode: "number" }).primaryKey().notNull(),
	jamId: integer("jam_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	gameId: bigint("game_id", { mode: "number" }).notNull(),
	rateUrl: text("rate_url").notNull(),
	ratingCount: integer("rating_count").default(0).notNull(),
	coolness: integer().default(0).notNull(),
	submittedAt: timestamp("submitted_at", { withTimezone: true, mode: 'string' }),
	gameTitle: text("game_title").notNull(),
	gameShortText: text("game_short_text"),
	gameUrl: text("game_url").notNull(),
	gameCoverUrl: text("game_cover_url"),
	gameCoverColor: text("game_cover_color"),
	gamePlatforms: text("game_platforms").array(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	authorId: bigint("author_id", { mode: "number" }),
	authorName: text("author_name"),
	authorUrl: text("author_url"),
	contributors: jsonb().default([]).notNull(),
	resultsFetchedAt: timestamp("results_fetched_at", { withTimezone: true, mode: 'string' }),
	scrapedAt: timestamp("scraped_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.jamId],
			foreignColumns: [jamsInItch.jamId],
			name: "jam_entries_jam_id_jams_jam_id_fk"
		}).onDelete("cascade"),
]);

export const profileUrlStubsInUser = user.table("profile_url_stubs", {
	id: serial().primaryKey().notNull(),
	profileId: text("profile_id").notNull(),
	stub: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.profileId],
			foreignColumns: [developerProfilesInUser.id],
			name: "profile_url_stubs_profile_id_developer_profiles_id_fk"
		}).onDelete("cascade"),
	unique("profile_url_stubs_profile_id_unique").on(table.profileId),
	unique("profile_url_stubs_stub_unique").on(table.stub),
]);

export const skillRequestsInUser = user.table("skill_requests", {
	id: serial().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	name: text().notNull(),
	category: text(),
	status: text().default('pending').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [developerProfilesInUser.id],
			name: "skill_requests_user_id_developer_profiles_id_fk"
		}).onDelete("cascade"),
]);

export const skillsInUser = user.table("skills", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	category: text(),
}, (table) => [
	unique("skills_name_unique").on(table.name),
]);

export const profileProjectsInUser = user.table("profile_projects", {
	id: text().primaryKey().notNull(),
	profileId: text("profile_id").notNull(),
	title: text().notNull(),
	description: text(),
	url: text(),
	submissionUrl: text("submission_url"),
	tags: text().array(),
	pinned: boolean().default(false),
	sortOrder: integer("sort_order").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	imageUrl: text("image_url"),
	status: text().default('pending').notNull(),
	source: profileProjectSourceInUser().default('manual').notNull(),
	sourceId: text("source_id"),
	type: profileProjectTypeInUser().default('game').notNull(),
	subTypes: text("sub_types").array().default([""]).notNull(),
	jamName: text("jam_name"),
	jamUrl: text("jam_url"),
	submissionTitle: text("submission_title"),
	result: text(),
	teamMembers: text("team_members").array(),
	participatedAt: timestamp("participated_at", { mode: 'string' }),
	imageKey: text("image_key"),
	imageFilename: text("image_filename"),
	imageMimeType: text("image_mime_type"),
	imageSizeBytes: integer("image_size_bytes"),
}, (table) => [
	foreignKey({
			columns: [table.profileId],
			foreignColumns: [developerProfilesInUser.id],
			name: "profile_projects_profile_id_developer_profiles_id_fk"
		}).onDelete("cascade"),
]);

export const infractionsInHammer = hammer.table("infractions", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	guildId: text("guild_id").notNull(),
	issuedAt: timestamp("issued_at", { mode: 'string' }).notNull(),
	reason: text(),
	ruleId: text("rule_id"),
	ruleText: text("rule_text"),
	staffMemberId: text("staff_member_id").notNull(),
	type: integer().notNull(),
	userId: text("user_id").notNull(),
	additionalInformation: text("additional_information"),
}, (table) => [
	foreignKey({
			columns: [table.staffMemberId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "infractions_staff_member_id_developer_profiles_discord_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "infractions_user_id_developer_profiles_discord_id_fk"
		}),
]);

export const memberNotesInHammer = hammer.table("member_notes", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	authorId: text("author_id").notNull(),
	content: text().notNull(),
	creationTimestamp: timestamp("creation_timestamp", { mode: 'string' }).notNull(),
	guildId: text("guild_id").notNull(),
	type: integer().notNull(),
	userId: text("user_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "member_notes_author_id_developer_profiles_discord_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "member_notes_user_id_developer_profiles_discord_id_fk"
		}),
]);

export const notificationsInUser = user.table("notifications", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	userId: text("user_id").notNull(),
	type: text().notNull(),
	actorId: text("actor_id"),
	entityType: text("entity_type"),
	entityId: text("entity_id"),
	data: jsonb().default({}).notNull(),
	readAt: timestamp("read_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("notifications_user_created_idx").using("btree", table.userId.asc().nullsLast().op("timestamp_ops"), table.createdAt.desc().nullsLast().op("text_ops")),
	index("notifications_user_unread_idx").using("btree", table.userId.asc().nullsLast().op("timestamp_ops"), table.createdAt.desc().nullsLast().op("text_ops")).where(sql`(read_at IS NULL)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [userInAuth.id],
			name: "notifications_user_id_user_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [userInAuth.id],
			name: "notifications_actor_id_user_id_fk"
		}).onDelete("set null"),
]);

export const reportedMessagesInHammer = hammer.table("reported_messages", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	attachments: text().notNull(),
	authorId: text("author_id").notNull(),
	channelId: text("channel_id").notNull(),
	content: text(),
	guildId: text("guild_id").notNull(),
	messageId: text("message_id").notNull(),
	reporterId: text("reporter_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "reported_messages_author_id_developer_profiles_discord_id_fk"
		}),
	foreignKey({
			columns: [table.reporterId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "reported_messages_reporter_id_developer_profiles_discord_id_fk"
		}),
]);

export const accountInAuth = auth.table("account", {
	id: text().primaryKey().notNull(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id").notNull(),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", { mode: 'string' }),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { mode: 'string' }),
	scope: text(),
	password: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [userInAuth.id],
			name: "account_user_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const developerProfilesInUser = user.table("developer_profiles", {
	id: text().primaryKey().notNull(),
	discordId: text("discord_id"),
	discordUsername: text("discord_username"),
	avatarUrl: text("avatar_url"),
	guildNickname: text("guild_nickname"),
	guildJoinedAt: timestamp("guild_joined_at", { mode: 'string' }),
	guildRoles: text("guild_roles").array(),
	bio: text(),
	tagline: text(),
	githubUrl: text("github_url"),
	twitterUrl: text("twitter_url"),
	websiteUrl: text("website_url"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	availableForWork: boolean("available_for_work").default(false),
	availability: text(),
	rateType: text("rate_type"),
	rateMin: integer("rate_min"),
	rateMax: integer("rate_max"),
}, (table) => [
	unique("developer_profiles_discord_id_unique").on(table.discordId),
]);

export const userInAuth = auth.table("user", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	email: text().notNull(),
	emailVerified: boolean("email_verified").notNull(),
	image: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
}, (table) => [
	unique("user_email_unique").on(table.email),
]);

export const userSkillsInUser = user.table("user_skills", {
	id: serial().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	skillId: integer("skill_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.skillId],
			foreignColumns: [skillsInUser.id],
			name: "user_skills_skill_id_skills_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [developerProfilesInUser.id],
			name: "user_skills_user_id_developer_profiles_id_fk"
		}).onDelete("cascade"),
]);

export const verificationInAuth = auth.table("verification", {
	id: text().primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
});

export const staffMessagesInHammer = hammer.table("staff_messages", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	content: text().notNull(),
	guildId: text("guild_id").notNull(),
	recipientId: text("recipient_id").notNull(),
	sentAt: text("sent_at").notNull(),
	staffMemberId: text("staff_member_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.recipientId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "staff_messages_recipient_id_developer_profiles_discord_id_fk"
		}),
	foreignKey({
			columns: [table.staffMemberId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "staff_messages_staff_member_id_developer_profiles_discord_id_fk"
		}),
]);

export const trackedMessagesInHammer = hammer.table("tracked_messages", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	attachments: text().notNull(),
	authorId: text("author_id").notNull(),
	channelId: text("channel_id").notNull(),
	content: text(),
	creationTimestamp: timestamp("creation_timestamp", { mode: 'string' }).notNull(),
	deletionTimestamp: timestamp("deletion_timestamp", { mode: 'string' }),
	isDeleted: integer("is_deleted").notNull(),
	guildId: text("guild_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "tracked_messages_author_id_developer_profiles_discord_id_fk"
		}),
]);

export const collabPostImagesInCollab = collab.table("collab_post_images", {
	id: serial().primaryKey().notNull(),
	postId: integer("post_id").notNull(),
	strapiMediaId: text("strapi_media_id").notNull(),
	url: text().notNull(),
	alt: text(),
	sortOrder: integer("sort_order").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.postId],
			foreignColumns: [collabPostsInCollab.id],
			name: "collab_post_images_post_id_collab_posts_id_fk"
		}).onDelete("cascade"),
]);

export const collabPostReportsInCollab = collab.table("collab_post_reports", {
	id: serial().primaryKey().notNull(),
	postId: integer("post_id").notNull(),
	reporterId: text("reporter_id").notNull(),
	reason: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.postId],
			foreignColumns: [collabPostsInCollab.id],
			name: "collab_post_reports_post_id_collab_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.reporterId],
			foreignColumns: [userInAuth.id],
			name: "collab_post_reports_reporter_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const collabPostRolesInCollab = collab.table("collab_post_roles", {
	id: serial().primaryKey().notNull(),
	postId: integer("post_id").notNull(),
	roleId: integer("role_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.postId],
			foreignColumns: [collabPostsInCollab.id],
			name: "collab_post_roles_post_id_collab_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [collabRolesInCollab.id],
			name: "collab_post_roles_role_id_collab_roles_id_fk"
		}).onDelete("cascade"),
]);

export const collabRolesInCollab = collab.table("collab_roles", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	category: text(),
}, (table) => [
	unique("collab_roles_name_unique").on(table.name),
]);

export const collabResponsesInCollab = collab.table("collab_responses", {
	id: serial().primaryKey().notNull(),
	postId: integer("post_id").notNull(),
	responderId: text("responder_id").notNull(),
	message: text().notNull(),
	portfolioUrl: text("portfolio_url"),
	status: text().default('pending').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.postId],
			foreignColumns: [collabPostsInCollab.id],
			name: "collab_responses_post_id_collab_posts_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.responderId],
			foreignColumns: [userInAuth.id],
			name: "collab_responses_responder_id_user_id_fk"
		}).onDelete("cascade"),
	unique("collab_responses_post_id_responder_id_unique").on(table.postId, table.responderId),
]);

export const collabPostsInCollab = collab.table("collab_posts", {
	id: serial().primaryKey().notNull(),
	authorId: text("author_id").notNull(),
	type: text().notNull(),
	subtype: text(),
	title: text().notNull(),
	description: text().notNull(),
	projectName: text("project_name"),
	compensation: text(),
	teamSize: text("team_size"),
	projectLength: text("project_length"),
	platforms: text().array(),
	experience: text(),
	portfolioUrl: text("portfolio_url"),
	contactMethod: text("contact_method"),
	status: text().default('recruiting').notNull(),
	featuredAt: timestamp("featured_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	compensationType: text("compensation_type"),
	experienceLevel: text("experience_level"),
	contactType: text("contact_type"),
	isIndividual: boolean("is_individual").default(false),
}, (table) => [
	foreignKey({
			columns: [table.authorId],
			foreignColumns: [userInAuth.id],
			name: "collab_posts_author_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const linkedAccountsInUser = user.table("linked_accounts", {
	id: serial().primaryKey().notNull(),
	profileId: text("profile_id").notNull(),
	provider: text().notNull(),
	providerUserId: text("provider_user_id").notNull(),
	providerUsername: text("provider_username"),
	providerAvatarUrl: text("provider_avatar_url"),
	providerProfileUrl: text("provider_profile_url"),
	accessToken: text("access_token"),
	scopes: text(),
	linkedAt: timestamp("linked_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.profileId],
			foreignColumns: [developerProfilesInUser.id],
			name: "linked_accounts_profile_id_developer_profiles_id_fk"
		}).onDelete("cascade"),
	unique("linked_accounts_profile_id_provider_unique").on(table.profileId, table.provider),
]);

export const userNotificationSettingsInUser = user.table("user_notification_settings", {
	userId: text("user_id").primaryKey().notNull(),
	lastDigestAt: timestamp("last_digest_at", { mode: 'string' }),
	unsubscribeToken: text("unsubscribe_token"),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [userInAuth.id],
			name: "user_notification_settings_user_id_user_id_fk"
		}).onDelete("cascade"),
	unique("user_notification_settings_unsubscribe_token_unique").on(table.unsubscribeToken),
]);

export const mutesInHammer = hammer.table("mutes", {
	guildId: text("guild_id").notNull(),
	userId: text("user_id").notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "mutes_user_id_developer_profiles_discord_id_fk"
		}),
	primaryKey({ columns: [table.guildId, table.userId], name: "mutes_user_id_guild_id_pk"}),
]);

export const temporaryBansInHammer = hammer.table("temporary_bans", {
	guildId: text("guild_id").notNull(),
	userId: text("user_id").notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "temporary_bans_user_id_developer_profiles_discord_id_fk"
		}),
	primaryKey({ columns: [table.guildId, table.userId], name: "temporary_bans_user_id_guild_id_pk"}),
]);

export const blockedReportersInHammer = hammer.table("blocked_reporters", {
	guildId: text("guild_id").notNull(),
	userId: text("user_id").notNull(),
	blockedAt: timestamp("blocked_at", { mode: 'string' }).notNull(),
	staffMemberId: text("staff_member_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "blocked_reporters_user_id_developer_profiles_discord_id_fk"
		}),
	foreignKey({
			columns: [table.staffMemberId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "blocked_reporters_staff_member_id_developer_profiles_discord_id"
		}),
	primaryKey({ columns: [table.guildId, table.userId], name: "blocked_reporters_user_id_guild_id_pk"}),
]);

export const altAccountsInHammer = hammer.table("alt_accounts", {
	userId: text("user_id").notNull(),
	altId: text("alt_id").notNull(),
	staffMemberId: text("staff_member_id").notNull(),
	registeredAt: timestamp("registered_at", { mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.altId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "alt_accounts_alt_id_developer_profiles_discord_id_fk"
		}),
	foreignKey({
			columns: [table.staffMemberId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "alt_accounts_staff_member_id_developer_profiles_discord_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [developerProfilesInUser.discordId],
			name: "alt_accounts_user_id_developer_profiles_discord_id_fk"
		}),
	primaryKey({ columns: [table.userId, table.altId], name: "alt_accounts_user_id_alt_id_pk"}),
]);

export const rulesInHammer = hammer.table("rules", {
	guildId: text("guild_id").notNull(),
	id: text().notNull(),
	brief: text(),
	description: text().notNull(),
}, (table) => [
	primaryKey({ columns: [table.guildId, table.id], name: "rules_id_guild_id_pk"}),
]);

export const jamEntryResultsInItch = itch.table("jam_entry_results", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	entryId: bigint("entry_id", { mode: "number" }).notNull(),
	criterion: text().notNull(),
	rank: integer().notNull(),
	score: numeric({ precision: 6, scale:  3 }).notNull(),
	rawScore: numeric("raw_score", { precision: 6, scale:  3 }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.entryId],
			foreignColumns: [jamEntriesInItch.entryId],
			name: "jam_entry_results_entry_id_jam_entries_entry_id_fk"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.entryId, table.criterion], name: "jam_entry_results_entry_id_criterion_pk"}),
]);

export const notificationPreferencesInUser = user.table("notification_preferences", {
	userId: text("user_id").notNull(),
	type: text().notNull(),
	inApp: boolean("in_app").default(true).notNull(),
	email: boolean().default(false).notNull(),
	digest: boolean().default(false).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [userInAuth.id],
			name: "notification_preferences_user_id_user_id_fk"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.userId, table.type], name: "notification_preferences_user_id_type_pk"}),
]);
