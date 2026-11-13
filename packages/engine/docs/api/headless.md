# @jams/engine/headless

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`AnalogValues`](#analogvalues) · [`AssetInfo`](#assetinfo) · [`AssetReloadError`](#assetreloaderror) · [`CONTACT_END`](#contact_end) · [`CONTACT_START`](#contact_start) · [`CheckEnv`](#checkenv) · [`CheckResult`](#checkresult) · [`CheckVerdict`](#checkverdict) · [`ChecksReport`](#checksreport) · [`CompileResult`](#compileresult) · [`CompiledInputScript`](#compiledinputscript) · [`CompiledPointer`](#compiledpointer) · [`CompiledScript`](#compiledscript) · [`CompiledScriptStep`](#compiledscriptstep) · [`CompiledStep`](#compiledstep) · [`CompiledTrack`](#compiledtrack) · [`DecodeOptions`](#decodeoptions) · [`ENTITY_DESTROYED`](#entity_destroyed) · [`ENTITY_DISABLED`](#entity_disabled) · [`ENTITY_ENABLED`](#entity_enabled) · [`ENTITY_SPAWNED`](#entity_spawned) · [`EventMatch`](#eventmatch) · [`FilesLoadInput`](#filesloadinput) · [`FuzzLegal`](#fuzzlegal) · [`FuzzMacroInputs`](#fuzzmacroinputs) · [`FuzzOptions`](#fuzzoptions) · [`FuzzReport`](#fuzzreport) · [`FuzzRun`](#fuzzrun) · [`FuzzTouch`](#fuzztouch) · [`HeadlessLive`](#headlesslive) · [`HeadlessLoad`](#headlessload) · [`HeadlessLoadInput`](#headlessloadinput) · [`HeadlessLoadOptions`](#headlessloadoptions) · [`HeadlessRuntime`](#headlessruntime) · [`HeadlessRuntimeOptions`](#headlessruntimeoptions) · [`InputEdge`](#inputedge) · [`InputScript`](#inputscript) · [`InputScriptStep`](#inputscriptstep) · [`InputScriptStepV2`](#inputscriptstepv2) · [`InputScriptTrack`](#inputscripttrack) · [`InputScriptV2`](#inputscriptv2) · [`LoadFailureReason`](#loadfailurereason) · [`LoadReport`](#loadreport) · [`PLAYER_JOINED`](#player_joined) · [`PLAYER_LEFT`](#player_left) · [`ParseRecordingResult`](#parserecordingresult) · [`PersistCell`](#persistcell) · [`PersistCellOptions`](#persistcelloptions) · [`PersistMatch`](#persistmatch) · [`PhysicalEnv`](#physicalenv) · [`PhysicalHit`](#physicalhit) · [`PhysicalOptions`](#physicaloptions) · [`PlayOptions`](#playoptions) · [`PlaytestBlocked`](#playtestblocked) · [`PlaytestHooks`](#playtesthooks) · [`PlaytestOptions`](#playtestoptions) · [`PlaytestOutcomeReport`](#playtestoutcomereport) · [`PlaytestReport`](#playtestreport) · [`PlaytestRun`](#playtestrun) · [`PlaytestSegment`](#playtestsegment) · [`PlaytestSegmentEnd`](#playtestsegmentend) · [`PlaytestStart`](#playteststart) · [`PlaytestStep`](#playteststep) · [`PointerBindings`](#pointerbindings) · [`PreparedPlay`](#preparedplay) · [`ProbeInput`](#probeinput) · [`ProbeOptions`](#probeoptions) · [`ProbeReport`](#probereport) · [`ProjectRuntimeView`](#projectruntimeview) · [`ProjectSnapshot`](#projectsnapshot) · [`RECORDING_VERSION`](#recording_version) · [`REPLAY_ACROSS_PLATFORMS`](#replay_across_platforms) · [`RapierModule`](#rapiermodule) · [`RecorderOptions`](#recorderoptions) · [`RecordingCommand`](#recordingcommand) · [`RecordingEnd`](#recordingend) · [`RecordingHost`](#recordinghost) · [`RecordingIssue`](#recordingissue) · [`RecordingMarker`](#recordingmarker) · [`RecordingPlatform`](#recordingplatform) · [`RecordingStream`](#recordingstream) · [`ReplayOptions`](#replayoptions) · [`ReplayReport`](#replayreport) · [`ReplayRun`](#replayrun) · [`RunChecksOptions`](#runchecksoptions) · [`RunRecorder`](#runrecorder) · [`RunRecording`](#runrecording) · [`RunRecordingV1`](#runrecordingv1) · [`RunRecordingV2`](#runrecordingv2) · [`RunTiming`](#runtiming) · [`RuntimeRequests`](#runtimerequests) · [`RuntimeStats`](#runtimestats) · [`SENSOR_ENTER`](#sensor_enter) · [`SENSOR_EXIT`](#sensor_exit) · [`STUCK_METRES`](#stuck_metres) · [`STUCK_TICKS`](#stuck_ticks) · [`SaveBlocker`](#saveblocker) · [`SaveStart`](#savestart) · [`SceneRuntime`](#sceneruntime) · [`SceneRuntimeHandle`](#sceneruntimehandle) · [`ScriptIssue`](#scriptissue) · [`ScriptSource`](#scriptsource) · [`ScriptStepLog`](#scriptsteplog) · [`SeatChange`](#seatchange) · [`SeatEvent`](#seatevent) · [`SnapshotError`](#snapshoterror) · [`SnapshotLoadInput`](#snapshotloadinput) · [`StepDuration`](#stepduration) · [`StepEvent`](#stepevent) · [`StepResult`](#stepresult) · [`StreamTables`](#streamtables) · [`SwapCheckOptions`](#swapcheckoptions) · [`SwapCheckReport`](#swapcheckreport) · [`SwapCheckRun`](#swapcheckrun) · [`SwapReport`](#swapreport) · [`SystemEvent`](#systemevent) · [`TickInput`](#tickinput) · [`TimingBucket`](#timingbucket) · [`TimingReport`](#timingreport) · [`TimingScope`](#timingscope) · [`TimingSpan`](#timingspan) · [`UntilClause`](#untilclause) · [`ValidatePhysicalOptions`](#validatephysicaloptions) · [`analogActions`](#analogactions) · [`analogValues`](#analogvalues-1) · [`assetInfo`](#assetinfo-1) · [`captureSave`](#capturesave) · [`compileInputScript`](#compileinputscript) · [`compiledPointer`](#compiledpointer-1) · [`createHeadlessRuntime`](#createheadlessruntime) · [`createPersistCell`](#createpersistcell) · [`createRunRecorder`](#createrunrecorder) · [`createRunTiming`](#createruntiming) · [`decodeStreams`](#decodestreams) · [`defaultFuzzMacro`](#defaultfuzzmacro) · [`defaultSeed`](#defaultseed) · [`fuzz`](#fuzz) · [`gamePersistCell`](#gamepersistcell) · [`heldEdges`](#heldedges) · [`loadHeadless`](#loadheadless) · [`memorySaveStore`](#memorysavestore) · [`mergeTick`](#mergetick) · [`parseRecording`](#parserecording) · [`physicalEnv`](#physicalenv-1) · [`plainJsonProblem`](#plainjsonproblem) · [`platformIssues`](#platformissues) · [`playWorld`](#playworld) · [`pointerAt`](#pointerat) · [`pointerHeld`](#pointerheld) · [`preparePlay`](#prepareplay) · [`probeConfigHash`](#probeconfighash) · [`recordedSwap`](#recordedswap) · [`recordingDivergence`](#recordingdivergence) · [`replayRecording`](#replayrecording) · [`restoreSave`](#restoresave) · [`runBlocked`](#runblocked) · [`runChecks`](#runchecks) · [`runPhysicalChecks`](#runphysicalchecks) · [`runPlaytest`](#runplaytest) · [`runProbe`](#runprobe) · [`scriptSource`](#scriptsource-1) · [`simActionError`](#simactionerror) · [`swapCheck`](#swapcheck) · [`tickWakes`](#tickwakes) · [`unknownActionError`](#unknownactionerror) · [`untilHolds`](#untilholds) · [`validatePhysical`](#validatephysical) · [`worldSaveBlockers`](#worldsaveblockers)

## `AnalogValues`

_type_ in `headless/compile-input-script.ts`

Axis values and vector components by action, quantised: what a seat holds besides its buttons.

```ts
type AnalogValues = Readonly<Record<string, Vec2 | number>>;
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

Refers to [`RapierModule`](#rapiermodule).

## `CheckResult`

_type_ in `headless/run-checks.ts`

```ts
type CheckResult = {
    detail?: unknown;
    id: string;
    kind: string;
    message: string;
    pass: boolean;
    /** Why the check didn't run; a skipped check passes. */
    skipped?: string;
};
```

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

## `ChecksReport`

_type_ in `headless/run-checks.ts`

```ts
type ChecksReport = {
    /** Every check passed or was skipped. */
    ok: boolean;
    results: CheckResult[];
};
```

Refers to [`CheckResult`](#checkresult).

## `CompileResult`

_type_ in `headless/playtest-types.ts`

```ts
type CompileResult = {
    issues: ScriptIssue[];
    ok: false;
} | {
    ok: true;
    script: CompiledInputScript;
};
```

Refers to [`CompiledInputScript`](#compiledinputscript), [`ScriptIssue`](#scriptissue).

## `CompiledInputScript`

_type_ in `headless/playtest-types.ts`

```ts
type CompiledInputScript = {
    /**
     * Seat 0's button edges before `maxTicks`, stamped with its slot, when no step waits
     * on `until`; otherwise edges are only known by running. Nothing is
     * released after the last step. For a fixed game these are the ticks played.
     */
    edges: InputEdge[] | null;
    maxTicks: number;
    play: PlayOptions;
    /** The script's `scene`: a playtest of any other scene is refused. */
    scene?: string;
    steps: CompiledStep[];
};
```

Refers to [`CompiledStep`](#compiledstep), [`InputEdge`](#inputedge), [`PlayOptions`](#playoptions).

## `CompiledPointer`

_type_ in `headless/compile-input-script.ts`

A pointer step as it plays: `at`, or a line from `at` to `drag` over the step.

```ts
type CompiledPointer = {
    at: Vec2;
    drag?: Vec2;
    /** Goes down on the step's first slot. */
    press?: PointerButton;
    /** Goes up on the step's last slot. */
    release?: PointerButton;
};
```

## `CompiledScript`

_type_ in `headless/compile-input-script.ts`

A compiled script of either format. A script written with `steps` keeps
them there (seat 0's track); one written with `tracks` has every seat's
steps in `tracks` and none in `steps`.

```ts
type CompiledScript = CompiledInputScript & {
    /** The script's `players`, when it names them. */
    players?: number;
    /**
     * Each seat's pointer bindings, by seat, when any action is bound to a
     * pointer button: a pointer step's buttons raise those actions as live
     * play does.
     */
    pointerBindings?: PointerBindings[];
    steps: CompiledScriptStep[];
    tracks?: CompiledTrack[];
};
```

Refers to [`CompiledInputScript`](#compiledinputscript), [`CompiledScriptStep`](#compiledscriptstep), [`CompiledTrack`](#compiledtrack), [`PointerBindings`](#pointerbindings).

## `CompiledScriptStep`

_type_ in `headless/compile-input-script.ts`

A step of either format: v1's fields, plus what it sets, points at and changes on its seat.

```ts
type CompiledScriptStep = CompiledStep & {
    /** Devices joining (`join`) or leaving (`leave`) the track's seat on the step's one slot. */
    joins?: {
        device: DeviceId;
        joined: boolean;
    }[];
    pointer?: CompiledPointer;
    /** Axis and vector values held for the step; what the step before set and this one doesn't returns to 0. */
    set?: AnalogValues;
};
```

Refers to [`AnalogValues`](#analogvalues), [`CompiledPointer`](#compiledpointer), [`CompiledStep`](#compiledstep).

## `CompiledStep`

_type_ in `headless/playtest-types.ts`

A step with its duration in ticks and its held set resolved.

```ts
type CompiledStep = {
    /** Sent on the step's one slot, args parsed. */
    commands?: GameCommand[];
    hold: string[];
    /** Index into the script's `steps`. */
    index: number;
    /** With `until`: the most slots the step may run. */
    max?: number;
    /** Fixed length in slots (ticks, for a fixed game); absent when the step waits on `until`. */
    ticks?: number;
    until?: UntilClause;
};
```

Refers to [`UntilClause`](#untilclause).

## `CompiledTrack`

_type_ in `headless/compile-input-script.ts`

One seat's steps, played concurrently with the other tracks from slot 0.

```ts
type CompiledTrack = {
    player: number;
    steps: CompiledScriptStep[];
};
```

Refers to [`CompiledScriptStep`](#compiledscriptstep).

## `DecodeOptions`

_type_ in `input/stream.ts`

How decoded actions are stamped: `timestamp` is the event's time on a
`tickMs` clock (default the engine's), and with `subTick` every action
carries its `offset`, 0 when the event sits on the tick itself.

```ts
type DecodeOptions = {
    subTick?: boolean;
    tickMs?: number;
};
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

## `EventMatch`

_type_ in `headless/playtest-types.ts`

The engine's `event` predicate: an event type, or a type with the entity ids it must name.

```ts
type EventMatch = string | {
    entityId?: string;
    other?: string;
    type: string;
};
```

## `FilesLoadInput`

_type_ in `headless/load.ts`

A scene and its prefabs as files: text or parsed JSON each.

```ts
type FilesLoadInput = LoadCommon & {
    files: {
        prefabs?: readonly unknown[];
        scene: unknown;
    };
};
```

## `FuzzLegal`

_type_ in `headless/playtest-types.ts`

The command macros of a fuzz over a game's legal commands, over every rollout.

```ts
type FuzzLegal = {
    /** Command macros that found the list empty and held nothing for their slot. */
    empty: number;
    /** Commands sent, each picked from the legal list of its slot. */
    sent: number;
};
```

## `FuzzMacroInputs`

_type_ in `headless/fuzz.ts`

What the default macro may drive beyond buttons: the game's analog actions and its pointer.

```ts
type FuzzMacroInputs = {
    /** Axis actions it sets to a value in −1…1. */
    axes?: readonly string[];
    /**
     * The pointer buttons an action is bound to, the actions bound to them
     * (clicked with the pointer rather than held), and the area the pointer
     * moves in.
     */
    pointer?: null | {
        actions?: readonly string[];
        bounds: Bounds;
        buttons: readonly PointerButton[];
    };
    /** Vector actions it sets to a point in the unit disc. */
    vectors?: readonly string[];
};
```

## `FuzzOptions`

_type_ in `headless/playtest-types.ts`

```ts
type FuzzOptions<S = unknown, G = unknown> = {
    dev?: boolean;
    /** Start every rollout from this save (`restoreSave`) instead of the scene's fresh load. */
    fromSave?: SaveStart;
    game?: GameDefinition<S, G> | null;
    /** Every prefab the game's `ctx.instantiate` may place, as `loadHeadless` returns it; default `prefabs`. */
    library?: PrefabLibrary;
    play?: PlayOptions<G>;
    /** The prefabs the scene's instances name. */
    prefabs?: PrefabLibrary;
    /** The project's data the game reads as `EngineContext.project`; its `engine` block resolves the scene's settings and the clock. */
    project?: ProjectRuntimeView | null;
    /** Needed only for a scene whose physics resolves to Rapier. */
    rapier?: RapierModule | null;
    registry?: Registry;
    /** Default 100. */
    rollouts?: number;
    scene: SceneDefinition;
    /** Seeds the generator; the same seed gives the same report (timing aside). */
    seed: number | string;
    /** Input slots per rollout, simulated or skipped; default 600. */
    ticks?: number;
};
```

Refers to [`PlayOptions`](#playoptions), [`ProjectRuntimeView`](#projectruntimeview), [`RapierModule`](#rapiermodule), [`SaveStart`](#savestart).

## `FuzzReport`

_type_ in `headless/playtest-types.ts`

```ts
type FuzzReport = {
    blocked: false;
    configHash: string;
    /** For a game that lists its commands and has no macro of its own: what the command macros did. */
    legal?: FuzzLegal;
    /** How many rollouts ended with each result. */
    results: Record<RunResult, number>;
    rollouts: number;
    scene: string;
    sceneHash: SceneHash;
    seed: number | string;
    /** Ticks simulated over every rollout; a rollout ends early on an outcome or `stuck`. */
    ticks: number;
    ticksPerRollout: number;
    /** Measured, so it differs run to run; compare reports without it. */
    timing: {
        elapsedMs: number;
        ticksPerSecond: number;
    };
    /** Sorted by `ref`. */
    touched: FuzzTouch[];
    /** Loadable entities no rollout touched, sorted. */
    untouched: Ref[];
};
```

Refers to [`FuzzLegal`](#fuzzlegal), [`FuzzTouch`](#fuzztouch).

## `FuzzRun`

_type_ in `headless/playtest-types.ts`

A fuzz that never ran: the scene has errors (`scene`) or doesn't load (`load`).

```ts
type FuzzRun = FuzzReport | PlaytestBlocked;
```

Refers to [`FuzzReport`](#fuzzreport), [`PlaytestBlocked`](#playtestblocked).

## `FuzzTouch`

_type_ in `headless/playtest-types.ts`

An entity some rollout touched: named by an event's `entityId` or `other`.

```ts
type FuzzTouch = {
    firstRollout: number;
    /** The earliest tick any rollout touched it, and that rollout's index. */
    firstTick: number;
    /** Rollouts that touched it. */
    reached: number;
    ref: Ref;
    type: EntityTypeName;
};
```

## `HeadlessLive`

_type_ in `headless/types.ts`

`GameInstance.live` for a headless runtime: the same members, with no
preloading, so staging answers at once. An activated `now` or `boundary`
swap applies after the step it waits for, between ticks.

```ts
type HeadlessLive = Omit<GameLive, "stage"> & {
    /** Reads and validates a version for a listed scene and keeps it resident; nothing is fetched or preloaded. */
    stage(v: StagedVersion): {
        issue: SceneIssue;
        ok: false;
    } | {
        ok: true;
    };
};
```

## `HeadlessLoad`

_type_ in `headless/load.ts`

What `runPlaytest`, `replayRecording` and `runChecks` take, ready to spread into their options.

```ts
type HeadlessLoad = {
    /**
     * The save the run starts from, when one was given, with the hash of its
     * text as given (of its canonical text when given parsed), which a
     * recording names it by.
     */
    fromSave?: SaveStart;
    /** Every prefab given or pinned, by id: what the game's `ctx.instantiate` may place. */
    library: PrefabLibrary;
    /** The prefabs the scene's instances name, by id: what `sceneHash` covers. */
    prefabs: PrefabLibrary;
    project: ProjectRuntimeView | null;
    /** By snapshot, the given registry's game with the snapshot's own materials in place of any overlay it had. */
    registry: Registry;
    scene: SceneDefinition;
    /** What a recording of this scene pins: the scene with the prefabs it uses. */
    sceneHash: SceneHash;
    /** The snapshot it was loaded from; null for files. */
    snapshot: Sha256 | null;
};
```

Refers to [`ProjectRuntimeView`](#projectruntimeview), [`SaveStart`](#savestart).

## `HeadlessLoadInput`

_type_ in `headless/load.ts`

```ts
type HeadlessLoadInput = FilesLoadInput | SnapshotLoadInput;
```

Refers to [`FilesLoadInput`](#filesloadinput), [`SnapshotLoadInput`](#snapshotloadinput).

## `HeadlessLoadOptions`

_type_ in `headless/load.ts`

```ts
type HeadlessLoadOptions = {
    /**
     * A save to start the run from, as text or parsed: a save of the loaded
     * scene, for the registry's game. Text is parsed and migrated with the
     * game's save migrations.
     */
    fromSave?: SaveFile | string;
};
```

## `HeadlessRuntime`

_type_ in `headless/types.ts`

A headless runtime; `save` captures the world as `captureSave` does, and `live` swaps scene versions in.

```ts
type HeadlessRuntime = SceneRuntimeHandle & {
    live?: HeadlessLive;
    save?(opts: {
        depth: SaveDepth;
        /** The caller's clock for `meta.savedAt`. */
        now: number;
        slot: string;
        title?: string;
    }): {
        file: SaveFile;
        ok: true;
    } | {
        issue: SceneIssue;
        ok: false;
    };
};
```

Refers to [`HeadlessLive`](#headlesslive), [`SceneRuntimeHandle`](#sceneruntimehandle).

## `HeadlessRuntimeOptions`

_type_ in `headless/types.ts`

```ts
type HeadlessRuntimeOptions = {
    dev?: boolean;
    /** The listed scenes: with it a flow request loads the next scene after the tick; without it the run ends there. */
    flow?: SceneLibrary;
    /** Start from this save instead of the scene's fresh load. */
    fromSave?: SaveFile;
    /** Without one the runtime loads primitives only. */
    game?: GameDefinition | null;
    /** Needed for a scene that runs on Rapier; a scene without physics loads with none. */
    rapier?: RapierModule | null;
    /** Built from `game` when omitted. */
    registry?: Registry;
    scene?: ExpandedScene;
    /** Times each step's parts into this collector; `stats().timing` reports them. */
    timing?: RunTiming;
};
```

Refers to [`RapierModule`](#rapiermodule), [`RunTiming`](#runtiming).

## `InputEdge`

_type_ in `headless/playtest-types.ts`

One input edge: at the start of `tick`, `action` goes down (1) or up (0).

```ts
type InputEdge = [
    tick: number,
    action: string,
    pressed: 0 | 1
];
```

## `InputScript`

_type_ in `headless/playtest-types.ts`

```ts
type InputScript<G = unknown> = {
    $schema?: string;
    /** Play from here; omitted plays from the game's spawn. */
    at?: Pt;
    game?: G;
    /** The run ends as `timeout` after this many simulated ticks (default 1800). */
    maxTicks?: number;
    /** The scene this was written for; the CLI checks it against the scene it runs. */
    scene?: string;
    /** Seeds `EngineContext.random` for the run, as `PlayOptions.seed`. */
    seed?: number | string;
    steps: InputScriptStep[];
    timeOffsetMs?: number;
    v: 1;
};
```

Refers to [`InputScriptStep`](#inputscriptstep).

## `InputScriptStep`

_type_ in `headless/playtest-types.ts`

One script step. Each step names everything held during it; what the
step before held and this one doesn't is released at the boundary.

```ts
type InputScriptStep = ({
    hold: string[];
} & StepDuration) | {
    args?: unknown;
    command: string;
} | {
    elapse: number;
} | {
    press: string | string[];
} | {
    wait: number;
};
```

Refers to [`StepDuration`](#stepduration).

## `InputScriptStepV2`

_type_ in `headless/playtest-types.ts`

A v2 step: v1's, plus `set` (axis values and vector pairs held for the
step, alone or with `hold`), `pointer`, `nav`, and a seat's `join` and `leave`.

```ts
type InputScriptStepV2 = ({
    hold: string[];
    set?: AnalogSet;
} & StepDuration) | ({
    pointer: ScriptPointer;
} & StepDuration) | ({
    set: AnalogSet;
} & StepDuration) | {
    args?: unknown;
    command: string;
} | {
    elapse: number;
} | {
    join: DeviceId;
} | {
    leave: DeviceId;
} | {
    nav: NavDestination;
} | {
    press: string | string[];
} | {
    wait: number;
};
```

Refers to [`StepDuration`](#stepduration).

## `InputScriptTrack`

_type_ in `headless/playtest-types.ts`

One seat's steps, run concurrently with the other tracks from slot 0.

```ts
type InputScriptTrack = {
    player: number;
    steps: InputScriptStepV2[];
};
```

Refers to [`InputScriptStepV2`](#inputscriptstepv2).

## `InputScriptV2`

_type_ in `headless/playtest-types.ts`

A v2 script: exactly one of `steps` (one track for seat 0, v1's form) or
`tracks`. It ends (`script-end`) when every track's steps ran out.

```ts
type InputScriptV2<G = unknown> = Omit<InputScript<G>, "steps" | "v"> & {
    /** Seats the run has; default the game's. */
    players?: number;
    v: 2;
} & ({
    steps: InputScriptStepV2[];
    tracks?: never;
} | {
    steps?: never;
    tracks: InputScriptTrack[];
});
```

Refers to [`InputScript`](#inputscript), [`InputScriptStepV2`](#inputscriptstepv2), [`InputScriptTrack`](#inputscripttrack).

## `LoadFailureReason`

_type_ in `runtime/types.ts`

Why a load failed, when it wasn't a plain error. `spawn-blocked`: a play
start `at` lies inside a solid. `physics-required`: an entity needs physics
the scene runs without. `physics-not-loaded`: the scene needs Rapier and
the host gave none.

```ts
type LoadFailureReason = "physics-not-loaded" | "physics-required" | "spawn-blocked";
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

## `PersistCell`

_type_ in `runtime/types.ts`

The value `EngineContext.persist` reads and writes. One cell outlives
every runtime of a game instance or headless session, so the value
survives scene loads.

```ts
type PersistCell = {
    readonly value: JsonValue;
    /** Back to the game's initial value. */
    reset(): void;
    set(next: JsonValue): void;
};
```

## `PersistCellOptions`

_type_ in `runtime/persist.ts`

```ts
type PersistCellOptions = {
    /** Dev and headless check what the game sets; production trusts it. */
    check?: boolean;
    /** Judged on every value the cell takes, after the plain-JSON check, when `check` is on. */
    schema?: z.ZodType;
};
```

## `PersistMatch`

_type_ in `headless/playtest-types.ts`

The engine's `persist` predicate: the value at a JSON Pointer into `ctx.persist` equals, or is at least or at most, a value.

```ts
type PersistMatch = {
    eq?: JsonValue;
    gte?: number;
    lte?: number;
    pointer: string;
};
```

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

Refers to [`PhysicalHit`](#physicalhit), [`RapierModule`](#rapiermodule).

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

## `PhysicalOptions`

_type_ in `headless/validate-physical.ts`

```ts
type PhysicalOptions = {
    /** `pointerLines` of the scene's text, to give each issue a line. */
    lines?: ReadonlyMap<string, number>;
};
```

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

## `PlaytestBlocked`

_type_ in `headless/playtest-types.ts`

A playtest that didn't finish: the script didn't compile, the scene has
errors, it didn't load, or an `EngineError` ended the run (`run`, its code
in `issues`).

```ts
type PlaytestBlocked = {
    blocked: true;
    issues: SceneIssue[];
    /** The load failure, for `stage: "load"`. */
    load?: LoadReport;
    scene: string;
    scriptIssues: ScriptIssue[];
    stage: "load" | "run" | "scene" | "script";
};
```

Refers to [`LoadReport`](#loadreport), [`ScriptIssue`](#scriptissue).

## `PlaytestHooks`

_type_ in `headless/playtest.ts`

```ts
type PlaytestHooks = {
    /**
     * After the run, with the last scene's runtime between ticks and before
     * it is destroyed: what `captureSave` takes. Not called for a blocked run.
     */
    onEnd?(runtime: SceneRuntimeHandle): void;
    /** After the run, with its last simulated tick's state while its world is still live; not called when no tick ran. */
    onLastTick?(state: PlayState): void;
};
```

Refers to [`SceneRuntimeHandle`](#sceneruntimehandle).

## `PlaytestOptions`

_type_ in `headless/playtest-types.ts`

```ts
type PlaytestOptions<S = unknown, G = unknown> = {
    /** Freeze the played definition, as the editor's Play does in dev. */
    dev?: boolean;
    /** The listed scenes: with it the run follows flow requests on the same script; without it a request ends the run as `flow`. */
    flow?: SceneLibrary;
    game?: GameDefinition<S, G> | null;
    /** Every prefab the game's `ctx.instantiate` may place, as `loadHeadless` returns it; default `prefabs`. */
    library?: PrefabLibrary;
    /** Cap on `events`; default 1000. */
    maxEvents?: number;
    /** Cap on `trail.pts`; default 2000. */
    maxTrail?: number;
    /** The prefabs the scene's instances name. */
    prefabs?: PrefabLibrary;
    /** The project's data the game reads as `EngineContext.project`; null without one. */
    project?: ProjectRuntimeView | null;
    /** Needed only for a scene whose physics resolves to Rapier; omitted or null, that scene's load fails. */
    rapier?: RapierModule | null;
    /** Built from `game` when omitted. */
    registry?: Registry;
    /** Validated (errors block), hashed and expanded the way Play does. */
    scene: SceneDefinition;
    script: CompiledInputScript | InputScript<G> | InputScriptV2<G>;
    /**
     * Times each step's parts into this collector, across every scene the
     * run visits; the caller reads its `report()`. Nothing of it reaches the
     * run's report or recording.
     */
    timing?: RunTiming;
};
```

Refers to [`CompiledInputScript`](#compiledinputscript), [`InputScript`](#inputscript), [`InputScriptV2`](#inputscriptv2), [`ProjectRuntimeView`](#projectruntimeview), [`RapierModule`](#rapiermodule), [`RunTiming`](#runtiming).

## `PlaytestOutcomeReport`

_type_ in `headless/playtest-types.ts`

```ts
type PlaytestOutcomeReport = {
    /** The game's focus then, or null without one. */
    at: Vec2 | null;
    cause?: string;
    entityId?: string;
    result: RunResult;
    /** The last tick simulated (`ticks - 1`). */
    tick: number;
    /** With `result: "flow"`: the scene the request that ended the run went to. */
    to?: AssetId;
};
```

## `PlaytestReport`

_type_ in `headless/playtest-types.ts`

How a playtest went. In a run that followed flow requests, `ticks`,
`slots`, `outcome.tick`, `steps`, `inputs`, `commands`, `events` and
`trail` cover every scene, ticks counted from the run's start; `scene`,
`sceneHash`, `stream` and `recording` are the first scene's, and
`segments` has each scene's own.

```ts
type PlaytestReport<S = unknown> = {
    blocked: false;
    /** The commands stepped, oldest first, stamped with the tick that stepped them. */
    commands: RecordingCommand[];
    /** `probeConfigHash` of the game. */
    configHash: string;
    events: StepEvent[];
    /** The game's snapshot after the last tick; `null` without a game. */
    final: S | null;
    /**
     * Seat 0's button edges actually played, `until` steps resolved, as v1 held them.
     * @deprecated Read `stream`, which holds every seat's input.
     */
    inputs: InputEdge[];
    /** Warnings and info the scene had; errors block instead. */
    issues: SceneIssue[];
    /** The commands legal after the last tick (`GamePlayDef.commands`), at most 64; absent when the game declares none. */
    legal?: GameCommand[];
    /** True when `legal` was cut at 64 entries. */
    legalTruncated?: boolean;
    outcome: PlaytestOutcomeReport;
    /** The run as a recording: `replayRecording` plays it again tick for tick; the first segment's in a multi-scene run. */
    recording: RunRecording;
    scene: string;
    sceneHash: SceneHash;
    /** Each scene the run visited, in order; present when the run was given `flow`. */
    segments?: PlaytestSegment[];
    /** Input slots the script used, skipped ones included; equal to `ticks` for a fixed game. */
    slots: number;
    /** Each started step: when it started, how long it ran and why it ended. */
    steps: PlaytestStep[];
    /** How many script steps started (the last one may not have finished). */
    stepsReached: number;
    /** Every seat's input and the system events, as a v2 recording holds them; the first scene's. */
    stream: RecordingStream;
    /** The run's ticks per second. */
    tickRate: number;
    /** Ticks simulated. */
    ticks: number;
    /**
     * The game's focus after ticks 0, 4, 8, …, oldest first; a sample whose
     * focus was null is left out. Empty without a `focus` hook.
     */
    trail: {
        every: 4;
        pts: Pt[];
        truncated: boolean;
    };
    truncated: boolean;
};
```

Refers to [`InputEdge`](#inputedge), [`PlaytestOutcomeReport`](#playtestoutcomereport), [`PlaytestSegment`](#playtestsegment), [`PlaytestStep`](#playteststep), [`RecordingCommand`](#recordingcommand), [`RecordingStream`](#recordingstream), [`RunRecording`](#runrecording), [`StepEvent`](#stepevent).

## `PlaytestRun`

_type_ in `headless/playtest-types.ts`

```ts
type PlaytestRun<S = unknown> = PlaytestBlocked | PlaytestReport<S>;
```

Refers to [`PlaytestBlocked`](#playtestblocked), [`PlaytestReport`](#playtestreport).

## `PlaytestSegment`

_type_ in `headless/playtest-types.ts`

One scene a run visited: its ticks and its own recording, which replays alone.

```ts
type PlaytestSegment = {
    end: PlaytestSegmentEnd;
    recording: RunRecording;
    scene: AssetId;
    ticks: number;
};
```

Refers to [`PlaytestSegmentEnd`](#playtestsegmentend), [`RunRecording`](#runrecording).

## `PlaytestSegmentEnd`

_type_ in `headless/playtest-types.ts`

How one scene's part of a run ended: the request that left it (`flow`, with `to`), or the run's own end.

```ts
type PlaytestSegmentEnd = {
    entry?: string;
    result: RunResult;
    tick: number;
    to?: AssetId;
};
```

## `PlaytestStart`

_type_ in `headless/playtest.ts`

Where a run starts: the scene's fresh load, or a save of it.

```ts
type PlaytestStart = {
    /**
     * Start from this save of the scene (`restoreSave`) instead of its fresh
     * load; the first scene's recording names it as `fromSave`, and the
     * script plays from the save's moment. A save of another scene is refused.
     */
    fromSave?: SaveStart;
};
```

Refers to [`SaveStart`](#savestart).

## `PlaytestStep`

_type_ in `headless/playtest-types.ts`

How one script step went.

```ts
type PlaytestStep = {
    /** `done`: its fixed length ran out; `until`: its condition held; `max`: it gave up; `run`: the run ended during it. */
    end: "done" | "max" | "run" | "until";
    /** Index into the script's steps, or into its track's steps. */
    index: number;
    /** The track's seat, for a script written with tracks; absent for one written with steps. */
    player?: number;
    /** The slot it started on: its tick, for a fixed game. */
    start: number;
    /** Slots it ran: ticks, for a fixed game; a turns or event game may skip some. */
    ticks: number;
};
```

## `PointerBindings`

_type_ in `headless/compile-input-script.ts`

One seat's pointer bindings: per button, each button action bound to it.

```ts
type PointerBindings = Partial<Record<PointerButton, readonly {
    action: string;
    binding: Binding;
}[]>>;
```

## `PreparedPlay`

_type_ in `runtime/play-session.ts`

```ts
type PreparedPlay = {
    /** A clone of the document, deep-frozen when `dev`. */
    def: SceneDefinition;
    /** The document's hash with the prefabs it uses: what a recording shows. */
    hash: SceneHash;
    /** Warnings and info; they don't block. */
    issues: SceneIssue[];
    ok: true;
    /** `runHash` of what this run runs: what a replay's staleness is judged on. */
    runHash: string;
    /** What the systems spawn from; deep-frozen with `def` when `dev`. */
    scene: ExpandedScene;
} | {
    issues: SceneIssue[];
    ok: false;
};
```

## `ProbeInput`

_type_ in `headless/types.ts`

```ts
type ProbeInput = {
    /** Game commands stepped on their tick, in list order; checked by the caller (`compileInputScript`). */
    commands?: readonly (readonly [
        tick: number,
        command: GameCommand
    ])[];
    /** Actions pressed at tick 0 and never released. */
    hold?: string[];
    /** Edges applied at the start of their tick, in list order. */
    inputs?: [
        tick: number,
        action: string,
        pressed: 0 | 1
    ][];
    /** Cap on `events`; defaults to 1000. */
    maxEvents?: number;
    ticks: number;
};
```

## `ProbeOptions`

_type_ in `headless/types.ts`

```ts
type ProbeOptions<S = unknown> = ProbeInput & {
    game?: GameDefinition<S> | null;
    /** The project the scene runs in: its `engine.tickRate` sets the clock before the game's. */
    project?: ProjectRuntimeView | null;
    /** Needed for a scene that runs on Rapier; a scene without physics loads with none. */
    rapier?: RapierModule | null;
    registry?: Registry;
    scene: ExpandedScene;
    /**
     * Times each step's parts into this collector, reported as
     * `stats.timing`: wall time, so the one part of the report two runs of
     * the same input don't share. Without it the report holds no timing.
     */
    timing?: RunTiming;
};
```

Refers to [`ProbeInput`](#probeinput), [`ProjectRuntimeView`](#projectruntimeview), [`RapierModule`](#rapiermodule), [`RunTiming`](#runtiming).

## `ProbeReport`

_type_ in `headless/types.ts`

```ts
type ProbeReport<S = unknown> = {
    /** Set when an `EngineError` out of a step ended the run: stage `run`, the error's code on its issue; `ticks`, `events` and `final` cover the ticks before it. */
    blocked?: PlaytestBlocked;
    /** Changes with the engine version, the tick rate, the game and its tuning. */
    configHash: string;
    events: StepEvent[];
    /** The game's snapshot after the last tick; `null` without a game. */
    final: S | null;
    /** The commands legal after the last tick (`GamePlayDef.commands`), at most 64; absent when the game declares none. */
    legal?: GameCommand[];
    /** True when `legal` was cut at 64 entries. */
    legalTruncated?: boolean;
    load: LoadReport;
    /** The game's first verdict (`play.outcome`) and its tick; the probe still runs every tick. */
    outcome?: GameOutcome & {
        tick: number;
    };
    stats: RuntimeStats;
    /** The runtime's ticks per second. */
    tickRate: number;
    /** Ticks actually simulated: 0 when the scene failed to load. */
    ticks: number;
    truncated: boolean;
};
```

Refers to [`LoadReport`](#loadreport), [`PlaytestBlocked`](#playtestblocked), [`RuntimeStats`](#runtimestats), [`StepEvent`](#stepevent).

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

Refers to [`AssetInfo`](#assetinfo).

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

## `RECORDING_VERSION`

_const_ in `scene/recording-schema.ts`

The recording format version every recording is written in.

```ts
declare const RECORDING_VERSION = 2;
```

## `REPLAY_ACROSS_PLATFORMS`

_const_ in `version.ts`

Whether a Rapier recording replays on another CPU architecture without a
warning. True since the cross-platform determinism check held on x86_64;
when false, a replay whose recorded `arch` is known and differs from here
carries `recording-other-platform`.

```ts
declare const REPLAY_ACROSS_PLATFORMS = true;
```

## `RapierModule`

_type_ in `types.ts`

```ts
type RapierModule = typeof _$_dimforge_rapier2d0;
```

## `RecorderOptions`

_type_ in `runtime/recorder.ts`

```ts
type RecorderOptions = RecordingHost & {
    /** The flow entry the scene loaded with. */
    entry?: null | string;
    /** The save the run began by loading: its slot and the fixture's hash, written as `fromSave`. */
    fromSave?: {
        sha256: Sha256;
        slot: string;
    };
    game: GameDefinition | null;
    maxMarkers?: number;
    maxTrail?: number;
    /** `ctx.persist` as the scene loaded; written as `start.persist` only when the game declares `persist`. */
    persist?: JsonValue;
    /** The seats as the run loaded (`runtime.ctx.input.players()`); devices they take later come from the joins recorded. */
    players?: readonly PlayerInfo[];
    rapier: RapierModule | null;
    /** The run's registry; with it, a UI-only action (`isUiAction`) a tick carries is left out of the recording. */
    registry?: Registry;
    /** `preparePlay`'s hash of what the run runs; a replay is stale when its own differs. */
    runHash: string;
    scene: string;
    sceneHash: SceneHash;
    /** The live version the scene loaded as, written as `sceneVersion`; null or omitted for the release's own. */
    sceneVersion?: Sha256 | null;
    /** The start as Play was asked for it; a replay casts `at` again the same way. */
    start: PlayOptions;
    /** The run's clock (`runtime.ctx.time`); omitted, the game's own. */
    time?: ResolvedTime;
};
```

Refers to [`PlayOptions`](#playoptions), [`RapierModule`](#rapiermodule), [`RecordingHost`](#recordinghost).

## `RecordingCommand`

_type_ in `scene/recording-schema.ts`

A command stamped with the tick that stepped it: `[tick, name, args?]`.

```ts
type RecordingCommand = NonNullable<RunRecordingV1["commands"]>[number];
```

Refers to [`RunRecordingV1`](#runrecordingv1).

## `RecordingEnd`

_type_ in `runtime/recorder.ts`

```ts
type RecordingEnd = {
    cause?: string;
    entityId?: string;
    /** The flow request that ended the scene's run, written as `next`. */
    next?: {
        entry?: string;
        scene: string;
    };
    result: RunResult;
    /** The last tick simulated. */
    tick: number;
    /** Ticks simulated. */
    ticks: number;
};
```

## `RecordingHost`

_type_ in `runtime/recorder.ts`

What a host knows about where it runs, beyond what the engine reads itself.

```ts
type RecordingHost = {
    /**
     * Overrides what the engine finds: `arch` and `runtime` default to this
     * process's (`"unknown"` and `"browser"` without one), and `flavour`, the
     * Rapier package, defaults to null since a module doesn't name its package.
     */
    platform?: Partial<RecordingPlatform>;
    /** The project the run plays in and its snapshot hash, when the host has them; default null. */
    projectRef?: null | {
        id: string;
        snapshot: null | string;
    };
    /** The id of the release the run plays from, written as `release`; omitted outside one. */
    release?: Sha256;
};
```

Refers to [`RecordingPlatform`](#recordingplatform).

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

## `ReplayOptions`

_type_ in `headless/recording.ts`

```ts
type ReplayOptions<S = unknown> = RecordingHost & {
    dev?: boolean;
    /** The listed scenes the recorded run had, which the replay keeps for `ctx.flow`; it never follows a request. */
    flow?: SceneLibrary;
    game?: GameDefinition<S> | null;
    /** Every prefab `ctx.instantiate` may place, as `loadHeadless` returns it; default `prefabs`. */
    library?: PrefabLibrary;
    /** The prefabs the scene's instances name. */
    prefabs?: PrefabLibrary;
    /** The project's data the game reads as `EngineContext.project`; its `engine` block resolves the scene's settings and the clock. */
    project?: ProjectRuntimeView | null;
    /** Needed only for a scene whose physics resolves to Rapier. */
    rapier?: RapierModule | null;
    /** A `RunRecording` in any format version, or its JSON (text or parsed), read by `parseRecording`. */
    recording: unknown;
    registry?: Registry;
    /**
     * Save fixtures by the hash of their bytes, as files or parsed: a
     * recording that began from a save (`fromSave`) replays from the one
     * with its hash, and without it is blocked with `asset-missing`.
     */
    saves?: ReadonlyMap<Sha256, SaveFile | string>;
    /** Validated, hashed and expanded the way Play does. */
    scene: SceneDefinition;
    /** The scene's listed id (`ctx.flow.scene`); default the library's id for it, else its name. */
    sceneId?: AssetId;
    /**
     * The scene versions the recording names, by id (a host holding several
     * looks one up with `findSceneVersion`); null for one it doesn't have. A
     * recording that starts on a version it can't find doesn't replay, and a
     * swap to one stops the replay at its tick, both with
     * `scene-version-removed`.
     */
    versions?: (id: Sha256) => StagedVersion | null;
};
```

Refers to [`ProjectRuntimeView`](#projectruntimeview), [`RapierModule`](#rapiermodule), [`RecordingHost`](#recordinghost).

## `ReplayReport`

_type_ in `headless/recording.ts`

```ts
type ReplayReport<S = unknown> = {
    blocked: false;
    /** How it differs from the recording, when it doesn't match. */
    divergence: null | string;
    /** The game's snapshot after the last tick; `null` without a game. */
    final: S | null;
    /** Coded warnings beside `warnings`: `recording-other-platform`. */
    issues: SceneIssue[];
    /** Same result, tick and end digest as the recording. */
    matches: boolean;
    /** The format version the recording was migrated from, when it was. */
    migratedFrom?: 1;
    /** The replay, recorded again. */
    recording: RunRecording;
    /**
     * What the run runs differs from what the recording ran (`runHash`; for a
     * recording migrated from v1, which has none, the scene's hash), so the
     * replay may not end the same way. Judged per part of the run: the start
     * against the start, and each swap against what the replayed swap made.
     */
    stale: boolean;
    /** The tick of the first swap the replay made differently (strategy, run hash, or not at all), from which it is stale. */
    staleFrom?: number;
    /** Why this replay may differ: a stale run, other tuning, another engine version or physics build. */
    warnings: string[];
};
```

Refers to [`RunRecording`](#runrecording).

## `ReplayRun`

_type_ in `headless/recording.ts`

```ts
type ReplayRun<S = unknown> = PlaytestBlocked | ReplayReport<S>;
```

Refers to [`PlaytestBlocked`](#playtestblocked), [`ReplayReport`](#replayreport).

## `RunChecksOptions`

_type_ in `headless/run-checks.ts`

```ts
type RunChecksOptions = {
    checks: ChecksFile;
    /** The project's `engine` block, which the scene's settings resolve through when validated. */
    engine?: Readonly<Record<string, unknown>>;
    /** Every prefab the game's `ctx.instantiate` may place in the checks that play; default `prefabs`. */
    library?: PrefabLibrary;
    /** The prefabs the scene's instances name. */
    prefabs?: PrefabLibrary;
    /** The project's data, for the checks that play the scene (`reaches`, `touches`); its `engine` block stands in for `engine` when that is omitted. */
    project?: ProjectRuntimeView | null;
    /** Needed for checks that load a scene running on Rapier; a scene without physics needs none. */
    rapier?: RapierModule | null;
    /** Reads a file a check names, relative to the checks file. */
    readFile: (path: string) => string;
    registry: Registry;
    scene: SceneDefinition;
};
```

Refers to [`ProjectRuntimeView`](#projectruntimeview), [`RapierModule`](#rapiermodule).

## `RunRecorder`

_type_ in `runtime/recorder.ts`

```ts
type RunRecorder = {
    /** The recording so far, ended as `end` with the game's snapshot after its last tick. */
    finish(end: RecordingEnd, final: unknown): RunRecording;
    /** After a swap was applied between ticks; written to `swaps` in the order given. */
    swap(entry: RecordedSwap): void;
    /** After each simulated tick, with the input it stepped, in the order the runtime took it. */
    tick(state: PlayState, input: TickInput, focus: Vec2 | null): void;
};
```

Refers to [`RecordingEnd`](#recordingend), [`RunRecording`](#runrecording), [`TickInput`](#tickinput).

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
    /** The live version this segment started on; absent: the release's own scene. */
    sceneVersion?: Sha256;
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
    /** Every swap during the segment, in tick order; absent when none ran. */
    swaps?: RecordedSwap[];
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

## `RunTiming`

_type_ in `runtime/timing.ts`

Collects wall-clock timings on the clock its host hands it. A runtime
given one (`SceneRuntimeOptions.timing`) times each step into scope
`tick` and reports it as `RuntimeStats.timing`; one collector may serve
several runtimes, their spans adding up. Nothing it measures reaches the
simulation, a recording, a save or a hash.

```ts
type RunTiming = {
    /** Off, every scope's `begin` is false and nothing reads the clock. */
    enabled: boolean;
    /** Each scope's spans so far; `shell`, `frame` and `draw` only once they ran. */
    report(): TimingReport;
    /** Forgets everything measured; scopes stay valid. */
    reset(): void;
    scope(name: string): TimingScope;
};
```

Refers to [`TimingReport`](#timingreport), [`TimingScope`](#timingscope).

## `RuntimeRequests`

_type_ in `runtime/types.ts`

What `SceneRuntime.takeRequests` hands the host.

```ts
type RuntimeRequests = {
    flow: FlowRequest | null;
    saves: SaveRequest[];
};
```

## `RuntimeStats`

_type_ in `runtime/types.ts`

```ts
type RuntimeStats = {
    /** Which world holds the colliders `bodies` and `colliders` count. */
    backend: "geometry" | "rapier";
    /** Each built behavior system's live attachments; zeros left out. */
    behaviors: Record<BehaviorName, number>;
    bodies: number;
    colliders: number;
    entities: number;
    perType: Record<EntityTypeName, number>;
    tags: number;
    /**
     * Where the steps' wall time went, by part: only for a runtime made with
     * `SceneRuntimeOptions.timing`, while that collector is enabled. The one
     * field of the stats that differs between two runs of the same input.
     */
    timing?: TimingReport;
};
```

Refers to [`TimingReport`](#timingreport).

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

## `STUCK_METRES`

_const_ in `headless/play-loop.ts`

```ts
declare const STUCK_METRES = 0.04;
```

## `STUCK_TICKS`

_const_ in `headless/play-loop.ts`

Holding a movement action with the focus moving under `STUCK_METRES` over `STUCK_TICKS` ticks is `stuck`.

```ts
declare const STUCK_TICKS = 120;
```

## `SaveBlocker`

_type_ in `runtime/save-state.ts`

Why a world save can't be taken now; `message` says it in plain words.

```ts
type SaveBlocker = {
    cause: "coroutine" | "timer";
    id: number;
    message: string;
    owner?: string;
} | {
    cause: "physics";
    message: string;
} | {
    cause: "restore";
    message: string;
};
```

## `SaveStart`

_type_ in `headless/play-loop.ts`

A save a run starts from, with the hash of the fixture's bytes, which
its recording names (`fromSave`) so a replay can find the same fixture.

```ts
type SaveStart = {
    file: SaveFile;
    sha256: Sha256;
};
```

## `SceneRuntime`

_type_ in `runtime/types.ts`

```ts
type SceneRuntime = {
    /**
     * Spawns entities into the loaded scene. A duplicate id or an unknown type
     * rejects the whole call before anything changes, and a spawn that throws
     * rolls the call back. The game's `onLoad` doesn't run again.
     */
    add: (entities: RuntimeEntity[]) => ReconcileReport;
    /** The game's `busy()`: false without a game or the hook. */
    busy: () => boolean;
    destroy: () => void;
    get: (id: string) => RuntimeEntity | undefined;
    /**
     * Replaces the current scene; a scene with duplicate ids or unknown types is
     * rejected before anything changes. With `play` it builds a play world:
     * `EngineContext.play` is set before the game's `onLoad`, and an `at` inside
     * a solid fails the load (`reason: "spawn-blocked"`).
     */
    load: (scene: ExpandedScene, play?: PlayOptions) => LoadReport;
    /** Despawns by id; unknown ids are no-ops. */
    remove: (ids: string[]) => void;
    /** The game's snapshot now; `null` without a game. */
    snapshot: () => unknown;
    stats: () => RuntimeStats;
    /**
     * One tick of `input`: `ctx.input` is updated from it before the systems'
     * `beforeStep`, and its actions and commands reach the game's
     * `beforeStep`. The array form (with `commands` beside it) is 0.x's.
     */
    step: (dtMs: number, input: InputAction[] | TickInput, commands?: readonly GameCommand[]) => StepResult;
    /**
     * Applies a new version of the loaded scene between ticks: reconcile when
     * the header is unchanged, else reload with capture and restore. Never
     * runs `onSwap`; the instance's live layer does.
     */
    swap: (next: ExpandedScene, opts: {
        prefabs: PrefabLibrary;
        strategy?: "auto" | "reload";
    }) => SwapReport;
    /**
     * The flow request and the save requests game code made since the last
     * call, emptied: the host applies them after the tick that made them.
     */
    takeRequests: () => RuntimeRequests;
    unload: () => void;
    /**
     * Replaces entities by id: the system's `update(e, prev)` fast path when it
     * has one, otherwise despawn then spawn. An id that isn't loaded is skipped
     * (a no-op), as is an entity equal to what's loaded. A type change despawns
     * from the old system and spawns in the new. Rejected and rolled back as `add` is.
     */
    update: (entities: RuntimeEntity[]) => ReconcileReport;
};
```

Refers to [`LoadReport`](#loadreport), [`PlayOptions`](#playoptions), [`RuntimeRequests`](#runtimerequests), [`RuntimeStats`](#runtimestats), [`StepResult`](#stepresult), [`SwapReport`](#swapreport), [`TickInput`](#tickinput).

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

Refers to [`AssetReloadError`](#assetreloaderror), [`ProjectRuntimeView`](#projectruntimeview), [`SceneRuntime`](#sceneruntime).

## `ScriptIssue`

_type_ in `headless/playtest-types.ts`

Why a script didn't compile: a JSON Pointer into it and one sentence, with a guess when there is one.

```ts
type ScriptIssue = {
    expected?: string;
    got?: string;
    hint?: string;
    message: string;
    path: string;
};
```

## `ScriptSource`

_type_ in `headless/compile-input-script.ts`

```ts
type ScriptSource = InputSource & {
    /** Every step that started: how it went, oldest end first; a step still running ends as `run`. */
    log(): ScriptStepLog[];
    tick(slot: number): TickInput;
};
```

Refers to [`ScriptStepLog`](#scriptsteplog), [`TickInput`](#tickinput).

## `ScriptStepLog`

_type_ in `headless/compile-input-script.ts`

How one step of a track went; `player` names the track for a script with `tracks`.

```ts
type ScriptStepLog = PlaytestStep & {
    player?: number;
};
```

Refers to [`PlaytestStep`](#playteststep).

## `SeatChange`

_type_ in `input/stream.ts`

A seat taking or leaving a device this tick.

```ts
type SeatChange = {
    device: DeviceId;
    joined: boolean;
    player: number;
};
```

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

## `SnapshotError`

_class_ in `project/snapshot.ts`

A snapshot that can't give what was asked of it, with the issues why.

```ts
declare class SnapshotError extends Error {
    readonly issues: SceneIssue[];
    constructor(issues: SceneIssue[]);
}
```

## `SnapshotLoadInput`

_type_ in `headless/load.ts`

A scene pinned by a project snapshot, its texts read from `store`.

```ts
type SnapshotLoadInput = LoadCommon & {
    /** The scene's asset id. */
    scene: AssetId;
    snapshot: ProjectSnapshot;
    store: ContentStore;
};
```

Refers to [`ProjectSnapshot`](#projectsnapshot).

## `StepDuration`

_type_ in `headless/playtest-types.ts`

How long a step runs: `for` ticks, `forMs` milliseconds (rounded to ticks at
the run's rate), or `until`, capped by `max` ticks. Lengths count input
slots, which an idle turns or event game skips without simulating.

```ts
type StepDuration = {
    for?: number;
    forMs?: number;
    /** With `until`: give up after this many ticks and move on (default 600). */
    max?: number;
    until?: UntilClause;
};
```

Refers to [`UntilClause`](#untilclause).

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

## `StreamTables`

_type_ in `input/stream.ts`

The names a stream's events index into.

```ts
type StreamTables = {
    actions: readonly string[];
    commands: readonly string[];
};
```

## `SwapCheckOptions`

_type_ in `headless/swap-check.ts`

```ts
type SwapCheckOptions = {
    /** Ticks to step after each swap; default `LIVE_DEFAULTS.checkTicks`. */
    afterTicks?: number;
    /** Fractions of each script's run to swap at; default `LIVE_DEFAULTS.checkAt`. */
    at?: readonly number[];
    /** The scene's checks file, run once against `to`; the report's `checks`. */
    checks?: {
        file: ChecksFile;
        readFile: (path: string) => string;
    };
    /** The version players have now: a staged version, or the release's scene (def and prefabs). */
    from: StagedVersion | {
        def: SceneDefinition;
        prefabs: PrefabLibrary;
    };
    game: GameDefinition;
    project?: ProjectRuntimeView | null;
    /** Needed when either version's scene runs on Rapier. */
    rapier?: RapierModule | null;
    /** Built from `game` when omitted. */
    registry?: Registry;
    /** The scene's input scripts, each named as the report names its runs. */
    scripts: readonly {
        name: string;
        script: InputScript | InputScriptV2;
    }[];
    to: StagedVersion;
};
```

Refers to [`InputScript`](#inputscript), [`InputScriptV2`](#inputscriptv2), [`ProjectRuntimeView`](#projectruntimeview), [`RapierModule`](#rapiermodule).

## `SwapCheckReport`

_type_ in `headless/swap-check.ts`

```ts
type SwapCheckReport = {
    /** `checks` run against `to`, when given. */
    checks?: ChecksReport;
    /** What kept a version or a script from being played at all, the script's name leading the message. */
    issues: readonly SceneIssue[];
    /** No error among the runs' issues and `issues`, and every check passed. */
    ok: boolean;
    runs: readonly SwapCheckRun[];
};
```

Refers to [`ChecksReport`](#checksreport), [`SwapCheckRun`](#swapcheckrun).

## `SwapCheckRun`

_type_ in `headless/swap-check.ts`

```ts
type SwapCheckRun = {
    /** The fraction of the run asked for. */
    at: number;
    issues: readonly SceneIssue[];
    script: string;
    /** What the swap did, or would have done when it failed. */
    strategy: SwapStrategy;
    /** The tick the swap ran before: `round(at · N)` of the run's N ticks, at most its last. */
    tick: number;
};
```

## `SwapReport`

_type_ in `runtime/types.ts`

What `SceneRuntime.swap` did; `undo()` puts the old version back.

```ts
type SwapReport = {
    carried: SceneSwap["carried"];
    diff: SceneDiff;
    ok: true;
    strategy: SwapStrategy;
    undo(): void;
} | {
    issue: SceneIssue;
    ok: false;
};
```

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

## `TickInput`

_type_ in `input/stream.ts`

One tick's input, merged system first, then seats in order.

```ts
type TickInput = {
    actions: InputAction[];
    commands: GameCommand[];
    joins: SeatChange[];
    /** Per seat; undefined when unchanged this tick. */
    pointers: (PointerState | undefined)[];
    tick: number;
};
```

Refers to [`SeatChange`](#seatchange).

## `TimingBucket`

_type_ in `runtime/timing.ts`

One timed thing: how often it ran, how long in all, and the most it took within one span.

```ts
type TimingBucket = {
    calls: number;
    maxMs: number;
    totalMs: number;
};
```

## `TimingReport`

_type_ in `runtime/timing.ts`

Where a run's wall time went. `tick` is the runtime's step. The browser
shell adds `shell` (its whole tick, the runtime's step being part `step`),
`frame` (what it does each rendered frame before the draw) and `draw`
(Pixi's render call on the CPU; the GPU's own time isn't in it). Wall
time: two runs never report the same numbers.

```ts
type TimingReport = {
    draw?: TimingSpan;
    frame?: TimingSpan;
    shell?: TimingSpan;
    tick: TimingSpan;
};
```

Refers to [`TimingSpan`](#timingspan).

## `TimingScope`

_type_ in `runtime/timing.ts`

One kind of span being timed: `begin`, a `lap` after each part, `end`.

```ts
type TimingScope = {
    /** Opens a span; false, timing nothing, while the collector is off. */
    begin(): boolean;
    /** Closes the span. One a throw left open is dropped by the next `begin`. */
    end(): void;
    /** Credits the time since `begin` or the last `lap` to `part`; nothing outside a span. */
    lap(part: string): void;
};
```

## `TimingSpan`

_type_ in `runtime/timing.ts`

One kind of span (a tick, a frame) over a run: `calls` spans, their total
and the longest, the named parts each span was split into, and
`unattributedMs`, the total less the parts: what no part covers, the
clock's own cost included. A part's `calls` counts every time it ran, and
its `maxMs` is the most it took in one span.

```ts
type TimingSpan = TimingBucket & {
    /** In the order the parts first ran; a part that never ran is left out. */
    parts: Record<string, TimingBucket>;
    unattributedMs: number;
};
```

Refers to [`TimingBucket`](#timingbucket).

## `UntilClause`

_type_ in `headless/playtest-types.ts`

When a step ends early: every key must hold (AND). `event`, `tick` (an
absolute tick, reached or passed), `exists`, `count`, `near`, `scene` and
`persist` are the engine's; the rest are the game's `play.predicates`.

```ts
type UntilClause = {
    [predicate: string]: unknown;
    /** The number of entities matching a selector keeps `min`, `max` or `eq`. */
    count?: CountMatch;
    event?: EventMatch;
    /** True while the entity exists and is enabled; `{ id, enabled: false }` while it exists at all. */
    exists?: ExistsMatch;
    /** The entity's pose is within `within` metres of a point or another entity's pose. */
    near?: NearMatch;
    persist?: PersistMatch;
    /** Holds once the main scene is this scene. */
    scene?: AssetId;
    tick?: number;
};
```

Refers to [`EventMatch`](#eventmatch), [`PersistMatch`](#persistmatch).

## `ValidatePhysicalOptions`

_type_ in `headless/validate-physical.ts`

```ts
type ValidatePhysicalOptions = PhysicalOptions & {
    /** The project's `engine` block, which the scene's settings resolve through. */
    engine?: Readonly<Record<string, unknown>>;
    /** The prefabs the scene's instances name; the game's `ctx.instantiate` places from them too. */
    prefabs?: PrefabLibrary;
    /** Needed for a scene that runs on Rapier; without one such a scene throws `PhysicsRequiredError`. */
    rapier?: RapierModule | null;
    registry: Registry;
    scene: SceneDefinition;
};
```

Refers to [`PhysicalOptions`](#physicaloptions), [`RapierModule`](#rapiermodule).

## `analogActions`

_function_ in `headless/compile-input-script.ts`

The actions that move a seat's values from `prev` to `next` at `tick`:
one returning to 0 for each value `next` drops, in `prev`'s order, then
one for each value `next` changes or adds, in its order. Pressed means
not 0.

```ts
declare function analogActions(prev: AnalogValues, next: AnalogValues, tick: number, player?: number, time?: Pick<ResolvedTime, "tickMs">): InputAction[];
```

Refers to [`AnalogValues`](#analogvalues).

## `analogValues`

_function_ in `headless/compile-input-script.ts`

`set`'s values as the runtime takes them: axis numbers and vector pairs quantised.

```ts
declare function analogValues(set: AnalogSet): AnalogValues;
```

Refers to [`AnalogValues`](#analogvalues).

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

Refers to [`AssetInfo`](#assetinfo).

## `captureSave`

_function_ in `runtime/save-state.ts`

A save of `runtime` at `opts.depth`, taken between ticks. `progress`
holds the scene, its sublevels, `persist` and the game's `snapshot()`;
`world` adds everything the run needs to continue exactly, and is
refused as `save-unsupported` with every cause `worldSaveBlockers`
names. `meta.savedAt` is the host's `now`, never read by the run.

```ts
declare function captureSave(runtime: SceneRuntimeHandle, opts: {
    depth: SaveDepth;
    now: number;
    slot: string;
    title?: string;
}): {
    file: SaveFile;
    ok: true;
} | {
    issue: SceneIssue;
    ok: false;
};
```

Refers to [`SceneRuntimeHandle`](#sceneruntimehandle).

## `compileInputScript`

_function_ in `headless/compile-input-script.ts`

Checks an input script against `registry`'s game (its actions and their
kinds, commands, `until` predicates, play options and seats) and resolves
every step to ticks at `time`'s rate, by default the game's own. Its
tracks drive the seats `players` (the project input map's) gives, else
the game's, unless the script sets its own `players`. A pointer step's
buttons hold the actions bound to them, the project input map's
(`map`) over the game's, as live play does. Issues
carry JSON Pointers into the script; an unknown action, command or key
gets a "did you mean". A v1 script compiles as written, as the v2 subset
it is: lengths in a script handed here are metres in either version, and
reading a v1 file (`parseInputScript`) is what migrates its px.

```ts
declare function compileInputScript(script: unknown, registry: Registry, time?: Pick<ResolvedTime, "rate">, players?: PlayersDef | null, map?: Pick<InputMapFile, "actions"> | null): CompileResult;
```

Refers to [`CompileResult`](#compileresult).

## `compiledPointer`

_function_ in `headless/compile-input-script.ts`

A script or macro pointer as it plays.

```ts
declare function compiledPointer(pointer: ScriptPointer): CompiledPointer;
```

Refers to [`CompiledPointer`](#compiledpointer).

## `createHeadlessRuntime`

_function_ in `headless/headless.ts`

A runtime with no view: nothing is drawn and nothing touches the DOM. Its
persistent value lasts as long as it does, across every `load`, unless
`persist` hands it one that outlives it. With `flow`, a flow request is
applied after the `step` that made it, with no transition and no wall
time (`applyFlowRequest`; a refused one throws), and `scene` loads as the
library's id for it, while save requests still wait in `takeRequests` for
the caller (taken after the scene changed, so a save of one made in the
tick that left a scene holds the next); without, every request waits there.
With `fromSave` it starts where the save left off (`restoreSave`): its
scene from `flow`, else `scene`, which must be the save's; a save that
can't be restored throws. `save` captures it as `captureSave` does.
`live` stages versions and swaps them in after the step their timing
waits for (after its flow request), and a flow load of a scene uses the
version active for it.

```ts
declare function createHeadlessRuntime(opts: HeadlessRuntimeOptions & ProjectOption & RuntimeShareOptions): HeadlessRuntime & {
    live: HeadlessLive;
    save: NonNullable<HeadlessRuntime["save"]>;
};
```

Refers to [`HeadlessLive`](#headlesslive), [`HeadlessRuntime`](#headlessruntime), [`HeadlessRuntimeOptions`](#headlessruntimeoptions).

## `createPersistCell`

_function_ in `runtime/persist.ts`

One persistent value: deep-frozen, the same object until `set`, back to
`initial()` on `reset`. `initial` is read when the value is first needed,
so a game's code sees any problem with it inside a step.

```ts
declare function createPersistCell(initial: () => JsonValue, opts?: PersistCellOptions): PersistCell;
```

Refers to [`PersistCell`](#persistcell), [`PersistCellOptions`](#persistcelloptions).

## `createRunRecorder`

_function_ in `runtime/recorder.ts`

Records a run in the current format: each tick's input through
`encodeTick`, a seat's pointer only when it changed since the last one
written, and every seed, the default one when the run named none.

```ts
declare function createRunRecorder(opts: RecorderOptions): RunRecorder;
```

Refers to [`RecorderOptions`](#recorderoptions), [`RunRecorder`](#runrecorder).

## `createRunTiming`

_function_ in `runtime/timing.ts`

A collector on `now`, a millisecond clock such as `performance.now`; it starts enabled.

```ts
declare function createRunTiming(now: () => number): RunTiming;
```

Refers to [`RunTiming`](#runtiming).

## `decodeStreams`

_function_ in `input/stream.ts`

A recording's streams as one `TickInput` per tick that has input, in tick
order. A tick's input is merged system first (seat changes and
`@elapsed`), then seats in order, each in stream order; the seat shows as
`player` from seat 1 on. Commands' args are copies, so a replay can't
change the recording. A malformed event throws, naming where it is.

```ts
declare function decodeStreams(rec: RecordingStream, opts?: DecodeOptions): Map<number, TickInput>;
```

Refers to [`DecodeOptions`](#decodeoptions), [`RecordingStream`](#recordingstream), [`TickInput`](#tickinput).

## `defaultFuzzMacro`

_function_ in `headless/fuzz.ts`

The macro fuzz uses when the game has none: one or two distinct button
actions held for 4–60 ticks (not the analog or pointer-bound ones
`inputs` names). With `inputs`' axis or vector actions, most
macros also set one of them to a random value; with pointer buttons, half
of them move the pointer to a random point in `bounds`, and half of those
click or drag a bound button (pressed on the first tick, released on the
last). Without analog actions or pointer buttons it draws exactly as it
does with no `inputs`, so a button-only game's rollouts stay the same.

```ts
declare function defaultFuzzMacro(rng: MacroRandom, actions: readonly string[], inputs?: FuzzMacroInputs): Macro;
```

Refers to [`FuzzMacroInputs`](#fuzzmacroinputs).

## `defaultSeed`

_function_ in `runtime/seed.ts`

`seedFromString("<gameId or engine>:<sceneName>")`: the seed of every run that names none.

```ts
declare function defaultSeed(gameId: null | string, sceneName: string): number;
```

## `fuzz`

_function_ in `headless/fuzz.ts`

Seeded random rollouts of a scene: each starts the way the editor's Play
does and plays macros (the game's `play.macro`, else `defaultFuzzMacro`,
which also sets the game's axis and vector actions and moves and clicks
the pointer when an action is bound to it; a macro's `set` and `pointer`
drive seat 0; a game's macro gets the actions without the UI-only ones and
fails the run if it holds or sets one, `simActionError`) drawn from `@jams/engine/sim-kit`'s
`Rng`. A game that lists its commands and has no macro of its own gets
command macros: one slot sending one of `legalCommands` (nothing when it
is empty), every macro for a `turns` game and half of them otherwise,
counted in `legal`. Rollouts run until the game's outcome,
`stuck` or `ticks` slots (an idle turns or event game skips slots, so its
rollouts still end). Reports which scene entities the rollouts' events
named (never a runtime `#` id), how many rollouts reached each and how
early, the ones never touched, and how the rollouts ended. Rollout `i` draws from its own fork of the seed,
so the first rollouts of a longer fuzz are the same as a shorter one's.
With `fromSave` every rollout starts where that save left off.

```ts
declare function fuzz<S = unknown, G = unknown>(opts: FuzzOptions<S, G>): FuzzRun;
```

Refers to [`FuzzOptions`](#fuzzoptions), [`FuzzRun`](#fuzzrun).

## `gamePersistCell`

_function_ in `runtime/persist.ts`

The cell for `game`'s `persist`; a game that declares none gets one holding null.

```ts
declare function gamePersistCell(game: GameDefinition | null | undefined, check: boolean): PersistCell;
```

Refers to [`PersistCell`](#persistcell).

## `heldEdges`

_function_ in `headless/compile-input-script.ts`

The edges that turn held set `prev` into `next` at `tick`: releases first,
in `prev`'s order, then presses in `next`'s.

```ts
declare function heldEdges(prev: readonly string[], next: readonly string[], tick: number): InputEdge[];
```

Refers to [`InputEdge`](#inputedge).

## `loadHeadless`

_function_ in `headless/load.ts`

Loads a scene for a headless run by snapshot (`snapshotScene`, which
pins the snapshot's materials too) or by files. Neither fetches or decodes a blob: what a run needs of one is its
entry's meta. Throws a `SnapshotError` for a snapshot that can't give the
scene or its project data, and a `SceneParseError` for a file that
doesn't parse; validation is the run's, as Play does it. With `fromSave`
the result carries the save, read and checked against the scene.

```ts
declare function loadHeadless(input: HeadlessLoadInput, opts?: HeadlessLoadOptions): Promise<HeadlessLoad>;
```

Refers to [`HeadlessLoad`](#headlessload), [`HeadlessLoadInput`](#headlessloadinput), [`HeadlessLoadOptions`](#headlessloadoptions).

## `memorySaveStore`

_function_ in `saves/store.ts`

Saves held in this process; what headless runs use.

```ts
declare function memorySaveStore(): SaveStore;
```

## `mergeTick`

_function_ in `input/stream.ts`

A tick's input in the order a replay feeds it: seat changes and
`@elapsed` first, then each seat's actions and commands in seat order,
each seat's in the order given. Live paths step this, so a run and its
replay see the same order.

```ts
declare function mergeTick(input: TickInput): TickInput;
```

Refers to [`TickInput`](#tickinput).

## `parseRecording`

_function_ in `scene/recording-schema.ts`

Parses a recording from JSON text or a parsed value, v1 or v2; a v1 file
is migrated (`migratedFrom: 1`), its time kind and px per metre taken
from `registry` when given. Never throws.

```ts
declare function parseRecording(input: unknown, registry?: RecordingRegistry): ParseRecordingResult;
```

Refers to [`ParseRecordingResult`](#parserecordingresult).

## `physicalEnv`

_function_ in `headless/validate-physical.ts`

Shape queries over a loaded runtime's world: the editor's edit world or a
headless one, never stepped, on Rapier or the geometry backend. Null when
nothing is loaded. Queries go through `ctx.space`, where touching isn't
overlapping.

```ts
declare function physicalEnv(runtime: SceneRuntimeHandle, def: SceneDefinition): PhysicalEnv | null;
```

Refers to [`PhysicalEnv`](#physicalenv), [`SceneRuntimeHandle`](#sceneruntimehandle).

## `plainJsonProblem`

_function_ in `runtime/persist.ts`

Where `value` stops being plain JSON, as "<path>: <why>", or null when it is.

```ts
declare function plainJsonProblem(value: unknown): null | string;
```

## `platformIssues`

_function_ in `headless/recording.ts`

`recording-other-platform` when a Rapier recording made on a known
architecture is replayed on another, unless `acrossPlatforms`
(`REPLAY_ACROSS_PLATFORMS`) says Rapier replays identically across them.
An `unknown` architecture on either side never warns.

```ts
declare function platformIssues(recording: Pick<RunRecording, "engine" | "platform">, here: Pick<RecordingPlatform, "arch">, acrossPlatforms?: boolean): SceneIssue[];
```

Refers to [`RecordingPlatform`](#recordingplatform), [`RunRecording`](#runrecording).

## `playWorld`

_function_ in `runtime/play-session.ts`

What `PlayState.world` answers, read live from `ctx`: an entity exists
while it is enabled unless asked with `enabled: false`, counts and
selections go through the query index, and the grid and project are
whatever `ctx` holds at the time of the read.

```ts
declare function playWorld(ctx: Pick<EngineContext, "enabled" | "exists" | "get" | "grid" | "poses" | "project" | "query">): PlayWorld;
```

## `pointerAt`

_function_ in `headless/compile-input-script.ts`

The pointer on slot `k` of a pointer step `slots` long, from `buttons`
(what was down before the slot): at `at`, or along the line to `drag`,
reaching it on the last slot; `press` goes down on the first slot and
`release` up on the last. `slots` is undefined for an `until` step, which
stays at `at`.

```ts
declare function pointerAt(pointer: CompiledPointer, k: number, slots: number | undefined, buttons: number): PointerState;
```

Refers to [`CompiledPointer`](#compiledpointer).

## `pointerHeld`

_function_ in `headless/compile-input-script.ts`

The button actions a seat holds, in a script and in fuzz: its `hold`, then each action a
pointer button in `buttons` holds through `bound`, combined as live play
combines an action's bindings (`combineAction`).

```ts
declare function pointerHeld(hold: readonly string[], buttons: number, bound: PointerBindings | undefined): readonly string[];
```

Refers to [`PointerBindings`](#pointerbindings).

## `preparePlay`

_function_ in `runtime/play-session.ts`

The first half of Play, shared by the shell, `runPlaytest` and `fuzz`:
parse and validate the document (any error blocks and is returned), clone
it so nothing played can reach the document, expand it with its prefabs
for a fresh runtime, and in dev freeze both, so a system that writes to
its definition throws. `hash` covers the prefabs the scene uses; `runHash`
covers what the run runs, computed once here.

```ts
declare function preparePlay(doc: SceneDefinition, registry: Registry, opts?: {
    dev?: boolean;
    /** The project's `engine` block, when there is no `project`. */
    engine?: Readonly<Record<string, unknown>>;
    /** Every prefab the run's `ctx.instantiate` may place; default `prefabs`. */
    library?: PrefabLibrary;
    prefabs?: PrefabLibrary;
    /** The project's data the run reads; its `engine` block resolves the settings and the clock. */
    project?: ProjectRuntimeView | null;
}): PreparedPlay;
```

Refers to [`PreparedPlay`](#preparedplay), [`ProjectRuntimeView`](#projectruntimeview).

## `probeConfigHash`

_function_ in `runtime/recorder.ts`

Hashes what a run's outcome depends on besides the scene, so a report or
recording from another engine version, tick rate or game tuning can be told
apart. `time` is the run's clock; omitted, the game's own.

```ts
declare function probeConfigHash(game?: GameDefinition | null, time?: Pick<ResolvedTime, "rate">): string;
```

## `recordedSwap`

_function_ in `runtime/recorder.ts`

An applied swap as a recording holds it: the version and hashes it swapped to, its strategy, timing and tick.

```ts
declare function recordedSwap(swap: SceneSwap): RecordedSwap;
```

## `recordingDivergence`

_function_ in `headless/recording.ts`

The first way `b` differs from `a`, or null when it ends the same way.

```ts
declare function recordingDivergence(a: RunRecording, b: RunRecording): null | string;
```

Refers to [`RunRecording`](#runrecording).

## `replayRecording`

_function_ in `headless/recording.ts`

Replays a recording headless: the play world starts as it did (its start,
seed, persistent value and flow entry) and every recorded tick's input,
read by `decodeStreams`, is stepped on its tick, every tick simulated
whatever the time model. The run ends where the recording did (its
outcome, its last tick, or the flow request at its `next`, which it
never follows), so a deterministic replay matches it exactly. One that
began from a save starts from the fixture `saves` holds under its hash
(`recordedSave`). A recording of an earlier format
migrates on read; a stale run, other tuning or another platform is a
warning, not a block.

```ts
declare function replayRecording<S = unknown>(opts: ReplayOptions<S>): ReplayRun<S>;
```

Refers to [`ReplayOptions`](#replayoptions), [`ReplayRun`](#replayrun).

## `restoreSave`

_function_ in `runtime/save-state.ts`

Loads `file`'s scene into `runtime` fresh, through the entry it was
reached by, and puts back what it saved, between ticks. The save's
`persist` is judged by `persistProblem` against the game's schema first,
in production too; a game that declares no persist takes only null. Progress depth: the fresh load, the game's `restore`
with the saved data, then `persist` and the play clock. World depth puts
the world back between the load and the game's `restore` (sublevels,
spawns, destroys, counters, enabled flags, the tick, poses and each
owner's state, timers, `ctx.random` and its forks, seats), raising no
event. A scene whose run hash changed since the save loads with an info
issue; a refused step leaves the scene freshly loaded.

```ts
declare function restoreSave(runtime: SceneRuntimeHandle, file: SaveFile): {
    issue: SceneIssue;
    ok: false;
} | {
    issues: SceneIssue[];
    ok: true;
    report: Extract<LoadReport, {
        ok: true;
    }>;
};
```

Refers to [`LoadReport`](#loadreport), [`SceneRuntimeHandle`](#sceneruntimehandle).

## `runBlocked`

_function_ in `headless/play-loop.ts`

A run that an `EngineError` thrown out of a step ended: blocked at `run`,
with the scene's issues and the error as an issue carrying its code. Null
for any other error, which the caller rethrows.

```ts
declare function runBlocked(err: unknown, scene: string, issues: SceneIssue[], registry: Registry): PlaytestBlocked | null;
```

Refers to [`PlaytestBlocked`](#playtestblocked).

## `runChecks`

_function_ in `headless/run-checks.ts`

Runs a scene's checks in order: the engine's kinds through
`validateScene`/`validatePhysical`, `runPlaytest`, `fuzz` and `findPath`
over the scene's grid, a game's through its `checks`. A check that throws fails with the error.

```ts
declare function runChecks(opts: RunChecksOptions): ChecksReport;
```

Refers to [`ChecksReport`](#checksreport), [`RunChecksOptions`](#runchecksoptions).

## `runPhysicalChecks`

_function_ in `headless/validate-physical.ts`

The engine's physical checks (`follower-hits-solid`, `solid-overlap`),
then the registry's `physicalChecks`, in document order of their `path`.
All of them run on either backend, except a game check with
`needsPhysics`, which a scene without physics skips with an info issue.

```ts
declare function runPhysicalChecks(env: PhysicalEnv, opts?: PhysicalOptions): SceneIssue[];
```

Refers to [`PhysicalEnv`](#physicalenv), [`PhysicalOptions`](#physicaloptions).

## `runPlaytest`

_function_ in `headless/playtest.ts`

Plays an input script on a scene headless, starting the run the way the
editor's Play does (validation errors block, the document is cloned and
expanded, `at` is cast with the game's spawn shape), and reports how it
ended: the game's outcome, else `stuck`, `script-end` or `timeout`. Its
tracks drive the seats the run has, the project input map's over the
game's (`scriptSeatLimit`). A game that lists its commands gets `legal`
after the last tick, else at the start (`legalCommands`), as `runProbe`
does. A flow request game code makes ends the run as `flow`; with
`flow`, the run follows it instead: after the tick the next listed scene
loads in a fresh runtime (persist carried, the request's `persist` and
`entry` applied, the keys still held pressed again) and the same script
goes on, each scene recorded on its own in `segments`. With `fromSave`
the first scene starts where the save left off. Deterministic: the same
scenes, game, save and script give the same report.

```ts
declare function runPlaytest<S = unknown, G = unknown>(opts: PlaytestOptions<S, G> & PlaytestStart & PlaytestHooks & RecordingHost): PlaytestRun<S>;
```

Refers to [`PlaytestHooks`](#playtesthooks), [`PlaytestOptions`](#playtestoptions), [`PlaytestRun`](#playtestrun), [`PlaytestStart`](#playteststart), [`RecordingHost`](#recordinghost).

## `runProbe`

_function_ in `headless/headless.ts`

Load `scene`, play scripted input for `ticks` ticks on the runtime's clock,
and report what happened. Every tick is simulated whatever the time model,
as the shell's `step(n)` does. An `EngineError` out of a step ends the run
as `runPlaytest`'s does: `blocked` at stage `run` with the error's code,
the report covering the ticks before it. A game that lists its commands
gets `legal` after the last tick, else at the start (`legalCommands`), as
`runPlaytest` does; a blocked run has none. A UI-only action in `hold` or
`inputs` is refused (`simActionError`).

```ts
declare function runProbe<S = unknown>(opts: ProbeOptions<S> & LibraryOption): ProbeReport<S>;
```

Refers to [`ProbeOptions`](#probeoptions), [`ProbeReport`](#probereport).

## `scriptSource`

_function_ in `headless/compile-input-script.ts`

Plays a compiled script one slot at a time: every track from slot 0 at
once, each `TickInput` holding each seat's button edges (releases first),
analog values, pointer (only when it changed), seat changes and commands,
all on its step's first slot but the pointer. The actions bound to a
pointer button are held while it is down, as in live play. A step's length counts
slots, so an idle turns or event game still moves through it; `until` is
judged by `holds` after each simulated tick. The input runs out
(`script-end`) once every track's steps have; nothing is released then.
A track that ends before the others likewise keeps what its last step
held (buttons, values, pointer) until the script ends: end it on a
`wait` to let go, and on a pointer `release` for a pointer button.
A script written with `steps` plays as seat 0's one track.

```ts
declare function scriptSource(script: CompiledInputScript, holds: (until: UntilClause, state: PlayState) => boolean, time?: Pick<ResolvedTime, "tickMs">): ScriptSource;
```

Refers to [`CompiledInputScript`](#compiledinputscript), [`ScriptSource`](#scriptsource), [`UntilClause`](#untilclause).

## `simActionError`

_function_ in `headless/headless.ts`

The error for an action that scripted input can't drive, or null: one the
game doesn't declare (`unknownActionError`), or a UI-only one
(`uiActionScriptProblem`, `binding-unknown`). The one check every headless
input path (probe, step, fuzz macro, input script) applies.

```ts
declare function simActionError(registry: Registry, action: string): null | string;
```

## `swapCheck`

_function_ in `headless/swap-check.ts`

Plays each script on `from`, swaps `to` in at each fraction of its run
through the live layer's own apply path (timing `now`, strategy auto),
steps `afterTicks` more, and runs the game's `live.check` right after the
swap and 60 ticks later. A swap that fails (`onSwap` threw, or a swap step
refused) and a step that throws after it are issues; `checks` runs once
against `to`. Deterministic, as playtests are.

```ts
declare function swapCheck(opts: SwapCheckOptions): SwapCheckReport;
```

Refers to [`SwapCheckOptions`](#swapcheckoptions), [`SwapCheckReport`](#swapcheckreport).

## `tickWakes`

_function_ in `headless/play-loop.ts`

Whether a slot's input wakes an idle game on `time`'s clock, by the rule
the shell's gate uses: a command wakes every model; an event game also
wakes on any action (a button edge or an analog change), a pointer whose
buttons differ from `pointers`' last (the pointer each seat last had),
and a pointer move only with `wakeOnPointerMove`. Seat changes wake
nothing; they ride the next simulated tick. A fixed clock never idles.

```ts
declare function tickWakes(time: Pick<ResolvedTime, "kind" | "wakeOnPointerMove">, input: Pick<TickInput, "actions" | "commands" | "pointers">, pointers?: readonly (PointerState | null | undefined)[]): boolean;
```

Refers to [`TickInput`](#tickinput).

## `unknownActionError`

_function_ in `headless/headless.ts`

The probe's error for an action name the game doesn't declare, or null.

```ts
declare function unknownActionError(action: string, actionNames: readonly string[]): null | string;
```

## `untilHolds`

_function_ in `headless/playtest.ts`

Whether every key of `until` holds on `state` (AND): the engine's `event`,
`tick`, `exists`, `count`, `near`, `scene` (the main scene is `scene`, the run's
listed id for it; never without one) and `persist`, then `registry`'s
game predicates. A key no predicate answers doesn't hold. `reaches` checks
judge `expect` with it too.

```ts
declare function untilHolds(until: UntilClause, state: PlayState, registry: Registry, scene?: AssetId | null): boolean;
```

Refers to [`UntilClause`](#untilclause).

## `validatePhysical`

_function_ in `headless/validate-physical.ts`

Loads `scene` into a headless world that is never stepped and runs the
physical checks over it: on Rapier, or on the geometry backend when the
scene runs without physics. The checks see the resolved view (instances
inlined, groups applied); their issues come back pointing into the
document, with fixes mapped onto it. A scene for another game, or one
that doesn't expand or load, has none: `validateScene` reports why.

```ts
declare function validatePhysical(opts: ValidatePhysicalOptions): SceneIssue[];
```

Refers to [`ValidatePhysicalOptions`](#validatephysicaloptions).

## `worldSaveBlockers`

_function_ in `runtime/save-state.ts`

Whether `runtime`'s world may be saved at depth `world`: every cause that
refuses it, none when it may. The main scene running on Rapier, a pending
function-form timer or coroutine (named by owner), or a game runtime
without `restore`. Every world save is judged by this one rule.

```ts
declare function worldSaveBlockers(runtime: SceneRuntimeHandle): SaveBlocker[];
```

Refers to [`SaveBlocker`](#saveblocker), [`SceneRuntimeHandle`](#sceneruntimehandle).
