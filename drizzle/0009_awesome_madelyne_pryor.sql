ALTER TABLE "user"."profile_projects" ADD COLUMN IF NOT EXISTS "image_key" text;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN IF NOT EXISTS "image_filename" text;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN IF NOT EXISTS "image_mime_type" text;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN IF NOT EXISTS "image_size_bytes" integer;
