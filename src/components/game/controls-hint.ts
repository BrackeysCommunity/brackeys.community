import type { ActionBindings } from "@jams/engine";
import type { ActionDef, Binding } from "@jams/engine/game";

/** One line of a hosted game's controls hint: an action and the keys and buttons that drive it. */
export type ControlsHintEntry = {
  action: string;
  label: string;
  /** The game's description of the action; empty for one only the input map or a remap names. */
  description: string;
  keys: readonly string[];
};

const NAMED_KEYS: Readonly<Record<string, string>> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

const POINTER_LABELS: Readonly<Record<string, string>> = {
  primary: "Click",
  secondary: "Right-click",
  middle: "Middle-click",
};

/** What a key's `KeyboardEvent.code` reads as on a keycap: `KeyA` is "A", `ShiftLeft` is "Shift". */
export function keyLabel(code: string): string {
  const named = NAMED_KEYS[code];
  if (named !== undefined) return named;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1]!;
  const numpad = /^Numpad(.+)$/.exec(code);
  if (numpad) return `Num ${numpad[1]}`;
  const side = /^(Shift|Control|Alt|Meta)(?:Left|Right)$/.exec(code);
  if (side) return side[1] === "Control" ? "Ctrl" : side[1]!;
  return code;
}

/** Four keys that read better as one name when an action binds all of them. */
const CLUSTERS: readonly { name: string; members: readonly string[] }[] = [
  { name: "Arrows", members: ["↑", "←", "↓", "→"] },
  { name: "WASD", members: ["W", "A", "S", "D"] },
];

function bindingLabel(binding: Binding): string | null {
  if (binding.device === "key") return keyLabel(binding.code);
  if (binding.device === "pointer") return POINTER_LABELS[binding.button] ?? null;
  return null;
}

function keysOf(bindings: readonly Binding[]): string[] {
  const labels: string[] = [];
  for (const binding of bindings) {
    const label = bindingLabel(binding);
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
