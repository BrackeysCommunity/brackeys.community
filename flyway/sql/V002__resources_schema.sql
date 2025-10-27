-- Resources management schema
-- This migration creates tables for community resources (games and tools)

-- Create the resources schema
CREATE SCHEMA IF NOT EXISTS resources;

-- Set search path for this script
SET search_path TO resources, public;

-- =====================================================
-- LOOKUP TABLES
-- =====================================================

-- Resource types (game or tool)
CREATE TABLE resources.type (
    id INTEGER NOT NULL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255)
);

INSERT INTO resources.type (id, name, description) VALUES
    (1, 'game', 'Games made by the community'),
    (2, 'tool', 'Development tools and resources');

-- Resource categories (genres for games, categories for tools)
CREATE TABLE resources.category (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    slug VARCHAR(50) NOT NULL UNIQUE,
    label VARCHAR(100) NOT NULL,
    type_id INTEGER NOT NULL,
    icon_name VARCHAR(50) NULL, -- Lucide icon name
    color_class VARCHAR(100) NULL, -- Tailwind color class
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (type_id) REFERENCES resources.type(id)
);

CREATE INDEX idx_category_type ON resources.category(type_id);
CREATE INDEX idx_category_slug ON resources.category(slug);

-- Resource tags
CREATE TABLE resources.tag (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    slug VARCHAR(50) NOT NULL UNIQUE,
    label VARCHAR(100) NOT NULL,
    icon_name VARCHAR(50) NULL, -- Lucide icon name
    color_class VARCHAR(100) NULL, -- Tailwind color class
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tag_slug ON resources.tag(slug);

-- =====================================================
-- MAIN TABLES
-- =====================================================

-- Main resources table
CREATE TABLE resources.resource (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    image_url VARCHAR(1000) NULL,
    type_id INTEGER NOT NULL,
    resource_url VARCHAR(1000) NOT NULL, -- External URL or internal path
    release_date DATE NULL,
    developer VARCHAR(200) NULL,
    developer_url VARCHAR(1000) NULL,
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    view_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_by_user_id BIGINT NULL, -- Discord user ID, NULL for seed data

    FOREIGN KEY (type_id) REFERENCES resources.type(id),
    CONSTRAINT positive_view_count CHECK (view_count >= 0)
);

CREATE INDEX idx_resource_type ON resources.resource(type_id);
CREATE INDEX idx_resource_published ON resources.resource(is_published) WHERE is_published = TRUE;
CREATE INDEX idx_resource_created ON resources.resource(created_at DESC);
CREATE INDEX idx_resource_submitter ON resources.resource(submitted_by_user_id);
-- Full-text search indexes
CREATE INDEX idx_resource_title_trgm ON resources.resource USING GIN(title gin_trgm_ops);
CREATE INDEX idx_resource_description_trgm ON resources.resource USING GIN(description gin_trgm_ops);
CREATE INDEX idx_resource_developer_trgm ON resources.resource USING GIN(developer gin_trgm_ops);

-- Resource submissions (user-submitted resources awaiting approval)
CREATE TABLE resources.submission (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    image_url VARCHAR(1000) NULL,
    type_id INTEGER NOT NULL,
    resource_url VARCHAR(1000) NOT NULL,
    release_date DATE NULL,
    developer VARCHAR(200) NULL,
    developer_url VARCHAR(1000) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    submitted_by_user_id BIGINT NOT NULL, -- Discord user ID
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMPTZ NULL,
    reviewed_by_user_id BIGINT NULL, -- Discord user ID of admin who reviewed
    rejection_reason TEXT NULL,
    approved_resource_id UUID NULL, -- Links to resource if approved

    FOREIGN KEY (type_id) REFERENCES resources.type(id),
    FOREIGN KEY (approved_resource_id) REFERENCES resources.resource(id) ON DELETE SET NULL,
    CONSTRAINT valid_status CHECK (status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT reviewed_has_reviewer CHECK (reviewed_at IS NULL OR reviewed_by_user_id IS NOT NULL),
    CONSTRAINT rejected_has_reason CHECK (status != 'rejected' OR rejection_reason IS NOT NULL)
);

CREATE INDEX idx_submission_status ON resources.submission(status);
CREATE INDEX idx_submission_submitter ON resources.submission(submitted_by_user_id);
CREATE INDEX idx_submission_reviewer ON resources.submission(reviewed_by_user_id);
CREATE INDEX idx_submission_created ON resources.submission(created_at DESC);
CREATE INDEX idx_submission_pending ON resources.submission(created_at DESC) WHERE status = 'pending';

-- =====================================================
-- JUNCTION TABLES (Many-to-Many)
-- =====================================================

-- Resource to categories (many-to-many)
CREATE TABLE resources.resource_categories (
    resource_id UUID NOT NULL,
    category_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (resource_id, category_id),
    FOREIGN KEY (resource_id) REFERENCES resources.resource(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES resources.category(id) ON DELETE CASCADE
);

CREATE INDEX idx_resource_categories_resource ON resources.resource_categories(resource_id);
CREATE INDEX idx_resource_categories_category ON resources.resource_categories(category_id);

-- Resource to tags (many-to-many)
CREATE TABLE resources.resource_tags (
    resource_id UUID NOT NULL,
    tag_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (resource_id, tag_id),
    FOREIGN KEY (resource_id) REFERENCES resources.resource(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES resources.tag(id) ON DELETE CASCADE
);

CREATE INDEX idx_resource_tags_resource ON resources.resource_tags(resource_id);
CREATE INDEX idx_resource_tags_tag ON resources.resource_tags(tag_id);

-- Submission to categories (many-to-many)
CREATE TABLE resources.submission_categories (
    submission_id UUID NOT NULL,
    category_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (submission_id, category_id),
    FOREIGN KEY (submission_id) REFERENCES resources.submission(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES resources.category(id) ON DELETE CASCADE
);

CREATE INDEX idx_submission_categories_submission ON resources.submission_categories(submission_id);
CREATE INDEX idx_submission_categories_category ON resources.submission_categories(category_id);

-- Submission to tags (many-to-many)
CREATE TABLE resources.submission_tags (
    submission_id UUID NOT NULL,
    tag_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (submission_id, tag_id),
    FOREIGN KEY (submission_id) REFERENCES resources.submission(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES resources.tag(id) ON DELETE CASCADE
);

CREATE INDEX idx_submission_tags_submission ON resources.submission_tags(submission_id);
CREATE INDEX idx_submission_tags_tag ON resources.submission_tags(tag_id);

-- =====================================================
-- TRIGGERS AND FUNCTIONS
-- =====================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION resources.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Increment view count
CREATE OR REPLACE FUNCTION resources.increment_view_count(resource_uuid UUID)
RETURNS void AS $$
BEGIN
    UPDATE resources.resource
    SET view_count = view_count + 1
    WHERE id = resource_uuid AND is_published = TRUE;
END;
$$ language 'plpgsql';

-- Add triggers
CREATE TRIGGER update_resource_updated_at BEFORE UPDATE ON resources.resource FOR EACH ROW EXECUTE FUNCTION resources.update_updated_at_column();
CREATE TRIGGER update_submission_updated_at BEFORE UPDATE ON resources.submission FOR EACH ROW EXECUTE FUNCTION resources.update_updated_at_column();

-- =====================================================
-- VIEWS FOR QUERIES
-- =====================================================

-- View for resources with aggregated categories and tags
CREATE VIEW resources.resource_detail AS
SELECT
    r.*,
    -- Aggregate categories
    COALESCE(
        json_agg(DISTINCT jsonb_build_object(
            'id', c.id,
            'slug', c.slug,
            'label', c.label,
            'icon_name', c.icon_name,
            'color_class', c.color_class
        )) FILTER (WHERE c.id IS NOT NULL),
        '[]'::json
    ) AS categories,
    -- Aggregate tags
    COALESCE(
        json_agg(DISTINCT jsonb_build_object(
            'id', t.id,
            'slug', t.slug,
            'label', t.label,
            'icon_name', t.icon_name,
            'color_class', t.color_class
        )) FILTER (WHERE t.id IS NOT NULL),
        '[]'::json
    ) AS tags,
    -- Type info
    rt.name AS type_name
FROM resources.resource r
LEFT JOIN resources.resource_categories rc ON r.id = rc.resource_id
LEFT JOIN resources.category c ON rc.category_id = c.id
LEFT JOIN resources.resource_tags rtag ON r.id = rtag.resource_id
LEFT JOIN resources.tag t ON rtag.tag_id = t.id
JOIN resources.type rt ON r.type_id = rt.id
GROUP BY r.id, rt.name;

-- View for submissions with aggregated categories and tags
CREATE VIEW resources.submission_detail AS
SELECT
    s.*,
    -- Aggregate categories
    COALESCE(
        json_agg(DISTINCT jsonb_build_object(
            'id', c.id,
            'slug', c.slug,
            'label', c.label,
            'icon_name', c.icon_name,
            'color_class', c.color_class
        )) FILTER (WHERE c.id IS NOT NULL),
        '[]'::json
    ) AS categories,
    -- Aggregate tags
    COALESCE(
        json_agg(DISTINCT jsonb_build_object(
            'id', t.id,
            'slug', t.slug,
            'label', t.label,
            'icon_name', t.icon_name,
            'color_class', t.color_class
        )) FILTER (WHERE t.id IS NOT NULL),
        '[]'::json
    ) AS tags,
    -- Type info
    rt.name AS type_name
FROM resources.submission s
LEFT JOIN resources.submission_categories sc ON s.id = sc.submission_id
LEFT JOIN resources.category c ON sc.category_id = c.id
LEFT JOIN resources.submission_tags stag ON s.id = stag.submission_id
LEFT JOIN resources.tag t ON stag.tag_id = t.id
JOIN resources.type rt ON s.type_id = rt.id
GROUP BY s.id, rt.name;

-- =====================================================
-- SEED DATA
-- =====================================================

-- Seed categories
INSERT INTO resources.category (slug, label, type_id, icon_name, color_class) VALUES
-- Game genres
('action', 'Action', 1, 'Swords', 'text-red-500'),
('puzzle', 'Puzzle', 1, 'Brain', 'text-blue-500'),
('adventure', 'Adventure', 1, 'WholeWord', 'text-brackeys-purple-600'),
('simulation', 'Simulation', 1, 'Building', 'text-green-500'),
('strategy', 'Strategy', 1, 'Trophy', 'text-yellow-500'),
('survival', 'Survival', 1, 'Skull', 'text-brackeys-fuscia'),
-- Tool categories
('game-development', 'Game Development', 2, 'Gamepad2', 'text-teal-500'),
('graphics-art', 'Graphics & Art', 2, 'WholeWord', 'text-pink-500'),
('code-editors', 'Code Editors', 2, 'Wrench', 'text-indigo-500'),
('development-tools', 'Development Tools', 2, 'Wrench', 'text-orange-500'),
('project-management', 'Project Management', 2, 'Building', 'text-cyan-500');

-- Seed tags
INSERT INTO resources.tag (slug, label, icon_name, color_class) VALUES
('community-made', 'Community Made', 'Users', 'text-brackeys-fuscia bg-brackeys-purple-500/20'),
('popular', 'Popular', 'Star', 'text-yellow-400 bg-yellow-500/20'),
('free', 'Free', 'Tag', 'text-green-400 bg-green-500/20'),
('open-source', 'Open Source', 'Tag', 'text-blue-400 bg-blue-500/20'),
('beginner-friendly', 'Beginner Friendly', 'Tag', 'text-teal-400 bg-teal-500/20');

