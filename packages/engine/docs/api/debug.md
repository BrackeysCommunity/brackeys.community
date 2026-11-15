# @jams/engine/debug

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`DEBUG_DRAW_MAX`](#debug_draw_max) · [`DEBUG_OFF`](#debug_off) · [`DebugDeps`](#debugdeps) · [`DebugFrame`](#debugframe) · [`DebugLayer`](#debuglayer) · [`DebugLayerFactory`](#debuglayerfactory) · [`DebugLayerHost`](#debuglayerhost) · [`DebugNeeds`](#debugneeds) · [`DebugOverlay`](#debugoverlay) · [`DebugOverlayFactory`](#debugoverlayfactory) · [`DebugSceneSource`](#debugscenesource) · [`DebugTick`](#debugtick) · [`DebugTools`](#debugtools) · [`ENGINE_DEBUG_LAYERS`](#engine_debug_layers) · [`EVENT_LOG_CAPACITY`](#event_log_capacity) · [`EntityInspection`](#entityinspection) · [`EntityRow`](#entityrow) · [`EventLog`](#eventlog) · [`EventLogFilter`](#eventlogfilter) · [`EventLogWriter`](#eventlogwriter) · [`PERF_SLOWEST`](#perf_slowest) · [`PerfBar`](#perfbar) · [`PerfPlan`](#perfplan) · [`PerfRow`](#perfrow) · [`RuntimeTimings`](#runtimetimings) · [`TIMING_ATTRIBUTE`](#timing_attribute) · [`TIMING_STORAGE_KEY`](#timing_storage_key) · [`TickPhase`](#tickphase) · [`TimingStat`](#timingstat) · [`createDebugDrawSink`](#createdebugdrawsink) · [`createDebugOverlay`](#createdebugoverlay) · [`createEventLog`](#createeventlog) · [`debugDrawLayer`](#debugdrawlayer) · [`debugModes`](#debugmodes) · [`debugTools`](#debugtools-1) · [`inspectEntity`](#inspectentity) · [`listEntities`](#listentities) · [`perfLayer`](#perflayer) · [`perfLines`](#perflines) · [`perfPlan`](#perfplan-1) · [`pickEntity`](#pickentity)

## `DEBUG_DRAW_MAX`

_const_ in `debug/draw-sink.ts`

Draws past this many in one tick are dropped, so a runaway loop can't stall the frame.

```ts
declare const DEBUG_DRAW_MAX = 4096;
```

## `DEBUG_OFF`

_const_ in `debug/index.ts`

```ts
declare const DEBUG_OFF = "off";
```

## `DebugDeps`

_type_ in `debug/index.ts`

```ts
type DebugDeps = Omit<DebugLayerHost, "pxPerMetre"> & {
    /** The game's layers, shown after the engine's. */
    layers?: readonly DebugLayerFactory[];
    /** The game's px per metre; default 100. */
    pxPerMetre?: number;
    /** The shell's router; F3 registers on it above every tool. */
    router: ToolRouter;
    store: Store<GameStoreState>;
    /**
     * The shell's timing collector. With it, `localStorage["debug-timing"] =
     * "1"` switches timing on while the game runs (and off again when
     * removed), and the report is kept as JSON in a
     * `<script type="application/json" data-jams-timing>` on the page.
     */
    timing?: RunTiming;
};
```

Refers to [`DebugLayerFactory`](#debuglayerfactory), [`DebugLayerHost`](#debuglayerhost).

## `DebugFrame`

_type_ in `debug/index.ts`

What every visible layer gets each shell tick.

```ts
type DebugFrame = {
    /** The last tick's `ctx.debug` draws, while a shown layer needs them. */
    draws?: readonly DebugDrawCommand[];
    dtMs: number;
    /** The game's `debugInfo()`; null without a scene or when the game supplies none. */
    info: unknown;
    /** World metres. */
    mouseWorld: Vec2;
    /** Canvas px per world metre, zoom included: a layer's line widths and labels divide screen px by it. */
    scale: number;
    /** The world bound by `setPhysics`; null without a scene. */
    scene: DebugSceneSource | null;
    /** The store's `timings`, while a shown layer needs them. */
    timings?: RuntimeTimings | null;
    /** World metres. */
    viewport: Viewport;
};
```

Refers to [`DebugSceneSource`](#debugscenesource), [`RuntimeTimings`](#runtimetimings).

## `DebugLayer`

_type_ in `debug/index.ts`

```ts
type DebugLayer = {
    destroy: () => void;
    setVisible: (visible: boolean) => void;
    update: (frame: DebugFrame) => void;
};
```

Refers to [`DebugFrame`](#debugframe).

## `DebugLayerFactory`

_type_ in `debug/index.ts`

A debug layer, created the first time F3 reaches its mode. Its id is that
mode's name; each mode shows its own layer and every layer before it.

```ts
type DebugLayerFactory = {
    create: (host: DebugLayerHost) => DebugLayer;
    id: string;
    /** What the shell must collect while this layer shows. */
    needs?: DebugNeeds;
};
```

Refers to [`DebugLayer`](#debuglayer), [`DebugLayerHost`](#debuglayerhost), [`DebugNeeds`](#debugneeds).

## `DebugLayerHost`

_type_ in `debug/index.ts`

Where a layer adds its containers: the camera-affected world (world
metres), or the screen-fixed UI (canvas px). `pxPerMetre` is the game's.

```ts
type DebugLayerHost = {
    pxPerMetre: number;
    uiContainer: Container;
    worldContainer: Container;
};
```

## `DebugNeeds`

_type_ in `debug/index.ts`

`timings`: the runtime's timings in the store; `debugDraw`: game code's `ctx.debug` draws.

```ts
type DebugNeeds = {
    debugDraw?: boolean;
    timings?: boolean;
};
```

## `DebugOverlay`

_type_ in `debug/index.ts`

```ts
type DebugOverlay = {
    /** The sink the shown debug-draw layer reads; null while none shows. */
    debugDraw?: () => DebugDrawSink | null;
    destroy: () => void;
    /** What the shown layers need now. */
    needs?: () => DebugNeeds;
    /** Binds the loaded scene's world; every layer reads it until the next call. */
    setPhysics: (source: DebugSceneSource | null) => void;
    /** Live inspection and the event log, for `GameInstance.debug`. */
    tools?: DebugTools;
    update: (tick: DebugTick) => void;
};
```

Refers to [`DebugNeeds`](#debugneeds), [`DebugSceneSource`](#debugscenesource), [`DebugTick`](#debugtick), [`DebugTools`](#debugtools).

## `DebugOverlayFactory`

_type_ in `debug/index.ts`

```ts
type DebugOverlayFactory = (deps: DebugDeps) => DebugOverlay;
```

Refers to [`DebugDeps`](#debugdeps), [`DebugOverlay`](#debugoverlay).

## `DebugSceneSource`

_type_ in `debug/index.ts`

The loaded scene's world, as the physics wireframes and the grid read it.

```ts
type DebugSceneSource = Pick<EngineContext, "geometry" | "physics" | "registry" | "tags"> & Partial<Pick<EngineContext, "grid">>;
```

## `DebugTick`

_type_ in `debug/index.ts`

What the shell hands the overlay each tick; the overlay adds the bound scene.

```ts
type DebugTick = Omit<DebugFrame, "scene">;
```

Refers to [`DebugFrame`](#debugframe).

## `DebugTools`

_type_ in `debug/index.ts`

What a dev host's overlay lends `GameInstance.debug`. Every answer is
plain data, so the play world may later sit across a worker link.

```ts
type DebugTools = {
    createEventLog(): EventLogWriter;
    entities(runtime: SceneRuntimeHandle, sel?: EntitySelector): readonly EntityRow[];
    inspect(runtime: SceneRuntimeHandle, id: string): EntityInspection | null;
    pick(runtime: SceneRuntimeHandle, p: Vec2): null | string;
};
```

Refers to [`EntityInspection`](#entityinspection), [`EntityRow`](#entityrow), [`EventLogWriter`](#eventlogwriter).

## `ENGINE_DEBUG_LAYERS`

_const_ in `debug/index.ts`

The engine's layers, before the game's.

```ts
declare const ENGINE_DEBUG_LAYERS: readonly DebugLayerFactory[];
```

Refers to [`DebugLayerFactory`](#debuglayerfactory).

## `EVENT_LOG_CAPACITY`

_const_ in `debug/event-log.ts`

Events an event log keeps before it drops the oldest.

```ts
declare const EVENT_LOG_CAPACITY = 10000;
```

## `EntityInspection`

_type_ in `debug/inspect.ts`

Everything a debugger shows of one live entity: plain data, read-only.

```ts
type EntityInspection = {
    /** Each behavior's `inspect` that answers for it, by name. */
    behaviors: Readonly<Record<BehaviorName, JsonValue | undefined>>;
    /** Rapier: linear (metres per second) and angular velocity; other bodies: their own inspect. */
    body?: null | {
        angular: number;
        sleeping: boolean;
        velocity: Vec2;
    };
    /** Ids of what it touches now: watched contacts and what its sensors hold. */
    contacts: readonly string[];
    enabled: boolean;
    entity: RuntimeEntity;
    id: string;
    /** What game code made for it (a motion body, a grid stepper, a controller), by owner name. */
    owners?: Readonly<Record<string, JsonValue | undefined>>;
    /** World metres and radians. */
    pose: Pose | null;
    prevPose: Pose | null;
    /** The type system's `inspect`. */
    system: JsonValue | undefined;
    timers: readonly InspectedTimer[];
    type: EntityTypeName;
};
```

## `EntityRow`

_type_ in `debug/inspect.ts`

One row of the play outliner: `at` in world metres, null for an entity without a pose.

```ts
type EntityRow = {
    at: Vec2 | null;
    enabled: boolean;
    id: string;
    type: string;
};
```

## `EventLog`

_interface_ in `debug/event-log.ts`

The events of a run as they happened, each with its tick: plain data.

```ts
interface EventLog {
    /** Oldest first; at most `capacity` events. */
    list(opts?: EventLogFilter): readonly StepEvent[];
    readonly capacity: number;
    clear(): void;
    /**
     * Called with each tick's events as they happen, and with none when the
     * log is cleared; returns the unsubscribe.
     */
    subscribe(fn: (tick: number, events: readonly StepEvent[]) => void): () => void;
}
```

Refers to [`EventLogFilter`](#eventlogfilter).

## `EventLogFilter`

_type_ in `debug/event-log.ts`

```ts
type EventLogFilter = {
    /** Only events naming this entity, as `entityId` or `other`. */
    entity?: string;
    /** The newest this many of what matches. */
    limit?: number;
    /** Only events at or after this tick. */
    since?: number;
    types?: readonly string[];
};
```

## `EventLogWriter`

_type_ in `debug/event-log.ts`

The log the shell fills: `append` takes each step's events.

```ts
type EventLogWriter = EventLog & {
    append(tick: number, events: readonly StepEvent[]): void;
};
```

Refers to [`EventLog`](#eventlog).

## `PERF_SLOWEST`

_const_ in `debug/perf.ts`

Systems and behaviors listed, slowest first.

```ts
declare const PERF_SLOWEST = 5;
```

## `PerfBar`

_type_ in `debug/perf.ts`

```ts
type PerfBar = {
    max: number;
    maxFrac: number;
    mean: number;
    /** 0..1 of the scale */
    meanFrac: number;
    phase: TickPhase;
};
```

Refers to [`TickPhase`](#tickphase).

## `PerfPlan`

_type_ in `debug/perf.ts`

What the perf layer draws for one `RuntimeTimings`.

```ts
type PerfPlan = {
    bars: PerfBar[];
    behaviors: PerfRow[];
    /** The widest bar's ms: the slowest phase's max. */
    scaleMs: number;
    systems: PerfRow[];
    ticks: number;
};
```

Refers to [`PerfBar`](#perfbar), [`PerfRow`](#perfrow).

## `PerfRow`

_type_ in `debug/perf.ts`

```ts
type PerfRow = {
    max: number;
    mean: number;
    name: string;
};
```

## `RuntimeTimings`

_type_ in `runtime/timings.ts`

Where the last window's ticks went, wall-clock milliseconds. Never part of
state, a recording, a save or a digest: two runs never report the same.

```ts
type RuntimeTimings = {
    behaviors: Readonly<Record<BehaviorName, TimingStat>>;
    /** Shell only: render and the frame's presentation work. */
    frame?: {
        present: TimingStat;
        render: TimingStat;
    };
    /** Mean and worst ms per tick, per phase, over the window. */
    phases: Readonly<Record<TickPhase, TimingStat>>;
    systems: Readonly<Record<EntityTypeName, TimingStat>>;
    /** Ticks in the window these numbers cover. */
    ticks: number;
};
```

Refers to [`TickPhase`](#tickphase), [`TimingStat`](#timingstat).

## `TIMING_ATTRIBUTE`

_const_ in `debug/timing-readout.ts`

Marks the readout: a `<script type="application/json">` in the body whose text is the `TimingReport`.

```ts
declare const TIMING_ATTRIBUTE = "data-jams-timing";
```

## `TIMING_STORAGE_KEY`

_const_ in `debug/timing-readout.ts`

`localStorage` key: `"1"` switches timing on, anything else leaves it as the host set it.

```ts
declare const TIMING_STORAGE_KEY = "debug-timing";
```

## `TickPhase`

_type_ in `runtime/timings.ts`

```ts
type TickPhase = (typeof TICK_PHASES)[number];
```

## `TimingStat`

_type_ in `runtime/timings.ts`

Milliseconds per tick over a window: the mean and the worst.

```ts
type TimingStat = {
    max: number;
    mean: number;
};
```

## `createDebugDrawSink`

_function_ in `debug/draw-sink.ts`

A sink that keeps every draw of a tick for `take`; what headless
`collectDebugDraw` and the shell's debug-draw layer pass the runtime.
Each draw is copied into plain data, so game code may reuse its vectors.

```ts
declare function createDebugDrawSink(): DebugDrawSink;
```

## `createDebugOverlay`

_function_ in `debug/index.ts`

Creates the debug overlay. Hosts only call it in dev builds.

```ts
declare function createDebugOverlay(deps: DebugDeps): DebugOverlay;
```

Refers to [`DebugDeps`](#debugdeps), [`DebugOverlay`](#debugoverlay).

## `createEventLog`

_function_ in `debug/event-log.ts`

```ts
declare function createEventLog(opts?: {
    capacity?: number;
}): EventLogWriter;
```

Refers to [`EventLogWriter`](#eventlogwriter).

## `debugDrawLayer`

_const_ in `debug/draw.ts`

Game code's `ctx.debug` draws for the last tick, positions in world
metres and widths in screen px. Drawn in world px inside a container
scaled back to metres, like the physics wireframes.

```ts
declare const debugDrawLayer: DebugLayerFactory;
```

Refers to [`DebugLayerFactory`](#debuglayerfactory).

## `debugModes`

_function_ in `debug/index.ts`

F3's cycle: `off`, then one mode per layer in order.

```ts
declare function debugModes(layers: readonly DebugLayerFactory[]): string[];
```

Refers to [`DebugLayerFactory`](#debuglayerfactory).

## `debugTools`

_function_ in `debug/index.ts`

The engine's own inspection and event log.

```ts
declare function debugTools(): DebugTools;
```

Refers to [`DebugTools`](#debugtools).

## `inspectEntity`

_function_ in `debug/inspect.ts`

Everything a debugger shows of `id`, loaded or spawned, enabled or not; null for an id that isn't live.

```ts
declare function inspectEntity(runtime: SceneRuntimeHandle, id: string): EntityInspection | null;
```

Refers to [`EntityInspection`](#entityinspection).

## `listEntities`

_function_ in `debug/inspect.ts`

The entities `sel` selects, in spawn order. Without `sel`, every live
entity, disabled ones too; a selector keeps its own `enabled` default.

```ts
declare function listEntities(runtime: SceneRuntimeHandle, sel?: EntitySelector): readonly EntityRow[];
```

Refers to [`EntityRow`](#entityrow).

## `perfLayer`

_const_ in `debug/perf.ts`

The runtime's phases as bars, and the five slowest systems and behaviors, from `GameStoreState.timings`.

```ts
declare const perfLayer: DebugLayerFactory;
```

Refers to [`DebugLayerFactory`](#debuglayerfactory).

## `perfLines`

_function_ in `debug/perf.ts`

The plan's text lines, top to bottom; the bar rows line up with the first `TICK_PHASES.length` after the header.

```ts
declare function perfLines(plan: PerfPlan): string[];
```

Refers to [`PerfPlan`](#perfplan).

## `perfPlan`

_function_ in `debug/perf.ts`

The phases as bars scaled to the slowest phase's max, and the five slowest systems and behaviors by mean.

```ts
declare function perfPlan(timings: RuntimeTimings): PerfPlan;
```

Refers to [`PerfPlan`](#perfplan), [`RuntimeTimings`](#runtimetimings).

## `pickEntity`

_function_ in `debug/inspect.ts`

The topmost enabled entity whose extent contains `p` (world metres): the
highest draw layer, then the highest `z`, then the latest spawn. Camera
regions and editor-only layers never draw in play, so they aren't picked.
Null for none.

```ts
declare function pickEntity(runtime: SceneRuntimeHandle, p: Vec2): null | string;
```
