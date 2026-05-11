# Drizzle migrations

SQL migrations for the Brackeys schema, managed entirely by drizzle-kit.

## Flow

- Edit `src/db/schema.ts`.
- `bun run db:generate` — drizzle-kit diffs the schema against the latest
  snapshot in `meta/` and emits a new `NNNN_<name>.sql` plus a matching
  `meta/NNNN_<name>_snapshot.json`. Commit both.
- `bun run db:migrate` — applies pending migrations to the DB at
  `DATABASE_URL`. Drizzle records each applied migration in
  `drizzle.__drizzle_migrations` (created automatically on first run).

CI applies migrations on `main` (staging) and `prod` whenever files under
`drizzle/` change — see `.gitlab/db-migrate.gitlab-ci.yml`.

## Conventions

- Don't edit committed migration SQL files; generate a new one instead.
- `meta/_journal.json` is the ordering source of truth — `when` values must
  be monotonically increasing.
