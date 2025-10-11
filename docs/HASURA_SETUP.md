# Hasura Setup and Configuration Guide

Complete guide for setting up and configuring Hasura GraphQL Engine for the Brackeys Web application.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Setup Instructions](#setup-instructions)
- [Development Workflow](#development-workflow)
- [CI/CD Pipeline](#cicd-pipeline)
- [Deployment](#deployment)
- [Best Practices](#best-practices)

## Overview

This project uses Hasura v2 GraphQL Engine with the following features:

- **Experimental Casing**: GraphQL naming convention (camelCase) for better frontend integration
- **Version-Controlled Migrations**: All database changes tracked in git
- **Automated Deployments**: CI/CD pipelines for dev, staging, and production
- **Docker-Based**: Containerized for consistency across environments

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React)                        │
│                     GraphQL Client                           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ GraphQL Queries/Mutations
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  Hasura GraphQL Engine                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  - Query Engine                                       │  │
│  │  - Permission System                                  │  │
│  │  - Real-time Subscriptions                           │  │
│  │  - Naming Convention (camelCase)                     │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ SQL Queries
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   PostgreSQL Database                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Schemas:                                             │  │
│  │  - users (authentication data)                        │  │
│  │  - collab (collaboration posts, profiles, etc.)      │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Setup Instructions

### Prerequisites

1. **Docker and Docker Compose**

   ```bash
   docker --version  # Should be 20.10+
   docker-compose --version  # Should be 1.29+
   ```

2. **Hasura CLI** (optional, for local development)
   ```bash
   curl -L https://github.com/hasura/graphql-engine/raw/stable/cli/get.sh | bash
   hasura version
   ```

### Initial Setup

1. **Clone and Configure**

   ```bash
   cd brackeys-web
   cp .env.example .env
   ```

2. **Set Environment Variables**

   Edit `.env` and configure:

   ```bash
   # Required
   POSTGRES_PASSWORD=<secure-password>
   HASURA_GRAPHQL_ADMIN_SECRET=<secure-admin-secret>

   # Optional (for authentication)
   HASURA_GRAPHQL_JWT_SECRET='{"type":"RS256","jwk_url":"https://..."}'
   ```

3. **Start Services**

   ```bash
   docker-compose up -d postgres hasura
   ```

4. **Verify Installation**
   - Open http://localhost:8080/console
   - Log in with your admin secret
   - Check that tables are tracked in the Data tab

### Quick Start

For a simplified getting started guide, see [hasura/QUICKSTART.md](../hasura/QUICKSTART.md).

## Development Workflow

### Working with Migrations

#### Creating Migrations

**Option 1: CLI Console (Recommended)**

```bash
cd hasura
hasura console

# Make changes in the console
# Metadata and migrations are automatically tracked
```

**Option 2: Manual Migration**

```bash
cd hasura
hasura migrate create "add_new_table" --database-name default

# Edit the generated files:
# migrations/default/<timestamp>_add_new_table/up.sql
# migrations/default/<timestamp>_add_new_table/down.sql
```

**Option 3: From Existing Database**

```bash
cd hasura
hasura migrate create "import_schema" --database-name default --sql-from-server
```

#### Applying Migrations

```bash
# Local
cd hasura && npm run migrate:apply

# Development
cd hasura && npm run migrate:apply:dev

# Using Makefile
cd hasura && make migrate-apply ENV=dev
```

#### Rolling Back Migrations

```bash
# Rollback last migration
cd hasura && npm run migrate:rollback

# Rollback multiple steps
cd hasura
hasura migrate apply --down 3 --database-name default

# Using Makefile
make migrate-rollback STEPS=3 ENV=local
```

### Working with Metadata

#### Exporting Metadata

After making changes via the console:

```bash
cd hasura
npm run metadata:export
# or
make metadata-export
```

#### Applying Metadata

```bash
cd hasura
hasura metadata apply
```

#### Metadata Structure

```
metadata/
├── version.yaml                    # Metadata version
├── databases/
│   ├── databases.yaml             # Database connections
│   └── default/
│       └── tables/
│           └── tables.yaml        # Table tracking and relationships
├── actions.yaml                   # Custom actions
├── allow_list.yaml               # Query allowlist
├── api_limits.yaml               # API rate limits
├── cron_triggers.yaml            # Scheduled triggers
├── inherited_roles.yaml          # Role inheritance
├── query_collections.yaml        # Saved queries
├── remote_schemas.yaml           # Remote schema integrations
└── rest_endpoints.yaml           # REST endpoints
```

### Naming Convention

Hasura is configured with `graphql-default` naming convention:

| Feature      | Database             | GraphQL             |
| ------------ | -------------------- | ------------------- |
| Table names  | `collaboration_post` | `collaborationPost` |
| Column names | `user_id`            | `userId`            |
| Foreign keys | `profile_id`         | `profileId`         |

This provides a seamless experience with camelCase in your frontend code.

## CI/CD Pipeline

### GitHub Actions Workflows

#### 1. PR Checks (`hasura-pr-check.yml`)

Runs on every PR that modifies Hasura files:

- Validates migration syntax
- Tests migrations on a test database
- Validates metadata YAML files
- Tests rollback capability

#### 2. Deployment (`hasura-deploy.yml`)

Triggers on push to main/staging/develop branches:

**Steps:**

1. **Validate** - Check migrations and metadata
2. **Build** - Create Docker image for migrations
3. **Deploy** - Apply migrations to appropriate environment
   - `develop` → Development environment
   - `staging` → Staging environment
   - `main` → Production environment (with safety checks)

### Required Secrets

Configure these in GitHub Settings → Secrets:

```bash
# Development
HASURA_DEV_ENDPOINT
HASURA_DEV_ADMIN_SECRET

# Staging
HASURA_STAGING_ENDPOINT
HASURA_STAGING_ADMIN_SECRET

# Production
HASURA_PROD_ENDPOINT
HASURA_PROD_ADMIN_SECRET
PROD_DATABASE_URL  # For backups
```

### Docker Image for Migrations

The `hasura/Dockerfile` creates a migration image:

```bash
# Build
cd hasura
docker build -t brackeys-hasura-migrations:latest .

# Run
docker run --rm \
  -e HASURA_GRAPHQL_DATABASE_URL="postgres://..." \
  -e HASURA_GRAPHQL_ADMIN_SECRET="..." \
  brackeys-hasura-migrations:latest
```

This image is automatically built and pushed to GitHub Container Registry on every push.

## Deployment

### Manual Deployment

#### Development

```bash
cd hasura
./scripts/apply-migrations.sh dev
```

#### Staging

```bash
cd hasura
./scripts/apply-migrations.sh staging
```

#### Production

```bash
cd hasura
./scripts/apply-migrations.sh prod
# Requires confirmation
```

### Automated Deployment

Deployments happen automatically via GitHub Actions:

1. **Develop branch** → Auto-deploy to development
2. **Staging branch** → Auto-deploy to staging
3. **Main branch** → Auto-deploy to production (with checks)

### Rollback in Production

If a migration causes issues:

```bash
cd hasura

# Check current status
hasura migrate status --endpoint $PROD_ENDPOINT --admin-secret $SECRET --database-name default

# Rollback
./scripts/rollback-migration.sh 1 prod
```

## Best Practices

### Migrations

1. **Always write down.sql**: Ensure migrations can be rolled back
2. **Test locally first**: Apply and rollback before committing
3. **Small, focused migrations**: One logical change per migration
4. **Avoid data migrations in schema changes**: Separate data and schema
5. **Use transactions**: Wrap multiple changes in BEGIN/COMMIT

### Metadata

1. **Export after changes**: Always export metadata after console changes
2. **Review before committing**: Check the diff to understand changes
3. **Track all tables**: Ensure all relevant tables are tracked
4. **Document custom names**: Comment when using custom GraphQL names

### Permissions

1. **Principle of least privilege**: Grant minimum required access
2. **Use session variables**: Leverage `X-Hasura-User-Id` etc.
3. **Test each role**: Verify permissions work as expected
4. **Document permission logic**: Explain complex permission rules

### Development

1. **Use CLI console**: Track metadata changes automatically
2. **Commit early and often**: Small commits are easier to review
3. **Follow naming conventions**: Use the established patterns
4. **Write tests**: Test GraphQL queries in your frontend tests

### Security

1. **Strong admin secret**: Use a long, random string
2. **JWT authentication**: Configure proper JWT validation
3. **Enable HTTPS**: Use TLS in production
4. **Limit CORS**: Don't use `*` in production
5. **Query depth limits**: Set reasonable API limits

## Troubleshooting

### Migration Conflicts

If migrations conflict:

```bash
cd hasura
hasura migrate status --database-name default
# Identify conflicting version
# Rollback or fix manually
```

### Metadata Drift

If metadata differs from files:

```bash
cd hasura
hasura metadata diff
hasura metadata apply  # Apply from files
# or
hasura metadata export  # Export from server
```

### Permission Issues

Debug permissions:

```bash
# Check role variables
X-Hasura-Role: user
X-Hasura-User-Id: 12345

# View in Hasura console
Data → [Table] → Permissions → [Role]
```

### Connection Issues

```bash
# Check Hasura logs
docker-compose logs hasura

# Check database connection
docker-compose exec postgres psql -U postgres -d brackeys
```

## Resources

- [Hasura Documentation](https://hasura.io/docs/latest/graphql/core/index.html)
- [GraphQL Best Practices](https://graphql.org/learn/best-practices/)
- [Project QUICKSTART](../hasura/QUICKSTART.md)
- [Migration Scripts README](../hasura/README.md)

## Versioning Commits

Use the `hasura` scope for all Hasura-related commits:

```bash
feat(hasura): add collaboration post queries
fix(hasura): correct profile relationship
chore(hasura): update permissions for user role
docs(hasura): document custom naming convention
```

See [HASURA_VERSIONING.md](./HASURA_VERSIONING.md) for details.
