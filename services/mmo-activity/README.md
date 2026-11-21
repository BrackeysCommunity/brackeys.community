# mmo-activity

The Discord MMO's Activity (GDD 17.7): the embedded web app that shows the
context a character is in and every machine (GDD 7.11). It is a client of
the world service's Activity listener and nothing more.

**It holds no rule that decides an outcome, no seed and no key.** It draws
the state the gateway sends and sends intents back. Each family's integer
model is mirrored here so a machine moves smoothly under a finger; the
server replays the move log, and its reply is the only result shown.

## Run it

```sh
vp install
vp dev --port 18787
```

- **No world at all:** `http://localhost:18787/?mock=bench`. The mock
  gateway answers from `test/fixtures/state-<name>.json` and the golden
  layouts. Fixtures: `armed`, `beat`, `bench`, `idle`, `intro`, `master`,
  `pouch`. Any family on a beat:
  `?mock=beat&family=crank&level=6&practice=8`.
- **A local world** with `MMO_ACTIVITY_DEV=1`: build (`vp build`), point
  `MMO_ACTIVITY_DIR` at `dist`, and open
  `http://localhost:<MMO_ACTIVITY_PORT>/?as=<discord id>`.
- **Inside Discord** the page is opened with `frame_id` in its address,
  signs in with the Embedded App SDK's `authorize`, and puts `/.proxy` in
  front of every route.

## Check it

```sh
vp check                        # format, lint, types
vp exec tsc --noEmit            # what `typecheck` runs
vp test run                     # golden vectors, gestures, shell, session
MMO_ALL_FAMILIES=1 vp test run  # fails until all fourteen scenes exist
vp build                        # the static build, into dist/
```

The build reads the wasteland pack (`palette.json`, `names.json`) and the
golden vectors from `../mmo-world`, so the colours and names are the
pack's and never typed here.

## Prove it on a local world

No Discord is needed. From the repo root, with the build in `dist/`:

```sh
MMO_ACTIVITY_PORT=8787 MMO_ACTIVITY_DIR="$PWD/services/mmo-activity/dist" MMO_ACTIVITY_DEV=1 \
  services/mmo-bot/scripts/local-world.sh

export MMO_URL=http://localhost:8080 MMO_ACTIVITY_URL=http://localhost:8787 MMO_OPERATOR_TOKEN=local-operator
(cd services/mmo-world && go run ./cmd/harness activity -out /tmp/activity)
(cd services/mmo-activity && bun scripts/touch-proof.ts /tmp/activity/touch)

services/mmo-bot/scripts/local-world.sh wipe
```

- `harness activity` signs in by the dev sign-in, opens a socket a
  character and, for each of the fourteen families, studies a machine,
  arms it, sends the kit's own solve and sends it again (the same fact,
  no second effect). It also leaves an armed machine to run out and works
  a bench past its day's cap. It writes `activity.md`.
- `scripts/touch-proof.ts` opens the build in a headless Chrome the size
  of a phone and solves two Rewires by touch events alone; the world, read
  over a second socket, says they were solved. Screenshots land in the
  folder it is given.
- Both stand a character before a machine with the operator's
  `set-machine` (`go run ./cmd/op set-machine <character> <family> <level> <note>`),
  which is also how to try any family on a countdown by hand.

## What is where

| Path               | What                                                         |
| ------------------ | ------------------------------------------------------------ |
| `src/main.ts`      | Boot: the theme, the launch, the session, the page           |
| `src/discord.ts`   | Inside or outside Discord, the routes, sign-in               |
| `src/session.ts`   | The socket: hello, reconnects, the whole state, intents      |
| `src/app.ts`       | Which screen is open, and the machine in hand                |
| `src/views/`       | The beat, the why view, pouches, the bench, idle             |
| `src/units.ts`     | Every number with its unit (GDD 2); nothing else formats one |
| `src/words.ts`     | Pack names and the lines made from facts and refusals        |
| `src/shell/`       | The puzzle shell every family shares                         |
| `src/scenes/<id>/` | One family: its model and its scene                          |
| `src/mock.ts`      | The stand-in gateway behind `?mock=`                         |
| `test/golden.ts`   | `goldenSuite`, which holds a model to the Go replay          |
| `test/stage.ts`    | A scene on a surface of a known size, for gesture tests      |
| `scripts/`         | The touch proof against a live local world                   |

## Adding a family

A family is one folder, `src/scenes/<id>/`, named with the family's id in
`puzzles.families`. The registry finds it; nothing outside the folder is
edited. It holds these files:

| File              | Holds                                                          |
| ----------------- | -------------------------------------------------------------- |
| `index.ts`        | The default export, a `Family`: `{ id, start, mount }`         |
| `model.ts`        | The integer model: `sim/puzzle/<family>.go`'s `Play`, mirrored |
| `scene.ts`        | `mount(host)`: the drawing and the gesture                     |
| `scene.css`       | The scene's own styles, imported by `scene.ts` (if it has any) |
| `golden.test.ts`  | Two lines: `goldenSuite(family)`                               |
| `gesture.test.ts` | Pointer paths in, the expected moves out                       |

`src/scenes/rewire/` is the reference; copy its shape.

### `model.ts`

- Implements `Model` from `src/shell/kit.ts`: `run(at)`, `apply(move)`,
  `snapshot()`. The Go file is the specification. Where the two disagree
  the Go rule wins.
- `run(at)` steps the model to `at` ms and returns `[status, ms]`. A
  family played move by move returns `[GOING, at]`. A timed family runs
  steps `n + 1` to `trunc(at / layout.step)`; step `k` happens at
  `k × step` ms. `Clock` in `shell/clock.ts` is that loop: give it the
  layout's step and a tick.
- `apply(move)` plays one move after `run(move.at)`. A move the family does
  not know returns `BROKE`. `b` and `c` may be missing: read them as 0.
- `snapshot()` is the same numbers, in the same order, as Go's `Snapshot`.
- Integers only. `Math.trunc` for every division. No `Date`, no
  `Math.random`, no floats.
- Export what the scene needs to read (Rewire exports `at` and `seated`).

### `scene.ts`

- `mount(host: SceneHost): Scene` appends its own element to
  `host.surface` and returns `frame`, `hint` and `destroy`.
- **Read `host.model` every frame; never keep it and never step it.** The
  shell swaps it (a refused arm, a clock moved back onto the server's).
  Cast it to your model: `const model = () => host.model as RewireModel`.
- A gesture ends in `host.move(a, b, c)`. That is the only way anything
  changes: the shell arms on the first call, stamps the move, records it
  and applies it to the model. Picking a piece up is not a move, so
  studying never arms.
- `host.arm()` starts the clock with no move, for a gesture that is timed
  before its first move exists (a swipe timed from its first gate, a pipe
  that only leaks once it is live). It does nothing once armed.
- `host.now()` is the model's clock in ms (0 at rest). `frame(at)` is
  called every animation frame with the same clock: draw the model as it
  is, and touch the DOM only where something changed (`set` in
  `shell/board.ts`).
- Lay out in CSS px from `sizeOf(host.surface)`, read each frame, so a
  rotated phone re-lays the scene. Put the geometry in an exported pure
  function and test it.
- `shell/board.ts` has the rest: `pointers` (one captured pointer, a
  cancel drops the drag), `HIT` (22 px, the least hit radius) and `PICKUP`
  (a piece is picked up from 1.6 radii), `nearest`, `svg`, `glyph`,
  `pieceColour`, `letter`, and `dropped` (the miss-distance beacon; call it
  on every drop).
- Colour is never the only signal. Every piece carries a glyph, a letter
  or a label, for everyone.
- `host.guide` is the faint guide line's move, when practice gives one.
  `hint(move)` shows one hint move for a few seconds.
- `host.compact` says the layout was held to the phone's cap; the size
  itself is already in `host.layout`.
- No number reaches the screen except through `src/units.ts`.
- SVG for discrete pieces; Canvas 2D where a gesture paints or traces.
  Give the root element the class `board` (it fills the surface) and the
  family's id, and scope every rule in `scene.css` under that id (keyframes
  too: `rewire-march`). Colours
  come from the palette's variables (`--ash`, `--concrete`, `--rust`,
  `--hazard`, `--signal`, `--tar`, `--corruption`, `--panel`, `--line`,
  `--piece-0` to `--piece-8`), never a literal.
- A log longer than the server's `max-moves` (1,200) is a haywire, so a
  gesture that streams moves (a rub, a trace, a crank) sends one per cell
  or per notch, never one per pointer event.

### Tests

`golden.test.ts`:

```ts
import { goldenSuite } from "../../../test/golden.ts";
import family from "./index.ts";

goldenSuite(family);
```

`gesture.test.ts` starts with `// @vitest-environment happy-dom` and uses
`stage(family, layout, { width, height })` from `test/stage.ts`: it
mounts the scene on a surface of that size and gives `drag`, `tap`,
`down`, `move`, `up`, `cancel` and the `moves` the scene made. Check at
least: a pointer path gives the expected moves; a missed drop gives none;
a cancelled pointer drops the drag; every piece is at least `HIT` px in
radius at the phone's cap (360 by 420) and at full size.

Then `vp check`, `vp test run`, and try it by hand at a phone's size:
`?mock=bench` for the rig with no countdown,
`?mock=beat&family=<id>&level=3` for the countdown.
