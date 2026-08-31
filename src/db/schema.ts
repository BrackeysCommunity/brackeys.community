import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ── Schemas ─────────────────────────────────────────────────────────────────

export const authSchema = pgSchema("auth");
export const userSchema = pgSchema("user");
export const collabSchema = pgSchema("collab");
export const teamSchema = pgSchema("team");
export const itchSchema = pgSchema("itch");
export const projectSchema = pgSchema("project");
export const socialSchema = pgSchema("social");
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
  // Ban state lives on the identity row (not developer_profiles) so it
  // survives profile deletion/anonymization.
  bannedAt: timestamp("banned_at"),
  banReason: text("ban_reason"),
  bannedById: text("banned_by_id").references((): AnyPgColumn => user.id, {
    onDelete: "set null",
  }),
  /** Null is permanent; a ban past this instant is over without anyone acting. */
  bannedUntil: timestamp("banned_until"),
  /** When staff lifted it. The ban fields stay behind it as the history record. */
  unbannedAt: timestamp("unbanned_at"),
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

export const developerProfiles = userSchema.table(
  "developer_profiles",
  {
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
    /** IANA zone name ("Europe/Madrid"). Offsets are derived at read time —
     *  storing an offset would go stale every DST transition. */
    timezone: text("timezone"),
    /** Free text, not geodata — "Lisbon-ish" is a valid answer. */
    location: text("location"),
    // Gates the profile-wall composer/list for non-owners. Disabling hides
    // existing notes from visitors but never deletes them.
    profileNotesEnabled: boolean("profile_notes_enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  // The directory's timezone facet filters on it — indexed up front
  // because `listMembers` is already the heaviest query in the codebase.
  (table) => [index("developer_profiles_timezone_idx").on(table.timezone)],
);

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

/**
 * A member's craft ("I am a Composer"), drawn from the same curated
 * `collab.collab_roles` vocabulary the board hires against — deliberately
 * shared, so "I am a Composer" and "we need a Composer" can ever meet; a
 * separate profile-role vocabulary would drift. Capped at 3 per profile
 * server-side to keep it a claim, not a tag cloud.
 */
export const userRoles = userSchema.table(
  "user_roles",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => developerProfiles.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => collabRoles.id, { onDelete: "cascade" }),
  },
  (table) => [
    unique().on(table.userId, table.roleId),
    // Role-vocabulary removals check usage here, and the directory's role
    // facet EXISTS-joins on it.
    index("user_roles_role_idx").on(table.roleId),
  ],
);

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
  // "user" when the member claimed the stub themselves, "discord" when it
  // was defaulted from their Discord username at first sign-in. Recorded
  // but not acted on today: nothing automatic ever rewrites a stub.
  source: text("source").notNull().default("user"),
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
    // Every read surface filters on `approved`; no review queue exists, so
    // the default must not gate visibility.
    status: text("status").notNull().default("approved"),
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
    // Set when this game vanished from the account's `/profile/games`
    // response (deleted on itch, or this member lost admin access — both
    // mean "stop listing it on this profile"). Account-scoped by design:
    // a teammate losing access says nothing about the game itself, so this
    // lives on the placement, not `project.projects`. Cleared when the game
    // reappears; never stamped off an empty response (API hiccup guard).
    missingSince: timestamp("missing_since"),
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
    providerDisplayName: text("provider_display_name"),
    providerAvatarUrl: text("provider_avatar_url"),
    providerProfileUrl: text("provider_profile_url"),
    accessToken: text("access_token"),
    scopes: text("scopes"),
    // Set on the first 401/403 from the provider, cleared on success or
    // re-link. Non-null = the profile UI shows RECONNECT and the sweep
    // skips the account's API sync (jam backfill still runs — it's DB-only).
    tokenInvalidAt: timestamp("token_invalid_at"),
    // Sweep resume cursor: ordered ASC NULLS FIRST, so an aborted sweep's
    // next tick starts at the starved tail instead of re-syncing the head.
    lastSyncedAt: timestamp("last_synced_at"),
    // The provider's user object verbatim, written at link and refreshed by
    // the sweep's identity pass. Audit/backfill surface, never a read path.
    providerRaw: jsonb("provider_raw"),
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
  | "collab_response_withdrawn"
  | "collab_post_featured"
  | "collab_post_closed_by_staff"
  | "collab_post_expiring"
  | "collab_post_expired"
  | "team_invite_received"
  | "team_invite_accepted"
  | "team_invite_declined"
  | "team_member_removed"
  | "team_archive_warning"
  | "team_auto_archived"
  | "team_updated_by_staff"
  | "team_member_removed_by_staff"
  | "team_ownership_transferred_by_staff"
  | "team_hidden_by_staff"
  | "team_unhidden_by_staff"
  | "team_deleted_by_staff"
  | "profile_updated_by_staff"
  | "comment_received"
  | "comment_reply"
  | "comment_removed_by_staff"
  | "report_resolved"
  | "skill_request_approved"
  | "skill_request_rejected"
  | "jam_starting"
  | "jam_voting_open"
  | "jam_results_posted"
  | "jam_team_post_created";

export type NotificationEntityType =
  | "collab_post"
  | "collab_response"
  | "team"
  | "team_invite"
  | "thread"
  | "comment"
  | "skill_request"
  | "jam";

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
  // Global "email me nothing" switch, checked independently of the per-type
  // matrix so a type added later can't reopen a channel the user closed.
  // Covers notification + digest mail only; account-security mail (verify,
  // password reset, deletion confirmation) ignores it.
  emailsDisabled: boolean("emails_disabled").notNull().default(false),
  // Stable random token used for one-click unsubscribe links in emails.
  // Issued lazily on first email send; remains valid until the user
  // explicitly regenerates it. Indexed unique so the unsub route can
  // resolve it without a userId.
  unsubscribeToken: text("unsubscribe_token").unique(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
  // The canonical project this post recruits for. Optional on purpose —
  // team is structural (the accept → invite loop needs one), a project is
  // not; plenty of posts are pre-project. Never minted at post time: a
  // post is not an anchor, so "something new" stays free text in
  // `projectName`, and a deleted project degrades the post back to it —
  // the same degrade-don't-delete pattern as `teamId`.
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
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
  // Legacy: no longer written or rendered. A linked team already shows
  // its member count and a project its credits, so the wizard stopped
  // asking. Kept so pre-existing rows survive.
  teamSize: text("team_size"),
  projectLength: text("project_length"),
  platforms: text("platforms").array(),
  // Legacy: free text the wizard never had an input for and no surface
  // ever rendered. Kept so pre-existing rows survive.
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
  // MinIO object key (renamed from strapi_media_id; the Strapi CMS it was
  // named for is long gone and uploads have gone to MinIO ever since).
  imageKey: text("image_key").notNull(),
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
  resolvedAt: timestamp("resolved_at"),
  resolvedById: text("resolved_by_id").references(() => user.id, { onDelete: "set null" }),
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
  // Staff hide — deliberately orthogonal to status, so unhiding restores
  // whichever state the team was in without remembering it anywhere.
  // Null hiddenAt = visible.
  hiddenAt: timestamp("hidden_at"),
  hiddenById: text("hidden_by_id").references(() => user.id, { onDelete: "set null" }),
  // Required when hiding; it is the owner-facing explanation.
  hiddenReason: text("hidden_reason"),
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
    // Provenance: this roster seat came from accepting a collab response.
    // Mirrors `team_invites.sourceResponseId` — the invite records the
    // handoff, this records that it stuck, which is the durable
    // "we worked together" fact the invite row can't carry (a revoked or
    // superseded invite looks identical to an accepted one after the fact).
    // `set null`, not cascade: deleting the post must not delete the roster.
    sourceResponseId: integer("source_response_id").references(() => collabResponses.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    unique().on(table.teamId, table.userId),
    // Every profile read counts this member's collabs, and the unique above
    // leads with `team_id`, so a by-user lookup had no index to use.
    index("team_members_user_idx").on(table.userId),
  ],
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

/**
 * Deliberately `set null` on the team FK where the report twins cascade:
 * a team owner can hard-delete the subject, and a cascade would let that
 * delete the evidence and dodge the queue. The name snapshot keeps an
 * orphaned report readable.
 */
export const teamReports = teamSchema.table("team_reports", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
  teamName: text("team_name").notNull(),
  reporterId: text("reporter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedById: text("resolved_by_id").references(() => user.id, { onDelete: "set null" }),
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
  // The one staff-written column on an otherwise scraped table: a home-hero
  // pin, newest wins, self-expiring once the jam is no longer live/upcoming.
  // The scraper's upsert lists its columns explicitly and must skip this one.
  heroPinnedAt: timestamp("hero_pinned_at", { withTimezone: true }),
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
    // grid, `recentEntriesQuery`, the results board — filters on jam_id first.
    index("jam_entries_jam_id_idx").on(table.jamId),
    // The game id is the identity a project row dedupes on, so the derived
    // "which jams did this game enter" join reads by it.
    index("jam_entries_game_id_idx").on(table.gameId),
    // Author id is how a scraped entry is matched to a linked itch account
    // (the "Brackeys member" badge on the entries grid).
    index("jam_entries_author_id_idx").on(table.authorId),
  ],
);

/**
 * "Submission to X" banners read off members' itch.io game pages by the
 * library sync — the seam between that service and the scraper.
 *
 * Discovery can only ingest jams itch lists, and itch's listings are not a
 * complete index: the 2014 cohort (Candy Jam is jam_id 1) never appears in
 * /jams/past at all, and spot checks find ordinary older jams missing too. A
 * member's own game page names the jam it was submitted to regardless, so the
 * scan turns "a jam one of our members actually entered" into a discovery
 * source, at one page fetch per game rather than a blind sweep of the id space.
 *
 * Keyed by itch game id, not by placement: the fact is about the game, so one
 * scan covers every member who holds it and outlives the placement row.
 */
export const itchGameJamScans = itchSchema.table("game_jam_scans", {
  gameId: bigint("game_id", { mode: "number" }).primaryKey(),
  gameUrl: text("game_url").notNull(),
  // Empty means scanned and not a jam submission — which is most games, and
  // is what keeps them from being re-fetched every tick.
  jamSlugs: text("jam_slugs")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  scannedAt: timestamp("scanned_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Resume points for the scraper's long walks, so a tick that stops at its
 * deadline continues where it left off instead of re-probing from the start.
 *
 * One row per walk, keyed by name (`jam_id_sweep` today). A cursor is only
 * ever a *position*, never a record of what was found — everything the walk
 * learns lands in `itch.jams` / `itch.jam_entries` as it goes, so a lost
 * cursor costs re-probing, not data.
 */
/**
 * Detection bookkeeping for the entry-moderation scan worker (plan 22): one
 * row per entry whose cover has been fetched and fingerprinted. Written only
 * by the scan job — same scraper-owned family as `game_jam_scans` above,
 * and the same ownership rule: detection state lives here, never as columns
 * on `jam_entries` (see the comment on `jamWatches`). What the scan *found*
 * is not stored here either — flags worth a human's time go to
 * `social.entry_flags`; this table only answers "is this entry due?".
 */
export const itchEntryScans = itchSchema.table(
  "entry_scans",
  {
    entryId: bigint("entry_id", { mode: "number" })
      .primaryKey()
      .references(() => itchJamEntries.entryId, { onDelete: "cascade" }),
    // The cover URL that was actually fetched and hashed; null when the
    // entry had none. Itch derivative URLs change when a cover is replaced,
    // so `game_cover_url IS DISTINCT FROM cover_url` is the cheap "cover
    // swapped after submission" re-scan trigger — itself a mild signal.
    coverUrl: text("cover_url"),
    // Perceptual hash (64-bit dHash, 16 hex chars) of that cover; null
    // when the entry has no cover.
    coverPhash: text("cover_phash"),
    // Raw classifier output (the sexual-category score since detector v5),
    // kept so a threshold change re-flags with a SQL pass instead of
    // re-running inference over the corpus.
    nsfwScore: real("nsfw_score"),
    // Bump the constant in the scan job to force a global re-scan.
    detectorVersion: integer("detector_version").notNull(),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // The internal-theft matcher joins new hashes against the whole corpus
    // by exact hash; near-hash comparison stays jam-scoped in the job.
    index("entry_scans_cover_phash_idx").on(table.coverPhash),
  ],
);

export const itchScrapeCursors = itchSchema.table("scrape_cursors", {
  name: text("name").primaryKey(),
  position: bigint("position", { mode: "number" }).notNull(),
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

/**
 * A member's relationship to a jam — the only user-declared thing about a
 * jam anywhere in the app. Everything else on a jam is scraped.
 *
 * Lives in `user`, not `itch`, and that placement is load-bearing: the
 * scraper owns the `itch.*` tables and reconciles them (soft-delete,
 * re-scrape, tombstone), so app columns bolted onto `itch.jams` would be
 * fighting it. The notification stamps below are the same argument in
 * miniature — they are per-watcher facts, not per-jam ones, so they belong
 * on the watch row even though "this jam started" is a property of the jam.
 *
 * Defined down here rather than up with the other `user` tables so the FK
 * to `itch.jams` reads in declaration order.
 */
export const jamWatches = userSchema.table(
  "jam_watches",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    jamId: integer("jam_id")
      .notNull()
      .references(() => itchJams.jamId, { onDelete: "cascade" }),
    /**
     * 'watching' | 'entering'. One column rather than a second table: they
     * are the same affinity at two strengths, and a member who declares and
     * then backs off should downgrade, not leave a tombstone in a
     * participation table. Declared intent is never promoted into actual
     * participation — `itchio-jam-sync` stays the only source of *shipped*.
     */
    intent: text("intent").notNull().default("watching"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Claimed-timestamp idempotency for the sweep, one per phase event, in
    // the same shape as `collab_posts.expiryNotifiedAt`.
    startNotifiedAt: timestamp("start_notified_at"),
    votingNotifiedAt: timestamp("voting_notified_at"),
    resultsNotifiedAt: timestamp("results_notified_at"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.jamId] }),
    // The fan-out direction: "everyone watching jam X". The PK leads with
    // user_id, so it cannot serve this.
    index("jam_watches_jam_idx").on(table.jamId),
  ],
);

export type JamWatchIntent = "watching" | "entering";

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

/** Last provider-seen values backing the snapshot-gated refresh — see
 * `projects.sourceSnapshot`. */
export type ProjectSourceSnapshot = {
  title: string | null;
  description: string | null;
  url: string | null;
};

/** Render-safe provider stats snapshot — see `projects.providerStats`. */
export type ProjectProviderStats = {
  downloadsCount?: number;
  viewsCount?: number;
  purchasesCount?: number;
  minPrice?: number;
  /** ISO timestamp of the sync that wrote this snapshot. */
  syncedAt: string;
};

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
    // Last provider-seen values for the snapshot-gated refresh: a field is
    // provider-refreshed only while the row still equals what the provider
    // last said (i.e. the owner hasn't edited it). Null on manual/jam-only
    // rows and on rows that predate the column — those keep any drift until
    // the next provider-side change.
    sourceSnapshot: jsonb("source_snapshot").$type<ProjectSourceSnapshot>(),
    // Derived from itch's `traits` (`p_windows` → "windows"). Null when the
    // provider sent no traits; provider-owned, refreshed every sync.
    platforms: text("platforms").array(),
    // Curated, render-safe stats snapshot — overwritten each sync, never a
    // time-series (the TimescaleDB scraper is where history would live).
    providerStats: jsonb("provider_stats").$type<ProjectProviderStats>(),
    // The provider's game object verbatim, overwritten each sync. Audit and
    // future-backfill surface only — read paths use the typed columns, and
    // API responses strip it (see getProject).
    providerRaw: jsonb("provider_raw"),
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

// ── Social layer: comment threads (social schema) ───────────────────────────

export const threadSubjectType = socialSchema.enum("thread_subject_type", [
  "collab_post",
  "profile",
  "collab_response",
]);

/**
 * The polymorphism boundary for commentable entities. A thread carries one
 * real FK per subject type (CHECK-constrained to exactly one) so subject
 * deletion cascades the whole conversation with zero app code — the same
 * reason the codebase avoids text polymorphism everywhere else. Comments,
 * subscriptions, and reports only ever reference threads/comments; adding a
 * new commentable paradigm touches this table (one column) and the handler
 * registry in `src/lib/comment-subjects.ts`, nothing else.
 */
export const threads = socialSchema.table(
  "threads",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    subjectType: threadSubjectType("subject_type").notNull(),
    collabPostId: integer("collab_post_id").references(() => collabPosts.id, {
      onDelete: "cascade",
    }),
    // References auth.user, not developer_profiles: a deleted account's wall
    // (including other people's notes on it) dies with the account even when
    // profile cleanup falls back to anonymization.
    profileUserId: text("profile_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    // Private two-party thread hanging off one application. Cascade is the
    // whole lifecycle: withdrawing the response takes the conversation with
    // it, so a private thread can never outlive the thing that scoped it.
    // Visibility is *not* a column — it derives from the response's two
    // parties in `comment-subjects.ts`, so it can't drift from the roster.
    collabResponseId: integer("collab_response_id").references(() => collabResponses.id, {
      onDelete: "cascade",
    }),
    lockedAt: timestamp("locked_at"),
    lockedById: text("locked_by_id").references(() => user.id, { onDelete: "set null" }),
    commentCount: integer("comment_count").notNull().default(0),
    lastCommentAt: timestamp("last_comment_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    check(
      "threads_one_subject",
      sql`num_nonnulls(${t.collabPostId}, ${t.profileUserId}, ${t.collabResponseId}) = 1`,
    ),
    // The `::text` casts are load-bearing, not noise. Comparing the column
    // against a bare literal makes Postgres resolve that literal as an enum
    // *value*, and it refuses to do that for a value added earlier in the
    // same transaction (55P04, "New enum values must be committed before
    // they can be used"). Drizzle's migrator runs every pending migration
    // inside one transaction, so the migration that adds a subject type can
    // never also write a constraint mentioning it — unless the comparison is
    // string-to-string, which is what these casts make it. Cast all three so
    // the next subject type is a plain schema edit rather than a deploy
    // failure someone has to rediscover.
    check(
      "threads_subject_type_matches",
      sql`(${t.subjectType}::text = 'collab_post') = (${t.collabPostId} IS NOT NULL)
      AND (${t.subjectType}::text = 'profile') = (${t.profileUserId} IS NOT NULL)
      AND (${t.subjectType}::text = 'collab_response') = (${t.collabResponseId} IS NOT NULL)`,
    ),
    // Partial unique indexes make lazy get-or-create race-safe.
    uniqueIndex("threads_collab_post_uq")
      .on(t.collabPostId)
      .where(sql`${t.collabPostId} IS NOT NULL`),
    uniqueIndex("threads_profile_uq")
      .on(t.profileUserId)
      .where(sql`${t.profileUserId} IS NOT NULL`),
    uniqueIndex("threads_collab_response_uq")
      .on(t.collabResponseId)
      .where(sql`${t.collabResponseId} IS NOT NULL`),
  ],
);

export const comments = socialSchema.table(
  "comments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    threadId: bigint("thread_id", { mode: "number" })
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    // parentId = integrity; rootId = top-level ancestor so one indexed query
    // fetches an entire reply chain; depth = display logic without walking.
    parentId: bigint("parent_id", { mode: "number" }).references((): AnyPgColumn => comments.id, {
      onDelete: "cascade",
    }),
    rootId: bigint("root_id", { mode: "number" }).references((): AnyPgColumn => comments.id, {
      onDelete: "cascade",
    }),
    depth: integer("depth").notNull().default(0),
    // Set-null is a deliberate break from the usual author cascades:
    // cascading would rip whole subtrees out of live conversations when an
    // account is deleted. NULL author renders as "Deleted User"; content
    // redaction happens in `cleanupUserData` while the user row still exists.
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    content: text("content").notNull(),
    replyCount: integer("reply_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    editedAt: timestamp("edited_at"),
    // User-facing deletes are tombstones; hard deletes only arrive from the
    // subject → thread → comments cascade, where removing subtrees is right.
    deletedAt: timestamp("deleted_at"),
    deletedById: text("deleted_by_id").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    check("comments_root_iff_parent", sql`(${t.parentId} IS NULL) = (${t.rootId} IS NULL)`),
    check("comments_depth_matches", sql`(${t.parentId} IS NULL) = (${t.depth} = 0)`),
    index("comments_thread_toplevel_idx")
      .on(t.threadId, t.id.desc())
      .where(sql`${t.parentId} IS NULL`),
    index("comments_root_idx").on(t.rootId, t.id),
    index("comments_author_idx").on(t.authorId),
  ],
);

/**
 * Forum-grade fan-out: the subject owner is subscribed at thread creation,
 * each commenter at their first comment (`onConflictDoNothing`, so an
 * auto-subscribe never flips `muted` back off).
 */
export const threadSubscriptions = socialSchema.table(
  "thread_subscriptions",
  {
    threadId: bigint("thread_id", { mode: "number" })
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    muted: boolean("muted").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.threadId, t.userId] }),
    index("thread_subs_user_idx").on(t.userId),
  ],
);

export const userBlocks = socialSchema.table(
  "user_blocks",
  {
    blockerId: text("blocker_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    blockedId: text("blocked_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index("user_blocks_blocked_idx").on(t.blockedId),
  ],
);

/**
 * Comment twin of `collabPostReports`; both carry resolution state so
 * staff get a queue, not just a log.
 */
export const commentReports = socialSchema.table("comment_reports", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  commentId: bigint("comment_id", { mode: "number" })
    .notNull()
    .references(() => comments.id, { onDelete: "cascade" }),
  reporterId: text("reporter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedById: text("resolved_by_id").references(() => user.id, { onDelete: "set null" }),
});

export type EntryFlagKind = "stolen_external" | "stolen_internal" | "nsfw" | "other";
export type EntryFlagSource = "auto" | "staff" | "community";
export type EntryFlagStatus = "open" | "confirmed" | "dismissed";

/**
 * A jam entry that deserves a human look — written by the scraper's scan
 * worker today (`source: "auto"`), shaped so a staff note or a community
 * "report entry" button can share the table later. Nothing acts on a flag
 * automatically: the row exists to fill the `/admin` queue, and confirm/
 * dismiss from there writes `moderation_actions` like every staff decision.
 *
 * Lives in `social`, not `itch`, by the `jamWatches` ownership rule — the
 * scraper reconciles `itch.*` and would fight app-owned moderation state.
 * `kind` includes `stolen_external` even though nothing writes it yet; it
 * is the slot a report button or an on-demand reverse-image check fills.
 */
export const entryFlags = socialSchema.table(
  "entry_flags",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entryId: bigint("entry_id", { mode: "number" })
      .notNull()
      .references(() => itchJamEntries.entryId, { onDelete: "cascade" }),
    // Denormalized: the queue is jam-scoped ("everything flagged in the
    // running jam") and must not join the largest table in the database
    // just to filter.
    jamId: integer("jam_id")
      .notNull()
      .references(() => itchJams.jamId, { onDelete: "cascade" }),
    kind: text("kind").$type<EntryFlagKind>().notNull(),
    source: text("source").$type<EntryFlagSource>().notNull().default("auto"),
    /** Detector confidence for queue ordering; null for human sources. */
    score: real("score"),
    /**
     * Everything a mod needs to judge without re-running detection: the
     * matched internal entry, hash distances, classifier scores, plus a
     * snapshot of the entry's title/cover so the row stays legible if the
     * scraper tombstones the entry.
     */
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text("status").$type<EntryFlagStatus>().notNull().default("open"),
    resolvedAt: timestamp("resolved_at"),
    resolvedById: text("resolved_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // The scan tick is idempotent against this: a re-detection updates the
    // open flag's evidence/score instead of stacking duplicates. Resolved
    // flags stay forever as the "we already looked" memory, and the job
    // skips re-flagging anything a human has already ruled on.
    uniqueIndex("entry_flags_open_kind_uidx")
      .on(t.entryId, t.kind)
      .where(sql`${t.status} = 'open'`),
    index("entry_flags_entry_idx").on(t.entryId),
    index("entry_flags_jam_idx").on(t.jamId),
  ],
);

// ── Moderation log (social schema) ──────────────────────────────────────────

/**
 * Every staff action taken on the site, and why. The notification carrying
 * a removal reason is the user's copy and they can delete it; this is the
 * record that survives — "why did this come down six months ago" needs an
 * answer that doesn't depend on the recipient keeping their inbox. The
 * guild's own moderation tables live in the EF-owned `hammer` schema
 * (`src/db/hammer.ts`); this log is the site's half of that story.
 */
export type ModerationActionType =
  | "comment_removed"
  | "comment_report_dismissed"
  | "post_closed"
  | "post_reopened"
  | "post_deleted"
  | "post_report_dismissed"
  | "post_report_deleted"
  | "report_reopened"
  | "skill_request_approved"
  | "skill_request_rejected"
  | "jam_hero_pinned"
  | "jam_hero_unpinned"
  | "user_banned"
  | "user_unbanned"
  | "vocabulary_created"
  | "vocabulary_renamed"
  | "vocabulary_deleted"
  | "team_updated"
  | "team_slug_updated"
  | "team_image_cleared"
  | "team_member_removed"
  | "team_member_invited"
  | "team_member_title_updated"
  | "team_ownership_transferred"
  | "team_project_updated"
  | "team_project_removed"
  | "team_hidden"
  | "team_unhidden"
  | "team_deleted"
  | "team_report_dismissed"
  | "moderation_proposed"
  | "moderation_proposal_approved"
  | "moderation_proposal_rejected"
  | "profile_updated"
  | "entry_flag_confirmed"
  | "entry_flag_dismissed";

export type ModerationTargetType =
  | "comment"
  | "comment_report"
  | "collab_post"
  | "post_report"
  | "skill_request"
  | "skill"
  | "collab_role"
  | "jam"
  | "user"
  | "team"
  | "team_report"
  | "moderation_proposal"
  | "jam_entry";

export const moderationActions = socialSchema.table(
  "moderation_actions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    action: text("action").$type<ModerationActionType>().notNull(),
    // Both people are `set null`, never cascade: a log row that disappears
    // with the account is not a log. `actorName` is the snapshot that keeps
    // the row readable afterwards — a moderator acting in an official
    // capacity, not personal data. The subject is deliberately *not*
    // snapshotted, so an account erasure anonymizes what was done to them
    // while leaving the fact that it happened.
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    actorName: text("actor_name"),
    subjectUserId: text("subject_user_id").references(() => user.id, { onDelete: "set null" }),
    targetType: text("target_type").$type<ModerationTargetType>().notNull(),
    /** Text, not a FK: targets span eight tables and outlive their rows. */
    targetId: text("target_id"),
    /** What staff typed, when they typed one. */
    reason: text("reason"),
    /** Names, titles, and previous values — whatever makes the row legible
     * without joining to tables the target may have been deleted from. */
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("moderation_actions_created_idx").on(t.createdAt.desc()),
    // "everything done to this member" and "everything this mod did" are
    // the two questions an incident review actually asks.
    index("moderation_actions_subject_idx").on(t.subjectUserId, t.createdAt.desc()),
    index("moderation_actions_actor_idx").on(t.actorId, t.createdAt.desc()),
    index("moderation_actions_target_idx").on(t.targetType, t.targetId),
  ],
);

export type ModerationProposalStatus = "pending" | "approved" | "rejected" | "superseded";
export type ModerationProposalTargetType = "team" | "profile";

/**
 * Staff-filed edits awaiting an admin's ruling — the `propose` tier of
 * `MOD_POWERS`. Copies the `skill_requests` shape: compare-and-set on
 * `status = 'pending'`, apply-then-mark in one transaction, audit row,
 * best-effort notify. `action` stays a plain string column so the policy
 * map can grow without touching the table.
 */
export const moderationProposals = socialSchema.table(
  "moderation_proposals",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    action: text("action").notNull(),
    targetType: text("target_type").$type<ModerationProposalTargetType>().notNull(),
    targetId: text("target_id").notNull(),
    /** The validated procedure input the approval will apply. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** Target values at propose time — the reviewer's diff baseline. */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    /** Why — becomes the owner-facing explanation on apply. */
    reason: text("reason").notNull(),
    proposedById: text("proposed_by_id").references(() => user.id, { onDelete: "set null" }),
    // Snapshot that survives account deletion, same rationale as
    // `moderation_actions.actorName`.
    proposedByName: text("proposed_by_name"),
    status: text("status").$type<ModerationProposalStatus>().notNull().default("pending"),
    reviewedById: text("reviewed_by_id").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    reviewNote: text("review_note"),
    /** Target values at apply time — what the approval overwrote. */
    appliedPrevious: jsonb("applied_previous").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // One live proposal per action per subject; a newer one supersedes it
    // atomically (the `team_invites` pattern).
    uniqueIndex("moderation_proposals_pending_unique")
      .on(t.targetType, t.targetId, t.action)
      .where(sql`${t.status} = 'pending'`),
    index("moderation_proposals_status_idx").on(t.status, t.createdAt.desc()),
  ],
);
