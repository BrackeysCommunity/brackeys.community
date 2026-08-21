
DO $$
DECLARE c record;
BEGIN
  -- Staging's hammer tables predate drizzle (baselined), so FK names differ
  -- from the init migration's. Drop every hammer FK onto developer_profiles
  -- by catalog lookup instead of by name.
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'f'
      AND connamespace = 'hammer'::regnamespace
      AND confrelid = '"user".developer_profiles'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "hammer"."alt_accounts" ALTER COLUMN "registered_at" SET DATA TYPE timestamp with time zone USING "registered_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hammer"."blocked_reporters" ALTER COLUMN "blocked_at" SET DATA TYPE timestamp with time zone USING "blocked_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hammer"."deleted_messages" ALTER COLUMN "message_id" DROP DEFAULT;--> statement-breakpoint
DROP SEQUENCE IF EXISTS "hammer"."deleted_messages_message_id_seq";--> statement-breakpoint
ALTER TABLE "hammer"."deleted_messages" ALTER COLUMN "message_id" SET DATA TYPE text USING "message_id"::text;--> statement-breakpoint
ALTER TABLE "hammer"."deleted_messages" ALTER COLUMN "creation_timestamp" SET DATA TYPE timestamp with time zone USING "creation_timestamp"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hammer"."deleted_messages" ALTER COLUMN "deletion_timestamp" SET DATA TYPE timestamp with time zone USING "deletion_timestamp"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hammer"."infractions" ALTER COLUMN "issued_at" SET DATA TYPE timestamp with time zone USING "issued_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hammer"."infractions" ALTER COLUMN "rule_id" SET DATA TYPE integer USING "rule_id"::integer;--> statement-breakpoint
ALTER TABLE "hammer"."member_notes" ALTER COLUMN "creation_timestamp" SET DATA TYPE timestamp with time zone USING "creation_timestamp"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hammer"."mutes" ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone USING "expires_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hammer"."rules" ALTER COLUMN "id" SET DATA TYPE integer USING "id"::integer;--> statement-breakpoint
ALTER TABLE "hammer"."staff_messages" ALTER COLUMN "sent_at" SET DATA TYPE timestamp with time zone USING "sent_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hammer"."temporary_bans" ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone USING "expires_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hammer"."tracked_messages" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
DROP SEQUENCE IF EXISTS "hammer"."tracked_messages_id_seq";--> statement-breakpoint
ALTER TABLE "hammer"."tracked_messages" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "hammer"."tracked_messages" ALTER COLUMN "creation_timestamp" SET DATA TYPE timestamp with time zone USING "creation_timestamp"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hammer"."tracked_messages" ALTER COLUMN "deletion_timestamp" SET DATA TYPE timestamp with time zone USING "deletion_timestamp"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hammer"."tracked_messages" ALTER COLUMN "is_deleted" SET DATA TYPE boolean USING "is_deleted"::boolean;--> statement-breakpoint
ALTER TABLE "hammer"."tracked_messages" ALTER COLUMN "is_deleted" SET DEFAULT false;--> statement-breakpoint
CREATE INDEX "infractions_user_idx" ON "hammer"."infractions" ("user_id","issued_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "member_notes_user_idx" ON "hammer"."member_notes" ("user_id");--> statement-breakpoint
ALTER TABLE "hammer"."deleted_messages" ALTER COLUMN "attachments" SET DATA TYPE text[] USING ARRAY["attachments"];--> statement-breakpoint
ALTER TABLE "hammer"."reported_messages" ALTER COLUMN "attachments" SET DATA TYPE text[] USING ARRAY["attachments"];--> statement-breakpoint
ALTER TABLE "hammer"."tracked_messages" ALTER COLUMN "attachments" SET DATA TYPE text[] USING ARRAY["attachments"];
