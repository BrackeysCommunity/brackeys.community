# @jams/engine/debug

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`DEBUG_OFF`](#debug_off) · [`DebugDeps`](#debugdeps) · [`DebugFrame`](#debugframe) · [`DebugLayer`](#debuglayer) · [`DebugLayerFactory`](#debuglayerfactory) · [`DebugLayerHost`](#debuglayerhost) · [`DebugOverlay`](#debugoverlay) · [`DebugOverlayFactory`](#debugoverlayfactory) · [`DebugSceneSource`](#debugscenesource) · [`DebugTick`](#debugtick) · [`ENGINE_DEBUG_LAYERS`](#engine_debug_layers) · [`createDebugOverlay`](#createdebugoverlay) · [`debugModes`](#debugmodes)

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
};
```

Refers to [`DebugLayerFactory`](#debuglayerfactory), [`DebugLayerHost`](#debuglayerhost).

## `DebugFrame`

_type_ in `debug/index.ts`

What every visible layer gets each shell tick.

```ts
type DebugFrame = {
    dtMs: number;
    /** The game's `debugInfo()`; null without a scene or when the game supplies none. */
    info: unknown;
    /** World metres. */
    mouseWorld: Vec2;
    /** Canvas px per world metre, zoom included: a layer's line widths and labels divide screen px by it. */
    scale: number;
    /** The world bound by `setPhysics`; null without a scene. */
    scene: DebugSceneSource | null;
    /** World metres. */
    viewport: Viewport;
};
```

Refers to [`DebugSceneSource`](#debugscenesource).

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
};
```

Refers to [`DebugLayer`](#debuglayer), [`DebugLayerHost`](#debuglayerhost).

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

## `DebugOverlay`

_type_ in `debug/index.ts`

```ts
type DebugOverlay = {
    destroy: () => void;
    /** Binds the loaded scene's world; every layer reads it until the next call. */
    setPhysics: (source: DebugSceneSource | null) => void;
    update: (tick: DebugTick) => void;
};
```

Refers to [`DebugSceneSource`](#debugscenesource), [`DebugTick`](#debugtick).

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

## `ENGINE_DEBUG_LAYERS`

_const_ in `debug/index.ts`

The engine's layers, before the game's.

```ts
declare const ENGINE_DEBUG_LAYERS: readonly DebugLayerFactory[];
```

Refers to [`DebugLayerFactory`](#debuglayerfactory).

## `createDebugOverlay`

_function_ in `debug/index.ts`

Creates the debug overlay. Hosts only call it in dev builds.

```ts
declare function createDebugOverlay(deps: DebugDeps): DebugOverlay;
```

Refers to [`DebugDeps`](#debugdeps), [`DebugOverlay`](#debugoverlay).

## `debugModes`

_function_ in `debug/index.ts`

F3's cycle: `off`, then one mode per layer in order.

```ts
declare function debugModes(layers: readonly DebugLayerFactory[]): string[];
```

Refers to [`DebugLayerFactory`](#debuglayerfactory).
