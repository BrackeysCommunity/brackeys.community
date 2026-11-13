# @jams/engine/project

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`ATLAS_KIND`](#atlas_kind) · [`ATLAS_SUFFIX`](#atlas_suffix) · [`AUDIO_KIND`](#audio_kind) · [`AssetBundle`](#assetbundle) · [`AssetEntry`](#assetentry) · [`AssetFile`](#assetfile) · [`AssetId`](#assetid) · [`AssetInfo`](#assetinfo) · [`AssetKey`](#assetkey) · [`AssetKindDef`](#assetkinddef) · [`AssetKindName`](#assetkindname) · [`AssetMatch`](#assetmatch) · [`AssetPath`](#assetpath) · [`AssetSidecar`](#assetsidecar) · [`AtlasDirection`](#atlasdirection) · [`AtlasFrame`](#atlasframe) · [`AtlasMeta`](#atlasmeta) · [`AtlasSettings`](#atlassettings) · [`AtlasSheet`](#atlassheet) · [`AtlasSlice`](#atlasslice) · [`AtlasTag`](#atlastag) · [`AtlasTool`](#atlastool) · [`AudioMeta`](#audiometa) · [`AudioSettings`](#audiosettings) · [`BlobInspect`](#blobinspect) · [`BlobKindDef`](#blobkinddef) · [`BuildSceneVersionOptions`](#buildsceneversionoptions) · [`BuildSceneVersionResult`](#buildsceneversionresult) · [`BuildStamp`](#buildstamp) · [`BundleEntry`](#bundleentry) · [`CREDITS_FILE`](#credits_file) · [`CheckReleaseOptions`](#checkreleaseoptions) · [`CheckSceneVersionOptions`](#checksceneversionoptions) · [`CodeKindDef`](#codekinddef) · [`CodeModuleInfo`](#codemoduleinfo) · [`ContentStore`](#contentstore) · [`ContentStoreError`](#contentstoreerror) · [`DATA_TABLE_KIND`](#data_table_kind) · [`DATA_TABLE_SCHEMA_ID`](#data_table_schema_id) · [`DATA_TABLE_VERSION`](#data_table_version) · [`DOC_NAME_KINDS`](#doc_name_kinds) · [`DOC_NAME_MAX_LENGTH`](#doc_name_max_length) · [`DataTableFile`](#datatablefile) · [`DataTableRow`](#datatablerow) · [`DocKindDef`](#dockinddef) · [`DocLayout`](#doclayout) · [`DocName`](#docname) · [`DocNameKind`](#docnamekind) · [`ENGINE_ASSET_KINDS`](#engine_asset_kinds) · [`EditSceneOp`](#editsceneop) · [`ExportBudget`](#exportbudget) · [`ExportBudgetReport`](#exportbudgetreport) · [`FONT_KIND`](#font_kind) · [`FontFormat`](#fontformat) · [`FontMeta`](#fontmeta) · [`FontSettings`](#fontsettings) · [`GAME_SETTINGS_KIND`](#game_settings_kind) · [`GAME_SETTINGS_SCHEMA_ID`](#game_settings_schema_id) · [`GAME_SETTINGS_VERSION`](#game_settings_version) · [`GameSettingsEngine`](#gamesettingsengine) · [`GameSettingsFile`](#gamesettingsfile) · [`GlobMatch`](#globmatch) · [`HashHistoryEntry`](#hashhistoryentry) · [`HeldFile`](#heldfile) · [`HeldProject`](#heldproject) · [`INDEX_HTML_FILE`](#index_html_file) · [`INPUT_MAP_KIND`](#input_map_kind) · [`INPUT_MAP_SCHEMA_ID`](#input_map_schema_id) · [`INPUT_MAP_VERSION`](#input_map_version) · [`INPUT_SCRIPT_SUFFIX`](#input_script_suffix) · [`ImageSize`](#imagesize) · [`InputMapFile`](#inputmapfile) · [`InputMapProblem`](#inputmapproblem) · [`InputMapTouchControl`](#inputmaptouchcontrol) · [`InspectEnv`](#inspectenv) · [`InspectResult`](#inspectresult) · [`JsonEdit`](#jsonedit) · [`JsonEditResult`](#jsoneditresult) · [`JsonPointer`](#jsonpointer) · [`KindEnv`](#kindenv) · [`KindRegistry`](#kindregistry) · [`Licence`](#licence) · [`LiveCompat`](#livecompat) · [`MATERIAL_KIND`](#material_kind) · [`MATERIAL_SCHEMA_ID`](#material_schema_id) · [`MATERIAL_VERSION`](#material_version) · [`MaterialFile`](#materialfile) · [`PREFAB_SCENE_OPS`](#prefab_scene_ops) · [`PROJECT_FILE`](#project_file) · [`PROJECT_FILE_DEFAULTS`](#project_file_defaults) · [`PROJECT_FILE_VERSION`](#project_file_version) · [`PROJECT_OPS_SCHEMA_ID`](#project_ops_schema_id) · [`PROJECT_OP_NAMES`](#project_op_names) · [`PROJECT_SCHEMA_ID`](#project_schema_id) · [`PROJECT_SNAPSHOT_SCHEMA_ID`](#project_snapshot_schema_id) · [`PROJECT_SNAPSHOT_VERSION`](#project_snapshot_version) · [`ParseAssetResult`](#parseassetresult) · [`ParseProjectFileResult`](#parseprojectfileresult) · [`ParseProjectSnapshotResult`](#parseprojectsnapshotresult) · [`ParseReleaseManifestResult`](#parsereleasemanifestresult) · [`ParseSidecarResult`](#parsesidecarresult) · [`PerProjectWords`](#perprojectwords) · [`PointerRead`](#pointerread) · [`ProjectApplyResult`](#projectapplyresult) · [`ProjectBatchCheck`](#projectbatchcheck) · [`ProjectBatchEnv`](#projectbatchenv) · [`ProjectBundle`](#projectbundle) · [`ProjectExport`](#projectexport) · [`ProjectFile`](#projectfile) · [`ProjectId`](#projectid) · [`ProjectOp`](#projectop) · [`ProjectOpBatch`](#projectopbatch) · [`ProjectOpName`](#projectopname) · [`ProjectPathMatcher`](#projectpathmatcher) · [`ProjectRuntimeView`](#projectruntimeview) · [`ProjectSnapshot`](#projectsnapshot) · [`ProjectState`](#projectstate) · [`ProjectTreeNode`](#projecttreenode) · [`ProjectUsage`](#projectusage) · [`ProjectView`](#projectview) · [`QuotaPolicy`](#quotapolicy) · [`QuotaVerdict`](#quotaverdict) · [`RECORDING_KIND`](#recording_kind) · [`RECORDING_SUFFIX`](#recording_suffix) · [`RELEASE_FILE`](#release_file) · [`RELEASE_SCHEMA_ID`](#release_schema_id) · [`RELEASE_VERSION`](#release_version) · [`RUNTIME_VIEW_KINDS`](#runtime_view_kinds) · [`RecordingMeta`](#recordingmeta) · [`RecordingSettings`](#recordingsettings) · [`RefIndex`](#refindex) · [`RefSite`](#refsite) · [`Referrer`](#referrer) · [`ReleaseAsset`](#releaseasset) · [`ReleaseBudgetContent`](#releasebudgetcontent) · [`ReleaseCredit`](#releasecredit) · [`ReleaseFile`](#releasefile) · [`ReleaseManifest`](#releasemanifest) · [`ReleaseRecordingRef`](#releaserecordingref) · [`ReleaseScene`](#releasescene) · [`ReleaseTarget`](#releasetarget) · [`SAVE_FIXTURE_MAX_BYTES`](#save_fixture_max_bytes) · [`SAVE_KIND`](#save_kind) · [`SAVE_SUFFIX`](#save_suffix) · [`SCENE_KIND_NAME`](#scene_kind_name) · [`SCENE_LIST_KIND`](#scene_list_kind) · [`SCENE_LIST_SCHEMA_ID`](#scene_list_schema_id) · [`SCENE_LIST_VERSION`](#scene_list_version) · [`SCENE_VERSION_SCHEMA_ID`](#scene_version_schema_id) · [`SCENE_VERSION_VERSION`](#scene_version_version) · [`SERVICE_WORKER_FILE`](#service_worker_file) · [`SIDECAR_SCHEMA_ID`](#sidecar_schema_id) · [`SIDECAR_SUFFIX`](#sidecar_suffix) · [`SIDECAR_VERSION`](#sidecar_version) · [`SaveFixtureMeta`](#savefixturemeta) · [`SaveFixtureSettings`](#savefixturesettings) · [`SceneListEntry`](#scenelistentry) · [`SceneListFile`](#scenelistfile) · [`SceneListFlow`](#scenelistflow) · [`SceneVersion`](#sceneversion) · [`SceneVersionNames`](#sceneversionnames) · [`SceneVersionRead`](#sceneversionread) · [`SceneWrite`](#scenewrite) · [`Sha256`](#sha256) · [`SnapshotAsset`](#snapshotasset) · [`SnapshotError`](#snapshoterror) · [`TEXTURE_KIND`](#texture_kind) · [`TextureFormat`](#textureformat) · [`TextureMeta`](#texturemeta) · [`TextureSettings`](#texturesettings) · [`ThirdPartyLicence`](#thirdpartylicence) · [`UNLIMITED_QUOTA`](#unlimited_quota) · [`WEB_MANIFEST_FILE`](#web_manifest_file) · [`applyJsonEdits`](#applyjsonedits) · [`assetFileEntries`](#assetfileentries) · [`assetFileEntry`](#assetfileentry) · [`assetFileKind`](#assetfilekind) · [`assetFilesIn`](#assetfilesin) · [`assetIdOfPath`](#assetidofpath) · [`assetInfo`](#assetinfo-1) · [`assetPathProblem`](#assetpathproblem) · [`atlasExportApp`](#atlasexportapp) · [`atlasImage`](#atlasimage) · [`atlasKind`](#atlaskind) · [`atlasMetaSchema`](#atlasmetaschema) · [`atlasSettingsSchema`](#atlassettingsschema) · [`atlasTool`](#atlastool-1) · [`audioKind`](#audiokind) · [`audioMetaSchema`](#audiometaschema) · [`audioSettingsSchema`](#audiosettingsschema) · [`buildRefIndex`](#buildrefindex) · [`buildSceneVersion`](#buildsceneversion) · [`byCodeUnit`](#bycodeunit) · [`canonicalJson`](#canonicaljson) · [`checkProjectBatch`](#checkprojectbatch) · [`checkReleaseManifest`](#checkreleasemanifest) · [`checkSceneVersion`](#checksceneversion) · [`checkSnapshot`](#checksnapshot) · [`checksKind`](#checkskind) · [`codeKind`](#codekind) · [`compareEntries`](#compareentries) · [`createKindRegistry`](#createkindregistry) · [`dataTableIssues`](#datatableissues) · [`dataTableKind`](#datatablekind) · [`defineAssetKind`](#defineassetkind) · [`detectImport`](#detectimport) · [`docKindJsonSchema`](#dockindjsonschema) · [`docNameOf`](#docnameof) · [`engineResolution`](#engineresolution) · [`findRelease`](#findrelease) · [`findSceneVersion`](#findsceneversion) · [`fontKind`](#fontkind) · [`fontMetaSchema`](#fontmetaschema) · [`fontSettingsSchema`](#fontsettingsschema) · [`formatAssetDoc`](#formatassetdoc) · [`formatBytes`](#formatbytes) · [`formatProjectFile`](#formatprojectfile) · [`formatProjectSnapshot`](#formatprojectsnapshot) · [`formatReleaseManifest`](#formatreleasemanifest) · [`formatSceneVersion`](#formatsceneversion) · [`formatSidecar`](#formatsidecar) · [`gameSettingsEntries`](#gamesettingsentries) · [`gameSettingsIssues`](#gamesettingsissues) · [`gameSettingsKind`](#gamesettingskind) · [`gameSettingsValues`](#gamesettingsvalues) · [`hashForPut`](#hashforput) · [`heldProject`](#heldproject-1) · [`idsAtPaths`](#idsatpaths) · [`inputMapEntries`](#inputmapentries) · [`inputMapIssues`](#inputmapissues) · [`inputMapKind`](#inputmapkind) · [`inputMapProblems`](#inputmapproblems) · [`inputScriptKind`](#inputscriptkind) · [`inspectEntry`](#inspectentry) · [`isSha256`](#issha256) · [`isSkippedAssetPath`](#isskippedassetpath) · [`keyedItemPointer`](#keyeditempointer) · [`kindInputMap`](#kindinputmap) · [`liveCompat`](#livecompat-1) · [`liveCompatKey`](#livecompatkey) · [`materialKind`](#materialkind) · [`materialSchema`](#materialschema) · [`mayBeAssetFile`](#maybeassetfile) · [`memoryContentStore`](#memorycontentstore) · [`orphanSidecarIssue`](#orphansidecarissue) · [`ownAssetId`](#ownassetid) · [`parseAsepriteJson`](#parseasepritejson) · [`parseAssetDoc`](#parseassetdoc) · [`parseBmfont`](#parsebmfont) · [`parseDocName`](#parsedocname) · [`parseJsonPointer`](#parsejsonpointer) · [`parseProjectFile`](#parseprojectfile) · [`parseProjectSnapshot`](#parseprojectsnapshot) · [`parseReleaseManifest`](#parsereleasemanifest) · [`parseSceneVersion`](#parsesceneversion) · [`parseSidecar`](#parsesidecar) · [`parseTexturePackerJson`](#parsetexturepackerjson) · [`prefabKind`](#prefabkind) · [`projectBundle`](#projectbundle-1) · [`projectFileSchema`](#projectfileschema) · [`projectGlobs`](#projectglobs) · [`projectJsonSchema`](#projectjsonschema) · [`projectMaterialOf`](#projectmaterialof) · [`projectOpBatchSchema`](#projectopbatchschema) · [`projectOpsJsonSchema`](#projectopsjsonschema) · [`projectPathMatcher`](#projectpathmatcher-1) · [`projectSnapshotJsonSchema`](#projectsnapshotjsonschema) · [`projectSnapshotSchema`](#projectsnapshotschema) · [`projectUsage`](#projectusage-1) · [`projectView`](#projectview-1) · [`readGifSize`](#readgifsize) · [`readJpegSize`](#readjpegsize) · [`readPngSize`](#readpngsize) · [`readPointer`](#readpointer) · [`readSceneVersion`](#readsceneversion) · [`readWebpSize`](#readwebpsize) · [`recordingKind`](#recordingkind) · [`recordingMetaSchema`](#recordingmetaschema) · [`recordingSettingsSchema`](#recordingsettingsschema) · [`referencedTrash`](#referencedtrash) · [`releaseBuildHash`](#releasebuildhash) · [`releaseId`](#releaseid) · [`releaseJsonSchema`](#releasejsonschema) · [`releaseManifestSchema`](#releasemanifestschema) · [`releaseSnapshot`](#releasesnapshot) · [`rewriteRefs`](#rewriterefs) · [`rowSchemaOf`](#rowschemaof) · [`runtimeView`](#runtimeview) · [`saveFixtureMetaSchema`](#savefixturemetaschema) · [`saveFixtureSettingsSchema`](#savefixturesettingsschema) · [`saveKind`](#savekind) · [`sceneBundle`](#scenebundle) · [`sceneKind`](#scenekind) · [`sceneListEntries`](#scenelistentries) · [`sceneListFlow`](#scenelistflow-1) · [`sceneListIssues`](#scenelistissues) · [`sceneListKind`](#scenelistkind) · [`sceneVersionId`](#sceneversionid) · [`sceneVersionJsonSchema`](#sceneversionjsonschema) · [`sceneVersionSchema`](#sceneversionschema) · [`sceneVersionSnapshot`](#sceneversionsnapshot) · [`schemaRefSites`](#schemarefsites) · [`sha256`](#sha256-1) · [`sidecarJsonSchema`](#sidecarjsonschema) · [`sidecarPathOf`](#sidecarpathof) · [`sidecarSchema`](#sidecarschema) · [`snapshotProject`](#snapshotproject) · [`snapshotScene`](#snapshotscene) · [`stableJson`](#stablejson) · [`suffixedId`](#suffixedid) · [`suffixedPath`](#suffixedpath) · [`tableAssets`](#tableassets) · [`textureKind`](#texturekind) · [`textureMetaSchema`](#texturemetaschema) · [`textureSettingsSchema`](#texturesettingsschema) · [`unreferencedBlobs`](#unreferencedblobs) · [`usableInputMap`](#usableinputmap) · [`validateAssetDoc`](#validateassetdoc) · [`writesPrefabs`](#writesprefabs)

## `ATLAS_KIND`

_const_ in `project/kinds/atlas.ts`

```ts
declare const ATLAS_KIND = "atlas";
```

## `ATLAS_SUFFIX`

_const_ in `project/kinds/atlas.ts`

```ts
declare const ATLAS_SUFFIX = ".atlas.json";
```

## `AUDIO_KIND`

_const_ in `project/kinds/audio.ts`

```ts
declare const AUDIO_KIND = "audio";
```

## `AssetBundle`

_type_ in `project/bundle.ts`

The blobs a scene (or the project's settings) needs loaded before it draws.

```ts
type AssetBundle = {
    bytes: number;
    /** Blobs to fetch, sorted by id. */
    entries: readonly BundleEntry[];
    /** The scene's id, or "project" for the project bundle. */
    name: string;
};
```

Refers to [`BundleEntry`](#bundleentry).

## `AssetEntry`

_type_ in `project/types.ts`

One registry entry as plain JSON. In the doc, `import` and `licence` are nested Y.Maps (per-field merge); the rest are atomic.

```ts
type AssetEntry = {
    bytes?: number;
    created: {
        at: number;
        by: string;
    };
    /** In the trash: the entry's doc or blob is kept so a restore brings it back. */
    deleted?: {
        at: number;
        by: string;
    };
    id: AssetId;
    /** Blob kinds: import settings. */
    import?: Record<string, unknown>;
    key: AssetKey;
    kind: AssetKindName;
    licence?: Licence;
    /** Blob kinds: what the kind's inspect derived; never hand-edited. */
    meta?: Record<string, unknown>;
    /** Display name; absent means the path's stem. */
    name?: string;
    path: AssetPath;
    /** Blob kinds: the current content. */
    sha256?: Sha256;
};
```

Refers to [`AssetId`](#assetid), [`AssetKey`](#assetkey), [`AssetKindName`](#assetkindname), [`AssetPath`](#assetpath), [`Licence`](#licence), [`Sha256`](#sha256).

## `AssetFile`

_type_ in `project/asset-files.ts`

One asset file as a host read it: its kind, the id it takes, its sidecar, and a binary's bytes.

```ts
type AssetFile = {
    /** A binary's hash and bytes; null for a doc kind's file. */
    blob: null | {
        data: Uint8Array;
        sha256: Sha256;
    };
    def: AssetKindDef;
    id: AssetId;
    path: AssetPath;
    sidecar: AssetSidecar | null;
};
```

Refers to [`AssetId`](#assetid), [`AssetKindDef`](#assetkinddef), [`AssetPath`](#assetpath), [`AssetSidecar`](#assetsidecar), [`Sha256`](#sha256).

## `AssetId`

_type_ in `project/types.ts`

An asset's id: ID_PATTERN, unique among the project's live assets; changed only by changeAssetId.

```ts
type AssetId = string;
```

## `AssetInfo`

_type_ in `project/asset-info.ts`

What headless code and the editor know of an asset without decoding or fetching it.

```ts
type AssetInfo = {
    bytes?: number;
    filter?: "linear" | "nearest";
    /** An atlas: its frame names in file order, its tags, its texture's id. */
    frames?: readonly string[];
    id: AssetId;
    kind: AssetKindName;
    nineSlice?: [
        number,
        number,
        number,
        number
    ];
    pivot?: [
        x: number,
        y: number
    ];
    /** An atlas frame's rectangle in its texture, px; only with `frame`. */
    rect?: {
        h: number;
        w: number;
        x: number;
        y: number;
    };
    sha256?: Sha256;
    /** Pixel size: a texture's, or with `frame`, the frame's. */
    size?: [
        w: number,
        h: number
    ];
    tags?: readonly {
        direction: string;
        from: number;
        name: string;
        to: number;
    }[];
    texture?: AssetId;
};
```

Refers to [`AssetId`](#assetid), [`AssetKindName`](#assetkindname), [`Sha256`](#sha256).

## `AssetKey`

_type_ in `project/types.ts`

An asset's registry key: never changes. Its first id for assets seeded from files, `randomKey()` for created ones.

```ts
type AssetKey = string;
```

## `AssetKindDef`

_type_ in `project/kinds/define.ts`

```ts
type AssetKindDef = BlobKindDef<any, any> | CodeKindDef | DocKindDef<any>;
```

Refers to [`BlobKindDef`](#blobkinddef), [`CodeKindDef`](#codekinddef), [`DocKindDef`](#dockinddef).

## `AssetKindName`

_type_ in `project/types.ts`

A kind's name: ID_PATTERN for the engine's, `<gameId>/<name>` for a game's.

```ts
type AssetKindName = string;
```

## `AssetMatch`

_type_ in `project/kinds/define.ts`

```ts
type AssetMatch = {
    /** For `.json` files: the value of the top-level "kind" field. */
    jsonKind?: string;
    /** File-name suffixes; the longest match across kinds wins. */
    suffixes?: readonly string[];
    /** Last resort for `.json` files with no "kind"; only the scene kind has one. */
    test?: (json: unknown) => boolean;
};
```

## `AssetPath`

_type_ in `project/types.ts`

Project-relative POSIX path including the file name: no leading "/", no
"." or ".." segments, no "\\", segments match /^[A-Za-z0-9._ -]{1,96}$/,
at most 255 characters. Case-sensitive, but two live paths that differ
only in case are `path-taken` (macOS and Windows checkouts).

```ts
type AssetPath = string;
```

## `AssetSidecar`

_type_ in `project/sidecar.ts`

A parsed sidecar; `key` is filled with `id` when the file omits it.

```ts
type AssetSidecar = {
    $schema?: string;
    /** Absent when kind detection gives the kind. */
    assetKind?: AssetKindName;
    bytes?: number;
    id: AssetId;
    import?: Record<string, unknown>;
    key: AssetKey;
    kind: "asset-sidecar";
    licence?: Licence;
    meta?: Record<string, unknown>;
    /** Display name; absent means the file's stem. */
    name?: string;
    sha256?: Sha256;
    v: 1;
};
```

Refers to [`AssetId`](#assetid), [`AssetKey`](#assetkey), [`AssetKindName`](#assetkindname), [`Licence`](#licence), [`Sha256`](#sha256).

## `AtlasDirection`

_type_ in `project/inspect/atlas.ts`

```ts
type AtlasDirection = "forward" | "pingpong" | "reverse";
```

## `AtlasFrame`

_type_ in `project/inspect/atlas.ts`

```ts
type AtlasFrame = {
    durationMs?: number;
    h: number;
    pivot?: [
        number,
        number
    ];
    w: number;
    x: number;
    y: number;
};
```

## `AtlasMeta`

_type_ in `project/kinds/atlas.ts`

```ts
type AtlasMeta = AtlasSheet & {
    tool: AtlasTool;
};
```

Refers to [`AtlasSheet`](#atlassheet), [`AtlasTool`](#atlastool).

## `AtlasSettings`

_type_ in `project/kinds/atlas.ts`

```ts
type AtlasSettings = {
    pivotDefault?: [
        number,
        number
    ];
    texture?: AssetId;
};
```

Refers to [`AssetId`](#assetid).

## `AtlasSheet`

_type_ in `project/inspect/atlas.ts`

What an atlas JSON yields: the atlas meta without its `tool`.

```ts
type AtlasSheet = {
    frames: Record<string, AtlasFrame>;
    /** Frame names in file order; tags and slice keys index into it. */
    order: string[];
    slices: AtlasSlice[];
    tags: AtlasTag[];
};
```

Refers to [`AtlasFrame`](#atlasframe), [`AtlasSlice`](#atlasslice), [`AtlasTag`](#atlastag).

## `AtlasSlice`

_type_ in `project/inspect/atlas.ts`

A slice's rectangle is relative to its frame; `center` is the nine-slice middle, [x, y, w, h].

```ts
type AtlasSlice = {
    center?: [
        number,
        number,
        number,
        number
    ];
    frame: string;
    h: number;
    name: string;
    w: number;
    x: number;
    y: number;
};
```

## `AtlasTag`

_type_ in `project/inspect/atlas.ts`

```ts
type AtlasTag = {
    direction: AtlasDirection;
    from: number;
    name: string;
    to: number;
};
```

Refers to [`AtlasDirection`](#atlasdirection).

## `AtlasTool`

_type_ in `project/kinds/atlas.ts`

```ts
type AtlasTool = "aseprite" | "texturepacker";
```

## `AudioMeta`

_type_ in `project/kinds/audio.ts`

```ts
type AudioMeta = {
    format: AudioFormat;
};
```

## `AudioSettings`

_type_ in `project/kinds/audio.ts`

```ts
type AudioSettings = Record<string, never>;
```

## `BlobInspect`

_type_ in `project/ops.ts`

What a blob op's inspection is given: the entry as the op leaves it (its hash, bytes, settings and path).

```ts
type BlobInspect = (kind: BlobKindDef, entry: AssetEntry) => InspectResult<unknown>;
```

Refers to [`AssetEntry`](#assetentry), [`BlobKindDef`](#blobkinddef), [`InspectResult`](#inspectresult).

## `BlobKindDef`

_type_ in `project/kinds/define.ts`

```ts
type BlobKindDef<M = unknown, S = unknown> = KindBase & {
    contentTypes: readonly string[];
    /** Pure and deterministic: the same bytes and settings give the same meta everywhere, from headers alone. */
    inspect(bytes: Uint8Array, settings: S, env: InspectEnv): InspectResult<M>;
    maxBytes: number;
    meta: z.ZodType<M>;
    refs?(entry: AssetEntry): readonly RefSite[];
    /** Import settings: every field optional with a default, so `{}` is valid. */
    settings: z.ZodType<S>;
    storage: "blob";
};
```

Refers to [`AssetEntry`](#assetentry), [`InspectEnv`](#inspectenv), [`InspectResult`](#inspectresult), [`RefSite`](#refsite).

## `BuildSceneVersionOptions`

_type_ in `project/scene-version.ts`

What `buildSceneVersion` reads.

```ts
type BuildSceneVersionOptions = {
    /** `project.build` for the code doing the build. */
    build: Readonly<Record<AssetKindName, Sha256>>;
    game: GameDefinition;
    registry: Registry;
    /** The release it will go live on; when given, `checkSceneVersion` runs and its issues are returned. */
    release?: ReleaseManifest;
    scene: AssetId;
    /**
     * Canonical texts by asset id (from docs or files): the scene, every doc
     * it reaches (its prefabs, materials, tables), and the game settings and
     * scene list it is read with.
     */
    texts: ReadonlyMap<AssetId, string>;
    view: ProjectView;
};
```

Refers to [`AssetId`](#assetid), [`AssetKindName`](#assetkindname), [`ProjectView`](#projectview), [`ReleaseManifest`](#releasemanifest), [`Sha256`](#sha256).

## `BuildSceneVersionResult`

_type_ in `project/scene-version.ts`

```ts
type BuildSceneVersionResult = {
    id: Sha256;
    issues: SceneIssue[];
    ok: true;
    /** The canonical texts it carries, by hash. */
    texts: ReadonlyMap<Sha256, string>;
    version: SceneVersion;
} | {
    issues: SceneIssue[];
    ok: false;
};
```

Refers to [`SceneVersion`](#sceneversion), [`Sha256`](#sha256).

## `BuildStamp`

_type_ in `project/types.ts`

One kind's schema hash as the newest build that wrote it saw it; a client with another hash and an older build is read-only on that kind.

```ts
type BuildStamp = {
    buildAt: number;
    engine: string;
    hash: Sha256;
};
```

Refers to [`Sha256`](#sha256).

## `BundleEntry`

_type_ in `project/bundle.ts`

One blob a bundle fetches.

```ts
type BundleEntry = {
    bytes: number;
    id: AssetId;
    kind: AssetKindName;
    sha256: Sha256;
};
```

Refers to [`AssetId`](#assetid), [`AssetKindName`](#assetkindname), [`Sha256`](#sha256).

## `CREDITS_FILE`

_const_ in `project/release.ts`

The credits page every build ships, next to its `index.html`.

```ts
declare const CREDITS_FILE = "credits.html";
```

## `CheckReleaseOptions`

_type_ in `project/release.ts`

```ts
type CheckReleaseOptions = {
    /**
     * `measureBudget` from `./export`. Given, `budget` must be what it
     * measures of `build.files` against `budget.limits`; a host without
     * `./export` leaves it out and the budget is taken as written.
     */
    measureBudget?: (files: readonly ReleaseFile[], content: ReleaseBudgetContent, limits: ExportBudget) => ExportBudgetReport;
};
```

Refers to [`ExportBudget`](#exportbudget), [`ExportBudgetReport`](#exportbudgetreport), [`ReleaseBudgetContent`](#releasebudgetcontent), [`ReleaseFile`](#releasefile).

## `CheckSceneVersionOptions`

_type_ in `project/scene-version.ts`

```ts
type CheckSceneVersionOptions = {
    names?: SceneVersionNames;
    /**
     * The game's registry, for finding the references in the carried scene and
     * prefabs (rule 7). Without it only what the engine's own types name is
     * found: the `assets` header, prefab instances and blobs' references.
     */
    registry?: Registry;
};
```

Refers to [`SceneVersionNames`](#sceneversionnames).

## `CodeKindDef`

_type_ in `project/kinds/define.ts`

Game code: listed read-only, never a doc.

```ts
type CodeKindDef = KindBase & {
    storage: "code";
};
```

## `CodeModuleInfo`

_type_ in `project/types.ts`

What a code module registers, as the tree and the Layers tab list it.

```ts
type CodeModuleInfo = {
    registers: {
        /** Collision groups it adds beside the engine's. */
        collisionGroups?: string[];
        kinds?: string[];
        /** Scene layers by name. */
        layers?: string[];
        materials?: string[];
        tables?: string[];
        types?: string[];
    };
};
```

## `ContentStore`

_type_ in `project/content-store.ts`

Bytes by content hash: dev keeps them in the cache dir, the site in object storage.

```ts
type ContentStore = {
    get(hash: Sha256): Promise<Uint8Array | null>;
    has(hash: Sha256): Promise<boolean>;
    /** Stores bytes and returns their hash; refuses with `hash-mismatch` when `expect` differs. */
    put(bytes: Uint8Array, expect?: Sha256): Promise<Sha256>;
};
```

Refers to [`Sha256`](#sha256).

## `ContentStoreError`

_class_ in `project/content-store.ts`

A store's refusal, carrying the issue (`hash-mismatch`) it was refused with.

```ts
declare class ContentStoreError extends Error {
    readonly issue: SceneIssue;
    constructor(issue: SceneIssue);
}
```

## `DATA_TABLE_KIND`

_const_ in `project/kinds/data-table.ts`

```ts
declare const DATA_TABLE_KIND = "data-table";
```

## `DATA_TABLE_SCHEMA_ID`

_const_ in `project/kinds/data-table.ts`

```ts
declare const DATA_TABLE_SCHEMA_ID = "urn:jams-engine:data-table:v2";
```

## `DATA_TABLE_VERSION`

_const_ in `project/kinds/data-table.ts`

```ts
declare const DATA_TABLE_VERSION = 2;
```

## `DOC_NAME_KINDS`

_const_ in `project/doc-names.ts`

```ts
declare const DOC_NAME_KINDS: readonly DocNameKind[];
```

Refers to [`DocNameKind`](#docnamekind).

## `DOC_NAME_MAX_LENGTH`

_const_ in `project/doc-names.ts`

The longest name of each kind: a 48-character project id, and a 48-character key after the dot.

```ts
declare const DOC_NAME_MAX_LENGTH: Readonly<Record<DocNameKind, number>>;
```

Refers to [`DocNameKind`](#docnamekind).

## `DataTableFile`

_type_ in `project/kinds/data-table.ts`

```ts
type DataTableFile = {
    $schema?: string;
    kind: typeof DATA_TABLE_KIND;
    rows: DataTableRow[];
    table: string;
    v: typeof DATA_TABLE_VERSION;
};
```

Refers to [`DATA_TABLE_KIND`](#data_table_kind), [`DATA_TABLE_VERSION`](#data_table_version), [`DataTableRow`](#datatablerow).

## `DataTableRow`

_type_ in `project/kinds/data-table.ts`

```ts
type DataTableRow = Record<string, unknown> & {
    id: string;
};
```

## `DocKindDef`

_type_ in `project/kinds/define.ts`

```ts
type DocKindDef<J = unknown> = KindBase & {
    /** What createAsset writes when the op carries no content. */
    empty(env: KindEnv, init: {
        id: AssetId;
    }): J;
    /** Canonical text; default `canonicalJson(value, layout)`. Must not depend on the registry. */
    format?(value: J): string;
    /** The id a file of this kind declares itself, when it has one (prefabs: "id"). */
    idField?: string;
    /** "custom" only for the engine's scene and prefab kinds, whose codecs are in ./collab. */
    layout: "custom" | DocLayout;
    /** Per-doc caps; the hosted service enforces them. */
    limits?: {
        maxItems?: number;
        maxStateBytes: number;
    };
    migrations?: Readonly<Record<number, Migration>>;
    /**
     * Reads text or a parsed value, migrations included, in place of
     * `parseAssetDoc`'s JSON, `v` and schema steps. Only the engine's custom
     * kinds have one: they wrap the scene and prefab parsers. Never throws.
     */
    parse?(input: unknown, env: KindEnv): ParseAssetResult<J>;
    /**
     * 1 when a project holds at most one asset of this kind: the first live
     * one by path is in effect, a later one reports `asset-kind`, and an op
     * that would add a second is refused.
     */
    perProject?: 1;
    /** How a one-per-project kind's issues name its asset; defaults from `kind`. */
    perProjectWords?: PerProjectWords;
    /** Doc name prefix; only the scene kind uses "scene". */
    prefix?: "asset" | "scene";
    /** Outgoing references: every place the value names another asset. */
    refs?(value: J, env: KindEnv): readonly RefSite[];
    /** Judges a parsed, migrated value; may depend on the registry (a table's row schema). */
    schema(env: KindEnv): z.ZodType<J>;
    /** The kind's JSON Schema `$id`, e.g. "urn:jams-engine:material:v1". */
    schemaId: string;
    storage: "doc";
    /** Issues beyond the schema's; never throws. */
    validate?(value: J, env: KindEnv): readonly SceneIssue[];
    /** The file format's current `v`; files carry it as "v". */
    version: number;
};
```

Refers to [`AssetId`](#assetid), [`DocLayout`](#doclayout), [`KindEnv`](#kindenv), [`ParseAssetResult`](#parseassetresult), [`PerProjectWords`](#perprojectwords), [`RefSite`](#refsite).

## `DocLayout`

_type_ in `project/kinds/define.ts`

How a doc kind's canonical JSON lives in Yjs. The root is always a `map`;
the engine derives the doc codec and the merge behaviour from it, so a
game never writes Yjs code.

```ts
type DocLayout = /** One value; concurrent writes: last writer wins. */ {
    as: "atomic";
} | {
    as: "keyed";
    id?: string;
    item: Extract<DocLayout, {
        as: "map";
    }>;
} | {
    as: "list";
    item: DocLayout;
} | {
    as: "map";
    fields?: Readonly<Record<string, DocLayout>>;
    rest?: DocLayout;
} | {
    as: "text";
};
```

## `DocName`

_type_ in `project/doc-names.ts`

Sync doc names: `project:<project>` for a project's registry,
`scene:<project>.<key>` for a scene and `asset:<project>.<key>` for every
other doc kind. Names use the asset's key, which never changes, so
changing an asset's id never renames its doc.

```ts
type DocName = {
    key: AssetKey;
    kind: "asset";
    project: ProjectId;
} | {
    key: AssetKey;
    kind: "scene";
    project: ProjectId;
} | {
    kind: "project";
    project: ProjectId;
};
```

Refers to [`AssetKey`](#assetkey), [`ProjectId`](#projectid).

## `DocNameKind`

_type_ in `project/doc-names.ts`

```ts
type DocNameKind = DocName["kind"];
```

Refers to [`DocName`](#docname).

## `ENGINE_ASSET_KINDS`

_const_ in `project/kinds/index.ts`

The engine's asset kinds, in the order a kind registry lists them before a game's.

```ts
declare const ENGINE_ASSET_KINDS: readonly AssetKindDef[];
```

Refers to [`AssetKindDef`](#assetkinddef).

## `EditSceneOp`

_type_ in `project/ops.ts`

```ts
type EditSceneOp = Extract<ProjectOp, {
    op: "editScene";
}>;
```

Refers to [`ProjectOp`](#projectop).

## `ExportBudget`

_type_ in `project/release.ts`

```ts
type ExportBudget = {
    /** JS and CSS, without wasm. */
    codeBytes: number;
    fileBytes: number;
    /** Code, wasm when needed, the project bundle and the start scene's bundle: what the first frame waits for. */
    firstLoadBytes: number;
    totalBytes: number;
};
```

## `ExportBudgetReport`

_type_ in `project/release.ts`

```ts
type ExportBudgetReport = {
    limits: ExportBudget;
    measured: {
        assetBytes: number;
        codeBytes: number;
        dataBytes: number;
        firstLoadBytes: number;
        largestFile: {
            bytes: number;
            path: string;
        };
        totalBytes: number;
        wasmBytes: number;
    };
    /** The budgets exceeded, in `ExportBudget`'s order; empty when within all. */
    over: readonly (keyof ExportBudget)[];
};
```

Refers to [`ExportBudget`](#exportbudget).

## `FONT_KIND`

_const_ in `project/kinds/font.ts`

```ts
declare const FONT_KIND = "font";
```

## `FontFormat`

_type_ in `project/kinds/font.ts`

```ts
type FontFormat = "bmfont" | WebFontFormat;
```

## `FontMeta`

_type_ in `project/kinds/font.ts`

```ts
type FontMeta = {
    format: FontFormat;
    lineHeight?: number;
    pages?: AssetPath[];
};
```

Refers to [`AssetPath`](#assetpath), [`FontFormat`](#fontformat).

## `FontSettings`

_type_ in `project/kinds/font.ts`

```ts
type FontSettings = {
    pages?: AssetId[];
};
```

Refers to [`AssetId`](#assetid).

## `GAME_SETTINGS_KIND`

_const_ in `project/kinds/game-settings.ts`

```ts
declare const GAME_SETTINGS_KIND = "game-settings";
```

## `GAME_SETTINGS_SCHEMA_ID`

_const_ in `project/kinds/game-settings.ts`

```ts
declare const GAME_SETTINGS_SCHEMA_ID = "urn:jams-engine:game-settings:v2";
```

## `GAME_SETTINGS_VERSION`

_const_ in `project/kinds/game-settings.ts`

```ts
declare const GAME_SETTINGS_VERSION = 2;
```

## `GameSettingsEngine`

_type_ in `project/kinds/game-settings.ts`

The engine's project-wide settings: each beats the game's default and loses to a scene's own.

```ts
type GameSettingsEngine = {
    gravity?: GameWorldDef["gravity"];
    physics?: GameWorldDef["physics"];
    resolution?: Partial<ResolutionPolicy>;
    /** Ticks per second for every scene; checked by the kind's `validate`, not the schema. */
    tickRate?: number;
};
```

## `GameSettingsFile`

_type_ in `project/kinds/game-settings.ts`

```ts
type GameSettingsFile = {
    $schema?: string;
    engine: GameSettingsEngine;
    game: Record<string, unknown>;
    kind: typeof GAME_SETTINGS_KIND;
    v: typeof GAME_SETTINGS_VERSION;
};
```

Refers to [`GAME_SETTINGS_KIND`](#game_settings_kind), [`GAME_SETTINGS_VERSION`](#game_settings_version), [`GameSettingsEngine`](#gamesettingsengine).

## `GlobMatch`

_type_ in `project/asset-files.ts`

A POSIX glob test, such as `node:path`'s `matchesGlob`.

```ts
type GlobMatch = (path: string, glob: string) => boolean;
```

## `HashHistoryEntry`

_type_ in `project/types.ts`

One record in a blob asset's hash history, oldest first. A hash gets an
entry when the asset first takes it and again each time it is replaced,
so a hash's newest `at` is when it last stopped being current (or first
became current, while it still is).

```ts
type HashHistoryEntry = {
    at: number;
    by: string;
    bytes: number;
    sha256: Sha256;
};
```

Refers to [`Sha256`](#sha256).

## `HeldFile`

_type_ in `project/runtime-view.ts`

A project file as a host holds it in memory: a doc's parsed JSON, or a binary's sidecar alone.

```ts
type HeldFile = {
    /** A doc's JSON; absent for a binary, whose sidecar carries its hash, size, import settings and meta. */
    json?: unknown;
    /** Project-relative. */
    path: AssetPath;
    sidecar?: AssetSidecar | null;
};
```

Refers to [`AssetPath`](#assetpath), [`AssetSidecar`](#assetsidecar).

## `HeldProject`

_type_ in `project/runtime-view.ts`

A project read from held files: the view and kinds bundles are computed over, and what its game reads.

```ts
type HeldProject = {
    kinds: KindRegistry;
    runtime: ProjectRuntimeView;
    view: ProjectView;
};
```

Refers to [`KindRegistry`](#kindregistry), [`ProjectRuntimeView`](#projectruntimeview), [`ProjectView`](#projectview).

## `INDEX_HTML_FILE`

_const_ in `project/release.ts`

The page every build opens at.

```ts
declare const INDEX_HTML_FILE = "index.html";
```

## `INPUT_MAP_KIND`

_const_ in `project/kinds/input-map.ts`

```ts
declare const INPUT_MAP_KIND = "input-map";
```

## `INPUT_MAP_SCHEMA_ID`

_const_ in `project/kinds/input-map.ts`

```ts
declare const INPUT_MAP_SCHEMA_ID = "urn:jams-engine:input-map:v1";
```

## `INPUT_MAP_VERSION`

_const_ in `project/kinds/input-map.ts`

```ts
declare const INPUT_MAP_VERSION = 1;
```

## `INPUT_SCRIPT_SUFFIX`

_const_ in `project/kinds/input-script.ts`

```ts
declare const INPUT_SCRIPT_SUFFIX = ".script.json";
```

## `ImageSize`

_type_ in `project/inspect/bytes.ts`

Pixel dimensions read from an image header.

```ts
type ImageSize = {
    height: number;
    width: number;
};
```

## `InputMapFile`

_type_ in `project/kinds/input-map.ts`

The project's input map: one per project, merged per action and binding.

```ts
type InputMapFile = {
    $schema?: string;
    /** Each replaces the game's bindings for its action whole; actions it omits keep the game's. */
    actions?: {
        action: string;
        bindings: Binding[];
        kind?: ActionKind;
    }[];
    /** Radial stick deadzone, 0…1. */
    deadzone?: number;
    kind: typeof INPUT_MAP_KIND;
    players?: PlayersDef;
    touch?: InputMapTouchControl[];
    v: typeof INPUT_MAP_VERSION;
};
```

Refers to [`INPUT_MAP_KIND`](#input_map_kind), [`INPUT_MAP_VERSION`](#input_map_version), [`InputMapTouchControl`](#inputmaptouchcontrol).

## `InputMapProblem`

_type_ in `project/kinds/input-map.ts`

One thing wrong with an input map; `at` is the JSON path of the offending value inside the file.

```ts
type InputMapProblem = Omit<BindingProblem, "path"> & {
    at: (number | string)[];
};
```

## `InputMapTouchControl`

_type_ in `project/kinds/input-map.ts`

An on-screen control as the input map declares it; `at` and `radius` are fractions of the canvas's shorter side.

```ts
type InputMapTouchControl = {
    action: string;
    at: [
        x: number,
        y: number
    ];
    id: string;
    kind: "button" | "dpad" | "stick";
    label?: string;
    radius: number;
};
```

## `InspectEnv`

_type_ in `project/kinds/define.ts`

```ts
type InspectEnv = {
    /** The asset id at a project path, for references a file makes by name (an atlas's image). */
    idAt(path: AssetPath): AssetId | undefined;
    /** The path of the asset being inspected. */
    path: AssetPath;
};
```

Refers to [`AssetId`](#assetid), [`AssetPath`](#assetpath).

## `InspectResult`

_type_ in `project/kinds/define.ts`

```ts
type InspectResult<M> = {
    import?: Record<string, unknown>;
    meta: M;
    ok: true;
} | {
    issue: SceneIssue;
    ok: false;
};
```

## `JsonEdit`

_type_ in `project/ops.ts`

```ts
type JsonEdit = {
    before?: number | string;
    insert: JsonPointer;
    value: unknown;
} | {
    remove: JsonPointer;
} | {
    set: JsonPointer;
    value: unknown;
} | {
    unset: JsonPointer;
};
```

Refers to [`JsonPointer`](#jsonpointer).

## `JsonEditResult`

_type_ in `project/json-edit.ts`

```ts
type JsonEditResult = {
    index: number;
    issue: SceneIssue;
    ok: false;
} | {
    ok: true;
    value: unknown;
};
```

## `JsonPointer`

_type_ in `project/ops.ts`

RFC 6901 pointer into a doc kind's canonical JSON; a segment "@<id>" picks a keyed item by id.

```ts
type JsonPointer = string;
```

## `KindEnv`

_type_ in `project/kinds/define.ts`

What a kind's schema, defaults and checks may depend on.

```ts
type KindEnv = {
    /**
     * The project's input map as a run reads it (`kindInputMap`), for a host
     * that holds its doc: an input script's tracks drive the seats its
     * `players` give, over the game's.
     */
    inputMap?: Pick<InputMapFile, "players"> | null;
    /**
     * The project's prefabs by id, parsed, for a host that holds their docs:
     * a scene or prefab migration reads the fields its instances override.
     */
    prefab?: MigrateEnv["prefab"];
    project: ProjectView | null;
    registry: Registry;
};
```

Refers to [`InputMapFile`](#inputmapfile), [`ProjectView`](#projectview).

## `KindRegistry`

_type_ in `project/kinds.ts`

```ts
type KindRegistry = {
    /**
     * The kind of a file, in order: the sidecar's kind, the longest matching
     * suffix, a `.json` file's top-level `kind`, a kind's `test`. Null when
     * the file isn't an asset, is always skipped (`isSkippedAssetPath`), or
     * its sidecar names a kind this registry doesn't have.
     */
    detect(path: AssetPath, json?: unknown, sidecarKind?: string): AssetKindDef | null;
    get(kind: AssetKindName): AssetKindDef | undefined;
    list(): readonly AssetKindDef[];
    /** Per-kind JSON Schema hash for code skew. */
    schemaHashes(env: KindEnv): Promise<Readonly<Record<AssetKindName, Sha256>>>;
};
```

Refers to [`AssetKindDef`](#assetkinddef), [`AssetKindName`](#assetkindname), [`AssetPath`](#assetpath), [`KindEnv`](#kindenv), [`Sha256`](#sha256).

## `Licence`

_type_ in `project/types.ts`

```ts
type Licence = {
    /** The exact credit line the licence asks for; the credits page prints it. */
    attribution?: string;
    author?: string;
    /** Where it came from: a URL or a description. */
    source?: string;
    /** An SPDX id ("CC-BY-4.0") or "proprietary". */
    spdx?: string;
};
```

## `LiveCompat`

_type_ in `project/scene-version.ts`

What a release must match for a scene version to go live on it.

```ts
type LiveCompat = {
    /** The per-kind schema hashes of the code that checked the version: `project.build`. */
    build: Readonly<Record<AssetKindName, Sha256>>;
    /** From `engine.formats`. */
    formats: {
        prefab: number;
        scene: number;
    };
    game: {
        configHash: null | string;
        id: string;
    };
};
```

Refers to [`AssetKindName`](#assetkindname), [`Sha256`](#sha256).

## `MATERIAL_KIND`

_const_ in `project/kinds/material.ts`

```ts
declare const MATERIAL_KIND = "material";
```

## `MATERIAL_SCHEMA_ID`

_const_ in `project/kinds/material.ts`

```ts
declare const MATERIAL_SCHEMA_ID = "urn:jams-engine:material:v2";
```

## `MATERIAL_VERSION`

_const_ in `project/kinds/material.ts`

```ts
declare const MATERIAL_VERSION = 2;
```

## `MaterialFile`

_type_ in `project/kinds/material.ts`

```ts
type MaterialFile = z.infer<typeof materialSchema>;
```

Refers to [`materialSchema`](#materialschema).

## `PREFAB_SCENE_OPS`

_const_ in `project/ops.ts`

Scene ops that write prefab docs; an `editScene` holding one goes to the project's prefab writer.

```ts
declare const PREFAB_SCENE_OPS: readonly SceneOp["op"][];
```

## `PROJECT_FILE`

_const_ in `project/types.ts`

The file at a project's root that names it, its game module and which files are assets and code. Never co-edited.

```ts
declare const PROJECT_FILE = "jams.project.json";
```

## `PROJECT_FILE_DEFAULTS`

_const_ in `project/project-file.ts`

What an omitted `assets` or `code` means.

```ts
declare const PROJECT_FILE_DEFAULTS: {
    readonly assets: [
        "**"
    ];
    readonly code: [
        "**/*.ts",
        "**/*.tsx"
    ];
};
```

## `PROJECT_FILE_VERSION`

_const_ in `project/project-file.ts`

The project file format version, the `v` every `jams.project.json` carries.

```ts
declare const PROJECT_FILE_VERSION = 1;
```

## `PROJECT_OPS_SCHEMA_ID`

_const_ in `project/ops.ts`

`urn:jams-engine:project-ops:v1`. Project ops are game-agnostic, so there is one schema.

```ts
declare const PROJECT_OPS_SCHEMA_ID = "urn:jams-engine:project-ops:v1";
```

## `PROJECT_OP_NAMES`

_const_ in `project/ops.ts`

```ts
declare const PROJECT_OP_NAMES: readonly [
    "createAsset",
    "importAsset",
    "renameAsset",
    "moveAsset",
    "deleteAsset",
    "restoreAsset",
    "purgeAsset",
    "changeAssetId",
    "setImport",
    "replaceContent",
    "setLicence",
    "editAsset",
    "editScene"
];
```

## `PROJECT_SCHEMA_ID`

_const_ in `project/project-file.ts`

`urn:jams-engine:project:v1`. The project file is game-agnostic, so there is one schema.

```ts
declare const PROJECT_SCHEMA_ID = "urn:jams-engine:project:v1";
```

## `PROJECT_SNAPSHOT_SCHEMA_ID`

_const_ in `project/snapshot.ts`

`urn:jams-engine:project-snapshot:v1`.

```ts
declare const PROJECT_SNAPSHOT_SCHEMA_ID = "urn:jams-engine:project-snapshot:v1";
```

## `PROJECT_SNAPSHOT_VERSION`

_const_ in `project/snapshot.ts`

The snapshot format version, the `v` every snapshot carries.

```ts
declare const PROJECT_SNAPSHOT_VERSION = 1;
```

## `ParseAssetResult`

_type_ in `project/kinds/define.ts`

A doc kind's file read: its migrated value, or the issues that refuse it.

```ts
type ParseAssetResult<J = unknown> = {
    issues: SceneIssue[];
    migratedFrom?: number;
    ok: true;
    value: J;
} | {
    issues: SceneIssue[];
    ok: false;
};
```

## `ParseProjectFileResult`

_type_ in `project/project-file.ts`

```ts
type ParseProjectFileResult = {
    file: ProjectFile;
    ok: true;
} | {
    issues: SceneIssue[];
    ok: false;
};
```

Refers to [`ProjectFile`](#projectfile).

## `ParseProjectSnapshotResult`

_type_ in `project/snapshot.ts`

```ts
type ParseProjectSnapshotResult = {
    issues: SceneIssue[];
    ok: false;
} | {
    ok: true;
    snapshot: ProjectSnapshot;
};
```

Refers to [`ProjectSnapshot`](#projectsnapshot).

## `ParseReleaseManifestResult`

_type_ in `project/release.ts`

```ts
type ParseReleaseManifestResult = {
    issues: SceneIssue[];
    ok: false;
} | {
    manifest: ReleaseManifest;
    ok: true;
};
```

Refers to [`ReleaseManifest`](#releasemanifest).

## `ParseSidecarResult`

_type_ in `project/sidecar.ts`

```ts
type ParseSidecarResult = {
    issues: SceneIssue[];
    ok: false;
} | {
    ok: true;
    sidecar: AssetSidecar;
};
```

Refers to [`AssetSidecar`](#assetsidecar).

## `PerProjectWords`

_type_ in `project/kinds/define.ts`

The words a one-per-project kind's `asset-kind` issues use.

```ts
type PerProjectWords = {
    /** What the hint moves into the first one: default "contents". */
    contents?: string;
    /** After "the project already has its": default `noun`. */
    held?: string;
    /** After "a second": default `<kind> asset`. */
    noun: string;
};
```

## `PointerRead`

_type_ in `project/json-edit.ts`

```ts
type PointerRead = {
    issue: SceneIssue;
    ok: false;
} | {
    layout: DocLayout;
    ok: true;
    value: unknown;
};
```

Refers to [`DocLayout`](#doclayout).

## `ProjectApplyResult`

_type_ in `project/ops.ts`

```ts
type ProjectApplyResult = {
    created: AssetId[];
    /** Doc names written, in write order. */
    docs: string[];
    /** The project log entry, when the batch wrote more than one doc. */
    entry?: ProjectLogEntry;
    /** Issues the batch leaves (warnings and errors on the result, as applyOps reports). */
    issues: SceneIssue[];
    ok: true;
} | {
    issue: SceneIssue;
    ok: false;
    opIndex: number;
};
```

Refers to [`AssetId`](#assetid).

## `ProjectBatchCheck`

_type_ in `project/ops.ts`

A batch applied to plain JSON: the registry and doc values it would leave, before anything is written.

```ts
type ProjectBatchCheck = {
    created: AssetId[];
    /** Indices of the `editScene` ops `prefabEdit` accepted; the caller writes those. */
    delegated: number[];
    issues: SceneIssue[];
    ok: true;
    /** Keys of the trashed entries removed for good, with their hash history; a batch with any can't be undone. */
    purged: AssetKey[];
    /** The batch changes the registry, so the project doc is written first. */
    registry: boolean;
    /** The scene docs among `written`, with the scene ops that reach each (a `changeAssetId`'s rewrites included). */
    scenes: ReadonlyMap<AssetKey, SceneWrite>;
    state: ProjectState;
    /** Every touched doc asset's value after the batch, by key. */
    values: ReadonlyMap<AssetKey, unknown>;
    /** Keys of the asset and scene docs the batch writes, in write order. */
    written: AssetKey[];
    /** The index of the op that first wrote each key of `written`. */
    writtenBy: ReadonlyMap<AssetKey, number>;
} | {
    issue: SceneIssue;
    ok: false;
    opIndex: number;
};
```

Refers to [`AssetId`](#assetid), [`AssetKey`](#assetkey), [`ProjectState`](#projectstate), [`SceneWrite`](#scenewrite).

## `ProjectBatchEnv`

_type_ in `project/ops.ts`

What checking a batch needs beside the state: the kinds, who and when for `created` and `deleted` stamps, and new keys.

```ts
type ProjectBatchEnv = {
    by: string;
    /**
     * Derives a blob entry's `meta` (and any import settings the file names)
     * when an op changes its content or settings; the host looks the bytes up
     * by `entry.sha256`. Without it the entry's `meta` is dropped when its
     * hash changes and kept otherwise, for the host to fill.
     */
    inspect?: BlobInspect;
    kinds: KindRegistry;
    /** New registry keys: collab's `randomKey` live, `sequentialKeys` in tests. */
    newKey: () => AssetKey;
    now: number;
    /**
     * Judges an `editScene` that writes prefab docs (`writesPrefabs`): the
     * project session's prefab writer. Null accepts the op and leaves its
     * writing to the caller; without this hook such ops are refused with
     * `op-invalid`. A `changeAssetId` whose referrers include prefabs asks
     * here too, once per prefab, with the rewrite as an `editScene` of its
     * own and `index` the `changeAssetId`'s.
     */
    prefabEdit?: (op: EditSceneOp, ctx: {
        entry: AssetEntry;
        index: number;
    }) => SceneIssue | null;
    /** The prefabs a scene's instances resolve against, by the scene's asset id. */
    prefabsFor?: (scene: AssetId) => PrefabLibrary;
    registry: Registry;
};
```

Refers to [`AssetEntry`](#assetentry), [`AssetId`](#assetid), [`AssetKey`](#assetkey), [`BlobInspect`](#blobinspect), [`EditSceneOp`](#editsceneop), [`KindRegistry`](#kindregistry).

## `ProjectBundle`

_type_ in `project/snapshot.ts`

Files and their bytes: what push uploads and pull writes.

```ts
type ProjectBundle = {
    /** Binary files by path, as content hashes; bytes travel through the content store. */
    blobs: Readonly<Record<AssetPath, Sha256>>;
    project: ProjectFile;
    /** Sidecars by the path of their asset. */
    sidecars: Readonly<Record<AssetPath, string>>;
    /** Text files by path, canonical text. */
    texts: Readonly<Record<AssetPath, string>>;
};
```

Refers to [`AssetPath`](#assetpath), [`ProjectFile`](#projectfile), [`Sha256`](#sha256).

## `ProjectExport`

_type_ in `project/types.ts`

The project file's `export` block.

```ts
type ProjectExport = {
    /** `#rrggbb`. */
    background?: string;
    /** Overrides of `DEFAULT_EXPORT_BUDGET`, in bytes. */
    budget?: Partial<ExportBudget>;
    /** Default "fullscreen". */
    display?: "fullscreen" | "minimal-ui" | "standalone";
    /** Texture asset ids, checked by meta: exactly 192×192 and 512×512 PNGs. Omitted: the engine's default icons. */
    icons?: {
        "192"?: AssetId;
        "512"?: AssetId;
    };
    /** Default from the resolution policy's aspect, else "any". */
    orientation?: "any" | "landscape" | "portrait";
    /** Off: no service worker even for the web target. Default true. */
    pwa?: boolean;
    /** Which Rapier package ships when a listed scene needs it; default "standard". */
    rapier?: "compat" | "standard";
    /** The installed app's short name; default the project's `name`. */
    shortName?: string;
    /** `#rrggbb`. */
    themeColor?: string;
};
```

Refers to [`AssetId`](#assetid), [`ExportBudget`](#exportbudget).

## `ProjectFile`

_type_ in `project/types.ts`

```ts
type ProjectFile = {
    $schema?: string;
    /** Globs of files that may be assets; default ["**"]. */
    assets?: string[];
    /** Globs of code modules the tree lists read-only; default ["**\/*.ts", "**\/*.tsx"]. */
    code?: string[];
    /** How `game build` exports the project; every field has a default. Git-only, never co-edited. */
    export?: ProjectExport;
    /** The module that exports the GameDefinition, relative to this file; null for an engine-only project. */
    game: null | {
        export: string;
        module: string;
    };
    id: ProjectId;
    /** Extra excludes beside the fixed ones (`*.schema.json`, `*.asset.json`, the project file, `__tests__`, `node_modules`, `dist`). */
    ignore?: string[];
    kind: "project";
    name: string;
    /** The module that exports the game's DOM UI (a `MountUi`), relative to this file; hosts mount it, the CLI never imports it. */
    ui?: {
        export: string;
        module: string;
    };
    v: 1;
};
```

Refers to [`ProjectExport`](#projectexport), [`ProjectId`](#projectid).

## `ProjectId`

_type_ in `project/types.ts`

A project's id: ID_PATTERN (`/^[a-z0-9][a-z0-9-]{0,47}$/`), unique on the site.

```ts
type ProjectId = string;
```

## `ProjectOp`

_type_ in `project/ops.ts`

```ts
type ProjectOp = {
    bytes: number;
    id: AssetId;
    op: "replaceContent";
    sha256: Sha256;
} | {
    bytes: number;
    id?: AssetId;
    kind?: AssetKindName;
    licence?: Licence;
    op: "importAsset";
    path: AssetPath;
    settings?: Record<string, unknown>;
    sha256: Sha256;
} | /** A text asset. `content` is its canonical JSON (default `kind.empty`); `path` may be a folder ending in "/" to get `<id><extension>`. */ {
    content?: unknown;
    id?: AssetId;
    kind: AssetKindName;
    licence?: Licence;
    op: "createAsset";
    path: AssetPath;
} | {
    edits: JsonEdit[];
    id: AssetId;
    op: "editAsset";
} | {
    file?: string;
    id: AssetId;
    name?: null | string;
    op: "renameAsset";
} | {
    force?: boolean;
    id: AssetId;
    op: "deleteAsset";
} | {
    id: AssetId;
    licence: Licence | null;
    op: "setLicence";
} | {
    id: AssetId;
    op: "changeAssetId";
    to: AssetId;
} | {
    id: AssetId;
    op: "editScene";
    ops: SceneOp[];
} | {
    id: AssetId;
    op: "purgeAsset";
} | {
    id: AssetId;
    op: "restoreAsset";
} | {
    id: AssetId;
    op: "setImport";
    set: Record<string, unknown>;
} | {
    ids: AssetId[];
    op: "moveAsset";
    to: string;
};
```

Refers to [`AssetId`](#assetid), [`AssetKindName`](#assetkindname), [`AssetPath`](#assetpath), [`JsonEdit`](#jsonedit), [`Licence`](#licence), [`Sha256`](#sha256).

## `ProjectOpBatch`

_type_ in `project/ops.ts`

```ts
type ProjectOpBatch = {
    /** File batches only: the project snapshot hash the batch was written against (stale → exit 3). */
    base?: Sha256;
    label?: string;
    ops: ProjectOp[];
    v: 1;
};
```

Refers to [`ProjectOp`](#projectop), [`Sha256`](#sha256).

## `ProjectOpName`

_type_ in `project/ops.ts`

```ts
type ProjectOpName = ProjectOp["op"];
```

Refers to [`ProjectOp`](#projectop).

## `ProjectPathMatcher`

_type_ in `project/asset-files.ts`

Which project-relative paths a project file makes assets and code modules.

```ts
type ProjectPathMatcher = {
    /** Under the asset globs, outside their `!` excludes, `ignore` and `isSkippedAssetPath`. */
    isAsset: (path: AssetPath) => boolean;
    /** Under the code globs, outside their `!` excludes and `ignore`. */
    isCode: (path: string) => boolean;
};
```

Refers to [`AssetPath`](#assetpath).

## `ProjectRuntimeView`

_type_ in `project/runtime-view.ts`

What game code reads of its project, as of load and frozen for the run.

```ts
type ProjectRuntimeView = {
    /** What `assetInfo` gives for a blob asset, frozen at load; undefined for an unknown id, a doc asset or an unknown frame. */
    asset(id: AssetId, frame?: string): AssetInfo | undefined;
    /** game-settings' `engine` block as written (`resolution` and the like); empty without one. */
    engine: Readonly<Record<string, unknown>>;
    /**
     * The project's scene list, the first by path: the start scene and the
     * listed scenes in order, a repeated scene's later entries left out;
     * `{ start: null, scenes: [] }` without one. `runtimeView` always sets it.
     */
    flow?: SceneListFlow;
    /**
     * The project's input map, the first by path: the bindings layer between
     * the host's and the game's. Seats, actions and touch controls it gets
     * wrong are left out, so those keep the game's; null without one.
     */
    inputMap: InputMapFile | null;
    /** game-settings' `game` block, defaults applied. */
    settings: Readonly<Record<string, unknown>>;
    /** Rows of a table, merged across its assets in path order. */
    table(name: string): readonly Readonly<Record<string, unknown> & {
        id: string;
    }>[];
};
```

Refers to [`AssetId`](#assetid), [`AssetInfo`](#assetinfo), [`InputMapFile`](#inputmapfile), [`SceneListFlow`](#scenelistflow).

## `ProjectSnapshot`

_type_ in `project/snapshot.ts`

A project pinned by content: reproducible from files, since it holds hashes of canonical texts and blobs, never doc states.

```ts
type ProjectSnapshot = {
    $schema?: string;
    /** Every live asset: docs by the SHA-256 of their canonical text, blobs by their content hash, size, import settings and meta. */
    assets: Readonly<Record<AssetId, SnapshotAsset>>;
    /** Wall clock; not part of `hash`. */
    at: number;
    build: Readonly<Record<AssetKindName, Sha256>>;
    /** ENGINE_VERSION of the writer. */
    engine: string;
    /** sha256(stableJson(everything above except `at` and `$schema`)). */
    hash: Sha256;
    kind: "project-snapshot";
    project: ProjectId;
    v: 1;
};
```

Refers to [`AssetId`](#assetid), [`AssetKindName`](#assetkindname), [`ProjectId`](#projectid), [`Sha256`](#sha256), [`SnapshotAsset`](#snapshotasset).

## `ProjectState`

_type_ in `project/types.ts`

Plain-JSON state of a project doc; what `./project` functions take.

```ts
type ProjectState = {
    assets: Readonly<Record<AssetKey, AssetEntry>>;
    build: Readonly<Record<AssetKindName, BuildStamp>>;
    code: Readonly<Record<string, CodeModuleInfo>>;
    history: Readonly<Record<AssetKey, readonly HashHistoryEntry[]>>;
    meta: {
        layout: number;
        name: string;
        projectId: ProjectId;
    };
};
```

Refers to [`AssetEntry`](#assetentry), [`AssetKey`](#assetkey), [`AssetKindName`](#assetkindname), [`BuildStamp`](#buildstamp), [`CodeModuleInfo`](#codemoduleinfo), [`HashHistoryEntry`](#hashhistoryentry), [`ProjectId`](#projectid).

## `ProjectTreeNode`

_type_ in `project/types.ts`

```ts
type ProjectTreeNode = {
    children: ProjectTreeNode[];
    path: string;
    type: "folder";
} | {
    entry: AssetEntry;
    type: "asset";
} | {
    info: CodeModuleInfo;
    path: string;
    type: "code";
};
```

Refers to [`AssetEntry`](#assetentry), [`CodeModuleInfo`](#codemoduleinfo).

## `ProjectUsage`

_type_ in `project/usage.ts`

```ts
type ProjectUsage = {
    blobBytes: number;
    blobs: number;
    docBytes: number;
    docs: number;
    trashBytes: number;
};
```

## `ProjectView`

_type_ in `project/types.ts`

The resolved view every reader uses.

```ts
type ProjectView = {
    /** Live entries by id; for a duplicated id, the first by (created.at, key). */
    byId: ReadonlyMap<AssetId, AssetEntry>;
    byKey: ReadonlyMap<AssetKey, AssetEntry>;
    byPath: ReadonlyMap<AssetPath, AssetEntry>;
    deleted: readonly AssetEntry[];
    /**
     * The game-settings asset's `engine` block, set by a reader that holds its
     * doc (`projectView` alone reads no docs). Validation resolves a scene's
     * physics and grid through it, as Play does.
     */
    engine?: Readonly<Record<string, unknown>>;
    /** `asset-id-taken`, `path-taken`, `asset-kind` (an unregistered kind), with keys in `entityIds`. */
    issues: readonly SceneIssue[];
    /** The repairs a server would write: key → { id?, path? }. */
    repairs: ReadonlyMap<AssetKey, {
        id?: AssetId;
        path?: AssetPath;
    }>;
    state: ProjectState;
    tree(): ProjectTreeNode[];
};
```

Refers to [`AssetEntry`](#assetentry), [`AssetId`](#assetid), [`AssetKey`](#assetkey), [`AssetPath`](#assetpath), [`ProjectState`](#projectstate), [`ProjectTreeNode`](#projecttreenode).

## `QuotaPolicy`

_type_ in `project/usage.ts`

Checked at blob upload and at asset-doc creation; a refusal is reported as `quota-exceeded`.

```ts
type QuotaPolicy = {
    check(usage: ProjectUsage, add: Partial<ProjectUsage>): QuotaVerdict;
};
```

Refers to [`ProjectUsage`](#projectusage), [`QuotaVerdict`](#quotaverdict).

## `QuotaVerdict`

_type_ in `project/usage.ts`

```ts
type QuotaVerdict = {
    limit: string;
    max: number;
    message: string;
    ok: false;
    used: number;
} | {
    ok: true;
};
```

## `RECORDING_KIND`

_const_ in `project/kinds/recording.ts`

```ts
declare const RECORDING_KIND = "recording";
```

## `RECORDING_SUFFIX`

_const_ in `project/kinds/recording.ts`

```ts
declare const RECORDING_SUFFIX = ".recording.json";
```

## `RELEASE_FILE`

_const_ in `project/release.ts`

The manifest's file name, at the root of every build.

```ts
declare const RELEASE_FILE = "release.json";
```

## `RELEASE_SCHEMA_ID`

_const_ in `project/release.ts`

`urn:jams-engine:release:v1`.

```ts
declare const RELEASE_SCHEMA_ID = "urn:jams-engine:release:v1";
```

## `RELEASE_VERSION`

_const_ in `project/release.ts`

The release manifest format version, the `v` every `release.json` carries.

```ts
declare const RELEASE_VERSION = 1;
```

## `RUNTIME_VIEW_KINDS`

_const_ in `project/runtime-view.ts`

The doc kinds a runtime view reads: a host loading one passes these docs' values.

```ts
declare const RUNTIME_VIEW_KINDS: readonly AssetKindName[];
```

Refers to [`AssetKindName`](#assetkindname).

## `RecordingMeta`

_type_ in `project/kinds/recording.ts`

```ts
type RecordingMeta = {
    /** How many seats played. */
    players: number;
    scene: string;
    sceneHash: string;
    ticks: number;
    /** The file's format version, before any migration on read. */
    v: 1 | 2;
};
```

## `RecordingSettings`

_type_ in `project/kinds/recording.ts`

```ts
type RecordingSettings = Record<string, never>;
```

## `RefIndex`

_type_ in `project/refs.ts`

```ts
type RefIndex = {
    /** References to ids that aren't live: `asset-missing` issues (with a did-you-mean). */
    dangling(): readonly SceneIssue[];
    /** Who names `id`. */
    referrers(id: AssetId): readonly Referrer[];
    /** What `id` names. */
    targets(id: AssetId): readonly RefSite[];
};
```

Refers to [`AssetId`](#assetid), [`RefSite`](#refsite), [`Referrer`](#referrer).

## `RefSite`

_type_ in `project/refs.ts`

One reference: the referring doc's value names asset `id` at `pointer`.

```ts
type RefSite = {
    id: AssetId;
    /**
     * "key" when the id is the `:<id>` end of the object key `pointer` ends
     * at (a bulk key such as `solid:ice`) rather than the value there.
     */
    in?: "key";
    kinds: readonly AssetKindName[];
    pointer: JsonPointer;
};
```

Refers to [`AssetId`](#assetid), [`AssetKindName`](#assetkindname), [`JsonPointer`](#jsonpointer).

## `Referrer`

_type_ in `project/refs.ts`

```ts
type Referrer = {
    id: AssetId;
    kind: AssetKindName;
    pointer: JsonPointer;
};
```

Refers to [`AssetId`](#assetid), [`AssetKindName`](#assetkindname), [`JsonPointer`](#jsonpointer).

## `ReleaseAsset`

_type_ in `project/release.ts`

A snapshot entry plus where its bytes are in the build.

```ts
type ReleaseAsset = {
    bytes: number;
    /** `data/<sha256>.json` for docs, `assets/<sha256><ext>` for blobs. */
    file: string;
    import?: Record<string, unknown>;
    key: AssetKey;
    kind: AssetKindName;
    licence?: Licence;
    /** Blobs: what the kind's inspect derived (an atlas's frames, a texture's size): the loader and headless read it. */
    meta?: Record<string, unknown>;
    name?: string;
    path: AssetPath;
    /** Docs: SHA-256 of the canonical text; blobs: the content hash. */
    sha256: Sha256;
    storage: "blob" | "doc";
};
```

Refers to [`AssetKey`](#assetkey), [`AssetKindName`](#assetkindname), [`AssetPath`](#assetpath), [`Licence`](#licence), [`Sha256`](#sha256).

## `ReleaseBudgetContent`

_type_ in `project/release.ts`

What a budget is measured over: a manifest's `flow` and bundles, or an export's content plan.

```ts
type ReleaseBudgetContent = {
    assets: ReleaseManifest["assets"];
    projectBundle: ReleaseManifest["projectBundle"];
    scenes: readonly ReleaseScene[];
    start: AssetId;
};
```

Refers to [`AssetId`](#assetid), [`ReleaseManifest`](#releasemanifest), [`ReleaseScene`](#releasescene).

## `ReleaseCredit`

_type_ in `project/release.ts`

```ts
type ReleaseCredit = {
    /** Assets sharing this exact licence, sorted. */
    assets: readonly AssetId[];
    attribution?: string;
    author?: string;
    source?: string;
    spdx?: string;
};
```

Refers to [`AssetId`](#assetid).

## `ReleaseFile`

_type_ in `project/release.ts`

One file of the build. `release.json` itself is never listed.

```ts
type ReleaseFile = {
    bytes: number;
    /** Relative to release.json; "/" separated, no "..". */
    path: string;
    role: "asset" | "code" | "data" | "icon" | "shell" | "style" | "wasm" | "worker";
    sha256: Sha256;
};
```

Refers to [`Sha256`](#sha256).

## `ReleaseManifest`

_type_ in `project/release.ts`

```ts
type ReleaseManifest = {
    $schema?: string;
    /** Every shipped asset by id (docs and blobs), sorted by id. */
    assets: Readonly<Record<AssetId, ReleaseAsset>>;
    budget: ExportBudgetReport;
    build: {
        /** The entry script index.html loads. */
        entry: string;
        files: readonly ReleaseFile[];
        /** SHA-256 of stableJson of the code, style and wasm files as [path, sha256] pairs, sorted by path. */
        hash: Sha256;
        /** null when no listed scene resolves to Rapier: the build holds no wasm. */
        rapier: null | {
            bytes: number;
            /** The wasm file; null for -compat (inlined). */
            file: null | string;
            package: "@dimforge/rapier2d" | "@dimforge/rapier2d-compat";
            version: string;
        };
        target: ReleaseTarget;
    };
    credits: {
        assets: readonly ReleaseCredit[];
        code: readonly ThirdPartyLicence[];
        /** Shipped assets with no licence recorded (licence-missing). */
        missing: readonly AssetId[];
    };
    engine: {
        agentSurface: number;
        /** The format versions a reader of this build's files must accept. */
        formats: {
            collabLayout: number;
            inputScript: number;
            prefab: number;
            recording: number;
            save: number;
            scene: number;
        };
        /** ENGINE_VERSION of the build. */
        version: string;
    };
    /** The scene list: only listed scenes ship. */
    flow: {
        scenes: readonly ReleaseScene[];
        start: AssetId;
    };
    game: {
        /** GameDefinition.configHash, when the game declares one. */
        configHash: null | string;
        id: string;
        /** GameDefinition.saves.version; null when the game has no saves. */
        saveVersion: null | number;
    };
    kind: "release";
    project: {
        /** The snapshot's per-kind schema hashes: a map, not one string. */
        build: Readonly<Record<AssetKindName, Sha256>>;
        id: ProjectId;
        name: string;
        /** The project snapshot's hash: `releaseSnapshot(manifest).hash` must equal it. Recording v2's `project.snapshot`. */
        snapshot: Sha256;
        /** The snapshot's own `engine` (the engine that took it). */
        snapshotEngine: string;
    };
    /** `projectBundle`: blobs resident for the whole run. */
    projectBundle: {
        bytes: number;
        entries: readonly AssetId[];
    };
    /** The web app manifest's inputs; null for every target whose `EXPORT_TARGETS` row has `pwa: false`. */
    pwa: null | {
        background: string;
        display: "fullscreen" | "minimal-ui" | "standalone";
        icons: readonly {
            file: string;
            size: 192 | 512;
        }[];
        name: string;
        orientation: "any" | "landscape" | "portrait";
        shortName: string;
        themeColor: string;
    };
    replay: {
        /** REPLAY_ACROSS_PLATFORMS of this build. Physics-free builds replay everywhere whatever it says. */
        acrossPlatforms: boolean;
    };
    /** The game's resolved time model, without the derived tickMs. */
    time: {
        catchUp: null | {
            maxMs: number;
        };
        kind: TimeKind;
        rate: number;
        wakeOnPointerMove: boolean;
    };
    v: 1;
};
```

Refers to [`AssetId`](#assetid), [`AssetKindName`](#assetkindname), [`ExportBudgetReport`](#exportbudgetreport), [`ProjectId`](#projectid), [`ReleaseAsset`](#releaseasset), [`ReleaseCredit`](#releasecredit), [`ReleaseFile`](#releasefile), [`ReleaseScene`](#releasescene), [`ReleaseTarget`](#releasetarget), [`Sha256`](#sha256), [`ThirdPartyLicence`](#thirdpartylicence).

## `ReleaseRecordingRef`

_type_ in `project/release.ts`

What `findRelease` reads of a recording.

```ts
type ReleaseRecordingRef = Pick<RunRecording, "engine" | "project"> & {
    /** The release id the run was played from, when it was. */
    release?: Sha256;
};
```

Refers to [`Sha256`](#sha256).

## `ReleaseScene`

_type_ in `project/release.ts`

```ts
type ReleaseScene = {
    /** `sceneBundle`: the blobs to fetch before its first frame, sorted, and their bytes. */
    bundle: {
        bytes: number;
        entries: readonly AssetId[];
    };
    id: AssetId;
    /** `scenePhysics` of the scene: whether it needs Rapier. */
    physics: "none" | "rapier";
    /** Prefabs its expansion uses, by id, sorted. */
    prefabs: readonly AssetId[];
    /** Listed as a sublevel in the scene list. */
    sublevel?: true;
    title?: string;
};
```

Refers to [`AssetId`](#assetid).

## `ReleaseTarget`

_type_ in `project/release.ts`

All four are valid in a manifest; this engine builds the targets `EXPORT_TARGETS` has a row for.

```ts
type ReleaseTarget = "desktop" | "itch" | "mobile" | "web";
```

## `SAVE_FIXTURE_MAX_BYTES`

_const_ in `project/kinds/save.ts`

```ts
declare const SAVE_FIXTURE_MAX_BYTES = 1048576;
```

## `SAVE_KIND`

_const_ in `project/kinds/save.ts`

```ts
declare const SAVE_KIND = "save";
```

## `SAVE_SUFFIX`

_const_ in `project/kinds/save.ts`

```ts
declare const SAVE_SUFFIX = ".save.json";
```

## `SCENE_KIND_NAME`

_const_ in `project/ops.ts`

The engine's scene kind: the one target `editScene` writes itself.

```ts
declare const SCENE_KIND_NAME = "scene";
```

## `SCENE_LIST_KIND`

_const_ in `project/kinds/scene-list.ts`

```ts
declare const SCENE_LIST_KIND = "scene-list";
```

## `SCENE_LIST_SCHEMA_ID`

_const_ in `project/kinds/scene-list.ts`

```ts
declare const SCENE_LIST_SCHEMA_ID = "urn:jams-engine:scene-list:v1";
```

## `SCENE_LIST_VERSION`

_const_ in `project/kinds/scene-list.ts`

```ts
declare const SCENE_LIST_VERSION = 1;
```

## `SCENE_VERSION_SCHEMA_ID`

_const_ in `project/scene-version.ts`

`urn:jams-engine:scene-version:v1`.

```ts
declare const SCENE_VERSION_SCHEMA_ID = "urn:jams-engine:scene-version:v1";
```

## `SCENE_VERSION_VERSION`

_const_ in `project/scene-version.ts`

The scene version record's format, the `v` every one carries.

```ts
declare const SCENE_VERSION_VERSION = 1;
```

## `SERVICE_WORKER_FILE`

_const_ in `project/release.ts`

The service worker a PWA build registers, next to its page.

```ts
declare const SERVICE_WORKER_FILE = "sw.js";
```

## `SIDECAR_SCHEMA_ID`

_const_ in `project/sidecar.ts`

`urn:jams-engine:asset-sidecar:v1`.

```ts
declare const SIDECAR_SCHEMA_ID = "urn:jams-engine:asset-sidecar:v1";
```

## `SIDECAR_SUFFIX`

_const_ in `project/sidecar.ts`

A sidecar sits beside its file as `<file>.asset.json`.

```ts
declare const SIDECAR_SUFFIX = ".asset.json";
```

## `SIDECAR_VERSION`

_const_ in `project/sidecar.ts`

The sidecar format version, the `v` every `<file>.asset.json` carries.

```ts
declare const SIDECAR_VERSION = 1;
```

## `SaveFixtureMeta`

_type_ in `project/kinds/save.ts`

What a save fixture's envelope gives.

```ts
type SaveFixtureMeta = {
    depth: SaveDepth;
    game: string;
    gameVersion: number;
    scene: string;
};
```

## `SaveFixtureSettings`

_type_ in `project/kinds/save.ts`

```ts
type SaveFixtureSettings = Record<string, never>;
```

## `SceneListEntry`

_type_ in `project/kinds/scene-list.ts`

One listed scene; a sublevel attaches beside a main scene and is never one itself.

```ts
type SceneListEntry = {
    scene: AssetId;
    sublevel?: true;
    title?: string;
};
```

Refers to [`AssetId`](#assetid).

## `SceneListFile`

_type_ in `project/kinds/scene-list.ts`

The project's scene list: the scene a game starts in and every scene flow may load.

```ts
type SceneListFile = {
    $schema?: string;
    kind: typeof SCENE_LIST_KIND;
    scenes: SceneListEntry[];
    start: AssetId | null;
    v: typeof SCENE_LIST_VERSION;
};
```

Refers to [`AssetId`](#assetid), [`SCENE_LIST_KIND`](#scene_list_kind), [`SCENE_LIST_VERSION`](#scene_list_version), [`SceneListEntry`](#scenelistentry).

## `SceneListFlow`

_type_ in `project/kinds/scene-list.ts`

What flow reads of a scene list: its start and its entries in order.

```ts
type SceneListFlow = {
    readonly scenes: readonly SceneListEntry[];
    readonly start: AssetId | null;
};
```

Refers to [`AssetId`](#assetid), [`SceneListEntry`](#scenelistentry).

## `SceneVersion`

_type_ in `project/scene-version.ts`

One published version of one scene: the data that replaces the release's
scene, never code. Holds no wall clock, author, note or timing, so the
same level published twice is the same version.

```ts
type SceneVersion = {
    $schema?: string;
    /**
     * Every asset the version needs: the scene doc, each prefab in
     * `entry.prefabs`, every blob in `entry.bundle` and the assets those refer
     * to. `file` is always `live/<sha256>.json` (docs) or `live/<sha256><ext>`
     * (blobs); the frame uses the release's own path when the release ships
     * that hash. Sorted by id.
     */
    assets: Readonly<Record<AssetId, ReleaseAsset>>;
    /** The release it was checked against when it was built; provenance only. */
    base: Sha256 | null;
    compat: LiveCompat;
    /** ENGINE_VERSION of the code that built it; shown, never compared. */
    engine: string;
    /** Its `flow.scenes` entry as a release would write it: title, sublevel, physics, prefabs, bundle. */
    entry: ReleaseScene;
    kind: "scene-version";
    project: ProjectId;
    /** The scene asset this version replaces; must be listed in the release's flow. */
    scene: AssetId;
    /** `sceneHash` of the canonical scene text: what the editor and replays display. */
    sceneHash: SceneHash;
    v: 1;
};
```

Refers to [`AssetId`](#assetid), [`LiveCompat`](#livecompat), [`ProjectId`](#projectid), [`ReleaseAsset`](#releaseasset), [`ReleaseScene`](#releasescene), [`Sha256`](#sha256).

## `SceneVersionNames`

_type_ in `project/scene-version.ts`

How the messages name the version and the release; a host passes its numbers (`level-1@4`, `v7`).

```ts
type SceneVersionNames = {
    /** Default: "the release". */
    release?: string;
    /** Default: the scene's id. */
    version?: string;
};
```

## `SceneVersionRead`

_type_ in `project/scene-version.ts`

A version read for play: its scene parsed, validated and expanded, and the prefabs it expanded from.

```ts
type SceneVersionRead = {
    def: SceneDefinition;
    /** Warnings and infos; an error stops the read. */
    issues: SceneIssue[];
    ok: true;
    prefabs: PrefabLibrary;
    scene: ExpandedScene;
} | {
    issues: SceneIssue[];
    ok: false;
};
```

## `SceneWrite`

_type_ in `project/ops.ts`

What the batch does to one scene doc: its scene ops in order, judged with this registry and these prefabs.

```ts
type SceneWrite = {
    ops: SceneOp[];
    prefabs?: PrefabLibrary;
    registry: Registry;
};
```

## `Sha256`

_type_ in `project/types.ts`

64 lowercase hex characters: SHA-256 of a blob's bytes or a doc's canonical UTF-8 text.

```ts
type Sha256 = string;
```

## `SnapshotAsset`

_type_ in `project/snapshot.ts`

One asset as a snapshot pins it.

```ts
type SnapshotAsset = {
    /** A blob's size in bytes, when its entry records one. */
    bytes?: number;
    /** A blob's import settings, when it has any: with its bytes they give its meta, and they hold its references (an atlas's texture). */
    import?: Readonly<Record<string, unknown>>;
    key: AssetKey;
    kind: AssetKindName;
    /** What a blob's kind inspected from its bytes and import (a texture's pixel size, an atlas's frames), when it has any. */
    meta?: Readonly<Record<string, unknown>>;
    path: AssetPath;
    sha256: Sha256;
};
```

Refers to [`AssetKey`](#assetkey), [`AssetKindName`](#assetkindname), [`AssetPath`](#assetpath), [`Sha256`](#sha256).

## `SnapshotError`

_class_ in `project/snapshot.ts`

A snapshot that can't give what was asked of it, with the issues why.

```ts
declare class SnapshotError extends Error {
    readonly issues: SceneIssue[];
    constructor(issues: SceneIssue[]);
}
```

## `TEXTURE_KIND`

_const_ in `project/kinds/texture.ts`

```ts
declare const TEXTURE_KIND = "texture";
```

## `TextureFormat`

_type_ in `project/kinds/texture.ts`

```ts
type TextureFormat = "gif" | "jpeg" | "png" | "webp";
```

## `TextureMeta`

_type_ in `project/kinds/texture.ts`

```ts
type TextureMeta = {
    format: TextureFormat;
    height: number;
    width: number;
};
```

Refers to [`TextureFormat`](#textureformat).

## `TextureSettings`

_type_ in `project/kinds/texture.ts`

```ts
type TextureSettings = {
    filter?: "linear" | "nearest";
    nineSlice?: [
        number,
        number,
        number,
        number
    ];
    pivot?: [
        number,
        number
    ];
};
```

## `ThirdPartyLicence`

_type_ in `project/release.ts`

```ts
type ThirdPartyLicence = {
    /** The package.json `license` field, an SPDX expression. */
    licence: string;
    /** Its LICENSE file's text, printed on the credits page; null when the package ships none. */
    notice: null | string;
    package: string;
    version: string;
};
```

## `UNLIMITED_QUOTA`

_const_ in `project/usage.ts`

The policy until the site states its limits: everything fits.

```ts
declare const UNLIMITED_QUOTA: QuotaPolicy;
```

Refers to [`QuotaPolicy`](#quotapolicy).

## `WEB_MANIFEST_FILE`

_const_ in `project/release.ts`

The web app manifest a PWA build links from its page.

```ts
declare const WEB_MANIFEST_FILE = "app.webmanifest";
```

## `applyJsonEdits`

_function_ in `project/json-edit.ts`

Applies edits in order to a copy of a declarative kind's plain JSON. The
layout decides what a pointer may address: keys of a map, indices of a
list, indices or "@<id>" of a keyed collection; never the inside of an
atomic or text value (`op-invalid`: set the whole value). `insert` goes
into a list or keyed collection, creating it when its key is absent; its
pointer may end in RFC 6901's "-" to append, as an omitted `before` does;
`remove` takes a collection item out; `unset` drops an object key and is
a no-op when the key is absent. The input is never changed, and the first
failing edit stops the batch.

```ts
declare function applyJsonEdits(value: unknown, layout: DocLayout, edits: readonly JsonEdit[]): JsonEditResult;
```

Refers to [`DocLayout`](#doclayout), [`JsonEdit`](#jsonedit), [`JsonEditResult`](#jsoneditresult).

## `assetFileEntries`

_function_ in `project/asset-files.ts`

The registry entries a project's files give, the way every host seeds
them: in the files' order, each keyed by its sidecar's key or its id,
suffixed when an earlier file holds it; binaries inspected against the
ids the files take.

```ts
declare function assetFileEntries<F extends AssetFile>(files: readonly F[], created: AssetEntry["created"]): {
    entry: AssetEntry;
    file: F;
    issue: SceneIssue | null;
    key: AssetKey;
}[];
```

Refers to [`AssetEntry`](#assetentry), [`AssetFile`](#assetfile), [`AssetKey`](#assetkey).

## `assetFileEntry`

_function_ in `project/asset-files.ts`

The entry a file gives under `key`: its sidecar's name and licence, and
for a binary its hash, size, the sidecar's settings and the meta an
inspection with `idAt` gives. An inspection that fails leaves the entry
without meta and is returned as `issue`.

```ts
declare function assetFileEntry(file: AssetFile, key: AssetKey, created: AssetEntry["created"], idAt: (path: AssetPath) => AssetId | undefined): {
    entry: AssetEntry;
    issue: SceneIssue | null;
};
```

Refers to [`AssetEntry`](#assetentry), [`AssetFile`](#assetfile), [`AssetId`](#assetid), [`AssetKey`](#assetkey), [`AssetPath`](#assetpath).

## `assetFileKind`

_function_ in `project/asset-files.ts`

The kind of a file under the asset globs, as every host judges it: its
sidecar's kind, else its suffix's, else, for a `.json` file, what its
content names. `json` is asked only for a `.json` file no suffix claims.

```ts
declare function assetFileKind(kinds: KindRegistry, path: AssetPath, json: () => unknown, sidecarKind?: string): AssetKindDef | null;
```

Refers to [`AssetKindDef`](#assetkinddef), [`AssetPath`](#assetpath), [`KindRegistry`](#kindregistry).

## `assetFilesIn`

_function_ in `project/asset-files.ts`

The files of `files` (project-relative paths to bytes) a project holds:
each one `assetFileKind` gives a kind, with its sidecar, and each sidecar
whose file isn't among them.

```ts
declare function assetFilesIn<B extends Uint8Array>(files: ReadonlyMap<AssetPath, B>, kinds: KindRegistry): Map<AssetPath, B>;
```

Refers to [`AssetPath`](#assetpath), [`KindRegistry`](#kindregistry).

## `assetIdOfPath`

_function_ in `project/view.ts`

The id a path gives an asset that names none: the file name without its
last extension, lowercased, with every run of other characters turned
into one "-" (`Hero Idle.png` → `hero-idle`, `yard.checks.json` →
`yard-checks`). Null when nothing is left.

```ts
declare function assetIdOfPath(path: AssetPath): AssetId | null;
```

Refers to [`AssetId`](#assetid), [`AssetPath`](#assetpath).

## `assetInfo`

_function_ in `project/asset-info.ts`

`id`'s info from its live entry: kind, hash and size in bytes; a
texture's pixel size and its import pivot, nine-slice and filter; an
atlas's frame names in file order, tags and texture id. With `frame`, an
atlas's info with that frame's pixel size, rectangle and pivot (frames without their
own carry the atlas's `pivotDefault`). Null for an id with no live asset
and for a frame the asset doesn't have.

```ts
declare function assetInfo(view: ProjectView, id: AssetId, frame?: string): AssetInfo | null;
```

Refers to [`AssetId`](#assetid), [`AssetInfo`](#assetinfo), [`ProjectView`](#projectview).

## `assetPathProblem`

_function_ in `project/view.ts`

Why `path` isn't an asset path (see `AssetPath`), or null when it is one.

```ts
declare function assetPathProblem(path: string): null | string;
```

## `atlasExportApp`

_function_ in `project/kinds/atlas.ts`

The tool an export's `meta.app` names, which is how an import tells an
Aseprite or TexturePacker JSON not named `.atlas.json` from any other
JSON: an object with `frames`, no top-level `kind`, and an `app` at
aseprite.org or codeandweb.com/texturepacker. Null otherwise.

```ts
declare function atlasExportApp(json: unknown): AtlasTool | null;
```

Refers to [`AtlasTool`](#atlastool).

## `atlasImage`

_function_ in `project/inspect/atlas.ts`

The texture file an atlas JSON names in `meta.image`, or null.

```ts
declare function atlasImage(json: unknown): null | string;
```

## `atlasKind`

_const_ in `project/kinds/atlas.ts`

A sprite atlas: an Aseprite or TexturePacker JSON export, told apart by
`meta.app`. Its frames, tags and slices are meta; the image it cuts is the
texture asset `import.texture` names.

```ts
declare const atlasKind: {
    contentTypes: string[];
    defaultFolder: (_env: KindEnv, near: string | undefined) => string;
    description: string;
    inspect: (bytes: Uint8Array, settings: AtlasSettings, env: InspectEnv) => InspectResult<AtlasMeta>;
    kind: string;
    match: {
        suffixes: string[];
    };
    maxBytes: number;
    meta: z.ZodType<AtlasMeta, unknown, z.core.$ZodTypeInternals<AtlasMeta, unknown>>;
    refs: (entry: AssetEntry) => RefSite[];
    settings: z.ZodType<AtlasSettings, unknown, z.core.$ZodTypeInternals<AtlasSettings, unknown>>;
    storage: "blob";
    title: string;
};
```

Refers to [`AssetEntry`](#assetentry), [`AtlasMeta`](#atlasmeta), [`AtlasSettings`](#atlassettings), [`InspectEnv`](#inspectenv), [`InspectResult`](#inspectresult), [`KindEnv`](#kindenv), [`RefSite`](#refsite).

## `atlasMetaSchema`

_const_ in `project/kinds/atlas.ts`

```ts
declare const atlasMetaSchema: z.ZodType<AtlasMeta>;
```

Refers to [`AtlasMeta`](#atlasmeta).

## `atlasSettingsSchema`

_const_ in `project/kinds/atlas.ts`

```ts
declare const atlasSettingsSchema: z.ZodType<AtlasSettings>;
```

Refers to [`AtlasSettings`](#atlassettings).

## `atlasTool`

_function_ in `project/inspect/atlas.ts`

Which tool exported an atlas JSON: Aseprite by its `meta.app`, otherwise TexturePacker's format.

```ts
declare function atlasTool(json: unknown): "aseprite" | "texturepacker" | null;
```

## `audioKind`

_const_ in `project/kinds/audio.ts`

A sound: Ogg, MP3, WAV or M4A, its format read from the header.

```ts
declare const audioKind: {
    contentTypes: string[];
    defaultFolder: (_env: KindEnv, near: string | undefined) => string;
    description: string;
    inspect: (bytes: Uint8Array, settings: AudioSettings, env: InspectEnv) => InspectResult<AudioMeta>;
    kind: string;
    match: {
        suffixes: string[];
    };
    maxBytes: number;
    meta: z.ZodType<AudioMeta, unknown, z.core.$ZodTypeInternals<AudioMeta, unknown>>;
    settings: z.ZodType<AudioSettings, unknown, z.core.$ZodTypeInternals<AudioSettings, unknown>>;
    storage: "blob";
    title: string;
};
```

Refers to [`AudioMeta`](#audiometa), [`AudioSettings`](#audiosettings), [`InspectEnv`](#inspectenv), [`InspectResult`](#inspectresult), [`KindEnv`](#kindenv).

## `audioMetaSchema`

_const_ in `project/kinds/audio.ts`

```ts
declare const audioMetaSchema: z.ZodType<AudioMeta>;
```

Refers to [`AudioMeta`](#audiometa).

## `audioSettingsSchema`

_const_ in `project/kinds/audio.ts`

```ts
declare const audioSettingsSchema: z.ZodType<AudioSettings>;
```

Refers to [`AudioSettings`](#audiosettings).

## `buildRefIndex`

_function_ in `project/refs.ts`

References out of every live asset: a doc kind's `refs(value)` over its
value in `values` (a doc that isn't there isn't read), a blob kind's
`refs(entry)`. A reference to an id with no live asset of a kind it
accepts is dangling.

```ts
declare function buildRefIndex(view: ProjectView, values: ReadonlyMap<AssetId, unknown>, kinds: KindRegistry, env: KindEnv): RefIndex;
```

Refers to [`AssetId`](#assetid), [`KindEnv`](#kindenv), [`KindRegistry`](#kindregistry), [`ProjectView`](#projectview), [`RefIndex`](#refindex).

## `buildSceneVersion`

_function_ in `project/scene-version.ts`

Builds the version of `opts.scene`: reads the scene as Play does (any
error stops the build); takes its release entry (physics, the prefabs the
expansion used, the bundle, and the title and sublevel flag the scene
list gives); carries the scene, its prefabs, its bundle and everything
those reference, each under `live/`; stamps the compatibility of this
code; then hashes it. With `opts.release`, `base` is that release's id
and `checkSceneVersion`'s issues against it are returned. The same
content gives the same id, whether its texts came from files or docs.

```ts
declare function buildSceneVersion(opts: BuildSceneVersionOptions): Promise<BuildSceneVersionResult>;
```

Refers to [`BuildSceneVersionOptions`](#buildsceneversionoptions), [`BuildSceneVersionResult`](#buildsceneversionresult).

## `byCodeUnit`

_const_ in `project/kinds/define.ts`

UTF-16 code-unit order, as `Array.prototype.sort` orders strings: the same on every host and locale.

```ts
declare const byCodeUnit: (a: string, b: string) => number;
```

## `canonicalJson`

_function_ in `project/canonical.ts`

The canonical text of a declarative kind's value: two-space indentation;
at the root `$schema`, `kind` and `v` first; object keys in the layout's
declared order then by code unit; each item of a `keyed` or `list`
collection on one line, a keyed item's id first; an atomic value on one
line; a trailing newline. A value that doesn't fit its layout is written
as an atomic one.

```ts
declare function canonicalJson(value: unknown, layout: DocLayout): string;
```

Refers to [`DocLayout`](#doclayout).

## `checkProjectBatch`

_function_ in `project/ops.ts`

Checks a whole batch against plain JSON: the project state and the
current values of the docs it touches (by asset id). A failing op means
nothing anywhere is written. `editAsset` applies its edits through the
kind's layout and judges the result by the kind's schema; `editScene`
runs `applyOps` on a scene and hands ops that write prefabs to
`env.prefabEdit`. `deleteAsset` without `force`, and an `editScene` whose
`definePrefab` null removes a prefab, are refused with `asset-in-use`
while a live asset among those given still names the asset once the
whole batch has run; a scene's checks file (`<stem>.checks.json` beside
it) counts as naming it, and follows it through `moveAsset` and
`renameAsset`. `changeAssetId`
rewrites every referrer (see `BatchWork.changeAssetId`), so it needs
every live doc that can hold a reference.

```ts
declare function checkProjectBatch(state: ProjectState, docs: ReadonlyMap<AssetId, unknown>, batch: ProjectOpBatch, env: ProjectBatchEnv): ProjectBatchCheck;
```

Refers to [`AssetId`](#assetid), [`ProjectBatchCheck`](#projectbatchcheck), [`ProjectBatchEnv`](#projectbatchenv), [`ProjectOpBatch`](#projectopbatch), [`ProjectState`](#projectstate).

## `checkReleaseManifest`

_function_ in `project/release.ts`

Every check a host can make without game code: the shape; every path
relative with no ".."; the start listed; scenes, prefabs, bundle entries
and credits inside `assets`; `build.rapier` null exactly when no scene is
"rapier"; every named file in `build.files`, an asset's with its hash;
`build.hash` and the snapshot hash reproduced; the files present with
their hashes (when `files` is given, by path); the budget recomputed (when
`options.measureBudget` is given). Empty when the manifest holds together.

```ts
declare function checkReleaseManifest(manifest: ReleaseManifest, files?: ReadonlyMap<string, Sha256>, options?: CheckReleaseOptions): Promise<SceneIssue[]>;
```

Refers to [`CheckReleaseOptions`](#checkreleaseoptions), [`ReleaseManifest`](#releasemanifest), [`Sha256`](#sha256).

## `checkSceneVersion`

_function_ in `project/scene-version.ts`

Every compatibility rule: the project, game and configuration (1),
formats (2) and per-kind schema hashes (3) are the release's; the scene
is listed with the same sublevel flag (4); physics only when the release
ships Rapier (5); every carried asset besides the scene and its prefabs
new to the release or with its hash (6); with `texts` (the carried
canonical texts, by hash), every reference out of a carried asset is to a
carried one (7); `entry`'s scene, prefabs and bundle carried and sorted
(8). `[]` when the version may go live on this release. Issues that
point into the version carry the line of its canonical text.

```ts
declare function checkSceneVersion(manifest: ReleaseManifest, version: SceneVersion, texts?: ReadonlyMap<Sha256, string>, opts?: CheckSceneVersionOptions): SceneIssue[];
```

Refers to [`CheckSceneVersionOptions`](#checksceneversionoptions), [`ReleaseManifest`](#releasemanifest), [`SceneVersion`](#sceneversion), [`Sha256`](#sha256).

## `checkSnapshot`

_function_ in `project/snapshot.ts`

Every reference in the snapshot's docs and blob import settings resolves
to an asset in it of a kind the reference accepts; else `asset-missing`.
Each doc is read from its canonical text in `store` (missing text is
`asset-missing`, bytes that don't hash to the pin `hash-mismatch`) and
parsed by its kind, whose errors are returned with the doc's id. An
unregistered kind is `asset-kind`; a `hash` the content doesn't give is
`hash-mismatch`. Kinds see the snapshot as `env.project`, and
`env.registry` with the snapshot's own materials in place of any overlay
it had. Blobs aren't fetched.

```ts
declare function checkSnapshot(snapshot: ProjectSnapshot, store: ContentStore, kinds: KindRegistry, env: KindEnv): Promise<SceneIssue[]>;
```

Refers to [`ContentStore`](#contentstore), [`KindEnv`](#kindenv), [`KindRegistry`](#kindregistry), [`ProjectSnapshot`](#projectsnapshot).

## `checksKind`

_const_ in `project/kinds/checks.ts`

Checks for the scene beside the file, co-edited per check and field.

```ts
declare const checksKind: {
    defaultFolder: (_env: KindEnv, near: string | undefined) => string;
    description: string;
    empty: () => ChecksFile;
    format: (file: ChecksFile) => string;
    kind: string;
    layout: {
        readonly as: "map";
        readonly fields: {
            readonly checks: {
                readonly as: "keyed";
                readonly item: {
                    readonly as: "map";
                    readonly fields: {
                        readonly kind: {
                            as: "atomic";
                        };
                    };
                    readonly rest: {
                        as: "atomic";
                    };
                };
            };
        };
        readonly rest: {
            as: "atomic";
        };
    };
    match: {
        suffixes: string[];
    };
    migrations: Readonly<Record<number, Migration>>;
    /**
     * Inline scripts' `scene`. A script given by path and the scene the file
     * sits beside are paths, not ids: `checksBeside` pairs a scene with its file.
     */
    refs: (file: ChecksFile) => RefSite[];
    schema: (env: KindEnv) => z.ZodType<ChecksFile>;
    schemaId: string;
    storage: "doc";
    title: string;
    version: number;
};
```

Refers to [`KindEnv`](#kindenv), [`RefSite`](#refsite).

## `codeKind`

_const_ in `project/kinds/code.ts`

Game code: modules the project file's `code` globs name, listed read-only and never a doc.

```ts
declare const codeKind: {
    description: string;
    kind: string;
    match: {};
    storage: "code";
    title: string;
};
```

## `compareEntries`

_function_ in `project/view.ts`

The registry's total order: `created.at`, then key. Duplicates keep the first and repair the rest.

```ts
declare function compareEntries(a: AssetEntry, b: AssetEntry): number;
```

Refers to [`AssetEntry`](#assetentry).

## `createKindRegistry`

_function_ in `project/kinds.ts`

Engine kinds (`base`, default `ENGINE_ASSET_KINDS`) first, then the
game's `assetKinds`. Throws on a duplicate name, an engine kind whose name
isn't an id, a game kind not named `<gameId>/<name>` or with `layout:
"custom"`, a declarative layout whose root isn't a `map`, and a suffix or
`jsonKind` two kinds claim.

```ts
declare function createKindRegistry(game?: GameDefinition | null, base?: readonly AssetKindDef[]): KindRegistry;
```

Refers to [`AssetKindDef`](#assetkinddef), [`KindRegistry`](#kindregistry).

## `dataTableIssues`

_function_ in `project/kinds/data-table.ts`

`dup-id` for a row whose id an earlier asset of its table (in path order)
already holds, `path` into the later asset and `detail` naming the table
and the earlier asset's key. Repeats inside one asset are that asset's
own `dup-id`.

```ts
declare function dataTableIssues(view: ProjectView, values: ReadonlyMap<AssetId, unknown>): SceneIssue[];
```

Refers to [`AssetId`](#assetid), [`ProjectView`](#projectview).

## `dataTableKind`

_const_ in `project/kinds/data-table.ts`

Rows of one of the game's data tables; several assets may hold rows of one table.

```ts
declare const dataTableKind: {
    defaultFolder: () => string;
    description: string;
    empty: (env: KindEnv, { id }: {
        id: AssetId;
    }) => DataTableFile;
    kind: string;
    layout: {
        as: "map";
        fields: {
            rows: {
                as: "keyed";
                item: {
                    as: "map";
                    rest: {
                        as: "atomic";
                    };
                };
            };
            table: {
                as: "atomic";
            };
        };
    };
    match: {
        jsonKind: string;
    };
    migrations: {
        1: typeof dataTableV1ToV2;
    };
    refs(file: DataTableFile, env: KindEnv): RefSite[];
    schema: (env: KindEnv) => z.ZodType<DataTableFile, unknown, z.core.$ZodTypeInternals<DataTableFile, unknown>>;
    schemaId: string;
    storage: "doc";
    title: string;
    version: number;
};
```

Refers to [`AssetId`](#assetid), [`DataTableFile`](#datatablefile), [`KindEnv`](#kindenv), [`RefSite`](#refsite).

## `defineAssetKind`

_function_ in `project/kinds/define.ts`

Identity at runtime; types the definition. Names are checked when a KindRegistry is built.

```ts
declare function defineAssetKind<K extends AssetKindDef>(def: K): K;
```

Refers to [`AssetKindDef`](#assetkinddef).

## `detectImport`

_function_ in `project/kinds.ts`

The kind a file brought into a project takes: `detect`'s, else, for a
`.json` that names no kind, `atlas` when its `meta.app` says Aseprite or
TexturePacker exported it. Detection by path then differs, so the
imported file's sidecar records the kind.

```ts
declare function detectImport(kinds: KindRegistry, path: AssetPath, json?: unknown): AssetKindDef | null;
```

Refers to [`AssetKindDef`](#assetkinddef), [`AssetPath`](#assetpath), [`KindRegistry`](#kindregistry).

## `docKindJsonSchema`

_function_ in `project/kinds.ts`

A doc kind's draft 2020-12 JSON Schema as a file publishes it: `$id`, the
agent surface and a title first. With a project, each asset field's
`enum` lists the live ids of its kinds.

```ts
declare function docKindJsonSchema(def: DocKindDef, env: KindEnv): Record<string, unknown>;
```

Refers to [`DocKindDef`](#dockinddef), [`KindEnv`](#kindenv).

## `docNameOf`

_function_ in `project/doc-names.ts`

The doc name for `ref`; throws when its project id or key doesn't match ID_PATTERN.

```ts
declare function docNameOf(ref: DocName): string;
```

Refers to [`DocName`](#docname).

## `engineResolution`

_function_ in `project/kinds/game-settings.ts`

The resolution policy an `engine` block sets: the whole block when it
parses, else each field that does; undefined when it sets none.

```ts
declare function engineResolution(engine: Readonly<Record<string, unknown>>): Partial<ResolutionPolicy> | undefined;
```

## `findRelease`

_function_ in `project/release.ts`

The release a recording was made on: the one whose id is its `release`;
else (no `release`, or none of `releases` has it) the first whose
`project.snapshot` and `engine.version` are the recording's. `releases`
come newest first; the caller judges a fallback by its `runHash`.

```ts
declare function findRelease<R extends {
    id: Sha256;
    manifest: ReleaseManifest;
}>(recording: ReleaseRecordingRef, releases: readonly R[]): R | null;
```

Refers to [`ReleaseManifest`](#releasemanifest), [`ReleaseRecordingRef`](#releaserecordingref), [`Sha256`](#sha256).

## `findSceneVersion`

_function_ in `project/scene-version.ts`

A recording's version by id; null when the host doesn't have it.

```ts
declare function findSceneVersion<V extends {
    id: Sha256;
    version: SceneVersion;
}>(id: Sha256, versions: readonly V[]): V | null;
```

Refers to [`SceneVersion`](#sceneversion), [`Sha256`](#sha256).

## `fontKind`

_const_ in `project/kinds/font.ts`

A font: a text BMFont (.fnt), whose page images are texture assets named
by `import.pages`, or a WOFF2, WOFF, TrueType or OpenType file.

```ts
declare const fontKind: {
    contentTypes: string[];
    defaultFolder: (_env: KindEnv, near: string | undefined) => string;
    description: string;
    inspect: (bytes: Uint8Array, settings: FontSettings, env: InspectEnv) => InspectResult<FontMeta>;
    kind: string;
    match: {
        suffixes: string[];
    };
    maxBytes: number;
    meta: z.ZodType<FontMeta, unknown, z.core.$ZodTypeInternals<FontMeta, unknown>>;
    refs: (entry: AssetEntry) => RefSite[];
    settings: z.ZodType<FontSettings, unknown, z.core.$ZodTypeInternals<FontSettings, unknown>>;
    storage: "blob";
    title: string;
};
```

Refers to [`AssetEntry`](#assetentry), [`FontMeta`](#fontmeta), [`FontSettings`](#fontsettings), [`InspectEnv`](#inspectenv), [`InspectResult`](#inspectresult), [`KindEnv`](#kindenv), [`RefSite`](#refsite).

## `fontMetaSchema`

_const_ in `project/kinds/font.ts`

```ts
declare const fontMetaSchema: z.ZodType<FontMeta>;
```

Refers to [`FontMeta`](#fontmeta).

## `fontSettingsSchema`

_const_ in `project/kinds/font.ts`

```ts
declare const fontSettingsSchema: z.ZodType<FontSettings>;
```

Refers to [`FontSettings`](#fontsettings).

## `formatAssetDoc`

_function_ in `project/kinds.ts`

A doc kind's canonical text: its `format`, else `canonicalJson` over its layout.

```ts
declare function formatAssetDoc<J>(kind: DocKindDef<J>, value: J): string;
```

Refers to [`DocKindDef`](#dockinddef).

## `formatBytes`

_function_ in `project/format-bytes.ts`

A byte count as people read it, KiB-based as the engine measures: `512 B`, `14 KB`, `2.3 MB`.

```ts
declare function formatBytes(bytes: number): string;
```

## `formatProjectFile`

_function_ in `project/project-file.ts`

The canonical text of a project file: keys in the schema's order, a trailing newline.

```ts
declare function formatProjectFile(file: ProjectFile): string;
```

Refers to [`ProjectFile`](#projectfile).

## `formatProjectSnapshot`

_function_ in `project/snapshot.ts`

A snapshot's file text: header keys first, `build` and `assets` sorted, a trailing newline.

```ts
declare function formatProjectSnapshot(snapshot: ProjectSnapshot): string;
```

Refers to [`ProjectSnapshot`](#projectsnapshot).

## `formatReleaseManifest`

_function_ in `project/release.ts`

Canonical text: canonicalJson with the key order of `ReleaseManifest`,
`assets` by id, `files` by path, each item of a list or of `assets` on
one line; trailing newline.

```ts
declare function formatReleaseManifest(manifest: ReleaseManifest): string;
```

Refers to [`ReleaseManifest`](#releasemanifest).

## `formatSceneVersion`

_function_ in `project/scene-version.ts`

Canonical text, by `formatReleaseManifest`'s writer: the key order of
`SceneVersion`, `assets` by id with each item on one line, two-space
indent, trailing newline.

```ts
declare function formatSceneVersion(version: SceneVersion): string;
```

Refers to [`SceneVersion`](#sceneversion).

## `formatSidecar`

_function_ in `project/sidecar.ts`

The canonical text of a sidecar. `key` is left out when it equals `id`,
and `assetKind` when it equals `detectedKind`, the kind detection gives
the file without a sidecar.

```ts
declare function formatSidecar(sidecar: Omit<AssetSidecar, "key"> & {
    key?: AssetKey;
}, options?: {
    detectedKind?: AssetKindName | null;
}): string;
```

Refers to [`AssetKey`](#assetkey), [`AssetKindName`](#assetkindname), [`AssetSidecar`](#assetsidecar).

## `gameSettingsEntries`

_function_ in `project/kinds/game-settings.ts`

The project's live game-settings entries, the one in effect (first by path) first.

```ts
declare function gameSettingsEntries(view: ProjectView): AssetEntry[];
```

Refers to [`AssetEntry`](#assetentry), [`ProjectView`](#projectview).

## `gameSettingsIssues`

_function_ in `project/kinds/game-settings.ts`

`asset-kind` for every live game-settings asset after the first by path: a project has at most one.

```ts
declare function gameSettingsIssues(view: ProjectView): SceneIssue[];
```

Refers to [`ProjectView`](#projectview).

## `gameSettingsKind`

_const_ in `project/kinds/game-settings.ts`

Project-wide settings: the engine's block (resolution, physics, gravity, tick rate) and the game's `projectSettings`.

```ts
declare const gameSettingsKind: {
    defaultFolder: () => string;
    description: string;
    empty: () => GameSettingsFile;
    kind: string;
    layout: {
        as: "map";
        fields: {
            engine: {
                as: "map";
                rest: {
                    as: "atomic";
                };
            };
            game: {
                as: "map";
                rest: {
                    as: "atomic";
                };
            };
        };
    };
    match: {
        jsonKind: string;
    };
    migrations: {
        1: typeof gameSettingsV1ToV2;
    };
    perProject: 1;
    perProjectWords: {
        contents: string;
        held: string;
        noun: string;
    };
    refs: (file: GameSettingsFile, env: KindEnv) => RefSite[];
    schema: (env: KindEnv) => z.ZodType<GameSettingsFile, unknown, z.core.$ZodTypeInternals<GameSettingsFile, unknown>>;
    schemaId: string;
    storage: "doc";
    title: string;
    validate: (file: GameSettingsFile) => SceneIssue[];
    version: number;
};
```

Refers to [`GameSettingsFile`](#gamesettingsfile), [`KindEnv`](#kindenv), [`RefSite`](#refsite).

## `gameSettingsValues`

_function_ in `project/kinds/game-settings.ts`

The game's settings with its `projectSettings` defaults applied: the
parsed block, or field by field when the block as a whole doesn't parse
(a bad value falls back to its default, else is left out).

```ts
declare function gameSettingsValues(registry: Registry, game: Record<string, unknown> | undefined): Record<string, unknown>;
```

## `hashForPut`

_function_ in `project/content-store.ts`

The hash of `bytes`, refused with `hash-mismatch` when it isn't `expect`; for every store's `put`.

```ts
declare function hashForPut(bytes: Uint8Array, expect?: Sha256): Promise<Sha256>;
```

Refers to [`Sha256`](#sha256).

## `heldProject`

_function_ in `project/runtime-view.ts`

The project `files` make, keyed and identified the way the scene CLI
seeds one from disk: in path order, each file's kind detected from its
path, JSON and sidecar, its id and key its sidecar's, else its own. A
binary is read from its sidecar, so no blob is fetched; one whose sidecar
has no hash, a doc without its JSON and a file of no kind are left out.

```ts
declare function heldProject(files: readonly HeldFile[], registry: Registry, meta: {
    name: string;
    projectId: ProjectId;
}): HeldProject;
```

Refers to [`HeldFile`](#heldfile), [`HeldProject`](#heldproject), [`ProjectId`](#projectid).

## `idsAtPaths`

_function_ in `project/asset-files.ts`

The live asset id at each path, as an inspection asks for it (an atlas names its image by path).

```ts
declare function idsAtPaths(entries: Iterable<Pick<AssetEntry, "deleted" | "id" | "path">>): (path: AssetPath) => AssetId | undefined;
```

Refers to [`AssetEntry`](#assetentry), [`AssetId`](#assetid), [`AssetPath`](#assetpath).

## `inputMapEntries`

_function_ in `project/kinds/input-map.ts`

The project's live input-map entries, the one in effect (first by path) first.

```ts
declare function inputMapEntries(view: ProjectView): AssetEntry[];
```

Refers to [`AssetEntry`](#assetentry), [`ProjectView`](#projectview).

## `inputMapIssues`

_function_ in `project/kinds/input-map.ts`

`asset-kind` for every live input-map asset after the first by path: a project has at most one.

```ts
declare function inputMapIssues(view: ProjectView): SceneIssue[];
```

Refers to [`ProjectView`](#projectview).

## `inputMapKind`

_const_ in `project/kinds/input-map.ts`

Seats, deadzone, bindings per action and on-screen controls, co-edited per action and binding.

```ts
declare const inputMapKind: {
    defaultFolder: () => string;
    description: string;
    empty: () => InputMapFile;
    kind: string;
    layout: {
        as: "map";
        fields: {
            actions: {
                as: "keyed";
                id: string;
                item: {
                    as: "map";
                    fields: {
                        bindings: {
                            as: "list";
                            item: {
                                as: "atomic";
                            };
                        };
                    };
                    rest: {
                        as: "atomic";
                    };
                };
            };
            players: {
                as: "map";
                rest: {
                    as: "atomic";
                };
            };
            touch: {
                as: "keyed";
                item: {
                    as: "map";
                    rest: {
                        as: "atomic";
                    };
                };
            };
        };
        rest: {
            as: "atomic";
        };
    };
    limits: {
        maxStateBytes: number;
    };
    match: {
        jsonKind: string;
    };
    perProject: 1;
    perProjectWords: {
        contents: string;
        noun: string;
    };
    schema: (env: KindEnv) => z.ZodType<InputMapFile, unknown, z.core.$ZodTypeInternals<InputMapFile, unknown>>;
    schemaId: string;
    storage: "doc";
    title: string;
    version: number;
};
```

Refers to [`InputMapFile`](#inputmapfile), [`KindEnv`](#kindenv).

## `inputMapProblems`

_function_ in `project/kinds/input-map.ts`

What's wrong with an input map against the game it runs under: its
seats (`player-unknown`), each action the game doesn't declare or whose
kind differs from the game's, every binding `bindingProblems` refuses
(judged by the game's kind for its action, the map's seats, else the
game's, and the map's touch controls), and each touch control on an
action the game doesn't declare (`binding-unknown`).

```ts
declare function inputMapProblems(file: InputMapFile, registry: Registry): InputMapProblem[];
```

Refers to [`InputMapFile`](#inputmapfile), [`InputMapProblem`](#inputmapproblem).

## `inputScriptKind`

_const_ in `project/kinds/input-script.ts`

A headless playtest: steps per seat, merging per step and per track.

```ts
declare const inputScriptKind: {
    defaultFolder: (_env: KindEnv, near: string | undefined) => string;
    description: string;
    empty: () => InputScriptV2;
    format: (script: InputScriptV2) => string;
    kind: string;
    layout: {
        readonly as: "map";
        readonly fields: {
            readonly at: {
                as: "atomic";
            };
            readonly game: {
                as: "atomic";
            };
            readonly maxTicks: {
                as: "atomic";
            };
            readonly players: {
                as: "atomic";
            };
            readonly scene: {
                as: "atomic";
            };
            readonly seed: {
                as: "atomic";
            };
            readonly steps: {
                as: "list";
                item: DocLayout;
            };
            readonly timeOffsetMs: {
                as: "atomic";
            };
            readonly tracks: {
                readonly as: "keyed";
                readonly id: "player";
                readonly item: {
                    readonly as: "map";
                    readonly fields: {
                        readonly player: {
                            as: "atomic";
                        };
                        readonly steps: {
                            as: "list";
                            item: DocLayout;
                        };
                    };
                    readonly rest: {
                        as: "atomic";
                    };
                };
            };
        };
        readonly rest: {
            as: "atomic";
        };
    };
    match: {
        suffixes: string[];
    };
    migrations: Readonly<Record<number, Migration>>;
    refs: (script: InputScriptV2) => RefSite[];
    schema: (env: KindEnv) => z.ZodType<InputScriptV2>;
    schemaId: string;
    storage: "doc";
    title: string;
    version: number;
};
```

Refers to [`DocLayout`](#doclayout), [`KindEnv`](#kindenv), [`RefSite`](#refsite).

## `inspectEntry`

_function_ in `project/inspect/entry.ts`

A blob entry's meta from its bytes and import settings, the way every
host derives it: `idAt` resolves the names the file makes (an atlas's
image), an inspector that throws is `import-failed`, and the settings the
inspection fills join the entry's own, which win.

```ts
declare function inspectEntry(def: BlobKindDef, entry: Pick<AssetEntry, "import" | "path">, bytes: Uint8Array, idAt: (path: AssetPath) => AssetId | undefined): InspectResult<unknown>;
```

Refers to [`AssetEntry`](#assetentry), [`AssetId`](#assetid), [`AssetPath`](#assetpath), [`BlobKindDef`](#blobkinddef), [`InspectResult`](#inspectresult).

## `isSha256`

_function_ in `project/hash.ts`

```ts
declare function isSha256(s: string): s is Sha256;
```

Refers to [`Sha256`](#sha256).

## `isSkippedAssetPath`

_function_ in `project/kinds.ts`

Whether a path is never an asset whatever the globs say: schemas, sidecars, the project file, tests and build output.

```ts
declare function isSkippedAssetPath(path: AssetPath): boolean;
```

Refers to [`AssetPath`](#assetpath).

## `keyedItemPointer`

_function_ in `project/json-edit.ts`

The pointer of one keyed item, `<collection>/@<id>`.

```ts
declare function keyedItemPointer(collection: JsonPointer, id: string): JsonPointer;
```

Refers to [`JsonPointer`](#jsonpointer).

## `kindInputMap`

_function_ in `project/kinds/input-script.ts`

The `KindEnv.inputMap` of a project: its input map in effect (the first
by path) as a run reads it, from the doc values `valueOf` holds; null
without one or before its doc is read.

```ts
declare function kindInputMap(view: ProjectView, valueOf: (id: AssetId) => unknown, registry: Registry): InputMapFile | null;
```

Refers to [`AssetId`](#assetid), [`InputMapFile`](#inputmapfile), [`ProjectView`](#projectview).

## `liveCompat`

_function_ in `project/scene-version.ts`

What `manifest` asks of a version that goes live on it.

```ts
declare function liveCompat(manifest: ReleaseManifest): LiveCompat;
```

Refers to [`LiveCompat`](#livecompat), [`ReleaseManifest`](#releasemanifest).

## `liveCompatKey`

_function_ in `project/scene-version.ts`

One hash of `compat`: two releases a version fits equally have the same key.

```ts
declare function liveCompatKey(compat: LiveCompat): Promise<Sha256>;
```

Refers to [`LiveCompat`](#livecompat), [`Sha256`](#sha256).

## `materialKind`

_const_ in `project/kinds/material.ts`

A surface material: a description, an optional physics block and an optional look.

```ts
declare const materialKind: {
    defaultFolder: () => string;
    description: string;
    empty: () => MaterialFile;
    format: (value: MaterialFile) => string;
    kind: string;
    layout: {
        as: "map";
        fields: {
            render: {
                as: "map";
                rest: {
                    as: "atomic";
                };
            };
        };
        rest: {
            as: "atomic";
        };
    };
    match: {
        jsonKind: string;
    };
    migrations: {
        1: typeof materialV1ToV2;
    };
    schema: () => z.ZodObject<{
        $schema: z.ZodOptional<z.ZodString>;
        description: z.ZodString;
        kind: z.ZodLiteral<"material">;
        physics: z.ZodOptional<z.ZodObject<{
            friction: z.ZodNumber;
            impulse: z.ZodOptional<z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, z.core.$strict>>;
            restitution: z.ZodNumber;
        }, z.core.$strict>>;
        render: z.ZodOptional<z.ZodObject<{
            blend: z.ZodOptional<z.ZodEnum<{
                add: "add";
                multiply: "multiply";
                normal: "normal";
                screen: "screen";
            }>>;
            style: z.ZodOptional<z.ZodObject<{
                alpha: z.ZodOptional<z.ZodNumber>;
                fill: z.ZodOptional<z.ZodString>;
                stroke: z.ZodOptional<z.ZodString>;
                strokeAlpha: z.ZodOptional<z.ZodNumber>;
                strokeWidth: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
            tint: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        v: z.ZodLiteral<2>;
    }, z.core.$strict>;
    schemaId: string;
    storage: "doc";
    title: string;
    version: number;
};
```

Refers to [`MaterialFile`](#materialfile).

## `materialSchema`

_const_ in `project/kinds/material.ts`

```ts
declare const materialSchema: z.ZodObject<{
    $schema: z.ZodOptional<z.ZodString>;
    description: z.ZodString;
    kind: z.ZodLiteral<"material">;
    physics: z.ZodOptional<z.ZodObject<{
        friction: z.ZodNumber;
        impulse: z.ZodOptional<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strict>>;
        restitution: z.ZodNumber;
    }, z.core.$strict>>;
    render: z.ZodOptional<z.ZodObject<{
        blend: z.ZodOptional<z.ZodEnum<{
            add: "add";
            multiply: "multiply";
            normal: "normal";
            screen: "screen";
        }>>;
        style: z.ZodOptional<z.ZodObject<{
            alpha: z.ZodOptional<z.ZodNumber>;
            fill: z.ZodOptional<z.ZodString>;
            stroke: z.ZodOptional<z.ZodString>;
            strokeAlpha: z.ZodOptional<z.ZodNumber>;
            strokeWidth: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        tint: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    v: z.ZodLiteral<2>;
}, z.core.$strict>;
```

## `mayBeAssetFile`

_function_ in `project/asset-files.ts`

Whether a file under the asset globs can be an asset before its content
is read: a kind claims its suffix, it is JSON a kind may claim by its
content, or a sidecar beside it names its kind. Anything else (a script
beside the art) is never read, listed, watched, pushed or pulled.

```ts
declare function mayBeAssetFile(kinds: KindRegistry, path: AssetPath, hasSidecar: () => boolean): boolean;
```

Refers to [`AssetPath`](#assetpath), [`KindRegistry`](#kindregistry).

## `memoryContentStore`

_function_ in `project/content-store.ts`

An in-memory store for tests and headless runs; it keeps its own copies, so callers may reuse their buffers.

```ts
declare function memoryContentStore(): ContentStore;
```

Refers to [`ContentStore`](#contentstore).

## `orphanSidecarIssue`

_function_ in `project/asset-files.ts`

The problem a sidecar with no asset file at `assetPath` is.

```ts
declare function orphanSidecarIssue(sidecarPath: AssetPath, assetPath: AssetPath): SceneIssue;
```

Refers to [`AssetPath`](#assetpath).

## `ownAssetId`

_function_ in `project/asset-files.ts`

The id a file gives itself with no sidecar: its doc kind's id field, else its name.

```ts
declare function ownAssetId(def: AssetKindDef, path: AssetPath, json: unknown): AssetId | null;
```

Refers to [`AssetId`](#assetid), [`AssetKindDef`](#assetkinddef), [`AssetPath`](#assetpath).

## `parseAsepriteJson`

_function_ in `project/inspect/aseprite.ts`

An Aseprite sheet's JSON (hash or array export): frames with durations, frame tags and slice keys.

```ts
declare function parseAsepriteJson(json: unknown): AtlasSheet | null;
```

Refers to [`AtlasSheet`](#atlassheet).

## `parseAssetDoc`

_function_ in `project/kinds.ts`

Reads a doc kind's file from text or a parsed value: JSON, the `kind`
its `jsonKind` names, `v` and migrations, then `validateAssetDoc`. The
value is the migrated JSON as written, so formatting it gives the file
back. Refused when any issue is an error; issues from text carry lines.
A kind with its own `parse` (scenes, prefabs) is read by it. Never throws.

```ts
declare function parseAssetDoc<J>(kind: DocKindDef<J>, input: unknown, env: KindEnv): ParseAssetResult<J>;
```

Refers to [`DocKindDef`](#dockinddef), [`KindEnv`](#kindenv), [`ParseAssetResult`](#parseassetresult).

## `parseBmfont`

_function_ in `project/inspect/bmfont.ts`

A text BMFont's line height and page files (in page id order, relative to
the .fnt). Null for the binary and XML variants, a missing `common` line,
or page ids that aren't 0…n-1 matching `common pages`.

```ts
declare function parseBmfont(text: string): null | {
    lineHeight: number;
    pages: string[];
};
```

## `parseDocName`

_function_ in `project/doc-names.ts`

The parts of a doc name, or null when it isn't one of the three forms.

```ts
declare function parseDocName(name: string): DocName | null;
```

Refers to [`DocName`](#docname).

## `parseJsonPointer`

_function_ in `project/json-edit.ts`

The reference tokens of an RFC 6901 pointer, unescaped; null when it is
malformed (no leading "/", or a "~" not followed by 0 or 1). A token
"@<id>" picks a keyed item by id only where the layout has a keyed
collection; in a map it is an ordinary key.

```ts
declare function parseJsonPointer(pointer: JsonPointer): null | string[];
```

Refers to [`JsonPointer`](#jsonpointer).

## `parseProjectFile`

_function_ in `project/project-file.ts`

Parses `jams.project.json` from text or a parsed value. Omitted globs stay omitted; `projectGlobs` fills them. Never throws.

```ts
declare function parseProjectFile(input: unknown): ParseProjectFileResult;
```

Refers to [`ParseProjectFileResult`](#parseprojectfileresult).

## `parseProjectSnapshot`

_function_ in `project/snapshot.ts`

Reads a snapshot from text or a parsed value; a `hash` its content doesn't give is `hash-mismatch`. Never throws.

```ts
declare function parseProjectSnapshot(input: unknown): Promise<ParseProjectSnapshotResult>;
```

Refers to [`ParseProjectSnapshotResult`](#parseprojectsnapshotresult).

## `parseReleaseManifest`

_function_ in `project/release.ts`

Reads `release.json`'s text: bad JSON, a wrong `kind`, a newer `v` or a shape the schema refuses are issues. Never throws.

```ts
declare function parseReleaseManifest(text: string): ParseReleaseManifestResult;
```

Refers to [`ParseReleaseManifestResult`](#parsereleasemanifestresult).

## `parseSceneVersion`

_function_ in `project/scene-version.ts`

Reads a scene version's text: bad JSON, a wrong `kind`, a newer `v` or a shape the schema refuses are issues. Never throws.

```ts
declare function parseSceneVersion(text: string): {
    issues: SceneIssue[];
    ok: false;
} | {
    ok: true;
    version: SceneVersion;
};
```

Refers to [`SceneVersion`](#sceneversion).

## `parseSidecar`

_function_ in `project/sidecar.ts`

Parses a sidecar from text or a parsed value. Never throws.

```ts
declare function parseSidecar(input: unknown): ParseSidecarResult;
```

Refers to [`ParseSidecarResult`](#parsesidecarresult).

## `parseTexturePackerJson`

_function_ in `project/inspect/texturepacker.ts`

A TexturePacker atlas's JSON (hash or array export, including the PixiJS
and Phaser flavours): frames with pivots, contiguous `animations` as tags,
and per-frame nine-slice borders as slices.

```ts
declare function parseTexturePackerJson(json: unknown): AtlasSheet | null;
```

Refers to [`AtlasSheet`](#atlassheet).

## `prefabKind`

_const_ in `project/kinds/prefab.ts`

A reusable piece of a level placed by instances, co-edited per child and field.

```ts
declare const prefabKind: {
    defaultFolder: (_env: KindEnv, near: string | undefined) => string;
    description: string;
    empty: (env: KindEnv, { id }: {
        id: AssetId;
    }) => Prefab;
    format: (prefab: Prefab) => string;
    idField: string;
    kind: string;
    layout: "custom";
    match: {
        jsonKind: string;
    };
    migrations: Readonly<Record<number, Migration>>;
    parse(input: unknown, env: KindEnv): {
        issues: SceneIssue[];
        migratedFrom: number;
        ok: true;
        value: Prefab;
    } | {
        issues: SceneIssue[];
        migratedFrom?: undefined;
        ok: true;
        value: Prefab;
    } | {
        issues: SceneIssue[];
        ok: false;
    };
    refs(prefab: Prefab, env: KindEnv): RefSite[];
    schema: (env: KindEnv) => z.ZodType<Prefab>;
    schemaId: string;
    storage: "doc";
    title: string;
    version: number;
};
```

Refers to [`AssetId`](#assetid), [`KindEnv`](#kindenv), [`RefSite`](#refsite).

## `projectBundle`

_function_ in `project/bundle.ts`

The bundle of the project's game-settings file `settings`: the asset
fields its kind's `refs` finds in the `game` block, defaults applied,
with each asset's own references followed as `sceneBundle` does. Loaded
once and kept resident.

```ts
declare function projectBundle(view: ProjectView, settings: unknown, kinds: KindRegistry, registry: Registry): {
    bundle: AssetBundle;
    issues: SceneIssue[];
};
```

Refers to [`AssetBundle`](#assetbundle), [`KindRegistry`](#kindregistry), [`ProjectView`](#projectview).

## `projectFileSchema`

_const_ in `project/project-file.ts`

The zod schema `project.schema.json` is generated from; `parseProjectFile` checks with it.

```ts
declare const projectFileSchema: z.ZodObject<{
    $schema: z.ZodOptional<z.ZodString>;
    assets: z.ZodOptional<z.ZodArray<z.ZodString>>;
    code: z.ZodOptional<z.ZodArray<z.ZodString>>;
    export: z.ZodOptional<z.ZodObject<{
        background: z.ZodOptional<z.ZodString>;
        budget: z.ZodOptional<z.ZodObject<{
            codeBytes: z.ZodOptional<z.ZodNumber>;
            fileBytes: z.ZodOptional<z.ZodNumber>;
            firstLoadBytes: z.ZodOptional<z.ZodNumber>;
            totalBytes: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        display: z.ZodOptional<z.ZodEnum<{
            "minimal-ui": "minimal-ui";
            fullscreen: "fullscreen";
            standalone: "standalone";
        }>>;
        icons: z.ZodOptional<z.ZodObject<{
            "192": z.ZodOptional<z.ZodString>;
            "512": z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        orientation: z.ZodOptional<z.ZodEnum<{
            any: "any";
            landscape: "landscape";
            portrait: "portrait";
        }>>;
        pwa: z.ZodOptional<z.ZodBoolean>;
        rapier: z.ZodOptional<z.ZodEnum<{
            compat: "compat";
            standard: "standard";
        }>>;
        shortName: z.ZodOptional<z.ZodString>;
        themeColor: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    game: z.ZodNullable<z.ZodObject<{
        export: z.ZodString;
        module: z.ZodString;
    }, z.core.$strict>>;
    id: z.ZodString;
    ignore: z.ZodOptional<z.ZodArray<z.ZodString>>;
    kind: z.ZodLiteral<"project">;
    name: z.ZodString;
    ui: z.ZodOptional<z.ZodObject<{
        export: z.ZodString;
        module: z.ZodString;
    }, z.core.$strict>>;
    v: z.ZodLiteral<1>;
}, z.core.$strict>;
```

## `projectGlobs`

_function_ in `project/project-file.ts`

A project file's globs with the defaults filled in. `ignore` is the
file's own; the fixed excludes are `isSkippedAssetPath`'s.

```ts
declare function projectGlobs(file: ProjectFile): {
    assets: string[];
    code: string[];
    ignore: string[];
};
```

Refers to [`ProjectFile`](#projectfile).

## `projectJsonSchema`

_function_ in `project/project-file.ts`

The draft 2020-12 JSON Schema of `jams.project.json`.

```ts
declare function projectJsonSchema(): Record<string, unknown>;
```

## `projectMaterialOf`

_function_ in `project/kinds/material.ts`

A material file as the registry overlays it; null when it isn't a valid
material. A v1 file is lifted to v2 first when `registry` gives its game's
px per metre.

```ts
declare function projectMaterialOf(value: unknown, registry?: Registry): ProjectMaterialDef | null;
```

## `projectOpBatchSchema`

_const_ in `project/ops.ts`

The zod schema `project-ops.schema.json` is generated from; `checkProjectBatch` checks with it.

```ts
declare const projectOpBatchSchema: z.ZodObject<{
    base: z.ZodOptional<z.ZodString>;
    label: z.ZodOptional<z.ZodString>;
    ops: z.ZodArray<z.ZodDiscriminatedUnion<readonly [
        z.ZodObject<{
            content: z.ZodOptional<z.ZodUnknown>;
            id: z.ZodOptional<z.ZodString>;
            kind: z.ZodString;
            licence: z.ZodOptional<z.ZodObject<{
                attribution: z.ZodOptional<z.ZodString>;
                author: z.ZodOptional<z.ZodString>;
                source: z.ZodOptional<z.ZodString>;
                spdx: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            op: z.ZodLiteral<"createAsset">;
            path: z.ZodString;
        }, z.core.$strict>,
        z.ZodObject<{
            bytes: z.ZodNumber;
            id: z.ZodOptional<z.ZodString>;
            kind: z.ZodOptional<z.ZodString>;
            licence: z.ZodOptional<z.ZodObject<{
                attribution: z.ZodOptional<z.ZodString>;
                author: z.ZodOptional<z.ZodString>;
                source: z.ZodOptional<z.ZodString>;
                spdx: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            op: z.ZodLiteral<"importAsset">;
            path: z.ZodString;
            settings: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            sha256: z.ZodString;
        }, z.core.$strict>,
        z.ZodObject<{
            file: z.ZodOptional<z.ZodString>;
            id: z.ZodString;
            name: z.ZodOptional<z.ZodUnion<readonly [
                z.ZodString,
                z.ZodNull
            ]>>;
            op: z.ZodLiteral<"renameAsset">;
        }, z.core.$strict>,
        z.ZodObject<{
            ids: z.ZodArray<z.ZodString>;
            op: z.ZodLiteral<"moveAsset">;
            to: z.ZodString;
        }, z.core.$strict>,
        z.ZodObject<{
            force: z.ZodOptional<z.ZodBoolean>;
            id: z.ZodString;
            op: z.ZodLiteral<"deleteAsset">;
        }, z.core.$strict>,
        z.ZodObject<{
            id: z.ZodString;
            op: z.ZodLiteral<"restoreAsset">;
        }, z.core.$strict>,
        z.ZodObject<{
            id: z.ZodString;
            op: z.ZodLiteral<"purgeAsset">;
        }, z.core.$strict>,
        z.ZodObject<{
            id: z.ZodString;
            op: z.ZodLiteral<"changeAssetId">;
            to: z.ZodString;
        }, z.core.$strict>,
        z.ZodObject<{
            id: z.ZodString;
            op: z.ZodLiteral<"setImport">;
            set: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, z.core.$strict>,
        z.ZodObject<{
            bytes: z.ZodNumber;
            id: z.ZodString;
            op: z.ZodLiteral<"replaceContent">;
            sha256: z.ZodString;
        }, z.core.$strict>,
        z.ZodObject<{
            id: z.ZodString;
            licence: z.ZodUnion<readonly [
                z.ZodObject<{
                    attribution: z.ZodOptional<z.ZodString>;
                    author: z.ZodOptional<z.ZodString>;
                    source: z.ZodOptional<z.ZodString>;
                    spdx: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>,
                z.ZodNull
            ]>;
            op: z.ZodLiteral<"setLicence">;
        }, z.core.$strict>,
        z.ZodObject<{
            edits: z.ZodArray<z.ZodUnion<readonly [
                z.ZodObject<{
                    set: z.ZodString;
                    value: z.ZodUnknown;
                }, z.core.$strict>,
                z.ZodObject<{
                    unset: z.ZodString;
                }, z.core.$strict>,
                z.ZodObject<{
                    before: z.ZodOptional<z.ZodUnion<readonly [
                        z.ZodString,
                        z.ZodNumber
                    ]>>;
                    insert: z.ZodString;
                    value: z.ZodUnknown;
                }, z.core.$strict>,
                z.ZodObject<{
                    remove: z.ZodString;
                }, z.core.$strict>
            ]>>;
            id: z.ZodString;
            op: z.ZodLiteral<"editAsset">;
        }, z.core.$strict>,
        z.ZodObject<{
            id: z.ZodString;
            op: z.ZodLiteral<"editScene">;
            ops: z.ZodArray<z.ZodObject<{
                op: z.ZodString;
            }, z.core.$loose>>;
        }, z.core.$strict>
    ], "op">>;
    v: z.ZodLiteral<1>;
}, z.core.$strict>;
```

## `projectOpsJsonSchema`

_function_ in `project/ops.ts`

The draft 2020-12 JSON Schema of a project op batch.

```ts
declare function projectOpsJsonSchema(): Record<string, unknown>;
```

## `projectPathMatcher`

_function_ in `project/asset-files.ts`

```ts
declare function projectPathMatcher(file: ProjectFile, match: GlobMatch): ProjectPathMatcher;
```

Refers to [`GlobMatch`](#globmatch), [`ProjectFile`](#projectfile), [`ProjectPathMatcher`](#projectpathmatcher).

## `projectSnapshotJsonSchema`

_function_ in `project/snapshot.ts`

The draft 2020-12 JSON Schema of a project snapshot.

```ts
declare function projectSnapshotJsonSchema(): Record<string, unknown>;
```

## `projectSnapshotSchema`

_const_ in `project/snapshot.ts`

The zod schema `project-snapshot.schema.json` is generated from; `parseProjectSnapshot` checks with it.

```ts
declare const projectSnapshotSchema: z.ZodObject<{
    $schema: z.ZodOptional<z.ZodString>;
    assets: z.ZodRecord<z.ZodString, z.ZodObject<{
        bytes: z.ZodOptional<z.ZodNumber>;
        import: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        key: z.ZodString;
        kind: z.ZodString;
        meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        path: z.ZodString;
        sha256: z.ZodString;
    }, z.core.$strict>>;
    at: z.ZodNumber;
    build: z.ZodRecord<z.ZodString, z.ZodString>;
    engine: z.ZodString;
    hash: z.ZodString;
    kind: z.ZodLiteral<"project-snapshot">;
    project: z.ZodString;
    v: z.ZodLiteral<1>;
}, z.core.$strict>;
```

## `projectUsage`

_function_ in `project/usage.ts`

What a project holds, live and trashed: its asset docs (`docBytes` gives
each one's stored state size by key; a doc without a size counts 0) and
its distinct blobs, current and in hash history. `trashBytes` is what
emptying the trash would free: trashed docs, and blobs only trashed
entries hold.

```ts
declare function projectUsage(view: ProjectView, docBytes: ReadonlyMap<AssetKey, number>): ProjectUsage;
```

Refers to [`AssetKey`](#assetkey), [`ProjectUsage`](#projectusage), [`ProjectView`](#projectview).

## `projectView`

_function_ in `project/view.ts`

The resolved view of a project's state. Two live entries with one id, or
with paths that are equal ignoring case, are ordered by (created.at, key):
the first keeps it, and each later one gets an issue and a repair with a
`-2`, `-3` suffix that no other entry, live or trashed, uses. With
`kinds`, a live entry whose kind isn't registered reports `asset-kind`.

```ts
declare function projectView(state: ProjectState, kinds?: KindRegistry): ProjectView;
```

Refers to [`KindRegistry`](#kindregistry), [`ProjectState`](#projectstate), [`ProjectView`](#projectview).

## `readGifSize`

_function_ in `project/inspect/gif.ts`

A GIF's logical screen size.

```ts
declare function readGifSize(bytes: Uint8Array): ImageSize | null;
```

Refers to [`ImageSize`](#imagesize).

## `readJpegSize`

_function_ in `project/inspect/jpeg.ts`

A JPEG's size from its first start-of-frame segment, skipping the segments before it.

```ts
declare function readJpegSize(bytes: Uint8Array): ImageSize | null;
```

Refers to [`ImageSize`](#imagesize).

## `readPngSize`

_function_ in `project/inspect/png.ts`

A PNG's size from its IHDR chunk, which the format requires first.

```ts
declare function readPngSize(bytes: Uint8Array): ImageSize | null;
```

Refers to [`ImageSize`](#imagesize).

## `readPointer`

_function_ in `project/json-edit.ts`

The value at `pointer`, walking the layout the way `applyJsonEdits` does.

```ts
declare function readPointer(value: unknown, layout: DocLayout, pointer: JsonPointer): PointerRead;
```

Refers to [`DocLayout`](#doclayout), [`JsonPointer`](#jsonpointer), [`PointerRead`](#pointerread).

## `readSceneVersion`

_function_ in `project/scene-version.ts`

The one reader of a version for play: parses its scene and prefabs from
`texts` (canonical texts by hash), validates the scene with `registry`
against the version's own assets, and expands it, as Play does. With
`game`, a version made for another game or configuration is refused
first. `opts.engine` is the project's `engine` block, which settings
resolve through.

```ts
declare function readSceneVersion(version: SceneVersion, texts: ReadonlyMap<Sha256, string>, registry: Registry, game: GameDefinition | null, opts?: {
    engine?: Readonly<Record<string, unknown>>;
}): SceneVersionRead;
```

Refers to [`SceneVersion`](#sceneversion), [`SceneVersionRead`](#sceneversionread), [`Sha256`](#sha256).

## `readWebpSize`

_function_ in `project/inspect/webp.ts`

A WebP's size from its first chunk: lossy (VP8), lossless (VP8L) or extended (VP8X).

```ts
declare function readWebpSize(bytes: Uint8Array): ImageSize | null;
```

Refers to [`ImageSize`](#imagesize).

## `recordingKind`

_const_ in `project/kinds/recording.ts`

A recorded run, its bytes a `recording:v2` file or a `recording:v1` one,
which is read through the v1 migration. Immutable once imported:
a recording pins the scene hash it was made on, so `replaceContent` on one
is refused with `asset-kind`; record again and import the new file.

```ts
declare const recordingKind: {
    contentTypes: string[];
    defaultFolder: (_env: KindEnv, near: string | undefined) => string;
    description: string;
    inspect: (bytes: Uint8Array, settings: RecordingSettings, env: InspectEnv) => InspectResult<RecordingMeta>;
    kind: string;
    match: {
        suffixes: string[];
    };
    maxBytes: number;
    meta: z.ZodType<RecordingMeta, unknown, z.core.$ZodTypeInternals<RecordingMeta, unknown>>;
    refs: (entry: AssetEntry) => RefSite[];
    settings: z.ZodType<RecordingSettings, unknown, z.core.$ZodTypeInternals<RecordingSettings, unknown>>;
    storage: "blob";
    title: string;
};
```

Refers to [`AssetEntry`](#assetentry), [`InspectEnv`](#inspectenv), [`InspectResult`](#inspectresult), [`KindEnv`](#kindenv), [`RecordingMeta`](#recordingmeta), [`RecordingSettings`](#recordingsettings), [`RefSite`](#refsite).

## `recordingMetaSchema`

_const_ in `project/kinds/recording.ts`

```ts
declare const recordingMetaSchema: z.ZodType<RecordingMeta>;
```

Refers to [`RecordingMeta`](#recordingmeta).

## `recordingSettingsSchema`

_const_ in `project/kinds/recording.ts`

```ts
declare const recordingSettingsSchema: z.ZodType<RecordingSettings>;
```

Refers to [`RecordingSettings`](#recordingsettings).

## `referencedTrash`

_function_ in `project/refs.ts`

Trashed entries that a live value names while no live asset holds their
id: what the project's writer restores so a delete racing a new
reference ends restored, never dangling. Of several trashed entries with
one id, the one deleted last. Keys, sorted.

```ts
declare function referencedTrash(view: ProjectView, index: RefIndex): AssetKey[];
```

Refers to [`AssetKey`](#assetkey), [`ProjectView`](#projectview), [`RefIndex`](#refindex).

## `releaseBuildHash`

_function_ in `project/release.ts`

`build.hash`: SHA-256 of the stable JSON of the code, style and wasm files as [path, sha256] pairs, sorted by path.

```ts
declare function releaseBuildHash(files: readonly ReleaseFile[]): Promise<Sha256>;
```

Refers to [`ReleaseFile`](#releasefile), [`Sha256`](#sha256).

## `releaseId`

_function_ in `project/release.ts`

The release id: sha256 of `formatReleaseManifest`'s text.

```ts
declare function releaseId(manifest: ReleaseManifest): Promise<Sha256>;
```

Refers to [`ReleaseManifest`](#releasemanifest), [`Sha256`](#sha256).

## `releaseJsonSchema`

_function_ in `project/release.ts`

The draft 2020-12 JSON Schema of `release.json`.

```ts
declare function releaseJsonSchema(): Record<string, unknown>;
```

## `releaseManifestSchema`

_const_ in `project/release.ts`

The manifest's zod schema; `parseReleaseManifest` checks with it.

```ts
declare const releaseManifestSchema: z.ZodType<ReleaseManifest>;
```

Refers to [`ReleaseManifest`](#releasemanifest).

## `releaseSnapshot`

_function_ in `project/release.ts`

The project snapshot the manifest pins (`at: 0`), rebuilt from `project` and `assets`; its `hash` is `project.snapshot`.

```ts
declare function releaseSnapshot(manifest: ReleaseManifest): ProjectSnapshot;
```

Refers to [`ProjectSnapshot`](#projectsnapshot), [`ReleaseManifest`](#releasemanifest).

## `rewriteRefs`

_function_ in `project/refs.ts`

The value with every `from` reference at `sites` replaced by `to`. Only
the named sites change, and only where they still hold `from`; the input
is never mutated and untouched branches are shared. A key site renames
its key (`solid:from` → `solid:to`, joining an existing `solid:to`). With
the referring kind's `layout`, an "@<id>" segment matches a keyed
collection's own id field; without one, the items' `id`.

```ts
declare function rewriteRefs<J>(value: J, sites: readonly RefSite[], from: AssetId, to: AssetId, layout?: DocLayout): J;
```

Refers to [`AssetId`](#assetid), [`DocLayout`](#doclayout), [`RefSite`](#refsite).

## `rowSchemaOf`

_function_ in `project/kinds/data-table.ts`

A table's row: its schema's fields plus `id`.

```ts
declare function rowSchemaOf(def: GameTableDef): z.ZodObject;
```

## `runtimeView`

_function_ in `project/runtime-view.ts`

The runtime view of a project; `values` holds each doc asset's plain JSON
by id. `settings` is the first game-settings asset's `game` block by
path, with the game's `projectSettings` defaults applied. A table's rows
are its assets' rows in path order, each through the table's row schema
(defaults applied); a row that doesn't fit it, or whose id an earlier row
has, is left out (the editor reports both). A table the game doesn't
declare has no rows. `engine` is that asset's `engine` block, unparsed.
`inputMap` is the first input-map asset by path, as `usableInputMap`
reads it, and `flow` the first scene list's as `sceneListFlow` reads it.
Read once, copied and frozen.

```ts
declare function runtimeView(view: ProjectView, values: ReadonlyMap<AssetId, unknown>, registry: Registry): ProjectRuntimeView;
```

Refers to [`AssetId`](#assetid), [`ProjectRuntimeView`](#projectruntimeview), [`ProjectView`](#projectview).

## `saveFixtureMetaSchema`

_const_ in `project/kinds/save.ts`

```ts
declare const saveFixtureMetaSchema: z.ZodType<SaveFixtureMeta>;
```

Refers to [`SaveFixtureMeta`](#savefixturemeta).

## `saveFixtureSettingsSchema`

_const_ in `project/kinds/save.ts`

```ts
declare const saveFixtureSettingsSchema: z.ZodType<SaveFixtureSettings>;
```

Refers to [`SaveFixtureSettings`](#savefixturesettings).

## `saveKind`

_const_ in `project/kinds/save.ts`

A `save:v1` file a playtest can start from. Unlike a recording it can be
recaptured: new bytes are a `replaceContent`, last writer wins on the hash.

```ts
declare const saveKind: {
    contentTypes: string[];
    defaultFolder: (_env: KindEnv, near: string | undefined) => string;
    description: string;
    inspect: (bytes: Uint8Array, settings: SaveFixtureSettings, env: InspectEnv) => InspectResult<SaveFixtureMeta>;
    kind: string;
    match: {
        suffixes: string[];
    };
    maxBytes: number;
    meta: z.ZodType<SaveFixtureMeta, unknown, z.core.$ZodTypeInternals<SaveFixtureMeta, unknown>>;
    refs: (entry: AssetEntry) => RefSite[];
    settings: z.ZodType<SaveFixtureSettings, unknown, z.core.$ZodTypeInternals<SaveFixtureSettings, unknown>>;
    storage: "blob";
    title: string;
};
```

Refers to [`AssetEntry`](#assetentry), [`InspectEnv`](#inspectenv), [`InspectResult`](#inspectresult), [`KindEnv`](#kindenv), [`RefSite`](#refsite), [`SaveFixtureMeta`](#savefixturemeta), [`SaveFixtureSettings`](#savefixturesettings).

## `sceneBundle`

_function_ in `project/bundle.ts`

The bundle of an expanded scene: every asset field of its entities
(instances resolved and defaults applied, so an id only a type's or a
behavior's default names counts), its settings' asset fields, and the
`assets` headers of `def` and of every prefab it reaches
(`prefabsUsedBy`: nesting and variant bases included), with each asset's
own references followed. A prefab a field names (a spawner's `prefab`)
that `prefabs` holds brings its children's asset fields and its header
too, and so on through what those name (`namedPrefabs`). Entries are the
textures among them, sorted by id, each once. A reference no live asset
of its kinds resolves, or a texture with no content, is `asset-missing`
with the closest live id; a texture whose entry records a hash but no
size is left out and is `asset-missing` too, saying so.

```ts
declare function sceneBundle(scene: ExpandedScene, def: SceneDefinition, prefabs: PrefabLibrary, view: ProjectView, kinds: KindRegistry, registry: Registry): {
    bundle: AssetBundle;
    issues: SceneIssue[];
};
```

Refers to [`AssetBundle`](#assetbundle), [`KindRegistry`](#kindregistry), [`ProjectView`](#projectview).

## `sceneKind`

_const_ in `project/kinds/scene.ts`

A level: entities, instances and bulk geometry, co-edited per entity and field through the scene codec.

```ts
declare const sceneKind: {
    defaultFolder: (_env: KindEnv, near: string | undefined) => string;
    description: string;
    empty: (env: KindEnv, { id }: {
        id: AssetId;
    }) => SceneDefinition;
    format: (def: SceneDefinition) => string;
    kind: string;
    layout: "custom";
    match: {
        test: (json: unknown) => boolean;
    };
    migrations: Readonly<Record<number, Migration>>;
    parse(input: unknown, env: KindEnv): {
        issues: SceneIssue[];
        migratedFrom: number;
        ok: true;
        value: SceneDefinition;
    } | {
        issues: SceneIssue[];
        migratedFrom?: undefined;
        ok: true;
        value: SceneDefinition;
    } | {
        issues: SceneIssue[];
        ok: false;
    };
    prefix: "scene";
    refs(def: SceneDefinition, env: KindEnv): RefSite[];
    schema: (env: KindEnv) => z.ZodType<SceneDefinition>;
    schemaId: string;
    storage: "doc";
    title: string;
    version: number;
};
```

Refers to [`AssetId`](#assetid), [`KindEnv`](#kindenv), [`RefSite`](#refsite).

## `sceneListEntries`

_function_ in `project/kinds/scene-list.ts`

The project's live scene lists, the one in effect (first by path) first.

```ts
declare function sceneListEntries(view: ProjectView): AssetEntry[];
```

Refers to [`AssetEntry`](#assetentry), [`ProjectView`](#projectview).

## `sceneListFlow`

_function_ in `project/kinds/scene-list.ts`

The start and entries of a scene list's value, read leniently: an entry
that isn't an object naming a scene, or whose scene an earlier entry
lists, is left out (validation reports both), and a start that isn't a
string is null. `undefined` (no list) is the empty flow.

```ts
declare function sceneListFlow(value: unknown): SceneListFlow;
```

Refers to [`SceneListFlow`](#scenelistflow).

## `sceneListIssues`

_function_ in `project/kinds/scene-list.ts`

`scene-unlisted` (warn) for each scene a listed scene's checks name that
flow couldn't go to under the list in effect (unlisted, or a sublevel):
a `reaches` check's `expect.scene`, and its script's `scene` and steps'
`until.scene`, inline or in the input script its path names (relative to
the checks file). Each issue's `path` points into the file
that names the scene, `entityIds` holds that file's asset key and the scene,
and `detail` holds the listed scene and the check. `lineOf` gives a
pointer's line in an asset's text, for a host that holds the texts.
A second list's `asset-kind` is the project view's.

```ts
declare function sceneListIssues(view: ProjectView, values: ReadonlyMap<AssetId, unknown>, opts?: {
    lineOf?: (asset: AssetId, pointer: string) => number | undefined;
}): SceneIssue[];
```

Refers to [`AssetId`](#assetid), [`ProjectView`](#projectview).

## `sceneListKind`

_const_ in `project/kinds/scene-list.ts`

The start and the listed scenes, co-edited per entry and ordered like entities.

```ts
declare const sceneListKind: {
    defaultFolder: () => string;
    description: string;
    empty: (env?: KindEnv) => SceneListFile;
    kind: string;
    layout: {
        as: "map";
        fields: {
            scenes: {
                as: "keyed";
                id: string;
                item: {
                    as: "map";
                    rest: {
                        as: "atomic";
                    };
                };
            };
            start: {
                as: "atomic";
            };
        };
        rest: {
            as: "atomic";
        };
    };
    limits: {
        maxItems: number;
        maxStateBytes: number;
    };
    match: {
        jsonKind: string;
    };
    perProject: 1;
    perProjectWords: {
        contents: string;
        noun: string;
    };
    refs: (file: SceneListFile) => RefSite[];
    schema: () => z.ZodType<SceneListFile, unknown, z.core.$ZodTypeInternals<SceneListFile, unknown>>;
    schemaId: string;
    storage: "doc";
    title: string;
    /**
     * `start-scene-missing` from flow's rule: an error for a start that is
     * null, isn't listed or is a sublevel. A list that lists nothing (a
     * project without scenes) has nothing to start, so its null start is a
     * warning there; flow refuses to start either way. An entry naming no
     * scene is the ref index's `asset-missing`; a repeated entry is the keyed
     * layout's `dup-id`.
     */
    validate: (file: SceneListFile) => SceneIssue[];
    version: number;
};
```

Refers to [`KindEnv`](#kindenv), [`RefSite`](#refsite), [`SceneListFile`](#scenelistfile).

## `sceneVersionId`

_function_ in `project/scene-version.ts`

SHA-256 of `formatSceneVersion`'s text: the version's id.

```ts
declare function sceneVersionId(version: SceneVersion): Promise<Sha256>;
```

Refers to [`SceneVersion`](#sceneversion), [`Sha256`](#sha256).

## `sceneVersionJsonSchema`

_function_ in `project/scene-version.ts`

The draft 2020-12 JSON Schema of `scene-version.json`.

```ts
declare function sceneVersionJsonSchema(): Record<string, unknown>;
```

## `sceneVersionSchema`

_const_ in `project/scene-version.ts`

The zod schema `scene-version.schema.json` is generated from; `parseSceneVersion` checks with it.

```ts
declare const sceneVersionSchema: z.ZodType<SceneVersion>;
```

Refers to [`SceneVersion`](#sceneversion).

## `sceneVersionSnapshot`

_function_ in `project/scene-version.ts`

A `ProjectSnapshot` holding exactly the version's assets (`at: 0`), hashed as `snapshotProject` hashes: what a collector pins.

```ts
declare function sceneVersionSnapshot(version: SceneVersion): Promise<ProjectSnapshot>;
```

Refers to [`ProjectSnapshot`](#projectsnapshot), [`SceneVersion`](#sceneversion).

## `schemaRefSites`

_function_ in `project/refs.ts`

The asset references in `value` that `shape` declares: a site at every
leaf whose schema is an `assetField`, found by following objects,
records, arrays, tuples, unions and their optional, nullable and default
wrappers alongside the value. Pointers start at `pointer` (the value's
own); keys the shape doesn't declare are skipped.

```ts
declare function schemaRefSites(shape: z.ZodRawShape, value: unknown, pointer: JsonPointer): RefSite[];
```

Refers to [`JsonPointer`](#jsonpointer), [`RefSite`](#refsite).

## `sha256`

_function_ in `project/hash.ts`

SHA-256 of `data` as 64 lowercase hex characters; a string is hashed as its UTF-8 bytes.

```ts
declare function sha256(data: Uint8Array | string): Promise<Sha256>;
```

Refers to [`Sha256`](#sha256).

## `sidecarJsonSchema`

_function_ in `project/sidecar.ts`

The draft 2020-12 JSON Schema of `<file>.asset.json`.

```ts
declare function sidecarJsonSchema(): Record<string, unknown>;
```

## `sidecarPathOf`

_const_ in `project/sidecar.ts`

```ts
declare const sidecarPathOf: (path: AssetPath) => AssetPath;
```

Refers to [`AssetPath`](#assetpath).

## `sidecarSchema`

_const_ in `project/sidecar.ts`

The zod schema `asset-sidecar.schema.json` is generated from; `parseSidecar` checks with it.

```ts
declare const sidecarSchema: z.ZodObject<{
    $schema: z.ZodOptional<z.ZodString>;
    assetKind: z.ZodOptional<z.ZodString>;
    bytes: z.ZodOptional<z.ZodNumber>;
    id: z.ZodString;
    import: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    key: z.ZodOptional<z.ZodString>;
    kind: z.ZodLiteral<"asset-sidecar">;
    licence: z.ZodOptional<z.ZodObject<{
        attribution: z.ZodOptional<z.ZodString>;
        author: z.ZodOptional<z.ZodString>;
        source: z.ZodOptional<z.ZodString>;
        spdx: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    name: z.ZodOptional<z.ZodString>;
    sha256: z.ZodOptional<z.ZodString>;
    v: z.ZodLiteral<1>;
}, z.core.$strict>;
```

## `snapshotProject`

_function_ in `project/snapshot.ts`

Pins every live asset of `view`: a doc by the SHA-256 of its canonical
text in `texts` (by id), a blob by its entry's `sha256`. Throws when a
live doc has no text. `at` is the wall clock; nothing else depends on
when it runs.

```ts
declare function snapshotProject(view: ProjectView, texts: ReadonlyMap<AssetId, string>, build: ProjectState["build"]): Promise<ProjectSnapshot>;
```

Refers to [`AssetId`](#assetid), [`ProjectSnapshot`](#projectsnapshot), [`ProjectState`](#projectstate), [`ProjectView`](#projectview).

## `snapshotScene`

_function_ in `project/snapshot.ts`

A scene and the prefabs its instances name, read from their canonical
texts in `store`, and the registry they parse and run by: `registry`'s
game with the snapshot's own material assets in place of any overlay it
had, so a material edited after the snapshot never reaches it. What a
loader or a live level pins. The library is keyed by asset id. Throws a
`SnapshotError` when the scene or a prefab it names isn't in the
snapshot, is another kind, or doesn't parse, or when it or a material
has no text in the store.

```ts
declare function snapshotScene(snapshot: ProjectSnapshot, sceneId: AssetId, store: ContentStore, registry: Registry): Promise<{
    def: SceneDefinition;
    prefabs: PrefabLibrary;
    registry: Registry;
}>;
```

Refers to [`AssetId`](#assetid), [`ContentStore`](#contentstore), [`ProjectSnapshot`](#projectsnapshot).

## `stableJson`

_function_ in `project/canonical.ts`

JSON with object keys sorted, so equal values give equal text whatever order their keys were set in.

```ts
declare function stableJson(value: unknown): string;
```

## `suffixedId`

_function_ in `project/view.ts`

`id` with `-<n>`, cut so the result is still at most 48 characters.

```ts
declare function suffixedId(id: AssetId, n: number): AssetId;
```

Refers to [`AssetId`](#assetid).

## `suffixedPath`

_function_ in `project/view.ts`

`path` with `-<n>` before its extension, so the kind's suffix survives: `a/yard.checks.json` → `a/yard-2.checks.json`.

```ts
declare function suffixedPath(path: AssetPath, n: number): AssetPath;
```

Refers to [`AssetPath`](#assetpath).

## `tableAssets`

_function_ in `project/kinds/data-table.ts`

One table's assets in path order, with the rows each holds.

```ts
declare function tableAssets(view: ProjectView, values: ReadonlyMap<AssetId, unknown>, table: string): {
    entry: AssetEntry;
    rows: readonly unknown[];
}[];
```

Refers to [`AssetEntry`](#assetentry), [`AssetId`](#assetid), [`ProjectView`](#projectview).

## `textureKind`

_const_ in `project/kinds/texture.ts`

An image: PNG, JPEG, WebP or GIF, sized from its header.

```ts
declare const textureKind: {
    contentTypes: string[];
    defaultFolder: (_env: KindEnv, near: string | undefined) => string;
    description: string;
    inspect: (bytes: Uint8Array, settings: TextureSettings, env: InspectEnv) => InspectResult<TextureMeta>;
    kind: string;
    match: {
        suffixes: string[];
    };
    maxBytes: number;
    meta: z.ZodType<TextureMeta, unknown, z.core.$ZodTypeInternals<TextureMeta, unknown>>;
    settings: z.ZodType<TextureSettings, unknown, z.core.$ZodTypeInternals<TextureSettings, unknown>>;
    storage: "blob";
    title: string;
};
```

Refers to [`InspectEnv`](#inspectenv), [`InspectResult`](#inspectresult), [`KindEnv`](#kindenv), [`TextureMeta`](#texturemeta), [`TextureSettings`](#texturesettings).

## `textureMetaSchema`

_const_ in `project/kinds/texture.ts`

```ts
declare const textureMetaSchema: z.ZodType<TextureMeta>;
```

Refers to [`TextureMeta`](#texturemeta).

## `textureSettingsSchema`

_const_ in `project/kinds/texture.ts`

```ts
declare const textureSettingsSchema: z.ZodType<TextureSettings>;
```

Refers to [`TextureSettings`](#texturesettings).

## `unreferencedBlobs`

_function_ in `project/usage.ts`

Blob hashes nothing keeps: not a live or trashed entry's current hash,
replaced (its newest history entry) within `graceMs` of `now`, not in any pinned
snapshot. In `stored` order, each once. Pure; the host decides when to
call it and what to delete.

```ts
declare function unreferencedBlobs(view: ProjectView, stored: readonly Sha256[], opts: {
    graceMs: number;
    now: number;
    pinned: readonly ProjectSnapshot[];
}): Sha256[];
```

Refers to [`ProjectSnapshot`](#projectsnapshot), [`ProjectView`](#projectview), [`Sha256`](#sha256).

## `usableInputMap`

_function_ in `project/kinds/input-map.ts`

The parts of a file a run uses: null when it isn't an input map's
shape; else the map without its seats, an action or a touch control that
`inputMapProblems` refuses, so those keep the game's.

```ts
declare function usableInputMap(raw: unknown, registry: Registry): InputMapFile | null;
```

Refers to [`InputMapFile`](#inputmapfile).

## `validateAssetDoc`

_function_ in `project/kinds.ts`

Judges a doc kind's parsed, migrated value: its schema's issues, a
`dup-id` for each repeated id in a `keyed` collection, then the kind's
own `validate` when the schema passed.

```ts
declare function validateAssetDoc(kind: DocKindDef, value: unknown, env: KindEnv): SceneIssue[];
```

Refers to [`DocKindDef`](#dockinddef), [`KindEnv`](#kindenv).

## `writesPrefabs`

_function_ in `project/ops.ts`

Whether an `editScene` writes prefab docs: it targets a prefab, or holds a prefab op.

```ts
declare function writesPrefabs(op: EditSceneOp, targetKind: AssetKindName | undefined): boolean;
```

Refers to [`AssetKindName`](#assetkindname), [`EditSceneOp`](#editsceneop).
