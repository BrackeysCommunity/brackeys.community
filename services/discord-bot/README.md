# Discord Bot — Railway Deployment

Long-lived Railway service that answers slash commands in the Brackeys
Discord server from the site's **public API tier**. A member types `/jam`
and gets the current Brackeys jam with its phase and countdown;
`/collab browse` lists open collab posts; `/member @someone` shows their
site profile. Every answer is a GET to `$APP_URL/api/public/rpc/*` through
the edge — the same requests the browser makes — so the bot is a client of
the API, never a second implementation of it. It holds no database
connection, no session, and writes nothing to the site (plan `28`).

## Commands

| Command                                                     | Answers from                                                            | Visibility         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------ |
| `/jam now`                                                  | `listJamsByHost` → running › voting › upcoming                          | public             |
| `/jam info <jam>`                                           | `getJam` + `getJamCommunity`                                            | ephemeral, `share` |
| `/jam entries <jam> [sort] [search]`                        | `listJamEntries`, 10 a page, prev/next buttons                          | ephemeral, `share` |
| `/jam results <jam>`                                        | `getJamResults` top 5 per criterion                                     | ephemeral, `share` |
| `/collab browse [type] [skill] [role] [jam] [search]`       | `listPosts` + `countPostsByType`, same facets                           | ephemeral, `share` |
| `/collab post <id>`                                         | `getPost`                                                               | ephemeral, `share` |
| `/collab stats`                                             | `getBoardStats` + `getTeamStats`                                        | ephemeral, `share` |
| `/member [user] [name]`, right-click → **Brackeys profile** | `getProfileByDiscordId` / `listMembers` + `getProfile`, `listUserTeams` | ephemeral, `share` |
| `/team <name>`                                              | `getTeam`                                                               | ephemeral, `share` |
| `/ping`                                                     | `getBoardStats` and the round-trip time                                 | ephemeral          |

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

### Portal work (one-time, human)

- The bot and the site's OAuth sign-in are **one Discord application**; the
  bot user already exists for the ban probe.
- Invite it to the guild with the `bot` and `applications.commands` scopes
  and no permissions beyond those it already holds — slash replies need
  none.
- Disable "Public Bot" (or leave install links off) so nobody adds it to
  another server. Commands register as **guild commands** for
  `DISCORD_GUILD_ID` only; nothing is registered globally.
- No privileged intent is requested — the client connects with `Guilds`
  only — so no intent review is needed.

### Staging

A **second Discord application** against a scratch guild, deployed from the
`staging` environment with `APP_URL=https://staging.brackeys.dev`. Guild
commands keep it clean: the staging application's commands exist only in
the scratch guild. Never point two live bots at the real guild.

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
cp .env.example .env
# fill in the staging application's token/ids and APP_URL

bun run start
```

You should see `[boot] gateway ready as …`, one `[register] …` line, and
`[memo] warm {…}`. Each API call logs `[api] <procedure> <status> <ms> cf=<HIT|MISS>`;
the second `/ping` should read `HIT`.

## Telemetry

`bot_command_invoked` / `bot_command_failed` with `command`, `subcommand`,
`latency_ms`, `api_outcome` (`hit` / `not_found` / `timeout` / `error`) and
`visibility`, captured under the service's own distinct id. **No Discord
user id** rides these events: someone who never signed in to the site has
no identity in our analytics and doesn't acquire one by typing a command.
