ALTER TABLE "user"."user_skills" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Nothing stopped the same skill being added twice, and the unique pair
-- below would refuse to be created over one. Keep the earliest row of each
-- pair: it is the one whose position the profile has been rendering.
DELETE FROM "user"."user_skills" us
USING "user"."user_skills" dup
WHERE us.user_id = dup.user_id
  AND us.skill_id = dup.skill_id
  AND us.id > dup.id;--> statement-breakpoint
-- Seed the order from the row ids, so every existing profile keeps the
-- sequence it happens to render today instead of being reshuffled by the
-- feature that gives it an order in the first place.
UPDATE "user"."user_skills" us
SET "sort_order" = ranked.position
FROM (
  SELECT id, (row_number() OVER (PARTITION BY user_id ORDER BY id)) - 1 AS position
  FROM "user"."user_skills"
) ranked
WHERE us.id = ranked.id;--> statement-breakpoint
ALTER TABLE "user"."user_skills" ADD CONSTRAINT "user_skills_user_skill_key" UNIQUE("user_id","skill_id");
