# Launch checklist

The owner's steps from the closed test to season one, in order. Each says
what to run or which page to open, and, in brackets, what is built up to
it. Nothing here is done by a build; every step is the owner's.

The launch world is the closed test's kept world: season zero (14 world
days) is the closed test, and season one (42 days) opens at its close and
takes the launch book as its rules epoch. When the closed test has not
started yet, steps 3 to 5 come first.

## 1. The closed test and season zero

[The bot's tester note says the world is kept and how `/forget-me` works;
`/forget-me`; the export.]

- Run the two-week closed test with 20 testers.
- **The gate:** 12 of the 20 still playing in the second week.
- At its close: `op export -out <dir>` ([export.md](export.md)) for the
  tuning pass and the real peak presses a minute ([load.md](load.md)).

## 2. The tuning pass and the launch book

[Report before and after against the last epoch file; `harness all`;
`harness report -check`; the export.]

Decide the open balance items, each reported under its target in the
suite's `report.md` with options and a recommendation:

- `staging-stays-local`;
- the closed-world emergence rows (`emergence-loop`,
  `promotion-each-type`, `pairing-share-falls`);
- `even-fight` by tier, and the party rows (`even-fight-party-*`,
  `party-solve-rate-*`, `party-help-measured`), from real solve times;
- `tier-2-level-20`, `first-class-unlock` on the small seed,
  `guild-founds` and `city-takes-season`;
- `top-kinds-near-median` (Craft's and the build climb's) and
  `richest-loop-band` (the loop climb);
- Economy at 10,000 near its floor, and `invitation-days` as a floor;
- the real peak for `load-tick-inside`;
- `puzzle-solve-rate` at the build climb's highest tier.

Then tune, and read the change:

```sh
cd services/mmo-world
go run ./cmd/harness all -soak -out <dir>
go run ./cmd/harness report -in <dir> -sheets-from <the world's book>/services/mmo-world -strict
go run ./cmd/harness report -in <dir> -write harness/epochs/
go run ./cmd/harness report -check
```

Commit the sheets with their epoch file ([epochs.md](epochs.md)).

## 3. Backups on the platform

[`scripts/backup.sh`, `scripts/restore.sh`, `op verify`, the Dockerfile's
`backup` target, [backups.md](backups.md).]

- Create the backup service in each environment from
  `services/mmo-world/Dockerfile`, target `backup`, with `DATABASE_URL` and
  `MMO_WORLD_ID`, and a private bucket for its output (the copy to the
  bucket and the pruning are the service's settings; the scripts write to
  a directory).
- Schedule and keep it as [backups.md](backups.md#schedule-and-retention) says.
- Run the restore drill on a staging copy, never on production
  ([backups.md](backups.md)).

## 4. Keys

[[keys.md](keys.md); every token setting takes `new,old`.]

- Put each world's `MMO_MASTER_SECRET` in the password manager; nowhere
  else.
- Rotate any token that ever left its environment.
- `MMO_FORGET_TOKEN` stays unset until the MMO's own web surface has a
  deletion path (step 7); `/forget-me` and `op forget` need no token of
  their own.

## 5. Deploy

[The `mmo-epoch-notes` migration; the world's start on the new book;
the [README's deploy order](../README.md#deploy-order).]

Follow the [README's deploy order](../README.md#deploy-order), its step 1
(a backup) included. This deploy adds:

- In the migrations step, the `mmo-epoch-notes` migration, on staging,
  then production.
- In the world step, a choice. A world that has not started its season
  clock starts once with `MMO_SHEETS_FROM=<the world's sheets digest>`
  (`sheets` in `op backup-manifest`), watches for `SHEETS RESTAMPED`, then
  unsets it. Otherwise it takes the new book as a rules epoch (step 6,
  [epochs.md](epochs.md)).

## 6. The epoch at season one's boundary

[The epoch at the close, its notes and card, the dry run at open, the
roll-key step; [epochs.md](epochs.md); `scripts/epoch-root.sh` puts the
world's current book at the image's second root, `/app/epoch-from`.]

- A backup first.
- Before season zero closes, follow [epochs.md](epochs.md#deploy) steps
  1–2 with the closed test's commit as the current book and this build as
  the new one. Add `MMO_ROLL_EPOCH_NEXT` only if a derived roll key (not
  the master) ever leaked; a leaked master needs a new world
  ([runbooks/leaked-key.md](runbooks/leaked-key.md#the-master-secret)). A
  book that cannot run the world fails this deploy, not the close.
- At the close watch for `EPOCH TAKEN` in the world's log and the
  rules-epoch notes card in each server's chronicle channel.
- Then set `MMO_SHEETS_ROOT` at the new sheets and, if it stepped,
  `MMO_ROLL_EPOCH`; unset `MMO_SHEETS_NEXT` and `MMO_ROLL_EPOCH_NEXT`.

## 7. Publish the legal text

[The drafts' text, in `src/components/legal/GameTermsDraft.tsx` and
`GamePrivacyDraft.tsx`, imported by no route; they move out with the
MMO's split from the site. Not built: the MMO's own web surface on its
subdomain, whose shape is the owner's to settle.]

- Review the drafts and publish them on the MMO's own web surface, with
  their effective and last-updated dates. The game's terms, privacy notice
  and admin docs live there, not on the site.
- If that surface gets a deletion path, set `MMO_FORGET_TOKEN` on the
  world and on it ([forget.md](forget.md)); until then `/forget-me` and
  `op forget` are the deletion paths.

## 8. Discord

[`services/mmo-bot/docs/verification.md`; global command registration;
posters that follow the servers the bot is in.]

- Verify the team owner's identity in the Discord Developer Portal.
- Publish the game's terms and privacy first (step 7): verification asks
  for their addresses.
- Submit the application's verification at 75 servers, before season one
  opens to servers that are not the owner's, and the Activity's
  verification before opening (an unverified Activity plays only in
  servers under 25 members).
- Move the commands to global as the bot's
  [README](../../mmo-bot/README.md#register-the-commands) says ("Moving to
  global").
- Keep a separate unverified application for testing.

## 9. The second server and onward

[`services/mmo-bot/docs/admins.md`; posters per server; the two-server
run on one world.]

- Invite the bot to a server that is not the owner's; its admin saves the
  `/admin` settings, which installs the server's guild at the nearest
  free start.
- Watch season one's first world day in both servers: each its own guild,
  settlement, settings, staging, events and chronicle.

## 10. The one-week soak

[The full soak's tooling: `scripts/full-soak.sh` locally, the scripted
season over HTTP.]

- Run the launch build on staging for a week before season one opens,
  with the scripted players: `harness season -live <the staging world's URL> -servers 2 -out <dir>` with the staging world's tokens.
- Then `op audit`, `op replay` and the tick ring
  (`/v1/operator/ticks`) on staging.

## 11. Other owner steps before season one

- Apply the `mmo-map-seen` migration on staging, then production; set a
  new `MMO_MAP_TOKEN` on the world in both environments.
- The site's env (staging first): `MMO_WORLD_URL` to the world's private
  address and `MMO_MAP_TOKEN` to the same secret.
- The edge cache: a map chunk shows `cf-cache-status: HIT` on its second
  fetch; the overlay shows `DYNAMIC` and `private, no-store`.
- Look at the map on staging three ways (anonymous, signed in without a
  character, with one): the dim, the ages, the frontier, `?server=`, and
  the first draw in a browser's Performance panel.
- In the test servers: `/map` and the Activity's Map screen.
- PostHog: add the map's `source: "map"` to any insight that lists sign-in
  sources.
- The `mmo-house-log` migration; register `/admin`, `/staff`, Report and
  `/chronicle` again; the servers' roles and channels (events, chronicle,
  log, the alarm role, the staff role opened to `/staff` in Integrations).
- Stage live in the test servers once as an admin and once as staff, and
  read the log channel; run the staged-goods gate's live week; confirm
  the staging item GDD 21 records as rejected.
- Look at the cards in Discord: staff and admin cards, the staged marks,
  the theft cards, and the Activity's `?mock=staged-hunt`, `?mock=vault`
  and `?mock=theft`; decide which thefts post to events; run the Embed
  Debugger checks.
- Narration: set the model key, take the real cost sample, set
  `MMO_NARRATION_DAY_USD` and turn `MMO_NARRATION` on; read the arc
  proposals and the weekly digest.
- Review the season and card art in the test servers.
