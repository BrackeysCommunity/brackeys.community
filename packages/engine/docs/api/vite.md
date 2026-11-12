# @jams/engine/vite

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`ASSET_CHANGED`](#asset_changed) · [`AssetChange`](#assetchange) · [`AssetChangedMessage`](#assetchangedmessage) · [`BlobRepair`](#blobrepair) · [`DEV_CACHE_ROOT`](#dev_cache_root) · [`DISK_ORIGIN`](#disk_origin) · [`DiskChange`](#diskchange) · [`DiskEvent`](#diskevent) · [`DiskSync`](#disksync) · [`EXPORT_ENTRY_ID`](#export_entry_id) · [`ExportBuildConfig`](#exportbuildconfig) · [`ExportBuildOptions`](#exportbuildoptions) · [`ExportPluginLike`](#exportpluginlike) · [`FileApplyOptions`](#fileapplyoptions) · [`FileProject`](#fileproject) · [`ListeningSceneCollab`](#listeningscenecollab) · [`MOVE_SETTLE_MS`](#move_settle_ms) · [`PERSISTED_ORIGIN`](#persisted_origin) · [`PROJECT_ROUTE`](#project_route) · [`PrefabFiles`](#prefabfiles) · [`ProjectDiskSync`](#projectdisksync) · [`ProjectFileAdapter`](#projectfileadapter) · [`ProjectFileAdapterOptions`](#projectfileadapteroptions) · [`ProjectProblem`](#projectproblem) · [`ProjectScan`](#projectscan) · [`ProjectSync`](#projectsync) · [`SCENE_COLLAB_PATH`](#scene_collab_path) · [`SCENE_NAME_PATTERN`](#scene_name_pattern) · [`SCENE_ROUTE`](#scene_route) · [`SceneCollab`](#scenecollab) · [`SceneCollabOptions`](#scenecollaboptions) · [`SceneCollabPlugin`](#scenecollabplugin) · [`ScenePathError`](#scenepatherror) · [`applyProjectBatchToFiles`](#applyprojectbatchtofiles) · [`codeModules`](#codemodules) · [`createExportBuild`](#createexportbuild) · [`createProjectFileAdapter`](#createprojectfileadapter) · [`createSceneCollab`](#createscenecollab) · [`defaultCacheDir`](#defaultcachedir) · [`exportEntrySource`](#exportentrysource) · [`fileContentStore`](#filecontentstore) · [`gameRegisters`](#gameregisters) · [`isCodePath`](#iscodepath) · [`listenSceneCollab`](#listenscenecollab) · [`pairDiskEvents`](#pairdiskevents) · [`prefabPath`](#prefabpath) · [`prefabsDirOf`](#prefabsdirof) · [`readFileProject`](#readfileproject) · [`readPrefabFiles`](#readprefabfiles) · [`readProjectPrefabFiles`](#readprojectprefabfiles) · [`resolveScenePath`](#resolvescenepath) · [`sceneCollabServer`](#scenecollabserver) · [`sceneNameOf`](#scenenameof) · [`snapshotFiles`](#snapshotfiles)

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

## `BlobRepair`

_type_ in `vite/project-files.ts`

A binary entry `repairBlobs` pointed back at bytes the store holds.

```ts
type BlobRepair = {
    from: Sha256;
    id: AssetId;
    key: AssetKey;
    to: Sha256;
};
```

## `DEV_CACHE_ROOT`

_const_ in `vite/content-store.ts`

Where the dev server keeps a project's cache, under the repo root: `node_modules/.cache/jams-engine/<project>`.

```ts
declare const DEV_CACHE_ROOT = "node_modules/.cache/jams-engine";
```

## `DISK_ORIGIN`

_const_ in `vite/project-files.ts`

The origin of every write the file adapter makes: seeding a doc and outside file changes.

```ts
declare const DISK_ORIGIN: SceneOrigin;
```

## `DiskChange`

_type_ in `vite/project-files.ts`

```ts
type DiskChange = {
    event: DiskEvent;
    type: "add";
} | {
    event: DiskEvent;
    type: "unlink";
} | {
    from: DiskEvent;
    to: DiskEvent;
    type: "move";
};
```

Refers to [`DiskEvent`](#diskevent).

## `DiskEvent`

_type_ in `vite/project-files.ts`

One raw add or unlink as `pairDiskEvents` sees it.

```ts
type DiskEvent = {
    /** When the watcher reported it, ms. */
    at: number;
    id?: AssetId;
    /** An unlink's registry key; an add's only when its sidecar names one. */
    key?: AssetKey;
    path: AssetPath;
    type: "add" | "unlink";
};
```

## `DiskSync`

_type_ in `vite/project-files.ts`

What a file change did to a doc.

```ts
type DiskSync = {
    issues?: SceneIssue[];
    kind: "refused";
    reason: string;
} | {
    kind: "applied";
    ops: number;
} | {
    kind: "unchanged";
};
```

## `EXPORT_ENTRY_ID`

_const_ in `vite/export-build.ts`

The id `index.html`'s script is built from.

```ts
declare const EXPORT_ENTRY_ID = "virtual:jams-export/main";
```

## `ExportBuildConfig`

_type_ in `vite/export-build.ts`

The build options an export needs, merged into Vite's config by the
plugin: the virtual entry as the only input, every bundler file under
`code/` named by content hash, no sourcemaps, no public dir copied and
no module preload helper (the page loads its entry alone).

```ts
type ExportBuildConfig = {
    build: {
        copyPublicDir: false;
        modulePreload: false;
        rolldownOptions: {
            input: Record<string, string>;
            output: {
                assetFileNames: string;
                chunkFileNames: string;
                entryFileNames: string;
                sourcemap: false;
            };
        };
        sourcemap: false;
    };
    publicDir: false;
};
```

## `ExportBuildOptions`

_type_ in `vite/export-build.ts`

```ts
type ExportBuildOptions = {
    budget?: Partial<ExportBudget>;
    /** Blobs by hash (dev: `fileContentStore`). */
    content: ContentStore;
    input: ExportInput;
    /** Absolute paths of the modules the project file names. */
    modules: {
        game: {
            export: string;
            path: string;
        };
        ui: null | {
            export: string;
            path: string;
        };
    };
    /** Called with the finished plan, for the CLI's report. */
    onPlan?(plan: ExportPlan): void;
    rapier: "compat" | "standard";
};
```

## `ExportPluginLike`

_type_ in `vite/export-build.ts`

The Vite plugin shape `createExportBuild` returns, typed structurally so `./vite` adds no peer.

```ts
type ExportPluginLike = {
    apply?: "build";
    /** Plans what ships, so `load` knows whether the entry imports Rapier. */
    buildStart(): Promise<void>;
    config(): ExportBuildConfig;
    configResolved(config: {
        root: string;
    }): void;
    enforce?: "pre";
    /**
     * Ordered after every other plugin's `generateBundle` (Vite's import
     * analysis rewrites chunk code in its own), so the chunks are hashed as
     * they are written.
     */
    generateBundle: {
        handler(this: {
            emitFile(f: {
                fileName: string;
                source: Uint8Array | string;
                type: "asset";
            }): void;
        }, opts: unknown, bundle: Record<string, unknown>): Promise<void>;
        order: "post";
    };
    load(id: string): null | string;
    name: string;
    resolveId(id: string): null | string;
};
```

Refers to [`ExportBuildConfig`](#exportbuildconfig).

## `FileApplyOptions`

_type_ in `vite/apply-files.ts`

```ts
type FileApplyOptions = {
    /** When this build was made, for the project's build stamps; default now. */
    buildAt?: number;
    /** Check and apply in memory, writing nothing. */
    dryRun?: boolean;
    now?: () => number;
    /** Who the batch's history entries and stamps name; default the `disk` origin. */
    origin?: DocOrigin;
    /**
     * Where blob bytes are read from to inspect them; default the project's dev
     * cache, which a write copies binaries from. A dry run can hold bytes it
     * mustn't store here.
     */
    store?: ContentStore;
};
```

## `FileProject`

_type_ in `vite/project-files.ts`

A project on disk: its root, its project file, the registries its assets are judged by, and its dev cache.

```ts
type FileProject = {
    /** Where doc states, trashed files and blobs are kept (`defaultCacheDir`). */
    cacheDir: string;
    /** The directory holding `jams.project.json`; absolute. */
    dir: string;
    file: ProjectFile;
    /** The loaded game, whose registrations fill the project doc's code map; absent or null for none. */
    game?: GameDefinition | null;
    kinds: KindRegistry;
    registry: Registry;
};
```

## `ListeningSceneCollab`

_type_ in `vite/collab-server.ts`

```ts
type ListeningSceneCollab = SceneCollab & {
    close(): Promise<void>;
    /** `http://host:port`, which answers `/__scene` and `/__project`. */
    httpUrl: string;
    port: number;
    /** `ws://host:port/__scene-collab`. */
    url: string;
};
```

Refers to [`SceneCollab`](#scenecollab).

## `MOVE_SETTLE_MS`

_const_ in `vite/project-files.ts`

How far apart an unlink and an add may be and still be one move, ms.

```ts
declare const MOVE_SETTLE_MS = 300;
```

## `PERSISTED_ORIGIN`

_const_ in `vite/project-files.ts`

The origin a persisted doc state is loaded with: it isn't an edit, so
nothing that reacts to `disk` or user transactions should see it.

```ts
declare const PERSISTED_ORIGIN: unique symbol;
```

## `PROJECT_ROUTE`

_const_ in `vite/handler.ts`

```ts
declare const PROJECT_ROUTE = "/__project";
```

## `PrefabFiles`

_type_ in `vite/project-files.ts`

```ts
type PrefabFiles = {
    /** Each read prefab's file, by id; absolute. */
    files: Map<string, string>;
    prefabs: PrefabLibrary;
    /** Files that didn't parse, or whose `id` isn't their asset's id; they are left out. */
    problems: {
        id: string;
        issues: SceneIssue[];
    }[];
    /** Each prefab file's text as read, by id. */
    texts: Map<string, string>;
};
```

## `ProjectDiskSync`

_type_ in `vite/project-files.ts`

What a file event did: `pending` while an add or unlink waits for `settle` to pair it into a move.

```ts
type ProjectDiskSync = ProjectSync | {
    kind: "pending";
};
```

Refers to [`ProjectSync`](#projectsync).

## `ProjectFileAdapter`

_type_ in `vite/project-files.ts`

```ts
type ProjectFileAdapter = {
    /**
     * A `path-taken` issue for the first live entry `storeProject` would skip:
     * one created or moved to a path that something on disk other than its
     * own file already holds, ignoring case (a file the scan doesn't list, a
     * folder, a file where a folder goes, a folder spelled in another case).
     * Null when every write lands. Writes nothing.
     */
    blockedWrite(doc: Y.Doc): Promise<SceneIssue | null>;
    /** The doc name an entry's content lives under. */
    docNameOf(entry: Pick<AssetEntry, "key" | "kind">): string;
    /** Drops an unloaded doc; its persisted state and files stay. */
    forget(name: string): void;
    /**
     * Fills an empty asset or scene doc from its file (or the trash cache), or
     * loads its persisted state and applies the file's difference as one
     * `disk` transaction (a layout-1 scene state is migrated first). A
     * created asset whose file isn't written yet stays for its creator to
     * fill: a declarative kind gets `meta` only, a scene or prefab nothing.
     * Throws when the file doesn't parse, or the doc isn't a doc asset of
     * this project.
     */
    loadDoc(name: string, doc: Y.Doc): Promise<void>;
    /** Fills an empty project doc from the files, or reconciles the persisted state with them. Returns the scan's problems. */
    loadProject(doc: Y.Doc): Promise<ProjectProblem[]>;
    /**
     * Writes a doc's state to `<cacheDir>/docs/<prefix>/<project>.<key>.bin`
     * (the doc name with its `:` as a folder, which every file system
     * accepts). Stores call it; the host calls it again on unload.
     */
    persist(name: string, doc: Y.Doc): Promise<void>;
    /**
     * Points every live binary whose hash the content store doesn't hold back
     * at bytes it does (the file's, else the newest held in its history),
     * with re-inspected meta and a project log entry, in one transaction
     * with `origin`. Returns what it repaired.
     */
    repairBlobs(doc: Y.Doc, origin: DocOrigin): Promise<BlobRepair[]>;
    /**
     * Reads every asset and sidecar under the project's globs into a
     * ProjectState; keys are ids unless a sidecar names one. A binary's bytes
     * are hashed, copied into the content store and inspected; its file wins
     * over what its sidecar says of them.
     */
    scan(): Promise<ProjectScan>;
    /** Applies the pending adds and unlinks: paired into moves, else registry adds and trashes, each with the `disk` origin. */
    settle(docs: (name: string) => Y.Doc | undefined, project: Y.Doc): Promise<ProjectSync[]>;
    /**
     * Writes the doc's canonical text when it changed, and a new file's
     * sidecar when it carries something; true when it wrote. A new file waits,
     * its content kept in the doc, while something on disk holds its path.
     */
    storeDoc(name: string, doc: Y.Doc): Promise<boolean>;
    /**
     * Writes the registry's creates, moves, trashes, restores and binary
     * replacements (bytes from the content store), and the sidecars they need:
     * every binary has one; true when it wrote.
     */
    storeProject(doc: Y.Doc): Promise<boolean>;
    /**
     * A file event under the project. An edit is one `disk` layoutPatch now; a
     * binary's new bytes are one `disk` replaceContent with re-inspected meta,
     * whose result names the change. An add or unlink is `pending` until
     * `settle`. The adapter's own writes are `unchanged`.
     */
    syncPath(path: AssetPath, docs: (name: string) => Y.Doc | undefined, project: Y.Doc): Promise<ProjectDiskSync>;
    /** A doc asset's content as plain JSON, as its kind parses it; undefined before it is seeded. Throws for a doc that isn't this project's. */
    valueOf(name: string, doc: Y.Doc): unknown;
    /** Whether a project-relative path under the asset globs may be an asset (`mayBeAssetFile`), or is a sidecar there. */
    watches(path: AssetPath): boolean;
};
```

Refers to [`BlobRepair`](#blobrepair), [`ProjectDiskSync`](#projectdisksync), [`ProjectProblem`](#projectproblem), [`ProjectScan`](#projectscan), [`ProjectSync`](#projectsync).

## `ProjectFileAdapterOptions`

_type_ in `vite/project-files.ts`

```ts
type ProjectFileAdapterOptions = {
    now?: () => number;
    /** The move pairing window; default `MOVE_SETTLE_MS`. */
    settleMs?: number;
};
```

## `ProjectProblem`

_type_ in `vite/project-files.ts`

```ts
type ProjectProblem = {
    issues: SceneIssue[];
    path: AssetPath;
};
```

## `ProjectScan`

_type_ in `vite/project-files.ts`

```ts
type ProjectScan = {
    problems: ProjectProblem[];
    state: ProjectState;
};
```

Refers to [`ProjectProblem`](#projectproblem).

## `ProjectSync`

_type_ in `vite/project-files.ts`

What a settled file event did; a binary's new bytes also name the changed asset.

```ts
type ProjectSync = DiskSync | {
    changed: AssetChange;
    kind: "applied";
    ops: number;
};
```

Refers to [`AssetChange`](#assetchange), [`DiskSync`](#disksync).

## `SCENE_COLLAB_PATH`

_const_ in `vite/collab-server.ts`

Where the dev server accepts collab websockets, for every doc: `project:`, `scene:` and `asset:`.

```ts
declare const SCENE_COLLAB_PATH = "/__scene-collab";
```

## `SCENE_NAME_PATTERN`

_const_ in `vite/scene-paths.ts`

Scene names are file stems: lowercase letters, digits and dashes, starting with a letter or digit.

```ts
declare const SCENE_NAME_PATTERN: RegExp;
```

## `SCENE_ROUTE`

_const_ in `vite/handler.ts`

```ts
declare const SCENE_ROUTE = "/__scene";
```

## `SceneCollab`

_type_ in `vite/collab-server.ts`

```ts
type SceneCollab = {
    /** Each project's file adapter, by project id. */
    adapters: ReadonlyMap<ProjectId, ProjectFileAdapter>;
    buildAt: number;
    destroy(): Promise<void>;
    /** Takes an HTTP upgrade for the collab path; returns false for any other URL. */
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
    /** Resolves once every queued file read and write has finished. */
    idle(): Promise<void>;
    /** The server's copy of a project doc, loading it if needed; it stays loaded while the server lives. */
    projectDoc(id: ProjectId): Promise<Y.Doc>;
    /** The in-process Hocuspocus server; it never listens on its own. */
    server: Server;
};
```

Refers to [`ProjectFileAdapter`](#projectfileadapter).

## `SceneCollabOptions`

_type_ in `vite/collab-server.ts`

```ts
type SceneCollabOptions = {
    /** When this build was made, ms since the epoch: the build stamps the server writes. Default when the server starts. */
    buildAt?: number;
    /** How long after the last edit a doc is written back, in ms. */
    debounceMs?: number;
    /**
     * The `@hocuspocus/server` module, for a host whose module loader is gone
     * by the time the first client connects (a config loaded through Vite's
     * `runnerImport`). Imported on first use when left out.
     */
    hocuspocus?: Pick<typeof _$_hocuspocus_server0, "Server">;
    /** The websocket path; defaults to `SCENE_COLLAB_PATH`. */
    path?: string;
    /** The projects served; each doc name says which it belongs to. */
    projects: readonly FileProject[];
    /** How long an unlink and an add may be apart and still pair into a move, in ms; default `MOVE_SETTLE_MS`. */
    settleMs?: number;
    /** Where refused disk changes, repairs and failed loads are reported; defaults to `console.warn`. */
    warn?: (message: string) => void;
    /** How long a file must be quiet before its change is read, in ms. */
    watchDelayMs?: number;
};
```

Refers to [`FileProject`](#fileproject).

## `SceneCollabPlugin`

_type_ in `vite/collab-server.ts`

The subset of a Vite plugin this entry uses, typed here so the package needs no `vite` peer.

```ts
type SceneCollabPlugin = {
    apply: "serve";
    configureServer(server: {
        config?: {
            server?: {
                cors?: ProjectCors;
            };
        };
        httpServer?: null | {
            on(event: "close", listener: () => void): unknown;
            on(event: "request", listener: (req: IncomingMessage, res: ServerResponse) => void): unknown;
            on(event: "upgrade", listener: UpgradeListener): unknown;
        };
        middlewares: {
            use(fn: Middleware): unknown;
        };
    }): void;
    name: string;
};
```

## `ScenePathError`

_class_ in `vite/scene-paths.ts`

```ts
declare class ScenePathError extends Error {
    constructor(message: string);
}
```

## `applyProjectBatchToFiles`

_function_ in `vite/apply-files.ts`

Applies a project batch to the project's files the way the dev server
applies one live: the docs it touches are loaded through the file
adapter into an in-memory session, `applyProjectBatch` checks and writes
them, and the adapter stores what changed (files, sidecars, moves, the
trash and the dev cache). A failing batch writes nothing, and neither does
one that would put an asset where something on disk the registry doesn't
list already sits (`path-taken`), dry run or not. A batch whose
`base` isn't the files' snapshot hash (`snapshotFiles`) fails with
`stale-base` before anything is read.

```ts
declare function applyProjectBatchToFiles(project: FileProject, batch: ProjectOpBatch, opts?: FileApplyOptions): Promise<ProjectApplyResult>;
```

Refers to [`FileApplyOptions`](#fileapplyoptions), [`FileProject`](#fileproject).

## `codeModules`

_function_ in `vite/project-files.ts`

The project's code modules, by project-relative path: the files its
`code` globs name (`!` globs and `ignore` exclude). The module the project
file names as the game's registers what the loaded game holds; the rest
register nothing the definition can attribute to them.

```ts
declare function codeModules(project: FileProject): Promise<Record<string, CodeModuleInfo>>;
```

Refers to [`FileProject`](#fileproject).

## `createExportBuild`

_function_ in `vite/export-build.ts`

A Vite plugin that builds index.html's entry (`virtual:jams-export/main`)
and emits every planned file. `generateBundle` hashes the chunks, finishes
the plan, writes the shell, docs, blobs, icons and `release.json` beside
them, and hands the plan to `onPlan`.

```ts
declare function createExportBuild(opts: ExportBuildOptions): ExportPluginLike;
```

Refers to [`ExportBuildOptions`](#exportbuildoptions), [`ExportPluginLike`](#exportpluginlike).

## `createProjectFileAdapter`

_function_ in `vite/project-files.ts`

A project's files as registry entries and asset docs, and back. Keeps
what it last read from or wrote to each file, so a store writes only
when the canonical text changed and the watcher events its own writes
cause are no-ops. Calls for one doc must not overlap; the host queues them.

```ts
declare function createProjectFileAdapter(project: FileProject, options?: ProjectFileAdapterOptions): ProjectFileAdapter;
```

Refers to [`FileProject`](#fileproject), [`ProjectFileAdapter`](#projectfileadapter), [`ProjectFileAdapterOptions`](#projectfileadapteroptions).

## `createSceneCollab`

_function_ in `vite/collab-server.ts`

Hocuspocus over the projects' files, in this process. The server is each
project's one writer: it seeds `project:<id>` from a scan and each
`scene:` and `asset:` doc from its file (or from the state persisted in
the project's cache dir, with the file's difference applied as one
`disk` transaction), writes back canonical text, sidecars, moves and the
trash on store, persists every doc, and turns file changes under the
project into `disk` transactions and registry ops. On each store of a
project doc it repairs binaries whose bytes the content store lacks
(`hash-mismatch`), restores trashed assets a live doc it holds still
names (`asset-in-use`; a doc it loads later is judged as it loads),
re-inspects binaries whose meta lags their bytes or merged settings, and
repairs duplicate ids and paths. It writes the code map and this build's
schema stamps when a project doc loads, and sends `asset:changed` on the
project doc whenever a binary's hash changes: on disk, by a client's
`replaceContent`, or by a repair. Each doc it seeds carries its seed's
stamp, and a client whose copy came from another seed (held across a
reseed) is refused before anything merges, so it resets to the server's
state. Needs `@hocuspocus/server`, imported here and only here, and
Node: its websocket adapter refuses to run under Bun.

```ts
declare function createSceneCollab(options: SceneCollabOptions): Promise<SceneCollab>;
```

Refers to [`SceneCollab`](#scenecollab), [`SceneCollabOptions`](#scenecollaboptions).

## `defaultCacheDir`

_function_ in `vite/content-store.ts`

```ts
declare function defaultCacheDir(project: ProjectId, root?: string): string;
```

## `exportEntrySource`

_function_ in `vite/export-build.ts`

The text of `virtual:jams-export/main`: `bootStandalone` with the game, its UI and, only when a listed scene needs it, Rapier.

```ts
declare function exportEntrySource(modules: ExportBuildOptions["modules"], rapier: ExportBuildOptions["rapier"] | null): string;
```

Refers to [`ExportBuildOptions`](#exportbuildoptions).

## `fileContentStore`

_function_ in `vite/content-store.ts`

Bytes by content hash on disk, at `<cacheDir>/blobs/<sha256>`. A blob is
written to a temp file and renamed into place, so a reader never sees a
partial one; a hash already held is not written again.

```ts
declare function fileContentStore(cacheDir: string): ContentStore;
```

## `gameRegisters`

_function_ in `vite/project-files.ts`

What a game definition registers: its types, asset kinds, tables, code materials, layers and collision groups, each sorted.

```ts
declare function gameRegisters(game: GameDefinition | null | undefined): CodeModuleInfo["registers"];
```

## `isCodePath`

_function_ in `vite/project-files.ts`

Whether a project-relative path is one of the project's code modules.

```ts
declare function isCodePath(file: ProjectFile, path: string): boolean;
```

## `listenSceneCollab`

_function_ in `vite/collab-server.ts`

The collab server on a port of its own, for tests and for running it outside Vite.

```ts
declare function listenSceneCollab(options: SceneCollabOptions & {
    host?: string;
    port?: number;
}): Promise<ListeningSceneCollab>;
```

Refers to [`ListeningSceneCollab`](#listeningscenecollab), [`SceneCollabOptions`](#scenecollaboptions).

## `pairDiskEvents`

_function_ in `vite/project-files.ts`

Pairs unlinks and adds into moves: an unlink and an add at most
`settleMs` apart that share a sidecar key, or else an id, are one move.
Each event pairs at most once, the earliest candidate first. Returns the
changes in the order to apply them: unlinks first (they free paths), then
moves, then adds, each in event order.

```ts
declare function pairDiskEvents(events: readonly DiskEvent[], settleMs: number): DiskChange[];
```

Refers to [`DiskChange`](#diskchange), [`DiskEvent`](#diskevent).

## `prefabPath`

_const_ in `vite/project-files.ts`

The file for prefab `id` in a scenes directory; ids follow scene names' rules.

```ts
declare const prefabPath: (scenesDir: string, id: string) => string;
```

## `prefabsDirOf`

_const_ in `vite/project-files.ts`

`<scenes dir>/prefabs`: where a scenes directory outside any project keeps its prefab files.

```ts
declare const prefabsDirOf: (scenesDir: string) => string;
```

## `readFileProject`

_function_ in `vite/project-files.ts`

The project whose `jams.project.json` is in `dir`, judged by `game`'s
registries (the engine's alone without one). Throws when the file is
missing or doesn't parse. `cacheDir` defaults to `defaultCacheDir`.

```ts
declare function readFileProject(dir: string, opts?: {
    cacheDir?: string;
    game?: GameDefinition | null;
}): Promise<FileProject>;
```

Refers to [`FileProject`](#fileproject).

## `readPrefabFiles`

_function_ in `vite/project-files.ts`

Reads every prefab in `prefabs/` of a scenes directory outside any
project, where a prefab's id is its file name; a missing `prefabs/` is an
empty library.

```ts
declare function readPrefabFiles(scenesDir: string, registry: Registry): Promise<PrefabFiles>;
```

Refers to [`PrefabFiles`](#prefabfiles).

## `readProjectPrefabFiles`

_function_ in `vite/project-files.ts`

Reads a project's live prefab assets from `state` (a scan of its files),
each at its registry path, judged by `registry`.

```ts
declare function readProjectPrefabFiles(project: Pick<FileProject, "dir" | "kinds">, state: ProjectState, registry: Registry): Promise<PrefabFiles>;
```

Refers to [`FileProject`](#fileproject), [`PrefabFiles`](#prefabfiles).

## `resolveScenePath`

_function_ in `vite/scene-paths.ts`

The file for scene `name` inside `dir`. Throws `ScenePathError` for a bad name or a path that leaves `dir`.

```ts
declare function resolveScenePath(dir: string, name: string): string;
```

## `sceneCollabServer`

_function_ in `vite/collab-server.ts`

The dev server's projects: `GET /__scene` lists the scenes,
`GET /__scene/:name` reads one, `/__project` lists the projects and holds
their blobs, and websockets on `/__scene-collab` co-edit every project
doc. Never part of a build.

```ts
declare function sceneCollabServer(options: SceneCollabOptions): SceneCollabPlugin;
```

Refers to [`SceneCollabOptions`](#scenecollaboptions), [`SceneCollabPlugin`](#scenecollabplugin).

## `sceneNameOf`

_function_ in `vite/scene-paths.ts`

The scene name for a file name in the scenes directory, or null when it
isn't one. The project file, schemas, sidecars and `.checks.json` files
have a dot in their stem, so they never are.

```ts
declare function sceneNameOf(fileName: string): null | string;
```

## `snapshotFiles`

_function_ in `vite/apply-files.ts`

The project as its files are now, pinned by content: each live doc
asset by the hash of its canonical text (its raw text when it doesn't
parse), each binary by its bytes, and this code's schema hashes as the
build. What a file batch's `base` names.

```ts
declare function snapshotFiles(project: FileProject): Promise<ProjectSnapshot>;
```

Refers to [`FileProject`](#fileproject).
