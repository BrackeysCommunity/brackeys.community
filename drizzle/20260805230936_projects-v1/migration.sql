CREATE SCHEMA "project";
--> statement-breakpoint
CREATE TABLE "project"."project_contributors" (
	"id" serial PRIMARY KEY,
	"project_id" text NOT NULL,
	"profile_id" text,
	"display_name" text NOT NULL,
	"role" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project"."project_jam_links" (
	"id" serial PRIMARY KEY,
	"project_id" text NOT NULL,
	"jam_id" integer,
	"jam_name" text,
	"jam_url" text,
	"submission_url" text,
	"result" text,
	"participated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project"."project_teams" (
	"id" serial PRIMARY KEY,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_teams_project_id_team_id_unique" UNIQUE("project_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "project"."projects" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"title" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'game' NOT NULL,
	"sub_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"classification" text,
	"embed_type" text,
	"release_status" text,
	"url" text,
	"links" jsonb DEFAULT '[]' NOT NULL,
	"image_url" text,
	"image_key" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_game_id" bigint,
	"published" boolean DEFAULT true NOT NULL,
	"restricted_at" timestamp,
	"released_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "team"."team_project_credits";--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "team"."team_projects" ADD COLUMN "project_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "project_contributors_profile_unique" ON "project"."project_contributors" ("project_id","profile_id") WHERE "profile_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "project_contributors_profile_idx" ON "project"."project_contributors" ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_jam_links_jam_unique" ON "project"."project_jam_links" ("project_id","jam_id") WHERE "jam_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_source_game_unique" ON "project"."projects" ("source_game_id") WHERE "source_game_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD CONSTRAINT "profile_projects_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"."projects"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "project"."project_contributors" ADD CONSTRAINT "project_contributors_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"."projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project"."project_contributors" ADD CONSTRAINT "project_contributors_profile_id_developer_profiles_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "user"."developer_profiles"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "project"."project_jam_links" ADD CONSTRAINT "project_jam_links_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"."projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project"."project_jam_links" ADD CONSTRAINT "project_jam_links_jam_id_jams_jam_id_fkey" FOREIGN KEY ("jam_id") REFERENCES "itch"."jams"("jam_id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "project"."project_teams" ADD CONSTRAINT "project_teams_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"."projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project"."project_teams" ADD CONSTRAINT "project_teams_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"."teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project"."projects" ADD CONSTRAINT "projects_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "team"."team_projects" ADD CONSTRAINT "team_projects_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"."projects"("id") ON DELETE SET NULL;