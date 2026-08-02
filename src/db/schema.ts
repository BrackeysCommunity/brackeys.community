import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ── Schemas ─────────────────────────────────────────────────────────────────

export const authSchema = pgSchema("auth");
export const userSchema = pgSchema("user");
export const hammerSchema = pgSchema("hammer");
export const collabSchema = pgSchema("collab");
export const itchSchema = pgSchema("itch");
export const profileProjectTypeEnum = userSchema.enum("profile_project_type", [
  "jam",
  "game",
  "audio",
  "tool",
  "app",
]);
export const profileProjectSourceEnum = userSchema.enum("profile_project_source", [
  "manual",
  "itchio",
  "itchio-jam",
]);

// ── Better Auth core tables (auth schema) ───────────────────────────────────

export const user = authSchema.table("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const session = authSchema.table("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = authSchema.table("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = authSchema.table("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

// ── User profile tables (user schema) ───────────────────────────────────────

export const developerProfiles = userSchema.table("developer_profiles", {
  id: text("id").primaryKey(),
  discordId: text("discord_id").unique(),
  discordUsername: text("discord_username"),
  avatarUrl: text("avatar_url"),
  guildNickname: text("guild_nickname"),
  guildJoinedAt: timestamp("guild_joined_at"),
  guildRoles: text("guild_roles").array(),
  bio: text("bio"),
  tagline: text("tagline"),
  githubUrl: text("github_url"),
  twitterUrl: text("twitter_url"),
  websiteUrl: text("website_url"),
  availableForWork: boolean("available_for_work").default(false),
  availability: text("availability"),
  rateType: text("rate_type"),
  rateMin: integer("rate_min"),
  rateMax: integer("rate_max"),
  // The people lane is the individual-availability surface (there is no
  // "I'm available" post type — a profile flag maintains itself, a post
  // goes stale the moment its author finds work). These two carry what
  // such a post would have said.
  lookingFor: text("looking_for"),
  collabPreference: text("collab_preference"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const skills = userSchema.table("skills", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: text("category"),
});

export const userSkills = userSchema.table("user_skills", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => developerProfiles.id, { onDelete: "cascade" }),
  skillId: integer("skill_id")
    .notNull()
    .references(() => skills.id, { onDelete: "cascade" }),
});

export const skillRequests = userSchema.table("skill_requests", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => developerProfiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const profileUrlStubs = userSchema.table("profile_url_stubs", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id")
    .notNull()
    .unique()
    .references(() => developerProfiles.id, { onDelete: "cascade" }),
  stub: text("stub").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const profileProjects = userSchema.table(
  "profile_projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    profileId: text("profile_id")
      .notNull()
      .references(() => developerProfiles.id, { onDelete: "cascade" }),
    type: profileProjectTypeEnum("type").notNull().default("game"),
    subTypes: text("sub_types").array().notNull().default([]),
    title: text("title").notNull(),
    description: text("description"),
    url: text("url"),
    imageUrl: text("image_url"),
    imageKey: text("image_key"),
    imageFilename: text("image_filename"),
    imageMimeType: text("image_mime_type"),
    imageSizeBytes: integer("image_size_bytes"),
    tags: text("tags").array(),
    pinned: boolean("pinned").default(false),
    sortOrder: integer("sort_order").default(0),
    status: text("status").notNull().default("pending"),
    // Mirrors the provider's visibility (e.g. itch.io `published`). Unpublished
    // titles are only shown to the profile owner.
    published: boolean("published").notNull().default(true),
    source: profileProjectSourceEnum("source").notNull().default("manual"),
    sourceId: text("source_id"),
    // Imported jam rows reference the scraped jam and derive name/URL from
    // the join; manual rows keep the free-text jamName/jamUrl below so
    // off-itch jams remain possible. Read paths coalesce text over join.
    jamId: integer("jam_id").references(() => itchJams.jamId, { onDelete: "set null" }),
    jamName: text("jam_name"),
    jamUrl: text("jam_url"),
    submissionTitle: text("submission_title"),
    submissionUrl: text("submission_url"),
    result: text("result"),
    teamMembers: text("team_members").array(),
    participatedAt: timestamp("participated_at"),
    // Provider-side publish date (e.g. itch.io `published_at`) — the
    // honest "shipped" date for imported titles, vs. `createdAt` which
    // is just when the row landed in our database.
    publishedAt: timestamp("published_at"),
    // Set when the provider page 404s for anonymous visitors even though
    // the API reports it published (itch.io "Restricted" visibility — the
    // API exposes no field for it). Owned exclusively by the
    // itchio-library-sync sweep's URL probe; `published` stays mirrored
    // from the API, so restricted state must not be encoded there or the
    // next sync would flip it back. NULL = publicly reachable.
    restrictedAt: timestamp("restricted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Imported rows are unique per (profile, source, external id) so
    // concurrent syncs can insert with onConflictDoNothing.
    uniqueIndex("profile_projects_source_unique")
      .on(table.profileId, table.source, table.sourceId)
      .where(sql`${table.sourceId} IS NOT NULL`),
  ],
);

export const linkedAccounts = userSchema.table(
  "linked_accounts",
  {
    id: serial("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => developerProfiles.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    providerUsername: text("provider_username"),
    providerAvatarUrl: text("provider_avatar_url"),
    providerProfileUrl: text("provider_profile_url"),
    accessToken: text("access_token"),
    scopes: text("scopes"),
    linkedAt: timestamp("linked_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [unique().on(table.profileId, table.provider)],
);

// ── Notifications (user schema) ─────────────────────────────────────────────

export type NotificationType =
  | "collab_response_received"
  | "collab_response_accepted"
  | "collab_response_declined"
  | "collab_post_featured"
  | "collab_post_closed_by_staff";

export type NotificationEntityType = "collab_post" | "collab_response";

export const notifications = userSchema.table(
  "notifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").$type<NotificationType>().notNull(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    entityType: text("entity_type").$type<NotificationEntityType>(),
    entityId: text("entity_id"),
    data: jsonb("data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("notifications_user_unread_idx")
      .on(t.userId, t.createdAt.desc())
      .where(sql`${t.readAt} IS NULL`),
    index("notifications_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);

export const notificationPreferences = userSchema.table(
  "notification_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").$type<NotificationType>().notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(false),
    digest: boolean("digest").notNull().default(false),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type] })],
);

export const userNotificationSettings = userSchema.table("user_notification_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  lastDigestAt: timestamp("last_digest_at"),
  // Stable random token used for one-click unsubscribe links in emails.
  // Issued lazily on first email send; remains valid until the user
  // explicitly regenerates it. Indexed unique so the unsub route can
  // resolve it without a userId.
  unsubscribeToken: text("unsubscribe_token").unique(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Moderation tables (hammer schema) ───────────────────────────────────────

export const altAccounts = hammerSchema.table(
  "alt_accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => developerProfiles.discordId),
    altId: text("alt_id")
      .notNull()
      .references(() => developerProfiles.discordId),
    staffMemberId: text("staff_member_id")
      .notNull()
      .references(() => developerProfiles.discordId),
    registeredAt: timestamp("registered_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.altId] })],
);

export const blockedReporters = hammerSchema.table(
  "blocked_reporters",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => developerProfiles.discordId),
    blockedAt: timestamp("blocked_at").notNull(),
    staffMemberId: text("staff_member_id")
      .notNull()
      .references(() => developerProfiles.discordId),
  },
  (table) => [primaryKey({ columns: [table.userId, table.guildId] })],
);

export const deletedMessages = hammerSchema.table("deleted_messages", {
  messageId: bigserial("message_id", { mode: "bigint" }).primaryKey(),
  attachments: text("attachments").notNull(),
  authorId: text("author_id")
    .notNull()
    .references(() => developerProfiles.discordId),
  channelId: text("channel_id").notNull(),
  content: text("content"),
  creationTimestamp: timestamp("creation_timestamp").notNull(),
  deletionTimestamp: timestamp("deletion_timestamp").notNull(),
  guildId: text("guild_id").notNull(),
  staffMemberId: text("staff_member_id")
    .notNull()
    .references(() => developerProfiles.discordId),
});

export const infractions = hammerSchema.table("infractions", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  guildId: text("guild_id").notNull(),
  issuedAt: timestamp("issued_at").notNull(),
  reason: text("reason"),
  ruleId: text("rule_id"),
  ruleText: text("rule_text"),
  staffMemberId: text("staff_member_id")
    .notNull()
    .references(() => developerProfiles.discordId),
  type: integer("type").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => developerProfiles.discordId),
  additionalInformation: text("additional_information"),
});

export const memberNotes = hammerSchema.table("member_notes", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  authorId: text("author_id")
    .notNull()
    .references(() => developerProfiles.discordId),
  content: text("content").notNull(),
  creationTimestamp: timestamp("creation_timestamp").notNull(),
  guildId: text("guild_id").notNull(),
  type: integer("type").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => developerProfiles.discordId),
});

export const mutes = hammerSchema.table(
  "mutes",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => developerProfiles.discordId),
    expiresAt: timestamp("expires_at"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.guildId] })],
);

export const reportedMessages = hammerSchema.table("reported_messages", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  attachments: text("attachments").notNull(),
  authorId: text("author_id")
    .notNull()
    .references(() => developerProfiles.discordId),
  channelId: text("channel_id").notNull(),
  content: text("content"),
  guildId: text("guild_id").notNull(),
  messageId: text("message_id").notNull(),
  reporterId: text("reporter_id")
    .notNull()
    .references(() => developerProfiles.discordId),
});

export const rules = hammerSchema.table(
  "rules",
  {
    guildId: text("guild_id").notNull(),
    id: text("id").notNull(),
    brief: text("brief"),
    description: text("description").notNull(),
  },
  (table) => [primaryKey({ columns: [table.id, table.guildId] })],
);

export const staffMessages = hammerSchema.table("staff_messages", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  content: text("content").notNull(),
  guildId: text("guild_id").notNull(),
  recipientId: text("recipient_id")
    .notNull()
    .references(() => developerProfiles.discordId),
  sentAt: text("sent_at").notNull(),
  staffMemberId: text("staff_member_id")
    .notNull()
    .references(() => developerProfiles.discordId),
});

export const temporaryBans = hammerSchema.table(
  "temporary_bans",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => developerProfiles.discordId),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.guildId] })],
);

export const trackedMessages = hammerSchema.table("tracked_messages", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  attachments: text("attachments").notNull(),
  authorId: text("author_id")
    .notNull()
    .references(() => developerProfiles.discordId),
  channelId: text("channel_id").notNull(),
  content: text("content"),
  creationTimestamp: timestamp("creation_timestamp").notNull(),
  deletionTimestamp: timestamp("deletion_timestamp"),
  isDeleted: integer("is_deleted").notNull(),
  guildId: text("guild_id").notNull(),
});

// ── Collaboration tables (collab schema) ─────────────────────────────────────

export const collabPosts = collabSchema.table("collab_posts", {
  id: serial("id").primaryKey(),
  authorId: text("author_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // Kept as text (not a pg enum) so the deferred playtest/mentor types
  // return as pure additions. v1 writes only 'paid' | 'hobby'.
  type: text("type").notNull(),
  // Optional link to the jam this post is recruiting for. Same hybrid-FK
  // spirit as `profile_projects.jam_id` — cross-schema into itch.jams.
  jamId: integer("jam_id").references(() => itchJams.jamId, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  projectName: text("project_name"),
  // `compensation` is the legacy display string. New posts write the
  // numbers below and render through `formatRate`; the column stays only
  // so pre-v1 rows keep rendering.
  compensation: text("compensation"),
  compensationType: text("compensation_type"),
  compensationMin: integer("compensation_min"),
  compensationMax: integer("compensation_max"),
  teamSize: text("team_size"),
  projectLength: text("project_length"),
  platforms: text("platforms").array(),
  experience: text("experience"),
  experienceLevel: text("experience_level"),
  portfolioUrl: text("portfolio_url"),
  contactMethod: text("contact_method"),
  contactType: text("contact_type"),
  isIndividual: boolean("is_individual").default(false),
  status: text("status").notNull().default("recruiting"),
  featuredAt: timestamp("featured_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const collabRoles = collabSchema.table("collab_roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: text("category"),
});

export const collabPostRoles = collabSchema.table(
  "collab_post_roles",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id")
      .notNull()
      .references(() => collabPosts.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => collabRoles.id, { onDelete: "cascade" }),
  },
  (table) => [unique().on(table.postId, table.roleId)],
);

/**
 * A post's tech stack, drawn from the same curated `user.skills`
 * vocabulary the profiles use — one vocabulary, two link tables, so a
 * responder's skills and a post's stack are comparable ids rather than
 * strings that have to match by spelling.
 *
 * Distinct from `collab_post_roles`: a role is the seat being filled
 * ("Pixel Artist"), a skill is what the project runs on ("Godot").
 */
export const collabPostSkills = collabSchema.table(
  "collab_post_skills",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id")
      .notNull()
      .references(() => collabPosts.id, { onDelete: "cascade" }),
    skillId: integer("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
  },
  (table) => [unique().on(table.postId, table.skillId)],
);

export const collabResponses = collabSchema.table(
  "collab_responses",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id")
      .notNull()
      .references(() => collabPosts.id, { onDelete: "cascade" }),
    responderId: text("responder_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    portfolioUrl: text("portfolio_url"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [unique().on(table.postId, table.responderId)],
);

export const collabPostImages = collabSchema.table("collab_post_images", {
  id: serial("id").primaryKey(),
  postId: integer("post_id")
    .notNull()
    .references(() => collabPosts.id, { onDelete: "cascade" }),
  strapiMediaId: text("strapi_media_id").notNull(),
  url: text("url").notNull(),
  alt: text("alt"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const collabPostReports = collabSchema.table("collab_post_reports", {
  id: serial("id").primaryKey(),
  postId: integer("post_id")
    .notNull()
    .references(() => collabPosts.id, { onDelete: "cascade" }),
  reporterId: text("reporter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── itch.io scraped data (itch schema) ───────────────────────────────────────

export type ItchJamHost = { name: string; url: string };
export type ItchJamContributor = { name: string; url: string };
export type ItchJamStatus = "upcoming" | "running" | "voting" | "over";

export const itchJams = itchSchema.table("jams", {
  jamId: integer("jam_id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  bannerUrl: text("banner_url"),
  // Host-chosen page background color scraped from the jam page's theme CSS
  // (`body{background-color: …}`). Validated to a strict hex/rgb() form at
  // scrape time; null when the host kept itch's default theme.
  themeColor: text("theme_color"),
  hashtag: text("hashtag"),
  hosts: jsonb("hosts")
    .$type<ItchJamHost[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  status: text("status").$type<ItchJamStatus>().notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  votingEndsAt: timestamp("voting_ends_at", { withTimezone: true }),
  joinedCount: integer("joined_count"),
  entriesCount: integer("entries_count"),
  ratingsCount: integer("ratings_count"),
  contentHtml: text("content_html"),
  // Set when the jam page 404s (deleted on itch, or its slug was reused by a
  // new jam). Rows are never deleted — the scraper retries for a grace window,
  // then leaves the row for manual verification. Cleared on successful scrape.
  missingSince: timestamp("missing_since", { withTimezone: true }),
  scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const itchJamEntries = itchSchema.table("jam_entries", {
  // jam_game.id — itch's submission id, distinct from the underlying game id.
  entryId: bigint("entry_id", { mode: "number" }).primaryKey(),
  jamId: integer("jam_id")
    .notNull()
    .references(() => itchJams.jamId, { onDelete: "cascade" }),
  gameId: bigint("game_id", { mode: "number" }).notNull(),
  rateUrl: text("rate_url").notNull(),
  ratingCount: integer("rating_count").notNull().default(0),
  coolness: integer("coolness").notNull().default(0),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  gameTitle: text("game_title").notNull(),
  gameShortText: text("game_short_text"),
  gameUrl: text("game_url").notNull(),
  gameCoverUrl: text("game_cover_url"),
  gameCoverColor: text("game_cover_color"),
  gamePlatforms: text("game_platforms").array(),
  authorId: bigint("author_id", { mode: "number" }),
  authorName: text("author_name"),
  authorUrl: text("author_url"),
  contributors: jsonb("contributors")
    .$type<ItchJamContributor[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  resultsFetchedAt: timestamp("results_fetched_at", { withTimezone: true }),
  // Set when itch no longer lists the entry (pulled from the jam, or its rate
  // page 404s). Rows are never deleted; cleared if the entry is listed again.
  missingSince: timestamp("missing_since", { withTimezone: true }),
  scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Slugs from the /jams/past listing whose jam page 404s and that were never
// persisted (jam deleted on itch before we ever scraped it). Recorded so the
// historical backfill doesn't re-fetch known-dead pages on every run.
export const itchMissingJams = itchSchema.table("missing_jams", {
  slug: text("slug").primaryKey(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
});

// Per-criterion rank scraped from /jam/{slug}/rate/{gameId} after voting ends.
// The submission stats (rank/score/raw score per criterion) are rendered only
// in the rate page HTML — they aren't exposed in the entries.json API.
export const itchJamEntryResults = itchSchema.table(
  "jam_entry_results",
  {
    entryId: bigint("entry_id", { mode: "number" })
      .notNull()
      .references(() => itchJamEntries.entryId, { onDelete: "cascade" }),
    criterion: text("criterion").notNull(),
    rank: integer("rank").notNull(),
    score: numeric("score", { precision: 6, scale: 3 }).notNull(),
    rawScore: numeric("raw_score", { precision: 6, scale: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.entryId, table.criterion] })],
);
