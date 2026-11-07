# Changelog

All notable changes to `@jams/engine`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package
uses its own semver: on 0.x a breaking change bumps the minor. Besides the
usual sections, **Format** records scene format (`v`) changes and **Agent
surface** records issue codes, ops, JSON Schemas and CLI commands, all of
which are public contract.

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
