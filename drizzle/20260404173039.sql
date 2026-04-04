-- Modify "rules" table
ALTER TABLE "hammer"."rules" ALTER COLUMN "guild_id" TYPE text, ALTER COLUMN "id" TYPE text;
-- Modify "alt_accounts" table
ALTER TABLE "hammer"."alt_accounts" ALTER COLUMN "user_id" TYPE text, ALTER COLUMN "alt_id" TYPE text, ALTER COLUMN "staff_member_id" TYPE text, ADD CONSTRAINT "alt_accounts_alt_id_developer_profiles_discord_id_fk" FOREIGN KEY ("alt_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION, ADD CONSTRAINT "alt_accounts_staff_member_id_developer_profiles_discord_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION, ADD CONSTRAINT "alt_accounts_user_id_developer_profiles_discord_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- Modify "blocked_reporters" table
ALTER TABLE "hammer"."blocked_reporters" ALTER COLUMN "guild_id" TYPE text, ALTER COLUMN "user_id" TYPE text, ALTER COLUMN "staff_member_id" TYPE text, ADD CONSTRAINT "blocked_reporters_staff_member_id_developer_profiles_discord_id" FOREIGN KEY ("staff_member_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION, ADD CONSTRAINT "blocked_reporters_user_id_developer_profiles_discord_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- Modify "deleted_messages" table
ALTER TABLE "hammer"."deleted_messages" ALTER COLUMN "author_id" TYPE text, ALTER COLUMN "channel_id" TYPE text, ALTER COLUMN "guild_id" TYPE text, ALTER COLUMN "staff_member_id" TYPE text, ADD CONSTRAINT "deleted_messages_author_id_developer_profiles_discord_id_fk" FOREIGN KEY ("author_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION, ADD CONSTRAINT "deleted_messages_staff_member_id_developer_profiles_discord_id_" FOREIGN KEY ("staff_member_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- Modify "infractions" table
ALTER TABLE "hammer"."infractions" ALTER COLUMN "guild_id" TYPE text, ALTER COLUMN "rule_id" TYPE text, ALTER COLUMN "staff_member_id" TYPE text, ALTER COLUMN "user_id" TYPE text, ADD CONSTRAINT "infractions_staff_member_id_developer_profiles_discord_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION, ADD CONSTRAINT "infractions_user_id_developer_profiles_discord_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- Modify "member_notes" table
ALTER TABLE "hammer"."member_notes" ALTER COLUMN "author_id" TYPE text, ALTER COLUMN "guild_id" TYPE text, ALTER COLUMN "user_id" TYPE text, ADD CONSTRAINT "member_notes_author_id_developer_profiles_discord_id_fk" FOREIGN KEY ("author_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION, ADD CONSTRAINT "member_notes_user_id_developer_profiles_discord_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- Modify "mutes" table
ALTER TABLE "hammer"."mutes" ALTER COLUMN "guild_id" TYPE text, ALTER COLUMN "user_id" TYPE text, ADD CONSTRAINT "mutes_user_id_developer_profiles_discord_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- Modify "reported_messages" table
ALTER TABLE "hammer"."reported_messages" ALTER COLUMN "author_id" TYPE text, ALTER COLUMN "channel_id" TYPE text, ALTER COLUMN "guild_id" TYPE text, ALTER COLUMN "message_id" TYPE text, ALTER COLUMN "reporter_id" TYPE text, ADD CONSTRAINT "reported_messages_author_id_developer_profiles_discord_id_fk" FOREIGN KEY ("author_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION, ADD CONSTRAINT "reported_messages_reporter_id_developer_profiles_discord_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- Modify "staff_messages" table
ALTER TABLE "hammer"."staff_messages" ALTER COLUMN "guild_id" TYPE text, ALTER COLUMN "recipient_id" TYPE text, ALTER COLUMN "staff_member_id" TYPE text, ADD CONSTRAINT "staff_messages_recipient_id_developer_profiles_discord_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION, ADD CONSTRAINT "staff_messages_staff_member_id_developer_profiles_discord_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- Modify "temporary_bans" table
ALTER TABLE "hammer"."temporary_bans" ALTER COLUMN "guild_id" TYPE text, ALTER COLUMN "user_id" TYPE text, ADD CONSTRAINT "temporary_bans_user_id_developer_profiles_discord_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- Modify "tracked_messages" table
ALTER TABLE "hammer"."tracked_messages" ALTER COLUMN "author_id" TYPE text, ALTER COLUMN "channel_id" TYPE text, ALTER COLUMN "guild_id" TYPE text, ADD CONSTRAINT "tracked_messages_author_id_developer_profiles_discord_id_fk" FOREIGN KEY ("author_id") REFERENCES "user"."developer_profiles" ("discord_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- Drop orphaned sequence from 0008 migration (id changed to text but sequence was never dropped)
DROP SEQUENCE IF EXISTS "user"."profile_projects_id_seq" CASCADE;
-- Create function to ensure a developer profile exists for a Discord ID
CREATE OR REPLACE FUNCTION hammer.ensure_developer_profile()
RETURNS TRIGGER AS $$
DECLARE
  col text;
  discord_id text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV
  LOOP
    EXECUTE format('SELECT ($1).%I', col) INTO discord_id USING NEW;
    IF discord_id IS NOT NULL THEN
      INSERT INTO "user".developer_profiles (id, discord_id, created_at, updated_at)
      VALUES (gen_random_uuid()::text, discord_id, now(), now())
      ON CONFLICT (discord_id) DO NOTHING;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Add triggers to hammer tables
CREATE TRIGGER ensure_profile_alt_accounts BEFORE INSERT ON hammer.alt_accounts
  FOR EACH ROW EXECUTE FUNCTION hammer.ensure_developer_profile('user_id', 'alt_id', 'staff_member_id');
CREATE TRIGGER ensure_profile_blocked_reporters BEFORE INSERT ON hammer.blocked_reporters
  FOR EACH ROW EXECUTE FUNCTION hammer.ensure_developer_profile('user_id', 'staff_member_id');
CREATE TRIGGER ensure_profile_deleted_messages BEFORE INSERT ON hammer.deleted_messages
  FOR EACH ROW EXECUTE FUNCTION hammer.ensure_developer_profile('author_id', 'staff_member_id');
CREATE TRIGGER ensure_profile_infractions BEFORE INSERT ON hammer.infractions
  FOR EACH ROW EXECUTE FUNCTION hammer.ensure_developer_profile('user_id', 'staff_member_id');
CREATE TRIGGER ensure_profile_member_notes BEFORE INSERT ON hammer.member_notes
  FOR EACH ROW EXECUTE FUNCTION hammer.ensure_developer_profile('author_id', 'user_id');
CREATE TRIGGER ensure_profile_mutes BEFORE INSERT ON hammer.mutes
  FOR EACH ROW EXECUTE FUNCTION hammer.ensure_developer_profile('user_id');
CREATE TRIGGER ensure_profile_reported_messages BEFORE INSERT ON hammer.reported_messages
  FOR EACH ROW EXECUTE FUNCTION hammer.ensure_developer_profile('author_id', 'reporter_id');
CREATE TRIGGER ensure_profile_staff_messages BEFORE INSERT ON hammer.staff_messages
  FOR EACH ROW EXECUTE FUNCTION hammer.ensure_developer_profile('recipient_id', 'staff_member_id');
CREATE TRIGGER ensure_profile_temporary_bans BEFORE INSERT ON hammer.temporary_bans
  FOR EACH ROW EXECUTE FUNCTION hammer.ensure_developer_profile('user_id');
CREATE TRIGGER ensure_profile_tracked_messages BEFORE INSERT ON hammer.tracked_messages
  FOR EACH ROW EXECUTE FUNCTION hammer.ensure_developer_profile('author_id');
