# @jams/engine/collab

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`ASSETS_KEY`](#assets_key) · [`ASSET_CHANGED`](#asset_changed) · [`AssetChange`](#assetchange) · [`AssetChangedMessage`](#assetchangedmessage) · [`AwarenessLike`](#awarenesslike) · [`BEHAVIORS_FIELD`](#behaviors_field) · [`BULK_FIELD`](#bulk_field) · [`BindOptions`](#bindoptions) · [`BindableRuntime`](#bindableruntime) · [`COLLAB_LAYOUT_VERSION`](#collab_layout_version) · [`CONTENT_KEY_PREFIX`](#content_key_prefix) · [`CONTENT_MAP`](#content_map) · [`CodeSkewIssue`](#codeskewissue) · [`DOC_MAPS`](#doc_maps) · [`DocApplyOptions`](#docapplyoptions) · [`DocApplyResult`](#docapplyresult) · [`DocLayoutMigration`](#doclayoutmigration) · [`DocOrigin`](#docorigin) · [`DocView`](#docview) · [`EMPTY_PREFAB_SOURCE`](#empty_prefab_source) · [`ENTITIES_BUCKET`](#entities_bucket) · [`ENTRY_NESTED_FIELDS`](#entry_nested_fields) · [`EntityRecord`](#entityrecord) · [`GRID_ROW_KEY`](#grid_row_key) · [`GROUP_KEY_PREFIX`](#group_key_prefix) · [`HistoryRow`](#historyrow) · [`INSTANCE_KEY_PREFIX`](#instance_key_prefix) · [`IssueProject`](#issueproject) · [`IssueWatch`](#issuewatch) · [`KEYED_ITEM`](#keyed_item) · [`KEYED_Z`](#keyed_z) · [`KeyGen`](#keygen) · [`LEGACY_BULK_FIELD`](#legacy_bulk_field) · [`LEGACY_Z_FIELD`](#legacy_z_field) · [`LOG_ARRAY`](#log_array) · [`LOG_CAP`](#log_cap) · [`LayoutMigration`](#layoutmigration) · [`LayoutWriteOptions`](#layoutwriteoptions) · [`LogEntry`](#logentry) · [`LogWarning`](#logwarning) · [`MemoryDocClient`](#memorydocclient) · [`MemoryDocHost`](#memorydochost) · [`MigrateDocOptions`](#migratedocoptions) · [`NESTED2_FIELDS`](#nested2_fields) · [`NESTED_FIELDS`](#nested_fields) · [`NO_PREFAB_WRITER`](#no_prefab_writer) · [`OVERRIDES_FIELD`](#overrides_field) · [`OpenDoc`](#opendoc) · [`OpenedDoc`](#openeddoc) · [`PARAMS_FIELD`](#params_field) · [`PARAM_KEY_PREFIX`](#param_key_prefix) · [`PATH_FIELD`](#path_field) · [`PREFAB_HEADER_KEY`](#prefab_header_key) · [`PREFAB_KEY_PREFIX`](#prefab_key_prefix) · [`PRESENCE_FIELD`](#presence_field) · [`PROJECT_LAYOUT_VERSION`](#project_layout_version) · [`PROJECT_MAPS`](#project_maps) · [`PROJECT_PRESENCE_FIELD`](#project_presence_field) · [`PeerPresence`](#peerpresence) · [`PrefabChange`](#prefabchange) · [`PrefabDocHeader`](#prefabdocheader) · [`PrefabDocPlan`](#prefabdocplan) · [`PrefabDocWrite`](#prefabdocwrite) · [`PrefabDocWriter`](#prefabdocwriter) · [`PrefabPatchOptions`](#prefabpatchoptions) · [`PrefabPlan`](#prefabplan) · [`PrefabSource`](#prefabsource) · [`PrefabToDocOptions`](#prefabtodocoptions) · [`PrefabWriteRequest`](#prefabwriterequest) · [`PrefabWriter`](#prefabwriter) · [`ProjectApplyOptions`](#projectapplyoptions) · [`ProjectDocWriterOptions`](#projectdocwriteroptions) · [`ProjectLogEntry`](#projectlogentry) · [`ProjectLogInput`](#projectloginput) · [`ProjectPeer`](#projectpeer) · [`ProjectPresence`](#projectpresence) · [`ProjectRevertResult`](#projectrevertresult) · [`ProjectSession`](#projectsession) · [`ProjectSessionEvent`](#projectsessionevent) · [`ProjectSessionOptions`](#projectsessionoptions) · [`ProjectWriter`](#projectwriter) · [`ReadDocOptions`](#readdocoptions) · [`RegistryApplyOptions`](#registryapplyoptions) · [`RegistryApplyResult`](#registryapplyresult) · [`ReinspectResult`](#reinspectresult) · [`RepairResult`](#repairresult) · [`RevertOptions`](#revertoptions) · [`RevertResult`](#revertresult) · [`SCENE_KEY`](#scene_key) · [`SCENE_ONLY_OPS`](#scene_only_ops) · [`SEED_STALE_CODE`](#seed_stale_code) · [`SEED_STALE_REASON`](#seed_stale_reason) · [`SETTINGS_KEY`](#settings_key) · [`SceneBinding`](#scenebinding) · [`SceneDocMeta`](#scenedocmeta) · [`SceneOrigin`](#sceneorigin) · [`ScenePresence`](#scenepresence) · [`SceneToDocOptions`](#scenetodocoptions) · [`SceneUndo`](#sceneundo) · [`SelectionMeta`](#selectionmeta) · [`SessionDoc`](#sessiondoc) · [`SessionPrefabSource`](#sessionprefabsource) · [`SessionPrefabSourceOptions`](#sessionprefabsourceoptions) · [`StepSelection`](#stepselection) · [`UNDO_CAP`](#undo_cap) · [`UndoCoordinator`](#undocoordinator) · [`UndoneStep`](#undonestep) · [`VARIANT_KEY`](#variant_key) · [`WatchIssuesOptions`](#watchissuesoptions) · [`Z_FIELD`](#z_field) · [`actorId`](#actorid) · [`actorLabel`](#actorlabel) · [`appendHistory`](#appendhistory) · [`appendProjectLog`](#appendprojectlog) · [`applyEntityDiff`](#applyentitydiff) · [`applyOpsToDoc`](#applyopstodoc) · [`applyProjectBatch`](#applyprojectbatch) · [`applyRegistryBatch`](#applyregistrybatch) · [`applyRepairs`](#applyrepairs) · [`assetsMap`](#assetsmap) · [`assignZ`](#assignz) · [`bindSceneDoc`](#bindscenedoc) · [`bucketOf`](#bucketof) · [`buildAtFrom`](#buildatfrom) · [`bulkRecord`](#bulkrecord) · [`compareZ`](#comparez) · [`contentLogKey`](#contentlogkey) · [`contentMap`](#contentmap) · [`contentMaps`](#contentmaps) · [`createProjectSession`](#createprojectsession) · [`createSceneUndo`](#createsceneundo) · [`createUndoCoordinator`](#createundocoordinator) · [`docLayout`](#doclayout) · [`docMeta`](#docmeta) · [`docPrefabs`](#docprefabs) · [`docToPrefab`](#doctoprefab) · [`docToScene`](#doctoscene) · [`entitiesMap`](#entitiesmap) · [`entityRecord`](#entityrecord-1) · [`expandLenient`](#expandlenient) · [`fieldLayout`](#fieldlayout) · [`fingerprint`](#fingerprint) · [`gridRowKey`](#gridrowkey) · [`groupsMap`](#groupsmap) · [`headerOf`](#headerof) · [`historyRows`](#historyrows) · [`instanceRecord`](#instancerecord) · [`instancesMap`](#instancesmap) · [`isLayoutKey`](#islayoutkey) · [`isPrefabDoc`](#isprefabdoc) · [`isSeedStaleClose`](#isseedstaleclose) · [`layoutFromDoc`](#layoutfromdoc) · [`layoutPatch`](#layoutpatch) · [`layoutToDoc`](#layouttodoc) · [`localPrefabSource`](#localprefabsource) · [`memoryDocHost`](#memorydochost-1) · [`metaMap`](#metamap) · [`migrateDoc`](#migratedoc) · [`migrateDocLayout`](#migratedoclayout) · [`migrateLayout`](#migratelayout) · [`observeLog`](#observelog) · [`observePeers`](#observepeers) · [`observeProjectLog`](#observeprojectlog) · [`observeProjectPeers`](#observeprojectpeers) · [`paramsMap`](#paramsmap) · [`patchGroup`](#patchgroup) · [`patchMap`](#patchmap) · [`patchRecord`](#patchrecord) · [`peers`](#peers) · [`prefabHeaderMap`](#prefabheadermap) · [`prefabOverridesMap`](#prefaboverridesmap) · [`prefabPatch`](#prefabpatch) · [`prefabPathNear`](#prefabpathnear) · [`prefabSceneBounds`](#prefabscenebounds) · [`prefabToDoc`](#prefabtodoc) · [`prefabsMap`](#prefabsmap) · [`projectAssetsMap`](#projectassetsmap) · [`projectBuildMap`](#projectbuildmap) · [`projectCodeMap`](#projectcodemap) · [`projectDocWriter`](#projectdocwriter) · [`projectHistoryMap`](#projecthistorymap) · [`projectLogFor`](#projectlogfor) · [`projectMetaMap`](#projectmetamap) · [`projectPeers`](#projectpeers) · [`projectPeersByDoc`](#projectpeersbydoc) · [`randomKey`](#randomkey) · [`readAssets`](#readassets) · [`readDoc`](#readdoc) · [`readEntry`](#readentry) · [`readLog`](#readlog) · [`readProject`](#readproject) · [`readProjectLog`](#readprojectlog) · [`recordFields`](#recordfields) · [`recordMap`](#recordmap) · [`recordOf`](#recordof) · [`refsOfView`](#refsofview) · [`reinspectBlobs`](#reinspectblobs) · [`revertEntry`](#revertentry) · [`revertOpenProjectEntry`](#revertopenprojectentry) · [`revertProblem`](#revertproblem) · [`revertProjectEntry`](#revertprojectentry) · [`sceneMap`](#scenemap) · [`sceneToDoc`](#scenetodoc) · [`seedProjectDoc`](#seedprojectdoc) · [`selectionsByKey`](#selectionsbykey) · [`sequentialKeys`](#sequentialkeys) · [`sessionPrefabSource`](#sessionprefabsource-1) · [`setPresence`](#setpresence) · [`setProjectPresence`](#setprojectpresence) · [`settingsMap`](#settingsmap) · [`stableJson`](#stablejson) · [`stampWins`](#stampwins) · [`staticPrefabSource`](#staticprefabsource) · [`validateDoc`](#validatedoc) · [`watchIssues`](#watchissues) · [`writeAssets`](#writeassets) · [`writeEntry`](#writeentry) · [`writeProjectState`](#writeprojectstate)

## `ASSETS_KEY`

_const_ in `collab/types.ts`

Log key for the `assets` map.

```ts
declare const ASSETS_KEY = "@assets";
```

## `ASSET_CHANGED`

_const_ in `collab/asset-changed.ts`

The stateless message type the server sends on a project doc when a binary's bytes change.

```ts
declare const ASSET_CHANGED = "asset:changed";
```

## `AssetChange`

_type_ in `collab/asset-changed.ts`

A binary asset whose bytes changed: what the dev server broadcasts as `asset:changed` for hot reload.

```ts
type AssetChange = {
    bytes: number;
    id: AssetId;
    key: AssetKey;
    kind: AssetKindName;
    path: AssetPath;
    /** The hash it held before. */
    previous: Sha256 | null;
    sha256: Sha256;
};
```

## `AssetChangedMessage`

_type_ in `collab/asset-changed.ts`

What an `asset:changed` stateless message holds, as JSON: hot reload refetches `sha256`.

```ts
type AssetChangedMessage = AssetChange & {
    project: ProjectId;
    type: typeof ASSET_CHANGED;
};
```

Refers to [`ASSET_CHANGED`](#asset_changed), [`AssetChange`](#assetchange).

## `AwarenessLike`

_type_ in `collab/types.ts`

The part of a y-protocols `Awareness` the presence helpers use, typed
structurally so the engine never imports a provider package.

```ts
type AwarenessLike = {
    clientID: number;
    getLocalState(): Record<string, unknown> | null;
    getStates(): Map<number, Record<string, unknown>>;
    off(event: "change", cb: (...args: unknown[]) => void): void;
    on(event: "change", cb: (...args: unknown[]) => void): void;
    setLocalStateField(field: string, value: unknown): void;
};
```

## `BEHAVIORS_FIELD`

_const_ in `game/behaviors.ts`

The reserved entity key that holds behavior blocks.

```ts
declare const BEHAVIORS_FIELD = "behaviors";
```

## `BULK_FIELD`

_const_ in `collab/types.ts`

Set on bulk entries only: the bulk key whose array the entry is written to.

```ts
declare const BULK_FIELD = "@bulk";
```

## `BindOptions`

_type_ in `collab/bind.ts`

```ts
type BindOptions = {
    /** After every transaction that changed the scene, with the new definition. */
    onChange?: (def: SceneDefinition, tr: Y.Transaction) => void;
    /** When some entries couldn't be expanded and were left out. */
    onSkipped?: (errors: string[]) => void;
    /** For a prefab doc: the scene size its view centres on (`readDoc`'s `parentBounds`). */
    parentBounds?: Bounds;
    /** Where instances' prefabs come from; default none. */
    prefabs?: PrefabSource;
};
```

Refers to [`PrefabSource`](#prefabsource).

## `BindableRuntime`

_type_ in `collab/bind.ts`

The part of a `SceneRuntime` a binding drives.

```ts
type BindableRuntime = {
    add(entities: RuntimeEntity[]): {
        ok: boolean;
    };
    load(scene: ExpandedScene): {
        ok: boolean;
    };
    remove(ids: string[]): void;
    update(entities: RuntimeEntity[]): {
        ok: boolean;
    };
};
```

## `COLLAB_LAYOUT_VERSION`

_const_ in `version.ts`

The doc layout this engine writes, stored as `meta.layout`. A doc with no
`meta.layout` is layout 1, and so is a sync token with no `l` claim.
Layout 2 moved prefabs out of the scene doc into docs of their own;
layout 3 renamed the record keys to `@z` and `@bulk` and added the
`assets` map, nested behaviors and params, grid rows and the prefab doc's
`params`, `overrides` and `instances`.

```ts
declare const COLLAB_LAYOUT_VERSION = 3;
```

## `CONTENT_KEY_PREFIX`

_const_ in `collab/revert.ts`

Log keys of a declarative doc's top-level content fields: `@content:<field>`.

```ts
declare const CONTENT_KEY_PREFIX = "@content:";
```

## `CONTENT_MAP`

_const_ in `collab/layout.ts`

Declarative kinds' docs: a value laid out by its kind's `DocLayout` under
`doc.getMap("content")`.

```
atomic   the value itself                        last writer wins
text     Y.Text                                  merges by character
map      Y.Map, one entry per key                keys merge independently
list     Y.Array of items                        inserts merge; an edited item is replaced whole
keyed    Y.Map key → Y.Map { @z, item }          items and their fields merge; order is (@z, key)
```

A value that doesn't fit its slot's layout (a number where `text` is
declared) is held as an atomic value, so every value round-trips and the
schema reports it.

```ts
declare const CONTENT_MAP = "content";
```

## `CodeSkewIssue`

_type_ in `collab/project-session.ts`

`code-skew`, with the two schema hashes that differ.

```ts
type CodeSkewIssue = SceneIssue & {
    code: "code-skew";
    detail: {
        kind: AssetKindName;
        mine: Sha256;
        project: Sha256;
    };
};
```

## `DOC_MAPS`

_const_ in `collab/types.ts`

```ts
declare const DOC_MAPS: {
    /** The `assets` header, AssetId → true. */
    readonly assets: "assets";
    readonly entities: "entities";
    readonly groups: "groups";
    readonly instances: "instances";
    readonly meta: "meta";
    /** A prefab doc's variant overrides, override path → value. */
    readonly overrides: "overrides";
    /** A prefab doc's exposed parameters, name → PrefabParam. */
    readonly params: "params";
    /** A prefab doc's header: id, base and contract. */
    readonly prefab: "prefab";
    /** Layout 1 only: the scene's prefabs, one atomic value each; `migrateLayout` moves them to prefab docs. */
    readonly prefabs: "prefabs";
    readonly scene: "scene";
    readonly settings: "settings";
};
```

## `DocApplyOptions`

_type_ in `collab/apply.ts`

```ts
type DocApplyOptions = ApplyOptions & {
    key?: KeyGen;
    /** The history label; defaults to the batch's own. */
    label?: string;
    /** Leave the batch out of the doc's `log`. */
    noLog?: boolean;
    /** For a prefab doc: the scene size its view centres on (`readDoc`'s `parentBounds`). */
    parentBounds?: Bounds;
    /** Writes prefab docs; without one, the ops that read or write prefabs are refused. */
    prefabWriter?: PrefabDocWriter;
};
```

Refers to [`KeyGen`](#keygen), [`PrefabDocWriter`](#prefabdocwriter).

## `DocApplyResult`

_type_ in `collab/apply.ts`

What a batch did to the doc, in keys as well as refs.

```ts
type DocApplyResult = (Extract<ApplyResult, {
    ok: true;
}> & {
    /** The prefab docs the batch wrote through `prefabWriter`, in write order. */
    docs: PrefabDocWrite[];
    /** Keys of every entry the batch added, changed or removed. */
    keys: string[];
    /** The key behind each ref of the new document the batch touched or created. */
    refKeys: Record<Ref, string>;
}) | Extract<ApplyResult, {
    ok: false;
}>;
```

Refers to [`PrefabDocWrite`](#prefabdocwrite).

## `DocLayoutMigration`

_type_ in `collab/migrate-layout.ts`

```ts
type DocLayoutMigration = {
    from: number;
    /** False when the doc wasn't seeded or was already at this engine's layout. */
    migrated: boolean;
    to: number;
};
```

## `DocOrigin`

_type_ in `collab/types.ts`

Who made a transaction. Yjs origins never leave the client, so the doc's
`log` records the actor for everyone else. Undo tracks one origin object
by identity: create it once per client and pass the same object to every
write. `repair` is the project's one writer (the dev server or the hosted
service) fixing paths, ids, hashes or quota.

```ts
type DocOrigin = {
    agentId: string;
    kind: "agent";
    onBehalfOf?: string;
} | {
    kind: "disk";
} | {
    kind: "migration";
} | {
    kind: "repair";
    reason: string;
} | {
    kind: "user";
    name?: string;
    userId: string;
};
```

## `DocView`

_type_ in `collab/convert.ts`

A doc read as a scene, with the key behind each entry.

```ts
type DocView = {
    /** The keys of each bulk array's entries, in order. */
    bulkKeys: Map<BulkKey, string[]>;
    def: SceneDefinition;
    /** The key of each of `def.entities`, in order. */
    entityKeys: string[];
    /** The key of each of `def.instances`, in order. */
    instanceKeys: string[];
    instanceRecords: Map<string, EntityRecord>;
    /** "prefab" for a prefab doc, read as a scene of its children: its name is the prefab's id, its bounds synthesised. */
    kind: "prefab" | "scene";
    /** A prefab doc's header, parameters and variant overrides; its instances and assets are in `def`. */
    prefab?: PrefabDocHeader;
    records: Map<string, EntityRecord>;
};
```

Refers to [`EntityRecord`](#entityrecord), [`PrefabDocHeader`](#prefabdocheader).

## `EMPTY_PREFAB_SOURCE`

_const_ in `collab/prefab-source.ts`

What a source with no prefabs reads: the default wherever a source is optional.

```ts
declare const EMPTY_PREFAB_SOURCE: PrefabSource;
```

Refers to [`PrefabSource`](#prefabsource).

## `ENTITIES_BUCKET`

_const_ in `collab/convert.ts`

The bucket a named entity is written to.

```ts
declare const ENTITIES_BUCKET = "entities";
```

## `ENTRY_NESTED_FIELDS`

_const_ in `collab/project-doc.ts`

Entry fields held as nested `Y.Map`s, patched key by key.

```ts
declare const ENTRY_NESTED_FIELDS: readonly [
    "import",
    "licence"
];
```

## `EntityRecord`

_type_ in `collab/types.ts`

A record as plain JSON: its `Y.Map` with nested maps as plain objects and
grid rows gathered back into their grid fields. `@z` always; `@bulk`,
`type` and one geometry field for a bulk entry; otherwise the entity's or
instance's on-disk fields.

```ts
type EntityRecord = {
    [BULK_FIELD]?: BulkKey;
    [Z_FIELD]: string;
    [field: string]: unknown;
    type?: string;
};
```

## `GRID_ROW_KEY`

_const_ in `collab/types.ts`

`<field>@<cx>,<cy>/<row>`: one grid row in its entity's map.

```ts
declare const GRID_ROW_KEY: RegExp;
```

## `GROUP_KEY_PREFIX`

_const_ in `collab/types.ts`

```ts
declare const GROUP_KEY_PREFIX = "@group:";
```

## `HistoryRow`

_type_ in `collab/project-log.ts`

A history row: one of the doc's own entries, marked when it was part of a batch that wrote other docs too.

```ts
type HistoryRow = LogEntry & {
    /** The project entry this row belongs to: its id and every doc the batch wrote. */
    project?: {
        docs: string[];
        entry: string;
    };
};
```

Refers to [`LogEntry`](#logentry).

## `INSTANCE_KEY_PREFIX`

_const_ in `collab/types.ts`

Log keys for the other maps: `@instance:<key>`, `@group:<id>`, `@prefab:<id>`.

```ts
declare const INSTANCE_KEY_PREFIX = "@instance:";
```

## `IssueProject`

_type_ in `collab/watch-issues.ts`

The project a doc belongs to, as validation reads it: a `ProjectSession`
fits. A change to `projectDoc`'s registry (an asset added, renamed or
trashed) revalidates. The project's engine block is the view's `engine`,
else the game-settings doc's while `get` has it open; an `anim` block's
animation source is read from its doc while `get` has it open. An edit to
either doc, or one opening or closing (`subscribe`), revalidates.

```ts
type IssueProject = {
    docNameFor?(entry: AssetEntry): null | string;
    get?(name: string): undefined | {
        readonly doc: Y.Doc;
        readonly layout?: DocLayout;
    };
    /** The kinds its docs are read with; default the game's. */
    readonly kinds?: KindRegistry;
    readonly projectDoc?: Y.Doc;
    subscribe?(listener: (e: ProjectSessionEvent) => void): () => void;
    view(): ProjectView;
};
```

Refers to [`ProjectSessionEvent`](#projectsessionevent).

## `IssueWatch`

_type_ in `collab/watch-issues.ts`

```ts
type IssueWatch = {
    /** Validates now, skipping the wait. */
    flush(): SceneIssue[];
    stop(): void;
};
```

## `KEYED_ITEM`

_const_ in `collab/layout.ts`

A keyed entry's item, laid out by the collection's `item` layout.

```ts
declare const KEYED_ITEM = "item";
```

## `KEYED_Z`

_const_ in `collab/layout.ts`

A keyed entry's fractional order key; layout 2 named it `z`.

```ts
declare const KEYED_Z = "@z";
```

## `KeyGen`

_type_ in `collab/keys.ts`

Makes a new entity key. Keys are generated, never names, so two creates with one name stay two entities.

```ts
type KeyGen = () => string;
```

## `LEGACY_BULK_FIELD`

_const_ in `collab/types.ts`

```ts
declare const LEGACY_BULK_FIELD = "bulk";
```

## `LEGACY_Z_FIELD`

_const_ in `collab/types.ts`

The layout-2 names of the layout's own record keys, which `migrateLayout` reads.

```ts
declare const LEGACY_Z_FIELD = "z";
```

## `LOG_ARRAY`

_const_ in `collab/types.ts`

```ts
declare const LOG_ARRAY = "log";
```

## `LOG_CAP`

_const_ in `collab/log.ts`

How many entries the doc keeps; the oldest go first.

```ts
declare const LOG_CAP = 200;
```

## `LayoutMigration`

_type_ in `collab/migrate-layout.ts`

```ts
type LayoutMigration = {
    /** Prefabs that became assets of their own. */
    created: AssetId[];
    /** Prefabs the project already held with another body: the project's doc was kept, a `prefab-diverged` warning logged. */
    diverged: AssetId[];
    /** The scene doc's log entry for the migration. */
    entry?: LogEntry;
    from: number;
    /** Prefabs the project already held with the same body. */
    kept: AssetId[];
    /** False when the doc wasn't seeded or was already at this engine's layout. */
    migrated: boolean;
    to: number;
};
```

Refers to [`LogEntry`](#logentry).

## `LayoutWriteOptions`

_type_ in `collab/layout.ts`

```ts
type LayoutWriteOptions = {
    /** Keys for new `keyed` items; default `randomKey`. */
    key?: KeyGen;
};
```

Refers to [`KeyGen`](#keygen).

## `LogEntry`

_type_ in `collab/types.ts`

One batch, as every client's history shows it. `before` holds each touched
key's state before the batch (`null`: it didn't exist) and `after` a
fingerprint of its state after (`null`: removed), so Revert can restore
`before` once it has checked nothing changed since. An entry too large to
keep whole drops both and can't be reverted.

```ts
type LogEntry = {
    actor: DocOrigin;
    after?: Record<string, null | string>;
    /** ms since the epoch, the writer's clock. */
    at: number;
    before?: Record<string, unknown>;
    id: string;
    keys: string[];
    /** `undo`, `redo` or `revert` when the entry records one of those rather than a batch. */
    kind?: "batch" | "redo" | "revert" | "undo";
    label: string;
    ops?: SceneOp["op"][];
    /** What a migration left as it was, and why. Notes, never issue codes. */
    warnings?: LogWarning[];
};
```

Refers to [`DocOrigin`](#docorigin), [`LogWarning`](#logwarning).

## `LogWarning`

_type_ in `collab/types.ts`

A note on a log entry, such as `prefab-diverged` from a layout migration.

```ts
type LogWarning = {
    code: string;
    ids?: string[];
    message: string;
};
```

## `MemoryDocClient`

_type_ in `collab/project-session.ts`

```ts
type MemoryDocClient = {
    openDoc: OpenDoc;
    /** Every name this client has opened, in order, once per open. */
    readonly opened: readonly string[];
    /** Offline holds this client's updates both ways; back online exchanges state as a reconnect does. */
    setOnline(online: boolean): void;
};
```

Refers to [`OpenDoc`](#opendoc).

## `MemoryDocHost`

_type_ in `collab/project-session.ts`

```ts
type MemoryDocHost = {
    /** A new client, with its own copy of each doc it opens. */
    client(): MemoryDocClient;
    /** The host's copy of a doc, created empty: seed it before clients open it. */
    doc(name: string): Y.Doc;
};
```

Refers to [`MemoryDocClient`](#memorydocclient).

## `MigrateDocOptions`

_type_ in `collab/migrate.ts`

```ts
type MigrateDocOptions = {
    /** The game's registry and the project's prefabs, for steps that need them. */
    env?: MigrateEnv;
    key?: KeyGen;
    migrations?: Readonly<Record<number, Migration>>;
    /** The format version to lift to; default the engine's. */
    target?: number;
};
```

Refers to [`KeyGen`](#keygen).

## `NESTED2_FIELDS`

_const_ in `collab/types.ts`

Fields held as two levels of nested `Y.Map`: behavior name → field → value, each field atomic.

```ts
declare const NESTED2_FIELDS: readonly string[];
```

## `NESTED_FIELDS`

_const_ in `collab/types.ts`

Fields held as a nested `Y.Map`, patched key by key.

```ts
declare const NESTED_FIELDS: readonly string[];
```

## `NO_PREFAB_WRITER`

_const_ in `collab/project-session.ts`

The writer a session starts with: it refuses every prefab write. The
first `sessionPrefabSource` over the session replaces it with one that
writes the project's prefab docs.

```ts
declare const NO_PREFAB_WRITER: PrefabWriter;
```

Refers to [`PrefabWriter`](#prefabwriter).

## `OVERRIDES_FIELD`

_const_ in `collab/types.ts`

On instances: a nested `Y.Map` of override key → value, so concurrent overrides of different fields merge.

```ts
declare const OVERRIDES_FIELD = "overrides";
```

## `OpenDoc`

_type_ in `collab/project-session.ts`

Opens a doc by name (`project:…`, `scene:…`, `asset:…`); resolves once it holds the server's state.

```ts
type OpenDoc = (name: string) => Promise<OpenedDoc>;
```

Refers to [`OpenedDoc`](#openeddoc).

## `OpenedDoc`

_type_ in `collab/project-session.ts`

One doc as the host's provider hands it over: synced, with its awareness, and how to let it go.

```ts
type OpenedDoc = {
    awareness: AwarenessLike;
    close(): void;
    doc: Y.Doc;
};
```

Refers to [`AwarenessLike`](#awarenesslike).

## `PARAMS_FIELD`

_const_ in `collab/types.ts`

On instances: the exposed parameters' values, a nested `Y.Map` of name → value.

```ts
declare const PARAMS_FIELD = "params";
```

## `PARAM_KEY_PREFIX`

_const_ in `collab/types.ts`

Log keys for a prefab doc's parameters: `@param:<name>`.

```ts
declare const PARAM_KEY_PREFIX = "@param:";
```

## `PATH_FIELD`

_const_ in `collab/types.ts`

Every other key of a record's `Y.Map` is one of its own fields. `shape`,
`at` and anything array- or object-valued is one atomic value (last
writer wins), except the nested fields below and grid fields, whose rows
are keys of their own (`GRID_ROW_KEY`).

```ts
declare const PATH_FIELD = "path";
```

## `PREFAB_HEADER_KEY`

_const_ in `collab/prefab-doc.ts`

The log key a change to a prefab doc's header (`id`, `contract`) is recorded under.

```ts
declare const PREFAB_HEADER_KEY = "@header";
```

## `PREFAB_KEY_PREFIX`

_const_ in `collab/types.ts`

```ts
declare const PREFAB_KEY_PREFIX = "@prefab:";
```

## `PRESENCE_FIELD`

_const_ in `collab/types.ts`

The awareness field presence is published under.

```ts
declare const PRESENCE_FIELD = "scene";
```

## `PROJECT_LAYOUT_VERSION`

_const_ in `collab/project-doc.ts`

The project doc layout this engine writes, stored as `meta.layout`; a doc with none is layout 1.

```ts
declare const PROJECT_LAYOUT_VERSION = 1;
```

## `PROJECT_MAPS`

_const_ in `collab/project-doc.ts`

```ts
declare const PROJECT_MAPS: {
    readonly assets: "assets";
    readonly build: "build";
    readonly code: "code";
    readonly history: "history";
    readonly meta: "meta";
};
```

## `PROJECT_PRESENCE_FIELD`

_const_ in `collab/types.ts`

The awareness field project presence is published under.

```ts
declare const PROJECT_PRESENCE_FIELD = "project";
```

## `PeerPresence`

_type_ in `collab/presence.ts`

```ts
type PeerPresence = ScenePresence & {
    clientId: number;
};
```

Refers to [`ScenePresence`](#scenepresence).

## `PrefabChange`

_type_ in `collab/apply.ts`

The prefab library a batch read, the one it leaves, and the ids that differ.

```ts
type PrefabChange = {
    changed: readonly string[];
    next: PrefabLibrary;
    prev: PrefabLibrary;
};
```

## `PrefabDocHeader`

_type_ in `collab/convert.ts`

What a prefab doc holds besides its children.

```ts
type PrefabDocHeader = {
    base?: string;
    contract?: unknown;
    id: string;
    overrides?: Record<OverridePath, unknown>;
    params?: Record<string, PrefabParam>;
};
```

## `PrefabDocPlan`

_type_ in `collab/apply.ts`

```ts
type PrefabDocPlan = {
    issue: SceneIssue;
    ok: false;
} | {
    ok: true;
    /** Writes each changed prefab's doc (and the registry, for a new or removed prefab), one transaction each. */
    write(origin: DocOrigin, ctx: {
        label: string;
        scene: LogEntry | null;
    }): PrefabDocWrite[];
};
```

Refers to [`DocOrigin`](#docorigin), [`LogEntry`](#logentry), [`PrefabDocWrite`](#prefabdocwrite).

## `PrefabDocWrite`

_type_ in `collab/apply.ts`

One doc a batch wrote besides its own, with that doc's log entry id.

```ts
type PrefabDocWrite = {
    doc: string;
    entry: string;
};
```

## `PrefabDocWriter`

_type_ in `collab/apply.ts`

Writes the prefab docs a scene batch changes (`definePrefab`,
`createPrefab`, `applyToPrefab`): what a project's prefab source
supplies. `plan` checks everything before the scene is written.

```ts
type PrefabDocWriter = {
    plan(change: PrefabChange): PrefabDocPlan;
};
```

Refers to [`PrefabChange`](#prefabchange), [`PrefabDocPlan`](#prefabdocplan).

## `PrefabPatchOptions`

_type_ in `collab/prefab-doc.ts`

```ts
type PrefabPatchOptions = {
    key?: KeyGen;
    /** The history label; default "Edit prefab <id>". */
    label?: string;
    /** Leave the change out of the doc's `log`. */
    noLog?: boolean;
};
```

Refers to [`KeyGen`](#keygen).

## `PrefabPlan`

_type_ in `collab/project-session.ts`

A planned prefab write, checked against plain JSON before anything is
written. `write` runs while the batch writes its docs, one transaction
per doc, and returns each doc it wrote with that doc's own log entry id.
`release` lets go of the docs the plan opened, once the batch is done.

```ts
type PrefabPlan = {
    docs: readonly string[];
    ok: true;
    release?(): void;
    write(origin: DocOrigin): {
        doc: string;
        entry: string;
    }[];
} | {
    issue: SceneIssue;
    ok: false;
};
```

Refers to [`DocOrigin`](#docorigin).

## `PrefabSource`

_type_ in `collab/prefab-source.ts`

Where a scene's prefabs come from: the project's prefab docs, or a
library read from files. Everything that resolves instances reads it.

```ts
type PrefabSource = {
    /** Every live prefab the project holds, by id; docs not yet loaded come from their last snapshot or are absent. */
    library(): PrefabLibrary;
    /** The prefab's doc, loading it if needed; null when there is none to open. */
    open(id: AssetId): Promise<Y.Doc | null>;
    /** Fires after any prefab doc or the registry changes, once per transaction. */
    subscribe(cb: (changed: readonly AssetId[]) => void): () => void;
    /** Writes prefab docs for a scene's batches; a read-only source has none. */
    writer?: PrefabDocWriter;
};
```

Refers to [`PrefabDocWriter`](#prefabdocwriter).

## `PrefabToDocOptions`

_type_ in `collab/prefab-doc.ts`

```ts
type PrefabToDocOptions = {
    assetKey?: string;
    /** Fill this doc instead of a new one; it must be empty. */
    doc?: Y.Doc;
    key?: KeyGen;
    /** The transaction origin of the seeding write. */
    origin?: unknown;
    /** Written to `meta`: the project and registry key the doc belongs to. */
    project?: string;
};
```

Refers to [`KeyGen`](#keygen).

## `PrefabWriteRequest`

_type_ in `collab/project-session.ts`

What a prefab writer is asked to plan: an `editScene` that targets a prefab or holds a prefab op.

```ts
type PrefabWriteRequest = {
    entry: AssetEntry;
    /** The op's index in its batch. */
    index: number;
    op: EditSceneOp;
    session: ProjectSession;
};
```

Refers to [`ProjectSession`](#projectsession).

## `PrefabWriter`

_type_ in `collab/project-session.ts`

Writes the prefab docs a batch's `editScene` ops change; the session's slot for it.

```ts
type PrefabWriter = {
    plan(request: PrefabWriteRequest): Promise<PrefabPlan>;
};
```

Refers to [`PrefabPlan`](#prefabplan), [`PrefabWriteRequest`](#prefabwriterequest).

## `ProjectApplyOptions`

_type_ in `collab/project-apply.ts`

```ts
type ProjectApplyOptions = {
    /** The history label; default the batch's own, else one made from its ops. */
    label?: string;
    /** The selection around the step, restored when it is undone or redone. */
    selection?: StepSelection;
};
```

Refers to [`StepSelection`](#stepselection).

## `ProjectDocWriterOptions`

_type_ in `collab/migrate-layout.ts`

```ts
type ProjectDocWriterOptions = {
    key?: KeyGen;
    now?: () => number;
    /** The doc a prefab's content lives in, by key; null when the host can't hand it over. */
    prefabDoc(key: AssetKey): Y.Doc | null;
    /** The scene's registry key. */
    scene: AssetKey;
};
```

Refers to [`KeyGen`](#keygen).

## `ProjectLogEntry`

_type_ in `collab/types.ts`

One batch that wrote two or more docs, in the project doc's log: each doc keeps its own entry too.

```ts
type ProjectLogEntry = {
    actor: DocOrigin;
    at: number;
    /** Each doc's own log entry id for this batch, in write order. */
    docs: {
        doc: string;
        entry: string;
    }[];
    id: string;
    label: string;
};
```

Refers to [`DocOrigin`](#docorigin).

## `ProjectLogInput`

_type_ in `collab/project-log.ts`

```ts
type ProjectLogInput = Omit<ProjectLogEntry, "at" | "id"> & {
    at?: number;
    /** Chosen beforehand when the docs the batch writes later must name it. */
    id?: string;
};
```

Refers to [`ProjectLogEntry`](#projectlogentry).

## `ProjectPeer`

_type_ in `collab/project-presence.ts`

```ts
type ProjectPeer = ProjectPresence & {
    clientId: number;
};
```

Refers to [`ProjectPresence`](#projectpresence).

## `ProjectPresence`

_type_ in `collab/types.ts`

What each client publishes through the project doc's awareness: where it is, not what it selects.

```ts
type ProjectPresence = {
    /** The doc this client is looking at, or null on the project overview. */
    doc: null | string;
    mode: "edit" | "play";
    user: {
        color: string;
        id: string;
        name: string;
    };
};
```

## `ProjectRevertResult`

_type_ in `collab/revert.ts`

```ts
type ProjectRevertResult = {
    /** The docs written, in write order. */
    docs: string[];
    /** The new project entry, when the revert wrote two or more docs. */
    entry?: ProjectLogEntry;
    keys: string[];
    ok: true;
} | {
    issue: SceneIssue;
    ok: false;
};
```

Refers to [`ProjectLogEntry`](#projectlogentry).

## `ProjectSession`

_type_ in `collab/project-session.ts`

```ts
type ProjectSession = {
    canRedo(): boolean;
    canUndo(): boolean;
    /** Ends one undo step; see `UndoCoordinator.commit`. */
    commit(step: {
        docs: string[];
        label: string;
        selection?: StepSelection;
    }): void;
    /** Closes every doc and drops the undo stacks. */
    destroy(): void;
    /** The doc a registry entry's content lives in; null for blob and code kinds. */
    docNameFor(entry: AssetEntry): null | string;
    /** An open doc, or undefined. */
    get(name: string): SessionDoc | undefined;
    now(): number;
    /** Opens a doc, or holds an open one once more; each `open` wants one `release`. */
    open(name: string): Promise<SessionDoc>;
    /** The open docs' names, the project doc first. */
    openDocs(): readonly string[];
    peekRedo(): UndoneStep | null;
    /** The step `undo` would take now, without taking it, so a host can go to its docs first. */
    peekUndo(): UndoneStep | null;
    /** Docs with steps on the undo stacks: they stay open while the session lives. */
    pinned(): readonly string[];
    /** The prefabs a batch's instances resolve against; empty until a `sessionPrefabSource` fills the slot. */
    prefabLibrary: () => PrefabLibrary;
    /** Writes prefab docs for `editScene`; replace it to give the session prefab docs. */
    prefabWriter: PrefabWriter;
    readonly awareness: AwarenessLike;
    readonly buildAt: number;
    readonly coordinator: UndoCoordinator;
    /** This build's per-kind schema hashes. */
    readonly hashes: Readonly<Record<AssetKindName, Sha256>>;
    readonly key: KeyGen;
    readonly kinds: KindRegistry;
    /** The project doc's name. */
    readonly name: string;
    readonly origin: DocOrigin;
    readonly project: ProjectId;
    readonly projectDoc: Y.Doc;
    readonly registry: Registry;
    readonly store?: ContentStore;
    redo(): UndoneStep | null;
    redoLabel(): string | undefined;
    /** Lets go of one `open`; the doc closes when nothing holds it and no undo step names it. */
    release(name: string): void;
    /** Every open doc this build may only read. */
    skew(): readonly CodeSkewIssue[];
    /** The `code-skew` a write to a doc of `kind` meets now, or null when this build may write it. */
    skewFor(kind: AssetKindName): CodeSkewIssue | null;
    state(): ProjectState;
    subscribe(listener: (e: ProjectSessionEvent) => void): () => void;
    /** Undoes this client's last step wherever it was; the step names its docs, so a host can say where. */
    undo(): UndoneStep | null;
    undoLabel(): string | undefined;
    view(): ProjectView;
};
```

Refers to [`AwarenessLike`](#awarenesslike), [`CodeSkewIssue`](#codeskewissue), [`DocOrigin`](#docorigin), [`KeyGen`](#keygen), [`PrefabWriter`](#prefabwriter), [`ProjectSessionEvent`](#projectsessionevent), [`SessionDoc`](#sessiondoc), [`StepSelection`](#stepselection), [`UndoCoordinator`](#undocoordinator), [`UndoneStep`](#undonestep).

## `ProjectSessionEvent`

_type_ in `collab/project-session.ts`

```ts
type ProjectSessionEvent = {
    doc: string;
    issue?: CodeSkewIssue;
    readOnly: boolean;
    type: "access";
} | {
    doc: string;
    type: "close" | "open";
} | /** The undo stacks changed. */ {
    type: "history";
};
```

Refers to [`CodeSkewIssue`](#codeskewissue).

## `ProjectSessionOptions`

_type_ in `collab/project-session.ts`

```ts
type ProjectSessionOptions = {
    /** When this build was made, ms since the epoch; the newest build's schema stamps win. Default 0. */
    buildAt?: number;
    /** Undo steps kept; default `UNDO_CAP`. */
    cap?: number;
    /** Registry keys and doc item keys for new things; default `randomKey`. */
    key?: KeyGen;
    kinds: KindRegistry;
    /** The clock batches stamp; default `Date.now`. */
    now?: () => number;
    /** The host's provider; the engine never opens a connection itself. */
    openDoc: OpenDoc;
    /** This client's origin. Undo tracks this object: pass the same one to every write. */
    origin: DocOrigin;
    /** Writes prefab docs; default `NO_PREFAB_WRITER` until a `sessionPrefabSource` fills the slot. */
    prefabWriter?: PrefabWriter;
    project: ProjectId;
    registry: Registry;
    /** Where blob ops' bytes are read for inspection. */
    store?: ContentStore;
};
```

Refers to [`DocOrigin`](#docorigin), [`KeyGen`](#keygen), [`OpenDoc`](#opendoc), [`PrefabWriter`](#prefabwriter).

## `ProjectWriter`

_type_ in `collab/migrate-layout.ts`

What a layout migration needs of the project the scene belongs to.

```ts
type ProjectWriter = {
    /** Adds a prefab entry (key = id where free, else `suffixedId(id, n)`) at `path` and seeds its doc with `prefab`, with `origin`. */
    createPrefab(input: {
        id: AssetId;
        path: AssetPath;
        prefab: Prefab;
    }, origin: DocOrigin): void;
    /**
     * The live asset with `id`, or null when the project has none; `body` is
     * its prefab doc's body, null for another kind or a prefab whose doc
     * can't be read.
     */
    prefab(id: AssetId): null | {
        body: Prefab | null;
        entry: AssetEntry;
    };
    /** The scene's path in the project: new prefabs go under its folder's `prefabs/`. */
    scenePath: AssetPath;
};
```

Refers to [`DocOrigin`](#docorigin).

## `ReadDocOptions`

_type_ in `collab/convert.ts`

```ts
type ReadDocOptions = {
    /** For a prefab doc: the scene size its bounds centre on the origin; default the empty scene's. */
    parentBounds?: Bounds;
    /** For a prefab doc, with `registry`: the prefabs its nested instances name, so the bounds hold their children too. */
    prefabs?: PrefabLibrary;
    /** For a prefab doc: measures its children, so the synthesised bounds hold them all. */
    registry?: Registry;
};
```

## `RegistryApplyOptions`

_type_ in `collab/project-apply.ts`

```ts
type RegistryApplyOptions = Pick<ProjectBatchEnv, "inspect" | "kinds" | "registry"> & Partial<Pick<ProjectBatchEnv, "by" | "newKey" | "now">> & {
    /** The other docs this batch wrote, each with its own log entry id, listed after the project doc. */
    alsoWrote?: readonly {
        doc: string;
        entry: string;
    }[];
    /** Current values of the doc assets the batch names, by id. */
    docs?: ReadonlyMap<AssetId, unknown>;
    /** The history label; default the batch's own, else one made from its ops. */
    label?: string;
};
```

## `RegistryApplyResult`

_type_ in `collab/project-apply.ts`

```ts
type RegistryApplyResult = (Extract<ProjectApplyResult, {
    ok: true;
}> & {
    /** What the check left: the doc values and keys a caller writing the asset docs needs. */
    check: Extract<ProjectBatchCheck, {
        ok: true;
    }>;
}) | Extract<ProjectApplyResult, {
    ok: false;
}>;
```

## `ReinspectResult`

_type_ in `collab/project-apply.ts`

```ts
type ReinspectResult = {
    entry?: ProjectLogEntry;
    /** The keys whose meta or filled settings were rewritten. */
    reinspected: AssetKey[];
    wrote: boolean;
};
```

Refers to [`ProjectLogEntry`](#projectlogentry).

## `RepairResult`

_type_ in `collab/project-apply.ts`

```ts
type RepairResult = {
    entry?: ProjectLogEntry;
    /** The fixes written: key → the new id and/or path. */
    repaired: ReadonlyMap<AssetKey, {
        id?: AssetId;
        path?: AssetPath;
    }>;
    /** The trashed keys brought back. */
    restored: AssetKey[];
    /** Whether anything was written. */
    wrote: boolean;
};
```

Refers to [`ProjectLogEntry`](#projectlogentry).

## `RevertOptions`

_type_ in `collab/revert.ts`

```ts
type RevertOptions = {
    /** A declarative kind's layout, for the `@content:` keys of an asset doc's entries. */
    layout?: DocLayout;
};
```

## `RevertResult`

_type_ in `collab/revert.ts`

```ts
type RevertResult = {
    issue: SceneIssue;
    ok: false;
} | {
    keys: string[];
    ok: true;
};
```

## `SCENE_KEY`

_const_ in `collab/types.ts`

```ts
declare const SCENE_KEY = "@scene";
```

## `SCENE_ONLY_OPS`

_const_ in `collab/apply.ts`

Ops that only mean something in a scene, so a prefab doc refuses them.
Instances nest, so a prefab doc takes the instance ops; defining or
creating prefabs stays with scenes.

```ts
declare const SCENE_ONLY_OPS: readonly SceneOp["op"][];
```

## `SEED_STALE_CODE`

_const_ in `collab/seed-identity.ts`

The close code a server refuses a client from another seed with.

```ts
declare const SEED_STALE_CODE = 4409;
```

## `SEED_STALE_REASON`

_const_ in `collab/seed-identity.ts`

Its close reason, as a doc's close message carries it (the per-doc close loses the code).

```ts
declare const SEED_STALE_REASON = "4409 seed-stale";
```

## `SETTINGS_KEY`

_const_ in `collab/types.ts`

Pseudo-keys a log entry uses for the two non-entity maps it can touch.

```ts
declare const SETTINGS_KEY = "@settings";
```

## `SceneBinding`

_type_ in `collab/bind.ts`

```ts
type SceneBinding = {
    destroy(): void;
    /** Reloads the runtime from the doc. */
    reload(): void;
    /** The expansion the runtime holds now. */
    scene(): ExpandedScene;
    /**
     * While paused the runtime is left alone (Play runs on its own snapshot);
     * `onChange` still fires. Resuming reloads it from the doc as it is then.
     */
    setPaused(paused: boolean): void;
};
```

## `SceneDocMeta`

_type_ in `collab/types.ts`

`meta`: what a doc was seeded with. Only the server writes it.

```ts
type SceneDocMeta = {
    $schema?: string;
    game?: string;
    key?: string;
    /** "prefab" on a prefab doc; absent on a scene doc. */
    kind?: string;
    /** The collab layout it was seeded with; absent on a layout-1 doc. */
    layout?: number;
    /** The project and registry key the doc belongs to, when its seeder knew them. */
    project?: string;
    /** The scene format `v` the doc holds, after any migration at load. */
    schemaVersion: number;
};
```

## `SceneOrigin`

_type_ in `collab/types.ts`

```ts
type SceneOrigin = DocOrigin;
```

Refers to [`DocOrigin`](#docorigin).

## `ScenePresence`

_type_ in `collab/types.ts`

What each client publishes through awareness. None of it is in the doc.
Selection names entity keys, which stay put while bulk refs shift.

```ts
type ScenePresence = {
    /** World coordinates. */
    cursor?: Pt;
    /** A drag in progress: the keys being dragged and the offset so far. */
    ghost?: {
        by: Pt;
        keys: string[];
    };
    mode: "edit" | "play";
    selection: string[];
    tool?: string;
    user: {
        color: string;
        id: string;
        name: string;
    };
};
```

## `SceneToDocOptions`

_type_ in `collab/convert.ts`

```ts
type SceneToDocOptions = {
    assetKey?: string;
    /** Fill this doc instead of a new one; it must be empty. */
    doc?: Y.Doc;
    key?: KeyGen;
    /** The transaction origin of the seeding write. */
    origin?: unknown;
    /** Written to `meta`: the project and registry key the doc belongs to. */
    project?: string;
};
```

Refers to [`KeyGen`](#keygen).

## `SceneUndo`

_type_ in `collab/undo.ts`

```ts
type SceneUndo = {
    canRedo(): boolean;
    canUndo(): boolean;
    /**
     * Marks the end of one batch, recording the selection around it. Call after
     * every write from this client's origin, so one batch is one step.
     */
    commit(selection: SelectionMeta): void;
    destroy(): void;
    manager: Y.UndoManager;
    redo(): SelectionMeta | null;
    redoLabel(): string | undefined;
    /** Undoes this client's last batch; returns the selection to restore, or null when there's nothing to undo. */
    undo(): SelectionMeta | null;
    /** The label of the step undo or redo would take next. */
    undoLabel(): string | undefined;
};
```

Refers to [`SelectionMeta`](#selectionmeta).

## `SelectionMeta`

_type_ in `collab/undo.ts`

The selection before and after a step, kept on its stack item so undo and redo restore it.

```ts
type SelectionMeta = {
    after: string[];
    before: string[];
    label?: string;
};
```

## `SessionDoc`

_type_ in `collab/project-session.ts`

A doc the session holds open. `readOnly` and `issue` follow the project's build stamps.

```ts
type SessionDoc = {
    readonly awareness: AwarenessLike;
    readonly doc: Y.Doc;
    readonly issue?: CodeSkewIssue;
    /** The registry key behind the doc; null for the project doc. */
    readonly key: AssetKey | null;
    /** The asset kind; null for the project doc or a key the registry doesn't hold. */
    readonly kind: AssetKindName | null;
    /** A declarative kind's layout; absent for the project doc, scenes and prefabs. */
    readonly layout?: DocLayout;
    readonly name: string;
    /** This build's schema for the kind differs from a newer build's: the doc may be read, not written. */
    readonly readOnly: boolean;
};
```

Refers to [`AwarenessLike`](#awarenesslike), [`CodeSkewIssue`](#codeskewissue).

## `SessionPrefabSource`

_type_ in `collab/prefab-source.ts`

A prefab source over a project session's prefab docs.

```ts
type SessionPrefabSource = PrefabSource & {
    /** Stops this source's listeners; the docs stay with the session. */
    destroy(): void;
    /** The prefab's doc name in the session, or null when the project holds no such prefab. */
    docName(id: AssetId): null | string;
    readonly session: ProjectSession;
    /** Resolves once every live prefab's doc is open. */
    ready(): Promise<void>;
    writer: PrefabDocWriter;
};
```

Refers to [`PrefabDocWriter`](#prefabdocwriter), [`PrefabSource`](#prefabsource), [`ProjectSession`](#projectsession).

## `SessionPrefabSourceOptions`

_type_ in `collab/prefab-source.ts`

```ts
type SessionPrefabSourceOptions = {
    /** The scene the source's writer works for: new prefabs go under its folder's `prefabs/`. */
    scene?: AssetId;
};
```

## `StepSelection`

_type_ in `collab/undo-coordinator.ts`

A step's selection and the doc it belongs to, restored when the step is undone or redone.

```ts
type StepSelection = SelectionMeta & {
    doc: string;
};
```

Refers to [`SelectionMeta`](#selectionmeta).

## `UNDO_CAP`

_const_ in `collab/undo-coordinator.ts`

```ts
declare const UNDO_CAP = 100;
```

## `UndoCoordinator`

_type_ in `collab/undo-coordinator.ts`

```ts
type UndoCoordinator = {
    /** Registers a doc this client writes to; its Y.UndoManager tracks this client's origin only. */
    attach(docName: string, doc: Y.Doc): void;
    canRedo(): boolean;
    canUndo(): boolean;
    /**
     * Ends one step; `docs` are the docs the step wrote, in write order,
     * `label` names it. An attached doc written since the last commit but not
     * named joins the step after the named ones; a commit that wrote nothing
     * adds no step.
     */
    commit(step: {
        docs: string[];
        label: string;
        selection?: StepSelection;
    }): void;
    destroy(): void;
    /** Drops the doc's manager and its part of every step; a step left with no docs goes. */
    detach(docName: string): void;
    /** The step `redo` would take now; null when writes since the last commit would clear the redo stack. */
    peekRedo(): UndoneStep | null;
    /** The step `undo` would take now, without taking it: writes since the last commit first, as one "Edit" step. */
    peekUndo(): UndoneStep | null;
    /** Docs with steps on either stack: the session keeps them connected. */
    pinned(): readonly string[];
    redo(): UndoneStep | null;
    redoLabel(): string | undefined;
    /**
     * Marks every step on either stack that wrote `docName`: one that later
     * finds nothing left to change is answered as refused with `reason`
     * instead of being skipped for the step below it.
     */
    refuseStale(docName: string, reason: string): void;
    /** Undoes this client's last step in every doc it wrote, newest doc first. */
    undo(): UndoneStep | null;
    undoLabel(): string | undefined;
};
```

Refers to [`StepSelection`](#stepselection), [`UndoneStep`](#undonestep).

## `UndoneStep`

_type_ in `collab/undo-coordinator.ts`

```ts
type UndoneStep = {
    /** The docs the step changed, in write order. */
    docs: string[];
    label: string;
    /** Why nothing was undone or redone: the step's changes are gone for good (it leaves the stack). */
    refused?: string;
    selection?: StepSelection;
};
```

Refers to [`StepSelection`](#stepselection).

## `VARIANT_KEY`

_const_ in `collab/types.ts`

Log key for a prefab doc's variant base and overrides.

```ts
declare const VARIANT_KEY = "@variant";
```

## `WatchIssuesOptions`

_type_ in `collab/watch-issues.ts`

```ts
type WatchIssuesOptions = {
    clearTimer?: (handle: unknown) => void;
    /** Default 150ms. */
    debounceMs?: number;
    /** For a prefab doc: the scene size its view centres on (`readDoc`'s `parentBounds`). */
    parentBounds?: Bounds;
    /** Where instances' prefabs come from; a change to one the doc reaches (`prefabsReachedBy`) revalidates. Default none. */
    prefabs?: PrefabSource;
    /** With it, asset ids the doc names are checked against the project (`asset-missing`, `asset-kind`) and `anim` blocks against their sources, and settings resolve through its engine block. */
    project?: IssueProject;
    setTimer?: (fn: () => void, ms: number) => unknown;
};
```

Refers to [`IssueProject`](#issueproject), [`PrefabSource`](#prefabsource).

## `Z_FIELD`

_const_ in `collab/types.ts`

A record's fractional order among its siblings.

```ts
declare const Z_FIELD = "@z";
```

## `actorId`

_function_ in `collab/project-apply.ts`

Who a `created` or `deleted` stamp names.

```ts
declare function actorId(origin: DocOrigin): string;
```

Refers to [`DocOrigin`](#docorigin).

## `actorLabel`

_function_ in `collab/types.ts`

The actor as a history row names it.

```ts
declare function actorLabel(origin: DocOrigin): string;
```

Refers to [`DocOrigin`](#docorigin).

## `appendHistory`

_function_ in `collab/project-doc.ts`

Appends to an asset's hash history, creating the array when the asset has none.

```ts
declare function appendHistory(doc: Y.Doc, key: AssetKey, items: readonly HashHistoryEntry[], origin?: unknown): void;
```

## `appendProjectLog`

_function_ in `collab/project-log.ts`

Appends an entry to the project doc's log and trims it to `LOG_CAP`, as
`appendLog` does for a doc's own. Call inside the batch's transaction on
the project doc, so the write carries the batch's origin.

```ts
declare function appendProjectLog(doc: Y.Doc, input: ProjectLogInput): ProjectLogEntry;
```

Refers to [`ProjectLogEntry`](#projectlogentry), [`ProjectLogInput`](#projectloginput).

## `applyEntityDiff`

_function_ in `collab/bind.ts`

Moves `runtime` from holding `before` to holding `after`: removes the
entities `after` lacks, adds the new ones and updates those whose value
changed. False when an add or update failed, so the caller reloads.

```ts
declare function applyEntityDiff(runtime: BindableRuntime, before: readonly RuntimeEntity[], after: readonly RuntimeEntity[]): boolean;
```

Refers to [`BindableRuntime`](#bindableruntime).

## `applyOpsToDoc`

_function_ in `collab/apply.ts`

Applies a batch to the live doc. The batch is checked exactly as
`applyOps` checks it, against the doc as it is now, so a `~` bulk ref
means the entry at that index now and a live batch needs no `base` (one
it brings is still checked). A failed batch writes nothing; a good one is
one `doc.transact(fn, origin)` that writes only the fields that changed,
plus its `log` entry. Instances resolve against `opts.prefabs`; the ops
that read or write prefabs go through `opts.prefabWriter` (one more
transaction per prefab doc) and are refused without one. On a prefab doc
the scene-only ops, grouped children, a write to the prefab itself and
an instance that makes the prefab contain itself are refused.

```ts
declare function applyOpsToDoc(doc: Y.Doc, batch: OpBatch, origin: SceneOrigin, registry: Registry, opts?: DocApplyOptions): DocApplyResult;
```

Refers to [`DocApplyOptions`](#docapplyoptions), [`DocApplyResult`](#docapplyresult), [`SceneOrigin`](#sceneorigin).

## `applyProjectBatch`

_function_ in `collab/project-apply.ts`

Applies a project batch across docs. Every doc the batch touches is
opened first (for `changeAssetId` and `deleteAsset`, every doc that
can hold a reference), and the whole batch is checked with
`checkProjectBatch` against their plain JSON; a failing op, or a doc it
writes that this build may only read (`code-skew`), writes nothing
anywhere. Then each doc gets exactly one transaction with `origin` and
its own log entry: `editAsset` through `layoutPatch`, `editScene`
through `applyOpsToDoc` (ops that write prefabs through
`session.prefabWriter`), new assets' content as the first edit of their
docs. `changeAssetId` writes the entry, the prefab header of a prefab,
and every referrer the same way. A batch that wrote two or more docs
also appends one project log entry naming each doc's entry. When
`origin` is the session's, the batch is one undo step, unless it purges
an asset: then it is on no undo stack.

```ts
declare function applyProjectBatch(session: ProjectSession, batch: ProjectOpBatch, origin: DocOrigin, opts?: ProjectApplyOptions): Promise<ProjectApplyResult>;
```

Refers to [`DocOrigin`](#docorigin), [`ProjectApplyOptions`](#projectapplyoptions), [`ProjectSession`](#projectsession).

## `applyRegistryBatch`

_function_ in `collab/project-apply.ts`

Applies a batch of registry ops to a project doc: the whole batch is
checked against the doc's plain-JSON state first, then written in one
transaction with `origin`, together with one project log entry. A batch
that changes nothing writes nothing. The ops that edit other docs are
refused here; `applyProjectBatch` applies those.

```ts
declare function applyRegistryBatch(doc: Y.Doc, batch: ProjectOpBatch, origin: DocOrigin, opts: RegistryApplyOptions): RegistryApplyResult;
```

Refers to [`DocOrigin`](#docorigin), [`RegistryApplyOptions`](#registryapplyoptions), [`RegistryApplyResult`](#registryapplyresult).

## `applyRepairs`

_function_ in `collab/project-apply.ts`

What the project's one writer runs on store: restores the given trashed
keys, then writes `projectView`'s repairs (later duplicates of an id or
path get a `-2`, `-3` suffix), in one transaction with a `repair` origin.
The repairs are a function of the state alone, so concurrent writers
write the same values, and a second call writes nothing.

```ts
declare function applyRepairs(doc: Y.Doc, opts?: {
    now?: number;
    origin?: Extract<DocOrigin, {
        kind: "repair";
    }>;
    restore?: readonly AssetKey[];
}): RepairResult;
```

Refers to [`DocOrigin`](#docorigin), [`RepairResult`](#repairresult).

## `assetsMap`

_const_ in `collab/convert.ts`

The `assets` header as a set: AssetId → true.

```ts
declare const assetsMap: (doc: Y.Doc) => Y.Map<unknown>;
```

## `assignZ`

_function_ in `collab/order.ts`

The `z` each entry of a list should have so the list sorts in the given
order, changing as few as possible: the longest run of existing values that
already increase strictly is kept, and the others get new keys between
their kept neighbours. `undefined` means the entry has no usable `z` yet.

```ts
declare function assignZ(current: readonly (string | undefined)[]): string[];
```

## `bindSceneDoc`

_function_ in `collab/bind.ts`

Keeps an edit-mode runtime in step with a doc: after each transaction
that changed the scene (local or remote), the touched entities are
removed, added and updated, each at most once per transaction. A change
to settings or the header reloads the runtime. A transaction in a
prefab the doc reaches (`prefabsReachedBy`: nested ones and a variant's
base included) re-expands it, once per transaction.

```ts
declare function bindSceneDoc(doc: Y.Doc, runtime: BindableRuntime, registry: Registry, opts?: BindOptions): SceneBinding;
```

Refers to [`BindOptions`](#bindoptions), [`BindableRuntime`](#bindableruntime), [`SceneBinding`](#scenebinding).

## `bucketOf`

_const_ in `collab/convert.ts`

The bulk key a record is written under, or `entities` for a named entity.

```ts
declare const bucketOf: (rec: EntityRecord) => string;
```

Refers to [`EntityRecord`](#entityrecord).

## `buildAtFrom`

_function_ in `collab/build-stamp.ts`

A build time as ms since the epoch: a positive number, or a string of
digits or a date `Date.parse` reads (what `VITE_BUILD_AT` holds). Anything
else is 0, which loses every build-stamp tie to a dated build. Every side
that stamps or compares builds reads its build time through this, so a dev
server and the browser given the same raw value agree on it.

```ts
declare function buildAtFrom(raw: unknown): number;
```

## `bulkRecord`

_function_ in `collab/convert.ts`

The record a bulk entry is stored as: its key, its type and its one geometry field.

```ts
declare function bulkRecord(key: BulkKey, value: BulkEntry, z: string): EntityRecord;
```

Refers to [`EntityRecord`](#entityrecord).

## `compareZ`

_function_ in `collab/order.ts`

Doc order: `z`, then key.

```ts
declare function compareZ(a: {
    key: string;
    z: string;
}, b: {
    key: string;
    z: string;
}): number;
```

## `contentLogKey`

_const_ in `collab/revert.ts`

```ts
declare const contentLogKey: (field: string) => string;
```

## `contentMap`

_const_ in `collab/layout.ts`

```ts
declare const contentMap: (doc: Y.Doc) => Y.Map<unknown>;
```

## `contentMaps`

_function_ in `collab/convert.ts`

Every map that holds a scene's or a prefab's content: what undo,
validation and bindings watch. The prefab doc's `params` and `overrides`
are included for every doc (they stay empty on a scene's), so a binding
made before the doc has synced still watches them.

```ts
declare function contentMaps(doc: Y.Doc): Y.Map<unknown>[];
```

## `createProjectSession`

_function_ in `collab/project-session.ts`

A client's live project: the project doc, the docs it opens through the
host's `openDoc` (lazily, each once), one undo coordinator over all of
them, and code-skew checks against the project's build stamps. A doc of a
kind whose schema hash differs from the project's stamp opens read-only,
unless this build is newer, in which case this client writes its stamp
(origin `repair`, reason `build`) and every older client turns read-only.

```ts
declare function createProjectSession(opts: ProjectSessionOptions): Promise<ProjectSession>;
```

Refers to [`ProjectSession`](#projectsession), [`ProjectSessionOptions`](#projectsessionoptions).

## `createSceneUndo`

_function_ in `collab/undo.ts`

A `Y.UndoManager` over the scene's maps (`contentMaps`) that tracks only
`origin` (compared by identity, so pass the same object to every write),
so undo never reverts a collaborator's, an agent's or the disk's change.
One batch is one step: `captureTimeout` is 0 and `commit` stops capturing.
The `log` isn't in scope, so undoing a batch leaves its history row.

```ts
declare function createSceneUndo(doc: Y.Doc, origin: SceneOrigin): SceneUndo;
```

Refers to [`SceneOrigin`](#sceneorigin), [`SceneUndo`](#sceneundo).

## `createUndoCoordinator`

_function_ in `collab/undo-coordinator.ts`

One undo stack for this client across every doc it writes in a project.
Each attached doc gets a `Y.UndoManager` with `createSceneUndo`'s settings
(`captureTimeout` 0, `stopCapturing()` per step, only `origin` tracked, by
identity) over every root type but `log` and `meta`, so undo never
removes a history row. The coordinator's stack holds which items of which
managers make each step, so a step that wrote several docs undoes and
redoes as one. The stack keeps the newest `cap` steps.

```ts
declare function createUndoCoordinator(origin: DocOrigin, opts?: {
    cap?: number;
}): UndoCoordinator;
```

Refers to [`DocOrigin`](#docorigin), [`UndoCoordinator`](#undocoordinator).

## `docLayout`

_function_ in `collab/convert.ts`

The collab layout a seeded doc holds: `meta.layout`, else 1.

```ts
declare function docLayout(doc: Y.Doc): number;
```

## `docMeta`

_function_ in `collab/convert.ts`

What `meta` says about a doc, or null before it has been seeded.

```ts
declare function docMeta(doc: Y.Doc): SceneDocMeta | null;
```

Refers to [`SceneDocMeta`](#scenedocmeta).

## `docPrefabs`

_function_ in `collab/convert.ts`

The prefabs a layout-1 doc holds in its `prefabs` map, by id; empty for layout 2.

```ts
declare function docPrefabs(doc: Y.Doc): PrefabLibrary;
```

## `docToPrefab`

_function_ in `collab/prefab-doc.ts`

The prefab a doc holds. Pass the result to `formatPrefab` for its canonical text.

```ts
declare function docToPrefab(doc: Y.Doc): Prefab;
```

## `docToScene`

_function_ in `collab/convert.ts`

The scene a doc holds. Pass the result to `formatScene` for its canonical text.

```ts
declare function docToScene(doc: Y.Doc): SceneDefinition;
```

## `entitiesMap`

_const_ in `collab/convert.ts`

```ts
declare const entitiesMap: (doc: Y.Doc) => Y.Map<Y.Map<unknown>>;
```

## `entityRecord`

_function_ in `collab/convert.ts`

The record a named entity is stored as.

```ts
declare function entityRecord(def: EntityDef, z: string): EntityRecord;
```

Refers to [`EntityRecord`](#entityrecord).

## `expandLenient`

_function_ in `collab/bind.ts`

Expands a scene that two clients' edits may have merged into a state
neither wrote: an entry that can't be expanded, or a second entity with
an id already used, is left out rather than failing the whole scene. A
scene with no header expands empty-named, with zero bounds.

```ts
declare function expandLenient(given: SceneDefinition, registry: Registry, prefabs?: PrefabLibrary): {
    errors: string[];
    scene: ExpandedScene;
};
```

## `fieldLayout`

_function_ in `project/canonical.ts`

The layout of `key` inside a map: its declared field, else `rest`, else atomic.

```ts
declare function fieldLayout(layout: MapLayout, key: string): DocLayout;
```

## `fingerprint`

_function_ in `collab/log.ts`

A short digest of an entry's state, ignoring its place in the order.

```ts
declare function fingerprint(rec: unknown): string;
```

## `gridRowKey`

_const_ in `collab/convert.ts`

The doc key of one grid row.

```ts
declare const gridRowKey: (field: string, chunk: string, row: number) => string;
```

## `groupsMap`

_const_ in `collab/convert.ts`

```ts
declare const groupsMap: (doc: Y.Doc) => Y.Map<Y.Map<unknown>>;
```

## `headerOf`

_function_ in `collab/apply.ts`

The header values the `scene` map holds: everything but `meta`'s, settings, assets and the entry arrays.

```ts
declare function headerOf(def: SceneDefinition): Record<string, unknown>;
```

## `historyRows`

_function_ in `collab/project-log.ts`

A doc's history panel: its own `log` plus the project log's entries that
name it, merged by `at` (ties keep the doc's order). A project entry shows
once, on the doc's own entry for that batch, carrying the docs it touched;
one whose doc entry has aged out of the doc's log shows as a row of its
own, under the project entry's id.

```ts
declare function historyRows(log: readonly LogEntry[], projectLog: readonly ProjectLogEntry[], docName: string): HistoryRow[];
```

Refers to [`HistoryRow`](#historyrow), [`LogEntry`](#logentry), [`ProjectLogEntry`](#projectlogentry).

## `instanceRecord`

_function_ in `collab/convert.ts`

The record an instance is stored as.

```ts
declare function instanceRecord(def: InstanceDef, z: string): EntityRecord;
```

Refers to [`EntityRecord`](#entityrecord).

## `instancesMap`

_const_ in `collab/convert.ts`

```ts
declare const instancesMap: (doc: Y.Doc) => Y.Map<Y.Map<unknown>>;
```

## `isLayoutKey`

_const_ in `collab/convert.ts`

Whether a record key belongs to the layout (`@z`, `@bulk`) rather than to the record's fields.

```ts
declare const isLayoutKey: (key: string) => boolean;
```

## `isPrefabDoc`

_const_ in `collab/convert.ts`

Whether a doc holds a prefab rather than a scene.

```ts
declare const isPrefabDoc: (doc: Y.Doc) => boolean;
```

## `isSeedStaleClose`

_function_ in `collab/seed-identity.ts`

Whether a doc's close is a server refusing this client's copy as another seed's.

```ts
declare function isSeedStaleClose(code: null | number, reason?: string): boolean;
```

## `layoutFromDoc`

_function_ in `collab/layout.ts`

The value a doc's `content` holds. Deterministic: docs holding the same
state give equal values with keys in the same order, so converged clients
format the same text.

```ts
declare function layoutFromDoc(doc: Y.Doc, layout: DocLayout): Record<string, unknown>;
```

## `layoutPatch`

_function_ in `collab/layout.ts`

Writes `next` into a doc in exactly one transaction, touching only what
differs, so concurrent edits elsewhere survive: map keys one by one, text
by its changed span, list items by a diff, and keyed items by matching
ids, keeping their keys. Returns whether anything was written.

```ts
declare function layoutPatch(doc: Y.Doc, layout: DocLayout, next: unknown, origin?: unknown, opts?: LayoutWriteOptions): boolean;
```

Refers to [`LayoutWriteOptions`](#layoutwriteoptions).

## `layoutToDoc`

_function_ in `collab/layout.ts`

Seeds a doc's `content` map with `value`, in one transaction. Only a
server seeds: two clients seeding one document would duplicate every
keyed item. Throws when `content` isn't empty.

```ts
declare function layoutToDoc(doc: Y.Doc, layout: DocLayout, value: unknown, origin?: unknown, opts?: LayoutWriteOptions): Y.Doc;
```

Refers to [`LayoutWriteOptions`](#layoutwriteoptions).

## `localPrefabSource`

_function_ in `collab/prefab-source.ts`

Prefab docs held in this process only, seeded from `library`: for tests,
headless runs and tools with no project. Its writer patches, creates and
drops those docs at once; nothing is shared with anyone.

```ts
declare function localPrefabSource(library?: PrefabLibrary, opts?: {
    key?: KeyGen;
}): PrefabSource & {
    docs(): ReadonlyMap<AssetId, Y.Doc>;
};
```

Refers to [`KeyGen`](#keygen), [`PrefabSource`](#prefabsource).

## `memoryDocHost`

_function_ in `collab/project-session.ts`

Docs served in-process, for tests, headless runs and tools with no sync
server: every client's `openDoc` gets its own copy of the named doc, kept
in step with every other copy through the host's, and an awareness shared
by the copies of that doc.

```ts
declare function memoryDocHost(): MemoryDocHost;
```

Refers to [`MemoryDocHost`](#memorydochost).

## `metaMap`

_const_ in `collab/convert.ts`

```ts
declare const metaMap: (doc: Y.Doc) => Y.Map<unknown>;
```

## `migrateDoc`

_function_ in `collab/migrate.ts`

Lifts a doc to `target` in place, in one `migration` transaction, keeping
each entry's key so an edit made against the old version still lands on
the same entity: named entities match by id, bulk entries by position.
A step that changes only `v` writes only `meta.schemaVersion` and leaves
every record untouched; a prefab doc's other changes are patched in with
`prefabPatch`, which keeps its children's keys the same way. `env` is
what the steps need (v3 → v4 needs the game's registry and the
project's prefabs). Returns the versions, or null when the doc was
already at `target`. Throws, leaving the doc as it was, when a step is
missing or refuses, or the doc is newer than `target`.

```ts
declare function migrateDoc(doc: Y.Doc, opts?: MigrateDocOptions): null | {
    from: number;
    to: number;
};
```

Refers to [`MigrateDocOptions`](#migratedocoptions).

## `migrateDocLayout`

_function_ in `collab/migrate-layout.ts`

Lifts a prefab doc, or a declarative asset doc laid out by `layout`, to
this engine's layout, in one `migration` transaction: a prefab's entity
and instance records, or each `keyed` entry at any depth of `content`,
get `@z` (and `@bulk`) for layout 2's `z` (and `bulk`), keeping every
key. Then `meta.layout` is set. Idempotent: a doc at this layout, or one
never seeded, is left alone. Throws for a layout-1 scene that still holds
prefabs: those move with `migrateLayout`.

```ts
declare function migrateDocLayout(doc: Y.Doc, layout?: DocLayout): DocLayoutMigration;
```

Refers to [`DocLayoutMigration`](#doclayoutmigration).

## `migrateLayout`

_function_ in `collab/migrate-layout.ts`

Lifts a scene doc to this engine's layout. From layout 1, each prefab in
its `prefabs` map becomes a prefab asset of its own (key = id, at
`<scene's folder>/prefabs/<id>.json`, its doc seeded from the value)
unless the project already has a live asset with that id; a prefab with
a different body, or an asset of another kind, is kept as it is and
noted as `prefab-diverged` in the migration's log entry, so no second
live asset takes the id, and the map is cleared. From layout 2, every
entity and instance record's `z` and `bulk` become `@z` and `@bulk`,
keeping each record's key. Then `meta.layout` is set; the scene doc's
writes are one transaction, all with the `migration` origin. Idempotent:
a doc at this layout is left alone.

```ts
declare function migrateLayout(sceneDoc: Y.Doc, project: ProjectWriter): LayoutMigration;
```

Refers to [`LayoutMigration`](#layoutmigration), [`ProjectWriter`](#projectwriter).

## `observeLog`

_function_ in `collab/log.ts`

Calls back with the whole log whenever it changes.

```ts
declare function observeLog(doc: Y.Doc, cb: (entries: LogEntry[]) => void): () => void;
```

Refers to [`LogEntry`](#logentry).

## `observePeers`

_function_ in `collab/presence.ts`

Calls back with the peers whenever anyone's presence changes. Returns the unsubscribe.

```ts
declare function observePeers(awareness: AwarenessLike, cb: (peers: PeerPresence[]) => void): () => void;
```

Refers to [`AwarenessLike`](#awarenesslike), [`PeerPresence`](#peerpresence).

## `observeProjectLog`

_function_ in `collab/project-log.ts`

Calls back with the whole project log whenever it changes. Returns the unsubscribe.

```ts
declare function observeProjectLog(doc: Y.Doc, cb: (entries: ProjectLogEntry[]) => void): () => void;
```

Refers to [`ProjectLogEntry`](#projectlogentry).

## `observeProjectPeers`

_function_ in `collab/project-presence.ts`

Calls back with the project peers whenever anyone's presence changes. Returns the unsubscribe.

```ts
declare function observeProjectPeers(awareness: AwarenessLike, cb: (peers: ProjectPeer[]) => void): () => void;
```

Refers to [`AwarenessLike`](#awarenesslike), [`ProjectPeer`](#projectpeer).

## `paramsMap`

_const_ in `collab/convert.ts`

A prefab doc's exposed parameters: name → PrefabParam.

```ts
declare const paramsMap: (doc: Y.Doc) => Y.Map<unknown>;
```

## `patchGroup`

_function_ in `collab/apply.ts`

Brings a group's `Y.Map` from `prev` to `next` key by key, so concurrent
edits of its `at`, turn, mirror and name merge. `prev` undefined writes
every key.

```ts
declare function patchGroup(ymap: Y.Map<unknown>, prev: GroupDef | undefined, next: GroupDef): void;
```

## `patchMap`

_function_ in `collab/convert.ts`

Brings an atomic-valued map to `next`: removes keys it lacks, writes the ones that differ.

```ts
declare function patchMap(map: Y.Map<unknown>, next: Readonly<Record<string, unknown>>): void;
```

## `patchRecord`

_function_ in `collab/convert.ts`

Writes only what differs between two records into a record's `Y.Map`, so
a concurrent edit to another field survives. `path`, `overrides` and
`params` are patched key by key, `behaviors` block by block and then
field by field, and a grid field row by row; every other value is
replaced whole. Removing a behavior deletes its block, so it wins over a
concurrent edit inside it. A record's kept maps (`keptMaps`) are emptied
rather than deleted and filled from empty in place, so concurrent first
writes merge; a record written before they existed gets one on its
first write, and two clients making that write at once keep only one.

```ts
declare function patchRecord(map: Y.Map<unknown>, prev: EntityRecord, next: EntityRecord): void;
```

Refers to [`EntityRecord`](#entityrecord).

## `peers`

_function_ in `collab/presence.ts`

Everyone else's presence, ordered by client id.

```ts
declare function peers(awareness: AwarenessLike): PeerPresence[];
```

Refers to [`AwarenessLike`](#awarenesslike), [`PeerPresence`](#peerpresence).

## `prefabHeaderMap`

_const_ in `collab/convert.ts`

A prefab doc's header: `id`, `base` and `contract`.

```ts
declare const prefabHeaderMap: (doc: Y.Doc) => Y.Map<unknown>;
```

## `prefabOverridesMap`

_const_ in `collab/convert.ts`

A prefab doc's variant overrides: override path → value.

```ts
declare const prefabOverridesMap: (doc: Y.Doc) => Y.Map<unknown>;
```

## `prefabPatch`

_function_ in `collab/prefab-doc.ts`

Brings a prefab doc to `next` in one transaction with `origin`, writing
only what changed: named children and nested instances keep their keys by
id, bulk entries by position, and each child's or instance's map is
patched field by field; parameters, overrides and assets are written per
key. A concurrent edit to another child, field or key survives. Returns
the log entry, or null when nothing changed.

```ts
declare function prefabPatch(doc: Y.Doc, next: Prefab, origin: DocOrigin, opts?: PrefabPatchOptions): LogEntry | null;
```

Refers to [`DocOrigin`](#docorigin), [`LogEntry`](#logentry), [`PrefabPatchOptions`](#prefabpatchoptions).

## `prefabPathNear`

_function_ in `collab/prefab-doc.ts`

Where a new prefab made from the scene at `scenePath` lives: `<scene's folder>/prefabs/<id>.json`, as the prefab kind places it.

```ts
declare function prefabPathNear(id: string, scenePath?: AssetPath): AssetPath;
```

## `prefabSceneBounds`

_function_ in `collab/convert.ts`

The bounds a prefab is edited in: `parent`'s size centred on the
prefab's origin, grown to hold its children (with a margin) when a
registry can measure them, and its nested instances' origins; with
`prefabs` as well, the nested instances' resolved children.

```ts
declare function prefabSceneBounds(prefab: Pick<Prefab, "bulk" | "entities" | "instances" | "v">, parent?: Bounds, registry?: Registry, prefabs?: PrefabLibrary): Bounds;
```

## `prefabToDoc`

_function_ in `collab/prefab-doc.ts`

Seeds a doc with a prefab, in one transaction. As with scenes, only the
project's one writer seeds a doc that others may open.

```ts
declare function prefabToDoc(prefab: Prefab, opts?: PrefabToDocOptions): Y.Doc;
```

Refers to [`PrefabToDocOptions`](#prefabtodocoptions).

## `prefabsMap`

_const_ in `collab/convert.ts`

Layout 1's prefabs, which `migrateLayout` moves into prefab docs; layout 2 never writes it.

```ts
declare const prefabsMap: (doc: Y.Doc) => Y.Map<unknown>;
```

## `projectAssetsMap`

_const_ in `collab/project-doc.ts`

```ts
declare const projectAssetsMap: (doc: Y.Doc) => Y.Map<Y.Map<unknown>>;
```

## `projectBuildMap`

_const_ in `collab/project-doc.ts`

```ts
declare const projectBuildMap: (doc: Y.Doc) => Y.Map<BuildStamp>;
```

## `projectCodeMap`

_const_ in `collab/project-doc.ts`

```ts
declare const projectCodeMap: (doc: Y.Doc) => Y.Map<CodeModuleInfo>;
```

## `projectDocWriter`

_function_ in `collab/migrate-layout.ts`

A `ProjectWriter` over a project doc and the prefab docs the host holds
(the dev server's or the hosted service's), for `migrateLayout` at load.

```ts
declare function projectDocWriter(projectDoc: Y.Doc, opts: ProjectDocWriterOptions): ProjectWriter;
```

Refers to [`ProjectDocWriterOptions`](#projectdocwriteroptions), [`ProjectWriter`](#projectwriter).

## `projectHistoryMap`

_const_ in `collab/project-doc.ts`

```ts
declare const projectHistoryMap: (doc: Y.Doc) => Y.Map<Y.Array<HashHistoryEntry>>;
```

## `projectLogFor`

_function_ in `collab/project-log.ts`

The entries whose batch wrote `docName`: what a doc's history panel merges with the doc's own log.

```ts
declare function projectLogFor(entries: readonly ProjectLogEntry[], docName: string): ProjectLogEntry[];
```

Refers to [`ProjectLogEntry`](#projectlogentry).

## `projectMetaMap`

_const_ in `collab/project-doc.ts`

```ts
declare const projectMetaMap: (doc: Y.Doc) => Y.Map<unknown>;
```

## `projectPeers`

_function_ in `collab/project-presence.ts`

Everyone else's project presence, ordered by client id.

```ts
declare function projectPeers(awareness: AwarenessLike): ProjectPeer[];
```

Refers to [`AwarenessLike`](#awarenesslike), [`ProjectPeer`](#projectpeer).

## `projectPeersByDoc`

_function_ in `collab/project-presence.ts`

Which peers are in each doc, for the project tree; `null` holds those on the overview.

```ts
declare function projectPeersByDoc(list: readonly ProjectPeer[]): Map<null | string, ProjectPeer[]>;
```

Refers to [`ProjectPeer`](#projectpeer).

## `randomKey`

_const_ in `collab/keys.ts`

12 base-36 characters from `crypto.getRandomValues`, about 62 bits.

```ts
declare const randomKey: KeyGen;
```

Refers to [`KeyGen`](#keygen).

## `readAssets`

_function_ in `collab/convert.ts`

The doc's `assets` header: its ids, sorted.

```ts
declare function readAssets(doc: Y.Doc): AssetId[];
```

## `readDoc`

_function_ in `collab/convert.ts`

Reads a doc. Deterministic: two docs holding the same state give the same
definition, so converged clients agree on `formatScene` text and
`sceneHash`. Entries sort by bucket, then `@z`, then key; a record with
no geometry or no id can't be written to disk and is skipped. Grid
fields come back from their rows, canonical, and only the layout's
`@`-keys are dropped. A prefab doc reads as a scene of its children and
instances (`kind: "prefab"`), named after the prefab, with bounds from
`prefabSceneBounds` that are never written; its base, params and
overrides are in `prefab`. Those bounds hold nested instances' children
when `prefabs` is given, so an edit to a nested prefab can change a
prefab doc's `sceneHash`: every reader that hashes a prefab doc passes
the same library, and a base taken before such an edit is stale.

```ts
declare function readDoc(doc: Y.Doc, opts?: ReadDocOptions): DocView;
```

Refers to [`DocView`](#docview), [`ReadDocOptions`](#readdocoptions).

## `readEntry`

_function_ in `collab/project-doc.ts`

One registry entry as plain JSON; null when the map lacks an id, kind or path.

```ts
declare function readEntry(key: AssetKey, map: Y.Map<unknown>): AssetEntry | null;
```

## `readLog`

_function_ in `collab/log.ts`

The doc's history, oldest first.

```ts
declare function readLog(doc: Y.Doc): LogEntry[];
```

Refers to [`LogEntry`](#logentry).

## `readProject`

_function_ in `collab/project-doc.ts`

The project doc as plain JSON, keys sorted.

```ts
declare function readProject(doc: Y.Doc): ProjectState;
```

## `readProjectLog`

_function_ in `collab/project-log.ts`

The project's cross-doc history, oldest first.

```ts
declare function readProjectLog(doc: Y.Doc): ProjectLogEntry[];
```

Refers to [`ProjectLogEntry`](#projectlogentry).

## `recordFields`

_function_ in `collab/convert.ts`

A record's fields: everything but the layout's own keys.

```ts
declare function recordFields(rec: EntityRecord): Record<string, unknown>;
```

Refers to [`EntityRecord`](#entityrecord).

## `recordMap`

_function_ in `collab/convert.ts`

A new `Y.Map` holding a record.

```ts
declare function recordMap(rec: EntityRecord): Y.Map<unknown>;
```

Refers to [`EntityRecord`](#entityrecord).

## `recordOf`

_function_ in `collab/convert.ts`

A record's `Y.Map` as plain JSON, grid rows gathered into their fields; values are copies.

```ts
declare function recordOf(map: Y.Map<unknown>): EntityRecord;
```

Refers to [`EntityRecord`](#entityrecord).

## `refsOfView`

_function_ in `collab/apply.ts`

The ref each entry of a view goes by, by key; instances by their id.

```ts
declare function refsOfView(view: DocView): Map<string, Ref>;
```

Refers to [`DocView`](#docview).

## `reinspectBlobs`

_function_ in `collab/project-apply.ts`

What the project's one writer runs on store, beside `applyRepairs`: every
live binary whose bytes `store` holds gets the meta (and filled settings)
its bytes and current settings give, in one transaction with a `repair`
origin and a project log entry. Settings merge per field, so after two
concurrent `setImport`s the meta either client wrote may lag the merged
settings; this puts it back, as it does after a move for meta that names
paths. Inspection is a pure function, so concurrent
writers write the same values, and a second call writes nothing. Bytes the
store lacks and inspections that fail are left alone. Pass one `checked`
map per doc to skip entries unchanged since the last call.

```ts
declare function reinspectBlobs(doc: Y.Doc, opts: {
    checked?: Map<AssetKey, string>;
    kinds: KindRegistry;
    now?: number;
    origin?: Extract<DocOrigin, {
        kind: "repair";
    }>;
    store: ContentStore;
}): Promise<ReinspectResult>;
```

Refers to [`DocOrigin`](#docorigin), [`ReinspectResult`](#reinspectresult).

## `revertEntry`

_function_ in `collab/revert.ts`

Applies a history entry's inverse as a new batch from `origin`: every key
it touched goes back to its state before the entry. Refused with an
issue, writing nothing, when any of those keys has changed since, or when
the entry was too large to keep its inverse. An asset doc's entry needs
its kind's `layout`.

```ts
declare function revertEntry(doc: Y.Doc, entry: LogEntry, origin: SceneOrigin, opts?: RevertOptions): RevertResult;
```

Refers to [`LogEntry`](#logentry), [`RevertOptions`](#revertoptions), [`RevertResult`](#revertresult), [`SceneOrigin`](#sceneorigin).

## `revertOpenProjectEntry`

_function_ in `collab/revert.ts`

Reverts a project entry: each doc's own entry for that batch, checked
first in every doc and then written as one new cross-doc batch (one
transaction and log entry per doc, one project entry, one undo step when
`origin` is the session's). Refused, writing nothing, when any doc has
changed since (the issue names the doc), when a doc's entry has aged out,
or when the batch changed the registry, which keeps no inverse: undo
that instead. The docs it names must be open, or `revertProjectEntry`
opens them first.

```ts
declare function revertOpenProjectEntry(session: ProjectSession, entryId: string, origin?: DocOrigin): ProjectRevertResult;
```

Refers to [`DocOrigin`](#docorigin), [`ProjectRevertResult`](#projectrevertresult), [`ProjectSession`](#projectsession).

## `revertProblem`

_function_ in `collab/revert.ts`

Why `entry` can't be reverted in `doc` now, or null when it can.

```ts
declare function revertProblem(doc: Y.Doc, entry: LogEntry, opts?: RevertOptions): SceneIssue | null;
```

Refers to [`LogEntry`](#logentry), [`RevertOptions`](#revertoptions).

## `revertProjectEntry`

_function_ in `collab/revert.ts`

`revertOpenProjectEntry`, opening the docs the entry names first; they're released after.

```ts
declare function revertProjectEntry(session: ProjectSession, entryId: string, origin?: DocOrigin): Promise<ProjectRevertResult>;
```

Refers to [`DocOrigin`](#docorigin), [`ProjectRevertResult`](#projectrevertresult), [`ProjectSession`](#projectsession).

## `sceneMap`

_const_ in `collab/convert.ts`

```ts
declare const sceneMap: (doc: Y.Doc) => Y.Map<unknown>;
```

## `sceneToDoc`

_function_ in `collab/convert.ts`

Seeds a doc with a scene, in one transaction, at this engine's layout.
The scene's prefabs are docs of their own (`prefabToDoc`). Only a server
seeds: two clients seeding one document on their own would duplicate
every entity.

```ts
declare function sceneToDoc(def: SceneDefinition, opts?: SceneToDocOptions): Y.Doc;
```

Refers to [`SceneToDocOptions`](#scenetodocoptions).

## `seedProjectDoc`

_function_ in `collab/project-doc.ts`

Fills an empty project doc: `meta` (at `PROJECT_LAYOUT_VERSION`), every
entry, a history array for each blob entry so concurrent first replaces
append to one array, the code map and build stamps. The project's one
writer seeds; pass a fixed `doc.clientID` for the same bytes everywhere.

```ts
declare function seedProjectDoc(doc: Y.Doc, state: ProjectState, origin?: unknown): void;
```

## `selectionsByKey`

_function_ in `collab/presence.ts`

Which peers have each key selected, for the outliner and canvas highlights.

```ts
declare function selectionsByKey(list: readonly PeerPresence[]): Map<string, PeerPresence[]>;
```

Refers to [`PeerPresence`](#peerpresence).

## `sequentialKeys`

_function_ in `collab/keys.ts`

A deterministic key generator for tests and seeded runs: `<prefix><n>`, counting from 0.

```ts
declare function sequentialKeys(prefix?: string): KeyGen;
```

Refers to [`KeyGen`](#keygen).

## `sessionPrefabSource`

_function_ in `collab/prefab-source.ts`

The project's prefabs as a source: every live prefab's doc, opened
through the session and held while it is live, read as a library;
`subscribe` fires once per transaction in any of them or the registry.
The first source for a session also fills its `prefabLibrary` slot, and
its `prefabWriter` slot when nothing else has, so `applyProjectBatch`
resolves instances against these docs and writes prefab ops to them.

```ts
declare function sessionPrefabSource(session: ProjectSession, opts?: SessionPrefabSourceOptions): SessionPrefabSource;
```

Refers to [`ProjectSession`](#projectsession), [`SessionPrefabSource`](#sessionprefabsource), [`SessionPrefabSourceOptions`](#sessionprefabsourceoptions).

## `setPresence`

_function_ in `collab/presence.ts`

Publishes this client's presence, merged over what it published before.

```ts
declare function setPresence(awareness: AwarenessLike, patch: Partial<ScenePresence>): void;
```

Refers to [`AwarenessLike`](#awarenesslike), [`ScenePresence`](#scenepresence).

## `setProjectPresence`

_function_ in `collab/project-presence.ts`

Publishes where this client is in the project, merged over what it published before.

```ts
declare function setProjectPresence(awareness: AwarenessLike, patch: Partial<ProjectPresence>): void;
```

Refers to [`AwarenessLike`](#awarenesslike), [`ProjectPresence`](#projectpresence).

## `settingsMap`

_const_ in `collab/convert.ts`

```ts
declare const settingsMap: (doc: Y.Doc) => Y.Map<unknown>;
```

## `stableJson`

_function_ in `project/canonical.ts`

JSON with object keys sorted, so equal values give equal text whatever order their keys were set in.

```ts
declare function stableJson(value: unknown): string;
```

## `stampWins`

_function_ in `collab/build-stamp.ts`

Whether a build's stamp for a kind wins over `than`: the later build, then the larger hash.

```ts
declare function stampWins(buildAt: number, hash: Sha256, than: BuildStamp): boolean;
```

## `staticPrefabSource`

_function_ in `collab/prefab-source.ts`

A fixed library: for tests, headless runs and the file paths. It opens no docs and writes nothing.

```ts
declare function staticPrefabSource(library?: PrefabLibrary): PrefabSource;
```

Refers to [`PrefabSource`](#prefabsource).

## `validateDoc`

_function_ in `collab/watch-issues.ts`

Validates a doc's scene (or a prefab doc's children), turning a validator that throws into an issue instead of an exception.

```ts
declare function validateDoc(doc: Y.Doc, registry: Registry, opts?: Pick<WatchIssuesOptions, "parentBounds" | "prefabs" | "project">): SceneIssue[];
```

Refers to [`WatchIssuesOptions`](#watchissuesoptions).

## `watchIssues`

_function_ in `collab/watch-issues.ts`

Reruns validation on the merged doc after changes settle. Two valid edits
can merge into a state neither client wrote (a reference to an entity
someone else deleted, two entities given one id at once); those arrive
here as `dangling-ref` and `dup-id` issues, never as exceptions.

```ts
declare function watchIssues(doc: Y.Doc, registry: Registry, onIssues: (issues: SceneIssue[]) => void, opts?: WatchIssuesOptions): IssueWatch;
```

Refers to [`IssueWatch`](#issuewatch), [`WatchIssuesOptions`](#watchissuesoptions).

## `writeAssets`

_function_ in `collab/convert.ts`

Brings the doc's `assets` set to `ids`, adding and removing ids one by one so concurrent changes merge.

```ts
declare function writeAssets(doc: Y.Doc, ids: readonly AssetId[]): void;
```

## `writeEntry`

_function_ in `collab/project-doc.ts`

Writes `entry` under its key, creating it when new, touching only the
fields that changed. `import` and `licence` always exist as nested maps,
so concurrent edits of different settings or licence fields merge. Runs
in its own transaction, or in the caller's when inside one.

```ts
declare function writeEntry(doc: Y.Doc, entry: AssetEntry, origin?: unknown): void;
```

## `writeProjectState`

_function_ in `collab/project-doc.ts`

Writes `next`'s registry where it differs from `prev` (the state `doc`
held when `next` was computed from it): changed entries field by field,
history entries past `prev`'s, and the removal of an entry or history
`next` no longer has (a purge). Call inside the batch's transaction.

```ts
declare function writeProjectState(doc: Y.Doc, prev: ProjectState, next: ProjectState): void;
```
