ALTER TABLE "user"."linked_accounts" ADD COLUMN "provider_raw" jsonb;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN "missing_since" timestamp;--> statement-breakpoint
ALTER TABLE "project"."projects" ADD COLUMN "platforms" text[];--> statement-breakpoint
ALTER TABLE "project"."projects" ADD COLUMN "provider_stats" jsonb;--> statement-breakpoint
ALTER TABLE "project"."projects" ADD COLUMN "provider_raw" jsonb;