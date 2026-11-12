# @jams/engine/scene

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`AGENT_SURFACE_KEYWORD`](#agent_surface_keyword) · [`AGENT_SURFACE_VERSION`](#agent_surface_version) · [`Aabb`](#aabb) · [`AnalogSet`](#analogset) · [`ApplyOptions`](#applyoptions) · [`ApplyResult`](#applyresult) · [`AssetId`](#assetid) · [`Bounds`](#bounds) · [`BulkEntry`](#bulkentry) · [`BulkForm`](#bulkform) · [`BulkKey`](#bulkkey) · [`BulkPlacement`](#bulkplacement) · [`CHECKS_FORMAT_VERSION`](#checks_format_version) · [`CHECKS_LAYOUT`](#checks_layout) · [`CHECKS_SUFFIX`](#checks_suffix) · [`CHILD_SEPARATOR`](#child_separator) · [`CHUNK_KEY_PATTERN`](#chunk_key_pattern) · [`CellEdit`](#celledit) · [`CellRect`](#cellrect) · [`CheckCell`](#checkcell) · [`CheckPlace`](#checkplace) · [`ChecksFile`](#checksfile) · [`ChecksIssue`](#checksissue) · [`ChunkKey`](#chunkkey) · [`ConnectedCheck`](#connectedcheck) · [`CountMatch`](#countmatch) · [`DEFAULT_ASCII_TAG_CHARS`](#default_ascii_tag_chars) · [`DEFAULT_BLOCKED_BY`](#default_blocked_by) · [`DEFAULT_LAYERS`](#default_layers) · [`DEFAULT_SCRIPT_MAX_TICKS`](#default_script_max_ticks) · [`DEFAULT_TOUCH_ROLLOUTS`](#default_touch_rollouts) · [`DEFAULT_TOUCH_SEED`](#default_touch_seed) · [`DEFAULT_TOUCH_TICKS`](#default_touch_ticks) · [`DEFAULT_UNTIL_MAX`](#default_until_max) · [`Dihedral`](#dihedral) · [`DrawnSprite`](#drawnsprite) · [`EMPTY_SCENE_TEMPLATE`](#empty_scene_template) · [`ENGINE_ISSUE_CODE_LIST`](#engine_issue_code_list) · [`ENGINE_REGISTRY_ID`](#engine_registry_id) · [`EngineIssueCode`](#engineissuecode) · [`EntityBase`](#entitybase) · [`EntityDef`](#entitydef) · [`EntityInput`](#entityinput) · [`EntityTypeName`](#entitytypename) · [`ExistsMatch`](#existsmatch) · [`ExpandOptions`](#expandoptions) · [`ExpandedScene`](#expandedscene) · [`FRAGMENT_KIND`](#fragment_kind) · [`FieldKind`](#fieldkind) · [`FieldPath`](#fieldpath) · [`GRID_CHUNK`](#grid_chunk) · [`GRID_MAX_VALUE`](#grid_max_value) · [`GRID_ROW_PATTERN`](#grid_row_pattern) · [`GameCheck`](#gamecheck) · [`GridCells`](#gridcells) · [`GridProblem`](#gridproblem) · [`GridRow`](#gridrow) · [`GridSettings`](#gridsettings) · [`GroupDef`](#groupdef) · [`GroupSchema`](#groupschema) · [`IDENTITY_2D`](#identity_2d) · [`ID_PATTERN`](#id_pattern) · [`INPUT_SCRIPT_LAYOUT`](#input_script_layout) · [`INPUT_SCRIPT_MIGRATIONS`](#input_script_migrations) · [`INPUT_SCRIPT_VERSION`](#input_script_version) · [`INSTANCE_OVERRIDE_FIELDS`](#instance_override_fields) · [`ISSUE_CODES`](#issue_codes) · [`InputScriptSchemas`](#inputscriptschemas) · [`InstanceDef`](#instancedef) · [`InstanceInput`](#instanceinput) · [`InstanceSchema`](#instanceschema) · [`IssueCode`](#issuecode) · [`IssueCodeInfo`](#issuecodeinfo) · [`JsonSchemaOptions`](#jsonschemaoptions) · [`LENGTH_UNITS`](#length_units) · [`LengthUnitName`](#lengthunitname) · [`LocalChild`](#localchild) · [`MAX_SCRIPT_TICKS`](#max_script_ticks) · [`MAX_TOUCH_ROLLOUTS`](#max_touch_rollouts) · [`MIGRATIONS`](#migrations) · [`MigrateEnv`](#migrateenv) · [`MigrateInputScriptResult`](#migrateinputscriptresult) · [`MigrateResult`](#migrateresult) · [`Migration`](#migration) · [`MigrationRefusal`](#migrationrefusal) · [`OP_NAMES`](#op_names) · [`OVERRIDE_PATH`](#override_path) · [`OpBatch`](#opbatch) · [`OverlayPoint`](#overlaypoint) · [`OverridePath`](#overridepath) · [`PREFABS_DIR`](#prefabs_dir) · [`PREFAB_KIND`](#prefab_kind) · [`PREFAB_MAX_DEPTH`](#prefab_max_depth) · [`ParseChecksResult`](#parsechecksresult) · [`ParseFragmentResult`](#parsefragmentresult) · [`ParseInputScriptResult`](#parseinputscriptresult) · [`ParseOptions`](#parseoptions) · [`ParsePrefabResult`](#parseprefabresult) · [`ParseRecordingResult`](#parserecordingresult) · [`ParseSceneResult`](#parsesceneresult) · [`ParseShapeResult`](#parseshaperesult) · [`PathCommand`](#pathcommand) · [`PathDef`](#pathdef) · [`PlacedChild`](#placedchild) · [`PlacedFragment`](#placedfragment) · [`Prefab`](#prefab) · [`PrefabBody`](#prefabbody) · [`PrefabLibrary`](#prefablibrary) · [`PrefabParam`](#prefabparam) · [`PrefabResolution`](#prefabresolution) · [`Pt`](#pt) · [`RECORDING_SCHEMA_ID`](#recording_schema_id) · [`RECORDING_TRAIL_EVERY`](#recording_trail_every) · [`RECORDING_VERSION`](#recording_version) · [`RESERVED_SCENE_KEYS`](#reserved_scene_keys) · [`ReachesCheck`](#reachescheck) · [`RecordingCommand`](#recordingcommand) · [`RecordingIssue`](#recordingissue) · [`RecordingMarker`](#recordingmarker) · [`RecordingPlatform`](#recordingplatform) · [`RecordingStream`](#recordingstream) · [`RectInput`](#rectinput) · [`Ref`](#ref) · [`Registry`](#registry) · [`RegistryError`](#registryerror) · [`ResolveOptions`](#resolveoptions) · [`ResolvedOrigin`](#resolvedorigin) · [`ResolvedPrefab`](#resolvedprefab) · [`ResolvedScene`](#resolvedscene) · [`ResolvedSettings`](#resolvedsettings) · [`RunRecording`](#runrecording) · [`RunRecordingV1`](#runrecordingv1) · [`RunRecordingV2`](#runrecordingv2) · [`RuntimeEntity`](#runtimeentity) · [`RuntimeField`](#runtimefield) · [`RuntimeFields`](#runtimefields) · [`SCENE_FORMAT_VERSION`](#scene_format_version) · [`SCENE_GRID_MAX_CELLS`](#scene_grid_max_cells) · [`SCENE_HEADER_KEYS`](#scene_header_keys) · [`SCENE_SVG_MAX_SIZE`](#scene_svg_max_size) · [`SCHEMA_ID_BASE`](#schema_id_base) · [`SceneAsciiMap`](#sceneasciimap) · [`SceneAsciiOptions`](#sceneasciioptions) · [`SceneChange`](#scenechange) · [`SceneCheck`](#scenecheck) · [`SceneDefinition`](#scenedefinition) · [`SceneFragment`](#scenefragment) · [`SceneHash`](#scenehash) · [`SceneIssue`](#sceneissue) · [`SceneLabels`](#scenelabels) · [`SceneLayerDef`](#scenelayerdef) · [`SceneOp`](#sceneop) · [`SceneOverlay`](#sceneoverlay) · [`SceneParseError`](#sceneparseerror) · [`SceneRegionOptions`](#sceneregionoptions) · [`SceneSettings`](#scenesettings) · [`SceneSprite`](#scenesprite) · [`SceneSvgOptions`](#scenesvgoptions) · [`SceneVersionError`](#sceneversionerror) · [`SceneViewport`](#sceneviewport) · [`ScriptPointer`](#scriptpointer) · [`SeatEvent`](#seatevent) · [`SettingsSources`](#settingssources) · [`Severity`](#severity) · [`ShapeInput`](#shapeinput) · [`ShapeObj`](#shapeobj) · [`ShapeTuple`](#shapetuple) · [`ShapeTupleSchema`](#shapetupleschema) · [`ShapeType`](#shapetype) · [`SpatialHash`](#spatialhash) · [`SpotAnchor`](#spotanchor) · [`SpriteAssetLookup`](#spriteassetlookup) · [`SpritePoseSource`](#spriteposesource) · [`SublevelJudgeOptions`](#subleveljudgeoptions) · [`SublevelSettings`](#sublevelsettings) · [`SystemEvent`](#systemevent) · [`TouchesCheck`](#touchescheck) · [`Transform2D`](#transform2d) · [`ValidCheck`](#validcheck) · [`ValidateOptions`](#validateoptions) · [`aabb`](#aabb-1) · [`aabbUnion`](#aabbunion) · [`applyOps`](#applyops) · [`applyPt`](#applypt) · [`applyVec`](#applyvec) · [`behaviorBlocks`](#behaviorblocks) · [`boxCorners`](#boxcorners) · [`bulkEntries`](#bulkentries) · [`bulkId`](#bulkid) · [`bulkKeyType`](#bulkkeytype) · [`bulkKeysOf`](#bulkkeysof) · [`canonicalGrid`](#canonicalgrid) · [`centroid`](#centroid) · [`checksJsonSchema`](#checksjsonschema) · [`checksPathOf`](#checkspathof) · [`checksSchemaFor`](#checksschemafor) · [`checksSchemaId`](#checksschemaid) · [`childRef`](#childref) · [`closest`](#closest) · [`closestOnSegment`](#closestonsegment) · [`compareChunkKeys`](#comparechunkkeys) · [`comparePointers`](#comparepointers) · [`compose`](#compose) · [`composeDihedral`](#composedihedral) · [`containedInRect`](#containedinrect) · [`containsPoint`](#containspoint) · [`convexHull`](#convexhull) · [`createRegistry`](#createregistry) · [`createScene`](#createscene) · [`createSpatialHash`](#createspatialhash) · [`decodeRow`](#decoderow) · [`defaultLayer`](#defaultlayer) · [`defaultPhysics`](#defaultphysics) · [`describeChange`](#describechange) · [`diffPrefabToOps`](#diffprefabtoops) · [`diffScenes`](#diffscenes) · [`diffToOps`](#difftoops) · [`dihedral`](#dihedral-1) · [`dihedralOf`](#dihedralof) · [`encodeRow`](#encoderow) · [`entityIssues`](#entityissues) · [`entitySchemaFor`](#entityschemafor) · [`expandInstance`](#expandinstance) · [`expandScene`](#expandscene) · [`fieldKind`](#fieldkind-1) · [`flipWorld`](#flipworld) · [`formatAsciiMap`](#formatasciimap) · [`formatChecks`](#formatchecks) · [`formatInputScript`](#formatinputscript) · [`formatPrefab`](#formatprefab) · [`formatPrefabs`](#formatprefabs) · [`formatScene`](#formatscene) · [`fragmentBounds`](#fragmentbounds) · [`fragmentJsonSchema`](#fragmentjsonschema) · [`fragmentOf`](#fragmentof) · [`fragmentSchemaFor`](#fragmentschemafor) · [`geometryFields`](#geometryfields) · [`gridCellBounds`](#gridcellbounds) · [`gridProblems`](#gridproblems) · [`gridTurns`](#gridturns) · [`groupOrigin`](#grouporigin) · [`groupTransform`](#grouptransform) · [`hashText`](#hashtext) · [`inputScriptJsonSchema`](#inputscriptjsonschema) · [`inputScriptSchemaFor`](#inputscriptschemafor) · [`inputScriptSchemaId`](#inputscriptschemaid) · [`inputScriptSchemasFor`](#inputscriptschemasfor) · [`instanceOrigin`](#instanceorigin) · [`instanceSteps`](#instancesteps) · [`instanceTransform`](#instancetransform) · [`intersectsRect`](#intersectsrect) · [`inverseTurn`](#inverseturn) · [`invert`](#invert) · [`isConvex`](#isconvex) · [`isExpandedScene`](#isexpandedscene) · [`isGridValue`](#isgridvalue) · [`isIdentityTurn`](#isidentityturn) · [`isInstanceOverrideField`](#isinstanceoverridefield) · [`isMigrationRefusal`](#ismigrationrefusal) · [`isSpawnOnly`](#isspawnonly) · [`isWholePixel`](#iswholepixel) · [`jsonPointer`](#jsonpointer) · [`layerNames`](#layernames) · [`lengthDecimals`](#lengthdecimals) · [`localChild`](#localchild-1) · [`localChildren`](#localchildren) · [`makeIssue`](#makeissue) · [`migrate`](#migrate) · [`migrateInputScript`](#migrateinputscript) · [`migrateRecordingV1`](#migraterecordingv1) · [`nearestSegment`](#nearestsegment) · [`nearestVertex`](#nearestvertex) · [`nextFreeId`](#nextfreeid) · [`opBatchSchemaFor`](#opbatchschemafor) · [`opsJsonSchema`](#opsjsonschema) · [`opsSchemaId`](#opsschemaid) · [`paintGrid`](#paintgrid) · [`parseBulkId`](#parsebulkid) · [`parseChecks`](#parsechecks) · [`parseChildRef`](#parsechildref) · [`parseChunkKey`](#parsechunkkey) · [`parseFragment`](#parsefragment) · [`parseInputScript`](#parseinputscript) · [`parsePrefab`](#parseprefab) · [`parseRecording`](#parserecording) · [`parseScene`](#parsescene) · [`parseSceneOrThrow`](#parsesceneorthrow) · [`parseShape`](#parseshape) · [`placeChildren`](#placechildren) · [`placeFragment`](#placefragment) · [`placeableTypes`](#placeabletypes) · [`pointerLines`](#pointerlines) · [`prefabBody`](#prefabbody-1) · [`prefabJsonSchema`](#prefabjsonschema) · [`prefabLibrary`](#prefablibrary-1) · [`prefabOf`](#prefabof) · [`prefabScene`](#prefabscene) · [`prefabSchemaFor`](#prefabschemafor) · [`prefabsUsedBy`](#prefabsusedby) · [`projectSpriteAssets`](#projectspriteassets) · [`pxToMetres`](#pxtometres) · [`raycastShape`](#raycastshape) · [`readCell`](#readcell) · [`recordingJsonSchema`](#recordingjsonschema) · [`renderSceneAscii`](#rendersceneascii) · [`renderSceneSvg`](#renderscenesvg) · [`resolvePrefab`](#resolveprefab) · [`resolveScene`](#resolvescene) · [`resolveSceneDetailed`](#resolvescenedetailed) · [`resolveSettings`](#resolvesettings) · [`resolveTime`](#resolvetime) · [`rotateShape`](#rotateshape) · [`roundLength`](#roundlength) · [`runRecordingSchema`](#runrecordingschema) · [`runRecordingV1Schema`](#runrecordingv1schema) · [`sceneAsciiMap`](#sceneasciimap-1) · [`sceneBody`](#scenebody) · [`sceneGameOf`](#scenegameof) · [`sceneHash`](#scenehash-1) · [`sceneHashWith`](#scenehashwith) · [`sceneJsonSchema`](#scenejsonschema) · [`sceneOpSchemaFor`](#sceneopschemafor) · [`scenePhysics`](#scenephysics) · [`sceneRegistry`](#sceneregistry) · [`sceneSchemaFor`](#sceneschemafor) · [`sceneSprites`](#scenesprites) · [`sceneViewport`](#sceneviewport-1) · [`schemaIdFor`](#schemaidfor) · [`scriptSeatLimit`](#scriptseatlimit) · [`scriptShapeIssues`](#scriptshapeissues) · [`shapeAtPose`](#shapeatpose) · [`shapeIsClosed`](#shapeisclosed) · [`shapeOutline`](#shapeoutline) · [`shapeToTuple`](#shapetotuple) · [`shapeVertices`](#shapevertices) · [`shapesIntersect`](#shapesintersect) · [`snapToPixel`](#snaptopixel) · [`spawnSchemaFor`](#spawnschemafor) · [`splitChildRef`](#splitchildref) · [`splitFieldPath`](#splitfieldpath) · [`splitOverridePath`](#splitoverridepath) · [`spriteBoxOf`](#spriteboxof) · [`sublevelIssue`](#sublevelissue) · [`suggestType`](#suggesttype) · [`takenIds`](#takenids) · [`toSourceBatch`](#tosourcebatch) · [`topSpan`](#topspan) · [`transformGrid`](#transformgrid) · [`translateShape`](#translateshape) · [`translation`](#translation) · [`turnOf`](#turnof) · [`undescribedProperties`](#undescribedproperties) · [`unknownGameIssue`](#unknowngameissue) · [`untitledEntityFields`](#untitledentityfields) · [`validateScene`](#validatescene) · [`worldPointSchema`](#worldpointschema)

## `AGENT_SURFACE_KEYWORD`

_const_ in `scene/agent-surface.ts`

The keyword the engine's JSON Schemas carry `AGENT_SURFACE_VERSION` under.

```ts
declare const AGENT_SURFACE_KEYWORD = "x-agent-surface";
```

## `AGENT_SURFACE_VERSION`

_const_ in `scene/agent-surface.ts`

The version of the agent surface: issue codes, op names, JSON Schema
`$id`s, the scene CLI's commands and flags, `.checks.json` kinds, and the
MCP adapter's tool names. It moves independently of
the engine's semver and the scene format's `v`, so an MCP client or an
agent skill can check compatibility without knowing the engine version.
Bump it whenever one of those lists changes; `codes --json` and the
published JSON Schemas carry it.

```ts
declare const AGENT_SURFACE_VERSION = 16;
```

## `Aabb`

_type_ in `scene/types.ts`

```ts
type Aabb = {
    maxX: number;
    maxY: number;
    minX: number;
    minY: number;
};
```

## `AnalogSet`

_type_ in `scene/input-script.ts`

Axis values and vector pairs held for a step, by action name.

```ts
type AnalogSet = Readonly<Record<string, Pt | number>>;
```

Refers to [`Pt`](#pt).

## `ApplyOptions`

_type_ in `scene/types.ts`

```ts
type ApplyOptions = {
    /** The prefab the document is a view of (a prefab doc read as a scene), so an op that nests instances refuses a cycle through it. */
    prefab?: string;
    /** The prefabs instances name; prefab ops read and change it. */
    prefabs?: PrefabLibrary;
    /** The project the scene belongs to: its issues judge asset ids and sprite frames, as `validateScene` does. */
    project?: ProjectView;
    validate?: "none" | "structural";
};
```

Refers to [`PrefabLibrary`](#prefablibrary).

## `ApplyResult`

_type_ in `scene/types.ts`

```ts
type ApplyResult = {
    created: string[];
    def: SceneDefinition;
    diff: SceneChange[];
    hash: SceneHash;
    inverse: OpBatch;
    issues: SceneIssue[];
    ok: true;
    /** The library after the batch, when it changed a prefab. */
    prefabs?: PrefabLibrary;
    /** Ids of the prefabs the batch set or deleted. */
    prefabsChanged?: string[];
    /** Start-of-batch refs that now go by another ref, or `null` when removed. */
    remap: Record<Ref, Ref | null>;
    touched: Ref[];
} | {
    failedAt: number;
    hash: SceneHash;
    issue: SceneIssue;
    ok: false;
};
```

Refers to [`OpBatch`](#opbatch), [`PrefabLibrary`](#prefablibrary), [`Ref`](#ref), [`SceneChange`](#scenechange), [`SceneDefinition`](#scenedefinition), [`SceneHash`](#scenehash), [`SceneIssue`](#sceneissue).

## `AssetId`

_type_ in `scene/types.ts`

A project asset's id (`ID_PATTERN`).

```ts
type AssetId = string;
```

## `Bounds`

_type_ in `scene/types.ts`

The world rectangle in metres; y is down.

```ts
type Bounds = [
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
];
```

## `BulkEntry`

_type_ in `scene/types.ts`

One entry of a bulk array: a shape tuple or a point.

```ts
type BulkEntry = Pt | ShapeTuple;
```

Refers to [`Pt`](#pt), [`ShapeTuple`](#shapetuple).

## `BulkForm`

_type_ in `scene/types.ts`

The two forms a bulk entry takes.

```ts
type BulkForm = "point" | "shape";
```

## `BulkKey`

_type_ in `scene/types.ts`

A top-level array of id-less entries of one type: the type's name, or
`<type>:<material>` for a type whose bulk form takes materials
(`solid:ice`).

```ts
type BulkKey = string;
```

## `BulkPlacement`

_type_ in `scene/resolve.ts`

What a bulk entry of a nested instance takes from the instances above it, as an entity would.

```ts
type BulkPlacement = {
    layer?: string;
    off?: boolean;
    z?: number;
};
```

## `CHECKS_FORMAT_VERSION`

_const_ in `scene/checks.ts`

The `.checks.json` format version, the `v` every checks file carries.

```ts
declare const CHECKS_FORMAT_VERSION = 3;
```

## `CHECKS_LAYOUT`

_const_ in `scene/format.ts`

A checks file in Yjs and on disk: checks keyed by id, merging per check and
field, so an inline `script` is replaced whole; `kind` after the id.

```ts
declare const CHECKS_LAYOUT: {
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
```

## `CHECKS_SUFFIX`

_const_ in `scene/checks.ts`

A scene's checks sit beside it as `<scene>.checks.json`, outside the scene's hash.

```ts
declare const CHECKS_SUFFIX = ".checks.json";
```

## `CHILD_SEPARATOR`

_const_ in `scene/resolve.ts`

Separates an instance's id from its child's in a resolved ref: `gate-3/door`.

```ts
declare const CHILD_SEPARATOR = "/";
```

## `CHUNK_KEY_PATTERN`

_const_ in `scene/grid.ts`

A chunk key's spelling; `-0` and leading zeros are not keys.

```ts
declare const CHUNK_KEY_PATTERN: RegExp;
```

## `CellEdit`

_type_ in `scene/types.ts`

One grid cell to paint: column, row, value (0 erases).

```ts
type CellEdit = [
    col: number,
    row: number,
    value: number
];
```

## `CellRect`

_type_ in `scene/types.ts`

A filled rectangle of cells, corners inclusive.

```ts
type CellRect = [
    c0: number,
    r0: number,
    c1: number,
    r1: number,
    value: number
];
```

## `CheckCell`

_type_ in `scene/checks.ts`

A grid cell, `[col, row]`.

```ts
type CheckCell = [
    col: number,
    row: number
];
```

## `CheckPlace`

_type_ in `scene/checks.ts`

An entity ref (its cell holds its geometry's centre) or a cell.

```ts
type CheckPlace = CheckCell | Ref;
```

Refers to [`CheckCell`](#checkcell), [`Ref`](#ref).

## `ChecksFile`

_type_ in `scene/checks.ts`

```ts
type ChecksFile = {
    $schema?: string;
    checks: SceneCheck[];
    v: typeof CHECKS_FORMAT_VERSION;
};
```

Refers to [`CHECKS_FORMAT_VERSION`](#checks_format_version), [`SceneCheck`](#scenecheck).

## `ChecksIssue`

_type_ in `scene/checks.ts`

A problem in a checks file: a JSON Pointer into it, its line, and one sentence.

```ts
type ChecksIssue = {
    expected?: string;
    got?: string;
    hint?: string;
    line?: number;
    message: string;
    path: string;
};
```

## `ChunkKey`

_type_ in `scene/grid.ts`

`"cx,cy"`: a chunk's coordinates in chunks, integers, may be negative.

```ts
type ChunkKey = string;
```

## `ConnectedCheck`

_type_ in `scene/checks.ts`

A path on the scene's grid joins `from` to each of `to`; walls are the `blockedBy` types' cells.

```ts
type ConnectedCheck = CheckHead & {
    /** Entity types whose shapes wall cells off; default `["solid"]`, `[]` for none. */
    blockedBy?: string[];
    diagonals?: boolean;
    from: CheckPlace;
    kind: "connected";
    to: CheckPlace[];
};
```

Refers to [`CheckPlace`](#checkplace).

## `CountMatch`

_type_ in `scene/input-script.ts`

The `count` predicate: an entity selector, and the bounds the number it matches must keep.

```ts
type CountMatch = EntitySelector & {
    eq?: number;
    max?: number;
    min?: number;
};
```

## `DEFAULT_ASCII_TAG_CHARS`

_const_ in `scene/ascii.ts`

Tags that pick a map character over the type's own: a sensor tagged `goal` draws `G`.

```ts
declare const DEFAULT_ASCII_TAG_CHARS: Readonly<Record<string, string>>;
```

## `DEFAULT_BLOCKED_BY`

_const_ in `scene/checks.ts`

The types a `connected` check walls with when it names none.

```ts
declare const DEFAULT_BLOCKED_BY: readonly string[];
```

## `DEFAULT_LAYERS`

_const_ in `scene/layers.ts`

The layers a game without `layers` gets.

```ts
declare const DEFAULT_LAYERS: readonly SceneLayerDef[];
```

Refers to [`SceneLayerDef`](#scenelayerdef).

## `DEFAULT_SCRIPT_MAX_TICKS`

_const_ in `scene/input-script.ts`

A run ends as `timeout` after this many simulated ticks unless the script sets `maxTicks`.

```ts
declare const DEFAULT_SCRIPT_MAX_TICKS = 1800;
```

## `DEFAULT_TOUCH_ROLLOUTS`

_const_ in `scene/checks.ts`

`touches` defaults, the same as `fuzz`'s.

```ts
declare const DEFAULT_TOUCH_ROLLOUTS = 100;
```

## `DEFAULT_TOUCH_SEED`

_const_ in `scene/checks.ts`

```ts
declare const DEFAULT_TOUCH_SEED = 1;
```

## `DEFAULT_TOUCH_TICKS`

_const_ in `scene/checks.ts`

```ts
declare const DEFAULT_TOUCH_TICKS = 600;
```

## `DEFAULT_UNTIL_MAX`

_const_ in `scene/input-script.ts`

An `until` step gives up after this many ticks unless it sets `max`.

```ts
declare const DEFAULT_UNTIL_MAX = 600;
```

## `Dihedral`

_type_ in `scene/transform.ts`

A quarter-turn transform: mirror x when `flip`, then turn `rot` quarter turns clockwise, then translate to `at`.

```ts
type Dihedral = {
    flip: boolean;
    rot: 0 | 1 | 2 | 3;
};
```

## `DrawnSprite`

_type_ in `scene/render-geometry.ts`

Where a sprite block draws in the world.

```ts
type DrawnSprite = {
    asset?: string;
    box: Aabb;
    frame?: string;
    /** `asset`, `asset:frame`, or `(no asset)`: what the renders print on the box. */
    label: string;
    /** The drawn rectangle in metres, turned with the entity when the sprite turns. */
    shape: Extract<ShapeObj, {
        type: "box";
    }>;
    /** Drawn size, metres: the block's, else its asset's px over px per metre times `scale`, else `SPRITE_FALLBACK_SIZE`. */
    size: [
        w: number,
        h: number
    ];
};
```

Refers to [`Aabb`](#aabb), [`ShapeObj`](#shapeobj).

## `EMPTY_SCENE_TEMPLATE`

_const_ in `scene/create.ts`

A new scene's content when its game gives no template: an empty world one 1920×1080 screen across at 100 px per metre.

```ts
declare const EMPTY_SCENE_TEMPLATE: SceneTemplate;
```

## `ENGINE_ISSUE_CODE_LIST`

_const_ in `scene/types.ts`

The engine's own codes. A game's codes are `<game-id>/<code>`.

```ts
declare const ENGINE_ISSUE_CODE_LIST: readonly [
    "schema",
    "unknown-key",
    "unknown-type",
    "unknown-game",
    "bad-shape",
    "bad-id",
    "version-newer",
    "migration-unresolved",
    "dup-id",
    "dangling-ref",
    "ref-type",
    "poly-invalid",
    "chain-invalid",
    "path-invalid",
    "prefab-unknown",
    "path-degenerate",
    "non-integer",
    "out-of-bounds",
    "hidden-layer",
    "unused-override",
    "prefab-cycle",
    "prefab-depth",
    "variant-base-unknown",
    "param-unknown",
    "layer-unknown",
    "behavior-unknown",
    "behavior-forbidden",
    "behavior-missing",
    "grid-invalid",
    "ref-child-unknown",
    "physics-required",
    "physics-skipped",
    "nav-invalid",
    "follower-hits-solid",
    "solid-overlap",
    "grid-unreachable",
    "stale-base",
    "ref-not-found",
    "op-invalid",
    "id-taken",
    "asset-missing",
    "asset-kind",
    "asset-frame-unknown",
    "sprite-no-asset",
    "tick-rate-invalid",
    "asset-in-use",
    "asset-id-taken",
    "path-taken",
    "hash-mismatch",
    "code-skew",
    "asset-too-large",
    "import-failed",
    "quota-exceeded",
    "project-id-taken",
    "asset-not-trashed",
    "release-immutable",
    "release-forbidden",
    "binding-unknown",
    "player-unknown",
    "spawn-id-invalid",
    "prefab-not-spawnable",
    "recording-other-platform",
    "scene-unlisted",
    "start-scene-missing",
    "sublevel-invalid",
    "save-version-newer",
    "save-too-large",
    "save-slot-limit",
    "save-unsupported",
    "save-store-failed",
    "export-asset-missing",
    "export-over-budget",
    "export-itch-layout",
    "export-target-unsupported",
    "licence-missing"
];
```

## `ENGINE_REGISTRY_ID`

_const_ in `game/types.ts`

The registry id of a registry without a game.

```ts
declare const ENGINE_REGISTRY_ID = "engine";
```

## `EngineIssueCode`

_type_ in `scene/types.ts`

```ts
type EngineIssueCode = (typeof ENGINE_ISSUE_CODE_LIST)[number];
```

Refers to [`ENGINE_ISSUE_CODE_LIST`](#engine_issue_code_list).

## `EntityBase`

_type_ in `scene/types.ts`

Fields every entity has, whatever its type.

```ts
type EntityBase = {
    group?: string;
    id: string;
    /** A registry layer's name; omitted means `defaultLayer`'s. */
    layer?: string;
    name?: string;
    off?: boolean;
    type: EntityTypeName;
    /** Draw order within the layer: an integer, default 0. */
    z?: number;
};
```

Refers to [`EntityTypeName`](#entitytypename).

## `EntityDef`

_type_ in `scene/types.ts`

An entity as written on disk. Its other fields are whatever its type's schema says.

```ts
type EntityDef = EntityBase & {
    [field: string]: unknown;
};
```

Refers to [`EntityBase`](#entitybase).

## `EntityInput`

_type_ in `scene/types.ts`

An entity to add: its type's fields, shapes in any `ShapeInput` form, id optional.

```ts
type EntityInput = Omit<EntityBase, "id"> & {
    [field: string]: unknown;
    id?: string;
};
```

Refers to [`EntityBase`](#entitybase).

## `EntityTypeName`

_type_ in `scene/types.ts`

A registered entity type's name, e.g. `solid`, or a game's own `crate`.

```ts
type EntityTypeName = string;
```

## `ExistsMatch`

_type_ in `scene/input-script.ts`

The `exists` predicate: an id, holding while it exists and is enabled; `enabled: false` holds for a disabled one too.

```ts
type ExistsMatch = string | {
    enabled?: false;
    id: string;
};
```

## `ExpandOptions`

_type_ in `scene/expand.ts`

```ts
type ExpandOptions = {
    /** The project's `engine` block, which settings resolve through between the scene and the game. */
    engine?: Readonly<Record<string, unknown>>;
    /** The prefabs the scene's instances name; an instance whose prefab is missing loads nothing. */
    prefabs?: PrefabLibrary;
};
```

Refers to [`PrefabLibrary`](#prefablibrary).

## `ExpandedScene`

_type_ in `scene/types.ts`

```ts
type ExpandedScene = {
    bounds: Bounds;
    /** In spawn order: the registry's spawn groups; within one, bulk first, then file order. */
    entities: RuntimeEntity[];
    game?: string;
    name: string;
    settings: ResolvedSettings;
};
```

Refers to [`Bounds`](#bounds), [`ResolvedSettings`](#resolvedsettings), [`RuntimeEntity`](#runtimeentity).

## `FRAGMENT_KIND`

_const_ in `scene/fragment.ts`

```ts
declare const FRAGMENT_KIND = "scene-fragment";
```

## `FieldKind`

_type_ in `scene/schema.ts`

What a field's schema holds, for tools that treat geometry specially.

```ts
type FieldKind = "angle" | "grid" | "mirror" | "path" | "point" | "shape" | "side" | "tags" | "value" | "vector";
```

## `FieldPath`

_type_ in `scene/types.ts`

A dot path into an entity: `shape`, `path.speed`, `path.pts.1`.

```ts
type FieldPath = string;
```

## `GRID_CHUNK`

_const_ in `scene/grid.ts`

```ts
declare const GRID_CHUNK = 32;
```

## `GRID_MAX_VALUE`

_const_ in `scene/grid.ts`

The largest cell value a row can hold.

```ts
declare const GRID_MAX_VALUE = 65535;
```

## `GRID_ROW_PATTERN`

_const_ in `scene/grid.ts`

A row's spelling; the value bound and the 32-cell sum are checked by `decodeRow`.

```ts
declare const GRID_ROW_PATTERN: RegExp;
```

## `GameCheck`

_type_ in `scene/checks.ts`

A game's kind (`<game>/<kind>`), with the fields its `arg` schema defines.

```ts
type GameCheck = CheckHead & {
    [field: string]: unknown;
};
```

## `GridCells`

_type_ in `scene/grid.ts`

Chunks by key; a chunk is up to 32 rows, trailing empty rows dropped; empty chunks absent.

```ts
type GridCells = Readonly<Record<ChunkKey, readonly GridRow[]>>;
```

Refers to [`ChunkKey`](#chunkkey), [`GridRow`](#gridrow).

## `GridProblem`

_type_ in `scene/grid.ts`

One problem with a grid value: where (relative to the value), what, and what was found.

```ts
type GridProblem = {
    got?: string;
    message: string;
    path: (number | string)[];
};
```

## `GridRow`

_type_ in `scene/grid.ts`

Run-length cells of one row of a chunk: "" or runs "v" / "v*n" joined by ","; trailing empties dropped.

```ts
type GridRow = string;
```

## `GridSettings`

_type_ in `scene/types.ts`

The scene's one cell grid, in metres, each length a whole number of px at
the game's px per metre; the hex parameters match Tiled's.

```ts
type GridSettings = {
    /** The hex's bounding box, m (Tiled's tilewidth, tileheight over px per metre). */
    cell: [
        w: number,
        h: number
    ];
    index: "even" | "odd";
    kind: "hex";
    origin?: Pt;
    /** The length of the flat sides, m (Tiled's hexsidelength over px per metre). */
    side: number;
    stagger: "x" | "y";
} | {
    cell: [
        w: number,
        h: number
    ];
    kind: "square";
    origin?: Pt;
};
```

Refers to [`Pt`](#pt).

## `GroupDef`

_type_ in `scene/types.ts`

A group: members store their geometry relative to `at`, so moving the
group is one edit to `at`. `rot` is quarter turns clockwise (y down) and
`flip` mirrors x before turning; absent is the identity.

```ts
type GroupDef = {
    at: Pt;
    flip?: true;
    name?: string;
    rot?: 1 | 2 | 3;
};
```

Refers to [`Pt`](#pt).

## `GroupSchema`

_const_ in `scene/schema.ts`

```ts
declare const GroupSchema: z.ZodObject<{
    at: z.ZodTuple<[
        z.ZodNumber,
        z.ZodNumber
    ], null>;
    flip: z.ZodOptional<z.ZodLiteral<true>>;
    name: z.ZodOptional<z.ZodString>;
    rot: z.ZodOptional<z.ZodLiteral<1 | 2 | 3>>;
}, z.core.$strict>;
```

## `IDENTITY_2D`

_const_ in `scene/transform.ts`

```ts
declare const IDENTITY_2D: Transform2D;
```

Refers to [`Transform2D`](#transform2d).

## `ID_PATTERN`

_const_ in `game/fields.ts`

Ids, scene names and game ids. `~` can never match, so a bulk reference is never a real id.

```ts
declare const ID_PATTERN: RegExp;
```

## `INPUT_SCRIPT_LAYOUT`

_const_ in `scene/format.ts`

An input script in Yjs and on disk: the header keys in this order, then
`steps` or `tracks`. Steps merge by insert, each step replaced whole.
Tracks are matched by `player` and merge per field, so two people adding
steps to one track, or to two, both keep their steps.

```ts
declare const INPUT_SCRIPT_LAYOUT: {
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
```

## `INPUT_SCRIPT_MIGRATIONS`

_const_ in `scene/input-script.ts`

`INPUT_SCRIPT_MIGRATIONS[n]` lifts a v`n` input script to v`n + 1`; every reader goes through them.

```ts
declare const INPUT_SCRIPT_MIGRATIONS: Readonly<Record<number, Migration>>;
```

Refers to [`Migration`](#migration).

## `INPUT_SCRIPT_VERSION`

_const_ in `scene/input-script.ts`

The input-script format version, the `v` every script carries.

```ts
declare const INPUT_SCRIPT_VERSION = 2;
```

## `INSTANCE_OVERRIDE_FIELDS`

_const_ in `scene/field-path.ts`

The fields of a nested instance that an override may set as a whole, besides `params.<name>`.

```ts
declare const INSTANCE_OVERRIDE_FIELDS: readonly [
    "at",
    "rot",
    "flip",
    "z",
    "off",
    "layer"
];
```

## `ISSUE_CODES`

_const_ in `scene/issues.ts`

Every code the engine reports; a game's own `<game-id>/<code>` codes sit
beside them in `registry.issueCodes`. Codes, severities and the `fixable`
flag are public contract: renaming or removing one is a breaking change.

```ts
declare const ISSUE_CODES: Readonly<Record<EngineIssueCode, IssueCodeInfo>>;
```

Refers to [`EngineIssueCode`](#engineissuecode), [`IssueCodeInfo`](#issuecodeinfo).

## `InputScriptSchemas`

_type_ in `scene/input-script.ts`

```ts
type InputScriptSchemas = ReturnType<typeof buildInputScriptSchemas>;
```

## `InstanceDef`

_type_ in `scene/types.ts`

One placement of a prefab. Its children load as entities with ids
`<id>/<childId>` (bulk children `<id>/~key:index`), translated by `at`
and then by the instance's group.

```ts
type InstanceDef = {
    at: Pt;
    /** Mirror x in the prefab's frame, before `rot`. */
    flip?: true;
    group?: string;
    id: string;
    layer?: string;
    name?: string;
    off?: boolean;
    /**
     * Child fields that differ from the prefab, by `childId.field.path`. Each
     * value is in the frame of the prefab that owns the child: for a nested
     * child (`door-1/panel`), its own prefab's frame.
     */
    overrides?: Record<OverridePath, unknown>;
    /** Values of the prefab's exposed parameters, by name. */
    params?: Record<string, unknown>;
    prefab: string;
    /** Quarter turns clockwise (y down); absent is 0. */
    rot?: 1 | 2 | 3;
    /** Added to every child's `z`. */
    z?: number;
};
```

Refers to [`OverridePath`](#overridepath), [`Pt`](#pt).

## `InstanceInput`

_type_ in `scene/types.ts`

An instance to add; without an id it gets `<prefab>-<n>`.

```ts
type InstanceInput = Omit<InstanceDef, "id"> & {
    id?: string;
};
```

Refers to [`InstanceDef`](#instancedef).

## `InstanceSchema`

_const_ in `scene/schema.ts`

```ts
declare const InstanceSchema: z.ZodObject<{
    at: z.ZodTuple<[
        z.ZodNumber,
        z.ZodNumber
    ], null>;
    flip: z.ZodOptional<z.ZodLiteral<true>>;
    group: z.ZodOptional<z.ZodString>;
    id: z.ZodString;
    layer: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    off: z.ZodOptional<z.ZodBoolean>;
    overrides: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    prefab: z.ZodString;
    rot: z.ZodOptional<z.ZodLiteral<1 | 2 | 3>>;
    z: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
```

## `IssueCode`

_type_ in `scene/types.ts`

An engine code, or a game's `<game-id>/<code>`.

```ts
type IssueCode = EngineIssueCode | `${string}/${string}`;
```

Refers to [`EngineIssueCode`](#engineissuecode).

## `IssueCodeInfo`

_type_ in `scene/types.ts`

```ts
type IssueCodeInfo = {
    /** The issue carries a `fix` batch whenever a mechanical repair exists; some instances have none. */
    fixable: boolean;
    hint: string;
    severity: Severity;
    summary: string;
};
```

Refers to [`Severity`](#severity).

## `JsonSchemaOptions`

_type_ in `scene/json-schema.ts`

```ts
type JsonSchemaOptions = {
    /**
     * Live asset ids of some kinds, the `enum` of every asset field naming
     * them (none when empty). Omitted, an asset field keeps the ids its
     * builder was given, if any.
     */
    assets?: (kinds: readonly AssetKindName[]) => readonly AssetId[];
    /** The registry's layer names, the `enum` of every `layer` field; omitted, layers are any id. */
    layers?: readonly string[];
};
```

## `LENGTH_UNITS`

_const_ in `scene/units.ts`

```ts
declare const LENGTH_UNITS: readonly LengthUnitName[];
```

Refers to [`LengthUnitName`](#lengthunitname).

## `LengthUnitName`

_type_ in `scene/units.ts`

The units a length field declares in `meta.unit`.

```ts
type LengthUnitName = "m" | "m/s" | "m/s²";
```

## `LocalChild`

_type_ in `scene/resolve.ts`

A child in a prefab's own frame, overrides applied. `child` is its ref
relative to the prefab: its own id, or under the nested instances it is
in (`door-1/panel`, `door-1/~solid:0`); an entity's `def.id` stays its id
in its own prefab. `turn` is the turn and flip of the nested instances
above it, and a nested bulk entry's `placed` the z, layer and `off` they
give it.

```ts
type LocalChild = {
    child: Ref;
    def: EntityDef;
    kind: "entity";
    turn?: Dihedral;
} | {
    child: Ref;
    index: number;
    key: string;
    kind: "bulk";
    placed?: BulkPlacement;
    turn?: Dihedral;
    value: BulkEntry;
};
```

Refers to [`BulkEntry`](#bulkentry), [`BulkPlacement`](#bulkplacement), [`Dihedral`](#dihedral), [`EntityDef`](#entitydef), [`Ref`](#ref).

## `MAX_SCRIPT_TICKS`

_const_ in `scene/input-script.ts`

The longest run, and the longest step, a script may ask for, in ticks.

```ts
declare const MAX_SCRIPT_TICKS = 36000;
```

## `MAX_TOUCH_ROLLOUTS`

_const_ in `scene/checks.ts`

```ts
declare const MAX_TOUCH_ROLLOUTS = 10000;
```

## `MIGRATIONS`

_const_ in `scene/migrate.ts`

```ts
declare const MIGRATIONS: Readonly<Record<number, Migration>>;
```

Refers to [`Migration`](#migration).

## `MigrateEnv`

_type_ in `scene/migrate.ts`

What a migration step may need beyond the document: the game, and the prefabs its instances name.

```ts
type MigrateEnv = {
    /** The prefab an instance names, for the units of its overrides and exposed params. */
    prefab?: (id: string) => Prefab | undefined;
    registry?: Registry;
};
```

Refers to [`Prefab`](#prefab), [`Registry`](#registry).

## `MigrateInputScriptResult`

_type_ in `scene/input-script.ts`

```ts
type MigrateInputScriptResult = {
    from: number;
    ok: true;
    script: unknown;
} | {
    issue: ScriptIssue;
    ok: false;
};
```

## `MigrateResult`

_type_ in `scene/migrate.ts`

```ts
type MigrateResult = {
    from: number;
    ok: true;
    raw: unknown;
} | {
    issue: SceneIssue;
    ok: false;
};
```

Refers to [`SceneIssue`](#sceneissue).

## `Migration`

_type_ in `scene/migrate.ts`

`MIGRATIONS[n]` lifts an untyped v`n` document to v`n + 1`, or refuses.
Each step ships with a frozen fixture test; only the current version
exists as Zod.

```ts
type Migration = (raw: unknown, env: MigrateEnv) => unknown;
```

Refers to [`MigrateEnv`](#migrateenv).

## `MigrationRefusal`

_type_ in `scene/migrate.ts`

A step that can't run without what `env` lacks returns this; `migrate` reports its issue.

```ts
type MigrationRefusal = {
    readonly refused: SceneIssue;
};
```

Refers to [`SceneIssue`](#sceneissue).

## `OP_NAMES`

_const_ in `scene/types.ts`

```ts
declare const OP_NAMES: readonly [
    "add",
    "addBulk",
    "update",
    "move",
    "place",
    "remove",
    "rename",
    "promote",
    "demote",
    "setScene",
    "setSettings",
    "reorder",
    "instantiate",
    "setGroup",
    "override",
    "revertOverride",
    "applyToPrefab",
    "unpack",
    "createPrefab",
    "definePrefab",
    "transform",
    "setZ",
    "useAssets",
    "paintCells",
    "setPrefabBase",
    "exposeParam",
    "setParam"
];
```

## `OVERRIDE_PATH`

_const_ in `scene/schema.ts`

Override keys: a child ref (ids joined by `/`, optionally ending in a
`~key:index`), a dot, then a field path whose segment right after
`behaviors` may be a behavior name (`door.behaviors.game/glow.intensity`).

```ts
declare const OVERRIDE_PATH: RegExp;
```

## `OpBatch`

_type_ in `scene/types.ts`

`actor` is "human", "agent", or a named agent.

```ts
type OpBatch = {
    actor?: string;
    base?: SceneHash;
    label?: string;
    ops: SceneOp[];
};
```

Refers to [`SceneHash`](#scenehash), [`SceneOp`](#sceneop).

## `OverlayPoint`

_type_ in `scene/render-geometry.ts`

A world point as a tuple or as `{ x, y }` (what a playtest report's events carry).

```ts
type OverlayPoint = Pt | {
    x: number;
    y: number;
};
```

Refers to [`Pt`](#pt).

## `OverridePath`

_type_ in `scene/types.ts`

A path into one child of a prefab: the child's id (or `~key:index` for a
bulk child), a dot, then a field path: `door.path.speed`, `~solid:0.shape`.

```ts
type OverridePath = string;
```

## `PREFABS_DIR`

_const_ in `scene/prefab.ts`

Where a scenes directory keeps its prefabs: `<dir>/prefabs/<id>.json`.

```ts
declare const PREFABS_DIR = "prefabs";
```

## `PREFAB_KIND`

_const_ in `scene/types.ts`

```ts
declare const PREFAB_KIND = "prefab";
```

## `PREFAB_MAX_DEPTH`

_const_ in `scene/types.ts`

How deep prefabs may nest, through instances and variant bases.

```ts
declare const PREFAB_MAX_DEPTH = 8;
```

## `ParseChecksResult`

_type_ in `scene/checks.ts`

```ts
type ParseChecksResult = {
    file: ChecksFile;
    ok: true;
} | {
    issues: ChecksIssue[];
    ok: false;
};
```

Refers to [`ChecksFile`](#checksfile), [`ChecksIssue`](#checksissue).

## `ParseFragmentResult`

_type_ in `scene/fragment.ts`

```ts
type ParseFragmentResult = {
    fragment: SceneFragment;
    issues: SceneIssue[];
    migratedFrom?: number;
    ok: true;
} | {
    issues: SceneIssue[];
    ok: false;
};
```

Refers to [`SceneFragment`](#scenefragment), [`SceneIssue`](#sceneissue).

## `ParseInputScriptResult`

_type_ in `scene/input-script.ts`

```ts
type ParseInputScriptResult<G = unknown> = {
    issues: (ScriptIssue & {
        line?: number;
    })[];
    ok: false;
} | {
    migratedFrom?: number;
    ok: true;
    script: InputScriptV2<G>;
};
```

## `ParseOptions`

_type_ in `scene/parse.ts`

What the scene, prefab and fragment parsers take beside the registry.

```ts
type ParseOptions = {
    prefab?: MigrateEnv["prefab"];
};
```

Refers to [`MigrateEnv`](#migrateenv).

## `ParsePrefabResult`

_type_ in `scene/prefab.ts`

```ts
type ParsePrefabResult = {
    issues: SceneIssue[];
    migratedFrom?: number;
    ok: true;
    prefab: Prefab;
} | {
    issues: SceneIssue[];
    ok: false;
};
```

Refers to [`Prefab`](#prefab), [`SceneIssue`](#sceneissue).

## `ParseRecordingResult`

_type_ in `scene/recording-schema.ts`

```ts
type ParseRecordingResult = {
    issues: RecordingIssue[];
    ok: false;
} | {
    /** The format version read, when it was migrated to the current one. */
    migratedFrom?: 1;
    ok: true;
    recording: RunRecording;
};
```

Refers to [`RecordingIssue`](#recordingissue), [`RunRecording`](#runrecording).

## `ParseSceneResult`

_type_ in `scene/parse.ts`

```ts
type ParseSceneResult = {
    def: SceneDefinition;
    issues: SceneIssue[];
    migratedFrom?: number;
    ok: true;
} | {
    issues: SceneIssue[];
    ok: false;
};
```

Refers to [`SceneDefinition`](#scenedefinition), [`SceneIssue`](#sceneissue).

## `ParseShapeResult`

_type_ in `scene/shapes.ts`

```ts
type ParseShapeResult = {
    issue: SceneIssue;
    ok: false;
} | {
    ok: true;
    shape: ShapeObj;
};
```

Refers to [`SceneIssue`](#sceneissue), [`ShapeObj`](#shapeobj).

## `PathCommand`

_type_ in `scene/shape-outline.ts`

One step of a 2D path, in the shape's coordinates.

```ts
type PathCommand = {
    cx: number;
    cy: number;
    end: number;
    op: "arc";
    r: number;
    start: number;
} | {
    op: "close";
} | {
    op: "lineTo";
    x: number;
    y: number;
} | {
    op: "moveTo";
    x: number;
    y: number;
};
```

## `PathDef`

_type_ in `scene/types.ts`

Waypoints in metres; `speed` in m/s.

```ts
type PathDef = {
    mode: "loop" | "ping_pong";
    pauseMs?: number;
    pts: Pt[];
    speed: number;
};
```

Refers to [`Pt`](#pt).

## `PlacedChild`

_type_ in `scene/resolve.ts`

An instance child as the entity the resolved view holds: its resolved ref, the instance's transform, `z`, layer, group and `off` applied.

```ts
type PlacedChild = {
    child: LocalChild;
    def: EntityDef;
};
```

Refers to [`EntityDef`](#entitydef), [`LocalChild`](#localchild).

## `PlacedFragment`

_type_ in `scene/fragment.ts`

```ts
type PlacedFragment = {
    issues: SceneIssue[];
    /** `addBulk` ops, then one `add` per entity, then one `instantiate` per instance. */
    ops: SceneOp[];
    /** The refs the ops create, bulk entries at the indices they will have. */
    select: Ref[];
};
```

Refers to [`Ref`](#ref), [`SceneIssue`](#sceneissue), [`SceneOp`](#sceneop).

## `Prefab`

_type_ in `scene/types.ts`

A prefab file, `<scenes dir>/prefabs/<id>.json`: a body plus who it is.

```ts
type Prefab = PrefabBody & {
    $schema?: string;
    /** The game whose registry judges it; omitted, engine primitives only. */
    game?: string;
    id: string;
    kind: typeof PREFAB_KIND;
    /** The scene format version it was written at. */
    v: number;
};
```

Refers to [`PREFAB_KIND`](#prefab_kind), [`PrefabBody`](#prefabbody).

## `PrefabBody`

_type_ in `scene/types.ts`

A prefab's content as a `definePrefab` op carries it: its children around a local origin.

```ts
type PrefabBody = {
    /** Assets only game code names. */
    assets?: AssetId[];
    /** A variant's base prefab. */
    base?: string;
    bulk?: Record<BulkKey, BulkEntry[]>;
    contract?: unknown;
    entities: EntityDef[];
    /** Nested instances. */
    instances?: InstanceDef[];
    /** A variant's overrides of its base's children. */
    overrides?: Record<OverridePath, unknown>;
    /** Exposed parameters by name. */
    params?: Record<string, PrefabParam>;
};
```

Refers to [`AssetId`](#assetid), [`BulkEntry`](#bulkentry), [`BulkKey`](#bulkkey), [`EntityDef`](#entitydef), [`InstanceDef`](#instancedef), [`OverridePath`](#overridepath), [`PrefabParam`](#prefabparam).

## `PrefabLibrary`

_type_ in `scene/types.ts`

Prefabs by id.

```ts
type PrefabLibrary = ReadonlyMap<string, Prefab>;
```

Refers to [`Prefab`](#prefab).

## `PrefabParam`

_type_ in `scene/types.ts`

One exposed parameter of a prefab.

```ts
type PrefabParam = {
    /** Shown in the inspector and used when an instance sets none; omitted, the targets' own values stand. */
    default?: unknown;
    description: string;
    /**
     * Per target, the value it takes for each string value of the param
     * (`{ "unit.behaviors.sprite.frame": { "red": "knight-red" } }`). A mapped
     * target the map has no entry for keeps its own value; targets left out
     * take the param's value as it is.
     */
    map?: Record<OverridePath, Record<string, unknown>>;
    /** Override paths inside the prefab that the value feeds, e.g. "door.path.speed". */
    targets: OverridePath[];
};
```

Refers to [`OverridePath`](#overridepath).

## `PrefabResolution`

_type_ in `scene/resolve.ts`

```ts
type PrefabResolution = {
    issue: SceneIssue;
    ok: false;
} | {
    ok: true;
    prefab: ResolvedPrefab;
};
```

Refers to [`ResolvedPrefab`](#resolvedprefab), [`SceneIssue`](#sceneissue).

## `Pt`

_type_ in `scene/types.ts`

A point in world metres; y is down.

```ts
type Pt = [
    x: number,
    y: number
];
```

## `RECORDING_SCHEMA_ID`

_const_ in `scene/recording-schema.ts`

`urn:jams-engine:recording:v2`. Recordings are game-agnostic, so there is one schema.

```ts
declare const RECORDING_SCHEMA_ID = "urn:jams-engine:recording:v2";
```

## `RECORDING_TRAIL_EVERY`

_const_ in `scene/recording-schema.ts`

A recording keeps the focus every this many ticks.

```ts
declare const RECORDING_TRAIL_EVERY = 4;
```

## `RECORDING_VERSION`

_const_ in `scene/recording-schema.ts`

The recording format version every recording is written in.

```ts
declare const RECORDING_VERSION = 2;
```

## `RESERVED_SCENE_KEYS`

_const_ in `scene/types.ts`

Top-level keys no bulk key may take.

```ts
declare const RESERVED_SCENE_KEYS: readonly string[];
```

## `ReachesCheck`

_type_ in `scene/checks.ts`

An input script's playtest ends with `result` (and `expect` holds then); a blocked run fails.

```ts
type ReachesCheck = CheckHead & {
    /** Play from here, over the script's own `at`. */
    at?: Pt;
    /** Every key must hold on the run's last tick, judged as a script step's `until` is. */
    expect?: UntilClause;
    kind: "reaches";
    result: string;
    /** Inline, or a path relative to the checks file; a parsed file's inline script is the current format. */
    script: InputScript | InputScriptV2 | string;
};
```

Refers to [`Pt`](#pt).

## `RecordingCommand`

_type_ in `scene/recording-schema.ts`

A command stamped with the tick that stepped it: `[tick, name, args?]`.

```ts
type RecordingCommand = NonNullable<RunRecordingV1["commands"]>[number];
```

Refers to [`RunRecordingV1`](#runrecordingv1).

## `RecordingIssue`

_type_ in `scene/recording-schema.ts`

A recording that didn't parse: a JSON Pointer into it and one sentence per problem.

```ts
type RecordingIssue = {
    message: string;
    path: string;
};
```

## `RecordingMarker`

_type_ in `scene/recording-schema.ts`

```ts
type RecordingMarker = RunRecordingV1["markers"][number];
```

Refers to [`RunRecordingV1`](#runrecordingv1).

## `RecordingPlatform`

_type_ in `scene/recording-schema.ts`

Where a recording was made; `flavour` names the Rapier package, null without one.

```ts
type RecordingPlatform = {
    arch: string;
    flavour: null | string;
    runtime: string;
};
```

## `RecordingStream`

_type_ in `scene/recording-schema.ts`

The parts of a v2 recording that hold its input.

```ts
type RecordingStream = Pick<RunRecordingV2, "actions" | "commands" | "inputs" | "system">;
```

Refers to [`RunRecordingV2`](#runrecordingv2).

## `RectInput`

_type_ in `scene/types.ts`

```ts
type RectInput = {
    bottom: number;
    left: number;
    right: number;
    top: number;
    type: "rect";
};
```

## `Ref`

_type_ in `scene/types.ts`

An entity id, or a bulk reference `~<bulkKey>:<index>`, e.g. `~solid:ice:3`.

```ts
type Ref = string;
```

## `Registry`

_type_ in `game/types.ts`

Primitives plus one game's types, materials, actions, groups and codes.

```ts
type Registry = {
    actionNames: readonly string[];
    actions: readonly ActionDef[];
    /** Registration order: what attach, step and detach follow. */
    behaviorNames: readonly BehaviorName[];
    behaviorRules: (type: EntityTypeName) => BehaviorRules;
    /** The engine's behaviors, then the game's. */
    behaviors: ReadonlyMap<BehaviorName, RegisteredBehavior>;
    bulkKey: (key: BulkKey) => BulkKeyInfo | undefined;
    /** Every bulk key, in spawn order, a type's plain key before its material keys. */
    bulkKeys: readonly BulkKeyInfo[];
    /** `ENGINE_CHECK_KINDS`, then the game's `checks` keys. */
    checkKinds: readonly string[];
    collisionGroupNames: readonly string[];
    /** Packed Rapier `InteractionGroups` for a group name; throws on an unknown one. */
    collisionGroups: (name: string) => number;
    commandNames: readonly string[];
    /** `ENGINE_COMMANDS`, then the game's `commands`. */
    commands: ReadonlyMap<string, CommandDef>;
    game: GameDefinition | null;
    /** The game's id, or `engine` without one. */
    id: string;
    /** The engine's codes, then the game's. */
    issueCodes: Readonly<Record<string, IssueCodeInfo>>;
    /** Scene layers, bottom to top: the game's, or `DEFAULT_LAYERS`. */
    layers: readonly SceneLayerDef[];
    materialNames: readonly string[];
    materials: ReadonlyMap<string, MaterialDef>;
    /** The game's physical checks; the engine's own run first and aren't listed. */
    physicalChecks: readonly PhysicalCheck[];
    /** `ENGINE_PREDICATES`, then the game's `play.predicates` keys. */
    predicateNames: readonly string[];
    /** The game's `prefabContract` fields; empty without a game or one that declares none. */
    prefabContract: z.ZodRawShape;
    /** The primitives-only registry: itself without a game, else built once beside it. */
    primitives: Registry;
    /** `ENGINE_RUN_RESULTS`, then the game's `play.results`. */
    runResults: readonly string[];
    /** `urn:jams-engine:scene:v<SCENE_FORMAT_VERSION>`, or `urn:jams-engine:scene:<game>:v<SCENE_FORMAT_VERSION>`. */
    schemaId: string;
    /** The engine's settings fields plus the game's. */
    settings: z.ZodRawShape;
    /** The index into `spawnGroups` of a loadable type; undefined for one that never loads. */
    spawnGroupOf: (type: EntityTypeName) => number | undefined;
    spawnGroups: readonly (readonly EntityTypeName[])[];
    /** The game's time model before project overrides, else the engine default. */
    time: TimeModel;
    typeNames: readonly EntityTypeName[];
    /** Primitives first, then the game's types, in registration order. */
    types: ReadonlyMap<EntityTypeName, RegisteredType>;
    /** The actions marked `ui: true`, in registration order; `actionNames` lists them too. */
    uiActionNames: readonly string[];
    validators: readonly SceneValidator[];
    /** The game's inspector widgets by id. */
    widgets: ReadonlyMap<string, InspectorWidgetDef>;
};
```

Refers to [`BulkKey`](#bulkkey), [`EntityTypeName`](#entitytypename), [`IssueCodeInfo`](#issuecodeinfo), [`SceneLayerDef`](#scenelayerdef).

## `RegistryError`

_class_ in `game/define.ts`

```ts
declare class RegistryError extends Error {
    readonly problems: string[];
    constructor(id: string, problems: string[]);
}
```

## `ResolveOptions`

_type_ in `scene/resolve.ts`

```ts
type ResolveOptions = {
    /** Whether grid fields turn with a turned nested instance (`gridTurns` of the scene); default false. */
    cells?: boolean;
};
```

## `ResolvedOrigin`

_type_ in `scene/resolve.ts`

Where a resolved entity came from, and the turn and flip it was placed with (absent: none).

```ts
type ResolvedOrigin = {
    child: Ref;
    instance: number;
    kind: "child";
    /** The instance ids from the scene down to the child's own instance: `["room-1", "door-1"]`. */
    path: string[];
    /** The accumulated turn and flip of its instances and group. */
    transform: Dihedral;
} | {
    index: number;
    kind: "entity";
    transform?: Dihedral;
};
```

Refers to [`Dihedral`](#dihedral), [`Ref`](#ref).

## `ResolvedPrefab`

_type_ in `scene/resolve.ts`

A prefab's children in its own frame: nested instances expanded, ids relative ("door-1/panel").

```ts
type ResolvedPrefab = {
    children: LocalChild[];
    id: string;
    /** Its exposed params. */
    params: Readonly<Record<string, PrefabParam>>;
    /** Every prefab it reached, for hashing and bundles; outermost first. */
    uses: readonly string[];
};
```

Refers to [`LocalChild`](#localchild), [`PrefabParam`](#prefabparam).

## `ResolvedScene`

_type_ in `scene/resolve.ts`

```ts
type ResolvedScene = {
    def: SceneDefinition;
    /** For each of `def.entities`, the document entity or instance child it is. */
    origins: ResolvedOrigin[];
};
```

Refers to [`ResolvedOrigin`](#resolvedorigin), [`SceneDefinition`](#scenedefinition).

## `ResolvedSettings`

_type_ in `scene/types.ts`

The engine's settings with defaults applied, plus the game's as given.

```ts
type ResolvedSettings = {
    [key: string]: unknown;
    gravity: Pt;
    grid: GridSettings | null;
    physics: "none" | "rapier";
    view: {
        projection: "orthogonal";
    };
};
```

Refers to [`GridSettings`](#gridsettings), [`Pt`](#pt).

## `RunRecording`

_type_ in `scene/recording-schema.ts`

A recording in the current format.

```ts
type RunRecording = RunRecordingV2;
```

Refers to [`RunRecordingV2`](#runrecordingv2).

## `RunRecordingV1`

_type_ in `scene/recording-schema.ts`

```ts
type RunRecordingV1 = z.infer<typeof runRecordingV1Schema>;
```

Refers to [`runRecordingV1Schema`](#runrecordingv1schema).

## `RunRecordingV2`

_type_ in `scene/recording-schema.ts`

A v2 recording: one input stream per seat plus a system stream, merged
per tick system first, then seats in order, each in stream order.

```ts
type RunRecordingV2 = {
    $schema?: string;
    /** Names `inputs` index into. */
    actions: string[];
    commands: string[];
    configHash: string;
    end: string;
    /** `physics` is null for a run without physics. */
    engine: {
        physics: null | string;
        version: string;
    };
    /** The save the run began from: its slot and the save file's hash. */
    fromSave?: {
        sha256: Sha256;
        slot: string;
    };
    game: null | string;
    /** Per seat. */
    inputs: SeatEvent[][];
    markers: RecordingMarker[];
    /** The flow request that ended this scene's run; a replay ends here without following it. */
    next?: {
        entry?: string;
        scene: AssetId;
    };
    outcome: RunRecordingV1["outcome"];
    platform: RecordingPlatform;
    players: {
        devices: DeviceId[];
        index: number;
    }[];
    /** Null for a run without a project; `snapshot` is the project snapshot's hash, when the host knew it. */
    project: null | {
        id: string;
        snapshot: null | string;
    };
    /** The release the run was played from (its manifest's id); omitted outside a release. */
    release?: Sha256;
    /**
     * What the run ran (the expanded scene, the clock and the project's data);
     * a replay is stale when it differs. Empty for a recording migrated from
     * v1, whose staleness is judged on `sceneHash`.
     */
    runHash: string;
    scene: string;
    sceneHash: string;
    /** Always written: the default seed when the run named none. */
    seed: number | string;
    start: {
        at?: [
            x: number,
            y: number
        ];
        /** The entry the flow request that loaded this scene named (`EngineContext.flow.entry`). */
        entry?: string;
        game?: unknown;
        /** `EngineContext.persist` as the scene loaded; written when the game declares `persist`. */
        persist?: JsonValue;
        timeOffsetMs?: number;
    };
    system: SystemEvent[];
    ticks: number;
    time: {
        kind: TimeKind;
        rate: number;
    };
    trail?: RunRecordingV1["trail"];
    v: 2;
};
```

Refers to [`RecordingMarker`](#recordingmarker), [`RecordingPlatform`](#recordingplatform), [`RunRecordingV1`](#runrecordingv1), [`SeatEvent`](#seatevent), [`SystemEvent`](#systemevent).

## `RuntimeEntity`

_type_ in `scene/types.ts`

One loadable entity: bulk entries expanded to `~key:index` ids, shapes
parsed, `off` entities and types that don't load (notes) dropped.

```ts
type RuntimeEntity<F extends object = {
    [field: string]: unknown;
}> = {
    /** Whole behavior blocks in registration order; present only when non-empty. */
    behaviors?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    id: string;
    /** The entity's layer after instance inheritance; present only when set. */
    layer?: string;
    /** The turns and flips of the instances and groups above it; present only when not the identity. */
    transform?: {
        flip: boolean;
        turn: 0 | 1 | 2 | 3;
    };
    type: EntityTypeName;
    /** Draw order within the layer; present only when non-zero. */
    z?: number;
} & RuntimeFields<F>;
```

Refers to [`EntityTypeName`](#entitytypename), [`RuntimeFields`](#runtimefields).

## `RuntimeField`

_type_ in `scene/types.ts`

On-disk field types as the runtime sees them: shape tuples become `ShapeObj`.

```ts
type RuntimeField<T> = T extends ShapeTuple ? ShapeObj : T;
```

Refers to [`ShapeObj`](#shapeobj), [`ShapeTuple`](#shapetuple).

## `RuntimeFields`

_type_ in `scene/types.ts`

```ts
type RuntimeFields<F> = {
    [K in keyof F]: RuntimeField<F[K]>;
};
```

Refers to [`RuntimeField`](#runtimefield).

## `SCENE_FORMAT_VERSION`

_const_ in `scene/types.ts`

Lengths are metres from v4; a game's `world.lengthUnit` (px per metre) draws them.

```ts
declare const SCENE_FORMAT_VERSION = 4;
```

## `SCENE_GRID_MAX_CELLS`

_const_ in `scene/render-geometry.ts`

The most grid cells one render draws; a "…" stands where the rest begin.

```ts
declare const SCENE_GRID_MAX_CELLS = 4096;
```

## `SCENE_HEADER_KEYS`

_const_ in `scene/types.ts`

Keys a scene document has besides its bulk arrays, in canonical order.
Bulk keys follow them, sorted by code unit, then `entities`.

```ts
declare const SCENE_HEADER_KEYS: readonly [
    "$schema",
    "v",
    "game",
    "name",
    "bounds",
    "settings",
    "assets",
    "groups",
    "instances"
];
```

## `SCENE_SVG_MAX_SIZE`

_const_ in `scene/svg.ts`

The longest side of a rendered scene, in image px.

```ts
declare const SCENE_SVG_MAX_SIZE = 1600;
```

## `SCHEMA_ID_BASE`

_const_ in `scene/json-schema.ts`

Prefix of every JSON Schema `$id` the engine publishes: `urn:jams-engine:<name>:v<n>`.

```ts
declare const SCHEMA_ID_BASE = "urn:jams-engine:";
```

## `SceneAsciiMap`

_type_ in `scene/ascii.ts`

```ts
type SceneAsciiMap = {
    /** World px per character. */
    cell: number;
    cols: number;
    /** Every character the map uses, in first-use order, with what it stands for. */
    legend: {
        char: string;
        label: string;
    }[];
    /** One string of `cols` characters per row, top first. Outside the scene's bounds is a space. */
    lines: string[];
    name: string;
    /** The game's px per metre. */
    pxPerMetre: number;
    /** The rectangle drawn, world px: metres times `pxPerMetre`. */
    region: Bounds;
    rows: number;
};
```

Refers to [`Bounds`](#bounds).

## `SceneAsciiOptions`

_type_ in `scene/ascii.ts`

```ts
type SceneAsciiOptions = SceneRegionOptions & {
    /** World px per character (metres times px per metre); default 64. Grows in steps of 64 when the map would pass `maxCells`. */
    cell?: number;
    /** Cap on columns and on rows; default 200. */
    maxCells?: number;
    /** `*` along the trail and `!` at the outcome. */
    overlay?: Pick<SceneOverlay, "outcome" | "trail">;
    /** `~` along every path rider's path; default true. */
    paths?: boolean;
    registry: Registry;
    /** Characters for tagged entities; default `DEFAULT_ASCII_TAG_CHARS`. */
    tagChars?: Readonly<Record<string, string>>;
};
```

Refers to [`Registry`](#registry), [`SceneOverlay`](#sceneoverlay), [`SceneRegionOptions`](#sceneregionoptions).

## `SceneChange`

_type_ in `scene/types.ts`

```ts
type SceneChange = {
    by: Pt;
    kind: "moved";
    ref: Ref;
} | {
    field: "assets" | "bounds" | "game" | "name" | "v" | `groups.${string}` | `settings.${string}`;
    from: unknown;
    kind: "scene";
    to: unknown;
} | {
    field: FieldPath;
    from: unknown;
    kind: "modified";
    ref: Ref;
    to: unknown;
} | {
    from: BulkEntry;
    kind: "resized";
    ref: Ref;
    to: BulkEntry;
} | {
    from: string;
    kind: "renamed";
    to: string;
} | {
    kind: "added";
    ref: Ref;
    type: EntityTypeName;
} | {
    kind: "removed";
    ref: Ref;
    type: EntityTypeName;
};
```

Refers to [`BulkEntry`](#bulkentry), [`EntityTypeName`](#entitytypename), [`FieldPath`](#fieldpath), [`Pt`](#pt), [`Ref`](#ref).

## `SceneCheck`

_type_ in `scene/checks.ts`

```ts
type SceneCheck = ConnectedCheck | GameCheck | ReachesCheck | TouchesCheck | ValidCheck;
```

Refers to [`ConnectedCheck`](#connectedcheck), [`GameCheck`](#gamecheck), [`ReachesCheck`](#reachescheck), [`TouchesCheck`](#touchescheck), [`ValidCheck`](#validcheck).

## `SceneDefinition`

_type_ in `scene/types.ts`

A scene document, the same in memory as on disk. Bulk arrays sit at the
top level under their bulk keys; read them through the registry.

```ts
type SceneDefinition = {
    $schema?: string;
    [bulkKey: BulkKey]: unknown;
    /** Assets only game code names, sorted and unique. */
    assets?: AssetId[];
    bounds: Bounds;
    entities?: EntityDef[];
    /** The game whose registry validates this file; omitted means engine primitives only. */
    game?: string;
    /** Declared groups by id. A member of a group stores geometry local to the group's `at`. */
    groups?: Record<string, GroupDef>;
    instances?: InstanceDef[];
    name: string;
    settings?: SceneSettings;
    v: number;
};
```

Refers to [`AssetId`](#assetid), [`Bounds`](#bounds), [`BulkKey`](#bulkkey), [`EntityDef`](#entitydef), [`GroupDef`](#groupdef), [`InstanceDef`](#instancedef), [`SceneSettings`](#scenesettings).

## `SceneFragment`

_type_ in `scene/fragment.ts`

A piece of a scene on its own: what copy puts on the clipboard as JSON
text, so it also pastes into and out of a chat with an agent. Bulk
entries have no ids, so they travel under their bulk key.

```ts
type SceneFragment = {
    bulk?: Record<BulkKey, BulkEntry[]>;
    entities: EntityDef[];
    /** The game whose registry judges it; omitted, whichever registry it is pasted into. */
    game?: string;
    /** Copied instances; their prefabs travel by id, not in the fragment. */
    instances?: InstanceDef[];
    kind: typeof FRAGMENT_KIND;
    /** The scene format version the fragment was written at. */
    v: number;
};
```

Refers to [`BulkEntry`](#bulkentry), [`BulkKey`](#bulkkey), [`EntityDef`](#entitydef), [`FRAGMENT_KIND`](#fragment_kind), [`InstanceDef`](#instancedef).

## `SceneHash`

_type_ in `scene/types.ts`

16 lowercase hex characters over the canonical text.

```ts
type SceneHash = string;
```

## `SceneIssue`

_type_ in `scene/types.ts`

```ts
type SceneIssue = {
    at?: Pt;
    code: IssueCode;
    /** Facts specific to the code, e.g. `code-skew`'s two schema hashes. */
    detail?: Record<string, unknown>;
    entityIds: string[];
    expected?: string;
    fix?: OpBatch;
    got?: string;
    hint?: string;
    line?: number;
    /** One sentence; names ids, not indices. */
    message: string;
    /**
     * JSON Pointer into the on-disk document, e.g. `/entities/3/path/pts/1`;
     * for an op that failed to apply, into its batch (`/ops/2/ref`).
     */
    path?: string;
    severity: Severity;
};
```

Refers to [`IssueCode`](#issuecode), [`OpBatch`](#opbatch), [`Pt`](#pt), [`Severity`](#severity).

## `SceneLabels`

_type_ in `scene/svg.ts`

```ts
type SceneLabels = "all" | "entities" | "none";
```

## `SceneLayerDef`

_type_ in `scene/layers.ts`

```ts
type SceneLayerDef = {
    description: string;
    /** The draw order visuals on this layer use: a `DRAW_LAYERS` value or any number between. */
    draw: number;
    /** Shown only in the editor, never drawn in play. */
    editorOnly?: boolean;
    /** ID_PATTERN. */
    name: string;
    /** Parallax: how far the layer moves per world unit of camera movement; [1, 1] default, [0, 0] screen-fixed. */
    scroll?: [
        x: number,
        y: number
    ];
    /** How visuals on it order among themselves; default "z". */
    sort?: "y" | "z";
};
```

## `SceneOp`

_type_ in `scene/types.ts`

```ts
type SceneOp = {
    about?: Pt;
    flip?: "x" | "y";
    groups?: string[];
    op: "transform";
    refs?: string[];
    turn?: -1 | 1 | 2 | 3;
} | {
    add?: AssetId[];
    op: "useAssets";
    remove?: AssetId[];
} | {
    anchor?: SpotAnchor;
    at: Pt;
    op: "place";
    ref: Ref;
} | {
    at?: Pt;
    /** Absolute; false is written as absent. */
    flip?: boolean;
    id: string;
    name?: null | string;
    op: "setGroup";
    remove?: boolean;
    /** Absolute; 0 is written as absent. */
    rot?: 0 | 1 | 2 | 3;
} | {
    at?: Pt;
    id: string;
    instance?: string;
    op: "createPrefab";
    refs: Ref[];
} | {
    base: null | string;
    op: "setPrefabBase";
} | {
    by: Pt;
    op: "move";
    refs: Ref[];
} | {
    by?: number;
    op: "setZ";
    refs: Ref[];
    z?: number;
} | {
    cells?: CellEdit[];
    field: string;
    op: "paintCells";
    rects?: CellRect[];
    ref: Ref;
} | {
    entity: EntityInput;
    index?: number;
    op: "add";
} | {
    from: string;
    op: "rename";
    to: string;
} | {
    id: string;
    op: "definePrefab";
    prefab: PrefabBody | null;
} | {
    id: string;
    op: "demote";
} | {
    id: string;
    op: "promote";
    ref: Ref;
} | {
    index: number;
    op: "reorder";
    refs: Ref[];
} | {
    index?: number;
    instance: InstanceInput;
    op: "instantiate";
} | {
    index?: number;
    key: BulkKey;
    op: "addBulk";
    points: Pt[];
} | {
    index?: number;
    key: BulkKey;
    op: "addBulk";
    shapes: ShapeInput[];
} | {
    name: string;
    op: "exposeParam";
    param: PrefabParam | null;
} | {
    name: string;
    op: "setParam";
    ref: string;
    value: unknown;
} | {
    op: "applyToPrefab";
    paths?: OverridePath[];
    ref: Ref;
    to?: string;
} | {
    op: "override";
    ref?: Ref;
    set: Record<OverridePath, unknown>;
} | {
    op: "remove";
    refs: Ref[];
} | {
    op: "revertOverride";
    paths?: OverridePath[];
    ref?: Ref;
} | {
    op: "setScene";
    set: {
        bounds?: Bounds;
        name?: string;
    };
} | {
    op: "setSettings";
    set?: Record<FieldPath, unknown>;
    unset?: FieldPath[];
} | {
    op: "unpack";
    ref: Ref;
} | {
    op: "update";
    ref: Ref;
    set?: Record<FieldPath, unknown>;
    unset?: FieldPath[];
};
```

Refers to [`AssetId`](#assetid), [`Bounds`](#bounds), [`BulkKey`](#bulkkey), [`CellEdit`](#celledit), [`CellRect`](#cellrect), [`EntityInput`](#entityinput), [`FieldPath`](#fieldpath), [`InstanceInput`](#instanceinput), [`OverridePath`](#overridepath), [`PrefabBody`](#prefabbody), [`PrefabParam`](#prefabparam), [`Pt`](#pt), [`Ref`](#ref), [`ShapeInput`](#shapeinput), [`SpotAnchor`](#spotanchor).

## `SceneOverlay`

_type_ in `scene/render-geometry.ts`

What a render draws over the scene, its points in metres. A
`PlaytestReport` fits as it is: its `issues`, `trail`, `events` and
`outcome` are these fields.

```ts
type SceneOverlay = {
    events?: readonly {
        at: OverlayPoint;
        entityId?: string;
        tick?: number;
        type: string;
    }[];
    issues?: readonly Pick<SceneIssue, "at" | "code" | "entityIds" | "severity">[];
    outcome?: null | {
        at: OverlayPoint | null;
        cause?: string;
        result: string;
        tick?: number;
    };
    /** The focus trail, oldest first. */
    trail?: readonly Pt[] | {
        pts: readonly Pt[];
    };
};
```

Refers to [`OverlayPoint`](#overlaypoint), [`Pt`](#pt), [`SceneIssue`](#sceneissue).

## `SceneParseError`

_class_ in `scene/parse.ts`

```ts
declare class SceneParseError extends Error {
    readonly issues: SceneIssue[];
    constructor(issues: SceneIssue[]);
}
```

Refers to [`SceneIssue`](#sceneissue).

## `SceneRegionOptions`

_type_ in `scene/render-geometry.ts`

What part of the world a render covers, in metres.

```ts
type SceneRegionOptions = {
    /** Frame one entity (an id or a `~key:index` bulk ref) and everything within `margin` of it. */
    around?: Ref;
    /** Metres around `around`'s box; default `DEFAULT_MARGIN`. */
    margin?: number;
    /** The prefabs a document's instances name; a document is drawn from its resolved view. */
    prefabs?: PrefabLibrary;
    /** The project the scene is in; sprite boxes take their assets' sizes and pivots from it. */
    project?: ProjectView;
    /** A world rectangle `[x0, y0, x1, y1]`, metres; wins over `around`. */
    region?: Bounds;
};
```

Refers to [`Bounds`](#bounds), [`PrefabLibrary`](#prefablibrary), [`Ref`](#ref).

## `SceneSettings`

_type_ in `scene/types.ts`

The engine's settings, lengths in metres; a game's settings schema adds its own keys beside them.

```ts
type SceneSettings = {
    [key: string]: unknown;
    /** World gravity, m/s²; y is down. Omitted: the project's, else the game's default. */
    gravity?: Pt;
    grid?: GridSettings;
    /** "none" runs without Rapier; omitted resolves through the project and game defaults to "rapier". */
    physics?: "none" | "rapier";
    /** Reserved for projections; only the default exists. */
    view?: {
        projection: "orthogonal";
    };
};
```

Refers to [`GridSettings`](#gridsettings), [`Pt`](#pt).

## `SceneSprite`

_type_ in `scene/render-geometry.ts`

One entity's sprite in a scene, by its ref.

```ts
type SceneSprite = DrawnSprite & {
    ref: string;
    type: string;
};
```

Refers to [`DrawnSprite`](#drawnsprite).

## `SceneSvgOptions`

_type_ in `scene/svg.ts`

```ts
type SceneSvgOptions = SceneRegionOptions & {
    /** `entities` (default) labels entities that have ids; `all` adds bulk refs; `none` labels nothing. */
    labels?: SceneLabels;
    /** Cap on the longest side, image px; default `SCENE_SVG_MAX_SIZE`. */
    maxSize?: number;
    overlay?: SceneOverlay;
    /** Waypoints, numbered ghosts and the line between them for every path rider; default true. */
    paths?: boolean;
    /** Types, styles and materials; the registry the scene was parsed with. */
    registry: Registry;
    /** Image px per world px, before the cap; default 1. */
    scale?: number;
};
```

Refers to [`Registry`](#registry), [`SceneLabels`](#scenelabels), [`SceneOverlay`](#sceneoverlay), [`SceneRegionOptions`](#sceneregionoptions).

## `SceneVersionError`

_class_ in `scene/parse.ts`

```ts
declare class SceneVersionError extends SceneParseError {
    constructor(issues: SceneIssue[]);
}
```

Refers to [`SceneIssue`](#sceneissue), [`SceneParseError`](#sceneparseerror).

## `SceneViewport`

_type_ in `scene/svg.ts`

The world rectangle a render covers and the image size it gets.

```ts
type SceneViewport = {
    height: number;
    /** The game's px per metre: world px are metres times this. */
    pxPerMetre: number;
    /** The world rectangle, metres. */
    region: Bounds;
    /** Image px per world px. */
    scale: number;
    /** World px between grid lines and axis ticks; the ticks are labelled in world px. */
    tick: number;
    width: number;
};
```

Refers to [`Bounds`](#bounds).

## `ScriptPointer`

_type_ in `scene/input-script.ts`

A pointer step: at `at`, pressing or releasing a button, and with `drag`, moving linearly to it over the step.

```ts
type ScriptPointer = {
    at: Pt;
    drag?: Pt;
    press?: PointerButton;
    release?: PointerButton;
};
```

Refers to [`Pt`](#pt).

## `SeatEvent`

_type_ in `scene/recording-schema.ts`

One seat's input event. `t` is the tick, or the tick plus a sub-tick
fraction in thousandths (`120.375`) when the game records offsets.
Analog values and vector components are ints × 1000; pointer x and y
are world metres × 10,000, as ints.

```ts
type SeatEvent = [
    t: number,
    kind: "a",
    action: number,
    value: number
] | [
    t: number,
    kind: "b",
    action: number,
    down: 0 | 1
] | [
    t: number,
    kind: "c",
    command: number,
    args?: unknown
] | [
    t: number,
    kind: "p",
    x: number,
    y: number,
    buttons: number,
    over: 0 | 1
] | [
    t: number,
    kind: "v",
    action: number,
    x: number,
    y: number
];
```

## `SettingsSources`

_type_ in `scene/expand.ts`

Where engine settings come from besides the scene, highest first after it.

```ts
type SettingsSources = {
    /** The game's world defaults (`GameDefinition.world`): `gravity`, `physics` and `grid`. */
    game?: Partial<ResolvedSettings>;
    /** The project's `game-settings` `engine` block: `gravity` and `physics`, each used when valid. */
    project?: Readonly<Record<string, unknown>>;
};
```

Refers to [`ResolvedSettings`](#resolvedsettings).

## `Severity`

_type_ in `scene/types.ts`

```ts
type Severity = "error" | "info" | "warn";
```

## `ShapeInput`

_type_ in `scene/types.ts`

```ts
type ShapeInput = RectInput | ShapeObj | ShapeTuple;
```

Refers to [`RectInput`](#rectinput), [`ShapeObj`](#shapeobj), [`ShapeTuple`](#shapetuple).

## `ShapeObj`

_type_ in `scene/types.ts`

```ts
type ShapeObj = {
    cx: number;
    cy: number;
    halfLen: number;
    r: number;
    rotDeg: number;
    type: "capsule";
} | {
    cx: number;
    cy: number;
    hh: number;
    hw: number;
    rotDeg: number;
    type: "box";
} | {
    cx: number;
    cy: number;
    r: number;
    type: "circle";
} | {
    pts: Pt[];
    type: "chain";
} | {
    pts: Pt[];
    type: "poly";
};
```

Refers to [`Pt`](#pt).

## `ShapeTuple`

_type_ in `scene/types.ts`

```ts
type ShapeTuple = [
    "box",
    cx: number,
    cy: number,
    hw: number,
    hh: number
] | [
    "box",
    cx: number,
    cy: number,
    hw: number,
    hh: number,
    rotDeg: number
] | [
    "capsule",
    cx: number,
    cy: number,
    halfLen: number,
    r: number
] | [
    "capsule",
    cx: number,
    cy: number,
    halfLen: number,
    r: number,
    rotDeg: number
] | [
    "chain",
    ...coords: number[]
] | [
    "circle",
    cx: number,
    cy: number,
    r: number
] | [
    "poly",
    ...coords: number[]
];
```

## `ShapeTupleSchema`

_const_ in `scene/shapes.ts`

```ts
declare const ShapeTupleSchema: z.ZodType<ShapeTuple, unknown, z.core.$ZodTypeInternals<ShapeTuple, unknown>>;
```

Refers to [`ShapeTuple`](#shapetuple).

## `ShapeType`

_type_ in `scene/types.ts`

```ts
type ShapeType = ShapeObj["type"];
```

Refers to [`ShapeObj`](#shapeobj).

## `SpatialHash`

_type_ in `scene/spatial-hash.ts`

A uniform-cell index of boxes by key.

```ts
type SpatialHash<K> = {
    clear(): void;
    /** Adds `key` at `box`; a key already present is moved and keeps its place in the order. */
    insert(key: K, box: Aabb): void;
    /** Keys whose boxes overlap `box` (touching counts), in insertion order. */
    query(box: Aabb): K[];
    readonly size: number;
    remove(key: K): void;
    update(key: K, box: Aabb): void;
};
```

Refers to [`Aabb`](#aabb).

## `SpotAnchor`

_type_ in `scene/types.ts`

```ts
type SpotAnchor = "bottom" | "center" | "left" | "right" | "top";
```

## `SpriteAssetLookup`

_type_ in `game/behaviors/sprite.ts`

An asset's info by id, and with `frame` an atlas frame's: `assetInfo` over a project, or `ProjectRuntimeView.asset`.

```ts
type SpriteAssetLookup = (id: string, frame?: string) => AssetInfo | null | undefined;
```

## `SpritePoseSource`

_type_ in `scene/render-geometry.ts`

The entity geometry a sprite is posed from: world shape, point and path, and the turns and flips above it.

```ts
type SpritePoseSource = {
    at?: Pt;
    path?: Pick<PathDef, "pts">;
    shape?: ShapeObj;
    transform?: RuntimeEntity["transform"];
};
```

Refers to [`PathDef`](#pathdef), [`Pt`](#pt), [`RuntimeEntity`](#runtimeentity), [`ShapeObj`](#shapeobj).

## `SublevelJudgeOptions`

_type_ in `scene/validate.ts`

```ts
type SublevelJudgeOptions = {
    /** World offset, metres; default [0, 0]. */
    at?: Pt;
    label: string;
    /** The scene list in effect. */
    list: readonly SceneListEntry[];
    /** The game's px per metre, which `at` and the cell are judged in. */
    pxPerMetre: number;
    /** The attached scene's asset id. */
    scene: AssetId;
    /** Whether a label is attached already, or still has live entities. */
    taken?: (label: string) => boolean;
};
```

Refers to [`Pt`](#pt).

## `SublevelSettings`

_type_ in `scene/validate.ts`

What `sublevelIssue` reads of a scene: its resolved settings.

```ts
type SublevelSettings = {
    settings: Pick<ResolvedSettings, "gravity" | "grid" | "physics">;
};
```

Refers to [`ResolvedSettings`](#resolvedsettings).

## `SystemEvent`

_type_ in `scene/recording-schema.ts`

The system stream: `w` is `@elapsed`, `j` and `l` a seat's join and leave.

```ts
type SystemEvent = [
    t: number,
    kind: "j",
    player: number,
    device: DeviceId
] | [
    t: number,
    kind: "l",
    player: number,
    device: DeviceId
] | [
    t: number,
    kind: "w",
    ms: number
];
```

## `TouchesCheck`

_type_ in `scene/checks.ts`

Seeded fuzz rollouts touch `entity` in at least `atLeast` of them.

```ts
type TouchesCheck = CheckHead & {
    atLeast: number;
    entity: Ref;
    kind: "touches";
    rollouts?: number;
    seed?: number | string;
    ticks?: number;
};
```

Refers to [`Ref`](#ref).

## `Transform2D`

_type_ in `scene/transform.ts`

x' = a·x + c·y + tx, y' = b·x + d·y + ty (Pixi's Matrix convention).

```ts
type Transform2D = {
    a: number;
    b: number;
    c: number;
    d: number;
    tx: number;
    ty: number;
};
```

## `ValidCheck`

_type_ in `scene/checks.ts`

No issues at or above `max` (default `error`) from `validateScene`, plus `validatePhysical` with `physical`.

```ts
type ValidCheck = CheckHead & {
    kind: "valid";
    max?: "error" | "warn";
    physical?: boolean;
};
```

## `ValidateOptions`

_type_ in `scene/validate.ts`

```ts
type ValidateOptions = {
    /**
     * The project's `game-settings` engine block. Settings resolve through it
     * and the game's world as `expandScene` resolves them, so the grid that
     * sizes grid fields, and that a turned or flipped instance over grid
     * children is judged against, is the scene's, else the game's
     * `world.grid`. A prefab view has no settings of its own and judges
     * against the grid these sources give; with none, each scene that places
     * the prefab judges it. Default `project.engine`, so a caller that hands
     * over the project's view judges physics and grids as Play does.
     */
    engine?: Readonly<Record<string, unknown>>;
    lines?: ReadonlyMap<string, number>;
    /**
     * The prefab this scene is a view of (`prefabScene`, a prefab doc's
     * `readDoc`). The view counts as one level of nesting, an instance that
     * reaches it is `prefab-cycle`, its variant base is checked too, and its
     * grid fields need no `settings.grid`.
     */
    prefab?: string;
    /**
     * The prefabs the scene's instances name. An instance whose prefab, or a
     * prefab nested in it, isn't here is `prefab-unknown`; one whose prefab
     * reaches itself is `prefab-cycle`; nesting past `PREFAB_MAX_DEPTH` is
     * `prefab-depth`.
     */
    prefabs?: PrefabLibrary;
    /**
     * The project the scene belongs to. With it, an asset id (asset fields of
     * types, behaviors and settings, and the `assets` header) that isn't live
     * is `asset-missing` and one of the wrong kind `asset-kind`, a sprite
     * without an asset `sprite-no-asset` and one naming a frame its atlas
     * lacks (or none) `asset-frame-unknown`; without it,
     * asset ids aren't checked.
     */
    project?: ProjectView;
    /** Overrides the sources `engine` and the game's world give, key by key. */
    settings?: SettingsSources;
};
```

Refers to [`PrefabLibrary`](#prefablibrary), [`SettingsSources`](#settingssources).

## `aabb`

_function_ in `scene/shape-geometry.ts`

World-space bounding box. Rotation is degrees here, as in the document.

```ts
declare function aabb(s: ShapeObj): Aabb;
```

Refers to [`Aabb`](#aabb), [`ShapeObj`](#shapeobj).

## `aabbUnion`

_function_ in `scene/shape-geometry.ts`

```ts
declare function aabbUnion(a: Aabb, b: Aabb): Aabb;
```

Refers to [`Aabb`](#aabb).

## `applyOps`

_function_ in `scene/ops.ts`

Applies a batch atomically: every op resolves its refs against the
document the batch started from, and the result carries the inverse batch,
the diff and (unless `validate: "none"`) the structural issues of the new
document. Types, bulk keys and settings come from the registry the scene's
`game` picks out of `given` (`sceneRegistry`), as `validateScene` judges it.

```ts
declare function applyOps(def: SceneDefinition, batch: OpBatch, given: Registry, opts?: ApplyOptions): ApplyResult;
```

Refers to [`ApplyOptions`](#applyoptions), [`ApplyResult`](#applyresult), [`OpBatch`](#opbatch), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `applyPt`

_function_ in `scene/transform.ts`

```ts
declare function applyPt(t: Transform2D, p: Pt): Pt;
```

Refers to [`Transform2D`](#transform2d).

## `applyVec`

_function_ in `scene/transform.ts`

The linear part only: for directions.

```ts
declare function applyVec(t: Transform2D, v: Pt): Pt;
```

Refers to [`Transform2D`](#transform2d).

## `behaviorBlocks`

_function_ in `scene/expand.ts`

The behavior blocks an entity of `type` runs with, in registration order:
each required behavior and each allowed one `written` carries, as the
behavior's field defaults, then the type's (`behaviorRules`), then the
entity's own fields. `written` is the entity's `behaviors` as on disk;
omit it for a bulk entry, which carries only the required ones.

```ts
declare function behaviorBlocks(registry: Registry, type: EntityTypeName, written?: unknown): Record<BehaviorName, BehaviorBlock>;
```

Refers to [`EntityTypeName`](#entitytypename), [`Registry`](#registry).

## `boxCorners`

_function_ in `scene/shape-geometry.ts`

```ts
declare function boxCorners(s: Extract<ShapeObj, {
    type: "box";
}>): Pt[];
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj).

## `bulkEntries`

_function_ in `scene/expand.ts`

A bulk key's entries; empty when the document has none.

```ts
declare function bulkEntries(def: SceneDefinition, k: BulkKey): BulkEntry[];
```

Refers to [`BulkEntry`](#bulkentry), [`BulkKey`](#bulkkey), [`SceneDefinition`](#scenedefinition).

## `bulkId`

_function_ in `scene/bulk-ref.ts`

```ts
declare function bulkId(key: BulkKey, index: number): Ref;
```

Refers to [`BulkKey`](#bulkkey), [`Ref`](#ref).

## `bulkKeyType`

_function_ in `scene/bulk-ref.ts`

The entity type a bulk key holds: the part before the first `:`.

```ts
declare function bulkKeyType(key: BulkKey): EntityTypeName;
```

Refers to [`BulkKey`](#bulkkey), [`EntityTypeName`](#entitytypename).

## `bulkKeysOf`

_function_ in `scene/expand.ts`

The bulk keys a document holds, in canonical order. Needs no registry: any other top-level array is one.

```ts
declare function bulkKeysOf(def: SceneDefinition): BulkKey[];
```

Refers to [`BulkKey`](#bulkkey), [`SceneDefinition`](#scenedefinition).

## `canonicalGrid`

_function_ in `scene/grid.ts`

Maximal runs, no trailing empties, keys row-major by (cy, cx): what files and docs hold.

```ts
declare function canonicalGrid(grid: GridCells): GridCells;
```

Refers to [`GridCells`](#gridcells).

## `centroid`

_function_ in `scene/shape-geometry.ts`

Area centroid of a polygon; the mean of the points when the area is zero.

```ts
declare function centroid(pts: readonly Pt[]): Pt;
```

Refers to [`Pt`](#pt).

## `checksJsonSchema`

_function_ in `scene/checks.ts`

The draft 2020-12 JSON Schema of checks files for `registry`.

```ts
declare function checksJsonSchema(registry: Registry): Record<string, unknown>;
```

Refers to [`Registry`](#registry).

## `checksPathOf`

_function_ in `scene/checks.ts`

`<dir>/<scene>.json` → `<dir>/<scene>.checks.json`.

```ts
declare function checksPathOf(sceneFile: string): string;
```

## `checksSchemaFor`

_function_ in `scene/checks.ts`

The checks-file schema for `registry`: the engine's kinds and the game's.
An inline script's seats are judged by `players` (the project input map's,
`kindInputMap`) over the game's, as the playtest that runs it judges them.

```ts
declare function checksSchemaFor(registry: Registry, players?: PlayersDef | null): z.ZodType<ChecksFile>;
```

Refers to [`ChecksFile`](#checksfile), [`Registry`](#registry).

## `checksSchemaId`

_function_ in `scene/checks.ts`

`urn:jams-engine:checks:v3`, or `urn:jams-engine:checks:<game>:v3`.

```ts
declare function checksSchemaId(registry: Registry): string;
```

Refers to [`Registry`](#registry).

## `childRef`

_const_ in `scene/resolve.ts`

The resolved ref of an instance's child: `gate-3/door`, `gate-3/~solid:0`.

```ts
declare const childRef: (instance: string, child: Ref) => Ref;
```

Refers to [`Ref`](#ref).

## `closest`

_function_ in `scene/did-you-mean.ts`

The nearest candidate within `max(1, floor(len / 3))` edits, case-insensitive.

```ts
declare function closest(word: string, candidates: readonly string[]): string | undefined;
```

## `closestOnSegment`

_function_ in `scene/shape-geometry.ts`

The point of segment `a`→`b` nearest `p`, how far along it is (0 at `a`, 1 at `b`) and its distance.

```ts
declare function closestOnSegment([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt): {
    at: Pt;
    dist: number;
    t: number;
};
```

Refers to [`Pt`](#pt).

## `compareChunkKeys`

_function_ in `scene/grid.ts`

Orders chunk keys row-major by `(cy, cx)` numerically; unparseable keys sort last by code unit.

```ts
declare function compareChunkKeys(a: ChunkKey, b: ChunkKey): number;
```

Refers to [`ChunkKey`](#chunkkey).

## `comparePointers`

_function_ in `scene/format.ts`

Orders two JSON Pointers by where they land in `formatScene`'s text: an
ancestor before what it holds, array items by index, keys in canonical
order, chunk keys row-major. A missing pointer sorts last. Inside an
object, a key under `path` is taken to be a path's; every key under
`behaviors` (names, fields, and keys nested in them) sorts by code unit.
Pass the document to place grid-valued keys, which only their values tell
apart.

```ts
declare function comparePointers(a: string | undefined, b: string | undefined, doc?: unknown): number;
```

## `compose`

_function_ in `scene/transform.ts`

```ts
declare function compose(outer: Transform2D, inner: Transform2D): Transform2D;
```

Refers to [`Transform2D`](#transform2d).

## `composeDihedral`

_function_ in `scene/transform.ts`

`outer ∘ inner` on the dihedral group: composing turns and flips without matrices.

```ts
declare function composeDihedral(outer: Dihedral, inner: Dihedral): Dihedral;
```

Refers to [`Dihedral`](#dihedral).

## `containedInRect`

_function_ in `scene/shape-geometry.ts`

Whether all of `s` lies inside `rect`; edges count, give or take rotation's rounding noise.

```ts
declare function containedInRect(s: ShapeObj, rect: Aabb): boolean;
```

Refers to [`Aabb`](#aabb), [`ShapeObj`](#shapeobj).

## `containsPoint`

_function_ in `scene/shape-geometry.ts`

Whether `p` is inside `s`, or within `tol` px of it. A chain has no inside.

```ts
declare function containsPoint(s: ShapeObj, p: Pt, tol?: number): boolean;
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj).

## `convexHull`

_function_ in `scene/shape-geometry.ts`

The convex hull of `pts` (Andrew's monotone chain) without collinear or
repeated points, wound the same way as `pts`; fewer than 3 points when
they all lie on one line.

```ts
declare function convexHull(pts: readonly Pt[]): Pt[];
```

Refers to [`Pt`](#pt).

## `createRegistry`

_function_ in `game/define.ts`

Merges the engine's primitives with a game's types, materials, actions,
collision groups and issue codes, and the project's materials over the
game's, and the engine's behaviors then the game's. Throws
`RegistryError` listing every problem: duplicate or reserved names, bulk
keys or codes, a type without a system, a spawn-only type that never
loads or has a bulk form, a spawn order that misses or
repeats a type, unknown groups, a game behavior outside the game's
namespace, a behavior `template` its fields or `refine` refuse, behavior
rules naming unknown behaviors or failing their schemas, a grid field without a point `at`, a `time.rate` the clock can't run
(`tick-rate-invalid`), an unknown `time.kind` or a `time.catchUp.maxMs` that
isn't a whole number ≥ 0, world defaults the scene settings would refuse, and
`world.gridWalls` naming a type that is unknown or never loads, and input
the shell can't read: seats outside 1–8, a deadzone outside 0–1, an
unknown action kind, a `ui` flag other than `true`, a 0.x key `keysProblems` refuses and every binding
`bindingProblems` refuses (`binding-unknown`, `player-unknown`).

```ts
declare function createRegistry(game?: GameDefinition | null, opts?: CreateRegistryOptions): Registry;
```

Refers to [`Registry`](#registry).

## `createScene`

_function_ in `scene/create.ts`

A new scene named `name` for `registry`'s game (none for the engine's):
the header, then `template`, else the game's own `template`, else
`EMPTY_SCENE_TEMPLATE`. `$schema` is written first when given.

```ts
declare function createScene(name: string, registry: Registry, opts?: {
    $schema?: string;
    template?: SceneTemplate;
}): SceneDefinition;
```

Refers to [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `createSpatialHash`

_function_ in `scene/spatial-hash.ts`

A hash with square cells of side `cell` (default 2.56 m).

```ts
declare function createSpatialHash<K>(cell?: number): SpatialHash<K>;
```

Refers to [`SpatialHash`](#spatialhash).

## `decodeRow`

_function_ in `scene/grid.ts`

The row's 32 cells, or null when it isn't in the row grammar.

```ts
declare function decodeRow(row: GridRow): Uint16Array | null;
```

Refers to [`GridRow`](#gridrow).

## `defaultLayer`

_function_ in `scene/layers.ts`

The layer an entity without `layer` sits on: types that never load
(notes) on `editor`, bulk entries on `terrain`, other entities on
`gameplay`. Given a game's `layers` that lack one of those names, an
editor-only type falls back to the last layer and everything else to the
first; without `layers` the names are `DEFAULT_LAYERS`'.

```ts
declare function defaultLayer(type: RegisteredType | undefined, bulk: boolean, layers?: readonly SceneLayerDef[]): string;
```

Refers to [`SceneLayerDef`](#scenelayerdef).

## `defaultPhysics`

_function_ in `scene/expand.ts`

The game's default backend: the project's `engine.physics`, else `world.physics`, else Rapier.

```ts
declare function defaultPhysics(registry: Registry, engine?: Readonly<Record<string, unknown>>): "none" | "rapier";
```

Refers to [`Registry`](#registry).

## `describeChange`

_function_ in `scene/diff.ts`

One line per change, e.g. `lift.path.speed: 100 -> 140`.

```ts
declare function describeChange(c: SceneChange): string;
```

Refers to [`SceneChange`](#scenechange).

## `diffPrefabToOps`

_function_ in `scene/diff-to-ops.ts`

A batch that turns a prefab doc's view (`readDoc` of a prefab doc: a
scene named after the prefab, its bounds synthesised) into `next`'s
children, nested instances and `assets`, as `diffToOps` writes them; the
view's name and bounds stay. Given `header`, the prefab's base and params
as they are now (`readDoc`'s `prefab`), a changed base is a
`setPrefabBase` and each changed param an `exposeParam`, for `applyOps`
with `{ prefab }`. Its id, variant overrides and contract are left to the
caller.

```ts
declare function diffPrefabToOps(view: SceneDefinition, next: Prefab, registry?: Registry, header?: Pick<Prefab, "base" | "params">): OpBatch;
```

Refers to [`OpBatch`](#opbatch), [`Prefab`](#prefab), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `diffScenes`

_function_ in `scene/diff.ts`

What changed from `a` to `b`: scene fields, settings by key, the `assets`
header as a set, groups by key, entities and then instances by id, then bulk entries per bulk key. Types come from the entities and the
bulk keys, so no registry is needed.

```ts
declare function diffScenes(a: SceneDefinition, b: SceneDefinition): SceneChange[];
```

Refers to [`SceneChange`](#scenechange), [`SceneDefinition`](#scenedefinition).

## `diffToOps`

_function_ in `scene/diff-to-ops.ts`

A batch that turns scene `a` into scene `b`: `applyOps(a, diffToOps(a, b))`
formats exactly as `b`.

Named entities match by id. One present on both sides with the same type
becomes an `update` (set and unset of the top-level fields that differ), so
a live doc keeps its key, and a survivor whose place in the order moved a
`reorder`; a type change is removed and added again. New entities are
added at their index. Bulk arrays keep the entries they share in order (LCS); an entry
that only moved becomes a `move` (one per offset), one resized or
otherwise changed in place an `update` of its shape or point, and the
rest is removed or added. The header goes through `setScene`, settings
through `setSettings`, the `assets` header through `useAssets`, groups
through `setGroup` (its turn and flip included). Instances match by id
like named entities, their `rot`, `flip` and `overrides` through
`update`, each changed param through `setParam`; a change of only `z` is a `setZ`, and one placing
another prefab is removed and instantiated again. A grid field that
changed is one `update` of the whole field.

`registry` tells point-form bulk keys from shape-form ones; without it the
values decide. Throws when `$schema`, `v` or `game` differ, or when `b` has
no `name`, since no op changes those.

```ts
declare function diffToOps(a: SceneDefinition, b: SceneDefinition, registry?: Registry): OpBatch;
```

Refers to [`OpBatch`](#opbatch), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `dihedral`

_function_ in `scene/transform.ts`

```ts
declare function dihedral(d: Dihedral, at: Pt): Transform2D;
```

Refers to [`Dihedral`](#dihedral), [`Transform2D`](#transform2d).

## `dihedralOf`

_function_ in `scene/transform.ts`

The dihedral part of a transform whose linear part is one, else null.

```ts
declare function dihedralOf(t: Transform2D): Dihedral | null;
```

Refers to [`Dihedral`](#dihedral), [`Transform2D`](#transform2d).

## `encodeRow`

_function_ in `scene/grid.ts`

The canonical row for up to 32 cells.

```ts
declare function encodeRow(cells: ArrayLike<number>): GridRow;
```

Refers to [`GridRow`](#gridrow).

## `entityIssues`

_function_ in `scene/parse.ts`

Maps a schema failure of one entity checked on its own, as `parseScene`
would map it inside a document (did-you-mean for keys and types,
`expected` and `got`), with each pointer moved by `relocate` from the
entity-relative form (`""`, `/path/speed`). With `spawn`, `def` is a
`ctx.spawn` input judged by `spawnSchemaFor`.

```ts
declare function entityIssues(issues: readonly z.core.$ZodIssue[], def: unknown, relocate: (rel: string) => string, registry: Registry, opts?: {
    spawn?: boolean;
}): SceneIssue[];
```

Refers to [`Registry`](#registry), [`SceneIssue`](#sceneissue).

## `entitySchemaFor`

_function_ in `scene/schema.ts`

The on-disk schema of one placeable type's entities; `undefined` for an
unregistered or spawn-only type, which no scene may name.

```ts
declare function entitySchemaFor(registry: Registry, type: EntityTypeName): undefined | z.ZodObject;
```

Refers to [`EntityTypeName`](#entitytypename), [`Registry`](#registry).

## `expandInstance`

_function_ in `scene/expand.ts`

One prefab instance's entities as a load expands them: ids
`<instance>/<child>` (refs between its children remapped to them), fields,
behaviors, `z`, layers and `transform`, in spawn-group order, `off`
children and types that don't load dropped. `group` is the instance's
group; `cells` says the scene's turns are grid turns (`gridTurns`). An
issue when the prefab is missing, cyclic or too deep; a child of an
unregistered type throws, as a load does.

```ts
declare function expandInstance(inst: InstanceDef, library: PrefabLibrary, registry: Registry, opts?: {
    cells?: boolean;
    group?: GroupDef;
}): {
    entities: RuntimeEntity[];
    ok: true;
} | {
    issue: SceneIssue;
    ok: false;
};
```

Refers to [`GroupDef`](#groupdef), [`InstanceDef`](#instancedef), [`PrefabLibrary`](#prefablibrary), [`Registry`](#registry), [`RuntimeEntity`](#runtimeentity), [`SceneIssue`](#sceneissue).

## `expandScene`

_function_ in `scene/expand.ts`

What the runtime loads, as the scene's resolved view (`resolveScene`)
holds it: group transforms applied, each instance's children through
`expandInstance` (ids `<instance>/<child>`); bulk entries become `~key:index` entities, `off` entities and
types that don't load are dropped, along with the editor's fields (`layer`
and a non-zero `z` stay), shapes become objects, behavior blocks are whole
(`behaviorBlocks`), a turned or flipped entity records its `transform`,
and settings get their defaults. Entities come in `registry.spawnGroups`
order: within a group, bulk entries first (in `registry.bulkKeys` order),
then entities in file order, instance children after the document's own.

```ts
declare function expandScene(source: SceneDefinition, registry: Registry, opts?: ExpandOptions): ExpandedScene;
```

Refers to [`ExpandOptions`](#expandoptions), [`ExpandedScene`](#expandedscene), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `fieldKind`

_function_ in `scene/schema.ts`

Shape tuples, points and paths are recognised by the schema they were
built from, vectors, angles, mirrors, sides, grids and tags by their
builder's `meta.kind` (`game/fields.ts`).

```ts
declare function fieldKind(schema: z.core.$ZodType): FieldKind;
```

Refers to [`FieldKind`](#fieldkind).

## `flipWorld`

_function_ in `scene/transform.ts`

The world-axis flip `"x"` or `"y"` composed onto `d` (what the transform op does).

```ts
declare function flipWorld(d: Dihedral, axis: "x" | "y"): Dihedral;
```

Refers to [`Dihedral`](#dihedral).

## `formatAsciiMap`

_function_ in `scene/ascii.ts`

`sceneAsciiMap` as text: a header, an x ruler, rows prefixed by their y, and the legend.

```ts
declare function formatAsciiMap(map: SceneAsciiMap): string;
```

Refers to [`SceneAsciiMap`](#sceneasciimap).

## `formatChecks`

_function_ in `scene/format.ts`

The canonical text of a checks file: `canonicalJson` over `CHECKS_LAYOUT`, one check per line.

```ts
declare function formatChecks(file: ChecksFile): string;
```

Refers to [`ChecksFile`](#checksfile).

## `formatInputScript`

_function_ in `scene/format.ts`

The canonical text of an input script: `canonicalJson` over
`INPUT_SCRIPT_LAYOUT`, one step per line; each track opens on a line with
its `player` and holds one step per line.

```ts
declare function formatInputScript(script: InputScript | InputScriptV2): string;
```

## `formatPrefab`

_function_ in `scene/format.ts`

The canonical text of a prefab file, two-space indent, trailing newline:
`$schema`, `kind`, `v`, `game`, `id`, `base` and `contract` one per line;
`params` one param per line; `assets` on one line, sorted and unique;
`overrides` one per line; `bulk` one array per key with one entry per
line; `instances` and then `entities` one per line. Params and overrides
are keyed in code-unit order; empty `params`, `assets`, `overrides`,
`bulk` and `instances` are left out, and `entities` is always written.

```ts
declare function formatPrefab(prefab: Prefab): string;
```

Refers to [`Prefab`](#prefab).

## `formatPrefabs`

_function_ in `scene/prefab.ts`

The canonical text of each prefab, by id, as files are written.

```ts
declare function formatPrefabs(prefabs: PrefabLibrary): Map<string, string>;
```

Refers to [`PrefabLibrary`](#prefablibrary).

## `formatScene`

_function_ in `scene/format.ts`

The canonical text of a scene, without a registry: header keys in
`SCENE_HEADER_KEYS` order, then bulk keys sorted by code unit, then
`entities`; one tuple, instance, entity or group per line, the `assets`
header on one line, sorted and unique, two-space indent, trailing
newline. An entity holding grids spans lines: its grid fields last, one
chunk per line. Empty arrays, an empty `groups` or `settings` and a
row's empty nested maps (`withoutEmptyMaps`) are left out. `lines`
maps every JSON Pointer to its 1-based line; pointers inside a tuple or
entity map to that item's first line, except those inside a chunk (its
line) and a later grid field's key (the line it opens on).

```ts
declare function formatScene(def: SceneDefinition): {
    lines: Map<string, number>;
    text: string;
};
```

Refers to [`SceneDefinition`](#scenedefinition).

## `fragmentBounds`

_function_ in `scene/fragment.ts`

The world box around everything in the fragment; `null` when nothing in
it has a position. Its instances count with `prefabs`: the box around
each one's resolved children (a variant's base and nested instances'
children included), turned and flipped with it; one whose prefab isn't
there is skipped.

```ts
declare function fragmentBounds(fragment: SceneFragment, registry: Registry, prefabs?: PrefabLibrary): Aabb | null;
```

Refers to [`Aabb`](#aabb), [`PrefabLibrary`](#prefablibrary), [`Registry`](#registry), [`SceneFragment`](#scenefragment).

## `fragmentJsonSchema`

_function_ in `scene/json-schema.ts`

The JSON Schema of scene fragments (the clipboard's JSON) judged by `registry`.

```ts
declare function fragmentJsonSchema(registry: Registry): Record<string, unknown>;
```

Refers to [`Registry`](#registry).

## `fragmentOf`

_function_ in `scene/fragment.ts`

The entities, instances and bulk entries `refs` name, in document order,
as the resolved view holds them (world coordinates); refs that don't
resolve are skipped. An instance travels as itself, its prefab by id; a
child of an instance (`gate-2/door`, resolved through `prefabs`) travels
as a plain entity, unless its instance is copied too.

```ts
declare function fragmentOf(def: SceneDefinition, refs: readonly Ref[], registry: Registry, prefabs?: PrefabLibrary): SceneFragment;
```

Refers to [`PrefabLibrary`](#prefablibrary), [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition), [`SceneFragment`](#scenefragment).

## `fragmentSchemaFor`

_function_ in `scene/fragment.ts`

The schema of a fragment judged by `registry`: entities and bulk entries
exactly as a scene of that registry holds them.

```ts
declare function fragmentSchemaFor(registry: Registry): z.ZodObject;
```

Refers to [`Registry`](#registry).

## `geometryFields`

_function_ in `scene/schema.ts`

A type's geometry fields, in declaration order. Tags are labels, not geometry.

```ts
declare function geometryFields(t: RegisteredType): {
    field: string;
    kind: Exclude<FieldKind, "tags" | "value">;
}[];
```

Refers to [`FieldKind`](#fieldkind).

## `gridCellBounds`

_function_ in `scene/grid.ts`

```ts
declare function gridCellBounds(grid: GridCells): CellBounds | null;
```

Refers to [`GridCells`](#gridcells).

## `gridProblems`

_function_ in `scene/grid.ts`

Everything wrong with a plain-JSON grid value whose cells may go up to
`max`: bad chunk keys, too many rows, rows outside the grammar, values
past `max`. Empty when the value is a grid `canonicalGrid` accepts.

```ts
declare function gridProblems(value: unknown, max?: number): GridProblem[];
```

Refers to [`GridProblem`](#gridproblem).

## `gridTurns`

_function_ in `scene/resolve.ts`

Whether grid fields turn and flip with their entity: only on a square
grid with equal cells, the one a quarter turn keeps on itself. Elsewhere
a turned grid child keeps its cells (validation reports it).

```ts
declare function gridTurns(def: Pick<SceneDefinition, "settings">): boolean;
```

Refers to [`SceneDefinition`](#scenedefinition).

## `groupOrigin`

_function_ in `scene/resolve.ts`

A group's origin; `[0, 0]` for no group or one that isn't declared.

```ts
declare function groupOrigin(def: SceneDefinition, group: string | undefined): Pt;
```

Refers to [`Pt`](#pt), [`SceneDefinition`](#scenedefinition).

## `groupTransform`

_function_ in `scene/resolve.ts`

A group's transform: its turn and flip about its `at`, the identity for no group or one that isn't declared.

```ts
declare function groupTransform(def: SceneDefinition, group: string | undefined): Transform2D;
```

Refers to [`SceneDefinition`](#scenedefinition), [`Transform2D`](#transform2d).

## `hashText`

_function_ in `scene/hash.ts`

16 hex characters: two FNV-1a 32 passes over the UTF-8 text.

```ts
declare function hashText(text: string): string;
```

## `inputScriptJsonSchema`

_function_ in `scene/input-script.ts`

The draft 2020-12 JSON Schema of input scripts for `registry`.

```ts
declare function inputScriptJsonSchema(registry: Registry): Record<string, unknown>;
```

Refers to [`Registry`](#registry).

## `inputScriptSchemaFor`

_function_ in `scene/input-script.ts`

An input script for `registry`'s game: its actions, `until` predicates, play options and seats.

```ts
declare function inputScriptSchemaFor(registry: Registry, players?: PlayersDef | null): InputScriptSchemas["script"];
```

Refers to [`InputScriptSchemas`](#inputscriptschemas), [`Registry`](#registry).

## `inputScriptSchemaId`

_function_ in `scene/input-script.ts`

`urn:jams-engine:input-script:v2`, or `urn:jams-engine:input-script:<game>:v2`.

```ts
declare function inputScriptSchemaId(registry: Registry): string;
```

Refers to [`Registry`](#registry).

## `inputScriptSchemasFor`

_function_ in `scene/input-script.ts`

The input-script schemas for `registry`, built once per registry and seat
limit; `players` is the project input map's, which sets the seats tracks
may drive over the game's (`scriptSeatLimit`).

```ts
declare function inputScriptSchemasFor(registry: Registry, players?: PlayersDef | null): InputScriptSchemas;
```

Refers to [`InputScriptSchemas`](#inputscriptschemas), [`Registry`](#registry).

## `instanceOrigin`

_function_ in `scene/resolve.ts`

Where an instance's prefab origin lands in the world.

```ts
declare function instanceOrigin(def: SceneDefinition, inst: InstanceDef): Pt;
```

Refers to [`InstanceDef`](#instancedef), [`Pt`](#pt), [`SceneDefinition`](#scenedefinition).

## `instanceSteps`

_function_ in `scene/resolve.ts`

The transforms that place an instance's children, innermost first: its
own turn and flip at its `at`, then its group's. Each is applied in turn,
so a child resolves exactly as it would after `unpack` into the group.

```ts
declare function instanceSteps(def: SceneDefinition, inst: InstanceDef): Transform2D[];
```

Refers to [`InstanceDef`](#instancedef), [`SceneDefinition`](#scenedefinition), [`Transform2D`](#transform2d).

## `instanceTransform`

_function_ in `scene/resolve.ts`

An instance's world transform: its group's after its own turn and flip at its `at`.

```ts
declare function instanceTransform(def: SceneDefinition, inst: InstanceDef): Transform2D;
```

Refers to [`InstanceDef`](#instancedef), [`SceneDefinition`](#scenedefinition), [`Transform2D`](#transform2d).

## `intersectsRect`

_function_ in `scene/shape-geometry.ts`

Whether `s` touches the world rectangle `rect` at all; edges count.

```ts
declare function intersectsRect(s: ShapeObj, rect: Aabb): boolean;
```

Refers to [`Aabb`](#aabb), [`ShapeObj`](#shapeobj).

## `inverseTurn`

_const_ in `scene/transform.ts`

The inverse element: what undoes `d`.

```ts
declare const inverseTurn: (d: Dihedral) => Dihedral;
```

Refers to [`Dihedral`](#dihedral).

## `invert`

_function_ in `scene/transform.ts`

```ts
declare function invert(t: Transform2D): Transform2D;
```

Refers to [`Transform2D`](#transform2d).

## `isConvex`

_function_ in `scene/shape-geometry.ts`

True for a simple convex polygon in either winding: non-zero area, every
turn the same way (collinear points allowed), and one full revolution, so
a star or bow-tie whose turns agree still fails.

```ts
declare function isConvex(pts: readonly Pt[]): boolean;
```

Refers to [`Pt`](#pt).

## `isExpandedScene`

_function_ in `scene/expand.ts`

Whether `scene` is already expanded: an `ExpandedScene` has an `entities` list and, unlike a document, no `v`.

```ts
declare function isExpandedScene(scene: ExpandedScene | SceneDefinition): scene is ExpandedScene;
```

Refers to [`ExpandedScene`](#expandedscene), [`SceneDefinition`](#scenedefinition).

## `isGridValue`

_function_ in `scene/grid.ts`

A plain-JSON value that is a grid: an object with ≥ 1 key, every key a chunk key, every value an array of strings.

```ts
declare function isGridValue(v: unknown): v is GridCells;
```

Refers to [`GridCells`](#gridcells).

## `isIdentityTurn`

_const_ in `scene/transform.ts`

```ts
declare const isIdentityTurn: (d: Dihedral) => boolean;
```

Refers to [`Dihedral`](#dihedral).

## `isInstanceOverrideField`

_function_ in `scene/field-path.ts`

Whether an override's field path, on a child ref naming a nested
instance, sets that instance's own field: `door-1.at`, `door-1.rot`,
`.flip`, `.z`, `.off`, `.layer`, `.params.<name>`.

```ts
declare function isInstanceOverrideField(field: FieldPath): boolean;
```

Refers to [`FieldPath`](#fieldpath).

## `isMigrationRefusal`

_function_ in `scene/migrate.ts`

Whether a step's result is a refusal rather than the lifted document.

```ts
declare function isMigrationRefusal(value: unknown): value is MigrationRefusal;
```

Refers to [`MigrationRefusal`](#migrationrefusal).

## `isSpawnOnly`

_function_ in `game/define.ts`

Whether `type` is registered spawn-only: it loads and `ctx.spawn` makes
it, but no scene, prefab or op may place it.

```ts
declare function isSpawnOnly(registry: Registry, type: EntityTypeName): boolean;
```

Refers to [`EntityTypeName`](#entitytypename), [`Registry`](#registry).

## `isWholePixel`

_function_ in `scene/units.ts`

Whether m × pxPerMetre is a whole number, to the rounding rule's
precision: within 1e-6 m of a whole world px, so every `snapToPixel` and
`pxToMetres` result passes at any px per metre (at 48, 5 px is written
0.104167 m).

```ts
declare function isWholePixel(m: number, pxPerMetre: number): boolean;
```

## `jsonPointer`

_function_ in `scene/issues.ts`

RFC 6901 pointer from path segments; `[]` is the root, `""`.

```ts
declare function jsonPointer(segments: readonly (number | string)[]): string;
```

## `layerNames`

_const_ in `scene/json-schema.ts`

The layer names `registry` declares, bottom to top.

```ts
declare const layerNames: (registry: Registry) => string[];
```

Refers to [`Registry`](#registry).

## `lengthDecimals`

_function_ in `scene/units.ts`

Decimals that show one world px exactly at pxPerMetre, at most 6 (2 at 100, 5 at 32).

```ts
declare function lengthDecimals(pxPerMetre: number): number;
```

## `localChild`

_function_ in `scene/resolve.ts`

One child of an instance in the prefab's frame with the instance's
overrides applied; `null` when the prefab has no such child. A bulk
child's override names its bulk field (`~solid:0.shape`); a nested
child is named by its relative ref (`door-1/panel`).

```ts
declare function localChild(prefab: Prefab, inst: InstanceDef, child: Ref, registry: Registry, library?: PrefabLibrary, opts?: ResolveOptions): LocalChild | null;
```

Refers to [`InstanceDef`](#instancedef), [`LocalChild`](#localchild), [`Prefab`](#prefab), [`PrefabLibrary`](#prefablibrary), [`Ref`](#ref), [`Registry`](#registry), [`ResolveOptions`](#resolveoptions).

## `localChildren`

_function_ in `scene/resolve.ts`

Every child of an instance in the prefab's frame, its overrides applied,
in prefab order: entities, then bulk entries by key, then the nested
instances' children. Without `library`, nested instances and a variant's base are left out;
with it, a prefab that doesn't resolve (`resolvePrefab`) has none.

```ts
declare function localChildren(prefab: Prefab, inst: InstanceDef, registry: Registry, library?: PrefabLibrary, opts?: ResolveOptions): LocalChild[];
```

Refers to [`InstanceDef`](#instancedef), [`LocalChild`](#localchild), [`Prefab`](#prefab), [`PrefabLibrary`](#prefablibrary), [`Registry`](#registry), [`ResolveOptions`](#resolveoptions).

## `makeIssue`

_function_ in `scene/issues.ts`

A `SceneIssue` with the code's severity and hint filled in. A game's codes
are looked up in `codes`, which is `registry.issueCodes` for them.

```ts
declare function makeIssue(code: IssueCode, fields: Partial<Omit<SceneIssue, "code">> & {
    message: string;
}, codes?: Readonly<Record<string, IssueCodeInfo>>): SceneIssue;
```

Refers to [`IssueCode`](#issuecode), [`IssueCodeInfo`](#issuecodeinfo), [`SceneIssue`](#sceneissue).

## `migrate`

_function_ in `scene/migrate.ts`

```ts
declare function migrate(raw: unknown, migrations?: Readonly<Record<number, Migration>>, target?: number, env?: MigrateEnv): MigrateResult;
```

Refers to [`MigrateEnv`](#migrateenv), [`MigrateResult`](#migrateresult), [`Migration`](#migration).

## `migrateInputScript`

_function_ in `scene/input-script.ts`

Lifts an older input script to the current format for `registry`'s game
(its px per metre and field units). A value with no usable `v`, or one at
or past the current version, comes back unchanged for the schema to judge.

```ts
declare function migrateInputScript(raw: unknown, registry: Registry): MigrateInputScriptResult;
```

Refers to [`MigrateInputScriptResult`](#migrateinputscriptresult), [`Registry`](#registry).

## `migrateRecordingV1`

_function_ in `scene/recording-schema.ts`

A v1 recording in format v2, losslessly: key edges become seat 0's `b`
events and commands its `c` events, except an `@elapsed` that leads its
tick, which becomes a system `w` event (the system stream merges first,
so the tick's order is kept); `tickRate` becomes `time` with the
registry's time kind, else `fixed`. v1 ran in world px, so its lengths
become metres at the registry's px per metre (`world.lengthUnit`, else the
default), by the input-script rule: positions (`start.at`, the outcome's
`at`, markers and trail) always, and the play options and each command's
args wherever the registry's schemas declare a length unit. The platform
is unknown, the project null and `runHash` empty, so a replay judges
staleness on `sceneHash`. Without a seed the run used its default one,
written as the text the default is hashed from, which seeds the
generator identically.

```ts
declare function migrateRecordingV1(v1: RunRecordingV1, registry?: RecordingRegistry): RunRecordingV2;
```

Refers to [`RunRecordingV1`](#runrecordingv1), [`RunRecordingV2`](#runrecordingv2).

## `nearestSegment`

_function_ in `scene/shape-geometry.ts`

The poly or chain segment nearest `p`: segment `index` runs from point
`index` to the next, and a poly's last segment closes back to point 0.
`null` for the other shapes.

```ts
declare function nearestSegment(s: ShapeObj, p: Pt): null | {
    at: Pt;
    dist: number;
    index: number;
    t: number;
};
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj).

## `nearestVertex`

_function_ in `scene/shape-geometry.ts`

The poly or chain point nearest `p`; `null` for the other shapes.

```ts
declare function nearestVertex(s: ShapeObj, p: Pt): null | {
    at: Pt;
    dist: number;
    index: number;
};
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj).

## `nextFreeId`

_function_ in `scene/fragment.ts`

`id` when it's free, else the next free `<stem>-<n>` (`lift` → `lift-2`, `lift-2` → `lift-3`), at most 48 characters.

```ts
declare function nextFreeId(id: string, taken: ReadonlySet<string>): string;
```

## `opBatchSchemaFor`

_function_ in `scene/ops-schema.ts`

A batch of ops, with entity types and bulk keys from `registry`.

```ts
declare function opBatchSchemaFor(registry: Registry): OpSchemas["batch"];
```

Refers to [`Registry`](#registry).

## `opsJsonSchema`

_function_ in `scene/ops-schema.ts`

```ts
declare function opsJsonSchema(registry: Registry): Record<string, unknown>;
```

Refers to [`Registry`](#registry).

## `opsSchemaId`

_function_ in `scene/ops-schema.ts`

`urn:jams-engine:ops:v1`, or `urn:jams-engine:ops:<game>:v1`, beside the registry's scene schema id.

```ts
declare function opsSchemaId(registry: Registry): string;
```

Refers to [`Registry`](#registry).

## `paintGrid`

_function_ in `scene/grid.ts`

The grid after the edits, which rows changed, and the edits that undo them.
Rects are painted first, then single cells, so a cell edit wins over a
rect under it. A cell painted to the value it already had is no change;
`inverse` holds each changed cell once, with its old value.

```ts
declare function paintGrid(grid: GridCells, edit: {
    cells?: readonly CellEdit[];
    rects?: readonly CellRect[];
}): {
    grid: GridCells;
    inverse: CellEdit[];
    rows: {
        chunk: ChunkKey;
        row: number;
    }[];
};
```

Refers to [`CellEdit`](#celledit), [`CellRect`](#cellrect), [`ChunkKey`](#chunkkey), [`GridCells`](#gridcells).

## `parseBulkId`

_function_ in `scene/bulk-ref.ts`

Splits `~solid:ice:3` on its last colon; `null` for anything that isn't
shaped like a bulk reference. Format only: whether the key is registered
is the registry's question (`registry.bulkKey`).

```ts
declare function parseBulkId(ref: Ref): null | {
    index: number;
    key: BulkKey;
};
```

Refers to [`BulkKey`](#bulkkey), [`Ref`](#ref).

## `parseChecks`

_function_ in `scene/checks.ts`

Parses a `.checks.json` file for `registry`: the header, then each check
by its `kind`, so a mistake is reported against the fields it was meant
to have. Ids must be unique. An inline input script is only checked to be
an object here; the playtest compiles it. A `reaches` check's `expect`
keeps the order it was written in, so a verdict names the first key that
fails. Issues carry lines.

```ts
declare function parseChecks(text: string, registry: Registry): ParseChecksResult;
```

Refers to [`ParseChecksResult`](#parsechecksresult), [`Registry`](#registry).

## `parseChildRef`

_function_ in `scene/resolve.ts`

Splits a resolved child ref; `null` for a ref of the document itself.

```ts
declare function parseChildRef(ref: Ref): null | {
    child: Ref;
    instance: string;
};
```

Refers to [`Ref`](#ref).

## `parseChunkKey`

_function_ in `scene/grid.ts`

```ts
declare function parseChunkKey(key: string): [
    cx: number,
    cy: number
] | null;
```

## `parseFragment`

_function_ in `scene/fragment.ts`

Parses a fragment from clipboard text or a parsed value: a stale `v` is
lifted by the scene migrations, then the fragment is checked against the
registry's scene schema. A fragment naming another game fails with
`unknown-game`; one naming none is judged by `registry`. Never throws.

```ts
declare function parseFragment(input: unknown, registry: Registry, opts?: ParseOptions): ParseFragmentResult;
```

Refers to [`ParseFragmentResult`](#parsefragmentresult), [`ParseOptions`](#parseoptions), [`Registry`](#registry).

## `parseInputScript`

_function_ in `scene/input-script.ts`

Reads an input script, as text or a parsed value, for `registry`'s game:
migrated to the current format, then judged by its schema, its seats by
`players` (the project input map's) over the game's. Issues carry JSON
Pointers into the script as written, and lines when read from text.

```ts
declare function parseInputScript<G = unknown>(input: unknown, registry: Registry, players?: PlayersDef | null): ParseInputScriptResult<G>;
```

Refers to [`ParseInputScriptResult`](#parseinputscriptresult), [`Registry`](#registry).

## `parsePrefab`

_function_ in `scene/prefab.ts`

Parses a prefab file from text or a parsed value. Its entities and bulk
entries go through `parseFragment` (migrations, the registry's schemas,
duplicate entity ids), its instances through the scene's own instance
schema, then the id, the game's contract and the variant header (`base`,
`params`, `assets`, `overrides`) are checked. Which prefabs the instances
and the base name, cycles, depth and whether overrides and param targets
reach a child are `validateScene`'s. Never throws.

```ts
declare function parsePrefab(input: unknown, registry: Registry, opts?: ParseOptions): ParsePrefabResult;
```

Refers to [`ParseOptions`](#parseoptions), [`ParsePrefabResult`](#parseprefabresult), [`Registry`](#registry).

## `parseRecording`

_function_ in `scene/recording-schema.ts`

Parses a recording from JSON text or a parsed value, v1 or v2; a v1 file
is migrated (`migratedFrom: 1`), its time kind and px per metre taken
from `registry` when given. Never throws.

```ts
declare function parseRecording(input: unknown, registry?: RecordingRegistry): ParseRecordingResult;
```

Refers to [`ParseRecordingResult`](#parserecordingresult).

## `parseScene`

_function_ in `scene/parse.ts`

Parses a scene from JSON text or an already-parsed value: migrate, pick
the registry from the scene's `game` (`sceneRegistry`), then that
registry's schema. Never throws; every failure is a `SceneIssue` with a
JSON Pointer `path`, plus `line` when the input was text. Structural
checks (duplicate ids, geometry) are `validateScene`'s. `opts.prefab`
looks up the prefabs instances name, for migrations that need them.

```ts
declare function parseScene(input: unknown, registry: Registry, opts?: ParseOptions): ParseSceneResult;
```

Refers to [`ParseOptions`](#parseoptions), [`ParseSceneResult`](#parsesceneresult), [`Registry`](#registry).

## `parseSceneOrThrow`

_function_ in `scene/parse.ts`

```ts
declare function parseSceneOrThrow(input: unknown, registry: Registry, opts?: ParseOptions): SceneDefinition;
```

Refers to [`ParseOptions`](#parseoptions), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `parseShape`

_function_ in `scene/shapes.ts`

Accepts a tuple, a `ShapeObj`, or `{ type: "rect", left, top, right, bottom }`.

```ts
declare function parseShape(input: unknown, path?: string): ParseShapeResult;
```

Refers to [`ParseShapeResult`](#parseshaperesult).

## `placeChildren`

_function_ in `scene/resolve.ts`

The children of one instance in the world: each in the prefab's frame
with the instance's overrides (nested instances resolved when `library`
is given), then under `steps`, one transform or several applied in turn
(`instanceSteps`), with its resolved ref and its refs to siblings and
nested children rewritten to theirs. `cells` says whether grid fields
turn (`gridTurns`).

```ts
declare function placeChildren(prefab: Prefab, inst: InstanceDef, registry: Registry, steps: Transform2D | readonly Transform2D[], cells: boolean, library?: PrefabLibrary): PlacedChild[];
```

Refers to [`InstanceDef`](#instancedef), [`PlacedChild`](#placedchild), [`Prefab`](#prefab), [`PrefabLibrary`](#prefablibrary), [`Registry`](#registry), [`Transform2D`](#transform2d).

## `placeFragment`

_function_ in `scene/fragment.ts`

The ops that put a fragment into `def`, moved by `by`: ids that clash
with `def`'s entities or instances renamed (`lift` → `lift-2`, `gate-2`
→ `gate-3`), references inside the fragment following the renames (a
child ref `gate-2/door` with its instance), and references out of it
kept when their target exists in `def`, else cleared with a
`dangling-ref` warning. An instance whose prefab isn't in `prefabs`
places nothing and warns `prefab-unknown`. Paste and unpack both place
fragments this way.

```ts
declare function placeFragment(fragment: SceneFragment, def: SceneDefinition, registry: Registry, by: Pt, prefabs?: PrefabLibrary): PlacedFragment;
```

Refers to [`PlacedFragment`](#placedfragment), [`PrefabLibrary`](#prefablibrary), [`Pt`](#pt), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition), [`SceneFragment`](#scenefragment).

## `placeableTypes`

_function_ in `game/define.ts`

The types a scene, prefab or op may place, in registration order: every type but the spawn-only ones.

```ts
declare function placeableTypes(registry: Registry): EntityTypeName[];
```

Refers to [`EntityTypeName`](#entitytypename), [`Registry`](#registry).

## `pointerLines`

_function_ in `scene/parse.ts`

Maps every JSON Pointer in `text` to the 1-based line its value starts on
(for object members, the line of the key). Throws `JsonSyntaxError` with
the offending offset on malformed JSON.

```ts
declare function pointerLines(text: string): Map<string, number>;
```

## `prefabBody`

_function_ in `scene/prefab.ts`

What `definePrefab` carries for a prefab: its body, base, params, assets and overrides, without the file's identity.

```ts
declare function prefabBody(prefab: Prefab): PrefabBody;
```

Refers to [`Prefab`](#prefab), [`PrefabBody`](#prefabbody).

## `prefabJsonSchema`

_function_ in `scene/json-schema.ts`

The JSON Schema of prefab files judged by `registry`, the game's contract included.

```ts
declare function prefabJsonSchema(registry: Registry): Record<string, unknown>;
```

Refers to [`Registry`](#registry).

## `prefabLibrary`

_function_ in `scene/prefab.ts`

A library from a list of prefabs; a later prefab with the same id wins.

```ts
declare function prefabLibrary(prefabs: Iterable<Prefab>): PrefabLibrary;
```

Refers to [`Prefab`](#prefab), [`PrefabLibrary`](#prefablibrary).

## `prefabOf`

_function_ in `scene/prefab.ts`

The prefab file a body becomes for scene `def`: current version, the scene's game.

```ts
declare function prefabOf(id: string, body: PrefabBody, game?: string): Prefab;
```

Refers to [`Prefab`](#prefab), [`PrefabBody`](#prefabbody).

## `prefabScene`

_function_ in `scene/prefab.ts`

A prefab as a scene of its own, for editing it in isolation and for
validating it: its children at their local coordinates, around the origin,
and its `assets` header. Its variant base, overrides and params stay on
the prefab, which the view's header ops change.

```ts
declare function prefabScene(prefab: Prefab, bounds: SceneDefinition["bounds"]): SceneDefinition;
```

Refers to [`Prefab`](#prefab), [`SceneDefinition`](#scenedefinition).

## `prefabSchemaFor`

_function_ in `scene/prefab.ts`

The schema of a prefab file judged by `registry`: a fragment's entities
and bulk entries around a local origin, nested instances of other
prefabs, its id, and the game's contract.

```ts
declare function prefabSchemaFor(registry: Registry): z.ZodObject;
```

Refers to [`Registry`](#registry).

## `prefabsUsedBy`

_function_ in `scene/prefab.ts`

The prefab ids a scene reaches, sorted by code unit, each once: those its
instances name and, with `prefabs`, every one those reach in turn through
their nested instances and variant bases. A prefab missing from `prefabs`
is listed and reaches nothing further; a cycle ends where it closes.

```ts
declare function prefabsUsedBy(def: SceneDefinition, prefabs?: PrefabLibrary): string[];
```

Refers to [`PrefabLibrary`](#prefablibrary), [`SceneDefinition`](#scenedefinition).

## `projectSpriteAssets`

_const_ in `scene/render-geometry.ts`

`assetInfo` over `view`, as a sprite lookup.

```ts
declare const projectSpriteAssets: (view: ProjectView) => SpriteAssetLookup;
```

Refers to [`SpriteAssetLookup`](#spriteassetlookup).

## `pxToMetres`

_function_ in `scene/units.ts`

A v3 px, px/s or px/s² number in metres: roundLength(px / pxPerMetre).

```ts
declare function pxToMetres(px: number, pxPerMetre: number): number;
```

## `raycastShape`

_function_ in `scene/shape-geometry.ts`

The first hit of a ray on a shape: time of impact as a fraction of `maxDist`, and the surface normal.
`dir` needn't be a unit vector; a ray starting inside a solid shape hits at 0 with normal [0, 0].

```ts
declare function raycastShape(s: ShapeObj, from: Pt, dir: Pt, maxDist: number): null | {
    normal: Pt;
    toi: number;
};
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj).

## `readCell`

_function_ in `scene/grid.ts`

```ts
declare function readCell(grid: GridCells, col: number, row: number): number;
```

Refers to [`GridCells`](#gridcells).

## `recordingJsonSchema`

_function_ in `scene/recording-schema.ts`

The draft 2020-12 JSON Schema of recordings.

```ts
declare function recordingJsonSchema(): Record<string, unknown>;
```

## `renderSceneAscii`

_function_ in `scene/ascii.ts`

The scene's character map as text; see `sceneAsciiMap`.

```ts
declare function renderSceneAscii(scene: ExpandedScene | SceneDefinition, opts: SceneAsciiOptions): string;
```

Refers to [`ExpandedScene`](#expandedscene), [`SceneAsciiOptions`](#sceneasciioptions), [`SceneDefinition`](#scenedefinition).

## `renderSceneSvg`

_function_ in `scene/svg.ts`

A schematic of the scene as SVG text, drawn in world px (the scene's
metres times the game's px per metre, written to 1/100 px): every entity
through `shapeOutline` in its registered type's (and material's) style, each
one-way solid's landing face (as the edit overlay marks it), a
grid with axis ticks in world px, id labels, each sprite's box labelled `asset[:frame]` (sized
from `opts.project` when given), path waypoints with numbered ghosts, and overlays
(issues, a playtest's trail, events and outcome). Pure and deterministic:
the same scene and options give the same text.

```ts
declare function renderSceneSvg(scene: ExpandedScene | SceneDefinition, opts: SceneSvgOptions): string;
```

Refers to [`ExpandedScene`](#expandedscene), [`SceneDefinition`](#scenedefinition), [`SceneSvgOptions`](#scenesvgoptions).

## `resolvePrefab`

_function_ in `scene/resolve.ts`

A prefab with its base and nested instances resolved: a variant's base's
children with the variant's overrides, then its own entities and bulk
entries, then each nested instance's children (that prefab resolved, the
instance's params and overrides applied, turned and flipped by its `rot`
and `flip` at its `at`, its `z` added, ids under `<instance>/`, its
`layer` and `off` inherited). At each level an override beats the
prefab's own value, and an outer level beats every inner one. Fails with
`prefab-unknown` for a missing prefab, `variant-base-unknown` for a
missing base, `prefab-cycle` for one that contains itself through
instances or bases, and `prefab-depth` past `PREFAB_MAX_DEPTH` levels (a
base counts as one). Params are the base's, a redeclared name replacing it.
Memoised per library and registry object: a library is a snapshot, and
a new version is a new map. Treat the result as read-only.

```ts
declare function resolvePrefab(id: string, library: PrefabLibrary, registry: Registry, opts?: ResolveOptions): PrefabResolution;
```

Refers to [`PrefabLibrary`](#prefablibrary), [`PrefabResolution`](#prefabresolution), [`Registry`](#registry), [`ResolveOptions`](#resolveoptions).

## `resolveScene`

_function_ in `scene/resolve.ts`

The resolved view of a scene (see `resolveSceneDetailed`). Returns `def` itself when it has no groups or instances.

```ts
declare function resolveScene(def: SceneDefinition, registry: Registry, prefabs?: PrefabLibrary): SceneDefinition;
```

Refers to [`PrefabLibrary`](#prefablibrary), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `resolveSceneDetailed`

_function_ in `scene/resolve.ts`

The resolved view and where each of its entities came from. A document
entity keeps its index, so pointers into `/entities/<i>` stay put; the
instances' children follow, instance by instance. A child's world
transform is its group's, then its instance's, each a turn and flip at
its `at` (`instanceTransform`), and an instance's `z` is added to each
child's. An instance whose prefab is missing contributes nothing
(validation reports it); an `off` instance's children are all `off`.

```ts
declare function resolveSceneDetailed(def: SceneDefinition, registry: Registry, prefabs?: PrefabLibrary): ResolvedScene;
```

Refers to [`PrefabLibrary`](#prefablibrary), [`Registry`](#registry), [`ResolvedScene`](#resolvedscene), [`SceneDefinition`](#scenedefinition).

## `resolveSettings`

_function_ in `scene/expand.ts`

The scene's settings with every engine key filled. `gravity` and
`physics` come from the scene's `settings`, else the project's engine
block, else the game's world, else the engine's default; `grid` from the
scene, else the game's world, else none; `view` from the scene, else
orthogonal (`game/defaults` holds the engine's values). The game's own
keys are the scene's, as given.

```ts
declare function resolveSettings(settings: SceneSettings | undefined, sources?: SettingsSources): ResolvedSettings;
```

Refers to [`ResolvedSettings`](#resolvedsettings), [`SceneSettings`](#scenesettings), [`SettingsSources`](#settingssources).

## `resolveTime`

_function_ in `game/time.ts`

Project `engine.tickRate` (rate only) → `GameDefinition.time` → the engine
default. A project rate that isn't valid is passed over here; validating
the project's settings reports it.

```ts
declare function resolveTime(sources: {
    game?: TimeModel;
    project?: Readonly<Record<string, unknown>>;
}): ResolvedTime;
```

## `rotateShape`

_function_ in `scene/shape-geometry.ts`

`s` turned `deg` degrees clockwise on screen about `about`, its `rotDeg`
kept in [0, 360). Quarter turns are exact; other angles leave fractions
for the caller to round.

```ts
declare function rotateShape(s: ShapeObj, about: Pt, deg: number): ShapeObj;
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj).

## `roundLength`

_function_ in `scene/units.ts`

Micrometres, no -0: the one rounding rule for a metric length written to a file.

```ts
declare function roundLength(m: number): number;
```

## `runRecordingSchema`

_const_ in `scene/recording-schema.ts`

The zod schema `recording.schema.json` is generated from; `parseRecording` checks v2 files with it.

```ts
declare const runRecordingSchema: z.ZodObject<{
    $schema: z.ZodOptional<z.ZodString>;
    actions: z.ZodArray<z.ZodString>;
    commands: z.ZodArray<z.ZodString>;
    configHash: z.ZodString;
    end: z.ZodString;
    engine: z.ZodObject<{
        physics: z.ZodNullable<z.ZodString>;
        version: z.ZodString;
    }, z.core.$strict>;
    fromSave: z.ZodOptional<z.ZodObject<{
        sha256: z.ZodString;
        slot: z.ZodString;
    }, z.core.$strict>>;
    game: z.ZodNullable<z.ZodString>;
    inputs: z.ZodArray<z.ZodArray<z.ZodUnion<readonly [
        z.ZodTuple<[
            z.ZodNumber,
            z.ZodLiteral<"b">,
            z.ZodNumber,
            z.ZodUnion<readonly [
                z.ZodLiteral<0>,
                z.ZodLiteral<1>
            ]>
        ], null>,
        z.ZodTuple<[
            z.ZodNumber,
            z.ZodLiteral<"a">,
            z.ZodNumber,
            z.ZodNumber
        ], null>,
        z.ZodTuple<[
            z.ZodNumber,
            z.ZodLiteral<"v">,
            z.ZodNumber,
            z.ZodNumber,
            z.ZodNumber
        ], null>,
        z.ZodTuple<[
            z.ZodNumber,
            z.ZodLiteral<"p">,
            z.ZodNumber,
            z.ZodNumber,
            z.ZodNumber,
            z.ZodUnion<readonly [
                z.ZodLiteral<0>,
                z.ZodLiteral<1>
            ]>
        ], null>,
        z.ZodTuple<[
            z.ZodNumber,
            z.ZodLiteral<"c">,
            z.ZodNumber,
            z.ZodOptional<z.ZodUnknown>
        ], null>
    ]>>>;
    markers: z.ZodArray<z.ZodObject<{
        at: z.ZodTuple<[
            z.ZodNumber,
            z.ZodNumber
        ], null>;
        entityId: z.ZodOptional<z.ZodString>;
        other: z.ZodOptional<z.ZodString>;
        tick: z.ZodNumber;
        type: z.ZodString;
    }, z.core.$strict>>;
    next: z.ZodOptional<z.ZodObject<{
        entry: z.ZodOptional<z.ZodString>;
        scene: z.ZodString;
    }, z.core.$strict>>;
    outcome: z.ZodObject<{
        at: z.ZodNullable<z.ZodTuple<[
            z.ZodNumber,
            z.ZodNumber
        ], null>>;
        cause: z.ZodOptional<z.ZodString>;
        entityId: z.ZodOptional<z.ZodString>;
        result: z.ZodString;
        tick: z.ZodNumber;
    }, z.core.$strict>;
    platform: z.ZodObject<{
        arch: z.ZodString;
        flavour: z.ZodNullable<z.ZodString>;
        runtime: z.ZodString;
    }, z.core.$strict>;
    players: z.ZodArray<z.ZodObject<{
        devices: z.ZodArray<z.ZodUnion<readonly [
            z.ZodEnum<{
                keyboard: "keyboard";
                pointer: "pointer";
                touch: "touch";
            }>,
            z.ZodTemplateLiteral<`pad:${number}`>
        ]>>;
        index: z.ZodNumber;
    }, z.core.$strict>>;
    project: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        snapshot: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    release: z.ZodOptional<z.ZodString>;
    runHash: z.ZodString;
    scene: z.ZodString;
    sceneHash: z.ZodString;
    seed: z.ZodUnion<readonly [
        z.ZodNumber,
        z.ZodString
    ]>;
    start: z.ZodObject<{
        at: z.ZodOptional<z.ZodTuple<[
            z.ZodNumber,
            z.ZodNumber
        ], null>>;
        entry: z.ZodOptional<z.ZodString>;
        game: z.ZodOptional<z.ZodUnknown>;
        persist: z.ZodOptional<z.ZodJSONSchema>;
        timeOffsetMs: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
    system: z.ZodArray<z.ZodUnion<readonly [
        z.ZodTuple<[
            z.ZodNumber,
            z.ZodLiteral<"w">,
            z.ZodNumber
        ], null>,
        z.ZodTuple<[
            z.ZodNumber,
            z.ZodLiteral<"j">,
            z.ZodNumber,
            z.ZodUnion<readonly [
                z.ZodEnum<{
                    keyboard: "keyboard";
                    pointer: "pointer";
                    touch: "touch";
                }>,
                z.ZodTemplateLiteral<`pad:${number}`>
            ]>
        ], null>,
        z.ZodTuple<[
            z.ZodNumber,
            z.ZodLiteral<"l">,
            z.ZodNumber,
            z.ZodUnion<readonly [
                z.ZodEnum<{
                    keyboard: "keyboard";
                    pointer: "pointer";
                    touch: "touch";
                }>,
                z.ZodTemplateLiteral<`pad:${number}`>
            ]>
        ], null>
    ]>>;
    ticks: z.ZodNumber;
    time: z.ZodObject<{
        kind: z.ZodEnum<{
            event: "event";
            fixed: "fixed";
            turns: "turns";
        }>;
        rate: z.ZodNumber;
    }, z.core.$strict>;
    trail: z.ZodOptional<z.ZodObject<{
        every: z.ZodLiteral<4>;
        pts: z.ZodArray<z.ZodTuple<[
            z.ZodNumber,
            z.ZodNumber
        ], null>>;
        truncated: z.ZodBoolean;
    }, z.core.$strict>>;
    v: z.ZodLiteral<2>;
}, z.core.$strict>;
```

## `runRecordingV1Schema`

_const_ in `scene/recording-schema.ts`

Format v1 (key edges only), kept to read and migrate v1 files; nothing writes it.

```ts
declare const runRecordingV1Schema: z.ZodObject<{
    $schema: z.ZodOptional<z.ZodString>;
    actions: z.ZodArray<z.ZodString>;
    commands: z.ZodOptional<z.ZodArray<z.ZodTuple<[
        z.ZodNumber,
        z.ZodString,
        z.ZodOptional<z.ZodUnknown>
    ], null>>>;
    configHash: z.ZodString;
    end: z.ZodString;
    engine: z.ZodObject<{
        physics: z.ZodString;
        version: z.ZodString;
    }, z.core.$strict>;
    game: z.ZodNullable<z.ZodString>;
    inputs: z.ZodArray<z.ZodTuple<[
        z.ZodNumber,
        z.ZodNumber,
        z.ZodUnion<readonly [
            z.ZodLiteral<0>,
            z.ZodLiteral<1>
        ]>
    ], null>>;
    markers: z.ZodArray<z.ZodObject<{
        at: z.ZodTuple<[
            z.ZodNumber,
            z.ZodNumber
        ], null>;
        entityId: z.ZodOptional<z.ZodString>;
        other: z.ZodOptional<z.ZodString>;
        tick: z.ZodNumber;
        type: z.ZodString;
    }, z.core.$strict>>;
    outcome: z.ZodObject<{
        at: z.ZodNullable<z.ZodTuple<[
            z.ZodNumber,
            z.ZodNumber
        ], null>>;
        cause: z.ZodOptional<z.ZodString>;
        entityId: z.ZodOptional<z.ZodString>;
        result: z.ZodString;
        tick: z.ZodNumber;
    }, z.core.$strict>;
    scene: z.ZodString;
    sceneHash: z.ZodString;
    start: z.ZodObject<{
        at: z.ZodOptional<z.ZodTuple<[
            z.ZodNumber,
            z.ZodNumber
        ], null>>;
        game: z.ZodOptional<z.ZodUnknown>;
        seed: z.ZodOptional<z.ZodUnion<readonly [
            z.ZodNumber,
            z.ZodString
        ]>>;
        timeOffsetMs: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
    tickRate: z.ZodNumber;
    ticks: z.ZodNumber;
    trail: z.ZodOptional<z.ZodObject<{
        every: z.ZodLiteral<4>;
        pts: z.ZodArray<z.ZodTuple<[
            z.ZodNumber,
            z.ZodNumber
        ], null>>;
        truncated: z.ZodBoolean;
    }, z.core.$strict>>;
    v: z.ZodLiteral<1>;
}, z.core.$strict>;
```

## `sceneAsciiMap`

_function_ in `scene/ascii.ts`

The scene as a character map, one character per `cell` world px (the
scene's metres times the game's px per metre): each
entity in its type's character (`EntityTypeDef.ascii`, else its base
primitive's), `=` for one-way solids, tag characters for tagged ones,
`~` along paths, each sprite's box in its entity's character under
everything else, grid fields' filled cells in their entity's character
(at most `SCENE_GRID_MAX_CELLS`, then `…`). Pure; region and `around` work as in `renderSceneSvg`.

```ts
declare function sceneAsciiMap(scene: ExpandedScene | SceneDefinition, opts: SceneAsciiOptions): SceneAsciiMap;
```

Refers to [`ExpandedScene`](#expandedscene), [`SceneAsciiMap`](#sceneasciimap), [`SceneAsciiOptions`](#sceneasciioptions), [`SceneDefinition`](#scenedefinition).

## `sceneBody`

_function_ in `scene/prefab.ts`

A scene's entities, bulk arrays, instances and `assets` as a prefab body, the other way from `prefabScene`.

```ts
declare function sceneBody(def: SceneDefinition, registry: Registry, contract?: unknown): PrefabBody;
```

Refers to [`PrefabBody`](#prefabbody), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `sceneGameOf`

_function_ in `scene/schema.ts`

The scene's `game` key, read without validating anything, so a tool can pick the registry.

```ts
declare function sceneGameOf(raw: unknown): string | undefined;
```

## `sceneHash`

_function_ in `scene/hash.ts`

`hashText` of the canonical text.

```ts
declare function sceneHash(def: SceneDefinition): SceneHash;
```

Refers to [`SceneDefinition`](#scenedefinition), [`SceneHash`](#scenehash).

## `sceneHashWith`

_function_ in `scene/prefab.ts`

The scene's hash with every prefab it reaches (`prefabsUsedBy`): what a
recording or a cache keys on, so editing a prefab, nested ones included,
marks it stale. A scene with no instances hashes as `sceneHash` does.

```ts
declare function sceneHashWith(def: SceneDefinition, prefabs?: PrefabLibrary): SceneHash;
```

Refers to [`PrefabLibrary`](#prefablibrary), [`SceneDefinition`](#scenedefinition), [`SceneHash`](#scenehash).

## `sceneJsonSchema`

_function_ in `scene/json-schema.ts`

The JSON Schema of scenes judged by `registry`, with `$id` `registry.schemaId` and the agent surface version.

```ts
declare function sceneJsonSchema(registry: Registry): Record<string, unknown>;
```

Refers to [`Registry`](#registry).

## `sceneOpSchemaFor`

_function_ in `scene/ops-schema.ts`

One op, with entity types and bulk keys from `registry`.

```ts
declare function sceneOpSchemaFor(registry: Registry): OpSchemas["op"];
```

Refers to [`Registry`](#registry).

## `scenePhysics`

_function_ in `scene/expand.ts`

The physics backend `def` resolves to, so a host can load Rapier only when it says "rapier".

```ts
declare function scenePhysics(def: SceneDefinition, registry: Registry, engine?: Readonly<Record<string, unknown>>): "none" | "rapier";
```

Refers to [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `sceneRegistry`

_function_ in `scene/schema.ts`

The registry a scene naming `game` is judged by: `registry` when it is
that game's, the engine's alone when the scene names no game (so a
gameless scene means the same to every tool), `null` for any other game.

```ts
declare function sceneRegistry(game: string | undefined, registry: Registry): Registry | null;
```

Refers to [`Registry`](#registry).

## `sceneSchemaFor`

_function_ in `scene/schema.ts`

The schema of a scene judged by `registry`: header keys, one optional
array per bulk key, and `entities` discriminated by `type` over the
placeable types (spawn-only types are left out), in canonical key order. A game's schema requires `"game": "<id>"`; the engine's has no
`game` key.

```ts
declare function sceneSchemaFor(registry: Registry): z.ZodObject;
```

Refers to [`Registry`](#registry).

## `sceneSprites`

_function_ in `scene/render-geometry.ts`

Every sprite the scene draws, in spawn order: each entity carrying a
`sprite` block (its type's defaults included), its world box sized from
`opts.project` when given.

```ts
declare function sceneSprites(scene: ExpandedScene | SceneDefinition, opts: Pick<SceneRegionOptions, "prefabs" | "project"> & {
    registry: Registry;
}): SceneSprite[];
```

Refers to [`ExpandedScene`](#expandedscene), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition), [`SceneRegionOptions`](#sceneregionoptions), [`SceneSprite`](#scenesprite).

## `sceneViewport`

_function_ in `scene/svg.ts`

Where `renderSceneSvg` looks and how big its image is, without drawing it.

```ts
declare function sceneViewport(scene: ExpandedScene | SceneDefinition, opts: SceneSvgOptions): SceneViewport;
```

Refers to [`ExpandedScene`](#expandedscene), [`SceneDefinition`](#scenedefinition), [`SceneSvgOptions`](#scenesvgoptions), [`SceneViewport`](#sceneviewport).

## `schemaIdFor`

_function_ in `scene/json-schema.ts`

`urn:jams-engine:<name>:v<version>`, or `urn:jams-engine:<name>:<game>:v<version>` for a game's registry.

```ts
declare function schemaIdFor(registry: Registry, name: string, version: number): string;
```

Refers to [`Registry`](#registry).

## `scriptSeatLimit`

_function_ in `scene/input-script.ts`

The seats a run has, and so the seats a script drives unless it sets
`players`: the project input map's `players` when it has them, else the
game's `input.players`, else one. The one rule every script reader
(schema, compiler, playtest, checks, the CLI) and the runtime agree on.

```ts
declare function scriptSeatLimit(registry: Registry, players?: PlayersDef | null): number;
```

Refers to [`Registry`](#registry).

## `scriptShapeIssues`

_function_ in `scene/input-script.ts`

A script's step lists and seats: one of `steps` or `tracks`; seats within
the script's `players`, else `scriptSeatLimit` of the map's `players` and
the game; one track per seat.

```ts
declare function scriptShapeIssues(script: {
    players?: unknown;
    steps?: unknown;
    tracks?: unknown;
}, registry: Registry, players?: PlayersDef | null): ScriptIssue[];
```

Refers to [`Registry`](#registry).

## `shapeAtPose`

_function_ in `scene/shape-geometry.ts`

`local` moved to a pose: translated by (x, y) and turned by `rot` radians about it.

```ts
declare function shapeAtPose(local: ShapeObj, pose: {
    rot: number;
    x: number;
    y: number;
}): ShapeObj;
```

Refers to [`ShapeObj`](#shapeobj).

## `shapeIsClosed`

_function_ in `scene/shape-outline.ts`

False only for a chain, which has no inside to fill.

```ts
declare function shapeIsClosed(shape: ShapeObj): boolean;
```

Refers to [`ShapeObj`](#shapeobj).

## `shapeOutline`

_function_ in `scene/shape-outline.ts`

The shape's outline as path commands, rotation applied. Every path starts
with a `moveTo`, so outlines replayed one after another never join.

```ts
declare function shapeOutline(shape: ShapeObj): PathCommand[];
```

Refers to [`PathCommand`](#pathcommand), [`ShapeObj`](#shapeobj).

## `shapeToTuple`

_function_ in `scene/shapes.ts`

Canonical tuple; `rotDeg` is dropped when 0.

```ts
declare function shapeToTuple(s: ShapeObj): ShapeTuple;
```

Refers to [`ShapeObj`](#shapeobj), [`ShapeTuple`](#shapetuple).

## `shapeVertices`

_function_ in `scene/shape-geometry.ts`

The corners a shape has: a box's four, a poly's or chain's points; none for circles and capsules.

```ts
declare function shapeVertices(s: ShapeObj): Pt[];
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj).

## `shapesIntersect`

_function_ in `scene/shape-geometry.ts`

Exact overlap test (SAT for box, poly, capsule, circle; chains as segments); touching counts.

```ts
declare function shapesIntersect(a: ShapeObj, b: ShapeObj): boolean;
```

Refers to [`ShapeObj`](#shapeobj).

## `snapToPixel`

_function_ in `scene/units.ts`

The nearest whole world px at `pxPerMetre`, in metres (roundLength applied).

```ts
declare function snapToPixel(m: number, pxPerMetre: number): number;
```

## `spawnSchemaFor`

_function_ in `scene/schema.ts`

What `ctx.spawn` takes for `type`: the entity as a scene file writes it,
without its scene id (a runtime id is checked by the runtime, not here).
Placeable and spawn-only types alike; `undefined` for a type that is
unregistered or never loads.

```ts
declare function spawnSchemaFor(registry: Registry, type: EntityTypeName): undefined | z.ZodObject;
```

Refers to [`EntityTypeName`](#entitytypename), [`Registry`](#registry).

## `splitChildRef`

_function_ in `scene/field-path.ts`

A child ref's segments: the ids of the nested instances it passes
through, then the child itself, an id or (last only) a bulk ref.
`door-1/latch/~solid:0` is `["door-1", "latch", "~solid:0"]`; null when it
isn't a child ref.

```ts
declare function splitChildRef(ref: Ref): null | string[];
```

Refers to [`Ref`](#ref).

## `splitFieldPath`

_function_ in `scene/field-path.ts`

The path's segments, or null when it isn't in the grammar.

```ts
declare function splitFieldPath(path: FieldPath): null | string[];
```

Refers to [`FieldPath`](#fieldpath).

## `splitOverridePath`

_function_ in `scene/field-path.ts`

Splits an override key at its first `.` into the child it names (a
`ChildRef`, nested children by `/`) and the field path in it; null when
either half isn't in the grammar.

```ts
declare function splitOverridePath(path: OverridePath): null | {
    child: Ref;
    field: string;
};
```

Refers to [`OverridePath`](#overridepath), [`Ref`](#ref).

## `spriteBoxOf`

_function_ in `scene/render-geometry.ts`

Where a `sprite` block draws for an entity posed by `src`, in metres, as
the sprite system places it: `spriteGeometry` of the block (its flip
toggled by the entity's) and its asset's info from `assets`, its asset's
px over `pxPerMetre`, at the pose plus the offset. The offset mirrors
with the entity's flip and turns with the pose, or with `turn: false`
with the quarter turns only. Undefined for a value that isn't a block or
an entity with no pose.

```ts
declare function spriteBoxOf(block: unknown, src: SpritePoseSource, assets?: SpriteAssetLookup, pxPerMetre?: number): DrawnSprite | undefined;
```

Refers to [`DrawnSprite`](#drawnsprite), [`SpriteAssetLookup`](#spriteassetlookup), [`SpritePoseSource`](#spriteposesource).

## `sublevelIssue`

_function_ in `scene/validate.ts`

Why the listed scene `opts.scene`, resolved to `sub`, can't attach beside
the main scene `main` as `opts.label` at `opts.at`, or null when it can.
Every refusal is `sublevel-invalid` with `detail.reason`: "unlisted" (by
`flowIssue`), "label" (malformed or taken), "physics", "grid" (shape,
cell size, or `at` off the main scene's cells, judged in whole px) or
"settings" (gravity). The one rule the runtime's attach and validation
both judge by.

```ts
declare function sublevelIssue(main: SublevelSettings, sub: SublevelSettings, opts: SublevelJudgeOptions): SceneIssue | null;
```

Refers to [`SceneIssue`](#sceneissue), [`SublevelJudgeOptions`](#subleveljudgeoptions), [`SublevelSettings`](#sublevelsettings).

## `suggestType`

_function_ in `scene/parse.ts`

The placeable type nearest to `word`, for "did you mean"; never a spawn-only type.

```ts
declare function suggestType(word: string, registry: Registry): EntityTypeName | undefined;
```

Refers to [`EntityTypeName`](#entitytypename), [`Registry`](#registry).

## `takenIds`

_function_ in `scene/fragment.ts`

Every id a scene's entities and instances hold; a new one must avoid them all.

```ts
declare function takenIds(def: SceneDefinition): Set<string>;
```

Refers to [`SceneDefinition`](#scenedefinition).

## `toSourceBatch`

_function_ in `scene/ops.ts`

Maps a batch written against the resolved view (`resolveScene`: world
coordinates, instance children as `gate-3/door`) onto the document, as
`mapResolvedBatch` describes: a child's edit becomes overrides, a group
member's geometry loses the group's origin. The editor sends every batch
through it; an agent working on the file writes document ops directly.

```ts
declare function toSourceBatch(def: SceneDefinition, batch: OpBatch, given: Registry, prefabs?: PrefabLibrary): SourceBatchResult;
```

Refers to [`OpBatch`](#opbatch), [`PrefabLibrary`](#prefablibrary), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `topSpan`

_function_ in `scene/shape-geometry.ts`

The standable top of a shape as `[x0, x1, y]`, from its bounding box.

```ts
declare function topSpan(s: ShapeObj): [
    x0: number,
    x1: number,
    y: number
];
```

Refers to [`ShapeObj`](#shapeobj).

## `transformGrid`

_function_ in `scene/grid.ts`

Cells turned and flipped about cell (0, 0)'s top-left corner; square cells only.

```ts
declare function transformGrid(grid: GridCells, d: Dihedral): GridCells;
```

Refers to [`Dihedral`](#dihedral), [`GridCells`](#gridcells).

## `translateShape`

_function_ in `scene/shape-geometry.ts`

```ts
declare function translateShape(s: ShapeObj, [dx, dy]: Pt): ShapeObj;
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj).

## `translation`

_const_ in `scene/transform.ts`

A pure translation by `[dx, dy]`.

```ts
declare const translation: ([dx, dy]: Pt) => Transform2D;
```

Refers to [`Transform2D`](#transform2d).

## `turnOf`

_const_ in `scene/transform.ts`

The dihedral element an instance's or group's `rot` and `flip` spell.

```ts
declare const turnOf: (d: {
    flip?: boolean;
    rot?: number;
}) => Dihedral;
```

Refers to [`Dihedral`](#dihedral).

## `undescribedProperties`

_function_ in `scene/json-schema.ts`

JSON Pointers of every object property and tuple item in a JSON Schema
that has no `description`, so a test can keep a schema readable as
documentation. A `const` tuple item (a shape's tag) needs none; a `$ref`
counts as described when its target is.

```ts
declare function undescribedProperties(schema: Record<string, unknown>): string[];
```

## `unknownGameIssue`

_function_ in `scene/schema.ts`

```ts
declare function unknownGameIssue(game: string, registry: Registry): SceneIssue;
```

Refers to [`Registry`](#registry), [`SceneIssue`](#sceneissue).

## `untitledEntityFields`

_function_ in `scene/json-schema.ts`

Entity fields in a scene JSON Schema without a `title`, as
`<type>.<field>`: the inspector labels fields by it. A `$ref` counts as
titled when its target is.

```ts
declare function untitledEntityFields(schema: Record<string, unknown>): string[];
```

## `validateScene`

_function_ in `scene/validate.ts`

Structural checks over a parsed scene, judged by the registry its `game`
picks (`sceneRegistry`). On the document itself: ids (entities and
instances share them), layers, `settings.grid`, the `assets` header,
groups, instances (their prefabs resolved through nesting and variant
bases by `resolvePrefab`, every variant's base known and sharing no
child id with it), their params (each one the prefab exposes) and
overrides (never of a grid field), a prefab view's params (each target
naming a child), and grids
under a turned or flipped instance or group (square cells only). On its resolved view
(`resolveScene`, so instance children and group members are checked
where they land): spawn-only types, which game code alone may make
(`unknown-type`), references (each type's `refs`; a child ref
`<instance>/<child>` is `ref-child-unknown` when the instance's prefab
lacks the child), behavior blocks
(registered, allowed by the type, their `requires` carried, their fields
valid), grid fields (only with a grid: the scene's, else the game's world's), asset ids and sprite
frames when `opts.project` is given, and the
geometry of every registered shape, point and path field (polys, chains,
paths, whole world pixels, bounds), then the game's `registry.validators`. No
physics. Each issue names the entity (bulk entries by their `~key:index`
reference, instance children as `<instance>/<child>`, pointing at the
instance) and carries a `fix` batch when one is mechanical; fixes are
written against the document, and those that use a `~` reference carry
`base`. Errors come first, then warnings, then info; within a severity,
engine and game issues merge in document order of their `path`
(`comparePointers`).

```ts
declare function validateScene(source: SceneDefinition, registry: Registry, opts?: ValidateOptions): SceneIssue[];
```

Refers to [`Registry`](#registry), [`SceneDefinition`](#scenedefinition), [`SceneIssue`](#sceneissue), [`ValidateOptions`](#validateoptions).

## `worldPointSchema`

_function_ in `scene/input-script.ts`

A point in world metres, `[x, y]`, y down.

```ts
declare function worldPointSchema(): z.ZodTuple<[
    z.ZodNumber,
    z.ZodNumber
], null>;
```
