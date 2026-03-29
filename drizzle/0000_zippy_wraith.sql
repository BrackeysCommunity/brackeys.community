CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alt_accounts" (
	"user_id" bigint NOT NULL,
	"alt_id" bigint NOT NULL,
	"staff_member_id" bigint NOT NULL,
	"registered_at" timestamp NOT NULL,
	CONSTRAINT "alt_accounts_user_id_alt_id_pk" PRIMARY KEY("user_id","alt_id")
);
--> statement-breakpoint
CREATE TABLE "blocked_reporters" (
	"guild_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"blocked_at" timestamp NOT NULL,
	"staff_member_id" bigint NOT NULL,
	CONSTRAINT "blocked_reporters_user_id_guild_id_pk" PRIMARY KEY("user_id","guild_id")
);
--> statement-breakpoint
CREATE TABLE "deleted_messages" (
	"message_id" bigserial PRIMARY KEY NOT NULL,
	"attachments" text NOT NULL,
	"author_id" bigint NOT NULL,
	"channel_id" bigint NOT NULL,
	"content" text,
	"creation_timestamp" timestamp NOT NULL,
	"deletion_timestamp" timestamp NOT NULL,
	"guild_id" bigint NOT NULL,
	"staff_member_id" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "developer_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"discord_id" text,
	"discord_username" text,
	"avatar_url" text,
	"guild_nickname" text,
	"guild_joined_at" timestamp,
	"guild_roles" text[],
	"bio" text,
	"tagline" text,
	"portfolio_url" text,
	"github_url" text,
	"twitter_url" text,
	"website_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "developer_profiles_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
CREATE TABLE "infractions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" bigint NOT NULL,
	"issued_at" timestamp NOT NULL,
	"reason" text,
	"rule_id" integer,
	"rule_text" text,
	"staff_member_id" bigint NOT NULL,
	"type" integer NOT NULL,
	"user_id" bigint NOT NULL,
	"additional_information" text
);
--> statement-breakpoint
CREATE TABLE "jam_participations" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"jam_name" text NOT NULL,
	"jam_url" text,
	"submission_title" text,
	"submission_url" text,
	"result" text,
	"team_members" text[],
	"participated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_notes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"author_id" bigint NOT NULL,
	"content" text NOT NULL,
	"creation_timestamp" timestamp NOT NULL,
	"guild_id" bigint NOT NULL,
	"type" integer NOT NULL,
	"user_id" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mutes" (
	"guild_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "mutes_user_id_guild_id_pk" PRIMARY KEY("user_id","guild_id")
);
--> statement-breakpoint
CREATE TABLE "profile_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"url" text,
	"screenshot_url" text,
	"tags" text[],
	"pinned" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text
);
--> statement-breakpoint
CREATE TABLE "reported_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"attachments" text NOT NULL,
	"author_id" bigint NOT NULL,
	"channel_id" bigint NOT NULL,
	"content" text,
	"guild_id" bigint NOT NULL,
	"message_id" bigint NOT NULL,
	"reporter_id" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"guild_id" bigint NOT NULL,
	"id" bigint NOT NULL,
	"brief" text,
	"description" text NOT NULL,
	CONSTRAINT "rules_id_guild_id_pk" PRIMARY KEY("id","guild_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "staff_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"guild_id" bigint NOT NULL,
	"recipient_id" bigint NOT NULL,
	"sent_at" text NOT NULL,
	"staff_member_id" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporary_bans" (
	"guild_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "temporary_bans_user_id_guild_id_pk" PRIMARY KEY("user_id","guild_id")
);
--> statement-breakpoint
CREATE TABLE "todos" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tracked_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"attachments" text NOT NULL,
	"author_id" bigint NOT NULL,
	"channel_id" bigint NOT NULL,
	"content" text,
	"creation_timestamp" timestamp NOT NULL,
	"deletion_timestamp" timestamp,
	"is_deleted" integer NOT NULL,
	"guild_id" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jam_participations" ADD CONSTRAINT "jam_participations_profile_id_developer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."developer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_projects" ADD CONSTRAINT "profile_projects_profile_id_developer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."developer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_profile_id_developer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."developer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;