CREATE TABLE "team"."team_reports" (
	"id" bigserial PRIMARY KEY,
	"team_id" text,
	"team_name" text NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_id" text
);
--> statement-breakpoint
ALTER TABLE "team"."team_reports" ADD CONSTRAINT "team_reports_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"."teams"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "team"."team_reports" ADD CONSTRAINT "team_reports_reporter_id_user_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team"."team_reports" ADD CONSTRAINT "team_reports_resolved_by_id_user_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;