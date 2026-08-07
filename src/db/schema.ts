import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
export const teamSchema = pgSchema("team");
export const itchSchema = pgSchema("itch");
export const projectSchema = pgSchema("project");
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
    // The canonical project this row is a *placement* of. Nullable while
    // the backfill runs and for rows created by code paths that haven't
    // converged yet. `set null`, never cascade: un-showcasing a game must
    // not delete the project other people's pages point at, and deleting a
    // project (rare, orphan sweep only) must not delete the surface row.
    projectId: text("project_id").references((): AnyPgColumn => projects.id, {
      onDelete: "set null",
    }),
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
  | "collab_post_closed_by_staff"
  | "collab_post_expiring"
  | "collab_post_expired"
  | "team_invite_received"
  | "team_invite_accepted"
  | "team_invite_declined"
  | "team_member_removed"
  | "team_archive_warning"
  | "team_auto_archived";

export type NotificationEntityType = "collab_post" | "collab_response" | "team" | "team_invite";

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
  // The named team behind the post. NULL + isIndividual=false is the
  // legacy "an unnamed team" state every pre-teams row is in — a deleted
  // team degrades its posts back to that state rather than deleting them.
  teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
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
  // 'recruiting' | 'party_full' | 'expired' (text, pure additions).
  status: text("status").notNull().default("recruiting"),
  featuredAt: timestamp("featured_at"),
  // Lifecycle: when the sweep auto-closes a still-recruiting post.
  // Jam-linked posts default to the jam's end + 3 days, others +45d;
  // reopen/extend push it out. NULL only on pre-v2 closed rows.
  expiresAt: timestamp("expires_at"),
  // Stamp for the "closes in 3 days — still looking?" nudge, so the
  // sweep stays idempotent across re-runs.
  expiryNotifiedAt: timestamp("expiry_notified_at"),
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

// ── Teams (team schema) ──────────────────────────────────────────────────────

/**
 * A named team — the entity behind "I'm posting on behalf of an existing
 * team". Spans profile-like identity (page, showcase) and collab
 * recruiting (posts carry `team_id`), so it gets its own schema.
 *
 * A team's stack is *derived* from its members' `user_skills` at read
 * time — there is deliberately no team_skills table to drift from the
 * roster it describes.
 */
export const teams = teamSchema.table("teams", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // URL handle, baked in from birth (unlike profiles, which retrofitted
  // stubs via a side table). Generated from the name at creation,
  // owner-editable via setTeamSlug.
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline"),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  avatarKey: text("avatar_key"),
  bannerUrl: text("banner_url"),
  bannerKey: text("banner_key"),
  websiteUrl: text("website_url"),
  itchUrl: text("itch_url"),
  // Team-level parallel of developerProfiles.availableForWork — "we're
  // recruiting" persists between posts.
  recruiting: boolean("recruiting").notNull().default(false),
  // 'active' | 'archived'. Archived pages stay up read-only; the team
  // stops being pickable in the wizard. Text, not a pg enum, so future
  // states are pure additions.
  status: text("status").notNull().default("active"),
  // Bumped by touchTeamActivity on post/member/project/settings events;
  // the lifecycle sweep reads it to find quiet never-shipped teams.
  lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
  // Stamp for the auto-archive warning; activity since clears it.
  archiveWarnedAt: timestamp("archive_warned_at"),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const teamMembers = teamSchema.table(
  "team_members",
  {
    id: serial("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => developerProfiles.id, { onDelete: "cascade" }),
    // 'owner' | 'member'. Text so 'admin' can slot in later the same way
    // deferred post types return as pure additions.
    role: text("role").notNull().default("member"),
    // Craft label shown on the roster ("Composer", "Pixel art"). Free
    // text, NOT a collabRoles FK — roles are seats being hired; this is
    // self-description.
    title: text("title"),
    sortOrder: integer("sort_order").default(0),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (table) => [unique().on(table.teamId, table.userId)],
);

export const teamInvites = teamSchema.table(
  "team_invites",
  {
    id: serial("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    inviteeId: text("invitee_id")
      .notNull()
      .references(() => developerProfiles.id, { onDelete: "cascade" }),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Provenance when the invite came from accepting a collab response —
    // the accept → invite handoff.
    sourceResponseId: integer("source_response_id").references(() => collabResponses.id, {
      onDelete: "set null",
    }),
    // 'pending' | 'accepted' | 'declined' | 'revoked'
    status: text("status").notNull().default("pending"),
    message: text("message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    respondedAt: timestamp("responded_at"),
  },
  (table) => [
    // One live invite per person per team; settled invites stay as history.
    uniqueIndex("team_invites_pending_unique")
      .on(table.teamId, table.inviteeId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

/**
 * A team's showcase. Owned by the team, not linked to members'
 * `profile_projects` rows — roster churn must not strip the page, and
 * edit rights belong to the team, not whichever member's copy it was.
 * `source_profile_project_id` records provenance when a row was imported
 * from a member's profile.
 *
 * Rows with `jam_id` double as the team's jam log, same hybrid-FK
 * pattern as `profile_projects` (free-text jamName/jamUrl for off-itch
 * jams; read paths coalesce text over join).
 */
export const teamProjects = teamSchema.table("team_projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  // The canonical project this showcase row is a placement of — see the
  // matching column on `profile_projects` for why it's `set null`.
  projectId: text("project_id").references((): AnyPgColumn => projects.id, {
    onDelete: "set null",
  }),
  type: profileProjectTypeEnum("type").notNull().default("game"),
  title: text("title").notNull(),
  description: text("description"),
  url: text("url"),
  imageUrl: text("image_url"),
  imageKey: text("image_key"),
  imageFilename: text("image_filename"),
  imageMimeType: text("image_mime_type"),
  imageSizeBytes: integer("image_size_bytes"),
  pinned: boolean("pinned").default(false),
  sortOrder: integer("sort_order").default(0),
  source: profileProjectSourceEnum("source").notNull().default("manual"),
  sourceId: text("source_id"),
  sourceProfileProjectId: text("source_profile_project_id").references(() => profileProjects.id, {
    onDelete: "set null",
  }),
  jamId: integer("jam_id").references(() => itchJams.jamId, { onDelete: "set null" }),
  jamName: text("jam_name"),
  jamUrl: text("jam_url"),
  submissionUrl: text("submission_url"),
  result: text("result"),
  participatedAt: timestamp("participated_at"),
  // Honest ship date, owner-editable; ordering + "shipped in 2026".
  releasedAt: timestamp("released_at"),
  addedBy: text("added_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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

export const itchJamEntries = itchSchema.table(
  "jam_entries",
  {
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
  },
  (table) => [
    // A foreign key does not index its own column in Postgres, and this
    // table is the largest in the database (one row per submission across
    // every scraped jam). Every jam-scoped read — the detail page's entries
    // grid, `topEntriesQuery`, the results board — filters on jam_id first.
    index("jam_entries_jam_id_idx").on(table.jamId),
    // The game id is the identity a project row dedupes on, so the derived
    // "which jams did this game enter" join reads by it.
    index("jam_entries_game_id_idx").on(table.gameId),
    // Author id is how a scraped entry is matched to a linked itch account
    // (the "Brackeys member" badge on the entries grid).
    index("jam_entries_author_id_idx").on(table.authorId),
  ],
);

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

// ── Projects as a canonical entity (project schema) ─────────────────────────

/**
 * The curated artifact kind. **Text, not a pg enum**, so future kinds are a
 * pure read-path addition (same reasoning as `teams.status` and
 * `collab_posts.type`) — the placement tables keep their narrower enum and
 * render whatever the canonical row says once linked.
 *
 * `jam` is deliberately absent: jam participation is a *record*
 * (`project_jam_links`, or the derived join on `source_game_id`), not a kind
 * of thing. `web` exists because websites and other dev adventures were
 * hiding under `app`'s subtype, and `assets` because itch asset packs had
 * nowhere to go at all.
 */
export const PROJECT_TYPES = ["game", "tool", "assets", "audio", "app", "web", "other"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/** Provenance of the canonical row itself. `itchio-jam` collapses into
 * `itchio` here: the *game* is the identity, the entry is a jam-record fact. */
export const PROJECT_SOURCES = ["manual", "itchio"] as const;
export type ProjectSource = (typeof PROJECT_SOURCES)[number];

/** A secondary link on a project: repo, live site, store page, registry. */
export type ProjectLink = { label: string; url: string };

/**
 * A thing somebody made. One row per artifact, no matter how many people
 * showcase it.
 *
 * The same shipped game used to exist as N unrelated `profile_projects`
 * rows plus a `team_projects` copy, with nothing joining them — so "who
 * worked on this?" was unanswerable and a project page had no row to be a
 * page *of*. This is that row; `profile_projects` and `team_projects`
 * become **placements** of it, keeping everything surface-shaped (pinned,
 * sort order, moderation status, per-surface image override) while
 * *identity* lives here.
 *
 * A project only exists when something local anchors it — a profile
 * placement, a team placement, or a manual creation. The scraped entries
 * corpus (hundreds of thousands of rows across ~21k jams) is rendered
 * straight from `itch.jam_entries`; an entry links to a project page only
 * when one happens to exist.
 */
export const projects = projectSchema.table(
  "projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Baked in at birth (the teams lesson, not the profiles retrofit).
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    type: text("type").$type<ProjectType>().notNull().default("game"),
    // Existing manual nuance, unchanged: music/sfx, web/standalone/mobile.
    subTypes: text("sub_types").array().notNull().default([]),
    // Raw itch API values — provider-owned, refreshed on sync, never
    // user-edited. Null for manual/off-itch rows, except `releaseStatus`,
    // which an owner may set on a manual project (a website wants "in
    // development" too, and itch's vocabulary is a good neutral one).
    // `classification`: game | asset | game_mod | physical_game |
    // soundtrack | tool | comic | book | other. Stored verbatim; only the
    // read-path mapping knows the spellings.
    classification: text("classification"),
    // itch's `type`: default | html | flash | java | unity. `html` is the
    // "playable in browser" signal that drives the project page's CTA.
    embedType: text("embed_type"),
    // itch's `release_status`: released | in_development | on_hold |
    // canceled | prototype.
    releaseStatus: text("release_status"),
    // The primary link — what the page's CTA points at.
    url: text("url"),
    // Everything else: repo, live site, store page. Deliberately not
    // per-provider columns; a GitHub import later becomes a new `source`
    // value plus an external id, which is a pure addition.
    links: jsonb("links")
      .$type<ProjectLink[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Cover art. `imageKey` uses a *project-scoped* MinIO namespace, not the
    // per-user one: a canonical row referencing a placement owner's uploaded
    // key would inherit that user's lifecycle and blank other people's pages
    // when they delete their account.
    imageUrl: text("image_url"),
    imageKey: text("image_key"),
    source: text("source").$type<ProjectSource>().notNull().default("manual"),
    // itch game id — the dedupe key. Library imports carry it as their
    // placement `sourceId`; jam imports carry an entry id whose
    // `itch.jam_entries.game_id` resolves to it. One game on itch = one
    // project row, however many members imported it.
    sourceGameId: bigint("source_game_id", { mode: "number" }),
    // Provider visibility mirrored at the canonical level. An unpublished
    // project renders only to its editors; a restricted one renders (jam
    // participation is public record) with its itch links suppressed.
    published: boolean("published").notNull().default(true),
    restrictedAt: timestamp("restricted_at"),
    // The honest ship date — never `createdAt`, which is when the row
    // landed in our database. Only a `released` project needs one.
    releasedAt: timestamp("released_at"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Partial: manual projects have no game id and must not collide on NULL.
    // This also serves the by-game-id reads (the derived jam record, and the
    // entries grid's "does this entry have a project page" lookup) — Postgres
    // can use a partial index for `= x` once it can prove x is not null, so a
    // second plain index on the same column would be dead weight.
    uniqueIndex("projects_source_game_unique")
      .on(table.sourceGameId)
      .where(sql`${table.sourceGameId} IS NOT NULL`),
  ],
);

/**
 * Who made it — the project page's reason to exist.
 *
 * Supersedes `team_project_credits`, which was team-scoped because teams
 * were the only entity that shipped things; a jam entry made by three
 * friends who never formed a team deserves credits too. Same philosophy:
 * `display_name` always survives, `profile_id` is the optional live link,
 * and roster churn never mutates a shipped credit.
 */
export const projectContributors = projectSchema.table(
  "project_contributors",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // set null, NOT cascade: a deleted account keeps its name in the
    // credits; only the link dies.
    profileId: text("profile_id").references(() => developerProfiles.id, {
      onDelete: "set null",
    }),
    displayName: text("display_name").notNull(),
    // "Composer", "Pixel art" — free text, same self-description rule as
    // `team_members.title`.
    role: text("role"),
    // 'placement' | 'entry-contributors' | 'manual'. Lets a re-sync refresh
    // scraped rows without clobbering hand-edited ones.
    source: text("source").notNull().default("manual"),
    sortOrder: integer("sort_order").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // One credit row per profile per project; free-text rows are exempt.
    uniqueIndex("project_contributors_profile_unique")
      .on(table.projectId, table.profileId)
      .where(sql`${table.profileId} IS NOT NULL`),
    index("project_contributors_profile_idx").on(table.profileId),
  ],
);

/**
 * A team's claim on a project ("made by Studio Chonk").
 *
 * Distinct from the team's *placement* (a `team_projects` row is what their
 * page chooses to show); this is the credit-level fact the project page
 * renders, and it survives the team un-showcasing the work.
 */
export const projectTeams = projectSchema.table(
  "project_teams",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique().on(table.projectId, table.teamId)],
);

/**
 * Jam appearances that can't be derived.
 *
 * For an imported project the jam record is a **DB-only join** —
 * `projects.source_game_id = itch.jam_entries.game_id` gives every
 * appearance, with rank from `jam_entry_results`, at zero maintenance cost.
 * These rows cover the rest: manual entries, and jams that never happened
 * on itch. Read paths union the two.
 *
 * Same hybrid `jam_id`-FK-or-free-text pattern the placement tables use.
 */
export const projectJamLinks = projectSchema.table(
  "project_jam_links",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    jamId: integer("jam_id").references(() => itchJams.jamId, { onDelete: "set null" }),
    // Free text for off-itch jams; read paths coalesce text over the join.
    jamName: text("jam_name"),
    jamUrl: text("jam_url"),
    submissionUrl: text("submission_url"),
    // "Overall: #12 of 312", or whatever the owner typed.
    result: text("result"),
    participatedAt: timestamp("participated_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_jam_links_jam_unique")
      .on(table.projectId, table.jamId)
      .where(sql`${table.jamId} IS NOT NULL`),
  ],
);
