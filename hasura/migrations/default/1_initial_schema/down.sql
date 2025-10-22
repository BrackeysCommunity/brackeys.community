-- Drop all objects in reverse order of creation

-- Drop scheduled jobs (if using pg_cron, these would need to be dropped separately)

-- Drop field definitions
DELETE FROM collab.field_definition;

-- Drop views
DROP VIEW IF EXISTS collab.response_visible;
DROP VIEW IF EXISTS collab.my_data;
DROP VIEW IF EXISTS collab.post_search;

-- Drop triggers
DROP TRIGGER IF EXISTS update_response_count_on_delete ON collab.response;
DROP TRIGGER IF EXISTS update_response_count_on_insert ON collab.response;
DROP TRIGGER IF EXISTS prevent_audit_log_update_trigger ON collab.audit_log;
DROP TRIGGER IF EXISTS update_post_updated_at ON collab.post;
DROP TRIGGER IF EXISTS update_rule_updated_at ON collab.rule;
DROP TRIGGER IF EXISTS update_profile_updated_at ON collab.profile;

-- Drop functions
DROP FUNCTION IF EXISTS collab.auto_expire_posts();
DROP FUNCTION IF EXISTS collab.update_post_response_count();
DROP FUNCTION IF EXISTS collab.prevent_audit_log_update();
DROP FUNCTION IF EXISTS collab.update_updated_at_column();

-- Drop tables
DROP TABLE IF EXISTS collab.bookmark;
DROP TABLE IF EXISTS collab.alert;
DROP TABLE IF EXISTS collab.report;
DROP TABLE IF EXISTS collab.audit_log;
DROP TABLE IF EXISTS collab.blocked_user;
DROP TABLE IF EXISTS collab.response;
DROP TABLE IF EXISTS collab.field_value;
DROP TABLE IF EXISTS collab.field_definition;
DROP TABLE IF EXISTS collab.post;
DROP TABLE IF EXISTS collab.rule;
DROP TABLE IF EXISTS collab.profile;

-- Drop lookup tables
DROP TABLE IF EXISTS collab.hiring_status;
DROP TABLE IF EXISTS collab.status;
DROP TABLE IF EXISTS collab.type;

-- Drop collab schema
DROP SCHEMA IF EXISTS collab CASCADE;

-- Drop users tables
DROP TRIGGER IF EXISTS update_users_updated_at ON users.user;
DROP FUNCTION IF EXISTS users.update_updated_at_column();
DROP INDEX IF EXISTS idx_user_roles_user_id;
DROP INDEX IF EXISTS idx_users_email;
DROP INDEX IF EXISTS idx_users_discord_id;
DROP INDEX IF EXISTS idx_users_ory_identity_id;

-- Drop extensions
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS pgcrypto;
