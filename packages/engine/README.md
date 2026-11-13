# @jams/engine

A game-agnostic 2D engine for the web: [Pixi](https://pixijs.com) v8 draws,
[Rapier](https://rapier.rs) 2D simulates, and levels are plain JSON scene
files that people, agents and the disk can edit together. A game registers
its entity types, actions and hooks; the engine loads its scenes, steps them
in a browser or headless, validates them with machine-readable issue codes,
and edits them through a small command language (`SceneOp`) that also runs on
a shared [Yjs](https://yjs.dev) document.

This is 0.x. `./editor`, `./game` and `./headless` are `@experimental`: they
may change in any 0.x minor. The scene format (`v: 4`, in metres), the issue codes, the
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
| `pixi.js`                   | `^8.23.0`        | the browser shell and `./debug`; the host owns the canvas                |
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
| `@jams/engine`           | `createGame`, the browser shell: renderer, camera, input, the tool router and the store selectors; the UI seam (`mountUi`, `bindText`, `bindToWorld`)      | pixi.js, @tanstack/store          |
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
`data-table`, `input-map`, `project-snapshot`, `scene-list`, `save`), all under
`@jams/engine/schemas/`.

## Your first game

From a checkout of this repository (after `vp install`), a game goes from
nothing to a zip for itch.io in seven steps, the commands all the scene
CLI's (`vp run scene`; see `scripts/scene/README.md`). Every `sh` block below
except the two that need a browser runs in CI in a temporary project
(`scripts/engine-readme/__tests__/tutorial.test.ts`), so the steps stay
true.

**1. Scaffold it.** `game new` writes a project under `src/games/orbs/`:
the project file, the game and UI modules, a `main` scene with its checks
and a winning input script, the game settings, an input map, the scene
list and a test. The `top-down` preset is physics-free with a fixed step;
`grid` and `turns` are the other two (see [A second game](#a-second-game)
for a turn game built out in full).

```sh
vp run scene game new orbs --preset top-down
```

**2. Open it in the editor.** With the dev server running, open
`/game/dev?game=orbs&edit=1`: the package's editor (`./editor-ui`) over the
project's files. An edit there is written back to `src/games/orbs/`, and an
edit on disk shows up in the open editor.

```sh browser
vp dev
```

**3. Add an entity.** Any change an editor can make is an op batch the CLI
can apply. This one adds a marker the game can read by its tag:

```sh
vp run scene apply main --project orbs --ops - <<'EOF'
{ "ops": [{ "op": "add", "entity": { "id": "orb", "type": "marker", "at": [2.5, 4.5], "tags": ["orb"] } }] }
EOF
```

**4. Playtest it headless.** The scaffolded script walks the hero to the
goal; the run prints its outcome, its steps and its events, and exits 1
when it's blocked:

```sh
vp run scene playtest main --project orbs --script src/games/orbs/scenes/main.script.json
```

**5. Build it.** `game build` writes a static site to
`dist/games/orbs/web`: the listed scenes and their assets, the code,
`release.json`, `credits.html` and the PWA files, with the bytes measured
against the size budgets. A physics-free game ships no Rapier.

```sh
vp run scene game build orbs
```

**6. Play the build.** Serve the directory with any static server (a
build doesn't run from `file://`) and open it:

```sh browser
vp dlx serve dist/games/orbs/web
```

**7. Export it for itch.io.** `game export --zip` builds the itch.io
target and zips it with fixed times, so two exports of one build are
equal; it checks itch.io's HTML5 layout and uploads nothing. Upload
`dist/games/orbs-itch.zip` to an itch.io page as an HTML game yourself.

```sh
vp run scene game export orbs --zip
```

From here, give the game its own entity types and rules in `index.ts` and
`runtime.ts`, its art through `vp run scene assets import`, and an
`export` block in `jams.project.json` (icons, colours, budgets).

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

## Units

The simulation runs in metres: every length a scene, prefab, op, check,
input script, material, setting or table holds is metres, every speed m/s
and gravity m/s², and so is everything game code reads or writes through
`ctx` (poses, velocities, casts and space queries, motion, grids, nav,
spawn positions, contact points), recordings and saves. y is down. Each
game says how many pixels a metre is drawn at, `GameDefinition.world.lengthUnit`
(`DEFAULT_LENGTH_UNIT`, 100): it maps world metres to the resolution's
virtual px for the camera and the drawing side, and reaches nothing else,
so how a game draws never changes a run or a digest. `createRegistry`
throws on one that isn't a positive finite number. Rapier keeps its own
default length unit of one metre, which fits a metre world.

Pixels stay where things are drawn or pointed at: texture and frame px,
nine-slice insets, stroke widths, font sizes and line heights,
`ResolutionPolicy.virtual`, screen px (snap distances, hit slop, handle
sizes) and the pointer's client position before `clientToWorld`. Angles
(degrees), times (ms and ticks) and unitless values (scales, restitution,
friction) never changed. `density` keeps its number and now means kg/m²,
so a body's mass is (px per metre)² smaller than it was in px: velocities,
gravity and contacts behave the same, and game code that applies forces or
impulses rather than velocities rescales them.

One rounding rule writes a length: `roundLength` (micrometres, never `-0`).
`snapToPixel(m, ppm)` lands on the nearest whole world px, which is what
the editor's free drags and nudges do, so pixel art lines up at any px per
metre; `lengthDecimals(ppm)` is how many decimals show one px (2 at 100, 5
at 32), and `isWholePixel` is the check a grid's cell, origin and hex side
must pass (`grid-invalid` otherwise). A game's own length fields declare
`meta.unit` (`"m"`, `"m/s"` or `"m/s²"`), which the engine's field helpers
already do; `scaleLengths` walks a value through its schema and scales only
those:

```ts metric-units.ts
import { createRegistry, defineGame, pxPerMetreOf, scaleLengths } from "@jams/engine/game";
import { isWholePixel, lengthDecimals, pxToMetres, snapToPixel } from "@jams/engine/scene";
import { z } from "zod";

/** Pixel art drawn at 32 px per metre: a 32 px tile is one metre of world. */
export const tinyGame = defineGame({
  id: "tiny",
  types: [],
  actions: [],
  world: { physics: "none", lengthUnit: 32, grid: { kind: "square", cell: [1, 1] } },
  createRuntime: () => ({ snapshot: () => null }),
});

/** A game's own length field declares its unit, so a migration knows to scale it. */
const launch = z
  .strictObject({
    speed: z.number().describe("Launch speed, m/s.").meta({ unit: "m/s" }),
    count: z.number().int().describe("How many."),
  })
  .describe("A launcher's tuning.");

export function units() {
  const ppm = pxPerMetreOf(createRegistry(tinyGame));
  return {
    ppm,
    // A free drag lands on whole world px: 0.5 m is 16 px, and 0.51 m (16.32 px) snaps back to it.
    snapped: [snapToPixel(0.5, ppm), snapToPixel(0.51, ppm)],
    // What a v3 file's 48 px means here, written the one way.
    fromPx: pxToMetres(48, ppm),
    whole: [isWholePixel(1.5, ppm), isWholePixel(1.51, ppm)],
    decimals: [lengthDecimals(100), lengthDecimals(32)],
    // Only the field that declares a length unit is scaled: 320 px/s is 10 m/s, `count` keeps 3.
    scaled: scaleLengths({ speed: 320, count: 3 }, launch, ppm),
  };
}
```

Scene format v4 is v3 with every length in metres. The v3 → v4 step
divides each length by the game's px per metre, through those field units,
and scales an instance's `overrides` and `params` through the prefab it
names; `parseScene`, `parsePrefab` and `parseFragment` take a `prefab`
lookup for that, and project kinds pass one. Without the game's registry
or a prefab it needs, the step refuses with `migration-unresolved` and the
file stays v3. The hosted sync service holds no game code, so it keeps a
stored v3 doc at v3 and serves it read-only with that issue; a hosted
project is migrated by tooling that has the game (the scene CLI's
`project pull`, `fmt`, and a fresh seed) or reset. The `checks`,
`material`, `game-settings` and `data-table` kinds moved to metres the same
way, each one version up.

## Registering entity types

A scene's entities are typed by the registry: eight primitives the engine
always has (`solid`, `sensor`, `marker`, `prop`, `follower`, `decor`,
`nav`, `note`) plus the game's own types. A game type either names a primitive as
its `base`, so the primitive's system spawns it, or brings its own `system`
(`createDataSystem` for a type whose entities are data the game reads).
`decor` is a picture with no body: `{ id, type: "decor", at, behaviors: {
sprite } }`, its `sprite` block required. It loads (headless too), so it
has a pose and is queryable, but nothing enters the physics world for it.
A game's `spawnOrder` lists its own types; a primitive it leaves out spawns
before every listed group, in primitive order, except `decor` and `nav`,
which then spawn last. A game
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
    {
      action: "left",
      bindings: [
        { device: "key", code: "KeyA" },
        { device: "key", code: "ArrowLeft" },
      ],
      description: "Walk left.",
    },
    {
      action: "right",
      bindings: [
        { device: "key", code: "KeyD" },
        { device: "key", code: "ArrowRight" },
      ],
      description: "Walk right.",
    },
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
game's spawn or, with `at`, settled along the game's spawn cast (gravity
by default; not at all under zero gravity or `cast: "none"`, see
[World models](#world-models)); `game.stop()` throws the play world away and rebuilds the edit world with
the editor's camera. `pause`, `resume`, `step` and `setTimeScale` drive the
loop, and `./editor`'s `createKeymap` resolves the editor's keys per scope.

`game.extractPixels(world)` reads back what the canvas shows: the RGBA bytes
under each world point through the camera, from the stage at resolution 1
over the game's background colour, null for a point off the canvas, and
`renderer`, the renderer that drew them (`webgl` or `webgpu`). Smoke tests
and agents use it to check a frame without screenshots; an editor host
reaches the editor's running game through its handle's `game()` (see
[Editor UI](#editor-ui)).

A game of several scenes passes `flow` (its scene list and scenes) and
calls `game.flow.restart()` instead of `loadScene`; see
[Scene flow](#scene-flow). `game.saves` saves and loads it; see
[Saves](#saves).

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

To see where the ticks' time goes, hand a run a collector on your clock:
`timing: createRunTiming(() => performance.now())` on `runProbe`,
`runPlaytest` or `createHeadlessRuntime`. The runtime then times each
step's parts (the Rapier world step, each type system's `beforeStep` and
`afterStep`, each behavior, the game's hooks, contacts, timers, events and
lifecycle) and `stats().timing` reports them as a `TimingReport`: per part
its calls, total and worst tick, beside the ticks' own total and what no
part covers. Without a collector a step reads no clock, and timing is
never part of a recording, a save or a hash; it is the one field of a
report that two runs don't share. `createGame`'s `timing: true` does the
same in the browser and adds the shell's tick, the frame and Pixi's draw
call. The scene CLI prints it with `step --timing`.

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
    v: 2,
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
  the engine's `event`, `tick`, `exists` (`"boss#1"` exists and is
  enabled; `{ id, enabled: false }` exists at all) and `count` (a selector
  plus `min`, `max` or `eq`: `{ "type": "enemy", "max": 0 }`), or a
  predicate the game declares in `play.predicates`. A script's `seed`
  seeds `ctx.random`. Scripts are `v: 2`: per-seat `tracks`, analog
  `set`, `pointer`, `join` and `leave` steps (see
  [Local multiplayer](#local-multiplayer)); a v1 script migrates on read.
  A pointer step's buttons raise the actions bound to them, as a live
  click does, and a track that ends early holds its last step until the
  script ends.
  `compileInputScript` checks a script and turns it into each slot's
  `TickInput`; `inputScriptJsonSchema(registry)` describes a game's scripts.
- The outcome comes from the game's `play.outcome`; otherwise a run ends as
  `timeout`, `script-end`, or `stuck` (under 0.04 m of movement over 120 ticks
  while one of the game's `play.movementActions` is held). An
  `EngineError` thrown out of a step (a bad spawn id, a prefab it can't
  place) ends the run `blocked` at stage `"run"`, its code on the issue.
- Reports carry every step event, the lifecycle and contact ones included;
  `fuzz` counts only scene entities as `touched`, never a runtime `#` id.
- The same seed gives the same fuzz report, apart from `timing`.

### Recordings v2

Every playtest's report carries a `recording`, and every Play in the
browser makes one (`GameInstance.recording()`, the `play:recorded` event).
A recording (`RECORDING_VERSION` 2) is how the world started and every
seat's input, enough to replay the run tick for tick:

- **The stream.** `inputs` holds one stream per seat and `system` one for
  the run, indexing the `actions` and `commands` name tables. A seat's
  events are `[t, "b", action, 0|1]` (a button), `[t, "a", action, v]` (an
  axis), `[t, "v", action, x, y]` (a vector; values × 1000 as ints),
  `[t, "p", x, y, buttons, over]` (the pointer, world metres × 10,000,
  written only when it changes) and `[t, "c", command, args?]` (a command
  the seat sent); the system's are `[t, "w", ms]` (`@elapsed`) and
  `[t, "j"|"l", seat, device]` (joins and leaves). A tick merges the system
  stream first, then the seats in order. `t` carries a sub-tick fraction in
  thousandths (`120.375`) when the game sets `input.subTick`.
  `decodeStreams(recording)` gives back one `TickInput` per tick, the one
  decoder the recorder, replays, headless runs and the shell share.
- **`runHash`** hashes what the run ran: the expanded scene, the resolved
  clock and the project's settings, engine block, tables, prefab library
  and input map. A doc's `$schema` isn't covered, so moving a schema file
  stales nothing. A replay is `stale` when it differs; `sceneHash` is kept
  and shown.
- **Platforms.** `platform` names the `arch`, the `runtime` and the
  Rapier `flavour` (`rapier2d`, `rapier2d-compat`,
  `rapier2d-deterministic-compat`, or null when the host didn't say).
  When `REPLAY_ACROSS_PLATFORMS` is false, replaying a Rapier recording
  whose known `arch` differs from here adds `recording-other-platform` to
  the report's `issues`; the cross-platform determinism check held on
  `x86_64`, so it is true.
- **The v1 migration.** `parseRecording(input, registry?)` reads v1 and v2
  files and returns `{ ok, recording, migratedFrom?: 1 }`. A v1 file
  migrates losslessly: its key edges and commands become seat 0's stream,
  a leading `@elapsed` the system stream, its `tickRate` a `time` with the
  registry's time kind. With no `runHash`, its replay judges staleness on
  `sceneHash`. A v1 recording of a Rapier run made before 0.11.0 replays
  as a mismatch: the simulation moved to metres and Rapier's own length
  unit, which changed every Rapier run's numbers once.

`replayRecording({ rapier, game, scene, recording })` steps the same tick
inputs on the same ticks and reports whether the run `matches` (same
result, ticks and end digest) or how it diverged, with `migratedFrom` for a
v1 file; a stale run, other tuning, engine version or physics build is a
warning, not a block. `GameInstance.replay(doc, recording)` plays one in
the browser in place of the devices, the pointer and every command
included, and pauses on its last tick.

Replays are exact on the same build: the determinism probe
(`packages/engine/__tests__/probes/`) gets bit-identical results from
`rapier2d`, `rapier2d-compat` and `rapier2d-deterministic-compat` on macOS
and Linux, under Node and Bun. Bindings never reach a recording (it holds
actions), so a remap can't change a replay.

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
`reaches` (an input script ends in a given result, and its `expect`, an
`until` clause such as `{ "count": { "type": "drop", "eq": 0 } }`, holds on
the last tick), `touches` (fuzz
reaches an entity in at least N rollouts) and `connected` (cells or
entities reach each other on the grid; see
[Grids at runtime](#grids-at-runtime)); a game adds `<id>/<kind>` kinds
in `checks`.

## Input

A game declares its actions; each is a `button` (the default), an `axis`
(−1…1) or a `vector` (a point in the unit disc, y down), and its
`bindings` say what drives it. The runtime turns each tick's input into
`ctx.input` before any system's `beforeStep`, so game code reads
`held`, `pressed`, `released`, `value`, `vector`, `pointer` and `players`
the same live, headless and in a replay; `beforeStep` still gets the
tick's action edges and commands.

- **Codes.** Keys bind by `KeyboardEvent.code` (`KeyA`, `Digit1`,
  `Space`, `ShiftLeft`, `ArrowUp`, `Numpad0`; the list is `KEY_CODES`),
  so a key sits where the QWERTY key sits on any layout. The editor's own
  shortcuts keep following the printed letter. A 0.x `keys` list still
  works, deprecated: each key binds every code `KEY_TO_CODE` gives it
  (`"Shift"` is both Shifts, `"1"` the digit row and the numpad). A key the
  table doesn't know (`"space"`; Space is `" "`) is refused when the game
  registers, with a did-you-mean.
- **Analog.** A key or pad button on an axis or vector contributes its
  `value` (default 1) on its `axis` (`"x"` or `"y"`). Bindings on a button
  combine by OR; on an axis the reading furthest from zero wins; a vector
  sums its keys, adds the stick furthest from the centre and clamps to the
  disc. Values are quantised to thousandths after a radial deadzone
  (`GameDefinition.input.deadzone`, default 0.15; the input map's wins),
  and an axis or vector raises an action whenever its quantised value
  changes.
- **Pads.** `{ device: "pad", button }` by the W3C standard mapping's names
  (`PAD_BUTTONS`: `south`, `east`, `west`, `north`, `lb`, `rb`, `lt`, `rt`,
  `select`, `start`, `ls`, `rs`, the d-pad, `home`) or a raw index for a
  non-standard pad; `{ stick: "left" | "right" }` for a vector;
  `{ axis, scale? }` (`PAD_AXES` or a trigger, `lt`/`rt`) for an axis. The
  shell polls `navigator.getGamepads()` once per tick, and also every
  animation frame while an `input.onAction` listener exists (see
  [UI-only actions](#ui-only-actions)); the two polls keep their own
  previous state, so neither eats the other's edges.
- **Pointer.** `{ device: "pointer", button }` binds `primary`,
  `secondary` or `middle`; `ctx.input.pointer(seat)` is the pointer in
  world metres (quantised to 1/10,000 m), its `buttons` bits and whether
  it is `over` the canvas. A sample is recorded whenever one of those
  changes, and `GameAttachment.onTick` gets the same position, the
  recorded one in a replay.
- **Touch.** A touch that starts on an on-screen control drives it; any
  other first touch is the pointer's primary button. The controls are the
  input map's `touch` list (below), bound with
  `{ device: "touch", control }`; `GameConfig.input.touch` shows them
  `"auto"` (on a coarse pointer, the default), `"always"` or `"never"`.

The duel game binds two seats on one keyboard and a pad's stick:

```ts duel-game.ts
import { defineGame, type Binding, type EngineContext } from "@jams/engine/game";
import type { Pt, SceneDefinition } from "@jams/engine/scene";

export type Runner = { x: number; y: number; joined: boolean };
export type DuelSnapshot = { runners: Runner[]; winner: number | null };

/** m/s at full stick. */
const SPEED = 4;
/** How close to the flag a runner must get, m. */
const REACH = 0.25;

const key = (code: string, axis: "x" | "y", value: number, player: number): Binding => ({
  device: "key",
  code,
  axis,
  value,
  player,
});

/** Two seats race to the flag: seat 0 on WASD, seat 1 on the arrows, either on a pad's left stick. */
export const duelGame = defineGame<DuelSnapshot>({
  id: "duel",
  types: [],
  actions: [
    {
      action: "move",
      kind: "vector",
      bindings: [
        key("KeyA", "x", -1, 0),
        key("KeyD", "x", 1, 0),
        key("KeyW", "y", -1, 0),
        key("KeyS", "y", 1, 0),
        key("ArrowLeft", "x", -1, 1),
        key("ArrowRight", "x", 1, 1),
        key("ArrowUp", "y", -1, 1),
        key("ArrowDown", "y", 1, 1),
        { device: "pad", stick: "left" },
      ],
      description: "Run.",
    },
    {
      action: "taunt",
      bindings: [
        { device: "key", code: "Space", player: 0 },
        { device: "key", code: "Enter", player: 1 },
        { device: "pad", button: "south" },
      ],
      description: "Wave at the other runner.",
    },
  ],
  // A device's first press takes the lowest free seat.
  input: { players: { max: 2, join: "press" }, deadzone: 0.2 },
  world: { physics: "none" },
  play: {
    results: ["seat-0-wins", "seat-1-wins"],
    outcome: ({ snapshot }) =>
      snapshot.winner === null ? null : { result: `seat-${snapshot.winner}-wins` },
  },
  createRuntime(ctx: EngineContext) {
    let runners: Runner[] = [];
    let flag: Pt = [0, 0];
    let winner: number | null = null;

    return {
      onLoad(scene) {
        const marker = (tag: string) =>
          scene.entities.filter(
            (e) => e.type === "marker" && (e.tags as string[] | undefined)?.includes(tag),
          );
        runners = marker("runner").map((e) => {
          const [x, y] = e.at as Pt;
          return { x, y, joined: false };
        });
        flag = (marker("flag")[0]?.at as Pt | undefined) ?? [0, 0];
        winner = null;
      },
      beforeStep(dtMs) {
        if (winner !== null) return;
        runners.forEach((r, seat) => {
          r.joined = ctx.input.players()[seat]?.joined ?? false;
          const v = ctx.input.vector("move", seat);
          r.x += v.x * SPEED * (dtMs / 1000);
          r.y += v.y * SPEED * (dtMs / 1000);
          const dx = flag[0] - r.x;
          const dy = flag[1] - r.y;
          if (winner === null && Math.sqrt(dx * dx + dy * dy) <= REACH) winner = seat;
        });
      },
      snapshot: () => ({ runners: runners.map((r) => ({ ...r })), winner }),
    };
  },
});

/** A 10 × 4 m field: two lanes, one flag at the far end of the top lane. */
export const field: SceneDefinition = {
  v: 4,
  game: "duel",
  name: "field",
  bounds: [0, 0, 10, 4],
  settings: { physics: "none" },
  entities: [
    { id: "lane-0", type: "marker", at: [1, 1], tags: ["runner"] },
    { id: "lane-1", type: "marker", at: [1, 3], tags: ["runner"] },
    { id: "flag", type: "marker", at: [9, 1], tags: ["flag"] },
  ],
};
```

An unknown code, button, axis or control, or a binding whose shape doesn't
fit its action's kind, is `binding-unknown` with a did-you-mean over the
code tables, and a seat past `players.max` is `player-unknown`.
`bindingProblems` is that one check: `createRegistry` throws on it, the
input map's kind reports it, `GameInstance.input.rebind` returns it, the
host's `GameConfig.bindings` warn with it in dev, and the scene CLI's
`input` prints it.

**Play-mode tools change the simulation only through commands; draw
previews freely.** Anything that reaches the world from outside the
devices (a tool, a host button, a DOM drop) is a command (`send`), recorded
on the sending seat's stream, so it replays; an attachment's preview is
drawing only. The tabletop game takes cards as `play-card` commands and
reads the pointer for a click:

```ts tabletop-game.ts
import { defineGame, type EngineContext } from "@jams/engine/game";
import { runPlaytest } from "@jams/engine/headless";
import type { SceneDefinition } from "@jams/engine/scene";
import { z } from "zod";

export type Card = { card: string; at: [x: number, y: number] };
export type TabletopSnapshot = { table: Card[]; hover: [x: number, y: number] | null };

/** How close to a card a click must land to pick it up, m. */
const PICK = 0.3;

/** Cards arrive from the host's DOM hand as `play-card` commands; a click on one takes it back. */
export const tabletopGame = defineGame<TabletopSnapshot>({
  id: "tabletop",
  types: [],
  actions: [
    {
      action: "take",
      bindings: [{ device: "pointer", button: "primary" }],
      description: "Take back the card under the pointer.",
    },
  ],
  commands: {
    "play-card": {
      description: "Put a card from the hand on the table.",
      args: z.strictObject({ card: z.string(), at: z.tuple([z.number(), z.number()]) }),
    },
  },
  world: { physics: "none" },
  createRuntime(ctx: EngineContext) {
    let table: Card[] = [];
    return {
      onLoad() {
        table = [];
      },
      beforeStep(_dtMs, _actions, commands) {
        for (const c of commands) if (c.name === "play-card") table.push(c.args as Card);
        const p = ctx.input.pointer();
        if (!p || !ctx.input.pressed("take")) return;
        const i = table.findIndex(({ at }) => Math.abs(at[0] - p.x) + Math.abs(at[1] - p.y) < PICK);
        if (i >= 0) table.splice(i, 1);
      },
      snapshot() {
        const p = ctx.input.pointer();
        return { table: table.map((c) => ({ ...c })), hover: p?.over ? [p.x, p.y] : null };
      },
    };
  },
});

export const felt: SceneDefinition = {
  v: 4,
  game: "tabletop",
  name: "felt",
  bounds: [0, 0, 6, 3],
  settings: { physics: "none" },
  entities: [{ id: "deck", type: "marker", at: [0.5, 0.5] }],
};

/** Two cards dropped from the hand, then a click on the first takes it back. */
export function dealAndTake() {
  const run = runPlaytest({
    game: tabletopGame,
    scene: felt,
    script: {
      v: 2,
      steps: [
        { command: "play-card", args: { card: "ace", at: [2, 1.5] } },
        { command: "play-card", args: { card: "king", at: [4, 1.5] } },
        { pointer: { at: [2.05, 1.5] } },
        // A `pointer` step with `press: "primary"` would raise `take` too, as a live click does.
        { press: "take" },
        { pointer: { at: [2.05, 1.5], drag: [3, 1] }, for: 10 },
      ],
    },
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.scriptIssues)}`);
  // Pointer samples are stored as world metres × 10,000.
  const samples = run.recording.inputs[0]?.filter((e) => e[1] === "p") ?? [];
  return { final: run.final, samples: samples.length, firstSample: samples[0] };
}
```

A host turns a DOM drag into that command: `GameInstance.clientToWorld`
maps page coordinates through the canvas's rect and the camera to world
metres, and `input.trackPointer(true)` lets pointer moves anywhere in the
document drive the pointer sample, so the world sees the drag:

```ts hand-drop.ts
import type { GameInstance } from "@jams/engine";
import { roundLength } from "@jams/engine/scene";

/**
 * A DOM hand beside the canvas: while a card is dragged the world's pointer
 * follows it, and the drop is a `play-card` command, so it is recorded and
 * replays. The host never edits the world itself.
 */
export function dealFromHand(
  game: Pick<GameInstance, "clientToWorld" | "input" | "send">,
  hand: HTMLElement,
): () => void {
  let card: string | null = null;
  const down = (e: PointerEvent) => {
    card = (e.target as HTMLElement).closest<HTMLElement>("[data-card]")?.dataset.card ?? null;
    if (card) game.input.trackPointer(true);
  };
  const up = (e: PointerEvent) => {
    if (!card) return;
    game.input.trackPointer(false);
    const at = game.clientToWorld(e.clientX, e.clientY);
    // Rounded the way a file writes metres, so the recorded args stay short.
    game.send({ name: "play-card", args: { card, at: [roundLength(at.x), roundLength(at.y)] } });
    card = null;
  };
  hand.addEventListener("pointerdown", down);
  hand.ownerDocument.addEventListener("pointerup", up);
  return () => {
    hand.removeEventListener("pointerdown", down);
    hand.ownerDocument.removeEventListener("pointerup", up);
  };
}
```

`createTouchControls(host, controls, sink)` is the overlay the shell
draws over its canvas, framework-free DOM, for a host that wants its own
pad (a menu, a custom shell). Sticks and d-pads report quantised unit-disc
values, buttons `{ down }`; `hitTest` names the control under a point:

```ts touch-pad.ts
import { createTouchControls, type TouchControlDef, type TouchControlValue } from "@jams/engine";

/** The duel's controls: `at` and `radius` are fractions of the frame's shorter side, from its top-left. */
export const DUEL_TOUCH: TouchControlDef[] = [
  { id: "stick", kind: "stick", action: "move", at: [0.2, 0.8], radius: 0.15 },
  { id: "taunt", kind: "button", action: "taunt", at: [1.55, 0.8], radius: 0.1, label: "Hi" },
];

/**
 * An overlay over `frame` outside `createGame`, e.g. a menu's own pad: each
 * control reports its value whenever it changes, a stick in the unit disc
 * (y down, quantised), a button as `{ down }`.
 */
export function mountPad(frame: HTMLElement) {
  const seen: [control: string, value: TouchControlValue][] = [];
  const pad = createTouchControls(frame, DUEL_TOUCH, (control, value) =>
    seen.push([control, value]),
  );
  return { pad, seen };
}
```

### The input map

A project may hold one `input-map` doc (`INPUT_MAP_KIND`, schema
`input-map.schema.json`). It sets `players`, `deadzone`, any action's
`bindings` (each replaces the game's for that action whole; actions it
omits keep the game's) and `touch`, the on-screen controls: `button`,
`stick` or `dpad`, with `at` and `radius` as fractions of the canvas's
shorter side from its top-left corner. `ProjectRuntimeView.inputMap` is
the project's, or null. It co-edits like every doc, and the scene CLI's
`input` prints what it resolves to.

### Remapping

Remaps live in the player's browser; input maps are project docs. A seat's
bindings for an action come from the first of four layers that names it,
replacing the rest whole: the player's remap, the host's
`GameConfig.bindings`, the project's input map, the game's `actions`.
`resolveBindings` is the one place they combine. `GameInstance.input`
reads and changes them: `bindings(seat)`, `rebind(action, bindings, {
player })` (checked, saved through the `RemapStore` at once and applied
from the next tick), `reset`, and `capture` for a "press a key" prompt.
`browserRemapStore()` keeps remaps in `localStorage` (every access in
try/catch, empty when storage is unavailable) and is what the site passes;
`memoryRemapStore()` keeps them for the page's life. They are never sent
anywhere, and a recording holds actions, not bindings.

```ts remapping.ts
import {
  browserRemapStore,
  createGame,
  memoryRemapStore,
  resolveBindings,
  type GameInstance,
  type RemapState,
} from "@jams/engine";
import { bindingProblems, KEY_TO_CODE, type Binding } from "@jams/engine/game";

import { duelGame } from "./duel-game";

/** The duel in a page: remaps persist in this browser, and its touch controls show on a coarse pointer. */
export function startDuel(canvas: HTMLCanvasElement): Promise<GameInstance> {
  return createGame(canvas, {
    game: duelGame,
    displayWidth: canvas.clientWidth,
    displayHeight: canvas.clientHeight,
    dev: false,
    input: { touch: "auto", remaps: browserRemapStore() },
  });
}

/**
 * A "press a key" prompt: the next key or pad button becomes the seat's
 * binding for `action`. The rebind is checked, saved through the game's
 * remap store and applies from the next tick.
 */
export async function remapPrompt(
  game: Pick<GameInstance, "input">,
  action: string,
  player = 0,
): Promise<string> {
  const binding = await game.input.capture({ devices: ["key", "pad"], timeoutMs: 5000 });
  if (!binding) return "cancelled";
  const done = game.input.rebind(action, [binding], { player });
  return done.ok ? "bound" : done.issue.code;
}

/**
 * The four layers, first to last: the player's remap, the host's bindings,
 * the project's input map and the game's actions. The first that names an
 * action replaces its bindings whole, per seat.
 */
export function layers() {
  const store = memoryRemapStore();
  const remap: RemapState = {
    v: 1,
    players: { 1: { taunt: [{ device: "key", code: "Backslash", player: 1 }] } },
  };
  store.save("duel", remap);
  const resolved = resolveBindings({
    remap: store.load("duel"),
    host: [{ action: "move", bindings: [{ device: "pad", stick: "right" }] }],
    map: { actions: [{ action: "taunt", bindings: [{ device: "key", code: "KeyQ" }] }] },
    game: duelGame.actions,
    players: 2,
  });
  const typo: Binding = { device: "key", code: "space" };
  return {
    move: resolved.source("move", 0),
    taunt0: [resolved.source("taunt", 0), resolved.bindings(0).taunt],
    taunt1: [resolved.source("taunt", 1), resolved.bindings(1).taunt],
    typo: bindingProblems(typo, { kind: "button", max: 2 }).map((p) => p.message),
    // A 0.x `keys` entry still binds: "Shift" was either Shift key.
    shift: KEY_TO_CODE.Shift,
  };
}
```

## Local multiplayer

A game has seats: `GameDefinition.input.players` (`PlayersDef`, `{ max:
1–8, join }`), overridden by the input map's `players`, default one seat.
The join policy says how devices (`DeviceId`: `keyboard`, `pointer`,
`touch`, `pad:<n>`) take them:

- `auto`: seat 0 owns the keyboard, pointer and touch; pads take free seats
  in connection order.
- `press`: a device's first press takes the lowest free seat.
- `host`: the host assigns them, `GameInstance.input.assign(device, seat |
null)`.

With one seat every device drives seat 0, which is 0.x's behaviour. A key
binding with `player: n` drives seat `n` whoever owns the keyboard, so two
players can share one. A pad that disconnects frees its seat. Joins and
leaves raise `PLAYER_JOINED` and `PLAYER_LEFT` with the seat as `player`,
and they are input, on the system stream, so a replay has the same seats
on the same ticks. `ctx.input.players()` and `GameInstance.input.players()`
list each seat's devices; `send` takes the sending seat as
`GameCommand.player`. A script gives each seat a track:

```ts duel-seats.ts
import { createRegistry, PLAYER_JOINED } from "@jams/engine/game";
import {
  decodeStreams,
  parseRecording,
  replayRecording,
  runPlaytest,
  type InputScriptV2,
} from "@jams/engine/headless";

import { duelGame, field } from "./duel-game";

const registry = createRegistry(duelGame);

/** Seat 0 joins on the keyboard and runs straight; seat 1 joins on a pad later and cuts across. */
export const race: InputScriptV2 = {
  v: 2,
  scene: "field",
  players: 2,
  maxTicks: 600,
  tracks: [
    {
      player: 0,
      steps: [{ join: "keyboard" }, { set: { move: [1, 0] }, for: 150 }],
    },
    {
      player: 1,
      steps: [
        { wait: 10 },
        { join: "pad:0" },
        { set: { move: [0.8, -0.6] }, for: 60 },
        { set: { move: [1, 0] }, for: 120 },
      ],
    },
  ],
};

/** Plays the race, then replays its recording from JSON and reads its streams back. */
export function runRace() {
  const run = runPlaytest({ game: duelGame, registry, scene: field, script: race });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.scriptIssues)}`);
  const text = JSON.stringify(run.recording);
  const parsed = parseRecording(text, registry);
  const replay = replayRecording({ game: duelGame, scene: field, recording: text });
  const ticks = decodeStreams(run.recording);
  return {
    result: run.outcome.result,
    joins: run.events.filter((e) => e.type === PLAYER_JOINED).map((e) => e.player ?? 0),
    seats: run.recording.players,
    actions: run.recording.actions,
    // Seat 1's first input: its vector, as ints × 1000.
    seat1First: run.recording.inputs[1]?.[0],
    migrated: parsed.ok ? (parsed.migratedFrom ?? null) : "unparsed",
    replayed: !replay.blocked && replay.matches,
    ticksWithInput: ticks.size,
  };
}
```

## UI

A game's UI goes in one of two places:

- **DOM over the canvas** (the UI seam below): HUDs, menus, unit cards,
  tooltips, anything with text, focus or a screen reader. It is a separate
  module from the game's, so headless runs and the scene CLI, which import
  the game module, never load DOM code, and one HUD serves the site, the
  editor's Play and a page of your own.
- **In the canvas**, drawn with the frame: the renderer's `uiContainer`, the
  Pixi stage's screen-fixed layer above the world, in canvas px (a debug
  layer gets it as `DebugLayerHost.uiContainer`), and the scene view's
  layers for things that ride the world. Keep it for in-canvas drawing
  only; it has no text input, focus or accessibility, so a game's HUD is
  DOM.

### The UI seam

The project file names the UI module beside the game module, relative to
the project file and with the same patterns as `game`:

```json
{
  "kind": "project",
  "v": 1,
  "id": "ferry",
  "name": "Ferry",
  "game": { "module": "./index.ts", "export": "ferryGame" },
  "ui": { "module": "./ui/index.ts", "export": "mountFerryHud" }
}
```

The export is a `MountUi<G>`: it gets a `UiContext<G>` and returns a
`UiHandle`, `{ destroy() }`, which takes away everything it added. The
context holds:

- `root`, a div over the canvas with the canvas's box. It takes no pointer
  events, so the canvas keeps its clicks; a child that should be clicked
  sets `pointer-events: auto`.
- `canvas` and `game`, the `GameInstance`.
- `slice()`, the store's `game` field (the runtime's `storeSlice()`), typed
  as `G`; null before the first load.
- `watch(select, fn)`, which calls `fn(value, prev)` now and again whenever
  `select(state)` changes by identity (`Object.is`), and returns the
  unsubscribe. Return the same slice object from `storeSlice` until
  something changed, and a watch on `(s) => s.game` fires once per change.
- `settings`, the game-settings doc's `game` block with defaults applied
  (`{}` without a project), and `reducedMotion`, true when the page prefers
  reduced motion, so the HUD skips its own animations.
- `links`, the pages the host ships beside the game, when it has any: an
  exported build's standalone host sets `links.credits` to its
  `credits.html`, so a menu can link to it; the site and the editor set
  none.

`mountUi(game, canvas, mount, { links })` is how a host mounts one (`links`
optional): `createUiLayer`
inserts the layer (a `data-jams-ui` div, a sibling of the canvas in its
offset parent, following the canvas's box through a `ResizeObserver`, or
the window's `resize` where there is none), builds the context and calls
`mount`. The function it returns calls `destroy`, drops every `watch` the
context made and removes the layer. The jams.team site calls it from an
effect in its game page, `SceneEditor` takes the same function as its `ui`
prop and mounts it over the canvas while Play runs, and a page of your own
calls it after `createGame`.

Two helpers keep framework-free DOM current. `bindText(el, ctx, select,
format?)` keeps `el.textContent` equal to `format(select(state))`.
`bindToWorld(el, ctx, at)` keeps `el` over the world point `at()` returns
(metres, through `game.worldToClient` and the camera), moving it with a
transform on every store change and canvas resize and hiding it while
`at()` is null. `watchView(ctx, fn)` is the trigger under `bindToWorld`,
for DOM sized from `worldToClient` too, such as a cell highlight.

**What a HUD may do:** read `slice()` and `watch`; call `game.send`
(commands are recorded and replay); map points with `game.clientToWorld`
and `game.worldToClient`; use `game.input` (`bindings`, `onAction`,
`capture`, `rebind`); and `pause` and `resume`. It never reaches
`game.runtime()` or the runtime's `ctx`: everything that changes the
simulation is a command, so a run with a HUD replays without one. What it
shows beyond the slice (a unit's reach, a fog of war) it computes from the
slice with the pure toolkits in `./game`.

The ferry's HUD: a status line, a button that sends `cross`, a name tag
over the boat and a help panel on a UI-only action:

```ts dom-hud.ts
import { bindText, bindToWorld, type GameStoreState, type MountUi } from "@jams/engine";

/** What the ferry game's `storeSlice()` returns: a new object only when something changed. */
export type FerrySlice = {
  turn: number;
  /** The boat's position, world metres. */
  boat: [x: number, y: number];
  aboard: number;
  /** Whether `cross` is among the commands the game lists as legal now. */
  canCross: boolean;
  result: "won" | null;
};

const ferry = (s: GameStoreState) => s.game as FerrySlice | null;

/**
 * The ferry's HUD, with no framework: a status line, a Cross button that
 * sends the game's `cross` command, a name tag that rides the boat, and a
 * help panel the UI-only `help` action toggles. It reads the slice and
 * changes the game only through `send`.
 */
export const mountFerryHud: MountUi<FerrySlice> = (ctx) => {
  const doc = ctx.root.ownerDocument;
  const hud = doc.createElement("div");
  hud.dataset.motion = ctx.reducedMotion ? "reduced" : "full";

  const status = doc.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const cross = doc.createElement("button");
  cross.type = "button";
  cross.textContent = "Cross";
  // The layer takes no pointer events; whatever is clickable opts back in.
  cross.style.pointerEvents = "auto";
  cross.addEventListener("click", () => ctx.game.send({ name: "cross" }));

  const tag = doc.createElement("span");
  tag.setAttribute("aria-hidden", "true");
  tag.textContent = typeof ctx.settings.boatName === "string" ? ctx.settings.boatName : "Ferry";

  const help = doc.createElement("aside");
  help.hidden = true;
  help.textContent = "Cross carries everyone aboard to the far bank.";

  hud.append(status, cross, tag, help);
  ctx.root.append(hud);

  const stops = [
    bindText(status, ctx, ferry, (f) =>
      !f
        ? "Loading the ferry"
        : f.result === "won"
          ? "Everyone is across"
          : `Turn ${f.turn} · ${f.aboard} aboard`,
    ),
    ctx.watch(ferry, (f) => {
      cross.disabled = !f?.canCross;
    }),
    bindToWorld(tag, ctx, () => {
      const f = ctx.slice();
      return f ? { x: f.boat[0], y: f.boat[1] - 0.5 } : null;
    }),
    ctx.game.input.onAction(
      (e) => {
        if (e.down && !e.repeat) help.hidden = !help.hidden;
      },
      { actions: ["help"] },
    ),
  ];

  return {
    destroy() {
      for (const stop of stops) stop();
      hud.remove();
    },
  };
};
```

A host page mounts it with `const unmount = mountUi(game, canvas,
mountFerryHud)`; the canvas's parent should be positioned, since the layer
is placed against the canvas's offset parent.

### UI-only actions

An action with `ui: true` is resolved from devices and every binding layer
like any other (the game's bindings, the input map, the host's and the
player's remaps, all checked alike), but it never enters the simulation:
it is absent from `TickInput` and `ctx.input`, from a recording's `actions`
table and seat streams, and from fuzz's default macro. A cursor or a menu
is UI state; in a `turns` game no tick runs until a command arrives, so a
cursor the simulation moved would freeze, and recording menu navigation
would only grow recordings with input that can't change a run.

`GameInstance.input.onAction(listener, { actions? })` delivers every
action's changes as devices produce them, UI-only or not, whether the
simulation is ticking, paused or idle; it returns the unsubscribe. Each
`UiActionEvent` carries `action`, `player`, `kind` and `device`; a button
gives its edge as `down`, with `repeat: true` for the OS's key repeat
(which never reaches the simulation), and an axis or vector its quantised
`value` or `vector` whenever that changes. While any listener exists the
shell also polls pads every animation frame, and a listener that throws is
logged without stopping the others.

`registry.uiActionNames` lists the UI-only actions in registration order
(`actionNames` still lists all of them, since input maps bind both), and
`isUiAction(registry, name)` in `./game` is the one check the input
system, the recorder, fuzz and script validation share. An input script's
`hold`, `press` or `set` naming a UI-only action is `binding-unknown` with
the hint "UI actions don't reach the simulation; send a command". The
input-map and input-script schemas list a game's UI-only actions in their
own enum branch, marked `x-ui: true`.

## Turn games

A turn game's player chooses, and the simulation then plays the choice
out. On a `turns` clock ([World models](#world-models)) the shape is:

- **Actions are UI-only.** A cursor (a vector), confirm and cancel drive
  the HUD's own state machine through `onAction` and canvas clicks
  (`clientToWorld`, then the grid's `cellAt`).
- **Orders are commands.** The HUD sends `move { unit, to }` and the like
  with `game.send`, which wakes the clock; the runtime applies them in
  `beforeStep`, refuses (and reports) an illegal one, and keeps `busy()`
  true while the result plays out, so the clock ticks only then.
- **The game says what is legal.** `GamePlayDef.commands?(state)` lists
  the commands a run may send now, in a stable order. Before a run's first
  tick `state.tick` is −1 and `events` is empty. The list is the
  game-agnostic shape every board, card and tactics game can give, and it
  is how anything but a person explores the game.

### Legal commands

Every report reads the list through one rule: what `play.commands`
returns after the last tick, cut at 64 entries with `legalTruncated: true`
beyond. `runProbe`'s `ProbeReport` and `runPlaytest`'s `final` carry it as
`legal` when the game declares `commands`, and it is absent when the game
doesn't.

`fuzz`, for a game with `commands` and no `play.macro` of its own, makes
command macros: one slot sending one command picked from the slot's legal
list by the rollout's seeded generator, for every macro on a `turns`
clock and half of them otherwise (the rest hold actions, as before). An
empty list sends nothing for that slot. `FuzzReport.legal` counts what the
command macros did (`sent`, and `empty` for the slots that found the list
empty), and the rollouts stay seeded, so a fuzz that reaches a game's
goal replays.

The scene CLI prints the list with `vp run scene step <scene> --legal`
(see `scripts/scene/README.md`), and MCP's `scene_playtest` results carry
it. On the second game's first level:

```text
$ vp run scene step level-1 --project tactics --ticks 1 --legal
level-1 … game tactics …: 1 ticks at 60Hz; lengths in m, speeds in m/s (48 px/m)
  final {"turn":1,"side":"blue","phase":"orders",…}
  legal (42):
    move {"unit":"blue-archer/unit","to":[0,3]}
    …
    wait {"unit":"blue-archer/unit"}
    …
```

The `tower-defense` probe ([Genre probes](#genre-probes)) gives the same
list on a fixed clock: `build { at }` on every free pad while money lasts.

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

/** Moves a coin 0.32 m right and returns the canonical text, or the issues that stopped it. */
export function nudgeCoin(text: string, id: string): string | string[] {
  const parsed = parseScene(text, registry);
  if (!parsed.ok) return parsed.issues.map((i) => `${i.code}: ${i.message}`);

  const result = applyOps(
    parsed.def,
    { ops: [{ op: "move", refs: [id], by: [0.32, 0] }] },
    registry,
  );
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
    svg: renderSceneSvg(scene, { registry, around, margin: 2, labels: "entities" }),
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
  "v": 4,
  "name": "gates",
  "bounds": [0, 0, 20, 10],
  "groups": {
    "east": { "at": [12, 0], "rot": 2, "flip": true }
  },
  "instances": [
    { "id": "gate-1", "prefab": "gate", "at": [6, 9] },
    {
      "id": "gate-2",
      "prefab": "red-gate",
      "group": "east",
      "z": 5,
      "at": [2, 9],
      "rot": 1,
      "params": { "speed": 1.2 },
      "overrides": { "trigger.tags": ["gate", "east"] }
    }
  ],
  "entities": [
    { "id": "east-post", "type": "solid", "group": "east", "shape": ["box", 5, 9, 0.1, 0.6] }
  ]
}
```

- A group's members store their geometry relative to its `at`, so moving
  the group is one edit. A group may turn and flip its members
  ([Transforms](#transforms)); there is no scale.
- A prefab is an asset of kind `prefab` (a `.json` with `"kind": "prefab"`
  anywhere in the project): `{ "kind": "prefab", "v": 4, "id",
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

Format v3 added these keys, and format v4 is v3 with every length in
metres (see [Units](#units)). Each addition is optional, and leaving it
out keeps v2's behaviour:

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
  "v": 4,
  "name": "yard",
  "bounds": [0, 0, 40, 20],
  "settings": {
    "gravity": [0, 12],
    "grid": { "kind": "square", "cell": [0.32, 0.32] },
    "physics": "rapier"
  },
  "assets": ["boom"],
  "groups": {
    "left-wing": { "name": "Left wing", "at": [4, 0], "rot": 2, "flip": true }
  },
  "instances": [
    { "id": "gate-1", "prefab": "gate", "at": [8, 9] },
    {
      "id": "gate-2",
      "prefab": "red-gate",
      "z": 5,
      "at": [16, 9],
      "rot": 1,
      "flip": true,
      "params": { "speed": 1.2 }
    },
    {
      "id": "room-1",
      "prefab": "room",
      "at": [24, 6],
      "overrides": { "door-1/panel.path.speed": 0.6 }
    }
  ],
  "solid": [["box", 20, 19.8, 20, 0.2]],
  "entities": [
    {
      "id": "lever",
      "type": "sensor",
      "z": 2,
      "shape": ["box", 7, 9.5, 0.1, 0.2],
      "tags": ["switch"]
    },
    {
      "id": "lift",
      "type": "solid",
      "shape": ["box", 24, 6.4, 0.4, 0.08],
      "attach": "room-1/door-1/panel"
    }
  ]
}
```

The schemas' `$id`s are `urn:jams-engine:scene:v4`, `prefab:v4`,
`fragment:v4` and `ops:v4` (and `<game>:scene:v4` for a game's).

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
| `sideField(desc)`         | the side turns by the turn    | the side mirrors              |
| grid fields               | cells remap (square only)     | cells remap (square only)     |
| any other value           | unchanged                     | unchanged                     |

One-way sides (`sideField`, a solid's `oneWay`) turn and flip with the
instance; `true` stays `true` while the side still faces up. The resolved
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
4. the engine's: gravity `[0, 12]` (`DEFAULT_GRAVITY`), `rapier`, no grid, orthogonal.

`resolveSettings(settings, { project?, game? })` applies the order;
`expandScene` resolves with the scene's values and the engine defaults.

### Prefabs: nesting, variants and parameters

A prefab may hold instances of other prefabs, may be a variant of another,
and may expose parameters:

```json
{
  "kind": "prefab",
  "v": 4,
  "id": "room",
  "instances": [
    { "id": "gate-1", "prefab": "gate", "at": [-2, 0] },
    {
      "id": "gate-2",
      "prefab": "gate",
      "at": [2, 0],
      "rot": 2,
      "flip": true,
      "overrides": { "door.path.speed": 0.9 }
    },
    {
      "id": "door-1",
      "prefab": "door",
      "z": 2,
      "at": [0, 0.4],
      "overrides": { "latch/door.path.speed": 0.3 }
    }
  ],
  "entities": [{ "id": "lamp", "type": "marker", "at": [0, -1], "tags": ["light"] }]
}
```

```json
{
  "kind": "prefab",
  "v": 4,
  "id": "red-gate",
  "base": "gate",
  "params": {
    "speed": {
      "description": "How fast the door opens, in m/s.",
      "targets": ["door.path.speed"],
      "default": 0.9
    }
  },
  "overrides": {
    "trigger.tags": ["gate", "red"]
  },
  "entities": [{ "id": "lamp", "type": "marker", "at": [0.2, -0.9], "tags": ["light"] }]
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
- **Parameters.** `params` declares `{ description, targets, default?, map? }`
  by name; each target is an override path inside the prefab. An
  instance's `params: { speed: 120 }` applies as an override of every
  target, so the precedence is prefab < param < override. `map` gives a
  target its own value per string value of the param, e.g.
  `{ "unit.behaviors.sprite.frame": { "red": "knight-red" } }`; a mapped
  target with no entry for the value keeps its own. A variant
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
  `purgeAsset` (deletes a trashed asset and its replaced versions for
  good; anything else is `asset-not-trashed`), `changeAssetId` (rewrites
  every reference in one batch, a material's bulk keys such as
  `solid:bouncy` and instance overrides included),
  `setImport`, `replaceContent`, `setLicence`, `editAsset` (JSON pointer
  edits, with `@<id>` for a keyed item) and `editScene` (scene ops). A
  scene's checks file follows it through `moveAsset` and `renameAsset`,
  and counts as a referrer when the scene is deleted. One batch is one
  undo step across every doc it writes, except a batch with a
  `purgeAsset`, which has no inverse and is on no undo stack.
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
- **Cleanup:** deleted assets go to the trash and stay restorable until
  a `purgeAsset` removes one with its hash history. `unreferencedBlobs`
  names the content-hash blobs nothing references: not a live or
  trashed asset's bytes, not in an asset's hash history within the grace
  period, and not pinned by a snapshot. Only those may be collected.

## Sprites and rendering

A scene names its art by asset id, the shell loads it, and headless code
knows its size without decoding a byte. The engine draws an entity through
its `sprite` behavior; an entity without one draws as its type's shape.

### The `sprite` behavior

`sprite` is the engine's one behavior (`SPRITE` in `./game`), visual only:
it never changes simulation state and has no system headless. Any entity
type may carry it, unless the type forbids it. Its fields:

| Field       | Meaning                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| `asset`     | A `texture`, or an `atlas` whose frame it draws. Without one only the fallback box draws (`sprite-no-asset`)    |
| `frame`     | The atlas frame's name; required for an atlas (`asset-frame-unknown` otherwise, or for a frame it lacks)        |
| `size`      | Drawn size in world metres; omitted, the frame's (or texture's) pixel size over the px per metre, times `scale` |
| `scale`     | Used when `size` is omitted; default 1                                                                          |
| `anchor`    | 0–1 in the frame; default the frame's pivot, else the texture's import pivot, else the centre                   |
| `offset`    | World metres from the pose to the anchor; turns and flips with the instance                                     |
| `tint`      | 0xRRGGBB multiplied into the texture                                                                            |
| `alpha`     | Opacity, 0–1; default 1                                                                                         |
| `flipX`     | Mirror left–right; an instance flip toggles it                                                                  |
| `flipY`     | Mirror top–bottom                                                                                               |
| `blend`     | `normal`, `add`, `multiply` or `screen`                                                                         |
| `tile`      | Repeat the frame across `size` instead of stretching it                                                         |
| `nineSlice` | Border insets in texture px; default the texture's import setting                                               |
| `turn`      | Turn with the pose's rotation; default true                                                                     |

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
  is `asset-missing`, and so is a texture whose entry records a hash but no
  size, reported at its reference with the hash as `detail.unsized`: it's
  left out of the bundle, and the export refuses it once, at that reference
  rather than again at the blob. `projectBundle(view, settings, kinds, registry)` is
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
  system's failed spawn does. A behavior's `beforeStep` runs after the
  game's, and its `beforePhysics` after the type systems', both before the
  physics step ([The tick order with behaviors](#the-tick-order-with-behaviors)).
  Each behavior's `step` runs after the type
  systems' `afterStep` and the contacts, before the timers and the game's
  `afterStep` (so the game sees what behaviors did); after the tick the
  sprites re-pose (so a pose the game wrote draws this tick), then
  `view.commit`. [Entity lifecycle](#entity-lifecycle) has the whole tick
  order, and `ready`, `disable` and `enable`.
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
  fields: { radius: z.number().positive().default(0.24).describe("Ring radius, m; default 0.24.") },
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
engine command, `@elapsed { ms }` (`ENGINE_COMMANDS` in `./game` lists the
engine's commands, which every registry accepts beside the game's), capped
at `maxMs`: the browser shell
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
  actions: [
    {
      action: "pick",
      bindings: [{ device: "key", code: "Space" }],
      description: "Pick every ripe apple.",
    },
  ],
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
  v: 4,
  game: "orchard",
  name: "meadow",
  bounds: [0, 0, 6.4, 3.6],
  entities: [],
};

/** Plants a tree, is away for a day (capped at eight hours), then picks. */
export function dayAway() {
  const run = runPlaytest({
    game: orchardGame,
    scene: meadow,
    script: { v: 2, steps: [{ command: "plant" }, { elapse: 24 * HOUR }, { press: ["pick"] }] },
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
  world: { physics: "none", grid: { kind: "square", cell: [0.32, 0.32] } },
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
        const hero = markerAt(scene, "hero");
        goal = (markerAt(scene, "goal")?.at as Pt | undefined) ?? null;
        route = [];
        walks = 0;
        stepper =
          hero && ctx.grid
            ? createGridStepper(ctx, hero.id, {
                start: ctx.grid.geometry.cellAt(hero.at as Pt),
                msPerStep: 150,
              })
            : null;
      },
      beforeStep(dtMs, _actions, commands) {
        const grid = ctx.grid;
        if (!grid || !stepper) return;
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
  v: 4,
  game: "walker",
  name: "corridor",
  bounds: [0, 0, 3.2, 1.6],
  entities: [
    { id: "wall", type: "solid", shape: ["box", 1.44, 0.64, 0.16, 0.64] },
    { id: "hero", type: "marker", at: [0.16, 0.16], tags: ["hero"] },
    { id: "goal", type: "marker", at: [3.04, 0.16], tags: ["goal"] },
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
      v: 2,
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
        const desc = rapier.ColliderDesc.ball(0.1);
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
    v: 4,
    game: "party",
    name: "party",
    bounds: [0, 0, 4, 3],
    settings: { physics: "none" },
    entities: [{ id: "red", type: "balloon", at: [2, 2.5] }],
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
and `ccd`. `world.lengthUnit` is the game's px per metre, which only the
drawing side reads (see Units).

### Shape queries

The geometry backend's shape tests are plain functions in `./scene`, for
tools, editors and games that need them without a world. `shapeAtPose(local,
{ x, y, rot })` moves a shape from its own frame to a pose,
`shapesIntersect(a, b)` tests overlap (touching counts), and
`raycastShape(shape, from, dir, maxDist)` returns the first hit's `toi`, as
a share of `maxDist`, and surface `normal`, or null. All three are exact:
they use only `+ − × ÷` and `Math.sqrt`, and quarter turns come from exact
tables, so a quarter-turned box is still exactly a box.
`createSpatialHash(cell?)` is the broad phase the editor's index and the
geometry world use: a uniform grid of `cell` m (2.56 by default) with
`insert`, `update`, `remove`, `clear` and `query(box)`, which returns the
keys whose boxes overlap (touching counts) in insertion order.

```ts shape-queries.ts
import {
  aabb,
  createSpatialHash,
  raycastShape,
  shapeAtPose,
  shapesIntersect,
  type ShapeObj,
} from "@jams/engine/scene";

/** A plank's shape in its own frame: 0.8 m long, 0.1 m thick, centred on its origin. */
const plank: ShapeObj = { type: "box", cx: 0, cy: 0, hw: 0.4, hh: 0.05, rotDeg: 0 };

/** Two planks on a workbench: one lying flat, one stood on end by a quarter turn. */
const placed = new Map<string, ShapeObj>([
  ["flat", shapeAtPose(plank, { x: 1, y: 1, rot: 0 })],
  ["upright", shapeAtPose(plank, { x: 3, y: 1, rot: Math.PI / 2 })],
]);

/** What a saw blade at `blade` would cut, and where a laser fired right from `from` lands. */
export function workbench(blade: ShapeObj, from: [number, number]) {
  // Broad phase: boxes in 0.64 m cells; a query returns keys in insertion order.
  const hash = createSpatialHash<string>(0.64);
  for (const [id, shape] of placed) hash.insert(id, aabb(shape));
  const near = hash.query(aabb(blade));
  // Narrow phase, exact: the quarter-turned plank is a 0.1 × 0.8 m box, not a rounded one.
  const cuts = near.filter((id) => shapesIntersect(blade, placed.get(id)!));
  const upright = placed.get("upright")!;
  const laser = raycastShape(upright, from, [1, 0], 4);
  return {
    upright: aabb(upright),
    near,
    cuts,
    laser: laser && { at: from[0] + laser.toi * 4, normal: laser.normal },
  };
}
```

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
`grid-yard` is a physics-free scene on a 0.32 m square grid (32 px at the
default 100 px per metre) with a
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
const hex = gridGeometry({
  kind: "hex",
  cell: [0.32, 0.28],
  side: 0.16,
  stagger: "x",
  index: "odd",
});
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
  type ActionDef,
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

const ARROW: Readonly<Record<string, string>> = {
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
};

/** Top-down steering on whichever backend the scene loads: a motion body, a controller and a sensor goal. */
export const roverGame = defineGame<RoverSnapshot>({
  id: "rover",
  types: [],
  actions: Object.keys(STEER).map(
    (action): ActionDef => ({
      action,
      bindings: [{ device: "key", code: ARROW[action]! }],
      description: `Steer ${action}.`,
    }),
  ),
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
            shape: { type: "circle", cx: 0, cy: 0, r: 0.08 },
          },
        );
        position = () => body.position();
        rover = createTopDownController(body, { maxSpeed: 1.8, accel: 9, decel: 9 });
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
        const hit = ctx.space.raycast(at, { x: 1, y: 0 }, 10, { exclude: [id] });
        return {
          at,
          speed: Math.sqrt(v.x * v.x + v.y * v.y),
          wallAhead: hit ? hit.toi * 10 : null,
        };
      },
    };
  },
});

const yard = (physics: "rapier" | "none"): SceneDefinition => ({
  v: 4,
  game: "rover",
  name: "yard",
  bounds: [0, 0, 4, 3],
  settings: { physics },
  entities: [
    { id: "east", type: "solid", shape: ["box", 3.92, 1.5, 0.08, 1.5] },
    { id: "south", type: "solid", shape: ["box", 2, 2.92, 2, 0.08] },
    { id: "start", type: "marker", at: [0.4, 0.4] },
    { id: "home", type: "sensor", shape: ["box", 3.6, 2.6, 0.24, 0.24] },
  ],
});

/** Drives right into the east wall, then slides down it into the home sensor. */
export function driveHome(rapier: RapierModule | null) {
  const run = runPlaytest({
    rapier,
    game: roverGame,
    scene: yard(rapier ? "rapier" : "none"),
    script: {
      v: 2,
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
    [4, 0],
    [4, 1],
    [4, 2],
    [4, 3],
    [0, 3],
  ] as Ring,
};
const corridor = {
  id: "corridor",
  pts: [
    [4, 1],
    [7, 1],
    [7, 2],
    [4, 2],
  ] as Ring,
};
const table = {
  id: "table",
  pts: [
    [1.5, 1],
    [2.5, 1],
    [2.5, 2],
    [1.5, 2],
  ] as Ring,
};

export function walkAround() {
  const { mesh, issues } = buildNavMesh([room, corridor], [table]);
  // The funnel's corners: round the table, through the doorway, to the end of the corridor.
  const path = navPath(mesh, [1, 1.5], [6.5, 1.5]);
  return {
    issues,
    path,
    onTable: navContains(mesh, [2, 1.5]),
    // A click outside the walk areas, moved to the closest walkable point.
    clickedOutside: navNearest(mesh, [5.5, 2.8]),
  };
}
```

## Standard behaviors

Every registry, a game's or a gameless project's, holds eleven gameplay
behaviors next to `sprite`, `occupant` and `lifetime`, so a level gets a
playable hero, physics props and moving parts from data alone. A behavior
belongs here when a second, unrelated game would use it unchanged; health,
damage, inventory, score and abilities stay in games. Each one is built on
`./game`'s public API and nothing else, so a game's own behavior can do
whatever the engine's do ([Write your own controller](#write-your-own-controller)).

| Behavior              | What it is                                                                                                                                                   | Fields (defaults)                                                                                                                                                                                                                                                                                                     | Requires                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `collider`            | A collision shape: static on its own, moved by a `body` beside it, or a trigger that raises `sensor:enter` and `sensor:exit` as the `sensor` type does.      | `shape` (local to the entity's pose, not a chain), `sensor` (false), `material`, `group` (see below), `density` (1 kg/m²), `friction`, `restitution` (from the material)                                                                                                                                              | —                                                                                                     |
| `body`                | Makes the collider a physics body.                                                                                                                           | `kind` (`dynamic`, `kinematic` or `static`), `gravityScale` (1), `linearDamping` (0), `angularDamping` (0), `fixedRotation` (false), `ccd` (false)                                                                                                                                                                    | `collider`; a dynamic body needs physics                                                              |
| `player-input`        | Binds the entity to a seat; behaviors on it read that player through `inputFor`.                                                                             | `seat` (0)                                                                                                                                                                                                                                                                                                            | —                                                                                                     |
| `character-top-down`  | Walks in the plane: a kinematic controller, stopped and slid along by walls.                                                                                 | `maxSpeed` (4 m/s), `accel` (40 m/s²), `decel` (40 m/s²), `pushDynamic` (false), `move` (the action, `"move"`)                                                                                                                                                                                                        | `collider`; a `body` only if kinematic; not with `character-side-view`, `nav-agent` or `path-follow`  |
| `character-side-view` | Runs and jumps under gravity, with coyote time, a jump buffer, a variable jump height, slopes, steps and one-way platforms; rides moving platforms.          | `maxSpeed` (6), `accel` (60), `decel` (70), `airControl` (0.6), `jumpHeight` (1.2 m), `gravityScale` (1), `maxFallSpeed` (15 m/s), `coyoteMs` (100), `jumpBufferMs` (100), `jumpCut` (0.5), `maxSlopeDeg` (50), `stepHeight` (0.04 m), `snapToGround` (0.04 m), `pushDynamic` (true), `move` and `jump` (the actions) | `collider`; a `body` only if kinematic; not with `character-top-down`, `nav-agent` or `path-follow`   |
| `camera-target`       | With no `cameraTarget()` from the game, the camera follows the weighted centre of the live entities carrying it, loaded or spawned.                          | `weight` (1), `seat` (omitted: every view)                                                                                                                                                                                                                                                                            | —                                                                                                     |
| `spawner`             | Spawns entities of a type, or instances of a prefab, at a rate up to a cap of live ones.                                                                     | `type` or `prefab` (exactly one), `rate` (1 /s), `cap` (10), `burst` (0), `lifeMs` (omitted: they stay), `spread` (0 m), `velocity` (for a dynamic body), `active` (true)                                                                                                                                             | —                                                                                                     |
| `nav-agent`           | Walks the scene's walk areas to a point or after an entity, kept apart from other agents; through a motion body when it has a `collider`, else by pose.      | `speed` (1.2 m/s), `arrive` (0.12 m), `radius` (0.3 m), `separation` (1.5), `repathTicks` (180), `to` (a point or an entity's id it walks to from the start; none)                                                                                                                                                    | a `nav` walk area in the scene (`nav-missing` otherwise); not with a character or `path-follow`       |
| `path-follow`         | Moves the entity along a waypoint path, with the `follower` type's path; with a kinematic `body` it carries what stands on it.                               | `path` (`pts`, `mode`, `speed`, as a follower's)                                                                                                                                                                                                                                                                      | not with a character or `nav-agent`                                                                   |
| `force-area`          | Pushes the dynamic bodies inside its collider one way, or toward or away from its pose; the two characters add the same acceleration while they stand in it. | `kind` (`directional`), `force` (directional, m/s²) or `strength` (point, m/s²), `falloff` (`none`, `linear` or `inverse-square`), `drag` (0 /s), `affects` (`groups`, `tags`)                                                                                                                                        | `collider` with `sensor: true`; pushing bodies needs physics                                          |
| `joint`               | Links the entity's body to another entity's: a hinge, a slider, a rope, a weld or a spring.                                                                  | `kind`, `to` (the other entity), `anchorA`, `anchorB`, `axis` (prismatic), `limits` and `motor` (revolute and prismatic), `length` (rope and spring), `stiffness` (100) and `damping` (1) (spring), `collide` (false)                                                                                                 | `body`, and physics; `to` names an entity with a body (`joint-ref-type`), never itself (`joint-self`) |

A collider with no `group` joins `dynamic` on a dynamic body and `static`
otherwise. A sensor's joins `sensor`, which meets nothing until the game
links it (`collisionGroups: { dynamic: { collidesWith: ["sensor"] } }`), so
a game says what its triggers and force areas see. A project with no game
can't link groups, so there a sensor's joins `dynamic`: it meets the
dynamic bodies, the characters' and agents' motion bodies, and the static
ones. The `sensor` type keeps its own group either way.

A behavior's points and paths are world metres, and its entity references
name entities: a `path-follow` path moves, turns and flips with its entity
in a prefab instance, a group and an editor move, as a follower's path
does, and a `joint` or `nav-agent` `to` inside a prefab names a child of
the same instance (`door` in prefab `gate` placed as `gate-1` is
`gate-1/door`), the innermost instance first, else the scene's own entity
of that id. A behavior's vectors (a joint's anchors, a sprite's offset)
are local to the entity's pose.

`solid`, `sensor`, `prop` and `follower` already own a body, so they
forbid `collider` and `body`: put the blocks on a `marker`, or on a game
type that allows them. A side-view hero is a marker with four blocks, and a
barrel it can push is a marker with two:

```json
{
  "id": "hero",
  "type": "marker",
  "at": [3, 9.6],
  "behaviors": {
    "collider": { "shape": ["box", 0, 0, 0.15, 0.3] },
    "character-side-view": { "maxSpeed": 5, "jumpHeight": 1.5 },
    "player-input": {},
    "camera-target": {}
  }
}
```

```json
{
  "id": "barrel",
  "type": "marker",
  "at": [6, 9],
  "behaviors": { "collider": { "shape": ["circle", 0, 0, 0.25], "density": 2 }, "body": {} }
}
```

The hero plays with no code. A registry built without a game has two
actions, `move` (a vector on WASD, the arrow keys, the left stick and the
d-pad) and `jump` (Space, or the pad's south button), and the characters
read those names by default; a game's `actions` replace both, so a game
that names its own sets the character's `move` and `jump` fields to them.
The barrel needs a scene with physics, since its body is dynamic. The scene
CLI makes both through ops
([Standard behaviors](../../scripts/scene/README.md#standard-behaviors) in
its README has the batches, and its tests run each).

- **Checks.** A missing `requires` is `behavior-missing`. The two
  characters, `nav-agent` and `path-follow` each move the entity on their
  own, so an entity carries at most one of the four: any two together are
  `behavior-conflict`. A joint's `to` holds when it names an entity with a
  `body`, a `collider` that isn't a sensor, or a type that declares
  `ownsBody` (`solid`, `prop` and `follower` do, and a type based on one
  of them); anything else is `joint-ref-type`, here and at load alike. A character on a
  dynamic body is `character-body-kind`, since the controller and the
  solver would both move it; its fix makes the body kinematic. A dynamic
  `body` or a `joint` in a scene without physics is `physics-required`.
- **Systems.** `ctx.behavior(name)` gives each one's system:
  `CharacterSystem` (`setIntent(id, { move, jump? })` drives an entity with
  no `player-input`, from that tick until the next call; `velocity`,
  `grounded`, `launch(id, v)`), `NavAgentSystem` (`setDestination(id, to)`,
  `to` a point or an entity id; `stop`, `path`), `SpawnerSystem` (`live(id)`),
  `ForceAreaSystem` (`sample(point, entityId?)`, the acceleration the
  areas give there; with an entity, only the areas whose `affects` takes
  it, as the characters ask), `PathFollowSystem` (`position`),
  `JointSystem` (`joined`) and `ColliderSystem` (`has`, `rebuild`, and
  `standIn` and `release`, below). A gameless scene's nav agents stand still until
  code gives them a destination, or their `to` names one. A character's or
  an agent's motion body stands in for its collider's own body, which the
  collider system keeps out of the world (and out of `ctx.bodies`) from
  `standIn(id)` until `release(id)`, across rebuilds and the entity's
  disables and enables: then it is built again where the entity stands
  and answers `ctx.bodies` again. A side-view character passes up through
  an `up` one-way solid while it rises, and down through one while it holds
  down; a `down`, `left` or `right` one holds it from that side whatever it
  does.
- **Events**, in `step` and `playtest` reports as any other:

| Event                   | When                                                               | `entityId`    | `other`                     |
| ----------------------- | ------------------------------------------------------------------ | ------------- | --------------------------- |
| `character:jumped`      | a side-view jump starts, on the ground or in coyote time           | the character | —                           |
| `character:left-ground` | a side-view character leaves the ground: a jump, a launch, a ledge | the character | —                           |
| `character:landed`      | a side-view character lands                                        | the character | what it landed on           |
| `nav:arrived`           | an agent reaches its destination                                   | the agent     | the entity it followed      |
| `nav:blocked`           | an agent gives up; `data.reason` is `no-path`, `stuck` or `gone`   | the agent     | the entity it followed      |
| `spawner:spawned`       | a spawner makes a spawn, `at` where it appeared                    | the spawner   | the new id (also `data.id`) |

- **Saves.** Every one that keeps state writes it into a world save and
  reads it back, so a restored run goes on as the saved one did; the
  spawner draws from `ctx.random.fork("spawner:<id>")`, and no other one
  draws at all. World saves still refuse scenes on Rapier
  ([Saves](#saves)), so a save mid-jump or mid-path is taken on the
  geometry backend.

### The tick order with behaviors

Behaviors have two hooks before the physics step, `beforeStep(dtMs)` and
`beforePhysics()`, beside `step` after it. Each tick runs:

1. the tick's input;
2. the type systems' `beforeStep`, in spawn order;
3. the game's `beforeStep`, with the tick's actions and commands;
4. the behaviors' `beforeStep`, in registration order (the characters,
   `nav-agent`, `path-follow`, `force-area` and `spawner` act here);
5. the type systems' `beforePhysics`, then the behaviors' (`joint` acts
   here); without physics, only the behaviors';
6. the tick's forces handed to the bodies, the physics step, and the forces
   taken off them;
7. the type systems' `afterStep`, then contacts;
8. the behaviors' `step`;
9. the timers, the events, the game's `afterStep`, and the end-of-tick flush
   ([Entity lifecycle](#entity-lifecycle) has the rest); any force applied
   since the step is dropped.

Registration order is the engine's behaviors (`sprite`, `occupant`,
`lifetime`, `collider`, `body`, `player-input`, `path-follow`,
`force-area`, `character-top-down`, `character-side-view`, `nav-agent`,
`joint`, `spawner`, `camera-target`), then the game's. Because behaviors
run after the game's `beforeStep`, an intent the game sets there, or an
entity it moves there, is acted on in the same tick; what the game reads
there is still the last tick's, so read a controller's result in
`afterStep`.

### Moving bodies: `ctx.bodies`

`ctx.bodies` (`BodyControl`) moves any body by entity id, whichever system
owns it: the `prop` and `follower` types, the `body` behavior and motion
bodies (the characters' too) all register theirs.

- `has(id)`, `kind(id)` (`"dynamic"`, `"kinematic"`, `"static"` or null),
  `velocity` and `setVelocity` (m/s), `angularVelocity` and
  `setAngularVelocity` (rad/s), `mass` (kg; Infinity for a kinematic or
  static body) and `wake`.
- `applyImpulse(id, impulse, at?)` changes the velocity at once, through
  the centre of mass or at a world point. `applyForce(id, force, at?)` and
  `applyTorque(id, torque)` hold for this tick's physics step only: they are
  summed through the tick, handed to the body after the behaviors'
  `beforePhysics`, and dropped after the step, so call them every tick to
  sustain one. One applied after the step (in `afterStep`, a behavior's
  `step` or an event handler) is dropped at the end of the tick, not
  carried into the next. A save between ticks therefore never holds a
  force.
- An id with no body throws `EngineError` `body-missing`. A force, torque
  or impulse on a kinematic or static body, a velocity on a static body or
  a follower, and an angular velocity on a kinematic body throw
  `body-not-dynamic`. Without physics, only kinematic bodies exist.

**Nothing gates forces by behavior.** `ctx.bodies` checks the body's kind
and nothing else: it never asks whether the entity carries a character, a
`player-input` or anything of the game's. An entity with a `collider`, a
dynamic `body`, a `player-input` and a game's own behavior that pushes it
from the seat's input is a supported shape, and so is the same entity in a
force area, on a joint, or spawned by a spawner. The one refusal is two
things positioning one body: a character on a dynamic body
(`character-body-kind`). A thruster that steers a dynamic body by force,
with no character anywhere:

```ts thruster-behavior.ts
import {
  defineBehavior,
  defineGame,
  inputFor,
  type BehaviorSystem,
  type EngineContext,
} from "@jams/engine/game";
import { z } from "zod";

/** The thruster's system, with the ships it pushes in attach order. */
export type ThrusterSystem = BehaviorSystem & { ships(): readonly string[] };

/** Pushes a dynamic body along its seat's move action: physics movement, no character. */
export const thruster = defineBehavior({
  name: "thruster-game/thruster",
  description: "Pushes the entity's dynamic body along its seat's move action.",
  fields: {
    force: z.number().positive().default(2).describe("Force at full stick, N; default 2."),
  },
  requires: ["body"],
  system(ctx): ThrusterSystem {
    const force = new Map<string, number>();
    return {
      attach(id, block) {
        force.set(id, Number(block.force));
      },
      detach(id) {
        force.delete(id);
      },
      // Before the physics step, which takes the force and drops it after.
      beforeStep() {
        for (const [id, f] of force) {
          const move = inputFor(ctx, id).vector("move");
          if (move.x !== 0 || move.y !== 0)
            ctx.bodies.applyForce(id, { x: move.x * f, y: move.y * f });
        }
      },
      clear() {
        force.clear();
      },
      size: () => force.size,
      ships: () => [...force.keys()],
    };
  },
});

export type ThrusterSnapshot = {
  ships: { id: string; at: [number, number]; v: [number, number] }[];
};

export const thrusterGame = defineGame<ThrusterSnapshot>({
  id: "thruster-game",
  types: [],
  behaviors: [thruster],
  actions: [
    {
      action: "move",
      kind: "vector",
      bindings: [
        { device: "pad", stick: "left" },
        { device: "key", code: "ArrowLeft", axis: "x", value: -1 },
        { device: "key", code: "ArrowRight", axis: "x" },
        { device: "key", code: "ArrowUp", axis: "y", value: -1 },
        { device: "key", code: "ArrowDown", axis: "y" },
      ],
      description: "Thrust.",
    },
  ],
  world: { gravity: [0, 0] },
  // Dynamic bodies overlap sensors, so a force area over a ship pushes it too.
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  createRuntime(ctx: EngineContext) {
    return {
      snapshot() {
        const ships = ctx.behavior<ThrusterSystem>(thruster.name)?.ships() ?? [];
        return {
          ships: ships.map((id) => {
            const p = ctx.poses.get(id);
            const v = ctx.bodies.velocity(id);
            return { id, at: [p?.x ?? 0, p?.y ?? 0], v: [v.x, v.y] };
          }),
        };
      },
    };
  },
});
```

A ship is a marker that carries it beside the engine's blocks:

```json
{
  "id": "ship",
  "type": "marker",
  "at": [2, 2],
  "behaviors": {
    "collider": { "shape": ["circle", 0, 0, 0.2] },
    "body": { "linearDamping": 0.5 },
    "player-input": {},
    "thruster-game/thruster": { "force": 3 }
  }
}
```

### Write your own controller

The characters are one way to move an entity, not the only one: they use
nothing a game can't. A controller of the game's own is a behavior whose
system makes a motion body when an entity attaches and moves it from the
seat's input in `beforeStep`; the motion body slides along walls, writes
the pose and registers with `ctx.bodies` as kinematic. Since it builds its
own body, the entity carries no `collider`. Register it in
`GameDefinition.behaviors` like any game behavior:

```ts own-controller.ts
import { createMotionBody, defineBehavior, inputFor, type MotionBody } from "@jams/engine/game";
import { z } from "zod";

/** A controller of the game's own: a motion body its seat's move action walks at one speed. */
export const stroll = defineBehavior({
  name: "stroll-game/stroll",
  description: "Walks the entity at one speed from its seat's move action.",
  fields: { speed: z.number().positive().default(3).describe("Walking speed, m/s; default 3.") },
  system(ctx) {
    const walkers = new Map<string, { body: MotionBody; speed: number }>();
    const circle = { type: "circle", cx: 0, cy: 0, r: 0.2 } as const;
    return {
      attach(id, block) {
        const at = ctx.poses.get(id) ?? { x: 0, y: 0 };
        const body = createMotionBody(ctx, ctx.get(id)!, at, { shape: circle });
        walkers.set(id, { body, speed: Number(block.speed) });
      },
      detach(id) {
        walkers.get(id)?.body.destroy();
        walkers.delete(id);
      },
      // After the game's beforeStep and before the physics step.
      beforeStep(dtMs) {
        for (const [id, { body, speed }] of walkers) {
          const move = inputFor(ctx, id).vector("move");
          const d = (speed * dtMs) / 1000;
          body.move({ x: move.x * d, y: move.y * d });
        }
      },
      clear() {
        for (const { body } of walkers.values()) body.destroy();
        walkers.clear();
      },
      size: () => walkers.size,
    };
  },
});
```

On an entity that carries a `collider` (so the editor, `ctx.tags` and the
other behaviors see its shape), the controller does what the characters
do: after making its motion body it calls
`ctx.behavior<ColliderSystem>("collider")?.standIn(id)`, which keeps the
collider's own body out of the world, rebuilds and re-enables included,
and on `detach` it calls `release(id)` while the entity still exists.
Destroying a motion body forgets its `oneWayPasses`; a controller that
gates one-way solids with no motion body of its own calls
`forgetOneWayActor(ctx, id)` when it lets the entity go.

## Entity lifecycle

A scene's entities are only where a run starts: game code spawns,
destroys, enables and disables entities while it runs, and every one it
makes is a real entity, in its type's system, the pose index, the entity
table, queries and events alike.

- **Hooks.** `SceneSystem` and `BehaviorSystem` both have three optional
  members. `ready(ids)` runs once a batch of entities has spawned and its
  behaviors attached (a load's, a spawn's, a placed prefab's), with the
  batch's ids of that type, or carrying that behavior, in spawn order: the
  place to wire entities to each other, since all of them exist. `disable(id)`
  stops simulating an entity and keeps its state (colliders out of queries,
  visuals removed); `enable(id)` resumes it.
- **Enable and disable.** `ctx.setEnabled(id, on)` is immediate.
  Disabling runs the behaviors' `disable` in reverse registration order,
  then the type system's, takes the entity out of queries and contacts,
  pauses the timers it owns and raises `entity:disabled`; enabling runs the
  same in the opposite order and raises `entity:enabled`.
  `ctx.enabled(id)` is false for a disabled entity and for one that doesn't
  exist; `ctx.exists(id)` and `ctx.get(id)` see disabled ones too.
- **The fallbacks.** A type system without `disable` has the entity
  despawned, its record and pose kept, and spawned again from the record
  at its spawn pose on enable (so its state resets). A behavior without
  `disable` is detached, and attached again on enable. The primitives
  have their own: `solid`, `sensor` and `prop` switch their bodies and
  colliders off (on Rapier or the geometry backend); a disabled sensor
  forgets what was inside without raising exits and raises enters on
  enable for what is inside then; a disabled `follower` keeps its path
  clock running, posts no poses, and snaps to its current point on
  enable; `marker`, `decor` and `nav` keep their record as it is.
- **Load order.** Every scene entity spawns in spawn-group order, each
  one's behaviors attaching right after it; then the systems' `ready` in
  spawn-group order and the behaviors' `ready` in registration order; then
  Play's `timeOffsetMs` seek (systems, behaviors, then timers, with
  `ctx.seeking` true); then the game's `onLoad`. Timers made in `ready`
  are sought with the rest; timers made in `onLoad` start at tick 0.
- **The tick order.** Each `step` runs: the type systems' `beforeStep`
  (spawn order); the game's `beforeStep` with the tick's actions and
  commands; the behaviors' `beforeStep`; the type systems' and then the
  behaviors' `beforePhysics`; the tick's forces handed to the bodies, the
  physics step, and the forces dropped; the type systems' `afterStep` (sensors raise
  their enters and exits here); contacts, for the pairs the game watches;
  each behavior's `step`; the timers that fall due; the **first dispatch**,
  delivering every event raised so far this tick to its subscribers; the
  game's `afterStep` with the tick's events; the **flush** of the tick's
  destroys; the **second dispatch**, delivering what `afterStep` and the
  flush raised. Then sprites re-pose and the view commits.
- **Spawning during a system's iteration.** A spawn is immediate, even
  inside a system's `afterStep` or an event handler: the new entity is in
  its system at once, so a `Map` iteration in progress may visit it (it is
  appended, so it always does or always doesn't: deterministic either
  way). A destroy inside a step waits for the flush, so a system iterating
  its entities while game code destroys them sees each one until the end
  of the tick. Outside a step (in `onLoad`, or from a host) both are
  immediate and raise no events.

Each hook a lantern's system and its game behavior see, logged in order:

```ts lantern-lifecycle.ts
import {
  createRegistry,
  defineBehavior,
  defineEntityType,
  defineGame,
  ENTITY_DESTROYED,
  ENTITY_DISABLED,
  ENTITY_SPAWNED,
  pointField,
  type BehaviorSystem,
  type SceneSystem,
} from "@jams/engine/game";
import { createHeadlessRuntime } from "@jams/engine/headless";
import { expandScene, type SceneDefinition } from "@jams/engine/scene";
import { z } from "zod";

/** Every hook a lantern's system and its `night/glow` block see, in the order they ran. */
export function lanternNight(): string[] {
  const log: string[] = [];

  const lantern = defineEntityType({
    type: "lantern",
    description: "A light on a post; its system keeps whether each one is lit.",
    fields: { at: pointField("Where the post stands.") },
    system: (): SceneSystem => {
      const lit = new Map<string, boolean>();
      return {
        spawn: (e) => void lit.set(e.id, true),
        despawn: (id) => void (lit.delete(id) && log.push(`despawn ${id}`)),
        clear: () => lit.clear(),
        size: () => lit.size,
        ready: (ids) => void log.push(`ready lantern ${ids.join(",")}`),
        // With `disable`, the entity keeps its state; without it the runtime
        // despawns it and spawns it again from its record on enable.
        disable: (id) => void (lit.set(id, false), log.push(`disable lantern ${id}`)),
        enable: (id) => void (lit.set(id, true), log.push(`enable lantern ${id}`)),
      };
    },
  });

  const glow = defineBehavior({
    name: "night/glow",
    description: "A halo round a lantern.",
    fields: { radius: z.number().positive().default(0.4).describe("Halo radius, m.") },
    system: (): BehaviorSystem => {
      const on = new Set<string>();
      return {
        attach: (id) => void (on.add(id), log.push(`attach glow ${id}`)),
        detach: (id) => void on.delete(id),
        clear: () => on.clear(),
        size: () => on.size,
        ready: (ids) => void log.push(`ready glow ${ids.join(",")}`),
        disable: (id) => void log.push(`disable glow ${id}`),
        enable: (id) => void log.push(`enable glow ${id}`),
      };
    },
  });

  const night = defineGame({
    id: "night",
    types: [lantern],
    behaviors: [glow],
    actions: [],
    commands: {
      light: { description: "Put up one more lantern." },
      douse: { description: "Put a lantern out.", args: z.strictObject({ id: z.string() }) },
      knock: { description: "Knock a lantern down.", args: z.strictObject({ id: z.string() }) },
    },
    createRuntime: (ctx) => ({
      onLoad() {
        log.push("onLoad");
        // Subscriptions end at unload, so every load subscribes again here.
        for (const type of [ENTITY_SPAWNED, ENTITY_DISABLED, ENTITY_DESTROYED])
          ctx.events.on(type, (e) => void log.push(`${e.type} ${e.entityId}`));
      },
      beforeStep(_dtMs, _actions, commands) {
        for (const c of commands) {
          const { id } = (c.args ?? {}) as { id?: string };
          if (c.name === "light")
            ctx.spawn({ type: "lantern", at: [0, 0], behaviors: { "night/glow": {} } });
          if (c.name === "douse" && id) ctx.setEnabled(id, false);
          if (c.name === "knock" && id) {
            ctx.destroy(id);
            // Inside a step a destroy waits for the end of the tick.
            log.push(`${id} exists after destroy: ${ctx.exists(id)}`);
          }
        }
      },
      snapshot: () => null,
    }),
  });

  const registry = createRegistry(night);
  const lane: SceneDefinition = {
    v: 4,
    game: "night",
    name: "lane",
    bounds: [0, 0, 2, 1],
    settings: { physics: "none" },
    entities: [
      { id: "west", type: "lantern", at: [0.2, 0.5], behaviors: { "night/glow": {} } },
      { id: "east", type: "lantern", at: [1.8, 0.5], behaviors: { "night/glow": { radius: 0.6 } } },
    ],
  };
  const rt = createHeadlessRuntime({ game: night, registry, scene: expandScene(lane, registry) });
  rt.step(rt.ctx.time.tickMs, [], [{ name: "light" }, { name: "douse", args: { id: "west" } }]);
  rt.step(rt.ctx.time.tickMs, [], [{ name: "knock", args: { id: "east" } }]);
  log.push(`east exists: ${rt.ctx.exists("east")}`);
  rt.ctx.setEnabled("west", true);
  rt.destroy();
  return log;
}
```

The log reads `attach glow west`, `attach glow east`, `ready lantern
west,east`, `ready glow west,east`, `onLoad`; in the first step the spawn
attaches and readies `lantern#1` at once, `douse` runs `disable glow west`
then `disable lantern west`, and the first dispatch delivers
`entity:spawned lantern#1` and `entity:disabled west`; in the second,
`east` still exists right after `ctx.destroy`, and the flush despawns it
and raises `entity:destroyed east`. The last `setEnabled`, outside a step,
runs `enable lantern west` then `enable glow west` and raises nothing.

### Spawning and prefabs at runtime

`ctx.spawn(input)` takes an entity as a scene file writes it (shape
tuples, `behaviors`, `z`, `layer`) with its `id` optional, and returns it
live: in its system, posed, its behaviors attached and `ready` run, and
inside a step an `entity:spawned` event raised. In dev and headless the
input is checked against the type's schema first. A spawn that throws
anywhere is undone and rethrown as an `EngineError` with a `code`:
`spawn-id-invalid`, `unknown-type`, `schema` or `physics-required`. A
spawn doesn't refresh Rapier's queries; its colliders join them at the
next physics step.

- **Runtime ids.** Omitted, the id is `<type>#<n>` from a counter per
  name, starting at 1, reset at each load and skipping ids already live
  (`runtimeId(name, n)`). A
  type and a prefab of one name share their counter. An explicit id must
  be `<name>#<label>` for that name (`RUNTIME_ID_PATTERN`) with a label
  that isn't all digits and isn't live, or the spawn throws
  `spawn-id-invalid`. `isRuntimeId(id)` (any id with a `#`, an instance's
  children included) and `parseRuntimeId` tell runtime ids from scene refs:
  no scene op names one, and `fuzz` never counts one as touched.
- **Spawn-only types.** A type with `spawnOnly: true` loads and spawns but
  can't be placed: the scene schema leaves it out, a file that names it is
  `unknown-type`, and `placeableTypes(registry)` lists the others. A
  game's actor is usually one, spawned in `onLoad` (as `<type>#1`).
- **Destroy.** `ctx.destroy(id)` takes an entity id or an instance id,
  whose live children go in reverse spawn order. At the flush each
  entity's behaviors detach (reverse registration order), the timers and
  subscriptions it owns end, its system despawns it, and `entity:destroyed`
  is raised at its last pose. A handler that destroys another entity
  during the flush has it flushed in the same pass.
- **Instantiate.** `ctx.instantiate(prefab, at, opts?)` places a prefab
  the way a load expands an instance (`expandInstance`, shared with
  `expandScene`): `rot`, `flip`, `z`, `layer`, `params` and `overrides` as
  an instance takes them, and `id` as a spawn does. The instance id is
  `<prefab>#<n>` and its children are `<id>/<child>`, refs between them
  remapped; each child raises its own `entity:spawned`. The prefabs it
  resolves are the run's library, read once per load: the shell passes
  its `setPrefabs` library, the editor's Play the project's, and headless
  entries `library` (every prefab the game may place; it defaults to
  `prefabs`, those the scene's instances name). The scene hash covers only
  the prefabs the scene's instances name, so a change to one that only
  `ctx.instantiate` places shows on replay as a digest mismatch, not as a
  changed input. A prefab it can't place
  throws `prefab-not-spawnable`, its `cause` the reason with its own code:
  `prefab-unknown`, `prefab-cycle`, `prefab-depth`, `physics-required` or
  `unknown-type`.

A game whose spouts let drops fall: `drop` is spawn-only, every drop
carries a `lifetime`, and a `pour` command places a prefab of two more
spouts:

```ts fountain-game.ts
import {
  defineEntityType,
  defineGame,
  ENTITY_DESTROYED,
  pointField,
  type EngineContext,
} from "@jams/engine/game";
import type { Prefab, SceneDefinition } from "@jams/engine/scene";
import { z } from "zod";

export const DRY = "fountain:dry";
/** Drops each spout lets fall before the fountain runs dry. */
export const DROPS = 8;

export type FountainSnapshot = {
  /** Drops destroyed so far: each `lifetime` ran out. */
  fell: number;
  live: number;
  /** The sum of every drop's sideways jitter, so a seed's draws show in the digest. */
  jitter: number;
  dry: boolean;
};

const spout = defineEntityType({
  type: "spout",
  description: "Where drops fall from.",
  base: "marker",
  fields: { at: pointField("The spout's mouth, absolute world metres.") },
});

const drop = defineEntityType({
  type: "drop",
  description: "A drop of water; game code spawns it, a scene can't place it.",
  base: "marker",
  spawnOnly: true,
  fields: { at: pointField("Where it is.") },
});

/** Every spout drips a drop each quarter second; each drop lasts a second; then the fountain runs dry. */
export const fountainGame = defineGame<FountainSnapshot>({
  id: "fountain",
  types: [spout, drop],
  actions: [],
  world: { physics: "none" },
  commands: {
    spill: {
      description: "Spill one drop under the first spout, with this id when given.",
      args: z.strictObject({ id: z.string().optional() }),
    },
    pour: {
      description: "Place a prefab of spouts above the basin.",
      args: z.strictObject({ prefab: z.string() }),
    },
  },
  play: {
    results: ["dry"],
    outcome: ({ snapshot }) => (snapshot.dry && snapshot.live === 0 ? { result: "dry" } : null),
  },
  createRuntime(ctx: EngineContext) {
    let snap: FountainSnapshot = { fell: 0, live: 0, jitter: 0, dry: false };
    // A fork per purpose: drawing more for one never shifts the other's numbers.
    let drift = ctx.random.fork("drift");

    const fall = (from: string, id?: string) => {
      const pose = ctx.poses.get(from);
      if (!pose) return;
      const dx = drift.range(-6, 6) / 100;
      snap.jitter += dx;
      ctx.spawn({
        type: "drop",
        ...(id ? { id } : {}),
        at: [pose.x + dx, pose.y + 0.08],
        behaviors: { lifetime: { ms: 1000 } },
      });
    };

    return {
      onLoad() {
        snap = { fell: 0, live: 0, jitter: 0, dry: false };
        drift = ctx.random.fork("drift");
        ctx.events.on(ENTITY_DESTROYED, (e) => {
          if ((e.data as { type?: string } | undefined)?.type === "drop") snap.fell++;
        });
        ctx.events.on(DRY, () => void (snap.dry = true));
        ctx.timers.every({ ms: 250 }, () => ctx.query.byType("spout").forEach((s) => fall(s)), {
          times: DROPS,
        });
        // The emit form: a plain event, so a snapshot of pending timers could save it.
        ctx.timers.after({ ms: 250 * DROPS + 1000 }, { emit: DRY, data: { drops: DROPS } });
      },
      beforeStep(_dtMs, _actions, commands) {
        for (const c of commands) {
          if (c.name === "spill") {
            const first = ctx.query.byType("spout")[0];
            if (first) fall(first, (c.args as { id?: string }).id);
          }
          if (c.name === "pour") {
            const { prefab } = c.args as { prefab: string };
            ctx.instantiate(prefab, [ctx.bounds[2] / 2, 0.16]);
          }
        }
      },
      snapshot: () => ({ ...snap, live: ctx.query.count({ type: "drop" }) }),
    };
  },
});

/** A basin with one spout over it. */
export const basin: SceneDefinition = {
  v: 4,
  game: "fountain",
  name: "basin",
  bounds: [0, 0, 1.6, 1.2],
  entities: [{ id: "spout", type: "spout", at: [0.8, 0.4] }],
};

/** Two spouts side by side, for `pour`. */
export const twinSpout: Prefab = {
  kind: "prefab",
  v: 4,
  game: "fountain",
  id: "twin-spout",
  entities: [
    { id: "left", type: "spout", at: [-0.24, 0] },
    { id: "right", type: "spout", at: [0.24, 0] },
  ],
};
```

A playtest of it, with a seed and the library `pour` places from, waits
on the engine's `exists` and `count` predicates (see
[Playtests and fuzz](#playtests-and-fuzz)), and an `EngineError` thrown
out of a step ends a run blocked at stage `run` with its code:

```ts fountain-playtest.ts
import { createRegistry, isRuntimeId } from "@jams/engine/game";
import {
  ENTITY_SPAWNED,
  replayRecording,
  runPlaytest,
  type InputScriptV2,
} from "@jams/engine/headless";
import { prefabLibrary } from "@jams/engine/scene";

import { basin, fountainGame, twinSpout, type FountainSnapshot } from "./fountain-game";

const registry = createRegistry(fountainGame);
// Every prefab `ctx.instantiate` may place; the scene's own instances need none.
const library = prefabLibrary([twinSpout]);

/** Pours a twin spout, waits for the drops to pile up, then for every one to be gone. */
const script = (seed: number): InputScriptV2 => ({
  v: 2,
  scene: "basin",
  seed,
  steps: [
    { command: "pour", args: { prefab: "twin-spout" } },
    { hold: [], until: { exists: "twin-spout#1/left", count: { type: "drop", min: 6 } }, max: 60 },
    { hold: [], until: { count: { type: "drop", max: 0 } }, max: 600 },
  ],
});

function play(seed: number) {
  const run = runPlaytest<FountainSnapshot>({
    game: fountainGame,
    registry,
    scene: basin,
    library,
    script: script(seed),
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.issues)}`);
  return run;
}

export function pourTwice() {
  const first = play(1);
  const again = play(1);
  const other = play(2);
  const replay = replayRecording({
    game: fountainGame,
    scene: basin,
    library,
    recording: first.recording,
  });
  const spawned = first.events.filter((e) => e.type === ENTITY_SPAWNED).map((e) => e.entityId!);
  return {
    result: first.outcome.result,
    final: first.final,
    steps: first.steps.map((s) => s.end),
    // The instance's children first, then the drops in spawn order.
    spawned: spawned.slice(0, 4),
    allRuntime: spawned.every(isRuntimeId),
    sameSeedSameRun: again.recording.end === first.recording.end,
    otherSeedJitter: other.final?.jitter,
    // A run given a seed records it, so the replay draws the same numbers.
    recordedSeed: first.recording.seed,
    replayed: !replay.blocked && replay.matches,
  };
}

/** The same id spilled twice: the second spawn throws, and the run ends blocked at stage `run`. */
export function spillTwice() {
  const run = runPlaytest({
    game: fountainGame,
    registry,
    scene: basin,
    script: {
      v: 2,
      steps: [
        { command: "spill", args: { id: "drop#first" } },
        { command: "spill", args: { id: "drop#first" } },
      ],
    },
  });
  return run.blocked ? { stage: run.stage, codes: run.issues.map((i) => i.code) } : null;
}
```

`pourTwice()` ends `dry` with 24 drops fallen; the first ids it spawns are
`twin-spout#1/left`, `twin-spout#1/right`, `drop#1`, `drop#2`; the same
seed gives the same end digest, another seed other jitter, and the
replay matches. `spillTwice()` is `{ stage: "run", codes:
["spawn-id-invalid"] }`. The scene CLI runs the same game:
`scripts/scene/README.md` §Lifecycle.

### Events

`ctx.events` subscribes to the run's step events: the engine's (sensors,
`entity:*`, `contact:*`), the game's own `ctx.emit`s and the timers'.
`on(type, handler, opts?)` returns the unsubscribe; `once` ends after the
first match. `opts.entity` keeps only events whose `entityId` or `other`
is that id (or a child of that instance id), and `opts.owner` ends the
subscription when that entity is destroyed.

- **Dispatch points.** Handlers run at the tick's two dispatch points (see
  the tick order), never at the `emit`: the first delivers everything
  raised since the tick began, the second everything the game's
  `afterStep` and the flush raised. Within a pass, events go in raise
  order and each to its subscribers in subscription order. A handler's own
  events are delivered in the same pass; a pass delivering more than 4096
  events throws `EngineError("event-loop")`, which is a handler raising
  events in a loop. It is a bug guard rather than an issue code: a
  playtest it stops is blocked at stage `run` with an issue carrying the
  code.
- **Subscribe in `onLoad`.** Every subscription, watch and timer ends at
  unload, so a game subscribes in `onLoad` (or later), and again on each
  load. Spawns at load and outside a step raise no events.
- **The six events.** `entity:spawned`, `entity:destroyed`,
  `entity:enabled` and `entity:disabled` (exported as `ENTITY_SPAWNED`
  and so on) carry the entity as `entityId`, its pose as `at` and its type
  as `data.type`; `contact:start` and `contact:end` (`CONTACT_START`,
  `CONTACT_END`) carry the watched side as `entityId` and the other as
  `other`. `StepEvent.data` is any plain JSON a game or timer attaches.
  Reports carry them all; a recording's markers skip `entity:*` unless
  `play.markers` names them.

The lantern and fountain examples above subscribe in `onLoad`.

### Timers

`ctx.timers` counts simulated ticks: a `Delay` is a tick count, or `{ ms
}` rounded to ticks once, when the timer is made, at the run's rate.
`after(delay, action)` runs once, `every(period, action, { times? })`
repeatedly, and `start(co)` a coroutine, a generator that yields a delay
to wait or a predicate to wait on (checked each tick). Each returns an id
for `cancel`; `size` is how many are pending.

- Due timers run at the tick's timer phase, ordered by due tick, then by
  creation. `after(0, …)` made before that phase runs in it, else in the
  next tick's.
- `{ owner }` ties a timer to an entity: cancelled when it is destroyed,
  paused (its remaining ticks kept) while it is disabled.
- **The emit form.** An action is a function or `{ emit, entityId?, data?
}`, an event the timer raises. Only the emit form is plain data, so it
  is the one to use for anything a snapshot of the game must be able to
  save and restore; the fountain's `fountain:dry` is one.
- **Seek.** Play's `timeOffsetMs` advances the timer clock by whole ticks
  before tick 0, firing what falls due in order with `ctx.seeking` true.
- A turns or event game's timers don't run while its clock idles; a game
  whose timers must run then keeps `busy()` true. `@elapsed` catch-up
  doesn't advance them either.

### Randomness

`ctx.random` is a seeded `Rng` (`./sim-kit`: `below`, `range`, `chance`,
`weighted`), for game code to use instead of `Math.random`. It is seeded
at each load from `PlayOptions.seed` (an input script's `seed`, the
`play` options of `fuzz`, the shell's `play(doc, opts)`), or without one
from `defaultSeed(gameId, sceneName)` (`./headless`), so
a run that names no seed still draws the same numbers every time. A run
records its seed as its recording's `seed`, and a replay
draws the same. `fork(label)` gives each purpose its own stream, so
drawing more for one never shifts another's numbers, as the fountain's
`drift` does. No engine system, primitive or behavior draws from it (a
boundary test holds `systems/` and `runtime/behaviors/` to that), so a
game's draws are the only ones.

### Queries

`ctx.query` answers from the pose index and each entity's shape, never
from Rapier or the geometry world, so it gives the same answers on both
backends. Results are in spawn order (load order, then spawns appended),
and only enabled entities count unless a selector says `enabled: false`.

- `select(sel?)`, `byType(type)`, `byTag(tag)` and `count(sel?)`: an
  `EntitySelector` is `{ type?, tag?, enabled? }`, `type` one name or a
  list, `tag` a value of the entity's tags fields.
- `inArea(area, sel?)` (an `Aabb` or a shape), `at(point, sel?)` and
  `nearest(point, { maxDist?, …sel })` (by extent; ties go to the earlier
  spawn) read a spatial hash of extents, refreshed only for entities whose
  pose changed since the last area query.
- `extent(id)`: the entity's shape moved and turned by its pose's change
  since it spawned, or a point at its pose when it has no shape.

`PlayState.world` (`exists`, `count`) is the same answers for a game's
`outcome` hook and the script predicates.

### Contacts

`ctx.contacts.watch(a, b?)` raises `contact:start` and `contact:end`
between entities matching `a` and `b`, each an id or `{ type?, tag? }`;
without `b`, anything that isn't a sensor. It returns the unwatch. After
the sensors' `afterStep`, for each watch in watch order and each enabled
match in spawn order, a broad phase of every non-sensor collider's world
bounds (refreshed each tick for the colliders that moved, so a collider a
system builds in code counts by where it is, not by the entity's scene
shape) finds the candidates, and each pair is tested exactly: Rapier's
`contactCollider` (touching at distance 0 or less) or the geometry
backend's `shapesIntersect`. A pair reports once per tick, `at` the
contact point. An entity destroyed or disabled mid-contact ends its
contacts without a `contact:end` (its own event says why). Nothing is
queried while nothing is watched.

### `lifetime` and pools

`lifetime` is an engine behavior: `{ "lifetime": { "ticks": 30 } }` (or
`"ms"`, exactly one of them) destroys its entity that long after it
spawns or is enabled, or with `"then": "disable"` disables it. It works
on any type, placed or spawned: the kitchen sink's `spark` is a `decor`
that fades after 30 ticks. A world save holds each lifetime's ticks left,
so a restored entity goes on the same tick.

`createPool(ctx, { spawn, max? })` (`./game`) reuses disabled entities
before spawning new ones: `acquire()` enables the most recently freed one,
or calls `spawn` (which returns a live id) while `max` allows, or returns
null; `release(id)` disables one and frees it. An entity disabled any
other way is free again too, so a `lifetime` with `then: "disable"` hands
an entity back with no game code; a destroyed one leaves the pool. Make a
pool in `onLoad`: it belongs to that load, its subscriptions end with it,
and after the next load `acquire` and `release` throw `pool-stale`.

A shuttle runs between two buffers: contacts with the walls light sparks
from a pool of two, which their `lifetime` hands back, and queries read
the yard, on either backend:

```ts shuttle-contacts.ts
import {
  CONTACT_END,
  CONTACT_START,
  createPool,
  defineEntityType,
  defineGame,
  pointField,
  type EngineContext,
  type Pool,
} from "@jams/engine/game";
import { runPlaytest, type RapierModule } from "@jams/engine/headless";
import type { SceneDefinition } from "@jams/engine/scene";

export type ShuttleSnapshot = {
  /** Every contact start and end so far: `start west`, `end west`, … */
  bumps: string[];
  /** Sparks ever spawned; the pool hands disabled ones out again first. */
  sparks: number;
  /** Bumps that found both sparks still lit, so the pool's `max` gave none. */
  refused: number;
  /** Sparks lit right now, and the wall nearest the shuttle. */
  lit: number;
  nearest: string | undefined;
  /** Entities whose extent reaches into the yard's west half. */
  west: readonly string[];
};

const spark = defineEntityType({
  type: "spark",
  description: "A flash where the shuttle hits a buffer.",
  base: "marker",
  spawnOnly: true,
  fields: { at: pointField("Where it flashes.") },
});

/** A shuttle runs between two buffers; each bump lights a spark from a pool of two. */
export const shuttleGame = defineGame<ShuttleSnapshot>({
  id: "shuttle",
  types: [spark],
  actions: [],
  world: { gravity: [0, 0] },
  createRuntime(ctx: EngineContext) {
    let bumps: string[] = [];
    let sparks = 0;
    let refused = 0;
    let pool: Pool | null = null;
    return {
      onLoad() {
        bumps = [];
        sparks = 0;
        refused = 0;
        // Watches, subscriptions and pools all end with the load: make them here.
        ctx.contacts.watch("shuttle", { type: "solid" });
        pool = createPool(ctx, {
          max: 2,
          spawn: () => {
            sparks++;
            const e = ctx.spawn({
              type: "spark",
              at: [0, 0],
              // `then: "disable"` hands the spark back to the pool when it runs out.
              behaviors: { lifetime: { ticks: 100, then: "disable" } },
            });
            return e.id;
          },
        });
        ctx.events.on(CONTACT_START, (e) => {
          bumps.push(`start ${e.other}`);
          const id = pool?.acquire();
          if (id) ctx.poses.set(id, e.at.x, e.at.y, 0, { snap: true });
          else refused++;
        });
        ctx.events.on(CONTACT_END, (e) => void bumps.push(`end ${e.other}`));
      },
      onUnload() {
        pool = null;
      },
      snapshot() {
        const at = ctx.poses.get("shuttle");
        return {
          bumps: [...bumps],
          sparks,
          refused,
          lit: ctx.query.count({ type: "spark" }),
          nearest: at ? ctx.query.nearest({ x: at.x, y: at.y }, { type: "solid" }) : undefined,
          west: ctx.query.inArea({ minX: 0, minY: 0, maxX: 1, maxY: 1 }),
        };
      },
    };
  },
});

const yard = (physics: "rapier" | "none"): SceneDefinition => ({
  v: 4,
  game: "shuttle",
  name: "yard",
  bounds: [0, 0, 2, 1],
  settings: { physics },
  entities: [
    { id: "west", type: "solid", shape: ["box", 0.07, 0.5, 0.07, 0.3] },
    { id: "east", type: "solid", shape: ["box", 1.93, 0.5, 0.07, 0.3] },
    {
      id: "shuttle",
      type: "follower",
      shape: ["circle", 0, 0, 0.08],
      // Each end runs 6 cm into a buffer, so the shuttle touches it there.
      path: {
        pts: [
          [0.16, 0.5],
          [1.84, 0.5],
        ],
        mode: "ping_pong",
        speed: 2.4,
      },
    },
  ],
});

/** Five seconds of shuttling, with Rapier or on the engine's own geometry. */
export function shuttle(rapier: RapierModule | null) {
  const run = runPlaytest<ShuttleSnapshot>({
    rapier,
    game: shuttleGame,
    scene: yard(rapier ? "rapier" : "none"),
    script: { v: 2, steps: [{ wait: 300 }] },
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.issues)}`);
  return run.final!;
}
```

Both backends give the same sixteen bumps in five seconds (`start west`,
`end west`, `start east`, …), two sparks spawned, two bumps refused
while both were lit, and the same `nearest` and `west`.

## Genre probes

The engine proves it isn't a platformer engine with small games built in
tests from the primitives and the APIs above, under
`packages/engine/__tests__/genres/`. Each probe is a game, a scene built in
code, an input script and the result it must reach:

| Probe             | Genres                                    | Physics | Time  | What it plays                                                                                                                |
| ----------------- | ----------------------------------------- | ------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| `grid-puzzle`     | puzzle, card and board games              | none    | event | a square-grid Sokoban: arrow keys step a pusher; won with both crates on goals                                               |
| `top-down`        | top-down, racing                          | rapier  | fixed | a top-down controller steers through a corridor of solids into a goal sensor                                                 |
| `turn-tactics`    | tactics, roguelikes                       | none    | turns | hex grid, `move` and `end-turn` commands; A\* moves a unit, field of view finds a target                                     |
| `shooter`         | twin-stick, endless runner, tower defense | rapier  | fixed | a turret spawns a thousand bullets with a `lifetime`; each is destroyed on its first wall contact                            |
| `roguelike`       | roguelikes                                | none    | turns | `ctx.random` places rooms by `ctx.instantiate` of two prefabs; field of view and A\* find the stairs                         |
| `local-versus`    | local multiplayer, fighting               | none    | fixed | two seats on vector sticks, one on the keyboard and one on a pad, in a two-track script; the first knock-out wins            |
| `point-and-click` | point-and-click, RTS                      | none    | fixed | a press on a walk area paths the walker along `ctx.nav`; a press on a hotspot (`ctx.space.pointAt`) walks there and fires it |
| `rhythm-tap`      | rhythm                                    | none    | fixed | sub-tick offsets on: taps between ticks are graded by their `offset`, and a replay grades them the same                      |
| `tower-defense`   | tower defense                             | none    | fixed | waves from a data table spawn creeps along a flow field; legal `build` commands place towers firing `lifetime` bolts         |

`runGenreProbe` plays each, replays its recording, and compares a digest of
the run with a pinned one, so CI on other machines checks the same numbers.
Probes also run under variants (gravity zero, gravity sideways, physics
none, another seed) that must reach the same result; `shooter`'s replay
also proves both runs name the same thousand ids, `roguelike` pins one
layout for each of seeds 1 and 2, and some of `tower-defense`'s 32 fuzz
rollouts at seed 1 must win through its legal commands. A physics-free probe never loads
Rapier: the harness hands it none and a mock fails if the wasm module ever
initialises. A sweep test fails on side-view literals in engine source, and
a matrix maps every genre row of the engine's roadmap to the probes that
cover it.

## A second game

[`src/games/tactics/`](../../src/games/tactics/) is the reference for a game that isn't a platformer:
a turn-based skirmish on a 12 × 8 square grid with no physics, built on
the public entries only (`@jams/engine`, `./game`, `./sim-kit`; the
boundary test fails on anything else). The player's blue side moves each
unit once a turn, then attacks or waits; `end-turn` hands over to the red
side, which the game plays on ticks. Read it section by section, each
linking its sources:

- **The project** ([`jams.project.json`](../../src/games/tactics/jams.project.json)): the game module
  (`./index.ts`, `tacticsGame`), the UI module (`./ui/index.ts`,
  `mountTacticsHud`) and the asset and code globs. The site finds it by
  this file (`/game/dev?game=tactics`, and `/game/dev?edit=1&project=tactics`
  for the editor); no table names it.
- **The definition** ([`index.ts`](../../src/games/tactics/index.ts)): `world: { physics: "none", gravity:
[0, 0], grid, gridWalls: ["solid"], lengthUnit: 48 }`, so a cell is
  `[1, 1]` m drawn at 48 px; `time: { kind: "turns", rate: 60 }`; the
  `unit` and `rough` types, with `spawnOrder: ["rough", "unit"]` (the
  primitives, walls among them, spawn first); the actions, every one
  `ui: true`; the commands; the `unit-class` data table; two project
  settings (`aiStepTicks`, `critChance`); and a pixel-art resolution
  policy (576 × 384 virtual px, letterbox, integer scale, nearest
  sampling, `pixelSnap`).
- **Types and data** ([`types.ts`](../../src/games/tactics/types.ts),
  [`data/unit-classes.json`](../../src/games/tactics/data/unit-classes.json),
  [`game-settings.json`](../../src/games/tactics/game-settings.json)): a `unit` is an `occupant` on the grid with a
  `side` and a `class`; a `rough` area adds an integer cost to the cells
  under it. The knight, archer and scout rows (`hp`, `attack`, `move`,
  `range`, `sight`) live in a data table that co-edits like any doc.
- **Rules** ([`rules.ts`](../../src/games/tactics/rules.ts), pure): a unit's reach is a `flowField` from its
  cell with `maxCost: move × 10`, rough cells costing more; attack range
  is grid distance; a class with `sight` needs `lineOfSight` with walls
  opaque; damage doubles on a crit, `rng.next() < critChance`. `legal`
  lists every legal order in a stable order.
- **The computer side** ([`ai.ts`](../../src/games/tactics/ai.ts), pure over a snapshot and an `Rng`): each
  red unit, in id order, attacks the weakest blue unit in reach, else walks
  toward the nearest along `findPath`; ties go by cell order, then the
  generator.
- **The runtime** ([`runtime.ts`](../../src/games/tactics/runtime.ts)): `beforeStep` parses each command and
  applies it through the rules, refusing an illegal one with a
  `tactics:refused` event; a unit walks one cell per 8 ticks through a
  grid stepper, and the red side gives one unit's orders every
  `aiStepTicks`, so `busy()` is true only while either goes on. Its
  snapshot holds the board and the class table, so `play.commands` lists
  orders from the snapshot alone, and `storeSlice` returns the same object
  until something changed.
- **Play** ([`play.ts`](../../src/games/tactics/play.ts)): results `won` and `lost` from `outcome`, the blue
  side's legal orders as `commands` (red's turn is the game's own, so fuzz
  and `step --legal` only ever play blue), and `turn` and `side`
  predicates for scripts and checks.
- **Content**: [`scenes/level-1.json`](../../src/games/tactics/scenes/level-1.json) (walls as `solid`, two `rough`
  areas, three blue and two red units placed from the `knight` and
  `archer` prefabs, whose `side` param sets the team), its checks (`valid`
  and a `connected` check between the sides) and `level-1.script.json`, a
  commands-only script that wins. [`art/make-art.ts`](../../src/games/tactics/art/make-art.ts) generates the unit
  sheet (an Aseprite atlas) and the tiles as PNGs with stored zlib blocks,
  so rerunning it reproduces every byte; each carries a `CC0-1.0` sidecar.
  [`input-map.json`](../../src/games/tactics/input-map.json) binds arrows and WASD, Enter and Space, Escape, `E`,
  the pad's d-pad, stick, south, east and start, and the primary pointer
  button.
- **The HUD** ([`ui/`](../../src/games/tactics/ui/), framework-free): [`hud.ts`](../../src/games/tactics/ui/hud.ts) builds the turn banner
  (`role="status"`, `aria-live`), the selected unit's card, an order menu
  of real, labelled buttons (Move, Attack, Wait, End turn) and a log line;
  [`cursor.ts`](../../src/games/tactics/ui/cursor.ts) is the cursor as a pure state machine (idle → unit selected
  → target chosen → command sent), fed by `onAction` (the cursor vector,
  confirm, cancel, end turn, next unit) and by canvas clicks through
  `clientToWorld` and `cellAt`; [`cells.ts`](../../src/games/tactics/ui/cells.ts) keeps one element per
  highlighted cell (reach, attack range, target, fog, each with
  `data-cell="c,r"`) over its cell with `bindToWorld` and `watchView`,
  pulsing unless `reducedMotion`. Reach and fog come from the slice through
  the pure grid toolkit (`flowField`, `fieldOfView`); the HUD sends only
  commands.
- **Flow** ([`scene-list.json`](../../src/games/tactics/scene-list.json),
  [`runtime.ts`](../../src/games/tactics/runtime.ts), [`ui/menu.ts`](../../src/games/tactics/ui/menu.ts)): the list starts at
  `menu` (Start, Continue and the store's `describe` line), then `level-1`
  and `level-2`, whose end (won or lost) requests `result` with the
  progress in `persist` (`cleared`, `roster` and how the level ended) and
  a 400 ms fade, and `result` goes back to the menu. Level 2's stair
  attaches the `cellar` sublevel. See [Scene flow](#scene-flow) and
  [Sublevels](#sublevels).
- **Saves** ([`index.ts`](../../src/games/tactics/index.ts), [`runtime.ts`](../../src/games/tactics/runtime.ts),
  [`ui/hud.ts`](../../src/games/tactics/ui/hud.ts), [`ui/menu.ts`](../../src/games/tactics/ui/menu.ts)): the game
  declares `saves: { version: 1 }` and `restore`; it autosaves its world to
  `auto` through `ctx.saves.request` as each blue turn starts, the HUD's
  Save writes `slot-1` between turns, and the menu's Continue loads the
  newest. See [Saves](#saves).
- **Export** ([`jams.project.json`](../../src/games/tactics/jams.project.json)'s `export`
  block, [`art/make-art.ts`](../../src/games/tactics/art/make-art.ts), [`ui/menu.ts`](../../src/games/tactics/ui/menu.ts)):
  the installed app's short name, theme and background colours, and its
  192 and 512 px icons, which `make-art.ts` draws byte for byte like the
  rest of the art and `vp run scene assets import` brought in with their
  `CC0-1.0` sidecars. `vp run scene game build tactics` writes a
  physics-free web build with no wasm, and `vp run scene game export
tactics --zip` the itch.io zip. In a build, the standalone host gives the
  UI `links.credits` (`UiContext.links`), and the menu shows a Credits link
  to the build's `credits.html`; the site's game room has no such page, so
  the link isn't there.
- **Tests** (`__tests__/`): the scene validates and its checks pass with no
  Rapier; the rules and the AI; the HUD by keyboard, pad and pointer under
  jsdom; the art regenerates byte for byte; the script wins, and its
  recording replays to one digest pinned for every platform (physics-free
  runs replay identically on every runner and in the browser smoke); and
  64 fuzz rollouts with seed 7 reach `won` through the legal list.

Run it headless with `vp run scene playtest level-1 --project tactics --script src/games/tactics/scenes/level-1.script.json`.
What the game needed and the engine lacked went into the engine as
extension points rather than into the game: UI-only actions and
`onAction`, legal commands, `worldToClient` and the UI seam, the site's
discovery by project file, `createDataSystem`, the grid toolkit's
`sameCell`, `inCellBounds` and `boundsCells`, and a `spawnOrder` that
names only the game's own types. `vp run scene game new <id> --preset
turns` starts a game of the same shape.

## Scene flow

A game of more than one scene names them in the project's scene list,
`scene-list.json` at the project's root (kind `scene-list`, at most one per
project): the start, and every scene flow may load, in order, each with an
optional title. A scene that only ever attaches beside another is listed
with `sublevel: true` (see [Sublevels](#sublevels)). The second game's:

```json
{
  "$schema": "../../../packages/engine/project/scene-list.schema.json",
  "kind": "scene-list",
  "v": 1,
  "start": "menu",
  "scenes": [
    { "scene": "menu", "title": "Title" },
    { "scene": "level-1", "title": "Ford" },
    { "scene": "level-2", "title": "Bridge" },
    { "scene": "result" },
    { "scene": "cellar", "sublevel": true }
  ]
}
```

The list is a doc like a scene: it co-edits per entry, so two people adding
different scenes and a third reordering converge with no lost entry, and
renaming or re-iding a listed scene rewrites its entry. It validates with
`start-scene-missing` (error) when `start` is null, names no scene, or names
one that isn't listed or is a sublevel; `asset-missing` for an entry naming
no scene; `dup-id` for a scene listed twice; and `scene-unlisted` (warn)
when a listed scene's `connected` or `reaches` checks, or a sublevel attach
in an input script, name a scene the list doesn't hold. One rule judges
every path: `flowIssue(list, id, use)` from `./game` says whether a scene may
`"start"`, be gone to (`"go"`) or be `"attach"`ed, and the kind, the
runtime, headless runs and the scene CLI all call it. A project without a
list plays nothing through flow: `game.flow.start` is null and
`game.flow.restart()` is `start-scene-missing`. `vp run scene flow` prints
the list, the start, each scene's physics and bundle bytes and any unlisted
references (see the scene CLI's README).

Game code changes scene by asking. `ctx.flow.request({ to, entry?,
transition?, persist? })` is applied by the host after the tick ends, after
its destroy flush, so a run of several scenes is as deterministic as a
command stream; the first request since the host last took them wins, and
later ones are dropped with a dev warning. `ctx.flow.scene` is the main
scene's id (null for a scene loaded without a scene list, as in bare
tests) and `ctx.flow.entry` the entry the request named, which the next
scene's `onLoad` reads to place the player. `persist` replaces the
[persistent state](#persistent-state) before the next load. A tick whose
`play.outcome` returns a verdict ends the run even with a request pending,
so a game that chains scenes returns null while it requests.

A host passes `GameConfig.flow`:

- **`source`**, a `SceneSource`: `list()`, `start()` and `scene(id)`, which
  returns `{ def, prefabs }` synchronously, because every listed scene's
  text is resident (sublevels attach inside a step). The site bundles each
  hosted game's list and listed scenes by glob and calls
  `game.flow.restart()` once the game starts; no scene id is written in
  its code, and `?scene=<id>` overrides the start for the editor only.
- **`transition`**, a `TransitionRunner(phase, spec, layer)` that runs the
  `out` and `in` halves of a `TransitionSpec` (`{ kind, ms?, color? }`).
  The default is `fadeTransition()` for `"fade"` (400 ms in all unless the
  spec says) and nothing for `"none"`. Transitions draw into a layer above
  the [UI layer](#the-ui-seam), so a fade covers the HUD too; they never
  touch the simulation, and under reduced motion a fade is a cut.
- **`loading`**, a factory for the view shown when a load takes longer than
  150 ms: default `createLoadingOverlay({ label? })`, a centred label and
  progress bar; `false` shows none.

`game.flow` has the list's `start` and `scenes`, `current()`, `go(to,
opts?)` and `restart()`, which loads the start with persist reset to the
game's initial value; both resolve a `FlowResult`, `{ ok: true, scene,
report }` or `{ ok: false, issue }` (`scene-unlisted` for a scene that isn't
a main scene of the list, `start-scene-missing`, a load's refusal). A change
runs in this order: the tick that asked ends (or `go` is called between
ticks); the loop stops ticking while rendering goes on; the transition's
`out` half; `onUnload`, with every sublevel detached; `source.scene(to)`
and its preload (`flow:loading` reports progress, the loading view shows
after 150 ms); the load, with persist applied and `ctx.flow.entry` set; the
`in` half; ticking resumes and `flow:change` fires with `{ from, to, entry
}`. A `go` during a change waits for it.

The editor's Play stays on one scene, so editing never jumps scenes under
the author: a request during Play ends the session with the outcome `{
result: "flow", to }`, and the play bar says "Requested level-2". `flow` is
an engine run result, so a game can't declare one by that name. The
editor's toolbar has a scene picker: the listed scenes first, in list order
with their titles and sublevels tagged, then the rest by path, the open one
checked. Picking one opens it and keeps `?scene=<id>` in the route; "New
scene…" names a scene, creates it from the game's template and, with "Add
to scene list" ticked, lists it in the same batch, so one undo removes both.

Headless, `runPlaytest`, `createHeadlessRuntime` and `replayRecording` take
the listed scenes as `flow: SceneLibrary` (`{ list, scenes }`, the scene
list's entries and a map from id to `{ def, prefabs }`). With it a request
is applied after the tick, with no transition and no wall time, and the
script carries on in the next scene; without it a request ends the run as
`{ result: "flow", to }`. A playtest's `segments` holds one entry per scene
visited, `{ scene, ticks, recording, end }`, and `recording` stays the
first segment's. Each segment's recording replays alone: its `start` holds
the persistent value (and the entry) it began with, its `next` the request
that ended it, and a replay applies the first and stops at the second
without following it. Scripts gain two engine predicates: `until: { scene:
"<id>" }` holds once the main scene is that scene, and `until: { persist: {
pointer, eq | gte | lte } }` reads the persistent value by JSON Pointer.

```ts scene-flow.ts
import {
  createGame,
  createLoadingOverlay,
  fadeTransition,
  type GameInstance,
  type SceneSource,
} from "@jams/engine";
import {
  defineGame,
  type EngineContext,
  type SceneLibrary,
  type TransitionSpec,
} from "@jams/engine/game";
import { replayRecording, runPlaytest } from "@jams/engine/headless";
import type { EntityDef, Pt, SceneDefinition } from "@jams/engine/scene";
import { z } from "zod";

type Post = { letters: number };

export type CourierSnapshot = {
  scene: string | null;
  entry: string | null;
  arrivedAt: Pt | null;
  /** What the cellar's attach spawned (`cellar:<id>`), and the sublevels attached now. */
  attached: string[];
  sublevels: string[];
  letters: number;
};

const FADE: TransitionSpec = { kind: "fade", ms: 400 };

/**
 * A courier walks scenes: `start` leaves the title for the harbour, which
 * attaches its cellar beside it; two `deliver`s close the cellar and end
 * the round, and the ending goes back to the title on its own.
 */
export const courierGame = defineGame<CourierSnapshot>({
  id: "courier",
  types: [],
  actions: [],
  world: { physics: "none" },
  persist: {
    initial: () => ({ letters: 0 }),
    schema: z.strictObject({ letters: z.number().int().min(0) }),
  },
  commands: {
    start: { description: "Leaves the title for the harbour, arriving at the pier." },
    deliver: { description: "Delivers a letter; the second ends the round." },
  },
  createRuntime(ctx: EngineContext) {
    let arrivedAt: Pt | null = null;
    let attached: string[] = [];
    let ticks = 0;
    const letters = () => (ctx.persist.value as Post).letters;
    return {
      onLoad(scene) {
        ticks = 0;
        attached = [];
        const entry = scene.entities.find((e) => e.id === ctx.flow.entry);
        arrivedAt = (entry?.at as Pt | undefined) ?? null;
        if (ctx.flow.scene === "harbour") {
          const cellar = ctx.flow.attach("cellar", { label: "cellar", at: [4, 0] });
          if (!cellar.ok) throw new Error(cellar.issue.message);
          attached = [...cellar.entities];
        }
      },
      beforeStep(_dtMs, _actions, commands) {
        for (const command of commands) {
          if (command.name === "start") {
            ctx.flow.request({ to: "harbour", entry: "pier", transition: FADE });
          }
          if (command.name === "deliver") {
            ctx.persist.set({ letters: letters() + 1 });
            if (letters() === 2) {
              ctx.flow.detach("cellar");
              ctx.flow.request({ to: "ending", transition: FADE });
            }
          }
        }
      },
      afterStep() {
        ticks++;
        if (ctx.flow.scene === "ending" && ticks === 3) {
          ctx.flow.request({ to: "title", persist: { letters: 0 } });
        }
      },
      snapshot: () => ({
        scene: ctx.flow.scene,
        entry: ctx.flow.entry,
        arrivedAt,
        attached,
        sublevels: ctx.flow.sublevels().map((s) => s.label),
        letters: letters(),
      }),
    };
  },
});

const scene = (name: string, entities: EntityDef[]): SceneDefinition => ({
  v: 4,
  game: "courier",
  name,
  bounds: [0, 0, 6.4, 3.2],
  entities,
});

/** The scene list and every listed scene, resident: what a host's `SceneSource` serves. */
export const courierScenes: SceneLibrary = {
  list: [
    { scene: "title", title: "Title" },
    { scene: "harbour", title: "Harbour" },
    { scene: "ending" },
    { scene: "cellar", sublevel: true },
  ],
  scenes: new Map(
    Object.entries({
      title: scene("title", [{ id: "sign", type: "marker", at: [3.2, 1.6] }]),
      harbour: scene("harbour", [
        { id: "pier", type: "marker", at: [0.5, 2.5] },
        { id: "post-office", type: "marker", at: [3, 2.5] },
      ]),
      ending: scene("ending", [{ id: "sunset", type: "marker", at: [3.2, 0.5] }]),
      cellar: scene("cellar", [
        { id: "barrel", type: "marker", at: [0.5, 0.5] },
        { id: "ladder", type: "marker", at: [1.5, 0.5] },
      ]),
    }).map(([id, def]) => [id, { def, prefabs: new Map() }]),
  ),
};

/** One script across every scene: title → harbour → ending → title, each scene its own segment. */
export function deliveryRound() {
  const title = courierScenes.scenes.get("title")!.def;
  const run = runPlaytest<CourierSnapshot>({
    game: courierGame,
    scene: title,
    flow: courierScenes,
    script: {
      v: 1,
      steps: [
        { command: "start" },
        { command: "deliver" },
        { hold: [], until: { persist: { pointer: "/letters", eq: 1 } }, max: 5 },
        { wait: 5 },
        { command: "deliver" },
        { hold: [], until: { scene: "title" }, max: 30 },
      ],
    },
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.issues)}`);
  const segments = run.segments ?? [];
  // Each segment's recording replays alone and stops at its `next` without following it.
  const replays = segments.map((s) =>
    replayRecording<CourierSnapshot>({
      game: courierGame,
      scene: courierScenes.scenes.get(s.scene)!.def,
      recording: s.recording,
      flow: courierScenes,
    }),
  );
  return {
    visited: segments.map((s) => s.scene),
    ends: segments.map((s) => s.end),
    persistAtStart: segments.map((s) => s.recording.start?.persist),
    sceneEnds: replays.map((r) => (r.blocked ? null : r.final)),
    replayed: replays.every((r) => !r.blocked && r.matches),
    final: run.final,
  };
}

/** A host's scenes: here a map, on the site the project's files bundled by glob. */
export function courierSource(library: SceneLibrary = courierScenes): SceneSource {
  return {
    list: () => library.list,
    start: () => "title",
    scene: (id) => library.scenes.get(id) ?? null,
  };
}

/** Plays from the list's start, with a dark fade and a loading line on a slow load. */
export async function playCourier(canvas: HTMLCanvasElement): Promise<GameInstance> {
  const game = await createGame(canvas, {
    game: courierGame,
    displayWidth: canvas.clientWidth,
    displayHeight: canvas.clientHeight,
    flow: {
      source: courierSource(),
      transition: fadeTransition({ color: 0x10141c }),
      loading: createLoadingOverlay({ label: "Sorting the post…" }),
    },
  });
  game.on("flow:change", ({ from, to, entry }) => {
    console.log(`${from ?? "start"} → ${to}${entry ? ` at ${entry}` : ""}`);
  });
  game.start();
  const started = await game.flow.restart();
  if (!started.ok) throw new Error(`${started.issue.code}: ${started.issue.message}`);
  return game;
}
```

`deliveryRound()` visits title, harbour, ending and title again on one
script; the harbour's recording starts with `{ letters: 0 }` and ends with
`next: { scene: "ending" }`, and every segment replays to its own digest.

## Persistent state

A game that remembers things between scenes (levels cleared, a roster, a
key picked up) declares `GameDefinition.persist: { initial, schema? }`.
`ctx.persist.value` is one plain JSON value, deep-frozen and the same object
until `ctx.persist.set(next)` replaces it, at once. In dev and headless
every value set is checked as plain JSON and against `schema`. A save's
load checks its value the same way everywhere, production included, and
refuses one that fails as a `schema` issue at `/persist`, keeping the scene
that was playing. A game that declares none reads null.

- **One value per game instance**, and per headless session: it survives
  every `loadScene`, flow change, sublevel attach and Play-from-here. It is
  reset to `initial()` by `game.flow.restart()`, replaced by a flow
  request's `persist` before the next load, and set to the saved value when
  a save loads. A save holding a persistent value for a game that declares
  none is refused (`schema` at `/persist`).
- **Not in any digest by itself.** A game whose run branches on it puts
  what matters in `snapshot()`. Recordings carry it at their start
  (`start.persist`), and a replay sets it before the load, in the browser
  (`GameInstance.replay`) as headlessly.
- **Headless:** `PlayState.persist` reaches `play.outcome` and the game's
  predicates, `until: { persist: … }` waits on it, and runtimes that should
  share one value take the same cell from `createPersistCell(initial,
opts?)` or `gamePersistCell(game, check)` (`./headless`) as their
  `persist` option.

## Sublevels

A sublevel is a listed scene loaded beside the main one, inside a step:
a cellar under a board, a room behind a door. `ctx.flow.attach(scene, {
label, at?, z? })` takes the scene from the runtime's scene list, frozen at
each load as the prefabs are, expands it, moves every entity by `at`
(metres; default `[0, 0]`), adds `z` to every entity's z, and spawns them
as `add` does, now: `ready` runs and each raises one `entity:spawned`. Scene
entities get the label as a prefix, `<label>:<id>` (`sublevelId`,
`parseSublevelId`, `SUBLEVEL_ID_PATTERN` from `./game`); runtime spawns keep
`<name>#<n>` from the runtime's counters, which a main-scene load resets and
attach and detach never touch. The result is `{ ok: true, entities }` or `{
ok: false, issue }` with `sublevel-invalid` and a `detail.reason`:

- `"unlisted"`: the scene isn't in the scene list;
- `"physics"`: it resolves to other physics than the main scene;
- `"grid"`: its grid has another shape or cell size, or `at` isn't on a
  cell boundary, judged in whole px against the metric cell;
- `"label"`: the label is taken or isn't an id word;
- `"settings"`: its gravity differs.

A sublevel has no `onLoad` of its own; the game reacts to its
`entity:spawned` events or to the attach's result. Queries, contacts and
sensors see its entities like any other, and the grid gains its walls.
`ctx.spawn({ …, sublevel: label })` ties a runtime spawn to it.
`ctx.flow.detach(label)` queues every `<label>:*` entity and every spawn
tied to it for the tick's destroy flush, then removes its grid walls;
`ctx.flow.sublevels()` lists those attached as `{ label, scene, at }`, and a
main-scene change detaches them all. Their art loads through the loader
like any scene's (placeholders until it arrives); a host calls
`game.preload` for the sublevels it expects. The courier above attaches its
cellar in the harbour's `onLoad` and detaches it with the last letter; the
second game attaches `cellar` when a unit steps on level 2's stair cell.

## Saves

**Where saves live, and how big they can be.** A game's saves go to the
first store that applies: the game's own (`saves.store`), then the
host's (`GameConfig.saves`, which jams.team sets), then the player's
browser (IndexedDB, else `localStorage`, else memory).

**Bring your own save backend for anything beyond small saves.** It is
the recommended path: you choose the size, the retention and the
accounts, and no host's limits apply. Implement `SaveStore` (five
methods and a `describe` sentence that tells players where their saves
live and for how long) and return it from `saves.store`. On jams.team,
also list your backend's origin under "Connects to" in the game's
settings, or the game's sandbox blocks the request.

| Store                          | Per save   | Saves per game | Kept                                                  |
| ------------------------------ | ---------- | -------------- | ----------------------------------------------------- |
| Engine default (any store)     | 64 KB      | 8              | —                                                     |
| The browser (raised by a game) | up to 1 MB | up to 64       | until the player clears the site's data               |
| jams.team, signed in           | 32 KB      | 4              | 180 days after last use; 1 MB per player across games |
| jams.team, signed out          | 32 KB      | 4              | in that browser until the player clears its site data |
| Your own backend               | yours      | yours          | yours                                                 |

A store may be stricter than your game's limits, never looser: on
jams.team a save over 32 KB is refused with `save-too-large` before it
is sent, whatever `saves.limits` says. Keep `snapshot()` small (ids and
counters, not derived data); a progress save is usually under 1 KB.
Sizes in this README count in 1,024s: a KB is 1,024 bytes and an MB is
1,024 KB.

**Preferences stay in the browser.** Key bindings, volumes, mutes,
language, captions and latency calibration are never part of a save and
are never uploaded, on jams.team or anywhere.

A save is a `save:v1` file at one of two depths:

- **`progress`**: the persistent value, the game's `snapshot()` (under
  `data`, since `game` is the game's id) and the scene it was taken in,
  with the entry it was reached through (`scene.entry`, the scene's
  `ctx.flow.entry`). Loading it loads that scene fresh through that entry,
  then hands the
  snapshot to `GameRuntime.restore(state)` and sets the persistent value.
  Every game can take one; restoring game state needs `restore`.
- **`world`**: everything a run needs to continue exactly: the tick, the
  runtime's counters, `ctx.random` and every fork it made (keyed by label
  path, `unit#2` for a path's second fork, matched in the order the
  restored run makes them), emit timers, enabled
  flags, destroyed and spawned entities with their exact ids, poses, each
  system's and behavior's own state (their optional `save(id)` and
  `restore(id, state)`, kept per owner; motion bodies and grid steppers
  under `motion` and `grid-step`), sublevels and seats. A world save is
  refused as `save-unsupported`, its detail naming each cause, while the
  main scene runs on Rapier (world saves of physics scenes arrive with
  online play's snapshots; use a progress save), while a function-form
  timer or a coroutine is pending (named by owner), or when the game has
  no `restore`. `worldSaveBlockers(runtime)` is that one rule, and every
  save path calls it. The guarantee, tested by the save variants of the
  physics-free genre probes and on the second game: a run saved at tick N and played on to N + M
  reaches the same digest as a fresh runtime that restored the save and
  played M.

`GameDefinition.saves: { version, migrations?, limits?, store? }` gives the
game's save-data version: bump it and add a migration (keyed by the version
it migrates from, `{ persist, game }` in and out) when `snapshot()` or the
persistent value changes shape. `parseSaveFile(text, game?)` checks the
envelope and migrates up, saying `migratedFrom`; a save from a newer
version, or one with a missing step ("no migration from 2 to 3"), is
`save-version-newer`. `formatSaveFile` writes the canonical text, and a
save's size is that text's UTF-8 length (`saveFileBytes`). A save whose
scene changed since (its `runHash`) still loads, with an info issue, since
refusing every save after a balance tweak would read as data loss. Slot
names are lowercase letters, digits and dashes, 1–32 characters
(`SLOT_PATTERN`). `meta.savedAt` is the host's clock, never read inside the
simulation. `meta.playTicks` is the play time: every tick played under the
instance's persist cell (or the headless session's), across scenes and
runtimes, seeded from the save when one loads and back to 0 on `flow.restart()`.

Saves go to a `SaveStore` (`kind`, `describe`, optional `limits`, `list`,
`read`, `write`, `remove`, every call guarded so a failing store never
stops the game): `memorySaveStore()`, `localStorageSaveStore({ prefix?,
storage? })`, `indexedDbSaveStore({ db? })`, or `browserSaveStore()`, which
probes once for IndexedDB, else localStorage, else memory. The game's own
backend (`GameDefinition.saves.store`) wins over the host's
(`GameConfig.saves`), which wins over `browserSaveStore()`. A store's
`describe` is the line a save menu shows: "Saves stay in this browser until
you clear its site data.", or "Saves last until this tab closes." for
memory.

Saves are limited to 64 KB and 8 slots per game by default; your own save
backend is the recommended path for anything more; browser saves stay on
the player's device. `DEFAULT_SAVE_LIMITS` is that default and
`saves.limits` raises or lowers it, but the browser stores cap at
`MAX_BROWSER_SAVE_LIMITS` (1 MB, 64 slots) and a store may be stricter
still: `effectiveSaveLimits(game, store)` is the minimum of the three, and
every store, the slots and a game's menu read it. The slots read it again
on every save, so a host whose limits change (a player signing in) applies
them to the next one. A save over the size is
`save-too-large`, checked before anything is written; a new slot past the
count is `save-slot-limit` ("This game keeps at most 8 saves; delete one to
save again."), while overwriting a slot never is; one instance's writes run
one at a time, so saves made together can't pass the count; a store that
throws is `save-store-failed`, and a host that refuses the save (a
signed-out player, or a game that doesn't save there) is `save-forbidden`,
with the host's own message.

`game.saves` is the instance's `SaveSlots`: `store` (`kind` and
`describe`), `limits`, `list()` (each slot's `meta`: title, scene,
`savedAt`, `playTicks`, and its bytes), `save(slot, { depth?, title? })`,
`load(slot)` and `remove(slot)`. A load pauses, swaps in the save's scene
restored, resumes and fires `flow:change`; a game with `time.catchUp` may
then be sent the time away since `meta.savedAt`, which idle games use for
"you were away". Game code saves with `ctx.saves.request(slot, opts?)`,
which the host honours after the tick; whether it worked arrives only as a
host event, `save:written { slot, bytes }` or `save:failed { slot, issue }`,
never as a simulation input.

Headless keeps saves in memory: `HeadlessRuntime.save(opts)` captures
(`captureSave`), `createHeadlessRuntime({ fromSave })` and `loadHeadless(…,
{ fromSave })` start from one (`restoreSave`), and a caller honours
`ctx.saves.request` by draining `takeRequests().saves`. A save fixture is
an asset of kind `save` (`*.save.json`, a blob with the game, version,
depth and scene as its meta) that `vp run scene save` writes and
`playtest --from-save` starts from; the recording then carries `fromSave:
{ slot, sha256 }`, and replaying it without that fixture is `asset-missing`.

```ts save-slots.ts
import { createGame, localStorageSaveStore, type GameInstance, type SaveSlots } from "@jams/engine";
import {
  createRegistry,
  defineGame,
  effectiveSaveLimits,
  formatSaveFile,
  parseSaveFile,
  type EngineContext,
} from "@jams/engine/game";
import { createHeadlessRuntime, memorySaveStore } from "@jams/engine/headless";
import { expandScene, type SceneDefinition } from "@jams/engine/scene";
import { z } from "zod";

export type HiveSnapshot = { nectar: number; bees: number };
type Honey = { honey: number };

/**
 * A physics-free hive: nectar comes in at a random rate, every 20 makes a
 * jar of honey (persistent), a timer hatches a bee every 10 ticks, and the
 * game asks for an autosave every 25 ticks.
 */
export const hiveGame = defineGame<HiveSnapshot>({
  id: "hive",
  types: [],
  actions: [],
  world: { physics: "none" },
  persist: {
    initial: () => ({ honey: 0 }),
    schema: z.strictObject({ honey: z.number().int().min(0) }),
  },
  saves: {
    version: 2,
    // Version 1 called the jars `jars`.
    migrations: {
      1: ({ persist, game }) => ({ persist: { honey: (persist as { jars: number }).jars }, game }),
    },
  },
  createRuntime(ctx: EngineContext) {
    let nectar = 0;
    let bees = 0;
    return {
      onLoad() {
        nectar = 0;
        bees = 0;
        ctx.timers.every(10, { emit: "hatch" });
      },
      beforeStep() {
        nectar += 1 + ctx.random.below(3);
        if (nectar >= 20) {
          nectar -= 20;
          ctx.persist.set({ honey: (ctx.persist.value as Honey).honey + 1 });
        }
        if (ctx.tick % 25 === 24) {
          ctx.saves.request("auto", { depth: "world", title: `Tick ${ctx.tick}` });
        }
      },
      afterStep(_dtMs, events) {
        for (const e of events) {
          if (e.type !== "hatch") continue;
          bees++;
          ctx.spawn({ type: "marker", at: [ctx.random.below(4), 1] });
        }
      },
      snapshot: () => ({ nectar, bees }),
      // Without `restore` a world save is refused (`save-unsupported`).
      restore(s) {
        nectar = s.nectar;
        bees = s.bees;
      },
    };
  },
});

const registry = createRegistry(hiveGame);
const meadow: SceneDefinition = {
  v: 4,
  game: "hive",
  name: "meadow",
  bounds: [0, 0, 4, 2],
  entities: [{ id: "hive", type: "marker", at: [2, 1] }],
};

/**
 * Plays 60 ticks, honouring the game's autosave requests and saving
 * `slot-1` by hand at tick 30; then a fresh runtime resumes `slot-1` and
 * plays the same 30 ticks to the same state.
 */
export async function keepHive() {
  const store = memorySaveStore();
  const scene = expandScene(meadow, registry);
  const open = (saveText?: string) => {
    const parsed = saveText === undefined ? null : parseSaveFile(saveText, hiveGame);
    if (parsed && !parsed.ok) throw new Error(parsed.issues[0]!.message);
    return createHeadlessRuntime({
      game: hiveGame,
      registry,
      scene,
      ...(parsed ? { fromSave: parsed.file } : {}),
    });
  };
  const now = (tick: number) => 1_762_531_200_000 + tick * 1000;
  const state = (r: ReturnType<typeof open>) => JSON.stringify([r.snapshot(), r.ctx.persist.value]);

  const run = open();
  const { tickMs } = run.ctx.time;
  for (let tick = 0; tick < 60; tick++) {
    run.step(tickMs, []);
    // The host's half of `ctx.saves.request`: capture after the tick, then write.
    for (const req of run.takeRequests().saves) {
      const saved = run.save({ ...req, depth: req.depth ?? "progress", now: now(tick) });
      if (saved.ok) await store.write("hive", req.slot, formatSaveFile(saved.file));
    }
    if (tick === 29) {
      const saved = run.save({
        depth: "world",
        slot: "slot-1",
        title: "Before the swarm",
        now: now(tick),
      });
      if (!saved.ok) throw new Error(saved.issue.message);
      await store.write("hive", "slot-1", formatSaveFile(saved.file));
    }
  }
  const played = state(run);

  const resumed = open((await store.read("hive", "slot-1"))!);
  for (let tick = 30; tick < 60; tick++) resumed.step(tickMs, []);

  const progress = run.save({ depth: "progress", slot: "slot-2", now: now(60) });
  const file = run.save({ depth: "world", slot: "slot-3", now: now(60) });
  if (!progress.ok || !file.ok) throw new Error("the hive can't be saved");
  // An old save of the game's version 1, migrated on parse.
  const old = parseSaveFile(
    formatSaveFile({ ...file.file, gameVersion: 1, persist: { jars: 3 } }),
    hiveGame,
  );
  const newer = parseSaveFile(formatSaveFile({ ...file.file, gameVersion: 3 }), hiveGame);
  run.destroy();
  resumed.destroy();

  return {
    limits: effectiveSaveLimits(hiveGame, store),
    slots: (await store.list("hive")).map((s) => [s.slot, s.meta.title, s.meta.playTicks]),
    sameState: state(resumed) === played,
    honey: (resumed.ctx.persist.value as Honey).honey,
    progressHasWorld: "world" in progress.file,
    migrated: old.ok ? [old.migratedFrom, old.file.persist] : null,
    newer: newer.ok ? null : newer.issues.map((i) => i.code),
  };
}

/** A save menu's lines: where saves live, the slots in use, and the next free slot. */
export async function saveMenu(saves: Pick<SaveSlots, "store" | "limits" | "list">) {
  const held = await saves.list();
  const names = new Set(held.map((s) => s.slot));
  let free: string | null = null;
  for (let n = 1; n <= saves.limits.maxSlots && free === null; n++) {
    if (!names.has(`slot-${n}`)) free = `slot-${n}`;
  }
  return {
    where: saves.store.describe,
    rows: held.map((s) => `${s.meta.title ?? s.meta.scene} · ${Math.round(s.bytes / 1024)} KB`),
    free: held.length < saves.limits.maxSlots ? free : null,
  };
}

/** Continue: loads the save written last, through the instance's slots. */
export async function continueNewest(game: Pick<GameInstance, "saves">) {
  const held = await game.saves.list();
  const newest = held.reduce<(typeof held)[number] | null>(
    (best, s) => (best && best.meta.savedAt >= s.meta.savedAt ? best : s),
    null,
  );
  return newest ? game.saves.load(newest.slot) : null;
}

/** A host's own store: localStorage under its own prefix; the game's `saves.store` would win over it. */
export async function playHive(canvas: HTMLCanvasElement): Promise<GameInstance> {
  const game = await createGame(canvas, {
    game: hiveGame,
    saves: localStorageSaveStore({ prefix: "hive-demo:" }),
  });
  game.on("save:written", ({ slot, bytes }) => console.log(`saved ${slot} (${bytes} B)`));
  game.on("save:failed", ({ slot, issue }) => console.warn(`${slot}: ${issue.message}`));
  game.start();
  return game;
}
```

`keepHive()` resumes `slot-1` to the same state as the run that went on,
lists the autosave beside it, migrates a version-1 save and refuses one
from version 3 as `save-version-newer`.

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
many docs shares one websocket between their providers. A doc is named by
its asset's registry key, which survives renames, so a host asks the
session for it (`session.docNameFor(entry)`) rather than building one from
a scene's name.

```ts co-editing.ts
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import type { GameInstance } from "@jams/engine";
import { bindSceneDoc, type OpenDoc, type ProjectSession } from "@jams/engine/collab";
import { createEditorSession } from "@jams/engine/editor";
import { sceneKind } from "@jams/engine/project";
import * as Y from "yjs";

/** The project session's `openDoc` over one websocket: a provider per doc, resolved once it has synced. */
export function hocuspocusDocs(url = "ws://localhost:3000/__scene-collab"): OpenDoc {
  const socket = new HocuspocusProviderWebsocket({ url });
  return (name) =>
    new Promise((resolve, reject) => {
      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc });
      const awareness = provider.awareness;
      if (!awareness) return reject(new Error(`"${name}": the provider has no awareness`));
      provider.on("synced", () => resolve({ doc, awareness, close: () => provider.destroy() }));
      provider.attach();
    });
}

/** The scene `wanted` names by id or display name, and its doc, which the session names by registry key. */
export function sceneDocOf(session: ProjectSession, wanted: string) {
  const scenes = [...session.view().byId.values()].filter((e) => e.kind === sceneKind.kind);
  const entry =
    scenes.find((e) => e.id === wanted) ??
    scenes.find((e) => (e.name ?? e.path.replace(/^.*\/|\.json$/g, "")) === wanted);
  const docName = entry && session.docNameFor(entry);
  return entry && docName ? { entry, docName } : null;
}

/** Opens scene `wanted` of the session's project, edits it as `userId`, and keeps the running game in step. */
export async function coEdit(
  game: Pick<GameInstance, "registry" | "runtime">,
  session: ProjectSession,
  wanted: string,
  userId: string,
) {
  const found = sceneDocOf(session, wanted);
  if (!found) throw new Error(`no scene "${wanted}" in ${session.project}`);
  const { doc, awareness } = await session.open(found.docName);
  const editor = createEditorSession({
    doc,
    origin: session.origin,
    registry: game.registry,
    name: found.entry.name ?? wanted,
    awareness,
    user: { id: userId, name: userId, color: "#6cf" },
    project: session,
  });
  const runtime = game.runtime();
  // Each transaction becomes entity-level adds, updates and removes, not a reload.
  const binding = runtime ? bindSceneDoc(doc, runtime, game.registry) : null;

  return {
    docName: found.docName,
    editor,
    move: (id: string) => editor.dispatch({ ops: [{ op: "move", refs: [id], by: [0.16, 0] }] }),
    undo: () => editor.undo(),
    close() {
      binding?.destroy();
      editor.destroy();
      session.release(found.docName);
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

- **`SceneEditor`** takes `{ host, game, project, scene?, rapier, ui?,
debug?, onReady? }`; `ui` is the game's `MountUi` (its project file's
  `ui`), mounted over the canvas while Play runs and unmounted on Stop; `mountSceneEditor(element, props)` mounts the same thing
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
sides write agree. A project whose files name no game passes `game: null` on
both sides: its scenes are judged by the engine alone (`createRegistry(null)`),
as the scene CLI judges them. `devProjectHost({ origin })`
points the page at a dev server on another origin (`http(s)://` or
`ws(s)://`). The repo carries the same setup as `scripts/engine-editor/`
(`vp run engine:editor`). It edits a scratch copy of `packages/engine/scenes`
(the engine project: kitchen sink and engine yard) unless `--in-place` is
passed, so the kitchen sink can be checked in the editor without the site.

## Project settings

The editor's Project settings panel (panel id `settings`: the host opens it
with `SceneEditorHandle.openPanel("settings")`, as the site's menu does,
and the toolbar's scene menu has "Project settings…")
edits a project's one-per-project docs in five tabs:

- **General**: the `game` block of `game-settings.json`, the fields the
  game's `projectSettings` declares.
- **Engine**: `engine.physics`, gravity in m/s², the tick rate and the
  resolution policy, each showing the game's value while the project sets
  none. The game's px per metre is shown and not edited: it is the code's
  (`GameDefinition.world.lengthUnit`).
- **Input**: the input map's seats and deadzone, every action with its
  bindings as chips (UI-only actions tagged), "Add binding", which takes
  the next press through the running game's `input.capture`, and the touch
  controls.
- **Scenes**: the scene list: drag a row, or use its arrows, to reorder;
  pick the start; edit titles; toggle a sublevel; add the scenes it doesn't
  list, and remove one.
- **Layers**: the scene layers and collision groups the game's code
  registers, each with the module it comes from, read-only, since they
  change in code.

A project without a `game-settings`, `input-map` or `scene-list` doc offers
"Create", an asset made from the kind's empty value. Removing a binding, a
touch control or a listed scene asks first through the editor's `Confirm`.
Every edit is one `editAsset` batch through the project session, so it has
history, per-person undo, presence and sync like any other edit, and two
people editing different tabs converge.

The panels are built on `./editor`'s pure settings model, which any host or
tool can use over a zod object: `settingsRows(schema, value, path, {
registry?, pxPerMetre? })` gives the inspector's rows (enums, bounded
numbers, booleans and number pairs with the scene inspector's widgets,
nested objects as children, metric steps at the game's px per metre),
`settingsValue(row, input)` checks and types what a control gives, and
`settingsEdit(asset, path, value, current?)` is the one op that writes a dot
path. Given the doc and its kind's layout as `current`, it writes where the
layout allows: a field inside an atomic value (`engine.resolution.fit`)
sets the whole value, a field under a missing object sets the object, and
`undefined` unsets.

## Export

`vp run scene game build <id>` turns a game's project into a static
directory that plays with no site behind it: no request leaves the build's
own directory, nothing names a host, and the same files serve from any static
host, an itch.io page or a wrapper. `vp run scene game export <id> --zip`
builds and zips it, and `vp run scene game manifest <dir>` reads a build
back. The commands, their flags and their output are in
`scripts/scene/README.md`; this section is what they make and the entries
they make it with.

**Not from `file://`: use a static server or a wrapper.** Browsers refuse
module scripts and `fetch` on a page opened from a file, so double-clicking
`index.html` shows nothing. Serve the directory (`vp dlx serve
dist/games/<id>/web`, or any static server), or load it in a wrapper that
serves the build from its own scheme. The host never reads
`location.protocol`, `origin` or `host`: every URL is resolved against
`release.json`'s own, so a build plays at a domain's root, in a subfolder,
inside itch.io's frame or from a wrapper's scheme alike.

### Targets

A target is a row of one table, `EXPORT_TARGETS` in `export/targets.ts`:
the only place a target's name decides anything. The planner, the
renderers, the CLI's `--target` and its usage line all read the rows, so a
new target is one row.

| Target    | `sw.js` and `app.webmanifest`                         | Files checked                   | Built by this engine                                      |
| --------- | ----------------------------------------------------- | ------------------------------- | --------------------------------------------------------- |
| `web`     | yes, unless the project file sets `export.pwa: false` | no                              | yes; `game build`'s default                               |
| `itch`    | no                                                    | `checkItchLayout` (see itch.io) | yes; `game export --zip`'s default (`DEFAULT_ZIP_TARGET`) |
| `desktop` | no row                                                |                                 | no: `export-target-unsupported`, before the bundler       |
| `mobile`  | no row                                                |                                 | no: `export-target-unsupported`, before the bundler       |

All four names are valid in a `release.json`, so a manifest a wrapper
writes later still parses with this engine's reader.

```ts export-targets.ts
import { DEFAULT_ZIP_TARGET, exportTarget, exportTargetNames } from "@jams/engine/export";

/** Each target this engine builds, read from its row: whether it is a PWA, whether its files are checked. */
export function targetRows() {
  return {
    rows: exportTargetNames().map((name) => {
      const row = exportTarget(name)!;
      return { name, pwa: row.pwa, layoutChecked: row.layout !== null };
    }),
    // A name `release:v1` reserves but this engine doesn't build has no row.
    desktop: exportTarget("desktop") ?? null,
    zipDefault: DEFAULT_ZIP_TARGET,
  };
}
```

### What a build holds

```text
index.html            loads code/<entry>; a <noscript> line; no external URL
release.json          the manifest
app.webmanifest       web target with pwa on
sw.js                 web target with pwa on
credits.html          always
code/*.js, *.css      the bundler's chunks, named by content hash
code/*.wasm           only when a listed scene needs Rapier and the standard package ships
data/<sha256>.json    every shipped doc's canonical text
assets/<sha256><ext>  every shipped blob
icons/icon-192.png, icons/icon-512.png
```

`index.html` sets `<html lang="en">`, the project's `name` as its title, a
viewport meta, the theme colour and the web manifest link (web target),
`<div id="game">` and one module script: no inline script or style, no
font, analytics or site URL, so a strict CSP serves it unchanged. Nothing
in a build depends on the clock or the machine: no dates, no absolute
paths, sorted file lists, no sourcemaps.

Only what the scene list reaches ships: the listed scenes, the prefabs
their expansion uses, the blobs their bundles fetch, the project bundle
and the runtime docs (game settings, input map, data tables, the scene
list). Checks files, input scripts, saves, unlisted scenes and unused art
stay out; a check that names an unlisted scene warns `scene-unlisted`.
Each listed scene's physics is decided once (`scenePhysics`) and recorded
in the manifest; when none needs Rapier, the build holds no wasm at all.

### Planning a build in code

`@jams/engine/export` is the planner, with nothing but zod under it (no
Pixi, no `node:`), so a site or a test can plan an export without a
bundler. `planContent` decides what ships; the bundler runs; `finishExport`
takes its hashed output (`BuiltCode`) and returns every file to write with
`release.json`. The shell pages come from pure renderers over the
manifest (`renderIndexHtml`, `renderServiceWorker`, `renderWebManifest`,
`renderCredits`), so the same manifest renders the same bytes anywhere.
`createExportBuild` from `@jams/engine/vite` is the Vite
plugin that does both around a Vite build, and `game build` runs it. Here
the walker from [World models](#world-models) is planned by hand, with a
stand-in for the bundler:

```ts export-plan.ts
import { finishExport, planContent, type BuiltCode, type ExportInput } from "@jams/engine/export";
import { createRegistry, withProject } from "@jams/engine/game";
import {
  heldProject,
  sha256,
  snapshotProject,
  type AssetSidecar,
  type HeldFile,
  type ProjectFile,
  type ReleaseTarget,
} from "@jams/engine/project";

import { walkerGame } from "./walker-game";

const LANE: ProjectFile = {
  kind: "project",
  v: 1,
  id: "lane",
  name: "Lane Walk",
  game: { module: "./index.ts", export: "walkerGame" },
  export: { shortName: "Lane", themeColor: "#1b1f2a", background: "#0d0f14" },
};

const texture = (id: string, licence?: AssetSidecar["licence"]): AssetSidecar => ({
  kind: "asset-sidecar",
  v: 1,
  key: `k-${id}`,
  id,
  sha256: id === "moss" ? "a".repeat(64) : "b".repeat(64),
  bytes: 2048,
  meta: { format: "png", width: 32, height: 32 },
  ...(licence ? { licence } : {}),
});

/** The project's files as a host holds them: docs by their JSON, binaries by their sidecars. */
function laneFiles(): { files: HeldFile[]; texts: Map<string, string> } {
  const docs: Record<string, unknown> = {
    "scene-list.json": { kind: "scene-list", v: 1, start: "lane", scenes: [{ scene: "lane" }] },
    "game-settings.json": { kind: "game-settings", v: 2, engine: {}, game: {} },
    "lane.json": {
      v: 4,
      name: "lane",
      bounds: [0, 0, 3.2, 1.92],
      settings: { physics: "none" },
      assets: ["moss", "lamp"],
      entities: [
        { id: "hero", type: "marker", at: [0.48, 0.48], tags: ["hero"] },
        { id: "goal", type: "marker", at: [2.72, 0.48], tags: ["goal"] },
      ],
    },
  };
  const texts = new Map<string, string>();
  const files: HeldFile[] = [];
  for (const [path, json] of Object.entries(docs)) {
    texts.set(path, `${JSON.stringify(json, null, 2)}\n`);
    files.push({ path, json });
  }
  files.push(
    { path: "art/moss.png", sidecar: texture("moss", { spdx: "CC0-1.0", author: "Ada" }) },
    { path: "art/lamp.png", sidecar: texture("lamp") },
  );
  return { files, texts };
}

/** What `game build` hands the planner: the view, the doc texts by id, the registry and a snapshot. */
export async function laneInput(target: ReleaseTarget): Promise<ExportInput> {
  const held = laneFiles();
  const { view, kinds } = heldProject(held.files, createRegistry(walkerGame), {
    projectId: LANE.id,
    name: LANE.name,
  });
  const texts = new Map<string, string>();
  for (const entry of view.byId.values()) {
    const text = held.texts.get(entry.path);
    if (text !== undefined) texts.set(entry.id, text);
  }
  const values = new Map([...texts].map(([id, text]) => [id, JSON.parse(text) as unknown]));
  return {
    project: LANE,
    view,
    texts,
    kinds,
    registry: withProject(createRegistry(walkerGame), view, values),
    game: walkerGame,
    engine: {},
    target,
    snapshot: await snapshotProject(view, texts, view.state.build),
  };
}

/** Stands in for the bundler: `createExportBuild` fills this from Vite's chunks. */
export async function laneCode(): Promise<BuiltCode> {
  const js = "console.log('lane');\n";
  return {
    files: [
      { path: "code/main-1a2b3c.js", sha256: await sha256(js), bytes: js.length, role: "code" },
    ],
    entry: "code/main-1a2b3c.js",
    rapier: null,
    thirdParty: [{ package: "zod", version: "4.1.12", licence: "MIT", notice: "MIT License…" }],
  };
}

/** Plans what ships, then the build's files and its `release.json`, without running a bundler. */
export async function planLane(target: ReleaseTarget = "web") {
  const input = await laneInput(target);
  const content = await planContent(input);
  const plan = await finishExport(content, await laneCode(), input);
  return {
    plan,
    needsRapier: content.needsRapier,
    files: plan.files.map((f) => `${f.path} ${f.role}`),
    issues: plan.issues.map((i) => `${i.severity} ${i.code}`),
  };
}
```

The web plan holds the four shell files, the code, two textures, three
docs and both icons (the engine's defaults, since the project file names
none); the itch plan drops `sw.js` and `app.webmanifest`. The unlicensed
texture is the plan's one issue, a `licence-missing` warning.

The project file's `export` block sets what the planner can't guess. Every
field has a default, and the block is read from git only, never co-edited:

```json
{
  "export": {
    "shortName": "Lane",
    "icons": { "192": "icon-192", "512": "icon-512" },
    "themeColor": "#1b1f2a",
    "background": "#0d0f14",
    "display": "fullscreen",
    "orientation": "landscape",
    "budget": { "totalBytes": 52428800 },
    "rapier": "standard",
    "pwa": true
  }
}
```

`icons` name texture assets, checked by their recorded size: one that
isn't exactly a 192×192 or 512×512 PNG falls back to the engine's default
with `export-asset-missing` at warn. `orientation` defaults from the
resolution policy's aspect, else `any`; `rapier: "compat"` ships the
package with its wasm inlined in the code.

### The manifest

`release.json` (`release:v1`, schema `@jams/engine/schemas/release.schema.json`)
says everything about a build without its code: the engine and the format
versions a reader must accept, the game's id and save version, the project
snapshot it was built from, every file with its hash, size and role, the
time model, the scene list with each scene's physics and bundle, every
shipped asset, the credits, the budget report and the PWA's inputs. Its
canonical text (`formatReleaseManifest`) hashes to the **release id**
(`releaseId`), which a recording made on the build carries as `release`.

`checkReleaseManifest` is the one check of whether a manifest holds
together: paths relative and inside the build, the start listed, every
named file listed with its hash, `build.hash` and the snapshot hash
reproduced, the files present when given, and the budget re-measured when
given `measureBudget`. The planner ends with it, `game manifest` and the
standalone host run it, and `findRelease` picks the release a recording
was made on (its `release` id first, else the same snapshot and engine):

```ts release-manifest.ts
import { measureBudget } from "@jams/engine/export";
import {
  checkReleaseManifest,
  findRelease,
  formatReleaseManifest,
  parseReleaseManifest,
  releaseId,
} from "@jams/engine/project";

import { planLane } from "./export-plan";

/** Reads a `release.json` the way `game manifest` and the standalone host do: parse, then check. */
export async function readRelease(text: string) {
  const parsed = parseReleaseManifest(text);
  if (!parsed.ok) return { ok: false, codes: parsed.issues.map((i) => i.code) };
  const issues = await checkReleaseManifest(parsed.manifest, undefined, { measureBudget });
  return {
    ok: issues.length === 0,
    id: await releaseId(parsed.manifest),
    manifest: parsed.manifest,
    codes: issues.map((i) => i.code),
  };
}

export async function laneRelease() {
  const { plan } = await planLane();
  const text = formatReleaseManifest(plan.manifest);
  const read = await readRelease(text);
  const m = plan.manifest;
  // The code's listed hash changed after the build: `build.hash` no longer reproduces.
  const edited = structuredClone(m);
  edited.build.files = edited.build.files.map((f) =>
    f.role === "code" ? { ...f, sha256: "c".repeat(64) } : f,
  );
  const tampered = await readRelease(formatReleaseManifest(edited));
  // A recording made on this release names it; one made before releases matches by snapshot.
  const id = await releaseId(m);
  const releases = [{ id, manifest: m }];
  const engine = { version: m.engine.version, physics: null };
  const project = { id: m.project.id, snapshot: m.project.snapshot };
  return {
    sameId: read.id === id,
    read: read.codes,
    tampered: tampered.codes,
    byId: findRelease({ engine, project, release: id }, releases)?.id === id,
    bySnapshot: findRelease({ engine, project }, releases)?.id === id,
    elsewhere: findRelease({ engine, project: { ...project, snapshot: "0".repeat(64) } }, releases),
  };
}
```

### Budgets

Every build is measured against four size budgets, `DEFAULT_EXPORT_BUDGET`,
which the project file's `export.budget` overrides one field at a time:

| Budget           | Default | Counts                                                                                                                   |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `codeBytes`      | 4 MiB   | JS and CSS, without wasm                                                                                                 |
| `firstLoadBytes` | 16 MiB  | code, the wasm when the start scene needs Rapier, the project bundle, the start scene's bundle and the docs boot fetches |
| `totalBytes`     | 100 MiB | every file                                                                                                               |
| `fileBytes`      | 32 MiB  | the largest file                                                                                                         |

Over any is `export-over-budget` (error), naming the budget, the measured
size, the limit and the three largest contributors, with the asset each
belongs to. The build is still written whole, and `game build` exits 1
unless `--allow-over-budget` is given. The summary always prints the wasm
line: `wasm: 0 B (no listed scene uses Rapier)`, or the package, its size
and the scenes that need it. `formatBytes` reads 1024-based units, so
`4 MB` is 4 MiB.

```ts export-budget.ts
import {
  DEFAULT_EXPORT_BUDGET,
  finishExport,
  formatBytes,
  planContent,
  resolveExportBudget,
} from "@jams/engine/export";

import { laneCode, laneInput } from "./export-plan";

export function budgets() {
  // The project file's `export.budget` overrides a default; a caller's override (the CLI's) comes last.
  const limits = resolveExportBudget(
    { totalBytes: 50 * 1024 * 1024 },
    { fileBytes: 8 * 1024 * 1024 },
  );
  return {
    defaults: Object.entries(DEFAULT_EXPORT_BUDGET).map(([k, v]) => `${k} ${formatBytes(v)}`),
    limits: Object.entries(limits).map(([k, v]) => `${k} ${formatBytes(v)}`),
  };
}

/** The lane against a first load of 4 KB: the plan is whole, with one error saying what to lower. */
export async function tightLane() {
  const input = await laneInput("web");
  const plan = await finishExport(await planContent(input), await laneCode(), input, {
    firstLoadBytes: 4096,
  });
  const over = plan.issues.filter((i) => i.code === "export-over-budget");
  return {
    over: plan.manifest.budget.over,
    measured: formatBytes(plan.manifest.budget.measured.firstLoadBytes),
    messages: over.map((i) => i.message),
    files: plan.files.length,
  };
}
```

A build's size is reported against its budget before anything is uploaded; jams.team's own limits are stated in its publish flow.

### The standalone host

`@jams/engine/standalone` boots a build from its `release.json` in any
page. A build's generated entry is one call to `bootStandalone` with the
game's definition, its UI and, when a listed scene needs it, Rapier's
loader. Boot sets `<html data-jams-state>` to `loading`; fetches and
checks `release.json` (a newer format than this engine reads is
`version-newer`, another game's build `asset-kind`); fetches every doc in
parallel, each checked against its hash (`hash-mismatch` means a stale
cache served another build's file); builds the project view and runtime
view from them (`manifestView`, `manifestRuntimeView`); creates the game
with the asset loader over the build's files, the scene flow over the
shipped scenes, `browserSaveStore()` and the release; mounts the UI;
starts the flow; registers `sw.js` when the build has one; and sets
`ready`. A refused boot sets `error` and shows the reason, its issue code
and a Reload button in the root:

```ts standalone-page.ts
import { bootStandalone, type StandaloneGame } from "@jams/engine/standalone";

import { walkerGame } from "./walker-game";

/**
 * What a build's generated entry does, by hand: boots the release next to
 * the page. A refused boot already shows its reason, the issue's code and a
 * Reload button in `root`, and sets `<html data-jams-state="error">`.
 */
export async function playLane(
  root: HTMLElement,
  fetch?: typeof globalThis.fetch,
): Promise<StandaloneGame | null> {
  try {
    return await bootStandalone({ root, game: walkerGame, ...(fetch ? { fetch } : {}) });
  } catch {
    return null;
  }
}

/** An Install button, shown while the browser offers to install the game, and a Credits link. */
export function laneMenu(game: StandaloneGame, doc: Document): HTMLElement {
  const menu = doc.createElement("nav");
  const install = doc.createElement("button");
  install.type = "button";
  install.textContent = "Install";
  const sync = () => {
    install.hidden = game.install === null;
  };
  sync();
  // The host holds the browser's prompt from `beforeinstallprompt` on; `install` is set from then.
  doc.defaultView?.addEventListener("beforeinstallprompt", () => queueMicrotask(sync));
  install.addEventListener("click", async () => {
    await game.install?.();
    sync();
  });
  const credits = doc.createElement("a");
  credits.href = game.credits;
  credits.textContent = "Credits";
  menu.append(install, credits);
  return menu;
}
```

The UI mounted by the host gets `links.credits`, the credits page's URL,
when the build has one. Saves default to `browserSaveStore()`, with its
own fallbacks when the origin has no IndexedDB; a game's own
`saves.store` still wins.

### The PWA

A web build with `pwa` on is an installable, offline app. `sw.js` is a
plain script with the build's file list inline: `install` precaches every
file `release.json` lists and the manifest itself, in a cache named
`jams-<project>-<build.hash 12>-<snapshot 12>`, so new code or new content
is a new cache; `activate` deletes this project's older caches; `fetch`
answers the content-named files (`code/`, `data/`, `assets/`, `icons/`)
cache first and the five shell files (`index.html`, `release.json`,
`credits.html`, `sw.js`, `app.webmanifest`) network first, with the cache
as the offline fallback. `app.webmanifest` carries the name, short name,
display, orientation, colours and icons, every URL relative, so the build
installs from whatever directory serves it.

The host registers `sw.js` only where it can run: the manifest has `pwa`,
the browser has service workers and the context is secure (HTTPS or
`localhost`). Anywhere else the game boots the same, online only.
`StandaloneGame.install` is the browser's install prompt, set from the
moment the browser offers one (`beforeinstallprompt`) and null otherwise;
`laneMenu` above shows its button only then.

An installed game keeps its saves in the same browser store: saves live
in the origin's save store (IndexedDB), not in the service worker's cache,
so installing, updating to a new build or the worker replacing its cache
leaves them where they were, and the installed app and the browser tab see the same
slots.

### Credits and licences

Every build ships `credits.html`, a page with no script: the game's name;
the assets, grouped by identical licence, each group with its attribution,
author, source, SPDX id and the assets' names; a "No licence recorded"
list; the code, each third-party package whose modules are in the chunks
with its version, licence and its `LICENSE` text in a `<details>`; and
"Made with @jams/engine" with the version.

An asset's licence is its sidecar's `licence` (`spdx`, `author`, `source`,
`attribution`), written with the scene CLI's `setLicence` op. A shipped
blob without one ships anyway, listed under "No licence recorded", with
one `licence-missing` warning per asset: a fact to show, not a reason to
block a jam build. The packages come from the bundle report's module
ids, each `node_modules/<package>/` reached giving its name, version,
`license` field and `LICENSE`, `LICENSE.md` or `COPYING` file. In the
lane above, `manifest.credits` is the CC0 moss texture, the lamp in
`missing`, and zod under `code`.

### itch.io

`vp run scene game export <id> --zip` builds the `itch` target and zips it
to `dist/games/<id>-itch.zip`. An itch build has no service worker and no
web manifest (itch.io's frame runs without them), `index.html` at the
zip's root and every path relative. `checkItchLayout` holds the files to
itch.io's HTML5 rules (https://itch.io/docs/creators/html5, "ZIP file
requirements"), read 2026-11-11, as `ITCH_LIMITS`:

| Limit           | Value                                |
| --------------- | ------------------------------------ |
| `maxFiles`      | 1,000 files after extraction         |
| `maxTotalBytes` | 500 MB extracted (500,000,000 bytes) |
| `maxFileBytes`  | 200 MB per file (200,000,000 bytes)  |
| `maxPathLength` | 240 characters, path included        |

itch.io states MB without a base, so the byte counts take the smaller,
decimal reading. It also refuses a file outside the root folder, a
`__MACOSX` folder and dotfiles; each failure is `export-itch-layout`
(error). The zip is stored, not deflated, with its entries sorted by path
and a fixed 1980-01-01 time, so two exports of one build are equal bytes on
every runtime. Nothing is uploaded: create the itch.io page as an HTML
game and upload the zip yourself.

itch.io takes at most 1,000 files, 500 MB extracted and 200 MB per file
(checked by `game export --zip`); a jams.team release may have more files
than itch.io accepts.

```ts itch-zip.ts
import { checkItchLayout, ITCH_LIMITS, zipFiles } from "@jams/engine/export";

const text = (s: string) => new TextEncoder().encode(s);

export function itchUpload() {
  const files = [
    { path: "index.html", bytes: text("<!doctype html>\n") },
    { path: "code/main-1a2b3c.js", bytes: text("console.log('lane');\n") },
    { path: "release.json", bytes: text("{}\n") },
  ];
  const sizes = (list: typeof files) => list.map((f) => ({ path: f.path, bytes: f.bytes.length }));
  // Stored entries, sorted by path, at a fixed time: the input order and the clock don't matter.
  const zip = zipFiles(files);
  const again = zipFiles([...files].reverse());
  return {
    limits: ITCH_LIMITS,
    issues: checkItchLayout(sizes(files)).map((i) => i.message),
    // A folder zipped from its parent, with a Finder file beside it.
    nested: checkItchLayout([
      { path: "lane/index.html", bytes: 16 },
      { path: "lane/.DS_Store", bytes: 6148 },
    ]).map((i) => i.message),
    zipBytes: zip.length,
    sameZip: zip.length === again.length && zip.every((b, i) => b === again[i]),
  };
}
```

### The packed engine

An export bundles the packed engine: `game build` resolves
`node_modules/@jams/engine`, the workspace link to this package, to its
`dist/`, the files a consumer installs, while the site, the tests and the
scene CLI import the source. `vp run game:build <id> [flags]` and `vp run
game:export <id> --zip` pack first as a Vite Task dependency; a direct
`vp run scene game build <id>` or the MCP `game_build` packs when `dist/`
is missing or older than the source, one pack at a time. A test that
builds a game needs a timeout long enough for one pack (up to 10 minutes).

## Publishing on jams.team

`vp run scene game release create <project>` builds the game, uploads
what jams.team doesn't already have, and puts the new release on the
game's **preview** channel. A person with the publisher role promotes it
to **production** on the game's page; agents and tokens can't.

A release is immutable: its id is the SHA-256 of its `release.json`, and
every file is stored and served by its hash, so a new version uploads
only what changed. Each release gets the next version number (v1, v2,
…), which never changes.

**Limits per project, enforced by jams.team:**

| Limit            | Number                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Release size     | 100 MB, 2,000 files, 32 MB per file (every file counts, including audio that loads later) |
| Release storage  | 512 MB across the project's releases (files shared between releases count once)           |
| Releases kept    | the 10 newest, plus the live preview and production releases and up to 8 jam versions     |
| Releases per day | 20                                                                                        |
| Asset storage    | 256 MB of uploaded assets, including the trash and replaced versions                      |
| Documents        | 1,000 documents and 64 MB of document data                                                |

You see usage against each limit in the editor (Project settings →
Usage) and before every publish, with a warning at 80%; an upload that
would pass a limit is refused before any file is sent, with a message
that names the limit and what to do.

**Cleanup, automatically, every day:** a release that is neither among
the 10 newest nor pinned (live on a channel, or a jam version) is
removed 14 days after it was published; its version number and history
stay. A replaced version of an asset is deleted 30 days after it was
replaced, unless a kept release uses it. Assets in the trash stay, and
count toward asset storage, until you empty the trash.

**The game runs sandboxed.** It can load only its own files, and connect
only to them and to up to 4 origins you list under "Connects to".
Builds need `@jams/engine` 0.14.1 or newer.

## Graphics loss

A browser can take a page's GPU context away at any time: a driver reset,
too many contexts, a laptop switching graphics cards. The shell handles it
so the game neither goes on blind nor stays a black canvas.

- **The pause.** On WebGL's `webglcontextlost` or WebGPU's `device.lost`,
  the game pauses: nothing ticks until drawing is back, the simulation
  never sees the loss, and a fixed-step game resumes on the tick it
  stopped at. A host's own pause (a pause menu) outlasts the loss: the
  restore leaves the game paused.
- **The overlay.** While the context is gone, a layer over the game shows
  a centred "Restoring graphics…" line, or what `renderer.lostOverlay`
  draws in its place.
- **The fallback.** A WebGL context that comes back within 3 seconds is
  rebuilt in place by Pixi. Otherwise, and on any WebGPU loss, the
  renderer is replaced by a WebGL one on a fresh canvas laid over the
  host's, with the world and UI containers re-attached and every resident
  texture uploaded again by its hash. A WebGPU init failure at start
  retries with WebGL. The fallback holds for the session.
  `renderer.preference: "webgl"` starts on WebGL; the standalone host sets
  it when the page's URL has `?renderer=webgl`.
- **The events.** Each step is an event on the game:

| Event             | Payload                                        | When                                                              |
| ----------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| `render:lost`     | `{ backend }`                                  | the context was lost; the game is paused                          |
| `render:restored` | `{ backend, rebuilt }`                         | drawing resumed, in place (`rebuilt: false`) or on a new renderer |
| `render:failed`   | `{ backend }`                                  | the rebuild after a loss failed; nothing draws again              |
| `render:fallback` | `{ from: "webgpu", reason: "init" \| "lost" }` | WebGL from here on; for `init`, emitted when the game starts      |

- **On the page.** `mirrorRenderState(game, root?)` from `./standalone`
  writes the events onto `root` (default `<html>`): `data-jams-render` is
  `lost`, then `restored`, `rebuilt` or `failed`, and `data-jams-render-fallback` is
  the fallback's reason. `bootStandalone` calls it, so a page, its tests or
  a smoke read the renderer's state without listening. Call it before
  `start()` to see an `init` fallback; the function it returns stops and
  clears both attributes.

```ts graphics-loss.ts
import { createGame, type GameInstance } from "@jams/engine";

import { walkerGame } from "./walker-game";

/** Shown in place of the default "Restoring graphics…" line while the GPU context is restored. */
export function restoringCard(layer: HTMLElement): { destroy(): void } {
  const card = layer.ownerDocument.createElement("p");
  card.setAttribute("role", "status");
  card.textContent = "The graphics card dropped out. Your game is paused and will carry on.";
  card.style.cssText = "margin:auto;padding:12px 16px;background:#111;color:#eee";
  layer.style.display = "flex";
  layer.append(card);
  return { destroy: () => card.remove() };
}

/** The three render events, as lines a host might log or send to its error reporting. */
export function watchGraphics(game: Pick<GameInstance, "on">, log: (line: string) => void): void {
  game.on("render:lost", ({ backend }) => log(`lost ${backend}: paused`));
  game.on("render:restored", ({ backend, rebuilt }) =>
    log(`back on ${backend}${rebuilt ? ", rebuilt" : ""}: resumed`),
  );
  game.on("render:fallback", ({ from, reason }) => log(`${from} ${reason}: WebGL from here on`));
}

export async function startLane(canvas: HTMLCanvasElement): Promise<GameInstance> {
  const game = await createGame(canvas, {
    game: walkerGame,
    displayWidth: canvas.clientWidth,
    displayHeight: canvas.clientHeight,
    dev: false,
    renderer: { preference: "webgpu", lostOverlay: restoringCard },
  });
  watchGraphics(game, (line) => console.info(line));
  return game;
}
```

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

| Field       | Type                                                 | Required | Description                                                                                                                        |
| ----------- | ---------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `$schema`   | string                                               |          | Path or URI of this file's JSON Schema, for editors. Ignored by the engine.                                                        |
| `v`         | `4`                                                  | yes      | Scene format version. Files are migrated up on load and always saved at the current version.                                       |
| `name`      | string                                               | yes      | Scene name, same rules as an id; matches the file name without .json.                                                              |
| `bounds`    | [number (m), number (m), number (m), number (m)] (m) | yes      | World rectangle [minX, minY, maxX, maxY] in metres; y is down. Limits the camera; anything outside it is flagged.                  |
| `settings`  | object                                               |          | Scene-wide settings: the engine's, then the game's.                                                                                |
| `assets`    | string[]                                             |          | Asset ids only game code names, so they count as used: sorted, each once.                                                          |
| `groups`    | { id: [group](#groups-and-prefabs) }                 |          | Groups by id. An entity or instance whose `group` names one stores its geometry relative to the group's `at`.                      |
| `instances` | [instance](#groups-and-prefabs)[]                    |          | Prefab instances, each a copy of a prefab file placed at `at`.                                                                     |
| `solid`     | [shape](#shapes)[]                                   |          | Static ground shapes, absolute metres; `solid:<material>` for a material. Entries have no id; ops refer to them as ~solid:<index>. |
| `entities`  | [entity](#entity-types)[]                            |          | Entities with stable ids: anything that moves, has parameters, or is referenced.                                                   |

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
| `shape`     | [shape](#shapes)                                      | yes      | Collider shape. Absolute world metres; y is down. Any tag, including chain for outlines.                                                                                  |
| `material`  | none registered                                       |          | Surface material.                                                                                                                                                         |
| `oneWay`    | `true` or `"up"` \| `"right"` \| `"down"` \| `"left"` |          | The one side actors collide with: they pass through from every other side and land on this one. `true` is "up": they pass up through it and land on top.                  |
| `attach`    | string                                                |          | A path follower's id: the collider rides that follower's body, keeping its offset from the follower's first path point.                                                   |
| `behaviors` | object                                                |          | Behavior blocks by name: each a typed set of fields this entity carries. `{}` carries a behavior with all its defaults; the type's required behaviors are always present. |

#### `sensor`

Trigger volume with no collision response; raises sensor:enter and sensor:exit when something overlaps it.

| Field       | Type             | Required | Description                                                                                                                                                               |
| ----------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape`     | [shape](#shapes) | yes      | Trigger shape. Absolute world metres; y is down.                                                                                                                          |
| `tags`      | string[]         |          | Labels a game reads off the sensor's events.                                                                                                                              |
| `attach`    | string           |          | A path follower's id: the collider rides that follower's body, keeping its offset from the follower's first path point.                                                   |
| `behaviors` | object           |          | Behavior blocks by name: each a typed set of fields this entity carries. `{}` carries a behavior with all its defaults; the type's required behaviors are always present. |

#### `marker`

A named point with tags; what it means is up to the game.

| Field       | Type             | Required | Description                                                                                                                                                               |
| ----------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `at`        | [point](#points) | yes      | Marker position. Absolute world metres; y is down.                                                                                                                        |
| `tags`      | string[]         |          | Labels a game reads, e.g. spawn or checkpoint.                                                                                                                            |
| `behaviors` | object           |          | Behavior blocks by name: each a typed set of fields this entity carries. `{}` carries a behavior with all its defaults; the type's required behaviors are always present. |

#### `prop`

Dynamic physics object that can be pushed and stood on.

| Field            | Type                  | Required | Description                                                                                                                                                               |
| ---------------- | --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape`          | [body shape](#shapes) | yes      | Starting collider shape. Absolute world metres; y is down. Not chain.                                                                                                     |
| `density`        | number                | yes      | Density in kg/m²; heavier props are harder to push.                                                                                                                       |
| `restitution`    | number                | yes      | Bounciness: 0 doesn't bounce, 1 keeps all its speed.                                                                                                                      |
| `friction`       | number                |          | Surface friction; omitted uses the material's, else the physics default.                                                                                                  |
| `material`       | none registered       |          | Surface material.                                                                                                                                                         |
| `gravityScale`   | number                |          | Multiplies the world's gravity on this body: 0 floats, -1 falls up; default 1.                                                                                            |
| `linearDamping`  | number (/s)           |          | Slows the body's motion over time; default 0.                                                                                                                             |
| `angularDamping` | number (/s)           |          | Slows the body's spin over time; default 0.                                                                                                                               |
| `fixedRotation`  | boolean               |          | When true, the body never turns.                                                                                                                                          |
| `ccd`            | boolean               |          | Continuous collision detection: when true, a fast body can't pass through thin colliders between steps.                                                                   |
| `behaviors`      | object                |          | Behavior blocks by name: each a typed set of fields this entity carries. `{}` carries a behavior with all its defaults; the type's required behaviors are always present. |

#### `follower`

Kinematic body that follows a waypoint path.

| Field       | Type                  | Required | Description                                                                                                                                                               |
| ----------- | --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape`     | [body shape](#shapes) | yes      | Collider shape LOCAL to the current path point, usually centred on 0, 0 (e.g. ["box", 0, 0, 0.4, 0.06]). Not chain.                                                       |
| `path`      | [path](#paths)        | yes      |                                                                                                                                                                           |
| `material`  | none registered       |          | Surface material.                                                                                                                                                         |
| `behaviors` | object                |          | Behavior blocks by name: each a typed set of fields this entity carries. `{}` carries a behavior with all its defaults; the type's required behaviors are always present. |

#### `decor`

A picture with no body: drawn by its sprite, never collides.

| Field       | Type             | Required | Description                                                                                                                                                               |
| ----------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `at`        | [point](#points) | yes      | Where the sprite's pose is. Absolute world metres; y is down.                                                                                                             |
| `behaviors` | object           |          | Behavior blocks by name: each a typed set of fields this entity carries. `{}` carries a behavior with all its defaults; the type's required behaviors are always present. |

#### `nav`

A walkable area, or a hole in one, for navigation without physics or a grid.

| Field       | Type                  | Required | Description                                                                                                                                                               |
| ----------- | --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape`     | [polygon](#shapes)    | yes      | A simple polygon, concave allowed. Absolute world metres; y is down.                                                                                                      |
| `mode`      | `"walk"` \| `"block"` |          | walk (default) or a hole cut out of the walk area it lies in.                                                                                                             |
| `tags`      | string[]              |          | Labels a game reads, e.g. a room name.                                                                                                                                    |
| `behaviors` | object                |          | Behavior blocks by name: each a typed set of fields this entity carries. `{}` carries a behavior with all its defaults; the type's required behaviors are always present. |

#### `note`

Editor note: text pinned to a point. Never loaded into the game.

| Field  | Type             | Required | Description                                  |
| ------ | ---------------- | -------- | -------------------------------------------- |
| `at`   | [point](#points) | yes      | Where the note shows, absolute world metres. |
| `text` | string           | yes      | The note, for whoever edits the scene next.  |

### Shapes

A shape tuple: ["box", cx, cy, hw, hh, rotDeg?] | ["circle", cx, cy, r] | ["capsule", cx, cy, halfLen, r, rotDeg?] | ["poly", x1, y1, x2, y2, x3, y3, ...] | ["chain", x1, y1, x2, y2, ...]. Metres, y is down; rotDeg in degrees.

A body shape is any of these but `chain`.

- **`box`** `["box", cx, cy, hw, hh, rotDeg?]`: Axis-aligned box (a Rapier cuboid) by centre and half-extents, optionally rotated about its centre. Items: Centre x (m); Centre y (y is down) (m); Half-width; the box is 2*hw wide (m); Half-height; the box is 2*hh tall (m); Rotation in integer degrees, clockwise on screen (y is down). Omitted means 0 (deg).
- **`circle`** `["circle", cx, cy, r]`: Circle (a Rapier ball) by centre and radius. Items: Centre x (m); Centre y (y is down) (m); Radius (m).
- **`capsule`** `["capsule", cx, cy, halfLen, r, rotDeg?]`: Capsule, vertical before rotation: a segment of half-length halfLen through the centre, swept by radius r. Items: Centre x (m); Centre y (y is down) (m); Half the length of the inner segment (m); Radius (m); Rotation in integer degrees, clockwise on screen (y is down). Omitted means 0 (deg).
- **`poly`** `["poly", x1, y1, x2, y2, x3, y3, ...]`: Convex polygon as flat x, y pairs (at least 3 points). Points are absolute; the loader centres the body on their centroid. Concave outlines must be split or drawn as a chain.
- **`chain`** `["chain", x1, y1, x2, y2, ...]`: Open polyline as flat x, y pairs (at least 2 points), for static terrain. Allowed on solid and sensor only.

### Points

A point [x, y] in world metres; y is down.

### Paths

A waypoint path with linear segments.

| Field     | Type                      | Required | Description                                                                                                                     |
| --------- | ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pts`     | [point](#points)[]        | yes      | Waypoints in absolute world metres. The entity's shape is centred on each point in turn. At least 2, no repeats.                |
| `mode`    | `"ping_pong"` \| `"loop"` | yes      | ping_pong: travel to the last point, then back. loop: after the last point, travel back to the first along the closing segment. |
| `speed`   | number (m/s)              | yes      | Travel speed along the path, m/s; must be > 0.                                                                                  |
| `pauseMs` | number (ms)               |          | How long it waits at each waypoint, in milliseconds. Omitted means 0.                                                           |

<!-- format-reference:end -->
