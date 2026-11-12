# @jams/engine/editor-ui

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`BlobRouteError`](#blobrouteerror) · [`CloseReason`](#closereason) · [`ConnectProjectSessionOptions`](#connectprojectsessionoptions) · [`DEFAULT_LAYOUT`](#default_layout) · [`EDITOR_UI_STYLESHEET`](#editor_ui_stylesheet) · [`EditorCue`](#editorcue) · [`EditorHost`](#editorhost) · [`EditorIdentityInput`](#editoridentityinput) · [`EditorLayout`](#editorlayout) · [`EditorNotify`](#editornotify) · [`EditorProjectChoice`](#editorprojectchoice) · [`EditorPublishHost`](#editorpublishhost) · [`EditorSkeleton`](#editorskeleton) · [`EditorSkeletonProps`](#editorskeletonprops) · [`EditorStorage`](#editorstorage) · [`GameSaveMode`](#gamesavemode) · [`GameSettingsPatch`](#gamesettingspatch) · [`GameSettingsView`](#gamesettingsview) · [`GameVisibility`](#gamevisibility) · [`MintProjectToken`](#mintprojecttoken) · [`NotifyOptions`](#notifyoptions) · [`PanelId`](#panelid) · [`Pending`](#pending) · [`PendingRun`](#pendingrun) · [`PendingTask`](#pendingtask) · [`PointerMove`](#pointermove) · [`ProjectAccess`](#projectaccess) · [`ProjectBlobs`](#projectblobs) · [`ProjectConnection`](#projectconnection) · [`ProjectConnectionState`](#projectconnectionstate) · [`ProjectConnectionStatus`](#projectconnectionstatus) · [`ProjectSocket`](#projectsocket) · [`ProjectTokenAnswer`](#projecttokenanswer) · [`ProjectTokenRequest`](#projecttokenrequest) · [`ProjectTokens`](#projecttokens) · [`ProjectTransport`](#projecttransport) · [`PublishChannel`](#publishchannel) · [`PublishWording`](#publishwording) · [`ReleaseView`](#releaseview) · [`SceneEditor`](#sceneeditor) · [`SceneEditorHandle`](#sceneeditorhandle) · [`SceneEditorProps`](#sceneeditorprops) · [`SceneHome`](#scenehome) · [`UsageLevel`](#usagelevel) · [`UsageLineView`](#usagelineview) · [`UsageView`](#usageview) · [`blobContentStore`](#blobcontentstore) · [`connectProjectSession`](#connectprojectsession) · [`createPending`](#createpending) · [`createProjectTokens`](#createprojecttokens) · [`devProjectHost`](#devprojecthost) · [`fitLayout`](#fitlayout) · [`hocuspocusTransport`](#hocuspocustransport) · [`mountSceneEditor`](#mountsceneeditor) · [`offConnection`](#offconnection) · [`parseLayout`](#parselayout) · [`projectBlobs`](#projectblobs-1)

## `BlobRouteError`

_class_ in `editor-ui/connect/blobs.ts`

A refused upload or read: the server's issue (`hash-mismatch`, `asset-too-large`, `quota-exceeded`…) when it sent one.

```ts
declare class BlobRouteError extends Error {
    readonly status: number;
    readonly issue?: SceneIssue | undefined;
    constructor(message: string, status: number, issue?: SceneIssue | undefined);
}
```

## `CloseReason`

_type_ in `editor-ui/host.ts`

What the server's close of a doc means: stop for good, reload the project from the server's state (this client's copy came from another seed), or try again.

```ts
type CloseReason = "reload" | "retry" | "revoked" | "too-large";
```

## `ConnectProjectSessionOptions`

_type_ in `editor-ui/connect/project-session.ts`

```ts
type ConnectProjectSessionOptions = {
    /** The access the tokens are asked for, reported until the first answer; default write. */
    access?: ProjectAccess;
    /** When the host's build was made; stamped on what this session writes. */
    buildAt?: number;
    cap?: number;
    /** The server's close codes; default every close retries. */
    closeReason?: (code: null | number, reason?: string) => CloseReason;
    isOnline?: () => boolean;
    key?: KeyGen;
    kinds: KindRegistry;
    now?: () => number;
    origin: DocOrigin;
    prefabWriter?: PrefabWriter;
    project: ProjectId;
    registry: Registry;
    /** Waits before re-attaching a doc the server refused for now. */
    retryMs?: readonly number[];
    store?: ContentStore;
    /** Hosted servers: a token per doc open, and the socket URL. Null for the dev server. */
    tokens?: ProjectTokens | null;
    transport: ProjectTransport;
    /** The socket's URL where no token names one. */
    url?: string;
};
```

Refers to [`CloseReason`](#closereason), [`ProjectAccess`](#projectaccess), [`ProjectTokens`](#projecttokens), [`ProjectTransport`](#projecttransport).

## `DEFAULT_LAYOUT`

_const_ in `editor-ui/layout/model.ts`

```ts
declare const DEFAULT_LAYOUT: EditorLayout;
```

Refers to [`EditorLayout`](#editorlayout).

## `EDITOR_UI_STYLESHEET`

_const_ in `editor-ui/index.ts`

The stylesheet's specifier, for hosts that inject a `<link>`.

```ts
declare const EDITOR_UI_STYLESHEET = "@jams/engine/editor-ui/style.css";
```

## `EditorCue`

_type_ in `editor-ui/host.ts`

```ts
type EditorCue = "drop" | "error" | "press" | "tab" | "toggle";
```

## `EditorHost`

_type_ in `editor-ui/host.ts`

Everything site-specific the editor uses; nothing else reaches a server, a flag or storage.

```ts
type EditorHost = {
    /** Where the asset loader fetches a blob: the dev route, the site's engine route, or an export's files. */
    assetUrl: AssetUrl;
    /** The host's own islands in the frame's top corners: a site menu, a title, a way out. */
    chrome?: {
        topLeft?: ReactNode;
        topRight?: ReactNode;
    };
    /** Opens the project's session for this editor; called again only when `project` changes. */
    connect(args: {
        origin: DocOrigin;
        project: ProjectId;
        registry: Registry;
    }): ProjectConnection;
    /** Interaction sounds; default silent. */
    cue?: (cue: EditorCue) => void;
    /** Which project holds a scene, by id or name, so a scene missing from this one can be pointed to. */
    findScene?: (scene: string) => Promise<SceneHome | null>;
    /** Feature gates the editor asks about; default every flag off. */
    flag?: (name: string) => boolean;
    /** Who is editing; default "Guest <n>" with a per-tab id. */
    identity?: EditorIdentityInput;
    /** Toasts, read once when the editor mounts; default the editor's own toast region. Sonner's `toast` fits as it is. */
    notify?: EditorNotify;
    /**
     * A project picked in the switcher, or a scene's own project from the
     * fallback notice's action (with that `scene`): the host opens it by giving
     * the editor another `project`, on `scene` when one is given.
     */
    onProjectChange?: (id: ProjectId, opts?: {
        scene?: string;
    }) => void;
    /** The editor opened another scene (a fallback, or a scene picker), so a route can follow. */
    onSceneChange?: (id: string) => void;
    /** A peer's colour by id, for cursors, faces and history dots; default a fixed palette by hash. */
    peerColor?: (id: string) => string;
    /** The projects the host can open; with two or more the Project panel offers a switcher. */
    projects?: readonly EditorProjectChoice[];
    /** Releases, channels and usage for the open project; without it the Publish panel and the Usage section aren't shown. */
    publish?: EditorPublishHost;
    /** The tree, inspector and licence fields take no edits. */
    readOnly?: boolean;
    /** Per-viewer storage; default `window.localStorage`, every call in try/catch; null keeps nothing. */
    storage?: EditorStorage | null;
};
```

Refers to [`EditorCue`](#editorcue), [`EditorIdentityInput`](#editoridentityinput), [`EditorNotify`](#editornotify), [`EditorProjectChoice`](#editorprojectchoice), [`EditorPublishHost`](#editorpublishhost), [`EditorStorage`](#editorstorage), [`ProjectConnection`](#projectconnection), [`SceneHome`](#scenehome).

## `EditorIdentityInput`

_type_ in `editor-ui/host.ts`

```ts
type EditorIdentityInput = {
    avatarUrl?: null | string;
    name: string;
};
```

## `EditorLayout`

_type_ in `editor-ui/layout/model.ts`

```ts
type EditorLayout = {
    /** The column opened last: the one drawn when only one fits. Default the right. */
    lastOpened?: Side;
    left: ColumnState;
    right: ColumnState;
    v: 1;
};
```

## `EditorNotify`

_type_ in `editor-ui/host.ts`

```ts
type EditorNotify = ((message: string, opts?: NotifyOptions) => unknown) & {
    error(message: string, opts?: NotifyOptions): unknown;
    success(message: string, opts?: NotifyOptions): unknown;
    warning(message: string, opts?: NotifyOptions): unknown;
};
```

Refers to [`NotifyOptions`](#notifyoptions).

## `EditorProjectChoice`

_type_ in `editor-ui/host.ts`

```ts
type EditorProjectChoice = {
    id: ProjectId;
    name: string;
};
```

## `EditorPublishHost`

_type_ in `editor-ui/host.ts`

A host that publishes the project's releases. Every sentence that states
one of the host's own numbers (a quota, a save cap, a link's lifetime, a
cleanup grace) arrives already written, so the editor carries none of
them.

```ts
type EditorPublishHost = {
    /** Opens the host's agent token dialog, for the release command. */
    openTokenDialog(): void;
    /** The project these calls act on. */
    project: ProjectId;
    promote(version: number, channel: PublishChannel): Promise<PointerMove>;
    /** Newest first. */
    releases(): Promise<readonly ReleaseView[]>;
    /** Back to the channel's previous release, or to `to`. */
    rollback(channel: PublishChannel, to?: number): Promise<PointerMove>;
    setSettings(patch: GameSettingsPatch): Promise<GameSettingsView>;
    settings(): Promise<GameSettingsView>;
    usage(): Promise<UsageView>;
    wording: PublishWording;
};
```

Refers to [`GameSettingsPatch`](#gamesettingspatch), [`GameSettingsView`](#gamesettingsview), [`PointerMove`](#pointermove), [`PublishChannel`](#publishchannel), [`PublishWording`](#publishwording), [`ReleaseView`](#releaseview), [`UsageView`](#usageview).

## `EditorSkeleton`

_function_ in `editor-ui/frame/EditorSkeleton.ts`

The editor's frame in its default layout with every panel's skeleton and
a "Loading the editor" status: what a host draws while the editor's code
loads, and what `SceneEditor` draws while it boots. Given `panels` (and
`status`), it is the editor's own frame, so a booting editor keeps its
canvas and columns when its panels arrive.

```ts
declare function EditorSkeleton({ panels, registry, notify, status, children, ...frame }: EditorSkeletonProps): ReactElement;
```

Refers to [`EditorSkeletonProps`](#editorskeletonprops).

## `EditorSkeletonProps`

_type_ in `editor-ui/frame/EditorSkeleton.ts`

```ts
type EditorSkeletonProps = Omit<EditorFrameProps, "children" | "panels"> & {
    /** The canvas; default a blank one. */
    children?: ReactNode;
    /** What the skeleton's inert controls report through; default nowhere. */
    notify?: EditorNotify;
    /** The editor's panels once it has them; until then each panel draws its skeleton. */
    panels?: FramePanels;
    /** What the skeleton's empty scene is built with; default the engine's own registry. */
    registry?: Registry;
    /** The bottom-left island; default the loading status while there are no `panels`, `null` for none. */
    status?: ReactNode;
};
```

Refers to [`EditorNotify`](#editornotify).

## `EditorStorage`

_type_ in `editor-ui/host.ts`

```ts
type EditorStorage = {
    get(key: string): null | string;
    set(key: string, value: string): void;
};
```

## `GameSaveMode`

_type_ in `editor-ui/host.ts`

```ts
type GameSaveMode = "none" | "own" | "site";
```

## `GameSettingsPatch`

_type_ in `editor-ui/host.ts`

```ts
type GameSettingsPatch = {
    connectOrigins?: readonly string[];
    online?: boolean;
    saveMode?: GameSaveMode;
    visibility?: GameVisibility;
};
```

Refers to [`GameSaveMode`](#gamesavemode), [`GameVisibility`](#gamevisibility).

## `GameSettingsView`

_type_ in `editor-ui/host.ts`

```ts
type GameSettingsView = {
    connectOrigins: readonly string[];
    online: boolean;
    /** Public was asked for and waits for staff review; the game stays unlisted meanwhile. */
    reviewPending: boolean;
    saveMode: GameSaveMode;
    /** The project's team, by name; null for a personal project, which can't be team-only. */
    team: null | string;
    visibility: GameVisibility;
};
```

Refers to [`GameSaveMode`](#gamesavemode), [`GameVisibility`](#gamevisibility).

## `GameVisibility`

_type_ in `editor-ui/host.ts`

```ts
type GameVisibility = "private" | "public" | "team" | "unlisted";
```

## `MintProjectToken`

_type_ in `editor-ui/host.ts`

```ts
type MintProjectToken = (request: ProjectTokenRequest) => Promise<ProjectTokenAnswer>;
```

Refers to [`ProjectTokenAnswer`](#projecttokenanswer), [`ProjectTokenRequest`](#projecttokenrequest).

## `NotifyOptions`

_type_ in `editor-ui/host.ts`

```ts
type NotifyOptions = {
    /** A button on the toast; sonner's `action` takes it as it is. A host whose toasts can't show one drops it. */
    action?: {
        label: string;
        onClick: () => void;
    };
    description?: string;
    id?: string;
};
```

## `PanelId`

_type_ in `editor-ui/layout/model.ts`

```ts
type PanelId = "history" | "inspector" | "outliner" | "problems" | "project" | "run" | (string & {});
```

## `Pending`

_type_ in `editor-ui/pending/pending.ts`

```ts
type Pending = {
    busy(scope: string): PendingTask | undefined;
    /** For work that isn't one promise (a debounce, a boot phase): busy until the returned call. */
    hold(spec: {
        id: string;
        label: string;
        scope: string;
    }): (outcome?: {
        error?: unknown;
        errorTitle?: string;
    }) => void;
    readonly store: Store<{
        tasks: readonly PendingTask[];
    }>;
    run<T>(spec: PendingRun<T>, work: (step: PendingStep) => Promise<T>): Promise<{
        error: unknown;
        ok: false;
    } | {
        ok: true;
        value: T;
    }>;
};
```

Refers to [`PendingRun`](#pendingrun), [`PendingTask`](#pendingtask).

## `PendingRun`

_type_ in `editor-ui/pending/pending.ts`

```ts
type PendingRun<T> = {
    /** The error toast's title; its description is the error's message. */
    error: ((error: unknown) => string) | string;
    /** One task per id; a second run with a running id joins the first. Default: `scope`. */
    id?: string;
    label: string;
    scope: string;
    /** Said on success; omit when the result shows on screen. */
    success?: ((value: T) => null | string) | string;
    total?: number;
};
```

## `PendingTask`

_type_ in `editor-ui/pending/pending.ts`

Every async editor action as a task: the control that started it shows
busy at once, the status island shows tasks that outlast
`ACTIVITY_DELAY_MS`, and an error is announced once. Pure: no React.

```ts
type PendingTask = {
    id: string;
    label: string;
    progress: null | {
        done: number;
        total: number;
    };
    /** A control or row (`project:rename:<assetId>`), a panel (`panel:problems`), or `editor`. */
    scope: string;
    startedAt: number;
};
```

## `PointerMove`

_type_ in `editor-ui/host.ts`

A channel's pointer before and after a promote or a rollback, by version.

```ts
type PointerMove = {
    from: null | number;
    to: number;
};
```

## `ProjectAccess`

_type_ in `editor-ui/host.ts`

```ts
type ProjectAccess = "read" | "write";
```

## `ProjectBlobs`

_type_ in `editor-ui/host.ts`

A project's blob route as the editor uses it.

```ts
type ProjectBlobs = {
    read(hash: Sha256): Promise<Uint8Array | null>;
    /** Stores `bytes`, refused unless the server hashes them as this client did. */
    upload(bytes: Uint8Array, opts?: {
        contentType?: string;
        kind?: AssetKindName;
        onProgress?: (sent: number, total: number) => void;
    }): Promise<UploadedBlob>;
};
```

## `ProjectConnection`

_type_ in `editor-ui/host.ts`

An open project session, as `EditorHost.connect` hands it to the editor.

```ts
type ProjectConnection = {
    /** Where imports upload; a connection without it takes no imports. */
    blobs?: ProjectBlobs;
    destroy(): void;
    getState(): ProjectConnectionState;
    /** Fires for each `asset:changed` message the server sends about this project. */
    onAssetChanged(listener: (message: AssetChangedMessage) => void): () => void;
    subscribe(listener: () => void): () => void;
};
```

Refers to [`ProjectBlobs`](#projectblobs), [`ProjectConnectionState`](#projectconnectionstate).

## `ProjectConnectionState`

_type_ in `editor-ui/host.ts`

```ts
type ProjectConnectionState = {
    /** What the session's token grants; the dev server grants writes. */
    access: ProjectAccess;
    error: Error | null;
    session: ProjectSession | null;
    status: ProjectConnectionStatus;
    /** Docs the server closed for good; the session keeps their last state. */
    stopped: Readonly<Record<string, Exclude<CloseReason, "reload" | "retry">>>;
    /** Updates no server has acknowledged yet, across the session's docs. */
    unsynced: number;
};
```

Refers to [`CloseReason`](#closereason), [`ProjectAccess`](#projectaccess), [`ProjectConnectionStatus`](#projectconnectionstatus).

## `ProjectConnectionStatus`

_type_ in `editor-ui/host.ts`

```ts
type ProjectConnectionStatus = "connecting" | "failed" | "live" | /** No project, or the host's gate is off. */ "off" | "offline" | "reconnecting";
```

## `ProjectSocket`

_type_ in `editor-ui/host.ts`

The one socket a session's docs share.

```ts
type ProjectSocket = {
    destroy(): void;
    /** A doc's provider, attached; its events arrive after this returns. */
    provider(args: {
        doc: Doc;
        events: ProjectDocEvents;
        name: string;
        /** Null where the server takes no token (the dev server). */
        token: (() => Promise<string>) | null;
    }): {
        attach(): void;
        awareness: AwarenessLike;
        destroy(): void;
        detach(): void;
    };
    status(): ProjectSocketStatus;
    subscribe(listener: () => void): () => void;
};
```

## `ProjectTokenAnswer`

_type_ in `editor-ui/host.ts`

```ts
type ProjectTokenAnswer = {
    access: ProjectAccess;
    token: string;
    url: string;
};
```

Refers to [`ProjectAccess`](#projectaccess).

## `ProjectTokenRequest`

_type_ in `editor-ui/host.ts`

```ts
type ProjectTokenRequest = {
    access: ProjectAccess;
    formatVersion: number;
    layoutVersion: number;
    projectId: ProjectId;
};
```

Refers to [`ProjectAccess`](#projectaccess).

## `ProjectTokens`

_type_ in `editor-ui/connect/project-session.ts`

```ts
type ProjectTokens = {
    /** A token with at least `TOKEN_REFRESH_MARGIN_MS` left, minting one when the last is too old. */
    get(): Promise<ProjectTokenAnswer>;
};
```

Refers to [`ProjectTokenAnswer`](#projecttokenanswer).

## `ProjectTransport`

_type_ in `editor-ui/host.ts`

Opens the session's socket on `url`.

```ts
type ProjectTransport = (url: string) => ProjectSocket;
```

Refers to [`ProjectSocket`](#projectsocket).

## `PublishChannel`

_type_ in `editor-ui/host.ts`

```ts
type PublishChannel = "preview" | "production";
```

## `PublishWording`

_type_ in `editor-ui/host.ts`

The Publish panel's sentences that carry a host's numbers, written by the host.

```ts
type PublishWording = {
    /** The command that builds and uploads a release of this project. */
    command: string;
    connectsTo: string;
    /** Shown before the command while the project has no release. */
    noRelease: string;
    privateLinks: string;
    saveModes: Readonly<Record<GameSaveMode, string>>;
    /** The agent token line beside the command. */
    token: string;
    visibility: Readonly<Record<GameVisibility, string>>;
};
```

Refers to [`GameSaveMode`](#gamesavemode), [`GameVisibility`](#gamevisibility).

## `ReleaseView`

_type_ in `editor-ui/host.ts`

```ts
type ReleaseView = {
    bytes: number;
    channels: readonly PublishChannel[];
    /** Its files are gone; the record stays. */
    collected: boolean;
    /** ISO 8601, UTC. */
    createdAt: string;
    engine: string;
    /** When it was first on production; null for a preview-only release. ISO 8601, UTC. */
    firstPromotedAt: null | string;
    /** Why staff hid it; null when it isn't hidden. */
    hidden: null | string;
    /** The release id: the SHA-256 of its `release.json`. */
    id: Sha256;
    /** The jams this release is pinned to, by title. */
    jams: readonly string[];
    playUrl: string;
    /** When the cleanup removes it unless pinned, with the sentence saying so; null when it is kept. */
    removal: null | {
        at: string;
        text: string;
    };
    version: number;
};
```

Refers to [`PublishChannel`](#publishchannel).

## `SceneEditor`

_function_ in `editor-ui/SceneEditor.ts`

The scene editor on the host's project: it owns the canvas and the game,
built with the host's game definition, Rapier and debug overlay, and
builds the game again when the project's materials, settings or tables
change. The frame draws the host's chrome in its top corners.

```ts
declare function SceneEditor(props: SceneEditorProps): ReactElement;
```

Refers to [`SceneEditorProps`](#sceneeditorprops).

## `SceneEditorHandle`

_type_ in `editor-ui/SceneEditor.ts`

```ts
type SceneEditorHandle = {
    /** The editor's current game; null while it builds (a rebuild included) and after unmount. */
    game(): GameInstance | null;
    openPanel(id: PanelId): void;
    resetLayout(): void;
};
```

Refers to [`PanelId`](#panelid).

## `SceneEditorProps`

_type_ in `editor-ui/SceneEditor.ts`

```ts
type SceneEditorProps = {
    /** Dev hosts: the debug overlay and the game's debug layers (F3). */
    debug?: () => Promise<{
        layers?: readonly DebugLayerFactory[];
        overlay: DebugOverlayFactory;
    }>;
    /**
     * The game the project's scenes are for, as its `jams.project.json` names
     * it; null for an engine-only project, whose scenes the dev server and the
     * CLI judge by `createRegistry(null)`.
     */
    game: GameDefinition | null;
    host: EditorHost;
    /** Called once the editor is up, with commands a host's own chrome can call. */
    onReady?: (handle: SceneEditorHandle) => void;
    project: ProjectId;
    rapier: () => Promise<RapierModule>;
    /** The scene to open, by id or name; when the project has neither its first scene opens and `onSceneChange` reports it. */
    scene?: string;
    /** The game's DOM UI (its project file's `ui`), mounted over the canvas while Play runs. */
    ui?: MountUi | null;
};
```

Refers to [`EditorHost`](#editorhost), [`SceneEditorHandle`](#sceneeditorhandle).

## `SceneHome`

_type_ in `editor-ui/host.ts`

A scene's project, and its id and display name there.

```ts
type SceneHome = {
    id: string;
    name: string;
    project: ProjectId;
};
```

## `UsageLevel`

_type_ in `editor-ui/host.ts`

```ts
type UsageLevel = "full" | "ok" | "warn";
```

## `UsageLineView`

_type_ in `editor-ui/host.ts`

One quota's row: its line already written ("Release storage: 120 MB of 512 MB"), and where it stands.

```ts
type UsageLineView = {
    /** A second line under the row, such as asset storage's breakdown. */
    detail?: string;
    level: UsageLevel;
    max: number;
    quota: string;
    /** used / max. */
    ratio: number;
    text: string;
    used: number;
};
```

Refers to [`UsageLevel`](#usagelevel).

## `UsageView`

_type_ in `editor-ui/host.ts`

```ts
type UsageView = {
    /** The cleanup rules, under the rows. */
    footer: string;
    lines: readonly UsageLineView[];
    /** The nearly-full or full line, when a quota is at either. */
    notice: null | {
        level: Exclude<UsageLevel, "ok">;
        text: string;
    };
    /** The trash's assets, with the confirmation that emptying it asks; null when it is empty. */
    trash: null | {
        assets: number;
        bytes: number;
        confirm: string;
    };
};
```

Refers to [`UsageLevel`](#usagelevel), [`UsageLineView`](#usagelineview).

## `blobContentStore`

_function_ in `editor-ui/connect/blobs.ts`

`blobs` as the content store a project session inspects blob ops' bytes with.

```ts
declare function blobContentStore(blobs: ProjectBlobs): ContentStore;
```

Refers to [`ProjectBlobs`](#projectblobs).

## `connectProjectSession`

_function_ in `editor-ui/connect/project-session.ts`

A project session over one socket: the first doc opened creates it (on
`url`, or on the URL the first token names), and each doc the session
opens gets its own provider on it, closed when the session lets the doc
go. The transport reconnects the socket and re-authenticates every
attached doc; a doc the server refuses for now (rate limit, stale token,
dropped while the socket stays up) is re-attached after a backoff, and one
`closeReason` says is closed for good is detached and listed in `stopped`.
A socket's own close (a code under 4000, or none) is left to the transport.
A doc the server refuses as another seed's (the server reseeded it while
this session held its history) is never merged: the whole session is
dropped and opened afresh, so every doc resets to the server's state;
`reloadOf` tells a listener that happened and what it dropped.

```ts
declare function connectProjectSession(options: ConnectProjectSessionOptions): ProjectConnection;
```

Refers to [`ConnectProjectSessionOptions`](#connectprojectsessionoptions), [`ProjectConnection`](#projectconnection).

## `createPending`

_const_ in `editor-ui/pending/pending.ts`

```ts
declare const createPending: (opts: {
    notify: EditorNotify;
    now?: () => number;
}) => Pending;
```

Refers to [`EditorNotify`](#editornotify), [`Pending`](#pending).

## `createProjectTokens`

_function_ in `editor-ui/connect/project-session.ts`

One project-scoped token for every doc of the session, reused until it
nears its expiry. A token's life is counted from when its mint was asked
for, so a slow answer only shortens it. Concurrent asks share one mint.

```ts
declare function createProjectTokens(request: ProjectTokenRequest, mint: MintProjectToken, opts?: {
    now?: () => number;
    ttlMs: number;
}): ProjectTokens;
```

Refers to [`MintProjectToken`](#mintprojecttoken), [`ProjectTokenRequest`](#projecttokenrequest), [`ProjectTokens`](#projecttokens).

## `devProjectHost`

_function_ in `editor-ui/connect/dev.ts`

The dev server's project session and asset route, on the paths `./vite`
serves: one Hocuspocus socket for the project doc and every scene and
prefab doc it opens, with the project's blob route as its content store
and import target, and its scene listing to say which project holds a
scene. The dev server takes no tokens.

```ts
declare function devProjectHost(opts: {
    /** When the host's build was made; the dev server stamps with the same VITE_BUILD_AT. */
    buildAt?: number;
    hocuspocus: HocuspocusModule;
    /**
     * The dev server's origin when it isn't the page's (`http(s)://` or
     * `ws(s)://`, any path ignored); default the page's own, read when a
     * project connects.
     */
    origin?: string;
}): Pick<EditorHost, "assetUrl" | "connect" | "findScene">;
```

Refers to [`EditorHost`](#editorhost).

## `fitLayout`

_const_ in `editor-ui/layout/model.ts`

What the frame draws for this window. Columns shrink toward their minimums
before the canvas goes under its own; past that only one column is drawn
(`single`: with both stored open, the one opened last) and the other is a rail;
under `LIMITS.phone` the frame uses its phone layout and draws no column.

```ts
declare const fitLayout: (layout: EditorLayout, viewport: Viewport) => FittedLayout;
```

Refers to [`EditorLayout`](#editorlayout).

## `hocuspocusTransport`

_function_ in `editor-ui/connect/hocuspocus.ts`

One `HocuspocusProviderWebsocket` from the module the host passes in, with
a `HocuspocusProvider` per doc attached to it. Each provider reports its
doc's unacknowledged updates, so the editor can say when the server holds
every edit.

```ts
declare function hocuspocusTransport(mod: HocuspocusModule): ProjectTransport;
```

Refers to [`ProjectTransport`](#projecttransport).

## `mountSceneEditor`

_function_ in `editor-ui/SceneEditor.ts`

Renders `SceneEditor` into `element` with its own React root.

```ts
declare function mountSceneEditor(element: HTMLElement, props: SceneEditorProps): {
    unmount(): void;
    update(props: SceneEditorProps): void;
};
```

Refers to [`SceneEditorProps`](#sceneeditorprops).

## `offConnection`

_function_ in `editor-ui/connect/project-session.ts`

A connection that opens nothing: for a host whose project is switched off.

```ts
declare function offConnection(access?: ProjectAccess): ProjectConnection;
```

Refers to [`ProjectAccess`](#projectaccess), [`ProjectConnection`](#projectconnection).

## `parseLayout`

_const_ in `editor-ui/layout/model.ts`

The stored layout if its shape and version hold; unknown panels dropped, missing ones back in their default group.

```ts
declare const parseLayout: (raw: unknown, known: readonly PanelId[]) => EditorLayout | null;
```

Refers to [`EditorLayout`](#editorlayout), [`PanelId`](#panelid).

## `projectBlobs`

_function_ in `editor-ui/connect/blobs.ts`

A project's blob route: `POST <route>` stores bytes and `GET
<route>/<sha256>` reads them back. An upload reports its progress once it
has hashed the bytes, as they are sent when the browser can tell (no
`fetcher` given), and when the server has stored them.

```ts
declare function projectBlobs(route: string, fetcher?: typeof fetch): ProjectBlobs;
```

Refers to [`ProjectBlobs`](#projectblobs).
