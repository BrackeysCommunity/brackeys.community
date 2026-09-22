ALTER TABLE "user"."developer_profiles" ADD COLUMN "name_glow_colors" text[];--> statement-breakpoint
-- Carry the single-colour picks across rather than dropping them: the column
-- shipped before the glow became a gradient, and a one-stop list renders the
-- same flat colour it did.
UPDATE "user"."developer_profiles" SET "name_glow_colors" = ARRAY["name_glow_color"] WHERE "name_glow_color" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "user"."developer_profiles" DROP COLUMN "name_glow_color";
