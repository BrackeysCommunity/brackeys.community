# Scene CLI

Read, check, edit and step scenes, and manage a project's assets, from a
terminal or an agent. The CLI works on **projects**: every
`jams.project.json` under `src/` (`src/games/platformer/` holds the
platformer's, `src/games/tactics/` the tactics game's, `packages/engine/scenes/`
the engine's, whose scenes name no game), found by `discoverProjects` in
`projects.ts`; `game new` scaffolds another ([New games](#new-games)). It is built only from the
engine's public entries (`@jams/engine/scene`, `/headless`, `/game`,
`/project`, `/collab`, `/vite`) and each game's entry, and every command is
a pure function in `tools/`, which the MCP server (`mcp.ts`,
[below](#mcp)) reuses.

```sh
vp run scene list
vp run scene show test-yard --type mover
vp run scene validate test-yard
vp run scene validate test-yard --physical
vp run scene check engine-yard
vp run scene schema scene --game platformer
vp run scene step test-yard --ticks 60 --hold move_right
vp run scene project tree --project engine
vp run scene assets list --project platformer
```

`vp run` prints one banner line before the command's output. When you parse
`--json`, call the script directly so stdout is only the JSON:

```sh
bun scripts/scene/cli.ts validate test-yard --json
```

Text output is terse; `--json` is the full structured result. Exit codes:
`0` ok, `1` error-severity issues or a failure, `2` usage, `3` stale base
(file batches only; a live batch that fails its `base` exits 1).

## Scenes and games

A scene names its game with a top-level `"game": "platformer"` key. That
picks the registry every command uses: the game's entity types, bulk keys,
materials, settings, actions and issue codes, plus the material assets of the
project that game belongs to. A scene without `game` uses the engine's
primitives only (`solid`, `sensor`, `marker`, `prop`, `follower`, `decor`, `nav`, `note`),
with the engine project's materials, and means the same to every tool. A
`game` no project has is an `unknown-game` issue.

A scene argument is a name (`test-yard`): the scene's asset id, looked up in
every project with the same guard as the dev server's collab server
(lowercase letters, digits and dashes only). A name two projects hold is
refused with exit 2 until `--project <id>` picks one, and `list` reports
the clash. Every command takes `--project`.
`show`, `step`, `validate`, `diff`, `playtest`, `fuzz` and `render` also
take a file path or `-` for stdin, read-only, and `check` a file path; `fmt`,
`apply` and `new` write, so they take names only. `step`, `playtest`, `fuzz`
and `check` run a scene without a `game` key under one with `--game <id>`;
`--game` on a scene that names a game is a usage error.

Scenes to practise on: `test-yard` (the platformer's), `level-1` (the
tactics game's: a turn game on a grid, driven by commands) and `engine-yard`
(primitives only).

## Commands

| Command                                                                                                                                                                                                                                              | Writes                   | What it returns                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list`                                                                                                                                                                                                                                               | no                       | every scene with its `game`, `sceneHash`, issue counts, entity counts per type and bounds, `clashes`                                                                                                                                                                                                                                                                                 |
| `show <scene\|file\|-> [--ref id] [--type t] [--near x,y,r]`                                                                                                                                                                                         | no                       | entities and bulk entries with their ref, type, raw shape, world AABB and top span, plus `sceneHash`, the time model and the physics backend                                                                                                                                                                                                                                         |
| `schema [scene\|ops\|script\|checks\|recording\|fragment\|prefab\|project\|asset-sidecar\|project-ops\|project-snapshot\|save\|material\|game-settings\|data-table\|<doc kind>] [--game id]`                                                         | no                       | a JSON Schema the engine serves (`urn:jams-engine:<kind>[:<game>]:v<n>`): a game's scene, ops, script, checks, fragment, prefab and doc kinds; the recording, project and save schemas                                                                                                                                                                                               |
| `codes`                                                                                                                                                                                                                                              | no                       | `agentSurface` and every issue code with its severity, summary, hint and fixability, grouped by owner                                                                                                                                                                                                                                                                                |
| `flow [--project p]`                                                                                                                                                                                                                                 | no                       | each project's scene list: its start, every listed scene's title, sublevel tag, physics and bundle bytes, the scenes it leaves out, and its issues; exit 1 on an error; see [Flow](#flow)                                                                                                                                                                                            |
| `validate <scene\|file\|-> [--physical]`                                                                                                                                                                                                             | no                       | `SceneIssue[]` with JSON Pointer paths and line numbers; `--physical` adds the physics world's; exit 1 on errors                                                                                                                                                                                                                                                                     |
| `fmt [asset] [--check]`                                                                                                                                                                                                                              | yes, unless check        | rewrites a doc asset (or every one) in its kind's canonical form; `--check` exits 1 when one isn't canonical                                                                                                                                                                                                                                                                         |
| `apply <scene> --ops <file\|-> [--dry-run] [--base hash] [--live …]`                                                                                                                                                                                 | yes, unless dry run      | the `ApplyResult`: diff, inverse, created ids, ref remap, issues and the new `sceneHash`                                                                                                                                                                                                                                                                                             |
| `diff <a> (<b> \| --git <rev> \| --ops <file\|->)`                                                                                                                                                                                                   | no                       | `changes`: what changed from the first side to the second, entity by entity                                                                                                                                                                                                                                                                                                          |
| `new <name> [--game id] [--from scene]`                                                                                                                                                                                                              | yes                      | writes a new scene from the game's template, or a copy of `--from` under the new name, as a `createAsset` (an id or path another asset holds is refused)                                                                                                                                                                                                                             |
| `step <scene\|file\|-> [--ticks N] [--hold a,b] [--inputs file] [--command tick[@seat]:name[=json]] [--elapse tick:ms] [--events type,…] [--game id] [--legal] [--timing]`                                                                           | no                       | a headless probe: events by entity id, spawns and destroys per type, the game's final snapshot, runtime stats; `--command` and `--elapse` repeat; `--legal` lists the commands legal after the last tick ([Legal commands](#legal-commands)); `--timing` times each tick's parts ([Timing](#timing))                                                                                 |
| `grid <scene> [--from c,r\|ref] [--to c,r\|ref] [--fov c,r:radius] [--diagonals]`                                                                                                                                                                    | no                       | the scene's grid as text: walls, a path between two cells or entities, what a cell sees; exit 1 with no path; see [World models](#grids-and-connected)                                                                                                                                                                                                                               |
| `playtest <scene\|file\|-> --script <file\|-> [--at x,y] [--events type,…] [--game id] [--record file] [--flow] [--from-save file] [--timing]`                                                                                                       | with --record            | a headless run of a v1 or v2 input script (`--at` in metres): outcome, steps, events, spawns and destroys per type, focus trail, `recording`, and a `legal` count for a game that lists its commands; `--flow` follows scene requests (`segments`), `--from-save` starts from a save fixture; `--timing` as `step`'s; exit 1 when blocked                                            |
| `replay <scene\|file\|-> --run <file\|-> [--game id] [--releases <dir>] [--versions <dir>]`                                                                                                                                                          | no                       | replays a run recording (or a playtest report's) headless, with the recorded engine, physics and platform and `migratedFrom 1` for a v1 file; `--releases` also names the build under the directory the run was made on (see [Game builds](#game-builds)); `--versions` reads the scene versions a run swapped to (see [Live levels](#live-levels)); exit 1 when it ends differently |
| `fuzz <scene\|file\|-> [--seed s] [--rollouts n] [--ticks n] [--game id] [--from-save file]`                                                                                                                                                         | no                       | seeded random rollouts: entities reached in N of M runs, first ticks, results, ticks per second, and for a game that lists its commands how many it sent; takes no script; `--from-save` starts every rollout from a save fixture                                                                                                                                                    |
| `save <scene\|file> --script <file\|-> --at <tick> --out <file>.save.json [--depth world\|progress] [--now ms] [--flow]`                                                                                                                             | yes                      | runs the script to the tick and writes a `save:v1` fixture there (inside a project, as a `save` asset); refused with `save-unsupported` and its causes; `--flow` follows scene requests through the scene list; see [Saves](#saves)                                                                                                                                                  |
| `input [--project p] [--player n] [--json]`                                                                                                                                                                                                          | no                       | each seat's resolved bindings per action, layer by layer (the input map's, then the game's), which one the seat uses, and their issues; loads no Rapier; see [Input v2](#input-v2)                                                                                                                                                                                                   |
| `check <scene\|file> [--checks file] [--only id] [--game id]`                                                                                                                                                                                        | no                       | runs `<scene>.checks.json`; each check passes, fails or is skipped; exit 1 when one fails                                                                                                                                                                                                                                                                                            |
| `render <scene\|file\|-> [--out file] [--ascii] [view flags…]`                                                                                                                                                                                       | with --out               | a schematic PNG or SVG of the scene, or `--ascii` a character map; see [Rendering](#rendering)                                                                                                                                                                                                                                                                                       |
| `textconv <file>`                                                                                                                                                                                                                                    | no                       | a scene as one sorted line per header field, bulk entry and entity, for `git diff`                                                                                                                                                                                                                                                                                                   |
| `bundle <scene>`                                                                                                                                                                                                                                     | no                       | the texture blobs a scene loads (sorted, deduplicated, with bytes and a total); `asset-missing` issues with a did-you-mean, exit 1 on them                                                                                                                                                                                                                                           |
| `project show`                                                                                                                                                                                                                                       | no                       | the project's id, name, game, live assets by kind, code modules, file problems and storage usage                                                                                                                                                                                                                                                                                     |
| `project tree`                                                                                                                                                                                                                                       | no                       | folders, live assets and read-only code modules, as the editor's tree panel shows them                                                                                                                                                                                                                                                                                               |
| `project refs [id]`                                                                                                                                                                                                                                  | no                       | what an asset names and what names it; without an id, every dangling reference; exit 1 on dangling ones                                                                                                                                                                                                                                                                              |
| `project snapshot [--out file\|-]`                                                                                                                                                                                                                   | with --out               | every live asset pinned by SHA-256; its `hash` is what a file batch's `base` names                                                                                                                                                                                                                                                                                                   |
| `project pull <project> --url https://site [--out dir] [--check]`                                                                                                                                                                                    | unless --check           | every file the hosted project changes (added, changed, removed); exit 1 with `--check` when one would                                                                                                                                                                                                                                                                                |
| `project push <dir> --create --url https://site [--dry-run]`                                                                                                                                                                                         | the site, unless dry run | the files, docs and uploads a new hosted project was seeded with; with `--dry-run`, the docs it would seed and the binaries it would upload                                                                                                                                                                                                                                          |
| `assets list [--kind k] [--trash] [--live]`                                                                                                                                                                                                          | no                       | each live (or trashed) asset: project, path, kind, id, key, name, bytes, hash                                                                                                                                                                                                                                                                                                        |
| `assets info <id> [--frame f]`                                                                                                                                                                                                                       | no                       | an asset's kind, hash and bytes; a texture's size, pivot, nine-slice and filter; an atlas's frames, tags and texture; `--frame` for one frame's size and pivot                                                                                                                                                                                                                       |
| `assets import <file> [--path p] [--id id] [--kind k] [--settings json]`                                                                                                                                                                             | yes, unless dry run      | bytes to the content store, then `importAsset` (a doc kind's JSON: `createAsset`); the file, sidecar and entry                                                                                                                                                                                                                                                                       |
| `assets rename <id> [--name text] [--file name.ext]`                                                                                                                                                                                                 | yes, unless dry run      | `renameAsset`: the display name and the file name in place; the id stays                                                                                                                                                                                                                                                                                                             |
| `assets move <id...> --to <folder/>`                                                                                                                                                                                                                 | yes, unless dry run      | `moveAsset`, sidecars included                                                                                                                                                                                                                                                                                                                                                       |
| `assets delete <id> [--force]`                                                                                                                                                                                                                       | yes, unless dry run      | `deleteAsset` to the trash; `asset-in-use` while something names it, unless `--force`                                                                                                                                                                                                                                                                                                |
| `assets restore <id>`                                                                                                                                                                                                                                | yes, unless dry run      | `restoreAsset` from the trash                                                                                                                                                                                                                                                                                                                                                        |
| `assets change-id <id> <new-id>`                                                                                                                                                                                                                     | yes, unless dry run      | `changeAssetId`: the new id and every reference to it, in every doc, as one batch                                                                                                                                                                                                                                                                                                    |
| `assets set-import <id> --set <json\|key=value,…>`                                                                                                                                                                                                   | yes, unless dry run      | `setImport` per field (`null` resets one); meta is re-inspected                                                                                                                                                                                                                                                                                                                      |
| `assets apply --ops <file\|->`                                                                                                                                                                                                                       | yes, unless dry run      | any project op batch (`schema project-ops`), which may span docs                                                                                                                                                                                                                                                                                                                     |
| `game new <id> [--name "Title"] [--preset top-down\|side-view\|grid\|turns] [--physics none\|rapier] [--gravity x,y] [--time fixed\|turns\|event] [--rate n] [--grid square\|hex\|none] [--cell n] [--px-per-metre n] [--dir src/games] [--dry-run]` | yes, unless dry run      | a new game project from a preset: its files, its scene's issues, the URLs that open it on the dev site and the playtest command; see [New games](#new-games)                                                                                                                                                                                                                         |
| `game build <id> [--target web\|itch] [--out dist/games/<id>/<target>] [--rapier standard\|compat] [--allow-over-budget]`                                                                                                                            | yes, under `dist/`       | a static build of the project: the listed scenes and what they reach, the code, `release.json`, credits and for `web` the PWA files; prints scenes and physics, bytes per role, the budget, credits gaps and the wasm line; the bundle report beside it; exit 1 on an error issue (over budget: written, and accepted with `--allow-over-budget`); see [Game builds](#game-builds)   |
| `game export <id> --zip [--target itch\|web] [--out dist/games/<id>-<target>.zip]`                                                                                                                                                                   | yes, under `dist/`       | builds, then zips the build (stored, sorted, fixed times); the `itch` target checks itch.io's HTML5 layout; nothing is uploaded                                                                                                                                                                                                                                                      |
| `game manifest <dir\|release.json>`                                                                                                                                                                                                                  | no                       | parses and checks a release manifest, with the build's files and their hashes when given its directory, and prints its summary; exit 1 when it doesn't hold together                                                                                                                                                                                                                 |
| `game live build <project> <scene> [--hosted] [--out <dir>]`                                                                                                                                                                                         | yes                      | builds one scene's version from the project's files, or with `--hosted` from a pull of the hosted project, into `--out`: `scene-version.json` and the texts it carries; prints its id, data size and files; see [Live levels](#live-levels)                                                                                                                                          |
| `game live check <project> <scene> [--against <release dir\|release.json>] [--from <version dir>]`                                                                                                                                                   | no                       | builds the version and checks it: compatibility with `--against`'s release, and the swap check from that release's scene or from `--from`'s version; with neither flag it only validates, with a `warning:` naming them; exit 1 on an error issue                                                                                                                                    |

The `assets` writers and `apply` also take `--dry-run`, `--live`, `--url`,
`--token`, `--agent` and `--on-behalf-of`; the `assets` writers take `--base` (see
[Projects and assets](#projects-and-assets)).

Every JSON report names the scene hash `sceneHash`. `show` returns at most
200 rows and sets `truncated: true` past that; narrow it with a filter.
`show` rows put an entity's shape, point and the AABB first and every other
field in `extra`; a shape that rides a path (a `follower`, the platformer's
`mover`) is placed at its first path point. A group member's row also has
the group's `origin`: its `shape` and `at` stay as stored, relative to it,
while its AABB and `--near` are in world metres. Each prefab instance is a row of
type `instance` (its `prefab`, its world `at`, the rest in `extra`) followed by
its children as `gate-3/door` rows in world coordinates, each naming its
`instance`; edit those with `override`, not `update`. A nested child's row
is `room-1/door-1/panel` with its `instancePath` (`["room-1", "door-1"]`),
and an instance's row lists the instances `nested` in it, the `params` it
sets and the ones its prefab `exposes`. Rows also carry `z`, `transform`
(the world `rot` and `flip` their groups and instances give them, when not
the identity), `behaviors`, and for each grid field a `grids` summary:
filled cells, chunks and the filled cells' bounds. A row with a sprite has
`sprite`: its `label` (`asset[:frame]`), `asset`, `frame`, drawn `size` and
the world `aabb` it draws, the same box `render` outlines.

`diff` reports `{ from, to, changed, changes }`, each change a
`SceneChange`: `added`, `removed`, `renamed` (an entity whose content is the
same under a new id), `modified` (one field path), `moved`, or `scene` (the
header and `settings` keys). Bulk entries are compared per key by index.
With `--git <rev>` the revision is the old side, as in `git diff <rev>`; with
`--ops` the second side is the first with the batch applied, and nothing is
written.

`new` writes into a project: `--project`'s, else the one whose game the
scene is for (`--game`), the engine's without one, or the `--from` scene's,
beside that project's other scenes. Without `--from` it starts from the
game's template (the platformer's has a floor, a spawn, the cheese, the hole
and a kill plane), or an empty 19.2 × 10.8 m world for a scene without a game. It
sets `$schema` to the schema file the project's scenes point at and writes
nothing when the name is taken in any project or the result has errors.

`fmt` formats any doc asset through its kind's own format (a scene, a
prefab, a `.checks.json`, a `.script.json`, a material, a table), by id;
without one it formats every doc asset of the projects in scope. A scene or
prefab at an older format version is migrated to the current one (v3), and
the result says `migratedFrom`.
`schema` serves every schema the engine publishes; `schema <doc kind>`
also gives a game's own doc kinds.

`step` reports `{ scene, game, sceneHash, configHash, tickRate, ticks,
load, events, truncated, final, outcome?, legal?, legalTruncated?, stats }`;
`legal` is there for a game that lists its commands, and `--legal` prints
it too. `final` is the game's
own snapshot (the platformer's is its player: position, velocity, state,
grounded, `groundId`), and `null` for a scene stepped without a game: the
engine has no player, so read its `events` and `stats` instead. `events` are
the engine's `sensor:enter` / `sensor:exit` (`entityId` the sensor, `other`
what crossed it) and the game's own (the platformer's `landed` and
`left-ground`). `configHash` changes with the engine version, the game and
its tuning, so a stale report can be told from a fresh one. A scene without
a game steps under one with `--game <id>`; `--game` on a scene that names a
game is a usage error.

A step that an engine error stops ends `blocked` at stage `run` (exit 1), as
a playtest does: `{ ok: false, blocked: true, stage, issues, … }` with the
code on its issue, and the report's `ticks`, `events` and `final` cover the
ticks before it.

`step` and `playtest` count spawns and destroys per entity type, and
`--events type,…` prints only those event types; see
[Lifecycle](#lifecycle). `--timing` adds where each tick's wall time went
(`stats.timing`); see [Timing](#timing).

`apply` writes only when the batch applied and left no error-severity
issue. `step --inputs` takes a JSON array of `[tick, action, 0|1]` edges;
`--hold` presses actions at tick 0 and never releases them. Action names
are the game's (the platformer's are `move_left`, `move_right`, `jump`,
`move_down`, `dash` and `grapple`), and any other name is a usage error
with a suggestion; the simulation runs at the game's tick rate (`tickRate`
in the report; 60 unless its time model or the project says otherwise).
`--command` and `--elapse` send commands (see [Game commands](#game-commands)).

## Projects and assets

A project is a folder with a `jams.project.json` (`schema project`): its
`id`, `name`, the module exporting its game (or `null`), and globs of the
files that may be assets (`assets`) and code (`code`). Every file under the
asset globs that an asset kind claims is an asset: scenes, prefabs, checks,
input scripts, materials, game settings, data tables, and binaries
(textures, atlases, fonts, audio, recordings), each with an id that never
changes when the file is renamed or moved. A binary's bytes are kept by
SHA-256 in the content store, and it has a `<file>.asset.json` sidecar
(`schema asset-sidecar`) with its id, hash, import settings and the meta
read from its header.

```sh
vp run scene project show --project engine
vp run scene project refs engine-yard
vp run scene project snapshot --project engine
vp run scene assets list --project engine
vp run scene assets info crates --frame crate-0
vp run scene bundle kitchen-sink
vp run scene assets import scripts/scene/examples/dot.png --path art/ --project engine --dry-run
vp run scene assets rename engine-yard --name Yard --dry-run
vp run scene assets move engine-yard-checks --to checks/ --dry-run
vp run scene assets change-id engine-yard yard --dry-run
vp run scene assets apply --ops scripts/scene/examples/name-yard.json --dry-run
vp run scene schema project-ops
```

Every `assets` writer builds a project op batch (`schema project-ops`; the
op names are `createAsset`, `importAsset`, `renameAsset`, `moveAsset`,
`deleteAsset`, `restoreAsset`, `changeAssetId`, `setImport`,
`replaceContent`, `setLicence`, `editAsset` and `editScene`) and applies it
the way the dev server does: the docs it touches are loaded, the whole batch
is checked across them, and each doc gets one change. A batch the engine
refuses writes nothing anywhere and exits 1; one that leaves error-severity
issues (a `--force` delete's dangling references) is written and exits 1.

- **On files** (the default) the files, sidecars, the trash and the dev
  cache (`node_modules/.cache/jams-engine/<project>`) are written. `--base
<hash>` pins the batch to `project snapshot`'s hash; a project that moved
  on exits 3 (`stale-base`).
- **`--live`** applies it on the running dev server's docs as an agent
  (`--agent`, default `scene-cli`, and `--on-behalf-of`), so open editors
  see it land; the server writes the files back. A binary is uploaded
  first (`POST /__project/<id>/blob`), then `importAsset` names its hash.
  A live batch takes no `base`. With a site `--url` and an agent token it
  goes to a hosted project instead (see [Hosted projects](#hosted-projects)).
- **`--dry-run`** reports what the batch would do and writes nothing: no
  file, no cache, no upload.

An asset id is looked up across projects; one that two projects hold needs
`--project` (exit 2 without it). `assets import` and `assets apply` with no
id to go by need `--project` when there is more than one project. The
kind of an imported file comes from its name (`.png`, `.checks.json`) or a
JSON file's `kind`; `--kind` overrides it, and `--path` (a path, or a folder
ending in `/`) overrides the kind's default folder.

`assets info` is what headless code and the editor know of an asset
without decoding or fetching it, read from its entry: the kind, hash and
bytes; a texture's pixel size and its import `pivot`, `nineSlice` and
`filter`; an atlas's frame names in file order, its tags and its texture's
id. `--frame` narrows an atlas to one frame's size, rectangle and pivot (a
frame without its own takes the atlas's `pivotDefault`); an id with no live
asset, or a frame the atlas lacks, exits 1. `bundle <scene>` lists the
texture blobs a scene loads, sorted by id and deduplicated, with each
one's hash and bytes and the total. It reads every asset field of the
expanded scene (instances resolved and defaults applied, so an id only a
type's default names counts; a sprite's `asset` among them), its settings'
asset fields and the `assets` headers of the scene and of every prefab it
reaches, and follows each asset's own references (an atlas brings its
texture). Only textures are entries; an atlas's frames ride in its meta. An
id it can't resolve is `asset-missing` with a did-you-mean, and exits 1.

The readers `project tree`, `project refs` and `assets list` take `--live` too:
they read the dev server's registry and docs (or a hosted project's), unsaved
edits included, instead of the files.

## New games

`game new <id>` writes a whole game project into `<dir>/<id>/` (`--dir`,
default `src/games`) that validates, plays to its goal headless and passes
`vp check` as written. The site needs no edit: it hosts every project under
`src/games/` whose game is `index.ts` and whose UI is `ui/index.ts`.
Dry-run first; it lists the files and writes none:

```sh
vp run scene game new maze --preset grid --dry-run
vp run scene game new leap --preset side-view --dry-run
vp run scene game new <id> --name "My Game" --preset turns
```

```text
maze: would create src/games/maze (grid, physics none, time event 60, square grid 1 m, 32 px per metre)
  src/games/maze/__tests__/game.test.ts
  …
  src/games/maze/ui/index.ts
play:     /game/dev?game=maze
edit:     /game/dev?edit=1&project=maze
playtest: vp run scene playtest main --project maze --script src/games/maze/scenes/main.script.json
```

**Presets.** Each states every world and time field, whether or not it is
the engine's default. `top-down`, `grid` and `turns` have physics `none`
and gravity `[0, 0]`; `side-view` runs on Rapier with gravity `[0, 20]`,
down, and puts its goal on a ledge a jump up. Each has a `hero` that
reaches a `goal` sensor. The `top-down` and `side-view` heroes are made of
[standard behaviors](#standard-behaviors) on the `hero` type (a marker),
so the game writes no movement code, and each scaffold's test plays its
hero to a `near` the goal.

| Preset               | Clock         | Grid                        | px per metre | The hero                                                                                                      |
| -------------------- | ------------- | --------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| `top-down` (default) | `fixed` 60 Hz | none                        | 100          | `collider`, `character-top-down`, `player-input` and `camera-target` blocks, walked by the `move` vector      |
| `side-view`          | `fixed` 60 Hz | none                        | 100          | `collider`, `character-side-view`, `player-input` and `camera-target` blocks, run by `move` and `jump`        |
| `grid`               | `event` 60 Hz | `square`, 1 m cells (32 px) | 32           | a `createGridStepper` that steps a cell per `move`                                                            |
| `turns`              | `turns` 60 Hz | `square`, 1 m cells (32 px) | 32           | one `step { dir }` command, its legal list from `GamePlayDef.commands`; `move` is UI-only, sent on by the HUD |

**Flags** override the preset's fields: `--physics none|rapier` (the same
code runs on Rapier), `--gravity x,y` in m/s², `--time fixed|turns|event`,
`--rate n` (an integer from 1 to 240), `--grid square|hex|none`, `--cell n`
(the cell in metres), `--px-per-metre n` (`world.lengthUnit`, how many px
a metre draws) and `--name "Title"` (default the id in title case). A flag
the preset can't take is a usage error (exit 2) that says why: `--time
turns` needs the `turns` preset, the `grid` and `turns` presets step on a
square grid, and `--cell` needs a grid.

```sh
vp run scene game new drift --physics rapier --gravity 0,9.8 --rate 30 --px-per-metre 64 --dry-run
vp run scene game new hop --preset turns --cell 0.5 --px-per-metre 48 --dry-run --json
```

**What it writes:**

| File                                               | What it holds                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `jams.project.json`                                | the id, name, `game` (`./index.ts`, `<camel>Game`) and `ui` (`./ui/index.ts`, `mount<Pascal>Hud`), assets and code globs |
| `index.ts`                                         | `defineGame`, with `world` (`physics`, `gravity`, `grid`, `lengthUnit`) and `time` (`kind`, `rate`) spelled out          |
| `types.ts`, `actions.ts`, `template.ts`            | the `hero` type and the snapshot; the actions and their bindings; the scene template `scenes/main.json` comes from       |
| `runtime.ts`, `play.ts`                            | `createRuntime` (`snapshot`, `storeSlice`, `busy()` on a turns clock); results, `outcome` and `commands()`               |
| `ui/index.ts`, `ui/hud.ts`                         | a framework-free HUD through `bindText`: a status line and one button; no editor code                                    |
| `scenes/main.json`, `.checks.json`, `.script.json` | the scene (format v4, in metres), a `reaches` check from the spawn to the goal, an input script that wins                |
| `game-settings.json`, `input-map.json`             | the project's settings and input map docs                                                                                |
| `scene.schema.json`, `input-script.schema.json`    | generated from the game's registry                                                                                       |
| `__tests__/game.test.ts`                           | the schemas are current (`UPDATE_SCHEMAS=1` rewrites them), the scene validates and the script wins headless             |

**Refusals** write nothing and exit 1: an id outside the project id pattern
(up to 48 lowercase letters, digits and dashes, starting with a letter or
digit) is `schema`;
an id a discovered project holds, or a directory that already exists, is
`project-id-taken`; a generated scene, checks file or script with an error
issue is refused with that issue.

```sh expect=project-id-taken
vp run scene game new tactics --dry-run --json
```

```sh expect=project-id-taken
vp run scene game new examples --dir scripts/scene --dry-run --json
```

```sh expect=schema
vp run scene game new My_Game --dry-run --json
```

**Then** open it. The game plays at `/game/dev?game=<id>` and its editor
opens at `/game/dev?edit=1&project=<id>` (the Project panel's switcher
lists it too), on `vp dev`. The editor comes from `@jams/engine/editor-ui`,
so the project holds none of it. Headless, its own commands work at once:
`vp run scene validate main --project <id>`, `vp run scene playtest main
--project <id> --script src/games/<id>/scenes/main.script.json` (`won`)
and `vp test src/games/<id>`. Outside `src/games` (another `--dir`) the
CLI still finds the project, but the site doesn't host it, and the command
says so. MCP's `game_new` takes the same inputs and is a dry run unless
`dryRun` is `false`.

## The edit loop

Every change goes through ops, never a hand edit. The loop is the same for
every scene:

1. **Read.** `show`, narrowed to where you're working. Note the `sceneHash`
   and the refs you want: entity ids, or `~bulk:index` refs such as
   `~solid:4`.
2. **Write the change as ops** in a file. `schema ops --game <id>` is the
   reference; `examples/` has the batches used below.
3. **Dry run** and read the diff and issues: `apply --dry-run`, or
   `diff --ops` for the changes alone. The dry run's `issues` are what
   `validate` would report after the change.
4. **Step** across the change, for a game's scene.
5. **Apply** for real: drop `--dry-run`.
6. **Check the file**: `fmt --check` and `validate`, and `diff --git HEAD`
   to review everything since the last commit.

On the platformer's `test-yard`, raising the elevator's top stop
(`examples/raise-elevator.json` sets `path.pts.1`):

```sh
vp run scene show test-yard --near 13,7,2
vp run scene schema ops --game platformer
vp run scene apply test-yard --ops scripts/scene/examples/raise-elevator.json --dry-run
vp run scene diff test-yard --ops scripts/scene/examples/raise-elevator.json
vp run scene step test-yard --ticks 240 --hold move_right --inputs scripts/scene/examples/jumps.json
vp run scene apply test-yard --ops scripts/scene/examples/raise-elevator.json
vp run scene fmt test-yard --check
vp run scene validate test-yard
```

Check that the `landed` events name the surfaces you expect.

On the gameless `engine-yard`, slowing the lift (`examples/slow-lift.json`
sets `path.speed`). Without a game there are no actions and `final` is
`null`; step it to see the sensor events and the runtime's stats:

```sh
vp run scene show engine-yard --type follower
vp run scene apply engine-yard --ops scripts/scene/examples/slow-lift.json --dry-run
vp run scene step engine-yard --ticks 120
vp run scene apply engine-yard --ops scripts/scene/examples/slow-lift.json
vp run scene fmt engine-yard --check
vp run scene validate engine-yard
```

On the tactics game's `level-1`, a turn game with no physics, step for
the legal list instead of a trail (see [Legal
commands](#legal-commands)). `examples/ford-crossing.json` adds a `rough`
ford on the north crossing, costing one extra move per cell, and makes the
thicket costlier; `grid` shows the path a unit would walk, and the
`sides-connected` check must still pass:

```sh
vp run scene show level-1 --type rough
vp run scene apply level-1 --ops scripts/scene/examples/ford-crossing.json --dry-run
vp run scene diff level-1 --ops scripts/scene/examples/ford-crossing.json
vp run scene apply level-1 --ops scripts/scene/examples/ford-crossing.json
vp run scene grid level-1 --from blue-knight-1/unit --to red-knight/unit
vp run scene step level-1 --ticks 1 --legal
vp run scene check level-1
vp run scene fmt level-1 --check
```

Moving a unit is an `update` of its instance's `at` (`blue-archer`, not
`blue-archer/unit`), on a cell centre: cells are 1 m, so `[2.5, 4.5]` is
cell `[2, 4]`:

```json scene=level-1
{ "ops": [{ "op": "update", "ref": "blue-archer", "set": { "at": [2.5, 4.5] } }] }
```

A new level starts from the game's template, or from a copy of a scene:

```sh
vp run scene new my-level --game platformer
vp run scene new yard-copy --from test-yard
```

If you edited JSON by hand anyway, run `fmt` and then `validate`.

## Playtests and fuzz

`playtest` plays an input script, a small JSON language that compiles to
each tick's input, on a fresh play world started the way the editor's Play starts
one: validation errors block, and `at` (or `--at x,y`, which overrides it)
is cast down onto the first surface with the game's spawn shape and refused
inside a solid. `schema script --game <id>` is the reference; a script's
`$schema` points at the committed `src/games/<id>/input-script.schema.json`
(the engine's is `packages/engine/scene/input-script.schema.json`).

- Scripts are `"v": 2`; analog values, the pointer, seats and per-seat
  tracks are in [Scripts v2](#scripts-v2).
- Steps: `{ "hold": [...], "for": ticks }`, `"forMs"` (rounded to whole
  ticks at the game's rate) or `"until": {...}` capped by `"max"` (default 600); `{ "press": a }`
  for one tick; `{ "wait": n }`; `{ "command": name, "args"? }` and
  `{ "elapse": ms }` send a command (see [Game commands](#game-commands)). A step names everything held during it;
  what the step before held and this one doesn't is released when it starts.
- `until` keys AND together and are checked after each tick: `event` (a
  type, or `{ type, entityId?, other? }`), `tick` (absolute), `exists` (an
  id that exists and is enabled, `"boss#1"`; `{ "id": "boss#1", "enabled":
false }` holds while it exists at all), `count` (entities matching a
  selector of `type`, one or a list, `tag` and `enabled`, kept within
  `min`/`max` or at `eq`: `{ "type": "enemy", "max": 0 }`), `near` (an
  entity's pose within `within` metres of a point or of another entity:
  `{ "id": "hero", "to": [4, 2], "within": 0.5 }`; see
  [Standard behaviors](#standard-behaviors)), `scene` (the
  main scene is this one, once a `--flow` run followed a request there),
  `persist` (a value in the game's persistent state, by JSON Pointer:
  `{ "pointer": "/cleared/0", "eq": "level-1" }`, or `gte`/`lte` for a
  number; see [Flow](#flow)), and the game's predicates (the platformer's
  `grounded`). A game predicate can't be named `exists`, `count`, `near`,
  `scene` or `persist`.
- `maxTicks` (default 1800), `scene` (a run against another scene is
  refused), `at`, `timeOffsetMs`, `game` for the game's play options, and
  `seed` (a number or a string) for the game's `ctx.random`; without one the
  run draws from a seed of the game's and the scene's names. The seed is the
  recording's `seed`, so `replay` draws the same numbers.

The run ends with the game's outcome (its `play.outcome` hook; the
platformer declares none yet), `stuck` (a movement action held while the
focus moves under 0.04 m in 120 ticks), `script-end` or `timeout`. The report
has `outcome` (`result`, `tick`, `at`, `cause`), `steps` (each started
step's start tick, length and why it ended: `done`, `until`, `max` or
`run`), `events` (at most 1000, then `truncated`), `trail` (the focus every
4 ticks), `final` (the game's snapshot), `stream` (every seat's input and the system events, as a v2 recording
holds them), `inputs` (deprecated: seat 0's `[tick, action, 0|1]` edges
played, `until` steps resolved), `sceneHash` and `configHash`, and for a
game that lists its commands `legal` ([Legal commands](#legal-commands)). A
script that doesn't compile, a scene with errors or a start that doesn't
load is `blocked` with its `stage` and issues, and exits 1, and so is a run
an engine error stops mid-step (stage `run`, the error's code on its issue,
such as `event-loop` or `spawn-id-invalid`); an unknown
action or key gets a "did you mean". Pass the report to `render --overlay`
to see its trail.

`fuzz` runs seeded random rollouts (`--rollouts`, default 100, each up to
`--ticks`, default 600). Each starts like Play and holds one or two random
actions for 4–60 ticks at a time, or the game's own macros. It reports each
entity an event named (`touched`, by id or bulk ref, `reached` in how many
rollouts, `firstTick` and `firstRollout`; a runtime `#` id is never counted),
the loadable entities nothing touched (`untouched`), how the rollouts ended (`results`) and the measured
`timing`. The same `--seed` (a number or a string, default 1) gives the
same report apart from `timing`, and a longer fuzz repeats a shorter one's
first rollouts. It takes no script: its rollouts are the default macro's
moves (analog and pointer ones too when the game has axis, vector or
pointer actions) or the game's `play.macro`, and a scripted run is a
`playtest`. A game that lists its commands is fuzzed by sending them
instead ([Legal commands](#legal-commands)).

```sh
vp run scene schema script --game platformer
vp run scene playtest test-yard --script scripts/scene/examples/hop-left.json
vp run scene playtest test-yard --script scripts/scene/examples/hop-left.json --at 3,6
vp run scene fuzz test-yard --seed 1 --rollouts 20 --ticks 300
```

`examples/hop-left.json` walks left, jumps, and holds on until a `landed`
event names `~solid:7`.

**Recordings.** `playtest --record run.json` writes the run's recording (it
is also the report's `recording`); the editor's **Load run** takes either,
and each Play in the editor becomes the loaded run after Stop. `replay`
plays one again and exits 1 when it ends differently (another result, tick
count or end state), which makes a recording a regression test for tuning:

```sh
vp run scene playtest test-yard --script scripts/scene/examples/hop-left.json --record hop.json
vp run scene replay test-yard --run hop.json
```

A scene that changed since the recording is a `warning stale: …` line, not
a failure by itself. What a recording holds, and how a v1 file replays, is
in [Recordings v2](#recordings-v2).

### Timing

`step --timing` and `playtest --timing` time each tick on the wall clock
and say where it went. Without the flag the runtime reads no clock and the
report is the same on every run; with it, the timing is the one part that
differs, and nothing of it reaches the events, the snapshot, a hash or a
recording.

```sh
vp run scene step engine-yard --ticks 120 --timing
vp run scene playtest test-yard --script scripts/scene/examples/hop-left.json --timing
```

```text
  timing (wall clock): 120 ticks in 4.8 ms, mean 0.040 ms, worst 1.071 ms
    physics.step                     2.1 ms  43.2%  mean   0.017  worst   0.331  ×120
    system.prop.afterStep            0.7 ms  14.4%  mean   0.006  worst   0.137  ×120
    …
    unattributed                     0.1 ms   1.6%
    by group: physics 43.2%, engine 55.2%, game 0.0%, unattributed 1.6%
```

Each row is one part of the tick, by total: its share of the ticks' total,
its mean per tick, the most it took in one tick, and how often it ran. The
parts, in the order a tick runs them:

| Part                                                  | What it times                                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `input`                                               | the tick's input applied to `ctx.input`, and its seat events                                  |
| `system.<type>.beforeStep`, `system.<type>.afterStep` | one entity type's system hook (`system.prop.afterStep` copies the props' poses out of Rapier) |
| `game.beforeStep`, `game.afterStep`, `game.snapshot`  | the game module's hooks                                                                       |
| `system.<type>.beforePhysics`                         | a system's last look before the world step (the sensor system's, from 32 sensors up)          |
| `physics.step`                                        | the Rapier world step; absent in a scene without physics                                      |
| `contacts`                                            | reading the watched contact pairs                                                             |
| `behavior.<name>`                                     | one behavior system's `step`                                                                  |
| `timers`, `events`, `lifecycle`                       | due timers, event dispatch, and the end-of-tick destroys and enables                          |

`unattributed` is the total less the parts. `by group` adds them up three
ways: `physics` is `physics.step`, `game` the `game.*` parts, `engine` the
rest. A part is charged everything that ran inside it: a game hook's
`ctx.space` query counts as the game's, a timer's or an event's handler as
`timers` or `events`, and a system's own calls into Rapier (a sensor's
overlap tests, a pose read) as that system's, so `physics` is the world
step alone, not all the time spent in Rapier's wasm.

`--json` carries it as `stats.timing` for `step` and `timing` for
`playtest`: `{ tick: { calls, totalMs, maxMs, unattributedMs, parts: {
<part>: { calls, totalMs, maxMs } } }, groups: { physics, engine, game,
unattributed } }`, times in ms. `tick.calls` is the ticks timed, a part's
`maxMs` its worst tick, and the first ticks carry the JIT's warm-up.

In a browser the tick has one more part, `view.commit` (the tick's poses
handed to the view), and the shell times three more spans: `shell`
(its whole tick: `input`, `step` (the runtime's, the `tick` span), the
`scene:step` `listeners`, the play `session` and recording, the `camera`
and store), `frame` (what it does each rendered frame before the draw:
`input`, `view.frame`, `behaviors.render`, `store`) and `draw` (Pixi's
render call on the CPU; the GPU's own time is not in it). A host turns it
on with `GameConfig.timing` and reads `game.runtime().stats().timing`. In a
dev host that passes the debug overlay (the site's editor does), switch it
on from the page while the game runs and read it back as JSON, refreshed
about twice a second:

```js
localStorage.setItem("debug-timing", "1");
JSON.parse(document.querySelector("script[data-jams-timing]").textContent);
localStorage.removeItem("debug-timing");
```

Setting the flag starts the numbers afresh. A browser's clock is coarse
(0.1 ms in Chrome, 1 ms in Firefox), so read totals and means over many
ticks, not a single part's `maxMs`.

## Physical validation

`validate --physical` also loads the scene into a headless world that is
never stepped and checks it with shape queries (the same checks can run on
the editor's edit world). The engine's: `follower-hits-solid` (warn: a
path follower, or a solid riding it, swept along each path segment, a
loop's closing one included, runs into a static solid; `at` is the impact point and `path` the
segment's first point) and `solid-overlap` (info: two static solids of one
type, material and one-way-ness overlap, so they could be one shape;
touching doesn't count). Then the game's: the platformer's
`platformer/spawn-in-solid` (error; its `fix` drops the spawn onto the
surface below the obstruction), `spawn-in-hazard` (error), `spawn-floating`
(warn: nothing under the player box down to the bounds' bottom),
`anchor-in-solid`, `anchor-orphan` (warn: nothing to stand on within the
grapple range) and `cloud-in-solid` (warn). A scene that doesn't load
reports only its structural issues.

## Checks

A scene's checks sit beside it as `<scene>.checks.json`, outside its hash;
`check <scene>` runs them, `--checks file` another file, `--only id` one.
`schema checks --game <id>` is the reference (`urn:jams-engine:checks:v3`,
`…:<game>:v3` with a game's kinds). Older files migrate on read, and `fmt`
writes them at v3, an inline script as `input-script:v2`.

```json
{
  "v": 3,
  "checks": [
    { "id": "valid", "kind": "valid", "physical": true },
    {
      "id": "settles",
      "kind": "reaches",
      "script": { "v": 2, "steps": [{ "wait": 60 }] },
      "result": "script-end"
    },
    { "id": "zone", "kind": "touches", "entity": "zone", "atLeast": 10, "rollouts": 50, "seed": 1 }
  ]
}
```

- `valid`: no issues at or above `max` (`error`, the default, or `warn`);
  `physical: true` adds `validate --physical`.
- `reaches`: the input script's playtest (`script` inline, or a file
  relative to the checks file; `at` overrides its start, and `nav`, a list
  of `{ id, to }`, sends nav agents on its first slot) ends with `result`,
  one of the run results (`timeout`, `script-end`, `stuck` and the game's).
  `expect` is an `until` clause every key of which must hold on the run's
  last tick; the verdict names the first key that fails, in the order the
  check wrote them. A blocked run fails, and so does an engine error thrown
  out of a step (a `blocked` run at stage `run`, its issue carrying the
  error's code).
- `touches`: at least `atLeast` of `rollouts` (default 100) fuzz rollouts
  (`seed` default 1, `ticks` default 600) touch `entity`.
- A game's kinds are `<game>/<kind>`, with the fields the game defines; the
  platformer has none yet (it declares no win result).
- `skip: "why"` reports a check as skipped without running it.

Each result has `id`, `kind`, `pass`, `message`, `skipped` when skipped
and a `detail` (the issues, the outcome, the rollout counts). An invalid
file exits 1 with issues pointing into it, with lines.

```sh
vp run scene check engine-yard
vp run scene check engine-yard --only settles --json
vp run scene schema checks
```

## World models

A world needn't be a side view stepped by Rapier sixty times a second. A
game picks how its clock runs and whether it has physics; a scene may run
without Rapier, on a cell grid, with walk areas for navigation. `show`
prints both under its header, and its JSON carries them as `time` (`kind`,
`rate`, `catchUp`, `wakeOnPointerMove`) and `physics`:

```sh
vp run scene show grid-yard
```

```text
time fixed 60Hz; physics none, no wasm
```

The engine's `grid-yard` is the scene to practise on: no game, `settings.physics`
`"none"`, a 0.32 m (32 px) square grid, walls of solids with one gap, markers
`start` and `exit` and two sensors. The tactics game's `level-1` is the
repo's turn game: physics none, a 12 × 8 grid of 1 m cells, a turns clock,
and units that move and fight only by commands ([Legal
commands](#legal-commands)). `corridor` and `meadow` below are not repo
scenes: they belong to the
engine README's walker and orchard games
(`scripts/engine-readme/examples/walker-game.ts`, `orchard-game.ts`), and
the README test writes them into projects of their own. `corridor` is a
turn game on a square grid with a `walk { to: [col, row] }` command;
`meadow` an idle game with a `plant` command and catch-up. Run in the repo,
these commands report an unknown scene; to try them, put the scene
(`corridor` in `walker-playtest.ts`, `meadow` in `orchard-game.ts`) in a
folder whose `jams.project.json` names the game, e.g. `"game": { "module":
"./walker-game.ts", "export": "walkerGame" }`.

### Time models

A game's `time` is `fixed` (the default: a tick every `1 / rate` seconds),
`turns` or `event`. A turns or event game ticks only when an input wakes it
(a key edge, a command; with `wakeOnPointerMove`, an event game's pointer
moves too), then once per `1 / rate` while its runtime's `busy()` says so,
and otherwise holds still. `rate` is an integer from 1 to 240, default 60;
the project's `game-settings` `engine.tickRate` overrides the game's.
Headless runs skip the slots a sleeping game would ignore: `ticks` and every
tick in a report count simulated ticks, and a playtest's `slots` counts the
script slots it used. `forMs` and millisecond timers round to whole ticks at
the game's rate. A rate the clock can't run is `tick-rate-invalid`:

```json project=engine expect=tick-rate-invalid
{
  "v": 1,
  "ops": [
    {
      "op": "editAsset",
      "id": "game-settings",
      "edits": [{ "set": "/engine/tickRate", "value": 0 }]
    }
  ]
}
```

### Game commands

A command is a named, JSON-argument message a game declares in `commands`
(its arguments checked by the command's schema), queued for the next
simulated tick and handed to the game's `beforeStep`. The engine's one
command is `@elapsed { ms }`: time away, which a game with `time.catchUp`
gets in one piece, capped at `catchUp.maxMs`; without `catchUp` it is
refused. `step` sends them on given ticks: `--command <tick>:<name>[=<json>]`
and `--elapse <tick>:<ms>`, both repeatable, sent on their ticks: each
tick's `@elapsed` first, then its commands in flag order.
`<tick>@<seat>:<name>` sends it from a seat (default 0); the seat must be one
the run has, the project input map's `players` or else the game's. The
report lists what it sent: in text, one line per command,
`t<tick> command [@<seat> ]<name> [<json>]` (`@<seat>` only for a seat
other than 0); in `--json`, `commands` holds `[tick, name]`,
`[tick, name, args]`, or, from a seat other than 0,
`[tick, name, args | null, seat]` (`null` when it took no arguments).
Quote the JSON for your shell:

```sh
# corridor and meadow: the walker and orchard example games' scenes, not repo scenes
vp run scene step corridor --ticks 40 --command '0:walk={"to":[9,0]}'
vp run scene step meadow --ticks 3 --command 0:plant --command 0:plant --elapse 1:28800000
```

An input script's `{ "command": "walk", "args": { … } }` and `{ "elapse":
ms }` steps take one slot each and keep what the step before held. An
unknown command or arguments that don't parse is a script issue with a
did-you-mean, as an unknown action is. A playtest report lists the
commands it sent as `commands` (`[tick, name, args?]`) beside `inputs`,
the recording carries them, and `replay` sends them on the same ticks.
`examples/walk-corridor.json` walks the hero down, waits, then sends it to
the far corner, and wins:

```sh
# corridor: the walker example game's scene, not a repo scene
vp run scene playtest corridor --script scripts/scene/examples/walk-corridor.json --record walk.json
vp run scene replay corridor --run walk.json
```

### Legal commands

A game whose `play.commands(state)` lists the commands a run may send now
(`GamePlayDef.commands`) is explored through that list. Its order is the
game's and stable, at most 64 are reported, and `legalTruncated: true`
marks a longer list. Every tool reads it the same way:

- `step --legal` prints the list after the last tick, below the run's
  events, one `name {args}` per line (`@<seat>` first for a seat other
  than 0), `legal: none` when the game lists nothing, and `legal: the game
lists no commands` for a game without `play.commands`. `--json` carries
  it as `legal` and `legalTruncated`.
- `playtest` prints `legal N commands` after the run, and its report (MCP's
  `scene_playtest` too) carries `legal` and `legalTruncated`.
- `fuzz`, for a game with `commands` and no `play.macro` of its own, sends
  one legal command per macro (every macro on a turns clock, half of them
  otherwise; the rest hold actions as before), drawn from the rollout's
  seeded random, and prints `legal: N commands sent, M macros with none
legal` (`legal.sent` and `legal.empty` in `--json`). Its default macro
  never holds a UI-only action, which only the HUD hears.

On the tactics game's `level-1`, the blue side's moves and waits on its
first turn, the commands its golden script sends, and a short fuzz:

```sh
vp run scene step level-1 --ticks 1 --legal
vp run scene step level-1 --ticks 40 --command '0:move={"unit":"blue-archer/unit","to":[2,4]}' --legal
vp run scene playtest level-1 --script src/games/tactics/scenes/level-1.script.json
vp run scene fuzz level-1 --seed 7 --rollouts 4 --ticks 300
```

```text
level-1 … game tactics config …: 1 ticks at 60Hz; lengths in m, speeds in m/s (48 px/m)
  final {"turn":1,"side":"blue","phase":"orders",…}
  legal (42):
    move {"unit":"blue-archer/unit","to":[0,3]}
    …
    wait {"unit":"blue-knight-2/unit"}
    end-turn
```

After the archer's move its own moves are gone from the list and its
`wait` stays. Tactics lists only the blue side's orders, so the list is
empty while red takes its turn: that is fuzz's "macros with none legal".
A command off the list changes nothing; the tactics runtime refuses it
with a `tactics:refused` event naming why.

### Physics none

A scene runs without Rapier when its physics resolves to `"none"`: scene
`settings.physics`, else the project's `engine.physics`, else the game's
`world.physics`, else `"rapier"`. Every command loads the wasm only for a
Rapier scene. The engine's own colliders stand in: `solid` (one-way sides
included), `sensor` (enter and exit from overlaps) and `follower` (a
kinematic collider on its path) work; `marker`, `decor`, `nav` and `note`
never had a body. `prop`, anything with `attach`, and a game type that
declares `physics: "required"` are `physics-required`, reported before
anything loads:

```json scene=grid-yard expect=physics-required
{
  "ops": [
    {
      "op": "add",
      "entity": {
        "id": "crate",
        "type": "prop",
        "shape": ["box", 1.6, 1.6, 0.12, 0.12],
        "density": 1,
        "restitution": 0
      }
    }
  ]
}
```

`validate --physical` and `check`'s `physical` run on the same colliders:
`solid-overlap`, `follower-hits-solid` and the game's checks, except one
that declares `needsPhysics`, which is skipped as `physics-skipped` (info).
All three of the platformer's physical checks need physics, and its player
needs Rapier, so `examples/flat-yard.json`, a platformer scene with
`settings.physics` `"none"`, has no spawn: `validate` reports the missing
spawn and skips the three checks:

```sh expect=physics-skipped
vp run scene validate scripts/scene/examples/flat-yard.json --physical --json
```

Replays of a physics-free scene match on every platform as long as its
colliders stay axis-aligned or turned by quarter turns.

Two more side-view assumptions are gone, both in the kitchen sink: a solid's
`oneWay` names the side actors land on (`"up"`, the same as `true`,
`"down"`, `"left"` or `"right"`; `side-wall` is `"left"`), and turns with
its instance; and a `prop` takes `gravityScale`, `linearDamping`,
`angularDamping`, `fixedRotation` (`upright`) and `ccd`.

### Grids and `connected`

`grid` prints the scene's grid as text: walls (cells whose centre a `solid`
covers, or the game's `world.gridWalls` types), a path between two cells
(`c,r`) or entities (their cell), what a cell sees within a radius, and
with `--diagonals` diagonal steps. It exits 1 when there's no path:

```sh
vp run scene grid grid-yard --from start --to exit
vp run scene grid grid-yard --from 2,2 --to 17,9 --diagonals
vp run scene grid grid-yard --fov 2,2:5
```

A `connected` check asks the same of the scene in `.checks.json`, with no
physics and no game code: `from` and each of `to` are an entity id or a
`[col, row]` cell, `diagonals` defaults to false and `blockedBy` lists the
types whose cells are walls (default `["solid"]`). Each target no path
reaches is one `grid-unreachable`; a scene without a grid is
`grid-invalid`. `examples/reach-exit.checks.json` passes on `grid-yard`:

```sh
vp run scene check grid-yard --checks scripts/scene/examples/reach-exit.checks.json
```

Blocking sensors too closes the gap at the foot of the divider:

```json checks=grid-yard expect=grid-unreachable
{
  "v": 3,
  "checks": [
    {
      "id": "sealed",
      "kind": "connected",
      "from": "start",
      "to": ["exit"],
      "blockedBy": ["solid", "sensor"]
    }
  ]
}
```

### Motion and navigation

Motion is game code with no scene keys: a game moves its own entities with
`./game`'s motion bodies, top-down controller and grid stepper, which work
on either backend and write the entity's pose, so `show`, `render` and the
editor follow them. Read where they go with `step` or `playtest`, never
from constants.

`nav` is the engine's walk-area type: `{ "id", "type": "nav", "shape":
["poly", x1, y1, …], "mode"?: "walk" | "block", "tags"? }`. A walk area is
any simple polygon, concave allowed; a `block` polygon is a hole in the walk
area around it. The kitchen sink's `floor-plan` is an L-shaped hall with
the `pillar` hole in it. A polygon that crosses itself, a hole not inside
exactly one walk area, or two walk areas that overlap is `nav-invalid`:

```json scene=kitchen-sink expect=nav-invalid
{
  "ops": [
    {
      "op": "add",
      "entity": {
        "id": "rug",
        "type": "nav",
        "shape": ["poly", 24, 3, 25, 3, 25, 4, 24, 4],
        "mode": "block"
      }
    }
  ]
}
```

## Lifecycle

A running game spawns, destroys, enables and disables entities, and places
prefabs (the engine README's
[Entity lifecycle](../../packages/engine/README.md#entity-lifecycle)). What it
spawns has a runtime id, `<name>#<n>` from a counter per type or prefab
name (`drop#3`), or an explicit `<name>#<label>` (`drop#first`); a placed
prefab's children are `<id>/<child>` (`twin-spout#1/left`). Runtime ids are
never scene refs: no op takes one, `show` lists none, and `fuzz` never
counts one as touched. A **spawn-only** type (the platformer's `player`)
loads and spawns but can't be placed: the scene schema leaves it out, and
`validate` and `apply` call it `unknown-type`.

The engine raises six events for this, in `step` and `playtest` reports as
any other:

| Event              | When                                                                        | `entityId`       | `other`   |
| ------------------ | --------------------------------------------------------------------------- | ---------------- | --------- |
| `entity:spawned`   | a spawn inside a step; a placed prefab raises one per child                 | the new entity   | —         |
| `entity:destroyed` | the end of the tick that destroyed it, `at` its last pose                   | the entity       | —         |
| `entity:enabled`   | an entity is switched back on inside a step                                 | the entity       | —         |
| `entity:disabled`  | an entity is switched off inside a step (a `lifetime` with `then: disable`) | the entity       | —         |
| `contact:start`    | a pair the game watches starts touching, `at` the contact point             | the watched side | the other |
| `contact:end`      | that pair stops touching                                                    | the watched side | the other |

The four `entity:*` events carry the entity's type as `data.type`. A
scene's own entities spawning at load raise nothing, and neither does
anything a game does outside a step. A recording's markers leave `entity:*`
out unless the game's `play.markers` names them.

`step` and `playtest` count spawns and destroys per type from those
events: the text prints a `spawned drop ×7, destroyed ×3` line per type,
and `--json` carries `lifecycle: { <type>: { spawned, destroyed } }`.
`--events type,…` keeps only those types in the printed and returned
`events`, while `lifecycle` still counts every event the run reported (the
first 1000; past that a summary line says it counted the reported ones).
The examples here run on the README's fountain game
(`scripts/engine-readme/examples/fountain-game.ts`): each spout lets a drop
fall every 250 ms, eight times, each drop's `lifetime` destroys it a second
later, and then the fountain runs dry.

```sh
# basin: the fountain example game's scene, not a repo scene
vp run scene step basin --ticks 120
vp run scene step basin --ticks 120 --events entity:destroyed
```

```text
basin 6517a02fa65d6a12 game fountain config a6ee13aa1cfb7ab1: 120 ticks at 60Hz; lengths in m, speeds in m/s (100 px/m)
  final {"fell":3,"live":4,"jitter":-0.2,"dry":false}
  spawned drop ×7, destroyed ×3
  t75 entity:destroyed drop#1
  t90 entity:destroyed drop#2
  t105 entity:destroyed drop#3
```

The kitchen sink's `spark` is a `decor` with a 30-tick `lifetime`, so a
gameless scene shows it too:

```sh
vp run scene step kitchen-sink --ticks 40 --events entity:destroyed
```

**`exists` and `count`** are `until` predicates (see
[Playtests and fuzz](#playtests-and-fuzz)) that read the live world after
each tick: `exists` holds while an id exists and is enabled, and `count`
while the number of entities matching a selector stays within `min`/`max`
or at `eq`. `examples/fountain-pour.json` places the game's `twin-spout`
prefab, waits until its left spout exists and six drops are falling, then
until every drop is gone:

```sh
# basin: the fountain example game's scene, not a repo scene
vp run scene playtest basin --script scripts/scene/examples/fountain-pour.json --events fountain:dry
```

```text
basin 6517a02fa65d6a12 game fountain config a6ee13aa1cfb7ab1: dry at t180 (181 ticks)
  step 0 t0 +1 done
  step 1 t1 +30 until
  step 2 t31 +150 until
  final {"fell":24,"live":0,"jitter":0.05,"dry":true}
  spawned spout ×2
  spawned drop ×24, destroyed ×24
  t180 fountain:dry
```

**`expect`** on a `reaches` check is an `until` clause that must hold on
the run's last tick, every key of it; the verdict names the first that
doesn't. `examples/basin.checks.json` runs the script above and expects
the right spout still there and no drop left:

```json checks=basin
{
  "v": 3,
  "checks": [
    {
      "id": "runs-dry",
      "kind": "reaches",
      "script": {
        "v": 2,
        "steps": [
          { "command": "pour", "args": { "prefab": "twin-spout" } },
          { "hold": [], "until": { "count": { "type": "drop", "min": 6 } }, "max": 60 },
          { "hold": [], "until": { "count": { "type": "drop", "max": 0 } }, "max": 600 }
        ]
      },
      "result": "dry",
      "expect": { "exists": "twin-spout#1/right", "count": { "type": "drop", "eq": 0 } }
    }
  ]
}
```

```sh
# basin: the fountain example game's scene, not a repo scene
vp run scene check basin --checks scripts/scene/examples/basin.checks.json
vp run scene check kitchen-sink --only fades
```

The kitchen sink's `fades` check waits a second and expects `lamp` to exist
and one `decor` left, its `spark` gone.

**Engine errors.** A spawn or a prefab placement that can't happen throws
an `EngineError` with an issue code, and a playtest, a `step` (or a
`reaches` check) that hits one ends `blocked` at stage `run`, the code on its issue:
`spawn-id-invalid` for an explicit id that isn't `<name>#<label>` for its
type, has an all-digit label or is already live, and
`prefab-not-spawnable` for a prefab the run can't place (not in its
library, nested in a cycle or too deep, or a child needing physics the
scene lacks; the error's `cause` carries that code). The prefabs a run can
place are the project's.

```sh expect=spawn-id-invalid
# basin: spills drop#first twice
vp run scene playtest basin --script scripts/scene/examples/spill-twice.json --json
```

```sh expect=prefab-not-spawnable
# basin: pours a prefab the fountain's project doesn't have
vp run scene playtest basin --script scripts/scene/examples/pour-missing.json --json
```

Over MCP, `scene_playtest` and `scene_check` take and return the same: the
events, `lifecycle`, `exists` and `count` in scripts, and `expect` in
checks.

## Standard behaviors

The engine registers eleven gameplay behaviors in every project, with a
game and without one: `collider`, `body`, `player-input`,
`character-top-down`, `character-side-view`, `camera-target`, `spawner`,
`nav-agent`, `path-follow`, `force-area` and `joint`. What each one is and
does at runtime is in the engine README's
[Standard behaviors](../../packages/engine/README.md#standard-behaviors);
here is how to place them. `solid`, `sensor`, `prop` and `follower` own a
body already and forbid `collider` and `body`, so the blocks go on a
`marker` (or a game type that allows them).

**`schema` lists them.** `schema scene` (and `schema prefab` and `schema
fragment`) carries each behavior under an entity's `behaviors`, by name: an
object whose `title` and `description` say what it is, whose `properties`
are its fields, each with its `title`, `description`, `default`, its
`unit` where it has one (`m`, `m/s`, `/s`, `kg/m²`, `N/m` and so on; a
`joint`'s `limits` and motor `velocity` and `maxForce` give `units` per
`kind` instead, such as `rad` for a revolute joint and `m` for a prismatic
one) and inspector `group`, and with `additionalProperties: false`.
`schema ops` leaves an added entity open; `apply` validates the scene it
makes. A game's schema has the same eleven beside
its own. What a block needs of its entity (`requires`, `conflicts`) and
the rules that span fields (`spawner`'s one of `type` or `prefab`, a point
`force-area`'s `strength`, a rope `joint`'s `length`) aren't JSON Schema:
`validate` and `apply` report them.

```sh
vp run scene schema scene
vp run scene schema scene --game platformer
vp run scene codes
```

**A hero with no code.** A gameless project's registry has two actions,
`move` (a vector on WASD, the arrow keys, the left stick and the d-pad) and
`jump` (Space or the pad's south button), and the characters read those
names unless their `move` and `jump` fields name others; a game's own
actions replace both. Four blocks make the engine yard's start marker a
side-view hero that plays and that the camera follows:

```json scene=engine-yard
{
  "label": "Make the start marker a playable side-view hero",
  "ops": [
    {
      "op": "update",
      "ref": "start",
      "set": {
        "behaviors.collider": { "shape": ["box", 0, 0, 0.15, 0.3] },
        "behaviors.character-side-view": { "maxSpeed": 5, "jumpHeight": 1.5 },
        "behaviors.player-input": {},
        "behaviors.camera-target": {}
      }
    }
  ]
}
```

`character-top-down` in place of `character-side-view` walks it in the
plane instead. **Physics-driven entities** are a `collider` and a `body`
(dynamic unless `kind` says otherwise). A barrel the hero pushes, an
upward force area over it, and a bob on a rope from the ledge:

```json scene=engine-yard
{
  "label": "A barrel, a force area over it and a rope from the ledge",
  "ops": [
    {
      "op": "add",
      "entity": {
        "id": "barrel",
        "type": "marker",
        "at": [6, 9],
        "behaviors": { "collider": { "shape": ["circle", 0, 0, 0.25], "density": 2 }, "body": {} }
      }
    },
    {
      "op": "add",
      "entity": {
        "id": "updraft",
        "type": "marker",
        "at": [6, 8],
        "behaviors": {
          "collider": { "shape": ["box", 0, 0, 0.5, 1], "sensor": true },
          "force-area": { "force": [0, -18] }
        }
      }
    },
    {
      "op": "add",
      "entity": {
        "id": "bob",
        "type": "marker",
        "at": [14, 8.6],
        "behaviors": {
          "collider": { "shape": ["circle", 0, 0, 0.1] },
          "body": {},
          "joint": { "kind": "rope", "to": "ledge", "length": 0.5 }
        }
      }
    }
  ]
}
```

A force area's collider must be a sensor (a `schema` issue otherwise), and
its `force` is an acceleration in m/s², y down. **Moving parts**: a nav
agent on the kitchen sink's floor plan, a spawner of the engine project's
`crate` prefab, and a platform that rides a path with a kinematic body, so
it carries what stands on it:

```json scene=kitchen-sink
{
  "label": "A nav agent, a crate spawner and a moving platform",
  "ops": [
    {
      "op": "add",
      "entity": {
        "id": "guard",
        "type": "marker",
        "at": [19.5, 3.5],
        "behaviors": { "nav-agent": { "speed": 1.5 } }
      }
    },
    {
      "op": "add",
      "entity": {
        "id": "hopper",
        "type": "marker",
        "at": [10, 2],
        "behaviors": { "spawner": { "prefab": "crate", "rate": 2, "cap": 5, "spread": 0.5 } }
      }
    },
    {
      "op": "add",
      "entity": {
        "id": "raft",
        "type": "marker",
        "at": [12, 6],
        "behaviors": {
          "collider": { "shape": ["box", 0, 0, 0.6, 0.08] },
          "body": { "kind": "kinematic" },
          "path-follow": {
            "path": {
              "pts": [
                [0, 0],
                [3, 0]
              ],
              "mode": "ping_pong",
              "speed": 1
            }
          }
        }
      }
    }
  ]
}
```

A gameless scene's nav agents stand still until code gives them a
destination (`setDestination`), their `to` field names one, or a script
sends them. A `nav` step (input-script v2) sends one for a slot, holding
what the hold step before it held: `{ "nav": { "id": "guard", "to": [22.6,
3.5] } }`, `to` a point in metres or an entity id to follow. A `reaches`
check's `nav` list sends its agents on the run's first slot, beside what
the script's first step sends there, so one script serves several checks.
Both send the engine command `@nav`, which a recording carries and a
replay sends again; an entity without a nav-agent ends the run `blocked`
at stage `run` with `behavior-missing` (`dangling-ref` for an id that
doesn't exist). The kitchen sink's guard crosses its floor plan both ways:

```sh
vp run scene playtest kitchen-sink --script scripts/scene/examples/nav-to-the-hall.json --events nav:arrived
vp run scene check kitchen-sink --checks scripts/scene/examples/nav-guard.checks.json
```

A prefab exposes a controller's field as a
parameter like any other field (see [Parameters](#parameters)): the
engine project's `hero-side` exposes `jumpHeight` and `maxSpeed`, and
`behavior-yard`'s `runner` sets one:

```json scene=behavior-yard
{ "ops": [{ "op": "setParam", "ref": "runner", "name": "maxSpeed", "value": 7 }] }
```

**What `validate` and `apply` refuse.** Both characters on one entity are
`behavior-conflict`:

```json scene=engine-yard expect=behavior-conflict
{
  "ops": [
    {
      "op": "update",
      "ref": "start",
      "set": {
        "behaviors.collider": { "shape": ["box", 0, 0, 0.15, 0.3] },
        "behaviors.character-side-view": {},
        "behaviors.character-top-down": {}
      }
    }
  ]
}
```

A character on a dynamic body is `character-body-kind`: the controller and
the physics solver would both move it. Its fix sets the body's `kind` to
`kinematic`; a character needs no body of its own.

```json scene=engine-yard expect=character-body-kind
{
  "ops": [
    {
      "op": "update",
      "ref": "start",
      "set": {
        "behaviors.collider": { "shape": ["box", 0, 0, 0.15, 0.3] },
        "behaviors.character-side-view": {},
        "behaviors.body": {}
      }
    }
  ]
}
```

A `path-follow` whose collider has no body, or a static one, leaves the
collider where it was built while the pose moves: a `behavior-conflict`
warning, as on a `solid`, `prop`, `follower` or `sensor`, whose own system
places it. A kinematic body moves the collider with the path:

```json scene=engine-yard expect=behavior-conflict
{
  "ops": [
    {
      "op": "update",
      "ref": "start",
      "set": {
        "behaviors.collider": { "shape": ["box", 0, 0, 0.6, 0.1] },
        "behaviors.path-follow": {
          "path": {
            "pts": [
              [0, 0],
              [3, 0]
            ],
            "mode": "ping_pong",
            "speed": 1
          }
        }
      }
    }
  ]
}
```

A nav agent in a scene with no walk area is `nav-missing`, a warning:

```json scene=engine-yard expect=nav-missing
{ "ops": [{ "op": "update", "ref": "start", "set": { "behaviors.nav-agent": {} } }] }
```

A joint's `to` naming its own entity is `joint-self`, and one naming an
entity with no body to hold (a sensor, a note, a marker with no `collider`
or `body`) is `joint-ref-type`:

```json scene=engine-yard expect=joint-self
{
  "ops": [
    {
      "op": "add",
      "entity": {
        "id": "bob",
        "type": "marker",
        "at": [6, 8],
        "behaviors": {
          "collider": { "shape": ["circle", 0, 0, 0.1] },
          "body": {},
          "joint": { "kind": "rope", "to": "bob", "length": 1 }
        }
      }
    }
  ]
}
```

```json scene=engine-yard expect=joint-ref-type
{
  "ops": [
    {
      "op": "add",
      "entity": {
        "id": "bob",
        "type": "marker",
        "at": [6, 8],
        "behaviors": {
          "collider": { "shape": ["circle", 0, 0, 0.1] },
          "body": {},
          "joint": { "kind": "rope", "to": "zone", "length": 1 }
        }
      }
    }
  ]
}
```

A dynamic body or a joint in a scene without physics is
`physics-required`; a kinematic body is fine there:

```json scene=grid-yard expect=physics-required
{
  "ops": [
    {
      "op": "add",
      "entity": {
        "id": "barrel",
        "type": "marker",
        "at": [1, 1],
        "behaviors": { "collider": { "shape": ["circle", 0, 0, 0.1] }, "body": {} }
      }
    }
  ]
}
```

A missing `requires` (a `body` with no `collider`, a `joint` with no
`body`) is `behavior-missing`, and a block on a type that owns a body is
`behavior-forbidden`. Two more codes come from a running game: code that
moves a body through `ctx.bodies` by an id with no body throws
`body-missing`, and a write a body doesn't take throws `body-not-dynamic`:
a force, torque or impulse on a kinematic or static body, a velocity on a
static body or a follower (its path sets it), or an angular velocity on a
kinematic body. A playtest or `step` that hits either ends
`blocked` at stage `run`, the code on its issue.

**Playing them.** The behaviors raise `character:jumped`,
`character:left-ground`, `character:landed` (`other` what it landed on),
`nav:arrived`, `nav:blocked` (`data.reason`) and `spawner:spawned` (`other`
the new id), and a `collider` with `sensor: true` raises `sensor:enter` and
`sensor:exit` as the `sensor` type does; `--events` filters them as any
other. `behavior-yard` is the engine project's scene of all eleven: a
side-view room, where `runner` (a `hero-side`) crosses a force area and
rides a path platform to a sensor, and a top-down room, where `walker` (a
`hero-top` on seat 1) walks around a nav agent's walk area. Its checks
play the side hero across with the engine's own predicates:

```sh
vp run scene validate behavior-yard
vp run scene step behavior-yard --ticks 120 --events spawner:spawned,character:landed
vp run scene check behavior-yard
```

**`near`** is an `until` predicate for where an entity is, with or without
a game: `{ "near": { "id": "runner/hero", "to": [26.5, 11.4], "within":
0.5 } }` holds while the entity's pose is within `within` metres of the
point, and `to` may name another entity instead, whose pose it follows. It
works in a playtest's steps, in a `reaches` check's `expect` and in `fuzz`
alike.

## Input v2

A game binds its actions by device, and a run records every seat's input.
The engine README's [Input](../../packages/engine/README.md#input) is the API;
this is what files and commands hold. The examples run on the engine
README's duel game (`scripts/engine-readme/examples/duel-game.ts`): two
seats race to a flag on a physics-free `field`, each steering a `move`
vector. The README test puts its scene and `examples/duel.input-map.json`
in a project of their own, so run in the repo these commands report an
unknown project.

### Bindings

An action is a `button` (the default), an `axis` (−1…1) or a `vector` (a
point in the unit disc, y down). Its `bindings` say what drives it:

| Binding                                              | Fits          | Meaning                                                                                                                                                                                   |
| ---------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ "device": "key", "code": "KeyA" }`                | button        | a key by `KeyboardEvent.code`: where it sits, whatever the layout prints on it (AZERTY's `Z` is `KeyW`)                                                                                   |
| `"axis": "x"`, `"value": -1` on a key or pad button  | vector, axis  | adds `value` (default 1) to that component, or to the axis                                                                                                                                |
| `"player": 1` on a key                               | any           | drives that seat whoever owns the keyboard: two players on one keyboard                                                                                                                   |
| `{ "device": "pad", "button": "south" }`             | as a key      | the standard mapping's `south`, `east`, `west`, `north`, `lb`, `rb`, `lt`, `rt`, `select`, `start`, `ls`, `rs`, `dpad-up`, `dpad-down`, `dpad-left`, `dpad-right`, `home`, or a raw index |
| `{ "device": "pad", "stick": "left" }`               | vector        | a stick, `left` or `right`                                                                                                                                                                |
| `{ "device": "pad", "axis": "left-x", "scale": -1 }` | axis          | one stick axis (`left-x`, `left-y`, `right-x`, `right-y`) or a trigger (`lt`, `rt`); `scale` -1 inverts                                                                                   |
| `{ "device": "pointer", "button": "primary" }`       | button        | `primary`, `secondary` or `middle`                                                                                                                                                        |
| `{ "device": "touch", "control": "stick" }`          | the control's | an on-screen control the input map declares: a `stick` or `dpad` drives a vector, a `button` a button                                                                                     |

Bindings on a button combine by OR; on an axis the reading furthest from
zero wins; a vector sums its keys, adds the stick furthest from the centre
and clamps to the disc. Axis and vector values are quantised to
thousandths after a radial deadzone (the input map's `deadzone`, else the
game's `input.deadzone`, else 0.15), and pointer positions to 1/10,000 m,
so a replay sees exactly what the run saw. A 0.x `keys` list still binds,
each key read as every code it produced on a US layout (`"Shift"` is both
Shifts); it is deprecated, as `codes` notes. Its keys are 0.x's
`KeyboardEvent.key` spellings, single characters lowercase: Space is
`" "`, and there are no aliases. A key the table doesn't know is refused
when the game registers (`binding-unknown`, `"arrowup"` → `"ArrowUp"`,
`"space"` → `" "`) rather than binding nothing.

An unknown action, code, pad button, axis or control, or a binding whose
shape doesn't fit its action's kind, is `binding-unknown`, with a "did you
mean" (`"space"` → `Space`); a seat past the seats there are, or more than
8 of them, is `player-unknown`. The registry, the input map, a rebind and
`input` judge a binding by the same rule.

### The input map

A project may hold one `input-map` doc (`schema input-map`; a second one
is `asset-kind`). It sets the seats, the deadzone, bindings for any of the
game's actions and the on-screen controls; each action it lists replaces
the game's bindings for that action whole, and the actions it leaves out
keep the game's. Touch controls are `button`, `stick` or `dpad`, placed by
`at` and sized by `radius` as fractions of the canvas's shorter side from
its top-left corner. The duel's map moves `taunt` to `Q` and `/` and adds
the touch controls:

```json
{
  "kind": "input-map",
  "v": 1,
  "players": { "max": 2, "join": "press" },
  "deadzone": 0.2,
  "actions": [
    {
      "action": "move",
      "kind": "vector",
      "bindings": [
        { "device": "key", "code": "KeyA", "axis": "x", "value": -1, "player": 0 },
        { "device": "key", "code": "ArrowLeft", "axis": "x", "value": -1, "player": 1 },
        { "device": "pad", "stick": "left" },
        { "device": "touch", "control": "stick" }
      ]
    },
    {
      "action": "taunt",
      "bindings": [
        { "device": "key", "code": "KeyQ", "player": 0 },
        { "device": "key", "code": "Slash", "player": 1 },
        { "device": "touch", "control": "taunt" }
      ]
    }
  ],
  "touch": [
    { "id": "stick", "kind": "stick", "action": "move", "at": [0.2, 0.8], "radius": 0.15 },
    {
      "id": "taunt",
      "kind": "button",
      "action": "taunt",
      "at": [1.55, 0.8],
      "radius": 0.1,
      "label": "Hi"
    }
  ]
}
```

(`move`'s other keys are left out here; the file has all eight.) A seat's
bindings for an action come from the first of four layers that names it:
the player's remap, the host's bindings, the input map, the game's
`actions`. Remaps live in the player's browser; input maps are project
docs. No command ever sees a remap.

The map edits like any doc, with `editAsset`; an action's bindings are at
`/actions/@<action>/bindings`:

```json project=duel
{
  "v": 1,
  "label": "Seat 1 taunts on the period key too",
  "ops": [
    {
      "op": "editAsset",
      "id": "input-map",
      "edits": [
        {
          "insert": "/actions/@taunt/bindings",
          "value": { "device": "key", "code": "Period", "player": 1 }
        }
      ]
    }
  ]
}
```

A key named by what it prints rather than its code is `binding-unknown`:

```json project=duel expect=binding-unknown
{
  "v": 1,
  "ops": [
    {
      "op": "editAsset",
      "id": "input-map",
      "edits": [
        {
          "insert": "/actions/@taunt/bindings",
          "value": { "device": "key", "code": "space" }
        }
      ]
    }
  ]
}
```

and nine seats are `player-unknown`:

```json project=duel expect=player-unknown
{
  "v": 1,
  "ops": [
    {
      "op": "editAsset",
      "id": "input-map",
      "edits": [{ "set": "/players/max", "value": 9 }]
    }
  ]
}
```

### Seats

A game has one seat unless the input map's `players`, else the game's
`input.players`, says otherwise: `{ "max": 1–8, "join": … }`. With `auto`
seat 0 owns the keyboard, pointer and touch and pads take free seats as
they connect; with `press` a device's first press takes the lowest free
seat; with `host` the host assigns devices. With one seat every device
drives seat 0. A pad that disconnects frees its seat. Joins and leaves
raise `player:joined` and `player:left` (with the seat as `player`) and
are recorded, so a replay has the same seats on the same ticks.

`input` prints what each seat's actions are bound to, per action with the
layer it came from (`map` or `game`), and the issues the game's bindings
and the input map have, without a browser and without Rapier. `--player n`
prints one seat:

```sh
# duel: the duel example game's project, not a repo project
vp run scene input --project duel
vp run scene input --project duel --player 1 --json
vp run scene input --project platformer
```

The platformer has no input map, so its seat has only the game's own
bindings. An action that still declares 0.x `keys` shows them mapped to
codes, marked `[from 0.x keys […], deprecated]`.

```text
platformer (game platformer): 1 seat, join auto; no input map
  seat 0
    move_left (button) from game
     *game  key ArrowLeft, key KeyA
    dash (button) from game
     *game  key ShiftLeft, key ShiftRight
remaps live in the player's browser; input maps are project docs
```

(Its other actions are left out here.)

### Scripts v2

Input scripts are `"v": 2` (`input-script:v2`, `input-script:<game>:v2`).
A v1 script still plays, migrated on read, and `fmt` writes it as v2.
Version 2 adds:

- `tracks`: one list of steps per seat, `{ "player": n, "steps": […] }`,
  run together from slot 0, each with its own `until`s. A script has
  `steps` (seat 0, v1's form) or `tracks`, and ends `script-end` when
  every track has run out. `players` in the header sets the run's seats.
  A track that runs out first keeps holding what its last step held
  (buttons, `set` values, pointer buttons) until the script ends, as a
  player who stops moving their hands would; end it on `{ "wait": 1 }` to
  let go of buttons and values, after a pointer `release` for a pointer
  button.
- `set`: axis values and vector pairs held for the step,
  `{ "set": { "move": [1, 0] }, "for": 30 }`, alone or beside `hold`.
- `pointer`: `at` in world metres, `press` and `release` a button, and
  `drag` to move from `at` to it over the step. A release or a drag needs
  a fixed length, and a press and release on a step's only slot is
  refused, since neither would show. A button down holds the actions bound
  to it (the project input map's bindings over the game's), as a click
  does in live play, so the recording replays what a player's would.
- `join` and `leave`: a device (`keyboard`, `pointer`, `touch`, `pad:<n>`)
  for the track's seat.
- `nav`: sends a nav agent to a point or after an entity for one slot,
  `{ "nav": { "id": "guard", "to": [22.6, 3.5] } }`; see
  [Standard behaviors](#standard-behaviors).

`examples/duel-race.json` joins seat 0 on the keyboard and runs it at the
flag, while seat 1 joins on a pad ten ticks later, cuts across, drags the
pointer and leaves; seat 0 wins. `fuzz`'s rollouts also set analog values
and move the pointer when the game has axis, vector or pointer actions.

```sh
# field: the duel example game's scene, not a repo scene
vp run scene playtest field --script scripts/scene/examples/duel-race.json --record race.json
vp run scene replay field --run race.json
```

### Recordings v2

A recording (`schema recording`, `urn:jams-engine:recording:v2`) is one
input stream per seat plus a system stream, indexing the `actions` and
`commands` name tables:

- `inputs[seat]`: `[t, "b", action, 0|1]` for a button,
  `[t, "a", action, v]` for an axis and `[t, "v", action, x, y]` for a
  vector (values × 1000, as ints), `[t, "p", x, y, buttons, over]` for the
  pointer (world metres × 10,000, written only when it changes) and
  `[t, "c", command, args?]` for a command the seat sent.
- `system`: `[t, "w", ms]` for `@elapsed`, `[t, "j", seat, device]` and
  `[t, "l", seat, device]` for joins and leaves. A tick merges the system
  stream first, then the seats in order.
- `players` (each seat's devices), `seed` (always written), `time`,
  `platform` (`arch`, `runtime`, and `flavour`, the Rapier package),
  `project`, and `runHash`: a hash of the expanded scene, the clock and the
  project's settings, tables and input map (never a doc's `$schema`). A
  replay is `stale` when `runHash` differs; `sceneHash` is still shown.
- `release`: the id of the exported build the run was played in, written
  only by a game that plays from a release; `replay --releases <dir>`
  finds that build ([Game builds](#game-builds)).
- `sceneVersion` and `swaps`: the scene version the segment started on and
  each swap during it (`tick`, `version`, `strategy`, `timing`,
  `sceneHash`, `runHash`), written only by a run that played a live
  version; `replay --versions <dir>` reads them ([Live levels](#live-levels)).

`replay` prints the recording's platform. When the engine doesn't vouch
for replays across CPU architectures, a Rapier recording made on another
one warns `recording-other-platform`; since the cross-platform check held
on x86_64 it does vouch, so today the warning never fires. A v1 recording
replays too, migrated on read (key edges and commands become seat 0's
stream, and its world px become metres at the game's px per metre), and
`replay` reports `migratedFrom 1` beside the engine version that recorded
it:

```sh
vp run scene replay engine-yard --run scripts/scene/examples/settles.v1.recording.json
```

```text
engine-yard: replays: script-end at t59 (60 ticks)
  recorded on engine 0.10.0, physics rapier 0.19.3; migratedFrom 1
  platform recorded unknown; replayed arm64, bun 1.3.11
```

A recording made before 0.11.0 still migrates, but replays `stale` (its
`sceneHash` is the v3 document's), and most as a mismatch: the move to
metres and to Rapier's own length unit changed the numbers a run
simulates once.

## Flow

A project's **scene list** (`scene-list.json` at its root, kind
`scene-list`, `schema scene-list`, `urn:jams-engine:scene-list:v1`) names
the scenes a game can go to: `start`, the scene the game opens on, and
`scenes`, one entry per scene with an optional `title` and `"sublevel":
true` for a scene that only attaches beside another
([Sublevels](#sublevels)). A project has at most one. Without one, nothing
plays through flow: the site and an export report `start-scene-missing`,
and the editor offers "Create scene list". The tactics game's:

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

`flow` prints each project's list: the start, every listed scene's title,
sublevel tag, physics backend and bundle (the blobs it loads before it
draws), the project's scenes the list leaves out (`not listed: …`), and the
list's issues. A start that is null, names no scene, or names an unlisted
scene or a sublevel is `start-scene-missing` (exit 1); an entry naming no
scene is `asset-missing`; a scene listed twice is `dup-id`; a listed
scene's check that names a scene flow can't go to (a `reaches` check's
`expect.scene`, or its script's `scene` or `until.scene`) is
`scene-unlisted`, a warning.

```sh
vp run scene flow
vp run scene flow --project tactics --json
```

```text
tactics: scene list scene-list.json, start menu, 5 listed
  menu  start  physics none  bundle 1 blob 9420 B  "Title"
  level-1  physics none  bundle 5 blobs 30804 B  "Ford"
  level-2  physics none  bundle 4 blobs 28341 B  "Bridge"
  result  physics none  bundle 1 blob 9420 B
  cellar  sublevel  physics none  bundle 4 blobs 28341 B
```

**Editing the list.** The list is a doc asset (id `scene-list`), changed
with `assets apply` and an `editAsset`, never by hand: `scenes` is keyed
by scene id, so `/scenes/@result/title` is the `result` entry's title,
`insert` at `/scenes` appends an entry and `remove` at `/scenes/@<id>`
drops one. MCP's `asset_apply_ops` takes the same batch.
`examples/title-result.json` titles the result scene:

```sh
vp run scene assets apply --ops scripts/scene/examples/title-result.json --project tactics --dry-run
```

A start the game can't open on is refused:

```json project=tactics expect=start-scene-missing
{
  "v": 1,
  "ops": [
    { "op": "editAsset", "id": "scene-list", "edits": [{ "set": "/start", "value": "cellar" }] }
  ]
}
```

**Requests.** A game changes scene with `ctx.flow.request({ to, entry?,
transition?, persist? })`; the request applies after the tick, the first
one of a tick wins, and the next scene reads `ctx.flow.entry`. A request
for a scene the list doesn't hold, or for a sublevel, is refused at run
time as `scene-unlisted`, an error there. `ctx.persist` is the game's
persistent state (its `persist.initial()`, checked by `persist.schema`):
it outlives every scene change, and a request's `persist` replaces it
before the next load.

**Headless runs.** `playtest` without `--flow` ends a run at its first
request, with result `flow` and the scene it asked for (`flow at t0 (1
ticks): requested "level-1"`). With `--flow` the run follows each request
through the scene's project's list (a scene file outside a project, or a
project with no list, is refused), loads the next scene with no
transition and no wall time, and goes on with the same script; one script
spans every scene. `until: { "scene": "<id>" }` waits for the main scene
to be one, and `until: { "persist": { "pointer", "eq"|"gte"|"lte" } }` for
a value in the persistent state. The report's `segments` has one row per
scene visited (`scene`, `ticks`, `recording`, `end`), printed as `scene
<id> +<ticks> <end> -> <next>`.

`examples/menu-to-level-2.json` starts the tactics game on its menu,
starts level 1, wins it with level 1's own orders, waits for the result
scene with `level-1` cleared in the persistent state, goes back to the
menu and starts again, which now opens level 2:

```sh
vp run scene playtest menu --script scripts/scene/examples/menu-to-level-2.json
vp run scene playtest menu --script scripts/scene/examples/menu-to-level-2.json --flow
vp run scene playtest menu --script scripts/scene/examples/menu-to-level-2.json --flow --record tour.json
vp run scene replay menu --run tour.json
```

```text
menu 52b0e915a58238a0 game tactics config 9a40e5fbc53f6748: script-end at t592 (593 ticks)
  …
  scene menu +1 flow -> level-1
  scene level-1 +590 flow -> result
  scene result +1 flow -> menu
  scene menu +1 flow -> level-2
  scene level-2 +0 script-end
```

**Recordings.** Each segment's recording is recording v2, widened
additively: `start.persist` (the persistent state the segment began with,
written when the game declares `persist`), `next` (`{ scene, entry? }`,
the request that ended the segment) and `fromSave` (`{ slot, sha256 }`,
for a run that began from a save fixture). `--record` writes the first
segment's, which is also the report's `recording`. A replay applies
`start.persist` before the load and ends at `next` without following it,
so each segment replays on its own scene.

MCP's `scene_flow` returns `flow --json`, and `scene_playtest` takes
`flow` and `fromSave`.

### Sublevels

A sublevel is a listed scene marked `"sublevel": true` that a game
attaches beside the main scene with `ctx.flow.attach(scene, { label, at
})` and removes with `ctx.flow.detach(label)`; `ctx.flow.sublevels()`
lists the attached ones. Its entities join the run under
`<label>:<id>` (`cellar:guard/unit`), queries and sensors see them, and a
detach removes every body, collider and entity it brought. A sublevel
can't be a start or a request's `to`.

An attach that can't happen returns `{ ok: false }` with
`sublevel-invalid`, whose `detail.reason` says why: `unlisted` (the scene
isn't in the list), `physics` (its physics backend differs from the main
scene's), `grid` (its grid's shape or cell differs, or `at` isn't on a
cell boundary of the main scene's grid, judged in whole px at the game's
px per metre), `settings` (its gravity differs) or `label` (malformed or
taken). The game decides what a refusal does; the tactics game's stair
stays shut.

Level 2's stair attaches the `cellar` as `cellar`, two rows under the
board, when a unit steps on it (`examples/take-stair.json`); it opens
only in a `--flow` run, since without the list nothing is listed to
attach:

```sh
vp run scene playtest level-2 --script scripts/scene/examples/take-stair.json --flow --events tactics:opened
```

```text
  spawned unit ×1
  …
  t16 tactics:opened stair (blue-knight-2/unit)
```

## Saves

A save is a `save:v1` file (`schema save`,
`packages/engine/project/save.schema.json`,
`urn:jams-engine:save:v1`): the game and its `saves.version`, the engine
version, the slot, `meta` (`playTicks`, `savedAt`, the scene), the
`depth`, the persistent state, the scene (`id`, `runHash`, the attached
sublevels) and the game's `data`. Its text is canonical, so the same save
is the same bytes. Two depths:

- **`world`** holds the whole running world (entities, spawns and
  disables, emit timers, motion bodies and grid steppers, the random
  streams, each system's state, the game's `restore`d snapshot), so a run
  restored from it goes on to the same digest as the run that saved it.
  It can't be taken while the scene runs on Rapier, a function timer or
  coroutine is pending, or the game's runtime has no `restore`: that is
  `save-unsupported`, with each cause in `detail.causes`.
- **`progress`** holds the persistent state and the game's snapshot only;
  loading it starts the scene fresh. Any scene can take one.

Saves are limited to 64 KB and 8 slots per game by default (a game's
`saves.limits` lowers or raises them, up to 1 MiB and 64 slots in a
browser). In a running game, `ctx.saves.request(slot, …)` asks for a save
after the tick, and `GameInstance.saves` lists, saves, loads and removes
slots through the game's store; a save result never reaches the
simulation. Your own save backend is the recommended path for anything
past the limits; browser saves stay on the player's device.

**Fixtures.** A save fixture is a save file a playtest can start from:
the `save` kind (`*.save.json`, a blob with a sidecar, meta `game`,
`gameVersion`, `depth` and `scene`). `save` runs a script to `--at` (a
simulated tick) and writes one there (`--depth world`, the default, or
`progress`); the slot is the file's stem. Inside a project the fixture is
imported as a `save` asset, and saving again to the same path replaces its
bytes (the project's history keeps the old ones); outside one it is a plain
file; a path a project doesn't hold as an asset (a test's `__tests__/fixtures/`)
is a plain file too. A run that ends before `--at` saves nothing (exit 1).
`meta.savedAt` is `--now <ms>` (epoch milliseconds, default 0), so saving the
same script to the same tick writes the same bytes and the same hash, and a
recording's `fromSave` pin survives a recapture of an unchanged state.
`playtest --from-save <file>` and `fuzz --from-save <file>` start from a
fixture instead of the scene's fresh load, and the run's recording names it
in `fromSave`; replaying that recording needs the project's fixture with
that hash, else it is blocked with `asset-missing` (`detail.kind: "save"`).
Save fixtures change only through `save`, never by hand.

Saving level 2 mid-walk, then playing on from there:

```sh
vp run scene save level-2 --script scripts/scene/examples/take-stair.json --at 10 --out turn-one.save.json
vp run scene playtest level-2 --script scripts/scene/examples/end-turn.json --from-save turn-one.save.json
vp run scene fuzz level-2 --from-save turn-one.save.json --rollouts 4 --ticks 120
vp run scene save level-2 --script scripts/scene/examples/take-stair.json --at 10 --out progress.save.json --depth progress
```

```text
level-2: saved world at t10 to turn-one.save.json (slot turn-one, 2716 B, sha256 3f314a889fde)
```

The platformer's scenes run on Rapier, so a world save refuses with each
cause (`cause physics: the scene runs on Rapier`, `cause restore: the
game's runtime has no restore`) and writes nothing; `--depth progress`
takes one:

```sh expect=save-unsupported
vp run scene save test-yard --script scripts/scene/examples/hop-left.json --at 10 --out yard.save.json --json
```

A save from a newer build of the game (its `gameVersion` past the game's
`saves.version`), or one whose version has no migration step to the
game's, is `save-version-newer`. `examples/newer.save.json` is level 2's
save with its game version raised:

```sh expect=save-version-newer
vp run scene playtest level-2 --script scripts/scene/examples/end-turn.json --from-save scripts/scene/examples/newer.save.json --json
```

## Rendering

`render` draws a scene so you can look at it: a schematic, not the game's
look. Every entity is drawn through the same outline the game draws, in its
registered type's colors (a material's color wins), with a grid and axis
ticks every 64 or 128 world px (wider on big scenes), id labels, and
every path rider's waypoints numbered with a dashed ghost of the body at
each. The scene's metres are drawn at its game's px per metre (100 by
default, so a tick every 64 px is one every 0.64 m), and the ticks are
labelled in those world px. The image's longest side is at most 1600px;
`--scale` (image px per world px, default 1) only shrinks under that cap.
Text is Rubik.

- `--out file.png` rasterises with resvg, `--out file.svg` writes the SVG,
  and without `--out` the SVG goes to stdout. `--json` reports the
  `region`, `scale`, `width`, `height` and `tick` (and the `svg` without
  `--out`).
- `--region x0,y0,x1,y1` draws that world rectangle, in metres; `--around
ref` frames one entity (an id or a `~bulk:index` ref, its whole path
  included) with `--margin n` metres around it (default 1.28). Without
  either, the scene's `bounds`.
- `--labels entities|all|none`: ids at each entity (the default), `all`
  adds bulk refs such as `~solid:4`, `none` draws no labels.
- `--overlay report.json` draws a report over the scene: its `issues`
  (dashed boxes around the entities they name, a ring at `at`), a
  playtest's `trail`, its `events` (dots by type, with a legend) and its
  `outcome` (a cross with the result and tick). A playtest report, a
  blocked playtest or `validate --json` output all work; `-` reads stdin.
- A sprite (an entity's `sprite` block) draws as a dashed box in its
  type's color, labelled `asset` or `asset:frame` (`(no asset)` without
  one), where the sprite would draw: sized from the project's asset info
  (`size`, else the frame's or texture's px over the game's px per metre,
  times `scale`), placed by
  its `anchor` and `offset`, turned with the entity's pose (unless `turn:
false`) and mirrored by its flip. Nothing
  is decoded; the box is all a schematic shows of the art. With `--json`
  the report lists them as `sprites`: each one's `ref`, `type`, `label` and
  world `box`.
- `--ascii` prints a character map instead, one character per 64 world px
  cell (0.64 m at 100 px per metre)
  (bigger cells past 200 columns or rows), aligned to multiples of the cell
  so the ruler and row labels read as world coordinates. Each type's
  character comes from the type (`EntityTypeDef.ascii`, else its base
  primitive's): `#` solid, `=` one-way solids and the platformer's clouds,
  `~` along paths, `G` goal, `S` spawn, `x` hazard, `o` anchor; the legend
  under the map lists what each character stands for. A sprite's box is
  marked with its entity's character (`d` for a `decor`). `--region`,
  `--around`, `--margin` and `--overlay` (`*` trail, `!` outcome) work the
  same; `--out file.txt` writes it to a file.

```sh
vp run scene render engine-yard --ascii
vp run scene render kitchen-sink --ascii --region 4,9,11,12
vp run scene render test-yard --ascii --around elevator --margin 0.64
vp run scene render test-yard --labels all --region 11,5,18,12
vp run scene render test-yard --out /tmp/test-yard.png
vp run scene render engine-yard --around lift --scale 2 --overlay report.json --out lift.png
```

## Game builds

`game build <id>` turns a game's project into a static site that plays
without the jams.team site, the editor or a dev server: every scene the
scene list holds, the prefabs, docs and blobs they reach, the game's code
and its UI, and `release.json`, the manifest that pins all of it. Only a
project with a game module builds. Output goes under `dist/` (gitignored):

```sh
vp run scene game build tactics
vp run scene game manifest dist/games/tactics/web
vp run scene game export tactics --zip
vp run scene game manifest dist/games/tactics/itch --json
```

`--target` picks a row of the engine's target table (`EXPORT_TARGETS`),
and the usage line lists the rows, so it grows with the table:

| Target | Default for         | Ships besides the game                                                                   | Checked against                        |
| ------ | ------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------- |
| `web`  | `game build`        | `sw.js` and `app.webmanifest` (offline play and install), unless `export.pwa` is `false` | the size budgets                       |
| `itch` | `game export --zip` | nothing: no service worker, since itch.io serves the game from its own nested path       | the budgets and itch.io's HTML5 layout |

Any other target (`desktop`, `mobile`) is a release target this engine
version doesn't build. It is refused with `export-target-unsupported`
while planning, before the bundler runs or anything is written:

```sh expect=export-target-unsupported
vp run scene game build tactics --target desktop --json
```

**What a build holds.** A build directory is the same for every target:

```text
dist/games/tactics/web/
  index.html            the page: <div id="game"> and one module script
  credits.html          every shipped blob's licence, and the code packages'
  release.json          the manifest (schema release:v1)
  code/<name>-<hash>.js the entry, its chunks and styles, named by content hash
  data/<sha256>.json    each shipped doc's canonical text
  assets/<sha256>.png   each shipped blob, named by its content hash
  icons/icon-192.png    the app icons: export.icons, else the engine's default
  icons/icon-512.png
  sw.js                 web only: the service worker
  app.webmanifest       web only: the web app manifest
```

A Rapier scene in the list adds the wasm: as its own `code/` file behind a
dynamic import with the standard package, or inlined into the code with
`game build platformer --rapier compat` (the project file's `export.rapier`
sets the default). A list with no Rapier scene ships no wasm at all. No file
depends on the clock or the machine, so two builds of one snapshot are
equal byte for byte. Serve the directory from any static server: the page
doesn't play from `file://`.

**What it prints.** One line per part of the plan, the same lines `game
manifest` prints (the wasm line among them), then where the bundle report went:

```text
tactics web: wrote dist/games/tactics/web (release <sha256>)
  game tactics, engine 0.14.2 (agent surface 17), target web, snapshot <sha256>
  scenes menu (start, none), level-1 (none), level-2 (none), result (none), cellar (sublevel, none)
  wasm: 0 B (no listed scene uses Rapier)
  files <n> + release.json, <bytes>: code …, shell …, worker …, icon …, asset …, data …
  budget codeBytes … of 4 MB, firstLoadBytes … of 16 MB, totalBytes … of 100 MB, largest file <path> … of 32 MB
  credits <n> licence groups, <n> code packages; every asset has a licence
  bundle report dist/games/tactics/web.bundle-report
```

`--json` has the same as data (`release`, `scenes`, `bytes` per role,
`budget`, `credits`, `wasm`, `issues`). The bundle report
(`<out>.bundle-report/client.json`) sits beside the build, never in it,
for `scripts/engine-bundle-check.ts --export <dir>`, which fails a build
that holds editor or dev-only code.

**Budgets.** Every build is measured against four limits, which the
project file's `export.budget` overrides field by field: `codeBytes` (JS
and CSS without wasm, 4 MiB), `firstLoadBytes` (the code, the wasm when a
scene needs it, the project bundle and the start scene's bundle: what the
first frame waits for, 16 MiB), `totalBytes` (100 MiB) and `fileBytes` (any
one file, 32 MiB). A build over one is still written, and fails with
`export-over-budget` naming the largest contributors;
`game build tactics --allow-over-budget` accepts it. The budget is reported
before anything is uploaded anywhere; jams.team's own limits are stated in
its publish flow.

**Credits.** A shipped blob with no licence recorded still ships, with a
`licence-missing` warning, and `credits.html` lists it under "No licence
recorded". Record one with a `setLicence` op through `assets apply`.
`export.icons` names a 192 and a 512 texture; one that isn't a PNG of
exactly that size falls back to the default icon with
`export-asset-missing` at warn.

**The project file's `export` block** (`schema project`; every field has a
default): `shortName`, `icons`, `themeColor`, `background`, `display`
(`fullscreen`, `standalone` or `minimal-ui`), `orientation`, `budget`,
`rapier` and `pwa`.

**`game export --zip`** builds (target `itch` unless `--target` says
otherwise) into `game build`'s directory, then zips it to
`dist/games/<id>-<target>.zip` (or `--out`): stored, sorted, with fixed
times, so two zips of one build are equal. For `itch` it checks itch.io's
HTML5 layout over the files, `export-itch-layout` for each failure: at most
1,000 files, 500 MB in all, 200 MB for any one file, 240 characters for a
path, `index.html` at the root, no `__MACOSX` folder or dotfiles. Nothing is
uploaded; the zip is what you upload to itch.io as an HTML5 game.

**`game manifest <dir|release.json>`** reads a build back: it parses the
manifest, checks it the way every host does before it plays (the start
listed, every named file in `build.files`, the build and snapshot hashes,
the budget recomputed) and prints its summary. Given the build's directory,
it also hashes every file against `build.files` (`export-asset-missing` for
one that's gone, `hash-mismatch` for one that changed) and names files the
manifest doesn't list. Exit 1 when it doesn't hold together:

```sh
vp run scene game manifest dist/games/tactics/web/release.json
```

**`replay --releases <dir>`** replays a run as `replay` does, then names the
build under `<dir>` it was made on (`findRelease`): the one whose release id
the recording carries (an exported game's runs carry it), else one with the
recording's snapshot and engine version. A run recorded by the CLI carries
neither, so the line says which of the builds it searched none matches; the
replay still decides the exit code:

```sh
vp run scene playtest level-1 --script src/games/tactics/scenes/level-1.script.json --record tactics-run.json
vp run scene replay level-1 --run tactics-run.json --releases dist/games
```

**The packed engine.** An export bundles `@jams/engine` as a consumer
installs it: the build resolves `node_modules/@jams/engine` (the workspace
link) to `packages/engine/dist`, not to the source the site and the CLI
import. `vp run game:build <id> [flags]` and `vp run game:export <id> --zip
[flags]` pack first, as a Vite Task dependency on `engine:pack`. A direct
`game build` (or the MCP `game_build`) packs on its own when
`packages/engine/dist` is missing or older than the source
(`scripts/scene/engine-dist.ts`), one pack at a time through a lock
directory, so parallel builds wait for one pack rather than racing. A
test that builds a game needs a timeout long enough for one pack (up to
10 minutes).

## Live levels

A scene version (`urn:jams-engine:scene-version:v1`, `@jams/engine/schemas/scene-version.schema.json`)
is one scene and the prefabs and blobs it reaches, as data only, checked
against the code that made it, so it can replace that scene in a release
players already run. The CLI builds and checks one offline; publishing it
is the site's. The commands:

```text
vp run scene game live build <project> <scene> [--hosted] [--out <dir>] [--json]
vp run scene game live check <project> <scene> [--against <release dir|release.json>] [--from <version dir>] [--json]
```

**`game live build`** parses, validates and expands the scene with the
game's registry (an error issue stops it), then writes `<out>/scene-version.json`
(the record's canonical text, whose SHA-256 is the version's id) and
`<out>/<sha256>.json` for each doc text it carries, and prints the id, the
data size and the files. It reads the project's files, or with `--hosted`
a temporary pull of the hosted project, as `game release create --hosted`
does (see [Releasing on the site](#releasing-on-the-site)). The same scene
and prefabs give the same id from files, from a pull and from the editor:
the record holds no clock, author, note or timing.

**`game live check`** builds the version the same way, then:

- with `--against` a release (a build directory or its `release.json`), it
  runs the compatibility rules every host runs before a version goes live
  on that release (`live-incompatible`, `live-scene-unlisted`,
  `live-physics`, `live-asset-conflict`, and `asset-missing` for a reference
  it doesn't carry), and swap checks it against the release's own scene;
- with `--from` a version directory, it swap checks it against that
  version, the one players have now;
- with neither, it only validates, and a `warning:` line names the two flags.

The swap check swaps at `now`. A game whose `GameDefinition.live.timings`
doesn't list it gets a `warning:` line too (`live-timing-unsupported`): a
published version reaches its players only at the strongest timing it
accepts, and `next-load` is always one.
`--json` gives the same fields as the text. Exit 1 on an error issue.

**The swap check** (`swapCheck` from `@jams/engine/headless`) proves a
version against real play. For each of the scene's input scripts it plays
the old version to learn the run's length, then for each of a quarter, a
half and three quarters of it (`LIVE_DEFAULTS.checkAt`) plays a fresh run
to that tick, applies the new version with timing `now` through the same
path a running game takes (the strategy follows the diff: `reconcile`, or
`reload` when the name, bounds or settings changed; then the game's
`onSwap`), and steps on 120 ticks (`checkTicks`). The game's own
`live.check` runs right after the swap and 60 ticks later, then the
scene's `.checks.json` against the new version. Each run reports
`{ script, at, tick, strategy, issues }`: `live-swap-failed` when `onSwap`
threw or a swap step refused (`detail.phase`), a step that threw, and the
game's check codes (`<game>/…`). It passes when no run has an error issue;
a scene with no input scripts has no runs.

Built from the tactics build above, a version of `level-1` fits its
release and swaps cleanly, from the release's scene and from itself:

```sh
vp run scene game live build tactics level-1 --out dist/live/level-1
vp run scene game live check tactics level-1
vp run scene game live check tactics level-1 --against dist/games/tactics/web
vp run scene game live check tactics level-1 --from dist/live/level-1 --json
```

**`replay --versions <dir>`** replays a run that swapped versions. A
recording names the version each segment started on (`sceneVersion`) and
every swap during it (`swaps`); the replay reads those versions from
`<dir>`, version files and their texts as `game live build` writes them, and
applies each swap before its recorded tick with its recorded strategy. A
version it can't find is `scene-version-removed`: a segment that starts on
one doesn't run, and a swap's stops the replay at its tick. A recording
without either key replays as before:

```sh
vp run scene replay level-1 --run tactics-run.json --versions dist/live/level-1
```

In the editor, **Live in Play** (the play bar's switch, off by default)
applies each edit made during Play to the running game as a player's live
update would: debounced 300 ms, timing `now`, through the same swap,
`onSwap` and `live.check`, with nothing uploaded. With it off, an edit
during Play waits for Restart.

## Live edits

While `vp dev` runs, every project is also a set of shared documents on the
dev server's collab server (`ws://localhost:3000/__scene-collab`): the
registry `project:<id>`, each scene `scene:<id>.<key>` and each other doc
asset `asset:<id>.<key>`, which the editor tabs have open. `apply --live`
sends a batch to the scene's project as one more client (`project-client.ts`)
instead of writing the file:

```sh
vp run scene apply engine-yard --live --ops scripts/scene/examples/slow-lift.json --agent claude --on-behalf-of ada
```

It asks the server for its projects, opens the scene's, tries the batch on a
copy of the scene doc, then sends it as one `editScene` project op, so prefab
ops (`createPrefab`, `definePrefab`, `applyToPrefab`, `unpack`) write the
prefab docs they name too. It applies with an `agent` origin (`--agent`, default `scene-cli`, and `--on-behalf-of`
the person it works for), waits until the server has the update, prints the
same `ApplyResult` as `apply` (plus `live`, `url` and `actor`) and
disconnects. Everyone with the scene open sees the change land and a history
row naming the agent, and can revert it; it is not on their undo stack. The
server writes the file back in canonical form, so `fmt --check` stays green.

- `~` refs resolve against the doc as it is when the batch lands, so a live
  batch needs no `base`; one it brings is still checked, and a stale one
  exits 1.
- `--dry-run` reports what the batch would do to the live doc and sends
  nothing. A batch that would leave error-severity issues isn't sent either.
- `--url` points at another server (`ws://localhost:<port>/__scene-collab`
  when `vp dev` runs on another port). With no server running, or a scene it
  doesn't serve, the command fails at once instead of retrying.

A file changed while the server has the scene open (by `apply` without
`--live`, `fmt`, a git checkout or a hand edit) reaches the open documents
as one change from `disk`. Use `--live` while people are editing; use the
file commands offline and in CI.

### Hosted projects

A project hosted on the site (staging only for now, behind the
`engine-projects` flag) takes the same `--live` commands. Point `--url` at
the site instead of a collab server, and pass the agent token a staff member
created for the project in the site, with `--token` or in `JAMS_AGENT_TOKEN`.
The site URL is `https://` (`http://` only on localhost):

```sh
export JAMS_AGENT_TOKEN=jat_…
vp run scene apply engine-yard --live --url https://staging.example --ops scripts/scene/examples/slow-lift.json
vp run scene assets list --live --url https://staging.example
```

`hosted.ts` trades the token at `POST /api/engine/agent-sync-token` for a
60 s sync token naming the project and the sync service, and replaces it
before it runs out as more docs open. The docs open on the sync service;
blobs go through the site's `…/projects/<id>/blobs` routes. The actor is
the token's: its id as `agentId` and the staff member it was made by as
`onBehalfOf`, so `--agent` and `--on-behalf-of` are ignored. A read-only
token can read and dry-run; a write is refused before anything opens. The
game code comes from the CLI's project of the same id, or `--project`'s.
The token is a secret: it never appears in output, and the sync token it
buys is good for a minute.

`project pull` brings a hosted project back to files, for a commit:

```sh
vp run scene project pull engine --url https://staging.example --check
```

It fetches the project's bundle (every doc state the service has stored,
and every blob hash), formats each doc here with its kind, exactly as the
dev server writes files back, fetches the blobs, and writes the files and
sidecars into `--out` (the CLI project's directory by default). It reports
each file it adds, changes or removes; `--check` writes nothing and exits 1
when one would change. The project file is written only where there is
none. An edit from the last few seconds may not be stored yet.

A hosted scene or prefab still at format v3 opens read-only, with
`migration-unresolved`: the sync service has no game code to move it to
metres (see [Units and format v4](#units-and-format-v4)), and a v3 client
can't write a v4 doc. Pull the project, run `fmt` on the files, and seed
the hosted project again from them (it must be reset in the site first,
since `project push` seeds only an empty project), or reset it and start
over.

`project push <dir> --create` seeds a new hosted project from a project's
files. A staff member reserves the id in the site and makes an agent token
for it; push refuses a project that already holds anything. It sends each
live doc's canonical text, uploads each binary, then has the site seed
every doc from the bundle, as `createHostedProject` does.

```sh
vp run scene project push packages/engine/scenes --create --url https://staging.example --dry-run
```

`--dry-run` checks the files as a push does (a doc that doesn't parse, or a
problem the site would refuse, fails it), reads the hosted project to see
that it is empty and which binaries it already holds, and reports the docs
it would seed (`seeds`) and the binaries it would upload (`uploads`), with
`written: false`. It sends nothing; the site's own checks of the bundle run
only on the real push.

### Releasing on the site

`game release create` builds a project (or takes `--from`'s build) and
uploads it to its hosted project as a new release, on preview unless
`--channel none`:

```sh
export JAMS_AGENT_TOKEN=jat_…
vp run scene game release create <project> [--hosted] [--from <dir>] [--channel preview|none] [--url https://site]
```

The token comes from `--token` or `JAMS_AGENT_TOKEN`, the site from `--url`
or `JAMS_AGENT_SITE`. `--hosted` pulls the hosted project's docs and blobs
before building. It sends only the files the site lacks, four at a time,
and sends a dropped file again. It ends with:

```text
Released tactics v7 (c0de4b…) to preview: 38 MB, 212 files, 4.2 MB new.
  Play:     {siteUrl}/games/tactics/play/7
  Storage:  124 MB of 512 MB release storage · 7 of 10 releases kept
  Removal:  v2 on 26 Nov 2026 (not pinned)
Promote it to production on the game's page: {siteUrl}/games/tactics
```

and a `warning:` line for any quota at or over 80%. `game release list`
prints the releases, newest first, with their size, channels, jam pins and
removal dates; `game release promote <project> <version> --channel preview`
and `game release rollback <project> --channel preview` move the preview
channel. An agent token works on preview only: production is moved by a
person on the game's page, and the refusal names it.

## MCP

`mcp.ts` is a local stdio MCP server, `jams-scenes`, over the same tool
functions as the CLI (it never spawns it), versioned with the engine
(`ENGINE_VERSION`). To use it from an agent, add this to the repo's
`.mcp.json`:

```json
{ "mcpServers": { "jams-scenes": { "command": "bun", "args": ["scripts/scene/mcp.ts"] } } }
```

| Tool                    | CLI command             | Notes                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scene_list`            | `list`                  |                                                                                                                                                                                                                                                                                                                                                   |
| `scene_show`            | `show`                  | `near` is `[x, y, r]`; rows with a sprite carry its `sprite` box; `time` and `physics`                                                                                                                                                                                                                                                            |
| `scene_schema`          | `schema`                | `which`: any name `schema` takes (`scene`, `ops`, `project-ops`, a doc kind…)                                                                                                                                                                                                                                                                     |
| `scene_codes`           | `codes`                 |                                                                                                                                                                                                                                                                                                                                                   |
| `scene_flow`            | `flow`                  | each project's scene list as data; edit the list with `asset_apply_ops`                                                                                                                                                                                                                                                                           |
| `scene_validate`        | `validate`              | `physical`                                                                                                                                                                                                                                                                                                                                        |
| `scene_diff`            | `diff`                  | one of `other`, `git` or an inline `ops` batch                                                                                                                                                                                                                                                                                                    |
| `scene_apply_ops`       | `apply` / `--live`      | writes; `dryRun` defaults to `true`                                                                                                                                                                                                                                                                                                               |
| `scene_playtest`        | `playtest`              | `script` inline or a path, v1 or v2 (tracks, `set`, `pointer`, `join`, `leave`), command and elapse steps included; `at` is `[x, y]` in metres; `events` a list of types, returns `lifecycle`, and `legal`/`legalTruncated` for a game that lists its commands; `flow` follows scene requests (`segments`), `fromSave` a fixture inline or a path |
| `scene_replay`          | `replay`                | `run` inline or a path: a v1 or v2 recording or a playtest result; reports `migratedFrom`, the platform and `issues`; `versions`: a directory `game_live_build` wrote, as `--versions`                                                                                                                                                            |
| `scene_fuzz`            | `fuzz`                  | `seed`, `rollouts`, `ticks` as numbers                                                                                                                                                                                                                                                                                                            |
| `scene_check`           | `check`                 | every kind, `connected` included; `reaches` takes `expect`                                                                                                                                                                                                                                                                                        |
| `scene_render`          | `render`                | a PNG `image` block; `ascii` for the map; `overlay` inline or a path; `sprites` lists the sprite boxes                                                                                                                                                                                                                                            |
| `project_tree`          | `project tree`          |                                                                                                                                                                                                                                                                                                                                                   |
| `asset_refs`            | `project refs`          | `id`; without one, every dangling reference                                                                                                                                                                                                                                                                                                       |
| `asset_import`          | `assets import`         | writes; `file` (a local path), `path`, `id`, `kind`, `settings`                                                                                                                                                                                                                                                                                   |
| `asset_apply_ops`       | `assets apply`          | writes; `ops` inline or a path; `base` on files; edits input maps (`/actions/@<action>/bindings`) and scene lists (`/scenes/@<scene>`, `/start`)                                                                                                                                                                                                  |
| `game_build`            | `game build`            | builds into `out` (default dist/games/<id>/<target>); `id`, `target`, `out`, `rapier` (`standard`/`compat`), `allowOverBudget`; returns the plan summary and issues, never file bytes                                                                                                                                                             |
| `game_manifest`         | `game manifest`         | `path`: a build directory, a `release.json` or an inline manifest; returns the validated manifest and its summary                                                                                                                                                                                                                                 |
| `game_live_build`       | `game live build`       | `id`, `scene`, `hosted`, `out`; `hosted` needs `JAMS_AGENT_TOKEN` and `JAMS_AGENT_SITE` in the server's environment; returns the version's id, data size and files written, as `--json` does                                                                                                                                                      |
| `game_live_check`       | `game live check`       | `id`, `scene`, `against` (a build directory or `release.json`), `from` (a directory `game_live_build` wrote); returns the compatibility issues and the swap check's runs, as `--json` does                                                                                                                                                        |
| `game_release_create`   | `game release create`   | `id`, `hosted`, `target`, `channel` (`preview`/`none`), `from`, `allowOverBudget`; needs `JAMS_AGENT_TOKEN` and `JAMS_AGENT_SITE` in the server's environment (never arguments); returns the release summary (version, id, size, files, new bytes, play URL, quota lines and warnings, next removal, game page), never file bytes                 |
| `game_release_list`     | `game release list`     | `id`                                                                                                                                                                                                                                                                                                                                              |
| `game_release_promote`  | `game release promote`  | `id`, `version` (a number), `channel: "preview"`; production is refused with the game page's URL                                                                                                                                                                                                                                                  |
| `game_release_rollback` | `game release rollback` | `id`, `channel: "preview"`; production is refused likewise                                                                                                                                                                                                                                                                                        |
| `game_new`              | `game new`              | writes; the CLI's inputs (`gravity` as `[x, y]`, `rate`, `cell` and `pxPerMetre` as numbers); returns the files, issues, `urls` and the playtest command                                                                                                                                                                                          |

Each result is the command's `--json` output as compact JSON in a text block
and as `structuredContent`, with `exitCode` added. A scene with error issues
is a normal result with `exitCode: 1`; `isError` is set only for calls that
did nothing (a usage error, a stale base, a missing scene or server).
Every tool takes `project`, which scopes it as `--project` does. The writers
`scene_apply_ops`, `asset_import`, `asset_apply_ops` and `game_new` write only with
`dryRun: false` (it defaults to `true`); every other tool is annotated
read-only, and `asset_apply_ops`, whose batches can delete assets and replace
content, destructive. `game_build` writes its build (annotated destructive and
idempotent, with no `dryRun`), and `game_live_build` its version likewise, open-world
too since `hosted` reaches the site; `game_live_check` is read-only. The release tools reach the site named by
`JAMS_AGENT_SITE` with `JAMS_AGENT_TOKEN` and are annotated open-world. `asset_import`'s `settings` is an object or the
`key=value` pairs `--settings` takes.

**Live mode.** With `live: true` (and `url`, default the dev server's), the
read tools read the doc open on `vp dev`'s collab server, unsaved edits
included; `project_tree` and `asset_refs` read the server's registry and
docs. `scene_apply_ops` sends its batch as `apply --live` does, and
`asset_import` and `asset_apply_ops` as the `assets` writers do with `--live`: one undoable history entry under an agent actor (`agentId`,
default `mcp`, and `onBehalfOf`), which open editors see land and which is
never on their undo stack. Only localhost servers are reachable, unless the MCP server
was started with both `JAMS_AGENT_TOKEN` and `JAMS_AGENT_SITE` in its
environment. `JAMS_AGENT_SITE` is the origin of the site hosting that token's
project (`https://`, or `http://` on localhost only); then `url` may be that
origin (see [Hosted projects](#hosted-projects)), and the actor is the
token's. The token is sent to that origin only, so a `url` naming any other
site is a usage error, and it is never a tool argument.

## Semantic `git diff`

`.gitattributes` marks the scene directories `diff=scene` (`*.checks.json`
excluded). Turn it on once per clone:

```sh
git config diff.scene.textconv "bun scripts/scene/cli.ts textconv"
```

Then `git diff` shows one line per header field, settings key, bulk entry
(by its `~key:index` ref) and entity (by id). Inserting into a bucket
shifts every later ref, so use `scene diff --git <rev>` for the exact
changes.

## Conventions

- **y is down, lengths are metres.** Positions, sizes, paths and bounds are
  world metres, speeds m/s and gravity m/s² (see
  [Units and format v4](#units-and-format-v4)); at the default 100 px per
  metre a whole pixel is two decimals. Rotations are integer degrees
  (`rotDeg` in shapes, `rot` on constructs).
- **Box and capsule sizes are half-extents.** `["box", cx, cy, hw, hh]`
  is centred on `cx, cy`. Read the `aabb` and `top` that `show` derives
  instead of computing edges yourself. Ops also accept
  `{ "type": "rect", "left", "top", "right", "bottom" }`.
- **Spawn is the player's feet**, not the centre of its body.
- **A path follower's shape is local** to its current path point, usually
  centred on `0, 0`; the path points are world positions.
- **Bulk refs (`~solid:3`) shift** when an earlier entry is removed. A
  batch that uses one needs `base` set to the hash you read (or
  `--base`), and fails with exit 3 (`stale-base`) when the scene has moved
  on. To keep referring to a bulk entry, promote it:
  `{ "op": "promote", "ref": "~solid:3", "id": "ledge-a" }`.
- **No runtime state in scenes**: no platform progress, cloud visibility
  or player state. Scenes are the authored starting point.
- **Leave remarks as `note` entities**
  (`{ "type": "note", "at": [x, y], "text": "..." }`); they never load.
- **Groups have an origin.** An entity or instance whose `group` names one
  of the scene's `groups` stores its geometry relative to that group's
  `at`; moving the group is one `setGroup` with a new `at`. A new group is
  declared with `setGroup` (at `[0, 0]` unless you say otherwise).
- **Prefabs are found by id.** In a project a prefab is a prefab asset at
  whatever path the registry gives it (moved to `kit/` or renamed, it still
  resolves); a new one goes to `prefabs/<id>.json` in the scene's folder.
  Only a scene file outside every project reads `prefabs/<id>.json` beside
  it by file name. Every command reads them. An instance places one at
  `at`; its children show up as `gate-1/door` in `show`, renders and
  playtests. Edit one instance's children with `override` (keys
  `<child>.<field.path>`, values in the prefab's own frame) and
  `revertOverride` (with no `ref`, in a variant's own document, they
  edit the variant's overrides of its base); change the prefab for every instance with
  `applyToPrefab` or `definePrefab`; turn an instance back into plain
  entities with `unpack`, or entries into a prefab with `createPrefab`.
  `schema prefab` is the prefab file's schema.
- **`apply` on files is a project op.** In a project it sends the batch as
  one `editScene` project op, as `--live` does, and writes the prefab files,
  sidecars, registry and dev cache the way `assets apply` does. An id
  another asset holds (`asset-id-taken`), a file another asset holds
  (`path-taken`), or a `definePrefab` with `"prefab": null` while another
  asset still places the prefab (`asset-in-use`, with `detail.referrers`)
  is refused and nothing is written; the refusal's `sceneHash` is the
  unchanged file's, so it works as `--base` for a retry. Otherwise a
  `definePrefab` with `"prefab": null` sends the prefab to the trash,
  where `assets restore` brings it back.
- **`attach` rides a follower.** A solid or sensor with `attach:
"<follower id>"` moves with that follower; place its shape where it
  should be while the follower is at its first path point.
- **`$schema` comes first** and points at the registry's committed schema, so
  editors validate and autocomplete scene files. Scene directories are left
  out of `vp fmt`; `fmt --check` is their formatter gate.

## Units and format v4

Scenes, prefabs, fragments and op batches are `"v": 4` (`scene:v4`,
`prefab:v4`, `fragment:v4`, `ops:v4`): format v3 with every length in
metres. The simulation runs in metres, and each game says how many pixels
a metre is drawn at, `world.lengthUnit` (default 100; the platformer
declares 100). At 100 px per metre a whole pixel is two decimals:
`["box", 3, 9.4, 0.2, 0.2]` is a 40 px square.

- **Metres:** `bounds`, `settings.gravity` (m/s²), `settings.grid`'s
  `cell`, `origin` and `side`, groups' and instances' `at`, shapes, points
  and paths, path `speed` (m/s), and every field a schema marks with a
  length unit (`m`, `m/s` or `m/s²`), a game's own fields included. `show`
  and `step` print lengths with their unit.
- **Not lengths:** angles (degrees), times (ms and ticks), scales,
  restitution and friction keep their numbers, and what is drawn stays in
  px: texture and frame px, nine-slice insets, stroke widths, font sizes,
  the resolution's virtual px, and the images `render` writes.
- **Mass:** `density` keeps its number and means kg/m², so a body's mass
  is (px per metre)² smaller than it was in px. Velocities, gravity and
  contacts behave the same; game code that applies forces or impulses
  rescales them.
- **Rounding:** files hold lengths to the micrometre. The editor's free
  drags and nudges land on whole world px at the game's px per metre, and
  a number you pick should too. A grid's `cell`, `origin` and `side` must
  be whole px (`grid-invalid` otherwise); `bounds` may be any metres.
- **The other kinds** moved too: checks v3 (`reaches`' `at`), materials v2
  (`launch` in m/s), game settings v2 (`engine.gravity` in m/s²) and data
  tables v2 (their rows' length fields); input scripts' `at` and pointer
  steps are metres.

**The migration.** The v3 → v4 step divides every length by the game's px
per metre, through the field units of the game's registry; an instance's
`overrides` and `params` are scaled by the fields they name in its prefab.
`fmt` runs it: `fmt --check` reports a v3 file as

```text
test-yard: not canonical (from v3 to v4); run vp run scene fmt test-yard
```

and `fmt` writes it at v4. Without the game's registry, or without a
prefab an override or param names, the step can't know the units and
refuses with `migration-unresolved`, leaving the file at v3. That is the
hosted sync service's case: it holds no game code, so a hosted project's
stored v3 scenes and prefabs stay v3 and open read-only (see
[Hosted projects](#hosted-projects)).

**Ops are metres.** An op batch carries no version, so a client still
writing px sends lengths a hundred times too big. Most land outside the
scene, and `apply` reports `out-of-bounds`:

```json scene=engine-yard expect=out-of-bounds
{ "ops": [{ "op": "update", "ref": "avatar", "set": { "shape": ["box", 300, 940, 20, 20] } }] }
```

## Format v3

Format v3's additions, all still in v4, are below. Each is optional and
defaults to what a v2 file meant, so the v2 → v3 step changed only `v`;
`fmt` migrates every scene and prefab it formats to v4. The
blocks below are op batches you can dry-run as they are: the ones on
`engine-yard` and `kitchen-sink` (the engine project's scenes) go to
`apply <scene> --ops <file> --dry-run`, the ones that touch a prefab's own
document to `assets apply --ops <file> --project engine --dry-run`. No repo
game has behaviors or a grid type yet, so the `card-table` batches run
against the CLI tests' card game (`__tests__/card-game.ts`), whose
`card-table` scene the README test writes: a square 0.32 m grid, a `tiles`
floor, a `lamp` and a `marker` called `spot`.

| Key or field                               | Where                       | Meaning                                                 | Absent                 |
| ------------------------------------------ | --------------------------- | ------------------------------------------------------- | ---------------------- |
| `behaviors`                                | entities                    | behavior blocks by name                                 | none, or the type's    |
| `layer`                                    | entities, instances         | one of the registry's layers                            | the type's default     |
| `z`                                        | entities, instances         | integer draw order; an offset on instances              | 0                      |
| `assets`                                   | scene and prefab header     | sorted ids of assets only game code names               | none                   |
| `settings.physics`                         | scene settings              | `"rapier"` or `"none"`                                  | `"rapier"`             |
| `settings.grid`                            | scene settings              | the scene's one cell grid, square or hex                | no grid                |
| `settings.view`                            | scene settings              | `{ "projection": "orthogonal" }`, reserved              | orthogonal             |
| `rot`, `flip`                              | instances, groups           | quarter turns clockwise, and a mirror of x before them  | not turned, not mirror |
| `params`                                   | instances                   | values of the prefab's exposed parameters               | the prefab's defaults  |
| `instances`, `base`, `params`, `overrides` | prefab files                | nested instances, a variant's base, exposed parameters  | none                   |
| `instances`                                | fragments                   | copied instances, their prefabs by id                   | none                   |
| grid fields                                | entities of a type with one | run-length cells in 32 × 32 chunks                      | empty                  |
| ref fields (`attach`, a game's `refField`) | entities                    | an id, or a child of an instance at any depth (`a/b/c`) | —                      |

`schema scene`, `schema prefab`, `schema fragment` and `schema ops` serve
`urn:jams-engine:scene:v4` and its kin, with a game's types, behaviors,
layers and asset ids filled in under `--game`.

### Behaviors

A behavior is a block of fields any entity can carry, defined in code with
`defineBehavior`; the engine's are bare names, a game's are
`<game>/<name>`. An entity holds them under `behaviors`, by name, and an
empty block `{}` means "carry it, all defaults":

```text
{ "id": "lamp", "type": "lamp", "at": [2, 1], "behaviors": { "card-game/glow": { "color": "#ff8800" } } }
```

A type may require a behavior (an entity of it always has the block, at
the type's defaults when the file has none), give defaults for an optional
one, or forbid some or all. A behavior may require another on the same
entity. Field paths reach into a block as `behaviors.<name>.<field>`
(`behaviors.card-game/glow.color`); `update` with `set` on a block's path
adds it, setting a field inside an absent block creates it, and `unset`
removes it. No repo game defines behaviors yet; the CLI tests' card game
has `card-game/glow`, which its `lamp` type requires, and
`card-game/flicker`, which requires `card-game/glow`:

```json scene=card-table
{
  "label": "Make the spot flicker",
  "ops": [
    {
      "op": "update",
      "ref": "spot",
      "set": { "behaviors.card-game/glow": {}, "behaviors.card-game/flicker.rate": 2 }
    },
    { "op": "update", "ref": "lamp", "set": { "behaviors.card-game/glow.color": "#ff8800" } }
  ]
}
```

A block the registry doesn't know is `behavior-unknown`, with a "did you
mean":

```json scene=engine-yard expect=behavior-unknown
{ "ops": [{ "op": "update", "ref": "crate", "set": { "behaviors.wobble": {} } }] }
```

One the type refuses is `behavior-forbidden` (the card game's `tiles`
forbids every behavior):

```json scene=card-table expect=behavior-forbidden
{ "ops": [{ "op": "update", "ref": "floor", "set": { "behaviors.card-game/glow": {} } }] }
```

One whose `requires` isn't on the entity is `behavior-missing`, fixed by
adding the required block:

```json scene=card-table expect=behavior-missing
{ "ops": [{ "op": "update", "ref": "spot", "set": { "behaviors.card-game/flicker": {} } }] }
```

### Layers and `z`

An entity's or instance's `layer` names one of the registry's layers: a
game's `layers`, else the engine's `terrain`, `decor`, `gameplay` and
`editor` (shown only in the editor). Without one, an entity sits on its
type's default. `z` is an integer in [-10000, 10000] that orders drawing
within a layer, 0 when absent; on an instance it is added to every child's
`z`. Bulk entries have no `z`: promote one first. `setZ` sets `z` or
shifts it `by` an amount, and `update` can set either field:

```json scene=engine-yard
{
  "label": "Lift the props",
  "ops": [
    { "op": "setZ", "refs": ["crate", "avatar"], "by": 1 },
    { "op": "setZ", "refs": ["ledge"], "z": -1 },
    { "op": "update", "ref": "zone", "set": { "layer": "decor", "z": 5 } }
  ]
}
```

A layer the registry doesn't have is `layer-unknown`; its fix unsets it:

```json scene=engine-yard expect=layer-unknown
{ "ops": [{ "op": "update", "ref": "ledge", "set": { "layer": "terain" } }] }
```

### Assets

A game's fields that name an asset (`assetField`) hold its id; with a
project, an id that isn't there is `asset-missing` and one of the wrong
kind `asset-kind`, and `assets change-id` rewrites them like every other
reference. The `assets` header lists the assets only game code names, so
the loader bundles them; `useAssets` adds and removes ids:

```json scene=engine-yard
{ "label": "Bundle the bouncy material", "ops": [{ "op": "useAssets", "add": ["bouncy"] }] }
```

### Sprites

`sprite` is the engine's own behavior: it draws a texture, or an atlas's
frame, at the entity's pose. Any entity may carry it, and a `decor` (a
picture with no body, which never collides) requires it. Its fields:
`asset` (a texture or atlas id), `frame` (required for an atlas), `size`
(metres; else the frame's px over the game's px per metre, times
`scale`), `anchor` (0–1 in the
frame; else its pivot, else the centre), `offset`, `tint` (0xRRGGBB),
`alpha`, `flipX`, `flipY`, `blend` (`normal`, `add`, `multiply`, `screen`),
`tile`, `nineSlice` (else the texture's import setting) and `turn` (turn
with the pose; default true). The entity's material's `render.tint` and
`render.blend` fill in each one the block leaves unset, for a material with
`physics`: one without is render data the registry doesn't take, so it lends
a sprite nothing. Find frame names and sizes with `assets info`:

```json scene=kitchen-sink
{
  "label": "Dress the goal",
  "ops": [
    {
      "op": "add",
      "entity": {
        "id": "sign",
        "type": "decor",
        "at": [7, 11],
        "behaviors": { "sprite": { "asset": "crates", "frame": "crate-1", "scale": 2 } }
      }
    },
    {
      "op": "update",
      "ref": "zone",
      "set": { "behaviors.sprite": { "asset": "backdrop", "alpha": 0.5 } }
    }
  ]
}
```

`apply` (and `apply --live`, and MCP's `scene_apply_ops`) judges asset ids
and sprites against the scene's project as `validate` does, reporting
`asset-missing`, `asset-kind`, `asset-frame-unknown` and `sprite-no-asset`;
the first three are errors, so a batch that leaves one writes nothing.
A frame the atlas doesn't have, or an atlas with no frame, is
`asset-frame-unknown`, with the closest frame:

```json scene=kitchen-sink expect=asset-frame-unknown
{ "ops": [{ "op": "update", "ref": "crate", "set": { "behaviors.sprite.frame": "crate-9" } }] }
```

A sprite with no `asset` is the warning `sprite-no-asset`: only its
fallback box draws, in the game and in `render`:

```json scene=kitchen-sink expect=sprite-no-asset
{ "ops": [{ "op": "update", "ref": "crate", "unset": ["behaviors.sprite.asset"] }] }
```

### Grids

`settings.grid` is the scene's one grid: `{ "kind": "square", "cell": [w,
h], "origin"?: [x, y] }`, or a hex grid with Tiled's parameters (`cell`,
`side`, `stagger` `"x"` or `"y"`, `index` `"odd"` or `"even"`). A type's
grid field (`gridField`) holds cells on it, local to the entity's `at`:
chunks of 32 × 32 cells keyed `"cx,cy"`, each a list of run-length rows
(`"1*4,2*8"` is four 1s then eight 2s; 0 is empty, values go to 65535).
On disk a grid entity spans lines, one chunk per line, and `fmt`
canonicalises the rows:

```text
{ "id": "floor", "type": "tiles", "at": [0, 0], "cells": {
  "0,0": ["1*16", "1*16", "1*4,2*8,1*4"]
} },
```

`paintCells` paints cells (`[col, row, value]`) and rectangles (`[c0, r0,
c1, r1, value]`, inclusive), at most 65,536 cells per op; value 0 erases.
No repo game has a grid type yet; on the CLI tests' card game
(`examples/paint-cells.json` paves a row of stone and erases one cell):

```sh
vp run scene apply card-table --ops scripts/scene/examples/paint-cells.json --dry-run
```

A grid field can't be overridden per instance (paint the prefab) or
addressed below the field by `update`. A grid setting or value that is
wrong, a grid field in a scene without `settings.grid`, or a turned
instance over a grid that isn't square with square cells is
`grid-invalid`:

```json scene=card-table expect=grid-invalid
{ "ops": [{ "op": "setSettings", "unset": ["grid"] }] }
```

### Transforms

Instances and groups take `rot` (1, 2 or 3 quarter turns, clockwise with
y down) and `flip: true` (mirror x in their own frame, before turning).
The eight combinations each have one spelling, and geometry on whole
pixels stays on them. A transform moves shapes, points and paths, turns direction and
angle fields, and remaps grid cells. `transform` speaks world terms and
composes onto what is there: `turn` (1, 2, 3 or -1), `flip` (`"x"` or
`"y"`) and `about` (each one's own `at` by default).
`examples/turn-instance.json` turns `gate-2` a quarter turn about a point
0.6 m above its foot, so it stands on the floor:

```sh
vp run scene apply kitchen-sink --ops scripts/scene/examples/turn-instance.json --dry-run
```

`setGroup` sets a group's `rot` and `flip` absolutely; `instantiate` and
`update` take them on an instance, with `z`:

```json scene=kitchen-sink
{
  "label": "Mirror the shelf and stand a gate on its side",
  "ops": [
    { "op": "transform", "groups": ["shelf"], "flip": "x" },
    { "op": "setGroup", "id": "shelf", "rot": 2 },
    {
      "op": "instantiate",
      "instance": {
        "id": "gate-9",
        "prefab": "gate",
        "at": [13, 11],
        "rot": 1,
        "flip": true,
        "z": 2
      }
    },
    { "op": "update", "ref": "gate-1", "set": { "flip": true, "z": -1 } }
  ]
}
```

### Nested prefabs

A prefab may hold `instances` of other prefabs. A nested child's id is its
path, `pair-1/right/bar`: in `show`, renders, playtests and at runtime.
An override key's child part may be a nested path (`right/bar.oneWay`) or
a nested instance itself (`left.z`, `left.rot`, `left.params.<name>`); the
outermost override wins. `applyToPrefab` folds overrides into the
instance's own prefab, or with `to` into a deeper one in its chain:

```json scene=kitchen-sink
{
  "label": "Two gates as one prefab",
  "ops": [
    {
      "op": "definePrefab",
      "id": "gate-pair",
      "prefab": {
        "entities": [],
        "instances": [
          { "id": "left", "prefab": "gate", "at": [-0.8, 0] },
          { "id": "right", "prefab": "gate", "at": [0.8, 0], "flip": true }
        ]
      }
    },
    {
      "op": "instantiate",
      "instance": { "id": "pair-1", "prefab": "gate-pair", "at": [13, 11.6] }
    },
    { "op": "override", "ref": "pair-1", "set": { "right/bar.oneWay": true, "left.z": 2 } },
    { "op": "applyToPrefab", "ref": "pair-1", "paths": ["right/bar.oneWay"], "to": "gate" }
  ]
}
```

`unpack` is one level: the instance's own children become entities, its
nested instances become instances in the scene, transforms baked in.
`createPrefab` takes instances among its `refs`, which move into the new
prefab as nested instances:

```json scene=kitchen-sink
{
  "label": "Fold the gates into a prefab, and unpack it again",
  "ops": [
    {
      "op": "createPrefab",
      "refs": ["gate-1", "gate-2"],
      "id": "gate-row",
      "at": [20.9, 11.6],
      "instance": "gates"
    },
    { "op": "unpack", "ref": "gates" }
  ]
}
```

In a prefab's own document (an `editScene` with the prefab's id),
`instantiate` nests an instance:

```json project=engine
{
  "v": 1,
  "label": "A gate on top of the post",
  "ops": [
    {
      "op": "editScene",
      "id": "post",
      "ops": [
        { "op": "instantiate", "instance": { "id": "top", "prefab": "gate", "at": [0, -1.4] } }
      ]
    }
  ]
}
```

A prefab that contains itself, through instances or variant bases, is
`prefab-cycle`; `instantiate` refuses one:

```json project=engine expect=prefab-cycle
{
  "v": 1,
  "ops": [
    {
      "op": "editScene",
      "id": "gate",
      "ops": [
        { "op": "instantiate", "instance": { "id": "inner", "prefab": "gate", "at": [0, 0] } }
      ]
    }
  ]
}
```

Prefabs nest at most 8 levels deep; a ninth is `prefab-depth`:

```json scene=engine-yard expect=prefab-depth
{
  "ops": [
    {
      "op": "definePrefab",
      "id": "n2",
      "prefab": { "entities": [], "instances": [{ "id": "a", "prefab": "gate", "at": [0, 0] }] }
    },
    {
      "op": "definePrefab",
      "id": "n3",
      "prefab": { "entities": [], "instances": [{ "id": "a", "prefab": "n2", "at": [0, 0] }] }
    },
    {
      "op": "definePrefab",
      "id": "n4",
      "prefab": { "entities": [], "instances": [{ "id": "a", "prefab": "n3", "at": [0, 0] }] }
    },
    {
      "op": "definePrefab",
      "id": "n5",
      "prefab": { "entities": [], "instances": [{ "id": "a", "prefab": "n4", "at": [0, 0] }] }
    },
    {
      "op": "definePrefab",
      "id": "n6",
      "prefab": { "entities": [], "instances": [{ "id": "a", "prefab": "n5", "at": [0, 0] }] }
    },
    {
      "op": "definePrefab",
      "id": "n7",
      "prefab": { "entities": [], "instances": [{ "id": "a", "prefab": "n6", "at": [0, 0] }] }
    },
    {
      "op": "definePrefab",
      "id": "n8",
      "prefab": { "entities": [], "instances": [{ "id": "a", "prefab": "n7", "at": [0, 0] }] }
    },
    {
      "op": "definePrefab",
      "id": "n9",
      "prefab": { "entities": [], "instances": [{ "id": "a", "prefab": "n8", "at": [0, 0] }] }
    },
    { "op": "instantiate", "instance": { "id": "deep", "prefab": "n9", "at": [10, 9] } }
  ]
}
```

A ref field (`attach`, or a game's `refField`) may name a child at any
depth (`gate-1/bar`, `room-1/door-1/panel`). A missing instance is
`dangling-ref`; an instance whose prefab has no such child is
`ref-child-unknown`, with a "did you mean":

```json scene=kitchen-sink expect=ref-child-unknown
{
  "ops": [
    {
      "op": "add",
      "entity": {
        "id": "hanger",
        "type": "solid",
        "shape": ["box", 19.8, 11, 0.2, 0.04],
        "attach": "gate-1/door"
      }
    }
  ]
}
```

### Variants

A variant is a prefab with a `base`: its children are the base's with the
variant's `overrides` applied, plus its own entities and instances. It
can't remove a base child; it overrides `off: true`. The editor's Create
variant is a `createAsset` of a prefab whose content names its `base`; on
files, `definePrefab` writes one, and `setPrefabBase` in a prefab's own document sets or (with
`null`) clears its base:

```json scene=kitchen-sink
{
  "label": "A wide gate",
  "ops": [
    {
      "op": "definePrefab",
      "id": "wide-gate",
      "prefab": {
        "base": "gate",
        "overrides": { "bar.shape": ["box", 0, -0.1, 1.2, 0.1] },
        "entities": []
      }
    },
    {
      "op": "instantiate",
      "instance": { "id": "wide-1", "prefab": "wide-gate", "at": [13, 11.6] }
    }
  ]
}
```

```json project=engine
{
  "v": 1,
  "label": "The post becomes a gate with a pole",
  "ops": [{ "op": "editScene", "id": "post", "ops": [{ "op": "setPrefabBase", "base": "gate" }] }]
}
```

In a prefab's own document, `override` and `revertOverride` with no `ref`
set and drop the variant's own overrides of its base's children (keys
`<child>.<field.path>`, as on an instance; `revertOverride` with no
`paths` drops them all). Here `one-way-latch`, a variant of `latch`, gets
a wider bar and gives up its one-way override:

```json project=engine
{
  "v": 1,
  "label": "A wider latch bar that blocks both ways",
  "ops": [
    {
      "op": "editScene",
      "id": "one-way-latch",
      "ops": [
        { "op": "override", "set": { "bar.shape": ["box", 0, -0.1, 0.8, 0.1] } },
        { "op": "revertOverride", "paths": ["bar.oneWay"] }
      ]
    }
  ]
}
```

Validated in the variant's own view, an override path naming no child of
the base is `unused-override`, and one naming a grid field is
`grid-invalid`. Each one's fix, applied in the variant's document, is the
no-`ref` `revertOverride` of that path:

```json
{ "op": "revertOverride", "paths": ["door.off"] }
```

Sent to a scene, the no-`ref` form is refused with `op-invalid`, like the
other header ops:

```json scene=kitchen-sink expect=op-invalid
{ "ops": [{ "op": "override", "set": { "bar.oneWay": true } }] }
```

A base that isn't a prefab in the project is `variant-base-unknown`, with
a "did you mean":

```json project=engine expect=variant-base-unknown
{
  "v": 1,
  "ops": [{ "op": "editScene", "id": "post", "ops": [{ "op": "setPrefabBase", "base": "gat" }] }]
}
```

### Parameters

A prefab exposes parameters: each has a `description`, the override
`targets` inside the prefab its value feeds, and an optional `default`. An
instance's `params` apply as overrides of every target; its own
`overrides` still win. A variant inherits its base's parameters and may
redeclare one. `exposeParam` declares, replaces or (with `null`) removes
one in the prefab's own document; `setParam` sets (or with `null` clears)
one on an instance, as do `instantiate` and `update` on `params.<name>`.
A param's optional `map` gives a target its own value per string value
of the param: tactics' `knight` maps `side` to
`{ "unit.behaviors.sprite.frame": { "blue": "knight-blue", "red": "knight-red" } }`,
so its `unit.side` gets `"red"` and its frame `"knight-red"`. A mapped
target with no entry for the value keeps its own; a map of a path that
isn't a target, an empty map, or a non-string `default` beside a map is
refused. Exposing one on `gate`:

```json project=engine
{
  "v": 1,
  "label": "A one-way switch on the gate",
  "ops": [
    {
      "op": "editScene",
      "id": "gate",
      "ops": [
        {
          "op": "exposeParam",
          "name": "oneWay",
          "param": {
            "description": "The side things land on, for a one-way bar.",
            "targets": ["bar.oneWay"]
          }
        }
      ]
    }
  ]
}
```

A scene batch can't use a parameter another doc's `editScene` exposes in
the same project batch: the scene is judged against the prefabs as they
were. `definePrefab` in the scene's own batch can, so here a variant of
`gate` declares the parameter and three instances set it:

```json scene=kitchen-sink
{
  "label": "Gates with a one-way switch",
  "ops": [
    {
      "op": "definePrefab",
      "id": "switch-gate",
      "prefab": {
        "base": "gate",
        "params": {
          "oneWay": {
            "description": "The side things land on, for a one-way bar.",
            "targets": ["bar.oneWay"]
          }
        },
        "entities": []
      }
    },
    {
      "op": "instantiate",
      "instance": {
        "id": "switch-1",
        "prefab": "switch-gate",
        "at": [13, 11.6],
        "params": { "oneWay": true }
      }
    },
    {
      "op": "instantiate",
      "instance": { "id": "switch-2", "prefab": "switch-gate", "at": [14.4, 11.6] }
    },
    { "op": "setParam", "ref": "switch-2", "name": "oneWay", "value": "down" },
    { "op": "update", "ref": "switch-1", "set": { "params.oneWay": "left" } }
  ]
}
```

A parameter the prefab doesn't expose is `param-unknown`; its fix clears
it with `setParam`:

```json scene=kitchen-sink expect=param-unknown
{ "ops": [{ "op": "setParam", "ref": "gate-1", "name": "speed", "value": 1.2 }] }
```

### New and changed ops

| Op               | What it does in v3                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transform`      | turns and flips instances (`refs`) and groups (`groups`) in world terms, composing onto what they have                                                                                                    |
| `setZ`           | sets `z`, or shifts it `by`, on entities and instances; bulk entries refuse                                                                                                                               |
| `useAssets`      | adds and removes ids in the scene's or prefab's `assets` header                                                                                                                                           |
| `paintCells`     | paints `cells` and `rects` of an entity's grid field; 0 erases                                                                                                                                            |
| `setPrefabBase`  | a prefab's document only: sets or (`null`) clears its variant base                                                                                                                                        |
| `exposeParam`    | a prefab's document only: declares, replaces or (`null`) removes a parameter                                                                                                                              |
| `setParam`       | sets or (`null`) clears one parameter on an instance                                                                                                                                                      |
| `setGroup`       | gains `rot` and `flip`, absolute (0 and `false` are written as absent)                                                                                                                                    |
| `instantiate`    | takes `rot`, `flip`, `z` and `params`; nests in a prefab's document; refuses a cycle                                                                                                                      |
| `override`       | the child part may be nested (`right/bar`) or a nested instance (`left.z`); with no `ref`, in a prefab's own document, sets the prefab's own overrides of its base (a scene refuses it with `op-invalid`) |
| `revertOverride` | the same paths as `override`; with no `ref`, in a prefab's own document, drops the prefab's own overrides of its base (a scene refuses it with `op-invalid`)                                              |
| `applyToPrefab`  | gains `to`: the prefab in the chain that receives the values                                                                                                                                              |
| `unpack`         | one level: nested instances become instances, transforms baked                                                                                                                                            |
| `createPrefab`   | `refs` may include instances, which become nested instances                                                                                                                                               |
| `definePrefab`   | the body takes `instances`, `base`, `overrides`, `params` and `assets`                                                                                                                                    |
| `update`         | addresses `behaviors.<name>.<field>`, `z`, an instance's `rot`, `flip`, `z` and `params.<name>`; not below a grid field                                                                                   |

## Movement numbers come from tooling

Jump height, gap distances, dash length and grapple range are not written
down here on purpose: they change whenever the movement tuning changes. Get
them by stepping the runtime (`step` with an input list), and later from the
generated movement envelope. Never from memory or from reading constants.

## Issue codes

`vp run scene codes` lists every code. Engine codes are bare; a game's are
prefixed with its id (`platformer/no-goal`). Issues come errors first, then
warnings, then info, each group in the order its `path` appears in the
file. An issue whose code is fixable carries a `fix` batch whenever the
repair is mechanical; apply it as it is (`apply --ops -` with the batch on
stdin). The ones you'll meet first:

- `bad-shape`: a tuple with the wrong tag or arity. The message gives the
  expected signature, e.g. `["box", cx, cy, hw, hh, rotDeg?]`.
- `unknown-key` / `unknown-type`: a key or `type` the scene's registry
  doesn't define; the message suggests the closest one.
- `unknown-game`: the scene's `game` isn't one the CLI knows.
- `dup-id`: two entities share an id. Rename the later one; its hint names
  a free id.
- `stale-base`: a bulk ref against an old hash. Re-read with `show` and
  rebuild the batch.
- `out-of-bounds` / `platformer/spawn-missing`: geometry outside `bounds`,
  or a platformer scene with no spawn.

Project batches add their own:

- `asset-missing`: a reference names an asset that isn't there or is in
  the trash; the message suggests the closest id.
- `asset-kind`: an asset of the wrong kind for the op or the reference
  (`editAsset` on a texture, a prefab ref naming a material).
- `asset-in-use`: `deleteAsset` on an asset something still names once
  the whole batch has run (`detail.referrers` lists each site); pass
  `--force` to delete it anyway. A `definePrefab` with `"prefab": null` on
  a prefab another asset still places gets it too, live and on files; it
  has no force. In the editor, a removal is judged against the scenes the
  browser has open, and the dev server restores a prefab a scene still
  places once that scene is open. A later op of the same batch can't
  define or change a prefab an earlier op removed (`op-invalid`).
- `asset-id-taken` / `path-taken`: another live asset holds the id or the
  path.
- `hash-mismatch`: uploaded bytes hash to something other than the hash
  they were sent with.
- `code-skew`: a newer build changed the kind's schema; this build may read
  the doc but not write it. Update and rebuild.
- `asset-too-large` / `quota-exceeded`: one file over its kind's size
  limit, or a project over its storage quota.
- `import-failed`: a binary's header couldn't be read with its import
  settings.

Format v3 adds these; [Format v3](#format-v3) has a batch that reports each:

| Code                   | Severity | Meaning                                                        | Fix                                          |
| ---------------------- | -------- | -------------------------------------------------------------- | -------------------------------------------- |
| `prefab-cycle`         | error    | A prefab contains itself through instances or variant bases.   | —                                            |
| `prefab-depth`         | error    | Prefabs nest deeper than 8 levels.                             | —                                            |
| `variant-base-unknown` | error    | A variant's base isn't a prefab in the project.                | did-you-mean, `setPrefabBase`                |
| `param-unknown`        | error    | An instance sets a parameter its prefab doesn't expose.        | `setParam` to `null`                         |
| `layer-unknown`        | error    | An entity or instance names a layer the registry doesn't have. | `update` unsetting `layer`                   |
| `behavior-unknown`     | error    | An entity carries a behavior that isn't registered.            | did-you-mean, or unset the block             |
| `behavior-forbidden`   | error    | An entity's type doesn't allow this behavior.                  | unset the block                              |
| `behavior-missing`     | error    | A behavior's `requires` isn't on the same entity.              | add the required block with defaults         |
| `grid-invalid`         | error    | A grid setting, grid value or grid placement is invalid.       | `fmt` for non-canonical rows; otherwise none |
| `ref-child-unknown`    | error    | A child ref names an instance whose prefab has no such child.  | did-you-mean                                 |

Sprites add these; [Sprites](#sprites) has a batch that reports each:

| Code                  | Severity | Meaning                                                                           | Fix          |
| --------------------- | -------- | --------------------------------------------------------------------------------- | ------------ |
| `asset-frame-unknown` | error    | A sprite names a frame its atlas doesn't have, or names an atlas without a frame. | did-you-mean |
| `sprite-no-asset`     | warn     | A sprite has no `asset`, so only its fallback box draws.                          | set `asset`  |

World models add these; [World models](#world-models) has an example that
reports each:

| Code                | Severity | Meaning                                                                                                    | Fix                                       |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `tick-rate-invalid` | error    | A tick rate (`engine.tickRate`, a game's `time.rate`) that isn't an integer from 1 to 240.                 | set one in range                          |
| `physics-required`  | error    | An entity needs physics (a `prop`, an `attach`, a type that requires it) in a scene whose physics is none. | set physics to rapier (fix), or remove it |
| `physics-skipped`   | info     | A game's physical check that needs physics was skipped in a scene without it.                              | —                                         |
| `grid-unreachable`  | error    | A `connected` check's target has no path from its start on the grid.                                       | open a path, or drop it                   |
| `nav-invalid`       | error    | A nav polygon crosses itself, a hole isn't inside exactly one walk area, or two walk areas overlap.        | reshape the polygons                      |

Input v2 adds these; [Input v2](#input-v2) has a batch that reports the
first two:

| Code                       | Severity | Meaning                                                                                                                                        | Fix                             |
| -------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `binding-unknown`          | error    | A binding names an action, key code, pad button or axis, pointer button or touch control that doesn't exist, or doesn't fit its action's kind. | did-you-mean                    |
| `player-unknown`           | error    | A binding, script track, command or seats declaration names a seat past `players.max`, or declares more than 8.                                | a seat from 0 to `max` − 1      |
| `recording-other-platform` | warn     | A Rapier recording is replayed on another CPU architecture than it was made on, so it may not replay bit for bit.                              | replay it where it was recorded |

Format v4 adds one; [Units and format v4](#units-and-format-v4) says when:

| Code                   | Severity | Meaning                                                                                                                                             | Fix                                                                          |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `migration-unresolved` | error    | A v3 file's move to metres needs the game's registry or a prefab it names, which the reader doesn't have; the file stays v3, read-only when hosted. | `fmt` in its project; a hosted project is pulled, formatted and seeded again |

Asset fields reuse `asset-missing` and `asset-kind`; a variant's child
whose id its base already has is `dup-id`, and a nested or pasted instance
of a missing prefab is `prefab-unknown`.

Lifecycle adds these; a running game throws them as an `EngineError`, and
[Lifecycle](#lifecycle) has a playtest that reports each:

| Code                   | Severity | Meaning                                                                                                                                                  | Fix                                                  |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `spawn-id-invalid`     | error    | A spawn or prefab placement id isn't `<name>#<label>` for its type or prefab, has an all-digit label, or is already live.                                | omit `id` for the next `<name>#<n>`, or pick a label |
| `prefab-not-spawnable` | error    | `ctx.instantiate` can't place a prefab: not in the run's library, cyclic or too deep, or a child needs physics; its `cause` carries the underlying code. | fix the prefab, the library or the scene's physics   |

`game new` adds one; [New games](#new-games) has a command that reports it:

| Code               | Severity | Meaning                                                                                | Fix                                                         |
| ------------------ | -------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `project-id-taken` | error    | A new project's id is already a discovered project's, or its directory already exists. | pick another id, or remove the existing project's directory |

Flow and saves add these; [Flow](#flow) and [Saves](#saves) have an
example that reports `start-scene-missing`, `save-unsupported` and
`save-version-newer`. The rest come from a running game: an attach
returns `sublevel-invalid`, a runtime `go` to an unlisted scene refuses
with `scene-unlisted`, a save store or `GameInstance.saves` returns
the save codes, and a host's store returns `save-forbidden`:

| Code                  | Severity | Meaning                                                                                                                                                                           | Fix                                                                                    |
| --------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `scene-unlisted`      | warn     | Flow names a scene the scene list doesn't hold: a listed scene's check, or an export; an error when a running game requests one.                                                  | list the scene through `assets apply`, or name a listed one                            |
| `start-scene-missing` | error    | The project has no scene list, or its `start` is null, names no scene, or names an unlisted scene or a sublevel.                                                                  | set `start` to a listed scene that isn't a sublevel                                    |
| `sublevel-invalid`    | error    | A sublevel can't attach: unlisted, its physics, grid or gravity differs from the main scene's, `at` is off a cell boundary, or its label is taken or malformed (`detail.reason`). | list it, match the main scene's settings, put `at` on whole cells, pick a free label   |
| `save-version-newer`  | error    | A save's game version is past the game's `saves.version`, or a migration step between them is missing.                                                                            | load it with the build that wrote it, or add the step to `saves.migrations`            |
| `save-too-large`      | error    | A save is bigger than the game's save limit (64 KB by default), so it wasn't written.                                                                                             | save less state, or raise `saves.limits.maxBytes` (1 MiB at most in a browser)         |
| `save-slot-limit`     | error    | A save to a new slot would pass the slot limit (8 by default); overwriting a slot never does.                                                                                     | remove or overwrite a slot, or raise `saves.limits.maxSlots` (64 at most in a browser) |
| `save-unsupported`    | error    | A world save can't be taken: the scene runs on Rapier, a function timer or coroutine is pending, or the game has no `restore` (`detail.causes`).                                  | take a progress save, or remove each cause                                             |
| `save-store-failed`   | warn     | The save store threw or refused a read or a write; the game keeps running.                                                                                                        | read the store's `describe`, and try again or use another store                        |
| `save-forbidden`      | error    | The host refused this save: the player is signed out, or the game doesn't save to that host.                                                                                      | sign in, or check where the game saves                                                 |

Game builds add these; [Game builds](#game-builds) has a build that
reports `export-target-unsupported`. The rest come from a build of a
project or a check of one (`game build`, `game export --zip`, `game
manifest`):

| Code                        | Severity | Meaning                                                                                                                                          | Fix                                                                              |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `export-asset-missing`      | error    | A file a build or its manifest names isn't there; at warn, an `export.icons` texture that isn't a PNG of its size, replaced by the default icon. | build again; for an icon, name a 192×192 or 512×512 PNG texture, or drop it      |
| `export-over-budget`        | error    | A build is over a size budget (code, first load, total or one file); it is still written, and the message names the largest contributors.        | shrink what it names, raise `export.budget`, or build with `--allow-over-budget` |
| `export-itch-layout`        | error    | An `itch` build breaks itch.io's HTML5 layout: too many files, too large, a long path, no root `index.html`, or a dotfile.                       | remove or shrink what the message names                                          |
| `export-target-unsupported` | error    | `--target` names a release target this engine version doesn't build; the message lists the ones it does.                                         | build `web` or `itch`                                                            |
| `licence-missing`           | warn     | A shipped blob has no licence recorded; it ships, listed under "No licence recorded" on the credits page.                                        | record it with a `setLicence` op (`assets apply`)                                |

Live levels add these; [Live levels](#live-levels) has the commands that
report them. `game live check` reports the first four against a release,
and the swap check `live-swap-failed`; a running game raises
`live-swap-failed` and `live-timing-unsupported` through its live updates,
and a replay `scene-version-removed`:

| Code                      | Severity | Meaning                                                                                                                                                                                                                                                                  | Fix                                                                                      |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `live-incompatible`       | error    | A scene version was made for another build of the game, another scene format, or another game or configuration than the release (`detail.rule`: `build`, `formats` or `game`).                                                                                           | build it again from the code the release was built from, or publish a release            |
| `live-scene-unlisted`     | error    | The release's scene list doesn't hold the version's scene, or holds it with another sublevel flag.                                                                                                                                                                       | add the scene to the list and publish a release                                          |
| `live-physics`            | error    | The version's scene needs physics, and the release was built without it.                                                                                                                                                                                                 | publish a release so the build includes physics                                          |
| `live-asset-conflict`     | error    | The version carries a changed asset that the release ships under the same id; only the scene and its prefabs change live.                                                                                                                                                | keep the old asset under its id and add the new one under a new id, or publish a release |
| `live-swap-failed`        | error    | A version couldn't be staged or applied while playing (`detail.phase`). A failed staging (`stage`) keeps the version the scene runs; after a refused swap step (`swap`) or a throwing `onSwap` (`onSwap`) the old version keeps running and the new one loads next time. | read the hint (the `onSwap` error or the refusing step) and fix the hook or the scene    |
| `live-timing-unsupported` | warn     | A version goes out with a timing the game doesn't declare, so it reaches players at the strongest one the game accepts.                                                                                                                                                  | declare more timings in `GameDefinition.live.timings`                                    |
| `scene-version-removed`   | error    | A replay needs a scene version it can't find: a segment's `sceneVersion` (the replay doesn't start) or a swap's (it stops at `detail.tick`).                                                                                                                             | replay with `--versions` naming a directory that holds it                                |

Standard behaviors add these;
[Standard behaviors](#standard-behaviors) has a batch that reports each of
the first five, and a running game throws the last two as an
`EngineError` from `ctx.bodies`:

| Code                  | Severity    | Meaning                                                                                                                                                                                                                                                       | Fix                                                                                                                               |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `behavior-conflict`   | error, warn | An entity carries two behaviors that can't share it, such as both character controllers; a warning for a `path-follow` that can't move its entity: a collider with no body or a static one, or a solid, prop, follower or sensor, whose own system places it. | unset one of the two blocks; for the warning, give the collider a kinematic body                                                  |
| `character-body-kind` | error       | A character behavior is on an entity whose body is dynamic, so the controller and the physics solver would both move it.                                                                                                                                      | set the body's `kind` to `kinematic` (fix), or unset it                                                                           |
| `nav-missing`         | warn        | An entity carries `nav-agent`, but the scene has no walk area for it to walk.                                                                                                                                                                                 | add a `nav` walk area, or unset the block                                                                                         |
| `joint-ref-type`      | error       | A joint's `to` names an entity with no body to hold: no `body` or `collider` and not a solid, prop or follower, or only a sensor.                                                                                                                             | point `to` at an entity with a body or a solid collider                                                                           |
| `joint-self`          | error       | A joint's `to` names the entity that carries it.                                                                                                                                                                                                              | point `to` at the other entity                                                                                                    |
| `body-missing`        | error       | `ctx.bodies` was asked about an entity id that has no body.                                                                                                                                                                                                   | give the entity a body, or check `ctx.bodies.has(id)`                                                                             |
| `body-not-dynamic`    | error       | A `ctx.bodies` write went to a body that doesn't take it: a force, torque or impulse to a kinematic or static body, a velocity to a static body or a follower (its path sets it), or an angular velocity to a kinematic body.                                 | check `ctx.bodies.kind(id)` first; push only a dynamic body, move a kinematic one with `setVelocity`, a follower through its path |

## The agent surface version

Issue codes, op names, the JSON Schema `$id`s, these commands and their
flags, the `.checks.json` kinds and the MCP tool names are versioned
together as the agent surface, apart from the engine's
semver and the scene format's `v`. `codes --json` reports it as
`agentSurface`, and every JSON Schema the engine publishes carries it as
`x-agent-surface`. A client written against one version can check it before
trusting codes or flags.

## Code layout

- `cli.ts`: process entry; `commands.ts`: argument parsing and the command
  table; `projects.ts`: `discoverProjects` and the `ProjectHandle` each
  project becomes (its game, registries with its materials overlaid, and dev
  cache); `context.ts`: `ToolContext` (`projects`, `--project`), the
  registry a scene is judged by, and finding scenes in the projects; `rapier-compat.ts`:
  injects `@dimforge/rapier2d-compat`, because the standard Rapier build
  can't construct a world under Bun.
- `tools/*.ts`: one pure `(input, ctx) => Promise<ToolResult>` per command;
  `project-*.ts` and `assets-*.ts` are the project commands, the writers
  over `runProjectBatch` in `tools/assets-apply.ts`; `apply --live` is
  `tools/apply-live.ts`. `project-client.ts` is the live side: a
  `ProjectSession` over one `HocuspocusProviderWebsocket` with a
  `HocuspocusProvider` per doc (kept until the client closes, since
  Hocuspocus can't reopen a doc at once on one socket), the dev server's
  project list and blob routes. `hosted.ts` is the hosted side: it trades an agent token for sync
  tokens, and calls the site's blob and bundle routes; `project pull` and
  `project push` are `tools/project-pull.ts` and `tools/project-push.ts`. `dev-sink.ts` builds the dev server's collab server over every
  project, which the root `vite.config.ts` registers. `default-context.ts`
  builds the `ToolContext` the CLI and the MCP server share.
- `tools/game-new.ts` is `game new`: it renders `game-templates/*.ts`
  (each a function returning a file's text, formatted as `vp fmt` writes
  it), stages them under `node_modules/.game-new/` to import the game and
  build its scene and schemas from its registry, and writes only once the
  scene, checks and script have no error. Its output per preset is pinned by
  `__tests__/fixtures/game-new/`.
- `mcp-tools.ts`: the MCP tool table (names, annotations, zod inputs, and
  each tool over its command); `mcp.ts`: the server, the only file that
  imports the MCP SDK.
- `raster.ts`: SVG to PNG for `render`, with resvg-wasm and the site's Rubik
  files from `src/lib/og/assets/`; the engine stays font-free.
- `tools/game-build.ts`, `game-export.ts` and `game-manifest.ts` are
  `game build`, `game export` and `game manifest`, and `replay --releases`
  (`replayRelease` in `game-manifest.ts`); `engine-dist.ts` packs the
  engine a build bundles. `tools/game-live.ts` is `game live build` and
  `game live check`, over the engine's `buildSceneVersion`,
  `checkSceneVersion` and `swapCheck`.
- `examples/`: the op batches, input list, input scripts, checks file,
  save fixture and image this README uses.
- `__tests__/`: the tools against temp projects (`fixtures.ts`), with the
  platformer and a small inline game; the asset commands on files and live;
  the repo's own projects; and every command and op batch in this README.

Adding or renaming a command, flag, op, issue code or schema id is an agent
surface change: bump `AGENT_SURFACE_VERSION`, update
`packages/engine/CHANGELOG.md`, regenerate `packages/engine/__tests__/public-api.json`,
and re-pin the hash in `packages/engine/scene/__tests__/agent-surface.test.ts`.
