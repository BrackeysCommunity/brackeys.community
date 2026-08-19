ALTER TABLE "auth"."user" ADD COLUMN "banned_until" timestamp;--> statement-breakpoint
ALTER TABLE "auth"."user" ADD COLUMN "unbanned_at" timestamp;