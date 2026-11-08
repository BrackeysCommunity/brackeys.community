# Changelog

All notable changes to `@jams/engine`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package
uses its own semver: on 0.x a breaking change bumps the minor. Besides the
usual sections, **Format** records scene format (`v`) changes and **Agent
surface** records issue codes, ops, JSON Schemas and CLI commands, all of
which are public contract.

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
  doc still names (`asset-in-use`), and repairs duplicate ids and paths; it
  writes the code map and this build's schema stamps.
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
  it, dry run or not, and writes nothing; the dev server warns once and
  leaves the entry unwritten until its path frees. `storeProject` trashes
  and stages moves before it creates, so a new entry can take a path the
  same write frees.
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
  batch, here or in another scene, deleting the referrer, or defining the
  prefab again in a later `editScene`, still works, and a reference
  another op of the batch adds is refused before anything is written. In
  the editor, the scene's own prefab writer judges a removal against the
  docs the browser holds open; a reference in a scene it hasn't opened is
  caught by the dev server on store, which reads every scene that can
  name it (open or not, from its persisted state or file) and restores the
  prefab.
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
