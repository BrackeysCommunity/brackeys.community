# Brackeys

Brackeys is the community web app for the Brackeys Discord. This repo is a single TanStack Start application that powers:

- the home / jam landing page
- the command center
- developer profiles
- the collab board

This README is the repo-level source of truth for local setup and day-to-day development. The old starter README is intentionally replaced because it no longer matched the codebase.

## Stack

- TanStack Start + Vite
- React 19
- TanStack Router, Query, Store, and Devtools
- Tailwind CSS v4
- Biome
- Drizzle ORM + PostgreSQL
- Better Auth
- ORPC
- Storybook

## Main App Surfaces

- `/` home / jam landing page
- `/command-center` command and macro docs
- `/profile` sign-in gate and profile entry
- `/profile/:userId` public profile view and owner edit flow
- `/collab` collab browse flow
- `/collab/new` collab post creation
- `/collab/:postId` collab post detail
- `/oauth/github/callback` GitHub account-link callback
- `/oauth/itchio/callback` itch.io link callback
- `/api/auth/*` Better Auth endpoints
- `/api/rpc/*` ORPC endpoints

## Repo Structure

```text
src/
  components/
    collab/
    home/
    layout/
    profile/
    ui/
  db/
  lib/
  orpc/
  routes/
drizzle/
.storybook/
```

Important files:

- `src/routes/__root.tsx`: shell, background, command palette, layout
- `src/db/schema.ts`: app schema
- `src/lib/auth.ts`: Better Auth provider config
- `src/orpc/router/*`: typed server procedures
- `drizzle.config.ts`: Drizzle config

## Prerequisites

- Bun
- PostgreSQL
- Discord OAuth app credentials

Optional but relevant depending on what you are working on:

- GitHub OAuth app credentials
- itch.io client ID
- Strapi instance for collab image uploads
- MinIO credentials for profile image uploads
- Sentry DSN

## Setup

1. Install dependencies.

```bash
bun install
```

2. Create local env vars.

```powershell
Copy-Item .env.example .env.local
```

3. Fill in the required secrets in `.env.local`.

Minimum required for most local work:

- `DATABASE_URL`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_GUILD_ID`

4. Apply database schema.

Only the user should ever run `bun run db:generate`, `bun run db:migrate`, or
`bun run db:push`. Agents should update schema and migration files, but the
user remains the only operator for those commands.

For an existing migration flow:

```bash
bun run db:migrate
```

For fast local iteration against an empty local database:

```bash
bun run db:push
```

5. Start the dev server.

```bash
bun run dev
```

The app runs on `http://localhost:3000`.

## Environment Variables

`README` only documents variables that are actually referenced in the repo today.

### Required

- `DATABASE_URL`: Postgres connection string
- `BETTER_AUTH_URL`: local app URL, usually `http://localhost:3000`
- `BETTER_AUTH_SECRET`: Better Auth secret
- `DISCORD_CLIENT_ID`: Discord OAuth client ID
- `DISCORD_CLIENT_SECRET`: Discord OAuth client secret
- `DISCORD_GUILD_ID`: guild used for member role/profile enrichment

### Required for specific features

- `GITHUB_CLIENT_ID`: GitHub account linking
- `GITHUB_CLIENT_SECRET`: GitHub account linking
- `VITE_ITCHIO_CLIENT_ID`: itch.io linking flow
- `VITE_STRAPI_URL`: Strapi-backed uploads / demo content
- `MINIO_ENDPOINT`: MinIO server URL, for example `https://your-minio-host.up.railway.app`
- `MINIO_PUBLIC_BASE_URL`: public base URL used to render stored objects
- `MINIO_BUCKET`: bucket name for uploaded profile project images
- `MINIO_ACCESS_KEY`: MinIO access key
- `MINIO_SECRET_KEY`: MinIO secret key

### Optional

- `VITE_APP_TITLE`: client title override
- `SERVER_URL`: server-side absolute URL override
- `VITE_SENTRY_DSN`: Sentry client/server instrumentation

## Useful Commands

```bash
bun run dev
bun run build
bun run preview
bun run start

bun run db:generate
bun run db:migrate
bun run db:push
bun run db:pull
bun run db:studio

bun run lint
bun run format
bun run check
bun run test

bun run storybook
bun run build-storybook
```

`bun run db:generate`, `bun run db:migrate`, and `bun run db:push` are
user-only commands. Do not have agents execute them.

## Development Notes

- Discord is the primary sign-in path.
- GitHub linking and GitHub contribution calendar rendering are implemented.
- itch.io linking exists and is token/client-ID based in the current implementation.
- Public profile links prefer linked provider URLs over manual URLs when available.
- OAuth-backed GitHub and itch.io links now render verified badges in the public profile UI.
- `src/routes/demo/*` still contains scaffold/demo routes and should not be treated as product truth.

## Database Notes

The schema currently spans:

- `auth`
- `user`
- `hammer`
- `collab`
- public `todos`

Profile data still uses separate `profile_projects` and `jam_participations` tables. The unified typed-projects migration has not landed yet.

## Validation Notes

- `bun run check` runs Biome across the repo.
- `bun run test` uses Vitest.
- First-party automated coverage appears limited at the moment, so UI and route changes still need manual verification.

## Working Conventions

- Prefer reading the code over assuming the starter framework defaults still apply.
- Treat Notion as the longer-lived cross-session source of truth for architecture, drift, and planning context.
- Keep Linear issue status aligned with what actually shipped in the repo.

## Known Gaps

- The repo still needs a fuller setup/runbook for external services and credential provisioning.
- Demo routes remain in-tree.
- The route tree currently has at least one existing TypeScript issue outside normal profile work (`src/routes/profile.$userId.tsx`), so isolated validation is sometimes more useful than full repo typechecking.

