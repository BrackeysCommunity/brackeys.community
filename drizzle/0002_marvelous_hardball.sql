ALTER TABLE "profile_projects" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "profile_projects" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;