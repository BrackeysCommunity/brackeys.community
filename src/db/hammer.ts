/**
 * The Hammer Discord bot's tables (github.com/BrackeysBot/Hammer) — a typed
 * read surface, NOT a drizzle-managed schema.
 *
 * Ownership contract: Hammer runs EF Core code-first against the `hammer`
 * schema with its own migration ledger (`__EFMigrationsHistory`); this file
 * is a hand-maintained mirror of that shape so the app can query it. It is
 * deliberately outside `drizzle.config.ts`'s `schema` path and its
 * `schemaFilter`, so drizzle-kit never diffs, drops, or "fixes" these
 * tables — when Hammer ships a shape change, update this mirror to match.
 * The bot writes these; the app only reads them.
 *
 * Shape notes (agreed at the SQLite → shared-Postgres handoff):
 *
 * - Discord snowflakes (`ulong` in the bot) are `text`, matching
 *   `developer_profiles.discord_id` and every other snowflake column in the
 *   app. Deliberately no FK onto `developer_profiles`: the bot records guild
 *   members who have never signed in here, so most of these ids have no
 *   profile row — app reads are LEFT JOINs on `discord_id`.
 * - Timestamps are `timestamptz`; Npgsql maps `DateTimeOffset` only to
 *   `timestamp with time zone`.
 * - C# enums stay integers. `infractions.type` is InfractionType (0 Warning,
 *   1 MessageDeletion, 2 Gag, 3 TemporaryMute, 4 Mute, 5 Kick,
 *   6 TemporaryBan, 7 Ban); `member_notes.type` is MemberNoteType (0 Guru,
 *   1 Staff).
 * - `attachments` is `text[]` of URLs — Npgsql maps string collections to
 *   arrays natively.
 */
import {
  bigserial,
  boolean,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const hammerSchema = pgSchema("hammer");

export const altAccounts = hammerSchema.table(
  "alt_accounts",
  {
    userId: text("user_id").notNull(),
    altId: text("alt_id").notNull(),
    staffMemberId: text("staff_member_id").notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.altId] })],
);

export const blockedReporters = hammerSchema.table(
  "blocked_reporters",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    blockedAt: timestamp("blocked_at", { withTimezone: true }).notNull(),
    staffMemberId: text("staff_member_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.guildId] })],
);

export const deletedMessages = hammerSchema.table("deleted_messages", {
  /** The message's own snowflake — Hammer's PK, not a generated id. */
  messageId: text("message_id").primaryKey(),
  attachments: text("attachments").array().notNull(),
  authorId: text("author_id").notNull(),
  channelId: text("channel_id").notNull(),
  content: text("content"),
  creationTimestamp: timestamp("creation_timestamp", { withTimezone: true }).notNull(),
  deletionTimestamp: timestamp("deletion_timestamp", { withTimezone: true }).notNull(),
  guildId: text("guild_id").notNull(),
  staffMemberId: text("staff_member_id").notNull(),
});

export const infractions = hammerSchema.table(
  "infractions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    guildId: text("guild_id").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    // Rule number + snapshot of its text at issue time, so the row stays
    // readable after the rulebook is edited. Loose by design, like
    // `moderation_actions.target_id`.
    ruleId: integer("rule_id"),
    ruleText: text("rule_text"),
    staffMemberId: text("staff_member_id").notNull(),
    type: integer("type").notNull(),
    userId: text("user_id").notNull(),
    additionalInformation: text("additional_information"),
  },
  // "Everything the guild has on this member", newest first — the member
  // dossier read.
  (table) => [index("infractions_user_idx").on(table.userId, table.issuedAt.desc())],
);

export const memberNotes = hammerSchema.table(
  "member_notes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    authorId: text("author_id").notNull(),
    content: text("content").notNull(),
    creationTimestamp: timestamp("creation_timestamp", { withTimezone: true }).notNull(),
    guildId: text("guild_id").notNull(),
    type: integer("type").notNull(),
    userId: text("user_id").notNull(),
  },
  (table) => [index("member_notes_user_idx").on(table.userId)],
);

export const mutes = hammerSchema.table(
  "mutes",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    /** Null is permanent, mirroring `user.banned_until`. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.guildId] })],
);

export const reportedMessages = hammerSchema.table("reported_messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  attachments: text("attachments").array().notNull(),
  authorId: text("author_id").notNull(),
  channelId: text("channel_id").notNull(),
  content: text("content"),
  guildId: text("guild_id").notNull(),
  messageId: text("message_id").notNull(),
  reporterId: text("reporter_id").notNull(),
});

export const rules = hammerSchema.table(
  "rules",
  {
    guildId: text("guild_id").notNull(),
    /** Rule number, unique per guild — "rule 5", not a surrogate id. */
    id: integer("id").notNull(),
    brief: text("brief"),
    description: text("description").notNull(),
  },
  (table) => [primaryKey({ columns: [table.id, table.guildId] })],
);

export const staffMessages = hammerSchema.table("staff_messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  content: text("content").notNull(),
  guildId: text("guild_id").notNull(),
  recipientId: text("recipient_id").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  staffMemberId: text("staff_member_id").notNull(),
});

export const temporaryBans = hammerSchema.table(
  "temporary_bans",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.guildId] })],
);

export const trackedMessages = hammerSchema.table("tracked_messages", {
  /** The tracked message's snowflake — Hammer keys these by message id. */
  id: text("id").primaryKey(),
  attachments: text("attachments").array().notNull(),
  authorId: text("author_id").notNull(),
  channelId: text("channel_id").notNull(),
  content: text("content"),
  creationTimestamp: timestamp("creation_timestamp", { withTimezone: true }).notNull(),
  deletionTimestamp: timestamp("deletion_timestamp", { withTimezone: true }),
  isDeleted: boolean("is_deleted").notNull().default(false),
  guildId: text("guild_id").notNull(),
});
