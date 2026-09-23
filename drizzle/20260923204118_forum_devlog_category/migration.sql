-- "Devlog" is a post kind; a Devlogs category and a #devlog tag said the same
-- thing twice more. Devlogs now default to Show & Tell like any other post.
UPDATE "forum"."posts"
SET "category_id" = (SELECT "id" FROM "forum"."categories" WHERE "slug" = 'show-and-tell')
WHERE "category_id" = (SELECT "id" FROM "forum"."categories" WHERE "slug" = 'devlogs');
--> statement-breakpoint
DELETE FROM "forum"."categories" WHERE "slug" = 'devlogs';
--> statement-breakpoint
-- Reserved: banned tags are refused by the router and never suggested.
INSERT INTO "forum"."tags" ("slug", "name", "status") VALUES
  ('devlog', 'devlog', 'banned'),
  ('devlogs', 'devlogs', 'banned')
ON CONFLICT ("slug") DO UPDATE SET "status" = 'banned', "merged_into_id" = NULL;
--> statement-breakpoint
UPDATE "forum"."tags" SET "merged_into_id" = NULL
WHERE "merged_into_id" IN (SELECT "id" FROM "forum"."tags" WHERE "slug" IN ('devlog', 'devlogs'));
--> statement-breakpoint
DELETE FROM "forum"."post_tags"
WHERE "tag_id" IN (SELECT "id" FROM "forum"."tags" WHERE "slug" IN ('devlog', 'devlogs'));
--> statement-breakpoint
UPDATE "forum"."tags" SET "usage_count" = 0 WHERE "slug" IN ('devlog', 'devlogs');
