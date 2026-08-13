CREATE TABLE "hammer"."moderation_actions" (
	"id" bigserial PRIMARY KEY,
	"action" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"subject_user_id" text,
	"target_type" text NOT NULL,
	"target_id" text,
	"reason" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "moderation_actions_created_idx" ON "hammer"."moderation_actions" ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "moderation_actions_subject_idx" ON "hammer"."moderation_actions" ("subject_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "moderation_actions_actor_idx" ON "hammer"."moderation_actions" ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "moderation_actions_target_idx" ON "hammer"."moderation_actions" ("target_type","target_id");--> statement-breakpoint
ALTER TABLE "hammer"."moderation_actions" ADD CONSTRAINT "moderation_actions_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "hammer"."moderation_actions" ADD CONSTRAINT "moderation_actions_subject_user_id_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;