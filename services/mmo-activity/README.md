# mmo-activity

The Discord MMO's Activity (GDD 17.7): the embedded web app that shows the
context a character is in and every machine (GDD 7.11). It is a client of
the world service's Activity listener and nothing more.

**It holds no rule that decides an outcome, no seed and no key.** It draws
the state the gateway sends and sends intents back. Each family's integer
model is mirrored here so a machine moves smoothly under a finger; the
server replays the move log, and its reply is the only result shown. A
party machine's moves stream to the gateway one by one; the gateway keeps
the merged log, relays it to the other seats and writes its solve. The
Activity never sends one, and a seat of a split kind cannot tell on its
own that the machine is solved.

## Run it

```sh
vp install
vp dev --port 18787
```

- **No world at all:** `http://localhost:18787/?mock=bench`. The mock
  gateway answers from `test/fixtures/state-<name>.json` and the golden
  layouts. Fixtures: `armed`, `beat`, `bench`, `idle`, `intro`, `master`,
  `pattern`, `pouch`, `theft`, `variant` (a region's variant by its own
  name), and the party's `party`, `party-machine`, `floor` and `hunt`. Any
  family on a beat: `?mock=beat&family=crank&level=6&practice=8`.
- **A server's staging:** `?mock=staged-hunt` is a hunt staff staged, its
  "Staged by" line under the title and its spoils tagged as local to the
  settlement that staged them; `?mock=vault` is a party of two at a
  competing vault, a fork machine labelled with who staged it. Who wins a
  vault, and what its haul is, is the world's alone: the Activity has no
  role and no console.
- **A theft:** `?mock=theft` is a burgle's lock beat on a Pin lock, its
  witness odds over the machine and before the beat's options, with their
  parts behind the beat's Why. The theft is shown as served: the mock
  writes no theft fact and never changes the odds, whatever is pressed;
  whether a theft is seen or caught is the world's alone.
- **A pattern's point:** `?mock=pattern` stands on pylon B of a triangle
  with its Circuit armed from chat, the pattern strip shut over it. A solve
  commits the value chat armed it with (0 in the mock, since no state says
  it); what the board makes of it is the world's alone.
- **The live map:** `?mock=map` opens on the Map screen over the idle
  state; every other mock has the same map a tab away. Its payloads are
  `test/fixtures/map/*.json` (`index`, `style`, `regions`, `chunks` at both
  levels, `overlay`), a 469-tile world read through the world's own
  `mapview`, as the listener serves it: a character who walked out and
  back, so the overlay holds tiles in sight and tiles last seen one and two
  world days ago, a storm front and a busy tile. `?mock=map&viewer=anonymous`
  serves `overlay-anonymous.json`, the overlay of a viewer with no
  character: no tile, no front, no self, so no live layer is drawn.
- **A party with no world:** `?mock=party&seats=4` seats a party of four;
  this screen is the first seat, and the other three are scripted
  teammates who pick, vote, press and play their seats of the rule's own
  solve on the mock's timers. `party-machine` puts a party machine on the
  beat (the party vectors are its layouts, through `virtual:party-rigs`),
  `floor` a fork with its vote, `hunt` a live hunt. Two tabs on one mock
  are not one party: each page runs its own mock.
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
MMO_ALL_FAMILIES=1 vp test run  # also: every family and party version with vectors has a scene
vp build                        # the static build, into dist/
```

The build reads the wasteland pack (`palette.json`, `names.json`) and the
golden vectors from `../mmo-world`, so the colours and names are the
pack's and never typed here. The party vectors (`testdata/party`) and the
shape vectors (`testdata/shapes`) are read from there too.

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

- `harness activity` signs in by the dev sign-in, opens a socket as a
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

| Path                   | What                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main.ts`          | Boot: the theme, the launch, the session, the page                                                                                   |
| `src/discord.ts`       | Inside or outside Discord, the routes (the map's too), sign-in                                                                       |
| `src/session.ts`       | The socket: hello, reconnects, the whole state, intents, a party machine's streamed moves                                            |
| `src/app.ts`           | Which screen is open, and the machine in hand                                                                                        |
| `src/views/`           | The beat (a party's too) with its creature panel, the floor's rooms, the hunt, the party, why, pouches, the bench, idle, the pattern |
| `src/views/map.ts`     | The Map screen: the canvas, the layer toggles, the counts in view and the picked tile's panel                                        |
| `src/map/source.ts`    | Where the map's payloads come from: the listener's map routes (the overlay signed with the session), or the `?mock=` fixtures        |
| `src/map/canvas.ts`    | The live map on a canvas: pan, wheel and pinch zoom, polling, painted with `packages/mmo-map`                                        |
| `src/units.ts`         | Every number with its unit (GDD 2); nothing else formats one                                                                         |
| `src/words.ts`         | Pack names, the lines made from facts and refusals, the beat's encounter line, and every picture's words                             |
| `src/shell/`           | The puzzle shell every family shares                                                                                                 |
| `src/scenes/<id>/`     | One family: its model and its scene                                                                                                  |
| `src/party/<id>/`      | One party version: its merged model and each seat's gesture                                                                          |
| `src/mock.ts`          | The stand-in gateway behind `?mock=`, a party's seats too, and the map's fixtures                                                    |
| `test/golden.ts`       | `goldenSuite`, which holds a model to the Go replay                                                                                  |
| `test/party-golden.ts` | `partySuite`, which holds a version's model to the Go party replay                                                                   |
| `test/stage.ts`        | A scene on a surface of a known size, for gesture tests; a party seat too                                                            |
| `test/alt.test.ts`     | Every picture on every mock and family named or hidden; the beat line is chat's                                                      |
| `scripts/`             | The touch proof against a live local world                                                                                           |

## Pictures and their words

Every live `svg`, `canvas` or `img` has `role="img"` and an `aria-label`
made in `src/words.ts` from the same fields it is drawn from, or
`aria-hidden="true"` when it only decorates (GDD 16.1). A scene's board is
named by the panel: the machine, its level and where it is in its play,
then the label the scene gave `board()`. The floor map names each room as
its hex reads, and the beat's creature panel names the creature and the
beat. `test/alt.test.ts` holds every fixture, every family and every party
version to it.

The beat view's opening line is `encounterLine` from
`packages/mmo-words/src/encounters.ts` over the committed wasteland pool,
with the creature and place chat's beat card uses, so both show the same
line. It is display only: a hash of the fight, never a draw.

The Map screen's canvas is named with `mapAlt` from
`packages/mmo-words/src/alt.ts`, the words `/map`'s picture uses, from the
layers it draws; its tile panel's fog states, ages and busy bands are
`FOG_WORDS`, `seenAgo` and `busyWords` from `packages/mmo-words/src/map.ts`.
The map holds no fog rule (GDD 4.11): the world filters the overlay to what
this character and their guild may see before it is sent, and the screen
draws what arrives with `packages/mmo-map`. Layer toggles are kept in
`localStorage`, for this browser only.

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
- A family played move by move extends `Untimed`; `within` and `until` in
  `shell/kit.ts` and `shell/grid.ts` hold the shared range checks and grid
  steps.
- `apply(move)` plays one move after `run(move.at)`. A move the family does
  not know returns `BROKE`. `b` and `c` may be missing: read them as 0.
- `snapshot()` is the same numbers, in the same order, as Go's `Snapshot`.
- Integers only. `Math.trunc` for every division. No `Date`, no
  `Math.random`, no floats.
- Export what the scene needs to read (Rewire exports `at` and `seated`).

### `scene.ts`

- `mount(host: SceneHost): Scene` makes its drawing with
  `board(host, label)` and returns `frame` and `destroy`. The label says
  what the scene shows; the panel puts the machine and its state in front.
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
- Lay out in CSS px. Call the board's `fit()` each frame: when the play
  area has changed size it empties the drawing and returns the new size
  to build on, so a rotated phone re-lays the scene. Put the geometry in
  an exported pure function and test it.
- `shell/board.ts` has the rest: `pointers` (one captured pointer, a
  cancel drops the drag), `HIT` (22 px, the least hit radius) and `PICKUP`
  (a piece is picked up from 1.6 radii), `nearest`, `reach`,
  `angleOf`/`sweep`/`turning` for a finger turning about a hub, `svg`,
  `text`, `say`, `glyph`, `pieceColour` and `letter`.
- `host.dropped(missPx, hitPx, landed, ev)` records how far a touch landed
  from its mark; call it on every drop. The shell sends them as one
  summary beacon a play, never one a touch.
- Colour is never the only signal. Every piece carries a glyph, a letter
  or a label, for everyone.
- `host.guide` is the faint guide line's move, when practice gives one.
  `host.hinted()` is the hint lit now, if one is: the shell lights it and
  puts it out (after `hintMs` on the family, or 3 s), so read it each
  frame. A mark that must outlast it is the scene's own to keep.
- `host.compact` says the layout was held to the phone's cap; the size
  itself is already in `host.layout`.
- No number reaches the screen except through `src/units.ts`.
- SVG for discrete pieces; Canvas 2D where a gesture paints or traces.
  Give the root element the class `board` (it fills the surface) and the
  family's id, and scope every rule in `scene.css` under that id (keyframes
  too: `rewire-slip`; a lit hint's `board-march` and `board-pulse` are
  shared, in `src/styles.css`). Colours
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

## Adding a party version

A party version is one folder, `src/party/<id>/`, named with its
`puzzles.party` row. `src/shell/party-registry.ts` finds it. It holds
`index.ts` (a `PartyVersion`: `{ id, family, start, mount }`), `model.ts`
(the merged model: `sim/puzzle`'s party rule for it, mirrored), `scene.ts`
and `golden.test.ts` (`partySuite(version)`).

- Every move of the merged log names its seat; a missing `seat` is seat 0,
  since the wire drops a zero. A malformed move is broke before the holder
  is checked, and a move by a seat that does not hold the piece is ignored.
- `start(layout)` is given this seat's dealt part on screen, with `Unseen`
  where it is not shown, and the whole layout in the vectors: it must not
  throw on either.
- `mount(host: PartySceneHost)` is a family scene's `mount` with `seat`,
  `seats` and `glimpse` (the next seat's part, when practice gives it).
  `host.model` also holds the other seats' moves as they are relayed:
  draw them as the seat's own. `host.move` streams the move; nothing a
  scene does ends the play.
- `stage(version, layout, { seat, model })` in `test/stage.ts` is one
  seat's scene; give the second stage the first one's `model` to press one
  machine from two seats.
