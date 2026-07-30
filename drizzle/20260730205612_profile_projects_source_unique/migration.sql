-- Dedupe any existing (profile_id, source, source_id) duplicates before the
-- unique index lands: keep the earliest row (created_at, then id as
-- tie-break) per group.
DELETE FROM "user"."profile_projects" p
WHERE p."source_id" IS NOT NULL
  AND p."id" NOT IN (
    SELECT DISTINCT ON ("profile_id", "source", "source_id") "id"
    FROM "user"."profile_projects"
    WHERE "source_id" IS NOT NULL
    ORDER BY "profile_id", "source", "source_id", "created_at" ASC, "id" ASC
  );
CREATE UNIQUE INDEX "profile_projects_source_unique" ON "user"."profile_projects" ("profile_id","source","source_id") WHERE "source_id" IS NOT NULL;