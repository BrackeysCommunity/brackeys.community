# @jams/engine

A game-agnostic 2D engine for the web: [Pixi](https://pixijs.com) v8 draws,
[Rapier](https://rapier.rs) 2D simulates, and levels are plain JSON scene
files that people, agents and the disk can edit together. A game registers
its entity types, actions and hooks; the engine loads its scenes, steps them
in a browser or headless, validates them with machine-readable issue codes,
and edits them through a small command language (`SceneOp`) that also runs on
a shared [Yjs](https://yjs.dev) document.

This is 0.x. `./editor`, `./game` and `./headless` are `@experimental`: they
may change in any 0.x minor. The scene format (`v: 3`), the issue codes, the
ops and the JSON Schemas are versioned contracts (see
[Versioning](#versioning)).

## Install

0.x isn't on a registry. Each release attaches a tarball to its GitLab
release (tag `engine-vX.Y.Z`); install it by path or URL:

```sh
bun add ./jams-engine-0.3.0.tgz
bun add pixi.js @dimforge/rapier2d @tanstack/store zod yjs fractional-indexing
```

Everything the engine shares with its host is a peer dependency, so the host
owns one copy of each. The editor UI's own libraries (`@base-ui/react`,
`@dnd-kit/core`, `@hugeicons/core-free-icons`, `@hugeicons/react`) are plain
dependencies, used only by `./editor-ui`.

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
| `react`, `react-dom`        | `^19.0.0`        | optional: only `./editor-ui` uses them                                   |
| `@hocuspocus/provider`      | `^4.7.0`         | optional: never imported; a host hands the module to `./editor-ui`       |

The package is ESM only and has no side effects on import; the one file a
host imports for its effect is `@jams/engine/editor-ui/style.css`.

| Entry                    | What it holds                                                                                                                                              | Runtime peers                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `@jams/engine`           | `createGame`, the browser shell: renderer, camera, input, the tool router and the store selectors                                                          | pixi.js, @tanstack/store          |
| `@jams/engine/scene`     | the scene format: parse, migrate, format, hash, expand, validate, issue codes, `applyOps`, diffs, the JSON Schemas                                         | zod                               |
| `@jams/engine/game`      | the authoring API: `defineGame`, `defineEntityType`, `createRegistry`, field helpers and the primitive systems                                             | zod                               |
| `@jams/engine/headless`  | a DOM- and Pixi-free runtime: `createHeadlessRuntime`, `runProbe`, input scripts, `runPlaytest`, `fuzz`, `validatePhysical`, `runChecks`                   | zod                               |
| `@jams/engine/collab`    | the shared `Y.Doc` layout, `sceneToDoc`/`docToScene`, `applyOpsToDoc`, undo, revert, binding and presence                                                  | yjs, fractional-indexing, zod     |
| `@jams/engine/editor`    | the editor without UI: `createEditorSession`, the keymap, `createToolHost` and its tools, picking, snapping, gizmos, the clipboard and the inspector model | yjs, @tanstack/store, zod         |
| `@jams/engine/debug`     | `createDebugOverlay`, the F3 overlay; pass it only in dev builds                                                                                           | pixi.js                           |
| `@jams/engine/editor-ui` | the scene editor's UI: `SceneEditor`, `mountSceneEditor`, the host seam `EditorHost` and its connectors (below)                                            | react, react-dom, and the above   |
| `@jams/engine/vite`      | Node only: `sceneCollabServer`, a dev-server plugin that co-edits a project's files                                                                        | node builtins, @hocuspocus/server |
| `@jams/engine/sim-kit`   | the seeded `Rng`, `digest32` and fixed-point maths, with no dependencies                                                                                   | none                              |

The JSON Schemas ship as files too: `@jams/engine/schemas/scene.schema.json`,
`prefab.schema.json`, `fragment.schema.json`, `ops.schema.json`,
`input-script.schema.json` and `recording.schema.json`, and the project's
(`project`, `asset-sidecar`, `project-ops`, `material`, `game-settings`,
`data-table`, `project-snapshot`), all under `@jams/engine/schemas/`.

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
it. A scene without physics never needs the module, and a host that passes
a loader only pays for the wasm when a Rapier scene loads (see
[Physics optional](#physics-optional)).

## Registering entity types

A scene's entities are typed by the registry: eight primitives the engine
always has (`solid`, `sensor`, `marker`, `prop`, `follower`, `decor`,
`nav`, `note`) plus the game's own types. A game type either names a primitive as
its `base`, so the primitive's system spawns it, or brings its own `system`.
`decor` is a picture with no body: `{ id, type: "decor", at, behaviors: {
sprite } }`, its `sprite` block required. It loads (headless too), so it
has a pose and is queryable, but nothing enters the physics world for it.
A game's `spawnOrder` may leave `decor` out; it then spawns last. A game
type named `decor` is a registry error, as for every primitive.

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

A scene without physics is checked on the engine's own colliders: both
engine checks and every game check run there, except one with
`needsPhysics: true`, which is skipped as `physics-skipped` (info). A
check's `overlaps` and `cast` go through `space`, the same queries on
either backend; touching isn't overlapping.

A `<scene>.checks.json` beside a scene lists what must stay true of it,
outside the scene's hash; `runChecks` runs it. The engine's kinds are
`valid` (no issues at or above a severity, optionally physical),
`reaches` (an input script ends in a given result), `touches` (fuzz
reaches an entity in at least N rollouts) and `connected` (cells or
entities reach each other on the grid; see
[Grids at runtime](#grids-at-runtime)); a game adds `<id>/<kind>` kinds
in `checks`.

## Editor tools

`./editor` has no UI, so any host can draw it. `createToolHost({ session,
router, toWorld, scale })` puts the active tool on the game's tool router:
tools get world-space pointer events, preview a drag only in the overlay
(previews are view-only: the editor passes no `runtime`, so the edit world
holds committed state), commit one batch per gesture, and describe what to draw
(outlines, handles, a marquee, guides, ghosts, a readout) as a
`ToolOverlay`. The built-in tools are select, pan, box, circle, pen,
waypoints and rotate. A game adds its own in `GameDefinition.editor.tools`,
a lazy loader so editor code stays out of its play bundle, and binds them
with edit-scope `editorKeys` whose command is `tool:<id>`;
`placementEditorTool` builds one from a list of shapes to place. Fields a
game marks with `meta.widget` render with the widget it describes in
`editor.widgets`.

Dropping an asset on the canvas places it: `dropFragment` turns a texture
into a `decor` with `sprite.asset`, an atlas frame into one with `asset`
and `frame`, and a prefab into an instance (other kinds aren't placeable),
and `dropBatch` places that fragment centred on the snapped drop point as
one batch, so it is one undo step. A game maps a drop to its own entity
with `GameDefinition.editor.assetDrop`; returning null keeps the engine's.

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
  "v": 3,
  "name": "gates",
  "bounds": [0, 0, 2000, 1000],
  "groups": {
    "east": { "at": [1200, 0], "rot": 2, "flip": true }
  },
  "instances": [
    { "id": "gate-1", "prefab": "gate", "at": [600, 900] },
    {
      "id": "gate-2",
      "prefab": "red-gate",
      "group": "east",
      "z": 5,
      "at": [200, 900],
      "rot": 1,
      "params": { "speed": 120 },
      "overrides": { "trigger.tags": ["gate", "east"] }
    }
  ],
  "entities": [
    { "id": "east-post", "type": "solid", "group": "east", "shape": ["box", 500, 900, 10, 60] }
  ]
}
```

- A group's members store their geometry relative to its `at`, so moving
  the group is one integer edit. A group may turn and flip its members
  ([Transforms](#transforms)); there is no scale.
- A prefab is an asset of kind `prefab` (a `.json` with `"kind": "prefab"`
  anywhere in the project): `{ "kind": "prefab", "v": 3, "id",
"entities", "bulk"?, "instances"? }` around a local origin. An instance
  puts that origin at `at` (inside its group's frame), turned and flipped
  by its own `rot` and `flip`; its children load as `gate-1/door` (bulk
  children `gate-1/~solid:0`), and references between them follow.
- `overrides` hold the fields one instance changes, keyed
  `<child>.<field.path>`, in the prefab's frame. Ops edit them
  (`override`, `revertOverride`), fold them into the prefab
  (`applyToPrefab`), turn an instance back into plain entities (`unpack`),
  or make a prefab from entries (`createPrefab`).
- Hosts load the library: `expandScene(def, registry, { prefabs })`, and
  the same `prefabs` option on `validateScene`, `applyOps`, the headless
  runs and the renders. `resolveScene` gives the scene with instances
  inlined and groups applied; that view is what tools pick and draw, and
  `toSourceBatch` maps an edit made on it back onto the document, through
  the inverse of any turn or flip above it.
- Prefabs are docs of their own (`prefabToDoc`/`docToPrefab`, `./collab`);
  a scene's session reads them through a `PrefabSource`
  (`sessionPrefabSource(projectSession, { scene })` live,
  `staticPrefabSource(library)` for files). To edit a prefab on its own,
  `await openPrefabIsolation(session, "gate")` (`./editor`) gives a
  session over the prefab's doc at its local coordinates. Every instance
  follows its edits, collaborators in the prefab see each other, and the
  project's one undo stack covers it. Bind the edit world to
  `isolation.session.doc` while it's open and call `close()` (or press
  Escape with nothing selected) to go back. Without a project, Apply to
  prefab, Create prefab and Unpack are refused.
- `attach: "<follower id>"` on a solid or sensor puts its collider on that
  follower's body, so it rides along; riders on it move by the follower's
  `frameDelta` (`carrierDelta`). The follower may be an instance's child
  (`"attach": "lift-1/car"`).

## Scene format v3

Format v3 is every format change the engine plans before 1.0, in one bump.
Each addition is optional, and leaving it out keeps v2's behaviour:

| Key or field                               | Where                      | Meaning                                                                         | Default             |
| ------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------- | ------------------- |
| `assets`                                   | scene, prefab header       | asset ids only game code names, sorted, each once                               | none                |
| `settings.physics`                         | scene settings             | `"rapier"` or `"none"`                                                          | resolved, `rapier`  |
| `settings.grid`                            | scene settings             | the scene's one cell grid                                                       | none                |
| `settings.view`                            | scene settings             | `{ "projection": "orthogonal" }`, reserved for other projections                | orthogonal          |
| `rot`, `flip`                              | instances, groups          | quarter turns clockwise, and a mirror in x before turning                       | identity            |
| `z`                                        | entities, instances        | integer draw order within the layer; on an instance, an offset for its children | 0                   |
| `params`                                   | instances                  | values for the prefab's exposed parameters                                      | none                |
| `behaviors`                                | entities                   | behavior blocks by name                                                         | the type's required |
| `layer`                                    | entities, instances        | one of the registry's layers                                                    | the type's default  |
| `instances`, `base`, `params`, `overrides` | prefab files               | nested instances, a variant's base and its overrides, exposed parameters        | none                |
| `instances`                                | fragments                  | copied instances; their prefabs travel by id                                    | none                |
| grid fields                                | entities of types with one | cells in chunks of run-length rows                                              | empty               |
| ref fields                                 | `refField`, `attachField`  | an id, or `<instance>/<child>` at any depth                                     | —                   |

```json
{
  "$schema": "../scene/scene.schema.json",
  "v": 3,
  "name": "yard",
  "bounds": [0, 0, 4000, 2000],
  "settings": {
    "gravity": [0, 1200],
    "grid": { "kind": "square", "cell": [32, 32] },
    "physics": "rapier"
  },
  "assets": ["boom"],
  "groups": {
    "left-wing": { "name": "Left wing", "at": [400, 0], "rot": 2, "flip": true }
  },
  "instances": [
    { "id": "gate-1", "prefab": "gate", "at": [800, 900] },
    {
      "id": "gate-2",
      "prefab": "red-gate",
      "z": 5,
      "at": [1600, 900],
      "rot": 1,
      "flip": true,
      "params": { "speed": 120 }
    },
    {
      "id": "room-1",
      "prefab": "room",
      "at": [2400, 600],
      "overrides": { "door-1/panel.path.speed": 60 }
    }
  ],
  "solid": [["box", 2000, 1980, 2000, 20]],
  "entities": [
    {
      "id": "lever",
      "type": "sensor",
      "z": 2,
      "shape": ["box", 700, 950, 10, 20],
      "tags": ["switch"]
    },
    {
      "id": "lift",
      "type": "solid",
      "shape": ["box", 2400, 640, 40, 8],
      "attach": "room-1/door-1/panel"
    }
  ]
}
```

The schemas' `$id`s are `urn:jams-engine:scene:v3`, `prefab:v3`,
`fragment:v3` and `ops:v3` (and `<game>:scene:v3` for a game's).

**The migration.** v2 → v3 changes only `v`, on scenes, prefabs and
fragments alike; `parseScene` and `parsePrefab` run it on load and `vp run
scene fmt` writes it back. A recording made against a v2 file replays with
the `stale` warning once, because the scene's hash is over its canonical
text, which now says `"v": 3`.

**Asset fields.** `assetField(env, kinds, description)` is an asset id of
one or more kinds (`"texture"`, `["texture", "atlas"]`). It parses as a
plain id, so a deleted asset leaves its referrers loadable; with a project
loaded, validation reports a dangling id as `asset-missing` and one of
another kind as `asset-kind`, and the JSON Schema lists the project's live
ids as an `enum`. The `assets` header names assets nothing else
references (a sound game code plays), so they count as used and travel
with the scene. Renames, id changes and the in-use check see every asset
field, behavior blocks and settings included. Op: `useAssets { add?,
remove? }`.

### Behaviors

A behavior is a typed block of fields any entity type may carry, with an
optional runtime half. Engine behaviors have bare names; a game's are
`<gameId>/<name>`, so a name the engine adds later never collides.

```ts coin-behaviors.ts
import {
  DEFAULT_LAYERS,
  defineBehavior,
  defineEntityType,
  defineGame,
  gridField,
  pointField,
  primitiveFields,
} from "@jams/engine/game";
import { z } from "zod";

import { coinGame } from "./coin-game";

/** Data only: game code reads it off `entity.behaviors["coin-game/loot"]`. */
export const loot = defineBehavior({
  name: "coin-game/loot",
  description: "What the entity drops when it's collected.",
  fields: {
    table: z.string().default("common").describe("The loot table it rolls on; default common."),
    rolls: z.number().int().min(1).default(1).describe("How many times it rolls; default 1."),
  },
  inspector: { label: "Loot", order: ["rolls", "table"] },
});

/** A chest always carries loot: three rolls unless a scene says otherwise. */
const chest = defineEntityType({
  type: "chest",
  description: "A chest: entering it opens it.",
  base: "sensor",
  fields: (env) => primitiveFields("sensor", env),
  behaviors: { required: { [loot.name]: { rolls: 3 } } },
});

/** Floor tiles on the scene's grid, local to `at`. */
const floor = defineEntityType({
  type: "floor",
  description: "Painted floor tiles.",
  base: "marker",
  fields: {
    at: pointField("The grid's origin."),
    tiles: gridField("The tiles.", { values: ["stone", "grass", "water"] }),
  },
  behaviors: { forbidden: "all" },
});

export const lootGame = defineGame({
  ...coinGame,
  types: [...coinGame.types, chest, floor],
  behaviors: [loot],
  // Bottom to top: a backdrop that scrolls at half speed, then the engine's four.
  layers: [
    { name: "sky", description: "The far backdrop.", draw: -5, scroll: [0.5, 0.5] },
    ...DEFAULT_LAYERS,
  ],
});
```

```json
{
  "id": "chest-1",
  "type": "chest",
  "shape": ["box", 900, 940, 20, 20],
  "behaviors": { "coin-game/loot": { "table": "rare" } }
}
```

- **`defineBehavior({ name, description, fields, system?, requires?,
visualOnly?, inspector? })`** lives in `./game` and needs only zod.
  `fields` is a Zod shape, or a function of the registry's `FieldEnv` when
  a field depends on it (an asset enum). Without `system` the block is
  data that game code reads; with one, `system(ctx, def)` returns a
  `BehaviorSystem` (`attach`, `detach`, optional `update`, `step`,
  `render`, `reset`, `seek`, plus `clear` and `size`). `requires` names
  behaviors the same entity must also carry; `visualOnly` ones never
  change simulation state and are built only with a view.
- **A type's rules:** `EntityTypeDef.behaviors` is `{ required?,
defaults?, forbidden? }`. A required behavior is always there: a missing
  block loads as the type's defaults. `defaults` fill fields of an
  optional behavior when an entity carries it. `forbidden` lists refused
  names, or `"all"` to allow only the required ones. Notes carry none, and
  bulk entries carry only their type's required behaviors, at the type's
  defaults. `registry.behaviorRules(type)` says what a type allows.
- **Defaults merge once**, in `expandScene`: the behavior's field
  defaults, then the type's, then the entity's block. The runtime sees
  whole blocks on `RuntimeEntity.behaviors`; the file keeps only what was
  written, and `{}` means "carry it, all defaults".
- **Order** is registration order: the engine's behaviors (`sprite`),
  then the game's in `GameDefinition.behaviors` order. When systems attach,
  step and detach is in [Behaviors at runtime](#behaviors-at-runtime).
- **Registry checks.** `createRegistry` throws on a game behavior without
  its `<id>/` prefix, a duplicate name, a `requires` or type rule naming an
  unknown behavior, a behavior both required and forbidden, a default that
  fails the behavior's schema, and a field name that isn't
  `/^[A-Za-z_$][A-Za-z0-9_$]*$/`. `z` and `behaviors` are reserved field
  names.
- **Validation:** `behavior-unknown` (with a did-you-mean),
  `behavior-forbidden`, `behavior-missing` (a `requires` unmet once
  required blocks are added), and `schema` issues inside a block at
  `/entities/<i>/behaviors/<name>/<field>`.
- **The inspector** shows one section per carried behavior, titled by
  `inspector.label`, fields in `inspector.order`, with Remove, and an Add
  behavior menu of what the type allows. The section of fields marked
  `meta({ group: "behavior" })` is titled Gameplay.

**Field paths** address fields in ops, overrides and params:

```text
FieldPath     := Segment ("." Segment)*
Segment       := Name | Index | BehaviorName      ; BehaviorName only right after "behaviors"
Name          := [A-Za-z_$][A-Za-z0-9_$]*
Index         := 0 | [1-9][0-9]*
OverridePath  := ChildRef "." FieldPath
ChildRef      := Id ("/" Id)* ("/" BulkRef)? | BulkRef
```

`path.speed`, `behaviors.coin-game/loot.rolls`,
`door-1/panel.behaviors.sprite.tint`. In a JSON Pointer the `/` of a
behavior name is `~1` (`/entities/3/behaviors/coin-game~1loot/rolls`).
`splitFieldPath` parses one. `update { set: { "behaviors.coin-game/loot":
{} } }` adds a behavior, `unset: ["behaviors.coin-game/loot"]` removes it,
and setting a field inside a missing block creates the block. A path may
not go below a grid field.

### Layers and `z`

A game's scene layers come from code: `GameDefinition.layers`, bottom to
top, replaces the engine's four (`DEFAULT_LAYERS`: `terrain`, `decor`,
`gameplay`, `editor`) when given, and `registry.layers` holds them. A
`SceneLayerDef` is `{ name, description, draw, sort?, scroll?,
editorOnly? }`: `draw` is the draw order its visuals use, `sort` is `"z"`
(default) or `"y"`, `scroll` is its parallax (`[1, 1]` by default, `[0, 0]`
fixed to the screen), and an `editorOnly` layer never draws in play.
`createRegistry` refuses duplicate or malformed names, an empty list and a
non-finite `draw` or `scroll`.

- An entity's or instance's `layer` names one of them; omitted, it is the
  type's default (`defaultLayer`: notes on `editor`, bulk entries on
  `terrain`, everything else on `gameplay`; a game whose layers lack one of
  those falls back to its first layer, or its last for editor-only types).
  An unknown name is `layer-unknown`, whose fix unsets it. The editor
  shows, hides and locks by layer, and the engine's own visuals draw on
  it: sprites always, and the primitive systems' shapes when the entity
  names a layer (otherwise, and whenever a game passes its own `layer`
  option, a shape keeps its system's draw layer, so a game's look doesn't
  change).
- In the Pixi view (`createPixiView` gets `registry.layers`), a layer is
  matched to draws by its `draw` order; draws at any other order are plain
  draw layers. A `sort: "y"` layer re-sorts each frame by `(z,
interpolated y, first draw)`; a `scroll` layer is offset by the camera
  times `1 − scroll`, so `[0.5, 0.5]` moves half as far as the camera; and
  on an `editorOnly` layer the visuals placed by entity (those given a
  `depth`) show only in edit mode, while a game's own draws at that order
  (a play-mode preview) still show.
- `z` is an integer in `[-10000, 10000]` on entities and instances,
  default 0. Within a layer, visuals draw in `(z, spawn order)`; on a
  y-sorted layer in `(z, y, spawn order)`, so a roof can still sit above
  y-sorted actors. An instance's `z` is added to each child's. Bulk entries
  have none: promote one to set it. Op: `setZ { refs, z? | by? }`.

### Transforms

Instances and groups turn and flip: `rot` is 1, 2 or 3 quarter turns
clockwise on screen (absent is 0), and `flip: true` mirrors x in the
prefab's or group's frame before turning. The eight combinations are every
rotation and reflection that keeps a square grid on itself, each with one
spelling, so integer geometry stays exact and diffs stay clean. A child's
world transform is its group's, then its instance's, then each nested
instance's, down to its own fields.

What a transform does depends on what a field is, so a game declares its
fields with the builders:

| Field                     | Under a turn                  | Under a flip                  |
| ------------------------- | ----------------------------- | ----------------------------- |
| shapes, points, paths     | positions turn about the `at` | positions mirror              |
| `box`, `capsule`          | `rotDeg` gains 90° per turn   | `rotDeg` negated              |
| `poly`, `chain`           | points turn                   | points mirror, order reversed |
| `vectorField`             | turns (never translated)      | mirrors                       |
| `angleField(desc, "deg")` | gains 90° per turn            | negated                       |
| `mirrorField("x", desc)`  | unchanged                     | toggled                       |
| grid fields               | cells remap (square only)     | cells remap (square only)     |
| any other value           | unchanged                     | unchanged                     |

A one-way solid stays screen-up inside a turned instance. The resolved
entity carries the transform it ended up with
(`RuntimeEntity.transform: { turn, flip }`). `Transform2D`, `dihedral`,
`compose`, `invert`, `applyPt`, `applyVec`, `composeDihedral` and
`flipWorld` are in `./scene` and the root entry.

- `transform { refs?, groups?, turn?: 1 | 2 | 3 | -1, flip?: "x" | "y",
about? }` turns and flips instances and groups in world terms, composed
  onto what they have, about each one's `at` unless `about` is given.
- `setGroup` takes absolute `rot` and `flip`; `instantiate` takes `rot`,
  `flip`, `z` and `params`.
- `unpack` bakes the transform into the entities it writes. An edit made
  on a turned child in the resolved view maps back through the inverse (a
  world `move` of a flipped child becomes a mirrored override).

### Grids

`settings.grid` gives a scene one cell grid, Tiled-compatible:
`{ "kind": "square", "cell": [w, h], "origin"? }` or `{ "kind": "hex",
"cell": [w, h], "side", "stagger": "x" | "y", "index": "odd" | "even",
"origin"? }` (`side` is the length of the flat sides). Cells and origins
are integers, `cell` positive.

A type holds cells with `gridField(description, { values?, max? })`;
values are integers up to 65535 (or `values.length`), 0 is empty, and
`values` names 1..n for the schema and the inspector. The type must also
have a point field `at`: cells are local to it and sized by
`settings.grid.cell`, so moving `at` (a group, an instance, `move`)
moves the whole tilemap exactly.

```json
    { "id": "floor", "type": "floor", "at": [0, 640], "tiles": {
      "-1,0": ["0*31,3"],
      "0,0": ["1*32", "1*32", "0*4,2*24"],
      "1,0": ["1*8"]
    } },
```

- Cells live in 32×32 chunks keyed `"cx,cy"`, rows top to bottom, each a
  run-length string: runs `v` or `v*n` joined by `,`, missing cells 0.
  Canonical text has maximal runs, no trailing zeros or empty rows, and
  chunks in `(cy, cx)` order; `parseScene` canonicalises, so `scene fmt`
  fixes a hand-written row. A grid entity is the one entity that spans
  lines: one chunk per line, its grid fields last.
- `paintCells { ref, field, cells?: [col, row, value][], rects?: [c0, r0,
c1, r1, value][] }` paints (value 0 erases), at most 65,536 cells per
  op; its inverse is the cells it overwrote. `./scene`'s `grid` helpers
  (`paintGrid`, `readCell`, `encodeRow`, `decodeRow`, `canonicalGrid`,
  `transformGrid`) are what it runs.
- `grid-invalid` covers a bad setting, row, key, count or value, a grid
  field in a scene without `settings.grid`, an override naming a grid
  field (paint the prefab instead), and a turned or flipped instance or
  group over a grid whose cells aren't square.

### Settings

The engine's scene settings are `gravity`, `physics` (`"rapier"` or
`"none"`), `grid` and `view` (`{ "projection": "orthogonal" }`, the only
projection so far). A game's `settings` add their own keys and may not
redefine these. Each engine setting resolves, first match wins, from:

1. the scene's `settings`;
2. the project's `game-settings` `engine` block;
3. the game's `GameDefinition` default;
4. the engine's: gravity `[0, 1200]`, `rapier`, no grid, orthogonal.

`resolveSettings(settings, { project?, game? })` applies the order;
`expandScene` resolves with the scene's values and the engine defaults.

### Prefabs: nesting, variants and parameters

A prefab may hold instances of other prefabs, may be a variant of another,
and may expose parameters:

```json
{
  "kind": "prefab",
  "v": 3,
  "id": "room",
  "instances": [
    { "id": "gate-1", "prefab": "gate", "at": [-200, 0] },
    {
      "id": "gate-2",
      "prefab": "gate",
      "at": [200, 0],
      "rot": 2,
      "flip": true,
      "overrides": { "door.path.speed": 90 }
    },
    {
      "id": "door-1",
      "prefab": "door",
      "z": 2,
      "at": [0, 40],
      "overrides": { "latch/door.path.speed": 30 }
    }
  ],
  "entities": [{ "id": "lamp", "type": "marker", "at": [0, -100], "tags": ["light"] }]
}
```

```json
{
  "kind": "prefab",
  "v": 3,
  "id": "red-gate",
  "base": "gate",
  "params": {
    "speed": {
      "description": "How fast the door opens, in px per second.",
      "targets": ["door.path.speed"],
      "default": 90
    }
  },
  "overrides": {
    "trigger.tags": ["gate", "red"]
  },
  "entities": [{ "id": "lamp", "type": "marker", "at": [20, -90], "tags": ["light"] }]
}
```

- **Nesting.** A nested child's id is its path of instance ids:
  `room-1/door-1/latch/door`. An override's child part may be a nested
  child (`door-1/panel.path.speed`) or a nested instance's own field
  (`door-1.at`, `.rot`, `.flip`, `.z`, `.off`, `.layer`,
  `.params.<name>`). At each level the prefab's value comes first, then
  that level's params, then its overrides, and an outer level beats every
  inner one. Nesting is at most 8 deep (`prefab-depth`), and a prefab that
  reaches itself through instances or bases is `prefab-cycle`; ops that
  would close a loop are refused. `unpack` opens one level, so the nested
  instances become the scene's. `applyToPrefab { to? }` writes into the
  instance's own prefab unless `to` names a deeper one.
- **Variants.** A prefab with `base` has its base's children, with its
  `overrides` applied, plus its own entities, bulk entries and instances.
  It can't remove a base child, only override `off: true`, and an id it
  shares with a base child is `dup-id`. A variant of a variant counts
  toward the depth; an unknown base is `variant-base-unknown`. Make one
  with the project op `createAsset` (kind `prefab`, content `{ "base":
"gate" }`); `setPrefabBase { base }` changes or clears it.
- **Parameters.** `params` declares `{ description, targets, default? }`
  by name; each target is an override path inside the prefab. An
  instance's `params: { speed: 120 }` applies as an override of every
  target, so the precedence is prefab < param < override. A variant
  inherits its base's params and may redeclare one. An instance setting
  one its prefab lacks is `param-unknown`. Ops: `exposeParam { name,
param | null }` (prefab docs only) and `setParam { ref, name, value |
null }`.
- **Child refs.** Reference fields (`refField`, `attachField`) accept
  `<instance>/<child>` at any depth (`room-1/door-1/panel`), matching
  `CHILD_REF_PATTERN`; every other id keeps `ID_PATTERN`. A missing
  instance is `dangling-ref`, a missing child `ref-child-unknown` (with a
  did-you-mean), the wrong type `ref-type`. At runtime the resolved ids
  are the same strings.
- **Fragments.** A `scene-fragment` carries `instances`, so copy, cut,
  duplicate and paste keep instances (a child copied on its own pastes as
  a plain entity). `placeFragment` renames a taken instance id (`gate-2`
  becomes `gate-3`) and rewrites child refs inside the fragment to match.
  Prefab bodies don't travel: a pasted instance whose prefab the project
  lacks reports `prefab-unknown` and places nothing.
- `resolvePrefab(id, library, registry)` resolves one prefab into its
  children in its own frame, nested instances expanded and its base folded
  in; load, the doc, the editor and checks share it. A scene's hash
  covers every prefab it reaches, through nesting and bases.

In the editor, the outliner shows nested children as a tree, dragging an
entity row onto a follower row attaches it (dropping it on its type's row
detaches), and the inspector has Turn and Flip on an instance.

### Issue codes added in v3

All are errors; `ISSUE_CODES` has each one's hint.

| Code                   | When                                                           | Fix                                  |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------ |
| `prefab-cycle`         | A prefab contains itself through instances or variant bases.   | —                                    |
| `prefab-depth`         | Prefabs nest deeper than 8 levels.                             | —                                    |
| `variant-base-unknown` | A variant's base isn't a prefab in the project.                | did-you-mean `setPrefabBase`         |
| `param-unknown`        | An instance sets a parameter its prefab doesn't expose.        | `setParam` to null                   |
| `layer-unknown`        | An entity or instance names a layer the registry doesn't have. | `update` unsetting `layer`           |
| `behavior-unknown`     | An entity carries a behavior that isn't registered.            | did-you-mean, or unset the block     |
| `behavior-forbidden`   | An entity's type doesn't allow this behavior.                  | unset the block                      |
| `behavior-missing`     | A behavior's `requires` isn't on the same entity.              | add the required block with defaults |
| `grid-invalid`         | A grid setting, grid value or grid placement is invalid.       | `scene fmt` for non-canonical rows   |
| `ref-child-unknown`    | A child ref names an instance whose prefab has no such child.  | did-you-mean                         |

`asset-missing` and `asset-kind` cover asset fields, `dup-id` a variant's
id clash, and `prefab-unknown` nested and pasted instances.

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
  edits, with `@<id>` for a keyed item) and `editScene` (scene ops). A
  scene's checks file follows it through `moveAsset` and `renameAsset`,
  and counts as a referrer when the scene is deleted. One batch is one
  undo step across every doc it writes.
- **Doc names.** `project:<id>` is the registry, `scene:<project>.<key>`
  a scene and `asset:<project>.<key>` any other doc kind
  (`docNameOf`, `parseDocName`).
- **Runs read the project.** `EngineContext.project` gives a game its
  `game-settings` (with the game's `projectSettings` defaults) and its data
  tables (`ctx.project.table("card")`); a project's material assets
  overlay the game's code materials by name (`withProject`).
- **Snapshots.** `snapshotProject` pins every live asset by content hash
  (a blob with its size, import settings and inspected meta), and `loadHeadless({ snapshot, store, scene, registry })` replays a run
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

## Sprites and rendering

A scene names its art by asset id, the shell loads it, and headless code
knows its size without decoding a byte. The engine draws an entity through
its `sprite` behavior; an entity without one draws as its type's shape.

### The `sprite` behavior

`sprite` is the engine's one behavior (`SPRITE` in `./game`), visual only:
it never changes simulation state and has no system headless. Any entity
type may carry it, unless the type forbids it. Its fields:

| Field       | Meaning                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| `asset`     | A `texture`, or an `atlas` whose frame it draws. Without one only the fallback box draws (`sprite-no-asset`) |
| `frame`     | The atlas frame's name; required for an atlas (`asset-frame-unknown` otherwise, or for a frame it lacks)     |
| `size`      | Drawn size in world px; omitted, the frame's (or texture's) pixel size times `scale`                         |
| `scale`     | Used when `size` is omitted; default 1                                                                       |
| `anchor`    | 0–1 in the frame; default the frame's pivot, else the texture's import pivot, else the centre                |
| `offset`    | World px from the pose to the anchor; turns and flips with the instance                                      |
| `tint`      | 0xRRGGBB multiplied into the texture                                                                         |
| `alpha`     | Opacity, 0–1; default 1                                                                                      |
| `flipX`     | Mirror left–right; an instance flip toggles it                                                               |
| `flipY`     | Mirror top–bottom                                                                                            |
| `blend`     | `normal`, `add`, `multiply` or `screen`                                                                      |
| `tile`      | Repeat the frame across `size` instead of stretching it                                                      |
| `nineSlice` | Border insets in texture px; default the texture's import setting                                            |
| `turn`      | Turn with the pose's rotation; default true                                                                  |

- **Placement.** The sprite draws at its entity's pose (the pose index,
  [below](#the-pose-index)) plus `offset`, anchored at `anchor`, as one
  visual `<entity id>#sprite` on the entity's layer with its `z` as depth.
  A sprite on a prop rotates with its body; a turned box draws a turned
  sprite; a flipped instance a mirrored one. An entity with a sprite isn't
  also drawn in its type's style.
- **Tint and blend.** Each is the block's, else the entity's `material`'s
  `render.tint` / `render.blend`, else none. A material reaches a sprite
  only through `registry.materials`, so only one with `physics` lends its
  tint and blend: a render-only material file is left out of the registry
  and lends nothing.
- **Sampling** is the texture's import `filter`, else the resolution
  policy's `sampling` ([Resolution](#resolution)).
- **The fallback box** is `size` (or the frame's, or 32×32) at the anchor
  in the type's style. It is what a view without `sprite` draws, what the
  Pixi view shows until the texture arrives, and what the schematic renders
  outline, labelled `asset[:frame]`.
- **Sizes headless.** `assetInfo(view, id, frame?)` (`./project` and
  `./headless`) gives a texture's pixel size, pivot, nine-slice and filter,
  or an atlas's frame names, tags, texture and, with `frame`, that frame's
  size, rectangle and pivot, from the asset's entry alone. A run reads the
  same through `ctx.project.asset(id, frame?)`, loaded from files or from a
  snapshot (which pins each blob's size and meta beside its hash).
  `spriteGeometry` turns a block and that info into the drawn box; the
  renders, picking and the sprite system all use it, and an atlas frame
  without a pivot of its own anchors at its texture's import pivot.

`decor` is the primitive for pictures: `{ id, type: "decor", at,
behaviors: { sprite } }`, no bulk form, no body. It has a pose and is
queryable headless, but nothing enters the physics world, so it can't
change a digest.

### Views

`SceneView` (`draw`, `pose`, `remove`, `layer`) grows optional members, so
every existing view and fake still satisfies it:

- `sprite?(id, visual, layer)` draws a `SpriteVisual` (`texture` by
  content hash, `frame`, `size`, `anchor`, `tint`, `alpha`, flips, `blend`,
  `tile`, `nineSlice`, `sampling` and the `fallback` shape and style).
  `drawSprite(view, id, visual, layer)` calls it, or draws the fallback box
  through `draw` on a view without it.
- `depth?(id, z)` orders a visual inside its layer: higher on top, ties by
  first draw.
- `commit?(tick)` and `frame?({ alpha, camera })` drive interpolation.
- `pose(id, x, y, rot?, snap?)`: `snap` places the visual with no
  interpolation from its last pose (new visuals always snap).

`createPixiView(container, { layers, textures, editing })` draws one Pixi
object per id: a `Graphics` for `draw`, a `Sprite`, `TilingSprite` or
`NineSliceSprite` for `sprite`, with frame textures cached per hash and
frame. It takes the registry's layers: a `sort: "y"` layer re-sorts by
`(z, y)` every frame, a `scroll` layer is offset by the camera times
`1 − scroll` (parallax), and an `editorOnly` layer's entity visuals show
only while `editing()` is true. `textures` is where hashes come from (the
loader); a miss draws the fallback and swaps in the texture when it loads.
See [Layers and `z`](#layers-and-z) for the layer model itself.

### Interpolation

The simulation ticks at a fixed rate and the screen draws in between, so
the view smooths what moves. Each visual keeps its previous and current
pose: a `pose` during a tick moves the current one (copying it to the
previous first, once per tick), the runtime calls `view.commit(tick)` after
each step, and each rendered frame `view.frame({ alpha, camera })` places
the visuals posed in the last committed tick at `lerp(prev, cur, alpha)`
(rotation by the shorter arc) and leaves the rest where they are. Paused
or in edit mode the shell passes `alpha: 1`. A game that teleports a
visual (a respawn) passes `snap` to `pose`, or it shows one lerped frame.
Static visuals are never posed, so they never move. After `view.frame` the
shell calls `runtime.render(alpha)`, the visual behaviors' render hooks.

### Loading art

Nothing is fetched by `loadScene`, which stays synchronous: a scene's
textures load ahead of it through the host's loader, and a sprite whose
texture isn't in yet draws its fallback box and swaps when it arrives.

```ts sprite-host.ts
import { createAssetLoader, createGame, type AssetUrl, type GameInstance } from "@jams/engine";
import type { KindRegistry, ProjectView } from "@jams/engine/project";
import { parseSceneOrThrow } from "@jams/engine/scene";

import { coinGame } from "./coin-game";

/** The dev server's blob route; a hosted build points at its own. */
const devUrl: AssetUrl = (project, entry) => `/__project/${project}/blob/${entry.sha256}`;

export async function startWithArt(
  canvas: HTMLCanvasElement,
  sceneText: string,
  project: { id: string; view: () => ProjectView; kinds: KindRegistry },
): Promise<GameInstance> {
  const loader = createAssetLoader({ project: project.id, url: devUrl });
  const game = await createGame(canvas, {
    game: coinGame,
    rapier: () => import("@dimforge/rapier2d"),
    displayWidth: canvas.clientWidth,
    displayHeight: canvas.clientHeight,
    assets: {
      loader,
      kinds: project.kinds,
      // Read at each bundle, so a live project's latest assets count.
      get view() {
        return project.view();
      },
    },
  });
  const scene = parseSceneOrThrow(sceneText, game.registry);
  const { failed } = await game.preload(scene, (p) => {
    console.log(`art ${p.loaded}/${p.total} (${p.bytes} of ${p.totalBytes} bytes)`);
  });
  // A failed texture draws its fallback box; the scene still loads.
  for (const entry of failed) console.warn(`couldn't load ${entry.id}`);
  const report = game.loadScene(scene);
  if (!report.ok) throw new Error(`the scene didn't load: ${report.error}`);
  game.start();
  return game;
}
```

- **Bundles.** `sceneBundle(scene, def, prefabs, view, kinds, registry)`
  (`./project`, pure) is the list of blobs a scene needs: every asset field
  of the expanded entities (instances resolved and defaults applied, so an
  id only a type's default names counts), the scene's settings, and the
  `assets` headers of the scene and of every prefab it reaches, with each
  asset's own references followed (an atlas brings its texture). Only
  textures are entries (`{ id, kind, sha256, bytes }`, sorted by id, each
  once); an atlas's frames are already in its meta. Anything unresolvable
  is `asset-missing`. `projectBundle(view, settings, kinds, registry)` is
  the `game-settings` doc's, loaded once and kept resident. `vp run scene
bundle <scene>` prints one.
- **The loader.** `createAssetLoader({ project, url, budgetBytes? })`
  (`@jams/engine`) loads textures through Pixi's `Assets`, keyed by content
  hash and shared by every bundle that holds the hash. `load(bundle, onProgress?)` fetches what isn't resident and
  reports failures instead of throwing; `retain` and `release` count a
  bundle in and out, and textures no resident bundle holds are evicted
  least-recently-used once the decoded bytes pass the budget (256 MiB by
  default). A re-imported file is a new hash, so it is a new key, never a
  cache bust.
- **`GameConfig.assets`** is `{ loader, view, kinds }` (the runtime view
  is `createGame`'s `project`): the host's loader,
  the project view bundles are computed over (read at each use, so a getter
  can follow a live project) and its kinds. `game.preload(scene,
onProgress?)` loads the scene's bundle, joined by the project bundle until
  all of its textures are in (a project texture that failed is fetched again
  by the next `preload` or `loadScene`); `loadScene` retains the new
  scene's bundle and releases the previous one. Without `assets` nothing is fetched and sprites draw as
  their boxes.
- **URLs are the host's.** `AssetUrl` is `(project, entry) => string`:
  the dev server serves `/__project/<id>/blob/<sha256>`, the site
  `/api/engine/projects/<id>/blobs/<sha256>`. The dev route is the
  package's `devAssetUrl(origin?)` (`editor-ui/connect/dev.ts`, served
  through `devProjectHost(...).assetUrl`); the site keeps only
  `hostedAssetUrl` in `src/components/game/asset-urls.ts`. Tests pass an
  in-memory one.
- **Headless never builds a loader** and never fetches: it sizes sprites
  from `assetInfo` alone.

### Hot reload of art

In development, re-exporting a PNG or atlas over its file is picked up by
the dev server, which rehashes it (one `replaceContent` with re-inspected
meta) and sends `asset:changed` on the project doc. The editor's session
waits until the project doc holds the new hash, rebuilds the project's
runtime view, and calls `game.reloadAssets({ project, view, changed })`:
the loader fetches the new hash and each sprite naming the asset (or an
atlas cut from it) redraws through its system's `update`. The scene isn't
reloaded and the world isn't rebuilt, so the runtime and its tick carry
on. A new `project` re-resolves the project bundle from its game settings,
so a settings asset field pointed at another texture loads it too. An
entity whose redraw throws is detached and attached afresh (left detached
if that throws again) while the rest still redraw; it comes back in the
result's `errors`, which the editor logs in dev. Only the dev server sends
the message; a hosted project picks up new art when a scene next loads.

## Behaviors at runtime

[Behaviors](#behaviors) covers defining one; this is what runs it.

- **The host.** Each scene runtime builds one behavior host after its type
  systems: one system per registered behavior that has one, in
  registration order (the engine's, then the game's). A behavior with no
  `system` builds nothing; a `visualOnly` one builds only when the context
  has a view, so headless `sprite` doesn't exist at all.
- **Order.** An entity's behaviors attach right after its type system
  spawns it (its pose is already set), in registration order, and detach
  right before it despawns, in reverse. An `update` that changes an entity
  updates each block that changed, attaches the new ones and detaches the
  removed ones; a system without `update` is detached and attached again.
  A behavior that throws on attach rolls the whole call back, as a type
  system's failed spawn does. Each tick runs the type systems'
  `beforeStep`, the game's `beforeStep`, the physics step, the type
  systems' `afterStep`, each behavior's `step`, then the game's
  `afterStep` (so the game sees what behaviors did), then the sprites'
  re-pose (so a pose the game wrote draws this tick), then `view.commit`.
  `reset` and `seek` reach behaviors as they reach type systems, and
  `stats().behaviors` counts attachments per behavior.
- **`ctx.behavior(name)`** gives a behavior's system, as `system(type)`
  gives a type's: undefined for a data-only behavior, and for a visual-only
  one headless.
- **Visual only means visual only.** A `visualOnly` behavior may read
  entities, poses and the project, and writes only through `ctx.view`.
  Every visual-only behavior is held to that by one check: a playtest with
  a recording view and the same playtest headless give the same digest
  (the engine's own runs it over a hundred sprites and `decor`).

### The pose index

`ctx.poses` (`PoseIndex`, simulation-side, deterministic, in no digest)
holds every loaded entity's pose `{ x, y, rot }` (radians) from the moment
it spawns: the runtime sets `spawnPose` (a shape's centre, a point field,
or a follower's first path point; the angle from `rotDeg`, else the
entity's quarter turns), snapped, before its behaviors attach, and removes
it after they detach. The system that moves an entity writes it: bodies
after the physics step (a body's angle plus its quarter turns for shapes
without `rotDeg`), followers along their path; markers and static solids
and sensors are written once. `get(id)` is the pose after the last tick,
`prev(id)` the pose a tick earlier (the same when it didn't move), and
`set(id, x, y, rot?, { snap? })` is only for the system that owns `id`; a
game may write the poses of its own entities.

```ts halo-behavior.ts
import { DRAW_LAYERS, defineBehavior, defineGame, type BehaviorSystem } from "@jams/engine/game";
import { z } from "zod";

import { coinGame } from "./coin-game";

/** A ring drawn around the entity. Visual only: built with a view, never headless. */
export const halo = defineBehavior({
  name: "coin-game/halo",
  description: "A ring drawn around the entity.",
  visualOnly: true,
  fields: { radius: z.number().positive().default(24).describe("Ring radius, px; default 24.") },
  system(ctx): BehaviorSystem {
    const rings = new Set<string>();
    const ringOf = (id: string) => `${id}#halo`;
    return {
      attach(id, block) {
        rings.add(id);
        const r = Number(block.radius);
        const style = { stroke: 0xffd700, strokeWidth: 2 };
        ctx.view?.draw(ringOf(id), { type: "circle", cx: 0, cy: 0, r }, style, DRAW_LAYERS.overlay);
        // The runtime set the spawn pose before any behavior attached.
        const pose = ctx.poses.get(id);
        if (pose) ctx.view?.pose(ringOf(id), pose.x, pose.y, 0, true);
      },
      detach(id) {
        if (rings.delete(id)) ctx.view?.remove(ringOf(id));
      },
      // After the type systems' afterStep, so the poses are this tick's.
      step() {
        for (const id of rings) {
          const pose = ctx.poses.get(id);
          const prev = ctx.poses.prev(id);
          if (pose && (!prev || pose.x !== prev.x || pose.y !== prev.y))
            ctx.view?.pose(ringOf(id), pose.x, pose.y);
        }
      },
      clear() {
        for (const id of rings) ctx.view?.remove(ringOf(id));
        rings.clear();
      },
      size: () => rings.size,
    };
  },
});

export const haloGame = defineGame({
  ...coinGame,
  behaviors: [halo],
  createRuntime(ctx) {
    const inner = coinGame.createRuntime(ctx);
    return {
      ...inner,
      onLoad(scene) {
        inner.onLoad?.(scene);
        // Undefined headless: a visual-only behavior's system isn't built there.
        const rings = ctx.behavior(halo.name)?.size() ?? 0;
        if (rings > 0) console.log(`${rings} haloed entities`);
      },
    };
  },
});
```

## Resolution

How the world maps onto the canvas is a `ResolutionPolicy`:

- `virtual`: the world units the camera shows at zoom 1, `{ height }`,
  `{ width }` or both.
- `fit`: `expand` (the fixed axis fills the canvas and the other shows
  more), `letterbox` (the whole virtual area shows, bars fill the rest) or
  `crop` (the virtual area covers the canvas, the overflow is cut); the
  last two need a width and a height, and fit as `expand` without both.
- `integer`: scale only by whole multiples, for pixel art; bars take the
  remainder. `pixelSnap`: round camera and visual positions to whole canvas
  pixels. `sampling`: the default texture sampling, `linear` or `nearest`
  (a texture's import `filter` wins). `antialias`: the renderer's
  antialiasing. `bars`: the bar colour, default the background.

`DEFAULT_RESOLUTION` is `{ virtual: { height: 1080 }, fit: "expand",
sampling: "linear", antialias: true }`, what the shell always did, so a
game that sets nothing looks the same. The policy in force is resolved
field by field (`resolveResolution`; `virtual` is taken whole): the host's
`GameConfig.resolution` (a site's display menu), then the project's
`game-settings` `engine.resolution`, then `GameDefinition.resolution`, then
the default. `viewportFor(policy, canvas)` is the pure maths: the
world-to-canvas `scale`, the world `view` the camera shows, and the
`offset` and `bars` of the shown area.

```ts pixel-art.ts
import { resolveResolution, viewportFor, type ResolutionPolicy } from "@jams/engine";
import { defineGame } from "@jams/engine/game";

import { coinGame } from "./coin-game";

/** A 640×360 world scaled by whole multiples, letterboxed, sampled nearest. */
const pixelArt: Partial<ResolutionPolicy> = {
  virtual: { width: 640, height: 360 },
  fit: "letterbox",
  integer: true,
  sampling: "nearest",
  antialias: false,
  pixelSnap: true,
};

export const pixelCoinGame = defineGame({ ...coinGame, resolution: pixelArt });

// The host's policy wins field by field, then the project's, then the game's.
const policy = resolveResolution({ game: pixelArt, host: { bars: 0x000000 } });
const { scale, view, offset } = viewportFor(policy, { width: 1920, height: 1080 });
console.log(scale, view, offset); // 3 { width: 640, height: 360 } { x: 0, y: 0 }
```

The store's `CameraState` carries `scale`, world units to canvas pixels
(the policy's scale times `zoom`), which an overlay drawn over the canvas
reads to line up with the world. `VIRTUAL_HEIGHT`, `DISPLAY_RESOLUTIONS`
and the `DisplayResolution` type are gone from the engine's exports: the
virtual size is the policy's, and a list of display sizes is the host's to
offer.

## World models

A game says how its clock runs with `GameDefinition.time`, a `TimeModel`:

- **`fixed`** (the default): a tick every `1 / rate` seconds of scaled wall
  time, whatever happens.
- **`turns`** and **`event`**: the loop draws every frame but ticks only
  when an input wakes it (a key edge or a command; an event game with
  `wakeOnPointerMove` also wakes on pointer moves), then once per `1 /
rate` seconds while the runtime's `busy()` returns true, and otherwise
  holds still. Turns suits a game that moves per order, event an idle or
  menu-driven one. `step(n)` simulates `n` ticks whatever the model, for
  debugging.

`rate` is an integer from 1 to 240, default 60, resolved first match wins
from the project's `game-settings` `engine.tickRate`, then the game's
`time.rate`, then 60 (`resolveTime` in `./scene` applies the order;
`ticksFor(ms, time)` is the whole ticks a duration lasts). The run's clock
is `ctx.time` (`kind`, `rate`, `tickMs`, `catchUp`, `wakeOnPointerMove`),
and every tick's `dtMs` is its `tickMs`. A rate the clock can't run is
`tick-rate-invalid`: `createRegistry` throws with it, and the project's
`game-settings` doc reports it. Headless runs of a turns or event game skip
the script slots a sleeping game would ignore, carrying their non-waking
input to the next simulated tick: `ticks` and every tick in a report count
simulated ticks, and `slots` the slots a playtest used.

**Commands** are how anything but the keyboard drives a game: a move in a
turn game, a button in a host's UI, an agent's order. A game declares them
in `commands`, each with a `description` and an optional Zod `args` schema;
names are lowercase words joined by dashes and never start with `@`, which
is the engine's. `GameInstance.send({ name, args })` queues one for the next
simulated tick and wakes a sleeping game (false, with a dev warning, when
not playing, for an unknown name or arguments that don't parse), and the
runtime gets the tick's commands as `beforeStep`'s third argument. Input
scripts send them with `{ command, args }` and `{ elapse }` steps, playtest
reports list them beside `inputs`, recordings carry them, and replays send
them on the same ticks.

**Catch-up.** With `time.catchUp: { maxMs }`, time away arrives as one
engine command, `@elapsed { ms }`, capped at `maxMs`: the browser shell
measures how long the page was hidden and sends it when the page is shown
again after at least a second, and `GameInstance.elapse(ms)` sends it for a
host (a restored save's last-seen gap). Without `catchUp` neither does
anything. An idle game that ripens apples by the minute:

```ts orchard-game.ts
import { defineGame } from "@jams/engine/game";
import { runPlaytest } from "@jams/engine/headless";
import type { SceneDefinition } from "@jams/engine/scene";

export type OrchardSnapshot = { trees: number; ripe: number; picked: number };

const HOUR = 3_600_000;

/** An idle game: apples ripen while nobody plays, and only input or a command wakes it. */
export const orchardGame = defineGame<OrchardSnapshot>({
  id: "orchard",
  types: [],
  actions: [{ action: "pick", keys: ["space"], description: "Pick every ripe apple." }],
  time: { kind: "event", catchUp: { maxMs: 8 * HOUR } },
  world: { physics: "none" },
  commands: { plant: { description: "Plant one more tree." } },
  createRuntime() {
    let trees = 1;
    let ripe = 0;
    let picked = 0;
    return {
      onLoad() {
        trees = 1;
        ripe = 0;
        picked = 0;
      },
      beforeStep(_dtMs, actions, commands) {
        for (const c of commands) {
          if (c.name === "plant") trees++;
          // Time away, already capped at catchUp.maxMs: an apple per tree per minute.
          if (c.name === "@elapsed")
            ripe += trees * Math.floor((c.args as { ms: number }).ms / 60_000);
        }
        if (actions.some((a) => a.action === "pick" && a.pressed)) {
          picked += ripe;
          ripe = 0;
        }
      },
      snapshot: () => ({ trees, ripe, picked }),
    };
  },
});

/** The game keeps its trees in its runtime, so the scene is empty. */
export const meadow: SceneDefinition = {
  v: 3,
  game: "orchard",
  name: "meadow",
  bounds: [0, 0, 640, 360],
  entities: [],
};

/** Plants a tree, is away for a day (capped at eight hours), then picks. */
export function dayAway() {
  const run = runPlaytest({
    game: orchardGame,
    scene: meadow,
    script: { v: 1, steps: [{ command: "plant" }, { elapse: 24 * HOUR }, { press: ["pick"] }] },
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.scriptIssues)}`);
  return { final: run.final, ticks: run.ticks };
}
```

A turn game on a grid: each `walk` command plans a path, and `busy()` keeps
the clock running until the hero arrives. It has no physics (`world.physics:
"none"`), so a host never loads Rapier for it:

```ts walker-game.ts
import {
  createGridStepper,
  defineGame,
  findPath,
  type Cell,
  type EngineContext,
  type GridStepper,
} from "@jams/engine/game";
import type { ExpandedScene, Pt } from "@jams/engine/scene";
import { z } from "zod";

export type WalkerSnapshot = { cell: Cell | null; walks: number; home: boolean };

const markerAt = (scene: ExpandedScene, tag: string) =>
  scene.entities.find(
    (e) => e.type === "marker" && (e.tags as string[] | undefined)?.includes(tag),
  );

/** A turn game with no physics: each `walk` command paths the hero over the grid, cell by cell. */
export const walkerGame = defineGame<WalkerSnapshot>({
  id: "walker",
  types: [],
  actions: [],
  time: { kind: "turns", rate: 30 },
  world: { physics: "none", grid: { kind: "square", cell: [32, 32] } },
  commands: {
    walk: {
      description: "Walk the hero to a cell along the shortest open path.",
      args: z.strictObject({ to: z.tuple([z.number().int(), z.number().int()]) }),
    },
  },
  play: {
    results: ["won"],
    outcome: ({ snapshot }) => (snapshot.home ? { result: "won" } : null),
  },
  createRuntime(ctx: EngineContext) {
    let hero: { id: string; at: Pt } | null = null;
    let goal: Pt | null = null;
    let stepper: GridStepper | null = null;
    let route: Cell[] = [];
    let walks = 0;

    const home = () => {
      if (!stepper || !goal || !ctx.grid) return false;
      const [c, r] = ctx.grid.geometry.cellAt(goal);
      const [hc, hr] = stepper.cell();
      return c === hc && r === hr && !stepper.moving();
    };

    return {
      onLoad(scene) {
        const h = markerAt(scene, "hero");
        hero = h ? { id: h.id, at: h.at as Pt } : null;
        goal = (markerAt(scene, "goal")?.at as Pt | undefined) ?? null;
        stepper = null;
        route = [];
        walks = 0;
      },
      beforeStep(dtMs, _actions, commands) {
        const grid = ctx.grid;
        if (!grid || !hero) return;
        // ctx.grid is built after onLoad, so the stepper starts on the first tick.
        stepper ??= createGridStepper(ctx, hero.id, {
          start: grid.geometry.cellAt(hero.at),
          msPerStep: 150,
        });
        stepper.update(dtMs);
        for (const command of commands) {
          if (command.name !== "walk") continue;
          const { to } = command.args as { to: [number, number] };
          const path = findPath(grid.geometry, stepper.cell(), to, {
            passable: (c) => grid.passable(c),
          });
          route = path?.cells.slice(1) ?? [];
          walks++;
        }
        const next = route[0];
        if (next && !stepper.moving() && stepper.step(next)) route.shift();
      },
      // While true, the clock keeps ticking at `time.rate` with no input.
      busy: () => route.length > 0 || (stepper?.moving() ?? false),
      snapshot: () => ({ cell: stepper?.cell() ?? null, walks, home: home() }),
    };
  },
});
```

```ts walker-playtest.ts
import { createRegistry } from "@jams/engine/game";
import { replayRecording, runPlaytest, type RapierModule } from "@jams/engine/headless";
import { scenePhysics, type SceneDefinition } from "@jams/engine/scene";

import { walkerGame } from "./walker-game";

const registry = createRegistry(walkerGame);

/** Ten cells by five; a wall over the top four rows of column 4 sends the hero round the bottom. */
export const corridor: SceneDefinition = {
  v: 3,
  game: "walker",
  name: "corridor",
  bounds: [0, 0, 320, 160],
  entities: [
    { id: "wall", type: "solid", shape: ["box", 144, 64, 16, 64] },
    { id: "hero", type: "marker", at: [16, 16], tags: ["hero"] },
    { id: "goal", type: "marker", at: [304, 16], tags: ["goal"] },
  ],
};

/** Plays two `walk` commands, then replays the recording; Rapier is never loaded. */
export async function walkCorridor(loadRapier: () => Promise<RapierModule>) {
  const rapier = scenePhysics(corridor, registry) === "rapier" ? await loadRapier() : null;
  const run = runPlaytest({
    rapier,
    game: walkerGame,
    registry,
    scene: corridor,
    script: {
      v: 1,
      steps: [
        { command: "walk", args: { to: [0, 4] } },
        { wait: 100 },
        { command: "walk", args: { to: [9, 0] } },
        { wait: 300 },
      ],
    },
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.scriptIssues)}`);
  const replay = replayRecording({
    rapier,
    game: walkerGame,
    scene: corridor,
    recording: run.recording,
  });
  return {
    result: run.outcome.result,
    // Ticks run only while the hero walks: the first wait's idle slots were skipped.
    ticks: run.ticks,
    slots: run.slots,
    commands: run.commands,
    replayed: !replay.blocked && replay.matches,
  };
}
```

## Physics optional

A scene's physics resolves like gravity (see [Settings](#settings)): the
scene's `settings.physics`, the project's `engine.physics`, the game's
`world.physics`, then `"rapier"`. `scenePhysics(def, registry, engine?)`
answers before anything loads, so a host decides whether it needs the
wasm. With `"none"`, `ctx.rapier` and `ctx.physics` are null and
`ctx.geometry` holds the engine's own colliders, static and kinematic
shapes with sensors and collision groups, filtered exactly as Rapier
filters them. `ctx.space` answers the same queries on either backend
(`space.backend` says which): `pointAt`, `overlaps`, `raycast` and `sweep`,
filtered by `sensors`, `exclude`, `group` and `types`, overlaps in handle
order and casts by time of impact, then handle.

| Primitive                | With Rapier          | With `physics: "none"`                                        |
| ------------------------ | -------------------- | ------------------------------------------------------------- |
| `solid`                  | fixed body, collider | a static collider; one-way sides gate on its tag              |
| `sensor`                 | sensor collider      | a sensor collider; enter and exit from overlaps, in one order |
| `follower`               | kinematic body       | a kinematic collider whose pose follows the path              |
| `marker`, `decor`, `nav` | nothing              | nothing                                                       |
| `prop`                   | dynamic body         | `physics-required`                                            |
| `attach`                 | rides the follower   | `physics-required`                                            |

A type that can't work without Rapier says `physics: "required"` (the
default is its base primitive's, else `"optional"`): `validateScene`
reports `physics-required` for each of its entities in a physics-free
scene, before anything loads. Its system reaches Rapier through
`physicsOf(ctx, what, entityId)`, which returns `{ rapier, physics }` or
throws a `PhysicsRequiredError`; a load that hits one fails with `reason:
"physics-required"`. `RuntimeStats.backend` is `rapier` or `geometry`.

```ts balloon-type.ts
import type { RigidBody } from "@dimforge/rapier2d";
import {
  createRegistry,
  defineEntityType,
  defineGame,
  physicsOf,
  pointField,
} from "@jams/engine/game";
import { validateScene, type Pt, type SceneDefinition } from "@jams/engine/scene";
import { z } from "zod";

/** A balloon floats up: a Rapier body with a negative gravity scale, so it needs physics. */
export const balloon = defineEntityType({
  type: "balloon",
  description: "A balloon that floats up.",
  physics: "required",
  fields: {
    at: pointField("Where it starts."),
    lift: z
      .number()
      .positive()
      .default(0.3)
      .describe("How strongly it rises, as a share of gravity."),
  },
  style: { fill: 0xff6688, stroke: 0xff6688 },
  system(ctx, type) {
    const bodies = new Map<string, RigidBody>();
    return {
      spawn(e) {
        // Throws PhysicsRequiredError in a scene with physics "none"; the load reports it.
        const { rapier, physics } = physicsOf(ctx, type.type, e.id);
        const [x, y] = e.at as Pt;
        const body = physics.addRigidBody(
          rapier.RigidBodyDesc.dynamic().setTranslation(x, y).setGravityScale(-Number(e.lift)),
        );
        const desc = rapier.ColliderDesc.ball(10);
        desc.setCollisionGroups(ctx.registry.collisionGroups("dynamic"));
        ctx.tags.set(physics.addCollider(desc, body).handle, { entityId: e.id, type: type.type });
        ctx.poses.set(e.id, x, y, 0, { snap: true });
        bodies.set(e.id, body);
      },
      despawn(id) {
        const body = bodies.get(id);
        if (!body) return;
        for (let i = 0; i < body.numColliders(); i++) ctx.tags.delete(body.collider(i).handle);
        physicsOf(ctx, type.type, id).physics.removeRigidBody(body);
        bodies.delete(id);
      },
      clear() {
        for (const id of [...bodies.keys()]) this.despawn(id);
      },
      afterStep() {
        for (const [id, body] of bodies) {
          const p = body.translation();
          ctx.poses.set(id, p.x, p.y, body.rotation());
        }
      },
      size: () => bodies.size,
    };
  },
});

const party = defineGame({
  id: "party",
  types: [balloon],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});
const registry = createRegistry(party);

/** The codes a physics-free scene with a balloon gets: `physics-required`, before anything loads. */
export function balloonIssues(): string[] {
  const scene: SceneDefinition = {
    v: 3,
    game: "party",
    name: "party",
    bounds: [0, 0, 400, 300],
    settings: { physics: "none" },
    entities: [{ id: "red", type: "balloon", at: [200, 250] }],
  };
  return validateScene(scene, registry).map((i) => i.code);
}
```

**Rapier loads lazily.** `GameConfig.rapier` is optional: `createGame`
loads it at start only when the game's start-up scene needs it,
`GameInstance.preload` brings it in for a Rapier scene, and `loadScene`,
`play` or `replay` of a Rapier scene with no module reports
`physics-not-loaded`. The headless options take `rapier: RapierModule |
null`, and the scene CLI loads the wasm only for a Rapier scene.

**Replays everywhere.** The geometry backend uses only `+ − × ÷` and
`Math.sqrt`, which every JavaScript engine rounds alike, and quarter turns
are exact tables; a collider turned by any other angle needs `Math.cos`
and `Math.sin`, which engines may round differently. So a physics-free game
replays bit for bit across browsers and machines as long as its colliders
stay axis-aligned or quarter-turned, which every grid and turn game does.
Rapier scenes replay exactly on the same build, as before.

**Nothing assumes a side view.** Gravity defaults to `DEFAULT_GRAVITY` and
any vector works, `[0, 0]` and sideways included. "Play from here" settles
the start along gravity, not at all or along a direction
(`SpawnShape.cast`). `PhysicsWorld.createCharacterController` takes its
options in full: `SIDE_VIEW_CONTROLLER` is the old tuning,
`TOP_DOWN_CONTROLLER` has no slopes, steps or snapping. A solid's `oneWay`
names the side actors land on (`"up"`, the same as `true`, `"down"`,
`"left"` or `"right"`) and turns with its instance; the kitchen sink's
`side-wall` is one-way from the left. A `prop` takes `gravityScale`,
`linearDamping`, `angularDamping`, `fixedRotation` (the sink's `upright`)
and `ccd`. `world.lengthUnit`, Rapier's pixels per metre, is reserved:
accepted, and read by nothing yet.

## Grids at runtime

A scene with a grid (its `settings.grid`, else the game's `world.grid`)
gets `ctx.grid` at load: the `geometry`, an `occupancy`, the scene's
`bounds` in cells and `passable(cell)`. Cells covered by the shapes of the
game's `world.gridWalls` types (default `["solid"]`, `[]` for none) are
walls. Everything else is pure and works without a runtime:

- **`gridGeometry(settings)`** for square and hex grids, placed as Tiled
  places them: `neighbors` in a fixed order, `stepCost` (10 an edge, 14 a
  diagonal), `heuristic`, `distance`, `center`, `cellAt`, `corners`, `line`
  (every cell a segment passes through), `cellsIn(shape)` and `rect`.
  Cells are `[col, row]`; `cellKey` packs one into a number for sets and
  maps.
- **`createOccupancy()`**: which ids hold which cell, which cells block
  paths, which are walls. The `occupant` behavior (`{ blocks? }`) keeps an
  entity in `ctx.grid.occupancy` as it moves.
- **`findPath`** (A\* with integer costs and a heap ordered by f, h and
  insertion, so one answer on every machine), **`flowField`** (every cell's
  cost to the nearest goal and the neighbour to step to, for many walkers),
  **`fieldOfView`** (symmetric shadowcasting on squares, a line to each
  cell on hexes) and **`lineOfSight`**. Paths take `passable`, a `cost` per
  step, `diagonals`, `cutCorners`, `bounds` and `maxExpanded`.

A `connected` check asks a scene's `.checks.json` whether cells or entities
reach each other on the grid, with no physics and no game code; each
unreachable target is `grid-unreachable`. The scene CLI's `grid` command
prints the walls, a path and a field of view as text. The engine's
`grid-yard` is a physics-free scene on a 32 px square grid with a
`connected` check.

```ts grid-tools.ts
import {
  cellKey,
  fieldOfView,
  findPath,
  flowField,
  gridGeometry,
  lineOfSight,
  type Cell,
} from "@jams/engine/game";

/** A 12×8 hex board, Tiled's flat-top layout, with a rock wall down column 5 but for its last row. */
const hex = gridGeometry({ kind: "hex", cell: [32, 28], side: 16, stagger: "x", index: "odd" });
const bounds = { c0: 0, r0: 0, c1: 11, r1: 7 };
const rocks = new Set([0, 1, 2, 3, 4, 5, 6].map((r) => cellKey([5, r])));
const open = (c: Cell) => !rocks.has(cellKey(c));

export function scout() {
  // A*, integer costs (10 a step), the same path on every machine.
  const path = findPath(hex, [1, 1], [9, 1], { passable: open, bounds });
  // Every cell's cost to the nearest goal, and the neighbour to step to: one field, many walkers.
  const field = flowField(hex, [[9, 1]], { passable: open, bounds });
  // What [1, 1] sees within 6 steps; the rocks block sight.
  const seen = fieldOfView(hex, [1, 1], 6, (c) => !open(c));
  return {
    steps: path ? path.cells.length - 1 : null,
    cost: path?.cost ?? null,
    fromCorner: field.cost([0, 7]),
    nextFromCorner: field.next([0, 7]),
    seesAcross: seen.has(cellKey([8, 1])),
    clearShot: lineOfSight(hex, [1, 7], [9, 7], (c) => !open(c)),
    centre: hex.center([9, 1]),
  };
}
```

## Motion

`./game` moves entities without a game writing its own physics, on either
backend:

- **`createMotionBody(ctx, entity, at, { shape, group?, tag? })`**: a body
  moved by `move(delta)`, which slides along what it hits (up to four
  times) and reports what it `moved`, its `hits` and whether it was
  `blocked`. On Rapier it is a kinematic body with a
  `TOP_DOWN_CONTROLLER` character controller; on geometry a kinematic
  collider swept through `ctx.space`. `teleport`, `setEnabled` and
  `destroy` do what they say. It doesn't push props: a game that wants
  pushing uses Rapier's character controller itself.
- **`createTopDownController(body, { maxSpeed, accel, decel })`**: steering
  toward an intended direction in the unit disc, with acceleration and
  braking, one `step(dtMs, intent)` a tick.
- **`createGridStepper(ctx, entityId, { start, msPerStep, body?, occupy?
})`**: one cell at a time to a neighbour, reserving the cell at once and
  moving there over whole ticks.

Each writes the entity's pose, so sprites, picking and interpolation follow
with no other wiring. A top-down rover that steers into a wall, slides
along it into a sensor, and wins on Rapier and without it:

```ts rover-game.ts
import type { Vec2 } from "@jams/engine";
import {
  createMotionBody,
  createTopDownController,
  defineGame,
  SENSOR_ENTER,
  type EngineContext,
  type TopDownController,
} from "@jams/engine/game";
import { runPlaytest, type RapierModule } from "@jams/engine/headless";
import type { Pt, SceneDefinition } from "@jams/engine/scene";

export type RoverSnapshot = { at: Vec2; speed: number; wallAhead: number | null } | null;

const STEER: Readonly<Record<string, Vec2>> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

/** Top-down steering on whichever backend the scene loads: a motion body, a controller and a sensor goal. */
export const roverGame = defineGame<RoverSnapshot>({
  id: "rover",
  types: [],
  actions: Object.keys(STEER).map((action) => ({
    action,
    keys: [`arrow${action}`],
    description: `Steer ${action}.`,
  })),
  world: { gravity: [0, 0] },
  // Motion bodies are in the engine's dynamic group, which ignores sensors unless told.
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  play: {
    results: ["won"],
    movementActions: Object.keys(STEER),
    focus: (snap) => snap?.at ?? null,
    outcome: ({ events }) =>
      events.some((e) => e.type === "rover:home") ? { result: "won" } : null,
  },
  createRuntime(ctx: EngineContext) {
    const held = new Set<string>();
    let rover: TopDownController | null = null;
    let position = (): Vec2 => ({ x: 0, y: 0 });
    let id = "";
    return {
      onLoad(scene) {
        held.clear();
        const start = scene.entities.find((e) => e.id === "start");
        if (!start) return;
        const [x, y] = start.at as Pt;
        id = start.id;
        const body = createMotionBody(
          ctx,
          { id, type: start.type },
          { x, y },
          {
            shape: { type: "circle", cx: 0, cy: 0, r: 8 },
          },
        );
        position = () => body.position();
        rover = createTopDownController(body, { maxSpeed: 180, accel: 900, decel: 900 });
      },
      beforeStep(dtMs, actions) {
        for (const a of actions) {
          if (a.pressed) held.add(a.action);
          else held.delete(a.action);
        }
        const intent = { x: 0, y: 0 };
        for (const a of held) {
          intent.x += STEER[a]?.x ?? 0;
          intent.y += STEER[a]?.y ?? 0;
        }
        rover?.step(dtMs, intent);
      },
      afterStep(_dtMs, events) {
        for (const e of events)
          if (e.type === SENSOR_ENTER && e.entityId === "home" && e.other === id)
            ctx.emit({ type: "rover:home", entityId: "home", at: e.at });
      },
      snapshot() {
        if (!rover) return null;
        const at = position();
        const v = rover.velocity();
        // ctx.space answers on Rapier and on the geometry backend alike.
        const hit = ctx.space.raycast(at, { x: 1, y: 0 }, 1000, { exclude: [id] });
        return {
          at,
          speed: Math.sqrt(v.x * v.x + v.y * v.y),
          wallAhead: hit ? hit.toi * 1000 : null,
        };
      },
    };
  },
});

const yard = (physics: "rapier" | "none"): SceneDefinition => ({
  v: 3,
  game: "rover",
  name: "yard",
  bounds: [0, 0, 400, 300],
  settings: { physics },
  entities: [
    { id: "east", type: "solid", shape: ["box", 392, 150, 8, 150] },
    { id: "south", type: "solid", shape: ["box", 200, 292, 200, 8] },
    { id: "start", type: "marker", at: [40, 40] },
    { id: "home", type: "sensor", shape: ["box", 360, 260, 24, 24] },
  ],
});

/** Drives right into the east wall, then slides down it into the home sensor. */
export function driveHome(rapier: RapierModule | null) {
  const run = runPlaytest({
    rapier,
    game: roverGame,
    scene: yard(rapier ? "rapier" : "none"),
    script: {
      v: 1,
      steps: [
        { hold: ["right"], forMs: 2500 },
        { hold: ["right", "down"], until: { event: "rover:home" }, max: 600 },
      ],
    },
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.issues)}`);
  return { result: run.outcome.result, ticks: run.ticks, final: run.final };
}
```

## Navigation

The `nav` primitive marks walkable areas for games with neither a grid nor
physics to walk on (point-and-click, a room-based RPG): `{ id, type:
"nav", shape: ["poly", …], mode?: "walk" | "block", tags? }`. A walk area
is any simple polygon, concave allowed; a `block` polygon is a hole in the
area around it. At load the runtime builds `ctx.nav` (`path`, `contains`,
`nearest` and the `mesh`); `buildNavMesh`, `navPath`, `navContains` and
`navNearest` are the same maths without a runtime. Areas are triangulated
by ear clipping with their holes bridged in and stitched where they share
an edge's exact end points; paths run A\* over the triangles, then the
funnel. A polygon that crosses itself, a hole not inside exactly one walk
area, or two walk areas that overlap is `nav-invalid`. The kitchen sink's
`floor-plan` is an L-shaped hall with the `pillar` hole in it.

```ts nav-walk.ts
import { buildNavMesh, navContains, navNearest, navPath } from "@jams/engine/game";

type Ring = [number, number][];

/** A room with a table in it, and a corridor stitched on where they share the doorway's two corners. */
const room = {
  id: "room",
  pts: [
    [0, 0],
    [400, 0],
    [400, 100],
    [400, 200],
    [400, 300],
    [0, 300],
  ] as Ring,
};
const corridor = {
  id: "corridor",
  pts: [
    [400, 100],
    [700, 100],
    [700, 200],
    [400, 200],
  ] as Ring,
};
const table = {
  id: "table",
  pts: [
    [150, 100],
    [250, 100],
    [250, 200],
    [150, 200],
  ] as Ring,
};

export function walkAround() {
  const { mesh, issues } = buildNavMesh([room, corridor], [table]);
  // The funnel's corners: round the table, through the doorway, to the end of the corridor.
  const path = navPath(mesh, [100, 150], [650, 150]);
  return {
    issues,
    path,
    onTable: navContains(mesh, [200, 150]),
    // A click outside the walk areas, moved to the closest walkable point.
    clickedOutside: navNearest(mesh, [550, 280]),
  };
}
```

## Genre probes

The engine proves it isn't a platformer engine with small games built in
tests from the primitives and the APIs above, under
`src/engine/__tests__/genres/`. Each probe is a game, a scene built in
code, an input script and the result it must reach:

| Probe          | Genres                       | Physics | Time  | What it plays                                                                            |
| -------------- | ---------------------------- | ------- | ----- | ---------------------------------------------------------------------------------------- |
| `grid-puzzle`  | puzzle, card and board games | none    | event | a square-grid Sokoban: arrow keys step a pusher; won with both crates on goals           |
| `top-down`     | top-down, racing             | rapier  | fixed | a top-down controller steers through a corridor of solids into a goal sensor             |
| `turn-tactics` | tactics, roguelikes          | none    | turns | hex grid, `move` and `end-turn` commands; A\* moves a unit, field of view finds a target |

`runGenreProbe` plays each, replays its recording, and compares a digest of
the run with a pinned one, so CI on other machines checks the same numbers.
Probes also run under variants (gravity zero, gravity sideways, physics
none) that must reach the same result. A physics-free probe never loads
Rapier: the harness hands it none and a mock fails if the wasm module ever
initialises. A sweep test fails on side-view literals in engine source, and
a matrix maps every genre row of the engine's roadmap to the probes that
cover it.

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

### Doc layout 3

Format v3 comes with collab layout 3 (`COLLAB_LAYOUT_VERSION`), laid out so
concurrent v3 edits merge:

```text
Scene doc
meta        kind, schemaVersion 3, layout 3, project, key, game?, $schema?
scene       name, bounds
settings    one atomic value per top-level key: gravity, physics, grid, view, the game's
assets      asset id → true
groups      id → { at, rot?, flip?, name? }
instances   key → { @z, id, prefab, at, rot?, flip?, z?, params: map, overrides: map, … }
entities    key → { @z, @bulk?, id, type, …fields, path: map, behaviors: map of maps, "<grid>@<cx>,<cy>/<row>": row }
log

Prefab doc
meta, prefab (id, base?, contract?), params (name → param), overrides (a variant's),
assets, instances, entities, log
```

- Keys the layout owns start with `@`: a record's fractional order is
  `@z` and a bulk entry's key `@bulk`, so a field may be called `z`.
  `createRegistry` refuses field names that could clash.
- `behaviors` is two levels deep (name → field → value, each field
  atomic): different fields or behaviors merge, and removing a behavior
  while someone edits inside it removes it. `params` and `overrides` merge
  per key.
- Each non-empty grid row is its own key (`tiles@-1,0/0`), so painters in
  different chunks or rows merge and a paint writes only the rows it
  changed; one row is last-writer-wins.
- `assets` is a set, so two people adding different ids keep both.
- Loading a layout-2 doc lifts it in one `migration` transaction
  (`migrateLayout` for scenes, `migrateDocLayout` for prefabs and keyed
  layouts): `z` → `@z`, `bulk` → `@bulk`, `layout: 3`, then
  `schemaVersion` 3 (`migrateDoc`). A
  hosted client whose token claims an older layout opens docs read-only
  with `engine-outdated`.

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

## Editor UI

`@jams/engine/editor-ui` is the scene editor the jams.team site runs, as a
React component any host can render: the outliner, inspector, problems,
history, project tree and load-run panels around a full-bleed game canvas,
with the toolbar, play bar and status bar in floating islands. It drives
`./editor`'s session and `./collab`'s docs, and reaches a server only
through the host.

- **`SceneEditor`** takes `{ host, game, project, scene?, rapier, debug?,
onReady? }`; `mountSceneEditor(element, props)` mounts the same thing
  without JSX and returns `{ update, unmount }`. `onReady` hands the host a
  `SceneEditorHandle` (`openPanel(id)`, `resetLayout()`, and `game()`, the
  editor's current `GameInstance`, null while it builds).
- **`EditorHost`** is the one seam. `connect({ project, registry, origin })`
  returns a `ProjectConnection` and `assetUrl` says where the asset loader
  fetches blobs; both are required. The rest default when left out:
  `identity` ("Guest n"), `peerColor` (a fixed palette by hash), `notify`
  (the editor's own toast region; sonner's `toast` fits as it is), `cue`
  (silent), `flag` (every flag off), `storage` (guarded `localStorage`
  under `jams-editor:*`; `null` keeps nothing), `chrome.topLeft` and
  `chrome.topRight` (the host's own islands), `onSceneChange` (the editor
  opened another scene than the one asked for) and `readOnly`.
- **Connectors.** `devProjectHost({ hocuspocus, origin?, buildAt? })` is
  `connect` and `assetUrl` for `./vite`'s dev server: one Hocuspocus socket
  for every doc, and the project's blob route as its content store and
  import target. A hosted server builds its own from
  `connectProjectSession` (a `transport`, and `tokens` from
  `createProjectTokens` for servers that want one per doc),
  `hocuspocusTransport`, `projectBlobs` and a `closeReason` classifier.
  The provider module is always passed in, never imported, so
  `@hocuspocus/provider` stays an optional peer.
- **Styling** is a plain stylesheet, `@jams/engine/editor-ui/style.css`
  (`EDITOR_UI_STYLESHEET` names it, for a `<link>`). Its classes are
  `je-`-prefixed in `@layer jams-editor`, themed by custom properties on
  `.je-root` (`--je-bg`, `--je-panel`, `--je-primary`, `--je-font`, …):
  a host sets the variables, unlayered, after importing the sheet. It needs
  no Tailwind and no preflight, and ships no font files.
- **Density tokens** size everything the sheet draws, on the same
  `.je-root`: `--je-inset` and `--je-gap` (8 px, the frame's margins),
  `--je-pad` (6 px), `--je-row` (24 px rows), `--je-control` (26 px
  controls), `--je-tab` (28 px tab strips), `--je-text`, `--je-text-sm` and
  `--je-label` (12, 11 and 10 px), `--je-label-col` (the inspector's label
  column, 30% of the panel from 64 to 120 px), `--je-rail` (a collapsed
  column, 36 px) and `--je-handle` (the resize handles' hit width).
- **Layout.** Two columns down the sides, each one or two tab groups. A
  column is resized from its inner edge (drag, or the arrow keys on the
  focused handle; Home/End go to the minimum and maximum, Enter collapses
  it to its rail), and the split between its groups the same way. The
  viewer's layout is an `EditorLayout` kept under `jams-editor:layout:v1`
  and read back through `parseLayout`, which drops panels it doesn't know
  and returns `null` for a value it can't read, so `DEFAULT_LAYOUT` is
  used. `fitLayout(layout, viewport)` places it in a window without
  touching what's stored: windows too narrow for both columns draw one and
  a rail, phones a panel bar with a sheet, and a stored size comes back
  when the window grows.
- **Tabs.** Each panel (`PanelId`: outliner, project, inspector, problems,
  run, history) is a tab. The default puts the Outliner over the Project
  on the left and the Inspector over Problems · Run · History on the right.
  A tab's menu moves its panel to the other group of its column or resets
  the layout; Problems' tab shows the error and warning count; inactive
  panels stay mounted. `SceneEditorHandle.openPanel(id)` reveals a panel's
  tab wherever the viewer moved it.
- **Pending.** Everything the editor waits on (booting, a rebuild, opening
  a prefab, an import, a tree or licence write, the physical check) is a
  task in one `Pending` per editor, made with `createPending({ notify })`.
  A task shows busy on its scope's controls at once, a second run with the
  same id joins the first, progress only moves forward, and a failure is
  toasted once (`run` resolves `{ ok: false }` rather than rejecting). The
  status island's activity line names a task once it has run 300 ms, with
  "n of m" when it knows its progress, beside the save state (Saving… /
  Saved, Reconnecting…, Offline — changes will sync).

A game outside jams.team serves its project with `./vite` and opens the
editor on it:

```ts vite.config.ts
import * as hocuspocus from "@hocuspocus/server";
import { readFileProject, sceneCollabServer } from "@jams/engine/vite";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

import { coinGame } from "./coin-game";

export default defineConfig({
  plugins: [
    wasm(),
    sceneCollabServer({
      projects: [await readFileProject("src/game", { game: coinGame })],
      hocuspocus,
    }),
  ],
});
```

Then `editor.ts`, served by `vite` and opened at `/editor.html`:

```ts editor.ts
import "@jams/engine/editor-ui/style.css";
import * as hocuspocus from "@hocuspocus/provider";
import { devProjectHost, mountSceneEditor } from "@jams/engine/editor-ui";

import { coinGame } from "./coin-game";

mountSceneEditor(document.getElementById("editor")!, {
  host: devProjectHost({ hocuspocus }),
  game: coinGame,
  project: "coin-game",
  rapier: () => import("@dimforge/rapier2d"),
});
```

Give the server and the page the same game, so that the build stamps both
sides write agree. A project whose files name no game still needs one that
declares every data table and setting its files use. `devProjectHost({ origin })`
points the page at a dev server on another origin (`http(s)://` or
`ws(s)://`). The repo carries the same setup as `scripts/engine-editor/`
(`vp run engine:editor`). It edits a scratch copy of `src/engine/scenes`
(the engine project: kitchen sink and engine yard) unless `--in-place` is
passed, so the kitchen sink can be checked in the editor without the site.

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
| `v`         | `3`                                       | yes      | Scene format version. Files are migrated up on load and always saved at the current version.                                   |
| `name`      | string                                    | yes      | Scene name, same rules as an id; matches the file name without .json.                                                          |
| `bounds`    | [integer, integer, integer, integer] (px) | yes      | World rectangle [minX, minY, maxX, maxY] in px; y is down. Limits the camera; anything outside it is flagged.                  |
| `settings`  | object                                    |          | Scene-wide settings: the engine's, then the game's.                                                                            |
| `assets`    | string[]                                  |          | Asset ids only game code names, so they count as used: sorted, each once.                                                      |
| `groups`    | { id: [group](#groups-and-prefabs) }      |          | Groups by id. An entity or instance whose `group` names one stores its geometry relative to the group's `at`.                  |
| `instances` | [instance](#groups-and-prefabs)[]         |          | Prefab instances, each a copy of a prefab file placed at `at`.                                                                 |
| `solid`     | [shape](#shapes)[]                        |          | Static ground shapes, absolute px; `solid:<material>` for a material. Entries have no id; ops refer to them as ~solid:<index>. |
| `entities`  | [entity](#entity-types)[]                 |          | Entities with stable ids: anything that moves, has parameters, or is referenced.                                               |

### Fields every entity has

| Field   | Type                                                   | Required | Description                                                                                                                                                                                                                             |
| ------- | ------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`    | string                                                 | yes      | Stable id, unique in the scene: lowercase letters, digits and '-', 1-48 characters, starting with a letter or digit. Ops and other entities refer to the entity by it.                                                                  |
| `type`  | string                                                 | yes      | The entity's type: one of the types below.                                                                                                                                                                                              |
| `name`  | string                                                 |          | Display label for the editor's outliner. No runtime effect.                                                                                                                                                                             |
| `layer` | `"terrain"` \| `"decor"` \| `"gameplay"` \| `"editor"` |          | Scene layer, one of the game's layers; omitted means the type's default. The editor shows, hides and locks entities by layer, and the engine's own visuals draw on it; a type's shape visuals keep the draw layer their system chooses. |
| `group` | string                                                 |          | The declared group (top-level `groups`) this belongs to. Its geometry is stored relative to the group's `at`, and members select and move together.                                                                                     |
| `off`   | boolean                                                |          | When true the entity stays in the file but is not loaded, e.g. to A/B a change without deleting it.                                                                                                                                     |
| `z`     | integer                                                |          | Draw order within the layer, an integer in [-10000, 10000]; higher draws on top, ties keep spawn order (on a y-sorted layer, z first, then y). Omitted means 0.                                                                         |

### Entity types

#### `solid`

Static ground, walls and platforms: collides from every side, or from above only.

| Field       | Type                                                  | Required | Description                                                                                                                                                               |
| ----------- | ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape`     | [shape](#shapes)                                      | yes      | Collider shape. Absolute world px; y is down. Any tag, including chain for outlines.                                                                                      |
| `material`  | none registered                                       |          | Surface material.                                                                                                                                                         |
| `oneWay`    | `true` or `"up"` \| `"right"` \| `"down"` \| `"left"` |          | The one side actors collide with: they pass through from every other side and land on this one. `true` is "up": they pass up through it and land on top.                  |
| `attach`    | string                                                |          | A path follower's id: the collider rides that follower's body, keeping its offset from the follower's first path point.                                                   |
| `behaviors` | object                                                |          | Behavior blocks by name: each a typed set of fields this entity carries. `{}` carries a behavior with all its defaults; the type's required behaviors are always present. |

#### `sensor`

Trigger volume with no collision response; raises sensor:enter and sensor:exit when something overlaps it.

| Field       | Type             | Required | Description                                                                                                                                                               |
| ----------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape`     | [shape](#shapes) | yes      | Trigger shape. Absolute world px; y is down.                                                                                                                              |
| `tags`      | string[]         |          | Labels a game reads off the sensor's events.                                                                                                                              |
| `attach`    | string           |          | A path follower's id: the collider rides that follower's body, keeping its offset from the follower's first path point.                                                   |
| `behaviors` | object           |          | Behavior blocks by name: each a typed set of fields this entity carries. `{}` carries a behavior with all its defaults; the type's required behaviors are always present. |

#### `marker`

A named point with tags; what it means is up to the game.

| Field       | Type             | Required | Description                                                                                                                                                               |
| ----------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `at`        | [point](#points) | yes      | Marker position. Absolute world px; y is down.                                                                                                                            |
| `tags`      | string[]         |          | Labels a game reads, e.g. spawn or checkpoint.                                                                                                                            |
| `behaviors` | object           |          | Behavior blocks by name: each a typed set of fields this entity carries. `{}` carries a behavior with all its defaults; the type's required behaviors are always present. |

#### `prop`

Dynamic physics object that can be pushed and stood on.

| Field            | Type                  | Required | Description                                                                                                                                                               |
| ---------------- | --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape`          | [body shape](#shapes) | yes      | Starting collider shape. Absolute world px; y is down. Not chain.                                                                                                         |
| `density`        | number                | yes      | Density, mass per px²; heavier props are harder to push.                                                                                                                  |
| `restitution`    | number                | yes      | Bounciness: 0 doesn't bounce, 1 keeps all its speed.                                                                                                                      |
| `friction`       | number                |          | Surface friction; omitted uses the material's, else the physics default.                                                                                                  |
| `material`       | none registered       |          | Surface material.                                                                                                                                                         |
| `gravityScale`   | number                |          | Multiplies the world's gravity on this body: 0 floats, -1 falls up; default 1.                                                                                            |
| `linearDamping`  | number                |          | Slows the body's motion over time; default 0.                                                                                                                             |
| `angularDamping` | number                |          | Slows the body's spin over time; default 0.                                                                                                                               |
| `fixedRotation`  | boolean               |          | When true, the body never turns.                                                                                                                                          |
| `ccd`            | boolean               |          | Continuous collision detection: when true, a fast body can't pass through thin colliders between steps.                                                                   |
| `behaviors`      | object                |          | Behavior blocks by name: each a typed set of fields this entity carries. `{}` carries a behavior with all its defaults; the type's required behaviors are always present. |

#### `follower`

Kinematic body that follows a waypoint path.

| Field       | Type                  | Required | Description                                                                                                                                                               |
| ----------- | --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape`     | [body shape](#shapes) | yes      | Collider shape LOCAL to the current path point, usually centred on 0, 0 (e.g. ["box", 0, 0, 40, 6]). Not chain.                                                           |
| `path`      | [path](#paths)        | yes      |                                                                                                                                                                           |
| `material`  | none registered       |          | Surface material.                                                                                                                                                         |
| `behaviors` | object                |          | Behavior blocks by name: each a typed set of fields this entity carries. `{}` carries a behavior with all its defaults; the type's required behaviors are always present. |

#### `decor`

A picture with no body: drawn by its sprite, never collides.

| Field       | Type             | Required | Description                                                                                                                                                               |
| ----------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `at`        | [point](#points) | yes      | Where the sprite's pose is. Absolute world px; y is down.                                                                                                                 |
| `behaviors` | object           |          | Behavior blocks by name: each a typed set of fields this entity carries. `{}` carries a behavior with all its defaults; the type's required behaviors are always present. |

#### `nav`

A walkable area, or a hole in one, for navigation without physics or a grid.

| Field       | Type                  | Required | Description                                                                                                                                                               |
| ----------- | --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape`     | [polygon](#shapes)    | yes      | A simple polygon, concave allowed. Absolute world px; y is down.                                                                                                          |
| `mode`      | `"walk"` \| `"block"` |          | walk (default) or a hole cut out of the walk area it lies in.                                                                                                             |
| `tags`      | string[]              |          | Labels a game reads, e.g. a room name.                                                                                                                                    |
| `behaviors` | object                |          | Behavior blocks by name: each a typed set of fields this entity carries. `{}` carries a behavior with all its defaults; the type's required behaviors are always present. |

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
