ALTER TABLE "team"."teams" ADD COLUMN "hidden_at" timestamp;--> statement-breakpoint
ALTER TABLE "team"."teams" ADD COLUMN "hidden_by_id" text;--> statement-breakpoint
ALTER TABLE "team"."teams" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
ALTER TABLE "team"."teams" ADD CONSTRAINT "teams_hidden_by_id_user_id_fkey" FOREIGN KEY ("hidden_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;