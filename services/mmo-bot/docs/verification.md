# Discord verification and limits

For the owner. What Discord asks of the app before it can grow past the
owner's servers, what to have ready, and the platform limits the bot plans
around. The Discord facts here were read from Discord's developer
documentation and blog in November 2026; each one this page could not
confirm from a Discord page is marked **not confirmed** and listed at the
end. Check the Developer Portal before acting on any of them.

## The plan

- **Season one is planned for 250 servers**, well past the 100-server cap
  an unverified app has had.
- **Submit app verification at 75 servers**, before season one opens to
  servers that are not the owner's, so a review in progress never stops a
  server from installing the bot.
- **Verify the Activity too.** An unverified Activity launches only in
  servers with fewer than 25 members, so in most real servers nobody could
  play a machine or a puzzle. That makes the Activity's verification a
  launch blocker, not a growth step.
- **No privileged intent.** The bot connects with `Guilds` alone.
- **No sharding** below 2,500 servers.

## The server cap

Discord required app verification before an app could join more than 100
servers, and offered the application from 75 servers on. Discord's
Developer Help Center still describes verification as what lets an app grow
past 100 servers (**not confirmed**: the article could not be read directly,
only through search results, and shows no date).

In June 2026 Discord moved its review of apps that access member, presence
and message content data from a 100-server trigger to a 10,000-user one,
and its developer help notes say app verification and the privileged intent
review are now separate processes. The 10,000-user review covers only that
data, which this bot never asks for, so it does not apply here. Whether the
100-server join cap itself still holds for unverified apps is **not
confirmed**; plan as if it does.

## Before submitting

1. **The app belongs to a team**, and the team's owner has two-factor
   authentication on (**not confirmed** as a requirement of the form).
2. **The team owner verifies their identity** through Discord's identity
   check (Stripe, per Discord's help center; **not confirmed** on a page
   read directly).
3. **Terms of Service and Privacy Policy URLs** are set in the app's
   General Information. The game's terms and privacy notice are drafts in
   the repository (`src/components/legal/GameTermsDraft.tsx` and
   `GamePrivacyDraft.tsx`) that no page shows yet. Publishing them comes
   first: review them, publish them on the MMO's own web surface on its
   subdomain (its shape is the owner's to settle) with their dates, then
   give the portal the full address of each page there. Players delete
   their game data with `/forget-me`, or by asking the privacy contact
   the notice names (the operator's forget).
4. **The bot's description** in General Information says what the game is
   and that it stores each player's Discord user id, their character and
   what it does, and the words they type to the bot.
5. **The install link** asks for the scopes and permissions in
   [admins.md](admins.md), and nothing more.
6. **No privileged intent is switched on.** On the app's Bot page, Presence
   Intent, Server Members Intent and Message Content Intent stay off.

## The portal steps

1. Developer Portal → Applications → the game's app.
2. **General Information**: description, Terms of Service URL, Privacy
   Policy URL, app icon.
3. **Bot**: privileged intents off; Public Bot on, so other servers' admins
   can install it.
4. **Installation**: the guild install with the `bot` and
   `applications.commands` scopes and the permissions in
   [admins.md](admins.md).
5. **Activities → Settings**: Activities on. **URL Mappings**: the
   Activity's production address.
6. **App Verification** (offered once the app is in enough servers):
   answer the questionnaire on what data the app keeps and why, then
   submit. The answers match the published privacy notice.
7. Verify the Activity as Discord's Activities pages ask. Whether this is
   part of the same submission or a step of its own is **not confirmed**.

## The Activity

- **Unverified**, an Activity is visible only to the app's team and its app
  testers, and launches only in servers with fewer than 25 members.
- **Verified**, it launches in any server, whatever its size.
- Discord recommends a separate unverified app for development and testing
  beside the verified one for release (below).

## Commands

- The bot registers **globally** for launch (`MMO_COMMANDS=global`,
  `bun run register --global --clear-guilds`); the test servers keep guild
  registration (`MMO_GUILD_IDS`). See the [README](../README.md).
- Discord allows 100 global slash commands, 15 message commands and one
  Primary Entry Point command (the Activity's launch command, which
  Discord creates when Activities are switched on). The manifest has 12
  slash commands and 1 message command.
- A bulk overwrite replaces every command type at once. The bot's global
  registration sends the entry point command back with every overwrite, so
  the Activity's launch command is never dropped.
- Creating commands is limited to 200 creates a day; a bulk overwrite's new
  commands count. The bot changes nothing when Discord already holds the
  same manifest, so restarts spend none.
- Guild commands change at once. How long a global change takes to reach
  every server is **not confirmed** (Discord's page no longer states it);
  a client holding an old version is refused and reloads.

## Rate limits

- **50 requests a second** across the bot's REST calls. Interaction
  replies do not count against it, which is why every press is answered
  through its own interaction.
- **Invalid requests** (401, 403 and 429 answers) above 10,000 in 10
  minutes block the bot's address for a while.
- **Per route**, measured by spike D: about 1 edit a second sustained on one
  message, about 1.3 posts a second to one channel, and thread creation
  sharing a bucket of 50 every 300 seconds. The bot keeps public posts and
  edits at most one every 2 seconds a channel and opens at most 40 threads
  every 300 seconds, with a soft cap of 500 open threads.
- **The gateway** takes 120 events a connection a minute, and 1,000
  identifies a day across all shards.

## Sharding

Each gateway connection (a shard) serves at most 2,500 servers, and an app
in 2,500 or more must shard. The bot runs one connection; at 250 servers it
needs nothing. Plan the change at about 2,000 servers.

## A separate app for testing

Keep the test app apart from the verified one, and never verify it:

- its own application, token and app id, in its own `.env.local`;
- `MMO_COMMANDS=guild` with `MMO_GUILD_IDS` naming the test servers only, so
  its posters follow only those servers;
- its own world, never the production one;
- its Activity unverified, which is enough for test servers under 25
  members and the team's app testers.

## Not confirmed

- Whether unverified apps are still capped at 100 servers after Discord's
  June 2026 change to the privileged data review.
- That the team owner's identity check runs through Stripe, that two-factor
  authentication is required, and the exact list the App Verification form
  asks for.
- Whether the Activity is verified in the same submission as the app.
- How long a global command change takes to propagate.
- Which thread operations need Manage Threads: spike D measured that the bot
  archives its own threads without it; reopening a thread a moderator
  archived or locked is taken from Discord's documented thread rules and was
  not measured.

## Sources

Read on 26 November 2026:

- Discord blog, "Updated requirements to how apps access data in servers",
  10 June 2026: `https://discord.com/blog/updated-requirements-to-how-apps-access-data-in-servers`
- Gateway, sharding and limits: `https://docs.discord.com/developers/events/gateway`
- Application commands: `https://docs.discord.com/developers/interactions/application-commands`
- Rate limits: `https://docs.discord.com/developers/topics/rate-limits`
- Discord's Developer Help Center articles on getting an app verified and on
  how friends can play an Activity (search results only; the pages refused a
  direct read).
- Spike D's measurements (`spikes/D-discord-platform.md` in the game
  drafts).
