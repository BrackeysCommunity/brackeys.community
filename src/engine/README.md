# @jams/engine

A game-agnostic 2D engine for the web: [Pixi](https://pixijs.com) v8 draws,
[Rapier](https://rapier.rs) 2D simulates, and levels are plain JSON scene
files that people, agents and the disk can edit together. A game registers
its entity types, actions and hooks; the engine loads its scenes, steps them
in a browser or headless, validates them with machine-readable issue codes,
and edits them through a small command language (`SceneOp`) that also runs on
a shared [Yjs](https://yjs.dev) document.

This is 0.1. `./editor`, `./game` and `./headless` are `@experimental`: they
may change in any 0.x minor. The scene format (`v: 1`), the issue codes, the
ops and the JSON Schemas are versioned contracts (see
[Versioning](#versioning)).

## Install

0.x isn't on a registry. Each release attaches a tarball to its GitLab
release (tag `engine-vX.Y.Z`); install it by path or URL:

```sh
bun add ./jams-engine-0.3.0.tgz
bun add pixi.js @dimforge/rapier2d @tanstack/store zod yjs fractional-indexing
```

Everything the engine uses is a peer dependency, so the host owns one copy of
each:

| Peer                        | Range            | Needed for                                                               |
| --------------------------- | ---------------- | ------------------------------------------------------------------------ |
| `pixi.js`                   | `^8.17.1`        | the browser shell and `./debug`; the host owns the canvas                |
| `@dimforge/rapier2d`        | `^0.19.3`        | physics; the host injects it (below), the engine imports only its types  |
| `@dimforge/rapier2d-compat` | `^0.19.3`        | optional: the flavour to inject under Bun or Node                        |
| `@tanstack/store`           | `>=0.8.1 <0.9.0` | the shell's and the editor's stores                                      |
| `zod`                       | `^4.1.11`        | scene and op schemas; a game's entity fields are Zod shapes              |
| `yjs`                       | `^13.6.33`       | `./collab` and `./editor`, the shared scene document                     |
| `fractional-indexing`       | `^4.0.0`         | entity order in the shared document                                      |
| `@hocuspocus/server`        | `^4.7.0`         | optional: only `./vite`'s dev server imports it, on the first connection |

The package is ESM only and has no side effects on import.

| Entry                   | What it holds                                                                                                                                              | Runtime peers                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `@jams/engine`          | `createGame`, the browser shell: renderer, camera, input, the tool router and the store selectors                                                          | pixi.js, @tanstack/store          |
| `@jams/engine/scene`    | the scene format: parse, migrate, format, hash, expand, validate, issue codes, `applyOps`, diffs, the JSON Schemas                                         | zod                               |
| `@jams/engine/game`     | the authoring API: `defineGame`, `defineEntityType`, `createRegistry`, field helpers and the primitive systems                                             | zod                               |
| `@jams/engine/headless` | a DOM- and Pixi-free runtime: `createHeadlessRuntime`, `runProbe`, input scripts, `runPlaytest`, `fuzz`, `validatePhysical`, `runChecks`                   | zod                               |
| `@jams/engine/collab`   | the shared `Y.Doc` layout, `sceneToDoc`/`docToScene`, `applyOpsToDoc`, undo, revert, binding and presence                                                  | yjs, fractional-indexing, zod     |
| `@jams/engine/editor`   | the editor without UI: `createEditorSession`, the keymap, `createToolHost` and its tools, picking, snapping, gizmos, the clipboard and the inspector model | yjs, @tanstack/store, zod         |
| `@jams/engine/debug`    | `createDebugOverlay`, the F3 overlay; pass it only in dev builds                                                                                           | pixi.js                           |
| `@jams/engine/vite`     | Node only: `sceneCollabServer`, a dev-server plugin that co-edits a project's files                                                                        | node builtins, @hocuspocus/server |
| `@jams/engine/sim-kit`  | the seeded `Rng`, `digest32` and fixed-point maths, with no dependencies                                                                                   | none                              |

The JSON Schemas ship as files too: `@jams/engine/schemas/scene.schema.json`,
`@jams/engine/schemas/ops.schema.json`,
`@jams/engine/schemas/input-script.schema.json` and
`@jams/engine/schemas/recording.schema.json`.

## Rapier is injected

The engine never imports Rapier. The host passes the module, so it picks the
flavour and when the wasm loads:

- **Browsers:** the standard `@dimforge/rapier2d`, loaded lazily with
  `rapier: () => import("@dimforge/rapier2d")`. A Vite host needs
  `vite-plugin-wasm`.
- **Bun and Node:** `@dimforge/rapier2d-compat`, which inlines its wasm. Call
  its `init()` first and pass the module through a cast; its classes are the
  standard build's.

Both flavours step a scene bit for bit alike; the engine's parity test checks
it.

## Registering entity types

A scene's entities are typed by the registry: six primitives the engine
always has (`solid`, `sensor`, `marker`, `prop`, `follower`, `note`) plus the
game's own types. A game type either names a primitive as its `base`, so the
primitive's system spawns it, or brings its own `system`.

```ts coin-game.ts
import { defineEntityType, defineGame, primitiveFields, SENSOR_ENTER } from "@jams/engine/game";
import { z } from "zod";

/** A coin is a sensor with a value; anything entering it collects it. */
const coin = defineEntityType({
  type: "coin",
  description: "A coin: collected when something enters it.",
  base: "sensor",
  fields: (env) => ({
    ...primitiveFields("sensor", env),
    value: z.number().int().positive().default(1).describe("Points the coin is worth."),
  }),
  style: { fill: 0xffd700, stroke: 0xffd700 },
});

export type CoinSnapshot = { score: number; left: number };

export const coinGame = defineGame<CoinSnapshot>({
  id: "coin-game",
  types: [coin],
  actions: [
    { action: "left", keys: ["a", "arrowleft"], description: "Walk left." },
    { action: "right", keys: ["d", "arrowright"], description: "Walk right." },
  ],
  // Props (the engine's dynamic group) don't touch sensors unless a game says so.
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  createRuntime() {
    const values = new Map<string, number>();
    let score = 0;
    return {
      onLoad(scene) {
        score = 0;
        values.clear();
        for (const e of scene.entities) {
          if (e.type === "coin") values.set(e.id, Number(e.value));
        }
      },
      afterStep(_dtMs, events) {
        for (const event of events) {
          const value = event.type === SENSOR_ENTER && values.get(event.entityId ?? "");
          if (!value) continue;
          score += value;
          values.delete(event.entityId!);
        }
      },
      snapshot: () => ({ score, left: values.size }),
    };
  },
  play: {
    results: ["won"],
    // After every tick; a result ends a playtest, null keeps it going.
    outcome: ({ snapshot }) => (snapshot.left === 0 ? { result: "won" } : null),
  },
});
```

`createRegistry(coinGame)` builds the registry that parses, validates and
expands this game's scenes; its JSON Schema (`sceneJsonSchema(registry)`)
describes the `coin` type next to the primitives. A scene names its game with
a top-level `"game": "coin-game"`; one without a `game` key uses the
primitives only.

## A minimal host

```ts browser-host.ts
import { createGame, type GameInstance } from "@jams/engine";
import { parseSceneOrThrow } from "@jams/engine/scene";

import { coinGame } from "./coin-game";

export async function startCoinGame(
  canvas: HTMLCanvasElement,
  sceneText: string,
  dev: boolean,
): Promise<GameInstance> {
  // Imported only in dev, so a production bundle never holds the overlay.
  const debug = dev ? (await import("@jams/engine/debug")).createDebugOverlay : undefined;
  const game = await createGame(canvas, {
    game: coinGame,
    rapier: () => import("@dimforge/rapier2d"),
    displayWidth: canvas.clientWidth,
    displayHeight: canvas.clientHeight,
    dev,
    debug,
  });
  const report = game.loadScene(parseSceneOrThrow(sceneText, game.registry));
  if (!report.ok) throw new Error(`the scene didn't load: ${report.error}`);
  game.start();
  return game;
}
```

`createGame` makes the canvas focusable and reads keys and pointer events
from it. `game.getStore()` is a `@tanstack/store` `Store` that the
`select*` helpers read (`selectPhase`, `selectFPS`, `selectMode`, …), and
`game.runtime()` hands over the loaded scene's runtime for entity-level
edits. Call `game.destroy()` when the canvas goes away.

An editor host switches between an edit world and a play world.
`game.play(doc, { at })` validates the document (errors block and come back
in the report), builds a fresh world from a frozen copy, and starts at the
game's spawn or, with `at`, on the first surface below that point;
`game.stop()` throws the play world away and rebuilds the edit world with
the editor's camera. `pause`, `resume`, `step` and `setTimeScale` drive the
loop, and `./editor`'s `createKeymap` resolves the editor's keys per scope.

## Headless

`./headless` loads and steps a scene without a DOM, Pixi or a store, for
tests, tools and agents. `runProbe` steps a scripted run and reports every
event, the game's final snapshot and its outcome:

```ts headless-probe.ts
import { readFileSync } from "node:fs";

import RAPIER from "@dimforge/rapier2d-compat";
import { createRegistry } from "@jams/engine/game";
import { runProbe, type RapierModule } from "@jams/engine/headless";
import { expandScene, parseSceneOrThrow } from "@jams/engine/scene";

import { coinGame } from "./coin-game";

await RAPIER.init();
const rapier = RAPIER as unknown as RapierModule;

const registry = createRegistry(coinGame);
const def = parseSceneOrThrow(readFileSync("scenes/first.json", "utf8"), registry);

const report = runProbe({
  rapier,
  game: coinGame,
  registry,
  scene: expandScene(def, registry),
  ticks: 600,
  hold: ["right"],
  inputs: [[300, "right", 0]],
});
console.log(report.final, report.outcome, `${report.events.length} events`);
```

Runs are deterministic: the same scene, script, engine version and game
tuning (`report.configHash`) give the same report. `createHeadlessRuntime`
gives the runtime itself, with `step(dtMs, actions)`, `snapshot()`,
`stats()` and the entity-level `add`, `update` and `remove`.

### Playtests and fuzz

`runPlaytest` starts a world the way the editor's Play does and plays an
input script; `fuzz` plays seeded random macros and reports what the
rollouts touched:

```ts headless-playtest.ts
import { readFileSync } from "node:fs";

import RAPIER from "@dimforge/rapier2d-compat";
import { createRegistry } from "@jams/engine/game";
import { fuzz, runPlaytest, type RapierModule } from "@jams/engine/headless";
import { parseSceneOrThrow } from "@jams/engine/scene";

import { coinGame } from "./coin-game";

await RAPIER.init();
const rapier = RAPIER as unknown as RapierModule;

const registry = createRegistry(coinGame);
const scene = parseSceneOrThrow(readFileSync("scenes/first.json", "utf8"), registry);

const run = runPlaytest({
  rapier,
  game: coinGame,
  registry,
  scene,
  script: {
    v: 1,
    steps: [
      { hold: ["right"], until: { event: "sensor:enter" }, max: 300 },
      { wait: 30 },
      { hold: ["left"], forMs: 2000 },
    ],
  },
});
if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.scriptIssues)}`);
console.log(
  run.outcome.result,
  `at tick ${run.outcome.tick}`,
  `${run.trail.pts.length} trail points`,
);

const coverage = fuzz({ rapier, game: coinGame, registry, scene, seed: "first", rollouts: 50 });
if (!coverage.blocked) {
  for (const t of coverage.touched) console.log(`${t.ref}: ${t.reached} of ${coverage.rollouts}`);
  console.log(`never touched: ${coverage.untouched.join(", ") || "none"}`);
}
```

- A script step names everything held during it (`hold`, `press`, `wait`)
  and lasts `for` ticks, `forMs`, or `until` every key of a clause holds:
  the engine's `event` and `tick`, or a predicate the game declares in
  `play.predicates`. `compileInputScript` checks a script and turns it into
  `[tick, action, pressed]` edges; `inputScriptJsonSchema(registry)`
  describes a game's scripts.
- The outcome comes from the game's `play.outcome`; otherwise a run ends as
  `timeout`, `script-end`, or `stuck` (under 4px of movement over 120 ticks
  while one of the game's `play.movementActions` is held).
- The same seed gives the same fuzz report, apart from `timing`.

### Recordings and replay

Every playtest's report carries a `recording`, and every Play in the
browser makes one (`GameInstance.recording()`, the `play:recorded` event):
how the world started, each input edge as `[tick, actionIndex, pressed]`
against an `actions` name table, the focus trail every 4 ticks, the game's
markers (`play.markers`, or every event), the outcome and `end`, a digest of
the game's snapshot after the last tick. `replayRecording({ rapier, game,
scene, recording })` steps the same edges on the same ticks and reports
whether the run `matches` (same result, ticks and end digest) or how it
diverged; a changed scene (`stale`), other tuning, engine version or physics
build is a warning, not a block. `GameInstance.replay(doc, recording)` plays
one in the browser in place of the keyboard and pauses on its last tick.

Replays are exact on the same build: the determinism probe
(`src/engine/__tests__/probes/`) gets bit-identical results from
`rapier2d`, `rapier2d-compat` and `rapier2d-deterministic-compat` on macOS
and Linux, under Node and Bun. Input a game reads outside the action
stream (a pointer a play-mode tool follows) isn't recorded, so a replay of
a run that used it diverges, and says so.

### Physical validation and checks

`validatePhysical({ rapier, scene, registry })` loads a scene into a world
that is never stepped and reports what needs physics: a path follower, or
a solid riding it, swept along the path into a solid
(`follower-hits-solid`), overlapping solids
(`solid-overlap`), then the game's `physicalChecks`, which get shape
queries (`overlaps`, `cast`) over that world.

A `<scene>.checks.json` beside a scene lists what must stay true of it,
outside the scene's hash; `runChecks` runs it. The engine's kinds are
`valid` (no issues at or above a severity, optionally physical),
`reaches` (an input script ends in a given result) and `touches` (fuzz
reaches an entity in at least N rollouts); a game adds `<id>/<kind>` kinds
in `checks`.

## Editor tools

`./editor` has no UI, so any host can draw it. `createToolHost({ session,
router, toWorld, scale, runtime })` puts the active tool on the game's tool
router: tools get world-space pointer events, preview a drag in the
running edit world, commit one batch per gesture, and describe what to draw
(outlines, handles, a marquee, guides, ghosts, a readout) as a
`ToolOverlay`. The built-in tools are select, pan, box, circle, pen,
waypoints and rotate. A game adds its own in `GameDefinition.editor.tools`,
a lazy loader so editor code stays out of its play bundle, and binds them
with edit-scope `editorKeys` whose command is `tool:<id>`;
`placementEditorTool` builds one from a list of shapes to place. Fields a
game marks with `meta.widget` render with the widget it describes in
`editor.widgets`.

## Scenes as data

`./scene` reads and writes scene files without loading anything:

```ts scene-tools.ts
import { createRegistry } from "@jams/engine/game";
import { applyOps, formatScene, parseScene, sceneHash, validateScene } from "@jams/engine/scene";

import { coinGame } from "./coin-game";

const registry = createRegistry(coinGame);

/** Moves a coin 32px right and returns the canonical text, or the issues that stopped it. */
export function nudgeCoin(text: string, id: string): string | string[] {
  const parsed = parseScene(text, registry);
  if (!parsed.ok) return parsed.issues.map((i) => `${i.code}: ${i.message}`);

  const result = applyOps(parsed.def, { ops: [{ op: "move", refs: [id], by: [32, 0] }] }, registry);
  if (!result.ok) return [`${result.issue.code}: ${result.issue.message}`];

  const warnings = validateScene(result.def, registry).filter((i) => i.severity !== "error");
  for (const w of warnings) console.warn(`${w.code} at ${w.path}: ${w.message}`);
  console.log(`${sceneHash(parsed.def)} → ${result.hash}`);
  return formatScene(result.def).text;
}
```

- `parseScene` never throws: it returns `{ ok, def, issues }`, migrating an
  older `v` on the way. `parseSceneOrThrow` is the host's shorthand.
- `formatScene` writes the canonical text (stable key order, one entity per
  line), so a scene saved by any tool diffs cleanly.
- Every issue has a stable `code` (`ISSUE_CODES` lists them with their
  severity and hint), a JSON Pointer `path`, and often a `fix`: an op batch
  that repairs it.
- `applyOps` is pure and returns the new document, its hash and the inverse
  batch. `diffScenes` and `diffToOps` go the other way.
- `sceneJsonSchema(registry)` and `opsJsonSchema(registry)` describe a game's
  files and batches; editors pick the schema up from a scene's `$schema`.

`renderSceneSvg` and `renderSceneAscii` draw a scene as a schematic, with
ids, axis ticks and each type's colors or characters, so a person or an
agent can see a level without a browser:

```ts scene-render.ts
import { createRegistry } from "@jams/engine/game";
import { parseSceneOrThrow, renderSceneAscii, renderSceneSvg } from "@jams/engine/scene";

import { coinGame } from "./coin-game";

const registry = createRegistry(coinGame);

/** A labelled schematic of the area around one entity, and the whole scene as text. */
export function picture(text: string, around: string): { svg: string; ascii: string } {
  const scene = parseSceneOrThrow(text, registry);
  return {
    svg: renderSceneSvg(scene, { registry, around, margin: 200, labels: "entities" }),
    ascii: renderSceneAscii(scene, { registry }),
  };
}
```

The SVG's longest side is capped at 1600px; pass `region`, or `around` a ref
with a `margin`, to look closer, and `overlay` a playtest report to draw its
trail, events and outcome.

### Groups and prefabs

A scene can declare **groups** and place **prefabs**:

```json
{
  "v": 2,
  "name": "gates",
  "bounds": [0, 0, 2000, 1000],
  "groups": {
    "east": { "at": [1200, 0] }
  },
  "instances": [
    { "id": "gate-1", "prefab": "gate", "at": [600, 900] },
    {
      "id": "gate-2",
      "prefab": "gate",
      "group": "east",
      "at": [200, 900],
      "overrides": { "door.path.speed": 140 }
    }
  ],
  "entities": [
    { "id": "east-post", "type": "solid", "group": "east", "shape": ["box", 500, 900, 10, 60] }
  ]
}
```

- A group's members store their geometry relative to its `at`, so moving
  the group is one integer edit. There is no rotation or scale.
- A prefab is `prefabs/<id>.json` beside the scene: `{ "kind": "prefab",
"v": 2, "id", "entities", "bulk"? }` around a local origin. An instance
  puts that origin at `at` (inside its group's frame); its children load
  as `gate-1/door` (bulk children `gate-1/~solid:0`), and references
  between them follow.
- `overrides` hold the fields one instance changes, keyed
  `<child>.<field.path>`, in the prefab's frame. Ops edit them
  (`override`, `revertOverride`), fold them into the prefab
  (`applyToPrefab`), turn an instance back into plain entities (`unpack`),
  or make a prefab from entries (`createPrefab`).
- Hosts load the library: `expandScene(def, registry, { prefabs })`, and
  the same `prefabs` option on `validateScene`, `applyOps`, the headless
  runs and the renders. `resolveScene` gives the scene with instances
  inlined and groups applied; that view is what tools pick and draw, and
  `toSourceBatch` maps an edit made on it back onto the document.
- Prefabs are docs of their own (`prefabToDoc`/`docToPrefab`, `./collab`);
  a scene's session reads them through a `PrefabSource`
  (`sessionPrefabSource(projectSession, { scene })` live,
  `staticPrefabSource(library)` for files). To edit a prefab on its own,
  `await openPrefabIsolation(session, "gate")` (`./editor`) gives a
  session over the prefab's doc at its local coordinates. Every instance
  follows its edits, collaborators in the prefab see each other, and the
  project's one undo stack covers it. Bind the edit world to
  `isolation.session.doc` while it's open and call `close()` to go back.
  Without a project, Apply to prefab, Create prefab and Unpack are
  refused.
- `attach: "<follower id>"` on a solid or sensor puts its collider on that
  follower's body, so it rides along; riders on it move by the follower's
  `frameDelta` (`carrierDelta`).

## Projects and assets

A project is a directory holding a `jams.project.json` (`id`, `name`,
`game` with the module and export that define it, and `assets`, `code` and
`ignore` globs), and every file under it is an asset of one kind. The
project's registry maps each asset's key to its id, path, kind, licence
and, for binaries, its content hash, size and inspected meta. `./project`
is the model as plain JSON (zod only): `parseProjectFile`, `projectView`
(lookups, the trash, `tree()`, and the deterministic repairs for a
duplicate id or path), `checkProjectBatch` for project ops, and
`buildRefIndex` for who names what.

- **Ids and keys.** An asset's id is what references use (`"prefab":
"gate"`, `"material": "bouncy"`); its key never changes, so renames,
  moves and id changes don't lose its doc or history. A file's id comes
  from its sidecar, else the kind's id field, else its file name
  (`assetIdOfPath`: `Hero Idle.png` is `hero-idle`).
- **Sidecars.** `<file>.asset.json` holds what the file can't: a key that
  differs from the id, a licence, a binary's import settings, hash and
  meta. A text asset with nothing to add has none.
- **Project ops** (`project-ops:v1`): `createAsset`, `importAsset`,
  `renameAsset`, `moveAsset`, `deleteAsset` (refused with `asset-in-use`
  while something names it, unless `force`), `restoreAsset`,
  `changeAssetId` (rewrites every reference in one batch, a material's
  bulk keys such as `solid:bouncy` and instance overrides included),
  `setImport`, `replaceContent`, `setLicence`, `editAsset` (JSON pointer
  edits, with `@<id>` for a keyed item) and `editScene` (scene ops). One
  batch is one undo step across every doc it writes.
- **Doc names.** `project:<id>` is the registry, `scene:<project>.<key>`
  a scene and `asset:<project>.<key>` any other doc kind
  (`docNameOf`, `parseDocName`).
- **Runs read the project.** `EngineContext.project` gives a game its
  `game-settings` (with the game's `projectSettings` defaults) and its data
  tables (`ctx.project.table("card")`); a project's material assets
  overlay the game's code materials by name (`withProject`).
- **Snapshots.** `snapshotProject` pins every live asset by content hash,
  and `loadHeadless({ snapshot, store, scene, registry })` replays a run
  against exactly that version, its own materials included, without
  fetching an image.

| Kind            | Stored as | Matched by                            | Notes                                                                        |
| --------------- | --------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| `scene`         | doc       | a `.json` with no other kind          | Entities, prefab instances and bulk geometry                                 |
| `prefab`        | doc       | `"kind": "prefab"`                    | Its own doc; instances follow its edits                                      |
| `material`      | doc       | `"kind": "material"`                  | Friction, bounce and a fallback look; overlays code materials                |
| `game-settings` | doc       | `"kind": "game-settings"`             | The engine's and the game's settings; one per project                        |
| `data-table`    | doc       | `"kind": "data-table"`                | Rows of one of the game's tables, merged in path order; ids unique per table |
| `input-script`  | doc       | `.script.json`                        | A headless playtest's held actions                                           |
| `checks`        | doc       | `.checks.json`                        | The checks for the scene beside it                                           |
| `texture`       | blob      | `.png` `.jpg` `.jpeg` `.webp` `.gif`  | 8 MiB; size and format read from the header                                  |
| `atlas`         | blob      | `.atlas.json`                         | 2 MiB; Aseprite or TexturePacker frames, tags and slices                     |
| `font`          | blob      | `.fnt` `.woff2` `.woff` `.ttf` `.otf` | 4 MiB; a text BMFont names its page textures                                 |
| `audio`         | blob      | `.ogg` `.mp3` `.wav` `.m4a`           | 16 MiB                                                                       |
| `recording`     | blob      | `.recording.json`                     | 4 MiB; immutable once imported                                               |
| `code`          | code      | the project file's `code` globs       | Edited in git; listed read-only with what each module registers              |

A game adds kinds of its own as `<game>/<name>` (`GameDefinition.assetKinds`,
declarative layouts only). Binaries live in a content store keyed by
SHA-256 (`fileContentStore` in development, object storage when hosted);
their bytes are never in a doc.

### Storage limits

Every limit is enforced on the server, and a refusal names the limit and
what to do next:

- **Per file:** the sizes in the table above, and 64 MiB for any upload.
  A bigger file is refused with `asset-too-large`.
- **Per hosted doc:** a scene's Yjs state up to 2 MiB with 10,000 entities,
  another doc kind's 1 MiB unless the kind declares its own (at most
  5 MiB), a prefab's 10,000 children, the project registry's 2 MiB, and
  512 KiB (scenes) or 256 KiB (other docs) per message. A store that would
  take a doc over its cap is refused.
- **Per project:** a `QuotaPolicy` judges a project's `projectUsage` (docs,
  doc bytes, blobs, blob bytes, trash); a write over it is refused with
  `quota-exceeded`, naming the limit, what is used and the maximum. The
  per-project numbers come with plan 55's publishing work; until then
  hosted projects run under `UNLIMITED_QUOTA`.
- **Cleanup:** deleted assets go to the trash and stay restorable.
  `unreferencedBlobs` names the content-hash blobs nothing references: not
  a live or trashed asset's bytes, not in an asset's hash history within
  the grace period, and not pinned by a snapshot. Only those may be
  collected.

## Co-editing

A scene can live in a shared `Y.Doc` that any number of editors, agents and
the disk write to; every client converges on the same canonical text.
`./collab` is transport-agnostic: the host brings a provider (Hocuspocus,
y-websocket, or none in a test). Every other doc kind co-edits the same
way, laid out by its kind's `DocLayout` (`layoutToDoc`, `layoutPatch`), and
a project session ties them together: `createProjectSession({ project,
openDoc, origin, registry, kinds })` opens docs lazily through the host's
`openDoc`, applies project batches across them (`applyProjectBatch`), and
keeps one undo stack per client over every doc it wrote. A host serving
many docs shares one websocket between their providers.

```ts co-editing.ts
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { GameInstance } from "@jams/engine";
import { bindSceneDoc } from "@jams/engine/collab";
import { createEditorSession } from "@jams/engine/editor";
import { docNameOf } from "@jams/engine/project";
import * as Y from "yjs";

/** Opens scene `name` of `project` from the dev server, edits it as `userId`, and keeps the running game in step. */
export function coEdit(game: GameInstance, project: string, name: string, userId: string) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: "ws://localhost:3000/__scene-collab",
    name: docNameOf({ kind: "scene", project, key: name }),
    document: doc,
  });
  const runtime = game.runtime();
  let binding: ReturnType<typeof bindSceneDoc> | null = null;
  let session: ReturnType<typeof createEditorSession> | null = null;

  provider.on("synced", () => {
    if (session) return;
    session = createEditorSession({
      doc,
      origin: { kind: "user", userId },
      registry: game.registry,
      name,
      awareness: provider.awareness ?? undefined,
      user: { id: userId, name: userId, color: "#6cf" },
    });
    // Each transaction becomes entity-level adds, updates and removes, not a reload.
    if (runtime) binding = bindSceneDoc(doc, runtime, game.registry);
  });

  return {
    move: (id: string) => session?.dispatch({ ops: [{ op: "move", refs: [id], by: [16, 0] }] }),
    undo: () => session?.undo(),
    close() {
      binding?.destroy();
      session?.destroy();
      provider.destroy();
    },
  };
}
```

- Every write carries an origin (`user`, `agent`, `disk` or `migration`),
  and each batch lands in the doc's `log`, so history names its actor.
  `session.undo()` steps back only this client's batches;
  `revert(entryId)` undoes anyone's.
- `applyOpsToDoc(doc, batch, origin, registry)` is the same command language
  against the doc, for agents and servers.
- `watchIssues` validates the merged document, since two valid edits can
  merge into an invalid scene.

In development, `./vite`'s plugin serves each project's files as shared docs
on the Vite dev server. A project is a directory holding a
`jams.project.json`; `readFileProject` reads one, and the plugin takes
`{ projects, buildAt?, settleMs? }`:

```ts dev-server.ts
import { readFileProject, sceneCollabServer } from "@jams/engine/vite";
import wasm from "vite-plugin-wasm";

import { coinGame } from "./coin-game";

/** The `plugins` of a host's `vite.config.ts`; `scenes/` holds a `jams.project.json`. */
export const devPlugins = [
  wasm(),
  sceneCollabServer({ projects: [await readFileProject("scenes", { game: coinGame })] }),
];
```

- `/__scene-collab` is the websocket for every doc: `project:<id>` (the
  registry), `scene:<project>.<key>` and `asset:<project>.<key>`. The
  server writes each doc back as canonical text with its sidecars, moves and
  trash, and turns outside edits into one `disk` transaction or registry op.
  One watcher per project root pairs an unlink and an add within `settleMs`
  into a move.
- Each doc's Yjs state is kept in `<cacheDir>/docs` and reloaded on restart;
  a file edited while the server was down is applied as one `disk`
  transaction.
- When a binary changes on disk the server rehashes it and sends an
  `asset:changed` stateless message (`ASSET_CHANGED`,
  `AssetChangedMessage`) on the project doc, so hot reload can refetch its
  `sha256`.
- HTTP routes, same-origin only: `/__scene` (scene files),
  `GET /__project` (the projects served), `POST /__project/<id>/blob`
  (store the body; with `x-expect-sha256`, bytes that hash otherwise are
  refused with `hash-mismatch`) and `GET /__project/<id>/blob/<sha256>`.

## Versioning

The package has its own semver, independent of the site's. On 0.x a breaking
change bumps the minor and anything else the patch; `CHANGELOG.md` lists
every change.

Two contracts carry their own numbers, so tools can check compatibility
without knowing the engine's version:

- **The scene format**, `v` in every file (`SCENE_FORMAT_VERSION`). A bump
  always ships its migration, and older files load through it.
- **The agent surface**, `AGENT_SURFACE_VERSION`: the issue codes and their
  severities, the op names and fields, the JSON Schema `$id`s
  (`urn:jams-engine:<name>:v<n>`), the scene CLI's commands and flags, the
  `.checks.json` kinds and the MCP tool names. It also appears as
  `x-agent-surface` in every schema.

## Scene format reference

Generated from `scene.schema.json` for the engine's own registry (the
primitives); a game's schema adds its types and settings.

<!-- format-reference:start -->

### Top-level keys

| Field       | Type                                      | Required | Description                                                                                                                    |
| ----------- | ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `$schema`   | string                                    |          | Path or URI of this file's JSON Schema, for editors. Ignored by the engine.                                                    |
| `v`         | `2`                                       | yes      | Scene format version. Files are migrated up on load and always saved at the current version.                                   |
| `name`      | string                                    | yes      | Scene name, same rules as an id; matches the file name without .json.                                                          |
| `bounds`    | [integer, integer, integer, integer] (px) | yes      | World rectangle [minX, minY, maxX, maxY] in px; y is down. Limits the camera; anything outside it is flagged.                  |
| `settings`  | object                                    |          | Scene-wide settings: the engine's, then the game's.                                                                            |
| `groups`    | { id: [group](#groups-and-prefabs) }      |          | Groups by id. An entity or instance whose `group` names one stores its geometry relative to the group's `at`.                  |
| `instances` | [instance](#groups-and-prefabs)[]         |          | Prefab instances, each a copy of a prefab file placed at `at`.                                                                 |
| `solid`     | [shape](#shapes)[]                        |          | Static ground shapes, absolute px; `solid:<material>` for a material. Entries have no id; ops refer to them as ~solid:<index>. |
| `entities`  | [entity](#entity-types)[]                 |          | Entities with stable ids: anything that moves, has parameters, or is referenced.                                               |

### Fields every entity has

| Field   | Type                                                   | Required | Description                                                                                                                                                            |
| ------- | ------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`    | string                                                 | yes      | Stable id, unique in the scene: lowercase letters, digits and '-', 1-48 characters, starting with a letter or digit. Ops and other entities refer to the entity by it. |
| `type`  | string                                                 | yes      | The entity's type: one of the types below.                                                                                                                             |
| `name`  | string                                                 |          | Display label for the editor's outliner. No runtime effect.                                                                                                            |
| `layer` | `"terrain"` \| `"gameplay"` \| `"decor"` \| `"editor"` |          | Editor layer, for showing, hiding and locking groups of entities. No runtime effect.                                                                                   |
| `group` | string                                                 |          | The declared group (top-level `groups`) this belongs to. Its geometry is stored relative to the group's `at`, and members select and move together.                    |
| `off`   | boolean                                                |          | When true the entity stays in the file but is not loaded, e.g. to A/B a change without deleting it.                                                                    |

### Entity types

#### `solid`

Static ground, walls and platforms: collides from every side, or from above only.

| Field      | Type             | Required | Description                                                                                                             |
| ---------- | ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `shape`    | [shape](#shapes) | yes      | Collider shape. Absolute world px; y is down. Any tag, including chain for outlines.                                    |
| `material` | none registered  |          | Surface material.                                                                                                       |
| `oneWay`   | boolean          |          | When true, actors pass up through it and land on top.                                                                   |
| `attach`   | string           |          | A path follower's id: the collider rides that follower's body, keeping its offset from the follower's first path point. |

#### `sensor`

Trigger volume with no collision response; raises sensor:enter and sensor:exit when something overlaps it.

| Field    | Type             | Required | Description                                                                                                             |
| -------- | ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `shape`  | [shape](#shapes) | yes      | Trigger shape. Absolute world px; y is down.                                                                            |
| `tags`   | string[]         |          | Labels a game reads off the sensor's events.                                                                            |
| `attach` | string           |          | A path follower's id: the collider rides that follower's body, keeping its offset from the follower's first path point. |

#### `marker`

A named point with tags; what it means is up to the game.

| Field  | Type             | Required | Description                                    |
| ------ | ---------------- | -------- | ---------------------------------------------- |
| `at`   | [point](#points) | yes      | Marker position. Absolute world px; y is down. |
| `tags` | string[]         |          | Labels a game reads, e.g. spawn or checkpoint. |

#### `prop`

Dynamic physics object that can be pushed and stood on.

| Field         | Type                  | Required | Description                                                              |
| ------------- | --------------------- | -------- | ------------------------------------------------------------------------ |
| `shape`       | [body shape](#shapes) | yes      | Starting collider shape. Absolute world px; y is down. Not chain.        |
| `density`     | number                | yes      | Density, mass per px²; heavier props are harder to push.                 |
| `restitution` | number                | yes      | Bounciness: 0 doesn't bounce, 1 keeps all its speed.                     |
| `friction`    | number                |          | Surface friction; omitted uses the material's, else the physics default. |
| `material`    | none registered       |          | Surface material.                                                        |

#### `follower`

Kinematic body that follows a waypoint path.

| Field      | Type                  | Required | Description                                                                                                     |
| ---------- | --------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `shape`    | [body shape](#shapes) | yes      | Collider shape LOCAL to the current path point, usually centred on 0, 0 (e.g. ["box", 0, 0, 40, 6]). Not chain. |
| `path`     | [path](#paths)        | yes      |                                                                                                                 |
| `material` | none registered       |          | Surface material.                                                                                               |

#### `note`

Editor note: text pinned to a point. Never loaded into the game.

| Field  | Type             | Required | Description                                 |
| ------ | ---------------- | -------- | ------------------------------------------- |
| `at`   | [point](#points) | yes      | Where the note shows, absolute world px.    |
| `text` | string           | yes      | The note, for whoever edits the scene next. |

### Shapes

A shape tuple: ["box", cx, cy, hw, hh, rotDeg?] | ["circle", cx, cy, r] | ["capsule", cx, cy, halfLen, r, rotDeg?] | ["poly", x1, y1, x2, y2, x3, y3, ...] | ["chain", x1, y1, x2, y2, ...]. Integer pixels, y is down.

A body shape is any of these but `chain`.

- **`box`** `["box", cx, cy, hw, hh, rotDeg?]`: Axis-aligned box (a Rapier cuboid) by centre and half-extents, optionally rotated about its centre. Items: Centre x (px); Centre y (y is down) (px); Half-width; the box is 2*hw wide (px); Half-height; the box is 2*hh tall (px); Rotation in integer degrees, clockwise on screen (y is down). Omitted means 0 (deg).
- **`circle`** `["circle", cx, cy, r]`: Circle (a Rapier ball) by centre and radius. Items: Centre x (px); Centre y (y is down) (px); Radius (px).
- **`capsule`** `["capsule", cx, cy, halfLen, r, rotDeg?]`: Capsule, vertical before rotation: a segment of half-length halfLen through the centre, swept by radius r. Items: Centre x (px); Centre y (y is down) (px); Half the length of the inner segment (px); Radius (px); Rotation in integer degrees, clockwise on screen (y is down). Omitted means 0 (deg).
- **`poly`** `["poly", x1, y1, x2, y2, x3, y3, ...]`: Convex polygon as flat x, y pairs (at least 3 points). Points are absolute; the loader centres the body on their centroid. Concave outlines must be split or drawn as a chain.
- **`chain`** `["chain", x1, y1, x2, y2, ...]`: Open polyline as flat x, y pairs (at least 2 points), for static terrain. Allowed on solid and sensor only.

### Points

A point [x, y] in integer world pixels; y is down.

### Paths

A waypoint path with linear segments.

| Field     | Type                      | Required | Description                                                                                                                     |
| --------- | ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pts`     | [point](#points)[]        | yes      | Waypoints in absolute world px. The entity's shape is centred on each point in turn. At least 2, no repeats.                    |
| `mode`    | `"ping_pong"` \| `"loop"` | yes      | ping_pong: travel to the last point, then back. loop: after the last point, travel back to the first along the closing segment. |
| `speed`   | number (px/s)             | yes      | Travel speed along the path, px per second; must be > 0.                                                                        |
| `pauseMs` | number (ms)               |          | How long it waits at each waypoint, in milliseconds. Omitted means 0.                                                           |

<!-- format-reference:end -->
