# Drizzle migrations

SQL migrations for the Brackeys schema, managed by drizzle-kit v1 (pinned in
`package.json`).

## Flow

- Edit `src/db/schema.ts`.
- `bun run db:generate -- --name <slug>` — drizzle-kit diffs the schema
  against the latest snapshot and emits a new
  `<timestamp>_<slug>/migration.sql` folder with a matching `snapshot.json`.
  Commit the whole folder.
- `bun run db:migrate` — applies pending migrations to the DB at
  `DATABASE_URL`. Drizzle records each applied migration in
  `drizzle.__drizzle_migrations`, matching by folder name.

CI applies migrations on `main` (staging) and `prod` whenever files under
`drizzle/` change — see `.gitlab/db-migrate.gitlab-ci.yml`.

## Conventions

- Don't edit committed migration SQL files; generate a new one instead.
- There is no journal file in v1 — ordering comes from the timestamped
  folder names, and drizzle-kit checks migration commutativity across
  branches at generate/migrate time.

## 2026-07-30 re-baseline

The pre-v1 history (Atlas squash `0000_re_init` + drifted snapshot) was
replaced by a clean baseline generated from `src/db/schema.ts` on
drizzle-kit 1.0.0-rc.4:

- `20260730185257_init` — full schema as deployed (baseline; must never be
  executed against an existing DB).
- `20260730185301_profile_projects_published` — first real migration on top.

Existing databases must have their tracking table reconciled **before** the
first v1 `db:migrate` run against them (the migrator otherwise tries to
execute the baseline and fails on the first `CREATE SCHEMA`; the transaction
rolls back, so it's harmless but blocking). One-time, per DB.
**Status: staging done 2026-07-30; prod still pending.**

```sql
BEGIN;
DROP TABLE IF EXISTS drizzle.__drizzle_migrations;
CREATE TABLE drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint,
  name text,
  applied_at timestamp with time zone DEFAULT now()
);
-- Mark the baseline as applied without executing it (applied_at NULL =
-- baselined, matching what drizzle's own table-upgrade backfill does).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at, name, applied_at)
VALUES (
  'cee6675575907c24140e4cdc8eecaedc808068de05cd64bf42accf25b69bdd2f',
  1785437577000,
  '20260730185257_init',
  NULL
);
COMMIT;
```

Fresh databases need nothing: `db:migrate` runs the baseline and everything
after it from scratch.
