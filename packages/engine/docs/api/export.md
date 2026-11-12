# @jams/engine/export

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`BudgetContent`](#budgetcontent) · [`BudgetContributor`](#budgetcontributor) · [`BuiltCode`](#builtcode) · [`CREDITS_FILE`](#credits_file) · [`ContentPlan`](#contentplan) · [`DEFAULT_BUILD_TARGET`](#default_build_target) · [`DEFAULT_EXPORT_BUDGET`](#default_export_budget) · [`DEFAULT_ZIP_TARGET`](#default_zip_target) · [`EXPORT_TARGETS`](#export_targets) · [`ExportIcon`](#exporticon) · [`ExportIconSize`](#exporticonsize) · [`ExportInput`](#exportinput) · [`ExportPlan`](#exportplan) · [`ExportTargetDef`](#exporttargetdef) · [`INDEX_HTML_FILE`](#index_html_file) · [`ITCH_LIMITS`](#itch_limits) · [`PlannedFile`](#plannedfile) · [`SERVICE_WORKER_FILE`](#service_worker_file) · [`WEB_MANIFEST_FILE`](#web_manifest_file) · [`assetCredits`](#assetcredits) · [`budgetIssues`](#budgetissues) · [`checkItchLayout`](#checkitchlayout) · [`crc32`](#crc32) · [`defaultIconPng`](#defaulticonpng) · [`exportTarget`](#exporttarget) · [`exportTargetNames`](#exporttargetnames) · [`finishExport`](#finishexport) · [`formatBytes`](#formatbytes) · [`iconFile`](#iconfile) · [`measureBudget`](#measurebudget) · [`planContent`](#plancontent) · [`planIcons`](#planicons) · [`renderCredits`](#rendercredits) · [`renderIndexHtml`](#renderindexhtml) · [`renderServiceWorker`](#renderserviceworker) · [`renderWebManifest`](#renderwebmanifest) · [`resolveExportBudget`](#resolveexportbudget) · [`serviceWorkerCacheName`](#serviceworkercachename) · [`serviceWorkerPrecache`](#serviceworkerprecache) · [`zipFiles`](#zipfiles)

## `BudgetContent`

_type_ in `export/budget.ts`

What the budget reads of a content plan; a manifest's `flow`, `projectBundle` and `assets` give the same.

```ts
type BudgetContent = Pick<ContentPlan, "assets" | "projectBundle" | "scenes" | "start">;
```

Refers to [`ContentPlan`](#contentplan).

## `BudgetContributor`

_type_ in `export/budget.ts`

One file counted against a budget, largest first in an issue.

```ts
type BudgetContributor = {
    asset?: AssetId;
    bytes: number;
    path: string;
};
```

## `BuiltCode`

_type_ in `export/plan.ts`

The bundler's output, hashed.

```ts
type BuiltCode = {
    entry: string;
    files: readonly {
        bytes: number;
        path: string;
        role: "code" | "style" | "wasm";
        sha256: Sha256;
    }[];
    rapier: ReleaseManifest["build"]["rapier"];
    thirdParty: readonly ThirdPartyLicence[];
};
```

## `CREDITS_FILE`

_const_ in `project/release.ts`

The credits page every build ships, next to its `index.html`.

```ts
declare const CREDITS_FILE = "credits.html";
```

## `ContentPlan`

_type_ in `export/plan.ts`

Everything the bundler needs before it runs: what ships, and whether Rapier does.

```ts
type ContentPlan = {
    assets: Readonly<Record<AssetId, ReleaseAsset>>;
    credits: Omit<ReleaseManifest["credits"], "code">;
    issues: readonly SceneIssue[];
    needsRapier: boolean;
    projectBundle: ReleaseManifest["projectBundle"];
    pwa: ReleaseManifest["pwa"];
    scenes: readonly ReleaseScene[];
    start: AssetId;
    time: ReleaseManifest["time"];
};
```

## `DEFAULT_BUILD_TARGET`

_const_ in `export/targets.ts`

The target `game build` builds when none is given.

```ts
declare const DEFAULT_BUILD_TARGET: ReleaseTarget;
```

## `DEFAULT_EXPORT_BUDGET`

_const_ in `export/budget.ts`

The size budgets a build is held to unless the project file's `export.budget` overrides one.

```ts
declare const DEFAULT_EXPORT_BUDGET: ExportBudget;
```

## `DEFAULT_ZIP_TARGET`

_const_ in `export/targets.ts`

The target `game export --zip` builds when none is given.

```ts
declare const DEFAULT_ZIP_TARGET: ReleaseTarget;
```

## `EXPORT_TARGETS`

_const_ in `export/targets.ts`

The targets this engine builds, one row each: the only place a target's
name decides anything. A target with no row is `export-target-unsupported`.

```ts
declare const EXPORT_TARGETS: Readonly<Partial<Record<ReleaseTarget, ExportTargetDef>>>;
```

Refers to [`ExportTargetDef`](#exporttargetdef).

## `ExportIcon`

_type_ in `export/icons.ts`

One shipped icon: the project's texture, or the engine's default.

```ts
type ExportIcon = {
    /** `icons/icon-<size>.png`. */
    file: string;
    size: ExportIconSize;
    source: {
        bytes: number;
        id: AssetId;
        kind: "asset";
        sha256: Sha256;
    } | {
        kind: "default";
    };
};
```

Refers to [`ExportIconSize`](#exporticonsize).

## `ExportIconSize`

_type_ in `export/icons.ts`

The icon sizes a build ships.

```ts
type ExportIconSize = 192 | 512;
```

## `ExportInput`

_type_ in `export/plan.ts`

Everything an export is planned from.

```ts
type ExportInput = {
    /** The project's game-settings `engine` block. */
    engine: Readonly<Record<string, unknown>>;
    game: GameDefinition;
    kinds: KindRegistry;
    project: ProjectFile;
    registry: Registry;
    /** The snapshot taken at build time (`snapshotProject`). */
    snapshot: ProjectSnapshot;
    target: ReleaseTarget;
    /** Canonical texts of every doc asset, by id. */
    texts: ReadonlyMap<AssetId, string>;
    view: ProjectView;
};
```

## `ExportPlan`

_type_ in `export/plan.ts`

```ts
type ExportPlan = {
    files: readonly PlannedFile[];
    issues: readonly SceneIssue[];
    manifest: ReleaseManifest;
};
```

Refers to [`PlannedFile`](#plannedfile).

## `ExportTargetDef`

_type_ in `export/targets.ts`

Everything that differs between export targets.

```ts
type ExportTargetDef = {
    /** Run over the planned files; its issues join the plan's. null: no check. */
    layout: ((files: readonly {
        bytes: number;
        path: string;
    }[]) => SceneIssue[]) | null;
    /** `sw.js` and `app.webmanifest` are planned (when `export.pwa` isn't false) and `manifest.pwa` is set. */
    pwa: boolean;
};
```

## `INDEX_HTML_FILE`

_const_ in `project/release.ts`

The page every build opens at.

```ts
declare const INDEX_HTML_FILE = "index.html";
```

## `ITCH_LIMITS`

_const_ in `export/itch.ts`

itch.io's limits on an HTML5 upload, as https://itch.io/docs/creators/html5
("ZIP file requirements") states them, read 2026-11-11: at most 1,000
files after extraction, 500MB extracted in all, 200MB for any one file,
240 characters for a file's name including its path. The page says "MB"
without a base, so the byte counts take the smaller, decimal reading.

```ts
declare const ITCH_LIMITS: {
    maxFileBytes: number;
    maxFiles: number;
    maxPathLength: number;
    maxTotalBytes: number;
};
```

## `PlannedFile`

_type_ in `export/plan.ts`

One file the export writes, and where its bytes come from.

```ts
type PlannedFile = {
    path: string;
    role: ReleaseFile["role"];
    source: {
        bytes: Uint8Array;
        kind: "bytes";
    } | {
        kind: "blob";
        sha256: Sha256;
    } | {
        kind: "built";
        path: string;
    } | {
        kind: "text";
        text: string;
    };
};
```

## `SERVICE_WORKER_FILE`

_const_ in `project/release.ts`

The service worker a PWA build registers, next to its page.

```ts
declare const SERVICE_WORKER_FILE = "sw.js";
```

## `WEB_MANIFEST_FILE`

_const_ in `project/release.ts`

The web app manifest a PWA build links from its page.

```ts
declare const WEB_MANIFEST_FILE = "app.webmanifest";
```

## `assetCredits`

_function_ in `export/credits.ts`

Shipped blobs grouped by identical licence, each group's assets sorted
and the groups by their first asset; the blobs with none are `missing`,
each with one `licence-missing` (warn). Docs are the project's own
writing and carry no licence of their own, so they aren't credited.

```ts
declare function assetCredits(assets: Readonly<Record<AssetId, ReleaseAsset>>): {
    credits: Omit<ReleaseManifest["credits"], "code">;
    issues: SceneIssue[];
};
```

## `budgetIssues`

_function_ in `export/budget.ts`

One `export-over-budget` per budget `report.over` names: the budget, the
measured size, the limit (the project's override already applied in
`report.limits`) and the largest contributors.

```ts
declare function budgetIssues(report: ExportBudgetReport, files: readonly ReleaseFile[], content: BudgetContent): SceneIssue[];
```

Refers to [`BudgetContent`](#budgetcontent).

## `checkItchLayout`

_function_ in `export/itch.ts`

itch.io's HTML5 layout over a build's files: the counts and sizes in
`ITCH_LIMITS`, `index.html` at the root, nothing outside the root folder,
no `__MACOSX` or dotfiles. Each failure is `export-itch-layout`.

```ts
declare function checkItchLayout(files: readonly {
    bytes: number;
    path: string;
}[]): SceneIssue[];
```

## `crc32`

_function_ in `export/crc32.ts`

The CRC-32 (IEEE 802.3) of `bytes`, as zip and PNG use it; pass `crc` to continue a running one.

```ts
declare function crc32(bytes: Uint8Array, crc?: number): number;
```

## `defaultIconPng`

_function_ in `export/icons.ts`

The engine's default icon of `size`: an 8-bit palette PNG built in code, byte-identical on every run.

```ts
declare function defaultIconPng(size: ExportIconSize): Uint8Array;
```

Refers to [`ExportIconSize`](#exporticonsize).

## `exportTarget`

_function_ in `export/targets.ts`

A target's row, or undefined when this engine doesn't build it.

```ts
declare function exportTarget(target: ReleaseTarget): ExportTargetDef | undefined;
```

Refers to [`ExportTargetDef`](#exporttargetdef).

## `exportTargetNames`

_function_ in `export/targets.ts`

The targets with a row, in table order.

```ts
declare function exportTargetNames(): ReleaseTarget[];
```

## `finishExport`

_function_ in `export/plan.ts`

Joins the content plan and the built code into the manifest and every
file to write, measures the budget and ends with `checkReleaseManifest`.
The shell files are rendered from the manifest before their own rows
are known: a renderer reads every path in `build.files`, never a shell
file's hash or size, nor the budget.

```ts
declare function finishExport(content: ContentPlan, code: BuiltCode, input: ExportInput, budget?: Partial<ExportBudget>): Promise<ExportPlan>;
```

Refers to [`BuiltCode`](#builtcode), [`ContentPlan`](#contentplan), [`ExportInput`](#exportinput), [`ExportPlan`](#exportplan).

## `formatBytes`

_function_ in `project/format-bytes.ts`

A byte count as people read it, KiB-based as the engine measures: `512 B`, `14 KB`, `2.3 MB`.

```ts
declare function formatBytes(bytes: number): string;
```

## `iconFile`

_const_ in `export/icons.ts`

Where an icon of `size` ships in every build.

```ts
declare const iconFile: (size: ExportIconSize) => string;
```

Refers to [`ExportIconSize`](#exporticonsize).

## `measureBudget`

_function_ in `export/budget.ts`

The build's sizes by role against `limits`. `firstLoadBytes` is code,
plus wasm when the start scene needs Rapier, plus the project bundle, the
start scene's bundle and the data texts fetched at boot. `over` names each
budget exceeded, in `ExportBudget`'s order.

```ts
declare function measureBudget(files: readonly ReleaseFile[], content: BudgetContent, limits: ExportBudget): ExportBudgetReport;
```

Refers to [`BudgetContent`](#budgetcontent).

## `planContent`

_function_ in `export/content.ts`

What ships: every scene the scene list holds, every prefab they expand,
the runtime docs and the blobs of their bundles and the project bundle,
with whatever those reference. The only place an export chooses its
content. Its issues: the target, the list's start, each listed scene's
parse and bundle, `scene-unlisted` for checks naming a scene flow can't
go to, references out of shipped assets that don't resolve, the icons,
and `licence-missing` once per shipped blob without one.

```ts
declare function planContent(input: ExportInput): Promise<ContentPlan>;
```

Refers to [`ContentPlan`](#contentplan), [`ExportInput`](#exportinput).

## `planIcons`

_function_ in `export/icons.ts`

The project's `export.icons`, checked by meta (exactly a 192×192 or
512×512 PNG); a named icon that isn't one falls back to the default with
`export-asset-missing` at warn. An omitted icon is the default, quietly.

```ts
declare function planIcons(input: {
    project: ProjectFile;
    view: ProjectView;
}): {
    icons: ExportIcon[];
    issues: SceneIssue[];
};
```

Refers to [`ExportIcon`](#exporticon).

## `renderCredits`

_function_ in `export/credits.ts`

`credits.html`: the game's name, its assets grouped by licence (each
group's attribution, author, source, SPDX id and asset names), the
assets with no licence recorded, each shipped package with its notice,
and the engine's version, then a "Play the game" link to `index.html`
(it opens the game; a page reached from a running game's new tab is
closed to return). No script and no style, so it reads the same under
any CSP and in either colour scheme.

```ts
declare function renderCredits(m: ReleaseManifest): string;
```

## `renderIndexHtml`

_function_ in `export/html.ts`

`index.html`: the project's name as the title, a viewport meta, the
theme colour and the web manifest link when the build is a PWA, the
build's stylesheets and icons, `<div id="game">`, one module script for
`build.entry` and a `<noscript>` line. No inline script or style and no
absolute URL, so a strict CSP and any static host serve it unchanged.

```ts
declare function renderIndexHtml(m: ReleaseManifest, opts: {
    styles: readonly string[];
}): string;
```

## `renderServiceWorker`

_function_ in `export/service-worker.ts`

`sw.js`, a plain script with its file list inline: `install` precaches
the build, `activate` deletes this project's other caches, and `fetch`
answers the build's files (a request for the directory is `index.html`),
leaving every other request to the network. Its state lives in one
closure, so nothing leaks onto the worker's global scope.

```ts
declare function renderServiceWorker(m: ReleaseManifest): string;
```

## `renderWebManifest`

_function_ in `export/web-manifest.ts`

`app.webmanifest` from the manifest's `pwa`, every URL relative to the
manifest itself so the build installs from whatever directory serves it.
Throws for a manifest with no `pwa`: its target ships no web manifest.

```ts
declare function renderWebManifest(m: ReleaseManifest): string;
```

## `resolveExportBudget`

_function_ in `export/budget.ts`

The limits a build is held to: the defaults, then each override in turn
(the project file's `export.budget`, then the caller's), skipping fields
an override leaves out.

```ts
declare function resolveExportBudget(...overrides: readonly (Partial<ExportBudget> | undefined)[]): ExportBudget;
```

## `serviceWorkerCacheName`

_const_ in `export/service-worker.ts`

`jams-<project>-<build.hash 12>-<snapshot 12>`: a new build or new content is a new cache.

```ts
declare const serviceWorkerCacheName: (m: ReleaseManifest) => string;
```

## `serviceWorkerPrecache`

_function_ in `export/service-worker.ts`

Every path `sw.js` precaches: each of `build.files` and `release.json`, sorted.

```ts
declare function serviceWorkerPrecache(m: ReleaseManifest): string[];
```

## `zipFiles`

_function_ in `export/zip.ts`

Stored entries, sorted by path, DOS time 1980-01-01 00:00, no extra
fields, CRC-32 in TypeScript: the same files give the same bytes on every
runtime. Throws on a duplicate path or a zip that would need zip64.

```ts
declare function zipFiles(files: readonly {
    bytes: Uint8Array;
    path: string;
}[]): Uint8Array;
```
