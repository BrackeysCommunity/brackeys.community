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
- PostHog project API key

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
- `GITLAB_CLIENT_ID`: gitlab.com account linking
- `GITLAB_BOOTH_CLIENT_ID`: `git.booth.dev` linking
- `GITLAB_BRACKEYS_CLIENT_ID`: `git.brackeys.dev` linking
  (register each application non-confidential — a public PKCE client needs no
  secret; `GITLAB_*_CLIENT_SECRET` exists for instances that require one)
- `DISCORD_BOT_TOKEN`: guild membership and ban probes, and the collab feed mirror below
- `DISCORD_COLLAB_CHANNEL_ID`: the channel an author's SHARE TO DISCORD posts their collab
  post into. Unset means the feature does not exist — the button never renders. The bot
  needs View Channel / Send Messages / Embed Links there and nothing more; it only ever
  edits or deletes the messages it wrote itself.
- `VITE_ITCHIO_CLIENT_ID`: itch.io linking flow
- `VITE_STRAPI_URL`: Strapi-backed uploads / demo content
- `MINIO_ENDPOINT`: MinIO server URL, for example `https://your-minio-host.up.railway.app`
- `MINIO_PUBLIC_BASE_URL`: public base URL used to render stored objects
- `MINIO_BUCKET`: bucket name for uploaded profile project images
- `MINIO_ACCESS_KEY`: MinIO access key
- `MINIO_SECRET_KEY`: MinIO secret key

### Optional

- `VITE_APP_TITLE`: client title override
- `VITE_DEPLOY_ENV`: `production` | `staging` | `development` — overrides the staging marker
  (badge beside the logo, top-edge stripe, `[STAGING]` tab-title prefix). Derived from
  `VITE_SITE_ORIGIN` when unset, which is right for every deploy we have; set it only where
  the origin can't tell the truth.
- `DISCORD_COLLAB_SHARE_COOLDOWN_SECONDS`: how long a member waits between announcing posts
  in the collab feed channel (default `21600`, six hours). Updating a message they already
  posted is limited separately, at ten an hour.
- `SERVER_URL`: server-side absolute URL override
- `VITE_POSTHOG_KEY`: PostHog project API key — analytics, feature flags, error tracking (all off when unset)
- `VITE_POSTHOG_HOST`: PostHog ingestion host, for example `https://eu.i.posthog.com`, or the
  reverse proxy path once `workers/posthog-proxy` is deployed. Inlined into the browser bundle
  at build time — changing it needs a rebuild, not just a restart.
- `POSTHOG_PERSONAL_API_KEY`: **build-time, server-only** — enables source-map upload so error
  stacks are un-minified. Never give this a `VITE_` prefix: it is a write credential and the
  prefix would inline it into the browser bundle. Absent means maps are simply not uploaded.
- `POSTHOG_PROJECT_ID`: build-time, pairs with the personal API key — the numeric project id
  (269454 prod, 269446 staging). Both must be set or the build skips maps entirely.
- `POSTHOG_API_HOST`: build-time, optional — the PostHog **API/UI** host for source-map
  upload (`https://eu.posthog.com`). Distinct from the ingestion host below; do not
  set both to the same value.
- `POSTHOG_KEY` / `POSTHOG_HOST`: read by the `services/*` workers for error reporting; they
  fall back to the `VITE_`-prefixed names so one Railway shared variable can cover everything

## Railway CLI (optional)

If you have access to the Railway project, you can pull environment variables directly from Railway instead of maintaining `.env.local` manually.

### Install

https://docs.railway.com/cli#installing-the-cli

```bash
npm i -g @railway/cli
# or MacOS
brew install railway
# or Linux/WSL
bash <(curl -fsSL cli.new)
```

### Link your local repo

```bash
railway login
railway link
```

The interactive prompt will ask you to select the workspace, project, environment, and service.

### Switch environments

```bash
railway environment       # list available environments
railway environment dev   # switch to dev
```

### Run with Railway env vars

Use the `railway:*` scripts to run any command with Railway-injected environment variables:

```bash
vp run railway:dev          # dev server with Railway env vars
vp run railway:build        # production build
vp run railway:db:migrate   # run migrations against Railway database
vp run railway:db:studio    # open Drizzle Studio against Railway database
```

You can also pass `-s <service>` and `-e <environment>` flags inline:

```bash
railway run -e staging -- vp dev --port 3000
```

The standard `bun run dev` / `vp run dev` workflow with `.env.local` continues to work for developers who do not need Railway CLI.

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

## Versioning

`__APP_VERSION__` (footer, PostHog `app_version`, source-map release) is a Vite
`define` assembled at build time in `vite.config.ts`:

```
<package.json version>+<UTC build stamp>.<short sha>     # staging, previews, local
0.1.0+20260906.0441.8ab5478

<tag without v>+<short sha>                              # tagged prod release
0.1.0+8ab5478
```

The stamp orders builds and the sha pins one. On a tagged release the tag does
the ordering, so the stamp is dropped: the release pipeline sets `APP_RELEASE`
as a Railway service variable and `vite.config.ts` takes that branch. The
standalone services have no Vite build and read `APP_RELEASE` at runtime
(`src/lib/service-telemetry.ts`), falling back to `RAILWAY_GIT_COMMIT_SHA`.

For the sha: Railway exposes `RAILWAY_GIT_COMMIT_SHA` on repo-connected
deploys, the release pipeline sets `APP_COMMIT_SHA`, GitLab exposes
`CI_COMMIT_SHA`, and a local build falls back to `git rev-parse`.

Nothing bumps `package.json` automatically; you change its `version` by hand
when the release line moves:

```bash
npm version minor --no-git-tag-version   # → 0.2.0
```

**Landing that on `main` releases to prod** — the bump is the trigger, not a
bookkeeping step. See "Releasing" below before you merge one.

## Releasing

**A production release is a git tag.** Pushing `vX.Y.Z` to GitLab runs one
pipeline that gates the commit, migrates the prod database, and deploys **all
five application services** — Web, `itch-crawler`, `media-scan`,
`notifications-worker`, `discord-bot` — from that one tree. Nothing in prod
moves because a branch moved; the Railway auto-deploy triggers on the prod
instances are off.

Staging is unchanged: it still tracks `main` through the GitHub mirror.

### The loop

Ordinary work never touches a tag. Branch off `main`, open an MR, and get the
usual MR pipeline (`lint`, `test`, `sonar`, a Railway preview). Merging to
`main` deploys **staging** through the GitHub mirror, and applies staging
migrations if the MR touched `drizzle/`. Soak it there.

Because staging is where you decide, **soak first, then bump** — the bump MR is
the release decision, not a step after it.

### Cutting one

Open an MR that bumps `package.json`'s `version` and nothing else:

```bash
npm version minor --no-git-tag-version   # → 0.2.0
```

Merge it. That is the whole release. The `auto-tag` job on `main` sees the
`version` field change, pushes `v0.2.0`, and the tag runs the release pipeline.

Two things it deliberately will not do:

- **A dependency bump does not release.** `auto-tag` diffs the `version` field
  itself, not the file, so Renovate MRs pass through untouched.
- **A prerelease does not release.** Set `0.3.0-rc.1` and it lands on `main`
  and deploys to staging with no tag and no prod deploy. Only `X.Y.Z` ships.

Pushing a tag by hand does the same thing, and is the fallback if `auto-tag` is
ever wedged:

```bash
git tag -a v0.2.0 -m "v0.2.0" && git push origin v0.2.0
```

From the tag on: `release-gate` checks the tag matches `package.json`, that the
commit is reachable from `main`, and type-checks every `services/*` package —
the only place CI does, since root `vp check` does not cover them. Then
`db-migrate-prod` runs (always, not only when `drizzle/` changed — that filter
is what let schema and code race), five parallel `deploy-prod` jobs
`railway up` each service and poll it to `SUCCESS`, `smoke-prod` asserts
`/api/health` reports the new version, and `publish-release` writes the GitLab
Release from `git log`.

`auto-tag` needs `RELEASE_TOKEN`: a project access token, Maintainer (the
`v*` protected-tag rule requires it), `write_repository`, masked and protected.
**It expires.** A previous incarnation of CI-side versioning died exactly that
way and went unnoticed for three months, so this job fails loudly on a missing
token and verifies the tag actually landed rather than trusting `git push` —
but a red `auto-tag` on `main` is the only thing between an expired token and a
release that silently never happens. Put its expiry in a calendar.

### Verifying

`/api/health` returns `{ ok, version }`; the footer shows `v0.1.0+<sha>`;
PostHog `app_version` reads `0.1.0` for web and services alike; Railway shows
five deployments messaged `v0.1.0 @ <sha>`.

### Rolling back

1. **Fast** — Railway rollback, per affected service: find the previous
   `SUCCESS` deployment (`railway deployment list --service X --environment prod
--json`) and call `deploymentRollback(id)` over GraphQL (the CLI has no
   rollback verb). Image and variables come back together, so `APP_RELEASE`
   reverts with it. Only deployments with `canRollback: true` qualify.
2. **Correct** — re-run the previous tag's pipeline and retry `deploy-prod`.
   Same code path as a release, so it is the one to trust.

Migrations do not roll back; drizzle has no down. A release whose migration is
not backwards-compatible with the previous code needs a forward fix (`v0.1.1`),
not a rollback. A deploy that fails mid-release leaves that service on its
previous deployment — the failure mode is "one service stale", not "prod down".

### When a job fails

- **`auto-tag`** — no tag, so no release happened at all; `main` and staging
  are fine. Usually the token: expired, unmasked, or its user is not a
  Maintainer so the `v*` rule refused the push (the job says which). Fix the
  token and re-run the job, or push the tag by hand.
- **`release-gate`** — nothing has moved. Fix and re-tag: delete the tag
  locally and remotely (`git push origin :v0.1.0`), then tag again.
- **`db-migrate-prod`** — nothing has deployed, and drizzle applies pending
  migrations in one transaction, so prod's schema is untouched. Fix the
  migration on `main` and cut the next patch tag.
- **One `deploy-prod` job** — that service is still on its previous
  deployment; the other four are on the new one. Retry the job from the
  pipeline. If the build itself is broken, fix forward with `v0.1.1` rather
  than leaving the split in place.
- **`smoke-prod`** — all five deployed but the origin is not serving the new
  version. Check `/api/health` by hand before assuming the job is wrong; if
  prod really is bad, roll back Web first, since it is the only user-facing
  one.

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
