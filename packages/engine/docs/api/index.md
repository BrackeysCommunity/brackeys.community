# @jams/engine

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`ActionBindings`](#actionbindings) · [`AssetLoader`](#assetloader) · [`AssetReloadError`](#assetreloaderror) · [`AssetUrl`](#asseturl) · [`BindingLayerName`](#bindinglayername) · [`BindingLayers`](#bindinglayers) · [`BlendMode`](#blendmode) · [`BoundInput`](#boundinput) · [`CameraMode`](#cameramode) · [`CameraState`](#camerastate) · [`DEFAULT_INDEXED_DB_NAME`](#default_indexed_db_name) · [`DEFAULT_LOCAL_STORAGE_PREFIX`](#default_local_storage_prefix) · [`DEFAULT_RESOLUTION`](#default_resolution) · [`DeviceTables`](#devicetables) · [`Dihedral`](#dihedral) · [`ENGINE_VERSION`](#engine_version) · [`EffectLayer`](#effectlayer) · [`ExpandedScene`](#expandedscene) · [`FlowRequest`](#flowrequest) · [`FlowResult`](#flowresult) · [`FrameRect`](#framerect) · [`GameCommand`](#gamecommand) · [`GameConfig`](#gameconfig) · [`GameDefinition`](#gamedefinition) · [`GameEventMap`](#gameeventmap) · [`GameFlow`](#gameflow) · [`GameInput`](#gameinput) · [`GameInstance`](#gameinstance) · [`GameLive`](#gamelive) · [`GameMode`](#gamemode) · [`GamePhase`](#gamephase) · [`GameStoreState`](#gamestorestate) · [`IDENTITY_2D`](#identity_2d) · [`InputAction`](#inputaction) · [`InputBinding`](#inputbinding) · [`LIVE_CHECK_AGAIN_TICKS`](#live_check_again_ticks) · [`LIVE_DEFAULTS`](#live_defaults) · [`LiveContext`](#livecontext) · [`LiveDeclaration`](#livedeclaration) · [`LiveSceneVersions`](#livesceneversions) · [`LoadFailureReason`](#loadfailurereason) · [`LoadProgress`](#loadprogress) · [`LoadReport`](#loadreport) · [`LoadingView`](#loadingview) · [`LoadingViewFactory`](#loadingviewfactory) · [`MAX_PLAYERS`](#max_players) · [`MountUi`](#mountui) · [`ParticleLayer`](#particlelayer) · [`ParticleLayerOptions`](#particlelayeroptions) · [`ParticleTexture`](#particletexture) · [`PixiView`](#pixiview) · [`PixiViewOptions`](#pixiviewoptions) · [`PlayOptions`](#playoptions) · [`PlayOutcome`](#playoutcome) · [`PlayReport`](#playreport) · [`PlaySession`](#playsession) · [`PointerKind`](#pointerkind) · [`RapierModule`](#rapiermodule) · [`Registry`](#registry) · [`RemapState`](#remapstate) · [`RemapStore`](#remapstore) · [`RenderBackend`](#renderbackend) · [`RendererConfig`](#rendererconfig) · [`ResolutionPolicy`](#resolutionpolicy) · [`ResolutionViewport`](#resolutionviewport) · [`ResolvedBindings`](#resolvedbindings) · [`RunRecording`](#runrecording) · [`RuntimeEntity`](#runtimeentity) · [`SPRITE`](#sprite) · [`SPRITE_FALLBACK_SIZE`](#sprite_fallback_size) · [`SaveDepth`](#savedepth) · [`SaveLimits`](#savelimits) · [`SaveMeta`](#savemeta) · [`SaveSlots`](#saveslots) · [`SaveStore`](#savestore) · [`SaveSummary`](#savesummary) · [`SaveWriteResult`](#savewriteresult) · [`SceneDiff`](#scenediff) · [`SceneLibrary`](#scenelibrary) · [`SceneListEntry`](#scenelistentry) · [`SceneSource`](#scenesource) · [`SceneSwap`](#sceneswap) · [`SimState`](#simstate) · [`SpriteAssetInfo`](#spriteassetinfo) · [`SpriteBlock`](#spriteblock) · [`SpriteGeometry`](#spritegeometry) · [`SpriteVisual`](#spritevisual) · [`StagedVersion`](#stagedversion) · [`StepEvent`](#stepevent) · [`StepResult`](#stepresult) · [`SwapSide`](#swapside) · [`SwapStrategy`](#swapstrategy) · [`SwapTiming`](#swaptiming) · [`TOOL_PRIORITY`](#tool_priority) · [`TextureSource`](#texturesource) · [`ToolConsumer`](#toolconsumer) · [`ToolEvent`](#toolevent) · [`ToolRouter`](#toolrouter) · [`TouchControlDef`](#touchcontroldef) · [`TouchControlValue`](#touchcontrolvalue) · [`TouchControls`](#touchcontrols) · [`Transform2D`](#transform2d) · [`TransitionRunner`](#transitionrunner) · [`TransitionSpec`](#transitionspec) · [`UiActionEvent`](#uiactionevent) · [`UiContext`](#uicontext) · [`UiHandle`](#uihandle) · [`Vec2`](#vec2) · [`ViewportDef`](#viewportdef) · [`acceptedTimings`](#acceptedtimings) · [`acceptedTimingsWords`](#acceptedtimingswords) · [`applyPt`](#applypt) · [`applyVec`](#applyvec) · [`bindText`](#bindtext) · [`bindToWorld`](#bindtoworld) · [`browserRemapStore`](#browserremapstore) · [`browserSaveStore`](#browsersavestore) · [`clampTiming`](#clamptiming) · [`compose`](#compose) · [`composeDihedral`](#composedihedral) · [`createAssetLoader`](#createassetloader) · [`createEffectLayer`](#createeffectlayer) · [`createGame`](#creategame) · [`createLoadingOverlay`](#createloadingoverlay) · [`createParticleLayer`](#createparticlelayer) · [`createPixiView`](#createpixiview) · [`createTouchControls`](#createtouchcontrols) · [`createUiLayer`](#createuilayer) · [`diffWords`](#diffwords) · [`dihedral`](#dihedral-1) · [`dihedralOf`](#dihedralof) · [`drawSprite`](#drawsprite) · [`fadeTransition`](#fadetransition) · [`flipWorld`](#flipworld) · [`indexedDbSaveStore`](#indexeddbsavestore) · [`invert`](#invert) · [`liveSceneSource`](#livescenesource) · [`localStorageSaveStore`](#localstoragesavestore) · [`memoryRemapStore`](#memoryremapstore) · [`memorySaveStore`](#memorysavestore) · [`mountUi`](#mountui-1) · [`pixiContainer`](#pixicontainer) · [`resolveBindings`](#resolvebindings) · [`resolvePlayers`](#resolveplayers) · [`resolveResolution`](#resolveresolution) · [`selectCamera`](#selectcamera) · [`selectDebugMode`](#selectdebugmode) · [`selectFPS`](#selectfps) · [`selectGame`](#selectgame) · [`selectMode`](#selectmode) · [`selectPhase`](#selectphase) · [`selectSession`](#selectsession) · [`selectSim`](#selectsim) · [`selectTick`](#selecttick) · [`snapshotRemapStore`](#snapshotremapstore) · [`spriteGeometry`](#spritegeometry-1) · [`swapStrategyFor`](#swapstrategyfor) · [`timingWords`](#timingwords) · [`utf8Bytes`](#utf8bytes) · [`versionName`](#versionname) · [`viewportFor`](#viewportfor) · [`watchView`](#watchview)

## `ActionBindings`

_type_ in `types.ts`

A seat's bindings by action.

```ts
type ActionBindings = Readonly<Record<string, readonly Binding[]>>;
```

## `AssetLoader`

_type_ in `render/asset-loader.ts`

Textures by content hash, shared by every bundle that holds the hash,
counted per resident bundle and evicted least-recently-used past a byte
budget once no resident bundle holds them.

```ts
type AssetLoader = TextureSource & {
    destroy(): void;
    /** Loads every entry not resident; resolves when all are (failures reported, never thrown). */
    load(bundle: AssetBundle, onProgress?: (p: LoadProgress) => void): Promise<{
        failed: BundleEntry[];
    }>;
    release(bundle: AssetBundle): void;
    /** Marks a bundle resident (`retain`) or done with (`release`); textures no resident bundle holds may be evicted. */
    retain(bundle: AssetBundle): void;
    /**
     * Drops every resident texture's GPU copy, by hash, so the renderer that
     * draws next uploads it again from its decoded image: what a renderer
     * rebuilt after a lost GPU context needs. A host's own loader may leave it out.
     */
    reupload?(): void;
    stats(): {
        bytes: number;
        resident: string[];
        textures: number;
    };
    /** Evicts released textures least-recently-used until resident bytes fit the budget. */
    trim(): void;
};
```

Refers to [`LoadProgress`](#loadprogress), [`TextureSource`](#texturesource).

## `AssetReloadError`

_type_ in `runtime/types.ts`

An entity whose behavior blocks threw while redrawing for changed assets.
The blocks naming a changed asset were detached and attached afresh; its
other blocks keep their state. When that threw too (`reattached` false)
those blocks stay detached until an edit or a scene load replaces the
entity.

```ts
type AssetReloadError = {
    entityId: string;
    error: string;
    reattached: boolean;
};
```

## `AssetUrl`

_type_ in `render/asset-loader.ts`

Where the host serves a bundle entry's bytes: dev server, site API or an exported file.

```ts
type AssetUrl = (project: ProjectId, entry: BundleEntry) => string;
```

## `BindingLayerName`

_type_ in `input/bindings.ts`

Where a seat's bindings for an action came from, first to last in precedence.

```ts
type BindingLayerName = "game" | "host" | "map" | "remap";
```

## `BindingLayers`

_type_ in `input/bindings.ts`

The four layers, each optional but the game's.

```ts
type BindingLayers = {
    /** The game's `actions`, which also give each action its kind. */
    game: readonly ActionDef[];
    /** The host's `GameConfig.bindings`. */
    host?: null | readonly InputBinding[];
    /** The project's input map. */
    map?: Pick<InputMapFile, "actions"> | null;
    /** How many seats there are (`resolvePlayers(…).max`); default 1. */
    players?: number;
    /** The player's remaps (a `RemapStore`'s state), per seat. */
    remap?: RemapState | null;
};
```

Refers to [`InputBinding`](#inputbinding), [`RemapState`](#remapstate).

## `BlendMode`

_type_ in `context.ts`

```ts
type BlendMode = "add" | "multiply" | "normal" | "screen";
```

## `BoundInput`

_type_ in `input/bindings.ts`

One binding as a device table holds it.

```ts
type BoundInput = {
    action: string;
    binding: Binding;
    /**
     * The binding names its seat (a key binding's `player`), so it drives
     * that seat whoever owns the device; otherwise it drives `player` only
     * while that seat owns the device.
     */
    fixed: boolean;
    kind: ActionKind;
    /** The seat the input drives. */
    player: number;
};
```

## `CameraMode`

_type_ in `types.ts`

`follow` eases toward the game's camera target; `free` holds wherever it was put.

```ts
type CameraMode = "follow" | "free";
```

## `CameraState`

_type_ in `types.ts`

```ts
type CameraState = {
    bounds: {
        max: Vec2;
        min: Vec2;
    };
    mode: CameraMode;
    position: Vec2;
    /** Canvas px per world metre: the display scale (the policy's scale × the game's px per metre) times `zoom`. */
    scale: number;
    zoom: number;
};
```

Refers to [`CameraMode`](#cameramode), [`Vec2`](#vec2).

## `DEFAULT_INDEXED_DB_NAME`

_const_ in `saves/store.ts`

```ts
declare const DEFAULT_INDEXED_DB_NAME = "jams-engine-saves";
```

## `DEFAULT_LOCAL_STORAGE_PREFIX`

_const_ in `saves/store.ts`

```ts
declare const DEFAULT_LOCAL_STORAGE_PREFIX = "jams-engine:save:";
```

## `DEFAULT_RESOLUTION`

_const_ in `resolution.ts`

A fixed 1080 virtual px height (10.8 m at 100 px per metre), the width expanding with the canvas's aspect.

```ts
declare const DEFAULT_RESOLUTION: ResolutionPolicy;
```

Refers to [`ResolutionPolicy`](#resolutionpolicy).

## `DeviceTables`

_type_ in `input/bindings.ts`

Every binding by the device input it listens to, in action, then seat, then binding order.

```ts
type DeviceTables = {
    /** By `KeyboardEvent.code`. */
    keys: Table<string>;
    padAxes: Table<"lt" | "rt" | PadAxis>;
    padButtons: Table<PadButton>;
    padSticks: Table<"left" | "right">;
    pointer: Table<PointerButton>;
    /** By touch control id. */
    touch: Table<string>;
};
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

## `ENGINE_VERSION`

_const_ in `version.ts`

```ts
declare const ENGINE_VERSION = "0.15.0";
```

## `EffectLayer`

_interface_ in `render/effects.ts`

```ts
interface EffectLayer {
    /** A full-canvas colour (0xRRGGBB) fading over `ms`; reduced motion caps it at 0.3 alpha and 80 ms. */
    flash(opts?: {
        alpha?: number;
        color?: number;
        ms?: number;
    }): void;
    /** Time scale 0 for `ms` of wall time, then the scale before; overlapping stops extend to the latest end. */
    hitStop(ms: number): void;
    clear(): void;
}
```

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

Refers to [`RuntimeEntity`](#runtimeentity).

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

Refers to [`TransitionSpec`](#transitionspec).

## `FlowResult`

_type_ in `types.ts`

What a scene change did: the scene it loaded, or why it refused (`scene-unlisted`, `start-scene-missing`, a load's refusal).

```ts
type FlowResult = {
    issue: SceneIssue;
    ok: false;
} | {
    ok: true;
    report: LoadReport;
    scene: AssetId;
};
```

Refers to [`LoadReport`](#loadreport).

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

## `GameConfig`

_type_ in `types.ts`

```ts
type GameConfig = {
    /**
     * Where scenes' textures come from: the host's loader (built with its URL
     * scheme), the project view bundles are computed over, and its kinds.
     * Without it nothing is fetched and sprites draw as their boxes. `view`
     * is read each time a bundle is computed, so a getter can follow a live
     * project. The runtime view sprites size from is `createGame`'s `project`.
     */
    assets?: {
        kinds: KindRegistry;
        loader: AssetLoader;
        view: ProjectView;
    };
    backgroundColor: number;
    /**
     * The host's bindings: one of four layers per action and seat (the
     * player's remap, these, the project's input map, the game's `actions`).
     * The first layer that binds an action wins and replaces its bindings whole.
     */
    bindings?: readonly InputBinding[];
    camera: CameraConfig;
    /** `createDebugOverlay` from `@jams/engine/debug`, passed only in dev builds so production never bundles it. */
    debug?: DebugOverlayFactory;
    /** The game's debug layers, shown after the engine's as F3 cycles; dev builds only, like `debug`. */
    debugLayers?: readonly DebugLayerFactory[];
    /** Enables dev logging, and the debug overlay when `debug` is given; hosts pass their build's dev flag. */
    dev: boolean;
    displayHeight: number;
    displayWidth: number;
    /** Scenes for `GameInstance.flow`, and how a change between them looks. */
    flow?: {
        /** Shown when a load takes longer than 150 ms; default `createLoadingOverlay()`; false for none. */
        loading?: LoadingViewFactory | false;
        /** Where scenes come from: the site's files, a release's data, a test's map. */
        source: SceneSource;
        /** Runs a transition's halves; default `fadeTransition()` for "fade", nothing for "none". */
        transition?: TransitionRunner;
    };
    /** What the shell plays: its entity types, actions, hooks and play-mode tools; null plays an engine-only project's scenes under createRegistry(null). */
    game: GameDefinition | null;
    /** On-screen controls and where a player's remaps persist. */
    input?: {
        /** Where the player's remaps are saved and restored; none without one. */
        remaps?: RemapStore;
        /** When the input map's on-screen controls show; auto: on a coarse pointer (`matchMedia("(pointer: coarse)")`). */
        touch?: "always" | "auto" | "never";
    };
    /** Where pointer and key input is read. Defaults to the canvas, made focusable. */
    inputTarget?: HTMLElement;
    /**
     * Where key events are read instead, so editor shortcuts work with focus on
     * a panel beside the canvas (pointers still come only from `inputTarget`).
     * Play input still takes a key press only when focus is in `inputTarget`.
     * Defaults to `inputTarget`.
     */
    keyTarget?: HTMLElement | Window;
    maxDeltaTime: number;
    /** The prefabs scene documents' instances name; `setPrefabs` replaces them. */
    prefabs?: PrefabLibrary;
    /**
     * Loads the Rapier module: `() => import("@dimforge/rapier2d")` in a browser,
     * or `@dimforge/rapier2d-compat` (cast) after its `init()` in Bun or Node.
     * `createGame` awaits it only when the game's default physics (or the
     * start-up scene's) is Rapier; `preload` brings it in for a Rapier scene.
     * A game whose scenes all run without physics needs none.
     */
    rapier?: () => Promise<RapierModule>;
    /** The Rapier package and the project's snapshot, for Play's recordings; the engine fills the arch and runtime. */
    recording?: RecordingHost & {
        /**
         * Also records the scene flow's run outside the editor's Play: each
         * scene `flow` loads is a session until the next load, which ends it as
         * `flow`. A load from a save isn't recorded. Default false.
         */
        flow?: boolean;
    };
    /**
     * Whether shake, flashes, particles, fades and HUD animations calm down;
     * "auto" (the default) follows the page's `prefers-reduced-motion`.
     * Resolved once, at `createGame`.
     */
    reducedMotion?: "auto" | boolean;
    /** A registry the host already built from `game`, so host and shell share one; built here when omitted. */
    registry?: Registry;
    /** The release this instance plays; the recorder writes its id as `release`. */
    release?: {
        id: Sha256;
        manifest: ReleaseManifest;
    };
    /** How the shell draws, and what it shows while the GPU context is restored. */
    renderer?: RendererConfig;
    /** The host's resolution policy, over the project's and the game's. */
    resolution?: Partial<ResolutionPolicy>;
    /** The host's save store; a game's own (`GameDefinition.saves.store`) wins, and the browser's is the default. */
    saves?: SaveStore;
    /** Loaded on start, expanded through `registry` when it is a document. Without one the world is empty. */
    scene?: ExpandedScene | SceneDefinition;
    /** @deprecated Ignored: the loop ticks at the game's `time.rate` (or the project's `engine.tickRate`). */
    targetFPS: number;
    /**
     * Time where each tick and frame goes from the start: `runtime().stats().timing`
     * reports the runtime's step by part, the shell's tick around it, the
     * frame's work before the draw and Pixi's draw call. Default off, when
     * no tick or frame reads a clock for it; a dev host's debug overlay can
     * switch it on while the game runs.
     */
    timing?: boolean;
    /** Split screen or a minimap: 1–4 viewports over the canvas; default one framing the main targets. */
    viewports?: readonly ViewportDef[];
};
```

Refers to [`AssetLoader`](#assetloader), [`ExpandedScene`](#expandedscene), [`GameDefinition`](#gamedefinition), [`InputBinding`](#inputbinding), [`LoadingViewFactory`](#loadingviewfactory), [`RapierModule`](#rapiermodule), [`Registry`](#registry), [`RemapStore`](#remapstore), [`RendererConfig`](#rendererconfig), [`ResolutionPolicy`](#resolutionpolicy), [`SaveStore`](#savestore), [`SceneSource`](#scenesource), [`TransitionRunner`](#transitionrunner), [`ViewportDef`](#viewportdef).

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
    /** How the camera follows in Play; a scene's `settings.camera` wins over it. */
    camera?: CameraRigDef;
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
     * order, except `decor`, `nav` and `camera-region`, which then spawn last. Omitted means
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

Refers to [`LiveDeclaration`](#livedeclaration), [`ResolutionPolicy`](#resolutionpolicy).

## `GameEventMap`

_type_ in `types.ts`

```ts
type GameEventMap = {
    /** A scene change finished. */
    "flow:change": {
        entry: null | string;
        from: AssetId | null;
        to: AssetId;
    };
    /** A scene change's load progress. */
    "flow:loading": LoadProgress;
    "game:destroy": undefined;
    "game:pause": undefined;
    "game:start": undefined;
    "game:tick": {
        tick: number;
    };
    /**
     * A version couldn't be applied, or a replay can't have one it recorded;
     * `issue` says what happens next: after a refused swap step or a throwing
     * `onSwap` the old version keeps running and the new one loads next time,
     * and `scene-version-removed` stops the replay there.
     */
    "live:failed": {
        issue: SceneIssue;
        scene: AssetId;
        version: Sha256 | null;
    };
    /** A new version of the running scene was applied between ticks, after the game's `onSwap`. */
    "live:swapped": SceneSwap;
    /** The game's first verdict in a play session, from its `play.outcome`. */
    "play:outcome": PlayOutcome;
    /** A play session's recording, finished at the game's first verdict, a replay's last tick, or Stop. */
    "play:recorded": RunRecording;
    /** Rebuilding the renderer after a loss failed: nothing draws again, and `render:restored` never follows. */
    "render:failed": {
        backend: RenderBackend;
    };
    /** WebGPU failed at start or was lost, and the shell draws with WebGL for the rest of the session. */
    "render:fallback": {
        from: "webgpu";
        reason: "init" | "lost";
    };
    /** The GPU context or device was lost; the game pauses until it is restored. */
    "render:lost": {
        backend: RenderBackend;
    };
    /** Drawing resumed: in place (`rebuilt: false`) or on a new renderer. */
    "render:restored": {
        backend: RenderBackend;
        rebuilt: boolean;
    };
    /** A save didn't land; game code never sees why. */
    "save:failed": {
        issue: SceneIssue;
        slot: string;
    };
    /** A save landed in the store. */
    "save:written": {
        bytes: number;
        slot: string;
    };
    /** Each simulated tick in play mode, with the step's events and the game's snapshot. */
    "scene:step": StepResult;
};
```

Refers to [`LoadProgress`](#loadprogress), [`PlayOutcome`](#playoutcome), [`RenderBackend`](#renderbackend), [`RunRecording`](#runrecording), [`SceneSwap`](#sceneswap), [`StepResult`](#stepresult).

## `GameFlow`

_type_ in `types.ts`

`GameInstance.flow`: the scene list and changes between its scenes.

```ts
type GameFlow = {
    /** The main scene playing, or null. */
    current(): AssetId | null;
    /** Changes scene between ticks, through the transition; a `go` during a change waits for it. */
    go(to: AssetId, opts?: Omit<FlowRequest, "to">): Promise<FlowResult>;
    readonly scenes: readonly SceneListEntry[];
    readonly start: AssetId | null;
    /** Loads `start` with persist reset to the game's initial value. */
    restart(): Promise<FlowResult>;
};
```

Refers to [`FlowRequest`](#flowrequest), [`FlowResult`](#flowresult), [`SceneListEntry`](#scenelistentry).

## `GameInput`

_type_ in `types.ts`

The shell's input: bindings per seat, remapping, seats and the pointer.

```ts
type GameInput = {
    /** Gives a device to a seat, or frees it with null (`join: "host"`). */
    assign: (device: DeviceId, player: null | number) => void;
    /** A seat's bindings by action (default seat 0). */
    bindings: (player?: number) => ActionBindings;
    /** The next key, pad button or pointer press, for a "press a key" prompt; null on timeout or Escape. */
    capture: (opts?: {
        devices?: readonly ("key" | "pad" | "pointer")[];
        timeoutMs?: number;
    }) => Promise<Binding | null>;
    /** Every action edge and analog change as devices produce them, simulation idle or not; returns the unsubscribe. */
    onAction: (listener: (e: UiActionEvent) => void, opts?: {
        actions?: readonly string[];
    }) => () => void;
    players: () => readonly PlayerInfo[];
    /** Replaces an action's bindings for a seat, saved through `GameConfig.input.remaps` and applied from the next tick. */
    rebind: (action: string, bindings: readonly Binding[], opts?: {
        player?: number;
    }) => {
        issue: SceneIssue;
        ok: false;
    } | {
        ok: true;
    };
    /** Drops a seat's remap of `action`, or of every action. */
    reset: (action?: string, opts?: {
        player?: number;
    }) => void;
    /** While on, pointer moves anywhere in the document update the pointer sample, so a DOM drag shows in the world. */
    trackPointer: (on: boolean) => void;
};
```

Refers to [`ActionBindings`](#actionbindings), [`UiActionEvent`](#uiactionevent).

## `GameInstance`

_type_ in `types.ts`

```ts
type GameInstance = {
    /** Offers Escape to the game in play (a tool's selection); true when it used it, so play goes on. */
    cancel: () => boolean;
    /**
     * Page coordinates (a DOM event's `clientX`, `clientY`) to world metres,
     * through the input target's rect and a viewport's camera: `viewport`'s,
     * else the one under the point (the first where none is).
     */
    clientToWorld: (clientX: number, clientY: number, viewport?: number) => Vec2;
    /** Runs a game command (its `editorKeys`, or a host button); false when the game didn't apply it. */
    command: (name: string) => boolean;
    destroy: () => void;
    /** Wall time away, e.g. a restored save's last-seen gap; becomes `@elapsed` when the game has `time.catchUp`. */
    elapse: (ms: number) => void;
    /**
     * Reads back the canvas pixel (RGBA bytes) under each point (world metres), through
     * the camera, from the stage at resolution 1 over the game's background
     * colour; a point off the canvas reads null. `renderer` is the renderer
     * that drew them, `webgl` or `webgpu`.
     */
    extractPixels: (world: readonly Vec2[]) => {
        pixels: (null | readonly [
            number,
            number,
            number,
            number
        ])[];
        renderer: string;
    };
    /** The scene list, the current scene and changes between scenes. */
    flow: GameFlow;
    /** Centres `rect` (world metres) and zooms so it fits with `marginPx` screen px around it (default 48). */
    frame: (rect: Aabb, marginPx?: number) => void;
    getMode: () => GameMode;
    getStore: () => Store<GameStoreState>;
    /** Bindings, remapping, seats and pointer tracking. */
    input: GameInput;
    /** New versions of listed scenes, staged and swapped into the running game. */
    live: GameLive;
    /**
     * Builds a fresh world for `scene`, expanding a document through `registry`
     * first; on failure the current scene keeps running.
     */
    loadScene: (scene: ExpandedScene | SceneDefinition) => LoadReport;
    off: <K extends keyof GameEventMap>(event: K, handler: (payload: GameEventMap[K]) => void) => void;
    on: <K extends keyof GameEventMap>(event: K, handler: (payload: GameEventMap[K]) => void) => void;
    /**
     * The editor camera, for edit mode (play's camera follows the game). Each
     * call moves the view now, within the camera's bounds and zoom limits, and
     * updates the store's `camera` so DOM overlays follow.
     *
     * `panBy` moves the view with a screen-px drag: what was under the pointer stays under it.
     */
    panBy: (screenDelta: Vec2) => void;
    /** Rendering, overlays and the camera keep running; no ticks until `resume` or `step`. */
    pause: () => void;
    /**
     * Validates `doc` (errors block and are returned) and builds a fresh play
     * world from a clone of it, frozen in dev: input is flushed, the camera
     * snaps to the game's target and the mode becomes `play`. From edit it
     * remembers the edit world and the editor camera for `stop`; while
     * playing it restarts on `doc` and keeps what it remembered. A failed
     * Play leaves the current world running. `as.sceneId` is the scene's
     * asset id when `doc.name` isn't it: saves, live versions and the
     * recording key on it.
     */
    play: (doc: SceneDefinition, opts?: PlayOptions, as?: {
        sceneId?: AssetId;
    }) => PlayReport;
    /** The last pointer position over the input target in world metres, for "play from here"; null before any. */
    pointerWorld: () => Vec2 | null;
    /**
     * Loads the scene's bundle, joined by the project bundle until all of the
     * project's textures are in (a project texture that failed is fetched again
     * by the next `preload` or `loadScene`), and `GameConfig.rapier` when the
     * scene's physics is Rapier; resolves when both are in. Loading a Rapier
     * scene before its module is in reports `physics-not-loaded`.
     */
    preload: (scene: ExpandedScene | SceneDefinition, onProgress?: (p: LoadProgress) => void) => Promise<{
        failed: BundleEntry[];
    }>;
    /** The project's runtime view: the one `createGame` was given, or the last `reloadAssets` passed; null without one. */
    project: () => ProjectRuntimeView | null;
    /** `GameConfig.reducedMotion` as resolved at `createGame`: what the effects, the camera and the UI read. */
    readonly reducedMotion: boolean;
    /**
     * The session's recording once finished (the game's first verdict, or
     * Stop), else the last session's; null before any Play. A session started
     * through `setMode` isn't recorded. With `running`, a session still
     * recording comes back as Stop would end it now, and keeps recording.
     */
    recording: (opts?: {
        running?: boolean;
    }) => RunRecording | null;
    /** The registry built from `config.game`; hosts parse and expand scenes with it. */
    registry: Registry;
    /**
     * Re-imported art: loads the `changed` assets' new bytes, then redraws the
     * loaded scene's visuals that use them, without reloading the scene. A new
     * `project` also re-resolves the project bundle from its game settings, so
     * a settings asset field moved to another id is loaded and kept resident.
     * A new `project` whose input map differs rebuilds the bindings and the
     * touch overlay from it, after letting go of everything the old map held;
     * the player's remaps stay, and seats and the pad deadzone keep what the
     * instance started with.
     * `failed` lists textures that did not load; `errors` the entities whose
     * redraw threw (every other entity still redraws). Never rejects for those.
     */
    reloadAssets: (update: {
        changed: readonly AssetId[];
        project: ProjectRuntimeView | null;
        view: ProjectView;
    }) => Promise<{
        errors: AssetReloadError[];
        failed: BundleEntry[];
    }>;
    /**
     * Plays `recording` on `doc`: Play from the recording's start, with its
     * input edges stepped on their ticks in place of the keyboard's. At its
     * last tick the loop pauses on the end state; Stop returns to edit.
     *
     * A recording that started on a live version (`sceneVersion`) plays that
     * version's scene in place of `doc`, and each recorded swap is applied
     * before its tick with its recorded strategy, through the same path as a
     * live swap. A version `versions` can't give is `scene-version-removed`:
     * for the start, the replay doesn't start (the report carries the issue);
     * for a swap, `live:failed` carries it with `detail.tick` and the replay
     * stops on that tick. The scene's own live version comes back at Stop.
     */
    replay: (doc: SceneDefinition, recording: RunRecording, opts?: {
        /** The scene's asset id when `doc.name` isn't it, as for `play`. */
        sceneId?: AssetId;
        /** The scene versions the recording names, by id; null for one the host doesn't have. */
        versions?: (id: Sha256) => StagedVersion | null;
    }) => PlayReport;
    resize: (width: number, height: number) => void;
    resume: () => void;
    /**
     * Routes the input target's pointer events and the key target's key events;
     * editor tools register at `TOOL_PRIORITY.editor`.
     */
    router: ToolRouter;
    /**
     * The loaded scene's runtime, for entity-level edits (`add`, `update`,
     * `remove`) that shouldn't rebuild the world; null with nothing loaded.
     * A `loadScene` replaces it.
     */
    runtime: () => SceneRuntime | null;
    /** Save slots over the game's, the host's or the browser's store. */
    saves: SaveSlots;
    /** Router screen px (from the input target's corner) to world metres, through the camera. */
    screenToWorld: (screen: Vec2) => Vec2;
    /**
     * Queues a command for the next simulated tick as the sending seat's
     * (`player`, default 0), recorded on that seat's stream, waking a turns or
     * event game; false (and a dev warning) when not playing, while a replay
     * plays its recorded commands, for a seat past `players.max`
     * (player-unknown), for an unknown name, or when its args don't parse.
     */
    send: (command: GameCommand) => boolean;
    /**
     * Kept for hosts without a document: `play` plays the loaded scene as it
     * stands (no validation) and `edit` is `stop`.
     */
    setMode: (mode: GameMode) => void;
    /**
     * The prefabs that documents passed to `loadScene`, `play` and `replay`
     * expand their instances from, e.g. the collab doc's as they change.
     */
    setPrefabs: (prefabs: PrefabLibrary) => void;
    /** Scales simulated time per frame; throws on a negative or non-finite scale. */
    setTimeScale: (scale: number) => void;
    /**
     * Replaces the viewports (1–4; throws on any other count or a rect outside
     * the canvas). They draw in Play; the editor always shows one full view.
     */
    setViewports: (defs: readonly ViewportDef[]) => void;
    start: () => void;
    /** Simulates `n` ticks now (default 1), delivering keys pressed while paused. Play mode only. */
    step: (n?: number) => void;
    /**
     * Discards the play world, rebuilds the edit world from the scene loaded
     * before Play (the play world's own scene when there was none), restores
     * the editor camera exactly and resumes the loop at 1x. No-op in edit.
     */
    stop: () => void;
    unloadScene: () => void;
    /** The index of the viewport under page coordinates (the topmost), or null off every viewport. */
    viewportAt: (clientX: number, clientY: number) => null | number;
    /** Page coordinates of a world point through `viewport`'s camera (default the first) and the canvas's rect; clientToWorld's inverse. */
    worldToClient: (p: Vec2, viewport?: number) => {
        x: number;
        y: number;
    };
    /** Zooms by `factor` about a screen point, keeping the world point under it fixed. */
    zoomAt: (screen: Vec2, factor: number) => void;
};
```

Refers to [`AssetReloadError`](#assetreloaderror), [`ExpandedScene`](#expandedscene), [`GameCommand`](#gamecommand), [`GameEventMap`](#gameeventmap), [`GameFlow`](#gameflow), [`GameInput`](#gameinput), [`GameLive`](#gamelive), [`GameMode`](#gamemode), [`GameStoreState`](#gamestorestate), [`LoadProgress`](#loadprogress), [`LoadReport`](#loadreport), [`PlayOptions`](#playoptions), [`PlayReport`](#playreport), [`Registry`](#registry), [`RunRecording`](#runrecording), [`SaveSlots`](#saveslots), [`StagedVersion`](#stagedversion), [`ToolRouter`](#toolrouter), [`Vec2`](#vec2), [`ViewportDef`](#viewportdef).

## `GameLive`

_type_ in `types.ts`

`GameInstance.live`.

```ts
type GameLive = {
    /**
     * Uses a staged version (null: the release's own) for a scene, with a timing
     * clamped to what the game accepts. The issue is live-timing-unsupported (a
     * warning) when the timing was clamped, or live-swap-failed when the version
     * isn't staged.
     */
    activate(scene: AssetId, version: Sha256 | null, timing: SwapTiming): {
        clamped: boolean;
        issue?: SceneIssue;
        timing: SwapTiming;
    };
    /** The version this scene's loads use; null for the release's own. */
    current(scene: AssetId): Sha256 | null;
    /** Activations waiting for their timing, in scene-id order. */
    pending(): readonly {
        scene: AssetId;
        timing: SwapTiming;
        version: Sha256 | null;
    }[];
    /** For online sessions: ignore activations until unpinned. */
    pin(versions: Readonly<Record<AssetId, Sha256>>): void;
    /**
     * Fetches nothing: makes a version resident (validated, expanded, bundle
     * preloaded) for a listed scene. Its preload gets `LIVE_DEFAULTS.preloadTimeoutMs`,
     * or less when `signal` aborts first; a refusal leaves the scene's versions as they were.
     */
    stage(v: StagedVersion, opts?: {
        signal?: AbortSignal;
    }): Promise<{
        issue: SceneIssue;
        ok: false;
    } | {
        ok: true;
    }>;
    unpin(): void;
};
```

Refers to [`StagedVersion`](#stagedversion), [`SwapTiming`](#swaptiming).

## `GameMode`

_type_ in `types.ts`

`edit` pauses the simulation; `play` runs it.

```ts
type GameMode = "edit" | "play";
```

## `GamePhase`

_type_ in `types.ts`

```ts
type GamePhase = "destroyed" | "idle" | "loading" | "paused" | "running";
```

## `GameStoreState`

_type_ in `types.ts`

```ts
type GameStoreState = {
    camera: CameraState;
    /** `off`, or the id of the last debug layer shown; every layer before it shows too. */
    debugMode: string;
    fps: number;
    /** The game's `storeSlice()`, refreshed each tick; null without a scene or a slice. */
    game: unknown;
    mode: GameMode;
    phase: GamePhase;
    /** Set at Play, cleared at Stop. */
    session: PlaySession | null;
    sim: SimState;
    tick: number;
};
```

Refers to [`CameraState`](#camerastate), [`GameMode`](#gamemode), [`GamePhase`](#gamephase), [`PlaySession`](#playsession), [`SimState`](#simstate).

## `IDENTITY_2D`

_const_ in `scene/transform.ts`

```ts
declare const IDENTITY_2D: Transform2D;
```

Refers to [`Transform2D`](#transform2d).

## `InputAction`

_type_ in `types.ts`

```ts
type InputAction = {
    action: string;
    /** Where in the tick it happened, 0…1 in thousandths; only with `GameDefinition.input.subTick`. */
    offset?: number;
    /** The seat; 0 when absent. */
    player?: number;
    /** Buttons: down. Axes and vectors: the value isn't zero. */
    pressed: boolean;
    tick: number;
    timestamp: number;
    /** An axis's value in −1…1, quantised to 1/1000. */
    value?: number;
    /** A vector's components, in the unit disc, quantised to 1/1000. */
    x?: number;
    y?: number;
};
```

## `InputBinding`

_type_ in `types.ts`

```ts
type InputBinding = {
    action: string;
    bindings?: readonly Binding[];
    /**
     * @deprecated 0.x layout keys, read as `{ device: "key", code }` for each
     * code `KEY_TO_CODE` gives the key; use `bindings`.
     */
    keys?: readonly string[];
};
```

## `LIVE_CHECK_AGAIN_TICKS`

_const_ in `game/live.ts`

How many ticks after a swap the game's `live.check` runs a second time.

```ts
declare const LIVE_CHECK_AGAIN_TICKS = 60;
```

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

Refers to [`SwapTiming`](#swaptiming).

## `LiveSceneVersions`

_type_ in `flow-host.ts`

The live versions a scene source reads first: the active version's scene for a listed id, or null for the release's own.

```ts
type LiveSceneVersions = {
    sceneFor(id: AssetId): LibraryScene | null;
};
```

## `LoadFailureReason`

_type_ in `runtime/types.ts`

Why a load failed, when it wasn't a plain error. `spawn-blocked`: a play
start `at` lies inside a solid. `physics-required`: an entity needs physics
the scene runs without. `physics-not-loaded`: the scene needs Rapier and
the host gave none.

```ts
type LoadFailureReason = "physics-not-loaded" | "physics-required" | "spawn-blocked";
```

## `LoadProgress`

_type_ in `render/asset-loader.ts`

`loaded` and `bytes` count the bundle's distinct blobs settled so far, failures included.

```ts
type LoadProgress = {
    bytes: number;
    loaded: number;
    total: number;
    totalBytes: number;
};
```

## `LoadReport`

_type_ in `runtime/types.ts`

```ts
type LoadReport = {
    counts: Record<EntityTypeName, number>;
    ms: number;
    ok: true;
} | {
    entityId?: string;
    error: string;
    ok: false;
    reason?: LoadFailureReason;
};
```

Refers to [`LoadFailureReason`](#loadfailurereason).

## `LoadingView`

_type_ in `types.ts`

What the flow host shows while a slow load runs.

```ts
type LoadingView = {
    hide(): void;
    show(p: LoadProgress): void;
};
```

Refers to [`LoadProgress`](#loadprogress).

## `LoadingViewFactory`

_type_ in `types.ts`

Builds the loading view inside the host's layer.

```ts
type LoadingViewFactory = (layer: HTMLElement) => LoadingView;
```

Refers to [`LoadingView`](#loadingview).

## `MAX_PLAYERS`

_const_ in `input/players.ts`

The most seats a game or an input map may declare.

```ts
declare const MAX_PLAYERS = 8;
```

## `MountUi`

_type_ in `ui/types.ts`

A game's DOM UI, named by the project file's `ui` key.

```ts
type MountUi<G = unknown> = (ctx: UiContext<G>) => UiHandle;
```

Refers to [`UiContext`](#uicontext), [`UiHandle`](#uihandle).

## `ParticleLayer`

_interface_ in `render/particles.ts`

```ts
interface ParticleLayer {
    /**
     * Starts (or restarts) the emitter `id` on `layer` (default the layer's
     * own container), following `at` each frame; while `at` gives undefined
     * it emits nothing. A restart keeps the particles it has alive.
     */
    emitter(id: string, preset: EmitterFile, at: () => Pose | undefined, layer?: ViewLayer): void;
    /** Stops the emitter `id`: what it put in world space lives out its life, what it put in local space goes. */
    remove(id: string): void;
    /**
     * One burst at a world point (metres): `count` particles (default the
     * preset's bursts' total, else one second of its rate), its angle range
     * turned by `angle` degrees, drawn in `tint` instead of its tint curve.
     */
    burst(preset: EmitterFile, at: Vec2, opts?: {
        angle?: number;
        count?: number;
        tint?: number;
    }): void;
    /** Wall ms scaled by the loop's time scale; 0 while paused. */
    update(dtMs: number): void;
    stats(): {
        emitters: number;
        particles: number;
    };
    /** Drops every emitter and particle, and the textures it holds. */
    clear(): void;
}
```

Refers to [`Vec2`](#vec2).

## `ParticleLayerOptions`

_type_ in `render/particles.ts`

```ts
type ParticleLayerOptions = {
    /** The container an emitter's `layer` draws in; without it, everything draws in `container`. */
    layer?: (layer: ViewLayer) => Container;
    /** The game's px per metre; default 100. `container` and the layer containers draw in world px. */
    pxPerMetre?: number;
    /** Rates and burst counts are quartered. */
    reducedMotion: boolean;
    /** Seeds the layer's own random stream: the scene's name. */
    seed: string;
    /** The preset's texture; null (or omitted) draws small squares. */
    texture?: (preset: EmitterFile) => ParticleTexture | null;
};
```

Refers to [`ParticleTexture`](#particletexture).

## `ParticleTexture`

_type_ in `render/particles.ts`

A preset's texture as the layer draws it: a content hash, an atlas frame in it and the sampling.

```ts
type ParticleTexture = {
    frame?: NonNullable<SpriteVisual["frame"]>;
    hash: Sha256;
    sampling: SpriteVisual["sampling"];
};
```

Refers to [`SpriteVisual`](#spritevisual).

## `PixiView`

_type_ in `render/pixi-view.ts`

```ts
type PixiView = SceneView & {
    /** Destroys every visual and layer, and `container` with them. */
    destroy(): void;
    /**
     * Offsets the `scroll` layers for a camera at (x, y) metres, as `frame`
     * does: what a viewport past the first sets before it draws the world.
     */
    parallax(camera: {
        x: number;
        y: number;
    }): void;
    readonly container: Container;
    /** Shows only the named scene layers (draw orders no layer names hide too); null shows every layer. */
    showLayers(names: null | readonly string[]): void;
};
```

## `PixiViewOptions`

_type_ in `render/pixi-view.ts`

```ts
type PixiViewOptions = {
    /** True in edit mode: editor-only layers show. */
    editing?: () => boolean;
    /**
     * Scene layers, matched to draws by their `draw` order (the first layer
     * with an order wins): a `sort: "y"` layer orders its visuals by (z, y,
     * first draw) each frame, a `scroll` layer is offset by the camera times
     * (1 − scroll), and an editor-only layer hides the visuals placed on it
     * by entity (those given a `depth`) unless `editing()`. Draws at an order
     * no layer has work as plain draw layers.
     */
    layers?: readonly SceneLayerDef[];
    /**
     * Gives the view a particle layer, made at the first `particles()`: an
     * emitter draws on its own layer, a burst on the scene's `gameplay`
     * layer (the body order without one).
     */
    particles?: Pick<ParticleLayerOptions, "reducedMotion" | "seed" | "texture">;
    /** Round visual positions to whole canvas pixels each frame. */
    pixelSnap?: boolean;
    /**
     * The game's px per metre (`world.lengthUnit`), default 100. Shapes,
     * poses and sprite sizes arrive in metres and are drawn in world px inside
     * `container`, which the view scales by 1 / pxPerMetre, so under a camera
     * mapping metres to canvas px a stroke, a tile and a nine-slice border
     * keep their px and arcs their smoothness.
     */
    pxPerMetre?: number;
    /** Textures by content hash; a miss draws the fallback and retries when the loader says it arrived. */
    textures?: TextureSource;
};
```

Refers to [`ParticleLayerOptions`](#particlelayeroptions), [`TextureSource`](#texturesource).

## `PlayOptions`

_type_ in `headless/playtest-types.ts`

How a play world starts: the same object for the editor's Play, `runPlaytest` and `fuzz`.

```ts
type PlayOptions<G = unknown> = {
    /** Start here instead of the game's spawn, cast onto the first surface below; refused inside a solid. */
    at?: Vec2;
    /** The game's own options (the platformer's abilities), parsed by its `play.options`. */
    game?: G;
    /** Seeds `EngineContext.random`; omitted, `defaultSeed(gameId, sceneName)`. */
    seed?: number | string;
    /** Advances time-driven systems (followers) by this much before tick 0. */
    timeOffsetMs?: number;
};
```

Refers to [`Vec2`](#vec2).

## `PlayOutcome`

_type_ in `types.ts`

A game's verdict, at the play world's tick (from 0 at Play) that produced
it; or `flow`, when a scene change the game requested ended the editor's
Play, with the scene it asked for as `to`.

```ts
type PlayOutcome = GameOutcome & {
    tick: number;
    to?: AssetId;
};
```

## `PlayReport`

_type_ in `types.ts`

What `GameInstance.play` did: validation errors (and a refused start) block it and are returned.

```ts
type PlayReport = {
    /** Why the play world didn't load; absent when validation blocked it. */
    error?: string;
    issues: SceneIssue[];
    ok: false;
    /** The load's own reason (`LoadReport`): `spawn-blocked` when `at` lies inside a solid. */
    reason?: LoadFailureReason;
} | {
    issues: SceneIssue[];
    ok: true;
};
```

Refers to [`LoadFailureReason`](#loadfailurereason).

## `PlaySession`

_type_ in `types.ts`

One Play to Stop. The shell records the game's first verdict and keeps playing; stopping is the host's call.

```ts
type PlaySession = {
    outcome: PlayOutcome | null;
    /** The store's `tick` when Play started. */
    startTick: number;
};
```

Refers to [`PlayOutcome`](#playoutcome).

## `PointerKind`

_type_ in `tool-router.ts`

```ts
type PointerKind = "mouse" | "pen" | "touch";
```

## `RapierModule`

_type_ in `types.ts`

```ts
type RapierModule = typeof _$_dimforge_rapier2d0;
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

Refers to [`GameDefinition`](#gamedefinition).

## `RemapState`

_type_ in `input/remap.ts`

A player's remapped bindings, per seat and action.

```ts
type RemapState = {
    players: Readonly<Record<number, Readonly<Record<string, readonly Binding[]>>>>;
    v: 1;
};
```

## `RemapStore`

_interface_ in `input/remap.ts`

Where a player's remaps persist between sessions; never sent anywhere.

```ts
interface RemapStore {
    load(gameId: string): RemapState | null;
    save(gameId: string, state: RemapState): void;
}
```

Refers to [`RemapState`](#remapstate).

## `RenderBackend`

_type_ in `types.ts`

A GPU backend the shell draws with.

```ts
type RenderBackend = "webgl" | "webgpu";
```

## `RendererConfig`

_type_ in `types.ts`

```ts
type RendererConfig = {
    /** Shown while restoring; default a centred "Restoring graphics…" line. */
    lostOverlay?: (layer: HTMLElement) => {
        destroy(): void;
    };
    /** Default "webgpu"; the shell falls back to "webgl" on failure or loss. */
    preference?: "webgl" | "webgpu";
};
```

## `ResolutionPolicy`

_type_ in `resolution.ts`

How the world maps onto the canvas: what the camera shows, how it fits,
and how it samples. Its sizes are virtual px; the camera reaches them from
world metres through the game's px per metre (`world.lengthUnit`).

```ts
type ResolutionPolicy = {
    /** The renderer's antialiasing; changing it rebuilds the renderer. */
    antialias?: boolean;
    /** Bar colour, 0xRRGGBB; default the background. */
    bars?: number;
    /**
     * expand: the fixed axis fills the canvas and the other shows more;
     * letterbox: the whole virtual area shows, bars fill the rest (needs width and height);
     * crop: the virtual area covers the canvas, the overflow is cut (needs width and height).
     */
    fit: "crop" | "expand" | "letterbox";
    /** Scale only by whole multiples (pixel art); bars take the remainder. */
    integer?: boolean;
    /** Round camera and visual positions to whole canvas pixels. */
    pixelSnap?: boolean;
    /** Default texture sampling; a texture's import `filter` wins. */
    sampling?: "linear" | "nearest";
    /** Virtual px the camera shows at zoom 1 on the fixed axis or axes. */
    virtual: {
        height: number;
        width: number;
    } | {
        height: number;
    } | {
        width: number;
    };
};
```

## `ResolutionViewport`

_type_ in `resolution.ts`

```ts
type ResolutionViewport = {
    /** Whether bars fill part of the canvas. */
    bars: boolean;
    /** Canvas px from the canvas's corner to the shown area's; the bars' size on each side. */
    offset: {
        x: number;
        y: number;
    };
    /** Canvas px per virtual px at zoom 1. */
    scale: number;
    /** The area the camera shows at zoom 1, virtual px. */
    view: {
        height: number;
        width: number;
    };
};
```

## `ResolvedBindings`

_type_ in `input/bindings.ts`

```ts
type ResolvedBindings = {
    /** Every action any layer names: the game's in declared order, then the others by first appearance. */
    actions: readonly string[];
    /** A seat's winning bindings by action (default seat 0). */
    bindings: (player?: number) => ActionBindings;
    /** A declared action's kind; "button" for one only a host or remap names. */
    kindOf: (action: string) => ActionKind;
    players: number;
    /** The layer whose bindings a seat uses for an action; null for an action no layer names. */
    source: (action: string, player?: number) => BindingLayerName | null;
    tables: DeviceTables;
};
```

Refers to [`ActionBindings`](#actionbindings), [`BindingLayerName`](#bindinglayername), [`DeviceTables`](#devicetables).

## `RunRecording`

_type_ in `scene/recording-schema.ts`

A recording in the current format.

```ts
type RunRecording = RunRecordingV2;
```

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

## `SPRITE_FALLBACK_SIZE`

_const_ in `game/behaviors/sprite.ts`

A sprite's size in metres when neither its block nor its asset gives one.

```ts
declare const SPRITE_FALLBACK_SIZE: readonly [
    w: number,
    h: number
];
```

## `SaveDepth`

_type_ in `game/save-file.ts`

`progress`: the scene, persist and the game's snapshot. `world`: everything a run needs to continue exactly.

```ts
type SaveDepth = "progress" | "world";
```

## `SaveLimits`

_type_ in `game/save-file.ts`

```ts
type SaveLimits = {
    maxBytes: number;
    maxSlots: number;
};
```

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

## `SaveSlots`

_interface_ in `saves/slots.ts`

A game instance's save slots, over the store precedence picked.

```ts
interface SaveSlots {
    readonly store: Pick<SaveStore, "describe" | "kind">;
    /**
     * min(the game's limits or the defaults, `MAX_BROWSER_SAVE_LIMITS` for a
     * browser store, the store's own), read afresh each time: a host's limits
     * can change after sign-in.
     */
    readonly limits: SaveLimits;
    list(): Promise<readonly SaveSummary[]>;
    save(slot: string, opts?: {
        depth?: SaveDepth;
        title?: string;
    }): Promise<SaveWriteResult>;
    load(slot: string): Promise<{
        issue: SceneIssue;
        ok: false;
    } | {
        meta: SaveMeta;
        migratedFrom?: number;
        ok: true;
    }>;
    remove(slot: string): Promise<void>;
}
```

Refers to [`SaveDepth`](#savedepth), [`SaveLimits`](#savelimits), [`SaveMeta`](#savemeta), [`SaveStore`](#savestore), [`SaveSummary`](#savesummary), [`SaveWriteResult`](#savewriteresult).

## `SaveStore`

_interface_ in `saves/store.ts`

Where a game's saves live: the game's own backend, the host's, the browser's, or memory.

```ts
interface SaveStore {
    readonly kind: "browser" | "game" | "host" | "memory";
    /** Plain words a game page and a save menu show: where saves live and how long they last. */
    readonly describe: string;
    /** A store may be stricter than the game's limits. */
    readonly limits?: Partial<SaveLimits>;
    list(gameId: string): Promise<readonly SaveSummary[]>;
    read(gameId: string, slot: string): Promise<null | string>;
    write(gameId: string, slot: string, text: string): Promise<SaveWriteResult>;
    remove(gameId: string, slot: string): Promise<void>;
}
```

Refers to [`SaveLimits`](#savelimits), [`SaveSummary`](#savesummary), [`SaveWriteResult`](#savewriteresult).

## `SaveSummary`

_type_ in `saves/store.ts`

```ts
type SaveSummary = {
    bytes: number;
    meta: SaveMeta;
    slot: string;
};
```

Refers to [`SaveMeta`](#savemeta).

## `SaveWriteResult`

_type_ in `saves/store.ts`

A write's result: `save-too-large`, `save-slot-limit` or `save-store-failed`
when it didn't land, or `save-forbidden` when a host refused it (signed out,
or the game doesn't save to that host).

```ts
type SaveWriteResult = {
    bytes: number;
    ok: true;
} | {
    issue: SceneIssue;
    ok: false;
};
```

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

Refers to [`SceneListEntry`](#scenelistentry).

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

## `SceneSource`

_type_ in `types.ts`

The scenes a host can play: the scene list, its start, and each listed scene's data.

```ts
type SceneSource = {
    list(): readonly SceneListEntry[];
    /** Synchronous: every listed scene's text is resident, since sublevels attach inside a step. */
    scene(id: AssetId): LibraryScene | null;
    start(): AssetId | null;
};
```

Refers to [`SceneListEntry`](#scenelistentry).

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

## `SimState`

_type_ in `types.ts`

The loop's simulation controls: a paused loop runs no ticks, and `timeScale` scales simulated time per frame.

```ts
type SimState = {
    paused: boolean;
    timeScale: number;
};
```

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

## `SpriteVisual`

_type_ in `context.ts`

A texture or a frame of one, as a view draws it at a visual's pose.

```ts
type SpriteVisual = {
    alpha?: number;
    /** In the frame's own 0–1 space. */
    anchor: [
        x: number,
        y: number
    ];
    blend?: BlendMode;
    /** What `draw` shows when the view can't draw sprites or the texture isn't loaded yet. */
    fallback: {
        shape: ShapeObj;
        style: Style;
    };
    flipX?: boolean;
    flipY?: boolean;
    /** The frame in texture px; omitted, the whole texture. */
    frame?: {
        h: number;
        w: number;
        x: number;
        y: number;
    };
    /** Border insets in texture px, drawn one texture px to one world px: nine-slice scaling. */
    nineSlice?: [
        left: number,
        top: number,
        right: number,
        bottom: number
    ];
    sampling: "linear" | "nearest";
    /** Drawn size, metres; the view draws it at the game's px per metre. */
    size: [
        w: number,
        h: number
    ];
    /** The texture's content hash; null draws only the fallback box. */
    texture: Sha256 | null;
    /** Repeat the frame across `size` instead of stretching it. */
    tile?: boolean;
    tint?: number;
};
```

Refers to [`BlendMode`](#blendmode).

## `StagedVersion`

_type_ in `types.ts`

A scene version the host fetched, ready to stage.

```ts
type StagedVersion = {
    id: Sha256;
    /** Canonical texts by hash (the scene and its prefabs), already hash-checked. */
    texts: ReadonlyMap<Sha256, string>;
    version: SceneVersion;
};
```

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

Refers to [`Vec2`](#vec2).

## `StepResult`

_type_ in `runtime/types.ts`

```ts
type StepResult = {
    /** Engine events first (sensors), then the game's, each in the order raised. */
    events: StepEvent[];
    /** The game's `snapshot()` after the step; `null` without a game. */
    game: unknown;
    /**
     * What this tick asked the shell to present, in request order; set only
     * for a runtime made with `recordPresentation`. Requests made outside a
     * step (a game's `onLoad`) are in the next tick's list.
     */
    present?: readonly PresentRequest[];
    /** The tick just simulated, counting from 0 after each load. */
    tick: number;
};
```

Refers to [`StepEvent`](#stepevent).

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

## `TextureSource`

_type_ in `render/pixi-view.ts`

Textures by content hash, for the view's sprites.

```ts
type TextureSource = {
    get(hash: Sha256): Texture | null;
    /** Fires with each hash as it loads; returns unsubscribe. */
    onLoad(cb: (hash: Sha256) => void): () => void;
};
```

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

Refers to [`PointerKind`](#pointerkind), [`Vec2`](#vec2).

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

## `TouchControlDef`

_type_ in `input/touch-controls.ts`

An on-screen control. `at` and `radius` are fractions of the canvas's
shorter side, from its top-left corner.

```ts
type TouchControlDef = {
    action: string;
    at: [
        x: number,
        y: number
    ];
    id: string;
    kind: "button";
    label?: string;
    radius: number;
} | {
    action: string;
    at: [
        x: number,
        y: number
    ];
    id: string;
    kind: "dpad";
    radius: number;
} | {
    action: string;
    at: [
        x: number,
        y: number
    ];
    id: string;
    kind: "stick";
    radius: number;
};
```

## `TouchControlValue`

_type_ in `input/touch-controls.ts`

What a control reports: a button's state, or a stick's or d-pad's position in the unit disc.

```ts
type TouchControlValue = {
    down: boolean;
} | {
    x: number;
    y: number;
};
```

## `TouchControls`

_type_ in `input/touch-controls.ts`

```ts
type TouchControls = {
    /** Releases every held control and removes the overlay and its listeners. */
    destroy(): void;
    /**
     * The id of the shown control under a page point (`clientX`, `clientY`),
     * else null. A touch that starts there belongs to the control, not the pointer.
     */
    hitTest(clientX: number, clientY: number): null | string;
    /** Shows or hides the overlay; hiding releases every held control. */
    show(on: boolean): void;
};
```

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

## `TransitionRunner`

_type_ in `types.ts`

Runs one half of a transition over `layer`, which sits above the game's UI; under `env.reducedMotion` a fade is a cut.

```ts
type TransitionRunner = (phase: "in" | "out", spec: TransitionSpec, layer: HTMLElement, env: {
    reducedMotion: boolean;
}) => Promise<void>;
```

Refers to [`TransitionSpec`](#transitionspec).

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

## `UiActionEvent`

_type_ in `types.ts`

One action change delivered to `GameInput.onAction` listeners, UI-only or not.

```ts
type UiActionEvent = {
    action: string;
    device: DeviceId;
    /** Buttons: the edge; with `repeat` true for the OS's key repeat. */
    down?: boolean;
    kind: ActionKind;
    player: number;
    repeat?: boolean;
    /** Axes and vectors: the quantised value. */
    value?: number;
    vector?: Vec2;
};
```

Refers to [`Vec2`](#vec2).

## `UiContext`

_type_ in `ui/types.ts`

What a game's DOM UI is given when a host mounts it over the canvas.

```ts
type UiContext<G = unknown> = {
    canvas: HTMLCanvasElement;
    game: GameInstance;
    /**
     * The browser's install prompt where the host can offer one (an exported
     * build with the PWA on); absent elsewhere. An Install button shows while
     * `current()` is a function.
     */
    install?: {
        /** Shows the browser's prompt, resolving true once it was accepted; null while the browser offers none. */
        current(): (() => Promise<boolean>) | null;
        /** Calls `fn` whenever `current()` turns from null to a function or back; returns the unsubscribe. */
        onChange(fn: () => void): () => void;
    };
    /**
     * Pages the host ships beside the game, as URLs a link can open; absent
     * where the host has none. An exported build sets `credits` to its
     * `credits.html`.
     */
    links?: {
        credits?: string;
    };
    /** `GameInstance.reducedMotion`: when true, HUDs skip their own animations. */
    reducedMotion: boolean;
    /**
     * A div over the canvas with the canvas's box; pointer-events none, so
     * children opt in with "auto". A host whose own chrome floats over the
     * canvas sets `--jams-ui-safe-top`, `-right`, `-bottom` and `-left` (px
     * from each edge of the layer that chrome covers) on an ancestor; HUD
     * panels offset by them, e.g. `top: calc(var(--jams-ui-safe-top, 0px) + 8px)`.
     */
    root: HTMLElement;
    /** game-settings' `game` block, defaults applied; {} without a project. */
    settings: Readonly<Record<string, unknown>>;
    /** The store's `game` field (GameRuntime.storeSlice), typed by the game; null before the first load. */
    slice(): G | null;
    /** Calls `fn` now and whenever `select`'s result changes by identity; returns the unsubscribe. */
    watch<T>(select: (s: GameStoreState) => T, fn: (value: T, prev: T | undefined) => void): () => void;
};
```

Refers to [`GameInstance`](#gameinstance), [`GameStoreState`](#gamestorestate).

## `UiHandle`

_type_ in `ui/types.ts`

What a mounted UI hands back: `destroy` removes everything it added.
`cancel` is offered Escape in play (`GameInstance.cancel`) after the
game's own attachment; it returns true when it used it (cleared a
selection), so play goes on instead of stopping.

```ts
type UiHandle = {
    cancel?(): boolean;
    destroy(): void;
};
```

## `Vec2`

_type_ in `types.ts`

```ts
type Vec2 = {
    x: number;
    y: number;
};
```

## `ViewportDef`

_type_ in `camera/viewports.ts`

One viewport over the canvas.

```ts
type ViewportDef = {
    /** A frame of `width` view px around it. */
    border?: {
        color: number;
        width: number;
    };
    /** What it frames: a seat's targets, an entity, the main targets, or the whole scene (a minimap). */
    frame: "main" | "scene" | {
        entity: string;
    } | {
        player: number;
    };
    /** Scene layers drawn; default all but editor-only. */
    layers?: readonly string[];
    /** Canvas fractions: [x, y, w, h], 0–1. */
    rect: [
        x: number,
        y: number,
        w: number,
        h: number
    ];
    rig?: CameraRigDef;
};
```

## `acceptedTimings`

_function_ in `game/live.ts`

The timings a game accepts, `next-load` first: the ones it lists, and `next-load`, which every game takes.

```ts
declare function acceptedTimings(live: Pick<LiveDeclaration, "timings"> | undefined): SwapTiming[];
```

Refers to [`LiveDeclaration`](#livedeclaration), [`SwapTiming`](#swaptiming).

## `acceptedTimingsWords`

_function_ in `game/live.ts`

The timings a game accepts as the words after "this game accepts ",
strongest first: `only next load`, or `boundary and next load`.

```ts
declare function acceptedTimingsWords(live: Pick<LiveDeclaration, "timings"> | undefined): string;
```

Refers to [`LiveDeclaration`](#livedeclaration).

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

## `bindText`

_function_ in `ui/bind.ts`

Keeps `el.textContent` equal to `format(select(state))`.

```ts
declare function bindText<T>(el: HTMLElement, ctx: UiContext, select: (s: GameStoreState) => T, format?: (v: T) => string): () => void;
```

Refers to [`GameStoreState`](#gamestorestate), [`UiContext`](#uicontext).

## `bindToWorld`

_function_ in `ui/bind.ts`

Keeps `el` at a world point (through worldToClient and the camera), e.g. a
label over an entity. `el` is placed at the layer's top-left corner and
moved with a transform whenever `watchView` calls, and whenever a store
change moves the point `at()` returns; it is hidden while `at()` is null.

```ts
declare function bindToWorld(el: HTMLElement, ctx: UiContext, at: () => Vec2 | null): () => void;
```

Refers to [`UiContext`](#uicontext), [`Vec2`](#vec2).

## `browserRemapStore`

_function_ in `input/remap.ts`

Remaps in `localStorage` under `${prefix}${gameId}`. Every access is in
try/catch: storage that is missing, blocked or full, or a stored value that
doesn't parse as a v1 state, loads as none and never throws.

```ts
declare function browserRemapStore(prefix?: string): RemapStore;
```

Refers to [`RemapStore`](#remapstore).

## `browserSaveStore`

_function_ in `saves/browser.ts`

IndexedDB, else `localStorage`, else memory ("Saves last until this tab
closes."), probed once on first use. A database that won't open falls back
to the next once, before its first call returns; `describe` follows what
the saves are actually in.

```ts
declare function browserSaveStore(): SaveStore;
```

Refers to [`SaveStore`](#savestore).

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

## `createAssetLoader`

_function_ in `render/asset-loader.ts`

Loads textures through Pixi's `Assets` with the texture parser forced,
since hash URLs carry no extension. Retaining and releasing are by bundle
object: retain the bundle you later release. `release` trims.

```ts
declare function createAssetLoader(opts: {
    /** Default 256 MiB of decoded texture bytes. */
    budgetBytes?: number;
    project: ProjectId;
    url: AssetUrl;
}): AssetLoader;
```

Refers to [`AssetLoader`](#assetloader), [`AssetUrl`](#asseturl).

## `createEffectLayer`

_function_ in `render/effects.ts`

An effect layer over `layer` (a div over the canvas), driving `loop`'s time scale.

```ts
declare function createEffectLayer(layer: HTMLElement, loop: Pick<GameLoop, "getTimeScale" | "setTimeScale">, opts: {
    reducedMotion: () => boolean;
}): EffectLayer;
```

Refers to [`EffectLayer`](#effectlayer).

## `createGame`

_function_ in `engine.ts`

`config.project` is what every scene's game reads as `EngineContext.project`;
null without one. `config.game` null plays an engine-only project's scenes
under `createRegistry(null)`.

```ts
declare function createGame(canvas: HTMLCanvasElement, config: Partial<GameConfig> & Pick<GameConfig, "game"> & ProjectOption): Promise<GameInstance>;
```

Refers to [`GameConfig`](#gameconfig), [`GameInstance`](#gameinstance).

## `createLoadingOverlay`

_function_ in `ui/flow-views.ts`

A centred label and progress bar over the transition layer, shown while
a slow scene load runs.

```ts
declare function createLoadingOverlay(opts?: {
    label?: string;
}): LoadingViewFactory;
```

Refers to [`LoadingViewFactory`](#loadingviewfactory).

## `createParticleLayer`

_function_ in `render/particles.ts`

A particle layer drawing into `container`; under reduced motion rates and bursts are quartered.

```ts
declare function createParticleLayer(container: Container, textures: TextureSource | undefined, opts: ParticleLayerOptions): ParticleLayer;
```

Refers to [`ParticleLayer`](#particlelayer), [`ParticleLayerOptions`](#particlelayeroptions), [`TextureSource`](#texturesource).

## `createPixiView`

_function_ in `render/pixi-view.ts`

A scene view drawing into `container`: one child per layer, one display
object per id inside it (`Graphics` for drawings, a sprite kind for
sprites). Poses interpolate between the last two committed ticks in
`frame`. `container` is scaled to `opts.pxPerMetre`'s world px; its
parent maps metres.

```ts
declare function createPixiView(container: Container, opts?: PixiViewOptions): PixiView;
```

Refers to [`PixiView`](#pixiview), [`PixiViewOptions`](#pixiviewoptions).

## `createTouchControls`

_function_ in `input/touch-controls.ts`

Draws `controls` as a DOM overlay filling `host` (the canvas's frame) and
reports each control's value to `sink` whenever it changes. Stick and
d-pad values are clamped to the unit disc and quantised; y grows downward.

```ts
declare function createTouchControls(host: HTMLElement, controls: readonly TouchControlDef[], sink: (control: string, value: TouchControlValue) => void): TouchControls;
```

Refers to [`TouchControlDef`](#touchcontroldef), [`TouchControlValue`](#touchcontrolvalue), [`TouchControls`](#touchcontrols).

## `createUiLayer`

_function_ in `ui/layer.ts`

The overlay a MountUi draws into: absolutely positioned over `canvas`,
resized with it. It isolates its children's z-indexes, so the transition
layer covers all of them.

```ts
declare function createUiLayer(canvas: HTMLCanvasElement): {
    destroy(): void;
    root: HTMLElement;
};
```

## `diffWords`

_function_ in `game/live.ts`

What a swap's diff changed, in plain words: `3 entities changed, 1 added,
1 removed`, `the scene's header changed`, or `nothing changed`.

```ts
declare function diffWords(diff: SceneDiff): string;
```

Refers to [`SceneDiff`](#scenediff).

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

## `drawSprite`

_function_ in `context.ts`

Draws a sprite through any view: `sprite` when it has one, else the fallback box.

```ts
declare function drawSprite(view: SceneView, id: string, visual: SpriteVisual, layer: ViewLayer): void;
```

Refers to [`SpriteVisual`](#spritevisual).

## `fadeTransition`

_function_ in `ui/flow-views.ts`

Fades the transition layer to a colour (`spec.color`, else `opts.color`,
else black) and back: `out` over the first half of `spec.ms`, `in` over
the second. Under reduced motion each half is a cut.

```ts
declare function fadeTransition(opts?: {
    color?: number;
}): TransitionRunner;
```

Refers to [`TransitionRunner`](#transitionrunner).

## `flipWorld`

_function_ in `scene/transform.ts`

The world-axis flip `"x"` or `"y"` composed onto `d` (what the transform op does).

```ts
declare function flipWorld(d: Dihedral, axis: "x" | "y"): Dihedral;
```

Refers to [`Dihedral`](#dihedral).

## `indexedDbSaveStore`

_function_ in `saves/store.ts`

One IndexedDB database of saves, keyed by game and slot. It holds at most `MAX_BROWSER_SAVE_LIMITS`.

```ts
declare function indexedDbSaveStore(opts?: {
    db?: string;
}): SaveStore;
```

Refers to [`SaveStore`](#savestore).

## `invert`

_function_ in `scene/transform.ts`

```ts
declare function invert(t: Transform2D): Transform2D;
```

Refers to [`Transform2D`](#transform2d).

## `liveSceneSource`

_function_ in `flow-host.ts`

`base` with each scene's active live version in place of its own, so
every load and sublevel library built from it gets that version; the
list and the start are `base`'s.

```ts
declare function liveSceneSource(base: SceneSource, live: LiveSceneVersions): SceneSource;
```

Refers to [`LiveSceneVersions`](#livesceneversions), [`SceneSource`](#scenesource).

## `localStorageSaveStore`

_function_ in `saves/store.ts`

`${prefix}${gameId}:${slot}` keys in `localStorage` (or `storage`), every
access in try/catch. It holds at most `MAX_BROWSER_SAVE_LIMITS`.

```ts
declare function localStorageSaveStore(opts?: {
    prefix?: string;
    storage?: Storage;
}): SaveStore;
```

Refers to [`SaveStore`](#savestore).

## `memoryRemapStore`

_function_ in `input/remap.ts`

Remaps kept for this page's life: tests, and hosts that don't persist them.

```ts
declare function memoryRemapStore(): RemapStore;
```

Refers to [`RemapStore`](#remapstore).

## `memorySaveStore`

_function_ in `saves/store.ts`

Saves held in this process; what headless runs use.

```ts
declare function memorySaveStore(): SaveStore;
```

Refers to [`SaveStore`](#savestore).

## `mountUi`

_function_ in `ui/layer.ts`

createUiLayer + the context + mount; the returned function unmounts and
removes the layer. `opts.links` is the host's pages, given to the UI as
`UiContext.links`.

```ts
declare function mountUi<G>(game: GameInstance, canvas: HTMLCanvasElement, mount: MountUi<G>, opts?: {
    links?: UiContext["links"];
}): () => void;
```

Refers to [`GameInstance`](#gameinstance), [`MountUi`](#mountui), [`UiContext`](#uicontext).

## `pixiContainer`

_function_ in `render/pixi-view.ts`

The Pixi container behind a Pixi view's layer handle, in world px, for a game drawing what the view can't.

```ts
declare function pixiContainer(handle: ViewLayerHandle): Container;
```

## `resolveBindings`

_function_ in `input/bindings.ts`

Combines the binding layers: per action and seat, the first layer that
names the action (the player's remap, the host, the project's input map,
the game) supplies its bindings, replacing the later layers' whole; a
layer that names an action with no bindings leaves it unbound. Then
indexes every seat's bindings by device. Bindings are taken as given:
`bindingProblems` judges them where they enter.

```ts
declare function resolveBindings(layers: BindingLayers): ResolvedBindings;
```

Refers to [`BindingLayers`](#bindinglayers), [`ResolvedBindings`](#resolvedbindings).

## `resolvePlayers`

_function_ in `game/input-bindings.ts`

The seats a run has: the input map's `players`, else the game's, else one seat.

```ts
declare function resolvePlayers(map: null | undefined | {
    players?: PlayersDef;
}, game: GameDefinition | null | undefined): PlayersDef;
```

Refers to [`GameDefinition`](#gamedefinition).

## `resolveResolution`

_function_ in `resolution.ts`

The policy in force, field by field: the host's, then the project's, then
the game's, then `DEFAULT_RESOLUTION`. `virtual` is taken whole.

```ts
declare function resolveResolution(sources: {
    game?: Partial<ResolutionPolicy>;
    host?: Partial<ResolutionPolicy>;
    project?: Partial<ResolutionPolicy>;
}): ResolutionPolicy;
```

Refers to [`ResolutionPolicy`](#resolutionpolicy).

## `selectCamera`

_function_ in `store.ts`

```ts
declare function selectCamera(state: GameStoreState): CameraState;
```

Refers to [`CameraState`](#camerastate), [`GameStoreState`](#gamestorestate).

## `selectDebugMode`

_function_ in `store.ts`

```ts
declare function selectDebugMode(state: GameStoreState): string;
```

Refers to [`GameStoreState`](#gamestorestate).

## `selectFPS`

_function_ in `store.ts`

```ts
declare function selectFPS(state: GameStoreState): number;
```

Refers to [`GameStoreState`](#gamestorestate).

## `selectGame`

_function_ in `store.ts`

The game's store slice, typed by the caller who knows the game.

```ts
declare function selectGame<G = unknown>(state: GameStoreState): G;
```

Refers to [`GameStoreState`](#gamestorestate).

## `selectMode`

_function_ in `store.ts`

```ts
declare function selectMode(state: GameStoreState): GameMode;
```

Refers to [`GameMode`](#gamemode), [`GameStoreState`](#gamestorestate).

## `selectPhase`

_function_ in `store.ts`

```ts
declare function selectPhase(state: GameStoreState): GamePhase;
```

Refers to [`GamePhase`](#gamephase), [`GameStoreState`](#gamestorestate).

## `selectSession`

_function_ in `store.ts`

```ts
declare function selectSession(state: GameStoreState): PlaySession | null;
```

Refers to [`GameStoreState`](#gamestorestate), [`PlaySession`](#playsession).

## `selectSim`

_function_ in `store.ts`

```ts
declare function selectSim(state: GameStoreState): SimState;
```

Refers to [`GameStoreState`](#gamestorestate), [`SimState`](#simstate).

## `selectTick`

_function_ in `store.ts`

```ts
declare function selectTick(state: GameStoreState): number;
```

Refers to [`GameStoreState`](#gamestorestate).

## `snapshotRemapStore`

_function_ in `input/remap.ts`

Remaps a host keeps for the game: `load` reads the snapshot the host
handed over at start (none when it isn't a v1 state) and then the latest
change; `save` hands the latest state back to the host once no change has
come for `SNAPSHOT_REMAP_SAVE_DELAY_MS`, so a run of edits posts once.

```ts
declare function snapshotRemapStore(initial: unknown, save: (gameId: string, state: RemapState) => void): RemapStore;
```

Refers to [`RemapState`](#remapstate), [`RemapStore`](#remapstore).

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

## `swapStrategyFor`

_const_ in `game/live.ts`

The strategy a swap of `diff` takes: reload when the header changed or a reload is asked for, else reconcile.

```ts
declare const swapStrategyFor: (diff: Pick<SceneDiff, "header">, wanted?: "auto" | SwapStrategy) => SwapStrategy;
```

Refers to [`SceneDiff`](#scenediff), [`SwapStrategy`](#swapstrategy).

## `timingWords`

_const_ in `game/live.ts`

How a timing reads in a message: `next load`, `boundary` or `now`.

```ts
declare const timingWords: (t: SwapTiming) => string;
```

Refers to [`SwapTiming`](#swaptiming).

## `utf8Bytes`

_const_ in `project/release-assets.ts`

```ts
declare const utf8Bytes: (text: string) => number;
```

## `versionName`

_const_ in `game/live.ts`

How a version is named where the host's numbers aren't known: `level-1@<first 12 hex>`, or the release's own.

```ts
declare const versionName: (scene: AssetId, version: Sha256 | null) => string;
```

## `viewportFor`

_function_ in `resolution.ts`

Pure: the virtual-to-canvas scale, the visible virtual size, the viewport's offset
and bars. The shown area is centred on the canvas. `letterbox` and `crop`
need a width and a height; given one, they fit as `expand` does. Under
`integer` the scale is a whole multiple and the fixed axes take bars for
the remainder; under `pixelSnap` the offset is whole canvas px.

```ts
declare function viewportFor(policy: ResolutionPolicy, canvas: {
    height: number;
    width: number;
}): ResolutionViewport;
```

Refers to [`ResolutionPolicy`](#resolutionpolicy), [`ResolutionViewport`](#resolutionviewport).

## `watchView`

_function_ in `ui/bind.ts`

Calls `fn` now and whenever where the world shows on screen may have
moved: when the camera changes and when the layer follows a canvas resize.
For DOM sized or placed by `worldToClient`. Returns the unsubscribe.

```ts
declare function watchView(ctx: UiContext, fn: () => void): () => void;
```

Refers to [`UiContext`](#uicontext).
