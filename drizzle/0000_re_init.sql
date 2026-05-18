-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE SCHEMA "user";
--> statement-breakpoint
CREATE SCHEMA "itch";
--> statement-breakpoint
CREATE SCHEMA "hammer";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE SCHEMA "collab";
--> statement-breakpoint
CREATE TYPE "user"."profile_project_source" AS ENUM('manual', 'itchio');--> statement-breakpoint
CREATE TYPE "user"."profile_project_type" AS ENUM('jam', 'game', 'audio', 'tool', 'app');--> statement-breakpoint
CREATE SEQUENCE "user"."profile_url_stubs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "user"."skill_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "user"."skills_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "user"."notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "user"."user_skills_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "user"."linked_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "itch"."jams" (
	"jam_id" integer PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"banner_url" text,
	"hashtag" text,
	"hosts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"voting_ends_at" timestamp with time zone,
	"entries_count" integer,
	"ratings_count" integer,
	"content_html" text,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_count" integer,
	CONSTRAINT "jams_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "hammer"."deleted_messages" (
	"message_id" bigserial PRIMARY KEY NOT NULL,
	"attachments" text NOT NULL,
	"author_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"content" text,
	"creation_timestamp" timestamp NOT NULL,
	"deletion_timestamp" timestamp NOT NULL,
	"guild_id" text NOT NULL,
	"staff_member_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."session" (
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
CREATE TABLE "itch"."jam_entries" (
	"entry_id" bigint PRIMARY KEY NOT NULL,
	"jam_id" integer NOT NULL,
	"game_id" bigint NOT NULL,
	"rate_url" text NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"coolness" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"game_title" text NOT NULL,
	"game_short_text" text,
	"game_url" text NOT NULL,
	"game_cover_url" text,
	"game_cover_color" text,
	"game_platforms" text[],
	"author_id" bigint,
	"author_name" text,
	"author_url" text,
	"contributors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"results_fetched_at" timestamp with time zone,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user"."profile_url_stubs" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"stub" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profile_url_stubs_profile_id_unique" UNIQUE("profile_id"),
	CONSTRAINT "profile_url_stubs_stub_unique" UNIQUE("stub")
);
--> statement-breakpoint
CREATE TABLE "user"."skill_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user"."skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text,
	CONSTRAINT "skills_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user"."profile_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"url" text,
	"submission_url" text,
	"tags" text[],
	"pinned" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"image_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" "user"."profile_project_source" DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"type" "user"."profile_project_type" DEFAULT 'game' NOT NULL,
	"sub_types" text[] DEFAULT '{""}' NOT NULL,
	"jam_name" text,
	"jam_url" text,
	"submission_title" text,
	"result" text,
	"team_members" text[],
	"participated_at" timestamp,
	"image_key" text,
	"image_filename" text,
	"image_mime_type" text,
	"image_size_bytes" integer
);
--> statement-breakpoint
CREATE TABLE "hammer"."infractions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"issued_at" timestamp NOT NULL,
	"reason" text,
	"rule_id" text,
	"rule_text" text,
	"staff_member_id" text NOT NULL,
	"type" integer NOT NULL,
	"user_id" text NOT NULL,
	"additional_information" text
);
--> statement-breakpoint
CREATE TABLE "hammer"."member_notes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"creation_timestamp" timestamp NOT NULL,
	"guild_id" text NOT NULL,
	"type" integer NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user"."notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_id" text,
	"entity_type" text,
	"entity_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hammer"."reported_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"attachments" text NOT NULL,
	"author_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"content" text,
	"guild_id" text NOT NULL,
	"message_id" text NOT NULL,
	"reporter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."account" (
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
CREATE TABLE "user"."developer_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"discord_id" text,
	"discord_username" text,
	"avatar_url" text,
	"guild_nickname" text,
	"guild_joined_at" timestamp,
	"guild_roles" text[],
	"bio" text,
	"tagline" text,
	"github_url" text,
	"twitter_url" text,
	"website_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"available_for_work" boolean DEFAULT false,
	"availability" text,
	"rate_type" text,
	"rate_min" integer,
	"rate_max" integer,
	CONSTRAINT "developer_profiles_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
CREATE TABLE "auth"."user" (
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
CREATE TABLE "user"."user_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"skill_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "hammer"."staff_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"guild_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"sent_at" text NOT NULL,
	"staff_member_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hammer"."tracked_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"attachments" text NOT NULL,
	"author_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"content" text,
	"creation_timestamp" timestamp NOT NULL,
	"deletion_timestamp" timestamp,
	"is_deleted" integer NOT NULL,
	"guild_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab"."collab_post_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"strapi_media_id" text NOT NULL,
	"url" text NOT NULL,
	"alt" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "collab"."collab_post_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "collab"."collab_post_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"role_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab"."collab_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text,
	CONSTRAINT "collab_roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "collab"."collab_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"responder_id" text NOT NULL,
	"message" text NOT NULL,
	"portfolio_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "collab_responses_post_id_responder_id_unique" UNIQUE("post_id","responder_id")
);
--> statement-breakpoint
CREATE TABLE "collab"."collab_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"type" text NOT NULL,
	"subtype" text,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"project_name" text,
	"compensation" text,
	"team_size" text,
	"project_length" text,
	"platforms" text[],
	"experience" text,
	"portfolio_url" text,
	"contact_method" text,
	"status" text DEFAULT 'recruiting' NOT NULL,
	"featured_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"compensation_type" text,
	"experience_level" text,
	"contact_type" text,
	"is_individual" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "user"."linked_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"provider_username" text,
	"provider_avatar_url" text,
	"provider_profile_url" text,
	"access_token" text,
	"scopes" text,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "linked_accounts_profile_id_provider_unique" UNIQUE("profile_id","provider")
);
--> statement-breakpoint
CREATE TABLE "user"."user_notification_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"last_digest_at" timestamp,
	"unsubscribe_token" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_notification_settings_unsubscribe_token_unique" UNIQUE("unsubscribe_token")
);
--> statement-breakpoint
CREATE TABLE "hammer"."mutes" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "mutes_user_id_guild_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "hammer"."temporary_bans" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "temporary_bans_user_id_guild_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "hammer"."blocked_reporters" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"blocked_at" timestamp NOT NULL,
	"staff_member_id" text NOT NULL,
	CONSTRAINT "blocked_reporters_user_id_guild_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "hammer"."alt_accounts" (
	"user_id" text NOT NULL,
	"alt_id" text NOT NULL,
	"staff_member_id" text NOT NULL,
	"registered_at" timestamp NOT NULL,
	CONSTRAINT "alt_accounts_user_id_alt_id_pk" PRIMARY KEY("user_id","alt_id")
);
--> statement-breakpoint
CREATE TABLE "hammer"."rules" (
	"guild_id" text NOT NULL,
	"id" text NOT NULL,
	"brief" text,
	"description" text NOT NULL,
	CONSTRAINT "rules_id_guild_id_pk" PRIMARY KEY("guild_id","id")
);
--> statement-breakpoint
CREATE TABLE "itch"."jam_entry_results" (
	"entry_id" bigint NOT NULL,
	"criterion" text NOT NULL,
	"rank" integer NOT NULL,
	"score" numeric(6, 3) NOT NULL,
	"raw_score" numeric(6, 3) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jam_entry_results_entry_id_criterion_pk" PRIMARY KEY("entry_id","criterion")
);
--> statement-breakpoint
CREATE TABLE "user"."notification_preferences" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"digest" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_type_pk" PRIMARY KEY("user_id","type")
);
--> statement-breakpoint
ALTER TABLE "hammer"."deleted_messages" ADD CONSTRAINT "deleted_messages_author_id_developer_profiles_discord_id_fk" FOREIGN KEY ("author_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."deleted_messages" ADD CONSTRAINT "deleted_messages_staff_member_id_developer_profiles_discord_id_" FOREIGN KEY ("staff_member_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itch"."jam_entries" ADD CONSTRAINT "jam_entries_jam_id_jams_jam_id_fk" FOREIGN KEY ("jam_id") REFERENCES "itch"."jams"("jam_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user"."profile_url_stubs" ADD CONSTRAINT "profile_url_stubs_profile_id_developer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "user"."developer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user"."skill_requests" ADD CONSTRAINT "skill_requests_user_id_developer_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD CONSTRAINT "profile_projects_profile_id_developer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "user"."developer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."infractions" ADD CONSTRAINT "infractions_staff_member_id_developer_profiles_discord_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."infractions" ADD CONSTRAINT "infractions_user_id_developer_profiles_discord_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."member_notes" ADD CONSTRAINT "member_notes_author_id_developer_profiles_discord_id_fk" FOREIGN KEY ("author_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."member_notes" ADD CONSTRAINT "member_notes_user_id_developer_profiles_discord_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user"."notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user"."notifications" ADD CONSTRAINT "notifications_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."reported_messages" ADD CONSTRAINT "reported_messages_author_id_developer_profiles_discord_id_fk" FOREIGN KEY ("author_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."reported_messages" ADD CONSTRAINT "reported_messages_reporter_id_developer_profiles_discord_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user"."user_skills" ADD CONSTRAINT "user_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "user"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user"."user_skills" ADD CONSTRAINT "user_skills_user_id_developer_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."staff_messages" ADD CONSTRAINT "staff_messages_recipient_id_developer_profiles_discord_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."staff_messages" ADD CONSTRAINT "staff_messages_staff_member_id_developer_profiles_discord_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."tracked_messages" ADD CONSTRAINT "tracked_messages_author_id_developer_profiles_discord_id_fk" FOREIGN KEY ("author_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab"."collab_post_images" ADD CONSTRAINT "collab_post_images_post_id_collab_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "collab"."collab_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab"."collab_post_reports" ADD CONSTRAINT "collab_post_reports_post_id_collab_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "collab"."collab_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab"."collab_post_reports" ADD CONSTRAINT "collab_post_reports_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab"."collab_post_roles" ADD CONSTRAINT "collab_post_roles_post_id_collab_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "collab"."collab_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab"."collab_post_roles" ADD CONSTRAINT "collab_post_roles_role_id_collab_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "collab"."collab_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab"."collab_responses" ADD CONSTRAINT "collab_responses_post_id_collab_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "collab"."collab_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab"."collab_responses" ADD CONSTRAINT "collab_responses_responder_id_user_id_fk" FOREIGN KEY ("responder_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab"."collab_posts" ADD CONSTRAINT "collab_posts_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user"."linked_accounts" ADD CONSTRAINT "linked_accounts_profile_id_developer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "user"."developer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user"."user_notification_settings" ADD CONSTRAINT "user_notification_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."mutes" ADD CONSTRAINT "mutes_user_id_developer_profiles_discord_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."temporary_bans" ADD CONSTRAINT "temporary_bans_user_id_developer_profiles_discord_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."blocked_reporters" ADD CONSTRAINT "blocked_reporters_user_id_developer_profiles_discord_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."blocked_reporters" ADD CONSTRAINT "blocked_reporters_staff_member_id_developer_profiles_discord_id" FOREIGN KEY ("staff_member_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."alt_accounts" ADD CONSTRAINT "alt_accounts_alt_id_developer_profiles_discord_id_fk" FOREIGN KEY ("alt_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."alt_accounts" ADD CONSTRAINT "alt_accounts_staff_member_id_developer_profiles_discord_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hammer"."alt_accounts" ADD CONSTRAINT "alt_accounts_user_id_developer_profiles_discord_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles"("discord_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itch"."jam_entry_results" ADD CONSTRAINT "jam_entry_results_entry_id_jam_entries_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "itch"."jam_entries"("entry_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user"."notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "user"."notifications" USING btree ("user_id" timestamp_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "user"."notifications" USING btree ("user_id" timestamp_ops,"created_at" text_ops) WHERE (read_at IS NULL);
*/