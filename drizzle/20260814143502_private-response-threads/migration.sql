-- The `"subject_type"::text` casts in the last statement are required, not
-- stylistic. Drizzle's migrator runs every pending migration in ONE
-- transaction, and Postgres rejects any use of an enum value added earlier in
-- that same transaction (55P04, "New enum values must be committed before they
-- can be used"). Comparing the column as text means the literal below is never
-- resolved as an enum value, so the ADD VALUE and the CHECK can ship together.
-- Rewriting them as bare enum comparisons reproduces the failure.
ALTER TYPE "social"."thread_subject_type" ADD VALUE 'collab_response';--> statement-breakpoint
ALTER TABLE "social"."threads" ADD COLUMN "collab_response_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "threads_collab_response_uq" ON "social"."threads" ("collab_response_id") WHERE "collab_response_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "social"."threads" ADD CONSTRAINT "threads_collab_response_id_collab_responses_id_fkey" FOREIGN KEY ("collab_response_id") REFERENCES "collab"."collab_responses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social"."threads" DROP CONSTRAINT "threads_one_subject", ADD CONSTRAINT "threads_one_subject" CHECK (num_nonnulls("collab_post_id", "profile_user_id", "collab_response_id") = 1);--> statement-breakpoint
ALTER TABLE "social"."threads" DROP CONSTRAINT "threads_subject_type_matches", ADD CONSTRAINT "threads_subject_type_matches" CHECK (("subject_type"::text = 'collab_post') = ("collab_post_id" IS NOT NULL)
      AND ("subject_type"::text = 'profile') = ("profile_user_id" IS NOT NULL)
      AND ("subject_type"::text = 'collab_response') = ("collab_response_id" IS NOT NULL));