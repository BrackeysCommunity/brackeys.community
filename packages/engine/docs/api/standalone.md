# @jams/engine/standalone

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`ConnectHostOptions`](#connecthostoptions) · [`FetchText`](#fetchtext) · [`FrameMessage`](#framemessage) · [`HOST_DOWNLOAD_MAX_BYTES`](#host_download_max_bytes) · [`HOST_HANDSHAKE_TIMEOUT_MS`](#host_handshake_timeout_ms) · [`HOST_MESSAGE_MAX_BYTES`](#host_message_max_bytes) · [`HOST_PROTOCOL_VERSION`](#host_protocol_version) · [`HOST_REQUESTS`](#host_requests) · [`HOST_REQUEST_TIMEOUT_MS`](#host_request_timeout_ms) · [`HOST_WELCOME_TIMEOUT_MS`](#host_welcome_timeout_ms) · [`HostChannel`](#hostchannel) · [`HostEvents`](#hostevents) · [`HostFeature`](#hostfeature) · [`HostMessage`](#hostmessage) · [`HostRequestError`](#hostrequesterror) · [`HostRequestMethod`](#hostrequestmethod) · [`HostRequestParams`](#hostrequestparams) · [`HostRequestResult`](#hostrequestresult) · [`HostSaves`](#hostsaves) · [`HostWelcome`](#hostwelcome) · [`LiveController`](#livecontroller) · [`LiveControllerOptions`](#livecontrolleroptions) · [`LiveSceneEntry`](#livesceneentry) · [`LiveSnapshot`](#livesnapshot) · [`LiveStateMessage`](#livestatemessage) · [`LiveStatus`](#livestatus) · [`RenderState`](#renderstate) · [`StandaloneBootError`](#standalonebooterror) · [`StandaloneGame`](#standalonegame) · [`StandaloneOptions`](#standaloneoptions) · [`bootStandalone`](#bootstandalone) · [`channelSaveStore`](#channelsavestore) · [`connectHost`](#connecthost) · [`createLiveController`](#createlivecontroller) · [`fetchReleaseTexts`](#fetchreleasetexts) · [`frameMessageSchema`](#framemessageschema) · [`frameReadySchema`](#framereadyschema) · [`hostFeatureSchema`](#hostfeatureschema) · [`hostHandshakeSchema`](#hosthandshakeschema) · [`hostIssueSchema`](#hostissueschema) · [`hostMessageBytes`](#hostmessagebytes) · [`hostMessageSchema`](#hostmessageschema) · [`hostRequested`](#hostrequested) · [`hostSavesSchema`](#hostsavesschema) · [`liveSceneEntrySchema`](#livesceneentryschema) · [`liveSnapshotSchema`](#livesnapshotschema) · [`liveStateMessageSchema`](#livestatemessageschema) · [`manifestRuntimeView`](#manifestruntimeview) · [`manifestView`](#manifestview) · [`mirrorRenderState`](#mirrorrenderstate) · [`saveLimitsSchema`](#savelimitsschema) · [`saveModeSchema`](#savemodeschema) · [`saveSummarySchema`](#savesummaryschema) · [`saveWriteResultSchema`](#savewriteresultschema) · [`showBootError`](#showbooterror) · [`welcomeSchema`](#welcomeschema) · [`withinHostMessageCap`](#withinhostmessagecap)

## `ConnectHostOptions`

_type_ in `standalone/host-channel.ts`

```ts
type ConnectHostOptions = {
    /** What the frame supports, sent in `hello`; none by default, and an empty list sends none. */
    features?: readonly HostFeature[];
    /** What the frame says in `hello`. */
    hello: {
        engine: string;
        game: string;
        release: Sha256;
    };
    /** How long each later request waits for the page's reply; default `HOST_REQUEST_TIMEOUT_MS`. */
    requestTimeoutMs?: number;
    /** How long to wait for the page's port; default `HOST_HANDSHAKE_TIMEOUT_MS`. */
    timeoutMs?: number;
    /** How long to wait for `welcome` once the port arrived; default `HOST_WELCOME_TIMEOUT_MS`. */
    welcomeTimeoutMs?: number;
    /** The frame's window; default the global one. */
    window?: Window;
};
```

Refers to [`HostFeature`](#hostfeature).

## `FetchText`

_type_ in `standalone/data.ts`

What the host fetches with: `fetch`, or a stand-in that answers a URL.

```ts
type FetchText = (url: string) => Promise<Response>;
```

## `FrameMessage`

_type_ in `standalone/host-protocol.ts`

```ts
type FrameMessage = z.infer<typeof frameMessageSchema>;
```

Refers to [`frameMessageSchema`](#framemessageschema).

## `HOST_DOWNLOAD_MAX_BYTES`

_const_ in `standalone/host-protocol.ts`

The most a `download` event's bytes may be.

```ts
declare const HOST_DOWNLOAD_MAX_BYTES: number;
```

## `HOST_HANDSHAKE_TIMEOUT_MS`

_const_ in `standalone/host-protocol.ts`

How long the frame waits for the page's `jams:host` before it plays without one.

```ts
declare const HOST_HANDSHAKE_TIMEOUT_MS = 2000;
```

## `HOST_MESSAGE_MAX_BYTES`

_const_ in `standalone/host-protocol.ts`

The most one message may take, as UTF-8 JSON; `download` is capped by its bytes instead.

```ts
declare const HOST_MESSAGE_MAX_BYTES = 65536;
```

## `HOST_PROTOCOL_VERSION`

_const_ in `standalone/host-protocol.ts`

The `jams-host` channel between a released game in a sandboxed frame and
the page that frames it. The frame posts `jams:frame-ready` to its parent;
the page answers `jams:host` with a `MessagePort`, and every message after
goes over that port. Requests carry an `id` and get one `reply`; events
carry none. Both sides validate every message with these schemas, since
neither trusts the other's code.

```ts
declare const HOST_PROTOCOL_VERSION = 1;
```

## `HOST_REQUESTS`

_const_ in `standalone/host-protocol.ts`

Each request the frame sends: its params, and the schema of the page's result.

```ts
declare const HOST_REQUESTS: {
    readonly "prefs.save": {
        readonly params: z.ZodObject<{
            store: z.ZodEnum<{
                prefs: "prefs";
                remap: "remap";
            }>;
            value: z.ZodUnknown;
        }, z.core.$strict>;
        readonly result: z.ZodNull;
    };
    readonly "saves.list": {
        readonly params: z.ZodObject<{
            gameId: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodArray<z.ZodObject<{
            bytes: z.ZodNumber;
            meta: z.ZodObject<{
                playTicks: z.ZodNumber;
                savedAt: z.ZodNumber;
                scene: z.ZodString;
                title: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            slot: z.ZodString;
        }, z.core.$strip>>;
    };
    readonly "saves.read": {
        readonly params: z.ZodObject<{
            gameId: z.ZodString;
            slot: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodNullable<z.ZodString>;
    };
    readonly "saves.remove": {
        readonly params: z.ZodObject<{
            gameId: z.ZodString;
            slot: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodNull;
    };
    readonly "saves.write": {
        readonly params: z.ZodObject<{
            gameId: z.ZodString;
            slot: z.ZodString;
            text: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodUnion<readonly [
            z.ZodObject<{
                bytes: z.ZodNumber;
                ok: z.ZodLiteral<true>;
            }, z.core.$strip>,
            z.ZodObject<{
                issue: z.ZodType<SceneIssue, unknown, z.core.$ZodTypeInternals<SceneIssue, unknown>>;
                ok: z.ZodLiteral<false>;
            }, z.core.$strip>
        ]>;
    };
    readonly "session.token": {
        readonly params: z.ZodObject<{
            sessionId: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            token: z.ZodString;
            url: z.ZodString;
        }, z.core.$strip>;
    };
    readonly hello: {
        readonly params: z.ZodObject<{
            engine: z.ZodString;
            features: z.ZodOptional<z.ZodArray<z.ZodLiteral<"live">>>;
            game: z.ZodString;
            release: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            live: z.ZodOptional<z.ZodNullable<z.ZodType<LiveSnapshot, unknown, z.core.$ZodTypeInternals<LiveSnapshot, unknown>>>>;
            online: z.ZodBoolean;
            player: z.ZodObject<{
                name: z.ZodNullable<z.ZodString>;
                signedIn: z.ZodBoolean;
            }, z.core.$strip>;
            prefs: z.ZodObject<{
                prefs: z.ZodUnknown;
                remap: z.ZodUnknown;
            }, z.core.$strip>;
            saves: z.ZodObject<{
                describe: z.ZodString;
                limits: z.ZodObject<{
                    maxBytes: z.ZodNumber;
                    maxSlots: z.ZodNumber;
                }, z.core.$strict>;
                mode: z.ZodEnum<{
                    none: "none";
                    own: "own";
                    site: "site";
                }>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    };
};
```

Refers to [`LiveSnapshot`](#livesnapshot).

## `HOST_REQUEST_TIMEOUT_MS`

_const_ in `standalone/host-protocol.ts`

How long the frame waits for the page's reply to any later request before
it fails with `save-store-failed`: a page that never answers would
otherwise leave a save pending until the channel closes. A reply that
arrives after is dropped as a reply to nothing.

```ts
declare const HOST_REQUEST_TIMEOUT_MS = 30000;
```

## `HOST_WELCOME_TIMEOUT_MS`

_const_ in `standalone/host-protocol.ts`

How long the frame waits for `welcome` once the page has answered with its
port: a page that is there may be slow to answer `hello` (a cold browser
opening its save store), and giving up then would drop its saves.

```ts
declare const HOST_WELCOME_TIMEOUT_MS = 30000;
```

## `HostChannel`

_type_ in `standalone/host-channel.ts`

The frame's end of the `jams-host` channel, open once the page has answered `hello`.

```ts
type HostChannel = {
    close(): void;
    /** Reports where one scene's live version stands. */
    liveState(message: LiveStateMessage): void;
    /** Hands the page a file to offer as a download button; the frame can't start downloads itself. */
    offerDownload(name: string, contentType: string, bytes: ArrayBuffer): void;
    /** Listens for one of the page's events; returns the unsubscribe. */
    on<E extends keyof HostEvents>(event: E, fn: (data: HostEvents[E]) => void): () => void;
    /** How many of the page's messages were dropped: over the size cap, not the protocol's shape, or a reply to nothing. */
    readonly dropped: number;
    /** The page's answer to `hello`. */
    readonly welcome: HostWelcome;
    /**
     * One request; rejects with a `HostRequestError` carrying the page's
     * issue, or `save-store-failed` when the channel closes first, the page
     * doesn't answer within the channel's `requestTimeoutMs`, or the page's
     * result isn't the method's.
     */
    request<M extends HostRequestMethod>(method: M, params: HostRequestParams<M>): Promise<HostRequestResult<M>>;
    /** Reports the game's boot state to the page. */
    state(state: "error" | "loading" | "ready", issue?: SceneIssue): void;
};
```

Refers to [`HostEvents`](#hostevents), [`HostRequestMethod`](#hostrequestmethod), [`HostRequestParams`](#hostrequestparams), [`HostRequestResult`](#hostrequestresult), [`HostWelcome`](#hostwelcome), [`LiveStateMessage`](#livestatemessage).

## `HostEvents`

_type_ in `standalone/host-protocol.ts`

The events the page sends, by type, as a frame listens for them.

```ts
type HostEvents = {
    /** The whole live snapshot again; the frame diffs it against what it runs. */
    "live.update": LiveSnapshot;
    /** The page asks for the run's recording so far; the frame answers with a download. */
    "recording.request": undefined;
    "saves.changed": HostSaves;
    pause: undefined;
    resume: undefined;
};
```

Refers to [`HostSaves`](#hostsaves), [`LiveSnapshot`](#livesnapshot).

## `HostFeature`

_type_ in `standalone/host-protocol.ts`

```ts
type HostFeature = z.infer<typeof hostFeatureSchema>;
```

Refers to [`hostFeatureSchema`](#hostfeatureschema).

## `HostMessage`

_type_ in `standalone/host-protocol.ts`

```ts
type HostMessage = z.infer<typeof hostMessageSchema>;
```

Refers to [`hostMessageSchema`](#hostmessageschema).

## `HostRequestError`

_class_ in `standalone/host-channel.ts`

A request the page refused or the channel couldn't carry: `issue` is the page's own, passed on unchanged.

```ts
declare class HostRequestError extends Error {
    readonly issue: SceneIssue;
    constructor(issue: SceneIssue);
}
```

## `HostRequestMethod`

_type_ in `standalone/host-protocol.ts`

```ts
type HostRequestMethod = keyof typeof HOST_REQUESTS;
```

Refers to [`HOST_REQUESTS`](#host_requests).

## `HostRequestParams`

_type_ in `standalone/host-protocol.ts`

```ts
type HostRequestParams<M extends HostRequestMethod> = z.infer<(typeof HOST_REQUESTS)[M]["params"]>;
```

Refers to [`HOST_REQUESTS`](#host_requests), [`HostRequestMethod`](#hostrequestmethod).

## `HostRequestResult`

_type_ in `standalone/host-protocol.ts`

```ts
type HostRequestResult<M extends HostRequestMethod> = z.infer<(typeof HOST_REQUESTS)[M]["result"]>;
```

Refers to [`HOST_REQUESTS`](#host_requests), [`HostRequestMethod`](#hostrequestmethod).

## `HostSaves`

_type_ in `standalone/host-protocol.ts`

```ts
type HostSaves = z.infer<typeof hostSavesSchema>;
```

Refers to [`hostSavesSchema`](#hostsavesschema).

## `HostWelcome`

_type_ in `standalone/host-protocol.ts`

```ts
type HostWelcome = z.infer<typeof welcomeSchema>;
```

Refers to [`welcomeSchema`](#welcomeschema).

## `LiveController`

_type_ in `standalone/live.ts`

The frame's side of live levels, for a host that announced `"live"`.

```ts
type LiveController = {
    dispose(): void;
    /** Resolves once `scene`'s preparation has finished, staged or refused; at once when none runs. */
    settled(scene: AssetId): Promise<void>;
    /** Diffs against what is staged and active; stages what's new, activates what's ready. */
    update(live: LiveSnapshot): void;
};
```

Refers to [`LiveSnapshot`](#livesnapshot).

## `LiveControllerOptions`

_type_ in `standalone/live.ts`

```ts
type LiveControllerOptions = {
    /** Fetches a file relative to release.json: the boot's own fetch. */
    fetchText(path: string): Promise<string>;
    /**
     * Filled with the file each staged version's blobs load from, by hash: the
     * release's own path when it ships that hash, else `live/<sha256><ext>`.
     * The standalone loader's URL function reads it.
     */
    files?: Map<Sha256, string>;
    instance: GameInstance;
    manifest: ReleaseManifest;
    report(state: LiveStateMessage): void;
};
```

Refers to [`LiveStateMessage`](#livestatemessage).

## `LiveSceneEntry`

_type_ in `standalone/host-protocol.ts`

One scene a channel runs a live version of.

```ts
type LiveSceneEntry = {
    /** The version's number among the scene's versions, as the page shows it. */
    number: number;
    scene: AssetId;
    /** ISO time the pointer moved; the page uses it for "updated 3 min ago" in its chrome. */
    since: string;
    timing: SwapTiming;
    version: Sha256;
};
```

## `LiveSnapshot`

_type_ in `standalone/host-protocol.ts`

The live versions a channel's release runs now: what the page hands the frame.

```ts
type LiveSnapshot = {
    channel: "preview" | "production";
    release: Sha256;
    /** Versions this channel still points at that were hidden: pages running one reload their frame. */
    removed: readonly Sha256[];
    /** Grows with every move on the channel. */
    rev: number;
    /** Only pointers that apply: compatible, listed, not collected, hidden or blocked. Sorted by scene. */
    scenes: readonly LiveSceneEntry[];
};
```

Refers to [`LiveSceneEntry`](#livesceneentry).

## `LiveStateMessage`

_type_ in `standalone/host-protocol.ts`

The frame's report on one scene's version; `version` null means the release's own.

```ts
type LiveStateMessage = {
    issue?: SceneIssue;
    scene: AssetId;
    status: LiveStatus;
    strategy?: SwapStrategy;
    tick?: number;
    timing?: SwapTiming;
    version: Sha256 | null;
};
```

Refers to [`LiveStatus`](#livestatus).

## `LiveStatus`

_type_ in `standalone/host-protocol.ts`

Where a scene's version stands in the frame.

```ts
type LiveStatus = "applied" | "failed" | "ready" | "refused" | "staging" | "waiting";
```

## `RenderState`

_type_ in `standalone/boot.ts`

What `data-jams-render` says: the GPU context is gone, came back in place, a new renderer took over, or none could be built.

```ts
type RenderState = "failed" | "lost" | "rebuilt" | "restored";
```

## `StandaloneBootError`

_class_ in `standalone/errors.ts`

A boot refused: the issues why, the first of which the error page names.

```ts
declare class StandaloneBootError extends Error {
    readonly issues: readonly SceneIssue[];
    constructor(issues: readonly SceneIssue[]);
}
```

## `StandaloneGame`

_type_ in `standalone/boot.ts`

```ts
type StandaloneGame = {
    /** The credits page, relative to the manifest: "credits.html". */
    credits: string;
    destroy(): void;
    /** The page hosting this frame (`?host=jams`), or null when none answered. */
    host: HostChannel | null;
    /**
     * Shows the browser's install prompt, resolving true once it was accepted.
     * null until the browser offers one (`beforeinstallprompt`), after it was
     * used, and wherever the build registers no service worker.
     */
    install: (() => Promise<boolean>) | null;
    instance: GameInstance;
    manifest: ReleaseManifest;
    /** The release id: the SHA-256 of `release.json`'s text. */
    release: Sha256;
};
```

Refers to [`HostChannel`](#hostchannel).

## `StandaloneOptions`

_type_ in `standalone/boot.ts`

```ts
type StandaloneOptions = {
    fetch?: typeof fetch;
    /**
     * Default true: the page is laid out for the game alone (no margin or
     * scrolling, the build's background, `root` fixed over the whole window)
     * and the canvas takes the root's size. False leaves the page's layout to
     * its own CSS, which then gives `root` its size.
     */
    fillPage?: boolean;
    game: GameDefinition;
    /** Present only when the build ships Rapier. */
    rapier?: () => Promise<RapierModule>;
    /** The manifest's URL, resolved against the document's base URI; default "release.json" next to the page. */
    release?: string;
    /** The element the game's canvas and UI go in. */
    root: HTMLElement;
    /** Default `browserSaveStore()`, or the host's store when a page hosts the frame; a game's own `saves.store` still wins. */
    saves?: SaveStore;
    /** Default true when the manifest has `pwa`; ignored where there is no service worker or the context isn't secure. */
    serviceWorker?: boolean;
    ui?: MountUi;
};
```

## `bootStandalone`

_function_ in `standalone/boot.ts`

Boots a released game from its `release.json`: the project's data, the
asset loader over the build's files, the scene flow at the list's start,
the UI and saves. Sets `document.documentElement.dataset.jamsState` to
"loading", then "ready", or "error" with the refusal shown in `root`
(the promise rejects then), and mirrors the renderer's state there too
(`mirrorRenderState`). Every URL is resolved against the manifest's
own, which resolves against the document's base URI, and none leaves its
directory.

With `?host=jams` on the page's URL it first looks for the page that
frames it (`connectHost`). When one answers, saves and remaps go through
that page, no service worker registers, the state is reported to it too
and its `pause`/`resume` pause the game, and its `recording.request`
gets the run's recording so far as a `download` (a hosted frame records
each scene the flow loads); when none answers in 2 s the
build plays as it would anywhere else. A hosted frame announces `"live"`:
the welcome's live versions are staged before the first scene loads (the
start scene waits for its own, the others stage in the background), the
page's `live.update` snapshots go to `createLiveController`, and its
reports go back as `live.state`.

```ts
declare function bootStandalone(opts: StandaloneOptions): Promise<StandaloneGame>;
```

Refers to [`StandaloneGame`](#standalonegame), [`StandaloneOptions`](#standaloneoptions).

## `channelSaveStore`

_function_ in `saves/store.ts`

Saves kept by the page that frames the game, over its `jams-host`
channel: `kind` "host", `describe` and `limits` from the page's welcome,
updated when the page sends `saves.changed`. A write the page refuses
returns the page's issue unchanged, so the game shows the page's words; a
list or read that fails is empty, and a failed remove does nothing.

```ts
declare function channelSaveStore(channel: HostChannel): SaveStore;
```

Refers to [`HostChannel`](#hostchannel).

## `connectHost`

_function_ in `standalone/host-channel.ts`

Opens the channel to the page that frames this game: posts
`jams:frame-ready` to the parent window, keeps the port of the first
`jams:host` it answers with, then sends `hello`. Resolves null when the
frame has no parent, no port arrives within `timeoutMs`, or no `welcome`
within `welcomeTimeoutMs` after it;
the game then plays as a plain standalone build. Every other window
message is ignored. Each request after `hello` waits `requestTimeoutMs`
for its reply.

```ts
declare function connectHost(opts: ConnectHostOptions): Promise<HostChannel | null>;
```

Refers to [`ConnectHostOptions`](#connecthostoptions), [`HostChannel`](#hostchannel).

## `createLiveController`

_function_ in `standalone/live.ts`

Follows the page's live snapshots: for each scene whose version differs
from what the frame runs, fetches `live/<version>.json` and checks that
it hashes to its id, parses and is compatible with the release; fetches
each doc it carries from the release's own `data/` when the release ships
that hash, else from `live/`, each hash-checked; stages it within one
`LIVE_DEFAULTS.preloadTimeoutMs` deadline for the whole preparation; and
activates it at its timing. Each step goes to `report`: `staging`,
`ready`, `waiting` (a boundary swap), `applied` (the swap, or the load
that used it) and `refused` or `failed` with the issue. A scene that
leaves the snapshot goes back to the release's own, at its pointer's
last timing, or at the next load when the version it ran had failed or
was removed. One preparation per scene runs at a time; a newer snapshot
cancels an older one.

```ts
declare function createLiveController(opts: LiveControllerOptions): LiveController;
```

Refers to [`LiveController`](#livecontroller), [`LiveControllerOptions`](#livecontrolleroptions).

## `fetchReleaseTexts`

_function_ in `standalone/data.ts`

Fetches the doc texts a boot needs (the runtime view's docs and every
listed scene and prefab), in parallel, each resolved against `base`, the
manifest's own URL. The manifest ships exactly those docs, so every doc
asset is fetched, each file once. A text that doesn't hash to its pin is
`hash-mismatch`: a stale cache served a file of another build.

```ts
declare function fetchReleaseTexts(m: ReleaseManifest, base: URL, fetchFn: FetchText): Promise<Map<AssetId, string>>;
```

Refers to [`FetchText`](#fetchtext).

## `frameMessageSchema`

_const_ in `standalone/host-protocol.ts`

Every message the frame sends after the handshake: a request, or an event.

```ts
declare const frameMessageSchema: z.ZodDiscriminatedUnion<[
    z.ZodObject<{
        id: z.ZodNumber;
        params: z.ZodObject<{
            engine: z.ZodString;
            features: z.ZodOptional<z.ZodArray<z.ZodLiteral<"live">>>;
            game: z.ZodString;
            release: z.ZodString;
        }, z.core.$strict>;
        type: z.ZodLiteral<"hello">;
    }, z.core.$strict>,
    z.ZodObject<{
        id: z.ZodNumber;
        params: z.ZodObject<{
            gameId: z.ZodString;
        }, z.core.$strict>;
        type: z.ZodLiteral<"saves.list">;
    }, z.core.$strict>,
    z.ZodObject<{
        id: z.ZodNumber;
        params: z.ZodObject<{
            gameId: z.ZodString;
            slot: z.ZodString;
        }, z.core.$strict>;
        type: z.ZodLiteral<"saves.read">;
    }, z.core.$strict>,
    z.ZodObject<{
        id: z.ZodNumber;
        params: z.ZodObject<{
            gameId: z.ZodString;
            slot: z.ZodString;
            text: z.ZodString;
        }, z.core.$strict>;
        type: z.ZodLiteral<"saves.write">;
    }, z.core.$strict>,
    z.ZodObject<{
        id: z.ZodNumber;
        params: z.ZodObject<{
            gameId: z.ZodString;
            slot: z.ZodString;
        }, z.core.$strict>;
        type: z.ZodLiteral<"saves.remove">;
    }, z.core.$strict>,
    z.ZodObject<{
        id: z.ZodNumber;
        params: z.ZodObject<{
            store: z.ZodEnum<{
                prefs: "prefs";
                remap: "remap";
            }>;
            value: z.ZodUnknown;
        }, z.core.$strict>;
        type: z.ZodLiteral<"prefs.save">;
    }, z.core.$strict>,
    z.ZodObject<{
        id: z.ZodNumber;
        params: z.ZodObject<{
            sessionId: z.ZodString;
        }, z.core.$strict>;
        type: z.ZodLiteral<"session.token">;
    }, z.core.$strict>,
    z.ZodObject<{
        issue: z.ZodOptional<z.ZodType<SceneIssue, unknown, z.core.$ZodTypeInternals<SceneIssue, unknown>>>;
        jamsState: z.ZodEnum<{
            error: "error";
            loading: "loading";
            ready: "ready";
        }>;
        type: z.ZodLiteral<"state">;
    }, z.core.$strict>,
    z.ZodObject<{
        bytes: z.ZodCustom<ArrayBuffer, ArrayBuffer>;
        contentType: z.ZodString;
        name: z.ZodString;
        type: z.ZodLiteral<"download">;
    }, z.core.$strict>,
    z.ZodObject<{
        issue: z.ZodOptional<z.ZodType<SceneIssue, unknown, z.core.$ZodTypeInternals<SceneIssue, unknown>>>;
        scene: z.ZodString;
        status: z.ZodEnum<{
            applied: "applied";
            failed: "failed";
            ready: "ready";
            refused: "refused";
            staging: "staging";
            waiting: "waiting";
        }>;
        strategy: z.ZodOptional<z.ZodType<SwapStrategy, unknown, z.core.$ZodTypeInternals<SwapStrategy, unknown>>>;
        tick: z.ZodOptional<z.ZodNumber>;
        timing: z.ZodOptional<z.ZodType<SwapTiming, unknown, z.core.$ZodTypeInternals<SwapTiming, unknown>>>;
        type: z.ZodLiteral<"live.state">;
        version: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>
], "type">;
```

## `frameReadySchema`

_const_ in `standalone/host-protocol.ts`

Frame → parent window, the first message.

```ts
declare const frameReadySchema: z.ZodObject<{
    protocol: z.ZodLiteral<1>;
    type: z.ZodLiteral<"jams:frame-ready">;
}, z.core.$strict>;
```

## `hostFeatureSchema`

_const_ in `standalone/host-protocol.ts`

What a frame says it supports in `hello`; absent means none.

```ts
declare const hostFeatureSchema: z.ZodLiteral<"live">;
```

## `hostHandshakeSchema`

_const_ in `standalone/host-protocol.ts`

Page → frame, carrying the port every later message goes over.

```ts
declare const hostHandshakeSchema: z.ZodObject<{
    protocol: z.ZodLiteral<1>;
    type: z.ZodLiteral<"jams:host">;
}, z.core.$strict>;
```

## `hostIssueSchema`

_const_ in `standalone/host-protocol.ts`

A refusal as the engine reports it; the receiver keeps the fields it knows.

```ts
declare const hostIssueSchema: z.ZodType<SceneIssue>;
```

## `hostMessageBytes`

_function_ in `standalone/host-protocol.ts`

The UTF-8 bytes `message` takes as JSON, a `download`'s buffer counted by
its length; `Infinity` for a value JSON can't hold.

```ts
declare function hostMessageBytes(message: unknown): number;
```

## `hostMessageSchema`

_const_ in `standalone/host-protocol.ts`

Every message the page sends after the handshake: a reply to a request, or an event.

```ts
declare const hostMessageSchema: z.ZodDiscriminatedUnion<[
    z.ZodDiscriminatedUnion<[
        z.ZodObject<{
            id: z.ZodNumber;
            ok: z.ZodLiteral<true>;
            result: z.ZodUnknown;
            type: z.ZodLiteral<"reply">;
        }, z.core.$strip>,
        z.ZodObject<{
            id: z.ZodNumber;
            issue: z.ZodType<SceneIssue, unknown, z.core.$ZodTypeInternals<SceneIssue, unknown>>;
            ok: z.ZodLiteral<false>;
            type: z.ZodLiteral<"reply">;
        }, z.core.$strip>
    ], "ok">,
    z.ZodObject<{
        saves: z.ZodObject<{
            describe: z.ZodString;
            limits: z.ZodObject<{
                maxBytes: z.ZodNumber;
                maxSlots: z.ZodNumber;
            }, z.core.$strict>;
            mode: z.ZodEnum<{
                none: "none";
                own: "own";
                site: "site";
            }>;
        }, z.core.$strip>;
        type: z.ZodLiteral<"saves.changed">;
    }, z.core.$strip>,
    z.ZodObject<{
        type: z.ZodLiteral<"pause">;
    }, z.core.$strip>,
    z.ZodObject<{
        type: z.ZodLiteral<"resume">;
    }, z.core.$strip>,
    z.ZodObject<{
        live: z.ZodType<LiveSnapshot, unknown, z.core.$ZodTypeInternals<LiveSnapshot, unknown>>;
        type: z.ZodLiteral<"live.update">;
    }, z.core.$strip>,
    z.ZodObject<{
        type: z.ZodLiteral<"recording.request">;
    }, z.core.$strip>
], "type">;
```

Refers to [`LiveSnapshot`](#livesnapshot).

## `hostRequested`

_function_ in `standalone/host-channel.ts`

Whether the page asked this frame to look for a host: `?host=jams` on its URL.

```ts
declare function hostRequested(href: string | undefined): boolean;
```

## `hostSavesSchema`

_const_ in `standalone/host-protocol.ts`

What the page says about where saves go: shown by a save menu, and the limits `SaveSlots` takes.

```ts
declare const hostSavesSchema: z.ZodObject<{
    describe: z.ZodString;
    limits: z.ZodObject<{
        maxBytes: z.ZodNumber;
        maxSlots: z.ZodNumber;
    }, z.core.$strict>;
    mode: z.ZodEnum<{
        none: "none";
        own: "own";
        site: "site";
    }>;
}, z.core.$strip>;
```

## `liveSceneEntrySchema`

_const_ in `standalone/host-protocol.ts`

```ts
declare const liveSceneEntrySchema: z.ZodType<LiveSceneEntry>;
```

Refers to [`LiveSceneEntry`](#livesceneentry).

## `liveSnapshotSchema`

_const_ in `standalone/host-protocol.ts`

```ts
declare const liveSnapshotSchema: z.ZodType<LiveSnapshot>;
```

Refers to [`LiveSnapshot`](#livesnapshot).

## `liveStateMessageSchema`

_const_ in `standalone/host-protocol.ts`

```ts
declare const liveStateMessageSchema: z.ZodObject<{
    issue: z.ZodOptional<z.ZodType<SceneIssue, unknown, z.core.$ZodTypeInternals<SceneIssue, unknown>>>;
    scene: z.ZodString;
    status: z.ZodEnum<{
        applied: "applied";
        failed: "failed";
        ready: "ready";
        refused: "refused";
        staging: "staging";
        waiting: "waiting";
    }>;
    strategy: z.ZodOptional<z.ZodType<SwapStrategy, unknown, z.core.$ZodTypeInternals<SwapStrategy, unknown>>>;
    tick: z.ZodOptional<z.ZodNumber>;
    timing: z.ZodOptional<z.ZodType<SwapTiming, unknown, z.core.$ZodTypeInternals<SwapTiming, unknown>>>;
    version: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
```

## `manifestRuntimeView`

_function_ in `standalone/manifest-view.ts`

The ProjectRuntimeView (settings, tables, input map, flow) from the shipped doc texts.

```ts
declare function manifestRuntimeView(m: ReleaseManifest, texts: ReadonlyMap<AssetId, string>, game: GameDefinition): ProjectRuntimeView;
```

## `manifestView`

_function_ in `standalone/manifest-view.ts`

A ProjectView over the manifest's assets (entries get `created: { at: 0, by: "release" }`).
Blobs carry their hash, size, import settings and meta, as a snapshot's view does;
docs carry none, so readers tell them apart the same way.

```ts
declare function manifestView(m: ReleaseManifest): ProjectView;
```

## `mirrorRenderState`

_function_ in `standalone/boot.ts`

Mirrors the game's renderer on `root` (default the document's root
element), where the page, its tests and a smoke can read it:
`dataset.jamsRender` is "lost" from `render:lost`, then "restored" or
"rebuilt" from `render:restored`, or "failed" from `render:failed`;
`dataset.jamsRenderFallback` is the
reason ("init" or "lost") once `render:fallback` moved drawing to WebGL.
Listen before `start()`, which tells an init fallback. The returned stop
clears both.

```ts
declare function mirrorRenderState(game: Pick<GameInstance, "off" | "on">, root?: HTMLElement): () => void;
```

## `saveLimitsSchema`

_const_ in `standalone/host-protocol.ts`

```ts
declare const saveLimitsSchema: z.ZodObject<{
    maxBytes: z.ZodNumber;
    maxSlots: z.ZodNumber;
}, z.core.$strict>;
```

## `saveModeSchema`

_const_ in `standalone/host-protocol.ts`

```ts
declare const saveModeSchema: z.ZodEnum<{
    none: "none";
    own: "own";
    site: "site";
}>;
```

## `saveSummarySchema`

_const_ in `standalone/host-protocol.ts`

```ts
declare const saveSummarySchema: z.ZodObject<{
    bytes: z.ZodNumber;
    meta: z.ZodObject<{
        playTicks: z.ZodNumber;
        savedAt: z.ZodNumber;
        scene: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    slot: z.ZodString;
}, z.core.$strip>;
```

## `saveWriteResultSchema`

_const_ in `standalone/host-protocol.ts`

```ts
declare const saveWriteResultSchema: z.ZodUnion<readonly [
    z.ZodObject<{
        bytes: z.ZodNumber;
        ok: z.ZodLiteral<true>;
    }, z.core.$strip>,
    z.ZodObject<{
        issue: z.ZodType<SceneIssue, unknown, z.core.$ZodTypeInternals<SceneIssue, unknown>>;
        ok: z.ZodLiteral<false>;
    }, z.core.$strip>
]>;
```

## `showBootError`

_function_ in `standalone/errors.ts`

The on-page error: the issue's code and message and a Reload button, as plain DOM.

```ts
declare function showBootError(root: HTMLElement, issue: SceneIssue): {
    destroy(): void;
};
```

## `welcomeSchema`

_const_ in `standalone/host-protocol.ts`

The page's answer to `hello`: who plays, where saves go, this browser's stored preferences, whether the game may go online, and the live versions it runs.

```ts
declare const welcomeSchema: z.ZodObject<{
    live: z.ZodOptional<z.ZodNullable<z.ZodType<LiveSnapshot, unknown, z.core.$ZodTypeInternals<LiveSnapshot, unknown>>>>;
    online: z.ZodBoolean;
    player: z.ZodObject<{
        name: z.ZodNullable<z.ZodString>;
        signedIn: z.ZodBoolean;
    }, z.core.$strip>;
    prefs: z.ZodObject<{
        prefs: z.ZodUnknown;
        remap: z.ZodUnknown;
    }, z.core.$strip>;
    saves: z.ZodObject<{
        describe: z.ZodString;
        limits: z.ZodObject<{
            maxBytes: z.ZodNumber;
            maxSlots: z.ZodNumber;
        }, z.core.$strict>;
        mode: z.ZodEnum<{
            none: "none";
            own: "own";
            site: "site";
        }>;
    }, z.core.$strip>;
}, z.core.$strip>;
```

Refers to [`LiveSnapshot`](#livesnapshot).

## `withinHostMessageCap`

_function_ in `standalone/host-protocol.ts`

Whether `message` fits the protocol's caps: 64 KiB, or a download's 16 MiB of bytes.

```ts
declare function withinHostMessageCap(message: unknown): boolean;
```
