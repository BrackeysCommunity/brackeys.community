ALTER TABLE "user"."developer_profiles" ADD COLUMN "website_verification_token" text;--> statement-breakpoint
ALTER TABLE "user"."developer_profiles" ADD COLUMN "website_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "user"."developer_profiles" ADD COLUMN "website_verified_host" text;