import { bigint, bigserial, boolean, integer, pgSchema, pgTable, serial, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { primaryKey } from 'drizzle-orm/pg-core'

// ── Schemas ─────────────────────────────────────────────────────────────────

export const authSchema = pgSchema('auth')
export const userSchema = pgSchema('user')
export const hammerSchema = pgSchema('hammer')
export const collabSchema = pgSchema('collab')

// ── Better Auth core tables (auth schema) ───────────────────────────────────

export const user = authSchema.table('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
})

export const session = authSchema.table('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
})

export const account = authSchema.table('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
})

export const verification = authSchema.table('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
})

// ── App tables (public schema) ──────────────────────────────────────────────

export const todos = pgTable('todos', {
  id: serial().primaryKey(),
  title: text().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})

// ── User profile tables (user schema) ───────────────────────────────────────

export const developerProfiles = userSchema.table('developer_profiles', {
  id: text('id').primaryKey(),
  discordId: text('discord_id').unique(),
  discordUsername: text('discord_username'),
  avatarUrl: text('avatar_url'),
  guildNickname: text('guild_nickname'),
  guildJoinedAt: timestamp('guild_joined_at'),
  guildRoles: text('guild_roles').array(),
  bio: text('bio'),
  tagline: text('tagline'),
  githubUrl: text('github_url'),
  twitterUrl: text('twitter_url'),
  websiteUrl: text('website_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const skills = userSchema.table('skills', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  category: text('category'),
})

export const userSkills = userSchema.table('user_skills', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => developerProfiles.id, { onDelete: 'cascade' }),
  skillId: integer('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
})

export const skillRequests = userSchema.table('skill_requests', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => developerProfiles.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category'),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const profileUrlStubs = userSchema.table('profile_url_stubs', {
  id: serial('id').primaryKey(),
  profileId: text('profile_id').notNull().unique().references(() => developerProfiles.id, { onDelete: 'cascade' }),
  stub: text('stub').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const profileProjects = userSchema.table('profile_projects', {
  id: serial('id').primaryKey(),
  profileId: text('profile_id').notNull().references(() => developerProfiles.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  url: text('url'),
  screenshotUrl: text('screenshot_url'),
  imageUrl: text('image_url'),
  tags: text('tags').array(),
  pinned: boolean('pinned').default(false),
  sortOrder: integer('sort_order').default(0),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const jamParticipations = userSchema.table('jam_participations', {
  id: serial('id').primaryKey(),
  profileId: text('profile_id').notNull().references(() => developerProfiles.id, { onDelete: 'cascade' }),
  jamName: text('jam_name').notNull(),
  jamUrl: text('jam_url'),
  submissionTitle: text('submission_title'),
  submissionUrl: text('submission_url'),
  result: text('result'),
  teamMembers: text('team_members').array(),
  participatedAt: timestamp('participated_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ── Moderation tables (hammer schema) ───────────────────────────────────────

export const altAccounts = hammerSchema.table('alt_accounts', {
  userId: bigint('user_id', { mode: 'bigint' }).notNull(),
  altId: bigint('alt_id', { mode: 'bigint' }).notNull(),
  staffMemberId: bigint('staff_member_id', { mode: 'bigint' }).notNull(),
  registeredAt: timestamp('registered_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.altId] }),
])

export const blockedReporters = hammerSchema.table('blocked_reporters', {
  guildId: bigint('guild_id', { mode: 'bigint' }).notNull(),
  userId: bigint('user_id', { mode: 'bigint' }).notNull(),
  blockedAt: timestamp('blocked_at').notNull(),
  staffMemberId: bigint('staff_member_id', { mode: 'bigint' }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.guildId] }),
])

export const deletedMessages = hammerSchema.table('deleted_messages', {
  messageId: bigserial('message_id', { mode: 'bigint' }).primaryKey(),
  attachments: text('attachments').notNull(),
  authorId: bigint('author_id', { mode: 'bigint' }).notNull(),
  channelId: bigint('channel_id', { mode: 'bigint' }).notNull(),
  content: text('content'),
  creationTimestamp: timestamp('creation_timestamp').notNull(),
  deletionTimestamp: timestamp('deletion_timestamp').notNull(),
  guildId: bigint('guild_id', { mode: 'bigint' }).notNull(),
  staffMemberId: bigint('staff_member_id', { mode: 'bigint' }).notNull(),
})

export const infractions = hammerSchema.table('infractions', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  guildId: bigint('guild_id', { mode: 'bigint' }).notNull(),
  issuedAt: timestamp('issued_at').notNull(),
  reason: text('reason'),
  ruleId: integer('rule_id'),
  ruleText: text('rule_text'),
  staffMemberId: bigint('staff_member_id', { mode: 'bigint' }).notNull(),
  type: integer('type').notNull(),
  userId: bigint('user_id', { mode: 'bigint' }).notNull(),
  additionalInformation: text('additional_information'),
})

export const memberNotes = hammerSchema.table('member_notes', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  authorId: bigint('author_id', { mode: 'bigint' }).notNull(),
  content: text('content').notNull(),
  creationTimestamp: timestamp('creation_timestamp').notNull(),
  guildId: bigint('guild_id', { mode: 'bigint' }).notNull(),
  type: integer('type').notNull(),
  userId: bigint('user_id', { mode: 'bigint' }).notNull(),
})

export const mutes = hammerSchema.table('mutes', {
  guildId: bigint('guild_id', { mode: 'bigint' }).notNull(),
  userId: bigint('user_id', { mode: 'bigint' }).notNull(),
  expiresAt: timestamp('expires_at'),
}, (table) => [
  primaryKey({ columns: [table.userId, table.guildId] }),
])

export const reportedMessages = hammerSchema.table('reported_messages', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  attachments: text('attachments').notNull(),
  authorId: bigint('author_id', { mode: 'bigint' }).notNull(),
  channelId: bigint('channel_id', { mode: 'bigint' }).notNull(),
  content: text('content'),
  guildId: bigint('guild_id', { mode: 'bigint' }).notNull(),
  messageId: bigint('message_id', { mode: 'bigint' }).notNull(),
  reporterId: bigint('reporter_id', { mode: 'bigint' }).notNull(),
})

export const rules = hammerSchema.table('rules', {
  guildId: bigint('guild_id', { mode: 'bigint' }).notNull(),
  id: bigint('id', { mode: 'bigint' }).notNull(),
  brief: text('brief'),
  description: text('description').notNull(),
}, (table) => [
  primaryKey({ columns: [table.id, table.guildId] }),
])

export const staffMessages = hammerSchema.table('staff_messages', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  content: text('content').notNull(),
  guildId: bigint('guild_id', { mode: 'bigint' }).notNull(),
  recipientId: bigint('recipient_id', { mode: 'bigint' }).notNull(),
  sentAt: text('sent_at').notNull(),
  staffMemberId: bigint('staff_member_id', { mode: 'bigint' }).notNull(),
})

export const temporaryBans = hammerSchema.table('temporary_bans', {
  guildId: bigint('guild_id', { mode: 'bigint' }).notNull(),
  userId: bigint('user_id', { mode: 'bigint' }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.guildId] }),
])

export const trackedMessages = hammerSchema.table('tracked_messages', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  attachments: text('attachments').notNull(),
  authorId: bigint('author_id', { mode: 'bigint' }).notNull(),
  channelId: bigint('channel_id', { mode: 'bigint' }).notNull(),
  content: text('content'),
  creationTimestamp: timestamp('creation_timestamp').notNull(),
  deletionTimestamp: timestamp('deletion_timestamp'),
  isDeleted: integer('is_deleted').notNull(),
  guildId: bigint('guild_id', { mode: 'bigint' }).notNull(),
})

// ── Collaboration tables (collab schema) ─────────────────────────────────────

export const collabPosts = collabSchema.table('collab_posts', {
  id: serial('id').primaryKey(),
  authorId: text('author_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  subtype: text('subtype'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  projectName: text('project_name'),
  compensation: text('compensation'),
  teamSize: text('team_size'),
  projectLength: text('project_length'),
  platforms: text('platforms').array(),
  experience: text('experience'),
  portfolioUrl: text('portfolio_url'),
  contactMethod: text('contact_method'),
  status: text('status').notNull().default('recruiting'),
  featuredAt: timestamp('featured_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const collabRoles = collabSchema.table('collab_roles', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  category: text('category'),
})

export const collabPostRoles = collabSchema.table('collab_post_roles', {
  id: serial('id').primaryKey(),
  postId: integer('post_id').notNull().references(() => collabPosts.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').notNull().references(() => collabRoles.id, { onDelete: 'cascade' }),
})

export const collabResponses = collabSchema.table('collab_responses', {
  id: serial('id').primaryKey(),
  postId: integer('post_id').notNull().references(() => collabPosts.id, { onDelete: 'cascade' }),
  responderId: text('responder_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  message: text('message').notNull(),
  portfolioUrl: text('portfolio_url'),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  unique().on(table.postId, table.responderId),
])

export const collabPostImages = collabSchema.table('collab_post_images', {
  id: serial('id').primaryKey(),
  postId: integer('post_id').notNull().references(() => collabPosts.id, { onDelete: 'cascade' }),
  strapiMediaId: text('strapi_media_id').notNull(),
  url: text('url').notNull(),
  alt: text('alt'),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
})

export const collabPostReports = collabSchema.table('collab_post_reports', {
  id: serial('id').primaryKey(),
  postId: integer('post_id').notNull().references(() => collabPosts.id, { onDelete: 'cascade' }),
  reporterId: text('reporter_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})
