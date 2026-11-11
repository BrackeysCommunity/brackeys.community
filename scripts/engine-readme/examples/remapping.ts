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
