CREATE TABLE "team"."team_project_credits" (
	"id" serial PRIMARY KEY,
	"project_id" text NOT NULL,
	"profile_id" text,
	"display_name" text NOT NULL,
	"role" text,
	"sort_order" integer DEFAULT 0,
	"added_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collab"."collab_posts" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "collab"."collab_posts" ADD COLUMN "expiry_notified_at" timestamp;--> statement-breakpoint
ALTER TABLE "team"."team_projects" ADD COLUMN "released_at" timestamp;--> statement-breakpoint
ALTER TABLE "team"."teams" ADD COLUMN "last_activity_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "team"."teams" ADD COLUMN "archive_warned_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "team_project_credits_profile_unique" ON "team"."team_project_credits" ("project_id","profile_id") WHERE "profile_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "team"."team_project_credits" ADD CONSTRAINT "team_project_credits_project_id_team_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "team"."team_projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team"."team_project_credits" ADD CONSTRAINT "team_project_credits_profile_id_developer_profiles_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "user"."developer_profiles"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "team"."team_project_credits" ADD CONSTRAINT "team_project_credits_added_by_user_id_fkey" FOREIGN KEY ("added_by") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Backfill: live recruiting posts start a full default expiry window.
UPDATE "collab"."collab_posts" SET "expires_at" = now() + interval '45 days' WHERE "status" = 'recruiting';--> statement-breakpoint
-- Backfill: v1 teams start their quiet-period clock at last update.
UPDATE "team"."teams" SET "last_activity_at" = "updated_at";