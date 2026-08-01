ALTER TYPE "user"."profile_project_source" ADD VALUE 'itchio-jam';--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN "jam_id" integer;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD CONSTRAINT "profile_projects_jam_id_jams_jam_id_fkey" FOREIGN KEY ("jam_id") REFERENCES "itch"."jams"("jam_id") ON DELETE SET NULL;