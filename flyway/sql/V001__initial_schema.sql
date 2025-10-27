-- Initialize application database

-- Create extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create the collab schema
CREATE SCHEMA IF NOT EXISTS collab;

-- Set search path for this script
SET search_path TO collab, public;

CREATE TABLE collab.type (
    id INTEGER NOT NULL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255)
);

INSERT INTO collab.type (id, name, description) VALUES
    (1, 'Paid', 'Paid work opportunities'),
    (2, 'Hobby', 'Hobby project collaborations'),
    (3, 'Gametest', 'Game testing requests'),
    (4, 'Mentor', 'Mentoring relationships');

CREATE TABLE collab.status (
    id INTEGER NOT NULL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255)
);

INSERT INTO collab.status (id, name, description) VALUES
    (1, 'Draft', 'User is creating the collaboration'),
    (2, 'Active', 'Collaboration is actively posted'),
    (3, 'Filled', 'Collaboration position has been filled'),
    (4, 'Cancelled', 'Collaboration was cancelled'),
    (5, 'Expired', 'Collaboration has expired');

CREATE TABLE collab.hiring_status (
    id INTEGER NOT NULL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255)
);

INSERT INTO collab.hiring_status (id, name, description) VALUES
    (1, 'Looking', 'Looking for work/team/mentor'),
    (2, 'Offering', 'Offering work/looking for people/offering mentorship');

-- =====================================================
-- MAIN TABLES
-- =====================================================

CREATE TABLE collab.profile (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE, -- Discord user ID
    guild_id BIGINT NOT NULL,
    display_name VARCHAR(100) NULL,
    bio TEXT NULL,
    skills TEXT NULL,
    portfolio TEXT NULL,
    contact_preferences JSONB NULL DEFAULT '{}',
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active_at TIMESTAMP(6) NULL,
    -- Constraints
    CONSTRAINT valid_contact_preferences CHECK (jsonb_typeof(contact_preferences) = 'object')
);

-- Indexes for profile
CREATE INDEX idx_profile_user ON collab.profile(user_id);
CREATE INDEX idx_profile_guild ON collab.profile(guild_id);
CREATE INDEX idx_profile_active ON collab.profile(last_active_at) WHERE is_public = TRUE;
-- Trigram indexes for fuzzy search
CREATE INDEX idx_profile_display_name_trgm ON collab.profile USING GIN(display_name gin_trgm_ops);
CREATE INDEX idx_profile_bio_trgm ON collab.profile USING GIN(bio gin_trgm_ops);
CREATE INDEX idx_profile_skills_trgm ON collab.profile USING GIN(skills gin_trgm_ops);
CREATE INDEX idx_profile_portfolio_trgm ON collab.profile USING GIN(portfolio gin_trgm_ops);
CREATE INDEX idx_profile_contacts ON collab.profile USING GIN(contact_preferences);

CREATE TABLE collab.rule (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id BIGINT NOT NULL,
    rule_number INTEGER NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (guild_id, rule_number),
    CONSTRAINT positive_rule_number CHECK (rule_number > 0)
);

CREATE INDEX idx_rule_guild ON collab.rule(guild_id);
CREATE INDEX idx_rule_active ON collab.rule(is_active) WHERE is_active = TRUE;

CREATE TABLE collab.post (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id UUID NOT NULL,
    guild_id BIGINT NOT NULL,
    type_id INTEGER NOT NULL,
    hiring_status_id INTEGER NOT NULL,
    status_id INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    posted_at TIMESTAMP(6) NULL,
    expires_at TIMESTAMP(6) NULL,
    deleted_at TIMESTAMP(6) NULL, -- Soft delete
    discord_message_id BIGINT NULL,
    discord_channel_id BIGINT NULL,
    view_count INTEGER NOT NULL DEFAULT 0,
    response_count INTEGER NOT NULL DEFAULT 0,
    is_highlighted BOOLEAN NOT NULL DEFAULT FALSE,
    tags JSONB NULL DEFAULT '[]',
    -- Computed column for soft delete (this is immutable)
    is_deleted BOOLEAN GENERATED ALWAYS AS (
        CASE WHEN deleted_at IS NOT NULL THEN TRUE ELSE FALSE END
    ) STORED,

    FOREIGN KEY (profile_id) REFERENCES collab.profile(id),
    FOREIGN KEY (type_id) REFERENCES collab.type(id),
    FOREIGN KEY (hiring_status_id) REFERENCES collab.hiring_status(id),
    FOREIGN KEY (status_id) REFERENCES collab.status(id),
    -- Constraints
    CONSTRAINT valid_posted_before_expires CHECK (posted_at IS NULL OR expires_at IS NULL OR posted_at < expires_at),
    CONSTRAINT valid_tags_array CHECK (jsonb_typeof(tags) = 'array'),
    CONSTRAINT positive_counts CHECK (view_count >= 0 AND response_count >= 0)
);

-- Indexes for post
CREATE INDEX idx_post_profile ON collab.post(profile_id);
CREATE INDEX idx_post_guild ON collab.post(guild_id);
CREATE INDEX idx_post_status ON collab.post(status_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_post_type ON collab.post(type_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_post_created ON collab.post(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_post_expires ON collab.post(expires_at) WHERE deleted_at IS NULL AND expires_at IS NOT NULL;
CREATE INDEX idx_post_posted ON collab.post(posted_at DESC) WHERE deleted_at IS NULL AND posted_at IS NOT NULL;
CREATE INDEX idx_post_tags ON collab.post USING GIN(tags);
CREATE INDEX idx_post_active ON collab.post(status_id, deleted_at, expires_at) WHERE status_id = 2;

CREATE TABLE collab.field_definition (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    type_id INTEGER NOT NULL,
    hiring_status_id INTEGER NOT NULL,
    field_name VARCHAR(50) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    field_type VARCHAR(20) NOT NULL DEFAULT 'text',
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    field_order INTEGER NOT NULL DEFAULT 0,
    max_length INTEGER NULL,
    validation_regex VARCHAR(255) NULL,
    help_text VARCHAR(500) NULL,
    options JSONB NULL DEFAULT '[]',
    is_searchable BOOLEAN NOT NULL DEFAULT TRUE, -- For full-text search

    FOREIGN KEY (type_id) REFERENCES collab.type(id),
    FOREIGN KEY (hiring_status_id) REFERENCES collab.hiring_status(id),
    UNIQUE (type_id, hiring_status_id, field_name),
    CONSTRAINT valid_field_type CHECK (field_type IN ('text', 'textarea', 'url', 'multiselect', 'number', 'date')),
    CONSTRAINT valid_options_array CHECK (jsonb_typeof(options) = 'array')
);

CREATE INDEX idx_field_definition_type_hiring ON collab.field_definition(type_id, hiring_status_id);

CREATE TABLE collab.field_value (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    post_id UUID NOT NULL,
    field_definition_id UUID NOT NULL,
    value TEXT NOT NULL,

    FOREIGN KEY (post_id) REFERENCES collab.post(id) ON DELETE CASCADE,
    FOREIGN KEY (field_definition_id) REFERENCES collab.field_definition(id),
    UNIQUE (post_id, field_definition_id)
);

CREATE INDEX idx_field_value_post ON collab.field_value(post_id);
-- Trigram index for fuzzy search on field values
CREATE INDEX idx_field_value_trgm ON collab.field_value USING GIN(value gin_trgm_ops);

CREATE TABLE collab.response (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    post_id UUID NOT NULL,
    profile_id UUID NOT NULL,
    message TEXT NOT NULL,
    contact_info VARCHAR(255) NULL,
    is_public BOOLEAN NOT NULL DEFAULT FALSE, -- Private by default (only poster + replier can see)
    is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMP(6) NULL,

    FOREIGN KEY (post_id) REFERENCES collab.post(id) ON DELETE CASCADE,
    FOREIGN KEY (profile_id) REFERENCES collab.profile(id),
    CONSTRAINT valid_read_timestamp CHECK (NOT is_read OR read_at IS NOT NULL)
);

CREATE INDEX idx_response_post ON collab.response(post_id);
CREATE INDEX idx_response_profile ON collab.response(profile_id);
CREATE INDEX idx_response_created ON collab.response(created_at DESC);
CREATE INDEX idx_response_public ON collab.response(is_public, is_hidden) WHERE is_public = TRUE;
CREATE INDEX idx_response_unread ON collab.response(post_id, is_read) WHERE is_read = FALSE;

CREATE TABLE collab.blocked_user (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id UUID NOT NULL,
    guild_id BIGINT NOT NULL,
    blocked_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    blocked_by_staff_id BIGINT NOT NULL, -- Discord user ID
    reason VARCHAR(500) NULL,
    violated_rule_id UUID NULL,
    expires_at TIMESTAMP(6) NULL,

    FOREIGN KEY (profile_id) REFERENCES collab.profile(id),
    FOREIGN KEY (violated_rule_id) REFERENCES collab.rule(id),
    UNIQUE (profile_id, guild_id)
);

-- Index for finding active blocks (where expires_at is null or in the future)
CREATE INDEX idx_blocked_user_active ON collab.blocked_user(profile_id, guild_id, expires_at);
CREATE INDEX idx_blocked_user_expires ON collab.blocked_user(expires_at) WHERE expires_at IS NOT NULL;

-- Immutable audit log
CREATE TABLE collab.audit_log (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    post_id UUID NULL,
    profile_id UUID NULL,
    staff_member_id BIGINT NOT NULL, -- Discord user ID
    action VARCHAR(50) NOT NULL,
    reason VARCHAR(500) NULL,
    metadata JSONB NULL DEFAULT '{}',
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (post_id) REFERENCES collab.post(id) ON DELETE SET NULL,
    FOREIGN KEY (profile_id) REFERENCES collab.profile(id) ON DELETE SET NULL,
    CONSTRAINT valid_action CHECK (action IN ('delete_post', 'restore_post', 'edit_post', 'block_user', 'unblock_user', 'hide_response', 'unhide_response', 'highlight_post'))
);

-- No update trigger for audit log - it's immutable
CREATE INDEX idx_audit_log_post ON collab.audit_log(post_id);
CREATE INDEX idx_audit_log_profile ON collab.audit_log(profile_id);
CREATE INDEX idx_audit_log_staff ON collab.audit_log(staff_member_id);
CREATE INDEX idx_audit_log_created ON collab.audit_log(created_at DESC);
CREATE INDEX idx_audit_log_action ON collab.audit_log(action);

CREATE TABLE collab.report (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    post_id UUID NULL,
    response_id UUID NULL,
    reported_profile_id UUID NOT NULL,
    reported_by_profile_id UUID NOT NULL,
    reason VARCHAR(100) NOT NULL,
    details TEXT NULL,
    violated_rule_id UUID NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP(6) NULL,
    resolved_by_staff_id BIGINT NULL, -- Discord user ID
    resolution VARCHAR(500) NULL,

    FOREIGN KEY (post_id) REFERENCES collab.post(id) ON DELETE CASCADE,
    FOREIGN KEY (response_id) REFERENCES collab.response(id) ON DELETE CASCADE,
    FOREIGN KEY (reported_profile_id) REFERENCES collab.profile(id),
    FOREIGN KEY (reported_by_profile_id) REFERENCES collab.profile(id),
    FOREIGN KEY (violated_rule_id) REFERENCES collab.rule(id),
    CONSTRAINT either_post_or_response CHECK (
        (post_id IS NOT NULL AND response_id IS NULL) OR
        (post_id IS NULL AND response_id IS NOT NULL)
    ),
    CONSTRAINT valid_resolution CHECK (resolved_at IS NULL OR resolved_by_staff_id IS NOT NULL)
);

CREATE INDEX idx_report_post ON collab.report(post_id);
CREATE INDEX idx_report_response ON collab.report(response_id);
CREATE INDEX idx_report_created ON collab.report(created_at DESC);
CREATE INDEX idx_report_unresolved ON collab.report(resolved_at) WHERE resolved_at IS NULL;

CREATE TABLE collab.alert (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id UUID NOT NULL,
    guild_id BIGINT NOT NULL,
    name VARCHAR(100) NOT NULL,
    type_id INTEGER NULL,
    hiring_status_id INTEGER NULL,
    keywords TEXT NULL,
    tags JSONB NULL DEFAULT '[]',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_notified_at TIMESTAMP(6) NULL,

    FOREIGN KEY (profile_id) REFERENCES collab.profile(id),
    FOREIGN KEY (type_id) REFERENCES collab.type(id),
    FOREIGN KEY (hiring_status_id) REFERENCES collab.hiring_status(id),
    CONSTRAINT valid_alert_tags CHECK (jsonb_typeof(tags) = 'array')
);

CREATE INDEX idx_alert_profile ON collab.alert(profile_id);
CREATE INDEX idx_alert_active ON collab.alert(is_active, guild_id) WHERE is_active = TRUE;
CREATE INDEX idx_alert_tags ON collab.alert USING GIN(tags);

CREATE TABLE collab.bookmark (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id UUID NOT NULL,
    post_id UUID NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes TEXT NULL,

    FOREIGN KEY (profile_id) REFERENCES collab.profile(id),
    FOREIGN KEY (post_id) REFERENCES collab.post(id) ON DELETE CASCADE,
    UNIQUE (profile_id, post_id)
);

CREATE INDEX idx_bookmark_profile ON collab.bookmark(profile_id);
CREATE INDEX idx_bookmark_created ON collab.bookmark(created_at DESC);

-- =====================================================
-- TRIGGERS AND FUNCTIONS
-- =====================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION collab.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Prevent updates to audit log
CREATE OR REPLACE FUNCTION collab.prevent_audit_log_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit log entries cannot be modified';
END;
$$ language 'plpgsql';

-- Update response count on post
CREATE OR REPLACE FUNCTION collab.update_post_response_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE collab.post
        SET response_count = response_count + 1
        WHERE id = NEW.post_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE collab.post
        SET response_count = response_count - 1
        WHERE id = OLD.post_id;
    END IF;
    RETURN NULL;
END;
$$ language 'plpgsql';

-- Auto-expire posts
CREATE OR REPLACE FUNCTION collab.auto_expire_posts()
RETURNS void AS $$
BEGIN
    UPDATE collab.post
    SET status_id = 5 -- Expired status
    WHERE status_id = 2 -- Active status
    AND expires_at IS NOT NULL
    AND expires_at < CURRENT_TIMESTAMP
    AND deleted_at IS NULL;
END;
$$ language 'plpgsql';


-- Add triggers
CREATE TRIGGER update_profile_updated_at BEFORE UPDATE ON collab.profile FOR EACH ROW EXECUTE FUNCTION collab.update_updated_at_column();
CREATE TRIGGER update_rule_updated_at BEFORE UPDATE ON collab.rule FOR EACH ROW EXECUTE FUNCTION collab.update_updated_at_column();
CREATE TRIGGER update_post_updated_at BEFORE UPDATE ON collab.post FOR EACH ROW EXECUTE FUNCTION collab.update_updated_at_column();

CREATE TRIGGER prevent_audit_log_update_trigger BEFORE UPDATE ON collab.audit_log FOR EACH ROW EXECUTE FUNCTION collab.prevent_audit_log_update();

CREATE TRIGGER update_response_count_on_insert AFTER INSERT ON collab.response FOR EACH ROW EXECUTE FUNCTION collab.update_post_response_count();
CREATE TRIGGER update_response_count_on_delete AFTER DELETE ON collab.response FOR EACH ROW EXECUTE FUNCTION collab.update_post_response_count();

-- =====================================================
-- VIEWS FOR HASURA PERMISSIONS AND COMPUTED FIELDS
-- =====================================================

-- View for active posts with trigram search
CREATE VIEW collab.post_search AS
SELECT
    cp.*,
    -- Aggregate field values for search
    string_agg(cfv.value, ' ') AS field_values_text,
    -- Convert tags array to searchable text
    COALESCE(array_to_string(ARRAY(SELECT jsonb_array_elements_text(cp.tags)), ' '), '') AS tags_text,
    -- Profile info for easier queries
    profile.user_id AS author_user_id,
    profile.display_name AS author_display_name,
    profile.is_public AS author_is_public,
    -- Check if user is blocked
    EXISTS(
        SELECT 1 FROM collab.blocked_user cbu
        WHERE cbu.profile_id = cp.profile_id
        AND cbu.guild_id = cp.guild_id
        AND (cbu.expires_at IS NULL OR cbu.expires_at > CURRENT_TIMESTAMP)
    ) AS author_is_blocked
FROM collab.post cp
JOIN collab.profile profile ON cp.profile_id = profile.id
LEFT JOIN collab.field_value cfv ON cp.id = cfv.post_id
WHERE cp.deleted_at IS NULL
GROUP BY cp.id, profile.id, profile.user_id, profile.display_name, profile.is_public;

-- View for user's own data (for permission rules)
CREATE VIEW collab.my_data AS
SELECT
    -- Profile data
    profile.id AS profile_id,
    profile.user_id AS user_id,
    profile.guild_id AS guild_id,
    profile.is_public AS profile_is_public,
    -- Blocked status
    EXISTS(
        SELECT 1 FROM collab.blocked_user cbu
        WHERE cbu.profile_id = profile.id
        AND cbu.guild_id = profile.guild_id
        AND (cbu.expires_at IS NULL OR cbu.expires_at > CURRENT_TIMESTAMP)
    ) AS is_blocked,
    -- Post counts
    COUNT(DISTINCT posts.id) FILTER (WHERE posts.deleted_at IS NULL) AS total_posts,
    COUNT(DISTINCT posts.id) FILTER (WHERE posts.status_id = 2 AND posts.deleted_at IS NULL) AS active_posts,
    -- Response counts
    COUNT(DISTINCT responses.id) AS total_responses,
    COUNT(DISTINCT responses.id) FILTER (WHERE NOT responses.is_read) AS unread_responses
FROM collab.profile profile
LEFT JOIN collab.post posts ON profile.id = posts.profile_id
LEFT JOIN collab.response responses ON posts.id = responses.post_id
GROUP BY profile.id, profile.user_id, profile.guild_id, profile.is_public;

-- View for response visibility (handles private responses)
CREATE VIEW collab.response_visible AS
SELECT
    cr.*,
    cp.profile_id AS post_author_profile_id,
    profile.user_id AS post_author_user_id,
    responder.user_id AS responder_user_id
FROM collab.response cr
JOIN collab.post cp ON cr.post_id = cp.id
JOIN collab.profile profile ON cp.profile_id = profile.id
JOIN collab.profile responder ON cr.profile_id = responder.id;

-- =====================================================
-- FIELD DEFINITIONS (Same as before but with search flag)
-- =====================================================

-- Field definitions with searchable flag
INSERT INTO collab.field_definition (type_id, hiring_status_id, field_name, display_name, field_type, is_required, field_order, max_length, help_text, is_searchable) VALUES
-- Paid looking for work
(1, 1, 'roles', 'My Role(s)', 'text', TRUE, 1, 200, 'What is/are your role(s)?', TRUE),
(1, 1, 'skills', 'My Skills', 'textarea', TRUE, 2, 500, 'Which specific skills do you have? (e.g., Unity, C#, Photoshop)', TRUE),
(1, 1, 'portfolio', 'Portfolio/Previous Work', 'url', TRUE, 3, 1000, 'Please list any previous projects or portfolio if you have one. (N/A if none)', FALSE),
(1, 1, 'experience', 'Experience', 'text', TRUE, 4, 100, 'How much experience do you have in the field? (e.g., 2 Months, 5 Years)', TRUE),
(1, 1, 'description', 'Description', 'textarea', FALSE, 5, 2000, 'Add a description (Optional)', TRUE),
(1, 1, 'compensation', 'My Rates', 'text', TRUE, 6, 200, 'How much are your rates? (e.g., "$5/work done", "$10-30/h")', FALSE),

-- Paid looking to hire
(1, 2, 'project_name', 'Project Name', 'text', TRUE, 1, 200, 'What is the name of your project?', TRUE),
(1, 2, 'description', 'Project Description', 'textarea', TRUE, 2, 2000, 'Describe your project', TRUE),
(1, 2, 'roles', 'Roles Needed', 'textarea', TRUE, 3, 500, 'Which roles are you looking to hire?', TRUE),
(1, 2, 'portfolio', 'Portfolio/Previous Work', 'url', TRUE, 4, 1000, 'Please list any previous projects or portfolio if you have one. (N/A if none)', FALSE),
(1, 2, 'team_size', 'Current Team Size', 'text', TRUE, 5, 100, 'What is the current team size?', FALSE),
(1, 2, 'project_length', 'Project Length', 'text', TRUE, 6, 200, 'What is the project length? (specify if not strict)', FALSE),
(1, 2, 'compensation', 'Compensation', 'text', TRUE, 7, 200, 'What is the compensation? (e.g., "$5/work done", "$10-30/h")', FALSE),
(1, 2, 'responsibilities', 'Responsibilities', 'textarea', TRUE, 8, 1000, 'What specific responsibilities will the person being hired have?', TRUE),

-- Hobby looking for team
(2, 1, 'roles', 'My Role(s)', 'text', TRUE, 1, 200, 'What is/are your role(s)?', TRUE),
(2, 1, 'skills', 'My Skills', 'textarea', TRUE, 2, 500, 'Which specific skills do you have? (e.g., Unity, C#, Photoshop)', TRUE),
(2, 1, 'portfolio', 'Portfolio/Previous Work', 'textarea', TRUE, 3, 1000, 'Please list any previous projects or portfolio if you have one. (N/A if none)', FALSE),
(2, 1, 'experience', 'Experience', 'text', TRUE, 4, 100, 'How much experience do you have in the field? (e.g., 2 Months, 5 Years)', TRUE),
(2, 1, 'description', 'Description', 'textarea', TRUE, 5, 2000, 'Add a description', TRUE),

-- Hobby looking for people
(2, 2, 'project_name', 'Project Name', 'text', TRUE, 1, 200, 'What is the name of your project?', TRUE),
(2, 2, 'roles', 'Roles Needed', 'textarea', TRUE, 2, 500, 'Which roles are you looking for?', TRUE),
(2, 2, 'portfolio', 'Portfolio/Previous Work', 'textarea', TRUE, 3, 1000, 'Please list any previous projects or portfolio if you have one. (N/A if none)', FALSE),
(2, 2, 'team_size', 'Current Team Size', 'text', TRUE, 4, 100, 'What is the current team size?', FALSE),
(2, 2, 'project_length', 'Project Length', 'text', TRUE, 5, 200, 'What is the project length? (specify if not strict)', FALSE),
(2, 2, 'responsibilities', 'Responsibilities', 'textarea', TRUE, 6, 1000, 'What specific responsibilities will the person being hired have?', TRUE),
(2, 2, 'description', 'Game Description', 'textarea', TRUE, 7, 2000, 'Please describe your game', TRUE),

-- Gametest
(3, 2, 'project_name', 'Project Name', 'text', TRUE, 1, 200, 'What is the name of your project?', TRUE),
(3, 2, 'platforms', 'Platforms', 'text', TRUE, 2, 200, 'Which platform(s) is your game made for? (e.g., Windows, Android)', TRUE),
(3, 2, 'description', 'Game Description', 'textarea', TRUE, 3, 2000, 'Please describe your game', TRUE),
(3, 2, 'link', 'Download Link', 'text', FALSE, 4, 500, 'Provide a download link for your game (optional, reply with "-" if none)', FALSE),

-- Looking for mentor
(4, 1, 'areas_of_interest', 'Areas of Interest', 'textarea', TRUE, 1, 500, 'On which subjects are you interested in being mentored?', TRUE),
(4, 1, 'description', 'Description', 'textarea', TRUE, 2, 2000, 'Add a description', TRUE),
(4, 1, 'compensation', 'Willing to Pay', 'text', TRUE, 3, 200, 'How much are you willing to pay? (e.g., "Free", "$5/h", "$10-30/h")', FALSE),

-- Looking to mentor
(4, 2, 'areas_of_interest', 'Areas of Interest', 'textarea', TRUE, 1, 500, 'On which subjects are you interested in mentoring?', TRUE),
(4, 2, 'description', 'Description', 'textarea', TRUE, 2, 2000, 'Add a description', TRUE),
(4, 2, 'compensation', 'Rates', 'text', TRUE, 3, 200, 'How much are your rates? (e.g., "Free", "$5/h", "$10-30/h")', FALSE);

-- =====================================================
-- SCHEDULED JOBS (Run these with pg_cron or external scheduler)
-- =====================================================

-- Schedule this to run every hour
-- SELECT collab.auto_expire_posts();

