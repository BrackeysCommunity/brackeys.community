CREATE SCHEMA "team";
--> statement-breakpoint
CREATE TABLE "team"."team_invites" (
	"id" serial PRIMARY KEY,
	"team_id" text NOT NULL,
	"invitee_id" text NOT NULL,
	"invited_by" text NOT NULL,
	"source_response_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"responded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "team"."team_members" (
	"id" serial PRIMARY KEY,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"title" text,
	"sort_order" integer DEFAULT 0,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_unique" UNIQUE("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "team"."team_projects" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"type" "user"."profile_project_type" DEFAULT 'game'::"user"."profile_project_type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"url" text,
	"image_url" text,
	"image_key" text,
	"image_filename" text,
	"image_mime_type" text,
	"image_size_bytes" integer,
	"pinned" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"source" "user"."profile_project_source" DEFAULT 'manual'::"user"."profile_project_source" NOT NULL,
	"source_id" text,
	"source_profile_project_id" text,
	"jam_id" integer,
	"jam_name" text,
	"jam_url" text,
	"submission_url" text,
	"result" text,
	"participated_at" timestamp,
	"added_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team"."teams" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"tagline" text,
	"bio" text,
	"avatar_url" text,
	"avatar_key" text,
	"banner_url" text,
	"banner_key" text,
	"website_url" text,
	"itch_url" text,
	"recruiting" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collab"."collab_posts" ADD COLUMN "team_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "team_invites_pending_unique" ON "team"."team_invites" ("team_id","invitee_id") WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "collab"."collab_posts" ADD CONSTRAINT "collab_posts_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"."teams"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "team"."team_invites" ADD CONSTRAINT "team_invites_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"."teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team"."team_invites" ADD CONSTRAINT "team_invites_invitee_id_developer_profiles_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "user"."developer_profiles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team"."team_invites" ADD CONSTRAINT "team_invites_invited_by_user_id_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team"."team_invites" ADD CONSTRAINT "team_invites_source_response_id_collab_responses_id_fkey" FOREIGN KEY ("source_response_id") REFERENCES "collab"."collab_responses"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "team"."team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"."teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team"."team_members" ADD CONSTRAINT "team_members_user_id_developer_profiles_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team"."team_projects" ADD CONSTRAINT "team_projects_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"."teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team"."team_projects" ADD CONSTRAINT "team_projects_79i2sC4NkkIF_fkey" FOREIGN KEY ("source_profile_project_id") REFERENCES "user"."profile_projects"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "team"."team_projects" ADD CONSTRAINT "team_projects_jam_id_jams_jam_id_fkey" FOREIGN KEY ("jam_id") REFERENCES "itch"."jams"("jam_id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "team"."team_projects" ADD CONSTRAINT "team_projects_added_by_user_id_fkey" FOREIGN KEY ("added_by") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "team"."teams" ADD CONSTRAINT "teams_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."user"("id");