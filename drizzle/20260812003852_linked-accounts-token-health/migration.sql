ALTER TABLE "user"."linked_accounts" ADD COLUMN "provider_display_name" text;--> statement-breakpoint
ALTER TABLE "user"."linked_accounts" ADD COLUMN "token_invalid_at" timestamp;--> statement-breakpoint
ALTER TABLE "user"."linked_accounts" ADD COLUMN "last_synced_at" timestamp;