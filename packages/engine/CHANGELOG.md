# Changelog

All notable changes to `@jams/engine`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package
uses its own semver: on 0.x a breaking change bumps the minor. Besides the
usual sections, **Format** records scene format (`v`) changes and **Agent
surface** records issue codes, ops, JSON Schemas and CLI commands, all of
which are public contract.

## [0.14.5] — unreleased

Live levels on a host: the editor's seam for publishing single scenes
over a channel's release. Without the new host member the editor behaves
as before. Also an engine-side broad phase for Rapier queries and the
follow-ups the engine's live levels left.

### Added

- `@jams/engine/editor-ui`: `EditorLiveHost`, the optional `live` member
  of `EditorPublishHost`, through which the editor reaches a host's live
  scene versions: `base(scene, channel)` (the channel's release manifest
  and the scene as players have it, for the Publish scene checks),
  `publish(versionText, texts, opts, onProgress)` (begin, each missing
  text, commit, then promote when production is chosen), `list`,
  `promote`, `rollback`, `clear`, `unblock`, `usage()`, `role()` and
  `wording`; with its types `LiveBaseView`, `LiveMove`,
  `LivePointerView`, `LivePublished`, `LivePublishOptions`,
  `LivePublishProgress`, `LiveUsageView`, `LiveVersionView` and
  `LiveWording` (the host's numbers, written by the host).
- `@jams/engine/scene`: `shortId` and `SHORT_ID_LENGTH`, a release or
  scene version id's first six characters (`3fa9c2…`), the one rule the
  editor's release list and the CLI's release and live lines share.
- `@jams/engine/game`: `sceneVersionName(scene, number)`, how a host's
  numbered scene version is named (`level-1@4`, grouped as
  `level-1@1,000`), the one rule the editor, the site, the CLI and the
  standalone frame's preload issues share;
  `arrivalWords(timing)`, when players get a moved version as a sentence
  ends (`the next time the level loads`, `at the next safe moment`,
  `now`), shared by the production confirms and a host's Stop sentence,
  and read with `timingWords` and the Publish scene timing labels from
  one table of each timing's words; `releasePromoteMessage(version)` and
  `releaseRollbackMessage(version, live)`, the questions a release
  promote and rollback ask first, shared by the editor's Publish panel
  and a host's game page; and `versionName`, until now on `.` only.
- `@jams/engine/project`: `sceneVersionDataBytes(text, version)`, what a
  host's data limit counts for a scene version (its `scene-version.json`
  plus each doc it carries once: the scene, its prefabs and the docs they
  use, such as materials and tables), the one rule the editor's Data
  line, the CLI and a host's refusal share; the README's Data per version
  row says the same. And `utf8Bytes`, until now on `.` only.
  `@jams/engine/game`: `SWAP_TIMINGS` and `swapTimingSchema`, so a host's
  and the CLI's timing inputs read the engine's list.
- `@jams/engine/editor-ui`: Live scenes lists each scene's newest version
  no channel plays, when it is newer than every version one does
  (published on no channel, or saved by a production publish whose move
  was refused), under 'Not live yet' with Promote to preview and, for
  publishers, Promote to production, which asks first and offers the
  timings the game declares (the others disabled); a blocked one shows
  its reason with Unblock, which asks first, as a live row does.
- `@jams/engine/editor-ui`: `EditorLiveHost.onPublished(listener)`,
  optional: the host calls it after each publish that went through, and
  the Publish panel's Live scenes list reloads on it, so a version
  published from the toolbar shows there at once.
- `castSpawn(ctx, at, shape, opts?)` takes `opts.exclude`, entity ids
  whose colliders neither block the start nor stop the cast; the
  platformer's swap rescue now passes its player instead of gating the
  player's collider to groups 0.
- An engine-side broad phase for Rapier: `PhysicsWorld.collidersNear(box)`
  and `PhysicsWorld.moved(bodyOrCollider)`. Fixed colliders sit in a
  spatial hash (built lazily at the first query, cell fitted to the median
  collider), colliders on moving bodies are read as they stand, so
  `ctx.space` sweep, overlaps, raycast and pointAt (and castSpawn's Rapier
  cast) test only nearby colliders: 4000 queries over a 300-collider scene
  went from 545 ms to 127 ms with the same hits, and loading costs nothing
  extra. A fixed body moved by code outside the engine's systems calls
  `moved` or `refreshQueries`.
- `@jams/engine/editor-ui`: Publish scene in the editor's toolbar, shown
  when the host's `publish.live` is given: one dialog for the open scene.
  It picks Preview, or Production for publishers (asking first), and one
  of the timings the game declares in `GameDefinition.live.timings`, the
  others disabled. It takes a note whose limit and placeholder come from
  the host's `LiveWording`. Its checks run on open and on each edit:
  validation and fit to the channel's release, the diff against what the
  channel plays and whether players' worlds update in place or are
  rebuilt, data size, today's count, and who edited since the last
  version. Publish builds the doc as it is at that moment, publishes
  through `EditorLiveHost.publish` with progress, and shows the host's
  refusals in the dialog.
- `@jams/engine/editor-ui`: the Publish panel lists Live scenes under the
  channels, one row per pointer per channel (title · level-1@4 · timing ·
  time ago · who), with Promote to production, Roll back and Stop (Stop
  asks with the host's `LiveWording.stopConfirm`); a blocked version
  shows its badge and reason with Unblock, which asks first ('Players
  will get level-1@4 again.'); versions due for cleanup show the host's
  forecast line; an empty project says 'No live scenes. Publish a scene
  from the editor to update one level without a release.' The section
  appears only when the host supplies `publish.live`.
- `@jams/engine/editor-ui`: promoting a release asks 'Promoting v8
  replaces these live scenes: …' and, for publishers, offers Keep (off by
  default) for each live scene that still fits the new release, passed as
  `keepScenes` to `EditorPublishHost.promote`. A release rollback's
  skipped live scenes are said as warnings. `PublishPanel` takes an
  optional `sceneTitle` to name the rows by title.
- The scene CLI's `game live publish|list|promote|rollback|clear` and the
  scene MCP server's `game_live_publish`, `game_live_list`,
  `game_live_promote`, `game_live_rollback` and `game_live_clear` tools
  over them: preview only for agent tokens, the token and site from the
  environment; `publish` swap-checks a boundary or now move from what
  players have unless `--no-swap-check`.

### Changed

- `@jams/engine/editor-ui`: `EditorPublishHost.promote` takes an optional
  `{ keepScenes }` (live scenes that stay on the channel over the new
  release), and `rollback` answers a `ReleaseRollback`: the `PointerMove`
  with the live scenes it restored and those it skipped, each with its
  sentence. Existing hosts fit both unchanged.
- `PhysicsWorld.refreshQueries` no longer disturbs velocities: it still
  steps by zero (Rapier 0.19 updates its broad phase, which character
  controllers read, only inside a step) but puts every dynamic body's
  linear and angular velocity back, so a jointed chain no longer jumps to
  ~1000 m/s on an add, update or remove in Play, a sublevel attach or a
  play-from-here cast; the live swap's own velocity restore is gone. No
  determinism pin moved (platformer goldens, behavior-yard checks and the
  swap bit-exact tests unchanged).
- A scene's `flow.scenes` entry (release and scene version alike) lists
  the prefabs only its fields name (a spawner's `prefab`) in `prefabs`, so
  a version carrying a changed spawner prefab replaces it instead of
  failing rule 6 with live-asset-conflict; release ids change for scenes
  with such prefabs (the engine project's behavior-yard).
- `SceneRuntime.load(scene, play?, as?)`, `GameInstance.play(doc, opts?,
as?)` and `replay(doc, rec, { sceneId })` take the scene's asset id,
  which saves, live versions and the recording key on when the doc's name
  isn't its id; editor Play passes it, so Live in Play updates a scene
  whose name differs from its id.
- `selectionBounds` redocumented as the outline/gizmo box; framing uses
  `frameBounds`.
- `@jams/engine/editor-ui`: a Live scenes row reads like a release row:
  the scene's title with its badges (blocked, hidden, removed soon,
  removed), then `level-1@4 · next load · 12m ago · Jo` muted; a hidden
  version shows staff's reason, and a hidden or removed one offers no
  Promote. Roll back on production asks first. The blocked line gives the
  reason after the badge, without repeating "Blocked". The production
  confirm reads 'Players will get level-1@4 the next time the level
  loads.' The release promote holds its Promote button while it reads
  the live scenes it replaces, and says so when it can't read them.
- `@jams/engine/editor-ui`: the Publish scene dialog clears a refusal
  when Where, When or the note changes or Publish is pressed, never when
  an edit runs the checks again, and no longer repeats a blocking check
  as a refusal. It and Live in Play build the open scene through one
  helper.
- `@jams/engine/editor-ui`: the Publish scene checks run again on a change
  to the scene, the project doc or any doc the version carries (a prefab
  edited elsewhere), and the docs they open stay open until the dialog
  closes instead of being reopened on every build. When the host can't
  say today's count or the scene's versions, the checks say so; a channel
  whose base doesn't load offers Try again. Production's choice reads
  'Production: players get it.', with 'Only publishers can choose this.'
  on the disabled choice, and the release beside each choice takes the
  choice's size. The Checks list is labelled by its heading, which sits
  outside the list.
- `@jams/engine/editor-ui`: Live scenes says a scene's cleanup forecast in
  one line ('3 versions of The ford will be removed, the first on
  20 Nov 2026. Point a channel at one to keep it.'); Unblock holds the row's other moves
  while it runs, and a preview row's Promote holds its Roll back and Stop;
  the game's settings show only to publishers when the host's live role
  says so.
- `@jams/engine/editor-ui`: the toolbar's Publish scene button has its own
  icon (a cloud upload), apart from the Publish panel's rocket, which
  manages releases.

### Fixed

- The editor's Run panel disables Replay for a run whose load attaches a
  sublevel on a live version the editor doesn't have, which the replay
  can't start without; it said the replay would stop at 0.0s. The panel
  and the replay now share one rule for where a replay stops (`replayGap`
  beside `createSwapReplay`).
- `parseRecording` refuses `swaps` out of tick order or past `ticks`
  (path `/swaps/i/tick`). A swap at `ticks` itself stays valid: a swap
  lands after its tick's step, so Stop, `recording.request` or a crash
  right after one writes it there, and a replay ends before it.
- `setMode('play')` with no scene loaded remembers the editor camera, so a
  later Play and Stop no longer leave the follow camera in edit mode.
- Tactics: a walk whose next cell the grid refuses ends on the cell the
  unit reached (state and pose), instead of snapping to the path's end
  past the blocker.

### Agent surface

- AS 20: `vp run scene game live publish|list|promote|rollback|clear`
  (preview only for agent tokens; the swap check runs before a boundary
  or now move unless `--no-swap-check`) and the MCP tools
  `game_live_publish`, `game_live_list`, `game_live_promote`,
  `game_live_rollback` and `game_live_clear`.

### Internal

- Site only, no engine surface change: jams.team's project quotas gain
  `liveVersionBytes` and `liveVersionsPerDay` (`checkLiveQuota`,
  `checkLiveChannelQuota`), its stored usage gains `liveVersions`
  (`{ kept, bytes }`) and `liveToday`, and the Usage lines gain a
  live-versions-per-day line.
- Site only: a release promote or rollback now resets or restores the
  channel's live scene pointers (`keepScenes` on promote, `restored` and
  `skipped` on rollback), sets `live_rev` and announces the move; a
  release committed to preview announces its move once it commits.
- `input-script` and `ops` schemas memoized through `builtFor`;
  lifecycle's spawn-schema map dropped; one `prefabReader` in scene/prefab
  for export, snapshot and scene-version reads; `generationOf` exported
  from runtime/pool for runtime/live.
- Site only: `GET /api/engine/live/<projectId>/stream?channel=preview|production`,
  the live stream (`event: live` with `{channel, rev}`; closes after
  `LIVE_STREAM_MINUTES`), behind the play page's gate; the forum's stream
  shares its server-sent-events helper and in-process broadcast.
- Site only: the play payload carries the channel's live state (`live`)
  for latest and preview, and is null for numbered and jam versions; new
  `getGameLive({ projectId, channel })` for play pages, behind the play
  gate, with a 5 s in-process cache keyed by project, channel, rev and
  release. jams.team's publish host gains `live` (the editor's
  `EditorLiveHost` over the live procedures and routes).
- Site only: the `engine_live` migration (scene versions, their files,
  per-channel scene pointers, player reports, `live_compat_key` on
  releases, scene uploads on the upload row), and the live procedures and
  their REST twins for agent tokens: begin and commit (the release upload
  protocol, one shared quota and role rule), list, get, base, promote,
  rollback and clear (one pointer writer, `pointScene`, checked by
  `checkPointerTarget`), block, unblock, hide, unhide, the staff queue and
  players' reports.
- Site only: a scene version's commit checks the day's count and release
  storage again under the project's lock; begin counts its hourly limit
  per person and per agent token, and a version the project already holds
  answers its number without counting against the day; a rollback without `to` goes
  back past a release move that cleared or restored the scene; a
  timing-only move keeps the pointer's `updated_at`, which the breaker's
  window starts from; the version list reads every stored version but only
  each scene's five newest removed ones, and each pointer's latest mover;
  `getProjectUsage` answers the caller's `role`, so a game's editors get
  the editor's live publishing with production off.
- Site only: the frame route serves `live/<sha256><ext>` under a release
  whose compat key a kept, unhidden version shares (410 'This level was
  removed' for a hidden one); the collector drops scene versions past the
  five kept per scene after the release grace, their texts a day later,
  and reports after 30 days.
- Site only: play pages follow their channel's live scenes (stream, else a
  60 s poll), report each version's outcome, and report a crash within
  10 s of a swap; the breaker blocks a version when, within 30 minutes of
  its move, 5 players and at least a quarter of those reporting fail on
  it. The game page names its live
  levels and, for publishers, blocked ones; staff hide and unhide versions
  from the admin queue; the terms and privacy pages say how live updates
  and their reports work.

## [0.14.4] — unreleased

Live levels in the engine: a published scene version can be staged and
swapped into a running game at a timing the game accepts, with the game's
migration hook, recorded and replayed, and checked headlessly. A run
that doesn't use them behaves as before, except that a hosted standalone
frame now records each scene's run (up to 30 minutes) so the page can ask
for it.

### Added

- `@jams/engine/game` and `.`: `SwapTiming`, `SwapStrategy`, `SceneDiff`,
  `SwapSide`, `SceneSwap`, `LiveDeclaration`, `LiveContext`,
  `LIVE_DEFAULTS` and `clampTiming(live, wanted)`, which keeps
  `next-load` always and drops a timing the game doesn't list to the
  strongest listed one below it.
- `.`: `swapStrategyFor(diff, wanted?)` (the one rule a swap, the swap
  check and `game live check` choose reconcile or reload by),
  `versionName(scene, version)` (`level-1@<12 hex>`, or the release's
  own), `timingWords(timing)` and `acceptedTimings(live)` (how a timing
  reads, and the timings a game takes, `next-load` first),
  `acceptedTimingsWords(live)` (those timings as the words after "this
  game accepts ": `only next load`, `boundary and next load`, strongest
  first; the editor and `live-timing-unsupported` word them with it),
  `diffWords(diff)` (`3 entities changed, 1 added, 1 removed`,
  `the scene's header changed` or `nothing changed`; the editor's and the
  CLI's swap summaries), and `utf8Bytes(text)`.
- `@jams/engine/game` and `.`: `LIVE_CHECK_AGAIN_TICKS` (60), how long
  after a swap the game's `live.check` runs a second time.
- `GameDefinition.live`, `GameRuntime.onSwap(swap)` and `ctx.live`
  (`version`, null for the release's own scene, and the version the load
  plays inside its `onLoad`, and `boundary(label?)`, which counts only
  inside a step: one from `onLoad`, `onSwap` or between ticks marks
  nothing).
- `GameInstance.live` (`stage`, `activate`, `current`, `pending`, `pin`,
  `unpin`) and `StagedVersion`; `GameInstance.replay` takes
  `{ versions? }`; `GameEventMap` gains `live:swapped` and `live:failed`.
- `SceneRuntime.swap(next, { prefabs, strategy? })` and `SwapReport`.
- `@jams/engine/project`: the `scene-version:v1` record (`SceneVersion`,
  `LiveCompat`, `SCENE_VERSION_VERSION`, `SCENE_VERSION_SCHEMA_ID`,
  `scene-version.schema.json`, exported as
  `@jams/engine/schemas/scene-version.schema.json`): `sceneVersionSchema`,
  `sceneVersionJsonSchema`, `parseSceneVersion`, `formatSceneVersion` (the
  release manifest's canonical writer), `sceneVersionId`,
  `liveCompat`/`liveCompatKey`, `checkSceneVersion` (the eight
  compatibility rules; `live-incompatible` with `detail.rule` `game`,
  `formats` or `build`, `live-scene-unlisted`, `live-physics`,
  `live-asset-conflict`, `asset-missing` and `schema`; it takes
  `CheckSceneVersionOptions`, `{ registry?, names?: { version?, release? } }`),
  `sceneVersionSnapshot`, `findSceneVersion`, `buildSceneVersion` and
  `readSceneVersion` (the one reader of a version for play, taking
  `{ engine? }`).
- `buildSceneVersion(opts)` (`./project`): builds a scene's
  `scene-version:v1` from a project view and canonical texts (files or docs
  give the same id); reads the scene as Play does, takes its release entry
  (physics, prefabs, bundle, title, sublevel), carries the scene, its
  prefabs, its bundle and their references under `live/`, stamps this
  code's compatibility, and with `release` sets `base` and returns
  `checkSceneVersion`'s issues.
- `SceneRuntime.swap` reconciles a new version of the loaded scene between
  ticks: remove, then add, then update, in scene order, through the same
  spawn and despawn code the editor's add, update and remove use. Runtime
  spawns, entities destroyed at runtime (even if their definition changed)
  and disabled entities keep their facts. A changed entity whose authored
  pose (spawn pose, transform, type) didn't change keeps its runtime pose,
  every owner's save state and its bodies' motion; when the designer moved
  it, the new definition wins. The version's prefab library is frozen for
  `ctx.instantiate` from the next call, and reloading the main scene uses
  that version and library. `undo()` and a refused step put the old
  version and library back. When the world can be saved at world depth,
  they restore it exactly from a world capture; otherwise, on Rapier for
  example, by the inverse reconcile, which matches the world at the moment
  of undo. A header change or `strategy: "reload"` reloads instead
  (below). A refused step gives `detail.reason: "refused"` and
  `detail.entityId`.
- `SceneRuntime.swap` reloads when the scene's name, bounds or settings
  changed, when `strategy: "reload"` is asked for, or when a reconcile step
  refused: at world depth when the run can be captured there; otherwise,
  for a refused update, at progress depth after the inverse reconcile (a
  refused add would refuse again in the fresh load, so it keeps the running
  world and reports the refusal). The run is captured with `captureSave`
  (world depth unless `worldSaveBlockers` names a cause, else progress),
  the new version loads fresh under the main scene's flow identity with its
  prefabs as the library (the game's `onLoad` runs) on the tick the run is
  at, and the capture is restored in a save restore's order (the game's
  `restore` runs; `onSwap` never does), so `ctx.tick`, the recording and a
  replay carry on through a progress-depth reload. `SwapReport.carried` is
  `"all"` for a reconcile and `"world"` or `"progress"` for a reload,
  `strategy` is `"reload"`, and `undo()` loads the old version again and
  restores the pre-swap capture at the same depth. A failed reload puts the
  old version back and reports `live-swap-failed` with
  `detail.reason: "refused"`; when putting it back fails too, the hint says so. An
  `undo()` that can't put the old version back throws with its cause.
- `GameInstance.live`: `stage(version, { signal })` reads, validates and
  expands a scene version, adds its assets to the loader's view for that
  scene's loads, and preloads its bundle within
  `LIVE_DEFAULTS.preloadTimeoutMs` (a timeout or abort refuses with
  `live-swap-failed`, `detail.phase: "stage"`); swaps run between ticks
  after any flow request, never while paused, during a scene change or in
  a replay, and never move or zoom the camera; flow loads and sublevel
  attaches read each scene's active version. `activate` also returns an
  `issue`: `live-timing-unsupported` (a warning) when the timing was
  clamped, `live-swap-failed` when the version isn't staged.
- The live layer behind `GameInstance.live` (internal, `runtime/live.ts`):
  stage keeps one staged version per scene; activate clamps the timing and
  is ignored while pinned; `next-load` waits for the scene's next load,
  `boundary` and `now` swap after the tick, one per scene in scene-id
  order, never while paused or during a scene change; `GameRuntime.onSwap`
  runs once after the swap, and a throw undoes the swap, destroys what
  `onSwap` spawned, emits `live:failed` (`live-swap-failed`, phase
  `onSwap`) and keeps the version for the next load. When the run can't
  be captured at world depth (any Rapier scene), the undo is the inverse
  reconcile, so what `onSwap` changed outside the diff before it threw (a
  pose, a draw from `ctx.random`) stays changed. A version of a scene
  attached as a sublevel of the one playing comes back from `activate` as
  `next-load`, clamped: the attached sublevel keeps running as it is, and
  its next attach, in the same run or a later one, uses the version. An
  attach reads a scene's active version once it moved since the running
  scene's load; until then, the library the run loaded with.
- `liveSceneSource(base, live)` and `LiveSceneVersions` (`.`): a
  `SceneSource` that answers `scene(id)` with the scene's active live
  version (`live.sceneFor(id)`) before `base`'s, with `list` and `start`
  from `base`; every flow load and the sublevel library built from it get
  the version.
- The flow host's `left(scene)` option: called once a change has left a
  scene for a loaded one (the same scene on a restart), so the live layer
  drops that scene's pending swap; a failed change keeps it.
- `@jams/engine/scene`: `diffExpanded(prev, next): SceneDiff` (added and
  changed ids in `next`'s order, removed in `prev`'s, `header` when the
  name, bounds or settings differ), `RecordedSwap`, and `liveIssue`, which
  words the live-level codes with their values.
- A kinematic `body` turns: `ctx.bodies.setAngularVelocity` sets its
  angular velocity (rad/s), it turns about its entity's pose on Rapier and
  without physics, and the `body` behavior keeps it in world saves; a
  kinematic body with `fixedRotation`, a character, a motion body and a
  follower still refuse with `body-not-dynamic`. `kinematicBodyEntry` takes
  `KinematicMotion`, whose optional `angularVelocity`/`setAngularVelocity`
  let an owner's body turn.
- `createMotionBody` takes `controller` (`CharacterControllerOptions`,
  default `TOP_DOWN_CONTROLLER`; `pushDynamic` is Rapier's
  `applyImpulsesToDynamicBodies`), and its body answers `grounded()`
  (optional on `MotionBody` so game-written bodies still fit).
- `swapCheck` (`./headless`): plays each input script on the old version,
  swaps the new one in through the live layer's apply (timing `now`,
  strategy auto) at `LIVE_DEFAULTS.checkAt` of each run, steps
  `checkTicks` more, and runs the game's `live.check` right after the swap
  and 60 ticks later. It reports `onSwap` throwing or a swap step refusing
  (`live-swap-failed`), a step or the check throwing after the swap
  (`live-swap-failed` in phase `after`, or the `EngineError`'s own code),
  and the check's own issues per run as `{ script, at, tick, strategy, issues }`. With
  `checks` it runs the scene's checks file against the new version
  (`report.checks`). `issues` holds what kept a version or script from
  playing at all.
- `@jams/engine/standalone`: `createLiveController`, `LiveSceneEntry`,
  `LiveSnapshot`, `LiveStateMessage` and their schemas. The `jams-host`
  channel (still protocol 1) gains `hello.features` (sent only when
  `connectHost`'s `features` lists one), `welcome.live`, the page's
  `live.update` event and the frame's `live.state` event
  (`HostChannel.liveState`).
- Recording v2 takes optional `sceneVersion` and `swaps`; a run with no
  live version and no swap writes neither.
- Recordings write `sceneVersion` (the live version a segment started on,
  omitted for the release's own scene) and `swaps` (each applied swap's
  tick, version, strategy, timing, sceneHash and runHash, in order). A
  move of another listed scene during the segment (a version activated or
  pinned, or back to the release's own) is written there too, as a
  `next-load` entry at its tick that names it as `sublevel`, so a replay moves
  it before the attach that used it. The shell's session recordings also
  start with an entry for each other listed scene that runs a live
  version, and its replays start those scenes on the release's own. A
  scene moved after the load but before the first step follows an entry
  for the version it had at the load, so a replay's load attaches what the
  recorded load did. A run without
  swaps writes the same bytes as before. `recordedSwap(swap)`
  (`./headless`) turns a `SceneSwap` into its recorded entry.
- `@jams/engine/headless`: `fileSchemaIssue(file, issue, entityIds?)`, a
  script or checks file's issue as a `schema` scene issue naming the file
  (the swap check, `game new` and `game live check` word them with it).
- `replayRecording` takes `versions` (id -> `StagedVersion | null`; look
  one up with `findSceneVersion`): a segment's `sceneVersion` is read with
  `readSceneVersion` and played instead of the release's scene, and each
  `swaps` entry is applied before its tick through the live layer with its
  recorded strategy. A missing version is `scene-version-removed`: a
  recording that starts on one doesn't replay (blocked at load, path
  `/sceneVersion`); a swap's stops the replay at its tick (path
  `/swaps/<i>/version`, `detail.tick`). Staleness is judged per segment:
  the start's runHash against the start, each swap's strategy and runHash
  against what the replayed swap made; `ReplayReport.staleFrom` is the
  tick of the first one that differs.
- `HeadlessRuntime.live` (`HeadlessLive`): `GameInstance.live`'s members
  over a headless live layer, with synchronous `stage` and no preloading;
  a `now`/`boundary` activation swaps after the step it waits for (after
  its flow request), and a flow load uses the scene's active version.
  Headless runs keep `ctx.live`, and `runPlaytest`'s and replays'
  recordings carry `sceneVersion` from it.
- `GameInstance.replay` plays a recording's `sceneVersion` through
  `opts.versions` and applies its recorded swaps before their ticks
  through the live layer, as `replayRecording` does (one shared replayer):
  the recorded strategy, a `next-load` swap only staged and activated, and
  a swap whose tick passed, that doesn't apply, or that ran with another
  strategy or run hash reported stale (a dev warning). A version the host
  can't give ends the replay with `scene-version-removed` (at the start it
  doesn't start; at a swap it stops on that tick, `detail.tick`, reported
  on `live:failed`). The scene's own live version comes back at Stop, as
  does that of each scene a recorded `next-load` entry activated. Play's
  session recordings carry `sceneVersion` from `ctx.live.version`.
  `GameInstance.play(doc)` runs the doc as its own unless it is the active
  version's scene (the same scene hash): `ctx.live.version` is null, the
  recording has no `sceneVersion`, and the next swap's `from` names the
  doc's scene hash, whatever version the scene's loads use.
- `bootStandalone` in a hosted frame says `features: ["live"]` in
  `hello`. It stages `welcome.live` before `flow.restart()`: the start
  scene waits for its own version, up to 60 s, and starts on the release's
  own if that version is refused; the other scenes stage in the
  background. It hands each `live.update` to `createLiveController` and
  reports back as `live.state` events.
- `createLiveController({ instance, manifest, fetchText, report, files? })`
  fetches `live/<version>.json` and checks that its SHA-256 equals the
  version id, then runs `parseSceneVersion` and `checkSceneVersion`. Each
  carried doc is read from the release's own `data/` file when the release
  ships that hash, else from `live/`, and its hash is checked. It stages
  everything under one 60 s deadline, then activates at the pointer's
  timing. It reports `staging`, `ready`, `waiting`, `applied`, `refused`
  and `failed`, with one staging per scene at a time; a sublevel's version
  is `applied` at its next attach. A scene that
  leaves the snapshot goes back to the release's own. New:
  `LiveController.settled(scene)`, and `LiveControllerOptions.files`, the
  blob overlay that the standalone loader's URL function reads.
- Live in Play: a "Live in Play" switch in the editor's play controls, off
  by default and remembered per viewer. While it is on, each edit during
  Play (debounced 300 ms) is built into an in-memory scene version and
  staged and activated `now` on the running game, through the same stage,
  swap and onSwap path a live update takes; nothing is uploaded. The play
  bar's status line says "Applying live update…", then "Live update
  applied: 3 entities changed" (or "the scene reloaded (…)"), when a
  clamped timing will apply, or
  the issue, whose whole text a hint holds. A header edit reloads with
  capture and restore. The game's `live.check` runs right after the swap
  and 60 ticks later; its issues, and the last failed update's until one
  applies, go to the Problems panel marked "Last Live in Play run" and
  stay after Stop until the scene or a prefab changes, or the next Play. A
  failed update shows in the play bar's status line, not a toast; a
  failing onSwap is shown and Play carries on. Replaying a run (Replay in
  the Run panel) passes the versions Live in Play built this session; the
  Run panel says whether Replay plays all of a run's live versions, stops
  at a time it names (seconds, or a step in a turns or event game), or
  can't start (Replay disabled) on a version this editor doesn't have. A
  run with a live version this editor doesn't have says Replay here has
  only the latest versions Live in Play built since the editor opened, and
  one that stops partway says so, at the time it reached, worded as the
  Run panel words it. Editor UI:
  `EditorHostState.livePlay`, `LivePlayState`, `LivePlayStatus`,
  `EditorProps.onLivePlay`, `EditorProps.liveVersion` (the live versions
  the editor holds, which the Run panel checks a run against).
- The spawner takes `fields`, the fields each spawn of its `type` gets;
  their shapes, points and paths are placed at the spawn point, so a shape
  type (a prop, a solid) spawns by type.
- `translateEntityDef(registry, def, by)` on `@jams/engine/scene`: an
  entity def moved by an offset, or null when it has nothing to move.
- Input scripts (v2) take a `nav` step and `reaches` checks a `nav` list
  that send a nav agent to a point or after an entity, as the engine
  command `@nav { id, to }` (`NAV_COMMAND`, `NavDestination`); it is
  recorded and replayed as input, and an entity without a nav-agent ends
  the run blocked with `behavior-missing` (`dangling-ref` for a missing
  id).
- `InputState.commands()`: the tick's commands, engine ones included.
- A `behavior-conflict` warning for a `path-follow` that can't move its
  entity: a collider with no body or a static one, or a solid, prop,
  follower or sensor.
- `FramePanels.reveal` and `EditorControls.reveal`: bring refs a panel
  selects into the canvas's view.
- `@jams/engine/game`: `SLOT_RULE`, what a slot name is in the words every
  message about one uses (`slotNameIssue`, the save envelope's `slot`,
  `vp run scene save`'s `--out`): lowercase letters, digits and dashes,
  1–`SLOT_MAX_LENGTH` characters, starting with a letter or digit.
- `@jams/engine/project`: `sceneVersionOptions(input, scene, { texts?, release? })`
  and `SceneVersionSource`, `buildSceneVersion`'s options from a project
  read for export (its view, texts, game, registry and snapshot's build);
  `readReleaseScene(manifest, scene, texts, registry, game, { engine? })`,
  the release's own scene read for play by `readSceneVersion` against the
  release's assets (null when the release doesn't list it).
- `@jams/engine/scene`: `isErrorIssue(issue)`, whether an issue is an
  error, and `plural(n, one, many?, format?)` (`1 error`, `3 errors`;
  `format` writes the count), the one count-and-noun rule the editor, the
  live check's words and the scene CLI share.
- `@jams/engine/project`: `liveFiles` and `AssetFiles`, a scene version's
  file layout (`live/<sha256>.json`, `live/<sha256><ext>`) as the export,
  the standalone loader and the smoke share it.
- `castSpawn` and `CastResult` are exported from `@jams/engine/game`: a
  game's `onSwap` settles an actor the way play from here settles a start,
  carried along gravity onto the first non-sensor collider and refused
  inside one.
- README: a Live levels section after Publishing on jams.team: the three
  timings, what a swap keeps, the site's limits, delivery and blocking, the
  API in short (`GameDefinition.live`, `ctx.live.boundary()`,
  `GameRuntime.onSwap`, `GameInstance.live`, `swapCheck`,
  `game live build/check`, Live in Play) and two runnable examples
  (`ledge-game.ts`, `ledge-live.ts`).
- The host channel's `recording.request` event, a fifth addition beside
  the four live ones: a hosted frame offers its run's recording as a `download`
  (`<scene>.recording.json`), which replays headless with
  `replay --versions`; with nothing recorded it sends nothing.
- `GameConfig.recording.flow`: records the scene flow's run outside the
  editor's Play, one session per scene load (with its `sceneVersion` and
  swaps), ended as `flow` by the next load, or as `quit` after 30 minutes
  of play so a long stay keeps a bounded input log; a hosted standalone
  frame turns it on. `GameInstance.recording({ running: true })` returns a session
  still recording as Stop would end it now.

### Changed

- Decided: when a reconcile step refuses an add and the run can't be
  captured at world depth, `SceneRuntime.swap` refuses the swap (the live
  layer keeps the version for the scene's next load) instead of reloading,
  because the progress-depth reload's fresh load would refuse the same add
  after losing the running world.
- Decided: a hosted standalone frame always records each flow scene's run
  (at most 30 minutes per load), so the page's `recording.request` gets the
  run from its load; a frame no page hosts records nothing, as before.
- `bindSceneDoc` and `applyEntityDiff` use the shared expanded-scene diff;
  no behaviour change.
- The export plan and `buildSceneVersion` build their carried assets,
  release entries and prefab libraries through one module
  (`project/release-assets.ts`, `reachPrefabs`/`prefabLibraryFor` on
  `scene/prefab.ts`), and the standalone boot and the live controller
  fetch hash-checked doc texts through one reader; no behaviour change.
  A live version's assets keep their names and licences in the view its
  loads resolve through.
- Rapier `ctx.space.sweep` casts only at colliders whose bounds meet the
  swept box: the same hits, about twice as fast at 1000 colliders.
- Documented: a force area adds to a character's velocity, which its
  `decel` works against while idle: a weaker push builds no speed, a
  stronger one carries it at the difference.
- `sceneBundle` follows prefab asset fields (a spawner's `prefab`) into
  the named prefab's children, its header and the prefabs it reaches, and
  the export plan and `buildSceneVersion`/`readSceneVersion` add those
  prefabs to each scene's library; scenes without such a field bundle
  exactly as before.
- behavior-yard drops its `assets` header; its bundle (crates-texture,
  hero-texture) and its genre pin are unchanged.
- The camera's free mode (the editor's) only keeps the view from leaving
  the bounds entirely, instead of keeping it inside them and centring an
  axis the view is wider than; follow mode (Play) is unchanged.
- Scene CLI: `game new`'s behavior presets drop the hero's `player-input`
  at the win, so it comes to rest.
- The Publish panel's release list shortens a release id as the CLI does,
  to its first six hex digits and an ellipsis (`3fa9c2…`), not twelve.

### Fixed

- The dev collab server started without a build time (0) stamps its schema
  hashes at 0, not -1: one tick older than its build never goes below the
  undated floor.
- Play from here starts seat 0's `character-top-down` or
  `character-side-view` hero at the chosen point.
- Editor: f (Frame the selection) frames whatever is selected, wherever
  the selection was made, by the box the selection's outline covers, so a
  prefab instance (its children) and a sprite box frame too, where they
  used to frame the whole scene.
- Editor: a row selected in the outliner that is off-screen is panned into
  the part of the canvas the columns leave visible, never zooming; one
  already in view leaves the camera alone.
- Editor: a wheel zoom keeps the world point under the pointer, including
  with the scene smaller than the view and after framing into the visible
  canvas. Wheel turns reported in lines (Firefox) or pages become CSS px,
  about 100 a notch in every browser.
- Editor: a column's top group keeps at least 40% of the column, so at
  1024 px Project settings no longer leaves the outliner a few rows; a
  bottom group with no stored height starts at 40%.
- Editor: the layout on screen survives a change of the frame's panels (a
  rebuild at Stop, the late Publish panel), whatever the storage holds: a
  null or refusing storage, or one another editor tab wrote to, no longer
  reopens a collapsed column.

### Agent surface

- `AGENT_SURFACE_VERSION` is 19, and every committed JSON Schema's
  `x-agent-surface` with it; `scene-version.schema.json` is a new schema
  id.
- Issue codes `live-incompatible`, `live-scene-unlisted`, `live-physics`,
  `live-asset-conflict`, `live-swap-failed` and `scene-version-removed`
  (errors) and `live-timing-unsupported` (warn). `live-incompatible` with
  `detail.rule: "game"` carries no hint. `live-swap-failed` words a
  staging failure (`detail.phase: "stage"`) as the scene keeping the
  version it runs, and only a refused swap step or a throwing `onSwap`
  as loading next time; a step or the game's live check throwing after
  the swap applied is phase `after` (`LiveSwapPhase`, `./scene`), worded
  as applied; the swap check's run that ended before the swap has no
  phase. The swap check's script for
  another scene carries the playtest's hint.
- The recording schema's `sceneVersion` and `swaps` (`swaps[].sublevel`
  names the scene a `next-load` entry moved).
- The scene schema's spawner `fields`; the input-script schema's `nav`
  step and the checks schema's `reaches.nav`; the registry's command names
  gain `@nav`.
- `behavior-conflict`'s summary and hint cover a `path-follow` that can't
  move its entity.
- `game live build <project> <scene> [--hosted] [--out <dir>]` writes
  `scene-version.json` and a `<sha256>.json` for each text it carries, and
  prints the id, the data size and the files;
  `game live check <project> <scene> [--against <release dir|release.json>] [--from <version dir>]`
  checks the version against a release and runs the swap check from the
  release's scene or a built version; with neither flag it only validates
  and prints a warning; `replay --versions <dir>` replays a run's live
  swaps.
- The scene MCP server gains `game_live_build` (build one scene's version
  into `out`, or with `hosted` from a temporary pull of the hosted
  project; same fields as `game live build --json`) and `game_live_check`
  (`against` a release dir or release.json, `from` a version dir; same
  fields as `game live check --json`). `scene_replay` takes `versions`, a
  directory of scene versions and their texts, as `replay --versions`
  does.

## [0.14.3] — unreleased

The standard behavior library: bodies, colliders, input seats, character
controllers, camera targets, spawners, nav agents, path following, force
areas and joints are behaviors any loadable entity can carry, so a
designer builds a playable entity in the inspector and a project with no
game module plays. Game code reaches every body through `ctx.bodies`, and
nothing gates forces or input by which behaviors an entity carries. It
also closes 0.14.2's leftovers: one stated slot length, and the pixi.js
peer range that excludes the release that draws nothing on Apple GPUs.

### Added

- `BehaviorSystem.beforeStep(dtMs)` and `BehaviorSystem.beforePhysics()`:
  each tick a behavior system can act after the game's `beforeStep` and
  after the type systems' `beforePhysics`, before the physics step (without
  physics, right after the behaviors' `beforeStep`). With timing on, the
  host laps `behavior.<name>.beforeStep` and `behavior.<name>.beforePhysics`.
- `GeometryWorld.groups(handle)`: a geometry collider's packed collision
  groups, 0 while it is disabled or removed.
- `BehaviorDef.conflicts`: behaviors the same entity must not also carry,
  reported as `behavior-conflict`.
- `ctx.bodies` (`BodyControl`, from `@jams/engine/game`): any entity's body
  by id, whichever system owns it. Asking about an id with no body throws
  `body-missing`; a force, torque or impulse on a body that isn't dynamic,
  a velocity write on a static body or a follower, and an angular velocity
  write on a kinematic body throw `body-not-dynamic`.
- The eleven standard behaviors, registered with their schemas: `collider`,
  `body`, `player-input`, `path-follow`, `force-area`,
  `character-top-down`, `character-side-view`, `nav-agent`, `joint`,
  `spawner` and `camera-target` (`COLLIDER`, `BODY`, `PLAYER_INPUT`,
  `PATH_FOLLOW`, `FORCE_AREA`, `CHARACTER_TOP_DOWN`, `CHARACTER_SIDE_VIEW`,
  `NAV_AGENT`, `JOINT`, `SPAWNER`, `CAMERA_TARGET`, with `BODY_KINDS`,
  `JOINT_KINDS`, each block's type and the system interfaces). `body`,
  `character-*` and `force-area` require `collider`, `joint` requires
  `body`, and `path-follow`, `nav-agent` and the two character controllers
  each conflict with the others (`behavior-conflict`): each moves the
  entity.
- `player-input` behavior system: `{ seat }` (default 0) binds an entity to
  an input seat, so one entity is player 2 by a field. Its system
  (`PlayerInputSystem`, from `ctx.behavior("player-input")`) keeps
  `seatOf(entityId)` and one cached view per carrier, dropped on detach.
- `inputFor(ctx, entityId)` returns the seat's `SeatInput` over `ctx.input`
  for an entity carrying `player-input`. When the entity carries none, its
  seat has not joined, its seat has left, or it is disabled, the view reads
  as nothing held and `seat` is null. A block update moves the entity to its
  new seat from the next tick. Repeat calls for one entity return the same
  view, with no allocation.
- `collider` behavior: a collision shape on any entity, local to the
  entity's pose. Without a `body` it is a fixed body; with `sensor: true` it
  raises `sensor:enter` and `sensor:exit` as the `sensor` type does. It
  takes `material`, `group` (default: dynamic on a dynamic body, sensor for
  a sensor, dynamic for a sensor in a project with no game, else static),
  `density`, and `friction` and `restitution` (its
  own win over the material's). Without physics, fixed and kinematic
  colliders go to the geometry world. A `group` the game doesn't declare
  is a `schema` error naming the nearest one.
- `body` behavior: makes an entity's collider a dynamic, kinematic or static
  body, with the prop's body fields (`gravityScale`, `linearDamping`,
  `angularDamping`, `fixedRotation`, `ccd`). A dynamic body writes the
  entity's pose after each step and is `physics-required` in a
  `physics: "none"` world. A kinematic body moves at the velocity
  `ctx.bodies.setVelocity` gives it, on either backend. Both register with
  `ctx.bodies` and keep their velocity through disable/enable and world
  saves.
- `camera-target`: the shell follows the weighted centre of the live
  entities carrying it, loaded or spawned (its system keeps them in attach
  order, and nothing a save needs).
- `spawner` behavior system: spawns `type` entities (through `ctx.spawn`) or
  `prefab` instances (through `ctx.instantiate`) at `rate` a second up to
  `cap` live, plus `burst` on its first active tick, at the entity's pose
  plus a random offset within `spread` drawn from
  `ctx.random.fork("spawner:<id>")` (a world save carries the stream on);
  sets `velocity` (turned with the entity) on spawns with a dynamic body through `ctx.bodies`; `lifeMs` gives
  a type's spawn a `lifetime` block and a prefab instance a lifetime as a
  whole; counts its live spawns back from `entity:destroyed` (an instance
  counts once, by its id, until its last child goes); raises
  `spawner:spawned` (`SPAWNER_SPAWNED`: `entityId` the spawner, `other` and
  `data.id` the new id, `at` where it appeared); world saves hold
  `{ owed, live, left?, burst? }`; seeks before tick 0 run as stepping
  would. A prefab the run can't place throws `prefab-not-spawnable`.
- `createSideViewController(ctx, body, opts)` (motion, exported from
  `@jams/engine/game`): runs and jumps a motion body under
  `ctx.gravity.y × gravityScale`, with `maxSpeed`, `accel`, `decel`,
  `airControl`, `jumpHeight`, `maxFallSpeed`, `coyoteMs`, `jumpBufferMs` and
  `jumpCut`, plus slopes, steps and snap from `SIDE_VIEW_CONTROLLER`
  overridden by `maxSlopeDeg`, `stepHeight` and `snapToGround`.
  `step(dtMs, { move, jump, jumpHeld }, { carrier?, accel? })` returns the
  motion result with `grounded`, `landed` and `jumped`. It works the same on
  both backends, keeps its velocity and timers in `save`/`restore` and in
  world saves (owner `side-view`), and has `launch` and `destroy`.
- Body and overlap helpers for a game's own systems: `registerBody`,
  `rapierBodyEntry`, `kinematicBodyEntry` and `BodyEntry` register a body
  with `ctx.bodies` the way the engine's systems do; `createOverlapTracker`,
  `saveOverlaps`, `restoreOverlaps`, `Overlaps` and `OverlapTracker` track
  and save sensor overlaps; `parseShape`, `composePose`, `relativePose` and
  `wholeTicksIn` are public too.
- `SLOT_MAX_LENGTH` (`@jams/engine/game`), the longest slot name (32
  characters). `SLOT_PATTERN` and the slot messages are built from it, so a
  host can state the limit without copying the number.
- `DEFAULT_ACTIONS`: the `move` (vector) and `jump` (button) actions a
  registry built without a game has.
- `SolidSystem.passesOneWay(actorId, actor, passing)`: one-way gating for
  one actor alone. Each solid holds the actor on its one-way side, and
  `passing` lets it through the `up` solids alone; `down`, `left` and
  `right` ones go by side. The solids it passes go into `oneWayPasses(ctx,
actorId)`, which motion bodies and side-view controllers skip in their
  own sweeps and moves; the world, and every other actor and dynamic body,
  still meets them. `gateOneWay` and `gateOneWaySides` still gate the whole
  world.
- `SpaceFilter.skip`: collider handles a query leaves out.
- `oneWayPasses(ctx, actorId)` (`@jams/engine/game`): the one-way colliders
  an actor passes, for a game's own sweeps, and `forgetOneWayActor(ctx,
actorId, passes?)` to drop them when the actor goes (with `passes`, the
  set `oneWayPasses` gave, only while that set is still the actor's, so a
  body made for it since keeps its own). A motion body's `destroy`
  forgets its entity's, so a character, an agent or a game's own
  controller built on one needs no call.
- `character-top-down` behavior system: the entity's `collider` shape
  becomes a kinematic motion body (`createMotionBody`) walked by
  `createTopDownController` from its seat's `move` action (`inputFor`), or
  from the last `CharacterSystem.setIntent` when it carries no
  `player-input`; a seat that leaves stops it at `decel`. A `force-area` it
  stands in adds `sample(pos)` as acceleration (held back by
  `accel`/`decel`, so only a stronger area moves it), `launch` sets its
  velocity, `grounded` is always true, and with `pushDynamic` it gives each
  dynamic body it runs into the impulse that matches its speed into it. On
  a dynamic `body` it is refused with `character-body-kind`; a kinematic
  `body` is its own. While attached its motion body stands in for its
  collider's own body through one collider-system call; on detach the
  collider's body is built again where the entity is and registered with
  `ctx.bodies` again. `character-side-view` and `nav-agent` stand in the
  same way.
  Its world save is its motion body's plus the last `setIntent`.
- `character-side-view` runs an entity with `collider` and `player-input`
  (or `setIntent` from code): it walks, and jumps with coyote time, a jump
  buffer and a jump cut, over slopes, steps and ground snap, through
  `createSideViewController`. It rides followers and kinematic
  `path-follow` bodies, passes `up` one-way solids per character while it
  rises or holds down (a `down`, `left` or `right` one holds it from its
  side; the passes go with it), takes force areas' `sample` for itself as
  acceleration, pushes
  dynamic bodies with `pushDynamic`, and raises `character:jumped`,
  `character:left-ground` and `character:landed` (`CHARACTER_JUMPED`,
  `CHARACTER_LEFT_GROUND`, `CHARACTER_LANDED`; `other` is the ground's
  entity). Its motion body stands in for the collider system's body on
  that entity, so `ctx.bodies` sees it as kinematic. A dynamic `body` is
  refused at runtime with `character-body-kind`.
- `path-follow` moves any entity along a waypoint path with the follower
  type's rules: a kinematic `body` on it is moved by its velocity before
  physics, so it carries what stands on it and `carrierDelta` answers for
  its collider; anything else has its pose written. It supports `reset`,
  `seek` and saves (its place on the path), and
  `PathFollowSystem.frameDelta(id)` says how far it moved the body last
  tick. `systems/path-follower` exports `advanceAlongPath`,
  `seekAlongPath`, `pathPosition`, `pathWaypoints`, `savePathPlace`,
  `readPathPlace` and `PathPlace`; `carrierDelta` also answers for bodies
  `path-follow` moves. Its path is placed with its entity: a prefab
  instance, a group and an editor move move, turn and flip it as they do a
  follower's path. Any behavior field of kind `point` or `path`, or a
  union's point arm (`nav-agent`'s `to`), is placed the same way.
- `nav-agent` walks: `setDestination(id, point | entityId)` plans over
  `ctx.nav`, steps toward each waypoint at `speed`, keeps `radius` from
  other agents by `separation` (side-stepping one met head-on), re-plans
  toward a followed entity every `repathTicks` (staggered by entity id,
  so a world save keeps each agent's place in the period), and ends with
  `nav:arrived` or `nav:blocked` (`NAV_ARRIVED`,
  `NAV_BLOCKED`; `data.reason` `no-path`, `stuck` or `gone`); `stop(id)`
  ends a walk silently. An entity with a solid `collider` moves through a
  motion body of that shape, otherwise by pose; both stay on the walk
  areas. World saves keep the destination, route and timers.
- `force-area` pushes the dynamic bodies inside its sensor collider through
  `ctx.bodies`: `directional` gives `force` (m/s², turned with the entity)
  times the body's mass, `point` gives `strength` toward its pose with
  `none`, `linear` (to zero at the collider's farthest point) or
  `inverse-square` (past 1 m) falloff, plus `drag` against velocity;
  `affects` limits it by collision group and tag, groups read off either
  world (a `groups` entry the game doesn't declare is a `schema`
  warning, and the area takes nothing in it).
  `ForceAreaSystem.sample(point, entityId?)` returns the summed
  acceleration of every area containing the point (drag aside) for
  kinematic controllers; with an entity, only the areas whose `affects`
  takes it, by the rule bodies are pushed by. Both characters pass their
  own id, so a tag- or group-filtered area leaves the others alone. A
  world save keeps what is inside each area. Its collider must be a sensor:
  validation reports `schema` with a fix, and attach refuses it.
- `joint` behavior: links an entity's body to the body of the entity its
  `to` names, as a `revolute`, `prismatic`, `rope`, `weld` or `spring`
  joint. Joints are made after every body of the load, removed while
  either end is destroyed or disabled, and made again when both are back or
  either is rebuilt. A `to` inside a prefab names a child of the same
  instance: the expansion rewrites it to the child's id, innermost instance
  first, else the scene's entity of that id, and the system and the
  validation resolve a ref written live by the same rule. A motor drives
  the relative speed with at most `maxForce`. A missing `anchorB` holds `to` at the point under `anchorA`
  when the joint is first made. Spring stiffness defaults to 100 N/m and
  damping to 1 N·s/m. A revolute or prismatic joint's `limits` go low,
  then high. On a character or a nav agent the joint holds its motion
  body. Refusals: `joint-self`, `joint-ref-type`, and `physics-required`
  in a scene without physics. `to` holds an entity with a non-sensor
  `collider` (a `body` on a sensor collider holds nothing) or a type that
  declares `ownsBody`.
- `EntityTypeDef.ownsBody`: the type's system gives each entity a physics
  body with a collider that isn't a sensor, so a joint's `to` may name it.
  `solid`, `prop` and `follower` declare it, and a type with a `base` and
  no system of its own takes its base's, with the behaviors its base
  forbids.
- `ColliderSystem.standIn(id)` and `release(id)` (the `BodyStandIn` type,
  from `@jams/engine/game`): a game's own controller takes an entity's body
  over from the collider system as the characters and agents do, held
  across rebuilds and the entity's disables and enables. `scopedRef` is
  exported too, for a game's own entity references.
- `until.near` in the input-script and checks schemas: the entity's pose
  within `within` metres of a point or another entity's pose.
- `nav-agent`'s optional `to`: a point, world m, or an entity's id it walks
  to from the start, so a scene with no code gives an agent a destination;
  omitted, it waits for `setDestination`. The point is placed with the
  entity (an instance's agents each walk to their own); an id inside a
  prefab names a sibling, as a joint's does. A world save taken after it
  arrives keeps it from walking there again on restore.
- `PlayWorld.pose(id)`: a live entity's pose after the tick, for game
  predicates and outcomes.
- Editor: Add behavior lists its options under headings by
  `BehaviorDef.inspector.category` (`physics`, `movement`, `world` or
  `visual`; `BehaviorOption.category`), in registration order, a game's
  own without one under Game. It also adds the behaviors one requires,
  each from its template; seeds a joint's `to` with the nearest entity that
  can hold it; starts a `path-follow` path where the entity stands; and
  applies the scene's own fixes to the blocks it adds (a force area's new
  collider becomes a sensor). An option that can't be added yet is
  disabled, with why in the item (`BehaviorOption.adds`,
  `BehaviorOption.unavailable`); `buildInspectorModel` takes `{ def }`.
- Editor: behavior gizmos on the selected entity: the collider's shape
  handles (writing `behaviors.collider.shape` in the entity's frame), joint
  anchors with a line from its pose to the entity `to` names (an anchor
  that would hide the other's handle, or a collider edge's, moves aside,
  further out on a thin collider; a handle partly covered is still grabbed
  where it shows), a
  force area's arrow or strength ring, a spawner's spread ring and velocity
  arrow, and its `path-follow` path and waypoints where the entity is
  placed (`behaviorGizmo`, `behaviorHandles`, `dragBehaviorHandle`,
  `behaviorMarks`, `GizmoTarget.behaviors`, `FORCE_PX`, `VELOCITY_PX`).
- Editor: the View menu's Colliders layer, on by default, outlines every
  other collider in the scene faintly (dashed for a sensor), so an entity
  with no art still shows where it is.
- Inspector: behavior fields carry `ModelField.group` and show under group
  headings, leaving out one that would only repeat its section's title or
  its one field's; a field that applies only to some kinds (a joint's
  spring stiffness, a force area's point falloff) shows only while the
  block is of one of them (`meta.when`); `meta.widget: "action"` fields are
  a select over the game's actions; vector fields are x/y fields with their
  unit; a `refField` in a block is an entity picker (`entity-ref` with
  `any`), and a point-or-entity field (`nav-agent`'s `to`) edits whichever
  it holds (its `point` or `entity-ref` widget carries `either`). Joint, body and force-area fields carry their units (N/m,
  N·s/m, /s) and plain titles ("Other anchor", "Max force"), and seat
  fields sit in their behavior's group. `meta.units` gives a field's unit
  by another block field's value (`{ kind: { revolute: "rad", prismatic:
"m" } }`); radians show as degrees (`scale` on the `number` and `range`
  widgets). `meta.widget: "range"` draws a number pair as low and high
  fields (the `range` widget): a joint's limits, in degrees for a revolute
  joint and metres for a prismatic one, with its motor in its own group
  (velocity in deg/s or m/s, max force in N·m or N). A segmented choice
  left unset tints its default segment instead of repeating it in a note.
  Field titles are measured in the loaded face, so the last letter isn't
  clipped. Switching a field other fields' `meta.when` keys on (a joint's
  `kind`, a force area's, a spawner's `type` or `prefab`) is one edit that
  unsets what no longer applies and seeds what the new choice needs (a
  rope's length, a point area's strength from the force's size); a field
  under an object the block lacks (a motor's velocity) writes the whole
  object (`modelOps` and `modelBatch` take the registry). `meta.options`
  labels an enum's values with a description each (a joint's kinds read
  Hinge, Slider, Rope, Weld, Spring); `meta.widget: "collision-group"`
  picks from the game's collision groups (a `tags` widget with `options`)
  and `meta.widget: "type"` from its entity types; a range's ends are
  labelled min and max, and one typed end starts it without inverting it;
  an op's refusal names the field by its title. On an instance child, a
  field one of the instance's params sets says so, and so does an override
  that beats it. Sprite fields sit under group headings.
- The engine project gains behavior-yard, a gameless side-view and
  top-down yard built only from the standard behaviors (hero-side and
  hero-top prefabs with exposed `maxSpeed`/`jumpHeight` params, a spawner
  of body crates, a path-follow ferry, a force-area updraft, a three-link
  joint chain, a nav-agent on a walk area sent to a drop point, a one-way
  ledge), with a checks file and an input script that play the side hero
  to a sensor. Both heroes are camera targets, so its one view follows
  their weighted centre, leaning toward the runner. Kitchen-sink carries
  one entity per standard behavior.

### Changed

- The `pixi.js` peer range is `^8.23.0` (was `^8.17.1`): Pixi 8.17's
  WebGPU renderer draws nothing in Chrome 157 on Apple GPUs.
- `solid`, `sensor`, `prop` and `follower` refuse the `body` and
  `collider` behaviors (`behavior-forbidden`): their systems already own a
  body. So does a type based on one of them with no system of its own.
- A registry with no game has the `move` and `jump` actions, and the shell
  binds them in a gameless project.
- `ENGINE_PREDICATES` gains `near`.
- Prop and follower bodies answer `ctx.bodies`: props as dynamic bodies
  (velocity, impulses, forces, torques, mass, wake by entity id), solids and
  sensors as static, followers and motion bodies as kinematic. Forces and
  torques are summed per tick, handed to Rapier before the step and cleared
  after it, so a force lasts one step; one applied after the step is
  dropped at the end of the tick.
- When a game names no camera target (no `cameraTarget()`, or it returns
  `undefined`), the shell's camera follows the weight-averaged pose of the
  live, enabled `camera-target` entities in a play world, with the camera's
  usual smoothing; a game's `cameraTarget()` returning a point or `null`
  still wins.
- A nav agent's separation looks only at entities of its agents' types, so
  a crowd on large walk areas no longer tests every polygon it overlaps.
- A registry's scene, fragment, prefab, entity and spawn schemas are built
  once per registry. With the eleven behavior blocks on every type,
  rebuilding them on each parse made every scene CLI command three to four
  times slower.

### Fixed

- A nav agent following an entity its block names takes its staggered place
  in the `repathTicks` period once the name resolves, as an agent sent by
  `setDestination` does, instead of every such agent re-planning on one
  tick. The behavior-yard genre pin moved for it (its courier follows
  `drop-point`); no other pin or golden trace did.
- Play starts on the game's own view: the camera takes zoom 1 and snaps to
  its target, where an editor zoomed out past the scene's bounds held it on
  the bounds' centre. Stop restores the editor camera as before.
- The dev collab server stamps its schema hashes one tick older than its
  build, so a page on that build outranks them: after an engine edit the
  server's hashes are stale, and an equal stamp won by hash alone could hold
  every open editor read-only until the server restarted.
- A dev editor page ranks its build stamp by when it loaded, never earlier
  than its server's build. Every tab one dev server serves shared that
  server's build time, so a tab opened before an engine edit could outrank a
  fresh one on hash order alone; now the tab loaded last wins, and a tab left
  read-only catches up by reloading.

### Agent surface

- `AGENT_SURFACE_VERSION` is 18, and every committed JSON Schema's
  `x-agent-surface` with it.
- Issue codes `behavior-conflict` (error), `character-body-kind` (error,
  fixable), `nav-missing` (warn), `joint-ref-type` (error), `joint-self`
  (error), `body-missing` (error) and `body-not-dynamic` (error).
- Every scene, prefab and fragment schema offers the eleven behavior
  blocks on each loadable type that allows them; the input-script and
  checks schemas take `until.near`; a gameless registry's `Action` enum
  lists `move` and `jump`.
- `until.near` `{ id, to: [x, y] | entityId, within }` is evaluated: it
  holds while the entity's pose is within `within` metres of the point or
  the other entity's pose, in playtest steps, a `reaches` check's `expect`
  and any game predicate or outcome given the tick's state (fuzz included),
  with or without a game. `PlayWorld.pose(id)` reads a live entity's pose.
  `game new` gains `--preset side-view` (Rapier, gravity [0, 20]); it and
  `top-down` now build the hero from `collider`, the character behavior,
  `player-input` and `camera-target`, with no movement code, and their
  scripts and reaches checks wait on `near`. The `scene-editing` skill has
  three tested behavior batches.
- `player-input` action fields are titled by their action ("Move action",
  "Jump action") instead of "Action"; `nav-agent` gains `to` in every
  schema that offers it, its point arm a world point (`Pt`).
- Behavior fields in the schemas carry `when` (the kinds a field applies
  to) and `group` (the inspector section it sits in), and a joint's `limits` and `motor` fields `units` (by kind) and
  `widget: "range"`. A joint's `kind` carries `options` (each kind's label
  and description), a collider's `group` and a force area's
  `affects.groups` carry `widget: "collision-group"`, a spawner's `type`
  `widget: "type"`, and every sprite field a `group`.
- A collider `group` or force-area `affects.groups` entry the game doesn't
  declare is reported as `schema` (an error for the collider, a warning
  for the force area, which plays and takes nothing in that group), with
  the declared groups as `expected`.

## [0.14.2] — unreleased

The patch jams.team's player saves stand on: a host can refuse a save in
its own words, and a store's limits can change while the game runs (a
player signing in moves from this browser's saves to the account's). It
also closes 0.14.1's leftovers: host requests that time out, and one
`asset-missing` for a texture that records no size.

### Added

- `save-forbidden` (error): a host refused a save, for a signed-out player
  or a game that doesn't save to that host. Hosts raise it; `SaveWriteResult`
  documents it beside the store's own codes.
- `HOST_REQUEST_TIMEOUT_MS` (30 s) from `@jams/engine/standalone`, and
  `ConnectHostOptions.requestTimeoutMs` to set it per channel.
- Per-part tick timing, off unless asked for. `createRunTiming(now)` from
  `@jams/engine/headless` makes a collector on the caller's clock
  (`RunTiming`, with `TimingScope`, `TimingReport`, `TimingSpan` and
  `TimingBucket`); `timing` on `ProbeOptions`, `PlaytestOptions` and
  `HeadlessRuntimeOptions` hands it to the runtime, which then times each
  step's parts: `input`, `system.<type>.beforeStep`, `.beforePhysics` and
  `.afterStep`, `game.beforeStep`, `game.afterStep` and `game.snapshot`, `physics.step`
  (the Rapier world step), `contacts`, `behavior.<name>`, `timers`,
  `events`, `lifecycle` and, with a view, `view.commit`.
  `RuntimeStats.timing` reports them (per part `calls`, `totalMs` and
  `maxMs`, the worst tick) beside the ticks' total and `unattributedMs`.
  Without a collector a step reads no clock; timing never enters a
  recording, a save or a hash.
- `GameConfig.timing` switches the same collection on in the browser shell,
  where `runtime().stats().timing` also carries `shell` (the shell's whole
  tick, the runtime's step being its part `step`), `frame` (the frame's
  work before the draw) and `draw` (Pixi's render call on the CPU).
- `DebugDeps.timing`, which `createGame` passes its debug overlay: with
  `localStorage["debug-timing"]` set to `"1"` (`TIMING_STORAGE_KEY`) the
  overlay switches timing on while the game runs and keeps the report as
  JSON in a `<script type="application/json" data-jams-timing>`
  (`TIMING_ATTRIBUTE`), refreshed about twice a second.

- `SceneSystem.beforePhysics()`, an optional hook the runtime calls after
  the game's `beforeStep` and right before the physics step, in spawn
  order: the last look at the world the step starts from. Not called
  without a physics world.

### Changed

- The sensor system no longer tests every sensor against every collider.
  From 32 sensors up it notes where the colliders stand in `beforePhysics`
  (where Rapier tests overlaps) and each sensor tests only the colliders
  near it, so a step costs about one read per collider instead of one test
  per sensor per collider. A collider whose collision groups can't meet
  any sensor's is never a candidate, and its position isn't read. The
  events and their order are unchanged.
- A body asleep at the last pose sync and asleep now is left as it was:
  props (and every type built on the engine's body table) ask Rapier
  whether the body sleeps instead of reading where it is, and keep its
  pose-index entry (the same object, `prev` equal to `get`) and its visual
  while nothing else wrote its pose. A sleeping body moved without waking
  it (`setTranslation(v, false)`) keeps its old pose until it wakes.
- A follower reads its body once per tick for its own pose, its visual
  and its riders: `AttachmentHub.moved(hostId, snap?, at?)` passes the
  host body's pose to each rider's `moved` callback as `at`, and riders
  pose from it instead of reading the body again.
- Claiming a spawn id no longer walks every live entity. The runtime's
  entity table counts the ids under each instance id, so `ctx.spawn`
  without an explicit id, `ctx.exists` and `ctx.enabled` answer for an id
  with nothing under it without a scan.
- `ctx.query`'s `inArea`, `at` and `nearest` no longer look at every entity
  on each call: after the first, they refresh only the entities whose pose
  was written since the last one. A `PoseIndex` of your own that doesn't
  report its writes is still scanned whole.
- `SaveSlots` re-reads a store's limits on every save: `SaveSlots.limits` is
  a getter over `effectiveSaveLimits(game, store)`, so a host's limits
  changing after sign-in, a claim or a save-mode change apply to the next
  save.
- `channelSaveStore` passes a host's refusal (e.g. `save-forbidden`) through
  unchanged as the write's result, so the game's `save:failed` carries the
  site's message.
- `HostChannel.request` times out: a request the page doesn't answer within
  `HOST_REQUEST_TIMEOUT_MS` rejects with `save-store-failed`, so a save the
  page never answers reaches the game as `save:failed` instead of staying
  pending until close. `hello` stays bounded by `welcomeTimeoutMs`; a reply
  after the timeout is dropped.
- `sceneBundle` and `projectBundle` leave out a texture whose entry records a
  hash but no size and raise `asset-missing` at the reference
  (`<field> names texture "<id>", whose entry records no size for blob
<sha>`, with `detail.unsized` the hash) instead of "no content to fetch".
  The export reports it once: it skips its own `"<id>" (<path>) ships, but
its entry records no size` for a texture a bundle already raised, and
  raises that one only for a shipped blob no bundle reached.

### Fixed

- The inspector, and every panel reading the document through
  `useEditorDoc`, follows an edit at once under the React Compiler. The
  compiler cached `session.getDoc()` and `session.getResolved()` for as long
  as `session` was the same object, so a panel re-rendered on a change but
  kept showing the document from the last selection change. The document,
  its resolved view and the prefab library are now read through
  `useSyncExternalStore`.

### Agent surface

- `AGENT_SURFACE_VERSION` is 17, and every committed JSON Schema's
  `x-agent-surface` with it.
- Issue code `save-forbidden` (error, "The host refused this save.").
- `scene step --timing` and `scene playtest --timing` print where each
  tick's wall time went, by part and by group (`physics`, `engine`, `game`),
  and carry it in `--json` as `stats.timing` and `timing`; the rest of
  either report is unchanged by the flag.

## [0.14.1] — unreleased

The release jams.team hosts games on: a typed channel between a released
game in a sandboxed frame and the page that frames it, the codes a site's
release routes refuse with, and the editor's seam for publishing. It also
closes 0.14.0's leftovers: export and standalone tidy-ups, a replay that
restores its recorded persist, a runHash that ignores schema pointers, a
seed-stale close that ends a live client, and engine UI that takes the
pointer itself outside the site's stylesheet.

### Added

- `./standalone`: the `jams-host` channel's protocol (`HOST_PROTOCOL_VERSION`
  1, `HOST_MESSAGE_MAX_BYTES` 64 KiB, `HOST_DOWNLOAD_MAX_BYTES` 16 MiB,
  `HOST_HANDSHAKE_TIMEOUT_MS`), its zod schemas (`frameReadySchema`,
  `hostHandshakeSchema`, `frameMessageSchema`, `hostMessageSchema`,
  `welcomeSchema`, `HOST_REQUESTS` and the save, limits and issue schemas
  they use), `hostMessageBytes`, `withinHostMessageCap`, `connectHost`,
  `hostRequested`, the `HostChannel` type and `channelSaveStore`.
  `StandaloneGame.host` is the channel, or null.
- `connectHost` opens the `jams-host` channel. On `?host=jams` it posts
  `jams:frame-ready` to the parent, keeps the first `jams:host` port and
  says `hello`. It resolves null without a parent or with no port and
  `welcome` within 2 s (`HOST_HANDSHAKE_TIMEOUT_MS`). Every page message is
  validated; invalid ones are dropped and counted on `HostChannel.dropped`,
  never thrown. Requests reject with the new `HostRequestError`, whose
  `issue` is the page's own, or `save-store-failed` when the channel closes
  or the page's result isn't the method's.
- `channelSaveStore(channel)`: kind `host`; `describe` and `limits` come
  from `welcome` and update on `saves.changed`. A write the page refuses
  returns the page's issue unchanged.
- `.`: `snapshotRemapStore(initial, save)`: `load` reads the host's snapshot
  (null unless it is a v1 state), then the latest change. `save` hands the
  latest state back 500 ms after the last change.
- `bootStandalone` with a host: saves go to `channelSaveStore` and remaps to
  `snapshotRemapStore` (posting `prefs.save { store: 'remap' }`). No service
  worker registers and the install prompt is off. `state` reports loading,
  ready, or error with the first issue. The page's `pause`/`resume` pause
  the game, and resume only undoes a pause the page caused. A game's own
  `saves.store` still wins. Without `?host=jams`, or with no answer in 2 s,
  it behaves as 0.14.0.
- `./editor-ui`: the publishing seam, `EditorHost.publish`
  (`EditorPublishHost` with `UsageView`, `ReleaseView`, `GameSettingsView`,
  `PublishWording` and their parts, with `PublishWording.connectOriginsMax`,
  the most origins Connects to takes); the Publish panel and the project
  settings' Usage section show only for a host that publishes. `SceneEditor`
  adds the Publish panel to the frame's panels (left column, bottom group,
  beside Project settings, also for a layout stored before it existed) and a
  Publish… item to the toolbar's scene menu.
- `UndoneStep.refused` and `UndoCoordinator.refuseStale(doc, reason)`: a
  step that wrote `doc` and later finds nothing left to change is answered
  as refused (and leaves the stack) instead of being skipped for the step
  below it. A project session marks its steps so when an asset entry is
  purged, so undoing "Delete X" after Empty trash reports "Permanently
  deleted" through the editor's notices and undoes nothing else.
- `./project`: `formatBytes`, import-free, the same function
  `./export`'s `formatBytes` is, so a site and its services format sizes as
  the engine does from one definition.
- `purgeAsset` project op: deletes a trashed asset and its hash history for
  good, so its blobs become unreferenced; anything not in the trash is
  refused with `asset-not-trashed`. It has no inverse: a batch with a purge
  is written with an untracked origin and is on no undo stack.
  `ProjectBatchCheck` reports the removed keys as `purged`, and
  `writeProjectState` now removes entries and history the new state no
  longer has.
- Issue codes `asset-not-trashed`, `release-immutable`, `release-forbidden`;
  `quota-exceeded` documents its `limit` names.
- README: §Saves (where saves live and how big they can be), §Publishing on
  jams.team (releases, limits, cleanup, sandbox), and §Export's itch.io
  line.
- `.`: the `render:failed { backend }` event, emitted when rebuilding the
  renderer after a lost GPU context fails; nothing draws again and
  `render:restored` never follows.
- `mirrorRenderState(game, root?)` (`./standalone`): mirrors
  `render:lost`/`render:restored`/`render:failed` on the root element's
  `data-jams-render` (`lost`, `restored`, `rebuilt`, `failed`) and `render:fallback`'s reason on
  `data-jams-render-fallback`; `bootStandalone` and the site's game room
  call it, and the export smoke reads it instead of the lost overlay.
- The editor's project settings gain a Usage section when the host
  publishes (`EditorHost.publish`). It shows one bar per `UsageView` line
  with the host's caption, the asset breakdown, the nearly-full and full
  notices and the cleanup rules, and an Empty trash button. That button asks
  through the editor's confirm, using the host's `trash.confirm` text, then
  deletes every trashed asset for good in one `purgeAsset` batch.
- The editor's Publish panel (shown only when the host supplies `publish`):
  the release command with a copy button and Create one (the host's token
  dialog) while the project has no release; the usage lines and the
  nearly-full or full notice; Production and Preview, with Promote (asks
  first) and Roll back production; the release list (version, short id,
  size, engine, upload time, channels, jam pins, hidden and removed states,
  Play); the Removed soon forecast; visibility, Where this game saves and
  Connects to, saved through `publish.setSettings` with pending feedback,
  the host's toasts and an inline error when the host refuses. Rolling
  production back asks first, as Promote does; Production reads "first
  live {date}" (a rollback leaves a release's first promotion as its only
  date); Play shows only for a release that can be played (not hidden, not
  removed); Connects to takes https:// and wss:// origins as the site does
  and stops at `wording.connectOriginsMax`; "On its own servers" waits until
  an origin is listed.

### Changed

- `game manifest` and `game build` print the wasm line once, in the
  summary, in place of the `physics rapier|none` line; `game manifest
--json` gains `wasm` (the same data `game build` returns).
- `runHash` no longer covers a project doc's `$schema` (the game-settings
  and input-map file-location pointer), so moving a schema file stales no
  recording or save; every recorded `runHash` is re-pinned once: tactics
  `fixtures/level-1.recording.json` ba18737a27e39b3b -> 715ae3af7674ba20,
  tactics `fixtures/level-2.save.json` and
  `scripts/scene/examples/newer.save.json` ef28c8e6400352cb ->
  5b3561382e3af67f, the engine project's `saves/grid-yard.save.json`
  233dd275d5b5e95e -> 5939d1cf13bf8952 (re-saved with `vp run scene save`,
  so its `engine` field reads 0.14.0 and its sidecar sha256 moved).
- `EditorProjectLink.openScene` takes `{ madeFrom }`; undoing New scene…
  returns the editor to the scene it was made from (else the scene it came
  from) instead of leaving it on the deleted, empty scene.

### Fixed

- A framed game keeps its host when the page is slow to answer `hello`:
  `connectHost` gives up after `timeoutMs` only while no port has arrived,
  then waits `welcomeTimeoutMs` (`HOST_WELCOME_TIMEOUT_MS`, 30 s) for
  `welcome`. A cold browser opening its save store took longer than 2 s,
  and the game played without the page's saves.
- A game plays without pads where the page's permissions policy withholds
  `gamepad`: `navigator.getGamepads()` throws there (WebKit, in an
  opaque-origin sandbox) and the shell now reads that as no pads.
- A released game boots under a CSP without `'unsafe-eval'`, as jams.team
  frames it: `./standalone` installs Pixi's eval-free shader and uniform
  sync (`pixi.js/unsafe-eval`), where Pixi otherwise refused to start.
- `connectHost` takes `jams:host` only from the parent window; a message
  with no `source` is ignored like any other window's.
- An export refuses a shipped blob whose entry records no size with
  `asset-missing`, instead of shipping it as `bytes: 0` (a hosted view could
  hit this, and the release's snapshot then disagreed with
  `snapshotProject`).
- The export build's credits no longer list the project's own modules as a
  third-party package when the project sits inside a `node_modules` path
  (the `game new` stage).
- `GameInstance.replay` puts the recording's `start.persist` into the
  instance's persist cell before the load, as a headless replay does, and
  refuses (ok: false, the value kept) a `start.persist` the game's persist
  schema rejects.
- `restoreSave` refuses a save holding a non-null `persist` for a game that
  declares no `persist` (`schema` at `/persist`).
- Scene CLI: a seed-stale close after sync ends a live project client with a
  fatal `ProjectClientError` telling the caller to rerun, instead of
  reattaching for the rest of the command.
- The standalone boot error panel takes the pointer itself (`pointer-events: auto`),
  so Reload stays clickable whatever the page sets around `root`.
- editor-ui: a number field's scrub or an angle dial that is mid-drag when the
  field turns disabled (the doc went read-only) is dropped, its preview cleared,
  and never commits; the dial marks itself `data-disabled` in place of an
  `aria-disabled` its `presentation` role doesn't support.

### Agent surface

- `AGENT_SURFACE_VERSION` is 16, and every committed JSON Schema's
  `x-agent-surface` with it.
- Issue codes `asset-not-trashed`, `release-immutable` and
  `release-forbidden`; `quota-exceeded`'s summary names a hosted project's
  quotas.
- The project op `purgeAsset` (`project-ops.schema.json`).
- `game release create|list|promote|rollback` (scene CLI): build or take
  `--from`'s build, upload to the hosted project over the release routes
  with an agent token (`--hosted` pulls the hosted project first), preview
  only; production refusals print the game's page.
- MCP: `game_release_create`, `game_release_list`, `game_release_promote`,
  `game_release_rollback`, over `game release …`. They use the agent token
  and site from the server's environment (`JAMS_AGENT_TOKEN`,
  `JAMS_AGENT_SITE`), never from tool arguments, and return the release
  summary, never file bytes. Production is refused (`release-forbidden`)
  with the game page's URL.

### Internal

- The shooter and tower-defense genre probes give their bullets and bolts
  the `lifetime` behavior instead of emit-form timers; the tower-defense
  probe's digest moves from `ea1f21e098681a71` to `b039a55159fd6798` (a
  lifetime ends before its tick's timers), the shooter's is unchanged.

## [0.14.0] — unreleased

Standalone web export: any game builds into a static bundle that runs on
any static host, with no site dependency. `game build` plans what ships,
bundles it with Vite and writes a release manifest that pins the build's
files and the project snapshot it came from; the standalone host boots that
manifest from any directory or scheme, a web build installs and plays
offline as a PWA, and `game export --zip` checks the layout itch.io takes.
The renderer survives a lost GPU context, the package moves to
`packages/engine`, and its API reference and a "your first game" tutorial
are generated and tested. The release also closes 0.13.0's leftovers: flow
and save tool gaps, input-map seats in the last script judges, undo across
scenes, one keycap rule and the second game's tidy-ups.

### Added

- Two new entries. `./export` plans a build: `planContent`,
  `finishExport`, `measureBudget` and `DEFAULT_EXPORT_BUDGET` (4 MiB of
  code, 16 MiB to the first frame, 100 MiB in all, 32 MiB per file),
  `assetCredits`, the renderers `renderIndexHtml`, `renderServiceWorker`,
  `renderWebManifest` and `renderCredits`, `planIcons` and
  `defaultIconPng`, `zipFiles`, `checkItchLayout` and `ITCH_LIMITS`,
  `crc32`, and `EXPORT_TARGETS`, the one table of targets, with `web` and
  `itch` rows, `exportTarget`, `exportTargetNames` and
  `DEFAULT_ZIP_TARGET`; it reaches only zod and the project, scene and game
  files. `./standalone` is the host a released game boots in:
  `bootStandalone`, `manifestView`, `manifestRuntimeView`,
  `fetchReleaseTexts`, `showBootError`, `StandaloneBootError`; it reaches no
  `node:`, React, editor or `./export` value. The package packs 13 entries.
- `./project`: the release manifest's types (`ReleaseManifest`,
  `ReleaseTarget` with `web`, `itch`, `desktop` and `mobile`,
  `ReleaseFile`, `ReleaseAsset`, `ReleaseScene`, `ReleaseCredit`,
  `ThirdPartyLicence`, `ExportBudget`, `ExportBudgetReport`) and its
  constants `RELEASE_VERSION`, `RELEASE_SCHEMA_ID` and `RELEASE_FILE`.
- `ProjectFile.export` (`ProjectExport`): `shortName`, `icons` (texture ids
  by size), `themeColor`, `background`, `display`, `orientation`, `budget`
  overrides, `rapier` (`standard` or `compat`) and `pwa`. Additive in
  `project:v1`; `formatProjectFile` writes it last.
- `.`: `GameConfig.renderer` (`RendererConfig`: `preference`,
  `lostOverlay`) and `GameConfig.release`, and the events `render:lost`,
  `render:restored` and `render:fallback` (`RenderBackend`).
- The release manifest (`release:v1`, `release.schema.json`):
  `releaseManifestSchema`, `parseReleaseManifest`, `formatReleaseManifest`
  (canonical text: assets by id and files by path, one item per line),
  `releaseId` (SHA-256 of that text), `releaseSnapshot` (the pinned project
  snapshot rebuilt at `at: 0`), `releaseBuildHash`, `releaseJsonSchema`,
  `checkReleaseManifest(manifest, files?, { measureBudget? })` and
  `findRelease` (by `release` id, else by snapshot and engine version,
  newest first). The package exports the schema as
  `./schemas/release.schema.json`.
- `./export` plans an export: `planContent` chooses what ships (the listed
  scenes, the prefabs they expand, the runtime docs, and the bundles' blobs
  plus whatever those reference; never unlisted scenes, checks, input
  scripts, recordings, saves, the trash or code), records each scene's
  physics and `needsRapier`, groups credits by identical licence
  (`licence-missing` once per unlicensed blob), plans the PWA and icons;
  `finishExport` joins it with the built code into the release manifest
  and its files, measures the budget and ends with `checkReleaseManifest`.
  `defaultIconPng` draws the default 192 and 512 icons in code,
  byte-stable.
- `./export`: `measureBudget(files, content, limits)` sums a build's files
  by role (code and style, wasm, assets, data, total, largest file);
  `firstLoadBytes` is code, plus wasm when the start scene needs Rapier,
  plus the project bundle's and the start scene's blobs (each counted
  once), plus every doc text the host fetches at boot.
  `resolveExportBudget(...overrides)` layers `export.budget` and a
  caller's override over `DEFAULT_EXPORT_BUDGET`; `budgetIssues(report,
files, content)` raises one `export-over-budget` per exceeded budget,
  at `/export/budget/<budget>`, naming the measured size, the limit and
  the three largest contributors (`detail`: budget, measured, limit,
  contributors); `formatBytes` prints sizes as `512 B`, `14 KB`, `2.3 MB`.
- `renderIndexHtml`, `renderServiceWorker`, `renderWebManifest` and
  `renderCredits` in `./export`: the shell files of an export (index.html
  with one module script and no inline script or absolute URL; sw.js
  precaching `build.files` and `release.json` in cache
  `jams-<project>-<build 12>-<snapshot 12>`, hashed files cache-first and
  the shell network-first; app.webmanifest; a script-free credits.html),
  plus the shell file-name constants (`INDEX_HTML_FILE`, `CREDITS_FILE`,
  `SERVICE_WORKER_FILE`, `WEB_MANIFEST_FILE`) and `serviceWorkerCacheName`
  / `serviceWorkerPrecache`.
- `zipFiles` (`./export`): a stored zip, entries sorted by path, DOS time
  1980-01-01 00:00, no extra fields, UTF-8 names, CRC-32 in TypeScript, so
  one build zips to the same bytes on every runtime; it throws on a
  duplicate path or anything needing zip64.
- `checkItchLayout` and `ITCH_LIMITS` (`./export`): itch.io's HTML5 limits
  (1,000 files, 500 MB in all, 200 MB per file, 240-character paths, read
  from itch.io/docs/creators/html5 on 2026-11-11, decimal MB), `index.html`
  at the root, nothing outside the root folder, no `__MACOSX` or dotfiles;
  each failure is `export-itch-layout`, pointing at its row in
  `release.json`'s `build.files`.
- `./standalone`'s `bootStandalone` boots a release from its
  `release.json`, resolving every URL against the manifest's URL
  (`document.baseURI`), so it never needs an HTTP origin or a service
  worker. It refuses a newer format (`version-newer`), another game's build
  (`asset-kind`), a stale doc or time model (`hash-mismatch`) and a
  manifest that fails `checkReleaseManifest`, each with an on-page error
  and a Reload button. Also added: `manifestView`, `manifestRuntimeView`,
  `fetchReleaseTexts` (taking a `FetchText`, `(url) => Promise<Response>`,
  which `typeof fetch` fits) and `showBootError`/`StandaloneBootError`.
- `createExportBuild` (`@jams/engine/vite`): a structurally typed Vite
  plugin that serves the export entry `virtual:jams-export/main`
  (`bootStandalone` with the game, its UI and, only when a listed scene
  needs it, a lazy Rapier import, standard or `-compat` with `init()`),
  requires the export's output options (no sourcemaps, content-hashed
  `code/[name]-[hash]` names, no public dir), hashes the bundle into
  `BuiltCode` with third-party licences read from the bundled packages,
  finishes the plan and emits every planned file plus `release.json`;
  `ExportBuildConfig`, `EXPORT_ENTRY_ID` and `exportEntrySource` alongside
  it.
- `AssetLoader.reupload()` (optional on host loaders): drops each resident
  texture's GPU copy by hash, so a renderer rebuilt after a lost GPU
  context uploads it again.
- GPU context loss and fallback: on `webglcontextlost` or a WebGPU
  `device.lost` the shell emits `render:lost`, pauses (no tick runs,
  `step`/`resume` hold) and shows `GameConfig.renderer.lostOverlay`
  (default a centred "Restoring graphics…" line). A WebGL restore within
  3 s rebuilds in place (`render:restored { rebuilt: false }`). Otherwise,
  and on any WebGPU loss, the renderer is replaced by a WebGL one drawing
  on a fresh canvas over the host's, the stage is re-attached, textures
  re-upload, then `render:fallback { reason: 'lost' }` (from WebGPU only)
  and `render:restored { rebuilt: true }`, and the game resumes. A WebGPU
  init failure retries with WebGL and emits `render:fallback { reason:
'init' }` at `start()`. `GameConfig.renderer.preference` is now read.
- `isSeedStaleClose`, `SEED_STALE_CODE` and `SEED_STALE_REASON` from
  `./collab`.
- The PWA: a web build with `export.pwa` on (the default) registers its
  `sw.js` from the standalone host (`StandaloneOptions.serviceWorker`,
  default on; skipped without `navigator.serviceWorker` or outside a secure
  context, and never for itch, which ships none). `StandaloneGame.install`
  wraps the browser's `beforeinstallprompt`: null until the browser offers
  an install, a function that shows the prompt (true once accepted) after.
- The platformer's and tactics' project files name their `export` blocks;
  tactics ships its own 192 and 512 icons (`icon-192`, `icon-512`, CC0)
  and a Credits link in its menu.
- The API reference: `docs/api/<entry>.md`, one page per public entry
  (editor-ui included) with each export's signature, its doc comment and
  links to the other types of the same entry, plus a `README.md` index. It
  is generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`,
  checked in CI with `--check` and rewritten with `UPDATE_API_DOCS=1`, and it
  ships in the package.
- `UiContext.links` (`{ credits?: string }`, optional) and `mountUi`'s
  optional fourth argument `{ links }`: the pages a host ships beside the
  game; the standalone host sets `links.credits` to the build's
  `credits.html` when the build lists it.
- `UiContext.install` (optional): the browser's install prompt where the
  host can offer one, as `current()` (the prompt, or null while the browser
  offers none) and `onChange(fn)`. The standalone host passes it to a PWA
  build's UI, and the tactics title menu shows an Install button while it
  is offered.
- `StandaloneOptions.fillPage` (default true): the standalone host lays the
  page out for the game alone through CSSOM (no margin or scrolling, the
  build's `pwa.background`, else black, behind it; the root fixed over the
  window, touch scrolling off) and sizes the canvas from the root. It shows
  a "Loading…" line in the root until the first scene is up.
- `DEFAULT_BUILD_TARGET` (`web`) in `./export` beside `DEFAULT_ZIP_TARGET`;
  `game build` and the MCP `game_build` read it.
- README §Your first game: from `vp run scene game new orbs --preset
top-down` through apply, playtest, `game build` and `game export --zip`,
  its shell blocks run in CI by
  `scripts/engine-readme/__tests__/tutorial.test.ts`; §A second game links
  tactics' sources section by section, its saves and its export (icons,
  Credits) included.
- README §Export (targets and their table, the build layout, planning in
  code, the release manifest, size budgets, the standalone host, the PWA,
  credits and licences, itch.io) and §Graphics loss (the pause, the
  overlay, the WebGL fallback, the render events), each with an example
  that runs in readme.test.ts.
- `ProjectSession.peekUndo()` / `peekRedo()` (and the same on
  `UndoCoordinator`): the step undo or redo would take, without taking it;
  writes since the last commit come first as one "Edit" step, and they
  make `peekRedo` null.
- `@jams/engine/game` exports `keycapLabel`, `pointerButtonLabel` and
  `bindingKeyLabel`, the one rule for how a key code or pointer button
  reads on a keycap (`KeyA` is "A", `Numpad4` is "Num 4", `ShiftLeft` is
  "Shift", `primary` is "Click"). The editor's binding chips, the site's
  controls hint and the tactics HUD all use it.

### Changed

- Recording v2 gains an optional `release` (the release id, a sha256),
  written when `GameConfig.release` is set, as the standalone host does;
  additive, `RECORDING_VERSION` stays 2 and the schema id is unchanged.
  `RecordingHost.release` passes it to `createRunRecorder` /
  `createSessionRecording`. Recordings made outside a release are
  unchanged byte for byte.
- `checksSchemaFor` takes the project input map's `players`, and the
  checks kind passes `KindEnv.inputMap`'s, so an inline checks script's
  tracks are judged by the map's seats as the playtest judges them.
  `scene fmt` judges scripts and checks against the project's input map.
  An unknown `until.persist` key gets a did-you-mean from `pointer`, `eq`,
  `gte` and `lte`. `scene step` prints a command's seat: `tN command @seat
name` in text, and `[tick, name, args | null, seat]` in `data.commands`
  for a seat other than 0.
- The editor switches to the scene an undo or redo touches before taking
  it, so the step's selection is restored there.
- New scene… opens the scene it made.
- An editor session seeds `canUndo`/`canRedo`/`undoLabel`/`redoLabel` from
  its history on creation, so a scene opened after edits elsewhere shows
  Undo at once.
- `COLLAB_LAYOUT_VERSION` and `REPLAY_ACROSS_PLATFORMS` are defined in
  `version.ts` beside `ENGINE_VERSION` (still exported from the same
  entries), so `./export` reads them without reaching the collab and
  recorder modules.
- The `lifetime` behavior can be world-saved: it counts on its own clock
  instead of a function timer, saves each entity's ticks left and restores
  them, so a restored entity expires on the same tick. `ctx.timers.size`
  no longer counts lifetimes, and within one tick a lifetime now ends
  before that tick's timers run.
- The tactics game's `TacticsRunSnapshot` no longer carries `grid` or
  `classes`: the board and the class table are the world's and the
  project's, read with `worldBoard`, and `restore` rebuilds them from the
  restored world. `TACTICS_GOLDEN_DIGEST` moves from e2a58c6a80e955b3 to
  0d59d480ac4a58bd and `fixtures/level-1.recording.json` is re-recorded
  (its stream, commands and outcome are unchanged; only `end`, the engine
  version and the config hash move). Older tactics saves that still hold
  `grid`/`classes` restore as before. Level 2's river and the cellar's
  rubble draw with their own tiles (`tile-river`, `tile-rubble`).
- The engine project's editor opens its scene list's start (`engine-yard`)
  when the URL names no scene, as a hosted game's does, instead of a fixed
  `kitchen-sink`.
- `GameRuntime.restore`'s docs say a save's keys come back sorted by code
  unit and that `snapshotDigest` hashes the snapshot's key order.
- `CodeModuleInfo.registers` gains `layers` and `collisionGroups`.
  `gameRegisters` fills them from the game's `layers` and the collision
  groups it adds beside the engine's, and the Layers tab reads them.
- `EditorChromeGame` includes `input`.
- `CloseReason` gains `reload`: a doc from another seed reloads the project
  from the server's state, and the site's `syncCloseReason` maps
  `4409 seed-stale` to it rather than `retry`.
- The package lives in `packages/engine/`, a workspace package of the repo
  (`"@jams/engine": "workspace:*"`), with its layout unchanged; import paths
  are unchanged. The site, tests and the scene CLI keep importing its
  source; `game build` bundles the packed `dist` through
  `node_modules/@jams/engine`, packing it first when `dist` is missing or
  older than the source (`vp run game:build` packs as a task dependency).
  The scene CLI finds projects under `src/` and `packages/`. The tactics
  game's docs point their `$schema` at the new path, which moves the
  `runHash` of `fixtures/level-1.recording.json` to ba18737a27e39b3b (its
  stream and end digest are unchanged).

### Fixed

- A recording made under the standalone host carries `project` (the
  release's project id and `project.snapshot`), so `findRelease` matches a
  release run by snapshot: `createGame` takes the ref from
  `GameConfig.release` when `GameConfig.recording.projectRef` isn't given.
- `createExportBuild`'s `generateBundle` is the object form `{ order:
"post", handler }`, so chunks are hashed after Vite's import analysis
  rewrites them, for any Vite config that adds the plugin; its `config()`
  turns `build.modulePreload` off (`ExportBuildConfig.build.modulePreload`).
- `planContent` warns `scene-unlisted` for a reference out of a shipped
  asset to a scene the list doesn't hold (a door's or sublevel's target),
  which doesn't ship.
- A project's named export icons are assets of the release: pinned by its
  snapshot, credited with their licence and checked against the build's
  snapshot. An icon nothing else ships is written once, at its icon path.
- The itch layout check of `finishExport` counts `release.json` among the
  files and bytes, as the zip holds it.
- The boot error panel is fixed over the viewport and scrolls, so its
  heading and a long message read from the start on a small screen.
- The standalone host refuses a game whose `saves.version` or `configHash`
  isn't the build's (`hash-mismatch` at `/game/saveVersion` or
  `/game/configHash`), as it does a time model.
- `credits.html` ends with "Play the game" (it opens the game) instead of
  "Back to the game": the tactics menu opens it in a new tab.
- The shell file names (`INDEX_HTML_FILE`, `CREDITS_FILE`,
  `SERVICE_WORKER_FILE`, `WEB_MANIFEST_FILE`) are defined once in
  `./project` beside `RELEASE_FILE`, which `./export` re-exports and the
  standalone host reads.
- A bound scene doc that loses its header (undoing the `createAsset` that
  made it) no longer throws; the binding keeps the last name and bounds,
  and `expandLenient` expands a header-less scene empty-named with zero
  bounds.
- `createHeadlessRuntime({ flow })` keeps the save requests it drains
  while applying flow requests; the handle's `takeRequests()` hands them
  to the caller.
- An editor Play recording of a game that declares `persist` writes
  `start.persist` (the value as Play found it) and `start.entry`, so it
  replays headless to the same end.
- A save fixture whose bytes aren't JSON fails to import with the engine's
  own sentence, the same under Bun and Node.
- `game build` always bundles for production: it defines
  `import.meta.env.DEV`, `import.meta.env.PROD` and `process.env.NODE_ENV`
  itself instead of taking them from the caller's `NODE_ENV`, so a build
  run under vitest or a dev server drops dev-only branches (the
  platformer's editor tools) like a CLI build does.
- The package's `files` ships `docs/api/*.md` only, and the release smoke
  accepts the API reference in the tarball.

### Agent surface

- `AGENT_SURFACE_VERSION` is 15, and every committed JSON Schema's
  `x-agent-surface` with it. `public-api.json`'s schema ids gain
  `urn:jams-engine:release:v1`; `project.schema.json` gains the `export`
  block and `recording.schema.json` the optional `release` (their ids
  unchanged).
- Issue codes `export-asset-missing` (error; an icon falling back to the
  default raises it as a warning), `export-over-budget`,
  `export-itch-layout`, `export-target-unsupported` (errors) and
  `licence-missing` (warn). `checkItchLayout` raises
  `export-itch-layout`; the planner, the budget and the release check raise
  the others.
- CLI: `game build <id> [--target web|itch] [--out …] [--rapier
standard|compat] [--allow-over-budget]`, `game export <id> --zip [--target
itch|web] [--out …]` and `game manifest <dir|release.json>` are
  registered, and `replay` takes `--releases <dir>`. `--target` lists the
  targets `EXPORT_TARGETS` has a row for.
- `game build <id>` builds a project into a static bundle (Vite,
  `createExportBuild`, the bundle report beside it) and prints the scenes
  and their physics, bytes per role, the budget and credits gaps; `game
export <id> --zip` builds (default target itch), zips with `zipFiles` and
  checks the target's layout; `game manifest <dir|release.json>` checks a
  manifest through `checkReleaseManifest` (with the directory's files and
  their hashes) and prints its summary; `replay --releases <dir>` names the
  build the run was made on (`findRelease`).
- `game build` (and `game export`, which builds through it) always prints
  the wasm line, `wasm: 0 B (no listed scene uses Rapier)` or
  `wasm: <size> (@dimforge/rapier2d <version>, scenes: …)`, or
  `… -compat <version> inlined in the code (<size>), scenes: …` for
  `--rapier compat`, and its `--json` data gains `wasm` ({bytes, package,
  version, inlined, scenes}) and `overBudget`. An over-budget build is
  written and exits 1 unless `--allow-over-budget`. `--rapier` defaults to
  the project file's `export.rapier`, else standard.
- MCP `game_build` (builds a project like `game build`; returns the plan
  summary, the issues and the output directory, never a file's contents)
  and `game_manifest` (checks a build directory, a `release.json` or an
  inline manifest like `game manifest`; returns the validated manifest and
  its summary).
- CLI: `scene save --flow` follows scene requests through the project's
  scene list, so a fixture can hold the scene, entry and persist the run
  reached.
- CLI: `scene assets apply` (with `--dry-run` too) reports `scene-unlisted`
  (`sceneListIssues`) for a batch that touches a scene list, checks file or
  input script.

## [0.13.0] — unreleased

Scene flow, additive scenes and saves: a game is several scenes with a
start, transitions, loading and saved progress. A project's scene list
names the start and the scenes a game may go to; games ask for a change
through `ctx.flow.request`, keep progress in `ctx.persist`, attach
sublevels beside the main scene, and save at two depths through stores
with caps. The editor gains a scene picker and a Project settings panel,
the site plays each hosted game from its list's start, and the second game
goes menu → level → result → menu with a fade and saves between turns. The
release also closes 0.12.0's leftovers: doc identity across a reseed,
input-map seats wherever a script is judged, Play following co-edited
project data, one-way physics from the type metadata, one pointer rule for
fuzz and scripts, controls hints from the game, prefab param value maps
and asset detection shared by push, pull and the dev server.

### Added

- The scene flow and save contract. `EngineContext` gains `flow` (the main
  scene, `request`, `attach`, `detach`, `sublevels`), `persist` (one JSON
  value that outlives every runtime of an instance) and `saves.request`;
  `ctx.flow.request` keeps the first request since the host last took one
  and drops later ones with a dev warning, `ctx.saves.request` queues, and
  `SceneRuntime.takeRequests()` hands both to the host and empties them;
  the shell, headless runtimes and `runPlaytest` apply them as below.
  `SceneRuntimeOptions.persist` takes the instance's `PersistCell`
  (`createGame` makes one per instance) and `SceneRuntimeOptions.scenes` a
  `SceneLibrary`. `GameDefinition` gains `persist` and `saves`,
  `GameRuntime` `restore`, `SceneSystem` and `BehaviorSystem`
  `save`/`restore`, `SpawnInput` `sublevel`, `PlayState` `persist`;
  `GameConfig` gains `flow` (a `SceneSource`, a `TransitionRunner`, a
  loading view) and `saves`; `GameInstance` gains `flow` and `saves`
  (below); `GameEventMap` gains `flow:change`, `flow:loading`,
  `save:written` and `save:failed`.
- `./game`: `flowIssue(list, id, use)`, the one rule for whether a scene
  is listed and may start, be gone to or be attached; `FlowRequest`,
  `TransitionSpec`, `SceneLibrary`, the sublevel types,
  `SUBLEVEL_ID_PATTERN`, `sublevelId` and `parseSublevelId`; the `save:v1`
  types (`SaveFile`, `WorldState` with `systems` keyed by entity, then
  owner, and `@random` holding `ctx.random`'s forks), the owner keys
  `SAVE_RANDOM_KEY`, `MOTION_SAVE_OWNER` and `GRID_STEP_SAVE_OWNER`,
  `SAVE_VERSION`,
  `SLOT_PATTERN`, `DEFAULT_SAVE_LIMITS` (64 KiB, 8 slots) and
  `MAX_BROWSER_SAVE_LIMITS` (1 MiB, 64 slots), `saveFileSchema`,
  `parseSaveFile`, `formatSaveFile` and `effectiveSaveLimits`.
- `.`: the save stores (`memorySaveStore`, `localStorageSaveStore`,
  `indexedDbSaveStore`, `browserSaveStore`), `SaveStore`, `SaveSlots`, `fadeTransition` and
  `createLoadingOverlay`; `./headless`: `memorySaveStore`,
  `captureSave`, `restoreSave`, `HeadlessRuntime`, `PlaytestSegment`; `./project`:
  `SCENE_LIST_KIND`, `SAVE_KIND` and their file types.
- The `scene-list` kind (`scene-list:v1`, one per project at its root):
  `start` and `scenes` keyed by scene, co-edited per entry. Its refs make
  `changeAssetId` rewrite it, and deleting a listed scene is `asset-in-use`.
  Validation: `start-scene-missing` (an error while `start` is null or
  names an unlisted or sublevel scene), `dup-id`, `asset-missing`, and
  `sceneListIssues` for `scene-unlisted` (reported by `scene project show`
  and the dev server's project check). `ProjectRuntimeView.flow` gives the
  list's start and scenes, empty without one. `RUNTIME_VIEW_KINDS` includes
  `scene-list`; `./project` exports `sceneListKind`, `sceneListEntries`,
  `sceneListFlow`, `sceneListIssues` and `SceneListFlow`, and the package
  exports `./schemas/scene-list.schema.json`.
- Persistent state: `GameDefinition.persist` ({ initial, schema? }) and
  `ctx.persist` hold one deep-frozen JSON value per game instance and per
  headless runtime, surviving every `loadScene` and Play-from-here; `set`
  checks plain JSON and the game's schema in dev and headless (production
  trusts it); a save's `persist` is checked against both on its load
  everywhere, production included, and a value they refuse is a `schema`
  issue at `/persist` that keeps the current scene. `PlayState.persist` carries it to `play.outcome` and
  predicates, and input scripts gain `until: { persist: { pointer, eq |
gte | lte } }`. Persistent state is in no digest by itself.
  `createHeadlessRuntime` takes `persist` to share one cell across
  runtimes; `./headless` exports `createPersistCell`, `gamePersistCell`,
  `plainJsonProblem` and `PersistCellOptions`.
- `parseSaveFile`, `formatSaveFile`, `saveFileSchema` and
  `effectiveSaveLimits` are real: a strict `save:v1` schema
  (`project/save.schema.json`, `urn:jams-engine:save:v1`, exported as
  `./schemas/save.schema.json`), canonical save
  text with a trailing newline, envelope checks (kind, `v`, the game's id,
  `SLOT_PATTERN`) and the game's `saves.migrations` run in order from
  `gameVersion` up (`migratedFrom`); a newer `gameVersion` or a missing
  step ("no migration from 2 to 3") is `save-version-newer`.
  `saveFileBytes(file)` gives a save's size, the UTF-8 length of its
  canonical text.
- `PlayState.world` now also reads the live world for
  `GamePlayDef.commands`, outcomes and predicates: `select`, `get`, `grid`
  and `project` (all optional on the type; `playWorld` always fills them,
  and its parameter widens to match).
- `GridSettings` is exported from `@jams/engine/game`.
- Scene flow in the runtime: `ctx.flow.scene` and `ctx.flow.entry` follow
  each load from the scene library (null for a plain `load`); hosts apply a
  drained `ctx.flow.request` after the tick, after its destroy flush, by
  loading the listed scene with its own prefabs and the request's
  `persist` applied first (put back if the load is refused). A target that
  isn't a main scene of the list is refused as `scene-unlisted` through
  `flowIssue`, and dev warns at request time. The runtime reads
  `SceneRuntimeOptions.scenes` once per load and keeps that frozen library
  for the run.
- `runPlaytest` with `flow` follows flow requests after the tick on one
  script; `PlaytestReport.segments` ({ scene, ticks, recording, end }, one
  per scene visited; `recording` stays the first scene's); without `flow`,
  a request ends the run as `{ result: "flow", to, tick }`, and a non-null
  outcome ends a tick even with a request pending. `until: { scene }`.
  `createHeadlessRuntime({ flow })` applies a request after the step that
  made it. Recording v2 widens additively (`RECORDING_VERSION` stays 2):
  `start.persist`, `start.entry`, `next`, `fromSave` (the save fixture a
  run started from, by hash).
  `replayRecording` applies `start.persist` and `start.entry` before the
  load, ends at `next` without following it, and counts a different `next`
  as a divergence; `ReplayOptions` gains `flow` and `sceneId`.
- Save stores: `memorySaveStore`, `localStorageSaveStore` (keys
  `${prefix}${gameId}:${slot}`, an optional `storage`),
  `indexedDbSaveStore` and `browserSaveStore` (IndexedDB, else
  localStorage, else memory, probed once; `describe` says where saves
  live). Every storage call is in try/catch, and the browser stores hold at
  most `MAX_BROWSER_SAVE_LIMITS`.
- `GameInstance.saves`: slots over the game's own store
  (`GameDefinition.saves.store`), else the host's (`GameConfig.saves`),
  else `browserSaveStore()`, under `effectiveSaveLimits`. `save-too-large`
  is checked before any write; a new slot past `maxSlots` is
  `save-slot-limit`, an overwrite never is; writes run one at a time, so
  saves made together can't pass the cap; a store that throws is
  `save-store-failed`. `load` restores through the shell (pause, load,
  restore, resume) and fires `flow:change`.
- `ctx.saves.request` is saved after its tick. The result is only a host
  event (`save:written`, `save:failed`), never a `StepResult`; a replay
  never writes saves.
- The editor's scene picker: a toolbar menu of the project's scenes
  (listed ones first in list order with their titles, then the rest by
  path, sublevels and the start tagged, the open one checked). Switching
  keeps the previous scene's doc connected for 60 s. "New scene…" creates a
  scene from the game's template and can add it to the scene list in the
  same undo step. An undo or redo whose step is in another scene opens that
  scene and says so in the status bar.
- `./project`: `KindEnv.inputMap` (the project input map's `players`, for
  a host that holds its doc) and `kindInputMap(view, valueOf, registry)`;
  the input-script kind judges a script's tracks against the map's seats
  over the game's, as playtest and `scene step` do.
- Scene changes in the shell: `GameInstance.flow` (`start`, `scenes`,
  `current()`, `go`, `restart()`) applies `ctx.flow.request` after its tick
  and runs a change between ticks: ticking stops, the transition's out
  half, `onUnload`, preload (a loading view past 150 ms), the load with
  `persist` and `entry`, the in half, then ticking resumes and
  `flow:change` fires; a `go` during a change waits for it.
  `fadeTransition` (a cut under reduced motion) and `createLoadingOverlay`
  draw in a transition layer above the UI layer, so a fade covers the HUD.
- In the editor's Play a flow request ends the session with outcome
  `{ result: "flow", to }` (`PlayOutcome.to`), finishes its recording with
  `next`, holds the frame, and the Play bar says "Ended: requested
  <scene>" with Resume and Step off and an Open button that stops Play and
  opens that scene.
- Sublevels: `ctx.flow.attach(scene, { label, at?, z? })` spawns a listed
  scene's entities beside the main scene, at once, as `<label>:<id>`
  (`<label>:<inst>/<child>`), its refs, positions and z following;
  `detach(label)` destroys them and every
  `ctx.spawn({ ..., sublevel: label })` at the tick's destroy flush;
  `sublevels()` lists them. Refusals are `sublevel-invalid` with
  `detail.reason` unlisted, label, physics, grid (cells judged in whole px)
  or settings (gravity), judged by `sublevelIssue` (`@jams/engine/scene`).
  No checks file or input-script op names a sublevel yet. While attached, `ctx.bounds` and the grid's cell bounds cover
  them.
- `./editor`: the settings model. `settingsRows(schema, value, path,
options?)` gives `InspectorRow`s (the scene inspector's field descriptors
  without a section) for any zod object, nested objects as children, enums,
  bounded numbers, booleans and number pairs drawn as the inspector draws
  them; `settingsValue(row, input)` parses and checks a typed value as the
  inspector does; `settingsEdit(asset, path, value, current?)` gives one
  `editAsset` op, setting a whole atomic value or a missing parent object
  when given the doc and its layout; `SettingsSection` names a project
  settings tab.
- The editor's Project settings panel (tabs General, Engine, Input, Scenes,
  Layers) over the project's game-settings, input-map and scene-list docs,
  opened from the site menu and from "Project settings…" in the toolbar's
  scene menu.
  Every edit is one `settingsEdit` batch through the project session
  (history entry, per-person undo, presence, sync). "Add binding" takes the
  next press through `GameInstance.input.capture`, and UI-only actions are
  tagged. The scene list is reordered by drag or arrows. Removals ask
  through Confirm. A missing doc offers Create. Layers and collision groups
  are read-only, each with its code module.
- A prefab param's optional `map` gives each target its own value per
  string value of the param
  (`{ "unit.behaviors.sprite.frame": { "red": "knight-red" } }`). A mapped
  target with no entry for the value keeps its own. A map of a path that
  isn't a target, an empty map, or a non-string `default` beside a map is
  refused: `schema` when a prefab file parses, `op-invalid` from
  `exposeParam`. Tactics' knight and archer take their frame and red flip
  from `side`, so level 1 has no per-instance art overrides. Level 1
  expands to the same scene, so its golden digest is unchanged; its
  recording fixture takes the file's new `sceneHash` and `runHash`.
- `assetFileKind`, `assetFilesIn` and `mayBeAssetFile`
  (`@jams/engine/project`): the one rule for which files under a project's
  asset globs are assets.
- `captureSave`/`restoreSave` capture and restore saves at two depths:
  `progress` (scene, sublevels, persist, the game's snapshot) and `world`
  (tick, counters, `ctx.random` and every fork it made, keyed by label
  path and, from a path's second fork on, its occurrence (`unit#2`),
  emit-form timers, enabled
  flags, destroyed and spawned entities with exact ids, poses, each type
  system's, behavior's and registered object's `save`, contact watches,
  seats and held input). A world save restored and run on matches the
  uninterrupted run's digest. A save keeps the entry its scene was
  reached through (`scene.entry`) and loads back through it;
  `meta.playTicks` counts every tick played under the instance's persist
  cell across scenes and runtimes, and a restore seeds it from the save.
- `worldSaveBlockers(runtime)` and `SaveBlocker`, the one rule behind
  `save-unsupported` (Rapier physics, a pending function timer or
  coroutine named by owner, a game runtime without `restore`).
- `createHeadlessRuntime` returns a runtime with `save(opts)` and takes
  `fromSave` to start where a save left off; `loadHeadless(input, {
fromSave })` reads a save (text or parsed), checks it against the
  loaded scene and returns it as `HeadlessLoad.fromSave` (a `SaveStart`:
  the file and the hash of the text given), so spreading the load into
  `runPlaytest` or `fuzz` starts there; new type
  `HeadlessLoadOptions`.
- `MotionBody.velocity()` and `setVelocity()`: a body keeps its velocity
  for the controller that moves it, and a world save keeps it.
- World saves keep the state engine systems hold: sensors' inside sets (a
  restored sensor raises no `sensor:enter` for what was already inside),
  one-way solids' gates, path followers' clocks, motion bodies (position,
  velocity, enabled), grid steppers (cell, step under way, reservation)
  and occupants' cells.
- The second game has a scene flow: tactics' scene list (menu start;
  Ford, Bridge, result, and cellar as a sublevel), a DOM title menu
  (Start; Continue, which loads the newest save; the save store's describe
  line) and a
  result scene (won or lost, turns taken, back to menu). Every change
  fades for 400 ms. Persistent progress is { cleared, roster, last }.
  Level 2's stair attaches the cellar through `ctx.flow.attach`.
- `save` asset kind: `*.save.json` files in a project are save:v1 fixtures
  (blob, application/json, 1 MiB cap). Inspect reads the file as written,
  with no game check and no migration, and records `{ game, gameVersion,
depth, scene }`. Its scene is a ref to the scene kind, and new bytes
  replace it last-writer-wins, with the old hash kept in history. The
  engine kind order is now scene, prefab, material, game-settings,
  data-table, input-script, input-map, scene-list, checks, texture, atlas,
  font, audio, recording, save, code.
- `runPlaytest` starts from a save with `fromSave: { file, sha256 }`
  (`PlaytestStart`, `SaveStart`): the first scene's recording names the
  fixture as `fromSave`, and `replayRecording` finds it by hash in `saves`
  (a recording whose fixture is missing is blocked with `asset-missing`,
  `detail.kind: "save"`). `fuzz` takes the same `fromSave`: every
  rollout starts where that save left off.
- `PlaytestHooks.onEnd(runtime)`, called with the last scene's runtime
  before it is destroyed.
- The types and constants these entries name, exported beside them: `.`:
  `GameFlow`, `FlowResult`, `LoadingView`, `LoadingViewFactory`,
  `SaveDepth`, `SaveLimits`, `SaveMeta`, `SaveSummary`, `SaveWriteResult`,
  `SceneListEntry`, `DEFAULT_INDEXED_DB_NAME`,
  `DEFAULT_LOCAL_STORAGE_PREFIX`; `./game`: `FlowContext`, `FlowUse`,
  `LibraryScene`, `PersistContext`, `SavesContext`, `SaveRequest`,
  `GamePersistDef`, `GameSavesDef`, `JsonValue`, `ParseSaveResult`,
  `SaveDepth`, `SaveGameData`, `SaveLimits`, `SaveLimitsStore`,
  `SaveMeta`, `SavedSystems`, `SavedTimer`, `SceneListEntry`,
  `SublevelInfo`, `SublevelOptions`, `SublevelResult`, `SAVE_SCHEMA_ID`;
  `./headless`: `PlaytestSegmentEnd`, `RuntimeRequests`; `./project`:
  `SceneListFile`, `SceneListEntry`, `SCENE_LIST_SCHEMA_ID`,
  `SCENE_LIST_VERSION`, `saveKind`, `SaveFixtureMeta`,
  `SaveFixtureSettings`, `saveFixtureMetaSchema`,
  `saveFixtureSettingsSchema`, `SAVE_SUFFIX`, `SAVE_FIXTURE_MAX_BYTES`;
  `./scene`: `SublevelJudgeOptions`, `SublevelSettings`; `./editor`:
  `SettingsRowsOptions`.

### Changed

- `ENGINE_RUN_RESULTS` gains `flow`, a run that ended on a scene change it
  didn't follow, so a game can no longer declare a result named `flow`;
  fuzz reports count it beside the others. `ENGINE_PREDICATES` gains
  `scene` and `persist`, so a game's script predicate can't take either
  name.
- `createSolidSystem` reads its type's `oneWay` metadata when
  `SolidOptions.oneWay` is omitted, so a `base: "solid"` type that declares
  `oneWay` is one-way in physics too; the solid system and the editor share
  one side rule (`oneWaySideOf`).
- `scene new` writes `$schema` for a project's first scene. It points at
  the game's `scene.schema.json` beside the project file, or at the
  engine's scene schema for a gameless project, when that file exists.
- `isRuntimeId` is also true for sublevel entity ids (`cellar:door`); bulk
  ids stay false.
- `FieldWidget`'s `point` widget's `pick` is a boolean: scene points keep
  `true`; a plain two-number tuple field (a setting's gravity) is now a
  `point` widget with `pick: false` instead of read-only JSON. `ModelField`
  is `InspectorRow` plus `section`.
- `captureSave` and `restoreSave` take a `SceneRuntimeHandle`;
  `restoreSave`'s success carries `issues` (an info `hash-mismatch` when
  the scene's run hash changed since the save). The shell's `saves.load`
  builds the save's scene fresh and restores into it before swapping it
  in, so a refused restore keeps the current scene. A world save's pad
  that isn't connected takes its saved seat when it connects.
- `createTopDownController` keeps its velocity on the motion body;
  behavior is unchanged.
- The site's game room plays the hosted project's scene list from its
  start scene (`GameConfig.flow` plus `flow.restart()`); a project without
  a list reports `start-scene-missing` on the page. The platformer gains
  `scene-list.json` (start `test-yard`).
- Tactics' level-1 golden recording
  (`src/games/tactics/__tests__/fixtures/level-1.recording.json`) gains
  `start.persist` because the game now declares `persist`.
  `TACTICS_GOLDEN_DIGEST` e2a58c6a80e955b3, `level-1.script.json`, the
  fuzz goal and the genre pins are unchanged: level 1 played without a
  scene list (golden, fuzz, browser smoke) still ends won at tick 589;
  only a level loaded through the flow asks for the result scene and
  returns a null outcome while it does.

### Fixed

- A client still holding a doc's history from before the server reseeded
  it (lost dev cache, replaced hosted row) is refused at its first sync
  step with close reason `4409 seed-stale` instead of merging both seeds
  into one doc, in the dev collab server and in canvas-sync. The editor's
  project session then drops its session, docs and socket and reopens from
  the server's state. Every doc the server seeds carries a `seed` root map
  stamping its seed's identity (`collab/seed-identity.ts`), written by a
  deterministic client id, so two instances seeding one doc write the same
  stamp.
- Editor Play follows co-edited project data: while the editor plays, an
  edit to the input map, game settings or a data table reaches the running
  game through `game.reloadAssets({ project, view, changed: [] })`, so new
  bindings drive actions mid-run instead of waiting for Stop.
- The genre harness's tick runs (`playTicks`) compile their script with the
  probe project's input-map seats and bindings.
- `project push`, `project pull` and the dev server's file adapter
  (`scan`, `watches()`) agree on which files are assets: a file under the
  asset globs that no kind detects (a script such as `art/make-art.ts`
  beside the art) is never read, watched, pushed, pulled or removed.
  `watches()` was true for it before.
- The tactics HUD declines Escape while no board is shown, so editor Play
  stops instead of the key being swallowed between scenes; a unit that
  joins later (a sublevel's guard) is numbered on from the units already
  named alike, fallen ones included, so the log never gives two units one
  name. Game side only: no pin, golden, public API, API report or schema
  moves.

### Agent surface

- `AGENT_SURFACE_VERSION` is 14, and every committed JSON Schema's
  `x-agent-surface` with it. `public-api.json`'s schema ids gain
  `urn:jams-engine:scene-list:v1` and `urn:jams-engine:save:v1`.
- Issue codes `scene-unlisted` (warn; an error at a runtime `go`),
  `start-scene-missing`, `sublevel-invalid`, `save-version-newer`,
  `save-too-large`, `save-slot-limit`, `save-unsupported` (errors) and
  `save-store-failed` (warn).
- CLI: `scene save <scene> --script s --at n --out <slot>.save.json
[--depth world|progress] [--now ms]` writes a save fixture (imported as a `save`
  asset in a project; world depth refused with `save-unsupported` and its
  causes; `meta.savedAt` is `--now`, default 0, so the same run writes the
  same bytes); `playtest --from-save <file>` and `fuzz --from-save <file>`
  start there; `playtest --flow` follows flow requests through the
  project's scene list; `scene flow [--project p] [--json]` lists the
  start, each listed scene's physics and bundle bytes, unlisted scenes and
  `scene-unlisted` references.
- CLI: `scene schema save` serves the `save:v1` schema.
- MCP `scene_flow`: each project's scene list as data, the same output as
  `scene flow --json` (start, each listed scene's physics and bundle
  blobs/bytes, unlisted scenes, issues). `scene_playtest` gains `flow`
  (follow scene requests through the scene list; `segments` in the result)
  and `fromSave` (a save fixture path or inline save:v1; the recording
  carries `fromSave`). `asset_apply_ops` edits the `scene-list` doc
  through its kind (insert/set/remove; `start-scene-missing` and
  `id-taken` refused).
- `save:v1` keeps the game's own `snapshot()` under `data`, not a second
  `game` key, because `game` is the game's id; `scene.entry` is optional.
- Schemas: `project/scene-list.schema.json` (`scene-list:v1`) and
  `project/save.schema.json` (`save:v1`) are new; `input-script.schema.json`
  gains `until.scene` and `until.persist` (`PersistMatch`: `pointer` with
  `eq`, `gte` or `lte`); `recording.schema.json` gains the optional
  `start.persist`, `start.entry`, `next` and `fromSave` (its id unchanged); `prefab.schema.json`'s params and `ops.schema.json`'s
  `exposeParam` gain the optional value `map`.

## [0.12.0] — unreleased

The second game, the scaffolder and the UI seam. `tactics`, a turn-based
square-grid skirmish with no physics, is built only on the public entries,
and what it couldn't do without a workaround landed in the engine (each
such line below ends "Found by the second game"). Games mount a DOM HUD
over the canvas through the project file's `ui` key, UI-only actions reach
`onAction` listeners and never the simulation, turn games list their legal
commands for fuzz, `step --legal` and the reports, and `game new` scaffolds
a project the site and editor open without an edit. The release also
closes 0.11.0's leftovers: dev-server and SSR crashes, one rule each for
the seat limit, pointer bits, nav types and one-per-project kinds, live
input-map reloads, and the remaining content in metres.

### Added

- `pointerBit(button)` in `@jams/engine/game`: a pointer button's bit in a
  DOM `buttons` mask and in a recorded tick's pointer buttons. The seat
  limit (`MAX_PLAYERS`), the pointer-button bit rule and the device-id
  schema each have one definition now. No behaviour or schema change.
- `DocKindDef.perProject: 1` marks a kind a project holds at most one of
  (with optional `perProjectWords` for its messages); game-settings and
  input-map declare it, and projectView, project ops and the dev file
  adapter judge every such kind through one rule, so a game's kind can
  declare it too. Messages are unchanged.
- `EntityTypeDef.oneWay` (`true` or a side, copied onto `RegisteredType`):
  every entity of the type is one-way on that side with or without its own
  `oneWay` field (a side the entity names wins; its own `true` or `false`
  keeps the type's side, as the solid system judges it), so `oneWayEdges`,
  the editor's one-way overlay, `renderSceneSvg` and the ASCII map draw the
  landing side of types made one-way only by their system. `createRegistry`
  refuses a value that isn't `true` or a side. The platformer's `cloud`
  declares `oneWay: true`, so its ASCII legend now reads `cloud one-way`.
- The UI seam: `mountUi(game, canvas, mount)` mounts a game's DOM UI
  (`MountUi`, named by the project file's `ui` key) over the canvas in a
  `data-jams-ui` layer from `createUiLayer` (pointer-events none, follows
  the canvas's box through a ResizeObserver, or the window's resize
  without one); its `UiContext` gives `slice()`, `watch` (once now, then
  per change by identity), the project's `settings` and `reducedMotion`;
  `bindText` and `bindToWorld` (a transform over a world point through
  `worldToClient`, moved when the view moves or a store change moves the
  point, hidden while the point is null) for framework-free HUDs. A host
  whose chrome floats over the canvas sets `--jams-ui-safe-top`, `-right`,
  `-bottom` and `-left` on an ancestor of the layer, and HUD panels offset
  by them. `UiHandle` and `UiActionEvent` are exported from `.` too. Found
  by the second game.
- `UiHandle.cancel?()`: a mounted UI is offered Escape in play through
  `GameInstance.cancel()`, after the game's attachment and newest UI first;
  returning true (it cleared a selection) keeps editor Play running instead
  of stopping it. Found by the second game.
- `heldProject(files, registry, meta)` (with `HeldFile` and `HeldProject`)
  in `@jams/engine/project`: the project view, kinds and runtime view a
  host builds from files it holds in memory (a doc's JSON, a binary's
  sidecar), keyed and identified as the scene CLI seeds one from disk.
- `watchView(ctx, fn)` in `.`: calls `fn` now and whenever where the world
  shows on screen may have moved (a camera change, and the layer following
  a canvas resize), for HUD DOM sized or placed through `worldToClient`;
  `bindToWorld` runs on it. Found by the second game.
- `createDataSystem` (and `DataSystem`) in `@jams/engine/game`: the system
  for a type whose entities are data a game reads, keeping the live ones by
  id in spawn order and simulating nothing; the marker primitive's system
  is one (`MarkerSystem` is now `DataSystem<MarkerEntity>`, and
  `createMarkerSystem(ctx, type)` uses both arguments). Found by the second
  game.
- `sameCell`, `inCellBounds` and `boundsCells` (a `CellBounds`'s cells in
  cell-key order) in `@jams/engine/game`'s grid toolkit; the grid stepper,
  `findPath`'s bounds and `ctx.grid.passable` use them. Found by the second
  game.
- `SceneEditor` takes `ui` (a game's `MountUi`) and mounts it over its Play
  canvas while Play runs, unmounting it on Stop.
- `ActionDef.ui?: true` marks a UI-only action; `Registry.uiActionNames`
  lists them in registration order (`actionNames` still lists every action)
  and `isUiAction(registry, name)` in `@jams/engine/game` is the one check.
  `createRegistry` refuses a `ui` other than `true`; a UI action's bindings
  are checked like any other's. Found by the second game.
- `ActionDef.ui` actions are resolved through every binding layer as
  usual, then reach only the input system's `onAction(listener, { actions? })`
  listeners (with `repeat: true` for the OS's key repeat on held buttons),
  never the tick queue, a `TickInput` or a recording.
  `createInputSystem(tables, { isUi })` takes the rule (`isUiAction`).
  `setFramePads` feeds a frame poll's pad changes to the listeners alone,
  and `listening()` says whether any listener exists. Found by the second
  game.
- `createGamepadReader` gains a frame cursor: `pollFrame()` and its `frame`
  view (`pads`, `reading`, `updatedAt`, typed `GamepadView`) keep their own
  previous state, so a frame poll and the tick poll never take each
  other's edges.
- `RecorderOptions.registry`: with it, the recorder leaves UI-only actions
  out of its `actions` table and seat streams. The browser shell and
  `runPlaytest` pass theirs.
- Input scripts: a `hold`, `press` or `set` naming a UI-only action is
  refused as `binding-unknown`, with the hint "UI actions don't reach the
  simulation; send a command". The input-script schema's `Action` enum and
  `AnalogSet`, and the input-map kind's `action` fields, list a game's
  UI-only actions in their own branch, marked `x-ui: true`.
- `GamePlayDef.commands?(state)`: the commands a run may send now. Found
  by the second game.
- `GameInstance.input.onAction(listener, { actions? })` (returns its
  unsubscribe; the shell polls UI actions every frame, also while a turns
  game waits), `GameInstance.worldToClient(p)` (a world point in metres
  to client pixels through the current camera) and
  `GameInstance.project()`, the project runtime view the instance was
  created with or last given by `reloadAssets`. Found by the second game.
- `legal`/`legalTruncated` on `ProbeReport` and `PlaytestReport`: the
  commands a game lists as legal after the last tick
  (`GamePlayDef.commands`), at most 64; `FuzzReport.legal` (`FuzzLegal`:
  `sent`, `empty`); `scene step --legal`; `playtest` and `fuzz` print
  legal counts; `scene_playtest` results carry `legal`.
- The `tower-defense` genre probe: waves from its project's `wave` data
  table (declared in the game's `tables`, read through
  `ctx.project.table`), a flow field to the exit, `ctx.timers.every`
  spawns, `ctx.query.inArea` targeting, bolts with `lifetime`, and `build` commands from `GamePlayDef.commands`; a fuzz
  variant (32 rollouts, seed 1) reaches `won`.
- The second game, `tactics` (src/games/tactics): a turn-based square-grid
  skirmish with no physics; level 1, the knight and archer prefabs, the
  unit-class table, game settings and an input map.
- `simActionError(registry, action)` in `@jams/engine/headless`: the error
  for an action scripted input can't drive (one the game doesn't declare,
  or a UI-only one), or null. `runProbe`, `scene step` and fuzz macros
  apply it; input scripts refuse the same actions with the same message.

### Agent surface

- `AGENT_SURFACE_VERSION` is 13, and every committed JSON Schema's
  `x-agent-surface` with it.
- The project file (`project:v1`) gains an optional `ui: { module, export }`
  (the game's DOM UI module, with the `game` key's patterns); the CLI never
  imports it. `project.schema.json` regenerated.
- Issue code `project-id-taken` (error).
- CLI: the `game` command group with `game new <id>` and its flags
  (`--name`, `--preset`, `--physics`, `--gravity`, `--time`, `--rate`,
  `--grid`, `--cell`, `--px-per-metre`, `--dir`, `--dry-run`);
  `step --legal` prints the report's legal
  commands after the last tick, or that the game lists none.
- `vp run scene game new <id>` scaffolds a game project from a preset
  (`top-down`, `grid`, `turns`; physics none, gravity [0, 0], every world
  and time field written, v4 scenes in metres) with a framework-free HUD, a
  scene whose checks and input script win, game-settings and input-map
  docs, generated schemas and a test; `--dry-run` lists the files.
- MCP `game_new` (a writer, dry run by default) takes the CLI's inputs and
  returns the written paths, the issues, the dev URLs and the playtest
  command.
- `project-id-taken` is now emitted by `game new` and `game_new` for an id
  a discovered project holds or a directory that exists.

### Changed

- The project file's optional `ui` key names the game's `MountUi`; a host
  (the site's room, `SceneEditor`'s Play) imports and mounts it over the
  canvas. The CLI and headless runs never import it.
- A game's `spawnOrder` may list only its own types (and any primitives it
  places): a bodied primitive it leaves out spawns before every listed
  group, in primitive order, as `decor` and `nav` already spawned last.
  Before, leaving one out was refused (`spawnOrder misses type`), so every
  game that registered before keeps its spawn order and Rapier handle
  order; only an order that leaves a bodied primitive out, newly accepted,
  spawns it first. Found by the second game.
- `fuzz` explores a game that lists its commands and has no macro by
  sending one legal command per one-slot macro (every macro on a `turns`
  clock, half of them otherwise, the rest holding actions as before); the
  default macro never holds a UI action.
- `GameInstance.reloadAssets` now picks up an edited input map in a running
  shell: when the update's `project.inputMap` differs from the current one,
  everything the old map holds is let go first (releases reach the next
  tick), then the bindings and the on-screen touch overlay are rebuilt from
  the new map. The player's remaps stay, less any the new map no longer
  allows (a touch control it dropped). The seat count and the pad deadzone
  keep the values the instance started with until the next `createGame`.
- A headless input script's pointer step now raises the actions bound to
  its buttons (the project input map's over the game's), as live play
  does; `compileInputScript` takes the input map as a fifth argument and
  its `CompiledScript` carries each seat's `pointerBindings`.
  `pointerHeld(hold, buttons, bound)` and `PointerBindings` in
  `@jams/engine/headless` give the actions a seat holds from its step's
  `hold` and its pointer buttons' bindings, combined as live play combines
  an action's bindings.
- An action's 0.x `keys` that the key table doesn't know are refused at
  registration (`binding-unknown`, with a did-you-mean: `"arrowup"` →
  `"ArrowUp"`, `"space"` → `" "`) instead of binding nothing; new
  `keysProblems`.
- `createRegistry` refuses a behavior `template` with an unknown field, a
  value its field refuses, or one its `refine` refuses.
- `InputScriptSchemas` (from `@jams/engine/scene`): a step's action
  schemas (`hold`, `press` and their lists) are typed `ZodType<string>`
  instead of a `ZodEnum`, since the action schema now refuses a UI-only
  action with its own message. Parsing a script is unchanged otherwise.

### Documented

- The README gains §UI (the UI seam, the project file's `ui` key, what a
  HUD may do, `uiContainer` for in-canvas drawing only, UI-only actions and
  `onAction`, with the framework-free example `dom-hud.ts`), §Turn games
  (legal commands in reports, fuzz and `step --legal`) and §A second game
  (the tactics game file by file), and the `tower-defense` row in its genre
  probe table.
- Scene CLI README: §New games (`game new` presets, flags incl.
  `--px-per-metre`, refusals, written files, how the site and editor open
  the game), §Legal commands (`step --legal`, `playtest`/`fuzz` legal
  counts), `game_new` in the MCP table, `project-id-taken` in the issue
  table, and a tactics `level-1` edit loop; every example runs in
  readme-examples.test.ts.
- The README's maths examples (shape queries, grid tools, nav walks), its
  scene and prefab format samples, the gravity default and the sprite
  size rows are in metres, and its example input scripts are v2.
- A track that ends before the others keeps holding its last step's
  buttons, values and pointer buttons until the script ends.

### Fixed

- UI-only actions are refused on every headless input path, not only in
  input scripts: `runProbe`'s `hold` and `inputs`, `scene step`, and a
  game's fuzz macro (whose action list no longer holds them) fail with the
  input-script message and hint; pointer bindings of UI-only actions raise
  nothing in a script's pointer step or a fuzz pointer move.
- `runProbe` reports `legal` for a run that loaded but stepped no tick,
  from the start state, as `runPlaytest` does.
- `SceneEditor` and the editor frame render on the server: nothing reads
  `window`, `document`, `navigator` or storage during render (the shared
  hooks are in `editor-ui/kit/ssr.ts`). A server render and hydration lay
  out for a 1280×800 window and the default layout, then the stored layout,
  section collapse and the real window size apply before the first paint;
  hotkeys draw Ctrl glyphs until hydration switches them to ⌘ on a Mac.
- `validateScene` judges whether a type is a nav type by the runtime's
  rule: a nav-based type with its own system is no longer checked as a
  walk area; `contacts` and the path follower read a collider's liveness
  through one `colliderLive`.
- Input scripts drive the seats the project input map's `players` gives,
  over the game's `input.players`: `scriptSeatLimit(registry, players?)` is
  the one rule; `scriptShapeIssues`, `inputScriptSchemasFor`/
  `inputScriptSchemaFor`, `parseInputScript` and `compileInputScript` take
  an optional `PlayersDef`, and `runPlaytest`, `runChecks` (`reaches`) and
  `scene step` pass the project's map. `scene step --command` takes
  `tick@seat:name[=json]` to send a command from a seat.
- The dev plugin (`sceneCollabServer`) keeps the dev server alive when a
  client hangs up mid-body on a request the site framework re-streams to
  its SSR worker: an unlistened `aborted` (ECONNRESET) on a
  `Readable.fromWeb` stream is dropped and warned once; any other
  unlistened error stays fatal.
- `editAsset` JSON edits accept RFC 6901's "-" end token as an insert
  pointer's last segment (`insert: "/actions/@fire/bindings/-"`),
  appending to a list or keyed collection the same way an omitted
  `before` does, from the CLI, MCP and the live editor path alike; "-"
  anywhere else, under a non-collection, or alongside `before` stays
  `op-invalid`.
- With `input.subTick` on, a live pad edge's offset comes from the pad's
  `Gamepad.timestamp` (the browser's last update), as a key's comes from
  its event; before, every pad edge was stamped at the tick's poll, the
  window's last thousandth. A pad with no timestamp on the page clock
  still counts as the poll.
- The dev plugin never writes a scene or prefab file back at an older
  format than the file holds. An editor tab left open across a restart
  that reseeds a doc from its newer-format file syncs its copy of the old
  seed back in, and the merged doc mixed both formats' values (a v4 level
  was written back as `v: 3` with px and metre geometry side by side). The
  doc is still persisted and the store throws, naming the file; closing
  the tabs and restarting the dev server reseeds it from the file.

### Internal

- The boundary test lets the site glob a hosted game's art
  (`/src/games/*/**/*.{png,jpg,jpeg,webp,gif}`) and its sidecars
  (`/src/games/*/**/*.asset.json`), and only from a call that also leaves
  out `!/src/games/*/**/__tests__/**`; every other deep glob into a game is
  still refused.

## [0.11.0] — unreleased

Input v2, local multiplayer and recording v2, with the world authored in
metres. Bindings name physical keys by `KeyboardEvent.code`; actions can be
buttons, axes or vectors fed by keys, gamepads, the pointer and on-screen
touch controls; up to eight seats share a keyboard or bring their own pads;
a project's input map and a player's persisted remaps layer over the
game's bindings. Recordings and input scripts move to v2: every seat's
input, the pointer, commands, seat changes and sub-tick offsets are
recorded, and v1 files migrate on read. Scenes and the simulation move to
metres (scene format v4), with Rapier at its default length unit, which
recaptures the golden traces once. The release also closes 0.10.0's
leftovers: gameless projects edit in the site, the editor gains grid,
occupancy and nav layers, and runtime ids, pools, contacts and the event
loop guard get fixes.

### Format

- Scene format v4: every length is in metres (scenes, prefabs, fragments;
  ops follow `SCENE_FORMAT_VERSION`). The v3 → v4 migration divides each
  length by the game's px per metre (`roundLength`): bounds, gravity, the
  grid, groups' and instances' `at`, shapes, points, paths, bulk entries,
  and every field whose `meta.unit` is m, m/s or m/s², including instance
  overrides and params through the prefab they name. Without the game's
  registry, or when an override's prefab or child can't be resolved, it
  refuses with `migration-unresolved`.
- `material`, `game-settings`, `data-table` and `checks` files are v2, with
  lengths in metres. Their v1 → v2 migrations divide by the game's px per
  metre: material `physics.impulse` in m/s; game-settings `engine.gravity`
  in m/s² and the game's `projectSettings` length fields by `meta.unit`;
  data-table rows by their row schema's units; checks' `reaches.at` and
  game checks' length args, and `reaches.expect`'s.
- `recording:v2` (`urn:jams-engine:recording:v2`, `RECORDING_VERSION` 2):
  per-seat `inputs` streams and a `system` stream of tuples, `seed`, `time`,
  `platform`, `players`, `project`, `runHash`; `engine.physics` is null
  without physics. `parseRecording(input, registry?)` reads v1 and v2 and
  migrates v1 on read (`migratedFrom: 1`): key edges become seat 0's `b`
  events, commands its `c` events (an `@elapsed` leading its tick becomes a
  system `w` event), `start.seed` or the default seed becomes `seed`,
  `tickRate` becomes `time` with the registry's time kind, else `fixed`;
  platform unknown, project null, `runHash` empty so staleness falls back
  to `sceneHash`. v1 ran in world px, so its lengths become metres at the
  registry's px per metre (else the default 100) by the input-script rule:
  `start.at`, the outcome's `at`, markers and trail always, the play
  options and each command's args where their schemas declare a length
  unit. A 0.10.0 recording replays stale (its `sceneHash` is the v3
  document's), and most diverge: the simulation it ran was recaptured in
  metres.
- Recordings are written as v2: per-seat input streams and a system stream
  (button, axis, vector, pointer and command events; `@elapsed`, joins and
  leaves), every seed (the default one when the run named none), time,
  platform, players, project and `runHash`; pointer samples only when they
  change; sub-tick offsets only with `input.subTick`.
- `input-script:v2` (`urn:jams-engine:input-script:v2`,
  `input-script:<game>:v2`): exactly one of `steps` (seat 0's track, v1's
  form) or `tracks: [{ player, steps }]`, one track per seat; new steps
  `set` (axis values and vector pairs, alone or with `hold`), `pointer`
  (`at`, `press`, `release`, `drag`, in metres), `join` and `leave`; header
  `players?`. A v1 script migrates on read (the input-script kind's 1 → 2
  migration, `parseInputScript`): `v: 2`, and its `at`, play options,
  `until` predicates and command args divided by the game's px per metre
  by their units.
- `checks:v3`: inline scripts are input-script v2; a v1 or v2 checks file
  migrates on read, inline v1 scripts lifted as script files are; `vp run
scene fmt` writes v3.

### Added

- Input contracts in `./game`: `ActionKind`, `Binding` (keys by
  `KeyboardEvent.code`, pad buttons, sticks and axes, pointer buttons,
  on-screen controls), `ActionDef.kind`, `GameDefinition.input`
  (`GameInputDef`: `players`, `subTick`, `deadzone`), `PlayersDef`,
  `PlayerInfo`, `DeviceId`, `GameCommand.player`, `Macro.set` and
  `Macro.pointer`, and `EngineContext.input` (`InputState`, `PointerState`):
  every seat's held, pressed and released actions, values, vectors and
  pointer for the tick. Until seats are assigned, seat 0 owns every device.
- `ctx.input` is live: `held`, `pressed`, `released`, `value`, `vector` and
  `pointer` per seat, rebuilt each tick from that tick's `TickInput`, so a
  replay reads the same state. Sticks pass a radial deadzone that zeroes
  them inside it and rescales their magnitude from dz…1 to 0…1; analog
  values are clamped (axes to −1…1, vectors to the unit disc) and quantised
  to 1/1000, pointer positions to 1/10,000 m.
- The device vocabularies in `./game`: `KEY_CODES`, `PAD_BUTTONS`,
  `PAD_AXES`, `POINTER_BUTTONS` and `KEY_TO_CODE` (a US-layout key to every
  code that produced it: `"Shift"` is both Shifts, `"1"` the digit row and
  the numpad), with `PadButton`, `PadAxis` and `PointerButton`.
- `PLAYER_JOINED` and `PLAYER_LEFT` in `./game` and `./headless`;
  `StepEvent.player`.
- `InputAction.value`, `x`, `y`, `player` and `offset`; `InputBinding.bindings`.
- `GameInstance.clientToWorld(clientX, clientY)` and `GameInstance.input`
  (`GameInput`: `bindings`, `rebind`, `reset`, `capture`, `assign`,
  `players`, `trackPointer`). `GameConfig.input` (`touch`, `remaps`).
- In `.`: `memoryRemapStore`, `browserRemapStore`, `RemapStore`,
  `RemapState`, and `createTouchControls` (`TouchControlDef`).
- In `./headless`: the stream types `TickInput`, `SeatEvent`,
  `SystemEvent`, `SeatChange`, `StreamTables`, the `RunRecordingV2`,
  `RecordingStream` and `RecordingPlatform` types, the v2 script types
  `InputScriptV2`, `InputScriptStepV2` and `InputScriptTrack`, and
  `decodeStreams`; `PlaytestReport.stream`, `ReplayReport.issues` and
  `ParseRecordingResult.migratedFrom?`.
- In `./project`: the `input-map` kind's definition (`inputMapKind`,
  `INPUT_MAP_KIND`, `INPUT_MAP_VERSION`, `INPUT_MAP_SCHEMA_ID`,
  `InputMapFile`, `InputMapTouchControl`); `KindEnv.prefab`, a host's
  lookup of the project's parsed prefabs for migrations.
- `input-map` is a registered engine asset kind (after `input-script` in
  `ENGINE_ASSET_KINDS`; `./schemas/input-map.schema.json`,
  `urn:jams-engine:input-map:v1`). There is at most one per project
  (`asset-kind` on a second; `inputMapIssues`, `inputMapEntries`). Its
  schema judges each action against the game's (`binding-unknown`) and
  every binding through `bindingProblems` (`binding-unknown` with a
  did-you-mean over the code tables; `player-unknown` for seats).
  `inputMapProblems` is that one rule; `usableInputMap` is what a run
  reads. Docs are capped at 256 KiB and counted by `projectUsage` as docs.
- `ProjectRuntimeView.inputMap` is the project's first input map by path,
  without the seats, actions and touch controls it gets wrong, which keep
  the game's. `RUNTIME_VIEW_KINDS` names the doc kinds a runtime view
  reads; `snapshotRuntimeView` pins input maps.
- The engine home has an `input-map.json` (two seats, `auto` join,
  deadzone 0.2).
- Units in `./scene`: `roundLength` (micrometres, no `-0`), `snapToPixel`,
  `pxToMetres`, `isWholePixel`, `lengthDecimals`, `LENGTH_UNITS` and
  `LengthUnitName`; in `./game`: `DEFAULT_LENGTH_UNIT` (100), `pxPerMetreOf`,
  `lengthUnitOf` and `scaleLengths`, which scales every length-unit number
  under a schema (objects, tuples, arrays, records, unions, optionals,
  defaults; a shape's `rotDeg` stays degrees).
- Migrations take an env: `MigrateEnv` (`registry`, `prefab`),
  `MigrationRefusal` and `isMigrationRefusal` in `./scene`; `migrate`'s
  fourth argument, `ParseOptions.prefab` on `parseScene`, `parsePrefab` and
  `parseFragment`, and `MigrateDocOptions.env`.
- `onePixel`, `pixelSize`, `snapToGrid` and `formatMetres` in `./editor`.
- Testing: `migrationHarness` takes `prefabOf` and `current`; a fixture
  name may appear in several older folders and must land on one
  current-version file.
- `resolveBindings(layers)` combines the four binding layers. Per action
  and seat, the first layer that names the action wins and replaces its
  bindings whole: the player's remap, then the host's `GameConfig.bindings`,
  then the project's input map, then the game's `actions`. It returns each
  seat's bindings, the layer each came from, and per-device lookup tables
  (keys by `KeyboardEvent.code`, pad buttons, axes and sticks, pointer
  buttons, touch controls). `bindingProblems(binding, { kind, max,
controls? })` is the one binding check: unknown code, button, axis,
  stick, pointer button or control, with did-you-mean; a shape that doesn't
  fit the action's kind; a seat past `max`. `playersProblems` judges
  `players` (max 1–8, a known join policy).
- The types and helpers around them: in `.`, `ResolvedBindings`,
  `BindingLayers`, `BindingLayerName`, `ActionBindings`, `DeviceTables`,
  `BoundInput`, `TouchControlValue`, `MAX_PLAYERS` (8) and
  `resolvePlayers(map, game)` (the input map's seats, else the game's,
  else one); in `./game`, `ACTION_KINDS`, `BindingContext`,
  `BindingProblem` and `declaredBindings(def)` (an action's `bindings`,
  else its 0.x `keys` through `KEY_TO_CODE`); in `./project`,
  `InputMapProblem`; in `./headless`, `DecodeOptions`; in `./scene`,
  `ScriptPointer`, `AnalogSet`, `ParseInputScriptResult` and
  `MigrateInputScriptResult`.
- `BehaviorDef.template` (`./game`): the block the editor's Add behavior
  writes before seeding required fields (default `{}`); `lifetime` uses
  `{ ticks: 60 }`.
- The editor's View layers: Grid (the scene grid's cells from
  `settings.grid`, square or hex, else a line every metre), Occupancy (the
  wall cells the game's `world.gridWalls` fill, rasterised as a load does)
  and Nav (walk areas, holes and the nav mesh), toggled from a View group
  in the toolbar's grid-step menu, off by default and remembered per
  viewer.
- Gamepads, polled once per shell tick (`navigator.getGamepads`): buttons,
  sticks and triggers (`lt`/`rt` as axes) by their standard-mapping names,
  other pads by raw index, through the input map's or the game's radial
  deadzone. Pad bindings combine with the other bindings of their action,
  a binding reads its seat's pad furthest from rest, and a disconnect
  releases the pad's held inputs.
- `ToolEvent` pointer events carry `pointerType` (`PointerKind`: "mouse" |
  "pen" | "touch"), `pointerId`, and `left` (a `pointerleave`, routed as a
  move); `pointercancel` routes as `up`. Play input takes pointer
  `down`/`up` as well as `move`: pointer buttons (`{ device: "pointer",
button }`) are button bindings, and a button changed mid-chord counts
  from its move. `InputSystem.getPointer()` (`PointerReading`: position,
  held `buttons`, `over`), `setTouchControls(target)`
  (`TouchControlTarget`: a touch that starts where `controlAt` names a
  control drives it through `drive` until it lifts; the first other touch
  is the pointer holding its primary button), `setControl(control, value)`
  (the on-screen controls' sink, raising touch bindings). `releaseAll` also
  lets go of pointer buttons and control touches.
- Pointer samples: at each tick start the shell converts the pointer
  through the camera to world metres, quantised to 1/10,000 m, and a
  `TickInput` carries a sample only when its position, `buttons` or `over`
  changed; `GameAttachment.onTick` receives the sample's position.
- `createTouchControls(host, controls, sink)` draws on-screen `stick`,
  `button` and `dpad` controls as a framework-free DOM overlay; `at` and
  `radius` are fractions of the canvas's shorter side. Sticks and d-pads
  report quantised unit-disc vectors (y down; d-pads snap to eight
  directions), buttons report `{ down }`; `show(false)` and `destroy()`
  release held controls; `hitTest(clientX, clientY)` names the control
  under a page point so a touch starting there is not the pointer.
- On-screen touch controls from the input map's `touch`, shown in play per
  `GameConfig.input.touch` (default "auto": `matchMedia("(pointer:
coarse)")`); a touch that starts away from every control is the pointer.
- `GameInstance.input.trackPointer(on)` follows document-wide pointer moves
  for DOM drags.
- `runProbe` takes `library`, every prefab `ctx.instantiate` may place
  (default `prefabs`), like `runPlaytest`.
- `browserRemapStore(prefix?)` keeps a player's remaps in `localStorage`
  under `jams-engine:remap:<gameId>`; storage that is missing, blocked or
  full, or a value that doesn't parse, loads as no remaps and never throws.
- Seats in the shell: devices reach seats by the game's or input map's
  `players` (`auto`: pads take free seats in connection order; `press`: a
  device's first press takes the lowest free seat; `host`:
  `GameInstance.input.assign`); a key binding's `player` drives that seat
  on a shared keyboard; a disconnected pad is released on its seat, then
  the seat is freed. Seat changes ride the next tick's `TickInput.joins`,
  and a new world's first tick carries the live seats.
  `GameInstance.input.players()`. The runtime's seats follow the input
  map's `players` when it sets them, else the game's.
- Remapping persisted in the player's browser: `GameInstance.input.rebind`
  (judged by `bindingProblems`, refused with `binding-unknown` or
  `player-unknown`), `reset`, `bindings(player?)`, and `capture` (the next
  key, pad button or pointer press; null on Escape or timeout). A rebind
  saves through `GameConfig.input.remaps` at once and applies from the
  next tick; stored remaps the game no longer fits are dropped on load.
  Remaps never reach a recording, the project or the site; the site passes
  `browserRemapStore()`.
- `encodeTick(input, tables, { subTick? })` and `decodeStreams(rec, {
tickMs?, subTick? })` implement the recording v2 stream: per-seat
  `b`/`a`/`v`/`p`/`c` events and the system stream's `w`/`j`/`l`, names by
  table index, analog values as ints × 1000, pointer positions as ints ×
  10,000 (metres), sub-tick offsets in thousandths; `mergeTick(input)` puts
  a live tick in the order a replay feeds it (system first, then seats in
  order).
- `runRecordingV1Schema`, `RunRecordingV1` and `migrateRecordingV1`.
- `runHash`: `preparePlay` hashes what a run runs (the expanded scene, the
  resolved clock, the project view's settings, engine block, declared
  tables in name order and input map, and the run's prefab library) and a
  replay is stale when it differs; a recording migrated from v1 falls back
  to `sceneHash`, so a re-format that leaves the expanded scene equal no
  longer makes a recording stale.
- `REPLAY_ACROSS_PLATFORMS` (true) and `platformIssues`;
  `ReplayReport.issues` carries `recording-other-platform` when the flag is
  false and a Rapier recording's known arch differs;
  `ReplayReport.migratedFrom`.
- `RecordingHost { platform?, projectRef? }` on `ReplayOptions` and
  `runPlaytest` for the Rapier flavour and the project's snapshot.
- `PlaytestReport.stream` (always filled), every seat's input as a v2
  recording holds it, beside `inputs`, now deprecated.
- `PhysicsWorld.isGrounded(controller)`: Rapier's `computedGrounded()`
  and a computed collision whose normal faces the controller's `up`, so a
  character is grounded on contact rather than within Rapier's prediction
  distance (about 5 cm at the metre unit) above the floor.
- `GameConfig.recording` (`RecordingHost`): the Rapier flavour and the
  project's snapshot a host knows, carried into Play's recordings.
- `parseInputScript`, `migrateInputScript`, `INPUT_SCRIPT_MIGRATIONS`,
  `scriptShapeIssues`, `worldPointSchema`.
- `compileInputScript` compiles input-script v2: `tracks` (one per seat,
  run at once from slot 0, each with its own `until`s; `script-end` once
  every track ran out), `set` (axis values and vector pairs held for the
  step, alone or with `hold`; a value the next step drops returns to 0),
  `pointer` (`at`; `press` on the first slot, `release` on the last; `drag`
  moves linearly from `at` and reaches `drag` on the last slot),
  `join`/`leave` (the system stream's `j`/`l` for the track's seat);
  commands from a seat other than 0 carry `player`.
- `scriptSource(script, holds, time?)` plays a compiled script as one
  `TickInput` per slot for `runLoop`, `runPlaytest` and fuzz, plus the
  shared helpers `analogValues`, `analogActions`, `compiledPointer`,
  `pointerAt` and the types `CompiledScript`, `CompiledScriptStep`,
  `CompiledTrack`, `CompiledPointer`, `AnalogValues`, `ScriptSource`,
  `ScriptStepLog`.
- `fuzz`'s default macro now also sets the game's axis and vector actions
  (`Macro.set`) and moves, clicks and drags the pointer (`Macro.pointer`,
  seat 0, inside the scene bounds) when an action is bound to a pointer
  button; `defaultFuzzMacro(rng, actions, inputs?)` takes the new
  `FuzzMacroInputs` (`axes`, `vectors`, `pointer: { buttons, actions?,
bounds }`). A button-only game's rollouts are unchanged;
  `GamePlayDef.macro` still wins, and a game macro's `set` and `pointer`
  are checked (unknown action, wrong kind, a press and release in one
  tick).
- Commands per seat: every send (`GameInstance.send`, `GameShell.send`, a
  host's DOM drop) is recorded as a `c` event on the sending seat's stream
  (`GameCommand.player`, default 0) and replays on it; a seat past
  `players.max` is refused with `player-unknown`. A tick's commands reach
  the game seat by seat, live and on replay.
- The `local-versus`, `point-and-click` and `rhythm-tap` genre probes.
  `local-versus` (local-multiplayer and fighting, in part): two seats on
  vector sticks join on the keyboard and `pad:0` and play a two-track v2
  script with physics `none`. `point-and-click` (point-and-click, and rts in
  part): a click on a walk area paths a walker along `ctx.nav`, and a click
  on a hotspot found with `ctx.space.pointAt` picks it, and the `use {
hotspot }` command a host sends for the pick walks the walker there and
  fires it; the recording carries the command and the replay reproduces it.
  `rhythm-tap` (rhythm, in part until the audio clock): with
  `input.subTick` on, taps arrive as `TickInput`s with sub-tick offsets and
  are judged by them. Each run reaches its result and its replay matches.

### Changed

- `SceneRuntime.step(dtMs, input, commands?)` takes a `TickInput` or 0.x's
  action array; the runtime updates `ctx.input` from it before the systems'
  `beforeStep`, and the game's `beforeStep` receives its actions and
  commands as before.
- `InputBinding.keys` is optional and deprecated (read through
  `KEY_TO_CODE`); `GameConfig.bindings` is the host's layer of four.
- `GameDefinition.world.lengthUnit` is documented as px per metre.
- `Migration` steps receive the migration env as their second argument.
- `migrateDoc` takes `env` (the registry and prefab lookup), lifts prefab
  docs whose values change through `prefabPatch`, and throws without
  changing the doc when a step refuses. `parsePrefab` migrates a whole
  older prefab (its params' defaults, variant overrides and contract too),
  and the file adapter and the scene CLI parse prefabs and scenes with the
  project's other prefabs as the migration's lookup.
- Every engine length field declares `meta.unit` `m`/`m/s`/`m/s²`
  (pointField, vectorField, PathSchema, shape tuples, polygonField, sprite
  size/offset, settings gravity and grid), with descriptions in metres;
  input-script `at` and recording points are metres. `bounds` and op
  points are no longer integers; `settings.grid` cells, hex sides and
  origins must be whole px at the game's px per metre (`grid-invalid`);
  `non-integer` now means a length off whole world px at the game's px per
  metre, and its fix snaps through `snapToPixel`; a `rect` shape no longer
  has to have even sides; `density` is kg/m². Ops and transforms keep
  every moved coordinate to micrometres (`roundLength`), so a move and its
  inverse round-trip, and `place` snaps its offset to whole world px.
  `EMPTY_SCENE_TEMPLATE` is 19.2 × 10.8 m.
- The simulation runs in metres, and Rapier's world keeps Rapier's default
  length unit (1 m), which removes PHY-4's px-scale tolerance problem;
  `world.lengthUnit` reaches nothing in the simulation. Engine constants
  converted at 100 px per metre: `DEFAULT_GRAVITY` is `[0, 12]` m/s²;
  `SIDE_VIEW_CONTROLLER` and `TOP_DOWN_CONTROLLER` keep a 0.0001 m offset,
  and the side view autosteps 0.04 × 0.02 m and snaps 0.04 m; one-way
  solids hold an actor within 0.04 m of their face; `createSpatialHash`'s
  default cell is 2.56 m. `castSpawn`'s refusal and the physical checks'
  messages give metres.
- **Breaking:** `STUCK_PX` (4) is now `STUCK_METRES` (0.04); a `stuck`
  cause reads 'the focus moved under 0.04 m in 120 ticks…'.
- The camera works in metres: `CameraState.scale` is canvas px per metre
  (the resolution policy's scale × `world.lengthUnit` × zoom);
  `screenToWorld`, `clientToWorld`, `pointerWorld`, `frame` and
  `extractPixels` take or give world metres; the camera's scene margin is
  1 m, and `DEFAULT_GAME_CONFIG.camera.bounds` is -20..40 × -20..20 m.
- `createPixiView` draws metres at its new `pxPerMetre` option (default
  100), its container scaled to world px, so strokes, tiles and nine-slice
  insets keep their px; a layer handle's container is in world px.
  `drawShape` and `traceShape` take an optional `scale` (coordinates and
  radii only; the stroke width stays px).
- Debug layers: `DebugFrame.scale` (canvas px per metre),
  `DebugLayerHost.pxPerMetre`, `DebugDeps.pxPerMetre?`,
  `DebugSceneSource.grid?`; line widths and labels are screen px; the grid
  layer draws the scene grid's cells, else a line every 1 m and 10 m (was
  every 64 and 256 px).
- A sprite's default drawn size is its frame's px over the game's px per
  metre, times `scale` (`spriteGeometry`'s new `pxPerMetre` argument;
  `SPRITE_FALLBACK_SIZE` is 0.32 × 0.32 m); `spriteBoxOf` takes the game's
  px per metre.
- `renderSceneSvg`, `renderSceneAscii`, `sceneViewport` and
  `sceneAsciiMap` read scenes in metres and draw them in world px (metres ×
  `world.lengthUnit`); a migrated v3 scene renders the same SVG and ASCII
  as before at 100 px per metre. `region`, `margin` (default 1.28 m) and
  overlay points are metres. `SceneViewport.region` is metres and
  `SceneViewport.pxPerMetre` / `SceneAsciiMap.pxPerMetre` are added.
- The editor works in metres: free drags, pastes, nudges and drawn shapes
  land on whole world px through `snapToPixel` at the game's px per metre;
  arrow keys nudge one world px (Shift ten, Alt one); `SnapSettings.step`
  is metres and `SNAP_STEPS` is 0.25, 0.5, 1, 2 and 4 m (default 0.5 m);
  the gizmo and draw readouts print metres (`Δ 0.64, 0 m`,
  `W 1.6 H 0.16 m`); the inspector model steps an `m` field one world px
  and gives it `lengthDecimals` decimals (`FieldWidget.decimals`), `m/s`
  and `m/s²` fields 0.01, and writes metric values to micrometres; the
  editor's spatial index cell is 2.56 m. The gizmo, batch, readout, nudge
  and snap helpers take the game's px per metre, and peer cursors are
  published to whole world px.
- The editor shows every length in metres with its unit: the inspector's
  shape, point and point-list fields step one world px (ten with Shift) at
  the game's px per metre, typed lengths are kept to micrometres, read-only
  metric fields read `3.25 m` / `4 m/s`, and the grid step reads `0.5 m`;
  panel and column sizes stay screen px. The grid step's button shows the
  number (`0.5`), its label and menu the metres.
- `projectMaterialOf(value, registry?)` lifts a v1 material file to v2
  through the game's px per metre, so a project overlay keeps a material
  its file hasn't been formatted to v2 yet; `unitsRefusal` lives in
  `./scene`'s issues module.
- A prefab doc's view grows its parent's bounds by 0.64 m around its
  children (was 64), to whole metres plus the margin. Grid wall cells, the
  `out-of-bounds` check and a diff's inferred `move` read lengths at the
  file's micrometre precision, so float sums on a cell or bounds edge (3.68 +
  0.16) count as on it.
- The platformer is authored in metres at 100 px per metre (`world: {
gravity: [0, 12], lengthUnit: 100 }`): movement tuning, the player box
  (0.6 × 0.6 m), the grapple range (4 m), construct sizes, bounce and
  trampoline launch velocities (-6.5 and -7 m/s), wind (8 m/s²), the
  new-scene template, and its issue texts and physical-check messages are
  metric.
- Game input matches keys by `KeyboardEvent.code`, so a binding means the
  same physical key on every layout (a `KeyW` binding fires on an AZERTY
  z). 0.x `keys` still work, mapped through the US-layout `KEY_TO_CODE`
  table (`" "` is Space, `"Shift"` is either Shift); they are deprecated.
  Editor shortcuts still match `KeyboardEvent.key`. `ToolEvent`'s key
  variant gains `code`; a key event with no physical code (a virtual
  keyboard) is read through its US-layout key. The shell combines
  `GameConfig.bindings` with the game's `actions` per action (the host's
  binding of an action replaces the game's whole, the game's bindings stay
  for every other action) instead of replacing the whole list, and in dev
  warns about each host binding `bindingProblems` refuses.
- `createRegistry` refuses an action of unknown kind, `input.players`
  outside 1–8 or with an unknown join policy, `input.deadzone` outside
  0–1, and every binding `bindingProblems` refuses, naming
  `binding-unknown` or `player-unknown`. 0.x `keys` still map through
  `KEY_TO_CODE`. A key the table doesn't know still binds nothing and isn't
  refused.
- The golden traces and determinism pins were recaptured once, when the
  simulation moved to metres: Rapier's default length unit fits a metre
  world, which fixes PHY-4's px-scale tolerances. Measured against the old
  m1-golden.json ÷ 100 on test-yard: every route differs from tick 0 by
  float rounding (≤ 0.1 mm). Final positions drift 0.19 mm (parity),
  0.12 mm (right-route) and 1.1 mm (left-route), with the same state,
  ground and velocity. At the metre unit Rapier's `computedGrounded()`
  also counts ground within its prediction distance (about 5 cm) above
  the floor; the player is grounded through `PhysicsWorld.isGrounded`,
  which needs a contact as well, and `landed` always names its ground
  entity (grounded on nothing nameable changes no state). With that, every
  landing and left-ground lands on the px traces' ticks and grounds,
  except two in left-route: its one-tick touch of ~solid:9 at tick 116 is
  gone, and it leaves the ball at tick 394, not 392, and lands on ~solid:0
  at 403, not 404. The determinism pins' script and fuzz digests moved (script
  ec60f220d6590d0d → 4f2826bab91c676f, fuzz cede7d80dbf9a1bb →
  319584c2c406e711); pile is plain Rapier and didn't move. Both
  length-unit probes now show that `world.lengthUnit` (100, 32, 48) leaves
  every digest identical. The genre pins of the shooter, top-down and
  turn-tactics probes moved with their positions, now in metres, on every
  variant (with and without physics), and point-and-click's when its probe
  began sending `use`; the other probes' pins didn't move.
- Hosted scene and prefab docs stored at format v3 open read-only until
  migrated: canvas-sync holds no game code, so it never runs the v3 → v4
  step for a doc that names a game, or for a prefab doc. A scene doc that
  names no game is lifted to v4 at load with the engine's own registry.
  The rest it keeps at v3 (lifting v1/v2 docs to v3), serves them to v4
  clients with the `scene-read-only` notice reason `migration-unresolved`,
  and stores no snapshot text for them. Migrate a hosted project with
  `vp run scene project pull`, `fmt` and `push`. New docs and seeds at the
  current format are written at v4. A bundle seed that can't reach v4 is
  refused.
- Play input combines an action's bindings: a button action is raised on
  each edge of 'any binding held' (two keys on one button no longer raise
  two presses), and an axis or vector action is raised whenever its
  quantised value changes, with `value` (axis) or `x`/`y` (vector) and
  `pressed` meaning non-zero. An axis takes the binding reading furthest
  from zero; opposite readings tied for furthest cancel to 0. A vector sums
  its keys and pad buttons (each its `value` on its `axis`), adds the stick
  furthest from centre, and clamps the sum to the unit disc. The project's
  input map is the third binding layer (remap > host > input map > game).
- `createGame`'s `game` and `SceneEditor`/`mountSceneEditor`'s `game` prop
  accept `null` for an engine-only project, whose scenes play and edit
  under `createRegistry(null)`, the registry the dev server, `./vite`'s
  `readFileProject` and the scene CLI judge it by, so the editor no longer
  opens such a project read-only with the code-skew notice. In a scene no
  game runs, Play's camera looks at the play start, else the centre of the
  scene's bounds.
- Event games wake on what the tick's input carries: any action (button
  edges, analog changes, pointer-button bindings) and pointer-button
  changes; pointer moves only with `wakeOnPointerMove`. Turns games wake
  only on commands and `@elapsed`.
- `renderSceneSvg` draws each one-way solid's landing face (a `<g
id="one-way">` of `<path data-one-way="<id>" data-side="up|right|down|left">`
  over the entities), from the same `oneWayEdges` rule as the editor's
  overlay; `renderSceneAscii`/`sceneAsciiMap` mark one-way through
  `oneWaySide`, so a `oneWay` string that isn't a side no longer draws `=`.
- `PlayState.world` is required; every run path (runPlaytest, fuzz,
  replay, runProbe, the shell's Play and its session recording) fills it
  with `playWorld(runtime.ctx)`.
- `runProbe` ends a run that an `EngineError` stops mid-step as
  `report.blocked` (a `PlaytestBlocked` at stage `run`, the error's code on
  its issue, the report covering the ticks before it) instead of throwing,
  and gives `play.outcome` the live `world`.
- `RunRecording` is the v2 type; the `recording` asset kind reads v1 or v2
  bytes and `RecordingMeta` gains `v` (the file's format) and `players`
  (seat count).
- `RunRecorder.tick(state, input: TickInput, focus)` replaces the edges and
  commands arguments; `RecorderOptions` takes `runHash` (required),
  `players`, `platform` and `projectRef`; `recordingStart(start, seed?)`.
- Headless runs step `TickInput`s merged system first, then seats in
  order, with analog values and pointers quantised; `InputSource.tick`,
  `RunLoopOptions.onTick`'s fifth argument (the `TickInput`), and
  `tickWakes` judge waking from the whole tick input as the shell does.
- The shell steps each live tick's whole `TickInput` through `mergeTick`,
  seat by seat as a replay decodes it, so actions, pointers and commands
  reach the runtime in the order the recording replays them (before, only
  commands were merged). With `input.subTick` on, each live action's
  `offset` is stamped from its event's timestamp: where it fell in the
  tick-long wall-clock window the tick closes, in thousandths, so a live
  run and its recording carry the same offsets.
- `SessionRecording.input(tick, live)` feeds a replay's `TickInput`s;
  `actions()` and `commands()` are deprecated; `stepped()` takes a
  `TickInput`.
- `PreparedPlay.runHash`; `preparePlay` takes `project` and `library`.
- The shell records each tick's `TickInput` as recording v2 (every seat's
  actions, pointer samples, seat joins and commands), and
  `GameInstance.replay` steps the recorded ticks whole: the attachment's
  `onTick` pointer, the seats and every command come from the recording,
  never from live devices. Shell recordings name `platform.arch` from
  `navigator.userAgentData` client hints (in `process.arch` names,
  `unknown` elsewhere) and carry `runHash` over the run's project data and
  prefab library.
- `INPUT_SCRIPT_LAYOUT` keys tracks by `player`, so concurrent step
  inserts into one track or two merge; keyed layouts match numeric ids.
- A v1 script handed to `compileInputScript` compiles as written (its
  steps and header only; v2 keys refused with a hint); reading a v1 file
  through `parseInputScript` is what migrates its units. `runPlaytest`
  plays scripts through `scriptSource`, and a `reaches` check reads its
  script file through `migrateInputScript`.
- `PlaytestStep.player` names the track of a `tracks` script.
- The platformer's Shaper runs on commands. Placing sends `shaper-place {
type, at: [x, y] (metres), rot (whole degrees) }` and right-click
  removal sends `shaper-remove { id }` through `shell.send`. The runtime
  applies them in `beforeStep` through the ConstructSystem, and a placed
  construct is a `construct#<n>` entity spawned through `ctx.spawn`, so a
  recording replays the same constructs in the shell and headless. A
  refused command raises `shaper-refused`. The golden traces don't use the
  Shaper and are unchanged.

### Removed

- The `src/engine/input.ts` module path: the input system lives in
  `src/engine/input/system.ts`.

### Fixed

- Adding Lifetime from the inspector's Add behavior menu writes a valid
  block instead of `{}`, which `applyOps` refused.
- Runtime-id counters skip ids that are already live, so a scene loaded
  back from `runtime.scene()` holding `player#1` gives the next
  `ctx.spawn` `player#2` instead of claiming `player#1` again.
- A pool belongs to the load it was made in: after the next `load` or
  `unload`, `acquire` and `release` throw `EngineError("pool-stale")` and
  `free`/`live` read 0, so a pool kept past its load can't take the next
  load's `bullet#1`.
- The event loop guard counts the second dispatch point's deliveries
  across the end-of-tick flushes as one pass, as documented, so a tick
  delivers at most 4,096 events per point; before, each flush got its own
  budget. Checked spawns reuse each type's spawn schema instead of
  rebuilding it. Contacts find a Rapier collider resized in place
  (`setRadius`, `setHalfExtents`, `setHalfHeight`, `setRoundRadius`), and a
  destroy forgets an entity's colliders without scanning every collider.
  The Problems panel's hover names each row's rule code, which a long
  message can clip in a narrow column.

### Agent surface

- `AGENT_SURFACE_VERSION` is 12, and every committed JSON Schema's
  `x-agent-surface` with it.
- Issue code `migration-unresolved` (error): a migration step can't run
  without the game's registry or the prefabs the file names. The
  `path-invalid`, `non-integer` and `grid-invalid` texts give metres.
- Issue codes `binding-unknown` (error): a binding names an action, key
  code, pad button or axis, pointer button or touch control that doesn't
  exist, or doesn't fit its action's kind; `player-unknown` (error): a
  binding's seat or a seats declaration is past the seats there are;
  `recording-other-platform` (warn): a Rapier recording replayed on another
  CPU architecture.
- JSON Schema `input-map.schema.json` (`urn:jams-engine:input-map:v1`).
- JSON Schema `recording.schema.json` is recording v2
  (`urn:jams-engine:recording:v2`), `input-script.schema.json` is
  `urn:jams-engine:input-script:v2` (`input-script:<game>:v2`), and checks
  files are `urn:jams-engine:checks:v3`.
- Every committed JSON Schema reads v4 (`scene:v4`, `prefab:v4`,
  `fragment:v4`, `ops:v4`) and the material, game-settings and data-table
  URNs v2; length fields carry `unit` m, m/s or m/s².
- CLI: `show` and `step` print lengths in metres with their unit and px
  per metre; `render --region/--margin`, `show --near` and MCP
  `scene_render`/`scene_show`/`scene_playtest` take metres; `fmt` migrates
  v3 scenes and prefabs through the project's prefabs and says `(from v3
to v4)`; `grid` prints cell sizes in metres; text reports round to 1e-4;
  `list`, `validate` and `project show` migrate through the project's
  prefabs too.
- CLI: `vp run scene input [--project p] [--player n] [--json]` prints
  each seat's bindings per action, layer by layer (input map, game), and
  their issues through `bindingProblems`; it loads no Rapier.
- CLI: `playtest` takes v2 scripts (tracks, analog, pointer, seats),
  migrates a v1 script before `--at` (now metres) and prints `script
migratedFrom 1`; step lines name a track's seat (`step p1/0 …`).
- CLI: `fuzz` takes no script, as before: its v2 input is the default
  macro's analog and pointer moves (or the game's `play.macro`), and a
  scripted run is a `playtest`. An optional prefix script can be added
  later without breaking a caller.
- CLI: `replay` prints the recorded engine version and physics,
  `migratedFrom 1` for a v1 recording, a `platform recorded …; replayed …`
  line and the `recording-other-platform` issue; JSON gains `recorded: {
engine, platform }`.
- CLI and MCP recordings name their Rapier package as `platform.flavour`
  (`rapier2d-compat`, from the tool context's `rapierFlavour`).
- CLI: `codes` prints `migration-unresolved`'s hint under its row and a
  `notes` section (JSON `notes.keys`) on the deprecated 0.x `keys`.
- MCP: `scene_playtest` and `scene_replay` take v2 inputs (scripts with
  `tracks`, `set`, `pointer`, `join`/`leave`; v2 recordings, and v1 ones
  migrated with `migratedFrom: 1`; `recording-other-platform` in the
  replay's `issues`); `asset_apply_ops` edits input maps (`editAsset`
  insert at `/actions/@<action>/bindings`, refused as
  `binding-unknown`/`player-unknown`). Tool names unchanged.
- CLI: `scene step` reports a blocked run (exit 1, `{ ok: false, blocked:
true, stage: "run", issues, … }` and `<scene>: blocked at run` text)
  instead of a CLI `error:`, and passes the project's whole prefab library.
- The boundary test's game words no longer include `player` and `players`:
  seats are the engine's own concept.

### Docs

- The engine README gains §Units (metres in the simulation and the
  formats, `world.lengthUnit` as px per metre, what stays px, density in
  kg/m², the rounding rule, hosted v3 docs), §Input (codes, analog, pads,
  pointer, touch, `clientToWorld` and `trackPointer`, commands for DOM
  drops), §The input map, §Remapping, §Local multiplayer and §Recordings
  v2, each with an example that runs; the scene CLI README gains §Input v2
  and §Units and format v4, and its examples and op batches are in metres.
  Its example input scripts are v2 and its checks files v3.

## [0.10.0] — unreleased

Entity lifecycle, spawning and events. Game code spawns, destroys,
disables and instantiates entities at runtime, subscribes to events, runs
timers and coroutines, draws from a seeded `ctx.random`, queries entities
and watches contacts; the platformer's actor is an entity. The release also
fixes running and editing: the dev server survives aborted requests, the
editor opens any project's scenes, and the draw tools, inspector, edit
overlay and narrow layouts get a pass.

### Added

- The lifecycle surface of `EngineContext`: `spawn`, `destroy`,
  `setEnabled`, `enabled`, `exists`, `get`, `seeking`, `events`,
  `instantiate`, `timers`, `random`, `query` and `contacts`. New types in `./game`: `SpawnInput`, `EventBus`, `EventSubscribeOptions`,
  `InstantiateOptions`, `InstantiateResult`, `Delay`, `TimerAction`,
  `CoroutineYield`, `Timers`, `EntitySelector`, `EntityQuery`,
  `ContactSelector`, `Contacts`, `Pool` and `PlayWorld` (optional
  `PlayState.world`).
- `EngineError(code, message, entityId?)` in `./game`: a runtime refusal
  with an issue code.
- Runtime ids in `./game`: `RUNTIME_ID_PATTERN`, `runtimeId(name, n)`,
  `isRuntimeId(id)` and `parseRuntimeId(id)` (`gate#2/door` gives
  `{ name, label, child }`).
- Event types `ENTITY_SPAWNED`, `ENTITY_DESTROYED`, `ENTITY_ENABLED`,
  `ENTITY_DISABLED`, `CONTACT_START` and `CONTACT_END` in `./game` and
  `./headless`; `StepEvent.data?`.
- `ctx.setEnabled(id, on)` and `ctx.enabled(id)`. A disabled entity's type
  system runs its `disable` (without one the entity is despawned and its
  record kept, and enable spawns it again from the record at its spawn pose,
  state reset); its behaviors run `disable` in
  reverse registration order, and a behavior without one is detached and
  attached again on enable. `entity:disabled`/`entity:enabled` are raised
  inside a step only, at the entity's pose with `data: { type }`. `marker`,
  `decor` and `nav` keep their records while disabled.
- `solid`, `sensor` and `prop` implement `disable`/`enable`: Rapier bodies
  and colliders through `setEnabled`, geometry colliders through
  `GeometryWorld.setEnabled`; visuals are removed on disable and redrawn on
  enable. A disabled sensor forgets what was inside without raising exits
  and raises enters at its next `afterStep`; a disabled one-way solid stays
  out of the world whatever its gate says, and comes back as the gate holds
  it now. A disabled carrier takes its riders' colliders out of the world
  while the riders stay enabled.
- `follower` implements `disable`/`enable`: a disabled follower's path clock
  keeps running, it has no collider (riders' colliders on its body go off
  with it), no visual and posts no poses; enabling snaps it to where its
  path is now, on Rapier and in the geometry world.
- `ctx.random` is seeded per load from `PlayOptions.seed` (new), or from
  `defaultSeed(gameId, sceneName)` (in `./headless`) when the run names
  none, so a seed gives one sequence. Engine systems and behaviors never
  draw from it.
- `BehaviorDef.refine?(block)`: a check across a block's fields, reported as
  a `schema` issue.
- The engine behavior `lifetime` (`LIFETIME` in `./game`:
  `{ ticks | ms, then?: "destroy" | "disable" }`, exactly one of `ticks` or
  `ms`; a `schema` issue otherwise). Attaching it, and each enable, schedules
  a timer the entity owns (`ms` rounded with `ticksFor`). The timer pauses
  while the entity is disabled, and enabling starts a fresh one. When it
  falls due it destroys the entity (default) or disables it.
  `ENGINE_BEHAVIORS` is now `[SPRITE, OCCUPANT, LIFETIME]`, so a game's
  behaviors register from index 3.
- `createPool(ctx, { spawn, max? })` (from `./game`): `acquire()` enables
  the most recently freed entity (LIFO), else spawns while `max` allows,
  else returns null; `release(id)` disables and frees it; `free`/`live`
  counts. An entity disabled by any means (a `lifetime` with
  `then: "disable"`) returns to its pool, and a destroyed one leaves it. A
  pool's subscriptions end with the load, so create it in `onLoad`.
- `ctx.instantiate(prefab, at, opts)` places a prefab at runtime as a load
  does (ids `<prefab>#<n>` or `opts.id`, children `<id>/<child>`, refs
  remapped, grid turns, spawn-group order, `ready`, one `entity:spawned` per
  child inside a step, rollback on a throw); `ctx.destroy(instanceId)`
  destroys every child. Failures are `EngineError("prefab-not-spawnable")`
  with the reason in `cause`.
- `SceneRuntimeOptions.prefabs` (a library, or a function read once per
  load), frozen for the run: the library `ctx.instantiate` places from. The
  shell passes its `setPrefabs` library, and every headless entry passes
  one; `loadHeadless`
  returns `library` (every prefab given, or pinned by the snapshot) beside
  `prefabs` (the used ones `sceneHash` covers); `ReplayOptions.library`,
  `RunChecksOptions.library`, `PlaytestOptions.library` and
  `FuzzOptions.library` (default `prefabs`); `createHeadlessRuntime` and
  `runProbe` take `prefabs`. `sceneHash` and `configHash` don't cover the
  prefabs only `ctx.instantiate` places: a changed one shows on replay as a
  digest mismatch rather than as a changed input.
- `EntityTypeDef.spawnOnly?: true`. Spawn-only types load and spawn and take
  a spawn group (an explicit `spawnOrder` must list them), but are left out
  of the scene, fragment, prefab and op schemas and their JSON Schemas; a
  scene, prefab or op naming one reports `unknown-type` ("spawned by game
  code only"), and did-you-mean and `expected` never name one.
  `createRegistry` refuses a spawn-only type that never loads or has a bulk
  form.
- `spawnSchemaFor(registry, type)` (a type's entity schema without its
  scene id, for `ctx.spawn`), `placeableTypes(registry)` and
  `isSpawnOnly(registry, type)` in `./scene`; `entityIssues` takes a fifth
  argument `{ spawn: true }` to map a spawn input's failures.
- Runtime ids `<name>#<n>` from per-name counters shared by types and
  prefabs and reset at each load, plus explicit `<name>#<label>` ids
  (`spawn-id-invalid` otherwise).
- `ctx.spawn` is immediate: the input is parsed in dev and headless, posed,
  its behaviors attached and `ready` run, and `entity:spawned` raised with
  `data: { type }` inside a step; on any throw the spawn is rolled back and
  rethrown as an `EngineError`.
- `ctx.destroy` is deferred to the end-of-tick flush inside a step and
  immediate outside one; an instance id destroys its live children in
  reverse spawn order, and `entity:destroyed` is raised at the last pose.
- `ctx.exists` and `ctx.get` see spawned entities; `scene()` and `stats()`
  include spawned entities and drop destroyed ones; grid walls re-sync after
  spawns and destroys of `world.gridWalls` types.
- Input scripts take an optional `seed` (number or string) in their v1
  header, passed to the run as `PlayOptions.seed`.
- Recordings record an explicit seed as v1's optional `start.seed`, written
  only when the run was given one; `replayRecording` and the shell's
  `replay` pass it back, so a seeded run replays to the same digest.
  Recordings without it replay on the default seed.
- `PlaytestBlocked.stage` gains `"run"`.
- `expandInstance(inst, library, registry, opts?: { group?, cells? })` in
  `./scene`: one prefab instance's children as runtime entities (ids
  `<inst>/<child>`, refs between children remapped, fields, behaviors, z,
  layers, transform) in spawn-group order, or `{ ok: false, issue }` for
  `prefab-unknown`, `prefab-cycle` or `prefab-depth`. `expandScene` now
  expands every instance through it; its output is unchanged.
- `ctx.events.on`/`once(type, handler, { entity?, owner? })` deliver at two
  points in the tick (after timers, and after the end-of-tick destroys), in
  subscription order per event and raise order across events; events a
  handler raises join the same pass, which throws `EngineError("event-loop")`
  past 4,096 deliveries (a bug guard, not an issue code: a playtest it
  stops is blocked at stage `run` with an issue carrying the code); `entity` matches `entityId` or `other` (or a child
  of that instance id); `owner` ends the subscription when that entity is
  destroyed; every subscription ends at unload.
- `ctx.query` (`select`, `byType`, `byTag`, `count`, `inArea`, `at`,
  `nearest`, `extent`): entities by type, tag, area, point and nearness,
  read from the pose index and each entity's shape moved by its pose (never
  Rapier or the geometry world, so both backends answer alike); results in
  spawn order; disabled entities skipped unless the selector says
  `enabled: false`; `nearest` ties go to the earlier spawn. `extent(id)` is
  the entity's shape at spawn moved rigidly by its pose's change (translated
  and turned about the spawn pose), or a zero-radius circle at its pose when
  it has no shape.
- `ctx.timers`: `after`, `every` (with `times`) and `start` for generator
  coroutines that yield a tick count, `{ ms }` or a predicate; `cancel` and
  `size`. Timers run in the tick's timer phase, ordered by due tick and then
  by creation. `{ ms }` is rounded once, at creation, with `ticksFor`. The
  `{ emit, entityId?, data? }` action form raises its event at the entity's
  pose. Owned timers are cancelled when the owner is destroyed and paused
  while it is disabled. Play's `timeOffsetMs` seek fires what falls due
  before tick 0, with `ctx.seeking` true. Delays that aren't whole,
  non-negative ticks throw `RangeError`.
- `ctx.contacts.watch(a, b?)` raises `contact:start` and `contact:end`
  between watched entities (by id, or `{ type?, tag? }`; `b` omitted means
  anything that isn't a sensor), read after the sensors each tick with no
  physics callback: a broad phase over every enabled entity's non-sensor
  colliders by world bounds (Rapier's collider at its translation and
  rotation, the geometry world's shape), refreshed each tick for the
  colliders that moved, so a collider a system builds in code (the
  platformer's `player#1`) touches by where it is rather than by the
  entity's scene shape; then `Collider.contactCollider(other, 0)` on Rapier
  (touching at distance <= 0, `at` its `point1`) or `shapesIntersect` in the
  geometry world (`at` the centre of the boxes' overlap). A pair reports once
  per tick and `entityId` is the watched side; a destroyed or disabled
  entity's contacts end without an event; sensors and colliders with
  collision groups 0 never touch; with nothing watched no Rapier call is
  made. `contactCollider` answers synchronously under Node on both
  `@dimforge/rapier2d` and `@dimforge/rapier2d-compat`, and the browser
  smoke and the Bun headless smoke each drop one prop onto a solid with
  `ctx.contacts.watch` and require its first `contact:start` on tick 23
  against the floor, through the public `@jams/engine/*` entries only, in
  Chromium, Firefox, WebKit, Bun (source and dist) and Node.
- The Box, Circle and Pen tools pick a draw type. `drawTypeOptions(registry,
kind)` lists the types whose shape field takes what the tool draws, and the
  tool command `type:<name>` picks one (also as `tool:<id>:type:<name>`). The
  choice is kept per host and shared by the three tools, and the editor
  toolbar shows it as a Draw type menu. `ToolOverlay.option` (`ToolOption`)
  carries the active tool's setting to the host, and `ToolHost.option()` reads
  it without building the selection's outlines. The pen keeps a concave
  stroke as a `poly` when the type's field is a `polygonField` (a concave
  `nav` area), and closes an open stroke of three or more points for a type
  that takes no chain. `strokeShape` takes an optional `StrokeFit`, which
  `strokeFit(registry, type)` returns.
- Editor UI: `EditorHost` gains `projects` (a host's projects; with two or
  more and an `onProjectChange`, the Project panel shows a project switcher),
  `onProjectChange(id, opts?: { scene? })` and `findScene(scene)` (which project holds a scene,
  by id or name, as `SceneHome { project, id, name }`); new types
  `EditorProjectChoice` and `SceneHome`. `devProjectHost` also returns
  `findScene`, answered from the dev server's `/__scene` and `/__project`
  listings. `SceneEditor`'s `scene` opens a scene by id or by display name.
  The fallback notice names the scene that opened by name (never its id) and
  the project asked about (`There's no scene "x" in <project>`), and points
  to the project that holds the scene when the host can say; when the host
  has its own `notify` and an `onProjectChange` for that project, the notice
  carries an `Open in <project>` action that calls
  `onProjectChange(project, { scene })`, which opens the scene asked for
  rather than the project's default. `NotifyOptions` gains
  `action?: { label, onClick }` (sonner's `action` takes it as it is). A rebuilt game
  (materials, settings or tables changed, including the rebuild Stop lets
  in) keeps the edit camera: the zoom and centre of the last edit view of the
  same scene.
- `exists` and `count` input-script predicates: `{ "exists": "boss#1" }`
  holds while the entity exists and is enabled,
  `{ "exists": { "id": "boss#1", "enabled": false } }` while it exists at
  all, and `{ "count": { "type": "enemy", "max": 0 } }` while the number of
  matching entities keeps its bounds. `count` takes `type` (one or a list),
  `tag`, `enabled` and `min`/`max` (a range) or `eq`. `ExistsMatch` and
  `CountMatch` in `./scene`; `UntilClause` gains `exists` and `count`.
- `PlayState.world` (`exists`, `count`) in headless runs and in the browser
  shell's outcome judging, so games' `outcome` hooks and predicates read
  it; `PlayWorld.exists(id, { enabled: false })` answers for a disabled
  entity too. `playWorld(ctx)` in `./headless` builds one.
- `untilHolds(clause, state, registry)` in `./headless`, the one `until`
  evaluator, and `runPlaytest`'s `onLastTick` hook (`PlaytestHooks`).
- An `EngineError` thrown out of a step ends a playtest as
  `PlaytestBlocked` with `stage: "run"` and the error as an issue carrying
  its code; `runBlocked(err, ...)` in `./headless` builds that report.
- `reaches` checks take `expect`, an `until` clause (`event`, `tick`,
  `exists`, `count` and the game's predicates) every key of which must hold
  on the run's last tick; the verdict names the first key that fails, in
  the order the check wrote them (`checks:v1`, additive).
- `scene step` and `scene playtest` count spawns and destroys per entity
  type from the lifecycle events' `data.type` (a
  `spawned bullet ×212, destroyed ×212` line per type, and
  `lifecycle: { <type>: { spawned, destroyed } }` in `--json`);
  `--events <type,…>` limits the printed and returned `events` to those
  types, while `lifecycle` still counts every reported event. MCP
  `scene_playtest` gains `events: string[]` with the same filter and
  returns `lifecycle`; its and `scene_check`'s descriptions name the
  `exists`/`count` predicates, the six lifecycle and contact events, stage
  `run` and `reaches.expect` (tool names unchanged).
- The `shooter` genre probe (twin-stick, endless-runner and tower-defense in
  part). Zero gravity; a turret fires a thousand spawned `bullet`s with
  `lifetime`, and each is destroyed on `contact:start` with a wall. It runs
  on Rapier and on physics `none`.
- The `roguelike` genre probe: on a square grid with no physics and a turns
  clock, `ctx.random` places rooms by `ctx.instantiate` of two prefabs built
  in code. A spawned `rogue` explores by field of view and A\* until it
  reaches the stairs (`won`). One layout per seed, pinned for the default
  seed and seeds 1 and 2.
- The engine project's kitchen sink gains `spark`, a decor whose `lifetime`
  block destroys it 30 ticks after load, and its checks a `fades` reaches
  check whose `expect` holds an `exists` (`lamp`) and a `count`
  (`{ type: "decor", eq: 1 }`).

### Changed

- `SceneSystem` and `BehaviorSystem` gain optional `ready?(ids)`,
  `disable?(id)` and `enable?(id)`. The runtime calls each system's `ready`
  after a load's, an `add`'s, a spawn's or an instantiate's entities
  attach, in spawn-group order (at load before the seek and `onLoad`).
  Systems without them behave as before.
- A `BehaviorDef.refine` is applied wherever a block is checked: parse, ops,
  `ctx.spawn`'s dev and headless check, and validation. It sees the written
  block over the type's defaults.
- `SceneRuntime.add`/`update`/`remove` share the spawn and despawn path with
  game code, so `remove` also ends what the entity owns: its timers,
  subscriptions and contacts.
- `entitySchemaFor` returns `undefined` for a spawn-only type, and
  `suggestType` suggests placeable types only.
- `PhysicsRequiredError` extends `EngineError` (code `physics-required`);
  its constructor is unchanged, and its `entityId` is absent rather than
  `undefined` when it names none.
- Inspector: a prop's density, restitution and friction sit in Physics with
  the body settings; unset body fields show their default (`meta.default`)
  or fallback (`meta.placeholder`, new `ModelField.placeholder`) as the
  placeholder; long field titles widen the label column instead of clipping;
  an optional side's clear segment reads `any`.
- `FieldKind` gains `"tags"` (`tagsField` carries `meta({ kind: "tags" })`);
  `geometryFields` leaves tag fields out, and transforms leave them as
  written.
- The platformer's actor is a spawn-only `player` entity, `player#1`. Its
  collider tag and view id are its entity id (was `player` / `~player`), it
  appears in `ctx.get`, `stats().perType`, `scene()` and `ctx.query`, and
  sensor events name `other: "player#1"`. The platformer's
  `PLAYER_ENTITY_ID` export is gone, and `PLAYER_TYPE` and
  `PlayerTypeEntity` are exported.
- Play and Stop remember the edit scene without the entities game code
  spawned, so Stop restores the authored scene and its next load spawns
  them again.
- `physics-required` is now fixable: each issue carries a `fix` batch
  `{ label: 'Set the scene's physics to "rapier"', ops: [{ op: "setSettings",
set: { physics: "rapier" } }] }`, so the editor's Problems panel and
  `vp run scene apply` repair it in one step.
- A game predicate named `exists` or `count` is refused at registry build.
- A recording's markers skip `entity:*` events unless the game's
  `play.markers` names them; `contact:*` and every other type still mark
  when the game names none.
- `fuzz` counts only scene refs in `touched` and `untouched`, never a
  runtime `#` id.

### Fixed

- `@jams/engine/vite`: the dev server no longer crashes when a client aborts
  a request. `sceneCollabServer` keeps an `error` listener on every request,
  response and upgrade socket the dev server's http server sees, whichever
  middleware answers it. A `/__project` blob upload cut off mid-body ends
  with no write and no error page. `SceneCollabPlugin`'s `httpServer` now
  also takes a `request` listener.

### Agent surface

- `AGENT_SURFACE_VERSION` is 11, and every committed JSON Schema's
  `x-agent-surface` with it. Schema ids are unchanged: every schema change
  below is additive.
- Issue code `spawn-id-invalid` (error): a runtime spawn or instantiate id
  that isn't `<name>#<label>` for its type or prefab, has an all-digit
  label, or is already live. Thrown by `ctx.spawn` as an `EngineError`.
- Issue code `prefab-not-spawnable` (error): `ctx.instantiate` can't place a
  prefab (not in the run's library, cyclic or too deep, or a child needs
  physics in a scene without it). Thrown as an `EngineError` whose `cause`
  carries the underlying code.
- `scene.schema.json`: every loading type's behaviors slot gains `lifetime`
  (`ticks`, `ms`, `then`).
- `ops.schema.json`: an `add`'s `entity.type` lists placeable types only.
- `input-script.schema.json`: the header gains an optional `seed` (number
  or string).
- `recording.schema.json`: `start` gains an optional `seed` (number or
  string).
- Issue code `physics-required` is now fixable: each issue carries a `fix`
  batch (`setSettings` with `physics: "rapier"`), and `codes --json` says
  `fixable: true`.
- `input-script.schema.json` (engine and platformer): `until` gains
  `exists` (`$defs.ExistsMatch`) and `count` (`$defs.CountMatch`,
  `$defs.EntityType`).
- `recording.schema.json`: the `markers` description says which events a
  game that names none keeps.
- `checks:v1`: `reaches` gains optional `expect`.
- CLI: `step` and `playtest` take `--events type,…`; MCP `scene_playtest`
  takes `events`.
- `scripts/scene/README.md` §Lifecycle documents the six lifecycle and
  contact events, `exists`/`count`, `reaches.expect`, `step`/`playtest
--events` and the lifecycle summaries, and the codes `spawn-id-invalid` and
  `prefab-not-spawnable`, each with an example the docs test runs; the
  engine README gains §Entity lifecycle (hooks, fallbacks, load and tick
  order), §Spawning and prefabs at runtime, §Events, §Timers, §Randomness,
  §Queries, §Contacts and §`lifetime` and pools.

## [0.9.0] — unreleased

World models: optional physics, grids, turns and movement. Nothing in the
engine assumes physics, gravity, a side view or real time any more. A game
picks its clock (fixed, turns or event) and takes commands; a scene with
physics `none` runs on the geometry backend and never loads Rapier;
`ctx.space` answers queries on either backend; grids come with A\*, flow
fields, field of view and occupancy; motion bodies, a top-down controller,
a grid stepper and walk-polygon navigation move things without a platformer
controller. `EngineContext.rapier` and `physics` become nullable, which is
breaking on 0.x. The editor UI's close-out from 0.8.1 lands here too.

### Added

- Time models in `./game`: `TimeModel`, `TimeKind`, `ResolvedTime`,
  `resolveTime` (also in `./scene`), `ticksFor`, `tickRateProblem`,
  `MIN_TICK_RATE` and `MAX_TICK_RATE`; `GameDefinition.time`,
  `EngineContext.time`, `GameRuntime.busy` and `SceneRuntime.busy()`.
- Game commands: `GameCommand`, `CommandDef`, `ENGINE_COMMANDS` (`@elapsed`),
  `COMMAND_NAME_PATTERN`, `GameDefinition.commands`, `Registry.commands`,
  `commandNames` and `time`, a third `commands` parameter on
  `GameRuntime.beforeStep`, and `SceneRuntime.step(dtMs, actions, commands?)`.
- `GameInstance.send` and `GameShell.send` queue a game command (or
  `@elapsed`) for the next simulated tick, waking a turns or event game; they
  return false, with a dev warning, when nothing is playing, while a replay
  plays its recorded commands, for an unknown name, or when `args` fail the
  command's schema (a command without an `args` schema takes none).
- Recordings gain an optional `commands: [tick, name, args?][]` after
  `inputs`, oldest first; replays step them on their ticks and refuse an
  unknown command or bad args. Input scripts gain `{ command, args? }` and
  `{ elapse }` steps (one slot each, holding what the hold step before held;
  `elapse` sends `@elapsed` clamped to `time.catchUp.maxMs` and needs
  catch-up). An unknown command gets a did-you-mean, as an unknown action
  does. `PlaytestReport.commands` sits beside `inputs`;
  `CompiledStep.commands`; new type `RecordingCommand`.
- World defaults in `./game`: `DEFAULT_TICK_RATE`, `DEFAULT_PHYSICS`,
  `DEFAULT_TIME`, `DEFAULT_SPAWN_CAST`, and the controller presets
  `SIDE_VIEW_CONTROLLER` and `TOP_DOWN_CONTROLLER`; `GameDefinition.world`
  (`GameWorldDef`).
- Grid toolkit in `./game`: `gridGeometry` (square and Tiled staggered hex;
  neighbours in a fixed order, 10/14 costs, octile or 10 × hex-distance
  heuristic, `center`/`cellAt` laid out the way Tiled lays them out,
  `corners`, `line` (supercover on squares, cube lerp on hexes, symmetric),
  `cellsIn`, `rect`), `cellKey`/`cellOf` and `createOccupancy`; `ctx.grid`
  (`RuntimeGrid`) built from `settings.grid` before entities spawn and
  before `onLoad`, with walls from `GameDefinition.world.gridWalls` (default
  `["solid"]`) kept in step with edits, so a grid stepper made at load takes
  its start cell at once; the `occupant` behavior (`OCCUPANT`,
  `OccupantBlock`: `{ blocks? }`), which keeps an entity on its pose's cell
  and places it as it attaches.
- Scenes without physics: the runtime makes its Rapier world at the first
  load whose physics resolves to `rapier` and keeps it, emptied between
  loads. A physics-free load leaves `ctx.rapier` and `ctx.physics` null and
  reports `stats().backend` as `"geometry"`. A Rapier scene without a module
  fails with `reason: "physics-not-loaded"`, and nothing already loaded
  changes. A `PhysicsRequiredError` from a spawn (a `prop`, or an `attach`)
  fails the load with `reason: "physics-required"` and the entity.
- Scenes without physics run on the geometry backend. Solids add static
  geometry colliders (one-way gating by enabling the collider), sensors add
  sensor colliders and raise `sensor:enter`/`sensor:exit` from
  `space.overlaps`, and followers add a kinematic collider that follows the
  path. `ctx.geometry` is set per load. `ctx.space` answers on either
  backend. `RuntimeStats.bodies`/`colliders` count the geometry world.
- `ctx.space` (`SpaceQuery`): `pointAt`, `overlaps`, `raycast`, `sweep` on
  Rapier and on the geometry world, with the same results and order. Overlap
  hits come back by handle, and casts by time of impact, then handle.
  Touching counts. A cast's `toi` is a fraction (0 to 1) of `maxDist` or
  `by`. A ray that starts inside a collider hits at 0 with normal (0, 0).
  Without `filter.group`, every collider counts except one gated off with
  groups 0. With `filter.group`, colliders are filtered by collision group as
  Rapier does. A geometry sweep finds `toi` to 1/1024 of `by`, and touching
  at the start counts as a hit at 0. `shapesIntersect`, `shapeAtPose` and
  `raycastShape` in `./scene` are exact, using only + − × ÷ and sqrt; quarter
  turns use exact tables. `GeometryWorld` and `GeometryColliderDesc` are
  exported from `./game`.
- `createSpatialHash(cell?)` in `./scene`: a uniform-cell index of boxes by
  key (256 px cells by default; touching counts; queries answer in insertion
  order). The editor's spatial index and the geometry world use it.
- `prop` takes optional `gravityScale`, `linearDamping`, `angularDamping`,
  `fixedRotation` and `ccd`, applied to the body only when set.
- `findPath(grid, from, to, opts?)`: A\* with integer costs and a heap
  ordered by (f, h, insertion), so every platform finds the same path;
  `GridPathOptions` (`passable`, `cost`, `diagonals`, `cutCorners`,
  `bounds`, `maxExpanded`, default 65,536) and `GridPath` (`cells`, `cost`,
  `expanded`). `flowField(grid, goals, opts?)`: Dijkstra from every goal at
  once over the same steps, giving each cell's `cost` and `next` step
  (`FlowField`), with an optional `maxCost`.
- `fieldOfView(grid, origin, radius, opaque)`: symmetric shadowcasting on
  square grids (a floor cell sees another exactly when it is seen back;
  walls in view are visible, the cells behind them aren't), a line to each
  cell on hex grids; `radius` counts steps (Chebyshev on squares, hex
  distance on hexes) and must be finite and ≥ 0. `lineOfSight(grid, a, b,
opaque)` gives the same answer as `fieldOfView` at any radius.
- The `connected` check kind (`{ kind: "connected", from, to, diagonals?,
blockedBy? }`): A\* on the scene's grid, walls from `blockedBy` (default
  `["solid"]`, `[]` for none), one `grid-unreachable` per unreachable
  target, `grid-invalid` without `settings.grid`; runs with no Rapier.
  `ENGINE_CHECK_KINDS` gains `"connected"`; `ConnectedCheck`, `CheckPlace`,
  `CheckCell` and `DEFAULT_BLOCKED_BY` are exported from `./scene`.
- `DebugSceneSource` includes `geometry`, so game debug layers can read the
  geometry world.
- Each engine primitive declares `physics`: `prop` is `"required"`, every
  other loadable primitive `"optional"`. `validateScene` reports
  `physics-required` (error) on each entity whose type requires physics (its
  own `physics`, else its base primitive's) and on each entity with
  `attach`, when the scene's physics resolves to `"none"`; an entity with the
  `occupant` behavior in a scene with no resolved grid is `grid-invalid`.
- `physicsOf` and `PhysicsRequiredError` (`code: "physics-required"`),
  `EntityTypeDef.physics`, and `LoadFailureReason` with `physics-required`
  and `physics-not-loaded` beside `spawn-blocked`.
- `SpawnShape.cast`, `ColliderTag.oneWaySide` and `Side`;
  `PhysicalEnv.space` and `PhysicalCheck.needsPhysics`; `RuntimeStats.backend`.
- Navigation in `./game`: `buildNavMesh(areas, holes)` triangulates walk
  areas (simple polygons, concave allowed) with their holes and stitches
  areas that share an edge's endpoints, reporting (`NavIssue`) and leaving
  out polygons that break the walk rules; `navPath` (A\* over triangles,
  then the funnel; null when the points aren't connected), `navContains` and
  `navNearest` read the `NavMesh`.
- The `nav` primitive (a simple polygon, concave allowed,
  `mode: "walk" | "block"`, tags) with its system (`createNavSystem`,
  `isNavSystem`, `NavEntity`, `NavSystem`, `NavPolygon`), and
  `polygonField(description)` with `isPolygonField`.
- `ctx.nav` is a live `RuntimeNav` (`mesh`, `path`, `contains`, `nearest`)
  over the scene's walk areas, null without any, rebuilt on the first read
  after an area or hole changes. `validateScene` raises `nav-invalid` for a
  self-intersecting nav polygon, a hole not strictly inside exactly one walk
  area, or overlapping walk areas.
- `scenePhysics(def, registry, engine?)` and `defaultPhysics(registry,
engine?)` (the project's `engine.physics`, else `world.physics`, else
  `"rapier"`); `ValidateOptions.engine`, the project's engine block, resolved
  as `expandScene` resolves it.
- `game-settings` `engine` block gains optional `physics` (`"rapier" |
"none"`), `gravity` ([x, y] px/s²) and `tickRate` (any number in the
  schema; the kind's `validate` reports `tick-rate-invalid` for anything
  that isn't an integer from 1 to 240). Additive, `v` stays 1; the `engine`
  map layout merges concurrent per-key edits. New type `GameSettingsEngine`
  (`./project`).
- Time models `fixed`/`turns`/`event` in the browser shell: the loop ticks
  at `time.rate` or the project's `engine.tickRate`; turns and event games
  idle until a waking input and step at the rate while `busy()`. Catch-up:
  with `time.catchUp`, a tab hidden at least 1 s, or a long frame the 250 ms
  clamp cut by at least 1 s, queues one `@elapsed { ms: min(away, maxMs) }`;
  `GameInstance.elapse(ms)` queues the same (dev warning without `catchUp`
  or when not playing).
- Turns and event games idle headless: an input slot that wakes nothing (no
  command; for event, no action edge) while the game isn't `busy()`
  simulates no tick; its edges play with the next tick. Script step lengths
  and fuzz `ticks` count slots; `maxTicks` and `ticks` count simulated
  ticks. `PlaytestReport.slots` is new.
- `probeConfigHash(game, time?)`, `compileInputScript(script, registry,
time?)` and `RecorderOptions.time` take the run's clock; omitted, the
  game's own.
- `ProbeInput.commands`: `runProbe` steps game commands on their ticks, in
  list order.
- `GameInstance.extractPixels(world)` reads back the canvas pixel (RGBA)
  under each world point through the camera, from the stage at resolution 1
  over the game's background colour (null off the canvas), and names the
  renderer that drew them.
- `SceneEditorHandle.game()`: the editor's running `GameInstance`, or null
  before it is built.
- `ApplyOptions.project`: with a project, `applyOps` (and `applyOpsToDoc`)
  judge asset ids and sprite frames as `validateScene` does.
- `ProjectView.engine?`: the game-settings asset's `engine` block, set by a
  reader that holds its doc. `validateScene` resolves settings through
  `opts.engine`, else `opts.project.engine`, so `applyOps` and
  `applyOpsToDoc` given such a view report `physics-required` as `validate`
  and Play do. `IssueProject` gains optional `docNameFor` and `get` (a
  `ProjectSession` has both): `validateDoc` and `watchIssues` then read the
  open game-settings doc's engine block, and an edit to it revalidates.
  `EditorSession.engine()` gives the block, and the editor's physical checks
  run on the backend it and the scene resolve to.
- `takesConcave(registry, target)` and `judgeConcave(edit, registry,
target)` in `./editor`: whether a gizmo target's shape field takes concave
  polygons, and the edit without its `concave` flag when it does.
- `IndexEntry.sprite`: the world box an indexed entity's sprite draws, when
  it has one (picking, marquee and asset drop read it).
- `EditorSkeleton` (`./editor-ui`): the editor's frame in its default
  layout, with every panel's skeleton and a "Loading the editor" status, for
  a host to draw while the editor's code loads. `SceneEditor` draws the same
  component while it boots.
- `castSpawn` (play from here) casts along gravity, a game's
  `SpawnShape.cast` direction, or not at all (`"none"`, zero gravity). It
  runs on either backend and refuses a start inside a non-sensor collider
  through `ctx.space`. A straight-down cast under downward gravity is
  unchanged.
- `sideField(description)` (field kind `side`, a `Side | true` value) and
  `SIDES`; `FieldKind` gains `"side"`. `solid.oneWay` takes `true` or a side
  (`"up" | "down" | "left" | "right"`), with `true` meaning `"up"`; instance
  and group transforms turn and flip a side field, so a turned instance's
  one-way side turns with it.
- `SolidSystem.gateOneWaySides(actor, passing)` gates one-way solids by side
  for an actor's box; `ColliderTag.oneWaySide` is set on every one-way
  collider on both backends (`"up"` for `oneWay: true`);
  `SolidOptions.oneWay` and `SolidEntity.oneWay` take a side.
  `gateOneWay(bottomY, dropping)` is the `"up"` shorthand and leaves solids
  of other sides as they are.
- Motion bodies: `createMotionBody(ctx, entity, at, { shape, group?, tag? })`
  moves an entity on either backend (a kinematic position-based Rapier body
  with a top-down character controller, or a kinematic geometry collider
  moved by sweep and slide, at most 4 passes), writes `ctx.poses`, snaps on
  `teleport`, reports `moved`, `hits` and `blocked`, and doesn't push props.
  `createTopDownController(body, { maxSpeed, accel, decel })` gives
  accelerated top-down movement with intent clamped to the unit disc.
- `createGridStepper(ctx, entityId, { start, msPerStep, body?, occupy? })`
  moves an entity cell to cell on the scene grid: each step takes
  `ticksFor(msPerStep, ctx.time)` whole ticks, ends exactly on the cell
  centre, writes `ctx.poses` (and moves a given motion body), and with
  `occupy` reserves its target in `ctx.grid.occupancy` as it starts.
- `sceneGrid(scene, registry, wallTypes?)` in `./game`: a scene's grid
  outside a runtime, walls rasterised as a load does; the `connected` check
  and `scene grid` both use it, and share `gridRoute(grid, from, to,
diagonals)` (a path over passable cells within the grid's bounds, none from
  a blocked start), `gridPlace(grid, registry, cellOrEntity)` (`GridPlace`:
  a cell, or the cell an entity's spawn pose falls in) and
  `gridMissingIssue(sceneName, what)` (`grid-invalid` for a scene with no
  grid), all in `./game`.
- Genre probes (tests only, not public API): `__tests__/genres/` runs each
  `*.probe.ts` headless, with its variants, against pinned digests. Probe
  `grid-puzzle` pushes crates on a square grid with physics `none`, under
  zero and sideways gravity too. Probe `top-down`: a top-down controller
  steers a motion body through an axis-aligned corridor into a goal sensor;
  it runs on Rapier, on the geometry backend (physics none) and under
  sideways gravity. Probe `turn-tactics` walks a unit across a hex grid by
  commands, turn by turn, with field of view, also under sideways gravity.
- The AGN sweep (`__tests__/agnostic-sweep.test.ts`): genre probes must
  cover gravity `[0, 0]`, sideways `[1200, 0]` and physics `"none"`, and
  engine sources outside `game/defaults.ts` may not hard-code `[0, 1200]`,
  `TICK_RATE`, `1000 / 60`, `Vector2(0, -1)` or `{ x: 0, y: -1 }` unless the
  line says `agnostic-ok: <reason>`.

### Changed

- `solid.oneWay: false` no longer parses (omit the key instead).
- The platformer states `world: { gravity: [0, 1200] }` and
  `time: { kind: "fixed", rate: 60 }`.
- `createGame` loads `GameConfig.rapier` lazily: at start only when the
  game's default physics (project `engine.physics`, else `world.physics`,
  else Rapier) or the start-up scene's is Rapier; `preload(scene)` loads it
  for a Rapier scene (a failure there warns in dev and resolves; the next
  preload retries); `loadScene`, `play` and `replay` of a Rapier scene before
  it is in report `physics-not-loaded`.
- `HeadlessRuntimeOptions`, `ProbeOptions`, `ValidatePhysicalOptions`,
  `RunChecksOptions`, `PlaytestOptions`, `FuzzOptions` and `ReplayOptions`
  take `rapier?: RapierModule | null`. `validatePhysical` throws
  `PhysicsRequiredError` for a Rapier scene without a module. `ValidatePhysicalOptions` and `RunChecksOptions`
  gain `engine?` (the project's engine block). `ProbeOptions`, `FuzzOptions`,
  `ReplayOptions` and `RunChecksOptions` gain `project?`
  (`ProjectRuntimeView`), as `PlaytestOptions` has it: its `engine` block
  resolves the scene's settings and the clock, and `runChecks` passes it to
  the `reaches` and `touches` checks.
- `validatePhysical` runs on the geometry backend for a scene without
  physics: `follower-hits-solid` and `solid-overlap` run on either backend;
  a `PhysicalCheck` with `needsPhysics: true` is skipped there with a
  `physics-skipped` info issue. `PhysicalEnv.overlaps` and `cast` go through
  `space`. `solid-overlap`'s depth and point now come from the overlap of
  the two shapes' bounding boxes, the same on both backends (engine-yard's
  walls report at [20, 980], not [20, 962]). The F3 physics wireframes draw
  the geometry world's colliders when `ctx.physics` is null. The
  platformer's physical checks declare `needsPhysics: true`.
- A recording of a physics-free scene names physics `none`. A headless
  replay simulates every recorded tick, whatever the time model.
- `ctx.physics` is null outside a loaded Rapier scene, before the first load
  and after `unload()` included.
- The `game-settings` kind's schema hash moves with its new `engine` keys,
  so a build older than this one opens a project's game settings read-only
  with `code-skew`.
- The scene CLI's `step`, `playtest`, `replay`, `fuzz`, `check` and
  `validate --physical` load Rapier only for a scene whose physics resolves
  to `"rapier"`, and resolve settings through the project's `engine`
  block. `apply`, `apply --live` and `list` judge a scene through that block
  too, so they report the `physics-required` that `validate` reports; `list`
  also judges asset ids against the project, as `validate` does.
- `createRegistry` refuses game command names that start with `@` or don't
  match `COMMAND_NAME_PATTERN`.
- A game's explicit `spawnOrder` may leave out `nav` as it may `decor`;
  both then spawn last.
- `EngineContext.rapier` and `EngineContext.physics` may be null (breaking).
  The engine's systems read them through `physicsOf` when they spawn, not
  when they are built; `ctx.attachments.attach` throws
  `PhysicsRequiredError` without a world.
- `PhysicsWorld.createCharacterController(opts)` takes
  `CharacterControllerOptions` and has no default (breaking): pass
  `SIDE_VIEW_CONTROLLER` for the controller it built before. A null option
  turns that behaviour off. Its `up` is a `Pt` (`[0, -1]` in both presets).
- `GameConfig.rapier` is optional, `SceneRuntimeOptions.rapier` takes null,
  and `CheckEnv.rapier`, `PhysicalEnv.rapier` and `PhysicalEnv.physics` may
  be null; `CheckEnv.rapier` is optional. A runtime given no Rapier builds
  no world.
- `ProbeReport.tickRate` and `PlaytestReport.tickRate` widen from `60` to
  `number`; a recording's `tickRate` is any integer from 1 to 240.
  `physicsBuild(null)` is `"none"`.
- Settings resolve `gravity` and `physics` scene → project `engine` block →
  `GameDefinition.world` → engine default, and `grid` scene → `world.grid` →
  none (the project block never supplies a grid, and `view` is the scene's or
  orthogonal); a project value that fails the setting's schema is skipped.
  `expandScene` resolves through `opts.engine` and the game's world;
  `SettingsSources.project` is readonly and `SettingsSources.game` holds the
  game's world defaults.
- Grid fields and turned grid instances are judged against the resolved
  grid, so a game's `world.grid` satisfies them, and a prefab view's message
  says "the game's grid".
- `createRegistry` refuses a `time.rate` the clock can't run (the problem
  names `tick-rate-invalid`) and world defaults it can't use: a bad
  `world.physics`, a `world.gravity` that isn't two finite numbers, a
  `world.grid` that `settings.grid` would refuse, `world.gridWalls` naming an
  unknown or never-loading type, and a `world.lengthUnit` that isn't finite
  and above 0.
- `DEFAULT_GRAVITY` is re-exported from `game/primitives` (it lives in
  `game/defaults`).
- Headless runs follow the game's clock: steps are `ctx.time.tickMs` long,
  reports' and recordings' `tickRate` and `configHash` use the run's rate,
  and `forMs` rounds through `ticksFor`.
- The runtime's physics world steps `1 / ctx.time.rate` s
  (`PhysicsConfig.timestep`, default `1 / DEFAULT_TICK_RATE`); path
  followers' `seek` steps by `ctx.time.tickMs`.
- `applyOps` and the project batch's `editScene` (`checkProjectBatch`,
  `applyProjectBatch`, `applyRegistryBatch`, `applyProjectBatchToFiles`, the
  dev server) report `asset-missing`, `asset-kind`, `asset-frame-unknown`
  and `sprite-no-asset` for a scene in a project, once per scene and asset (a
  forced delete's dangling ref and `editScene`'s `asset-missing` for it are
  one issue). The scene CLI's `apply` and `apply --live` no longer write a
  batch that leaves `asset-missing`, `asset-kind` or `asset-frame-unknown`
  (errors); `sprite-no-asset` is a warning and doesn't block.

### Deprecated

- `GameConfig.targetFPS` (ignored): the clock runs at the game's rate.

### Removed

- `TICK_RATE` (from `physics.ts`): the step length is `ctx.time.tickMs` and
  the rate `ctx.time.rate`.

### Fixed

- A bulk row carrying a sprite gets a moving sprite box during a drag:
  selection outlines pose sprite boxes from the previewed geometry, for
  entities and bulk rows alike, rather than from the index's committed entry.
- `/__project` on `./vite`'s dev server answers CORS for the origins Vite's
  `server.cors` allows (by default the loopback hosts on any port), outside
  Vite's own cors middleware too. A preflight is 204, and every answer
  carries `Access-Control-Allow-Origin` (the request's origin), `Vary:
Origin`, and allows `content-type`, `x-expect-sha256` and `x-asset-kind`,
  so `devProjectHost({ origin })` on another origin can fetch and store
  blobs. Any other origin is still 403 with no CORS headers.
- The standalone editor's (`vp run engine:editor`) Play camera frames the
  play start, or the centre of the scene's bounds when Play didn't start
  from a point.
- The site's editor loading frame says "Loading the editor" in the room's
  chrome at once, then draws the editor's skeleton while the editor loads.
- The scene editor builds each game on a new `<canvas>` element. Rebuilding
  the game (a project, settings or table change, or a new game definition)
  used to put the new Pixi app on the old game's canvas. Pixi had already
  lost that canvas's WebGL context, so in Chromium, and in WebKit wherever
  it falls back to WebGL, the tab hung in Pixi's shader probe and the editor
  never mounted.
- The Run panel converts ticks to seconds at the recording's tick rate.
- Reshaping a nav walk area into a concave polygon no longer previews in the
  invalid tone.
- The editor's Run panel no longer marks a fresh run stale: it compares the
  recording's `sceneHash` with `sceneHashWith` of the open scene and its
  prefab library, the hash the recorder writes; editing a prefab the scene
  places now marks the run stale too.
- An instance's asset parameters get the asset picker (textures and atlases
  of the field's kinds, an atlas's frames as a select) instead of text
  fields, as a type's own asset fields do; picking an atlas inside an object
  parameter writes the atlas and its frame as one setParam.

### Agent surface

- `AGENT_SURFACE_VERSION` is 10, and every committed JSON Schema's
  `x-agent-surface` with it. Schema ids are unchanged: every schema change
  below is additive.
- `recording.schema.json`: `tickRate` is an integer from 1 to 240; an
  optional `commands` array follows `inputs`.
- `input-script.schema.json`: steps gain `{ command, args? }` and
  `{ elapse }`.
- `scene.schema.json` (and the prefab and fragment schemas): every loadable
  type's behaviors gain `occupant` (`{ blocks? }`) after `sprite`.
- `validate` and `check` emit `physics-required` for a prop or an `attach`
  in a scene without physics, and `grid-invalid` for an occupant in a scene
  with no grid.
- Issue codes `physics-required`, `nav-invalid`, `grid-unreachable` and
  `tick-rate-invalid` (all errors, not fixable).
- Issue code `physics-skipped` (info, not fixable): `validate --physical`
  reports it for each game check with `needsPhysics` in a scene without
  physics.
- The `checks:v1` schema gains the `connected` kind; `check` and MCP
  `scene_check` run it.
- `scene.schema.json` (and the prefab and fragment schemas): `prop` gains
  optional `gravityScale`, `linearDamping`, `angularDamping`,
  `fixedRotation` and `ccd`.
- `scene.schema.json`: the `gravity` and `grid` settings' descriptions name
  the project's and the game's defaults. `game-settings.schema.json`: the
  `engine` block's `physics`, `gravity` and `tickRate`.
- `apply`, `apply --live` and MCP `scene_apply_ops` report the asset codes
  (`asset-missing`, `asset-kind`, `asset-frame-unknown`, `sprite-no-asset`)
  as `validate` does.
- `scene grid <scene> [--from c,r|ref] [--to c,r|ref] [--fov c,r:radius]
[--diagonals] [--json]` prints the grid's walls, a path and a field of view
  as ASCII; exit 1 with no path, `grid-invalid` without a grid.
- `scene.schema.json` (and the prefab and fragment schemas): `solid.oneWay`
  is `true` or a side (`up`, `right`, `down`, `left`).
- `input-script.schema.json`: the header's `at` casts along the game's spawn
  direction (gravity by default).
- `scene.schema.json` (and the prefab and fragment schemas): the `nav`
  primitive (`shape` a `Polygon`, `mode` `walk` or `block`, `tags`) and
  `$defs.Polygon` (one `poly` tuple).
- `validate` and `check` emit `nav-invalid` for a self-intersecting nav
  polygon, a hole not strictly inside exactly one walk area, or overlapping
  walk areas.
- `scene show` prints `time <kind> <rate>Hz[ catch-up <ms>ms][ wakes on
pointer move]; physics rapier|none, no wasm` as its second line, and its
  JSON (and MCP `scene_show`) carries `time` (`kind`, `rate`, `catchUp`,
  `wakeOnPointerMove`) and `physics`.
- `scene step --command <tick>:<name>[=<json>]` and `--elapse <tick>:<ms>`
  are repeatable and step on their ticks (each tick's `@elapsed` before its
  commands), checked as an input script's command and elapse steps are;
  `step`'s JSON gains `commands`.
- MCP `scene_playtest` documents command and elapse steps, and
  `scene_check` documents `connected`. Tool names are unchanged.

## [0.8.1] — unreleased

The editor UI moves into the package, then gets a usability pass. The
scene editor the site drew from its own components is now
`@jams/engine/editor-ui`, rendered by any host through one seam,
`EditorHost`, and mountable standalone on `./vite`'s file-backed collab.
Every other entry stays free of React.

The usability pass gives the frame resizable columns that keep their sizes,
with tab groups in place of fixed islands; one pending mechanism, so every
action shows busy, its activity and the save state in the status island; a
denser frame and panels drawn from shared tokens; and in-view feedback:
selection and hover outlines, transform previews with snap guides (the grid
included), and placement ghosts. A narrow window keeps the column opened
last, the activity line holds its place in the status island, and the hover
clears when the pointer leaves the view. `./editor` gains additive exports
for these (`setHover` and `EditorStoreState.hover`, `dropPreview`,
`boundsCheck`, the `color` and `asset` `FieldWidget` kinds,
`EditorToolContext.hover` and `previewDoc`); nothing in it changes shape.
**Changed** lists what behaves differently from the site's editor.

### Added

- `@jams/engine/editor-ui`: `SceneEditor` and `mountSceneEditor`, the
  outliner, inspector, problems, history, project and load-run panels, the
  toolbar, play bar and status bar, around a full-bleed game canvas, as the
  site had them. The host seam is `EditorHost` with its adapters
  (`EditorNotify`, `EditorStorage`, `EditorCue`, `EditorIdentityInput`);
  everything but `connect` and `assetUrl` has a default, and per-viewer
  settings are stored under `jams-editor:*`.
- `./editor-ui`'s connectors, moved from the site and made host-neutral:
  `devProjectHost({ hocuspocus, origin?, buildAt? })` (the dev server's
  session and asset route on `./vite`'s paths), `connectProjectSession`
  and `createProjectTokens` (tokens and the close-code classifier are
  injected), `hocuspocusTransport` (it reports each doc's unacknowledged
  updates as `ProjectConnectionState.unsynced`), `offConnection(access?)`
  (a connection that opens nothing, for a host whose project is switched
  off), and the blob client `projectBlobs` and `BlobRouteError`. The provider module is always passed
  in, never imported.
- `blobContentStore(blobs)`, a `ProjectBlobs` as the content store a
  project session checks blob ops' bytes against, so a hosted connection
  inspects imports the same way `devProjectHost` does.
- The types a host needs to build its own connection or notifier:
  `MintProjectToken`, `ProjectTokenRequest`, `ProjectAccess` and
  `NotifyOptions`.
- `@jams/engine/editor-ui/style.css`, the editor's stylesheet, exported as a
  file and named by `EDITOR_UI_STYLESHEET`: `je-` classes in
  `@layer jams-editor`, themed by `--je-*` custom properties on `.je-root`,
  with no Tailwind.
- The layout model is built: `parseLayout` reads a stored layout (unknown
  panels dropped, missing ones back in their default group, `null` when the
  shape or version is wrong), and `fitLayout` places both columns and each
  group for a viewport, switching to one open column or the phone layout when
  there's no room, and reports what the columns cover of the canvas.
- `createPending` is built: tasks show busy at once, runs with the same id
  join, progress only moves forward, each error is toasted once, and `run`
  resolves `{ ok: false }` instead of rejecting. The status island shows
  the activity line (after 300 ms, with progress and "+N more") and the
  save state (Saving… / Saved, Reconnecting…, Offline — changes will
  sync). The kit `Button` gains `busyScope`.
- The frame's columns are resizable (drag, arrows 8/32 px, Home/End, Enter
  collapses, double-click restores) with a split between their two tab
  groups; sizes come from the layout model and persist per viewer; narrow
  windows draw one column and a rail, phones a panel bar and sheet; framing
  a selection, a problem or a prefab fits the canvas the columns leave
  visible.
- Editor panels sit in tab groups (two per column): Problems' tab counts
  errors and warnings, a tab's menu moves its panel to the other group or
  resets the layout, and inactive panels stay mounted.
- `react`, `react-dom` and `@hocuspocus/provider` are optional peers, used
  only by `./editor-ui`. The package's first `dependencies` are the editor's
  own libraries, `@base-ui/react`, `@dnd-kit/core`,
  `@hugeicons/core-free-icons` and `@hugeicons/react`. `sideEffects` is
  `["*.css"]`.
- The scene view outlines every selected thing on its resolved shape and
  pose (solids, sensors, bulk rows, markers, decor and sprite boxes, grid
  entities' filled cells, instance children of turned, flipped and nested
  instances, and an instance by its children), each a primary stroke on a
  dark halo with non-scaling strokes; a multi-selection adds one bounds box.
  Hover is shared: `EditorStoreState.hover` (set with `setHover`) is the
  entity under the pointer in the view or the outliner, outlined in a
  lighter tone in the view and marked on its outliner row. A marquee
  outlines what it would select while you drag, and touch mode looks
  different from contain mode. `ToolOverlay` outlines and points carry
  `ref`, `ToolOverlay.bounds` and `marquee.hits` are new, and
  `EditorToolContext.hover` lets a tool report what's under the pointer.
  The tool host now announces selection and hover changes to its
  subscribers.
- Density tokens on `.je-root`: `--je-inset`, `--je-gap`, `--je-pad`,
  `--je-row`, `--je-control`, `--je-tab`, `--je-text`, `--je-text-sm`,
  `--je-label`, `--je-label-col`, `--je-rail` and `--je-handle`. The
  frame, panels and kit size themselves from them.
- Placement previews. The placement tools, an asset dragged over the view
  and the draw tools show a ghost of what a release would add, in the
  template's colour, or in red with the reason when it would land out of
  bounds or be refused. The pen and waypoint tools draw the stroke so far
  and a dashed next segment to the snapped pointer, with its length.
  `dropPreview(drop, at, opts)` (and its `DropPreview` and `DropOptions`
  types) is the drop's ghost, from the same batch `dropBatch` builds;
  `boundsCheck(box, def)` is the one bounds rule the placement tool, the
  drop and the draw tools share.
- Inspector widgets: `FieldWidget` gains `{ kind: "color" }`, a colour
  picker for a string field whose meta names the `color` widget (a game's
  own `color` widget still wins), and `{ kind: "asset", kinds, frame? }`, a
  searchable picker of the project's assets of those kinds for an asset
  field. When the field takes atlases and has a sibling `frame` field, the
  frame becomes a select of the atlas's frames, and picking an asset and
  its frame is one undo step. Without a project, both stay text fields.
- `vp run engine:editor` serves the editor standalone on `./vite`, over a
  scratch copy of the engine project, with no site code.
- `EditorToolContext.previewDoc()` (optional), the scene as the drag in
  progress would leave it, and `preview?: boolean` on `ToolOverlay.outlines`
  and `ToolOverlay.points`, marking what draws the drag's preview.
- The browser smoke (`vp run engine:smoke:browser`) also mounts the packed
  `dist` editor UI on the kitchen sink in Chromium, Firefox and WebKit: its
  islands keep apart and inside the window at 1440×900, 1024×700 and
  760×700, the inspector group is at least 500 px tall at 1440×900, a tab
  switch shows its panel, and the crate's sprite pixel reads back from the
  editor's renderer. `engine-browser-smoke.json` lists the editor run per
  browser.

### Changed

- Per-viewer settings (the outliner's view and collapsed groups, snap and
  colour space) are stored under `jams-editor:*`; values saved under the
  site's older `game-editor:*` keys are ignored.
- A game rebuild keeps the selection and the tool, where they still
  resolve in the rebuilt editor.
- The viewer's own face shows the avatar the host's `identity` gives,
  where the site always drew the initial.
- The root entry's input router treats keys pressed inside a CodeMirror
  editor (`.cm-editor`) or a select's options as typing and ignores them,
  as the editor does; the two share one rule.
- A file drop the import refuses entirely reports one error with the
  reasons and no longer plays the drop cue.
- The editor's panels draw no headers of their own; each tab group's strip
  is its only header, and the outliner's Type/Layer control sits in its body
  toolbar.
- `devProjectHost`'s `origin` also takes a `ws(s)://` origin; blobs then go
  over `http(s)://` on the same host. `SceneEditorHandle.openPanel` and
  `resetLayout` now drive the frame's layout (reveal the panel's tab
  wherever the viewer moved it; put back the default layout) instead of
  focusing a fixed island.
- The editor's frame draws right away with skeleton panels, and the status
  says which boot phase it's in (connecting, opening the scene, materials
  and prefabs, building the game). A rebuild keeps the last frame mounted
  and inert under "Rebuilding the game" and brings back the selection and
  tool. Opening a prefab and Create variant run as pending tasks with busy
  controls, and a second press joins the running one. Hot reload of art is
  a pending hold. A `?scene=` the project doesn't hold now gets a notice,
  and `onSceneChange` is called with the scene that opened.
- Project panel: import runs as a pending task with per-file progress
  (reading, hashing, uploading with % sent, adding), and the folder it was
  dropped on and the drop target stay busy until it settles, followed by
  one success toast. Rename, move, delete and restore show their row busy.
  Each licence field shows Saving… and then any refusal. The tree shows its
  loading skeleton until the project doc holds the server's state. Code
  modules sit under one Code row after the assets, collapsed by default and
  remembered. `projectBlobs` reports bytes sent through XHR when no fetcher
  is passed.
- History rows are one line (label · actor · time) with an icon Revert.
  Consecutive entries with the same label and actor within 60 s fold into
  one row with a count, which expands; Revert on a folded row reverts the
  newest. Problems rows are one or two lines: icon, message, then the code
  in muted text. The Problems tab spins from a doc change until the
  physical check lands (a `panel:problems` hold). The Run panel's markers
  scroll inside the panel. Reading a run file goes through the pending
  mechanism.
- Inspector: sections collapse from their title and remember it per
  section (`jams-editor:inspector-collapsed`); the label column follows
  the panel's width, 30% from 64 to 120 px, through `--je-label-col`; one
  padding and 26 px controls; the selection's type and Create prefab share
  the header row; with nothing selected the inspector is one muted line in
  its body. Outliner: rows are one 24 px line; the filter's placeholder is
  "Filter", with its syntax in a hint; an instance's row, its Open button
  and the inspector's Open prefab show busy while that prefab opens.
- The dock's Play and Play from here are icon buttons with key hints.
  Tools that don't fit between the columns move into a More tools menu:
  game tools first, then the grid step, then the shape tools (Select and
  Pan stay). When the bottom row is short the status shrinks to a
  save-state dot and counts, and keeps the full words for screen readers
  and in the dot's hint. The read-only notice is a banner centred over the
  canvas. The prefab breadcrumb is one row in the frame's context, beside
  the host's top-left chrome, and moves below it only when the top row has
  no room.
- During a move, scale, rotate, vertex or edge drag, the overlay draws the
  selection where the drag puts it (filled faintly) over a `ghost`-toned
  outline of where it started. The handles and bounds box follow the
  preview, snap guides draw as haloed `guide` marks, and the readout shows
  the snapped Δ, size or angle. Previews are view-only: the editor no
  longer pushes drags into the edit world's runtime, release commits one
  batch, and Esc writes nothing.
- A grid snap draws its guide too: the grid line across the moved box, a
  little past each side. The draw tools show a crosshair on the snapped
  start before the press. Leaving the canvas between gestures clears the
  shared hover.

### Agent surface

- Unchanged; `AGENT_SURFACE_VERSION` stays 9.

## [0.8.0] — unreleased

Sprites and rendering: a scene names art, the engine loads and draws it,
and headless knows its size. The `sprite` behavior draws textures and
atlas frames on any entity, `decor` is a picture with no body, the runtime
runs behaviors' systems and keeps a pose index, the asset loader fetches
each scene's bundle, the Pixi view interpolates, sorts and scrolls its
layers, resolution policies fit a virtual area, the editor places dropped
art, and re-imported art reloads without reloading the scene. Every
addition is optional; a game, view or host that sets none of them behaves
exactly as on 0.7.0, and the platformer replays its golden traces
unchanged.

### Added

- `sprite`, the engine's first behavior (visual-only, so no system
  headless): draws a texture or an atlas frame at the entity's pose plus
  `offset` through `SceneView.sprite`, else its fallback box through
  `draw`. Size comes from the block, else the asset's times `scale`, else
  32×32; the anchor from the block, else the frame's (or texture's) pivot,
  else an atlas texture's import pivot, else the centre; tint
  and blend from the block, else the entity's material. `flipX` toggles
  under an instance flip; the sprite follows the pose's rotation unless
  `turn: false`, and snaps on a teleport. Its system re-poses after the
  game's `afterStep`, just before `view.commit`, so a pose any system
  wrote in a tick (a game system's in `afterStep` included) draws in that
  tick. `SPRITE`, `spriteGeometry`,
  `SpriteBlock`, `SpriteGeometry`, `SpriteAssetInfo`, `FrameRect` and
  `SPRITE_FALLBACK_SIZE` are in `./game` and `.`; `SpriteVisual`,
  `BlendMode` and `drawSprite` (`.`) draw a sprite through any view, as
  its fallback box through `draw` when the view has no `sprite`.
- `decor`: a primitive picture with no body,
  `{ id, type: "decor", at, behaviors: { sprite } }` (sprite required,
  ascii `d`, no bulk form); it loads headless with a pose and creates
  nothing in the physics world. `PRIMITIVE_TYPES` and
  `BASE_REQUIRED_FIELDS` gain it, and `createDecorSystem` / `DecorEntity`
  join `./game`. A game type named `decor` is a registry error.
- The pose index: `PoseIndex` and `Pose` (`./game`) and
  `EngineContext.poses`, each loaded entity's simulation-side pose. Every
  loaded entity gets a snapped spawn pose from its type's geometry: a
  shape's centre (a path rider's shape placed at its first path point),
  else its point field, else its first path point. The angle comes from
  `rotDeg`, else from `transform.turn`. `prev` is kept lazily per tick.
  Props write their pose after every step, followers and the entities
  attached to them on every step, seek and reset; static solids, sensors
  and markers write theirs once at spawn. Poses are not part of any
  digest. `spawnPose(entity, registry)` (`./game`) is the spawn pose of an
  entity a game system owns.
- The behavior host: the runtime runs registered behaviors' systems.
  Attach after the type system spawned an entity and its spawn pose is
  set, in registration order; detach in reverse before it despawns;
  `update` per block on an edit (detach then attach for a system without
  `update`); `step` after the type systems' `afterStep` and before the
  game's; `reset` on every load and `seek` on a `timeOffsetMs` load after
  the type systems'. A throwing attach rolls `load`, `add` and `update`
  back as a throwing spawn does. A visual-only behavior builds only when
  the runtime has a view, so a playtest with and without a view gives one
  digest. `EngineContext.behavior(name)` is a behavior's runtime system as
  `system(type)` gives a type's, `SceneRuntimeHandle.render(alpha)` runs
  the behaviors' `render` hooks, and `RuntimeStats.behaviors` counts each
  built behavior system's live attachments by name (zeros left out).
- The asset loader: `createAssetLoader`, `AssetLoader`, `AssetUrl` and
  `LoadProgress` (`.`). Textures load through Pixi `Assets` (texture
  parser forced), keyed by Sha256, reference-counted per retained bundle
  object, a shared hash loaded once; `release` trims released textures
  least-recently-used past `budgetBytes` (default 256 MiB of decoded
  w×h×4 bytes). Failures come back in `failed`, never thrown; progress
  is monotonic and counts settled blobs (failures included). A load of a
  URL whose eviction is still settling waits for it, so it never gets the
  texture being destroyed.
  `GameConfig.assets` (`{ loader, view, kinds }`; the runtime view stays
  `createGame`'s `project`) hands the shell a loader, and
  `GameInstance.preload(scene, onProgress?)` loads the scene's bundle,
  resolving with the entries that failed. The project bundle is retained
  for the instance's life and joined to every load until all of its
  textures are in, so a project texture that failed is fetched again by
  the next `preload` or `loadScene`. A definition is expanded with the
  shell's prefabs and bundles its `assets` header and its prefabs'
  headers; an `ExpandedScene` carries no header, so it
  bundles its entities and settings only. Without `config.assets` it
  resolves `{ failed: [] }` and nothing is retained.
- Bundles: `sceneBundle`, `projectBundle`, `AssetBundle` and
  `BundleEntry` (`./project`), the texture blobs a scene or the game
  settings need loaded. A scene's bundle covers its expanded entities'
  asset fields (with defaults), its settings, and the assets headers of
  the scene and every prefab it reaches, following atlas and font refs.
  Entries are sorted, deduplicated and totalled; anything unresolvable is
  an `asset-missing` issue with a did-you-mean.
- Asset info headless: `assetInfo(view, id, frame?)` and `AssetInfo`
  (`./project`, `./headless`), read from the entry with no decoding: a
  texture's size, import pivot, nine-slice and filter, and an atlas's
  frames (file order), tags and texture, or with `frame` that frame's
  size, pivot and `rect` in its texture; null for an unknown or trashed id
  or an unknown frame. `ProjectRuntimeView.asset(id, frame?)` is
  `assetInfo` of each live blob, frozen at load, from files or from a
  snapshot alike. `ProjectRuntimeView.engine` is a frozen copy of the game-settings
  doc's `engine` block.
- Interpolation: `SceneView` gains optional `commit` and `frame`. The
  runtime calls `view.commit(tick)` after the game's `afterStep` and the
  sprites' re-pose; the
  shell calls `view.frame({ alpha, camera })` and then
  `SceneRuntimeHandle.render(alpha)` on every rendered frame, with
  `alpha` 1 while paused or editing. The Pixi view keeps each visual's
  previous and current pose and places visuals posed in the last
  committed tick at `lerp(prev, cur, alpha)` (rotation the short way
  round), leaving the rest at their latest pose; new visuals and
  `pose(…, snap)` don't lerp.
- The Pixi view: `createPixiView(container, opts?)` takes
  `PixiViewOptions` (`layers`, `textures`, `editing`, `pixelSnap`), and
  `TextureSource` is what it reads textures from; the shell passes the
  registry's layers, the host's loader and the resolved `pixelSnap`.
  `sprite()` draws a Sprite, TilingSprite (`tile`) or NineSliceSprite
  (`nineSlice`) with frame, size, anchor, tint, alpha, blend, flips and
  per-sprite sampling; frame textures are cached per hash, frame and
  sampling, and a texture not yet loaded shows the fallback box until
  `textures.onLoad` reports it. `pixelSnap` rounds placed positions to
  whole canvas pixels.
- Resolution policies: `ResolutionPolicy`, `DEFAULT_RESOLUTION` (a
  1080-unit virtual height, `expand`, linear sampling, antialiasing, which
  gives 0.7.0's numbers), `viewportFor` / `ResolutionViewport` and
  `resolveResolution` (`.`), and `engineResolution` (`./project`).
  `viewportFor` fits the virtual area by `expand` (on a height, a width or
  both), `letterbox` or `crop`, with `integer` scaling (bars take the
  remainder) and `pixelSnap`. `resolveResolution` takes each field from
  `GameConfig.resolution`, then the project's game-settings
  `engine.resolution`, then `GameDefinition.resolution`, then
  `DEFAULT_RESOLUTION`. The shell's camera, renderer (antialias,
  letterbox bars in `bars`, default the background), scene runtime
  (`sampling`) and Pixi view (`pixelSnap`) follow the resolved policy.
  `CameraState.scale` is world units to canvas pixels (the display scale
  times `zoom`). `EngineContext.sampling` (`SceneRuntimeOptions.sampling`,
  default `"linear"`) is the default texture sampling for sprites.
- `game-settings`: the `engine` block takes an optional `resolution`
  (every field optional; `bars` a 0xRRGGBB number), additive with no `v`
  change. The kind's schema hash changes.
- Drop-to-place: `dropFragment`, `dropBatch` and `AssetDrop`
  (`./editor`), and `GameEditorDef.assetDrop`: what a dropped asset
  becomes in a scene (a texture or atlas frame a `decor` with
  `sprite.asset`/`frame`, a prefab an instance; a game's hook wins and its
  null falls back). `dropBatch` takes the project's `prefabs` and returns
  one labelled batch (`Place <name>`), one undo step, or `ok: false` with
  `asset-kind` / `asset-frame-unknown` for a drop it can't place.
- Hot reload of art: `GameInstance.reloadAssets(update)` (the project's
  new runtime view and view, and the changed asset ids) and
  `SceneRuntimeHandle.reloadAssets(project, changed)`. The shell takes the
  new project and view (later preloads bundle against them), swaps its
  held bundles to the new hashes, loads the changed textures, then the
  runtime swaps `EngineContext.project` and re-attaches every entity whose
  behavior block names a changed id through its asset fields (or an atlas
  cut from a changed texture): `update` with the same block, else detach
  and attach. The scene isn't reloaded; the runtime and its tick survive.
  A new `project` also re-resolves the project bundle from its game
  settings: a settings asset field moved to another id is loaded with the
  changed textures and retained in place of the old bundle (fetched again
  by the next `preload` if that load failed). When an entity's redraw
  throws, the blocks naming a changed asset are detached and attached
  afresh while its other blocks (a stepping behavior's state among them)
  stay attached as they were; if that throws too those blocks stay
  detached until the next edit of the entity attaches them. The other
  entities still redraw, and the entity comes back in the result's
  `errors` as an `AssetReloadError` (`{ entityId, error, reattached }`,
  exported from `.` and `./headless`); `SceneRuntimeHandle.reloadAssets`
  returns those, and `GameInstance.reloadAssets` resolves
  `{ failed, errors }` without rejecting for them.
  `ASSET_CHANGED`, `AssetChange` and `AssetChangedMessage` are in
  `./collab`, so a browser host reads the dev server's `asset:changed`
  message without `./vite` (which still re-exports all three).
  `AssetChangedMessage` is `AssetChange` plus `type` and `project`.
- `validateScene` with `project` emits `asset-frame-unknown` (an atlas
  frame its meta lacks, or an atlas with no frame named) and
  `sprite-no-asset` (warn).
- `renderSceneSvg` draws each sprite's box, labelled `asset[:frame]`, and
  `sceneAsciiMap` marks it with its entity type's character under bodies
  and points. `SceneRegionOptions.project` (a ProjectView) sizes the boxes
  from `assetInfo`, else the block's size, else 32x32. New in `./scene`:
  `sceneSprites`, `spriteBoxOf`, `projectSpriteAssets`, `DrawnSprite`,
  `SceneSprite`, `SpriteAssetLookup`, `SpritePoseSource`. The boxes take
  their spawn pose, asset info and offset from the same helpers as the
  runtime's pose index and sprite system, so the renders, picking and a
  run place a sprite alike.
- Editor: `createSpatialIndex({ asset })` (a
  `ProjectRuntimeView.asset`-shaped lookup) indexes sprite boxes.
  `pickAt` and Alt-marquee hit an entity's sprite box, and a point entity
  with a sprite (a decor) uses that box as its geometry.
  `ToolHostOptions.asset` passes such a lookup to the tool host's index,
  and `ToolHost.reindex()` rebuilds it when the lookup's answers change;
  the site's editor sizes sprite boxes from the project's assets.

### Changed

- Project snapshots pin a blob's `bytes` and its kind's inspected `meta`
  beside its hash and import settings (both optional in
  `project-snapshot` v1, so older snapshots still parse), and
  `snapshotView` carries them. A snapshot of a project with blobs hashes
  differently from 0.7.0's for the same content. Headless runs loaded by
  snapshot size sprites from it as runs loaded from files do.
- `SceneView` gains optional `sprite` and `depth` (beside `commit` and
  `frame`), and `pose` an optional `snap`. Views that implement none of
  them keep working.
- Materials' `render` takes `tint` (`"#rgb"`/`"#rrggbb"`, a colour
  string like `style`'s, which `projectMaterialOf` converts to the number
  a sprite's `tint` is) and `blend` (`normal`, `add`,
  `multiply`, `screen`), additive with no `v` change, and both reach
  `MaterialDef.tint` / `blend` and `ProjectMaterialDef`'s as a sprite's
  defaults on an entity of that material (only materials with `physics`
  join `registry.materials`). In the collab doc, `render` merges field by
  field, so concurrent tint and blend edits both survive. A `render` an
  older client stored whole is read as it is and becomes a map on the next
  write, with no layout bump. Files keep `render` on one line. The
  material kind's schema hash changes.
- `AttachmentHub` gains `moved(hostId, snap?)`, and `attach` takes an
  optional fourth `moved(host, snap)` callback. Hosts call `moved` after
  their body moves, and the colliders riding them re-pose. A game that
  hosts bodies through `ctx.attachments.host` must now call `moved`.
- `loadScene` (and Play/Stop world swaps) retain the new scene's bundle
  before releasing the previous one and start loading any texture not yet
  resident, so a scene loaded without `preload` swaps its textures in as
  they arrive; the edit scene's bundle stays retained through Play.
  `config.assets.view` is read at each use, so a host may pass a getter
  that follows its project.
- `drawEntity` skips an entity carrying a `sprite` block; its entity
  argument (and `createRiders`') takes optional `behaviors`.
- Every loadable type allows `sprite` unless it forbids it, so the
  committed scene, prefab and fragment schemas list it.
- `createCamera` takes an optional `ResolutionPolicy` (default
  `DEFAULT_RESOLUTION`, which gives today's numbers), and
  `createRenderer` takes one too.
- The platformer snaps its player's spawn pose, so a respawn never shows
  a lerped frame.
- A game's `spawnOrder` may leave `decor` out; it then spawns last.
- The primitive systems' shape visuals (solid, sensor, prop, follower)
  draw on the entity's `layer` when it names one (a system's explicit
  `layer` option still wins), and `drawEntity` passes `depth(z)` for an
  entity with a `z` or a `layer`; its entity parameter gains `z?` and
  `layer?`.
- `createPixiView`: layer containers follow `PixiViewOptions.layers` by
  `draw`; `depth` sets the order inside a layer (ties by first draw); a
  `sort: "y"` layer re-sorts by (z, interpolated y, first draw) every
  frame; a `scroll` layer is offset by camera·(1 − scroll); entity
  visuals on an `editorOnly` layer hide unless `editing()`.
- Documentation: the README gains §Sprites and rendering (the sprite
  behavior's fields, tint and blend precedence, decor, views,
  interpolation and `snap`, the loader, `preload`, bundles and the hosts'
  URL resolvers, art hot reload in dev), §Behaviors at runtime (the
  host's order, visual-only behaviors, `ctx.behavior`, the pose index) and
  §Resolution (policies, resolve order, `CameraState.scale`;
  `VIRTUAL_HEIGHT`, `DISPLAY_RESOLUTIONS` and `DisplayResolution`
  removed). scripts/scene/README.md documents `assets info`, `bundle`,
  sprite boxes in `render` and `show`, and `asset-frame-unknown` /
  `sprite-no-asset`.

### Removed

- The internal `assets.ts` module and its `initAssets` call in
  `createGame`.
- `VIRTUAL_HEIGHT`, `DISPLAY_RESOLUTIONS` and `DisplayResolution`: the
  site reads `store.camera.scale`, and display menus are the host's
  (`GameConfig.resolution`).

### Agent surface

- `AGENT_SURFACE_VERSION` is 9, and every committed JSON Schema's
  `x-agent-surface` with it.
- Issue codes `asset-frame-unknown` (error) and `sprite-no-asset` (warn).
- CLI commands `assets info <id> [--frame f]` and `bundle <scene>`, both
  with text and `--json` output.
- `scene show` lists each sprite's world box (`sprite` on a row: label,
  asset, frame, size, aabb; text ` sprite <label> x0,y0..x1,y1`).
  `scene render` labels sprite boxes and adds
  `sprites: [{ref,type,label,box}]` to its JSON (SVG and `--ascii`) when
  the scene has any. MCP names are unchanged; the `scene_show` and
  `scene_render` descriptions now mention sprite boxes.

## [0.7.0] — unreleased

Scene format v3: every format change the roadmap knows about in one bump
with one migration, so v3 is the format 1.0 freezes. Behaviors attach to
any entity, prefabs nest and have variants and exposed parameters,
instances and groups turn and flip, entities gain `z` and registry layers,
asset fields and the `assets` header reference project assets, scenes
carry `physics`, `grid` and `view` settings, and grid fields hold tile
cells. Every addition is optional with a default equal to v2's behaviour.

### Format

- Scene format v3. `SCENE_FORMAT_VERSION` is 3 and `MIGRATIONS[2]` lifts
  v2 scenes, prefabs and fragments by setting `v: 3` and nothing else;
  every v3 addition defaults to v2's behaviour, so `scene fmt` rewrites a
  v2 file by changing only `"v"`. Schema ids are `scene:v3`, `prefab:v3`,
  `fragment:v3` and `ops:v3` (and their `<game>:` forms); checks files,
  input scripts, recordings and the project kinds keep theirs. A
  recording made against a v2 file replays once with the existing `stale`
  warning, because `sceneHash` covers the canonical text (which now says
  `"v": 3`); re-recording clears it.
- `assets` on the scene and prefab header (after `settings`): the asset
  ids only game code names, sorted and unique, on one line. Dangling ids
  are `asset-missing`, duplicates `schema`.
- `settings.physics` (`"rapier"` or `"none"`, resolved `"rapier"`),
  `settings.grid` (the scene's one cell grid: `square` with `cell` and
  `origin`, or `hex` with `cell`, `side`, `stagger` and `index`, as Tiled
  parameterizes it; none by default) and
  `settings.view` (`{ projection: "orthogonal" }`, reserved).
- `rot` (1, 2 or 3 quarter turns clockwise) and `flip` (mirror x before
  turning) on instances and groups; identity when absent. Geometry stays
  integer: points, vectors, angles, mirrors, shapes and paths transform
  exactly.
- `z` on entities and instances: an integer draw order in
  [-10000, 10000], 0 by default and written as absent (by `update` and
  `setZ` alike, so both give the same file and hash); an instance's `z` is
  added to every child's.
- `params` on instances: values for the parameters the prefab exposes.
- `behaviors` on entities: behavior blocks by name, each checked by its
  behavior's fields, with the type's required and default blocks filled
  in on load.
- `layer` on entities and instances names one of the registry's layers
  (the game's, else `terrain`, `decor`, `gameplay`, `editor`); the type's
  default when absent.
- Prefab files take `instances` (nesting, at most `PREFAB_MAX_DEPTH`
  levels, no cycles), `base` (a variant of another prefab), `params`
  (`{ description, targets, default? }` per name) and `overrides` (a
  variant's overrides of its base), written in the order `$schema`,
  `kind`, `v`, `game`, `id`, `base`, `contract`, `params`, `assets`,
  `overrides`, bulk keys, `instances`, `entities`.
- Fragments take `instances`, so copying an instance pastes an instance.
- Grid fields on types that declare one (`gridField`): chunked
  run-length cells keyed `"cx,cy"`, 32×32 cells a chunk, one chunk per
  line, empty by default.
- Ref fields (`refField`, `attachField`) may name an instance's child at
  any depth (`room-1/door-1/panel`); one the prefab lacks is
  `ref-child-unknown`.
- Entity and instance keys are written `id`, `type`, `prefab`, `name`,
  `layer`, `group`, `off`, `z`, `shape`, `at`, `rot`, `flip`, `path`,
  `params`, `overrides`, the other keys by code unit, `behaviors`, then
  grid-valued keys.

### Added

- `./scene`: the v3 contract types. `SCENE_HEADER_KEYS` gains `assets`
  (after `settings`); `GroupDef` gains `rot` and `flip`; `InstanceDef`
  gains `rot`, `flip`, `z` and `params`; `GridSettings` and
  `SceneSettings.physics`, `grid` and `view`; `PrefabParam`,
  `PrefabBody.instances`, `base`, `overrides`, `params` and `assets`,
  `PREFAB_MAX_DEPTH`; `SceneFragment.instances`; `RuntimeEntity.behaviors`,
  `z`, `layer` and `transform`; `AssetId`, `CellEdit` and `CellRect`.
- `./scene`: `Transform2D`, `IDENTITY_2D`, `Dihedral` and the transform
  functions (`scene/transform.ts`); `SceneLayerDef`, `DEFAULT_LAYERS` and
  `defaultLayer` (`scene/layers.ts`); the grid codec's `GRID_CHUNK`,
  `ChunkKey`, `GridRow`, `GridCells` and functions (`scene/grid.ts`);
  `splitFieldPath` (`scene/field-path.ts`).
- `./game`: `defineBehavior`, `BehaviorDef`, `BehaviorSystem`,
  `RegisteredBehavior`, `BEHAVIOR_NAME_PATTERN` and the other behavior
  types; `GameDefinition.behaviors` and `layers`;
  `EntityTypeDef.behaviors`; `FieldEnv.assets`; `Registry.behaviors`,
  `behaviorNames`, `behaviorRules` (`BehaviorRules`) and `layers`.
- `./collab`: `LEGACY_Z_FIELD`, `LEGACY_BULK_FIELD`, `BEHAVIORS_FIELD`,
  `PARAMS_FIELD`, `NESTED2_FIELDS`, `GRID_ROW_KEY`, `ASSETS_KEY`,
  `PARAM_KEY_PREFIX` and `VARIANT_KEY`.
- `./scene` and `.` (through `math.ts`): `Transform2D`, `IDENTITY_2D`,
  `Dihedral` and `dihedral`, `compose`, `invert`, `applyPt`, `applyVec`,
  `dihedralOf`, `composeDihedral`, `flipWorld`, `translation`, `turnOf`,
  `inverseTurn` and `isIdentityTurn`. Quarter turns and flips are exact on
  integers.
- `transformEntityDef`, `transformBulkEntry` and `transformFieldValue` act
  on fields by kind: shapes, points and paths move; vectors turn and flip;
  angles gain 90° per turn and negate under a flip; mirror booleans toggle
  under a flip; grids go through `transformGrid`. Boxes and capsules turn
  by `rotDeg`, and flipped polygons and chains keep their winding. The
  translate forms are now wrappers with unchanged behavior.
- `./game`: `vectorField`, `angleField` and `mirrorField`, field builders
  whose values turn and mirror with their entity; `fieldKind` reports
  `vector`, `angle`, `mirror` and `grid` from a field's `meta.kind`.
- `./game`: `assetField(env, kinds, description)`, `AssetIdSchema` and
  `assetKindsOf`. Asset references parse as any id (a dangling one is
  reported by validation, not parsing). `DEFAULT_LAYERS` and
  `SceneLayerDef` are re-exported from `./game`.
- Entity and instance `z`: an integer draw order in [-10000, 10000] (an
  offset on instances); instance `rot`, `flip` and `params`; group `rot`
  and `flip`; the scene `assets` header.
- Scene settings `physics` (`"rapier"` | `"none"`), `grid` (square or
  Tiled-style hex) and the reserved `view: { projection: "orthogonal" }`.
  `resolveSettings(settings, { project?, game? })` (`./scene`, with
  `SettingsSources`) resolves each engine key scene → project engine block
  → game default → engine default (gravity `[0, 1200]`, rapier, no grid,
  orthogonal), and expanded scenes always carry all four.
- `./editor`: bring forward (Mod+]) and send backward (Mod+[) commands,
  one `setZ` by ±1 over the selected entities and instances (`zOrderBatch`
  in `editor/commands`). The spatial index stacks by the registry's layer
  order, then `z`, then document order. The outliner's layer view and the
  inspector's layer choice come from the registry's layers.
- `./project`: `schemaRefSites(shape, value, pointer)` finds asset
  references at every `assetField` leaf, following objects, records,
  arrays, tuples, unions and wrappers. Scene and prefab `refs` now cover
  type fields, behavior blocks, `settings`, the `assets` header (any
  kind), overrides (an instance's or a variant's own) that set an asset
  field, a whole behavior block or the whole `behaviors` map, a prefab's
  `base` and its nested instances' prefabs; `data-table` refs cover rows
  (`/rows/@<id>/…`) and `game-settings` the `game` block. `changeAssetId`
  rewrites references in a scene's settings, `assets` header, those
  overrides (each key set whole with `override`) and a prefab's `base` too.
- `toJsonSchema(schema, { layers?, assets? })` (`JsonSchemaOptions`, with
  `layerNames` on `./scene`): `layer` fields get the registry's layer names
  as `enum` in scene, prefab, fragment, ops and doc-kind schemas; an asset
  field's `enum` lists live ids only when there are some.
  `docKindJsonSchema` with a project fills them from the view; code-skew
  `schemaHashes` never carry asset ids.
- `validateScene` reports `layer-unknown` for an entity or instance whose
  `layer` isn't one of the registry's layers (did-you-mean; fix: `update`
  unsetting `layer`), `grid-invalid` for `settings.grid` values (cells
  positive integers, a hex `side` an integer in [0, cell width for stagger
  x / cell height for stagger y], origin integers), and `schema` for a
  repeated id in the `assets` header. `ValidateOptions.project` (a
  `ProjectView`): with it, an asset id in a type field, a behavior block,
  `settings` or the `assets` header that no live asset has is
  `asset-missing` (did-you-mean over the live ids of the field's kinds; a
  trashed id says so) and a live id of the wrong kind is `asset-kind`;
  without it asset ids aren't checked. `ValidateOptions.prefab` names the
  prefab the scene is a view of: a nested instance that reaches it is
  `prefab-cycle` even while the library's copy of it is stale, and its
  variant base is checked too; `applyOps` with `prefab` validates its
  result the same way. `vp run scene validate` passes the scene's project.
- `setZ { refs, z | by }` sets or shifts `z` on entities and instances,
  within ±10000. A z of 0 is written as absent, bulk refs are refused
  (promote first), and the inverse is an exact `setZ`. On an instance child
  in the resolved view it becomes an override of `<child>.z`.
- `useAssets { add?, remove? }` edits the `assets` header, which stays
  sorted and unique, with an exact inverse. `diffToOps` turns header
  changes into `useAssets` and z-only changes into `setZ`. `diffScenes`
  reports `scene.assets`.
- Behaviors register: the engine's (none yet), then
  `GameDefinition.behaviors` in order; `registry.behaviors`,
  `behaviorNames` and `behaviorRules(type)` (allowed, required blocks,
  defaults). `createRegistry` refuses a game behavior without its
  `<gameId>/` prefix, a bad or duplicate name, `requires` or type rules
  naming unknown behaviors, a behavior both required and forbidden,
  defaults failing a behavior's schema, behavior field names that aren't
  identifiers, and a type with a grid field but no point field `at`.
- `splitFieldPath` parses the field-path grammar (names, indices, behavior
  names right after `behaviors`).
- `behaviorBlocks(registry, type, written?)` (`./scene`): an entity's
  behavior blocks in registration order, merged as behavior defaults, then
  the type's, then the entity's. `expandScene` puts them on
  `RuntimeEntity.behaviors` (bulk entries get their type's required
  blocks), keeps `layer` and a non-zero `z`, and records
  `transform { turn, flip }` for turned or flipped entities.
- `gridField(description, { values?, max? })`: cells in 32×32 chunks of
  run-length rows, local to the entity's `at`; parsing rewrites the value
  canonically. `gridFieldInfo` reads a grid field's values and max. The
  grid codec in `scene/grid.ts` is real: `decodeRow`/`encodeRow`,
  `readCell`, `paintGrid` (rects, then cells; changed rows and the exact
  inverse), `canonicalGrid`, `isGridValue`, `gridCellBounds`,
  `parseChunkKey`, `compareChunkKeys`, `gridProblems`, `transformGrid`.
- `renderSceneSvg` and `renderSceneAscii` draw grid fields' filled cells
  one by one, local to the entity's `at` and sized by
  `settings.grid.cell` (hex grids staggered as Tiled's), at most 4,096
  cells per render (`SCENE_GRID_MAX_CELLS`), with a `…` where the rest
  begin; a grid entity's render box and `around` framing cover its cells.
- `./scene`: `resolveSceneDetailed` places each instance child through its
  instance's turn and flip at its `at` and then its group's
  (`instanceSteps`; composed: `instanceTransform`), and group members
  through their group's (`groupTransform`). `ResolvedOrigin`'s child form
  gains `path: string[]` (instance ids from the scene down) and
  `transform: Dihedral`; the entity form gains an optional `transform`
  when its group turns or flips. `instanceOrigin` applies the group's
  turn. Grid fields turn only on a square grid with equal cells
  (`gridTurns`). `toSourceBatch` maps edits back through the inverse: a
  world `move` of a flipped child becomes a mirrored override; point,
  vector, angle (exact inverse), mirror, shape and path updates, `place`
  (anchor mapped), `add`, `instantiate` (rot/flip into the group's frame)
  and `paintCells` on members of a turned group follow. Updating one
  coordinate of a turned point and painting an instance child are
  `op-invalid`. New: `placeChildren` and `PlacedChild` (the turn helpers
  are listed with `Transform2D`). `fragmentBounds(fragment, registry, prefabs?)` boxes a
  fragment's instances, turned and flipped, with exact integer bounds.
- The `transform` and `paintCells` ops apply. `transform` turns and flips
  instances and whole groups in world terms about `about` (each one's own
  origin by default); an instance in a group keeps a group-local `at`, and
  naming an instance together with its group is `op-invalid`. `paintCells`
  paints a grid field of an entity (an instance child, bulk entry or
  instance is `op-invalid`) and its inverse restores the exact cells, split
  into ops of at most `MAX_PAINT_CELLS` (now exported from
  `ops-schema.ts`). `instantiate` stores `rot`, `flip` and `params`, and
  `setGroup` stores `rot` and `flip`. `update` and override keys reach
  into behavior blocks (`<child>.behaviors.<name>.<field>`).
- `validateScene` checks behavior blocks: `behavior-unknown`
  (did-you-mean, fix unsets the block), `behavior-forbidden` (the type
  forbids it or never loads; fix unsets), `behavior-missing` (a carried
  behavior's `requires`, counting the type's required blocks; fix adds the
  block as `{}`), and `schema` inside a block at
  `/entities/<i>/behaviors/<name, / as ~1>/<field>`. Grid rules: a grid
  field in a scene without `settings.grid` (a prefab view is exempt: the
  scene placing it sizes the cells), an override naming a grid field (fix
  reverts it), and a turned or flipped instance or group over a grid
  unless the grid is square with square cells are `grid-invalid`.
  Overrides may name `z` and `behaviors`.
- Inspector: one `behaviors:<name>` section per carried behavior (titled
  `inspector.label`, fields in `inspector.order`, a Remove batch unless
  the type requires it) and `InspectorModel.addBehaviors` for the Add
  behavior menu; each add or remove is one update per target.
  `ModelField.defaultValue` carries a behavior field's default. A new
  `assets` section holds fields grouped `assets`.
- Editor commands `turn-cw`, `turn-ccw`, `flip-x`, `flip-y` (`turnBatch`,
  `flipBatch`, `quarterTurnTargets`): one `transform` op over the selected
  instances and whole groups. `e` turns a selection of instances or groups
  a quarter (`KeyContext.quarterTurns`), and still rotates anything else
  15°; Shift+H and Shift+V flip.
- `./scene`: `resolvePrefab(id, library, registry, opts?)` returns a
  `PrefabResolution`: a `ResolvedPrefab` (its children with relative ids
  such as `door-1/panel`, its params, and the prefabs it uses, outermost
  first), or a failure: `prefab-unknown`, `prefab-cycle` (the chain starts
  at its least id) or `prefab-depth` (more than `PREFAB_MAX_DEPTH` = 8
  levels). It is memoised per library and registry object. Also new:
  `splitChildRef`, `INSTANCE_OVERRIDE_FIELDS`, `isInstanceOverrideField`,
  `ResolveOptions` (`{ cells }`) and `BulkPlacement`.
- Prefab files can hold nested `instances` (the scene's instance schema).
  `prefabsUsedBy(def, prefabs?)` takes an optional library and then returns
  every prefab the scene reaches through nested instances and variant
  bases, sorted; `sceneHashWith` hashes all of them. `formatPrefab` writes
  the full v3 prefab header order: `$schema`, `kind`, `v`, `game`, `id`,
  `base`, `contract`, `params` (one per line), `assets`, `overrides` (one
  per line), `bulk`, `instances` (one per line), `entities` (one per line,
  always written, `[]` when empty). `prefabOf`, `prefabBody`,
  `prefabScene` and `sceneBody` carry instances.
- `instantiate` works in a prefab's view (pass `prefab`, the viewed
  prefab's id, in `ApplyOptions`) and refuses with `prefab-cycle` an
  instance, an `update` of an instance's `prefab`, a `definePrefab`, a
  `createPrefab` or an `applyToPrefab` that would make a prefab contain
  itself. `override` takes nested child keys (`door-1/panel.path.speed`)
  and a nested instance's own fields (`door-1.at`, `.rot`, `.flip`, `.z`,
  `.off`, `.layer`, `.params.<name>`; any other field is `op-invalid`).
  `applyToPrefab` takes `to`, a prefab in the instance's chain that
  receives the values (default its own prefab; a nested child's override
  lands on the nested instance there); a path that doesn't run through
  `to`, or one a level between overrides too, refuses with `op-invalid`.
  `unpack` is one level: the outer instance's nested instances become
  instances of the document, their `at`, turn, `z`, layer, `off` and group
  composed with it and its overrides through them folded in.
  `createPrefab` takes instance refs, which move into the new prefab as
  nested instances (their group's transform baked in). `definePrefab`
  carries `instances`, `base`, `overrides`, `params` and `assets`, and
  every inverse restores them. `diffPrefabToOps(view, next, registry?)`
  turns a prefab doc's view into a prefab's children, nested instances and
  assets.
- `./editor`: prefab commands work on nested instances. `applyLevels`
  lists the prefabs Apply to prefab can write a ref's overrides into, and
  `applyToPrefabBatch(def, ref, { to, prefabs })` writes to the chosen
  one. `revertAllBatch` on a nested ref (`room-1/door-1`) drops only the
  keys that ref covers (`overridePathsOf`). `nestedInstanceOf` finds a
  nested instance by its resolved ref. `instancesOf` counts placements
  through nesting, and placements of the prefab's variants, when given the
  library. `createPrefabBatch` accepts
  instances, which become nested instances of the new prefab.
  `buildOutline` adds a row for each nested instance and its children
  (`room-1/door-1/panel`), one level deeper each time.
- Variants: a prefab with `base` resolves its base's children (the
  variant's `overrides` applied, `off: true` hides one) ahead of its own
  entities, bulk entries and instances; a base counts toward
  `PREFAB_MAX_DEPTH`; a cycle through bases is `prefab-cycle`, a missing
  base `variant-base-unknown`. Exposed params: an instance's `params`
  apply as overrides of every target (prefab < param < override at each
  level), a param's `default` applies when the instance sets none, and a
  variant inherits its base's params (a redeclared name replaces it).
- Prefab files take a variant header: `base` (a prefab id), `overrides`
  (override path to value) and `params` (name to
  `{ description, targets, default? }`), plus the `assets` header;
  `parsePrefab`, `prefabSchemaFor`, `prefabOf` and `prefabBody` carry all
  four, and `entities` stays required (it may be empty).
- `setPrefabBase` and `exposeParam` apply on a prefab's view (`applyOps`
  with `{ prefab }`) and are refused with `op-invalid` on a scene. An
  unknown base is `variant-base-unknown` with did-you-mean; the prefab
  itself, or a base that contains it, is `prefab-cycle`. When the header
  changes, `result.prefabs` holds the viewed prefab, with its new base and
  params plus the view's children and `assets`, and `prefabsChanged` lists
  its id. Inverses are header ops.
- `setParam` sets or (null) clears one param on an instance, and `update`
  with `params.<name>: null` clears it too. A param's value is checked
  against every target as an override, and the instance's own overrides
  still win. A param the prefab doesn't expose isn't refused; validation
  reports it as `param-unknown`. Instance params come back in an inverse
  as one `setParam` per param.
- `diffToOps` writes each changed instance param as a `setParam`.
  `diffPrefabToOps` takes an optional fourth argument, `header` (the
  prefab's current base and params), and writes `setPrefabBase` and
  `exposeParam` for whatever differs.
- `./collab`: `setPrefabBase` and `exposeParam` in an `editScene` of a
  prefab write that prefab doc's header through the session's prefab
  writer: the base on its own and overrides per path (logged under
  `VARIANT_KEY`), parameters per name (`@param:<name>`). An unknown base
  is `variant-base-unknown` (with a did-you-mean); the prefab itself, or a
  base that leads back through bases or nested instances, is
  `prefab-cycle`. Sent to a scene, either op is refused with `op-invalid`.
  `changeAssetId` of a base prefab repoints its variants' `base`.
- `./game`: `CHILD_REF_PATTERN` and `refField(description)`: a reference
  field may name an instance's child by its resolved ref (`gate-2/door`,
  `room-1/door-1/panel`); every other id keeps `ID_PATTERN`.
- `./editor`: `instanceParamsModel` and `paramBatch` (`InstanceParamsModel`,
  `ParamModel`): an instance's exposed params, each typed by its first
  target's schema, set with `setParam` (a nested instance's as an override
  of `<nested>.params.<name>`); the inspector's instance panel lists and
  edits them. `referableEntities` (`./editor`).
- Scene fragments carry prefab instances: `fragmentOf(def, refs, registry,
prefabs?)` copies instance refs as instances (world `at`/turn, prefab by
  id) and an instance's child as a plain entity under its own id;
  `fragmentSchemaFor` gains `instances`; `placeFragment(fragment, def,
registry, by, prefabs?)` emits `instantiate` ops after the `add`s,
  renames clashing instance ids (`gate-2` → `gate-3`) and rewrites child
  refs into them (`gate-2/door` → `gate-3/door`); an instance whose prefab
  is missing from `prefabs` places nothing and warns `prefab-unknown`.
  `copySelection` and `cutSelection` take `prefabs`, as do
  `PasteOptions.prefabs` and `duplicateSelection`'s options; the editor's
  copy, cut, paste and duplicate pass the session's prefabs.
- `./editor`: `createVariantBatch(base, prefabs, { taken?, folder? })`
  (`CreateVariant`): Create variant. Returns `{ id, project, scene }`.
  `project` is one `createAsset` (kind `prefab`, content
  `{ kind: "prefab", v, base, entities: [] }`), for agents, the CLI and
  the dev file adapter. `scene` is the same prefab as a `definePrefab`,
  for a session that writes prefab docs through its prefab source. The id
  is `<base>-variant`, numbered when taken. Returns null when the library
  has no such base.

- `./editor`: Escape leaves a prefab open on its own once the gesture,
  tool and selection are cleared (`leave-prefab`, bound in edit scope
  before `clear-selection`). `KeyContext` gains `inPrefab` and
  `hasSelection`; `ToolHost.keyContext()` supplies `hasSelection`.
- `./editor`: `attachBatch(def, ref, follower | null, registry, prefabs?)`:
  one `update` that points an entity's `attachField` at a follower, an
  instance's child follower (`gate-2/lift`) included, or clears it. It
  returns null when the type has no `attachField`, the follower's type
  isn't one the field's refs allow, or nothing would change.
  `attachFieldOf` and `isFollowerType` tell which types can attach and
  which can be ridden. In the outliner, dragging a row onto a follower's
  row attaches it, dropping it on its type's row detaches it, and an
  instance's nested children show as a tree that opens and closes.
- `./editor`: the instance inspector turns (clockwise / counter-clockwise)
  and flips (horizontally / vertically) a scene instance as one batch
  each, and shows and sets its `z`; `instanceTransformModel` and
  `instanceZBatch`.
- `README.md` covers format v3: behaviors, layers and `z`, assets and the
  `assets` header, scene settings, grids, transforms, nested prefabs,
  variants and parameters.
- `./collab`: `applyEntityDiff(runtime, before, after)` moves a
  `BindableRuntime` from one set of entities to another (removes, adds and
  updates only what differs) and returns false when an add or update
  failed, so the caller reloads; `bindSceneDoc` uses it.

### Changed

- **Breaking:** `LAYERS` and `Layer` are gone from the scene types:
  `EntityBase.layer` and `InstanceDef.layer` are plain strings naming one
  of the registry's layers, and `ResolvedSettings` is
  `{ gravity, physics, grid: GridSettings | null, view, ...game keys }`.
  `defaultLayer` moved from `editor/spatial-index` to `scene/layers` and
  takes an optional third argument, the registry's layers: a game whose
  layers lack `terrain`, `gameplay` or `editor` gets the first layer
  (editor-only types the last).
- **Breaking:** `BASE_FIELDS.layer` is any id (`ID_PATTERN`), not a fixed
  enum; `RESERVED_FIELDS` gains `z`, `behaviors`, `params` and
  `overrides`, and `createRegistry` refuses a type whose required `path`
  field accepts `{}`, since an empty `path` is written as none.
- `createRegistry` refuses a type field name that isn't
  `/^[A-Za-z_$][A-Za-z0-9_$]*$/`, a game settings field named `gravity`,
  `physics`, `grid` or `view`, and invalid game layers (none, duplicate or
  non-`ID_PATTERN` names, non-finite draw or scroll). `registry.layers` is
  the game's layers or `DEFAULT_LAYERS`; `withProject` fills
  `FieldEnv.assets` with the project's live ids per kind, sorted, and
  `CreateRegistryOptions` gains `assets`.
- A prefab for another game (or no registry) still reports its header,
  base and nested-instance prefab references.
- `formatScene` writes `assets` on one line after `settings`, sorted and
  unique, and leaves it out when empty. `formatPrefab` writes `assets`
  after `contract`. The entity and instance key order adds `z` (after
  `off`), `rot`, `flip` (after `at`) and `params` (before `overrides`).
  The resolved view adds an instance's `z` to each child's, `unpack` bakes
  it into the children, and `instantiate` keeps `z`.
- Each loadable type's entity schema has a `behaviors` object. A known
  block is checked by its behavior's fields, and a field is required only
  when neither the behavior nor the type gives it a default. Any other
  name parses, so validation can report it by name. The JSON Schema lists
  only the type's allowed behaviors (`additionalProperties: false`), and
  types that don't load have no `behaviors`.
- `OVERRIDE_PATH` follows the override-path grammar: a child ref (ids
  joined by `/`, optionally ending in a bulk ref), a dot, then a field
  path whose segment right after `behaviors` may be a behavior name.
- The formatter's entity and instance key order ends with every other key
  by code unit, then `behaviors` (its blocks by name in code-unit order),
  then grid-valued keys. Everything inside `behaviors` is written by code
  unit, at every depth and whatever the names (a path-shaped field value
  included), and `comparePointers` orders pointers there the same way. An
  entity that holds grids spans lines, one chunk
  per line, chunk keys row-major by (cy, cx); `formatScene`'s `lines` maps
  each chunk pointer to its line. `formatPrefab` writes grid entities the
  same way. `comparePointers` takes an optional document to place grid
  keys, and orders chunk keys and behavior names as the text does.
  `parseScene` reports bad grid keys, rows, row counts and values past a
  field's max as `grid-invalid`, once per problem.
- The inspector's `behavior` section is titled Gameplay (its id is
  unchanged). `ModelField.section` and `InspectorSectionModel.id` are
  `ModelSectionId` (`InspectorSectionId | behaviors:<name>`).
- `./collab`: collab layout 3 (`COLLAB_LAYOUT_VERSION = 3`). Record keys
  are `Z_FIELD = "@z"` and `BULK_FIELD = "@bulk"`: every `@`-key belongs to
  the layout and `readDoc` strips only those, so a draw `z` field survives.
  `behaviors` is a two-level nested map (`NESTED2_FIELDS`; removing a
  behavior wins over a concurrent field set) and `params` joins
  `NESTED_FIELDS`. `recordMap` gives a named entity an empty `behaviors`
  map and an instance empty `params` and `overrides` maps, which
  `patchRecord` empties and fills in place and `recordOf` reads as absent,
  so two clients adding an entity's first behaviors (or an instance's
  first params or overrides) at once both land. Grid-valued fields are stored one row per key
  (`<field>@<cx>,<cy>/<row>`, `GRID_ROW_KEY`): `patchRecord` writes only
  changed rows and `recordOf` gathers them back canonical. The `assets`
  header is the `assets` map (AssetId → true; `readAssets`,
  `writeAssets`). `contentMaps` adds `assets` and the prefab doc's `params`
  and `overrides`. `readDoc` reads a prefab doc's instances, and its base,
  params and overrides into `DocView.prefab` (`PrefabDocHeader`). Groups
  carry `rot` and `flip`. New helpers: `assetsMap`, `paramsMap`,
  `prefabOverridesMap`, `patchMap`, `recordFields`, `isLayoutKey`,
  `gridRowKey`.
- `./collab`: `migrateLayout` lifts a layout-2 scene doc to layout 3 (every
  entity and instance record's `z` → `@z`, `bulk` → `@bulk`, keys kept, one
  `migration` transaction), and takes a layout-1 scene through the prefab
  move and then the rename in the same scene transaction. New
  `migrateDocLayout(doc, layout?)` (`DocLayoutMigration`) does the same for
  a prefab doc (records) or a declarative asset doc (every `keyed` entry's
  order key, at any depth) at load. Keyed entries keep their order under
  `KEYED_Z = "@z"`. `migrateDoc` writes only `meta.schemaVersion` for a
  step that changes nothing but `v`.
- Dev and hosted loads lift layout-2 scene, prefab and declarative asset
  docs to collab layout 3 (`@z`, `@bulk`), keeping every key; the layout
  step runs before the format migration, and a client whose token carries
  `l` below 3 connects read-only with `engine-outdated`.
- `./collab`: `writeScene` writes the `assets` map one id per key (log key
  `@assets`), a group's `rot` and `flip` as their own keys (`patchGroup`),
  and an instance's `rot`, `flip`, `z` and per-key `params` through
  `patchRecord`, so `paintCells` writes only the grid rows it changed. A
  prefab doc's `writeScene` also writes its `assets` and nested
  `instances`.
- `./collab`: `prefabToDoc`, `docToPrefab` and `prefabPatch` write and read
  the layout-3 prefab maps: `base` in the `prefab` header beside `id` and
  `contract`, `params` (name → PrefabParam, atomic each), `overrides` (a
  variant's, path → value), `assets` (AssetId → true) and nested
  `instances` (key → Y.Map, the scene's instance layout). `prefabPatch`
  keeps nested instances' keys by id and logs each parameter under
  `@param:<name>`, base and overrides under `@variant`, and the assets set
  under `@assets`, so concurrent edits to different keys merge and each
  entry reverts.
- `./collab`: `revertEntry` reverts `@assets`, `@param:<name>`, `@variant`
  and a prefab doc's `@header`; a group reverts key by key.
- `./collab`: `watchIssues` / `validateDoc` take `project` (`IssueProject`:
  a `ProjectSession` fits); with it the scene's asset ids are checked
  (`asset-missing`, `asset-kind`) and a change to the project registry
  revalidates. A prefab doc validates as a view of its prefab
  (`ValidateOptions.prefab`).
- `moveAsset` and `renameAsset` of a scene carry its checks file
  (`<stem>.checks.json` beside it) to the same folder and new stem in the
  same op, refused with `path-taken` when that path is taken; `deleteAsset`
  of a scene names its checks file as an `asset-in-use` referrer at
  pointer "" (by path), unless the batch trashes or moves the checks file
  too, or a new scene takes the path.
- `localChild`, `localChildren` and `placeChildren` take an optional
  trailing `library` (and `opts` for `localChild` and `localChildren`).
  With a library, nested instances resolve; without one, only the prefab's
  own children come back, and a prefab that doesn't resolve has no
  children. `LocalChild` gains `turn?` and, on bulk children, `placed?`. A
  nested child's `def.id` is its id in its own prefab, while `child` is its
  relative ref. `childEntity` returns the relative ref as the id and
  applies `placed`. `ResolvedOrigin.path` carries the whole instance
  chain, and its transform composes nested turns.
- `splitOverridePath` returns null when the child part is not a child ref
  or the field part is not a field path. Nested override keys
  (`door-1/panel.path.speed`) and nested-instance keys
  (`door-1.at|rot|flip|z|off|layer|params.<name>`) resolve so that an
  outer level beats every inner one. Override values are in the frame of
  the child's own prefab.
- `diffToOps` removes and re-instantiates an instance whose `prefab`
  changed instead of updating it.
- `ApplyOptions` gains `prefab`, the prefab the document is a view of.
- `prefabsUsedBy(def, prefabs?)` takes the library as an optional second
  argument. `prefabSceneBounds` takes
  `Pick<Prefab, "bulk" | "entities" | "instances" | "v">`.
- `./collab`: a prefab doc takes `instantiate`, `override`,
  `revertOverride`, `applyToPrefab` (with `to`) and `unpack`, so prefabs
  can nest; `setScene`, `setSettings`, `setGroup`, `definePrefab` and
  `createPrefab` stay scene-only (`SCENE_ONLY_OPS`). An `instantiate` that
  would make the prefab contain itself is refused with `prefab-cycle`, both
  live and in `checkProjectBatch`. The bounds a prefab doc is edited in
  also hold its nested instances' origins.
- `./collab`: `prefabSceneBounds(prefab, parent?, registry?, prefabs?)`
  and `ReadDocOptions.prefabs` take the prefab library, so a prefab doc's
  bounds hold its nested instances' resolved children. The editor session,
  `bindSceneDoc`, `validateDoc`/`watchIssues` and `applyOpsToDoc` all read
  prefab docs with their prefab source's library, so they agree on its
  `sceneHash`; an edit to a nested prefab can change that hash (the
  session re-reads it when its source changes).
- `./editor`: `applyToPrefabBatch(def, ref, opts?: { to?, prefabs? })` and
  `instancesOf(def, prefab, prefabs?)`.
- `attachField` takes child refs (`gate-2/lift`), so an entity can ride a
  follower inside an instance.
- `refCandidates(def, registry, accepts, prefabs?)` takes an optional
  `PrefabLibrary` and then lists instances' children at any depth.
- `duplicateSelection` reads the selection through `fragmentOf`, which
  resolves the document itself, so the editor no longer passes `from`.

### Fixed

- Copying an instance's child no longer produces a fragment paste refuses
  with `bad-id`: the child takes its own id (`gate-2/door` → `door`, a
  bulk child its type), and refs to it in the fragment follow.
- `snapshotScene` and `loadHeadless({ files })` load every prefab a scene
  reaches (nested instances' prefabs and variant bases), not only the ones
  it places, so a scene with nested prefabs or variants loads instead of
  failing with `prefab-unknown` or `variant-base-unknown`.
- `changeAssetId` on a prefab that other prefabs nest or use as a base
  rewrites those prefabs' instances and `base` in the same batch, instead
  of refusing with "changed while the batch was being planned".
- `bindSceneDoc` and `watchIssues` follow every prefab a scene reaches
  (`prefabsUsedBy`), so editing a nested prefab or a variant's base
  reaches the live runtime and the issue list.
- An empty map (`behaviors: {}`, an empty `path`, `settings: {}`) and an
  absent one are the same between file and doc, so both hash alike.
  `formatScene` leaves an empty `settings` out and `parseScene` reads it
  as absent.
- Behavior defaults are no longer written into files; one implementation
  of `setPrefabBase` and `exposeParam` serves the scene and project paths;
  `createAsset` of a prefab or variant writes through the prefab writer
  on the live and file paths; a batch can expose a param in one
  `editScene` and set it in a later one.
- `prefabScene` and `sceneBody` carry a prefab's `assets` header, so a
  prefab edited or validated on its own keeps it.
- A variant's own `overrides` count as asset and material references (so
  renames rewrite them) and are validated in its view: a path naming no
  child of the base is `unused-override`, one naming a grid field is
  `grid-invalid`, each with a fix that drops it. The fix is a
  `revertOverride` with no ref, so it applies to a live prefab doc and
  touches only that override.
- `override` and `revertOverride` with no `ref`, in a prefab's own
  document, set and drop the prefab's own overrides of its variant base,
  on the scene, project and live paths (a prefab doc writes them per
  path); their inverses are the same ops. Sent to a scene they are refused
  with `op-invalid`, like the other header ops.
- A header op's failure points at its field on every path
  (`/ops/<i>/base`, `/ops/<i>/name`, `/ops/<i>/set`), and a prefab named
  as its own base is `prefab-cycle` on every path.
- An `editScene` on the project path that removes a prefab's last
  `assets` entry drops its `assets` header; the scene and project paths
  build the prefab a view leaves with one helper (`prefabLeftByView`).
- A prefab validated on its own judges a turned or flipped nested instance
  over grid children against the grid `ValidateOptions.settings` (the
  project's engine block, the game's defaults) resolves; with none, each
  scene that places the prefab judges it. Neither source holds a grid yet,
  so the editor and `scene validate` leave the check to the placing scenes
  until a caller passes one.
- An override of a bulk child's `off` (a variant hiding a base solid, or a
  cut of an instance's bulk child) is no longer `unused-override`.
- A behavior field's default under an `optional` or `nullable` wrapper
  (`z.number().default(3).optional()`) is no longer filled on parse and
  written back to files; `expandScene` still fills it.
- The `assets` header's asset checks skip a non-string entry, as the
  project's ref sites do, instead of reporting it.
- In a variant's isolation, an edit whose base children the edit world
  can't add or update reloads the world instead of leaving it out of
  step.
- Generated JSON Schemas no longer carry the field builders' `kind` and
  `axis` meta, which aren't JSON Schema keywords.
- Quarter-turn rotation is exact and writes no trailing `rotDeg: 0`; bulk
  children of a turned nested instance carry the composed turn; grid
  entities' render boxes cover their cells.
- Editor: cutting an instance's child, `cutSelection` hashing the
  document, a variant in isolation showing its base's children, and the
  outliner's layer view showing nested rows.

### Agent surface

- `AGENT_SURFACE_VERSION` is 8: the ops, issue codes, schema ids and CLI
  output below. MCP tool names are unchanged; `scene_apply_ops` takes the
  new ops through `ops:v3` and `scene_show` carries the new fields.
- Ops `transform`, `setZ`, `useAssets`, `paintCells` (at most 65,536
  cells; `rects` fill first and `cells` paint over them), `setPrefabBase`,
  `exposeParam` and `setParam` in the ops schema; `setGroup` takes `rot`
  and `flip`, `instantiate`'s instance takes `rot`, `flip`, `z` and
  `params`, `applyToPrefab` takes `to`, `override` and `revertOverride`
  take an optional `ref` (omitted, in a prefab's own document: the
  prefab's own overrides of its base), and `definePrefab`'s body takes
  `instances`, `base`, `overrides`, `params` and `assets`.
- A variant's `unused-override` and `grid-invalid` fixes are
  `{ "op": "revertOverride", "paths": [<path>] }`, not a `definePrefab`;
  a prefab named as its own base through `editScene` or a prefab doc is
  `prefab-cycle` (was `variant-base-unknown`), and header op issues point
  at the op's field (`/ops/<i>/base`, `/ops/<i>/name`).
- The prefab schema (`prefab:v3`) takes an optional `instances` array of
  the scene's `Instance`, and `base` (before `contract`), then `params`
  (`PrefabParam`: `description`, `targets`, `default`), `assets` and
  `overrides`; `entities` stays required. The fragment schema takes an
  optional `instances` array.
- An `attach` field's pattern is `CHILD_REF_PATTERN`, not `ID_PATTERN`, in
  the scene, prefab and fragment schemas.
- Issue codes `prefab-cycle`, `prefab-depth`, `variant-base-unknown`,
  `param-unknown`, `layer-unknown`, `behavior-unknown`,
  `behavior-forbidden`, `behavior-missing`, `grid-invalid` and
  `ref-child-unknown`.
- `scene show` lists nested instance children as `a/b/c` with
  `instancePath`, an instance's `nested` ids, `z`, the world `transform`
  (turn and flip), behavior blocks, an instance's `params` and the params
  its prefab `exposes`, and each grid field's summary (`grids.<field>`:
  filled `cells`, `chunks`, cell `bounds`); a turned group member's AABB is
  in world space. `scene fmt` reports `migratedFrom` for scenes and
  prefabs it migrates to v3.
- `scripts/scene/README.md` §Format v3: behaviors, layers and `z`, assets,
  grids, transforms, nested prefabs, variants and parameters, with a
  dry-runnable batch for every new and changed op and one that reports
  each new issue code; `examples/paint-cells.json` and
  `examples/turn-instance.json`.

## [0.6.0] — unreleased

The collaborative project and asset model: a project is a set of typed
assets, each kind co-editing like a scene, with a registry, references,
content-addressed blobs and one undo stack across every doc a client
writes.

### Added

- `./project`, a new entry that needs only zod: the project model as plain
  JSON. Ids and keys (`AssetId`, `AssetKey`, `AssetPath`, `Sha256`),
  `ProjectFile`, `AssetEntry`, `ProjectState`, `Licence`, `ProjectOp` and
  `ProjectOpBatch` (`PROJECT_OP_NAMES`); doc names `project:<id>`,
  `scene:<project>.<key>` and `asset:<project>.<key>` (`parseDocName`
  returns null for anything else, `docNameOf` throws on a bad id or key;
  `DOC_NAME_KINDS`, `DOC_NAME_MAX_LENGTH`); `sha256`, `isSha256` and
  `stableJson`.
- `./game`: `GameDefinition.assetKinds`, `tables` (`GameTableDef`) and
  `projectSettings`; `EngineContext.project` (a frozen
  `ProjectRuntimeView`, or null) for the run.
- `./collab`: `DocOrigin` (`SceneOrigin` stays as its alias) gains the
  `repair` origin, labelled `repair (<reason>)`; `ProjectLogEntry` sits
  beside `LogEntry`.
- `./project`: `canonicalJson(value, layout)` writes a declarative kind's
  canonical text: `$schema`, `kind`, `v` first at the root, then the
  layout's declared fields, then the rest sorted; one line per keyed or
  list item, a keyed item's id first; two-space indent; trailing newline.
- `./project`: `applyJsonEdits(value, layout, edits)` applies `set`,
  `unset`, `insert` (before a sibling id or an index, default the end) and
  `remove` to plain JSON; RFC 6901 pointers with `@<id>` segments for keyed
  items (`parseJsonPointer`, `keyedItemPointer`, `readPointer`). It refuses
  a pointer into an atomic or text value with `op-invalid`, a repeated
  keyed id with `id-taken`, and a missing target with `ref-not-found`.
- `./project`: `memoryContentStore()` implements `ContentStore`. `put`
  rejects with a `ContentStoreError` carrying a `hash-mismatch` issue when
  `expect` differs. `hashForPut` gives other stores the same check.
- `./project`: `createKindRegistry(game, base)` builds a kind registry:
  engine kinds then the game's `assetKinds`. It refuses duplicate names,
  game kinds not named `<gameId>/<name>`, game kinds with
  `layout: "custom"`, declarative layouts without a `map` root, and a
  suffix or `jsonKind` that two kinds claim. `detect` goes in order:
  sidecar kind, longest suffix, `.json` top-level `kind`, then a kind's
  `test`. It always skips `*.schema.json`, `*.asset.json`,
  `jams.project.json`, `__tests__`, `node_modules` and `dist`
  (`isSkippedAssetPath`). `schemaHashes` hashes each kind's JSON Schema.
- `./project`: `validateAssetDoc(kind, value, env)`: schema issues
  (`schema`, `unknown-key`), `dup-id` for repeated ids in `keyed`
  collections, then the kind's own `validate`.
- `byCodeUnit` (`./project`): the code-unit string comparator the
  project model sorts by.
- `./project`: `buildRefIndex` (referrers, targets, dangling references as
  `asset-missing` with a did-you-mean), `rewriteRefs`, `referencedTrash`
  (the trashed entries a live value names, for the writer's
  restore-on-store repair), `projectUsage` and `unreferencedBlobs` (keeps
  current hashes of live and trashed entries, hashes replaced within the
  grace period, and pinned snapshots' hashes). Every replacement appends
  the outgoing hash to the asset's history stamped with its time, so a
  hash's newest `HashHistoryEntry.at` is when it last stopped being
  current.
- `./project`: the files-to-registry steps every host seeds a project
  with, shared by the dev server's scan and the site's bundle seeding:
  `projectPathMatcher(file, matchesGlob)` (asset and code candidates by
  the project file's globs), `ownAssetId`, `orphanSidecarIssue`,
  `idsAtPaths`, `assetFileEntry` and `assetFileEntries` (keys from the
  sidecar or id, suffixed in file order; name, licence, settings and the
  inspected meta), over `AssetFile`.
- `./project`: `parseProjectFile` / `formatProjectFile` for
  `jams.project.json` (`urn:jams-engine:project:v1`, defaults
  `assets: ["**"]`, `code: ["**/*.ts", "**/*.tsx"]`) and `parseSidecar` /
  `formatSidecar` for `<file>.asset.json`
  (`urn:jams-engine:asset-sidecar:v1`; `key` omitted when it equals `id`,
  `assetKind` when detection agrees). New schema files
  `./schemas/project.schema.json` and `./schemas/asset-sidecar.schema.json`.
  `src/engine/scenes/` and `src/games/platformer/` each carry a
  `jams.project.json`.
- `./project`: pure header readers `readPngSize`, `readJpegSize`,
  `readWebpSize` (VP8, VP8L, VP8X) and `readGifSize`; `parseAsepriteJson`
  and `parseTexturePackerJson` (hash and array exports: frames, tags with
  direction, slices with nine-slice centre, file order) with `atlasImage`
  and `atlasTool`; `parseBmfont` for text .fnt line height and pages. They
  read headers and JSON only and return null on bad input.
- `./collab`: `layoutToDoc`, `layoutFromDoc` and `layoutPatch` keep a
  declarative kind's value in `doc.getMap("content")` by its `DocLayout`
  (atomic, text, map, list, keyed). A patch writes only what changed, in
  one transaction. Keyed items keep their keys when ids match, and two
  items with one id stay two.
- `createUndoCoordinator(origin, { cap })` (`./collab`): one undo stack per
  client across every doc it writes in a project. Each attached doc gets a
  `Y.UndoManager` with `createSceneUndo`'s settings over every root type
  but `log` and `meta`; a step that wrote several docs undoes (newest doc
  first) and redoes as one, carries its label and selection, never reaches
  into an older step when a collaborator overwrote part of it, and the
  stack keeps the newest 100 steps. `pinned()` names the docs with steps on
  either stack.
- Project log and project presence (`./collab`): `readProjectLog`,
  `observeProjectLog` and `projectLogFor` over the project doc's `log` of
  cross-doc batches (capped at `LOG_CAP`); `setProjectPresence`,
  `projectPeers`, `observeProjectPeers` and `projectPeersByDoc` over
  `PROJECT_PRESENCE_FIELD`, beside each doc's unchanged `ScenePresence`.
- `ENGINE_ASSET_KINDS` (`./project`): the engine's doc kinds `scene`,
  `prefab`, `material` (`material:v1`), `game-settings`
  (`game-settings:v1`), `data-table` (`data-table:v1`), `input-script` and
  `checks`, plus `code`. `createKindRegistry` uses them as its default
  base.
- `parseAssetDoc`, `formatAssetDoc` and `docKindJsonSchema` (`./project`):
  read, write and publish any doc kind's file. `DocKindDef.parse` lets the
  scene and prefab kinds use their own parsers.
- `createRegistry(game, { materials })` and
  `withProject(registry, view, values)` (`./game`): a project's material
  assets overlay the game's code materials by name. A material without
  `physics` can't be used on a body.
- `runtimeView` (`./project`): `EngineContext.project` reads game-settings
  (with `projectSettings` defaults) and data tables (merged in path
  order). `createGame`, `createHeadlessRuntime`, `runPlaytest` and
  `createSceneRuntime` take a `project` option; without one, `ctx.project`
  is null. `./headless` re-exports the `ProjectRuntimeView` type.
- `formatInputScript`, `formatChecks`, `INPUT_SCRIPT_LAYOUT` and
  `CHECKS_LAYOUT` (`./scene`).
- The project doc (`./collab`): `readProject`, `readEntry`, `writeEntry`,
  `seedProjectDoc`, `writeProjectState`, `appendHistory` and the
  `PROJECT_MAPS` accessors. Registry entries are `Y.Map`s whose `import`
  and `licence` are nested `Y.Map`s, so they merge per field.
- `applyRegistryBatch` (`./collab`) applies `createAsset`, `importAsset`,
  `renameAsset`, `moveAsset`, `deleteAsset`, `restoreAsset`, `setImport`,
  `replaceContent` and `setLicence` to a project doc in one transaction
  with the batch's origin and one project log entry. `applyRepairs`
  (repair origin, idempotent) writes the view's deterministic id and path
  repairs, plus restores of the trashed keys it is given.
- `projectView` (`./project`) resolves `byId`, `byPath`, `byKey`, the
  trash, the issues `asset-id-taken`, `path-taken` (case-only included)
  and `asset-kind`, the repairs (sorted by `(created.at, key)`, with
  `-2`/`-3` before the extension) and `tree()`. `checkProjectBatch` checks
  the registry ops on plain JSON; `ProjectBatchEnv.newKey` is required and
  `inspect` (a `BlobInspect`) is new. `assetIdOfPath`, `assetPathProblem`,
  `compareEntries`, `suffixedId` and `suffixedPath` are exported beside
  it.
- `./vite`: `fileContentStore(cacheDir)`, the dev content store: blobs at
  `<cacheDir>/blobs/<sha256>`, written atomically, `put` refused with
  `hash-mismatch` when `expect` differs; `defaultCacheDir(project, root?)`
  and `DEV_CACHE_ROOT` (`node_modules/.cache/jams-engine/<project>`).
- `./vite`: `createProjectFileAdapter(project)` reads a project's files
  into a `ProjectState` (`scan`: keys are ids unless a sidecar names one;
  schemas, sidecars, the project file, `__tests__`, `node_modules` and
  `dist` are skipped) and writes declarative asset docs and registry
  changes back: canonical text only when it changed, a sidecar only when
  it carries something, moves, trash and restore from the dev cache. File
  events: an edit is one `disk` layoutPatch; adds and unlinks wait for
  `settle`, which pairs them into moves (`pairDiskEvents`, by sidecar key
  then id, within `MOVE_SETTLE_MS`).
- Blob asset kinds `texture` (PNG, JPEG, WebP, GIF; 8 MiB), `atlas`
  (Aseprite and TexturePacker JSON; 2 MiB), `font` (text BMFont, WOFF2,
  WOFF, TTF, OTF; 4 MiB), `audio` (Ogg, MP3, WAV, M4A; 16 MiB) and
  `recording` (recording:v1; 4 MiB, immutable) join `ENGINE_ASSET_KINDS`,
  each with zod settings and meta and a pure, header-only `inspect` that
  returns `import-failed` instead of throwing.
- `./collab`: `createProjectSession({ project, openDoc, origin, registry,
kinds, store?, buildAt?, prefabWriter?, cap?, key?, now? })` is a
  client's live project. Docs open lazily through the host's injected
  `openDoc(name): Promise<{ doc, awareness, close }>`, one undo
  coordinator spans all of them, and docs with undo steps stay open
  (`pinned()`). Code skew: a doc of a kind whose schema hash differs from
  the project's build stamp opens read-only with `code-skew`
  (`detail: { kind, mine, project }`), unless this build's
  `(buildAt, hash)` is newer, in which case the session writes its stamp
  with origin `repair`/`build`. `prefabWriter` is a slot;
  `NO_PREFAB_WRITER` refuses prefab writes with `op-invalid` ("needs the
  project"). `memoryDocHost()` serves docs in-process for tests and
  headless runs.
- `./collab`: `applyProjectBatch(session, batch, origin, opts?)` applies a
  project batch across docs. It checks first, so a failing op or a
  read-only doc writes nothing. Each doc gets one transaction and its own
  log entry, a batch that wrote two or more docs gets one project log
  entry, and the batch is one undo step for the session's origin.
  `editAsset` goes through `layoutPatch`, `editScene` through
  `applyOpsToDoc`, and a new asset's content is written as its doc's first
  edit. `applyRegistryBatch` still refuses `editAsset`, `editScene` and
  `changeAssetId`.
- `./collab`: `revertProjectEntry` / `revertOpenProjectEntry` revert a
  project entry as one new cross-doc batch, or name the doc that changed
  since. `revertEntry` takes `{ layout }` for asset docs'
  `@content:<field>` keys. `revertProblem` and `contentLogKey` are new.
- `./collab`: `historyRows(log, projectLog, docName)` returns
  `HistoryRow`s, and `appendProjectLog` is exported. `ProjectLogInput`
  takes an optional `id`.
- `./editor`: `projectHistory(project, docName, { onUndone? })` is a
  `SessionHistory` backed by the coordinator. `SessionHistory.undo`/`redo`
  may return the `SelectionMeta` to restore, and the new optional
  `commit(selection)` is called after each dispatch.
- `./project`: `checkProjectBatch` now checks `editAsset` (through the
  layout, then the kind's schema) and `editScene` (`applyOps` on scenes).
  Ops that write prefabs go to `env.prefabEdit`. `ProjectBatchEnv` gains
  `prefabsFor` and `prefabEdit`, `ProjectBatchCheck` gains `delegated`,
  and `writesPrefabs`, `PREFAB_SCENE_OPS` and `SCENE_KIND_NAME` are new.
- `./project`: project snapshots are real: `snapshotProject` pins every
  live asset by content hash (docs by canonical text, blobs by bytes and
  import settings), `checkSnapshot` resolves every reference to an asset
  in the snapshot (`asset-missing`, `asset-kind`, `hash-mismatch`),
  `snapshotScene` reads a scene and its prefabs from the content store
  and returns the registry they run by. Both parse with the snapshot's own
  material assets overlaid in place of any the caller's registry had, so
  a material edited after a snapshot never reaches it;
  `parseProjectSnapshot`, `formatProjectSnapshot`, `SnapshotError` and
  `SnapshotAsset`.
- `./headless`: `loadHeadless({ snapshot, store, scene, registry,
project? })` or `loadHeadless({ files, registry, project? })` loads a
  scene for a run without fetching or decoding a blob; two snapshots of
  one scene load side by side, each with its own materials in the
  returned `registry`.
- `SceneIssue.detail` (`./scene`): optional facts specific to an issue
  code, such as `code-skew`'s two schema hashes.
- `./project`: `checkProjectBatch` refuses `deleteAsset` with `asset-in-use`
  while another live asset names it, listing `detail.referrers: { id,
pointer }[]`. With `force` it trashes the asset, and the result carries
  each referrer's `asset-missing`. A site only counts when its kinds include
  the asset's kind. `changeAssetId` is checked: the entry's id, a prefab's
  own id, then every referrer is rewritten with `rewriteRefs`. A doc
  referrer goes through `editAsset` (set at the deepest addressable
  pointer), a scene through `update` scene ops, a prefab through
  `env.prefabEdit` as an `editScene` of its own, and a binary referrer
  through its import settings. A referrer that refuses fails the op, and so
  does a recording, whose bytes name its scene. The op needs every live doc
  whose kind has `refs`. `ProjectBatchCheck` gains `writtenBy` and `scenes`
  (`SceneWrite`: the scene ops, registry and prefabs each scene doc is
  written with).
- `./collab`: `applyProjectBatch` applies `changeAssetId` as one cross-doc
  batch. The registry entry, the prefab doc's header id (logged under
  `@header`) and every referrer each get one transaction, and it is one undo
  step. For `changeAssetId` and `deleteAsset` it opens every doc that can
  hold a reference. A doc it only reads refuses the batch for code skew only
  when the batch writes it. The prefab writer is asked about every prefab
  rewrite, and the batch is planned before anything is written. A prefab
  it creates gets the same path rule as `createAsset`: a path another live
  asset holds, ignoring case, or a file where a folder goes is `path-taken`.
- Breaking: `sceneToDoc` takes no `prefabs` and writes `meta.layout`, plus
  `project` and `assetKey` when given. `DocView` loses `prefabs` and gains
  `kind` and `prefab`. `readDoc(doc, { registry, parentBounds })` reads a
  prefab doc as a scene with synthesised bounds. `contentMaps` covers the
  prefab header map, not `prefabs`. `docMeta` returns `layout`, `kind`,
  `project` and `key`. `writeScene` takes no `prefabs`.
- `PrefabSource` (`staticPrefabSource`, `localPrefabSource`,
  `sessionPrefabSource`, `EMPTY_PREFAB_SOURCE`): `bindSceneDoc`,
  `watchIssues`, `validateDoc` and `createEditorSession` take an optional
  `prefabs` source and re-expand or revalidate once per prefab transaction.
  `EditorSession` gains `prefabs` and `parentBounds`.
- `applyOpsToDoc` takes `prefabWriter` and `parentBounds`. Without a writer
  it refuses definePrefab, createPrefab, applyToPrefab and unpack with
  op-invalid ('needs the project'). On a prefab doc it refuses scene-only
  ops and grouped children (`SCENE_ONLY_OPS`). Its result gains `docs`.
- Breaking: `openPrefabIsolation` is async and returns a session over the
  prefab's own doc; the scratch doc is gone. It takes `awareness`, `user`
  and `history` options. Apply to prefab, Create prefab and Unpack are
  cross-doc batches, one undo step each. `asProjectBatch` was added.
- `ProjectSession.prefabLibrary` slot; `PrefabPlan.release`.
- `./vite`: the project file adapter handles binary kinds. `scan` hashes
  each binary, copies its bytes into `fileContentStore` and inspects it;
  `storeProject` writes the sidecar every binary has (hash, bytes, settings,
  meta), the bytes of a `replaceContent` or restore taken from the content
  store, and moves and deletes the sidecar along with its file. When a
  binary's bytes change on disk, that becomes one `disk` `replaceContent`
  with re-inspected meta, and its `ProjectSync` result names the
  `AssetChange` for the server to broadcast as `asset:changed`. A persisted
  doc state loads with `PERSISTED_ORIGIN`, followed by at most one `disk`
  transaction for whatever changed on disk while the server was down.
- Breaking: `./vite`: the dev server serves every project doc
  (`project:<id>`, `scene:<project>.<key>`, `asset:<project>.<key>`) on
  `/__scene-collab` from the projects' files;
  `sceneCollabServer`/`listenSceneCollab` take
  `{ projects: FileProject[], buildAt?, settleMs? }` instead of `{ homes }`.
- `./vite`: dev persistence: each doc's Yjs state is kept in
  `<cacheDir>/docs` and reloaded on restart, with a file edited meanwhile
  applied as one disk transaction.
- `./vite`: one watcher per project root pairs unlink+add into moves within
  the settle delay; disk edits, moves and deletes become one disk
  transaction or registry op; binaries are rehashed and announced with an
  `asset:changed` stateless message on the project doc (`ASSET_CHANGED`,
  `AssetChangedMessage`).
- `./vite`: on store, the dev server repairs binaries whose bytes the
  content store lacks (`hash-mismatch`), restores trashed assets a loaded
  doc still names (`asset-in-use`; also as such a doc loads), and repairs
  duplicate ids and paths; it writes the code map and this build's schema
  stamps.
- `./vite`: `GET /__project`, `POST /__project/<id>/blob`
  (`x-expect-sha256`) and `GET /__project/<id>/blob/<sha256>`, same-origin
  only (`PROJECT_ROUTE`). A body that doesn't hash to `x-expect-sha256` is
  refused with 422 and a `hash-mismatch` issue, the status the site's blob
  route answers. An upload to a project with no blob kinds is refused with
  400 and an `asset-kind` issue before its body is read, and the project id
  segment is percent-decoded. Unlike the site's route it ignores
  `x-asset-kind` (the body is capped at the project's largest blob kind),
  answers 200 for a new blob as well as a held one, and has no quotas.
- `./vite`: `applyProjectBatchToFiles` and `snapshotFiles` apply a
  `ProjectOpBatch` to a project's files through the live path; a stale base
  fails with `stale-base`.
- Breaking: `./vite`: `readFileProject`, `codeModules`, `gameRegisters`,
  `isCodePath`; scene and prefab docs in the project file adapter;
  `file-adapter.ts` and `prefab-files.ts` folded into `project-files.ts`
  (`createSceneFileAdapter`, `sceneDocName`, `sceneOfDocName`,
  `SCENE_DOC_PREFIX`, `SceneHome` and `SceneFileAdapter` removed; use
  `createProjectFileAdapter` and `docNameOf`/`parseDocName`).
- `./vite`: `ProjectFileAdapter.blockedWrite(doc)`, the `path-taken`
  issue for a created or moved entry whose path something on disk other
  than its own file holds (a file the scan doesn't list, a file where a
  folder goes, ignoring case); a path a trash or move in the same write
  frees isn't blocked. `applyProjectBatchToFiles` refuses such a batch with
  it, dry run or not, and writes nothing; the dev server warns once,
  leaves the entry unwritten, and writes each held entry once a file event
  under the project frees its own path. `storeProject` trashes and stages
  moves before it creates, so a new entry can take a path the same write
  frees.
- `./vite`: `readProjectPrefabFiles(project, state, registry)` reads a
  project's live prefab assets at their registry paths. `PrefabFiles` gains
  `files` (each read prefab's file).
- `./vite`: `FileApplyOptions.store`: where `applyProjectBatchToFiles`
  inspects blob bytes from (a dry run's bytes stay out of the cache).
- `reinspectBlobs` (`./collab`): the project's one writer re-derives a
  binary's meta from its bytes and merged import settings on store, with a
  `repair` (`reinspect`) origin; `inspectEntry` (`./project`): the shared,
  never-throwing blob inspection every host uses.
- `./project`: `detectImport(kinds, path, json?)`, the kind a file brought
  into a project takes: `detect`'s, else `atlas` for a `.json` that names
  no `kind` and whose `meta.app` says Aseprite or TexturePacker exported it
  (`atlasExportApp`). The scene CLI's `assets import`, the MCP
  `asset_import` and the editor tree's drop import use it, so such a file
  imports without `--kind`, and its sidecar records `assetKind: atlas`.
- `./collab`: `buildAtFrom(raw)` and `stampWins(buildAt, hash, than)`, the
  build-time reading and stamp comparison every host shares, so a dev
  server and the browser given the same `VITE_BUILD_AT` agree on it.

### Changed

- **Breaking:** doc names carry the project. A scene is
  `scene:<project>.<key>` (the platformer's yard is
  `scene:platformer.test-yard`), every other asset `asset:<project>.<key>`,
  and the registry `project:<id>`, on the dev server and on canvas-sync
  alike; the old `scene:<name>` no longer resolves.
- Collab layout 2: `COLLAB_LAYOUT_VERSION` is 2. Each prefab is a doc of its
  own with the scene entity layout (`prefabToDoc`, `docToPrefab`,
  `prefabPatch`), so concurrent edits to different children or fields merge.
  Scene docs drop their `prefabs` map (`DOC_MAPS.prefabs` stays as the
  layout-1 name). `migrateLayout(sceneDoc, projectWriter)` and
  `projectDocWriter` move a layout-1 doc's prefabs into prefab assets at
  load. A client whose sync token's `l` claim is older or newer than the
  doc's layout connects read-only.
- Prefabs are assets: a prefab file is a `prefab` asset of its project,
  edited in its own doc, and the editor's prefab ops write that doc in the
  same undo step as the scene.
- **Breaking:** `./vite`: `writePrefabFiles` is removed; every scene home is
  a project, whose prefabs change through `applyProjectBatchToFiles`.
- The scene CLI's `GAMES` table, `gameScenesDirs` and `gameSchemaFiles` are
  gone: every `jams.project.json` names its game, and `ToolContext` takes
  `projects`.
- Concurrent `replaceContent`s now resolve to one writer's hash, size and
  meta together (never a mix).
- The dev server sends `asset:changed` whenever a binary's hash changes (a
  client's `replaceContent`, a disk re-export or a hash repair), not only on
  disk edits, and re-inspects binaries on store.
- A `data-table` asset in a project with no game takes any table name, its
  rows needing only ids; the game a run names judges the rows when it reads
  them (`ctx.project.table`). A game without tables still refuses every
  table.
- The engine's own project (`src/engine/scenes/jams.project.json`) holds a
  `bouncy` material asset the kitchen sink's `ledge` uses, a
  `game-settings` doc and a `card` data table (`data/cards.json`);
  `engine-yard.checks.json` and `kitchen-sink.checks.json` are in
  `formatChecks`' canonical form.

### Fixed

- An `editScene` that removes a prefab (`definePrefab` with `null`) is
  refused with `asset-in-use` and `detail.referrers` while another live
  asset still names the prefab, live and on files alike. `checkProjectBatch`
  judges it, and a `deleteAsset` without `force`, once the whole batch has
  run, against what the batch leaves every referrer (a delegated
  `editScene`'s scene included): removing the last instances in the same
  batch, here or in another scene, or deleting the referrer still works,
  and a reference another op of the batch adds is refused before anything
  is written. A delegated `editScene` is judged the way it is written,
  after the batch's other edits of its scene: ops that don't apply to what
  they leave it fail the batch at that op, and so does one that defines or
  changes a prefab an earlier op of the batch removed (`op-invalid`). In
  the editor, the scene's own prefab writer judges a removal against the
  docs the browser holds open. The dev server restores a trashed asset
  that a doc it holds still names, on store and when such a doc loads; it
  doesn't read docs nobody has open, so a forced delete stays trashed
  while its referrers are closed.
- `scene apply` reports the unchanged file's `sceneHash` when the project
  refuses the batch, so a retry with `--base` that hash isn't stale.
- A material's bulk keys (`solid:<material>`, a prefab's `bulk` too) and
  instance overrides that set a material field are references: `deleteAsset`
  reports them as `asset-in-use`, a forced delete leaves them
  `asset-missing`, and `changeAssetId` moves the bulk entries to the new
  key (`addBulk` then `remove`) and rewrites the overrides (`override`).
  `RefSite` gains `in?: "key"` for a site whose id is the end of the key
  it points at, and `rewriteRefs` renames such a key, joining arrays when
  the new key is there already.
- `changeAssetId` follows a keyed collection's own id field:
  `rewriteRefs(value, sites, from, to, layout?)` matches `@<id>` by the
  layout's `id`. A site that still names the old id after the rewrite
  fails the op with `op-invalid` instead of being written back, and a
  scene or prefab that wouldn't read under the new ids (each rewritten one,
  and every one when a material changed id) fails the batch.
- A project holds at most one game-settings asset: `projectView` (with
  kinds) reports a second as `asset-kind` (so `project show` lists it, the
  dev server warns on load and `project push` refuses it), and
  `createAsset` or `restoreAsset` of a second is refused with `asset-kind`.
- A data-table row id that two assets of one table hold is reported as
  `dup-id` (`detail: { table, first }`): by `project show`, by the dev
  server when it loads the project, and on `checkProjectBatch`'s result
  for every table the batch wrote.
- `projectView` treats two folders that differ only in case as taken:
  the later entry gets `path-taken` and a repair under the first entry's
  spelling, and `createAsset`, `renameAsset`, `moveAsset` and
  `restoreAsset` refuse such a path.
- `registry.primitives` beside a game's registry now carries the project
  materials passed to `createRegistry(game, { materials })` /
  `withProject`, so a scene with no game run under a game keeps its
  project's materials.
- Code skew: a newer build whose stamp was held back while project-doc
  updates waited on missing ones now writes it once they land, even when
  they don't touch the build map.
- Code skew hashes each kind's schema under the game's code alone
  (`buildHashes` in collab/project-session.ts), so a registry carrying the
  project's material assets no longer makes a CLI or tab read-only against
  the dev server.
- The dev server's file adapter judges scenes and other docs by the
  project's material assets (its open material docs, else their files), so
  a scene naming a material asset scans, loads and writes back.
- `reinspectBlobs` re-derives meta after a move, for meta that names paths
  (a font's pages).

### Agent surface

- `AGENT_SURFACE_VERSION` 7: the project ops `createAsset`, `importAsset`,
  `renameAsset`, `moveAsset`, `deleteAsset`, `restoreAsset`,
  `changeAssetId`, `setImport`, `replaceContent`, `setLicence`, `editAsset`
  and `editScene` (`project-ops:v1`; `public-api.json` lists them as
  `projectOpNames`); the issue codes `asset-missing`, `asset-kind`,
  `asset-in-use`, `asset-id-taken`, `path-taken`, `hash-mismatch`,
  `code-skew` (a warning: the doc stays readable, but read-only),
  `asset-too-large`, `import-failed` and `quota-exceeded`, none with a
  scene fix, since project ops and server repairs mend them; the schema ids
  `urn:jams-engine:project:v1`, `asset-sidecar:v1`, `project-ops:v1`,
  `project-snapshot:v1`, `material:v1`, `game-settings:v1` and
  `data-table:v1`, each a schema file in the package exports; every
  published schema carries `x-agent-surface: 7`.
- MCP tools `project_tree`, `asset_import` (dry run by default),
  `asset_refs` and `asset_apply_ops` (dry run by default), in file and live
  mode; every tool takes `project?`, and `scene_schema`'s `which` takes any
  schema name the CLI serves.
- New schema files `./schemas/material.schema.json`
  (`urn:jams-engine:material:v1`), `./schemas/game-settings.schema.json`
  (`urn:jams-engine:game-settings:v1`), `./schemas/data-table.schema.json`
  (`urn:jams-engine:data-table:v1`) and `./schemas/project-ops.schema.json`
  (`urn:jams-engine:project-ops:v1`, built from `projectOpBatchSchema` by
  `projectOpsJsonSchema`).
- New schema file `./schemas/project-snapshot.schema.json`
  (`urn:jams-engine:project-snapshot:v1`, built from
  `projectSnapshotSchema` by `projectSnapshotJsonSchema`).
- `checkProjectBatch` and `applyProjectBatch` accept `editAsset`,
  `editScene` and `changeAssetId`. `deleteAsset` is refused with
  `asset-in-use` while referenced once the whole batch has run, unless
  `force`; so is an `editScene` whose `definePrefab` `null` removes a
  prefab another live asset still names.
- The scene CLI works on projects: every `jams.project.json` under `src/`
  (`discoverProjects`), with `--project <id>` on every command; a scene or
  asset id two projects hold exits 2 until `--project` picks one.
- New CLI commands `project show`, `project tree [--live]`,
  `project refs [id] [--live]` and `project snapshot [--out]`;
  `assets list [--kind] [--trash] [--live]`,
  `assets import <file> [--path] [--id] [--kind] [--settings]`,
  `assets rename <id> [--name] [--file]`, `assets move <id…> --to`,
  `assets delete <id> [--force]`, `assets restore <id>`,
  `assets change-id <id> <new-id>`, `assets set-import <id> --set` and
  `assets apply --ops`. Every `assets` writer takes `--dry-run` (writes
  nothing: no file, cache or upload), `--live [--url]` (the dev server's
  docs, as an agent), `--agent`, `--on-behalf-of`, and on files `--base`
  (the project snapshot hash; stale exits 3).
- `assets import` uploads a binary's bytes first
  (`POST /__project/<id>/blob`, or the dev cache on files), then applies
  `importAsset`.
- `fmt [asset]` formats any doc kind through the kind's format, or every doc
  asset.
- `schema` serves project, asset-sidecar, project-ops, project-snapshot,
  material, game-settings, data-table and any doc kind, and its usage line
  lists fragment and prefab.
- `apply --live` runs on the project client as one `editScene` op, so
  prefab ops write their prefab docs.
- On files, a scene in a project resolves its prefabs through the project's
  registry: every live prefab asset under the project's globs, at its path,
  whatever its file name (`validate`, `list`, `show`, `step`, `apply` and
  the rest). Only a scene file outside every project still reads
  `prefabs/` beside it.
- `apply` on files, in a project, sends the batch as one `editScene` op
  through `applyProjectBatchToFiles`, as `--live` does, writing prefab
  files, sidecars, registry and dev cache the way `assets apply` does. A
  changed prefab goes back to its asset's file and a new one to `prefabs/`
  beside the scene (`prefabPathNear`). A prefab id another asset holds is
  refused with `asset-id-taken`, a path another asset or an unlisted
  file holds with `path-taken`, and a `definePrefab` with `"prefab": null`
  while another live asset still places the prefab with `asset-in-use`
  (and `detail.referrers`): exit 1 with `ok: false`, `failedAt`, `issue`,
  `sceneHash` and `written: false` in the data, nothing written, dry run
  included. That `sceneHash` is the unchanged file's, usable as `--base`
  for a retry. Otherwise a `definePrefab` with `"prefab": null` sends the
  prefab to the trash, where `assets restore` brings it back.
- `new` creates the scene as a `createAsset` op through
  `applyProjectBatchToFiles` and refuses an id or path another asset holds
  (`asset-id-taken` / `path-taken`): exit 1, nothing written, the issue in
  its result's `issue` with `written: false`.
- Hosted projects: every `--live` command (`apply`, `assets list`, the
  `assets` writers, `project tree` and `project refs`) takes a site `--url https://…` (`http://` only on
  localhost, since the token travels with every request) and an agent token
  (`--token`, else `JAMS_AGENT_TOKEN`). The CLI exchanges the token at
  `POST /api/engine/agent-sync-token` for 60 s project sync tokens and
  refreshes them before they expire. Edits carry the token's actor (`g` as
  `agentId`, `o` as `onBehalfOf`). Blobs go through
  `/api/engine/projects/<id>/blobs`. A read-only token can read and dry-run,
  but writes are refused.
- New CLI commands `project pull <project> --url … [--out dir] [--check]`
  (the hosted bundle formatted on the client into files and sidecars; every
  added, changed or removed file is reported; `--check` writes nothing and
  exits 1 on a difference) and `project push <dir> --create --url …`
  (uploads binaries, then seeds the agent token's reserved project from a
  `ProjectBundle`; refused if the project already holds anything;
  `--dry-run` checks the files and reads the hosted project, sending
  nothing).
- MCP: a live tool's `url` may be a hosted site only when the MCP server's
  environment has `JAMS_AGENT_TOKEN` and `JAMS_AGENT_SITE`, the site's
  origin; the token is sent to that origin only, so a tool argument can't
  redirect it, and is never a tool argument itself.

### Internal

- The boundary test keeps `./project` on zod and the project, scene and
  game files, and leaves `HocuspocusProviderWebsocket` (one socket shared by
  a project's docs) to hosts: the site's project session and the scene
  CLI's project client build it, never an engine source file.
- The site's engine route paths live in one dependency-free module
  (`src/lib/engine/route-paths.ts`) that the routes and the scene CLI's
  hosted client both import.
- `services/canvas-sync` copies `src/engine/project` and
  `src/engine/version.ts` into its image and serves the project and asset
  doc kinds beside scenes.

## [0.5.0] — unreleased

Prefabs, groups and attachment: a scene places prefab files as instances
with per-field overrides, groups carry a local origin so moving one is one
edit, and solids and sensors can ride a path follower's body. Every
consumer of world geometry reads one resolved view of the scene.

### Format

- Scene format v2. The v1 → v2 migration declares every group a v1 entity
  names at `[0, 0]`, so nothing moves; v1 files keep loading and are saved
  as v2. Two top-level keys after `settings`: `groups` (`{ [id]: { at,
name? } }`; a member stores its geometry relative to `at`) and
  `instances` (`{ id, prefab, at, overrides?, name?, layer?, group?, off?
}`, one per line). Entities and instances share ids. A prefab is
  `<scenes dir>/prefabs/<id>.json`: `{ kind: "prefab", v, game?, id,
contract?, entities, bulk? }` around a local origin. Override keys are
  `<childId>.<field.path>` (`door.path.speed`, `~solid:0.shape`), values in
  the prefab's frame.
- `attach: "<follower id>"` on `solid` and `sensor` (and types that spread
  their fields): the collider rides that follower's body at its offset from
  the follower's first path point; its shape stays in world px.
- Schema ids follow the format: `urn:jams-engine:scene:v2` and
  `urn:jams-engine:ops:v2` (and their game forms). Checks files and input
  scripts keep their own versions (`checks:v1`, `input-script:v1`).

### Added

- `./scene`: `resolveScene` / `resolveSceneDetailed` (instances inlined as
  `<instance>/<child>`, bulk children as `<instance>/~key:index`, group
  offsets applied, sibling references remapped; where each resolved entity
  came from), `toSourceBatch` (a batch written against the resolved view
  mapped onto the document: a child's edit becomes overrides, a group
  member's geometry loses the group's origin), `childRef`, `parseChildRef`,
  `localChild`, `localChildren`, `groupOrigin`, `instanceOrigin`.
- Prefabs: `parsePrefab`, `prefabSchemaFor`, `prefabJsonSchema`
  (`./schemas/prefab.schema.json`), `formatPrefab`, `prefabLibrary`,
  `prefabOf`, `prefabBody`, `prefabScene`, `sceneBody`, `prefabsUsedBy`,
  `sceneHashWith` (a scene's hash with the prefabs it uses, so a prefab
  edit makes recordings stale), `PREFABS_DIR`; `fragmentJsonSchema`
  (`./schemas/fragment.schema.json`); `placeFragment`, `nextFreeId` and
  `takenIds`, shared by paste and unpack.
- `GameDefinition.prefabContract`: the fields of a prefab's `contract`,
  a zod shape like `settings`; without it a prefab carries none.
- `expandScene`, `validateScene`, `applyOps`, `preparePlay`,
  `runPlaytest`, `fuzz`, `replayRecording`, `runChecks`,
  `validatePhysical` and the SVG and ASCII renders take `prefabs`;
  `GameConfig.prefabs` and `GameInstance.setPrefabs` for the shell.
- The collab doc holds `groups`, `instances` (overrides as a per-key
  `Y.Map`, so concurrent overrides of different fields merge) and
  `prefabs` maps (`groupsMap`, `instancesMap`, `prefabsMap`,
  `contentMaps`, `docPrefabs`); `sceneToDoc` seeds a home's prefabs, the
  dev server writes changed prefabs back to `prefabs/*.json` and syncs
  prefab files changed on disk into every open scene of that home.
- `EditorSession.getResolved()`, `getPrefabs()` and `dispatch(batch, {
resolved: true })`; the tool host picks, draws and edits the resolved
  view, so instance children can be picked and edited as overrides.
- Attachment: `EngineContext.attachments` (`AttachmentHub`),
  `carrierDelta` (the follower motion under any collider on its body),
  `ColliderTag.carrier`; `createRiders` for systems that attach.
- `./vite`: `readPrefabFiles`, `writePrefabFiles`, `prefabsDirOf`,
  `prefabPath`.
- Open prefab: `openPrefabIsolation(session, id)` edits a prefab as a
  scene of its own at its local coordinates (`isolationBounds`), on a
  scratch doc whose every batch lands in the scene's doc as one
  `definePrefab`, so instances follow and the scene's undo covers it;
  undo there steps the scene's history back through its own edits only,
  and changes from anywhere else are diffed in. `EditorSessionOptions.history`
  (`SessionHistory`) lets a session undo and list history elsewhere.
- `scenes/kitchen-sink.json`, with its prefabs `post` and `gate` and
  `kitchen-sink.checks.json`: one gameless scene holding every engine
  primitive, a bulk solid of each shape form, a group, two prefabs with
  overridden instances, and a solid and a sensor attached to a follower,
  with a note per region. Its `touches` check is skipped without a game:
  the engine's own collision groups don't let props touch sensors.

### Changed

- `diffToOps` reorders surviving entities and instances in place
  (`reorder`) instead of removing and adding them, so a live doc keeps
  their keys.
- An attached one-way solid is gated by its collider's collision groups,
  not by moving its body; `castSpawn` and the physical checks skip
  colliders gated that way (queries pass `filterGroups`).
- The platformer's player movement filters by the player's collision
  groups, so a gated attached platform lets it through.
- `follower-hits-solid` also sweeps every solid attached to the follower
  (gated one-way ones too; attached sensors don't count).
- `follower-hits-solid`'s summary says what the sweep covers: "A path
  follower, or a solid riding it, swept along the path, runs into a
  solid."

### Agent surface

- `AGENT_SURFACE_VERSION` 6: the ops `reorder`, `instantiate`, `setGroup`,
  `override`, `revertOverride`, `applyToPrefab`, `unpack`, `createPrefab`
  and `definePrefab`, each with an inverse; the schema ids
  `urn:jams-engine:scene:v2`, `urn:jams-engine:ops:v2`,
  `urn:jams-engine:fragment:v2` and `urn:jams-engine:prefab:v2`; `scene
schema fragment|prefab` and `which: "fragment" | "prefab"` on the MCP
  `scene_schema`. `prefab-unknown` reports an instance whose prefab isn't
  loaded; `unused-override` (now a warning with a fix) one that names no
  child or field; an undeclared group is `dangling-ref` with a fix that
  declares it at `[0, 0]`.

### Internal

- The engine compiles under `noUncheckedIndexedAccess`
  (`src/engine/tsconfig.strict.json`, `vp run engine:typecheck:strict`, and
  the pack's dts build); `services/canvas-sync` turns the flag back on.
- A browser smoke (`vp run engine:smoke:browser`) runs engine-yard for 120
  ticks with `rapier2d-compat` in headless Chromium, Firefox and WebKit and
  compares each digest with the in-process run; CI runs it as
  `engine-browser-smoke`.
- Probes for Rapier's `lengthUnit` (`__tests__/probes/length-unit-probe.ts`,
  and the platformer's): setting it changes the traces, so the engine
  leaves it unset.

## [0.4.0] — unreleased

Run recording and replay: every Play and every headless playtest records
its input edges, the focus trail, the game's markers and a digest of the
end state, in one versioned, game-agnostic format that replays tick for
tick, headless or in the browser.

### Added

- `RunRecording` (`./scene`: `runRecordingSchema`, `parseRecording`,
  `recordingJsonSchema`, `RECORDING_VERSION`; packaged as
  `./schemas/recording.schema.json`): `v`, `engine` (version and physics
  build), `scene`, `sceneHash`, `game`, `configHash`, `tickRate`, `start`
  (Play's `at`, `timeOffsetMs` and game options as asked for), `actions`
  (a name table) and `inputs` (`[tick, actionIndex, pressed]` in step
  order), `ticks`, `outcome`, `markers`, an optional `trail` and `end`, a
  digest of the game's snapshot after the last tick.
- `./headless`: `replayRecording` replays a recording on a scene and says
  whether it `matches` (same result, ticks and end digest), how it
  diverged, and warns, without blocking, when the scene is stale (its hash
  changed), the tuning, engine version or physics build differ;
  `recordingDivergence`, `createRunRecorder`. `PlaytestReport.recording`
  carries every playtest's run.
- `GameInstance.replay(doc, recording)` plays a recording in the browser
  in place of the keyboard and pauses on its last tick;
  `GameInstance.recording()` and the `play:recorded` event give each Play's
  recording, finished at the game's first verdict, a replay's last tick or
  Stop.
- `GamePlayDef.markers`: the event types a recording keeps for the ghost
  (every event when omitted).
- `SceneSystem.seek(ms)`: time-driven systems move on before tick 0.
  Path followers implement it.

### Changed

- `PlayOptions.timeOffsetMs` is honoured: Play, playtests, fuzz and
  replays seek every system by it before tick 0, exactly as stepping that
  long would, and before `at` is cast.
- `ENGINE_RUN_RESULTS` adds `quit`, a browser run stopped before any
  outcome.
- `probeConfigHash` moved into the runtime so the browser shell can stamp
  recordings; `./headless` still exports it.

### Agent surface

- `AGENT_SURFACE_VERSION` 5: the schema id `urn:jams-engine:recording:v1`;
  the run result `quit`; the CLI command `replay <scene> --run <file|->`
  (exit 1 when a replay ends differently), `playtest --record <file>` and
  `schema recording`; the MCP tool `scene_replay` and `which: "recording"`
  on `scene_schema`.

## [0.3.0] — unreleased

Editor tools and the MCP surface: picking, gizmos, snapping, vertex and
path editing, a clipboard and a schema-driven inspector model, all pure
and driven by one tool host; physical validation and `.checks.json`; and an
MCP adapter that edits live docs as a Yjs client.

### Added

- `./editor`, the tool layer:
  - the tool contract (`EditorToolDef`, `EditorToolContext`, `EditorTool`,
    `ToolOverlay`, `defineEditorTool`): a tool gets world-space pointer
    events, commits one batch per gesture through `commit`, previews in the
    edit world through `preview`, and describes what to draw as a
    `ToolOverlay` the host renders;
  - `createToolHost`, which mounts tools as one router consumer at
    `TOOL_PRIORITY.editor`, keeps a spatial index current from the session,
    counts clicks, runs the Escape cascade, and carries the default
    commands (nudge, rotate ±15°, select all, group, hierarchy walk, frame,
    snap toggle, copy, cut, paste, duplicate); the keymap's `sub-object` and
    gesture context come from `host.keyContext()`;
  - built-in tools `select` (click, Shift, Mod, Alt-cycle, marquee and
    Alt-marquee, drag-move with snapping, handles, one AABB gizmo for a
    multi-selection, sub-object point editing with a **Convert to chain**
    offer on a concave commit), `box`, `circle`, `pen`, `waypoints`,
    `rotate` and `pan`;
  - `createGesturePreview` (a drag shows in the runtime through its update
    fast path and never writes the doc);
  - the pure geometry under them: `createSpatialIndex` (a 256px grid of
    AABBs, updated from touched refs), `pickAt`, `cycleHit`,
    `marqueeSelect`, `snapPoint`, `snapMove` (grid, then edges and
    vertices, then centres; the grabbed AABB edge snaps), `snapAngle`,
    and `gizmos` (handles per shape, resize with the opposite edge
    anchored, Alt from the centre, Shift keeping aspect, rotate with a 15°
    snap, vertex insert and delete keeping poly ≥ 3 and chain ≥ 2,
    waypoint editing, readouts, each gesture as one `OpBatch`);
  - `copySelection`, `pasteFragment`, `cutSelection`, `duplicateSelection`
    over a `SceneFragment` (`text/plain` JSON): paste centres under the
    cursor, snaps, regenerates ids, remaps internal references and keeps
    or clears external ones with an issue;
  - `buildInspectorModel`: sections and a widget per field from the type's
    schema (`.meta()` titles and groups, `.describe()` tooltips), mixed
    values for a multi-selection, relative edits (`+=16`), shape
    conversions marked lossless or lossy, and a game's own widgets;
  - `placementEditorTool`, a placement tool as an editor tool (one `add`
    per placement).
- `./game`: `GameDefinition.editor` (`tools`, loaded lazily so editor code
  stays out of a play bundle, and `widgets`, `InspectorWidgetDef`
  descriptors a field names in `meta.widget`), `physicalChecks` and
  `checks` (`.checks.json` kinds); `Registry.widgets`, `physicalChecks` and
  `checkKinds`; `createPlacementTool`, the ghost, rotate and place state
  machine the platformer's Shaper now uses.
- `GameInstance.screenToWorld`, `panBy`, `zoomAt` and `frame` for an
  editor camera.
- `./headless`: `validatePhysical` (the scene in a never-stepped world;
  the engine's `follower-hits-solid` and `solid-overlap`, then the game's
  checks), `physicalEnv` and `runPhysicalChecks` for a world that is
  already loaded, and `runChecks` for `.checks.json`.
- `./scene`: `parseChecks`, `checksSchemaFor` and `checksJsonSchema` (the
  `.checks.json` format, kinds `valid`, `reaches`, `touches` and a game's);
  `SceneFragment` and `parseFragment` (migrates a stale `v`);
  `intersectsRect`, `containedInRect`, `nearestVertex`, `nearestSegment`,
  `shapeVertices`, `closestOnSegment` and `rotateShape`.
- A `resized` scene change: a bulk entry with the same tag and centre and
  a new size.
- `src/engine/__tests__/api-report.txt`, the normalised `.d.mts` API
  report (`vp run engine:api-report --write`); CI fails on an unreviewed
  diff.

### Changed

- **Breaking:** `./editor`'s store type `EditorTool` (`"select"`) is gone;
  `EditorStoreState.tool` is a tool id string, and `EditorTool` now names
  a live tool.
- `diffToOps` turns a moved bulk entry into a `move` op and a resized one
  into an `update`, not a remove and an add.

### Agent surface

- `AGENT_SURFACE_VERSION` 4: issue codes `follower-hits-solid` and
  `solid-overlap`; the schema id `urn:jams-engine:checks:v1` (and
  `urn:jams-engine:checks:<game>:v1`); check kinds `valid`, `reaches` and
  `touches`; the CLI commands `check` and `textconv`, `validate
--physical`, `schema checks` and `--game` on `playtest`, `fuzz` and
  `check`; the MCP tools `scene_apply_ops`, `scene_check`, `scene_codes`,
  `scene_diff`, `scene_fuzz`, `scene_list`, `scene_playtest`,
  `scene_render`, `scene_schema`, `scene_show` and `scene_validate`.
  `public-api.json` now lists `checkKinds` and `mcpTools`.

## [0.2.0] — unreleased

Edit and play: Play builds a fresh world from a frozen copy of the
document and Stop throws it away; the editor gets a full scoped keymap;
and agents get headless playtests, fuzz rollouts and scene renders whose
outcomes come from the game.

### Added

- **Play and Stop** on `GameInstance`: `play(doc, opts?)` parses and
  validates the document (errors block and come back in the `PlayReport`),
  clones it, deep-freezes the clone and its expansion in dev, and builds a
  fresh world; input is flushed and the camera snaps. `stop()` destroys the
  play world, rebuilds the edit world from the scene loaded before Play and
  restores the editor camera exactly. `pause`, `resume`, `step(n)` and
  `setTimeScale` are public. `PlayOptions` (`at`, `timeOffsetMs`, `game`)
  is the same object for Play, `runPlaytest` and `fuzz`. Play from a point
  casts the game's `play.spawnShape` onto the first surface below and is
  refused inside a solid (`reason: "spawn-blocked"`). The store has a
  `session` (`startTick`, the game's first `outcome`), with `selectSession`;
  `play:outcome` is a new event. `command(name)`, `cancel()` and
  `pointerWorld()` let a host drive the game's commands, its Escape and
  "play from here".
- **Play hooks in the game contract** (`GameDefinition.play`): `outcome`
  after every tick (a result ends a playtest; the engine never decides
  one), `results`, `focus`, `movementActions` (for `stuck`), input-script
  `predicates`, a fuzz `macro` generator, `spawnShape` and an `options`
  schema for game-typed play options. `GameDefinition.editorKeys` adds
  game keys to the editor keymap, delivered to `GameAttachment.onCommand`
  (and Escape to `onCancel`). `EngineContext.play` tells a game's `onLoad`
  where a play world starts. `Registry.runResults` and `predicateNames`;
  a game can't reuse an engine result or predicate name.
- `SceneRuntime.load(scene, play?)` builds a play world.
- `./editor`: `createKeymap(gameKeys?)` with scopes `global`, `edit`,
  `play`, `sub-object` and `text-field`, `ENGINE_KEYS`, `keyChord` and
  `normalizeChord`. `Mod+Enter` plays, `Shift+Mod+Enter` plays from the
  cursor, `P` / `.` / `[` `]` pause, step and change time scale in play, F3
  cycles the debug overlay everywhere. A game key that collides with an
  engine key in its scope is reported as shadowed and never wins.
- The tool router takes keys from a key target (`GameConfig.keyTarget`,
  default the window) while pointers stay on the canvas, so editor
  shortcuts work with focus on a panel; consumers opt into keys typed in a
  text field with `editable`. `TOOL_PRIORITY.debug` (300).
- `./headless`: `compileInputScript` (input scripts with `hold`, `press`,
  `wait`, `for`, `forMs` and `until` over the engine's `event` and `tick`
  predicates and the game's, compiled to `[tick, action, pressed]` edges,
  unknown names with "did you mean"); `runPlaytest`, a `PlaytestReport`
  with `sceneHash`, `configHash`, the outcome (the game's result, or
  `timeout`, `script-end` or `stuck`), capped events, the focus trail every
  4 ticks, the steps reached, the final snapshot and the inputs played, or
  a `PlaytestBlocked` naming the stage that stopped it; `fuzz`, seeded
  macro-input rollouts reporting which entities were touched, first-reach
  ticks and "reached in N of M runs", result counts and measured ticks per
  second; `preparePlay`, the start of Play shared by all three.
- `./scene`: `inputScriptSchemaFor` and `inputScriptJsonSchema` (the
  game's actions, predicates and options); `renderSceneSvg`, a pure
  schematic drawn through `shapeOutline` (region or `around` a ref with a
  margin, longest side capped at 1600px, labels, axis ticks, colors from
  each type's style, overlays for issues, a playtest's trail, events and
  outcome, follower paths and markers); `sceneAsciiMap` /
  `renderSceneAscii`, a character map whose legend comes from the types.
  `EntityTypeDef.ascii` sets a type's character.
- `./sim-kit`, a new entry with no dependencies: the seeded `Rng` (sfc32),
  `digest32` and the fixed-point maths, moved from the site's arcade, which
  now imports them from here.
- `./schemas/input-script.schema.json`, the engine's input-script JSON
  Schema, in the tarball.

### Changed

- **Breaking:** `GameDefinition.outcome(events, snapshot)` returning
  `{ status }` is gone; a game puts `outcome(state)` returning
  `{ result, cause?, entityId? } | null` in `play`, and `ProbeReport.outcome`
  is the first verdict with its tick. `PlaytestOutcome` is replaced by
  `GameOutcome`.
- **Breaking:** `./editor`'s `resolveEditorKey` and `EditorKeyContext` are
  replaced by `createKeymap`.
- **Breaking:** `./debug`'s `DebugDeps.inputTarget` is replaced by `router`;
  F3 is a router consumer instead of a `window` listener.
- `./headless` is no longer `@experimental`.

### Agent surface

- `AGENT_SURFACE_VERSION` 3: the schema id `urn:jams-engine:input-script:v1`
  (and `urn:jams-engine:input-script:<game>:v1` per game); the CLI commands
  `playtest`, `fuzz` and `render`, and `schema script`.

## [0.1.0] — unreleased

The first release: a game-agnostic engine that loads scenes from data, scene
format v1, the `SceneOp` command language, a headless runtime, shared scene
documents, and the editor core. It is the four pre-releases below plus the
packaging changes listed here.

**Contains:** the browser shell (`.`), with Rapier injected; the entity type
registry and the game-authoring API (`./game`); scene format v1, with
schema, parse, migrate, format, hash, expand and structural validation with
issue codes (`./scene`); `applyOps` with inverses, the entity diff and
`diffToOps`; the scene and ops JSON Schemas as package files; the headless
runtime and `runProbe` (`./headless`); the shared document (`./collab`); the
debug overlay (`./debug`); the dev sync server (`./vite`); and the editor
core (`./editor`). `./editor`, `./game` and `./headless` are
`@experimental`.

**Doesn't contain:** editor tools or gizmos, play-testing, input scripts,
rendering, the MCP adapter, prefabs, React, or anything game-specific.

### Added

- `README.md`, shipped in the tarball: install, peers, Rapier injection,
  registering entity types, a browser host, headless runs, scenes as data,
  co-editing, and a scene format reference generated from the JSON Schema.

### Changed

- **Breaking:** `GameConfig.rapier` is required. The root entry no longer
  falls back to `import("@dimforge/rapier2d")`, so no entry has a runtime
  reference to Rapier; browser hosts pass `rapier: () =>
import("@dimforge/rapier2d")`.
- `package.json` declares `"sideEffects": false`: no module does anything on
  import, and bundlers drop the barrels and scene tools a host doesn't use
  (4.9 kB of engine code off the site's game route).

### Agent surface

- Unchanged: `AGENT_SURFACE_VERSION` is still 2.

## [0.1.0-dev.4]

Scenes become shared documents: the editor co-edits a `Y.Doc` that any
number of people, agents and the disk write to, and every client converges
on the same canonical text.

### Added

- `./collab`, a new entry (`yjs` and `fractional-indexing` are new peers):
  the doc layout (`entities` keyed by generated keys with a fractional `z`,
  `settings`, `scene`, `meta`, and a capped `log`); `sceneToDoc` and
  `docToScene`, which round-trip every scene file byte for byte;
  `applyOpsToDoc`, which checks a batch as `applyOps` does against the doc as
  it is and writes only the changed fields in one transaction, with a `log`
  entry naming the actor; the origin types (`user`, `agent`, `disk`,
  `migration`); `createSceneUndo`, an undo manager that tracks one client's
  origin, one batch per step, with the selection around each step;
  `revertEntry`; `bindSceneDoc`, which keeps an edit-mode runtime in step once
  per transaction; `watchIssues` and `validateDoc`, validation of the merged
  doc; `migrateDoc`; presence helpers over a structural `AwarenessLike`.
- `SceneRuntime.add`, `update` and `remove`: entity-level edits without a
  rebuild, through a system's `update` fast path when it has one (markers,
  solids, sensors). `GameInstance.runtime()` hands the loaded one to a host.
- `./scene`: `diffToOps(a, b, registry?)`, a batch that turns one scene into
  another; an entity on both sides with the same type is an `update`, so a
  live doc keeps its keys. Also exported now: `migrate`, `MIGRATIONS`,
  `hashText` and `ENGINE_REGISTRY_ID`.
- `./vite`: `sceneCollabServer`, an in-process Hocuspocus at
  `/__scene-collab` serving `scene:<name>` docs from the scene homes, storing
  canonical JSON back, and turning outside edits to a file into one `disk`
  transaction (`@hocuspocus/server` is an optional peer).

### Changed

- `./editor`: `createEditorSession` takes a `Y.Doc` and an origin. Undo and
  redo step only this client's batches; history is the doc's `log`, with
  every actor and `revert(id)`; selection is kept as doc keys so it survives
  other people's edits; presence is published through `awareness`. The store
  gained `history` and `peers`; `lastActor` is a `SceneOrigin`.
- `applyOps` refuses to demote an entity that has no geometry.

### Removed

- `./editor`: `markSaved`, `replaceDoc`, `session.history`, the store's
  `dirty` and `savedAt`, and the `apply` option. `createHistory` stays for
  tools that edit files.
- `./vite`: `sceneDevSink` and its POST write path with the 409; the GET
  endpoints remain.

### Agent surface

- `AGENT_SURFACE_VERSION` is 2. The scene CLI's `apply` gained `--live`,
  `--url`, `--agent` and `--on-behalf-of`: `apply <scene> --live` sends the
  batch to the dev server's shared scene doc as an `agent` client instead of
  writing the file. Exit code 3 (stale base) is for file batches only; a live
  batch that fails its `base` exits 1.

## [0.1.0-dev.3]

The scene format is complete for 0.1: every structural code has a fixture
and, where the repair is mechanical, a fix; old files have a migration path;
the JSON Schemas read as documentation; and the agent surface has its own
version.

### Added

- `./scene`: `AGENT_SURFACE_VERSION` and `AGENT_SURFACE_KEYWORD`;
  `createScene` and `EMPTY_SCENE_TEMPLATE`; `comparePointers`, the document
  order of two JSON Pointers; `undescribedProperties` and
  `untitledEntityFields`, which a game's tests run over its schemas.
- `./game`: `GameDefinition.template` and `SceneTemplate`, what a new scene
  of the game starts with.
- `src/engine/scenes/` holds scenes that name no game; `engine-yard.json`
  moved there from the test fixtures.

### Changed

- `validateScene` orders issues by severity, then engine and game issues
  together by where their `path` falls in the canonical text, instead of
  engine issues before game issues.
- A failed `applyOps` issue always has a `path`, a pointer into the batch
  (`/ops/<i>`, or `/base` for `stale-base`).
- Every entity field carries an inspector `title`: `type` and shape fields
  gained theirs, and `Path` has `title` and `group`.

### Format

- Still `v: 1`. The migration harness walks frozen copies of every
  released version (`scene/__tests__/fixtures/v1/`, and each game's own) to
  the current one, and pins their bytes.
- A game's types are versioned with the scene format: a change to them
  must be additive (new optional fields or types) until a game needs its
  own migrations.

### Agent surface

- Version 1. `codes --json` returns `{ agentSurface, codes }` instead of
  the bare groups; both JSON Schemas carry `x-agent-surface`.
- `poly-invalid` offers the convex hull as its fix where the field can't
  be a chain; `platformer/no-kill-plane` is fixable (adds a hazard along the
  bottom of the bounds).
- Op discriminators and the gravity tuple's items have descriptions.
- CLI: `diff <a> (<b> | --git <rev> | --ops <file>)` and
  `new <name> [--game id] [--from scene]`; `list` reports issue counts per
  scene; scenes without a game resolve from the `engine` home.
- `public-api.json` lists op names, schema ids and every command's flags,
  and a test pins the agent surface's hash to its version.

## [0.1.0-dev.2]

Drawing, input and scene loading go through seams, so `./headless` loads
no Pixi and a game draws without importing it.

### Added

- `./scene`: `shapeOutline`, `shapeIsClosed` and `PathCommand`, the outline
  of every shape (rotated box, circle, rotated capsule as one stadium, poly,
  open chain); `isExpandedScene`.
- `./game`: `drawShape`, which traces, fills and strokes a shape in a
  `Style`; the `SceneView` drawing interface (`draw`, `pose`, `remove` and
  `layer`, an opaque `ViewLayerHandle` for a game that draws its own) with
  `ViewLayer`; `Style`, `styleOf`, `drawEntity`, `bodyLocalShape`, and
  `VisualOptions` (`layer`, `draw: false`) on solid and follower options.
- Static geometry has a production visual: solids and sensors draw in
  their type's style on `terrain`, with the material's style winning; props
  and followers draw on `body` and follow their bodies each step.
- `Style.strokeWidth` and `Style.strokeAlpha`.
- `.`: `createPixiView`, `pixiContainer` and `PixiView`, the Pixi-backed
  scene view; the tool router (`GameInstance.router`, `TOOL_PRIORITY`,
  `ToolConsumer`, `ToolEvent`, `ToolRouter`), which gives each pointer and
  key event to one consumer by priority (play, game tools, editor tools);
  `GameConfig.inputTarget`; `CameraMode` and `SimState`.
- `DebugOverlay.setPhysics` and the `DebugTick` type.
- `CameraState.mode` and `GameStoreState.sim` (`paused`, `timeScale`).

### Changed

- `GameInstance.loadScene` and `GameConfig.scene` accept a
  `SceneDefinition` as well as an `ExpandedScene`, and expand it through
  the game's registry. A definition that fails to expand is a failed
  `LoadReport`, and the current scene keeps running.
- `SceneView` is a drawing interface instead of `{ world: Container }`:
  `GameShell.view` is a `SceneView`, and `GameShell.router` replaces
  `GameShell.target`.
- Input comes from `inputTarget`, by default the canvas, which gets
  `tabIndex = 0` when it has none and is focused on start and on
  `setMode("play")`, instead of from `window`. Keys reach the game only
  while it has focus, pointer positions are canvas-local, and a key press
  in a text field reaches no consumer. Held keys are released when the
  target loses focus or the tab is hidden.
- The debug overlay rebinds to each loaded runtime instead of holding the
  first world, and `DebugOverlay.update` takes a `DebugTick`; a custom
  overlay factory must implement `setPhysics`.
- Each load sets the camera's bounds from the scene's bounds plus a 100px
  margin and snaps to the game's camera target, so a load doesn't pan in.
- The loop pauses while the tab is hidden and resumes without a catch-up
  burst.
- The physics wireframes draw every collider shape with its rotation, not
  only cuboids.

### Removed

- `addToLayer` from `./game`; layers belong to the Pixi view.

## [0.1.0-dev.1]

The engine no longer knows any game. The platformer moved to
`src/games/platformer` and is the first game built on the extension points.

### Added

- `@jams/engine/game` (experimental): `defineGame`, `defineEntityType`,
  `createRegistry` and `RegistryError`; field builders (`shapeField`,
  `bodyShapeField`, `pointField`, `materialField`, `tagsField`, `PathSchema`,
  `primitiveFields`); and the system-authoring API: `EngineContext`,
  `SceneSystem`, `ColliderTag(s)`, collider and body builders, and the
  primitive system factories (`createSolidSystem`, `createSensorSystem`,
  `createPropSystem`, `createMarkerSystem`, `createFollowerSystem`) with
  option bags, so a game composes them instead of re-implementing them.
- Engine primitives: `solid` (with `material` and `oneWay`), `sensor` (with
  `tags`), `marker`, `prop`, `follower` (a kinematic path follower) and
  `note`.
- A game supplies entity types, spawn order, actions and bindings,
  materials, collision groups, settings fields, issue codes, validators and
  per-runtime hooks (`onLoad`, `beforeStep`, `afterStep`, `snapshot`,
  `cameraTarget`, `storeSlice`, `debugInfo`), plus `attach` for play-mode
  tools in the browser shell.
- Sensors raise `sensor:enter` and `sensor:exit` with `other`, the entity
  that entered or left.
- `GameConfig.game` (required), `GameConfig.registry`,
  `GameConfig.debugLayers` and `GameInstance.registry`; `selectGame`.
- The debug overlay takes game layers; F3 cycles the engine's grid and
  physics layers, then the game's.

### Changed

- The package moved from `src/game` to `src/engine`.
- `StepResult` is `{ tick, events, game }`: `game` is the game's snapshot,
  in place of `player`. `RuntimeStats.perType` replaces `perBehavior` and
  `fields`. `SceneRuntimeHandle` has `ctx`, `game` and `scene()`.
- World gravity comes from the scene's `settings.gravity`.
- Parse, expand, validate, `applyOps` and the editor session take a
  registry. `formatScene`, `sceneHash` and `diffScenes` don't need one.

### Removed

- `DEFAULT_BINDINGS`, `PlayerInfo`, `selectPlayer`, `selectPlayerPosition`,
  `selectPlayers`, `DEBUG_MODES`, and every platformer type, system,
  material and constant (the player, grapple, Shaper, constructs, wind and
  bounce pads, clouds, movers).

### Format

- Still `v: 1` (unreleased): the entity discriminator is `type` (was `b`);
  a scene names its game with a top-level `game` key and gets a `settings`
  block; bulk keys come from registered types. M1 files are rewritten in
  place, with no migration.

### Agent surface

- Issue codes: added `unknown-type` and `unknown-game`; `spawn-missing`,
  `spawn-overlap`, `wind-rotation`, `no-goal` and `no-kill-plane` left the
  engine and are now the platformer's `platformer/<code>`. Game codes are
  always `<game-id>/<code>`.
- Ops: removed `setSpawn` and `removeSpawn` (spawns are entities or bulk
  entries of a game's type); added `setSettings`. `SceneChange` names
  `type`, not `behavior`.
- JSON Schemas are per registry: `urn:jams-engine:scene:v1` for the
  engine's primitives, `urn:jams-engine:scene:<game>:v1` for a game, which
  commits its own `scene.schema.json`.
- `./headless`: `runProbe` and `createHeadlessRuntime` take `game` and
  `registry`; `ProbeReport.final` is the game's snapshot, `landings` is
  gone, and `probeConfigHash(game)` replaces `CONFIG_HASH`.

## [0.1.0-dev.0]

### Added

- `@jams/engine` as a package rooted at `src/game`, with six entries: `.`,
  `./scene`, `./editor` (experimental), `./headless`, `./debug` and `./vite`,
  built by `vp run engine:pack`.
- Scenes as data: `createGame({ scene })`, `GameInstance.loadScene`,
  `unloadScene`, `setMode("edit" | "play")` and `selectMode`.
- `SceneRuntime` with load, unload, per-entity lookup and `step`, whose
  events name entities by id.
- `./headless`: `createHeadlessRuntime` and `runProbe`, DOM-free.
- `./editor`: `createEditorSession` with `OpBatch` undo history, selection,
  the outline model, the keymap resolver and the editor store.
- `./vite`: `sceneDevSink({ dir })`, the dev-server endpoints under
  `/__scene`, and `resolveScenePath`, the name and path guard tools share.
- `ENGINE_VERSION`.

### Changed

- Rapier is injected through `GameConfig.rapier`; the default loader stays
  until 0.1.
- `GameConfig.dev` replaces `import.meta.env.DEV` inside the engine, and
  the debug overlay is injected through `GameConfig.debug`, so a production
  host that leaves it out doesn't bundle it.
- Collider tags, force fields and every former module-level registry are
  per runtime, so two games or a game and a headless runtime can coexist.
- The level is no longer hardcoded in `physics.ts` and `engine.ts`; it is
  `src/game/scenes/test-yard.json`. The spawn is the player's feet.
- Wind force follows the zone's rotation instead of mirroring it.
- Poly colliders accept either winding; the player passes through sensors
  instead of standing on them.
- Each system draws into a fixed layer of the scene view (`DRAW_LAYERS`),
  so draw order no longer depends on spawn order.
- Game input ignores key presses in edit mode, in text fields and with
  Ctrl, Cmd or Alt held, so it no longer swallows editor shortcuts.

### Format

- Scene format `v: 1` introduced: `SceneDefinition`, its Zod schema
  `SceneV1`, `parseScene`, `formatScene` (canonical text), `sceneHash`,
  `expandScene` and `validateScene`.

### Agent surface

- Issue codes: every code in `ISSUE_CODE_LIST`, with severities, summaries
  and hints in `ISSUE_CODES`.
- Ops: `add`, `addBulk`, `update`, `move`, `place`, `remove`, `rename`,
  `promote`, `demote`, `setSpawn`, `removeSpawn`, `setScene`, applied by
  `applyOps` with inverses and an entity diff.
- JSON Schemas `urn:jams-engine:scene:v1` and `urn:jams-engine:ops:v1`,
  shipped as `schemas/scene.schema.json` and `schemas/ops.schema.json`.
- CLI (`vp run scene`, site-side): `list`, `show`, `schema`, `codes`,
  `validate`, `fmt`, `apply`, `step`, with `--json` and exit codes 0 ok,
  1 errors, 2 usage, 3 stale base. Reports name the scene hash
  `sceneHash`; probe reports also carry `configHash`.
- `ApplyResult.remap`: where each start-of-batch ref went (shifted bulk
  index, promotion, demotion, rename), or `null` when removed.
- Op failures map entity and batch schema errors like `parseScene` does:
  a JSON Pointer `path` under `/ops/<i>`, `expected`, `got`, and a
  did-you-mean for keys and behaviors.
- `./scene` exports `closest`; `./headless` exports `PROBE_ACTIONS`,
  `unknownActionError` and `CONFIG_HASH`, and `runProbe` throws on an
  unknown action.
- `POST /__scene/:name` takes `?base=<hash>` and answers 409 when the file
  changed since; writes need `application/json` and a same-origin caller.
