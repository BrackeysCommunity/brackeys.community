CREATE TABLE "social"."moderation_proposals" (
	"id" bigserial PRIMARY KEY,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"proposed_by_id" text,
	"proposed_by_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" text,
	"reviewed_at" timestamp,
	"review_note" text,
	"applied_previous" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_proposals_pending_unique" ON "social"."moderation_proposals" ("target_type","target_id","action") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "moderation_proposals_status_idx" ON "social"."moderation_proposals" ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "social"."moderation_proposals" ADD CONSTRAINT "moderation_proposals_proposed_by_id_user_id_fkey" FOREIGN KEY ("proposed_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social"."moderation_proposals" ADD CONSTRAINT "moderation_proposals_reviewed_by_id_user_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;