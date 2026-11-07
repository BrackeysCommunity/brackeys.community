# Scene CLI

Read, check, edit and step scenes from a terminal or an agent. Each game
keeps its scenes in `src/games/<id>/scenes/*.json`, and scenes that name no
game live in `src/engine/scenes/`; the games the CLI knows are listed in
`games.ts`. It is built only from the engine's public entries
(`@jams/engine/scene`, `/headless`, `/game`, `/vite`) and each game's entry,
and every command is a pure function in `tools/`, which the MCP server
(`mcp.ts`, [below](#mcp)) reuses.

```sh
vp run scene list
vp run scene show test-yard --type mover
vp run scene validate test-yard
vp run scene validate test-yard --physical
vp run scene check engine-yard
vp run scene schema scene --game platformer
vp run scene step test-yard --ticks 60 --hold move_right
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
materials, settings, actions and issue codes. A scene without `game` uses
the engine's primitives only (`solid`, `sensor`, `marker`, `prop`,
`follower`, `note`) and means the same to every tool. A `game` the CLI
doesn't know is an `unknown-game` issue.

A scene argument is a name (`test-yard`), looked up in every home (each
game's scenes directory, and `engine` for gameless scenes) with the same
guard as the dev server's collab server: lowercase letters, digits and dashes
only. A name held by two homes is refused, and `list` reports the clash.
`show`, `step`, `validate`, `diff`, `playtest`, `fuzz` and `render` also
take a file path or `-` for stdin, read-only, and `check` a file path; `fmt`,
`apply` and `new` write, so they take names only. `step`, `playtest`, `fuzz`
and `check` run a scene without a `game` key under one with `--game <id>`;
`--game` on a scene that names a game is a usage error.

Two scenes to practise on: `test-yard` (the platformer's) and
`engine-yard` (primitives only).

## Commands

| Command                                                                               | Writes              | What it returns                                                                                                  |
| ------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `list`                                                                                | no                  | every scene with its `game`, `sceneHash`, issue counts, entity counts per type and bounds, `clashes`             |
| `show <scene\|file\|-> [--ref id] [--type t] [--near x,y,r]`                          | no                  | entities and bulk entries with their ref, type, raw shape, world AABB and top span, plus `sceneHash`             |
| `schema [scene\|ops\|script\|checks\|recording] [--game id]`                          | no                  | a scene, op-batch, input-script, checks or recording JSON Schema (`urn:jams-engine:<kind>:<game>:v1`)            |
| `codes`                                                                               | no                  | `agentSurface` and every issue code with its severity, summary, hint and fixability, grouped by owner            |
| `validate <scene\|file\|-> [--physical]`                                              | no                  | `SceneIssue[]` with JSON Pointer paths and line numbers; `--physical` adds the physics world's; exit 1 on errors |
| `fmt <scene> [--check]`                                                               | yes, unless check   | rewrites the canonical form; `--check` exits 1 when the file isn't canonical                                     |
| `apply <scene> --ops <file\|-> [--dry-run] [--base hash] [--live …]`                  | yes, unless dry run | the `ApplyResult`: diff, inverse, created ids, ref remap, issues and the new `sceneHash`                         |
| `diff <a> (<b> \| --git <rev> \| --ops <file\|->)`                                    | no                  | `changes`: what changed from the first side to the second, entity by entity                                      |
| `new <name> [--game id] [--from scene]`                                               | yes                 | writes a new scene from the game's template, or a copy of `--from` under the new name                            |
| `step <scene\|file\|-> [--ticks N] [--hold a,b] [--inputs file] [--game id]`          | no                  | a headless probe: events by entity id, the game's final snapshot, runtime stats                                  |
| `playtest <scene\|file\|-> --script <file\|-> [--at x,y] [--game id] [--record file]` | with --record       | a headless run of an input script: outcome, steps, events, focus trail, `recording`; exit 1 when blocked         |
| `replay <scene\|file\|-> --run <file\|-> [--game id]`                                 | no                  | replays a run recording (or a playtest report's) headless; exit 1 when it ends differently                       |
| `fuzz <scene\|file\|-> [--seed s] [--rollouts n] [--ticks n] [--game id]`             | no                  | seeded random rollouts: entities reached in N of M runs, first ticks, results, ticks per second                  |
| `check <scene\|file> [--checks file] [--only id] [--game id]`                         | no                  | runs `<scene>.checks.json`; each check passes, fails or is skipped; exit 1 when one fails                        |
| `render <scene\|file\|-> [--out file] [--ascii] [view flags…]`                        | with --out          | a schematic PNG or SVG of the scene, or `--ascii` a character map; see [Rendering](#rendering)                   |
| `textconv <file>`                                                                     | no                  | a scene as one sorted line per header field, bulk entry and entity, for `git diff`                               |

Every JSON report names the scene hash `sceneHash`. `show` returns at most
200 rows and sets `truncated: true` past that; narrow it with a filter.
`show` rows put an entity's shape, point and the AABB first and every other
field in `extra`; a shape that rides a path (a `follower`, the platformer's
`mover`) is placed at its first path point. A group member's row also has
the group's `origin`: its `shape` and `at` stay as stored, relative to it,
while its AABB and `--near` are in world px. Each prefab instance is a row of
type `instance` (its `prefab`, its world `at`, the rest in `extra`) followed by
its children as `gate-3/door` rows in world coordinates, each naming its
`instance`; edit those with `override`, not `update`.

`diff` reports `{ from, to, changed, changes }`, each change a
`SceneChange`: `added`, `removed`, `renamed` (an entity whose content is the
same under a new id), `modified` (one field path), `moved`, or `scene` (the
header and `settings` keys). Bulk entries are compared per key by index.
With `--git <rev>` the revision is the old side, as in `git diff <rev>`; with
`--ops` the second side is the first with the batch applied, and nothing is
written.

`new` writes into the scene's home: the game's (`--game`), the `engine`
home without one, or the home of the `--from` scene. Without `--from` it
starts from the game's template (the platformer's has a floor, a spawn, the
cheese, the hole and a kill plane), or an empty 1920×1080 world for a scene
without a game. It sets `$schema` to the home's committed schema file and
writes nothing when the name is taken anywhere or the result has errors.

`step` reports `{ scene, game, sceneHash, configHash, tickRate, ticks,
load, events, truncated, final, outcome?, stats }`. `final` is the game's
own snapshot (the platformer's is its player: position, velocity, state,
grounded, `groundId`), and `null` for a scene stepped without a game: the
engine has no player, so read its `events` and `stats` instead. `events` are
the engine's `sensor:enter` / `sensor:exit` (`entityId` the sensor, `other`
what crossed it) and the game's own (the platformer's `landed` and
`left-ground`). `configHash` changes with the engine version, the game and
its tuning, so a stale report can be told from a fresh one. A scene without
a game steps under one with `--game <id>`; `--game` on a scene that names a
game is a usage error.

`apply` writes only when the batch applied and left no error-severity
issue. `step --inputs` takes a JSON array of `[tick, action, 0|1]` edges;
`--hold` presses actions at tick 0 and never releases them. Action names
are the game's (the platformer's are `move_left`, `move_right`, `jump`,
`move_down`, `dash` and `grapple`), and any other name is a usage error
with a suggestion; the simulation runs at 60 ticks a second.

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
vp run scene show test-yard --near 1300,700,200
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

A new level starts from the game's template, or from a copy of a scene:

```sh
vp run scene new my-level --game platformer
vp run scene new yard-copy --from test-yard
```

If you edited JSON by hand anyway, run `fmt` and then `validate`.

## Playtests and fuzz

`playtest` plays an input script, a small JSON language that compiles to
input edges, on a fresh play world started the way the editor's Play starts
one: validation errors block, and `at` (or `--at x,y`, which overrides it)
is cast down onto the first surface with the game's spawn shape and refused
inside a solid. `schema script --game <id>` is the reference; a script's
`$schema` points at the committed `src/games/<id>/input-script.schema.json`
(the engine's is `src/engine/scene/input-script.schema.json`).

- Steps: `{ "hold": [...], "for": ticks }`, `"forMs"` (rounded to 60 Hz
  ticks) or `"until": {...}` capped by `"max"` (default 600); `{ "press": a }`
  for one tick; `{ "wait": n }`. A step names everything held during it;
  what the step before held and this one doesn't is released when it starts.
- `until` keys AND together and are checked after each tick: `event` (a
  type, or `{ type, entityId?, other? }`), `tick` (absolute), and the game's
  predicates (the platformer's `grounded`).
- `maxTicks` (default 1800), `scene` (a run against another scene is
  refused), `at`, `timeOffsetMs`, and `game` for the game's play options.

The run ends with the game's outcome (its `play.outcome` hook; the
platformer declares none yet), `stuck` (a movement action held while the
focus moves under 4px in 120 ticks), `script-end` or `timeout`. The report
has `outcome` (`result`, `tick`, `at`, `cause`), `steps` (each started
step's start tick, length and why it ended: `done`, `until`, `max` or
`run`), `events` (at most 1000, then `truncated`), `trail` (the focus every
4 ticks), `final` (the game's snapshot), `inputs` (the `[tick, action, 0|1]`
edges played, `until` steps resolved), `sceneHash` and `configHash`. A
script that doesn't compile, a scene with errors or a start that doesn't
load is `blocked` with its `stage` and issues, and exits 1; an unknown
action or key gets a "did you mean". Pass the report to `render --overlay`
to see its trail.

`fuzz` runs seeded random rollouts (`--rollouts`, default 100, each up to
`--ticks`, default 600). Each starts like Play and holds one or two random
actions for 4–60 ticks at a time, or the game's own macros. It reports each
entity an event named (`touched`, by id or bulk ref, `reached` in how many
rollouts, `firstTick` and `firstRollout`), the loadable entities nothing
touched (`untouched`), how the rollouts ended (`results`) and the measured
`timing`. The same `--seed` (a number or a string, default 1) gives the
same report apart from `timing`, and a longer fuzz repeats a shorter one's
first rollouts.

```sh
vp run scene schema script --game platformer
vp run scene playtest test-yard --script scripts/scene/examples/hop-left.json
vp run scene playtest test-yard --script scripts/scene/examples/hop-left.json --at 300,600
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
a failure by itself.

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
`schema checks --game <id>` is the reference (`urn:jams-engine:checks:v1`,
`…:<game>:v1` with a game's kinds).

```json
{
  "v": 1,
  "checks": [
    { "id": "valid", "kind": "valid", "physical": true },
    {
      "id": "settles",
      "kind": "reaches",
      "script": { "v": 1, "steps": [{ "wait": 60 }] },
      "result": "script-end"
    },
    { "id": "zone", "kind": "touches", "entity": "zone", "atLeast": 10, "rollouts": 50, "seed": 1 }
  ]
}
```

- `valid`: no issues at or above `max` (`error`, the default, or `warn`);
  `physical: true` adds `validate --physical`.
- `reaches`: the input script's playtest (`script` inline, or a file
  relative to the checks file; `at` overrides its start) ends with `result`,
  one of the run results (`timeout`, `script-end`, `stuck` and the game's).
  A blocked run fails.
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

## Rendering

`render` draws a scene so you can look at it: a schematic, not the game's
look. Every entity is drawn through the same outline the game draws, in its
registered type's colors (a material's color wins), with a grid and axis
ticks in world px every 64 or 128px (wider on big scenes), id labels, and
every path rider's waypoints numbered with a dashed ghost of the body at
each. The image's longest side is at most 1600px; `--scale` (image px per
world px, default 1) only shrinks under that cap. Text is Rubik.

- `--out file.png` rasterises with resvg, `--out file.svg` writes the SVG,
  and without `--out` the SVG goes to stdout. `--json` reports the
  `region`, `scale`, `width`, `height` and `tick` (and the `svg` without
  `--out`).
- `--region x0,y0,x1,y1` draws that world rectangle; `--around ref` frames
  one entity (an id or a `~bulk:index` ref, its whole path included) with
  `--margin n` px around it (default 128). Without either, the scene's
  `bounds`.
- `--labels entities|all|none`: ids at each entity (the default), `all`
  adds bulk refs such as `~solid:4`, `none` draws no labels.
- `--overlay report.json` draws a report over the scene: its `issues`
  (dashed boxes around the entities they name, a ring at `at`), a
  playtest's `trail`, its `events` (dots by type, with a legend) and its
  `outcome` (a cross with the result and tick). A playtest report, a
  blocked playtest or `validate --json` output all work; `-` reads stdin.
- `--ascii` prints a character map instead, one character per 64px cell
  (bigger cells past 200 columns or rows), aligned to multiples of the cell
  so the ruler and row labels read as world coordinates. Each type's
  character comes from the type (`EntityTypeDef.ascii`, else its base
  primitive's): `#` solid, `=` one-way solids and the platformer's clouds,
  `~` along paths, `G` goal, `S` spawn, `x` hazard, `o` anchor; the legend
  under the map lists what each character stands for. `--region`,
  `--around`, `--margin` and `--overlay` (`*` trail, `!` outcome) work the
  same; `--out file.txt` writes it to a file.

```sh
vp run scene render engine-yard --ascii
vp run scene render test-yard --ascii --around elevator --margin 64
vp run scene render test-yard --labels all --region 1100,500,1800,1200
vp run scene render test-yard --out /tmp/test-yard.png
vp run scene render engine-yard --around lift --scale 2 --overlay report.json --out lift.png
```

## Live edits

While `vp dev` runs, every scene is also a shared document on the dev
server's collab server (`ws://localhost:3000/__scene-collab`, document
`scene:<name>`), which the editor tabs have open. `apply --live` sends a
batch to that document as one more client instead of writing the file:

```sh
vp run scene apply engine-yard --live --ops scripts/scene/examples/slow-lift.json --agent claude --on-behalf-of ada
```

It connects, waits for the first sync, applies the batch in one transaction
with an `agent` origin (`--agent`, default `scene-cli`, and `--on-behalf-of`
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

## MCP

`mcp.ts` is a local stdio MCP server, `jams-scenes`, over the same tool
functions as the CLI (it never spawns it), versioned with the engine
(`ENGINE_VERSION`). To use it from an agent, add this to the repo's
`.mcp.json`:

```json
{ "mcpServers": { "jams-scenes": { "command": "bun", "args": ["scripts/scene/mcp.ts"] } } }
```

| Tool              | CLI command        | Notes                                                                |
| ----------------- | ------------------ | -------------------------------------------------------------------- |
| `scene_list`      | `list`             |                                                                      |
| `scene_show`      | `show`             | `near` is `[x, y, r]`                                                |
| `scene_schema`    | `schema`           | `which`: `scene`, `ops`, `script`, `checks`, `recording`             |
| `scene_codes`     | `codes`            |                                                                      |
| `scene_validate`  | `validate`         | `physical`                                                           |
| `scene_diff`      | `diff`             | one of `other`, `git` or an inline `ops` batch                       |
| `scene_apply_ops` | `apply` / `--live` | the only tool that writes; `dryRun` defaults to `true`               |
| `scene_playtest`  | `playtest`         | `script` inline or a path; `at` is `[x, y]`                          |
| `scene_replay`    | `replay`           | `run` inline or a path: a recording or a playtest result             |
| `scene_fuzz`      | `fuzz`             | `seed`, `rollouts`, `ticks` as numbers                               |
| `scene_check`     | `check`            |                                                                      |
| `scene_render`    | `render`           | a PNG `image` block; `ascii` for the map; `overlay` inline or a path |

Each result is the command's `--json` output as compact JSON in a text block
and as `structuredContent`, with `exitCode` added. A scene with error issues
is a normal result with `exitCode: 1`; `isError` is set only for calls that
did nothing (a usage error, a stale base, a missing scene or server).
Every tool but `scene_apply_ops` is annotated read-only. `scene_apply_ops`
writes the scene file only with `dryRun: false`.

**Live mode.** With `live: true` (and `url`, default the dev server's), the
read tools read the doc open on `vp dev`'s collab server, unsaved edits
included, and `scene_apply_ops` sends its batch as `apply --live` does: one
undoable history entry under an agent actor (`agentId`, default `mcp`, and
`onBehalfOf`). Only localhost servers are reachable; hosted docs are out of
scope.

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

- **y is down.** Coordinates are integer world pixels; rotations are
  integer degrees (`rotDeg` in shapes, `rot` on constructs).
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
- **Prefabs live in `prefabs/<id>.json`** beside the scene, and every
  command reads them. An instance places one at `at`; its children show
  up as `gate-1/door` in `show`, renders and playtests. Edit one
  instance's children with `override` (keys `<child>.<field.path>`,
  values in the prefab's own frame) and `revertOverride`; change the
  prefab for every instance with `applyToPrefab` or `definePrefab`; turn
  an instance back into plain entities with `unpack`, or entries into a
  prefab with `createPrefab`. `apply` writes changed prefab files too.
  `schema prefab` is the prefab file's schema.
- **`attach` rides a follower.** A solid or sensor with `attach:
"<follower id>"` moves with that follower; place its shape where it
  should be while the follower is at its first path point.
- **`$schema` comes first** and points at the home's committed schema, so
  editors validate and autocomplete scene files. Scene directories are left
  out of `vp fmt`; `fmt --check` is their formatter gate.

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
  table; `games.ts`: the game table and each home's scenes directory and
  schema file; `context.ts`: `ToolContext`, the registry a scene is judged
  by, and file access through `resolveScenePath`; `rapier-compat.ts`:
  injects `@dimforge/rapier2d-compat`, because the standard Rapier build
  can't construct a world under Bun.
- `tools/*.ts`: one pure `(input, ctx) => Promise<ToolResult>` per command;
  `apply --live` is `tools/apply-live.ts`, over the Hocuspocus client in
  `live.ts`. `dev-sink.ts` builds the dev server's collab server over every
  home, which the root `vite.config.ts` registers. `default-context.ts`
  builds the `ToolContext` the CLI and the MCP server share.
- `mcp-tools.ts`: the MCP tool table (names, annotations, zod inputs, and
  each tool over its command); `mcp.ts`: the server, the only file that
  imports the MCP SDK.
- `raster.ts`: SVG to PNG for `render`, with resvg-wasm and the site's Rubik
  files from `src/lib/og/assets/`; the engine stays font-free.
- `examples/`: the op batches, input list and input script this README uses.
- `__tests__/`: the tools against temp scenes directories, with the
  platformer and a small inline game; the real scene homes; and every
  example in this README and in the `scene-editing` skill.

Adding or renaming a command, flag, op, issue code or schema id is an agent
surface change: bump `AGENT_SURFACE_VERSION`, update
`src/engine/CHANGELOG.md`, regenerate `src/engine/__tests__/public-api.json`,
and re-pin the hash in `src/engine/scene/__tests__/agent-surface.test.ts`.
