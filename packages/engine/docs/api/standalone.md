# @jams/engine/standalone

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`ConnectHostOptions`](#connecthostoptions) · [`FetchText`](#fetchtext) · [`FrameMessage`](#framemessage) · [`HOST_DOWNLOAD_MAX_BYTES`](#host_download_max_bytes) · [`HOST_HANDSHAKE_TIMEOUT_MS`](#host_handshake_timeout_ms) · [`HOST_MESSAGE_MAX_BYTES`](#host_message_max_bytes) · [`HOST_PROTOCOL_VERSION`](#host_protocol_version) · [`HOST_REQUESTS`](#host_requests) · [`HOST_WELCOME_TIMEOUT_MS`](#host_welcome_timeout_ms) · [`HostChannel`](#hostchannel) · [`HostEvents`](#hostevents) · [`HostMessage`](#hostmessage) · [`HostRequestError`](#hostrequesterror) · [`HostRequestMethod`](#hostrequestmethod) · [`HostRequestParams`](#hostrequestparams) · [`HostRequestResult`](#hostrequestresult) · [`HostSaves`](#hostsaves) · [`HostWelcome`](#hostwelcome) · [`RenderState`](#renderstate) · [`StandaloneBootError`](#standalonebooterror) · [`StandaloneGame`](#standalonegame) · [`StandaloneOptions`](#standaloneoptions) · [`bootStandalone`](#bootstandalone) · [`channelSaveStore`](#channelsavestore) · [`connectHost`](#connecthost) · [`fetchReleaseTexts`](#fetchreleasetexts) · [`frameMessageSchema`](#framemessageschema) · [`frameReadySchema`](#framereadyschema) · [`hostHandshakeSchema`](#hosthandshakeschema) · [`hostIssueSchema`](#hostissueschema) · [`hostMessageBytes`](#hostmessagebytes) · [`hostMessageSchema`](#hostmessageschema) · [`hostRequested`](#hostrequested) · [`hostSavesSchema`](#hostsavesschema) · [`manifestRuntimeView`](#manifestruntimeview) · [`manifestView`](#manifestview) · [`mirrorRenderState`](#mirrorrenderstate) · [`saveLimitsSchema`](#savelimitsschema) · [`saveModeSchema`](#savemodeschema) · [`saveSummarySchema`](#savesummaryschema) · [`saveWriteResultSchema`](#savewriteresultschema) · [`showBootError`](#showbooterror) · [`welcomeSchema`](#welcomeschema) · [`withinHostMessageCap`](#withinhostmessagecap)

## `ConnectHostOptions`

_type_ in `standalone/host-channel.ts`

```ts
type ConnectHostOptions = {
    /** What the frame says in `hello`. */
    hello: {
        engine: string;
        game: string;
        release: Sha256;
    };
    /** How long to wait for the page's port; default `HOST_HANDSHAKE_TIMEOUT_MS`. */
    timeoutMs?: number;
    /** How long to wait for `welcome` once the port arrived; default `HOST_WELCOME_TIMEOUT_MS`. */
    welcomeTimeoutMs?: number;
    /** The frame's window; default the global one. */
    window?: Window;
};
```

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
            game: z.ZodString;
            release: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
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
     * issue, or `save-store-failed` when the channel closes first or the
     * page's result isn't the method's.
     */
    request<M extends HostRequestMethod>(method: M, params: HostRequestParams<M>): Promise<HostRequestResult<M>>;
    /** Reports the game's boot state to the page. */
    state(state: "error" | "loading" | "ready", issue?: SceneIssue): void;
};
```

Refers to [`HostEvents`](#hostevents), [`HostRequestMethod`](#hostrequestmethod), [`HostRequestParams`](#hostrequestparams), [`HostRequestResult`](#hostrequestresult), [`HostWelcome`](#hostwelcome).

## `HostEvents`

_type_ in `standalone/host-protocol.ts`

The events the page sends, by type, as a frame listens for them.

```ts
type HostEvents = {
    "saves.changed": HostSaves;
    pause: undefined;
    resume: undefined;
};
```

Refers to [`HostSaves`](#hostsaves).

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
and its `pause`/`resume` pause the game; when none answers in 2 s the
build plays as it would anywhere else.

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
message is ignored.

```ts
declare function connectHost(opts: ConnectHostOptions): Promise<HostChannel | null>;
```

Refers to [`ConnectHostOptions`](#connecthostoptions), [`HostChannel`](#hostchannel).

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
    }, z.core.$strip>
], "type">;
```

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

The page's answer to `hello`: who plays, where saves go, this browser's stored preferences, and whether the game may go online.

```ts
declare const welcomeSchema: z.ZodObject<{
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

## `withinHostMessageCap`

_function_ in `standalone/host-protocol.ts`

Whether `message` fits the protocol's caps: 64 KiB, or a download's 16 MiB of bytes.

```ts
declare function withinHostMessageCap(message: unknown): boolean;
```
