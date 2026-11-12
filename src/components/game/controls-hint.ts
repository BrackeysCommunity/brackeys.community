import type { ActionBindings } from "@jams/engine";
import { bindingKeyLabel, type ActionDef, type Binding } from "@jams/engine/game";

/** One line of a hosted game's controls hint: an action and the keys and buttons that drive it. */
export type ControlsHintEntry = {
  action: string;
  label: string;
  /** The game's description of the action; empty for one only the input map or a remap names. */
  description: string;
  keys: readonly string[];
};

/** Four keys that read better as one name when an action binds all of them. */
const CLUSTERS: readonly { name: string; members: readonly string[] }[] = [
  { name: "Arrows", members: ["↑", "←", "↓", "→"] },
  { name: "WASD", members: ["W", "A", "S", "D"] },
];

function keysOf(bindings: readonly Binding[]): string[] {
  const labels: string[] = [];
  for (const binding of bindings) {
    const label = bindingKeyLabel(binding);
    if (label !== null && !labels.includes(label)) labels.push(label);
  }
  let keys = labels;
  for (const { name, members } of CLUSTERS) {
    if (!members.every((m) => keys.includes(m))) continue;
    const at = keys.findIndex((k) => members.includes(k));
    keys = keys.filter((k) => !members.includes(k));
    keys.splice(at, 0, name);
  }
  return keys;
}

/** `move_left` reads "Move left". */
function actionLabel(action: string): string {
  const words = action.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The hint a host shows for a game with no UI of its own: each action the
 * simulation reads, in the game's order, with the keyboard and pointer
 * bindings that drive it for the first seat. A game that mounts its own UI
 * says its controls itself, so it gets null; so does one with nothing to show.
 */
export function controlsHint(opts: {
  actions: readonly ActionDef[];
  bindings: ActionBindings;
  ownUi: boolean;
}): readonly ControlsHintEntry[] | null {
  if (opts.ownUi) return null;
  const defs = new Map(opts.actions.map((def) => [def.action, def]));
  const names = [
    ...defs.keys(),
    ...Object.keys(opts.bindings).filter((action) => !defs.has(action)),
  ];
  const entries: ControlsHintEntry[] = [];
  for (const action of names) {
    const def = defs.get(action);
    if (def?.ui) continue;
    const keys = keysOf(opts.bindings[action] ?? []);
    if (keys.length === 0) continue;
    entries.push({ action, label: actionLabel(action), description: def?.description ?? "", keys });
  }
  return entries.length > 0 ? entries : null;
}
