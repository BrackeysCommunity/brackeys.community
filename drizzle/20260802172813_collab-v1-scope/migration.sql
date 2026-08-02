CREATE TABLE "collab"."collab_post_skills" (
	"id" serial PRIMARY KEY,
	"post_id" integer NOT NULL,
	"skill_id" integer NOT NULL,
	CONSTRAINT "collab_post_skills_post_id_skill_id_unique" UNIQUE("post_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "collab"."collab_posts" ADD COLUMN "jam_id" integer;--> statement-breakpoint
ALTER TABLE "collab"."collab_posts" ADD COLUMN "compensation_min" integer;--> statement-breakpoint
ALTER TABLE "collab"."collab_posts" ADD COLUMN "compensation_max" integer;--> statement-breakpoint
ALTER TABLE "user"."developer_profiles" ADD COLUMN "looking_for" text;--> statement-breakpoint
ALTER TABLE "user"."developer_profiles" ADD COLUMN "collab_preference" text;--> statement-breakpoint
ALTER TABLE "collab"."collab_posts" DROP COLUMN "subtype";--> statement-breakpoint
-- The unique below is a retrofit: (post_id, role_id) was never
-- constrained, so duplicate role links are possible in existing data and
-- would fail the ADD CONSTRAINT. Keep the lowest id of each pair.
DELETE FROM "collab"."collab_post_roles" a
  USING "collab"."collab_post_roles" b
  WHERE a."id" > b."id"
    AND a."post_id" = b."post_id"
    AND a."role_id" = b."role_id";--> statement-breakpoint
ALTER TABLE "collab"."collab_post_roles" ADD CONSTRAINT "collab_post_roles_post_id_role_id_unique" UNIQUE("post_id","role_id");--> statement-breakpoint
ALTER TABLE "collab"."collab_post_skills" ADD CONSTRAINT "collab_post_skills_post_id_collab_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "collab"."collab_posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collab"."collab_post_skills" ADD CONSTRAINT "collab_post_skills_skill_id_skills_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "user"."skills"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collab"."collab_posts" ADD CONSTRAINT "collab_posts_jam_id_jams_jam_id_fkey" FOREIGN KEY ("jam_id") REFERENCES "itch"."jams"("jam_id") ON DELETE SET NULL;