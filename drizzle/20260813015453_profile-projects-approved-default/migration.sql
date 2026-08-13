ALTER TABLE "user"."profile_projects" ALTER COLUMN "status" SET DEFAULT 'approved';
--> statement-breakpoint
-- Rows stuck on the old 'pending' default were invisible to every read
-- surface (all filter status = 'approved') with no approval path in
-- existence. The sync paths always wrote 'approved' explicitly, so pending
-- rows are exactly the manually-added ones the bug swallowed.
UPDATE "user"."profile_projects" SET "status" = 'approved' WHERE "status" = 'pending';
