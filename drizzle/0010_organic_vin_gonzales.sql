ALTER TABLE "user"."developer_profiles" ADD COLUMN "available_for_work" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user"."developer_profiles" ADD COLUMN "availability" text;--> statement-breakpoint
ALTER TABLE "user"."developer_profiles" ADD COLUMN "rate_type" text;--> statement-breakpoint
ALTER TABLE "user"."developer_profiles" ADD COLUMN "rate_min" integer;--> statement-breakpoint
ALTER TABLE "user"."developer_profiles" ADD COLUMN "rate_max" integer;