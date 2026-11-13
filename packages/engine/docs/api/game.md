# @jams/engine/game

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`ACTION_KINDS`](#action_kinds) · [`ActionDef`](#actiondef) · [`ActionKind`](#actionkind) · [`AssetIdSchema`](#assetidschema) · [`AssetKindDef`](#assetkinddef) · [`Attachment`](#attachment) · [`AttachmentHub`](#attachmenthub) · [`BASE_FIELDS`](#base_fields) · [`BEHAVIOR_NAME_PATTERN`](#behavior_name_pattern) · [`BODY`](#body) · [`BODY_KINDS`](#body_kinds) · [`BODY_SHAPE_TYPES`](#body_shape_types) · [`BasePrimitive`](#baseprimitive) · [`BehaviorBlock`](#behaviorblock) · [`BehaviorDef`](#behaviordef) · [`BehaviorName`](#behaviorname) · [`BehaviorRules`](#behaviorrules) · [`BehaviorSystem`](#behaviorsystem) · [`BehaviorSystemFactory`](#behaviorsystemfactory) · [`Binding`](#binding) · [`BindingContext`](#bindingcontext) · [`BindingProblem`](#bindingproblem) · [`BodyBlock`](#bodyblock) · [`BodyControl`](#bodycontrol) · [`BodyEntry`](#bodyentry) · [`BodyKind`](#bodykind) · [`BodyStandIn`](#bodystandin) · [`BulkKeyInfo`](#bulkkeyinfo) · [`CAMERA_TARGET`](#camera_target) · [`CHARACTER_JUMPED`](#character_jumped) · [`CHARACTER_LANDED`](#character_landed) · [`CHARACTER_LEFT_GROUND`](#character_left_ground) · [`CHARACTER_SIDE_VIEW`](#character_side_view) · [`CHARACTER_TOP_DOWN`](#character_top_down) · [`CHILD_REF_PATTERN`](#child_ref_pattern) · [`COLLIDER`](#collider) · [`COMMAND_NAME_PATTERN`](#command_name_pattern) · [`CONTACT_END`](#contact_end) · [`CONTACT_START`](#contact_start) · [`CameraTargetBlock`](#cameratargetblock) · [`CastResult`](#castresult) · [`Cell`](#cell) · [`CellBounds`](#cellbounds) · [`CellKey`](#cellkey) · [`CharacterControllerOptions`](#charactercontrolleroptions) · [`CharacterIntent`](#characterintent) · [`CharacterSideViewBlock`](#charactersideviewblock) · [`CharacterSystem`](#charactersystem) · [`CharacterTopDownBlock`](#charactertopdownblock) · [`CheckEnv`](#checkenv) · [`CheckKindDef`](#checkkinddef) · [`CheckVerdict`](#checkverdict) · [`ColliderBlock`](#colliderblock) · [`ColliderSystem`](#collidersystem) · [`ColliderTag`](#collidertag) · [`ColliderTags`](#collidertags) · [`CommandDef`](#commanddef) · [`ContactSelector`](#contactselector) · [`Contacts`](#contacts) · [`CoroutineYield`](#coroutineyield) · [`CreateRegistryOptions`](#createregistryoptions) · [`DEFAULT_ACTIONS`](#default_actions) · [`DEFAULT_GRAVITY`](#default_gravity) · [`DEFAULT_LAYERS`](#default_layers) · [`DEFAULT_LENGTH_UNIT`](#default_length_unit) · [`DEFAULT_PHYSICS`](#default_physics) · [`DEFAULT_ROTATE_STEP`](#default_rotate_step) · [`DEFAULT_SAVE_LIMITS`](#default_save_limits) · [`DEFAULT_SPAWN_CAST`](#default_spawn_cast) · [`DEFAULT_TICK_RATE`](#default_tick_rate) · [`DEFAULT_TIME`](#default_time) · [`DRAW_LAYERS`](#draw_layers) · [`DataSystem`](#datasystem) · [`DecorEntity`](#decorentity) · [`Delay`](#delay) · [`DeviceId`](#deviceid) · [`DrawLayer`](#drawlayer) · [`ENGINE_CHECK_KINDS`](#engine_check_kinds) · [`ENGINE_COLLISION_GROUPS`](#engine_collision_groups) · [`ENGINE_COMMANDS`](#engine_commands) · [`ENGINE_PREDICATES`](#engine_predicates) · [`ENGINE_REGISTRY_ID`](#engine_registry_id) · [`ENGINE_RUN_RESULTS`](#engine_run_results) · [`ENGINE_TOOL_IDS`](#engine_tool_ids) · [`ENTITY_DESTROYED`](#entity_destroyed) · [`ENTITY_DISABLED`](#entity_disabled) · [`ENTITY_ENABLED`](#entity_enabled) · [`ENTITY_SPAWNED`](#entity_spawned) · [`EditorToolDef`](#editortooldef) · [`EngineCheckKind`](#enginecheckkind) · [`EngineCollisionGroup`](#enginecollisiongroup) · [`EngineContext`](#enginecontext) · [`EngineError`](#engineerror) · [`EngineRunResult`](#enginerunresult) · [`EngineToolId`](#enginetoolid) · [`EntityOf`](#entityof) · [`EntityQuery`](#entityquery) · [`EntitySelector`](#entityselector) · [`EntityTypeDef`](#entitytypedef) · [`EventBus`](#eventbus) · [`EventSubscribeOptions`](#eventsubscribeoptions) · [`FORCE_AREA`](#force_area) · [`FieldEnv`](#fieldenv) · [`FlowContext`](#flowcontext) · [`FlowField`](#flowfield) · [`FlowRequest`](#flowrequest) · [`FlowUse`](#flowuse) · [`FollowerOptions`](#followeroptions) · [`FollowerSystem`](#followersystem) · [`ForceAreaBlock`](#forceareablock) · [`ForceAreaSystem`](#forceareasystem) · [`FrameRect`](#framerect) · [`GRID_STEP_SAVE_OWNER`](#grid_step_save_owner) · [`GameAttachment`](#gameattachment) · [`GameCommand`](#gamecommand) · [`GameDefinition`](#gamedefinition) · [`GameEditorDef`](#gameeditordef) · [`GameInputDef`](#gameinputdef) · [`GameKeyBinding`](#gamekeybinding) · [`GameOutcome`](#gameoutcome) · [`GamePersistDef`](#gamepersistdef) · [`GamePlayDef`](#gameplaydef) · [`GameRuntime`](#gameruntime) · [`GameSavesDef`](#gamesavesdef) · [`GameShell`](#gameshell) · [`GameTableDef`](#gametabledef) · [`GameWorldDef`](#gameworlddef) · [`GeometryColliderDesc`](#geometrycolliderdesc) · [`GeometryWorld`](#geometryworld) · [`GridFieldInfo`](#gridfieldinfo) · [`GridGeometry`](#gridgeometry) · [`GridPath`](#gridpath) · [`GridPathOptions`](#gridpathoptions) · [`GridPlace`](#gridplace) · [`GridSettings`](#gridsettings) · [`GridStepper`](#gridstepper) · [`ID_PATTERN`](#id_pattern) · [`InputState`](#inputstate) · [`InspectorWidgetDef`](#inspectorwidgetdef) · [`InstantiateOptions`](#instantiateoptions) · [`InstantiateResult`](#instantiateresult) · [`IssueCodeDef`](#issuecodedef) · [`JOINT`](#joint) · [`JOINT_KINDS`](#joint_kinds) · [`JointBlock`](#jointblock) · [`JointKind`](#jointkind) · [`JointSystem`](#jointsystem) · [`JsonValue`](#jsonvalue) · [`KEY_CODES`](#key_codes) · [`KEY_TO_CODE`](#key_to_code) · [`KinematicMotion`](#kinematicmotion) · [`LIFETIME`](#lifetime) · [`LIVE_DEFAULTS`](#live_defaults) · [`LibraryScene`](#libraryscene) · [`LifetimeBlock`](#lifetimeblock) · [`LiveContext`](#livecontext) · [`LiveDeclaration`](#livedeclaration) · [`LoadFailureReason`](#loadfailurereason) · [`MAX_BROWSER_SAVE_LIMITS`](#max_browser_save_limits) · [`MAX_TICK_RATE`](#max_tick_rate) · [`MIN_TICK_RATE`](#min_tick_rate) · [`MOTION_SAVE_OWNER`](#motion_save_owner) · [`Macro`](#macro) · [`MacroRandom`](#macrorandom) · [`MarkerEntity`](#markerentity) · [`MarkerSystem`](#markersystem) · [`MaterialDef`](#materialdef) · [`MotionBody`](#motionbody) · [`MotionBodyOptions`](#motionbodyoptions) · [`MotionResult`](#motionresult) · [`NAV_AGENT`](#nav_agent) · [`NAV_ARRIVED`](#nav_arrived) · [`NAV_BLOCKED`](#nav_blocked) · [`NAV_COMMAND`](#nav_command) · [`NavAgentBlock`](#navagentblock) · [`NavAgentSystem`](#navagentsystem) · [`NavDestination`](#navdestination) · [`NavEntity`](#naventity) · [`NavIssue`](#navissue) · [`NavMesh`](#navmesh) · [`NavPolygon`](#navpolygon) · [`NavSystem`](#navsystem) · [`OCCUPANT`](#occupant) · [`Occupancy`](#occupancy) · [`OccupantBlock`](#occupantblock) · [`OverlapTracker`](#overlaptracker) · [`Overlaps`](#overlaps) · [`PAD_AXES`](#pad_axes) · [`PAD_BUTTONS`](#pad_buttons) · [`PATH_FOLLOW`](#path_follow) · [`PLAYER_INPUT`](#player_input) · [`PLAYER_JOINED`](#player_joined) · [`PLAYER_LEFT`](#player_left) · [`POINTER_BUTTONS`](#pointer_buttons) · [`PRIMITIVE_TYPES`](#primitive_types) · [`PadAxis`](#padaxis) · [`PadButton`](#padbutton) · [`ParseSaveResult`](#parsesaveresult) · [`ParseShapeResult`](#parseshaperesult) · [`PathFollowBlock`](#pathfollowblock) · [`PathFollowSystem`](#pathfollowsystem) · [`PathPlace`](#pathplace) · [`PathSchema`](#pathschema) · [`PersistContext`](#persistcontext) · [`PhysicalCheck`](#physicalcheck) · [`PhysicalEnv`](#physicalenv) · [`PhysicalHit`](#physicalhit) · [`PhysicsRequiredError`](#physicsrequirederror) · [`PhysicsWorld`](#physicsworld) · [`PlacementCheck`](#placementcheck) · [`PlacementDraw`](#placementdraw) · [`PlacementGhost`](#placementghost) · [`PlacementTool`](#placementtool) · [`PlacementToolOptions`](#placementtooloptions) · [`PlayStart`](#playstart) · [`PlayState`](#playstate) · [`PlayWorld`](#playworld) · [`PlayerInfo`](#playerinfo) · [`PlayerInputBlock`](#playerinputblock) · [`PlayerInputSystem`](#playerinputsystem) · [`PlayersDef`](#playersdef) · [`PointerButton`](#pointerbutton) · [`PointerKind`](#pointerkind) · [`PointerState`](#pointerstate) · [`Pool`](#pool) · [`Pose`](#pose) · [`PoseIndex`](#poseindex) · [`PrimitiveType`](#primitivetype) · [`ProjectMaterialDef`](#projectmaterialdef) · [`ProjectRuntimeView`](#projectruntimeview) · [`PtSchema`](#ptschema) · [`RUNTIME_ID_PATTERN`](#runtime_id_pattern) · [`RegisteredBehavior`](#registeredbehavior) · [`RegisteredType`](#registeredtype) · [`Registry`](#registry) · [`RegistryError`](#registryerror) · [`ResolvedTime`](#resolvedtime) · [`RunResult`](#runresult) · [`RuntimeGrid`](#runtimegrid) · [`RuntimeNav`](#runtimenav) · [`SAVE_RANDOM_KEY`](#save_random_key) · [`SAVE_SCHEMA_ID`](#save_schema_id) · [`SAVE_VERSION`](#save_version) · [`SENSOR_ENTER`](#sensor_enter) · [`SENSOR_EXIT`](#sensor_exit) · [`SIDES`](#sides) · [`SIDE_VIEW_CONTROLLER`](#side_view_controller) · [`SLOT_MAX_LENGTH`](#slot_max_length) · [`SLOT_PATTERN`](#slot_pattern) · [`SPAWNER`](#spawner) · [`SPAWNER_SPAWNED`](#spawner_spawned) · [`SPRITE`](#sprite) · [`SPRITE_FALLBACK_SIZE`](#sprite_fallback_size) · [`SUBLEVEL_ID_PATTERN`](#sublevel_id_pattern) · [`SaveDepth`](#savedepth) · [`SaveFile`](#savefile) · [`SaveGameData`](#savegamedata) · [`SaveLimits`](#savelimits) · [`SaveLimitsStore`](#savelimitsstore) · [`SaveMeta`](#savemeta) · [`SaveRequest`](#saverequest) · [`SavedSystems`](#savedsystems) · [`SavedTimer`](#savedtimer) · [`SavesContext`](#savescontext) · [`SceneDiff`](#scenediff) · [`SceneLayerDef`](#scenelayerdef) · [`SceneLibrary`](#scenelibrary) · [`SceneListEntry`](#scenelistentry) · [`SceneRuntimeHandle`](#sceneruntimehandle) · [`SceneSwap`](#sceneswap) · [`SceneSystem`](#scenesystem) · [`SceneTemplate`](#scenetemplate) · [`SceneValidator`](#scenevalidator) · [`SceneView`](#sceneview) · [`ScriptPredicate`](#scriptpredicate) · [`SeatInput`](#seatinput) · [`SensorSystem`](#sensorsystem) · [`Side`](#side) · [`SideViewController`](#sideviewcontroller) · [`SideViewEnv`](#sideviewenv) · [`SideViewIntent`](#sideviewintent) · [`SideViewOptions`](#sideviewoptions) · [`SideViewResult`](#sideviewresult) · [`SolidOptions`](#solidoptions) · [`SolidSystem`](#solidsystem) · [`SpaceCastHit`](#spacecasthit) · [`SpaceFilter`](#spacefilter) · [`SpaceHit`](#spacehit) · [`SpaceQuery`](#spacequery) · [`SpawnInput`](#spawninput) · [`SpawnShape`](#spawnshape) · [`SpawnerBlock`](#spawnerblock) · [`SpawnerSystem`](#spawnersystem) · [`SpriteAssetInfo`](#spriteassetinfo) · [`SpriteBlock`](#spriteblock) · [`SpriteGeometry`](#spritegeometry) · [`StepEvent`](#stepevent) · [`StepResult`](#stepresult) · [`Style`](#style) · [`SublevelInfo`](#sublevelinfo) · [`SublevelOptions`](#subleveloptions) · [`SublevelResult`](#sublevelresult) · [`SwapSide`](#swapside) · [`SwapStrategy`](#swapstrategy) · [`SwapTiming`](#swaptiming) · [`SystemFactory`](#systemfactory) · [`TOOL_PRIORITY`](#tool_priority) · [`TOP_DOWN_CONTROLLER`](#top_down_controller) · [`TimeKind`](#timekind) · [`TimeModel`](#timemodel) · [`TimerAction`](#timeraction) · [`Timers`](#timers) · [`ToolConsumer`](#toolconsumer) · [`ToolEvent`](#toolevent) · [`ToolRouter`](#toolrouter) · [`TopDownController`](#topdowncontroller) · [`TopDownOptions`](#topdownoptions) · [`TransitionSpec`](#transitionspec) · [`ViewLayer`](#viewlayer) · [`ViewLayerHandle`](#viewlayerhandle) · [`VisualOptions`](#visualoptions) · [`WaypointMode`](#waypointmode) · [`WaypointState`](#waypointstate) · [`WorldState`](#worldstate) · [`advanceAlongPath`](#advancealongpath) · [`advanceWaypoint`](#advancewaypoint) · [`angleField`](#anglefield) · [`assetField`](#assetfield) · [`assetKindsOf`](#assetkindsof) · [`bindingKeyLabel`](#bindingkeylabel) · [`bindingProblems`](#bindingproblems) · [`bodyLocalShape`](#bodylocalshape) · [`bodyShapeField`](#bodyshapefield) · [`boundsCells`](#boundscells) · [`buildNavMesh`](#buildnavmesh) · [`carrierDelta`](#carrierdelta) · [`castSpawn`](#castspawn) · [`cellKey`](#cellkey-1) · [`cellOf`](#cellof) · [`clamp`](#clamp) · [`clampTiming`](#clamptiming) · [`clampVec2`](#clampvec2) · [`composePose`](#composepose) · [`createDataSystem`](#createdatasystem) · [`createDecorSystem`](#createdecorsystem) · [`createFollowerSystem`](#createfollowersystem) · [`createGridStepper`](#creategridstepper) · [`createMarkerSystem`](#createmarkersystem) · [`createMotionBody`](#createmotionbody) · [`createNavSystem`](#createnavsystem) · [`createOccupancy`](#createoccupancy) · [`createOverlapTracker`](#createoverlaptracker) · [`createPlacementTool`](#createplacementtool) · [`createPool`](#createpool) · [`createPropSystem`](#createpropsystem) · [`createRegistry`](#createregistry) · [`createSensorCollider`](#createsensorcollider) · [`createSensorSystem`](#createsensorsystem) · [`createSideViewController`](#createsideviewcontroller) · [`createSolidSystem`](#createsolidsystem) · [`createTopDownController`](#createtopdowncontroller) · [`declaredBindings`](#declaredbindings) · [`defineBehavior`](#definebehavior) · [`defineEntityType`](#defineentitytype) · [`defineGame`](#definegame) · [`degToRad`](#degtorad) · [`distanceVec2`](#distancevec2) · [`drawEntity`](#drawentity) · [`drawShape`](#drawshape) · [`effectiveSaveLimits`](#effectivesavelimits) · [`fieldOfView`](#fieldofview) · [`findPath`](#findpath) · [`flowField`](#flowfield-1) · [`flowIssue`](#flowissue) · [`forgetOneWayActor`](#forgetonewayactor) · [`formatSaveFile`](#formatsavefile) · [`gridField`](#gridfield) · [`gridFieldInfo`](#gridfieldinfo-1) · [`gridGeometry`](#gridgeometry-1) · [`gridMissingIssue`](#gridmissingissue) · [`gridPlace`](#gridplace-1) · [`gridRoute`](#gridroute) · [`inCellBounds`](#incellbounds) · [`initialWaypointState`](#initialwaypointstate) · [`inputFor`](#inputfor) · [`interpolatePosition`](#interpolateposition) · [`isNavSystem`](#isnavsystem) · [`isPolygonField`](#ispolygonfield) · [`isRuntimeId`](#isruntimeid) · [`isUiAction`](#isuiaction) · [`keycapLabel`](#keycaplabel) · [`keysProblems`](#keysproblems) · [`kinematicBodyEntry`](#kinematicbodyentry) · [`lengthUnitOf`](#lengthunitof) · [`lerp`](#lerp) · [`lerpVec2`](#lerpvec2) · [`lineOfSight`](#lineofsight) · [`materialField`](#materialfield) · [`mirrorField`](#mirrorfield) · [`navContains`](#navcontains) · [`navNearest`](#navnearest) · [`navPath`](#navpath) · [`oneWayPasses`](#onewaypasses) · [`parseRuntimeId`](#parseruntimeid) · [`parseSaveFile`](#parsesavefile) · [`parseShape`](#parseshape) · [`parseSublevelId`](#parsesublevelid) · [`pathPosition`](#pathposition) · [`pathWaypoints`](#pathwaypoints) · [`physicsOf`](#physicsof) · [`playersProblems`](#playersproblems) · [`pointField`](#pointfield) · [`pointerBit`](#pointerbit) · [`pointerButtonLabel`](#pointerbuttonlabel) · [`polygonField`](#polygonfield) · [`posedBodyDesc`](#posedbodydesc) · [`primitiveFields`](#primitivefields) · [`pxPerMetreOf`](#pxpermetreof) · [`rapierBodyEntry`](#rapierbodyentry) · [`readPathPlace`](#readpathplace) · [`refField`](#reffield) · [`registerBody`](#registerbody) · [`relativePose`](#relativepose) · [`resolveTime`](#resolvetime) · [`restoreOverlaps`](#restoreoverlaps) · [`runtimeId`](#runtimeid) · [`sameCell`](#samecell) · [`saveFileBytes`](#savefilebytes) · [`saveFileSchema`](#savefileschema) · [`saveOverlaps`](#saveoverlaps) · [`savePathPlace`](#savepathplace) · [`scaleLengths`](#scalelengths) · [`sceneGrid`](#scenegrid) · [`scopedRef`](#scopedref) · [`seekAlongPath`](#seekalongpath) · [`shapeColliderDesc`](#shapecolliderdesc) · [`shapeField`](#shapefield) · [`shapePose`](#shapepose) · [`sideField`](#sidefield) · [`spawnPose`](#spawnpose) · [`spriteGeometry`](#spritegeometry-1) · [`styleOf`](#styleof) · [`sublevelId`](#sublevelid) · [`tagsField`](#tagsfield) · [`tickRateProblem`](#tickrateproblem) · [`ticksFor`](#ticksfor) · [`traceShape`](#traceshape) · [`vectorField`](#vectorfield) · [`wholeTicksIn`](#wholeticksin) · [`withProject`](#withproject)

## `ACTION_KINDS`

_const_ in `game/input-bindings.ts`

```ts
declare const ACTION_KINDS: readonly ActionKind[];
```

Refers to [`ActionKind`](#actionkind).

## `ActionDef`

_type_ in `game/types.ts`

```ts
type ActionDef = InputBinding & {
    description: string;
    /** Default "button". */
    kind?: ActionKind;
    /** Resolved from devices and every binding layer, but never delivered to the simulation or written to a recording. */
    ui?: true;
};
```

Refers to [`ActionKind`](#actionkind).

## `ActionKind`

_type_ in `game/types.ts`

A button is down or up; an axis is −1…1; a vector lies in the unit disc.

```ts
type ActionKind = "axis" | "button" | "vector";
```

## `AssetIdSchema`

_const_ in `game/fields.ts`

An asset id; parses as a string so a dangling id is `asset-missing`, not a parse failure.

```ts
declare const AssetIdSchema: z.ZodString;
```

## `AssetKindDef`

_type_ in `project/kinds/define.ts`

```ts
type AssetKindDef = BlobKindDef<any, any> | CodeKindDef | DocKindDef<any>;
```

## `Attachment`

_type_ in `systems/attachments.ts`

```ts
type Attachment = {
    /** The collider while the host has a body; null while it waits for one. */
    collider(): Collider | null;
    /** Removes the collider (not the body) and stops waiting for the host. */
    detach(): void;
    /** The host while it has a body. */
    host(): AttachmentHost | null;
};
```

## `AttachmentHub`

_type_ in `systems/attachments.ts`

Colliders that ride another entity's body (`attach` on solids and
sensors): a host offers its body when it spawns and withdraws it before
the body goes; requests made before the host spawned, or across its
respawns, attach when it (re)appears. One per runtime. `attach` throws
`PhysicsRequiredError` while the runtime has no physics world.

```ts
type AttachmentHub = {
    attach(entityId: string, hostId: string, make: (host: AttachmentHost) => Collider, moved?: (host: AttachmentHost, snap: boolean, at?: Readonly<Pose>) => void): Attachment;
    /** The ids attached to a host. */
    attachedTo(hostId: string): string[];
    clear(): void;
    host(hostId: string, type: string, body: RigidBody, origin: Vec2): void;
    /**
     * Call after the host's body moved (`snap` when it jumped there): each
     * collider riding it has `moved` called, to re-pose its entity. `at` is
     * the body's translation and rotation when the caller has just read them,
     * passed on so riders don't read them again.
     */
    moved(hostId: string, snap?: boolean, at?: Readonly<Pose>): void;
    /** Call before removing the host's body; the colliders go with it and wait for the next `host`. */
    unhost(hostId: string): void;
};
```

Refers to [`Attachment`](#attachment), [`Pose`](#pose).

## `BASE_FIELDS`

_const_ in `game/fields.ts`

Fields every entity has besides `type`.

```ts
declare const BASE_FIELDS: {
    readonly group: z.ZodOptional<z.ZodString>;
    readonly id: z.ZodString;
    readonly layer: z.ZodOptional<z.ZodString>;
    readonly name: z.ZodOptional<z.ZodString>;
    readonly off: z.ZodOptional<z.ZodBoolean>;
    readonly z: z.ZodOptional<z.ZodNumber>;
};
```

## `BEHAVIOR_NAME_PATTERN`

_const_ in `game/behaviors.ts`

```ts
declare const BEHAVIOR_NAME_PATTERN: RegExp;
```

## `BODY`

_const_ in `game/behaviors/body.ts`

```ts
declare const BODY: BehaviorDef<{
    angularDamping: z.ZodOptional<z.ZodNumber>;
    ccd: z.ZodOptional<z.ZodBoolean>;
    fixedRotation: z.ZodOptional<z.ZodBoolean>;
    gravityScale: z.ZodOptional<z.ZodNumber>;
    kind: z.ZodDefault<z.ZodEnum<{
        dynamic: "dynamic";
        kinematic: "kinematic";
        static: "static";
    }>>;
    linearDamping: z.ZodOptional<z.ZodNumber>;
}>;
```

Refers to [`BehaviorDef`](#behaviordef).

## `BODY_KINDS`

_const_ in `game/behaviors/body.ts`

What moves a body: forces and contacts, code alone, or nothing.

```ts
declare const BODY_KINDS: readonly [
    "dynamic",
    "kinematic",
    "static"
];
```

## `BODY_SHAPE_TYPES`

_const_ in `game/fields.ts`

Every shape type except `chain`, which has no interior and so can't be a body.

```ts
declare const BODY_SHAPE_TYPES: readonly ShapeType[];
```

## `BasePrimitive`

_type_ in `game/types.ts`

Primitives with a runtime system; `note` never loads.

```ts
type BasePrimitive = Exclude<PrimitiveType, "note">;
```

Refers to [`PrimitiveType`](#primitivetype).

## `BehaviorBlock`

_type_ in `game/behaviors.ts`

One behavior's fields on one entity, defaults applied.

```ts
type BehaviorBlock = Readonly<Record<string, unknown>>;
```

## `BehaviorDef`

_type_ in `game/behaviors.ts`

```ts
type BehaviorDef<F extends z.ZodRawShape = z.ZodRawShape> = {
    /** Behaviors the same entity must not also carry; `behavior-conflict` otherwise. */
    conflicts?: readonly BehaviorName[];
    /** One sentence for the JSON Schema, `codes`, `show` and the inspector. */
    description: string;
    /** The block's fields; a function when one depends on the registry or the project (an asset enum). */
    fields: ((env: FieldEnv) => F) | F;
    /**
     * `category` is the editor's Add behavior heading; a behavior without one
     * lists under Game.
     */
    inspector?: {
        category?: "movement" | "physics" | "visual" | "world";
        label?: string;
        order?: readonly string[];
    };
    name: BehaviorName;
    /**
     * A check across the block's fields that a field shape can't say
     * ("exactly one of `ticks` or `ms`"): the message of a `schema` issue, or
     * undefined when the block is fine. Runs after the fields parse.
     */
    refine?(block: BehaviorBlock): string | undefined;
    /** Behaviors the same entity must also carry (`anim` requires `sprite`); `behavior-missing` otherwise. */
    requires?: readonly BehaviorName[];
    /** The runtime half; omitted for a data-only block game code reads. */
    system?: BehaviorSystemFactory;
    /**
     * The block the editor's Add behavior writes, before required fields are
     * seeded; default `{}`. Give one when `{}` fails `refine`.
     */
    template?: BehaviorBlock;
    /** Never changes simulation state: built only with a view, never headless. */
    visualOnly?: boolean;
};
```

Refers to [`BehaviorBlock`](#behaviorblock), [`BehaviorName`](#behaviorname), [`BehaviorSystemFactory`](#behaviorsystemfactory), [`FieldEnv`](#fieldenv).

## `BehaviorName`

_type_ in `game/behaviors.ts`

`sprite`, or a game's `<gameId>/<name>`.

```ts
type BehaviorName = string;
```

## `BehaviorRules`

_type_ in `game/types.ts`

What a type allows, requires and defaults among the registry's behaviors.

```ts
type BehaviorRules = {
    allowed: readonly BehaviorName[];
    defaults: ReadonlyMap<BehaviorName, BehaviorBlock>;
    required: ReadonlyMap<BehaviorName, BehaviorBlock>;
};
```

Refers to [`BehaviorBlock`](#behaviorblock), [`BehaviorName`](#behaviorname).

## `BehaviorSystem`

_interface_ in `game/behaviors.ts`

A behavior's runtime half.

```ts
interface BehaviorSystem<B extends BehaviorBlock = BehaviorBlock> {
    /** After the entity's type system spawned it, in registration order. */
    attach(entityId: string, block: B, entity: RuntimeEntity): void;
    /** Before the type system despawns it, in reverse order. Idempotent. */
    detach(entityId: string): void;
    /** The block changed; without it the host detaches and attaches. */
    update?(entityId: string, block: B, prev: B, entity: RuntimeEntity): void;
    /** Each tick, after the game's `beforeStep`, before the type systems' `beforePhysics`. */
    beforeStep?(dtMs: number): void;
    /**
     * Each tick, after the type systems' `beforePhysics`, before the physics
     * step; without physics, right after the behaviors' `beforeStep`.
     */
    beforePhysics?(): void;
    /** Each tick, after the type systems' `afterStep`, before the game's. */
    step?(dtMs: number): void;
    /** Each rendered frame, after `view.frame`; only for visual behaviors, never headless. */
    render?(alpha: number): void;
    /** Back to t = 0; `seek` moves time-driven state on, as `SceneSystem.seek` does. */
    reset?(): void;
    seek?(ms: number): void;
    clear(): void;
    size(): number;
    /** After a load's or a spawn's entities attached, with the ids carrying this behavior in spawn order. */
    ready?(ids: readonly string[]): void;
    /** The entity is disabled; without it the host detaches the block, and attaches it again on enable. */
    disable?(entityId: string): void;
    enable?(entityId: string): void;
    /** The block's state on `entityId` that a world save needs (a timer's progress); undefined for none. */
    save?(entityId: string): JsonValue | undefined;
    /** Puts back what `save` returned, after the block was attached again. */
    restore?(entityId: string, state: JsonValue): void;
}
```

Refers to [`BehaviorBlock`](#behaviorblock), [`JsonValue`](#jsonvalue).

## `BehaviorSystemFactory`

_type_ in `game/behaviors.ts`

```ts
type BehaviorSystemFactory = (ctx: EngineContext, def: RegisteredBehavior) => BehaviorSystem;
```

Refers to [`BehaviorSystem`](#behaviorsystem), [`EngineContext`](#enginecontext), [`RegisteredBehavior`](#registeredbehavior).

## `Binding`

_type_ in `game/types.ts`

One device input an action listens to.

```ts
type Binding = {
    axis: "lt" | "rt" | PadAxis;
    device: "pad";
    scale?: number;
} | {
    axis?: "x" | "y";
    button: PadButton;
    device: "pad";
    value?: number;
} | /** A key by `KeyboardEvent.code`; on an axis or vector action, `value` (default 1) is what it contributes on `axis` (vector: "x" or "y"). `player` drives that seat whoever owns the keyboard. */ {
    axis?: "x" | "y";
    code: string;
    device: "key";
    player?: number;
    value?: number;
} | {
    button: PointerButton;
    device: "pointer";
} | {
    control: string;
    device: "touch";
} | {
    device: "pad";
    stick: "left" | "right";
};
```

Refers to [`PadAxis`](#padaxis), [`PadButton`](#padbutton), [`PointerButton`](#pointerbutton).

## `BindingContext`

_type_ in `game/input-bindings.ts`

What a binding is judged against: its action's kind, the seats there are and the declared touch controls.

```ts
type BindingContext = {
    /** Ids of the input map's on-screen controls; absent, a touch binding's control isn't judged. */
    controls?: readonly string[];
    kind: ActionKind;
    /** Seats `0…max−1`. */
    max: number;
};
```

Refers to [`ActionKind`](#actionkind).

## `BindingProblem`

_type_ in `game/input-bindings.ts`

One thing wrong with a binding; `path` is a JSON Pointer inside the binding (`/code`).

```ts
type BindingProblem = {
    code: "binding-unknown" | "player-unknown";
    expected?: string;
    got?: string;
    hint?: string;
    message: string;
    path: string;
};
```

## `BodyBlock`

_type_ in `game/behaviors/body.ts`

A `body` block as an entity carries it, defaults applied.

```ts
type BodyBlock = z.infer<z.ZodObject<typeof bodyFields>>;
```

## `BodyControl`

_interface_ in `game/types.ts`

Every owner of a body registers it here by entity id. An id with no body
throws `EngineError` `body-missing`; a force, torque or impulse on a
kinematic or static body, a velocity write on a static body or a follower
(its path sets its velocity), and an angular velocity write on a kinematic
body that never turns (a character's, a motion body, a follower, or one with
`fixedRotation`) throw `body-not-dynamic`; a kinematic `body` block's turns
about its entity's pose at the angular velocity set. A static or kinematic
body's mass is Infinity. With `world.physics: "none"` only kinematic bodies
exist.

```ts
interface BodyControl {
    has(id: string): boolean;
    kind(id: string): "dynamic" | "kinematic" | "static" | null;
    velocity(id: string): Vec2;
    setVelocity(id: string, v: Vec2): void;
    angularVelocity(id: string): number;
    setAngularVelocity(id: string, w: number): void;
    /** Applied once, at the centre of mass or at a world point. */
    applyImpulse(id: string, impulse: Vec2, at?: Vec2): void;
    /**
     * Held for this tick's physics step only; call it each tick to sustain it.
     * One applied after the step (in `afterStep`, a behavior's `step` or an
     * event handler) is dropped at the end of the tick, never carried into the
     * next one.
     */
    applyForce(id: string, force: Vec2, at?: Vec2): void;
    /** Held as `applyForce` holds a force. */
    applyTorque(id: string, torque: number): void;
    mass(id: string): number;
    wake(id: string): void;
}
```

## `BodyEntry`

_type_ in `runtime/bodies-control.ts`

What a body's owner hands `ctx.bodies` when it registers the body. Only a
dynamic entry is ever asked for an impulse, a force or a torque.

```ts
type BodyEntry = {
    /** Held until `resetForces`. */
    addForce(force: Vec2, at?: Vec2): void;
    addTorque(torque: number): void;
    /** rad/s. */
    angularVelocity(): number;
    applyImpulse(impulse: Vec2, at?: Vec2): void;
    mass(): number;
    readonly kind: BodyKind;
    resetForces(): void;
    setAngularVelocity(w: number): void;
    setVelocity(v: Vec2): void;
    /** m/s. */
    velocity(): Vec2;
    wake(): void;
};
```

## `BodyKind`

_type_ in `game/behaviors/body.ts`

```ts
type BodyKind = (typeof BODY_KINDS)[number];
```

Refers to [`BODY_KINDS`](#body_kinds).

## `BodyStandIn`

_type_ in `runtime/bodies-control.ts`

What a system that owns entities' bodies (the collider behavior's) offers
one that moves the entity through a body of its own (a character, a nav
agent): its body out of the world while the other stands in, and back.

```ts
type BodyStandIn = {
    /** Gives the body back: built again where the entity is now, in `ctx.bodies` again. */
    release(entityId: string): void;
    /**
     * Takes the entity's body out of the world, and out of `ctx.bodies`, which
     * the standing-in body answers meanwhile; it holds across rebuilds.
     */
    standIn(entityId: string): void;
};
```

## `BulkKeyInfo`

_type_ in `game/types.ts`

```ts
type BulkKeyInfo = {
    /** `shape` or `at`. */
    field: "at" | "shape";
    form: BulkForm;
    key: BulkKey;
    material?: string;
    type: EntityTypeName;
};
```

## `CAMERA_TARGET`

_const_ in `game/behaviors/camera-target.ts`

```ts
declare const CAMERA_TARGET: BehaviorDef<{
    seat: z.ZodOptional<z.ZodNumber>;
    weight: z.ZodDefault<z.ZodNumber>;
}>;
```

Refers to [`BehaviorDef`](#behaviordef).

## `CHARACTER_JUMPED`

_const_ in `runtime/types.ts`

A character's jump started, on the ground or in coyote time.

```ts
declare const CHARACTER_JUMPED = "character:jumped";
```

## `CHARACTER_LANDED`

_const_ in `runtime/types.ts`

A character landed: `entityId` the character, `other` what it landed on.

```ts
declare const CHARACTER_LANDED = "character:landed";
```

## `CHARACTER_LEFT_GROUND`

_const_ in `runtime/types.ts`

A character left the ground, by a jump, a launch or a ledge.

```ts
declare const CHARACTER_LEFT_GROUND = "character:left-ground";
```

## `CHARACTER_SIDE_VIEW`

_const_ in `game/behaviors/character-side-view.ts`

```ts
declare const CHARACTER_SIDE_VIEW: BehaviorDef<{
    accel: z.ZodDefault<z.ZodNumber>;
    airControl: z.ZodDefault<z.ZodNumber>;
    coyoteMs: z.ZodDefault<z.ZodNumber>;
    decel: z.ZodDefault<z.ZodNumber>;
    gravityScale: z.ZodDefault<z.ZodNumber>;
    jump: z.ZodDefault<z.ZodString>;
    jumpBufferMs: z.ZodDefault<z.ZodNumber>;
    jumpCut: z.ZodDefault<z.ZodNumber>;
    jumpHeight: z.ZodDefault<z.ZodNumber>;
    maxFallSpeed: z.ZodDefault<z.ZodNumber>;
    maxSlopeDeg: z.ZodDefault<z.ZodNumber>;
    maxSpeed: z.ZodDefault<z.ZodNumber>;
    move: z.ZodDefault<z.ZodString>;
    pushDynamic: z.ZodDefault<z.ZodBoolean>;
    snapToGround: z.ZodDefault<z.ZodNumber>;
    stepHeight: z.ZodDefault<z.ZodNumber>;
}>;
```

Refers to [`BehaviorDef`](#behaviordef).

## `CHARACTER_TOP_DOWN`

_const_ in `game/behaviors/character-top-down.ts`

```ts
declare const CHARACTER_TOP_DOWN: BehaviorDef<{
    accel: z.ZodDefault<z.ZodNumber>;
    decel: z.ZodDefault<z.ZodNumber>;
    maxSpeed: z.ZodDefault<z.ZodNumber>;
    move: z.ZodDefault<z.ZodString>;
    pushDynamic: z.ZodDefault<z.ZodBoolean>;
}>;
```

Refers to [`BehaviorDef`](#behaviordef).

## `CHILD_REF_PATTERN`

_const_ in `game/fields.ts`

An id, or `<instance>/<child>` at any depth: what a reference field may name.

```ts
declare const CHILD_REF_PATTERN: RegExp;
```

## `COLLIDER`

_const_ in `game/behaviors/collider.ts`

```ts
declare const COLLIDER: BehaviorDef<{
    density: z.ZodDefault<z.ZodNumber>;
    friction: z.ZodOptional<z.ZodNumber>;
    group: z.ZodOptional<z.ZodString>;
    material: z.ZodOptional<z.ZodEnum<{
        [x: string]: string;
    }>> | z.ZodOptional<z.ZodNever>;
    restitution: z.ZodOptional<z.ZodNumber>;
    sensor: z.ZodDefault<z.ZodBoolean>;
    shape: z.ZodType<ShapeTuple, unknown, z.core.$ZodTypeInternals<ShapeTuple, unknown>>;
}>;
```

Refers to [`BehaviorDef`](#behaviordef).

## `COMMAND_NAME_PATTERN`

_const_ in `game/commands.ts`

What a game's command names look like.

```ts
declare const COMMAND_NAME_PATTERN: RegExp;
```

## `CONTACT_END`

_const_ in `runtime/types.ts`

```ts
declare const CONTACT_END = "contact:end";
```

## `CONTACT_START`

_const_ in `runtime/types.ts`

A watched pair started touching: `entityId` the watched side, `other` the other, `at` the contact point.

```ts
declare const CONTACT_START = "contact:start";
```

## `CameraTargetBlock`

_type_ in `game/behaviors/camera-target.ts`

A `camera-target` block as an entity carries it, defaults applied.

```ts
type CameraTargetBlock = z.infer<z.ZodObject<typeof cameraTargetFields>>;
```

## `CastResult`

_type_ in `runtime/cast.ts`

```ts
type CastResult = {
    at: Vec2;
    ok: true;
} | {
    error: string;
    ok: false;
};
```

## `Cell`

_type_ in `grid/geometry.ts`

```ts
type Cell = readonly [
    col: number,
    row: number
];
```

## `CellBounds`

_type_ in `grid/geometry.ts`

An inclusive range of cells.

```ts
type CellBounds = {
    c0: number;
    c1: number;
    r0: number;
    r1: number;
};
```

## `CellKey`

_type_ in `grid/geometry.ts`

Packed (col + 2^20) · 2^21 + (row + 2^20); cells must lie in [−2^20, 2^20).

```ts
type CellKey = number;
```

## `CharacterControllerOptions`

_type_ in `physics.ts`

How a Rapier character controller moves; each null turns that behaviour off.

```ts
type CharacterControllerOptions = {
    /** Step height and width, m. */
    autostep: null | {
        dynamic: boolean;
        maxHeight: number;
        minWidth: number;
    };
    /** null: no climbing limit. */
    maxSlopeClimbDeg: null | number;
    /** null: never slides. */
    minSlopeSlideDeg: null | number;
    /** The gap kept from what it touches, m; default 0.0001. */
    offset?: number;
    pushDynamic: boolean;
    /** How far down it snaps to the ground, m. */
    snapToGround: null | number;
    /** Unit vector pointing up. */
    up: Pt;
};
```

## `CharacterIntent`

_type_ in `game/behaviors/character-top-down.ts`

What a character is asked to do this tick when no seat drives it.

```ts
type CharacterIntent = {
    /** Side view: held to jump, released early for a lower one. */
    jump?: boolean;
    /** Unit disc; a side-view character reads only `x`. */
    move: Vec2;
};
```

## `CharacterSideViewBlock`

_type_ in `game/behaviors/character-side-view.ts`

A `character-side-view` block as an entity carries it, defaults applied.

```ts
type CharacterSideViewBlock = z.infer<z.ZodObject<typeof characterSideViewFields>>;
```

## `CharacterSystem`

_type_ in `game/behaviors/character-top-down.ts`

Both character behaviors' systems.

```ts
type CharacterSystem<B extends BehaviorBlock = BehaviorBlock> = BehaviorSystem<B> & {
    /** Standing on something; a top-down character always is. */
    grounded(entityId: string): boolean;
    /** Sets its velocity at once, m/s: a bounce pad, a knockback. */
    launch(entityId: string, velocity: Vec2): void;
    /** Drives an entity that carries no `player-input`, from this tick until the next call. */
    setIntent(entityId: string, intent: CharacterIntent): void;
    /** m/s. */
    velocity(entityId: string): Vec2;
};
```

Refers to [`BehaviorBlock`](#behaviorblock), [`BehaviorSystem`](#behaviorsystem), [`CharacterIntent`](#characterintent).

## `CharacterTopDownBlock`

_type_ in `game/behaviors/character-top-down.ts`

A `character-top-down` block as an entity carries it, defaults applied.

```ts
type CharacterTopDownBlock = z.infer<z.ZodObject<typeof characterTopDownFields>>;
```

## `CheckEnv`

_type_ in `game/types.ts`

What a `.checks.json` check runs against.

```ts
type CheckEnv = {
    def: SceneDefinition;
    /** The prefabs the scene's instances name. */
    prefabs?: PrefabLibrary;
    /** Null when the host loaded no Rapier (a scene without physics needs none). */
    rapier?: RapierModule | null;
    /** Reads a file a check names (an input script), relative to the checks file. */
    readFile(path: string): string;
    registry: Registry;
};
```

Refers to [`Registry`](#registry).

## `CheckKindDef`

_type_ in `game/types.ts`

A check kind a game adds to `.checks.json` (the platformer's `beatable`).

```ts
type CheckKindDef<A = unknown> = {
    /** The check's own fields beside `id`, `kind` and `skip`. */
    arg: z.ZodType<A>;
    description: string;
    run(arg: A, env: CheckEnv): CheckVerdict;
};
```

Refers to [`CheckEnv`](#checkenv), [`CheckVerdict`](#checkverdict).

## `CheckVerdict`

_type_ in `game/types.ts`

A check's outcome: pass or fail, in a sentence, with what it measured.

```ts
type CheckVerdict = {
    detail?: unknown;
    message: string;
    pass: boolean;
};
```

## `ColliderBlock`

_type_ in `game/behaviors/collider.ts`

A `collider` block as an entity carries it, defaults applied.

```ts
type ColliderBlock = z.infer<z.ZodObject<ReturnType<typeof colliderFields>>>;
```

## `ColliderSystem`

_type_ in `game/behaviors/collider.ts`

The `collider` behavior's system. It owns the entity's physics body and
collider for its `collider` and `body` blocks both, and hands the body
over (`standIn`, `release`) to a behavior that moves the entity through a
body of its own.

```ts
type ColliderSystem = BehaviorSystem<ColliderBlock> & BodyStandIn & {
    /** Whether `entityId` carries an attached collider. */
    has(entityId: string): boolean;
    /** Builds the entity's body and collider again from its current blocks. */
    rebuild(entityId: string): void;
};
```

Refers to [`BehaviorSystem`](#behaviorsystem), [`BodyStandIn`](#bodystandin), [`ColliderBlock`](#colliderblock).

## `ColliderTag`

_type_ in `game/types.ts`

What the runtime knows about a collider it created.

```ts
type ColliderTag = {
    /** The entity whose body carries the collider when it isn't `entityId`'s own (an attached solid rides a follower). */
    carrier?: {
        entityId: string;
        type: string;
    };
    entityId: string;
    /** The entity's own launch velocity on any contact; a material's is in `registry.materials`. */
    impulse?: Vec2;
    material?: string;
    /** One-way: actors pass up through it and land on top. */
    oneWay?: boolean;
    /** The side actors land on, set with `oneWay: true`. */
    oneWaySide?: Side;
    tags?: readonly string[];
    /** The registered type of the entity that owns it, or a game's own label (`avatar`). */
    type: string;
};
```

Refers to [`Side`](#side).

## `ColliderTags`

_type_ in `game/types.ts`

Per-world lookup from collider handle (Rapier's or the geometry world's) to the entity that owns it.

```ts
type ColliderTags = {
    clear: () => void;
    delete: (handle: number) => void;
    get: (handle: number) => ColliderTag | undefined;
    handlesOf: (entityId: string) => number[];
    readonly size: number;
    set: (handle: number, tag: ColliderTag) => void;
};
```

Refers to [`ColliderTag`](#collidertag).

## `CommandDef`

_type_ in `game/types.ts`

```ts
type CommandDef = {
    /** Validates `args`; omitted, the command takes none. */
    args?: z.ZodType;
    description: string;
};
```

## `ContactSelector`

_type_ in `game/types.ts`

An entity id, or every entity of a type or with a tag.

```ts
type ContactSelector = string | {
    tag?: string;
    type?: EntityTypeName;
};
```

## `Contacts`

_interface_ in `game/types.ts`

```ts
interface Contacts {
    /**
     * Raises `contact:start` and `contact:end` between `a` and `b` (anything
     * that isn't a sensor when omitted); returns the unwatch.
     */
    watch(a: ContactSelector, b?: ContactSelector): () => void;
}
```

Refers to [`ContactSelector`](#contactselector).

## `CoroutineYield`

_type_ in `game/types.ts`

What a coroutine yields: a delay to wait, or a predicate to wait on (checked each tick).

```ts
type CoroutineYield = (() => boolean) | Delay;
```

Refers to [`Delay`](#delay).

## `CreateRegistryOptions`

_type_ in `game/define.ts`

```ts
type CreateRegistryOptions = {
    /**
     * The project's live asset ids of the asked kinds, sorted: what asset
     * fields offer as JSON Schema choices. Omitted means no project, so
     * every kind is empty. The `primitives` registry shares it.
     */
    assets?: FieldEnv["assets"];
    /**
     * The project's materials by asset id. Each wins over the game's code
     * material of that name. One with `physics` joins `materials` (and so
     * the material fields' choices); one without is left out of them, so a
     * physics body naming it is refused like any unknown material, and its
     * `style`, `tint` and `blend` reach no entity: a sprite falls back to a
     * material's tint and blend only through `materials`. The
     * `primitives` registry beside a game's has them too, so a scene with
     * no game run under one sees its project's materials.
     */
    materials?: Readonly<Record<string, ProjectMaterialDef>>;
};
```

Refers to [`FieldEnv`](#fieldenv), [`ProjectMaterialDef`](#projectmaterialdef).

## `DEFAULT_ACTIONS`

_const_ in `game/defaults.ts`

The actions a registry built without a game has, so the standard
behaviors can be played in a project with no game module. A game's own
`actions` replace them.

```ts
declare const DEFAULT_ACTIONS: readonly ActionDef[];
```

Refers to [`ActionDef`](#actiondef).

## `DEFAULT_GRAVITY`

_const_ in `game/defaults.ts`

World gravity, m/s²; y is down.

```ts
declare const DEFAULT_GRAVITY: [
    number,
    number
];
```

## `DEFAULT_LAYERS`

_const_ in `scene/layers.ts`

The layers a game without `layers` gets.

```ts
declare const DEFAULT_LAYERS: readonly SceneLayerDef[];
```

Refers to [`SceneLayerDef`](#scenelayerdef).

## `DEFAULT_LENGTH_UNIT`

_const_ in `game/defaults.ts`

A game's px per metre when its `world.lengthUnit` sets none.

```ts
declare const DEFAULT_LENGTH_UNIT = 100;
```

## `DEFAULT_PHYSICS`

_const_ in `game/defaults.ts`

```ts
declare const DEFAULT_PHYSICS = "rapier";
```

## `DEFAULT_ROTATE_STEP`

_const_ in `placement.ts`

```ts
declare const DEFAULT_ROTATE_STEP = 0.15;
```

## `DEFAULT_SAVE_LIMITS`

_const_ in `game/save-file.ts`

64 KiB per save and 8 slots per game, unless the game sets its own.

```ts
declare const DEFAULT_SAVE_LIMITS: SaveLimits;
```

Refers to [`SaveLimits`](#savelimits).

## `DEFAULT_SPAWN_CAST`

_const_ in `game/defaults.ts`

```ts
declare const DEFAULT_SPAWN_CAST = "gravity";
```

## `DEFAULT_TICK_RATE`

_const_ in `game/defaults.ts`

```ts
declare const DEFAULT_TICK_RATE = 60;
```

## `DEFAULT_TIME`

_const_ in `game/defaults.ts`

```ts
declare const DEFAULT_TIME: {
    readonly kind: "fixed";
    readonly rate: 60;
};
```

## `DRAW_LAYERS`

_const_ in `context.ts`

Named draw orders inside a scene view, bottom to top, whatever order
systems spawn in. A game may pass any number between them.

```ts
declare const DRAW_LAYERS: {
    readonly actor: 30;
    readonly body: 10;
    readonly marker: 20;
    readonly overlay: 50;
    readonly preview: 60;
    readonly terrain: 0;
};
```

## `DataSystem`

_type_ in `systems/data.ts`

```ts
type DataSystem<E extends RuntimeEntity = RuntimeEntity> = SceneSystem<E> & {
    get(id: string): E | undefined;
    /** Live entities in spawn order. */
    list(): E[];
};
```

Refers to [`SceneSystem`](#scenesystem).

## `DecorEntity`

_type_ in `systems/decor.ts`

```ts
type DecorEntity = RuntimeEntity<{
    at: Pt;
}>;
```

## `Delay`

_type_ in `game/types.ts`

Ticks, or milliseconds rounded to ticks once, at creation, with the run's tick rate.

```ts
type Delay = number | {
    ms: number;
};
```

## `DeviceId`

_type_ in `game/types.ts`

An input device, as seats own them.

```ts
type DeviceId = "keyboard" | "pointer" | "touch" | `pad:${number}`;
```

## `DrawLayer`

_type_ in `context.ts`

```ts
type DrawLayer = keyof typeof DRAW_LAYERS;
```

Refers to [`DRAW_LAYERS`](#draw_layers).

## `ENGINE_CHECK_KINDS`

_const_ in `game/types.ts`

Check kinds the engine runs itself; a game's are `<game-id>/<kind>`.

```ts
declare const ENGINE_CHECK_KINDS: readonly [
    "valid",
    "reaches",
    "touches",
    "connected"
];
```

## `ENGINE_COLLISION_GROUPS`

_const_ in `game/types.ts`

Collision groups the primitives use. A game adds its own beside them.

```ts
declare const ENGINE_COLLISION_GROUPS: readonly [
    "static",
    "dynamic",
    "sensor"
];
```

## `ENGINE_COMMANDS`

_const_ in `game/commands.ts`

Engine commands; game command names may not start with "@".

```ts
declare const ENGINE_COMMANDS: Readonly<Record<"@elapsed" | typeof NAV_COMMAND, CommandDef>>;
```

Refers to [`CommandDef`](#commanddef), [`NAV_COMMAND`](#nav_command).

## `ENGINE_PREDICATES`

_const_ in `game/types.ts`

`until` predicates the engine provides; a game's predicates can't take these names.

```ts
declare const ENGINE_PREDICATES: readonly [
    "event",
    "tick",
    "exists",
    "count",
    "near",
    "scene",
    "persist"
];
```

## `ENGINE_REGISTRY_ID`

_const_ in `game/types.ts`

The registry id of a registry without a game.

```ts
declare const ENGINE_REGISTRY_ID = "engine";
```

## `ENGINE_RUN_RESULTS`

_const_ in `game/types.ts`

Run results the engine decides itself; a game declares the rest in
`play.results`. `quit` is a browser run stopped before any outcome;
`flow` is a run that ended on a scene change it didn't follow.

```ts
declare const ENGINE_RUN_RESULTS: readonly [
    "timeout",
    "script-end",
    "stuck",
    "quit",
    "flow"
];
```

## `ENGINE_TOOL_IDS`

_const_ in `game/types.ts`

The engine's own editor tools; a game's tools can't reuse these ids.

```ts
declare const ENGINE_TOOL_IDS: readonly [
    "select",
    "pan",
    "box",
    "circle",
    "pen",
    "waypoints",
    "rotate"
];
```

## `ENTITY_DESTROYED`

_const_ in `runtime/types.ts`

An entity destroyed at the end of a tick, at its last pose.

```ts
declare const ENTITY_DESTROYED = "entity:destroyed";
```

## `ENTITY_DISABLED`

_const_ in `runtime/types.ts`

```ts
declare const ENTITY_DISABLED = "entity:disabled";
```

## `ENTITY_ENABLED`

_const_ in `runtime/types.ts`

```ts
declare const ENTITY_ENABLED = "entity:enabled";
```

## `ENTITY_SPAWNED`

_const_ in `runtime/types.ts`

An entity spawned inside a step, at its spawn pose.

```ts
declare const ENTITY_SPAWNED = "entity:spawned";
```

## `EditorToolDef`

_type_ in `editor/tools.ts`

A tool a game adds. An edit-scope `editorKeys` binding whose command is
`tool:<id>` picks it; `tool:<id>:<arg>` picks it and passes `<arg>` to
its `command`.

```ts
type EditorToolDef = {
    create(ctx: EditorToolContext): EditorTool;
    description: string;
    /** Unique among the engine's (`ENGINE_TOOL_IDS`) and the game's tools. */
    id: string;
    label: string;
};
```

## `EngineCheckKind`

_type_ in `game/types.ts`

```ts
type EngineCheckKind = (typeof ENGINE_CHECK_KINDS)[number];
```

Refers to [`ENGINE_CHECK_KINDS`](#engine_check_kinds).

## `EngineCollisionGroup`

_type_ in `game/types.ts`

```ts
type EngineCollisionGroup = (typeof ENGINE_COLLISION_GROUPS)[number];
```

Refers to [`ENGINE_COLLISION_GROUPS`](#engine_collision_groups).

## `EngineContext`

_type_ in `game/types.ts`

Everything a scene system or a game's runtime hooks need, scoped to one runtime.

```ts
type EngineContext = {
    /**
     * Colliders riding another entity's body: what `attach` on solids and
     * sensors goes through. Throws `PhysicsRequiredError` when physics is null.
     */
    attachments: AttachmentHub;
    /** A behavior's runtime system, as `system(type)` gives a type's. */
    behavior: <S extends BehaviorSystem = BehaviorSystem>(name: BehaviorName) => S | undefined;
    bounds: Bounds;
    /** Contact starts and ends between watched entities, raised as step events. */
    contacts: Contacts;
    /**
     * Destroys an entity, or every child of an instance id. Inside a step it
     * happens at the end of the tick, after the game's `afterStep`; outside
     * one, at once.
     */
    destroy: (id: string) => void;
    dev: boolean;
    /** Raise an event in the current tick's `StepResult`. */
    emit: (event: Omit<StepEvent, "tick">) => void;
    /** False for a disabled entity and for one that doesn't exist. */
    enabled: (id: string) => boolean;
    /** Subscriptions to this runtime's step events, delivered at the tick's dispatch points. */
    events: EventBus;
    exists: (id: string) => boolean;
    /** The main scene, requests for the next one, and sublevels. */
    flow: FlowContext;
    /** The engine's own colliders while the loaded scene has no physics; null under Rapier. */
    geometry: GeometryWorld | null;
    /** A live entity, loaded or spawned. */
    get: (id: string) => RuntimeEntity | undefined;
    /** `settings.gravity` as a vector; the physics world uses the same value. */
    gravity: Vec2;
    /** Each seat's actions and pointer this tick, derived from the tick's input, so a replay rebuilds it exactly. */
    input: InputState;
    /**
     * Places a prefab now, as a load would: the instance id is
     * `<prefab>#<n>` (or `opts.id`), its children `<id>/<child>`. Throws an
     * `EngineError` (`prefab-not-spawnable`, `spawn-id-invalid`). A
     * `prefab-not-spawnable` error's `cause` says why: an issue (`prefab-unknown`,
     * `prefab-cycle`, `prefab-depth`) or an `EngineError` (`physics-required`,
     * `unknown-type`), each with its `code`.
     */
    instantiate: (prefab: AssetId, at: Pt | Vec2, opts?: InstantiateOptions) => InstantiateResult;
    /** State that survives scene changes (`GameDefinition.persist`); its value is null when the game declares none. */
    persist: PersistContext;
    physics: PhysicsWorld | null;
    /** Every loaded entity's pose, written by the system that moves it. */
    poses: PoseIndex;
    /** Entities by type, tag, area, point and distance, read from poses and shapes. */
    query: EntityQuery;
    /**
     * Seeded at each load from `PlayOptions.seed`, else from the game's and
     * the scene's names; `fork(label)` gives a system its own stream. Engine
     * systems and behaviors never draw from it, except the `spawner`
     * behavior, which takes a fork per entity.
     */
    random: Rng;
    /** Null while the loaded scene runs without physics; `physicsOf` reads both or throws. */
    rapier: RapierModule | null;
    /** Moves bodies by entity id, whichever system owns them. */
    readonly bodies: BodyControl;
    /** Present when the loaded scene's resolved settings have a grid. */
    readonly grid: RuntimeGrid | null;
    /** Which version of the main scene runs, and where game code marks a safe moment to change it. */
    readonly live: LiveContext;
    /** Present when the loaded scene has walk areas. */
    readonly nav: RuntimeNav | null;
    /**
     * What this load is playing: `null` for an edit world. With `at`, the game
     * spawns its actor there instead of at its own spawn; the runtime has already
     * cast it along its `spawnShape`'s `cast` onto the first surface it meets.
     */
    readonly play: PlayStart | null;
    /**
     * The project's data, a frozen view; null for a run with no project (bare
     * scene tests). `GameInstance.reloadAssets` (art hot reload in the editor)
     * can replace it with a new frozen view mid-run, so read `ctx.project` at
     * use rather than caching it.
     */
    readonly project: ProjectRuntimeView | null;
    /** Texture sampling for a sprite whose texture's import sets no `filter`. */
    readonly sampling: "linear" | "nearest";
    /** True while Play's `timeOffsetMs` is being sought before tick 0. */
    readonly seeking: boolean;
    /** The tick being simulated, counting from 0 after each load. */
    readonly tick: number;
    /** The run's clock; the same for every load of one runtime. */
    readonly time: ResolvedTime;
    registry: Registry;
    saves: SavesContext;
    /**
     * Immediate. A disabled entity skips its systems, behaviors, contacts,
     * queries and owned timers, and keeps its state.
     */
    setEnabled: (id: string, enabled: boolean) => void;
    settings: ResolvedSettings;
    /** Point, shape, ray and sweep queries over whichever backend is loaded. */
    space: SpaceQuery;
    /**
     * Spawns one entity now, through its type's system, and returns it live:
     * posed, its behaviors attached and `ready` run. Throws an `EngineError`
     * (`spawn-id-invalid`, `unknown-type`, `schema`, `physics-required`)
     * after undoing what it did.
     */
    spawn: <E extends RuntimeEntity = RuntimeEntity>(input: SpawnInput) => E;
    /** The system that spawns `type`, for a game's hooks to drive. */
    system: <S extends SceneSystem = SceneSystem>(type: EntityTypeName) => S | undefined;
    tags: ColliderTags;
    /** Tick-counted timers and coroutines, reset at each load. */
    timers: Timers;
    view: SceneView | null;
};
```

Refers to [`AttachmentHub`](#attachmenthub), [`BehaviorName`](#behaviorname), [`BehaviorSystem`](#behaviorsystem), [`BodyControl`](#bodycontrol), [`ColliderTags`](#collidertags), [`Contacts`](#contacts), [`EntityQuery`](#entityquery), [`EventBus`](#eventbus), [`FlowContext`](#flowcontext), [`GeometryWorld`](#geometryworld), [`InputState`](#inputstate), [`InstantiateOptions`](#instantiateoptions), [`InstantiateResult`](#instantiateresult), [`LiveContext`](#livecontext), [`PersistContext`](#persistcontext), [`PhysicsWorld`](#physicsworld), [`PlayStart`](#playstart), [`PoseIndex`](#poseindex), [`ProjectRuntimeView`](#projectruntimeview), [`Registry`](#registry), [`ResolvedTime`](#resolvedtime), [`RuntimeGrid`](#runtimegrid), [`RuntimeNav`](#runtimenav), [`SavesContext`](#savescontext), [`SceneSystem`](#scenesystem), [`SceneView`](#sceneview), [`SpaceQuery`](#spacequery), [`SpawnInput`](#spawninput), [`StepEvent`](#stepevent), [`Timers`](#timers).

## `EngineError`

_class_ in `game/types.ts`

A runtime refusal with an issue code: `spawn-id-invalid`,
`prefab-not-spawnable`, `physics-required`, `unknown-type`, `schema`. A
playtest that hits one ends blocked at stage `"run"` with its code.

```ts
declare class EngineError extends Error {
    readonly code: string;
    readonly entityId?: string;
    constructor(code: string, message: string, entityId?: string);
}
```

## `EngineRunResult`

_type_ in `game/types.ts`

```ts
type EngineRunResult = (typeof ENGINE_RUN_RESULTS)[number];
```

Refers to [`ENGINE_RUN_RESULTS`](#engine_run_results).

## `EngineToolId`

_type_ in `game/types.ts`

```ts
type EngineToolId = (typeof ENGINE_TOOL_IDS)[number];
```

Refers to [`ENGINE_TOOL_IDS`](#engine_tool_ids).

## `EntityOf`

_type_ in `game/define.ts`

The runtime entity a type's fields describe.

```ts
type EntityOf<D extends EntityTypeDef> = D extends EntityTypeDef<infer F> ? RuntimeEntity<z.infer<z.ZodObject<F>>> : RuntimeEntity;
```

Refers to [`EntityTypeDef`](#entitytypedef).

## `EntityQuery`

_interface_ in `game/types.ts`

```ts
interface EntityQuery {
    /** In spawn order: load order, then spawns appended. */
    select(sel?: EntitySelector): readonly string[];
    byType(type: EntityTypeName): readonly string[];
    byTag(tag: string): readonly string[];
    count(sel?: EntitySelector): number;
    /** Entities whose world extent intersects `area`. */
    inArea(area: Aabb | ShapeObj, sel?: EntitySelector): readonly string[];
    at(p: Vec2, sel?: EntitySelector): readonly string[];
    /** Closest by extent; ties go to the earlier spawn. */
    nearest(p: Vec2, sel?: EntitySelector & {
        maxDist?: number;
    }): string | undefined;
    /** The entity's shape moved by its pose's change since it spawned, or a point at its pose when it has no shape. */
    extent(id: string): ShapeObj | undefined;
}
```

Refers to [`EntitySelector`](#entityselector).

## `EntitySelector`

_type_ in `game/types.ts`

```ts
type EntitySelector = {
    /** Default true: only enabled entities. */
    enabled?: boolean;
    /** A value of the entity's `tagsField` fields. */
    tag?: string;
    type?: EntityTypeName | readonly EntityTypeName[];
};
```

## `EntityTypeDef`

_type_ in `game/types.ts`

```ts
type EntityTypeDef<F extends z.ZodRawShape = z.ZodRawShape> = {
    /** One character for the scene's ASCII map; omitted, the base primitive's, else the type's first letter. */
    ascii?: string;
    /** The primitive whose engine system spawns this type; the fields must include the primitive's. */
    base?: BasePrimitive;
    /** Which behaviors this type always has, defaults, and refuses. */
    behaviors?: {
        /** Field defaults for an optional behavior when an entity of this type carries it. */
        defaults?: Readonly<Record<BehaviorName, Record<string, unknown>>>;
        /**
         * Refused on this type; "all" allows only `required`. A type with a `base`
         * and no system of its own also refuses what its base primitive refuses.
         */
        forbidden?: "all" | readonly BehaviorName[];
        /** Always present; a missing block loads as these defaults ({} for the behavior's own). */
        required?: Readonly<Record<BehaviorName, Record<string, unknown>>>;
    };
    /**
     * An id-less top-level array under the type's name. `shape` entries fill
     * the `shape` field and `point` entries the `at` field; with `materials`,
     * `<type>:<material>` keys exist for every registered material.
     */
    bulk?: {
        description: string;
        form: BulkForm;
        materials?: boolean;
    };
    /** One sentence for the JSON Schema, `codes`, `show` and the inspector. */
    description: string;
    /**
     * The type's own fields. `id`, `type`, `name`, `layer`, `group` and `off`
     * are added by the engine. Written as a function when a field depends on
     * the registry (a material enum).
     */
    fields: ((env: FieldEnv) => F) | F;
    inspector?: {
        group?: string;
        label?: string;
        order?: readonly string[];
    };
    /** False for editor-only types (notes): kept on disk, dropped by `expandScene`. */
    loads?: boolean;
    /**
     * Every entity of the type is one-way on this side (`true` is "up"), with
     * or without a `oneWay` field. A side the entity names wins; its `true` or
     * `false` keeps the type's side, as the solid system judges it. Declare it
     * when the type's system makes it one-way, so the editor and renderers
     * draw the landing side.
     */
    oneWay?: Side | true;
    /**
     * Its system gives each entity a physics body with a collider that isn't a
     * sensor, as solid, prop and follower do: a joint's `to` can name it.
     * Omitted, a type with a `base` and no system of its own takes its base
     * primitive's.
     */
    ownsBody?: true;
    /** Whether the type can load in a scene with physics "none"; default its base primitive's, else "optional". */
    physics?: "optional" | "required";
    /** Fields that name other entities, and the types they may name. */
    refs?: {
        field: string;
        targets: readonly EntityTypeName[];
    }[];
    /**
     * Loads and spawns, but can't be placed in a scene: absent from the scene
     * schema, and `unknown-type` in a file. Game code makes it with `ctx.spawn`.
     */
    spawnOnly?: true;
    style?: Style;
    /** Required unless `base` is set or `loads` is false. */
    system?: SystemFactory;
    type: EntityTypeName;
};
```

Refers to [`BasePrimitive`](#baseprimitive), [`BehaviorName`](#behaviorname), [`FieldEnv`](#fieldenv), [`Side`](#side), [`Style`](#style), [`SystemFactory`](#systemfactory).

## `EventBus`

_interface_ in `game/types.ts`

```ts
interface EventBus {
    /**
     * Handlers run at the tick's two dispatch points (after the timers, and
     * after the end-of-tick destroys), in subscription order per event and
     * raise order across events. Returns the unsubscribe. Subscriptions end
     * at unload, so subscribe in `onLoad` or later.
     */
    on(type: string, handler: (e: StepEvent) => void, opts?: EventSubscribeOptions): () => void;
    /** As `on`, for the first matching event only. */
    once(type: string, handler: (e: StepEvent) => void, opts?: EventSubscribeOptions): () => void;
}
```

Refers to [`EventSubscribeOptions`](#eventsubscribeoptions), [`StepEvent`](#stepevent).

## `EventSubscribeOptions`

_type_ in `game/types.ts`

Options for `EngineContext.events.on` and `once`.

```ts
type EventSubscribeOptions = {
    /** Only events whose `entityId` or `other` is this id, or a child of this instance id. */
    entity?: string;
    /** The subscription ends when this entity is destroyed. */
    owner?: string;
};
```

## `FORCE_AREA`

_const_ in `game/behaviors/force-area.ts`

```ts
declare const FORCE_AREA: BehaviorDef<{
    affects: z.ZodOptional<z.ZodObject<{
        groups: z.ZodOptional<z.ZodArray<z.ZodString>>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    drag: z.ZodDefault<z.ZodNumber>;
    falloff: z.ZodDefault<z.ZodEnum<{
        "inverse-square": "inverse-square";
        linear: "linear";
        none: "none";
    }>>;
    force: z.ZodOptional<z.ZodTuple<[
        z.ZodNumber,
        z.ZodNumber
    ], null>>;
    kind: z.ZodDefault<z.ZodEnum<{
        directional: "directional";
        point: "point";
    }>>;
    strength: z.ZodOptional<z.ZodNumber>;
}>;
```

Refers to [`BehaviorDef`](#behaviordef).

## `FieldEnv`

_type_ in `game/types.ts`

What a type's field schema may depend on: the registry's names.

```ts
type FieldEnv = {
    /** Live asset ids of these kinds in the project, for JSON Schema enums; empty without a project. */
    assets: (kinds: readonly AssetKindName[]) => readonly AssetId[];
    /** The registered materials themselves, for descriptions. */
    materialDefs: ReadonlyMap<string, MaterialDef>;
    /** Registered material names, in registration order. */
    materials: readonly string[];
    /** Registered type names, in registration order. */
    types: readonly string[];
};
```

Refers to [`MaterialDef`](#materialdef).

## `FlowContext`

_type_ in `game/types.ts`

`EngineContext.flow`: the scene the runtime plays, requests to change it, and sublevels beside it.

```ts
type FlowContext = {
    /** Loads a listed scene's entities beside the main scene, now, with ids `<label>:<id>`. */
    attach(scene: AssetId, opts: SublevelOptions): SublevelResult;
    /** Destroys a sublevel's entities, and the spawns made for it, at the tick's destroy flush. */
    detach(label: string): void;
    /** The entry the request that loaded this scene named, or null. */
    readonly entry: null | string;
    /** The loaded main scene's id; null for a scene loaded without a scene library (bare tests). */
    readonly scene: AssetId | null;
    /**
     * Applied by the host after this tick ends. The first request since the
     * host last took them wins; later ones are dropped with a dev warning.
     */
    request(req: FlowRequest): void;
    sublevels(): readonly SublevelInfo[];
};
```

Refers to [`FlowRequest`](#flowrequest), [`SublevelInfo`](#sublevelinfo), [`SublevelOptions`](#subleveloptions), [`SublevelResult`](#sublevelresult).

## `FlowField`

_type_ in `grid/flow.ts`

```ts
type FlowField = {
    /** Integer cost to the nearest goal; undefined when unreachable. */
    cost(c: Cell): number | undefined;
    /** The neighbour to move to (the cheapest, first in neighbour order on ties); undefined at a goal or unreachable. */
    next(c: Cell): Cell | undefined;
    readonly bounds: CellBounds;
};
```

Refers to [`Cell`](#cell), [`CellBounds`](#cellbounds).

## `FlowRequest`

_type_ in `game/flow.ts`

A scene change game code asks for with `ctx.flow.request`.

```ts
type FlowRequest = {
    /** A marker or any entity id in the next scene; the game reads it in `onLoad` as `ctx.flow.entry`. */
    entry?: string;
    /** Replaces `ctx.persist` before the next load. */
    persist?: JsonValue;
    to: AssetId;
    transition?: TransitionSpec;
};
```

Refers to [`JsonValue`](#jsonvalue), [`TransitionSpec`](#transitionspec).

## `FlowUse`

_type_ in `game/flow.ts`

What a scene is asked to be: the start of a game, the target of a `go`, or a sublevel attached beside one.

```ts
type FlowUse = "attach" | "go" | "start";
```

## `FollowerOptions`

_type_ in `systems/path-follower.ts`

Visuals default to the `body` layer.

```ts
type FollowerOptions = SurfaceDefaults & VisualOptions;
```

Refers to [`VisualOptions`](#visualoptions).

## `FollowerSystem`

_type_ in `systems/path-follower.ts`

```ts
type FollowerSystem = SceneSystem<FollowerEntity> & {
    /**
     * How far the follower moved in the last `beforeStep`, for carrying
     * riders. It holds for every collider on its body, attached ones too.
     */
    frameDelta(id: string): Vec2 | null;
    position(id: string): Vec2 | null;
};
```

Refers to [`SceneSystem`](#scenesystem).

## `ForceAreaBlock`

_type_ in `game/behaviors/force-area.ts`

A `force-area` block as an entity carries it, defaults applied.

```ts
type ForceAreaBlock = z.infer<z.ZodObject<typeof forceAreaFields>>;
```

## `ForceAreaSystem`

_type_ in `game/behaviors/force-area.ts`

```ts
type ForceAreaSystem = BehaviorSystem<ForceAreaBlock> & {
    /**
     * The summed acceleration every area containing `point` gives, m/s²: what
     * a kinematic controller adds. With `entityId`, only the areas whose
     * `affects` takes that entity count, by the rule they push bodies by. The
     * characters add it to their own velocity, which their `decel` then works
     * against while idle: a push weaker than the decel builds no speed, and a
     * stronger one carries the character at the difference.
     */
    sample(point: Vec2, entityId?: string): Vec2;
};
```

Refers to [`BehaviorSystem`](#behaviorsystem), [`ForceAreaBlock`](#forceareablock).

## `FrameRect`

_type_ in `game/behaviors/sprite.ts`

A frame's rectangle in its texture, px.

```ts
type FrameRect = {
    h: number;
    w: number;
    x: number;
    y: number;
};
```

## `GRID_STEP_SAVE_OWNER`

_const_ in `game/save-file.ts`

The owner name a grid stepper saves under in `world.systems`.

```ts
declare const GRID_STEP_SAVE_OWNER = "grid-step";
```

## `GameAttachment`

_type_ in `game/types.ts`

```ts
type GameAttachment = {
    destroy(): void;
    /** Escape in play mode: true when the game had something of its own to cancel, so play goes on. */
    onCancel?(): boolean;
    /** A command from the game's `editorKeys` (or a host button); false when it didn't apply. */
    onCommand?(command: string): boolean;
    onModeChange?(mode: GameMode): void;
    /** Each shell tick in play mode, before the runtime steps. */
    onTick?(dtMs: number, mouseWorld: Vec2): void;
};
```

## `GameCommand`

_type_ in `game/types.ts`

A discrete message to the game, delivered on the next simulated tick.

```ts
type GameCommand = {
    /** Plain JSON, checked by the command's `args` schema. */
    args?: unknown;
    /** A name in GameDefinition.commands, or an engine command ("@elapsed"). */
    name: string;
    /** The seat that sent it; 0 when absent. */
    player?: number;
};
```

## `GameDefinition`

_type_ in `game/types.ts`

```ts
type GameDefinition<S = unknown, G = unknown> = {
    /** Action names and default bindings, in the order tools list them. */
    actions: readonly ActionDef[];
    /** The game's own asset kinds; names are `<gameId>/<name>`, layouts declarative only. */
    assetKinds?: readonly AssetKindDef[];
    /** Play-mode tools in the browser shell, attached after each load. */
    attach?(shell: GameShell, runtime: SceneRuntimeHandle): GameAttachment;
    /** The game's behaviors, after the engine's in registration order; names are `<id>/<name>`. */
    behaviors?: readonly BehaviorDef[];
    /** `.checks.json` kinds, keyed `<id>/<kind>`. */
    checks?: Readonly<Record<string, CheckKindDef>>;
    /**
     * Groups beside the engine's, or more interactions for an engine group
     * (`dynamic: { collidesWith: ["sensor"] }`). Interaction is symmetric, so
     * one side listing the other is enough.
     */
    collisionGroups?: Readonly<Record<string, {
        collidesWith: readonly string[];
    }>>;
    /** Commands the game accepts beside the engine's; names match `COMMAND_NAME_PATTERN`. */
    commands?: Readonly<Record<string, CommandDef>>;
    /** Hashes the game's tuning into `ProbeReport.configHash`. */
    configHash?: string;
    createRuntime(ctx: EngineContext): GameRuntime<S>;
    /** Edit-mode tools and inspector widgets. */
    editor?: GameEditorDef;
    /** Keys the game adds to the editor's keymap; engine bindings win. */
    editorKeys?: readonly GameKeyBinding[];
    /** Matches the id pattern; `engine` is reserved. Prefixes the game's issue codes. */
    id: string;
    /** Seats, sub-tick offsets and the stick deadzone. */
    input?: GameInputDef;
    /** Keys are `<id>/<code>`. */
    issues?: Readonly<Record<string, IssueCodeDef>>;
    /** Scene layers, bottom to top; replaces the engine's four defaults when given. */
    layers?: readonly SceneLayerDef[];
    /** Which swap timings the game accepts for a new version of a running scene; omitted: next load only. */
    live?: LiveDeclaration;
    materials?: Readonly<Record<string, MaterialDef>>;
    /** State that survives every scene change within one instance (`EngineContext.persist`). */
    persist?: GamePersistDef;
    /** Checks that need the physics world, run after the engine's by `validatePhysical`. */
    physicalChecks?: readonly PhysicalCheck[];
    /** Play, playtest and fuzz hooks: outcome, focus, predicates, macros, spawn shape. */
    play?: GamePlayDef<S, G>;
    /**
     * The fields of a prefab's `contract`: what the game promises about a
     * prefab (entry and exit surfaces, required abilities, a proof run).
     * Without them a prefab can't carry a contract.
     */
    prefabContract?: z.ZodRawShape;
    /** Fields the game adds to the project's game-settings doc. */
    projectSettings?: z.ZodRawShape;
    /** The game's resolution policy, under the project's and the host's. */
    resolution?: Partial<ResolutionPolicy>;
    /** The game's save data version, its migrations, limits and own backend. */
    saves?: GameSavesDef;
    /** Fields the game adds to the scene's `settings`; must not redefine `gravity`. */
    settings?: z.ZodRawShape;
    /**
     * Spawn groups in order; types inside one group spawn together in file
     * order (bulk first). Lists each of the game's loadable types once; a
     * primitive it leaves out spawns before every listed group, in primitive
     * order, except `decor` and `nav`, which then spawn last. Omitted means
     * each primitive, then each game type, in registration order.
     */
    spawnOrder?: readonly (EntityTypeName | readonly EntityTypeName[])[];
    /** Data-table schemas by table name. */
    tables?: Readonly<Record<string, GameTableDef>>;
    /** What a new scene of this game starts with; it should validate without errors. */
    template?: SceneTemplate;
    /** How the game's clock runs; omitted: fixed at 60. */
    time?: TimeModel;
    /** The game's entity types. Primitives are always present and can't be redefined. */
    types: readonly EntityTypeDef[];
    validators?: readonly SceneValidator[];
    /** The game's world defaults, under the project's and each scene's settings. */
    world?: GameWorldDef;
};
```

Refers to [`ActionDef`](#actiondef), [`AssetKindDef`](#assetkinddef), [`BehaviorDef`](#behaviordef), [`CheckKindDef`](#checkkinddef), [`CommandDef`](#commanddef), [`EngineContext`](#enginecontext), [`EntityTypeDef`](#entitytypedef), [`GameAttachment`](#gameattachment), [`GameEditorDef`](#gameeditordef), [`GameInputDef`](#gameinputdef), [`GameKeyBinding`](#gamekeybinding), [`GamePersistDef`](#gamepersistdef), [`GamePlayDef`](#gameplaydef), [`GameRuntime`](#gameruntime), [`GameSavesDef`](#gamesavesdef), [`GameShell`](#gameshell), [`GameTableDef`](#gametabledef), [`GameWorldDef`](#gameworlddef), [`IssueCodeDef`](#issuecodedef), [`LiveDeclaration`](#livedeclaration), [`MaterialDef`](#materialdef), [`PhysicalCheck`](#physicalcheck), [`SceneLayerDef`](#scenelayerdef), [`SceneRuntimeHandle`](#sceneruntimehandle), [`SceneTemplate`](#scenetemplate), [`SceneValidator`](#scenevalidator), [`TimeModel`](#timemodel).

## `GameEditorDef`

_type_ in `game/types.ts`

A game's additions to the editor.

```ts
type GameEditorDef = {
    /** What a dropped asset becomes in this game's scenes; null falls back to the engine's. */
    assetDrop?: (drop: AssetDrop) => EntityInput | InstanceInput | null;
    /**
     * Tools beside the engine's, loaded only when an editor opens (a dynamic
     * `import()`), so editor code never reaches a game's play bundle. A tool
     * is picked by an edit-scope `editorKeys` binding whose command is
     * `tool:<id>`, or by a host button.
     */
    tools?: () => Promise<readonly EditorToolDef[]>;
    /** Widgets by id, as fields name them in `meta.widget`. */
    widgets?: Readonly<Record<string, InspectorWidgetDef>>;
};
```

Refers to [`EditorToolDef`](#editortooldef), [`InspectorWidgetDef`](#inspectorwidgetdef).

## `GameInputDef`

_type_ in `game/types.ts`

How a game reads its input (`GameDefinition.input`).

```ts
type GameInputDef = {
    /** Radial stick deadzone, 0…1; default 0.15. */
    deadzone?: number;
    /** Default `{ max: 1, join: "auto" }`: every device drives seat 0. */
    players?: PlayersDef;
    /** Record sub-tick offsets (rhythm games); default false. */
    subTick?: boolean;
};
```

Refers to [`PlayersDef`](#playersdef).

## `GameKeyBinding`

_type_ in `game/types.ts`

A key the game binds in the editor's keymap (a palette of the game's own
tools). `key` is a chord: optional `Shift+`, `Alt+` and `Mod+` (Ctrl or
Cmd) prefixes, in that order, then a `KeyboardEvent.key` (single
characters lowercase): `"1"`, `"Tab"`, `"Mod+g"`. An engine binding in the
same scope wins and the game's is reported as shadowed.

```ts
type GameKeyBinding = {
    /** Delivered to `GameAttachment.onCommand`. */
    command: string;
    description: string;
    key: string;
    scope: "edit" | "play";
};
```

## `GameOutcome`

_type_ in `game/types.ts`

A game's verdict: one of its declared `results`, with what caused it.

```ts
type GameOutcome = {
    cause?: string;
    entityId?: string;
    result: string;
};
```

## `GamePersistDef`

_type_ in `game/types.ts`

`GameDefinition.persist`.

```ts
type GamePersistDef = {
    /** The value a new game starts with; also what `flow.restart()` resets to. */
    initial: () => JsonValue;
    /** Checked on `set` in dev and headless, and on a save's load. */
    schema?: z.ZodType;
};
```

Refers to [`JsonValue`](#jsonvalue).

## `GamePlayDef`

_type_ in `game/types.ts`

How a game plays: what Play, `runPlaytest` and `fuzz` ask it. Every hook is optional.

```ts
type GamePlayDef<S = unknown, G = unknown> = {
    /**
     * The commands a run may send now, in a stable order. Fuzz picks among
     * them; `scene step --legal` prints them. Before a run's first tick (fuzz's
     * first macro, a playtest that ran none) `state.tick` is -1 and `events` is
     * empty.
     */
    commands?(state: PlayState<S>): readonly GameCommand[];
    /** The position trails, stuck detection and fuzz follow; `null` while there is none. */
    focus?(snapshot: S): Vec2 | null;
    /**
     * The next fuzz macro; omitted, fuzz holds one or two random button actions
     * for 4–60 ticks, and sets the game's axis and vector actions and moves the
     * pointer when it has them (`defaultFuzzMacro`); with `commands` and no
     * macro, fuzz sends one legal command per macro instead (every macro on a
     * turns clock, half otherwise).
     */
    macro?(rng: MacroRandom, actions: readonly string[]): Macro;
    /** Event types a recording keeps as markers for the ghost; omitted, every event but `entity:*`. */
    markers?: readonly string[];
    /** Actions that move the focus: holding one with under 4px of displacement over 120 ticks is `stuck`. */
    movementActions?: readonly string[];
    /** The schema of `PlayOptions.game` (abilities and the like) and of an input script's `game` key. */
    options?: z.ZodType<G>;
    /** Called after every tick; a non-null result ends the run with it. The engine never decides one. */
    outcome?(state: PlayState<S>): GameOutcome | null;
    /** `until` predicates beside the engine's `ENGINE_PREDICATES`. */
    predicates?: Readonly<Record<string, ScriptPredicate<S>>>;
    /** Results `outcome` may return; they can't reuse `ENGINE_RUN_RESULTS`. */
    results?: readonly string[];
    /** Cast from the cursor along its `cast` for "play from here"; without it `at` is used as given. */
    spawnShape?: SpawnShape;
};
```

Refers to [`GameCommand`](#gamecommand), [`GameOutcome`](#gameoutcome), [`Macro`](#macro), [`MacroRandom`](#macrorandom), [`PlayState`](#playstate), [`ScriptPredicate`](#scriptpredicate), [`SpawnShape`](#spawnshape).

## `GameRuntime`

_type_ in `game/types.ts`

A game's per-runtime state and hooks, created once per runtime.

```ts
type GameRuntime<S = unknown> = {
    /** After the systems' `afterStep`; `events` holds this tick's events so far. */
    afterStep?(dtMs: number, events: readonly StepEvent[]): void;
    /** After the systems' `beforeStep`, before the physics step; `commands` are the ones queued for this tick. */
    beforeStep?(dtMs: number, actions: InputAction[], commands: readonly GameCommand[]): void;
    /** turns/event: keep stepping at `rate` after the tick an input woke. Ignored for fixed. */
    busy?(): boolean;
    /** Where the shell's camera follows; `null` keeps it still. */
    cameraTarget?(): Vec2 | null;
    /** What the game's debug layers read each tick. */
    debugInfo?(): unknown;
    destroy?(): void;
    /** After every entity spawned, before the first step; spawn actors here. */
    onLoad?(scene: ExpandedScene): void;
    /** After a new version of the running scene was applied, before the next tick; outside a step. */
    onSwap?(swap: SceneSwap): void;
    /** Before `onLoad` of the next scene, and on destroy. Remove what `onLoad` made. */
    onUnload?(): void;
    /**
     * Rebuilds the game's state from `snapshot()` output; any save needs it to
     * restore game state. A save's text sorts every object's keys by code unit,
     * so `state` comes back with its keys sorted, not in the order `snapshot()`
     * wrote them. `snapshotDigest` hashes the snapshot's JSON as written, key
     * order included: a game that iterates a record or wants its digests to
     * match the run that saved puts its own key order back here.
     */
    restore?(state: S): void;
    /** What `StepResult.game` and `ProbeReport.final` carry; plain JSON. */
    snapshot(): S;
    /** The game's slice of the shell's store, read once per tick. Return the same object when nothing changed. */
    storeSlice?(): unknown;
};
```

Refers to [`GameCommand`](#gamecommand), [`SceneSwap`](#sceneswap), [`StepEvent`](#stepevent).

## `GameSavesDef`

_type_ in `game/types.ts`

`GameDefinition.saves`.

```ts
type GameSavesDef = {
    /** Raises or lowers the engine defaults; the browser stores cap at `MAX_BROWSER_SAVE_LIMITS`. */
    limits?: Partial<SaveLimits>;
    /** Keyed by the version each migrates from, to that version + 1. */
    migrations?: Readonly<Record<number, (data: SaveGameData) => SaveGameData>>;
    /** The game's own save backend: wins over the host's and the browser's. */
    store?: () => SaveStore;
    /** The game's save-data version; bump it and add a migration when `snapshot()` or `persist` changes shape. */
    version: number;
};
```

Refers to [`SaveGameData`](#savegamedata), [`SaveLimits`](#savelimits).

## `GameShell`

_type_ in `game/types.ts`

The parts of the browser shell a game attaches its play-mode tools to.

```ts
type GameShell = {
    dev: boolean;
    getMode: () => GameMode;
    /** Play-mode tools register here as `TOOL_PRIORITY.game` consumers. */
    router: ToolRouter;
    /** Queues a command for the next simulated tick; false (and a dev warning) when not playing, unknown, or its args don't parse. */
    send: (command: GameCommand) => boolean;
    /** The current scene's view, the one the runtime's systems draw into. */
    view: SceneView;
};
```

Refers to [`GameCommand`](#gamecommand), [`SceneView`](#sceneview), [`ToolRouter`](#toolrouter).

## `GameTableDef`

_type_ in `game/types.ts`

A data table a game declares: what a row of that table holds beside its `id`.

```ts
type GameTableDef = {
    description: string;
    row: z.ZodRawShape;
};
```

## `GameWorldDef`

_type_ in `game/types.ts`

A game's world defaults (`GameDefinition.world`).

```ts
type GameWorldDef = {
    /** m/s²; y is down. */
    gravity?: Pt;
    grid?: GridSettings;
    /** Cells covered by these types' shapes become grid walls at load; default ["solid"], [] for none. */
    gridWalls?: readonly EntityTypeName[];
    /** px per metre: world metres to the resolution's virtual px; the simulation is in metres; default 100. */
    lengthUnit?: number;
    physics?: "none" | "rapier";
};
```

Refers to [`GridSettings`](#gridsettings).

## `GeometryColliderDesc`

_type_ in `runtime/geometry-world.ts`

```ts
type GeometryColliderDesc = {
    body: "kinematic" | "static";
    /** A registered collision group name; default "static", or "sensor" for sensors. */
    group?: string;
    pose?: {
        rot: number;
        x: number;
        y: number;
    };
    sensor?: boolean;
    /** Local to the pose for box, circle and capsule (centred on 0, 0); world for poly and chain at pose (0, 0). */
    shape: ShapeObj;
};
```

## `GeometryWorld`

_interface_ in `runtime/geometry-world.ts`

The engine's own colliders, for a scene loaded without physics.

```ts
interface GeometryWorld {
    /** A handle from the world's own counter; `ctx.tags` maps it like a Rapier handle. */
    add(desc: GeometryColliderDesc): number;
    setPose(handle: number, x: number, y: number, rot?: number): void;
    setEnabled(handle: number, enabled: boolean): void;
    remove(handle: number): void;
    /** The world-space shape now. */
    shape(handle: number): ShapeObj | undefined;
    /**
     * Packed like Rapier's `InteractionGroups`: membership in the high 16 bits,
     * filter in the low. 0 while the collider is disabled or gone.
     */
    groups(handle: number): number;
    /** In insertion order. */
    handles(): IterableIterator<number>;
    clear(): void;
    readonly size: number;
}
```

Refers to [`GeometryColliderDesc`](#geometrycolliderdesc).

## `GridFieldInfo`

_type_ in `game/fields.ts`

What a gridField's cells may hold: `values` names cells 1..n, `max` is the largest value.

```ts
type GridFieldInfo = {
    max: number;
    values: readonly string[];
};
```

## `GridGeometry`

_interface_ in `grid/geometry.ts`

```ts
interface GridGeometry {
    readonly settings: GridSettings;
    /** Fixed order: square N, E, S, W, then NE, SE, SW, NW with diagonals; hex the six edges clockwise from the top (or top-right). */
    neighbors(c: Cell, diagonals?: boolean): Cell[];
    /** 10 for an edge neighbour, 14 for a diagonal. */
    stepCost(a: Cell, b: Cell): number;
    /** Admissible: octile (10/14) on squares, 10 × hex distance on hexes. */
    heuristic(a: Cell, b: Cell): number;
    /** Steps between cells (Chebyshev with diagonals, else Manhattan; hex distance). */
    distance(a: Cell, b: Cell, diagonals?: boolean): number;
    /** World metres, as Tiled places cells (origin, cell size, hex side and stagger). */
    center(c: Cell): Pt;
    /** The cell whose centre is nearest, as Tiled picks it; a point on a square's edge goes to the higher cell. */
    cellAt(p: Pt): Cell;
    /** Clockwise on screen: a square from its top-left, a hex from its top (or left) vertex. */
    corners(c: Cell): Pt[];
    /**
     * Every cell a segment between centres passes through, both ends included:
     * supercover on squares (a segment through a corner takes both cells beside
     * it), cube lerp on hexes. Ties go the same way from either end, so
     * `line(b, a)` is `line(a, b)` reversed.
     */
    line(a: Cell, b: Cell): Cell[];
    /** Cells whose centre a shape contains (rasterising solids), row by row. */
    cellsIn(shape: ShapeObj): Cell[];
    /** The cells a world rectangle covers. */
    rect(bounds: Bounds): CellBounds;
}
```

Refers to [`Cell`](#cell), [`CellBounds`](#cellbounds), [`GridSettings`](#gridsettings).

## `GridPath`

_type_ in `grid/path.ts`

```ts
type GridPath = {
    cells: Cell[];
    cost: number;
    expanded: number;
};
```

Refers to [`Cell`](#cell).

## `GridPathOptions`

_type_ in `grid/path.ts`

```ts
type GridPathOptions = {
    bounds?: CellBounds;
    /** Extra integer cost to enter `to` (added to stepCost); null: impassable. */
    cost?: (from: Cell, to: Cell) => null | number;
    /** With diagonals: may a diagonal step pass between two blocked edge neighbours? Default false. */
    cutCorners?: boolean;
    diagonals?: boolean;
    /** Give up after expanding this many cells; default 65,536. */
    maxExpanded?: number;
    /** Default: RuntimeGrid.passable when called through ctx.grid, else every cell in `bounds`. */
    passable?: (c: Cell) => boolean;
};
```

Refers to [`Cell`](#cell), [`CellBounds`](#cellbounds).

## `GridPlace`

_type_ in `runtime/grid.ts`

A cell, or an entity's cell: the one its spawn pose falls in.

```ts
type GridPlace = {
    at: Pt;
    cell: Cell;
    label: string;
    ref?: string;
};
```

Refers to [`Cell`](#cell).

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

## `GridStepper`

_interface_ in `motion/grid-step.ts`

Moves an entity cell to cell, one neighbour at a time.

```ts
interface GridStepper {
    cell(): Cell;
    moving(): boolean;
    /** Starts a step to a neighbour; false when it's moving, blocked or not a neighbour. Reserves the cell at once. */
    step(to: Cell): boolean;
    /** Advances the step; call once per tick. Lerps exactly by whole ticks. */
    update(dtMs: number): void;
}
```

Refers to [`Cell`](#cell).

## `ID_PATTERN`

_const_ in `game/fields.ts`

Ids, scene names and game ids. `~` can never match, so a bulk reference is never a real id.

```ts
declare const ID_PATTERN: RegExp;
```

## `InputState`

_interface_ in `input/state.ts`

Each seat's actions and pointer for the tick being simulated (`EngineContext.input`).

```ts
interface InputState {
    held(action: string, player?: number): boolean;
    /** Went down this tick. */
    pressed(action: string, player?: number): boolean;
    released(action: string, player?: number): boolean;
    /** An axis's value, or 0/1 for a button. */
    value(action: string, player?: number): number;
    vector(action: string, player?: number): Vec2;
    pointer(player?: number): PointerState | null;
    players(): readonly PlayerInfo[];
    /** The tick's commands, the engine's (`@elapsed`, `@nav`) among them, in the order the tick holds them. */
    commands(): readonly GameCommand[];
}
```

Refers to [`GameCommand`](#gamecommand), [`PlayerInfo`](#playerinfo), [`PointerState`](#pointerstate).

## `InspectorWidgetDef`

_type_ in `game/types.ts`

How the inspector draws a field a game marks with `.meta({ widget: id })`.
The engine only describes the widget and the site renders it, so a game
never ships UI code (React stays in the site).

```ts
type InspectorWidgetDef = {
    format?: "json" | "text";
    kind: "readonly";
} | {
    kind: "choice";
    options: readonly {
        description?: string;
        label: string;
        value: number | string;
    }[];
} | {
    kind: "color";
} | {
    kind: "slider";
    max: number;
    min: number;
    step?: number;
    unit?: string;
};
```

## `InstantiateOptions`

_type_ in `game/types.ts`

```ts
type InstantiateOptions = {
    flip?: boolean;
    /** `<prefab>#<label>`; omitted, the next `<prefab>#<n>`. */
    id?: string;
    layer?: string;
    overrides?: Readonly<Record<OverridePath, unknown>>;
    params?: Readonly<Record<string, unknown>>;
    rot?: 0 | 1 | 2 | 3;
    z?: number;
};
```

## `InstantiateResult`

_type_ in `game/types.ts`

The instance id and its children's ids, in spawn order.

```ts
type InstantiateResult = {
    entities: readonly string[];
    id: string;
};
```

## `IssueCodeDef`

_type_ in `game/types.ts`

```ts
type IssueCodeDef = IssueCodeInfo;
```

## `JOINT`

_const_ in `game/behaviors/joint.ts`

```ts
declare const JOINT: BehaviorDef<{
    anchorA: z.ZodOptional<z.ZodType<Pt, unknown, z.core.$ZodTypeInternals<Pt, unknown>>>;
    anchorB: z.ZodOptional<z.ZodType<Pt, unknown, z.core.$ZodTypeInternals<Pt, unknown>>>;
    axis: z.ZodOptional<z.ZodType<Pt, unknown, z.core.$ZodTypeInternals<Pt, unknown>>>;
    collide: z.ZodDefault<z.ZodBoolean>;
    damping: z.ZodOptional<z.ZodNumber>;
    kind: z.ZodEnum<{
        prismatic: "prismatic";
        revolute: "revolute";
        rope: "rope";
        spring: "spring";
        weld: "weld";
    }>;
    length: z.ZodOptional<z.ZodNumber>;
    limits: z.ZodOptional<z.ZodTuple<[
        z.ZodNumber,
        z.ZodNumber
    ], null>>;
    motor: z.ZodOptional<z.ZodObject<{
        maxForce: z.ZodNumber;
        velocity: z.ZodNumber;
    }, z.core.$strict>>;
    stiffness: z.ZodOptional<z.ZodNumber>;
    to: z.ZodType<string, unknown, z.core.$ZodTypeInternals<string, unknown>>;
}>;
```

Refers to [`BehaviorDef`](#behaviordef).

## `JOINT_KINDS`

_const_ in `game/behaviors/joint.ts`

Rapier's joint constructors, by what they do.

```ts
declare const JOINT_KINDS: readonly [
    "revolute",
    "prismatic",
    "rope",
    "weld",
    "spring"
];
```

## `JointBlock`

_type_ in `game/behaviors/joint.ts`

A `joint` block as an entity carries it, defaults applied.

```ts
type JointBlock = z.infer<z.ZodObject<typeof jointFields>>;
```

## `JointKind`

_type_ in `game/behaviors/joint.ts`

```ts
type JointKind = (typeof JOINT_KINDS)[number];
```

Refers to [`JOINT_KINDS`](#joint_kinds).

## `JointSystem`

_type_ in `game/behaviors/joint.ts`

```ts
type JointSystem = BehaviorSystem<JointBlock> & {
    /** Whether the entity's joint exists now: both bodies are live and enabled. */
    joined(entityId: string): boolean;
};
```

Refers to [`BehaviorSystem`](#behaviorsystem), [`JointBlock`](#jointblock).

## `JsonValue`

_type_ in `game/types.ts`

Plain JSON: what persistent state, saves and snapshots hold.

```ts
type JsonValue = JsonValue[] | boolean | null | number | string | {
    [key: string]: JsonValue;
};
```

## `KEY_CODES`

_const_ in `game/input-codes.ts`

W3C UI Events `KeyboardEvent.code` values: "KeyA"…"KeyZ", "Digit0"…"Digit9", "Space", "Enter", "ShiftLeft", "ArrowUp", "Numpad0", "F1"…

```ts
declare const KEY_CODES: readonly string[];
```

## `KEY_TO_CODE`

_const_ in `game/input-codes.ts`

US-layout `KeyboardEvent.key` (single characters lowercase, as 0.x
bindings matched them) → every `code` that produced it, for 0.x `keys`
bindings: "Shift" is both Shifts, "1" the digit row and the numpad.

```ts
declare const KEY_TO_CODE: Readonly<Record<string, readonly string[]>>;
```

## `KinematicMotion`

_type_ in `runtime/bodies-control.ts`

What the owner of a kinematic body reports and takes: `kinematicBodyEntry`'s `motion`.

```ts
type KinematicMotion = {
    /** rad/s; left out, with `setAngularVelocity`, for a body that never turns (a character's). */
    angularVelocity?(): number;
    setAngularVelocity?(w: number): void;
    /** Left out when the owner sets the velocity itself (a path). */
    setVelocity?(v: Vec2): void;
    /** m/s. */
    velocity(): Vec2;
    wake?(): void;
};
```

## `LIFETIME`

_const_ in `game/behaviors/lifetime.ts`

```ts
declare const LIFETIME: BehaviorDef<{
    ms: z.ZodOptional<z.ZodNumber>;
    then: z.ZodOptional<z.ZodEnum<{
        destroy: "destroy";
        disable: "disable";
    }>>;
    ticks: z.ZodOptional<z.ZodNumber>;
}>;
```

Refers to [`BehaviorDef`](#behaviordef).

## `LIVE_DEFAULTS`

_const_ in `game/live.ts`

How long staging may take, Live in Play's debounce, and where and how long the swap check runs.

```ts
declare const LIVE_DEFAULTS: {
    readonly checkAt: readonly [
        0.25,
        0.5,
        0.75
    ];
    readonly checkTicks: 120;
    readonly livePlayDebounceMs: 300;
    readonly preloadTimeoutMs: 60000;
};
```

## `LibraryScene`

_type_ in `game/flow.ts`

A listed scene as a host resolves it: its definition and the prefabs its instances name.

```ts
type LibraryScene = {
    def: SceneDefinition;
    prefabs: PrefabLibrary;
};
```

## `LifetimeBlock`

_type_ in `game/behaviors/lifetime.ts`

A `lifetime` block as an entity carries it.

```ts
type LifetimeBlock = z.infer<z.ZodObject<typeof lifetimeFields>>;
```

## `LiveContext`

_type_ in `game/types.ts`

`EngineContext.live`.

```ts
type LiveContext = {
    /** Inside a step: this is a safe moment to change the level (a respawn, a turn's end, a checkpoint). */
    boundary(label?: string): void;
    /** The running main scene's version; null when it is the release's own. */
    readonly version: Sha256 | null;
};
```

## `LiveDeclaration`

_type_ in `game/live.ts`

`GameDefinition.live`: which timings the game accepts and what must hold after a swap.

```ts
type LiveDeclaration = {
    /** Invariants the swap check and Live in Play run right after a swap and `LIVE_CHECK_AGAIN_TICKS` later. */
    check?(ctx: EngineContext): readonly SceneIssue[];
    /** "next-load" is always allowed; list "boundary" and "now" to accept them. */
    timings: readonly SwapTiming[];
};
```

Refers to [`EngineContext`](#enginecontext), [`SwapTiming`](#swaptiming).

## `LoadFailureReason`

_type_ in `runtime/types.ts`

Why a load failed, when it wasn't a plain error. `spawn-blocked`: a play
start `at` lies inside a solid. `physics-required`: an entity needs physics
the scene runs without. `physics-not-loaded`: the scene needs Rapier and
the host gave none.

```ts
type LoadFailureReason = "physics-not-loaded" | "physics-required" | "spawn-blocked";
```

## `MAX_BROWSER_SAVE_LIMITS`

_const_ in `game/save-file.ts`

The most a game may raise its limits to in the browser's stores.

```ts
declare const MAX_BROWSER_SAVE_LIMITS: SaveLimits;
```

Refers to [`SaveLimits`](#savelimits).

## `MAX_TICK_RATE`

_const_ in `game/time.ts`

```ts
declare const MAX_TICK_RATE = 240;
```

## `MIN_TICK_RATE`

_const_ in `game/time.ts`

```ts
declare const MIN_TICK_RATE = 1;
```

## `MOTION_SAVE_OWNER`

_const_ in `game/save-file.ts`

The owner name a motion body saves under in `world.systems`.

```ts
declare const MOTION_SAVE_OWNER = "motion";
```

## `Macro`

_type_ in `game/types.ts`

One fuzz macro: actions held together for `ticks` ticks (an empty `hold` waits).

```ts
type Macro = {
    hold: readonly string[];
    /** A pointer move, press or drag over the macro's ticks. */
    pointer?: ScriptPointer;
    /** Axis and vector values held with it. */
    set?: AnalogSet;
    ticks: number;
};
```

## `MacroRandom`

_type_ in `game/types.ts`

The slice of the seeded generator (`@jams/engine/sim-kit`'s `Rng`) a macro generator draws from.

```ts
type MacroRandom = {
    /** A uniform integer in `[0, bound)`. */
    below(bound: number): number;
    pick<T>(items: readonly T[]): T;
    /** A uniform integer in `[lo, hi]`. */
    range(lo: number, hi: number): number;
};
```

## `MarkerEntity`

_type_ in `systems/marker.ts`

```ts
type MarkerEntity = RuntimeEntity<{
    at: Pt;
    tags?: string[];
}>;
```

## `MarkerSystem`

_type_ in `systems/marker.ts`

```ts
type MarkerSystem = DataSystem<MarkerEntity>;
```

Refers to [`DataSystem`](#datasystem), [`MarkerEntity`](#markerentity).

## `MaterialDef`

_type_ in `game/types.ts`

```ts
type MaterialDef = {
    /** A sprite's blend mode when its block sets none. */
    blend?: BlendMode;
    description: string;
    friction: number;
    /** Launch velocity on contact, m/s; y is down, so a bounce is negative y. */
    impulse?: Vec2;
    restitution: number;
    /** Wins over the entity type's style for a body of this material. */
    style?: Style;
    /** A sprite's tint when its block sets none, 0xRRGGBB. */
    tint?: number;
};
```

Refers to [`Style`](#style).

## `MotionBody`

_interface_ in `motion/body.ts`

A body moved by code that writes its entity's pose.

```ts
interface MotionBody {
    readonly entityId: string;
    readonly handle: number;
    position(): Vec2;
    /** Moves by `delta`, sliding along what it hits (at most 4 iterations); writes the pose index. */
    move(delta: Vec2, opts?: {
        slide?: boolean;
    }): MotionResult;
    /** Puts it at (x, y) with no sweep; the pose snaps. */
    teleport(x: number, y: number): void;
    /**
     * Whether its last move ended against something facing its controller's
     * `up`: on Rapier, `PhysicsWorld.isGrounded` for its controller; without
     * physics, a hit of that move whose normal faces `up`. False after a
     * teleport, a restore, or a move while disabled, until it moves again.
     * Every `createMotionBody` body answers it; it is optional so a body a
     * game writes itself (for `createGridStepper`, say) still fits.
     */
    grounded?(): boolean;
    /** A disabled body is out of the world: nothing hits it, and its moves travel in full. */
    setEnabled(enabled: boolean): void;
    /** m/s, kept for the controller moving it (`createTopDownController`); a world save keeps it. */
    velocity(): Vec2;
    setVelocity(v: Vec2): void;
    /** Takes it out of the world and `ctx.bodies`, and forgets the entity's `oneWayPasses`. */
    destroy(): void;
}
```

Refers to [`MotionResult`](#motionresult).

## `MotionBodyOptions`

_type_ in `motion/body.ts`

```ts
type MotionBodyOptions = {
    /**
     * The Rapier character controller that moves it, set up exactly as given
     * (`pushDynamic` is Rapier's `applyImpulsesToDynamicBodies`). Default
     * `TOP_DOWN_CONTROLLER`, which climbs and slides along every slope: a
     * top-down body has no up. Without physics only `offset`, the gap kept
     * from what it hits, and `up`, for `grounded`, apply.
     */
    controller?: CharacterControllerOptions;
    /** Collision group name; default "dynamic". */
    group?: string;
    /** Local, centred on 0, 0; not chain. */
    shape: ShapeObj;
    /** Merged into the collider's tag (entityId and type come from the entity). */
    tag?: Partial<ColliderTag>;
};
```

Refers to [`CharacterControllerOptions`](#charactercontrolleroptions), [`ColliderTag`](#collidertag).

## `MotionResult`

_type_ in `motion/body.ts`

```ts
type MotionResult = {
    /** True when the full delta couldn't be travelled. */
    blocked: boolean;
    hits: SpaceCastHit[];
    /** What it actually moved. */
    moved: Vec2;
};
```

Refers to [`SpaceCastHit`](#spacecasthit).

## `NAV_AGENT`

_const_ in `game/behaviors/nav-agent.ts`

```ts
declare const NAV_AGENT: BehaviorDef<{
    arrive: z.ZodDefault<z.ZodNumber>;
    radius: z.ZodDefault<z.ZodNumber>;
    repathTicks: z.ZodDefault<z.ZodNumber>;
    separation: z.ZodDefault<z.ZodNumber>;
    speed: z.ZodDefault<z.ZodNumber>;
    to: z.ZodOptional<z.ZodUnion<readonly [
        z.ZodTuple<[
            z.ZodNumber,
            z.ZodNumber
        ], null>,
        z.ZodType<string, unknown, z.core.$ZodTypeInternals<string, unknown>>
    ]>>;
}>;
```

Refers to [`BehaviorDef`](#behaviordef).

## `NAV_ARRIVED`

_const_ in `runtime/types.ts`

A nav agent reached its destination: `entityId` the agent, `other` the entity it followed.

```ts
declare const NAV_ARRIVED = "nav:arrived";
```

## `NAV_BLOCKED`

_const_ in `runtime/types.ts`

A nav agent gave up: `data.reason` is `no-path`, `stuck` or `gone`.

```ts
declare const NAV_BLOCKED = "nav:blocked";
```

## `NAV_COMMAND`

_const_ in `game/commands.ts`

The engine command a script's or a check's `nav` sends: the `nav-agent` system reads it at the start of the tick.

```ts
declare const NAV_COMMAND = "@nav";
```

## `NavAgentBlock`

_type_ in `game/behaviors/nav-agent.ts`

A `nav-agent` block as an entity carries it, defaults applied.

```ts
type NavAgentBlock = z.infer<z.ZodObject<typeof navAgentFields>>;
```

## `NavAgentSystem`

_type_ in `game/behaviors/nav-agent.ts`

```ts
type NavAgentSystem = BehaviorSystem<NavAgentBlock> & {
    /** The waypoints left on its route, world m; null with no destination. */
    path(entityId: string): null | readonly Vec2[];
    /** Walks to a point, world m, or follows an entity by id; raises nav:arrived or nav:blocked. */
    setDestination(entityId: string, to: Vec2 | string): void;
    /** Stops where it is and forgets its destination. */
    stop(entityId: string): void;
};
```

Refers to [`BehaviorSystem`](#behaviorsystem), [`NavAgentBlock`](#navagentblock).

## `NavDestination`

_type_ in `game/commands.ts`

Where a `nav` step, a check's `nav` or the `@nav` command sends a nav agent.

```ts
type NavDestination = {
    /** The nav agent's entity id. */
    id: string;
    /** A point, world m, or an entity id it follows. */
    to: [
        x: number,
        y: number
    ] | string;
};
```

## `NavEntity`

_type_ in `systems/nav.ts`

```ts
type NavEntity = RuntimeEntity<{
    mode?: "block" | "walk";
    shape: ShapeObj;
    tags?: string[];
}>;
```

## `NavIssue`

_type_ in `nav/navmesh.ts`

```ts
type NavIssue = {
    entityIds: string[];
    message: string;
};
```

## `NavMesh`

_type_ in `nav/navmesh.ts`

```ts
type NavMesh = {
    /** Per triangle, the walk area's entity id. */
    areaOf: readonly string[];
    /** Per triangle, the triangles sharing an edge with it, in edge order. */
    neighbors: readonly (readonly number[])[];
    triangles: readonly (readonly [
        Pt,
        Pt,
        Pt
    ])[];
};
```

## `NavPolygon`

_type_ in `systems/nav.ts`

A nav polygon as the mesh builder takes it.

```ts
type NavPolygon = {
    id: string;
    pts: readonly Pt[];
};
```

## `NavSystem`

_type_ in `systems/nav.ts`

```ts
type NavSystem = SceneSystem<NavEntity> & {
    /** Live walk areas in spawn order. */
    areas(): NavPolygon[];
    /** Live block polygons (holes) in spawn order. */
    holes(): NavPolygon[];
    /** The runtime's mesh over every nav system, kept on the first one and keyed by their revisions. */
    memo: null | {
        key: string;
        nav: RuntimeNav | null;
    };
    /** Bumped on every change to the areas or holes, so a mesh over them knows when to rebuild. */
    revision(): number;
};
```

Refers to [`NavEntity`](#naventity), [`NavPolygon`](#navpolygon), [`RuntimeNav`](#runtimenav), [`SceneSystem`](#scenesystem).

## `OCCUPANT`

_const_ in `game/behaviors/occupant.ts`

```ts
declare const OCCUPANT: BehaviorDef<{
    blocks: z.ZodOptional<z.ZodBoolean>;
}>;
```

Refers to [`BehaviorDef`](#behaviordef).

## `Occupancy`

_interface_ in `grid/occupancy.ts`

Who stands on which cell, and which cells are walls.

```ts
interface Occupancy {
    /** Places or moves `id`; `blocks` (default true) makes the cell impassable to paths. */
    place(id: string, cell: Cell, opts?: {
        blocks?: boolean;
    }): void;
    remove(id: string): void;
    /** Ids in placement order. */
    at(cell: Cell): readonly string[];
    cellOf(id: string): Cell | undefined;
    blocked(cell: Cell): boolean;
    setWall(cell: Cell, wall: boolean): void;
    wall(cell: Cell): boolean;
    clear(): void;
}
```

Refers to [`Cell`](#cell).

## `OccupantBlock`

_type_ in `game/behaviors/occupant.ts`

An `occupant` block as an entity carries it.

```ts
type OccupantBlock = z.infer<z.ZodObject<typeof occupantFields>>;
```

## `OverlapTracker`

_type_ in `systems/bodies.ts`

Raises a sensor's `sensor:enter` and `sensor:exit` from what overlapped it before and now.

```ts
type OverlapTracker = {
    /**
     * Enter for each handle in `now` and not `before`, then exit for each in
     * `before` and not `now`, each at `at(handle)`, with the handle's entity
     * as `other`.
     */
    diff(id: string, before: Overlaps, now: Overlaps, at: (handle: number) => Vec2): void;
};
```

Refers to [`Overlaps`](#overlaps).

## `Overlaps`

_type_ in `systems/bodies.ts`

Overlapping collider handle → the entity id its tag names.

```ts
type Overlaps = Map<number, string | undefined>;
```

## `PAD_AXES`

_const_ in `game/input-codes.ts`

The standard mapping's stick axes, in index order.

```ts
declare const PAD_AXES: readonly [
    "left-x",
    "left-y",
    "right-x",
    "right-y"
];
```

## `PAD_BUTTONS`

_const_ in `game/input-codes.ts`

The W3C standard gamepad mapping's buttons, in index order.

```ts
declare const PAD_BUTTONS: readonly [
    "south",
    "east",
    "west",
    "north",
    "lb",
    "rb",
    "lt",
    "rt",
    "select",
    "start",
    "ls",
    "rs",
    "dpad-up",
    "dpad-down",
    "dpad-left",
    "dpad-right",
    "home"
];
```

## `PATH_FOLLOW`

_const_ in `game/behaviors/path-follow.ts`

```ts
declare const PATH_FOLLOW: BehaviorDef<{
    path: z.ZodObject<{
        mode: z.ZodEnum<{
            loop: "loop";
            ping_pong: "ping_pong";
        }>;
        pauseMs: z.ZodOptional<z.ZodNumber>;
        pts: z.ZodArray<z.ZodTuple<[
            z.ZodNumber,
            z.ZodNumber
        ], null>>;
        speed: z.ZodNumber;
    }, z.core.$strict>;
}>;
```

Refers to [`BehaviorDef`](#behaviordef).

## `PLAYER_INPUT`

_const_ in `game/behaviors/player-input.ts`

```ts
declare const PLAYER_INPUT: BehaviorDef<{
    seat: z.ZodDefault<z.ZodNumber>;
}>;
```

Refers to [`BehaviorDef`](#behaviordef).

## `PLAYER_JOINED`

_const_ in `runtime/types.ts`

A device took a seat.

```ts
declare const PLAYER_JOINED = "player:joined";
```

## `PLAYER_LEFT`

_const_ in `runtime/types.ts`

A seat's device left it (a pad disconnected, or the host freed it).

```ts
declare const PLAYER_LEFT = "player:left";
```

## `POINTER_BUTTONS`

_const_ in `game/input-codes.ts`

```ts
declare const POINTER_BUTTONS: readonly [
    "primary",
    "secondary",
    "middle"
];
```

## `PRIMITIVE_TYPES`

_const_ in `game/types.ts`

Entity types the engine always registers. A game type can name one as its
`base` to be spawned by the engine's system for it.

```ts
declare const PRIMITIVE_TYPES: readonly [
    "solid",
    "sensor",
    "marker",
    "prop",
    "follower",
    "decor",
    "nav",
    "note"
];
```

## `PadAxis`

_type_ in `game/input-codes.ts`

```ts
type PadAxis = (typeof PAD_AXES)[number] | number;
```

Refers to [`PAD_AXES`](#pad_axes).

## `PadButton`

_type_ in `game/input-codes.ts`

A standard-mapping button by name, or a raw index for a pad without the standard mapping.

```ts
type PadButton = (typeof PAD_BUTTONS)[number] | number;
```

Refers to [`PAD_BUTTONS`](#pad_buttons).

## `ParseSaveResult`

_type_ in `game/save-file.ts`

What a save read returns: the file, migrated up to the game's version, or why it can't load.

```ts
type ParseSaveResult = {
    file: SaveFile;
    migratedFrom?: number;
    ok: true;
} | {
    issues: SceneIssue[];
    ok: false;
};
```

Refers to [`SaveFile`](#savefile).

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

## `PathFollowBlock`

_type_ in `game/behaviors/path-follow.ts`

A `path-follow` block as an entity carries it.

```ts
type PathFollowBlock = z.infer<z.ZodObject<typeof pathFollowFields>>;
```

## `PathFollowSystem`

_type_ in `game/behaviors/path-follow.ts`

```ts
type PathFollowSystem = BehaviorSystem<PathFollowBlock> & {
    /** How far the entity's body moved in the last beforeStep, for carrying riders; null when this behavior moves no body of it. */
    frameDelta(entityId: string): Vec2 | null;
    /** Where the entity is on its path now, world m; null for one not attached. */
    position(entityId: string): Vec2 | null;
};
```

Refers to [`BehaviorSystem`](#behaviorsystem), [`PathFollowBlock`](#pathfollowblock).

## `PathPlace`

_type_ in `systems/path-follower.ts`

Where something is on its path: the waypoint clock, where it was after the last advance, and how far that advance moved it.

```ts
type PathPlace = {
    frameDelta: Vec2;
    prevPos: Vec2;
    state: WaypointState;
};
```

Refers to [`WaypointState`](#waypointstate).

## `PathSchema`

_const_ in `game/fields.ts`

```ts
declare const PathSchema: z.ZodObject<{
    mode: z.ZodEnum<{
        loop: "loop";
        ping_pong: "ping_pong";
    }>;
    pauseMs: z.ZodOptional<z.ZodNumber>;
    pts: z.ZodArray<z.ZodTuple<[
        z.ZodNumber,
        z.ZodNumber
    ], null>>;
    speed: z.ZodNumber;
}, z.core.$strict>;
```

## `PersistContext`

_type_ in `game/types.ts`

`EngineContext.persist`: one JSON value that outlives scene loads within one game instance.

```ts
type PersistContext = {
    /** Deep-frozen; the same object until `set`. */
    readonly value: JsonValue;
    /** Replaces the value now. */
    set(next: JsonValue): void;
};
```

Refers to [`JsonValue`](#jsonvalue).

## `PhysicalCheck`

_type_ in `game/types.ts`

A check that needs the physics world (`spawn-in-solid`); issue codes are the game's own.

```ts
type PhysicalCheck = {
    description: string;
    id: string;
    /** Skipped, with an info issue, in a scene without physics. */
    needsPhysics?: boolean;
    run(env: PhysicalEnv): SceneIssue[];
};
```

Refers to [`PhysicalEnv`](#physicalenv).

## `PhysicalEnv`

_type_ in `game/types.ts`

What a physical check sees: the scene loaded into a world that is never
stepped (the editor's edit world, or a headless one for `validate
--physical`), with shape queries over it.

```ts
type PhysicalEnv = {
    /** The first collider `shape` hits when swept by `by`; sensors never count. */
    cast(shape: ShapeObj, by: Vec2, opts?: {
        exclude?: readonly string[];
    }): (PhysicalHit & {
        toi: number;
    }) | null;
    def: SceneDefinition;
    /** Colliders overlapping `shape` (world coordinates); sensors only with `sensors: true`. */
    overlaps(shape: ShapeObj, opts?: {
        exclude?: readonly string[];
        sensors?: boolean;
    }): PhysicalHit[];
    physics: PhysicsWorld | null;
    /** Null in a scene without physics; `space` answers on either backend. */
    rapier: RapierModule | null;
    registry: Registry;
    scene: ExpandedScene;
    space: SpaceQuery;
    tags: ColliderTags;
};
```

Refers to [`ColliderTags`](#collidertags), [`PhysicalHit`](#physicalhit), [`PhysicsWorld`](#physicsworld), [`Registry`](#registry), [`SpaceQuery`](#spacequery).

## `PhysicalHit`

_type_ in `game/types.ts`

A collider found by a physical query.

```ts
type PhysicalHit = {
    /** The contact or impact point, world metres. */
    at: Vec2;
    tag: ColliderTag;
};
```

Refers to [`ColliderTag`](#collidertag).

## `PhysicsRequiredError`

_class_ in `game/physics-of.ts`

Something that needs Rapier ran in a scene loaded without physics: an `EngineError` with code `physics-required`.

```ts
declare class PhysicsRequiredError extends EngineError {
    /** A type, a system or a call. */
    readonly what: string;
    constructor(what: string, entityId?: string);
}
```

Refers to [`EngineError`](#engineerror).

## `PhysicsWorld`

_type_ in `physics.ts`

```ts
type PhysicsWorld = {
    /** Create a collider, optionally attached to a rigid body */
    addCollider: (desc: ColliderDesc, body?: RigidBody) => Collider;
    addRigidBody: (desc: RigidBodyDesc) => RigidBody;
    /** A character controller set up exactly as `opts` says; `SIDE_VIEW_CONTROLLER` and `TOP_DOWN_CONTROLLER` are presets. */
    createCharacterController: (opts: CharacterControllerOptions) => KinematicCharacterController;
    /** Get debug render data (line segments + colors) for wireframe overlay */
    debugRender: () => {
        colors: Float32Array;
        vertices: Float32Array;
    };
    /** Tear down the world and free all resources */
    destroy: () => void;
    /**
     * Whether `controller`'s last `computeColliderMovement` ended on the ground.
     * Rapier's `computedGrounded()` alone also counts ground within its
     * prediction distance (about 5 cm at the metre unit) before contact; this
     * also asks for a collision whose normal faces the controller's `up`.
     */
    isGrounded: (controller: KinematicCharacterController) => boolean;
    rapier: RapierModule;
    /** Make newly added colliders visible to scene queries without advancing time. */
    refreshQueries: () => void;
    removeCollider: (collider: Collider) => void;
    /** Remove a rigid body (and its attached colliders) */
    removeRigidBody: (body: RigidBody) => void;
    /** World gravity from the next step on, m/s²; y is down. */
    setGravity: (gravity: Vec2) => void;
    /** Advance simulation by one fixed timestep */
    step: () => void;
    /** The raw Rapier world — escape hatch for advanced usage */
    world: World;
};
```

Refers to [`CharacterControllerOptions`](#charactercontrolleroptions).

## `PlacementCheck`

_type_ in `placement.ts`

```ts
type PlacementCheck = {
    reason?: string;
    valid: boolean;
};
```

## `PlacementDraw`

_type_ in `placement.ts`

How the host draws the ghost; each is called only when the ghost's visibility or pose changes.

```ts
type PlacementDraw<T> = {
    hide(): void;
    pose(ghost: PlacementGhost<T>): void;
    show(ghost: PlacementGhost<T>): void;
};
```

Refers to [`PlacementGhost`](#placementghost).

## `PlacementGhost`

_type_ in `placement.ts`

A template about to be placed: where (world metres) and at what rotation.

```ts
type PlacementGhost<T> = {
    at: Vec2;
    /** Radians. */
    rotation: number;
    template: T;
};
```

## `PlacementTool`

_type_ in `placement.ts`

```ts
type PlacementTool<T> = {
    /** Drops the template and hides the ghost. */
    clear: () => void;
    destroy: () => void;
    ghost: () => PlacementGhost<T> | null;
    /** Hides the ghost and keeps the template, until the next `move`. */
    hide: () => void;
    /** Follows the pointer, in world metres; with `show` false the ghost stays hidden (the host isn't placing now). */
    move: (at: Vec2, show?: boolean) => void;
    /** Validates the ghost and commits it when valid. */
    place: () => PlacementCheck;
    /** Turns the ghost by `delta` steps, for a rotatable template. */
    rotate: (delta: number) => void;
    /** Picks a template at rotation 0 and shows its ghost where the pointer last was. */
    select: (template: T) => void;
    selected: () => T | null;
};
```

Refers to [`PlacementCheck`](#placementcheck), [`PlacementGhost`](#placementghost).

## `PlacementToolOptions`

_type_ in `placement.ts`

```ts
type PlacementToolOptions<T> = {
    /** Runs only after `validate` passed. */
    commit(ghost: PlacementGhost<T>): void;
    draw: PlacementDraw<T>;
    /** Templates that turn; omitted, every one does. */
    rotatable?(template: T): boolean;
    /** Radians per `rotate` unit; default 0.15 (about 8.6° per wheel notch). */
    rotateStep?: number;
    validate(ghost: PlacementGhost<T>): PlacementCheck;
};
```

Refers to [`PlacementCheck`](#placementcheck), [`PlacementDraw`](#placementdraw), [`PlacementGhost`](#placementghost).

## `PlayStart`

_type_ in `game/types.ts`

The resolved start of a play world, as the game's `onLoad` reads it from `EngineContext.play`.

```ts
type PlayStart = {
    /** Where the centre of the game's `play.spawnShape` starts, already cast along its `cast` (not at all with zero gravity, `"none"` or a zero vector). */
    at?: Vec2;
    /** The game's own options (`GamePlayDef.options`), already parsed. */
    game?: unknown;
    timeOffsetMs: number;
};
```

## `PlayState`

_type_ in `game/types.ts`

What a game's outcome hook and script predicates see after each tick.

```ts
type PlayState<S = unknown> = {
    /** This tick's events only; a game that needs history keeps it in its runtime and snapshot. */
    events: readonly StepEvent[];
    /** The persistent value after the tick (`EngineContext.persist`); absent where the host doesn't track it. */
    persist?: JsonValue;
    snapshot: S;
    /** The tick just simulated, from 0. */
    tick: number;
    /** The live world after the tick: whether an entity exists (and is enabled), and how many match. */
    world: PlayWorld;
};
```

Refers to [`JsonValue`](#jsonvalue), [`PlayWorld`](#playworld), [`StepEvent`](#stepevent).

## `PlayWorld`

_type_ in `game/types.ts`

What `PlayState.world` answers about the entities live after a tick.

```ts
type PlayWorld = {
    count(sel: EntitySelector): number;
    /** True while `id` exists and is enabled; with `enabled: false`, while it exists at all. */
    exists(id: string, opts?: {
        enabled?: boolean;
    }): boolean;
    /** A live entity (`EngineContext.get`); absent as `select` is. */
    get?(id: string): RuntimeEntity | undefined;
    /** A live entity's pose after the tick (`EngineContext.poses`); absent as `select` is. */
    pose?(id: string): Readonly<Pose> | undefined;
    /** The loaded scene's grid (`EngineContext.grid`), null without one; absent as `select` is. */
    readonly grid?: RuntimeGrid | null;
    /** The run's project view (`EngineContext.project`), null without one; absent as `select` is. */
    readonly project?: ProjectRuntimeView | null;
    /** Live entities in spawn order (`EngineContext.query.select`); absent where the host doesn't build the world with `playWorld`. */
    select?(sel?: EntitySelector): readonly string[];
};
```

Refers to [`EntitySelector`](#entityselector), [`Pose`](#pose), [`ProjectRuntimeView`](#projectruntimeview), [`RuntimeGrid`](#runtimegrid).

## `PlayerInfo`

_type_ in `game/types.ts`

A seat and the devices it owns.

```ts
type PlayerInfo = {
    devices: readonly DeviceId[];
    index: number;
    joined: boolean;
};
```

Refers to [`DeviceId`](#deviceid).

## `PlayerInputBlock`

_type_ in `game/behaviors/player-input.ts`

A `player-input` block as an entity carries it, defaults applied.

```ts
type PlayerInputBlock = z.infer<z.ZodObject<typeof playerInputFields>>;
```

## `PlayerInputSystem`

_interface_ in `game/input-for.ts`

The `player-input` behavior's system, as `ctx.behavior("player-input")` gives it.

```ts
interface PlayerInputSystem extends BehaviorSystem<PlayerInputBlock> {
    /** The seat the entity's block names, joined or not; null when it carries none. */
    seatOf(entityId: string): null | number;
    /**
     * The entity's view, made once per attached entity, reading its seat at
     * each call: nothing held while the seat hasn't joined. Undefined when the
     * entity carries no `player-input`.
     */
    inputFor(entityId: string): SeatInput | undefined;
}
```

Refers to [`BehaviorSystem`](#behaviorsystem), [`PlayerInputBlock`](#playerinputblock), [`SeatInput`](#seatinput).

## `PlayersDef`

_type_ in `game/types.ts`

Input seats and how devices take them.

```ts
type PlayersDef = {
    /**
     * auto: seat 0 owns keyboard, pointer and touch, and pads take free seats
     * in connection order; press: a device's first press takes the lowest free
     * seat; host: `GameInstance.input.assign`.
     */
    join: "auto" | "host" | "press";
    /** Seats, 1–8; default 1. */
    max: number;
};
```

## `PointerButton`

_type_ in `game/input-codes.ts`

```ts
type PointerButton = (typeof POINTER_BUTTONS)[number];
```

Refers to [`POINTER_BUTTONS`](#pointer_buttons).

## `PointerKind`

_type_ in `tool-router.ts`

```ts
type PointerKind = "mouse" | "pen" | "touch";
```

## `PointerState`

_type_ in `input/state.ts`

A seat's pointer this tick.

```ts
type PointerState = {
    /** Bit 0 primary, 1 secondary, 2 middle. */
    buttons: number;
    /** False after it left the canvas. */
    over: boolean;
    /** World position, quantised. */
    x: number;
    y: number;
};
```

## `Pool`

_type_ in `game/types.ts`

Disabled entities handed out again before new ones spawn.

```ts
type Pool = {
    /** A free (disabled) entity, enabled; or a new one from `spawn` when none is free and `max` allows. */
    acquire(): null | string;
    readonly free: number;
    readonly live: number;
    /** Disables it and marks it free. */
    release(id: string): void;
};
```

## `Pose`

_type_ in `runtime/poses.ts`

```ts
type Pose = {
    /** Radians. */
    rot: number;
    x: number;
    y: number;
};
```

## `PoseIndex`

_interface_ in `runtime/poses.ts`

Every loaded entity's pose, simulation-side: set at spawn and by the
system that moves it. Deterministic and headless; never in a digest.

```ts
interface PoseIndex {
    /** The pose after the last simulated tick (or at spawn). */
    get(id: string): Readonly<Pose> | undefined;
    /** The pose one tick earlier; equals `get` for an entity not moved in the last tick. */
    prev(id: string): Readonly<Pose> | undefined;
    /**
     * Written only by the system that owns `id`; `snap` makes `prev` equal the new pose (spawn, teleport).
     * Without `rot` the entity keeps its current angle (0 for a new entry).
     */
    set(id: string, x: number, y: number, rot?: number, opts?: {
        snap?: boolean;
    }): void;
    remove(id: string): void;
    has(id: string): boolean;
    ids(): IterableIterator<string>;
    readonly size: number;
}
```

Refers to [`Pose`](#pose).

## `PrimitiveType`

_type_ in `game/types.ts`

```ts
type PrimitiveType = (typeof PRIMITIVE_TYPES)[number];
```

Refers to [`PRIMITIVE_TYPES`](#primitive_types).

## `ProjectMaterialDef`

_type_ in `game/define.ts`

A project's material asset as the registry takes it; without `physics` it is render data only.

```ts
type ProjectMaterialDef = {
    blend?: BlendMode;
    description: string;
    physics?: {
        friction: number;
        impulse?: Vec2;
        restitution: number;
    };
    style?: Style;
    tint?: number;
};
```

Refers to [`Style`](#style).

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

## `PtSchema`

_const_ in `game/fields.ts`

```ts
declare const PtSchema: z.ZodTuple<[
    z.ZodNumber,
    z.ZodNumber
], null>;
```

## `RUNTIME_ID_PATTERN`

_const_ in `game/runtime-ids.ts`

`<name>#<label>`: the name an `ID_PATTERN` id, the label digits (a counter) or an `ID_PATTERN` word.

```ts
declare const RUNTIME_ID_PATTERN: RegExp;
```

## `RegisteredBehavior`

_type_ in `game/behaviors.ts`

```ts
type RegisteredBehavior = BehaviorDef & {
    /** Position in registration order: what attach, step and detach follow. */
    index: number;
    /** `engine`, or the game's id. */
    origin: string;
    /** Fields resolved against this registry. */
    shape: z.ZodRawShape;
};
```

Refers to [`BehaviorDef`](#behaviordef).

## `RegisteredType`

_type_ in `game/types.ts`

```ts
type RegisteredType = EntityTypeDef & {
    /** `engine` for primitives, else the game's id. */
    origin: string;
    /** The type's fields resolved against this registry. */
    shape: z.ZodRawShape;
};
```

Refers to [`EntityTypeDef`](#entitytypedef).

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

Refers to [`ActionDef`](#actiondef), [`BehaviorName`](#behaviorname), [`BehaviorRules`](#behaviorrules), [`BulkKeyInfo`](#bulkkeyinfo), [`CommandDef`](#commanddef), [`GameDefinition`](#gamedefinition), [`InspectorWidgetDef`](#inspectorwidgetdef), [`MaterialDef`](#materialdef), [`PhysicalCheck`](#physicalcheck), [`RegisteredBehavior`](#registeredbehavior), [`RegisteredType`](#registeredtype), [`SceneLayerDef`](#scenelayerdef), [`SceneValidator`](#scenevalidator), [`TimeModel`](#timemodel).

## `RegistryError`

_class_ in `game/define.ts`

```ts
declare class RegistryError extends Error {
    readonly problems: string[];
    constructor(id: string, problems: string[]);
}
```

## `ResolvedTime`

_type_ in `game/time.ts`

```ts
type ResolvedTime = Readonly<{
    catchUp: null | {
        maxMs: number;
    };
    kind: TimeKind;
    rate: number;
    /** 1000 / rate: every tick's dtMs. */
    tickMs: number;
    wakeOnPointerMove: boolean;
}>;
```

Refers to [`TimeKind`](#timekind).

## `RunResult`

_type_ in `game/types.ts`

How a run ended: an engine result, or one the game declares (`won`, `died`).

```ts
type RunResult = (string & {}) | EngineRunResult;
```

Refers to [`EngineRunResult`](#enginerunresult).

## `RuntimeGrid`

_type_ in `runtime/grid.ts`

The loaded scene's grid: present when its resolved settings have one.

```ts
type RuntimeGrid = {
    /** The scene bounds in cells. */
    bounds: CellBounds;
    geometry: GridGeometry;
    occupancy: Occupancy;
    /** In bounds, not a wall, not blocked. */
    passable(c: Cell): boolean;
};
```

Refers to [`Cell`](#cell), [`CellBounds`](#cellbounds), [`GridGeometry`](#gridgeometry), [`Occupancy`](#occupancy).

## `RuntimeNav`

_type_ in `runtime/nav.ts`

Navigation over the loaded scene's walk areas: present when it has some.

```ts
type RuntimeNav = {
    contains(p: Vec2): boolean;
    mesh: NavMesh;
    nearest(p: Vec2): Vec2;
    path(from: Vec2, to: Vec2): Vec2[] | null;
};
```

Refers to [`NavMesh`](#navmesh).

## `SAVE_RANDOM_KEY`

_const_ in `game/save-file.ts`

The `world.systems` key of `ctx.random`'s forks; `@` can't begin an entity id.

```ts
declare const SAVE_RANDOM_KEY = "@random";
```

## `SAVE_SCHEMA_ID`

_const_ in `game/save-file.ts`

```ts
declare const SAVE_SCHEMA_ID = "urn:jams-engine:save:v1";
```

## `SAVE_VERSION`

_const_ in `game/save-file.ts`

```ts
declare const SAVE_VERSION = 1;
```

## `SENSOR_ENTER`

_const_ in `runtime/types.ts`

Engine event types.

```ts
declare const SENSOR_ENTER = "sensor:enter";
```

## `SENSOR_EXIT`

_const_ in `runtime/types.ts`

```ts
declare const SENSOR_EXIT = "sensor:exit";
```

## `SIDES`

_const_ in `game/fields.ts`

The four sides, clockwise from `"up"`.

```ts
declare const SIDES: readonly [
    "up",
    "right",
    "down",
    "left"
];
```

## `SIDE_VIEW_CONTROLLER`

_const_ in `game/defaults.ts`

Side-view tuning in metres: up −y, climb 50°, slide 30°, autostep 0.04 × 0.02, snap 0.04, push.

```ts
declare const SIDE_VIEW_CONTROLLER: CharacterControllerOptions;
```

Refers to [`CharacterControllerOptions`](#charactercontrolleroptions).

## `SLOT_MAX_LENGTH`

_const_ in `game/save-file.ts`

The longest slot name, in characters.

```ts
declare const SLOT_MAX_LENGTH = 32;
```

## `SLOT_PATTERN`

_const_ in `game/save-file.ts`

A slot name: lowercase letters, digits and dashes, 1–`SLOT_MAX_LENGTH` characters, starting with a letter or digit.

```ts
declare const SLOT_PATTERN: RegExp;
```

## `SPAWNER`

_const_ in `game/behaviors/spawner.ts`

```ts
declare const SPAWNER: BehaviorDef<{
    active: z.ZodDefault<z.ZodBoolean>;
    burst: z.ZodDefault<z.ZodNumber>;
    cap: z.ZodDefault<z.ZodNumber>;
    fields: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    lifeMs: z.ZodOptional<z.ZodNumber>;
    prefab: z.ZodOptional<z.ZodType<string, unknown, z.core.$ZodTypeInternals<string, unknown>>>;
    rate: z.ZodDefault<z.ZodNumber>;
    spread: z.ZodDefault<z.ZodNumber>;
    type: z.ZodOptional<z.ZodString>;
    velocity: z.ZodOptional<z.ZodTuple<[
        z.ZodNumber,
        z.ZodNumber
    ], null>>;
}>;
```

Refers to [`BehaviorDef`](#behaviordef).

## `SPAWNER_SPAWNED`

_const_ in `runtime/types.ts`

A spawner made a spawn: `entityId` the spawner, `other` and `data.id` the new id, `at` where it appeared.

```ts
declare const SPAWNER_SPAWNED = "spawner:spawned";
```

## `SPRITE`

_const_ in `game/behaviors/sprite.ts`

```ts
declare const SPRITE: BehaviorDef<{
    alpha: z.ZodOptional<z.ZodNumber>;
    anchor: z.ZodOptional<z.ZodTuple<[
        z.ZodNumber,
        z.ZodNumber
    ], null>>;
    asset: z.ZodOptional<z.ZodType<string, unknown, z.core.$ZodTypeInternals<string, unknown>>>;
    blend: z.ZodOptional<z.ZodEnum<{
        add: "add";
        multiply: "multiply";
        normal: "normal";
        screen: "screen";
    }>>;
    flipX: z.ZodOptional<z.ZodBoolean>;
    flipY: z.ZodOptional<z.ZodBoolean>;
    frame: z.ZodOptional<z.ZodString>;
    nineSlice: z.ZodOptional<z.ZodTuple<[
        z.ZodNumber,
        z.ZodNumber,
        z.ZodNumber,
        z.ZodNumber
    ], null>>;
    offset: z.ZodOptional<z.ZodType<Pt, unknown, z.core.$ZodTypeInternals<Pt, unknown>>>;
    scale: z.ZodOptional<z.ZodNumber>;
    size: z.ZodOptional<z.ZodTuple<[
        z.ZodNumber,
        z.ZodNumber
    ], null>>;
    tile: z.ZodOptional<z.ZodBoolean>;
    tint: z.ZodOptional<z.ZodNumber>;
    turn: z.ZodOptional<z.ZodBoolean>;
}>;
```

Refers to [`BehaviorDef`](#behaviordef).

## `SPRITE_FALLBACK_SIZE`

_const_ in `game/behaviors/sprite.ts`

A sprite's size in metres when neither its block nor its asset gives one.

```ts
declare const SPRITE_FALLBACK_SIZE: readonly [
    w: number,
    h: number
];
```

## `SUBLEVEL_ID_PATTERN`

_const_ in `game/runtime-ids.ts`

A sublevel entity's id: `<label>:<id>`, or `<label>:<inst>/<child>` for
an instance's child, the label an `ID_PATTERN` word. `:` is outside the
scene and runtime id patterns, so a sublevel id never names a main-scene
entity, a runtime spawn or anything a scene file can hold.

```ts
declare const SUBLEVEL_ID_PATTERN: RegExp;
```

## `SaveDepth`

_type_ in `game/save-file.ts`

`progress`: the scene, persist and the game's snapshot. `world`: everything a run needs to continue exactly.

```ts
type SaveDepth = "progress" | "world";
```

## `SaveFile`

_type_ in `game/save-file.ts`

```ts
type SaveFile = {
    $schema?: string;
    /** The game's own data, its `snapshot()`; `game` is the game's id. */
    data: JsonValue;
    depth: SaveDepth;
    engine: string;
    game: string;
    gameVersion: number;
    kind: "save";
    meta: SaveMeta;
    persist: JsonValue;
    project: null | {
        id: ProjectId;
        snapshot: Sha256;
    };
    release: Sha256 | null;
    scene: {
        /** The scene's `ctx.flow.entry` when saved; absent for none. */
        entry?: string;
        id: AssetId;
        runHash: string;
        sublevels: readonly SublevelInfo[];
    };
    slot: string;
    v: typeof SAVE_VERSION;
    /** Depth `world` only. */
    world?: WorldState;
};
```

Refers to [`JsonValue`](#jsonvalue), [`SAVE_VERSION`](#save_version), [`SaveDepth`](#savedepth), [`SaveMeta`](#savemeta), [`SublevelInfo`](#sublevelinfo), [`WorldState`](#worldstate).

## `SaveGameData`

_type_ in `game/save-file.ts`

What a game's save migrations take and return.

```ts
type SaveGameData = {
    game: JsonValue;
    persist: JsonValue;
};
```

Refers to [`JsonValue`](#jsonvalue).

## `SaveLimits`

_type_ in `game/save-file.ts`

```ts
type SaveLimits = {
    maxBytes: number;
    maxSlots: number;
};
```

## `SaveLimitsStore`

_type_ in `game/save-file.ts`

The store fields the limits read: its kind and its own, possibly stricter, limits.

```ts
type SaveLimitsStore = {
    kind: string;
    limits?: Partial<SaveLimits>;
};
```

Refers to [`SaveLimits`](#savelimits).

## `SaveMeta`

_type_ in `game/save-file.ts`

```ts
type SaveMeta = {
    playTicks: number;
    /** The host's clock when saved, ms since the epoch; never read inside the simulation. */
    savedAt: number;
    /** The main scene it was saved in. */
    scene: AssetId;
    title?: string;
};
```

## `SaveRequest`

_type_ in `game/types.ts`

A save game code asked for; the host writes it after the tick, and the result is a host event.

```ts
type SaveRequest = {
    depth?: SaveDepth;
    slot: string;
    title?: string;
};
```

Refers to [`SaveDepth`](#savedepth).

## `SavedSystems`

_type_ in `game/save-file.ts`

Each entity's saved state by owner (a type system, a behavior, `motion`,
`grid-step`), written only for an owner whose `save` returned a value.
The `@random` key holds `ctx.random`'s forks by label.

```ts
type SavedSystems = Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
```

Refers to [`JsonValue`](#jsonvalue).

## `SavedTimer`

_type_ in `game/save-file.ts`

```ts
type SavedTimer = {
    data?: JsonValue;
    due: number;
    emit: string;
    entityId?: string;
    id: number;
    owner?: string;
    period?: number;
    times?: number;
};
```

Refers to [`JsonValue`](#jsonvalue).

## `SavesContext`

_type_ in `game/types.ts`

`EngineContext.saves`: asks the host to save; never answers inside the simulation.

```ts
type SavesContext = {
    /** Saves `slot` after this tick; whether it worked arrives only as a host event (`save:written`, `save:failed`). */
    request(slot: string, opts?: {
        depth?: SaveDepth;
        title?: string;
    }): void;
};
```

Refers to [`SaveDepth`](#savedepth).

## `SceneDiff`

_type_ in `game/live.ts`

What differs between two expanded versions of a scene, by entity id in scene order.

```ts
type SceneDiff = {
    added: readonly string[];
    changed: readonly string[];
    /** name, bounds or settings differ: the swap reloads. */
    header: boolean;
    removed: readonly string[];
};
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

## `SceneLibrary`

_type_ in `game/flow.ts`

The scenes a runtime may load or attach: the scene list's entries and each listed scene.

```ts
type SceneLibrary = {
    /** In list order. */
    readonly list: readonly SceneListEntry[];
    readonly scenes: ReadonlyMap<AssetId, LibraryScene>;
};
```

Refers to [`LibraryScene`](#libraryscene), [`SceneListEntry`](#scenelistentry).

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

## `SceneRuntimeHandle`

_type_ in `runtime/types.ts`

The runtime plus the parts the shell and a game's tools drive directly.

```ts
type SceneRuntimeHandle = SceneRuntime & {
    readonly ctx: EngineContext;
    /** The game's per-runtime hooks, or `null` without a game. */
    readonly game: GameRuntime | null;
    /**
     * Swaps in the project's new view and redraws what uses the `changed`
     * assets; returns the entities whose redraw threw, the rest redrawn.
     */
    reloadAssets: (project: ProjectRuntimeView | null, changed: readonly AssetId[]) => AssetReloadError[];
    /** Each rendered frame, after the view's `frame`: the visual behaviors' render hooks. */
    render: (alpha: number) => void;
    /** The loaded scene with every `add`, `update` and `remove` since applied, or null. */
    scene: () => ExpandedScene | null;
};
```

Refers to [`EngineContext`](#enginecontext), [`GameRuntime`](#gameruntime), [`ProjectRuntimeView`](#projectruntimeview).

## `SceneSwap`

_type_ in `game/live.ts`

What `GameRuntime.onSwap` and the `live:swapped` event receive.

```ts
type SceneSwap = {
    /** What survived: everything (reconcile), the world (reload, world depth), or only the game's state and persist. */
    carried: "all" | "progress" | "world";
    diff: SceneDiff;
    /** `version` null: the release's own scene. */
    from: SwapSide;
    scene: AssetId;
    strategy: SwapStrategy;
    /** `ctx.tick` when the swap ran: the next tick to step. */
    tick: number;
    timing: SwapTiming;
    to: SwapSide;
};
```

Refers to [`SceneDiff`](#scenediff), [`SwapSide`](#swapside), [`SwapStrategy`](#swapstrategy), [`SwapTiming`](#swaptiming).

## `SceneSystem`

_interface_ in `game/types.ts`

One entity type's slice of a scene. A system owns the bodies, colliders,
tags and visuals it creates and never reads another system's geometry.

```ts
interface SceneSystem<E extends RuntimeEntity = RuntimeEntity> {
    spawn(e: E): void;
    /** Idempotent: an unknown id is a no-op. */
    despawn(id: string): void;
    clear(): void;
    /** Fast path for an edit; without it the runtime despawns and respawns. */
    update?(e: E, prev: E): void;
    /** Back to t = 0 without respawning. */
    reset?(): void;
    /**
     * Moves time-driven state on by `ms` before tick 0 (Play's `timeOffsetMs`),
     * exactly as stepping that long would, and places bodies there.
     */
    seek?(ms: number): void;
    /** Live entities, scene and runtime alike. */
    size(): number;
    /** Before the game's `beforeStep`, in spawn order. */
    beforeStep?(dtMs: number): void;
    /**
     * After the game's `beforeStep` and right before the physics step, in
     * spawn order: the last look at the world the step starts from. Not
     * called without a physics world.
     */
    beforePhysics?(): void;
    /** After the physics step, in spawn order, before the game's `afterStep`. */
    afterStep?(dtMs: number): void;
    /**
     * After a load's or a spawn's entities of this type spawned and their
     * behaviors attached; ids in spawn order.
     */
    ready?(ids: readonly string[]): void;
    /**
     * Stop simulating `id`: colliders out of queries, visuals hidden, state
     * kept. Without it the runtime despawns the entity and keeps its record.
     */
    disable?(id: string): void;
    /** Simulate `id` again. Without it the runtime spawns it again from its record, state reset. */
    enable?(id: string): void;
    /** Per-entity state beyond the pose that a world save needs (a path's progress); undefined for none. */
    save?(id: string): JsonValue | undefined;
    /** Puts back what `save` returned, after the entity was spawned again from its scene or record. */
    restore?(id: string, state: JsonValue): void;
}
```

Refers to [`JsonValue`](#jsonvalue).

## `SceneTemplate`

_type_ in `game/types.ts`

What a new scene starts with: everything but its header (`$schema`, `v`, `game`, `name`).

```ts
type SceneTemplate = {
    [bulkKey: BulkKey]: unknown;
    bounds: Bounds;
    entities?: EntityDef[];
    settings?: SceneSettings;
};
```

## `SceneValidator`

_type_ in `game/types.ts`

A game's structural check, run after the engine's on a schema-valid scene.

```ts
type SceneValidator = (def: SceneDefinition, env: {
    lines?: ReadonlyMap<string, number>;
    registry: Registry;
}) => SceneIssue[];
```

Refers to [`Registry`](#registry).

## `SceneView`

_interface_ in `context.ts`

Where a runtime's systems draw, one visual per id; `null` in headless
runs. Shapes, poses and sprite sizes are world metres; a style's
`strokeWidth` is world px, so a line keeps its weight at any px per metre. Ids are unique per runtime: an entity's id, or `${id}#<part>` for a
system that draws several pieces of one entity. The optional members are
additive: a view without them still draws everything, sprites as their
fallback boxes.

```ts
interface SceneView {
    /** Draws `shape` (metres) in the visual's local space, replacing `id`'s drawing; a redraw keeps its pose. */
    draw(id: string, shape: ShapeObj, style: Style, layer: ViewLayer): void;
    /**
     * Moves `id`'s local origin to (x, y) metres and turns it by `rot` radians. New
     * visuals start at (0, 0, 0). `snap`: no interpolation from the previous
     * pose (new visuals always snap).
     */
    pose(id: string, x: number, y: number, rot?: number, snap?: boolean): void;
    /** Idempotent. */
    remove(id: string): void;
    /** The layer's own handle; what a game draws there is in world px (metres × the game's px per metre). */
    layer(layer: ViewLayer): ViewLayerHandle;
    /** A sprite under `id`, replacing what was drawn. */
    sprite?(id: string, visual: SpriteVisual, layer: ViewLayer): void;
    /** Order inside its layer: higher on top; ties by first draw. */
    depth?(id: string, z: number): void;
    /** The runtime finished tick `tick`; poses set since belong to it. */
    commit?(tick: number): void;
    /** Each rendered frame: interpolated poses, y-sort, parallax; `camera` is the camera's position in metres. */
    frame?(f: {
        alpha: number;
        camera: {
            x: number;
            y: number;
            zoom: number;
        };
    }): void;
}
```

Refers to [`Style`](#style), [`ViewLayer`](#viewlayer), [`ViewLayerHandle`](#viewlayerhandle).

## `ScriptPredicate`

_type_ in `game/types.ts`

A game's `until` predicate for input scripts, e.g. `{ "grounded": true }`.

```ts
type ScriptPredicate<S = unknown> = {
    /** The value the predicate takes in a script; its JSON Schema goes into the game's input-script schema. */
    arg: z.ZodType;
    description: string;
    /** `arg` has already been parsed by `arg`. */
    test(arg: unknown, state: PlayState<S>): boolean;
};
```

Refers to [`PlayState`](#playstate).

## `SeatInput`

_type_ in `game/input-for.ts`

One seat's input this tick, as `ctx.input` gives it for that seat.

```ts
type SeatInput = {
    held(action: string): boolean;
    pointer(): PointerState | null;
    /** Went down this tick. */
    pressed(action: string): boolean;
    /** The seat read, or null when the entity carries no `player-input` or its seat hasn't joined. */
    readonly seat: null | number;
    released(action: string): boolean;
    /** An axis's value, or 0/1 for a button. */
    value(action: string): number;
    vector(action: string): Vec2;
};
```

Refers to [`PointerState`](#pointerstate).

## `SensorSystem`

_type_ in `systems/bodies.ts`

Raises `sensor:enter` / `sensor:exit` after each step for every collider that starts or stops overlapping.

```ts
type SensorSystem = SceneSystem<SensorEntity> & {
    afterStep(dtMs: number): void;
};
```

Refers to [`SceneSystem`](#scenesystem).

## `Side`

_type_ in `game/types.ts`

A side of an entity; it turns and flips with instance transforms.

```ts
type Side = "down" | "left" | "right" | "up";
```

## `SideViewController`

_interface_ in `motion/side-view.ts`

```ts
interface SideViewController {
    velocity(): Vec2;
    grounded(): boolean;
    step(dtMs: number, intent: SideViewIntent, env?: SideViewEnv): SideViewResult;
    /** Sets the velocity and leaves the ground, as a jump would without spending one. */
    launch(v: Vec2): void;
    save(): JsonValue;
    restore(state: JsonValue): void;
    /** Drops it from world saves; the body is the caller's to destroy. */
    destroy(): void;
}
```

Refers to [`JsonValue`](#jsonvalue), [`SideViewEnv`](#sideviewenv), [`SideViewIntent`](#sideviewintent), [`SideViewResult`](#sideviewresult).

## `SideViewEnv`

_type_ in `motion/side-view.ts`

```ts
type SideViewEnv = {
    /** An outside acceleration this tick (a force area's), m/s². */
    accel?: Vec2;
    /** What it stands on moved by this much this tick, m. */
    carrier?: Vec2;
};
```

## `SideViewIntent`

_type_ in `motion/side-view.ts`

```ts
type SideViewIntent = {
    /** Pressed this tick. */
    jump: boolean;
    /** Held this tick; releasing it while rising cuts the jump. */
    jumpHeld: boolean;
    /** −1 to 1; a larger one is clamped. */
    move: number;
};
```

## `SideViewOptions`

_type_ in `motion/side-view.ts`

```ts
type SideViewOptions = Pick<MotionBodyOptions, "group" | "shape"> & {
    /** m/s² toward the intended speed. */
    accel: number;
    /** The share of `accel` and `decel` it has in the air, 0–1. */
    airControl: number;
    /** How long after leaving the ground a jump still works, ms. */
    coyoteMs: number;
    /** m/s² back to rest when there is no intent. */
    decel: number;
    /** Multiplies `ctx.gravity.y`; 0 floats. */
    gravityScale: number;
    /** How long a jump press is kept for the next time a jump is allowed, ms. */
    jumpBufferMs: number;
    /** The share of the upward speed kept when the jump is released early, 0–1. */
    jumpCut: number;
    /** m: how high a full jump rises. */
    jumpHeight: number;
    /** m/s, > 0. */
    maxFallSpeed: number;
    /** The steepest slope it walks up, degrees; default `SIDE_VIEW_CONTROLLER`'s. */
    maxSlopeDeg?: number;
    /** m/s along the ground. */
    maxSpeed: number;
    /** How far down it sticks to the ground, m; 0 never snaps. Default `SIDE_VIEW_CONTROLLER`'s. */
    snapToGround?: number;
    /** The tallest step it climbs without jumping, m; 0 climbs none. Default `SIDE_VIEW_CONTROLLER`'s. */
    stepHeight?: number;
};
```

Refers to [`MotionBodyOptions`](#motionbodyoptions).

## `SideViewResult`

_type_ in `motion/side-view.ts`

```ts
type SideViewResult = MotionResult & {
    /** On walkable ground at the end of the tick. */
    grounded: boolean;
    /** A jump started this tick. */
    jumped: boolean;
    /** Grounded now and not at the start of the tick. */
    landed: boolean;
};
```

Refers to [`MotionResult`](#motionresult).

## `SolidOptions`

_type_ in `systems/bodies.ts`

Visuals default to the `terrain` layer.

```ts
type SolidOptions = SurfaceDefaults & VisualOptions & {
    /** Collision group; `static` when omitted. */
    group?: string;
    /** Every entity of the type is one-way, whatever its own `oneWay` says; `true` is `"up"`, and an entity's own side wins. Omitted, the type's `oneWay`. */
    oneWay?: Side | boolean;
};
```

Refers to [`Side`](#side), [`VisualOptions`](#visualoptions).

## `SolidSystem`

_type_ in `systems/bodies.ts`

```ts
type SolidSystem = SceneSystem<SolidEntity> & {
    /** `gateOneWaySides` for the `"up"` solids alone, by the actor's bottom edge; other sides are left as they are. */
    gateOneWay(actorBottomY: number, dropping: boolean): void;
    /**
     * Gates this system's one-way entities for one actor's box: each stays
     * solid while the actor is on its one-way side (within 0.04 m of that face)
     * and isn't `passing` through, and otherwise moves its body out of the
     * world so queries and contacts skip it. An attached one is gated by its
     * collider's collision groups instead, and one in the geometry world by
     * disabling its collider.
     */
    gateOneWaySides(actor: Aabb, passing: boolean): void;
    isHidden(id: string): boolean;
    /**
     * Gates the one-way entities for the actor `actorId` alone: each holds it
     * while it is on that solid's one-way side, and `passing` (rising, or
     * dropping through) lets it through the `"up"` solids alone, as
     * `gateOneWay` does; a `"down"`, `"left"` or `"right"` solid goes by side
     * only. The colliders it passes go into `oneWayPasses(ctx, actorId)` for
     * its own sweeps to skip, and the world is left as it is, so every other
     * actor and body still meets them.
     */
    passesOneWay(actorId: string, actor: Aabb, passing: boolean): void;
    /** Where the entity's body is now; a hidden one-way body is off-world. */
    position(id: string): Vec2 | null;
};
```

Refers to [`SceneSystem`](#scenesystem).

## `SpaceCastHit`

_type_ in `runtime/space.ts`

```ts
type SpaceCastHit = SpaceHit & {
    normal: Vec2;
    toi: number;
};
```

Refers to [`SpaceHit`](#spacehit).

## `SpaceFilter`

_type_ in `runtime/space.ts`

```ts
type SpaceFilter = {
    /** Entity ids to skip. */
    exclude?: readonly string[];
    /** Only colliders a member of this collision group would interact with. */
    group?: string;
    /** Include sensors (default false). */
    sensors?: boolean;
    /** Collider handles to skip: an actor's `oneWayPasses`. */
    skip?: ReadonlySet<number>;
    /** Only colliders whose tag's type is one of these. */
    types?: readonly string[];
};
```

## `SpaceHit`

_type_ in `runtime/space.ts`

```ts
type SpaceHit = {
    at: Vec2;
    handle: number;
    tag: ColliderTag;
};
```

Refers to [`ColliderTag`](#collidertag).

## `SpaceQuery`

_interface_ in `runtime/space.ts`

Point, shape, ray and sweep queries over whichever backend is loaded.
Overlap hits are ordered by handle; casts by time of impact, then handle.
Only tagged colliders are hits, and a collider gated off with collision
groups 0, disabled, or on a disabled body never is. Touching counts. `at` is `p` for `pointAt`, the point
of the collider nearest the query shape's centre for `overlaps`, and the
point of impact for casts. A cast's `toi` is a fraction (0–1) of
`maxDist` or `by`, and its `normal` is the hit surface's, facing the
query; a ray starting inside a collider hits it at 0 with normal (0, 0).

```ts
interface SpaceQuery {
    readonly backend: "geometry" | "rapier";
    /** Colliders containing `p`, by handle: runtime picking. */
    pointAt(p: Vec2, filter?: SpaceFilter): SpaceHit[];
    overlaps(shape: ShapeObj, filter?: SpaceFilter): SpaceHit[];
    raycast(from: Vec2, dir: Vec2, maxDist: number, filter?: SpaceFilter): SpaceCastHit | null;
    /** The first collider `shape` hits moved by `by`; sensors never count. */
    sweep(shape: ShapeObj, by: Vec2, filter?: SpaceFilter): SpaceCastHit | null;
}
```

Refers to [`SpaceCastHit`](#spacecasthit), [`SpaceFilter`](#spacefilter), [`SpaceHit`](#spacehit).

## `SpawnInput`

_type_ in `game/types.ts`

An entity to spawn, as it is written in a scene file (shape tuples,
behaviors, `z`, `layer`), its id optional.

```ts
type SpawnInput = {
    [field: string]: unknown;
    /** `<name>#<label>`, the label not all digits; omitted, the next `<type>#<n>`. */
    id?: string;
    /** A sublevel's label: the spawn is destroyed with that sublevel's detach. */
    sublevel?: string;
    type: EntityTypeName;
};
```

## `SpawnShape`

_type_ in `game/types.ts`

The actor's shape centred on its position; "play from here" casts it along `cast` onto the first surface it meets, within the scene bounds.

```ts
type SpawnShape = ({
    halfLen: number;
    r: number;
    type: "capsule";
} | {
    hh: number;
    hw: number;
    type: "box";
} | {
    r: number;
    type: "circle";
}) & {
    /** How "play from here" settles the start: along gravity (default), not at all, or along a direction. */
    cast?: "gravity" | "none" | Pt;
};
```

## `SpawnerBlock`

_type_ in `game/behaviors/spawner.ts`

A `spawner` block as an entity carries it, defaults applied.

```ts
type SpawnerBlock = z.infer<z.ZodObject<ReturnType<typeof spawnerFields>>>;
```

## `SpawnerSystem`

_type_ in `game/behaviors/spawner.ts`

```ts
type SpawnerSystem = BehaviorSystem<SpawnerBlock> & {
    /** The runtime ids of its spawns still alive, oldest first; an instance counts once, by its id. */
    live(entityId: string): readonly string[];
};
```

Refers to [`BehaviorSystem`](#behaviorsystem), [`SpawnerBlock`](#spawnerblock).

## `SpriteAssetInfo`

_type_ in `game/behaviors/sprite.ts`

What the geometry reads of an asset's info: its (or its frame's) size and pivot, and a frame's rectangle when known.

```ts
type SpriteAssetInfo = Pick<AssetInfo, "pivot" | "size"> & {
    rect?: FrameRect;
};
```

Refers to [`FrameRect`](#framerect).

## `SpriteBlock`

_type_ in `game/behaviors/sprite.ts`

A `sprite` block as an entity carries it.

```ts
type SpriteBlock = z.infer<z.ZodObject<ReturnType<typeof spriteFields>>>;
```

## `SpriteGeometry`

_type_ in `game/behaviors/sprite.ts`

```ts
type SpriteGeometry = {
    /** In the frame's own 0–1 space. */
    anchor: [
        x: number,
        y: number
    ];
    /** The drawn rectangle in the sprite's own space: the anchor at the origin, the block's flips applied. */
    box: Extract<ShapeObj, {
        type: "box";
    }>;
    /** The frame's rectangle in its texture; omitted, the whole texture. */
    frame?: FrameRect;
    /** From the pose to the anchor, world metres, as the block writes it. */
    offset: Pt;
    /** Drawn size, world metres. */
    size: [
        w: number,
        h: number
    ];
};
```

Refers to [`FrameRect`](#framerect).

## `StepEvent`

_type_ in `runtime/types.ts`

Something that happened during one tick, naming entities by id. The
engine raises `sensor:enter` and `sensor:exit` (`entityId` is the sensor,
`other` what entered or left it, `at` the other's position), the
`entity:*` lifecycle events (`data: { type }`) and `contact:start` and
`contact:end`, and `player:joined` and `player:left` (`player` the seat,
`data: { device }`, `at` the origin, since a seat has no position); a
game raises its own types through `EngineContext.emit`.

```ts
type StepEvent = {
    at: Vec2;
    /** Plain JSON a game or a timer attaches. */
    data?: unknown;
    entityId?: string;
    other?: string;
    /** The seat the event is about. */
    player?: number;
    tick: number;
    type: string;
};
```

## `StepResult`

_type_ in `runtime/types.ts`

```ts
type StepResult = {
    /** Engine events first (sensors), then the game's, each in the order raised. */
    events: StepEvent[];
    /** The game's `snapshot()` after the step; `null` without a game. */
    game: unknown;
    /** The tick just simulated, counting from 0 after each load. */
    tick: number;
};
```

Refers to [`StepEvent`](#stepevent).

## `Style`

_type_ in `game/types.ts`

A fallback look until there is art (`50` Q13). Colors are 0xRRGGBB.

```ts
type Style = {
    alpha?: number;
    fill?: number;
    stroke?: number;
    /** The stroke's own alpha; `alpha` when omitted. */
    strokeAlpha?: number;
    strokeWidth?: number;
};
```

## `SublevelInfo`

_type_ in `game/flow.ts`

```ts
type SublevelInfo = {
    at: Pt;
    label: string;
    scene: AssetId;
};
```

## `SublevelOptions`

_type_ in `game/flow.ts`

```ts
type SublevelOptions = {
    /** World offset of the sublevel's origin, metres; on a grid scene a whole number of cells. Default [0, 0]. */
    at?: Pt;
    /** Prefixes its entities' ids (`<label>:<id>`); an id-pattern word no other sublevel holds. */
    label: string;
    /** Added to every entity's z. */
    z?: number;
};
```

## `SublevelResult`

_type_ in `game/flow.ts`

```ts
type SublevelResult = {
    entities: readonly string[];
    ok: true;
} | {
    issue: SceneIssue;
    ok: false;
};
```

## `SwapSide`

_type_ in `game/live.ts`

One side of a swap: the version (null for the release's own scene) and its hashes.

```ts
type SwapSide = {
    runHash: string;
    sceneHash: string;
    version: Sha256 | null;
};
```

## `SwapStrategy`

_type_ in `game/live.ts`

Reconcile changes entities in place; reload loads the new version fresh and restores what it can.

```ts
type SwapStrategy = "reconcile" | "reload";
```

## `SwapTiming`

_type_ in `game/live.ts`

When a new version of a scene reaches a running game: inside the next load
of that scene, after the tick in which game code called
`ctx.live.boundary()`, or after the tick during which it finished staging.

```ts
type SwapTiming = "boundary" | "next-load" | "now";
```

## `SystemFactory`

_type_ in `game/types.ts`

```ts
type SystemFactory<E extends RuntimeEntity = RuntimeEntity> = (ctx: EngineContext, type: RegisteredType) => SceneSystem<E>;
```

Refers to [`EngineContext`](#enginecontext), [`RegisteredType`](#registeredtype), [`SceneSystem`](#scenesystem).

## `TOOL_PRIORITY`

_const_ in `tool-router.ts`

```ts
declare const TOOL_PRIORITY: {
    readonly debug: 300;
    readonly editor: 200;
    readonly game: 100;
    readonly play: 0;
};
```

## `TOP_DOWN_CONTROLLER`

_const_ in `game/defaults.ts`

No slopes, autostep or snap: walls stop you, nothing lifts you.

```ts
declare const TOP_DOWN_CONTROLLER: CharacterControllerOptions;
```

Refers to [`CharacterControllerOptions`](#charactercontrolleroptions).

## `TimeKind`

_type_ in `game/time.ts`

```ts
type TimeKind = "event" | "fixed" | "turns";
```

## `TimeModel`

_type_ in `game/time.ts`

```ts
type TimeModel = {
    /** Time away arrives as one `@elapsed` command, at most `maxMs`. Off when omitted. */
    catchUp?: {
        maxMs: number;
    };
    kind: TimeKind;
    /** Ticks per second: the fixed clock, or the pace of a woken turns/event game while busy. Integer 1–240; default 60. */
    rate?: number;
    /** event only: pointer moves wake the game (hover effects). Default false. */
    wakeOnPointerMove?: boolean;
};
```

Refers to [`TimeKind`](#timekind).

## `TimerAction`

_type_ in `game/types.ts`

What a timer does when it falls due: a function, or an event it raises.
Only the event form can be saved with a snapshot.

```ts
type TimerAction = (() => void) | {
    data?: unknown;
    emit: string;
    entityId?: string;
};
```

## `Timers`

_interface_ in `game/types.ts`

```ts
interface Timers {
    /** Runs `action` once after `delay`; returns the timer's id. */
    after(delay: Delay, action: TimerAction, opts?: {
        owner?: string;
    }): number;
    /** Runs `action` every `period`, `times` times when given. */
    every(period: Delay, action: TimerAction, opts?: {
        owner?: string;
        times?: number;
    }): number;
    /** Runs `co` from the next timer phase; a yielded delay waits, a yielded predicate waits until it holds. */
    start(co: () => Generator<CoroutineYield, void, void>, opts?: {
        owner?: string;
    }): number;
    cancel(id: number): void;
    /** Timers and coroutines pending. */
    readonly size: number;
}
```

Refers to [`CoroutineYield`](#coroutineyield), [`Delay`](#delay), [`TimerAction`](#timeraction).

## `ToolConsumer`

_type_ in `tool-router.ts`

```ts
type ToolConsumer = {
    /** Claim the event; the first claiming consumer by priority gets it, nobody else does. */
    accepts(e: ToolEvent): boolean;
    /** Also offered key presses typed into a text field, which nobody else sees (the editor's Mod+S). */
    editable?: boolean;
    handle(e: ToolEvent): void;
    id: string;
    /** Higher wins. Engine bands: play 0, game tools 100, editor tools 200, the debug overlay 300. */
    priority: number;
};
```

Refers to [`ToolEvent`](#toolevent).

## `ToolEvent`

_type_ in `tool-router.ts`

```ts
type ToolEvent = {
    /** The DOM button that changed (0 primary, 1 middle, 2 secondary), -1 for a plain move. */
    button: number;
    /** A wheel turn's vertical distance in CSS px, whatever unit the browser reported it in; 0 otherwise. */
    deltaY: number;
    kind: "pointer";
    /** A move that is the pointer leaving the target (a `pointerleave`); `screen` is where it left. */
    left?: boolean;
    native: MouseEvent | PointerEvent | WheelEvent;
    /** Tells simultaneous touches apart; absent outside pointer events. */
    pointerId?: number;
    /** The device: absent for an event the router didn't build, which reads as a mouse. */
    pointerType?: PointerKind;
    /** CSS pixels from the input target's top-left corner. */
    screen: Vec2;
    type: "down" | "move" | "up" | "wheel";
} | {
    /**
     * The physical key (`KeyboardEvent.code`, "KeyW"), the same on every
     * layout; play input matches it. Empty or absent for a key with no
     * physical position, such as a virtual keyboard's.
     */
    code?: string;
    /** Typed into a text field; only consumers with `editable` are offered it. */
    editable?: boolean;
    /** The layout's character or key name (`KeyboardEvent.key`); editor chords match it. */
    key: string;
    kind: "key";
    native: KeyboardEvent;
    /** Focus was outside the input target (a panel elsewhere in the key target); play input ignores it. */
    outsideTarget?: boolean;
    type: "down" | "up";
};
```

Refers to [`PointerKind`](#pointerkind).

## `ToolRouter`

_type_ in `tool-router.ts`

```ts
type ToolRouter = {
    /**
     * Turns the target's DOM events into `ToolEvent`s; a Window target has no
     * offset. Keys come from `keyTarget` when given (an element holding the
     * target and the panels beside it), pointers always from `target`.
     */
    attach(target: HTMLElement | Window, keyTarget?: HTMLElement | Window): void;
    destroy(): void;
    detach(): void;
    /** The id of the consumer that took the event, or null. */
    dispatch(e: ToolEvent): null | string;
    /** Returns the unregister function. Ids are unique per router. */
    register(c: ToolConsumer): () => void;
};
```

Refers to [`ToolConsumer`](#toolconsumer), [`ToolEvent`](#toolevent).

## `TopDownController`

_interface_ in `motion/top-down.ts`

```ts
interface TopDownController {
    velocity(): Vec2;
    /** `intent` is a direction in the unit disc; a longer one is clamped to it. */
    step(dtMs: number, intent: Vec2): MotionResult;
}
```

Refers to [`MotionResult`](#motionresult).

## `TopDownOptions`

_type_ in `motion/top-down.ts`

```ts
type TopDownOptions = {
    /** m/s² toward the intended velocity. */
    accel: number;
    /** m/s² back to rest when there is no intent. */
    decel: number;
    /** m/s. */
    maxSpeed: number;
};
```

## `TransitionSpec`

_type_ in `game/flow.ts`

How a scene change looks; transitions are visual only and run in the host.

```ts
type TransitionSpec = {
    color?: number;
    kind: "fade" | "none" | (string & {});
    ms?: number;
};
```

## `ViewLayer`

_type_ in `context.ts`

```ts
type ViewLayer = DrawLayer | number;
```

Refers to [`DrawLayer`](#drawlayer).

## `ViewLayerHandle`

_type_ in `context.ts`

An opaque handle to one draw layer, for games that draw their own; the Pixi view's is a Container in world px.

```ts
type ViewLayerHandle = {
    readonly __viewLayer: true;
};
```

## `VisualOptions`

_type_ in `systems/bodies.ts`

Where a system draws its entities, and whether it draws them at all.

```ts
type VisualOptions = {
    /** False when the game draws the entities itself. */
    draw?: boolean;
    /** The draw layer for every entity, whatever its `layer`; omitted, the entity's layer, else the system's default. */
    layer?: ViewLayer;
};
```

Refers to [`ViewLayer`](#viewlayer).

## `WaypointMode`

_type_ in `systems/path-follower.ts`

Ping-pong reverses at the ends; loop runs the closing segment from last back to first.

```ts
type WaypointMode = "loop" | "ping_pong";
```

## `WaypointState`

_type_ in `systems/path-follower.ts`

```ts
type WaypointState = {
    currentIndex: number;
    direction: -1 | 1;
    nextIndex: number;
    pauseRemainingMs: number;
    t: number;
};
```

## `WorldState`

_type_ in `game/save-file.ts`

```ts
type WorldState = {
    /** Runtime id counters by name. */
    counters: Readonly<Record<string, number>>;
    /** Scene entities destroyed since the load. */
    destroyed: readonly string[];
    enabled: Readonly<Record<string, false>>;
    /** `[x, y, angle]`, metres and radians. */
    poses: Readonly<Record<string, readonly [
        number,
        number,
        number
    ]>>;
    random: RngState;
    seats: readonly {
        devices: readonly DeviceId[];
        player: number;
    }[];
    spawned: readonly {
        id: string;
        input: SpawnInput;
        instance?: InstantiateOptions & {
            prefab: AssetId;
        };
    }[];
    systems: SavedSystems;
    tick: number;
    /** Pending emit-form timers. */
    timers: readonly SavedTimer[];
};
```

Refers to [`DeviceId`](#deviceid), [`InstantiateOptions`](#instantiateoptions), [`SavedSystems`](#savedsystems), [`SavedTimer`](#savedtimer), [`SpawnInput`](#spawninput).

## `advanceAlongPath`

_function_ in `systems/path-follower.ts`

Advances `state` by `dtMs` at the path's speed, pause and mode.

```ts
declare function advanceAlongPath(state: WaypointState, waypoints: Vec2[], path: PathDef, dtMs: number): WaypointState;
```

Refers to [`WaypointState`](#waypointstate).

## `advanceWaypoint`

_function_ in `systems/path-follower.ts`

Advance waypoint state by dt. Returns new state (immutable).

```ts
declare function advanceWaypoint(state: WaypointState, waypoints: Vec2[], speed: number, dtMs: number, pauseMs: number, mode: WaypointMode): WaypointState;
```

Refers to [`WaypointMode`](#waypointmode), [`WaypointState`](#waypointstate).

## `angleField`

_function_ in `game/fields.ts`

An angle, clockwise (y down): turned and mirrored with its entity.

```ts
declare function angleField(description: string, unit: "deg"): z.ZodNumber;
```

## `assetField`

_function_ in `game/fields.ts`

A reference to a project asset of one of `kinds`. Parsing takes any id;
the JSON Schema's enum of the project's live ids comes from `env`.

```ts
declare function assetField(env: FieldEnv, kinds: AssetKindName | readonly AssetKindName[], description: string): z.ZodType<AssetId>;
```

Refers to [`FieldEnv`](#fieldenv).

## `assetKindsOf`

_function_ in `game/fields.ts`

The kinds an assetField names, or null for any other schema.

```ts
declare function assetKindsOf(schema: z.core.$ZodType): null | readonly AssetKindName[];
```

## `bindingKeyLabel`

_function_ in `input/keycaps.ts`

A key or pointer binding as its keycap; null for a pad or touch binding.

```ts
declare function bindingKeyLabel(binding: Binding): null | string;
```

Refers to [`Binding`](#binding).

## `bindingProblems`

_function_ in `game/input-bindings.ts`

The one check every path that accepts a binding calls: the registry, the
input-map kind, a rebind, the host's bindings and `scene input`. Judges
the device's vocabulary (a key code, a pad button, axis or stick, a
pointer button, a declared touch control), with a did-you-mean over the
code tables; whether the binding's shape fits its action's kind; and a
key binding's seat against `max`.

```ts
declare function bindingProblems(binding: Binding, ctx: BindingContext): BindingProblem[];
```

Refers to [`Binding`](#binding), [`BindingContext`](#bindingcontext), [`BindingProblem`](#bindingproblem).

## `bodyLocalShape`

_function_ in `systems/bodies.ts`

`shape` in the frame of a body `posedBodyDesc` made from it: centred and unrotated.

```ts
declare function bodyLocalShape(shape: ShapeObj): ShapeObj;
```

## `bodyShapeField`

_function_ in `game/fields.ts`

A shape tuple field for a body: any shape type but `chain`. Every body field shares one schema, so one `$defs` entry.

```ts
declare function bodyShapeField(description: string): z.ZodType<ShapeTuple>;
```

## `boundsCells`

_function_ in `grid/geometry.ts`

Every cell of `b` in cell-key order: column by column, each from its top row down.

```ts
declare function boundsCells(b: CellBounds): Cell[];
```

Refers to [`Cell`](#cell), [`CellBounds`](#cellbounds).

## `buildNavMesh`

_function_ in `nav/navmesh.ts`

Walk areas triangulated with their holes and stitched where they share an
edge's exact endpoints. Polygons that break the walk rules
(`walkPolygonIssues`) are reported and left out.

```ts
declare function buildNavMesh(areas: readonly {
    id: string;
    pts: readonly Pt[];
}[], holes: readonly {
    id: string;
    pts: readonly Pt[];
}[]): {
    issues: NavIssue[];
    mesh: NavMesh;
};
```

Refers to [`NavIssue`](#navissue), [`NavMesh`](#navmesh).

## `carrierDelta`

_function_ in `systems/path-follower.ts`

How far the body carrying a collider moved in the last step: its
follower's `frameDelta` (an attached collider's carrier, else its own
entity's), or the `path-follow` behavior's for a body it moves; null when
neither moves it.

```ts
declare function carrierDelta(ctx: EngineContext, handle: number): Vec2 | null;
```

Refers to [`EngineContext`](#enginecontext).

## `castSpawn`

_function_ in `runtime/cast.ts`

Where an actor of `shape` placed at `at` comes to rest: carried along its
`cast` direction (gravity's by default) onto the first non-sensor collider,
within the scene's bounds, on either backend. Refused when the shape
already overlaps one there (through `ctx.space`); with no direction (zero
gravity, `"none"`, a zero vector) or nothing ahead it stays at `at`. Gated
colliders don't count.

```ts
declare function castSpawn(ctx: EngineContext, at: Vec2, shape: SpawnShape): CastResult;
```

Refers to [`CastResult`](#castresult), [`EngineContext`](#enginecontext), [`SpawnShape`](#spawnshape).

## `cellKey`

_function_ in `grid/geometry.ts`

```ts
declare function cellKey(c: Cell): CellKey;
```

Refers to [`Cell`](#cell), [`CellKey`](#cellkey).

## `cellOf`

_function_ in `grid/geometry.ts`

```ts
declare function cellOf(k: CellKey): Cell;
```

Refers to [`Cell`](#cell), [`CellKey`](#cellkey).

## `clamp`

_function_ in `math.ts`

Clamp a number between min and max

```ts
declare function clamp(value: number, min: number, max: number): number;
```

## `clampTiming`

_function_ in `game/live.ts`

The timing a game gets when `wanted` is asked for: `next-load` is always
allowed, and a timing the game doesn't list falls to the strongest listed
one below it (`now`, then `boundary`, then `next-load`).

```ts
declare function clampTiming(live: LiveDeclaration | undefined, wanted: SwapTiming): {
    clamped: boolean;
    timing: SwapTiming;
};
```

Refers to [`LiveDeclaration`](#livedeclaration), [`SwapTiming`](#swaptiming).

## `clampVec2`

_function_ in `math.ts`

Clamp a Vec2 component-wise between min and max Vec2s

```ts
declare function clampVec2(v: Vec2, min: Vec2, max: Vec2): Vec2;
```

## `composePose`

_function_ in `runtime/poses.ts`

A body-local `offset` placed on a body at `x, y` turned `rot` radians: the world pose it rides to.

```ts
declare function composePose(x: number, y: number, rot: number, offset: Pose): Pose;
```

Refers to [`Pose`](#pose).

## `createDataSystem`

_function_ in `systems/data.ts`

A system for a type whose entities are data a game reads (`system:
createDataSystem`): it keeps the live ones and simulates and draws
nothing, so a disabled entity keeps its record as it is.

```ts
declare function createDataSystem<E extends RuntimeEntity = RuntimeEntity>(_ctx?: EngineContext, _type?: RegisteredType): DataSystem<E>;
```

Refers to [`DataSystem`](#datasystem), [`EngineContext`](#enginecontext), [`RegisteredType`](#registeredtype).

## `createDecorSystem`

_function_ in `systems/decor.ts`

Pictures with no body. The runtime gives each its spawn pose and the
sprite behavior draws it, so this system only keeps count: nothing
enters the physics world.

```ts
declare function createDecorSystem(_ctx: EngineContext, _type: RegisteredType): SceneSystem<DecorEntity>;
```

Refers to [`DecorEntity`](#decorentity), [`EngineContext`](#enginecontext), [`RegisteredType`](#registeredtype), [`SceneSystem`](#scenesystem).

## `createFollowerSystem`

_function_ in `systems/path-follower.ts`

Kinematic bodies that follow their `path`, advanced in `beforeStep`;
poses and visuals follow in `afterStep`, and so do the entities attached
to them. In a scene without physics a follower has no body: its pose,
and its geometry collider, follow the path all the same.

A disabled follower's path clock keeps running, but it has no collider
(its body's riders lose theirs with it), no visual and posts no poses;
enabling it snaps it to where its path is now.

Each follower answers `ctx.bodies` as a kinematic body whose velocity is
what its path moved it by in the last step; its path alone sets it.

```ts
declare function createFollowerSystem(ctx: EngineContext, type: RegisteredType, opts?: FollowerOptions): FollowerSystem;
```

Refers to [`EngineContext`](#enginecontext), [`FollowerOptions`](#followeroptions), [`FollowerSystem`](#followersystem), [`RegisteredType`](#registeredtype).

## `createGridStepper`

_function_ in `motion/grid-step.ts`

A stepper for `entityId` on the loaded scene's grid, standing on `start`'s
centre. Each step takes `ticksFor(msPerStep, ctx.time)` ticks, writes the
entity's pose every tick (moving `body` along with it when given) and ends
exactly on the target's centre. With `occupy`, the entity stands in
`ctx.grid.occupancy` and a step moves it to its target as the step
starts. Without a grid nothing moves and every step is refused. A world
save keeps the cell, the step under way and its reservation; the pose is
the runtime's (and the body's) to put back.

```ts
declare function createGridStepper(ctx: EngineContext, entityId: string, opts: {
    body?: MotionBody;
    msPerStep: number;
    occupy?: boolean;
    start: Cell;
}): GridStepper;
```

Refers to [`Cell`](#cell), [`EngineContext`](#enginecontext), [`GridStepper`](#gridstepper), [`MotionBody`](#motionbody).

## `createMarkerSystem`

_function_ in `systems/marker.ts`

Named points with no body; a game reads them, e.g. to place its actors on load.

```ts
declare function createMarkerSystem(ctx: EngineContext, type: RegisteredType): MarkerSystem;
```

Refers to [`EngineContext`](#enginecontext), [`MarkerSystem`](#markersystem), [`RegisteredType`](#registeredtype).

## `createMotionBody`

_function_ in `motion/body.ts`

Rapier: a kinematic position-based body with a character controller
(`opts.controller`, default `TOP_DOWN_CONTROLLER`); geometry: a kinematic
collider, sweep and slide.
It answers `ctx.bodies` as a kinematic body, its stored velocity read
and written there.

```ts
declare function createMotionBody(ctx: EngineContext, entity: {
    id: string;
    type: string;
}, at: Vec2, opts: MotionBodyOptions): MotionBody;
```

Refers to [`EngineContext`](#enginecontext), [`MotionBody`](#motionbody), [`MotionBodyOptions`](#motionbodyoptions).

## `createNavSystem`

_function_ in `systems/nav.ts`

Walk areas and the holes cut out of them. Nothing enters the physics
world: the runtime builds a mesh from these on demand (`ctx.nav`).

```ts
declare function createNavSystem(_ctx: EngineContext, _type: RegisteredType): NavSystem;
```

Refers to [`EngineContext`](#enginecontext), [`NavSystem`](#navsystem), [`RegisteredType`](#registeredtype).

## `createOccupancy`

_function_ in `grid/occupancy.ts`

```ts
declare function createOccupancy(): Occupancy;
```

Refers to [`Occupancy`](#occupancy).

## `createOverlapTracker`

_function_ in `systems/bodies.ts`

```ts
declare function createOverlapTracker(ctx: EngineContext): OverlapTracker;
```

Refers to [`EngineContext`](#enginecontext), [`OverlapTracker`](#overlaptracker).

## `createPlacementTool`

_function_ in `placement.ts`

Select a template, move its ghost with the pointer, rotate it, place it:
validate, then commit. The host decides what a placement makes (a body
mid-game, an `add` op in the editor) and how the ghost is drawn.

```ts
declare function createPlacementTool<T>(opts: PlacementToolOptions<T>): PlacementTool<T>;
```

Refers to [`PlacementTool`](#placementtool), [`PlacementToolOptions`](#placementtooloptions).

## `createPool`

_function_ in `runtime/pool.ts`

A pool over `spawn`: `acquire` enables the most recently freed (disabled)
entity before spawning a new one, up to `max` entities in all; an entity
disabled by any means (a `lifetime` with `then: "disable"`) is free
again, and a destroyed one leaves the pool.

It belongs to the load it was made in: its subscriptions end with that
load, and the next load gives out the same counter ids again, so after it
`acquire` and `release` throw `EngineError("pool-stale")` and `free` and
`live` read 0. Create the pool in `onLoad` (or later) and drop it at unload.

```ts
declare function createPool(ctx: EngineContext, opts: {
    max?: number;
    spawn: () => string;
}): Pool;
```

Refers to [`EngineContext`](#enginecontext), [`Pool`](#pool).

## `createPropSystem`

_function_ in `systems/bodies.ts`

```ts
declare function createPropSystem(ctx: EngineContext, type: RegisteredType): SceneSystem<PropEntity>;
```

Refers to [`EngineContext`](#enginecontext), [`RegisteredType`](#registeredtype), [`SceneSystem`](#scenesystem).

## `createRegistry`

_function_ in `game/define.ts`

Merges the engine's primitives with a game's types, materials, actions,
collision groups and issue codes, and the project's materials over the
game's, and the engine's behaviors then the game's. Without a game the
actions are `DEFAULT_ACTIONS`. Throws
`RegistryError` listing every problem: duplicate or reserved names, bulk
keys or codes, a type without a system, a spawn-only type that never
loads or has a bulk form, a spawn order that misses or
repeats a type, unknown groups, a game behavior outside the game's
namespace, a behavior `template` its fields or `refine` refuse, a
behavior's `requires` or `conflicts` naming an unknown behavior, behavior
rules naming unknown behaviors, failing their schemas or requiring two
that conflict, a grid field without a point `at`, a `time.rate` the clock can't run
(`tick-rate-invalid`), an unknown `time.kind` or a `time.catchUp.maxMs` that
isn't a whole number ≥ 0, world defaults the scene settings would refuse, and
`world.gridWalls` naming a type that is unknown or never loads, and input
the shell can't read: seats outside 1–8, a deadzone outside 0–1, an
unknown action kind, a `ui` flag other than `true`, a 0.x key `keysProblems` refuses and every binding
`bindingProblems` refuses (`binding-unknown`, `player-unknown`).

```ts
declare function createRegistry(game?: GameDefinition | null, opts?: CreateRegistryOptions): Registry;
```

Refers to [`CreateRegistryOptions`](#createregistryoptions), [`GameDefinition`](#gamedefinition), [`Registry`](#registry).

## `createSensorCollider`

_function_ in `collisions.ts`

Turns `desc` into a sensor in the registry's `sensor` group and attaches
it to `body`. Sensors are fixed and actors often kinematic, a pairing
Rapier skips by default, so those pairs are switched on too.

```ts
declare function createSensorCollider(ctx: Pick<EngineContext, "physics" | "rapier" | "registry">, body: RigidBody, desc: ColliderDesc): Collider;
```

Refers to [`EngineContext`](#enginecontext).

## `createSensorSystem`

_function_ in `systems/bodies.ts`

```ts
declare function createSensorSystem(ctx: EngineContext, type: RegisteredType): SensorSystem;
```

Refers to [`EngineContext`](#enginecontext), [`RegisteredType`](#registeredtype), [`SensorSystem`](#sensorsystem).

## `createSideViewController`

_function_ in `motion/side-view.ts`

Run and jump under gravity, down being +y: the speed along the ground
turns toward `move × maxSpeed` at `accel` (or eases to rest at `decel`),
scaled by `airControl` off the ground; a jump rises `jumpHeight` under
`ctx.gravity.y × gravityScale`, falls no faster than `maxFallSpeed`, and
keeps `jumpCut` of its upward speed when released early. A jump works for
`coyoteMs` after leaving the ground, and a press is kept `jumpBufferMs`
for the landing. It walks up slopes to `maxSlopeDeg`, climbs steps to
`stepHeight` and sticks to ground within `snapToGround` below it.

Both backends follow one rule: `ctx.space` sweeps of `shape` find how far
each move goes and what it meets, then the body moves that far, so
grounding is one downward sweep. The
velocity lives on the body; it and the timers are in `save`, and a world
save keeps them under the `side-view` owner.

```ts
declare function createSideViewController(ctx: EngineContext, body: MotionBody, opts: SideViewOptions): SideViewController;
```

Refers to [`EngineContext`](#enginecontext), [`MotionBody`](#motionbody), [`SideViewController`](#sideviewcontroller), [`SideViewOptions`](#sideviewoptions).

## `createSolidSystem`

_function_ in `systems/bodies.ts`

```ts
declare function createSolidSystem(ctx: EngineContext, type: RegisteredType, opts?: SolidOptions): SolidSystem;
```

Refers to [`EngineContext`](#enginecontext), [`RegisteredType`](#registeredtype), [`SolidOptions`](#solidoptions), [`SolidSystem`](#solidsystem).

## `createTopDownController`

_function_ in `motion/top-down.ts`

Free movement in the plane: the velocity turns toward `intent × maxSpeed`
at `accel` (or eases to rest at `decel`), the body moves by it, and what
it hits takes away the part of the velocity heading into it. The velocity
lives on the body, so a world save keeps it.

```ts
declare function createTopDownController(body: MotionBody, opts: TopDownOptions): TopDownController;
```

Refers to [`MotionBody`](#motionbody), [`TopDownController`](#topdowncontroller), [`TopDownOptions`](#topdownoptions).

## `declaredBindings`

_function_ in `game/input-bindings.ts`

An action's bindings: its `bindings`, else its 0.x layout `keys` as a key
binding for every code `KEY_TO_CODE` gives each key. A key the table
doesn't know binds nothing here; `keysProblems` refuses it where the
action enters.

```ts
declare function declaredBindings(def: {
    bindings?: readonly Binding[];
    keys?: readonly string[];
}): readonly Binding[];
```

Refers to [`Binding`](#binding).

## `defineBehavior`

_function_ in `game/behaviors.ts`

Identity at runtime; types the definition. Names and rules are checked when a registry is built.

```ts
declare function defineBehavior<F extends z.ZodRawShape>(def: BehaviorDef<F>): BehaviorDef<F>;
```

Refers to [`BehaviorDef`](#behaviordef).

## `defineEntityType`

_function_ in `game/define.ts`

Declares an entity type; the identity, typed so `EntityOf` can read its fields.

```ts
declare function defineEntityType<F extends z.ZodRawShape>(def: EntityTypeDef<F>): EntityTypeDef<F>;
```

Refers to [`EntityTypeDef`](#entitytypedef).

## `defineGame`

_function_ in `game/define.ts`

Declares a game; checked when a registry is built from it.

```ts
declare function defineGame<S, G = unknown>(def: GameDefinition<S, G>): GameDefinition<S, G>;
```

Refers to [`GameDefinition`](#gamedefinition).

## `degToRad`

_function_ in `physics.ts`

```ts
declare function degToRad(deg: number): number;
```

## `distanceVec2`

_function_ in `math.ts`

Distance between two Vec2s

```ts
declare function distanceVec2(a: Vec2, b: Vec2): number;
```

## `drawEntity`

_function_ in `systems/bodies.ts`

Draws an entity in its type's look; nothing without a view or a look, or
for an entity with a sprite, which draws instead. An entity with a `z` or
a `layer` gets its depth, which orders it inside its layer and makes it
one of the layer's entity visuals (hidden in play on an editor-only one).

```ts
declare function drawEntity(ctx: Pick<EngineContext, "registry" | "view">, type: RegisteredType, e: {
    behaviors?: RuntimeEntity["behaviors"];
    id: string;
    layer?: string;
    material?: string;
    shape: ShapeObj;
    z?: number;
}, layer: ViewLayer, shape?: ShapeObj): void;
```

Refers to [`EngineContext`](#enginecontext), [`RegisteredType`](#registeredtype), [`ViewLayer`](#viewlayer).

## `drawShape`

_function_ in `render/draw-shape.ts`

Trace `shape` into `g` at `scale` (as `traceShape`), fill it with
`style.fill` and stroke it with `style.stroke` at `style.strokeAlpha ??
style.alpha`, `style.strokeWidth` px wide whatever the scale. An open
shape has no fill, so it strokes in its fill color when the style has no
stroke.

```ts
declare function drawShape(g: Graphics, shape: ShapeObj, style: Style, scale?: number): void;
```

Refers to [`Style`](#style).

## `effectiveSaveLimits`

_function_ in `game/save-file.ts`

min(the game's limits or the defaults, `MAX_BROWSER_SAVE_LIMITS` for a browser store, the store's own).

```ts
declare function effectiveSaveLimits(game: Pick<GameDefinition, "saves"> | null, store?: SaveLimitsStore): SaveLimits;
```

Refers to [`GameDefinition`](#gamedefinition), [`SaveLimits`](#savelimits), [`SaveLimitsStore`](#savelimitsstore).

## `fieldOfView`

_function_ in `grid/fov.ts`

Visible cells within `radius` steps (Chebyshev on squares, hex distance on
hexes), the origin included whatever it is: symmetric shadowcasting on
squares, a line to each cell on hexes. Opaque cells in view are visible;
the cells they hide are not.

```ts
declare function fieldOfView(grid: GridGeometry, origin: Cell, radius: number, opaque: (c: Cell) => boolean): Set<CellKey>;
```

Refers to [`Cell`](#cell), [`CellKey`](#cellkey), [`GridGeometry`](#gridgeometry).

## `findPath`

_function_ in `grid/path.ts`

A*: integer costs, a binary heap ordered by (f, h, insertion), so one answer everywhere.

```ts
declare function findPath(grid: GridGeometry, from: Cell, to: Cell, opts?: GridPathOptions): GridPath | null;
```

Refers to [`Cell`](#cell), [`GridGeometry`](#gridgeometry), [`GridPath`](#gridpath), [`GridPathOptions`](#gridpathoptions).

## `flowField`

_function_ in `grid/flow.ts`

Dijkstra outwards from every goal at once over the same steps `findPath`
takes, run backwards: a cell's cost is what walking from it to the nearest
goal costs. Without `bounds`, the field's bounds are the cells it reached.

```ts
declare function flowField(grid: GridGeometry, goals: readonly Cell[], opts?: GridPathOptions & {
    maxCost?: number;
}): FlowField;
```

Refers to [`Cell`](#cell), [`FlowField`](#flowfield), [`GridGeometry`](#gridgeometry), [`GridPathOptions`](#gridpathoptions).

## `flowIssue`

_function_ in `game/flow.ts`

Why `id` can't be used as `use` under `list`, or null when it can. A
start or a `go` target must be listed and not a sublevel; an attached
scene must be listed. A missing start is `start-scene-missing`; a `go` to
a scene that isn't a main scene of the list is `scene-unlisted` as an
error; an attach of an unlisted scene is `sublevel-invalid` with
`detail.reason` "unlisted".

```ts
declare function flowIssue(list: readonly SceneListEntry[], id: AssetId | null, use: FlowUse): SceneIssue | null;
```

Refers to [`FlowUse`](#flowuse), [`SceneListEntry`](#scenelistentry).

## `forgetOneWayActor`

_function_ in `systems/bodies.ts`

Forgets an actor that is gone, with every solid system's passes for it.
With `passes` (the set `oneWayPasses` gave), only while that set is still
the actor's: a body made for it since keeps its own.

```ts
declare function forgetOneWayActor(ctx: EngineContext, actorId: string, passes?: ReadonlySet<number>): void;
```

Refers to [`EngineContext`](#enginecontext).

## `formatSaveFile`

_function_ in `game/save-file.ts`

Canonical JSON with a trailing newline; a save's size is the UTF-8 length of this text.

```ts
declare function formatSaveFile(file: SaveFile): string;
```

Refers to [`SaveFile`](#savefile).

## `gridField`

_function_ in `game/fields.ts`

Cells on the scene's grid, local to the entity's `at`. `values` names
cells 1..n for the schema and inspector; `max` defaults to
`values.length`, or 65535 without `values`. Parsing rewrites the value
canonically (`canonicalGrid`), so a hand-written row comes out as the
formatter writes it.

```ts
declare function gridField(description: string, opts?: {
    max?: number;
    values?: readonly string[];
}): z.ZodType<GridCells>;
```

## `gridFieldInfo`

_function_ in `game/fields.ts`

The values and largest value a gridField takes, or null for any other schema.

```ts
declare function gridFieldInfo(schema: z.core.$ZodType): GridFieldInfo | null;
```

Refers to [`GridFieldInfo`](#gridfieldinfo).

## `gridGeometry`

_function_ in `grid/geometry.ts`

```ts
declare function gridGeometry(settings: GridSettings): GridGeometry;
```

Refers to [`GridGeometry`](#gridgeometry), [`GridSettings`](#gridsettings).

## `gridMissingIssue`

_function_ in `runtime/grid.ts`

The `grid-invalid` issue for a scene with no grid; `what` ends the message: "to draw", "for check x to find paths on".

```ts
declare function gridMissingIssue(sceneName: string, what: string): SceneIssue;
```

## `gridPlace`

_function_ in `runtime/grid.ts`

```ts
declare function gridPlace(grid: RuntimeGrid, registry: Registry, place: Cell | RuntimeEntity): GridPlace;
```

Refers to [`Cell`](#cell), [`GridPlace`](#gridplace), [`Registry`](#registry), [`RuntimeGrid`](#runtimegrid).

## `gridRoute`

_function_ in `runtime/grid.ts`

A path over the grid's passable cells within its bounds, or null; none from a blocked start.

```ts
declare function gridRoute(grid: RuntimeGrid, from: Cell, to: Cell, diagonals: boolean): GridPath | null;
```

Refers to [`Cell`](#cell), [`GridPath`](#gridpath), [`RuntimeGrid`](#runtimegrid).

## `inCellBounds`

_const_ in `grid/geometry.ts`

Whether `c` lies in `b`, edges included.

```ts
declare const inCellBounds: (b: CellBounds, c: Cell) => boolean;
```

Refers to [`Cell`](#cell), [`CellBounds`](#cellbounds).

## `initialWaypointState`

_function_ in `systems/path-follower.ts`

At the first waypoint, heading for the second, not paused.

```ts
declare function initialWaypointState(): WaypointState;
```

Refers to [`WaypointState`](#waypointstate).

## `inputFor`

_function_ in `game/input-for.ts`

The seat's input for an entity carrying `player-input`, else a view that reads as nothing held.

```ts
declare function inputFor(ctx: EngineContext, entityId: string): SeatInput;
```

Refers to [`EngineContext`](#enginecontext), [`SeatInput`](#seatinput).

## `interpolatePosition`

_function_ in `systems/path-follower.ts`

Interpolate position between two waypoints at progress t

```ts
declare function interpolatePosition(a: Vec2, b: Vec2, t: number): Vec2;
```

## `isNavSystem`

_function_ in `systems/nav.ts`

Whether `system` is a nav system: the one `ctx.nav` reads its polygons from.

```ts
declare function isNavSystem(system: SceneSystem | undefined): system is NavSystem;
```

Refers to [`NavSystem`](#navsystem), [`SceneSystem`](#scenesystem).

## `isPolygonField`

_const_ in `game/fields.ts`

Whether a field is a `polygonField`, which takes concave polygons.

```ts
declare const isPolygonField: (schema: z.core.$ZodType) => boolean;
```

## `isRuntimeId`

_function_ in `game/runtime-ids.ts`

True for any id the runtime made rather than the loaded scene file: with
`#` in it (a spawn, a runtime instance's children such as `gate#2/door`)
or a sublevel label before a `:` (`cellar:door`, `cellar:~solid:0`; a
bulk id's own `~solid:0` isn't one).

```ts
declare function isRuntimeId(id: string): boolean;
```

## `isUiAction`

_function_ in `game/input-bindings.ts`

Whether `name` is a UI-only action (`ActionDef.ui`): resolved from devices
and delivered to `input.onAction` listeners, but never to the simulation,
a recording or a fuzz macro.

```ts
declare function isUiAction(registry: Registry, name: string): boolean;
```

Refers to [`Registry`](#registry).

## `keycapLabel`

_function_ in `input/keycaps.ts`

What a `KeyboardEvent.code` reads as on a keycap: `KeyA` is "A",
`Digit3` is "3", `Numpad4` is "Num 4", `ShiftLeft` is "Shift",
`ArrowLeft` is "←"; a code with no shorter name reads as itself.

```ts
declare function keycapLabel(code: string): string;
```

## `keysProblems`

_function_ in `game/input-bindings.ts`

What's wrong with an action's 0.x `keys`, read only when it has no
`bindings`: a key `KEY_TO_CODE` doesn't know would bind nothing, so it is
refused (`binding-unknown`) with a did-you-mean. The table is 0.x's
`KeyboardEvent.key` spelling, single characters lowercase: Space is
`" "`, not `"space"`. There are no aliases: `bindings` names keys by
`code`.

```ts
declare function keysProblems(def: {
    bindings?: readonly Binding[];
    keys?: readonly unknown[];
}): BindingProblem[];
```

Refers to [`Binding`](#binding), [`BindingProblem`](#bindingproblem).

## `kinematicBodyEntry`

_function_ in `runtime/bodies-control.ts`

A kinematic body whose owner moves it: `velocity` reads what the owner
reports, and `setVelocity`, when the owner takes one, writes what it
moves by; the angular velocity likewise, and a body whose owner takes
none never turns. Forces don't move it, so its mass is infinite.

```ts
declare function kinematicBodyEntry(id: string, motion: KinematicMotion): BodyEntry;
```

Refers to [`BodyEntry`](#bodyentry), [`KinematicMotion`](#kinematicmotion).

## `lengthUnitOf`

_function_ in `game/units.ts`

The length unit a field declares in `meta.unit`, looking through its wrappers; undefined for any other field.

```ts
declare function lengthUnitOf(schema: z.core.$ZodType): LengthUnitName | undefined;
```

## `lerp`

_function_ in `math.ts`

Linearly interpolate between two numbers

```ts
declare function lerp(a: number, b: number, t: number): number;
```

## `lerpVec2`

_function_ in `math.ts`

Linearly interpolate between two Vec2s

```ts
declare function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2;
```

## `lineOfSight`

_function_ in `grid/fov.ts`

Whether `b` is in `a`'s field of view at any radius: the same answer
`fieldOfView` gives, and symmetric between two cells that aren't opaque.

```ts
declare function lineOfSight(grid: GridGeometry, a: Cell, b: Cell, opaque: (c: Cell) => boolean): boolean;
```

Refers to [`Cell`](#cell), [`GridGeometry`](#gridgeometry).

## `materialField`

_function_ in `game/fields.ts`

An optional material, one of the registry's; the description lists each with its own.

```ts
declare function materialField(env: FieldEnv, description?: string): z.ZodOptional<z.ZodEnum<{
    [x: string]: string;
}>> | z.ZodOptional<z.ZodNever>;
```

Refers to [`FieldEnv`](#fieldenv).

## `mirrorField`

_function_ in `game/fields.ts`

Whether the entity is mirrored along `axis`: toggled when its entity is flipped across that axis.

```ts
declare function mirrorField(axis: "x", description: string): z.ZodBoolean;
```

## `navContains`

_function_ in `nav/navmesh.ts`

Whether `p` lies on the mesh, edges included.

```ts
declare function navContains(mesh: NavMesh, p: Pt): boolean;
```

Refers to [`NavMesh`](#navmesh).

## `navNearest`

_function_ in `nav/navmesh.ts`

The closest point on the mesh (for a click outside it); `p` itself when it's on the mesh or the mesh is empty.

```ts
declare function navNearest(mesh: NavMesh, p: Pt): Pt;
```

Refers to [`NavMesh`](#navmesh).

## `navPath`

_function_ in `nav/navmesh.ts`

A*: triangles by shared-edge midpoints, then the funnel; null when the
points aren't connected. A search state is a triangle and the edge it was
entered by (state `3 · triangle + edge`), so a triangle reached first
through a poor edge can still be reached through a better one.

```ts
declare function navPath(mesh: NavMesh, from: Pt, to: Pt): Pt[] | null;
```

Refers to [`NavMesh`](#navmesh).

## `oneWayPasses`

_function_ in `systems/bodies.ts`

The handles of the one-way colliders `actorId` passes through, from every
solid system's last `passesOneWay` for it: what its sweeps skip (a
`SpaceFilter`'s `skip`). The same live set for the actor on this context,
empty for an actor no system gated.

```ts
declare function oneWayPasses(ctx: EngineContext, actorId: string): ReadonlySet<number>;
```

Refers to [`EngineContext`](#enginecontext).

## `parseRuntimeId`

_function_ in `game/runtime-ids.ts`

`gate#2/door` as `{ name: "gate", label: "2", child: "door" }`; null for
anything that isn't a runtime id or a child of one.

```ts
declare function parseRuntimeId(id: string): null | {
    child?: string;
    label: string;
    name: string;
};
```

## `parseSaveFile`

_function_ in `game/save-file.ts`

Parses, checks the envelope, then migrates `{ persist, game }` from `gameVersion` up with the game's migrations.

```ts
declare function parseSaveFile(text: string, game?: Pick<GameDefinition, "id" | "saves">): ParseSaveResult;
```

Refers to [`GameDefinition`](#gamedefinition), [`ParseSaveResult`](#parsesaveresult).

## `parseShape`

_function_ in `scene/shapes.ts`

Accepts a tuple, a `ShapeObj`, or `{ type: "rect", left, top, right, bottom }`.

```ts
declare function parseShape(input: unknown, path?: string): ParseShapeResult;
```

Refers to [`ParseShapeResult`](#parseshaperesult).

## `parseSublevelId`

_function_ in `game/runtime-ids.ts`

`cellar:door` as `{ label: "cellar", id: "door" }`; null for anything that isn't a sublevel id.

```ts
declare function parseSublevelId(id: string): null | {
    id: string;
    label: string;
};
```

## `pathPosition`

_function_ in `systems/path-follower.ts`

Where `state` puts it on its path.

```ts
declare function pathPosition(waypoints: readonly Vec2[], state: WaypointState): Vec2;
```

Refers to [`WaypointState`](#waypointstate).

## `pathWaypoints`

_function_ in `systems/path-follower.ts`

A path's points as vectors.

```ts
declare function pathWaypoints(path: Pick<PathDef, "pts">): Vec2[];
```

## `physicsOf`

_function_ in `game/physics-of.ts`

Rapier and the world, or a PhysicsRequiredError naming `what` (a type, a system, a call).

```ts
declare function physicsOf(ctx: Pick<EngineContext, "physics" | "rapier">, what: string, entityId?: string): {
    physics: PhysicsWorld;
    rapier: RapierModule;
};
```

Refers to [`EngineContext`](#enginecontext), [`PhysicsWorld`](#physicsworld).

## `playersProblems`

_function_ in `game/input-bindings.ts`

What's wrong with a seats declaration: `max` a whole number from 1 to 8, `join` a known policy.

```ts
declare function playersProblems(players: PlayersDef): BindingProblem[];
```

Refers to [`BindingProblem`](#bindingproblem), [`PlayersDef`](#playersdef).

## `pointField`

_function_ in `game/fields.ts`

A point field, absolute world metres.

```ts
declare function pointField(description: string): z.ZodTuple<[
    z.ZodNumber,
    z.ZodNumber
], null>;
```

## `pointerBit`

_const_ in `game/input-codes.ts`

A pointer button's bit in a DOM `buttons` mask, and in a tick's recorded pointer buttons.

```ts
declare const pointerBit: (button: PointerButton) => number;
```

Refers to [`PointerButton`](#pointerbutton).

## `pointerButtonLabel`

_function_ in `input/keycaps.ts`

What a pointer button reads as: `primary` is "Click"; null for one with no name.

```ts
declare function pointerButtonLabel(button: string): null | string;
```

## `polygonField`

_function_ in `game/fields.ts`

A `["poly", …]` shape field with no convexity rule: any simple polygon, concave allowed.

```ts
declare function polygonField(description: string): z.ZodType<ShapeTuple>;
```

## `posedBodyDesc`

_function_ in `physics.ts`

A body descriptor posed for `shape` (see `shapePose`).

```ts
declare function posedBodyDesc(desc: RigidBodyDesc, shape: ShapeObj): RigidBodyDesc;
```

## `primitiveFields`

_function_ in `game/primitives.ts`

A primitive's fields for `env`, for a game type based on it (or wrapping
its system) to spread and extend rather than redeclare.

```ts
declare function primitiveFields<P extends PrimitiveType>(name: P, env: FieldEnv): ResolvedFields<(typeof PRIMITIVES)[P]>;
```

Refers to [`FieldEnv`](#fieldenv), [`PrimitiveType`](#primitivetype).

## `pxPerMetreOf`

_function_ in `game/units.ts`

The game's px per metre: `world.lengthUnit`, else the default.

```ts
declare function pxPerMetreOf(registry: Registry): number;
```

Refers to [`Registry`](#registry).

## `rapierBodyEntry`

_function_ in `runtime/bodies-control.ts`

A dynamic or static Rapier body; a static one answers reads and refuses writes.

```ts
declare function rapierBodyEntry(id: string, body: RigidBody, kind: "dynamic" | "static"): BodyEntry;
```

Refers to [`BodyEntry`](#bodyentry).

## `readPathPlace`

_function_ in `systems/path-follower.ts`

Reads `savePathPlace`'s output back; null when it doesn't fit `waypoints`.

```ts
declare function readPathPlace(state: JsonValue, waypoints: readonly Vec2[]): PathPlace | null;
```

Refers to [`JsonValue`](#jsonvalue), [`PathPlace`](#pathplace).

## `refField`

_function_ in `game/fields.ts`

A reference to another entity by id, or to an instance's child by its
resolved ref (`gate-2/door`, `room-1/door-1/panel`). The type's `refs`
say which types it may name.

```ts
declare function refField(description: string): z.ZodType<string>;
```

## `registerBody`

_function_ in `runtime/bodies-control.ts`

Registers `id`'s body with the context's `ctx.bodies`; the returned call
unregisters it. A context without one (a bare test context) registers
nothing.

```ts
declare function registerBody(ctx: EngineContext, id: string, entry: BodyEntry): () => void;
```

Refers to [`BodyEntry`](#bodyentry), [`EngineContext`](#enginecontext).

## `relativePose`

_function_ in `runtime/poses.ts`

`pose` in the frame `frame` is posed at: what a body-local offset is for a body placed at `frame`.

```ts
declare function relativePose(pose: Pose, frame: Pose): Pose;
```

Refers to [`Pose`](#pose).

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

Refers to [`ResolvedTime`](#resolvedtime), [`TimeModel`](#timemodel).

## `restoreOverlaps`

_function_ in `systems/bodies.ts`

```ts
declare function restoreOverlaps(tags: ColliderTags, saved: JsonValue | undefined): Overlaps;
```

Refers to [`ColliderTags`](#collidertags), [`JsonValue`](#jsonvalue), [`Overlaps`](#overlaps).

## `runtimeId`

_function_ in `game/runtime-ids.ts`

The id the `n`th spawn of `name` gets: `runtimeId("bullet", 12)` is `"bullet#12"`.

```ts
declare function runtimeId(name: string, n: number): string;
```

## `sameCell`

_const_ in `grid/geometry.ts`

```ts
declare const sameCell: (a: Cell, b: Cell) => boolean;
```

Refers to [`Cell`](#cell).

## `saveFileBytes`

_function_ in `game/save-file.ts`

A save's size: the UTF-8 length of its canonical text, what every limit is judged on.

```ts
declare function saveFileBytes(file: SaveFile): number;
```

Refers to [`SaveFile`](#savefile).

## `saveFileSchema`

_const_ in `game/save-file.ts`

The strict `save:v1` schema.

```ts
declare const saveFileSchema: z.ZodType<SaveFile>;
```

Refers to [`SaveFile`](#savefile).

## `saveOverlaps`

_function_ in `systems/bodies.ts`

```ts
declare function saveOverlaps(tags: ColliderTags, overlaps: Overlaps): SavedOverlap[];
```

Refers to [`ColliderTags`](#collidertags), [`Overlaps`](#overlaps).

## `savePathPlace`

_function_ in `systems/path-follower.ts`

A place on a path as plain JSON, for a world save.

```ts
declare function savePathPlace(m: PathPlace): JsonValue;
```

Refers to [`JsonValue`](#jsonvalue), [`PathPlace`](#pathplace).

## `scaleLengths`

_function_ in `game/units.ts`

`value` with every number under a length-unit field divided by
`pxPerMetre` (roundLength), through objects, tuples, arrays, records,
discriminated unions, optionals and defaults; other values unchanged.
A length unit on a container covers the numbers in it; a shape tuple's
`rotDeg` stays degrees.

```ts
declare function scaleLengths(value: unknown, schema: z.core.$ZodType, pxPerMetre: number): unknown;
```

## `sceneGrid`

_function_ in `runtime/grid.ts`

The scene's grid outside a runtime, rasterised as a load does: walls from
`wallTypes` (default `gridWallTypes(registry)`), no occupants.

```ts
declare function sceneGrid(scene: ExpandedScene, registry: Registry, wallTypes?: readonly string[]): RuntimeGrid | null;
```

Refers to [`Registry`](#registry), [`RuntimeGrid`](#runtimegrid).

## `scopedRef`

_function_ in `game/types.ts`

The entity `ref`, written on the entity `from`, names: the nearest
`<instance>/<ref>` among `from`'s instances, innermost first, else `ref`
itself. The one rule a behavior's entity reference resolves by, when an
instance expands and wherever one is read.

```ts
declare function scopedRef(from: string, ref: string, has: (id: string) => boolean): string;
```

## `seekAlongPath`

_function_ in `systems/path-follower.ts`

Advances `state` by `ms` as stepping would: whole ticks of `time.tickMs`,
then the rest in one advance.

```ts
declare function seekAlongPath(state: WaypointState, waypoints: Vec2[], path: PathDef, ms: number, time: {
    rate: number;
    tickMs: number;
}): WaypointState;
```

Refers to [`WaypointState`](#waypointstate).

## `shapeColliderDesc`

_function_ in `physics.ts`

Collider descriptor for `shape`. With `local` false the collider is centred
on a body placed at `shapePose(shape)`; with `local` true the shape's own
offset and rotation are applied relative to the body (path followers).

```ts
declare function shapeColliderDesc(rapier: RapierModule, shape: ShapeObj, local?: boolean): ColliderDesc;
```

## `shapeField`

_function_ in `game/fields.ts`

A shape tuple field, optionally limited to some shape types. `id` names its `$defs` entry, so use each id once.

```ts
declare function shapeField(description: string, only?: {
    id: string;
    owner: string;
    types: readonly ShapeType[];
}): z.ZodType<ShapeTuple>;
```

## `shapePose`

_function_ in `physics.ts`

Where a body carrying `shape` sits: the centre of a box, circle or capsule,
the origin for poly and chain (whose points are absolute).

```ts
declare function shapePose(shape: ShapeObj): {
    rotation: number;
    x: number;
    y: number;
};
```

## `sideField`

_function_ in `game/fields.ts`

A side of the entity, or `true` for `"up"`: turned and flipped with its entity.

```ts
declare function sideField(description: string): z.ZodType<Side | true>;
```

Refers to [`Side`](#side).

## `spawnPose`

_function_ in `runtime/spawn-pose.ts`

Where an entity starts, from its type's geometry: a shape's centre (a
path rider's shape placed at the path's first point), else its point
field, else its path's first point. The angle is the shape's `rotDeg`,
else `RuntimeEntity.transform`'s quarter turns.

```ts
declare function spawnPose(e: RuntimeEntity, registry: Registry): Pose;
```

Refers to [`Pose`](#pose), [`Registry`](#registry).

## `spriteGeometry`

_function_ in `game/behaviors/sprite.ts`

Where a sprite block draws, from `info` (`ProjectRuntimeView.asset` or
`assetInfo` of its asset and frame; omitted without one): its size is the
block's `size`, else the info's px over `pxPerMetre` (the game's,
`pxPerMetreOf`) times `scale`, else `SPRITE_FALLBACK_SIZE`; its anchor
the block's, else the info's pivot, else the centre.

```ts
declare function spriteGeometry(block: Partial<SpriteBlock>, info?: SpriteAssetInfo | null, pxPerMetre?: number): SpriteGeometry;
```

Refers to [`SpriteAssetInfo`](#spriteassetinfo), [`SpriteBlock`](#spriteblock), [`SpriteGeometry`](#spritegeometry).

## `styleOf`

_function_ in `game/style.ts`

The look of an entity of `type`: the type's style, else its base
primitive's, with the material's style winning field by field. Pure, so
the scene renderers share it with the runtime's systems.

```ts
declare function styleOf(ctx: Pick<EngineContext, "registry">, type: RegisteredType, material: string | undefined): Style | undefined;
```

Refers to [`EngineContext`](#enginecontext), [`RegisteredType`](#registeredtype), [`Style`](#style).

## `sublevelId`

_function_ in `game/runtime-ids.ts`

The id the sublevel `label` gives its entity `id`: `sublevelId("cellar", "door")` is `"cellar:door"`.

```ts
declare function sublevelId(label: string, id: string): string;
```

## `tagsField`

_function_ in `game/fields.ts`

Free-form labels a game reads, e.g. `["spawn"]`.

```ts
declare function tagsField(description: string): z.ZodOptional<z.ZodArray<z.ZodString>>;
```

## `tickRateProblem`

_function_ in `game/time.ts`

The `tick-rate-invalid` message for a bad rate, or null.

```ts
declare function tickRateProblem(rate: unknown): null | string;
```

## `ticksFor`

_function_ in `game/time.ts`

Whole ticks for `ms` at this rate, at least 1: what `forMs`, `{ ms }` timers and `msPerStep` use.

```ts
declare function ticksFor(ms: number, time: Pick<ResolvedTime, "rate">): number;
```

Refers to [`ResolvedTime`](#resolvedtime).

## `traceShape`

_function_ in `render/draw-shape.ts`

Trace `shape` into `g`, its coordinates times `scale` (the Pixi view passes
the game's px per metre, so the outline is built in world px and arcs keep
their smoothness); the caller fills or strokes.

```ts
declare function traceShape(g: Graphics, shape: ShapeObj, scale?: number): void;
```

## `vectorField`

_function_ in `game/fields.ts`

A direction or offset [dx, dy]: turned and mirrored with its entity, never translated.

```ts
declare function vectorField(description: string): z.ZodType<Pt>;
```

## `wholeTicksIn`

_function_ in `game/time.ts`

The whole ticks that fit in `ms` (rounded down) and the ms left over: what a seek runs.

```ts
declare function wholeTicksIn(ms: number, time: Pick<ResolvedTime, "rate">): {
    restMs: number;
    ticks: number;
};
```

Refers to [`ResolvedTime`](#resolvedtime).

## `withProject`

_function_ in `game/define.ts`

`registry`'s game with `view`'s live material assets overlaid by id
(`values` holds each asset's JSON; a material whose JSON isn't valid
is left out) and its live asset ids as the asset fields' choices.
Schema hashes for skew checks use the project-free registry instead.

```ts
declare function withProject(registry: Registry, view: ProjectView, values: ReadonlyMap<AssetId, unknown>): Registry;
```

Refers to [`Registry`](#registry).
