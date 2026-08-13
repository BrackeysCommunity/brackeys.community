ALTER TABLE "collab"."collab_post_reports" ADD COLUMN "resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "collab"."collab_post_reports" ADD COLUMN "resolved_by_id" text;--> statement-breakpoint
ALTER TABLE "auth"."user" ADD COLUMN "banned_at" timestamp;--> statement-breakpoint
ALTER TABLE "auth"."user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "auth"."user" ADD COLUMN "banned_by_id" text;--> statement-breakpoint
ALTER TABLE "collab"."collab_post_reports" ADD CONSTRAINT "collab_post_reports_resolved_by_id_user_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "auth"."user" ADD CONSTRAINT "user_banned_by_id_user_id_fkey" FOREIGN KEY ("banned_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;