CREATE TYPE "user"."profile_project_source" AS ENUM('manual', 'itchio');--> statement-breakpoint
CREATE TYPE "user"."profile_project_type" AS ENUM('jam', 'game', 'audio', 'tool', 'app');--> statement-breakpoint
ALTER TABLE "user"."jam_participations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "user"."jam_participations" CASCADE;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" RENAME COLUMN "screenshot_url" TO "submission_url";--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ALTER COLUMN "source" SET DEFAULT 'manual'::"user"."profile_project_source";--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ALTER COLUMN "source" SET DATA TYPE "user"."profile_project_source" USING "source"::"user"."profile_project_source";--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN "type" "user"."profile_project_type" DEFAULT 'game' NOT NULL;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN "sub_types" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN "jam_name" text;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN "jam_url" text;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN "submission_title" text;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN "result" text;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN "team_members" text[];--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN "participated_at" timestamp;