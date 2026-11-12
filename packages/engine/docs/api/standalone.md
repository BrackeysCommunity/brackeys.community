# @jams/engine/standalone

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`FetchText`](#fetchtext) · [`StandaloneBootError`](#standalonebooterror) · [`StandaloneGame`](#standalonegame) · [`StandaloneOptions`](#standaloneoptions) · [`bootStandalone`](#bootstandalone) · [`fetchReleaseTexts`](#fetchreleasetexts) · [`manifestRuntimeView`](#manifestruntimeview) · [`manifestView`](#manifestview) · [`showBootError`](#showbooterror)

## `FetchText`

_type_ in `standalone/data.ts`

What the host fetches with: `fetch`, or a stand-in that answers a URL.

```ts
type FetchText = (url: string) => Promise<Response>;
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
    /** Default `browserSaveStore()`; a game's own `saves.store` still wins. */
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
(the promise rejects then). Every URL is resolved against the manifest's
own, which resolves against the document's base URI, and none leaves its
directory.

```ts
declare function bootStandalone(opts: StandaloneOptions): Promise<StandaloneGame>;
```

Refers to [`StandaloneGame`](#standalonegame), [`StandaloneOptions`](#standaloneoptions).

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

## `showBootError`

_function_ in `standalone/errors.ts`

The on-page error: the issue's code and message and a Reload button, as plain DOM.

```ts
declare function showBootError(root: HTMLElement, issue: SceneIssue): {
    destroy(): void;
};
```
