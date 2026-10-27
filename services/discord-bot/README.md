# Discord Bot — Railway Deployment

Long-lived Railway service that answers slash commands in the Brackeys
Discord server from the site's **public API tier**. A member types `/jam`
and gets the current Brackeys jam with its phase and countdown;
`/collab browse` lists open collab posts; `/member @someone` shows their
site profile. Every answer is a GET to `$APP_URL/api/public/rpc/*` through
the edge — the same requests the browser makes — so the bot is a client of
the API, never a second implementation of it. It holds no database
connection, no session, and writes nothing to the site (plan `28`) beyond
the optional member relay, which only asks the site to re-read a member
from Discord.

## Commands

| Command                                                      | Answers from                                                                                                                                         | Visibility         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `/jam now`                                                   | `listJamsByHost` → running › voting › upcoming                                                                                                       | public             |
| `/jam info <jam>`                                            | `getJam` + `getJamCommunity`                                                                                                                         | ephemeral, `share` |
| `/jam entries <jam> [sort] [search]`                         | `listJamEntries`, 10 a page, prev/next buttons                                                                                                       | ephemeral, `share` |
| `/jam results <jam>`                                         | `getJamResults` top 5 per criterion                                                                                                                  | ephemeral, `share` |
| `/collab browse [type] [skill] [role] [jam] [search]`        | `listPosts` + `countPostsByType`, same facets                                                                                                        | ephemeral, `share` |
| `/collab post <id>`                                          | `getPost`                                                                                                                                            | ephemeral, `share` |
| `/collab stats`                                              | `getBoardStats` + `getTeamStats`                                                                                                                     | ephemeral, `share` |
| `/member [user] [name]`, right-click → **jams.team profile** | `getProfileByDiscordId` / `listMembers` + `getProfile`, `listUserTeams`                                                                              | ephemeral, `share` |
| `/team <name>`                                               | `getTeam`                                                                                                                                            | ephemeral, `share` |
| `/ping`                                                      | `getBoardStats` and the round-trip time                                                                                                              | ephemeral          |
| `/summarize [since] [ask]`                                   | This channel's history over REST + Haiku (plan 49); `since` takes a window or `since I last posted` (up to 7 days); `ask` answers a question instead | ephemeral, `share` |

Autocomplete (jam titles, skills, roles, team names) never touches the API
on the request path: `src/memo.ts` warms those lists at boot and refreshes
them in the background, and a cold memo answers with nothing rather than
risking the 3-second deadline.

## How a command runs

1. `discord/adapter.ts` turns the interaction into a plain `Invocation`,
   checks the per-user cooldown, and **defers** with the visibility the
   command decided (Discord fixes it at the first response).
2. `commands/dispatch.ts` runs the matching pure command
   `(api, input, ctx) => Reply`. Commands never see discord.js; they get a
   typed `PublicApi` client and a fixed `now`, which is what makes them
   testable under `bun test`.
3. The adapter writes the `Reply` descriptor back. The API wrapper
   (`src/api.ts`) has a 2 s timeout per call; a timeout or 5xx becomes one
   ephemeral outage line, never a stack trace. A 403 from Discord is logged
   loudly and never retried.

Pagination state lives in the button's `custom_id` (`commands/custom-id.ts`),
versioned and bounded so the widest legal state fits Discord's 100
characters and an old button after a redeploy says "run the command again".

## Typecheck

`src/api.ts` imports the public router's **type only**, so the client is
typed against the live procedures — a renamed input fails this service's
`tsc`. Bun erases the import; the image never holds the router. The cost
is that `tsc` walks the app's router graph, so `tsconfig.json` mirrors the
root's options where they differ (see its comments). Run:

```bash
cd services/discord-bot
bun run typecheck
bun test src
```

Root `vp check` formats these files but does not type-check them.

## Railway setup

1. **Create a new service** pointing at this repo.
2. **Leave Root Directory blank** — the Dockerfile builds from the repo root
   so it can copy the shared `src/lib` helpers it renders with.
3. **Set the Dockerfile Path** to `services/discord-bot/Dockerfile` (also in
   `railway.toml`).
4. **Long-lived, not cron** — `restartPolicy=ALWAYS` keeps the gateway
   connection resident.
5. **Environment variables** — see [`.env.example`](./.env.example):
   `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID` (or the web app's
   `DISCORD_CLIENT_ID` — same value, either name), `DISCORD_GUILD_ID`,
   `APP_URL` (required, never defaulted), optional `JAM_HOST_NAME`,
   `BOT_API_TIMEOUT_MS`, and the PostHog pair the other services read.
6. **Member relay (optional)** — `MEMBER_RELAY=true` adds the privileged
   `GuildMembers` intent and POSTs `{ discordId }` to
   `$APP_URL/api/discord/member-sync` when a member's avatar, nickname or
   username changes, signed with an HMAC keyed by `DISCORD_BOT_TOKEN`
   (`src/lib/bot-relay-signature.ts`). It needs the privileged **Server
   Members Intent**, which the app holds (approved October 2026); without
   it the gateway refuses the login (4014). On in prod.
7. **Summaries (optional)** — with `REDIS_URL` (the shared Dragonfly,
   `${{Dragonfly.DRAGONFLY_URL}}`) and `ANTHROPIC_API_KEY` set, the bot
   registers `/summarize` (plan 49) and takes the non-privileged
   `GuildMessages` intent to hear deletions. Staff-only (Manage Messages)
   until `SUMMARIZE_OPEN=true`; `SUMMARY_COOLDOWN_LIMIT` /
   `SUMMARY_COOLDOWN_WINDOW_MS` set its per-member window (3 per 10 min).
   Message text is read over REST on request only and goes to Anthropic
   under an org with no training and zero data retention; only summaries
   are cached, for 30 days. The same Redis holds the Discord backoff
   window shared with the web app (`src/lib/discord-guard.ts`).

### Deploys

The bot sits outside the app's release cycle: **prod deploys from `main`**
through a Railway trigger on the prod instance (it has no staging
instance). Watch paths limit it to `services/discord-bot/**` and the
shared `src/lib` files the Dockerfile copies, so a web-only commit doesn't
restart it. Keep the watch paths in step with the Dockerfile's COPY list
(service settings, or `serviceInstanceUpdate` `watchPatterns`). The bot
calls only the site's public API, so it doesn't need to ship in lockstep
with a web release. Its telemetry release is the commit SHA Railway
injects (`RAILWAY_GIT_COMMIT_SHA`).

## Registration

At boot the service GETs the guild's current commands, normalises both
sides to the fields the manifest sets, and PUTs the bulk overwrite **only
when they differ** — a bulk PUT counts one create per command against the
200-per-day guild budget, and a crash loop that re-registered on every
boot would spend it. Five restarts, one PUT at most. On demand:

```bash
bun run register          # diff, then PUT if changed
bun run register --force  # PUT regardless
```

## Running locally

```bash
cd services/discord-bot
bun install
cp .env.example .env.staging
# the *staging* application's token/ids, and APP_URL=https://staging.jams.team

bun run staging          # gateway + boot registration, against .env.staging
bun run register:staging # registration only, no gateway
```

`bun run start` / `bun run register` read `.env` instead, so the two
environments sit side by side; both files are gitignored. `--env-file`
_replaces_ `.env` rather than layering over it, so a leftover production
`.env` cannot bleed into a staging run. Never point a local process at the
real guild — the gateway would run a second live bot alongside Railway's.

You should see `[boot] gateway ready as …`, one `[register] …` line, and
`[memo] warm {…}`. Each API call logs `[api] <procedure> <status> <ms> cf=<HIT|MISS>`;
the second `/ping` should read `HIT`.

## Telemetry

`bot_command_invoked` / `bot_command_failed` with `command`, `subcommand`,
`latency_ms`, `api_outcome` (`hit` / `not_found` / `timeout` / `error`) and
`visibility`, captured under the service's own distinct id. **No Discord
user id** rides these events: someone who never signed in to the site has
no identity in our analytics and doesn't acquire one by typing a command.
