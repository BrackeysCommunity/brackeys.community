ALTER TABLE "collab"."collab_posts" ADD COLUMN "compensation_type" text;--> statement-breakpoint
ALTER TABLE "collab"."collab_posts" ADD COLUMN "experience_level" text;--> statement-breakpoint
ALTER TABLE "collab"."collab_posts" ADD COLUMN "contact_type" text;--> statement-breakpoint
ALTER TABLE "collab"."collab_posts" ADD COLUMN "is_individual" boolean DEFAULT false;