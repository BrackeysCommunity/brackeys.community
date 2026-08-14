ALTER TABLE "team"."team_members" ADD COLUMN "source_response_id" integer;--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team"."team_members" ("user_id");--> statement-breakpoint
ALTER TABLE "team"."team_members" ADD CONSTRAINT "team_members_source_response_id_collab_responses_id_fkey" FOREIGN KEY ("source_response_id") REFERENCES "collab"."collab_responses"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Hand-added: backfill provenance for matches that already happened. The
-- accepted invite still carries the response it came from, so every roster
-- seat it produced can be reconstructed exactly. Without this, COLLABS reads
-- 0 for everyone until the next accept, which makes a live number look broken.
UPDATE "team"."team_members" m
SET "source_response_id" = i."source_response_id"
FROM "team"."team_invites" i
WHERE i."team_id" = m."team_id"
  AND i."invitee_id" = m."user_id"
  AND i."status" = 'accepted'
  AND i."source_response_id" IS NOT NULL
  AND m."source_response_id" IS NULL;