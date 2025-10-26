# Flyway Database Migrations

This directory contains database migration files managed by [Flyway](https://flywaydb.org/).

## Directory Structure

```
flyway/
├── conf/
│   └── flyway.conf          # Flyway configuration
├── sql/
│   ├── V1__initial_schema.sql
│   └── V2__your_migration.sql
└── README.md                # This file
```

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- PostgreSQL database running (via `docker compose up -d postgres`)

### Running Migrations

```bash
# Run all pending migrations
bun run db:migrate

# View migration status
bun run db:info

# Validate migrations
bun run db:validate
```

## Available Commands

| Command | Description |
|---------|-------------|
| `bun run db:migrate` | Apply all pending migrations |
| `bun run db:info` | Display migration status |
| `bun run db:validate` | Validate applied migrations |
| `bun run db:baseline` | Baseline an existing database |
| `bun run db:repair` | Repair the schema history table |
| `bun run db:clean` | **⚠️ DANGER**: Drop all objects in schemas |

## Creating a New Migration

### Naming Convention

Flyway uses a specific naming pattern:

```
V<VERSION>__<DESCRIPTION>.sql
```

- `V` - Prefix indicating a versioned migration
- `<VERSION>` - Sequential version number (e.g., 1, 2, 3)
- `__` - Double underscore separator
- `<DESCRIPTION>` - Brief description using underscores for spaces
- `.sql` - File extension

### Examples

✅ **Good Examples:**
- `V001__initial_schema.sql`
- `V002__add_user_preferences.sql`
- `V003__create_notifications_table.sql`
- `V004__add_post_tags_index.sql`

❌ **Bad Examples:**
- `V1_initial_schema.sql` (single underscore)
- `v2__add_feature.sql` (lowercase 'v')
- `V2.1__update.sql` (decimal version)
- `add_table.sql` (no version prefix)

### Step-by-Step Guide

1. **Create the migration file:**

```bash
touch flyway/sql/V002__add_user_preferences.sql
```

2. **Write your SQL migration:**

```sql
-- Add user preferences table
CREATE TABLE collab.user_preferences (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id UUID NOT NULL REFERENCES collab.profile(id) ON DELETE CASCADE,
    theme VARCHAR(20) DEFAULT 'light',
    notifications_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(profile_id)
);

CREATE INDEX idx_user_preferences_profile ON collab.user_preferences(profile_id);

CREATE TRIGGER update_user_preferences_updated_at 
    BEFORE UPDATE ON collab.user_preferences 
    FOR EACH ROW 
    EXECUTE FUNCTION collab.update_updated_at_column();
```

3. **Test the migration locally:**

```bash
# Ensure database is running
docker compose up -d postgres

# Run migration
bun run db:migrate

# Verify it was applied
bun run db:info
```

4. **Commit and push:**

```bash
git add flyway/sql/V002__add_user_preferences.sql
git commit -m "feat(db): add user preferences table"
git push origin main
```

## Migration Best Practices

### 1. Always Test Locally First

Before pushing migrations to production:

```bash
# Start fresh database
docker compose down -v postgres
docker compose up -d postgres

# Apply migrations
bun run db:migrate

# Verify schema
docker compose exec postgres psql -U postgres -d brackeys -c "\dt collab.*"
```

### 2. Make Migrations Idempotent

Use `IF NOT EXISTS`, `IF EXISTS`, or `CREATE OR REPLACE`:

```sql
-- Good
CREATE TABLE IF NOT EXISTS collab.my_table (...);

-- Good
ALTER TABLE collab.my_table ADD COLUMN IF NOT EXISTS my_column TEXT;

-- Good  
DROP TABLE IF EXISTS collab.old_table;
```

### 3. Use Transactions

Wrap related statements in transactions:

```sql
BEGIN;

CREATE TABLE collab.new_table (...);
CREATE INDEX idx_new_table ON collab.new_table(column);

COMMIT;
```

### 4. Add Comments

Document complex migrations:

```sql
-- Migration: Add support for user notifications
-- Author: John Doe
-- Date: 2025-10-26
-- Ticket: PROJ-123

CREATE TABLE collab.notifications (
    -- Primary key
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    -- User receiving the notification
    profile_id UUID NOT NULL REFERENCES collab.profile(id),
    -- Notification content
    message TEXT NOT NULL,
    -- Delivery status
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 5. Avoid Data Migrations in Schema Files

Separate data migrations when dealing with large datasets:

```sql
-- V3__add_user_roles_table.sql (schema)
CREATE TABLE collab.user_roles (...);

-- V4__populate_default_roles.sql (data)
INSERT INTO collab.user_roles (name, description) VALUES
    ('admin', 'Administrator role'),
    ('moderator', 'Moderator role'),
    ('user', 'Regular user role');
```

### 6. Never Modify Executed Migrations

Once a migration has been applied to any environment (especially production), **never modify it**.

Instead, create a new migration:

```sql
-- V5__fix_user_roles.sql
ALTER TABLE collab.user_roles ADD COLUMN permissions JSONB;
```

### 7. Consider Backwards Compatibility

Ensure migrations don't break running application instances:

```sql
-- Add new column with default value (safe)
ALTER TABLE collab.users ADD COLUMN status VARCHAR(20) DEFAULT 'active';

-- Add new table (safe)
CREATE TABLE collab.new_feature (...);

-- Rename column (requires application code update)
-- Do this in multiple steps:
-- Step 1: Add new column
-- Step 2: Update application to use both
-- Step 3: Migrate data
-- Step 4: Remove old column
```

### 8. Use Indexes Carefully

For production, use `CONCURRENTLY` to avoid blocking:

```sql
-- Development (fast, but locks table)
CREATE INDEX idx_post_created ON collab.post(created_at);

-- Production (slower, but non-blocking)
CREATE INDEX CONCURRENTLY idx_post_created ON collab.post(created_at);
```

## Configuration

Flyway configuration is in `flyway/conf/flyway.conf`. Key settings:

| Setting | Value | Description |
|---------|-------|-------------|
| `flyway.locations` | `filesystem:/flyway/sql` | Where to find migrations |
| `flyway.schemas` | `collab,public` | Schemas to manage |
| `flyway.baselineOnMigrate` | `true` | Baseline existing databases |
| `flyway.encoding` | `UTF-8` | SQL file encoding |
| `flyway.validateOnMigrate` | `true` | Validate before migrating |

## Environment Variables

Set these in your `.env` file:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password
POSTGRES_DB=brackeys
```

For CI/CD, these are provided via GitHub Secrets.

## Migration States

Flyway tracks migration states:

| State | Description |
|-------|-------------|
| **Success** | Migration executed successfully |
| **Pending** | Migration not yet applied |
| **Failed** | Migration failed (needs repair) |
| **Ignored** | Migration ignored by configuration |
| **Missing** | Applied migration file is missing |
| **Undone** | Migration was undone (Teams edition) |

View states with:

```bash
bun run db:info
```

## Troubleshooting

### Migration Failed

If a migration fails:

```bash
# Check what went wrong
bun run db:info

# Fix the migration file
# Then repair the schema history
bun run db:repair

# Try again
bun run db:migrate
```

### Out of Order Migrations

Flyway expects sequential versions. If you have:
- V001 (applied)
- V003 (applied)
- V002 (pending)

You need to either:
1. Apply V002 with `outOfOrder=true` (not recommended)
2. Rename V002 to V4

### Checksum Mismatch

If you see "checksum mismatch":

```bash
# Option 1: Repair (if you know what you're doing)
bun run db:repair

# Option 2: Baseline and continue (for existing databases)
bun run db:baseline
```

**Remember**: Database migrations are permanent. Always test thoroughly before applying to production!

