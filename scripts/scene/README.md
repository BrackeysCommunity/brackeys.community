# Scene CLI

Read, check, edit and step the game's scenes (`src/game/scenes/*.json`)
from a terminal or an agent. It is built only from the engine's public
entries (`@jams/engine/scene`, `/headless`, `/vite`), and every command is a
pure function in `tools/` that the MCP adapter will reuse.

```sh
vp run scene <command> [args] [--json]
```

`vp run` prints one banner line before the command's output. When you parse
`--json`, call the script directly so stdout is only the JSON:

```sh
bun scripts/scene/cli.ts validate test-yard --json
```

Text output is terse; `--json` is the full structured result. Exit codes:
`0` ok, `1` error-severity issues or a failure, `2` usage, `3` stale base.

## Commands

| Command                                                   | Writes              | What it returns                                                                                |
| --------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| `list`                                                    | no                  | every scene with its `sceneHash`, entity counts per behavior and bounds                        |
| `show <scene> [--ref id] [--behavior b] [--near x,y,r]`   | no                  | entities and bulk entries with their ref, raw shape, world AABB and top span, plus `sceneHash` |
| `schema [scene\|ops]`                                     | no                  | the JSON Schema (`urn:jams-engine:scene:v1` or `urn:jams-engine:ops:v1`)                       |
| `codes`                                                   | no                  | every issue code with its severity, summary, hint and whether it has a fix                     |
| `validate <scene\|file\|->`                               | no                  | `SceneIssue[]` with JSON Pointer paths and line numbers; exit 1 on errors                      |
| `fmt <scene> [--check]`                                   | yes, unless check   | rewrites the canonical form; `--check` exits 1 when the file isn't canonical                   |
| `apply <scene> --ops <file\|-> [--dry-run] [--base hash]` | yes, unless dry run | the `ApplyResult`: diff, inverse, created ids, ref remap, issues and the new `sceneHash`       |
| `step <scene> [--ticks N] [--hold a,b] [--inputs file]`   | no                  | a headless probe: events and landings by entity id, the final player state, runtime stats      |

Every JSON report names the scene hash `sceneHash`; `step` also carries
`configHash`, which changes with movement tuning and the engine version, so
a stale report can be told from a fresh one. `show` returns at most 200
rows and sets `truncated: true` past that; narrow it with a filter.

A scene argument is a name (`test-yard`), resolved inside
`src/game/scenes/` with the same guard as the dev server's write-back:
lowercase letters, digits and dashes only. `validate` also takes a file path
or `-` for stdin, read-only.

`apply` writes only when the batch applied and left no error-severity
issue. `step --inputs` takes a JSON array of `[tick, action, 0|1]` edges;
`--hold` presses actions at tick 0 and never releases them. Actions are
`move_left`, `move_right`, `jump`, `move_down`, `dash` and `grapple`, and
any other name is a usage error; the simulation runs at 60 ticks a second.

## The edit loop

1. **Read.** `vp run scene show test-yard --near 1300,700,200`. Note the
   `sceneHash` and the refs you want: entity ids, or `~bulk:index` refs such as
   `~solid:4`.
2. **Write the change as ops**, not as a hand edit. `vp run scene schema
ops` is the reference.

   ```json
   {
     "label": "Raise the lift",
     "ops": [{ "op": "update", "ref": "elevator", "set": { "path.pts.1": [1300, 640] } }]
   }
   ```

3. **Dry run** and read the diff:
   `vp run scene apply test-yard --ops ops.json --dry-run`.
4. **Validate** what you're about to write: the dry run's `issues` are
   the same `validate` reports.
5. **Step** across the change:
   `vp run scene step test-yard --ticks 240 --hold move_right --inputs jumps.json`.
   Check `landings[].on` names the surfaces you expect.
6. **Apply** for real: drop `--dry-run`.
7. **Check the file**: `vp run scene fmt test-yard --check` and
   `vp run scene validate test-yard`.

If you edited JSON by hand anyway, run `fmt` and then `validate`.

## Conventions

- **y is down.** Coordinates are integer world pixels; rotations are
  integer degrees (`rotDeg` in shapes, `rot` on constructs).
- **Box and capsule sizes are half-extents.** `["box", cx, cy, hw, hh]`
  is centred on `cx, cy`. Read the `aabb` and `top` that `show` derives
  instead of computing edges yourself. Ops also accept
  `{ "type": "rect", "left", "top", "right", "bottom" }`.
- **Spawn is the player's feet**, not the centre of its body.
- **A mover's shape is local** to its current path point, usually centred
  on `0, 0`; the path points are world positions.
- **Bulk refs (`~solid:3`) shift** when an earlier entry is removed. A
  batch that uses one needs `base` set to the hash you read (or
  `--base`), and fails with exit 3 (`stale-base`) when the scene has moved
  on. To keep referring to a bulk entry, promote it:
  `{ "op": "promote", "ref": "~solid:3", "id": "ledge-a" }`.
- **No runtime state in scenes**: no platform progress, cloud visibility
  or player state. Scenes are the authored starting point.
- **Leave remarks as `note` entities**
  (`{ "b": "note", "at": [x, y], "text": "..." }`); they never load.

## Movement numbers come from tooling

Jump height, gap distances, dash length and grapple range are not written
down here on purpose: they change whenever the movement tuning changes. Get
them by stepping the runtime (`step` with an input list), and later from the
generated movement envelope. Never from memory or from reading constants.

## Issue codes

`vp run scene codes` lists every code. The ones you'll meet first:

- `bad-shape`: a tuple with the wrong tag or arity. The message gives the
  expected signature, e.g. `["box", cx, cy, hw, hh, rotDeg?]`.
- `unknown-key`: a key the schema doesn't define; the message suggests the
  closest known key.
- `dup-id`: two entities share an id. Rename one.
- `stale-base`: a bulk ref against an old hash. Re-read with `show` and
  rebuild the batch.
- `out-of-bounds` / `spawn-missing`: geometry outside `bounds`, or a scene
  with no spawn.

## Code layout

- `cli.ts`: process entry; `commands.ts`: argument parsing and the command
  table; `context.ts`: `ToolContext`, file access through
  `resolveScenePath`; `rapier-compat.ts`: injects `@dimforge/rapier2d-compat`,
  because the standard Rapier build can't construct a world under Bun.
- `tools/*.ts`: one pure `(input, ctx) => Promise<ToolResult>` per command.
- `__tests__/`: the tools against a temp scenes directory.

Adding or renaming a command, flag or exit code is an Agent surface change:
update `src/game/CHANGELOG.md` and regenerate `src/game/__tests__/public-api.json`.
