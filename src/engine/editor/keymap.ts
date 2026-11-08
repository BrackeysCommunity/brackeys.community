import type { GameKeyBinding } from "../game/types";
import type { EditorMode } from "./store";

/**
 * Where a binding applies. `global` holds in edit and play; `sub-object`
 * (editing a shape's points) sits over `edit`; `text-field` is focus in a
 * field, where only Mod+S is caught and every other key is typing.
 */
export type KeyScope = "global" | "edit" | "play" | "sub-object" | "text-field";

type Direction = "up" | "down" | "left" | "right";

export type EditorCommand =
  | "save"
  | "debug"
  // edit
  | "undo"
  | "redo"
  | "delete"
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "select-all"
  | "group"
  | "ungroup"
  | "bring-forward"
  | "send-backward"
  | "frame"
  | "toggle-snap"
  | "hierarchy-up"
  | "hierarchy-down"
  | "tool:select"
  | "tool:pan"
  | "tool:box"
  | "tool:circle"
  | "tool:pen"
  | "tool:waypoints"
  | "tool:rotate"
  | "pan-hold"
  | "rotate-ccw"
  | "rotate-cw"
  | "turn-cw"
  | "turn-ccw"
  | "flip-x"
  | "flip-y"
  | `nudge-${Direction}`
  | `nudge-${Direction}-coarse`
  | `nudge-${Direction}-fine`
  | "play"
  | "play-here"
  | "cancel-gesture"
  | "leave-sub-object"
  | "clear-tool"
  | "leave-prefab"
  | "clear-selection"
  // sub-object
  | "delete-points"
  // play
  | "stop"
  | "pause"
  | "step"
  | "slower"
  | "faster";

export type EditorKeyEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/** What decides the active scopes and Escape's cascade. */
export type KeyContext = {
  mode: EditorMode;
  /** Focus is in a text field, select or contenteditable. */
  editableTarget: boolean;
  /** A shape's points are being edited. */
  subObject?: boolean;
  /** A drag or draw is in progress. */
  gesture?: boolean;
  /** The active tool; anything but `select` is cleared by Escape. */
  tool?: string;
  /** Everything selected is prefab instances or whole groups, which turn by quarter turns. */
  quarterTurns?: boolean;
  /** A prefab is open on its own, so Escape can leave it. */
  inPrefab?: boolean;
  /** Something is selected; Escape clears it before leaving a prefab. */
  hasSelection?: boolean;
};

export type EngineKeyBinding = {
  /** A chord, as `GameKeyBinding.key` describes. */
  key: string;
  scope: KeyScope;
  command: EditorCommand;
  description: string;
  /** Applies only when this holds; the next binding for the chord is tried otherwise. */
  when?: (ctx: KeyContext) => boolean;
};

export type KeyMatch =
  | { source: "engine"; command: EditorCommand; binding: EngineKeyBinding }
  | { source: "game"; command: string; binding: GameKeyBinding };

const arrows: Direction[] = ["up", "down", "left", "right"];
const arrowKey = (d: Direction) => `Arrow${d[0]!.toUpperCase()}${d.slice(1)}`;

/**
 * The editor's own bindings, in the order they're tried within a scope.
 * Mod is Ctrl or Cmd. Play is Mod+Enter, not Mod+P, which opens the print
 * dialog.
 */
export const ENGINE_KEYS: readonly EngineKeyBinding[] = [
  { key: "Mod+s", scope: "text-field", command: "save", description: "Save" },
  { key: "Mod+s", scope: "global", command: "save", description: "Save" },
  { key: "F3", scope: "global", command: "debug", description: "Cycle the debug overlay" },

  {
    key: "Escape",
    scope: "sub-object",
    command: "cancel-gesture",
    description: "Cancel the gesture",
    when: (c) => c.gesture === true,
  },
  {
    key: "Escape",
    scope: "sub-object",
    command: "leave-sub-object",
    description: "Leave point editing",
  },
  {
    key: "Delete",
    scope: "sub-object",
    command: "delete-points",
    description: "Delete the selected points",
  },
  {
    key: "Backspace",
    scope: "sub-object",
    command: "delete-points",
    description: "Delete the selected points",
  },

  { key: "v", scope: "edit", command: "tool:select", description: "Select tool" },
  { key: "h", scope: "edit", command: "tool:pan", description: "Pan tool" },
  { key: "Space", scope: "edit", command: "pan-hold", description: "Pan while held" },
  { key: "b", scope: "edit", command: "tool:box", description: "Box tool" },
  { key: "c", scope: "edit", command: "tool:circle", description: "Circle tool" },
  { key: "p", scope: "edit", command: "tool:pen", description: "Pen tool" },
  { key: "w", scope: "edit", command: "tool:waypoints", description: "Waypoints tool" },
  { key: "r", scope: "edit", command: "tool:rotate", description: "Rotate tool" },
  {
    key: "q",
    scope: "edit",
    command: "turn-ccw",
    description: "Turn a quarter counterclockwise",
    when: (c) => c.quarterTurns === true,
  },
  { key: "q", scope: "edit", command: "rotate-ccw", description: "Rotate −15°" },
  {
    key: "e",
    scope: "edit",
    command: "turn-cw",
    description: "Turn a quarter clockwise",
    when: (c) => c.quarterTurns === true,
  },
  { key: "e", scope: "edit", command: "rotate-cw", description: "Rotate +15°" },
  { key: "Shift+h", scope: "edit", command: "flip-x", description: "Flip horizontally" },
  { key: "Shift+v", scope: "edit", command: "flip-y", description: "Flip vertically" },
  ...arrows.flatMap((d): EngineKeyBinding[] => [
    {
      key: arrowKey(d),
      scope: "edit",
      command: `nudge-${d}`,
      description: `Nudge ${d} one grid step`,
    },
    {
      key: `Shift+${arrowKey(d)}`,
      scope: "edit",
      command: `nudge-${d}-coarse`,
      description: `Nudge ${d} four grid steps`,
    },
    {
      key: `Alt+${arrowKey(d)}`,
      scope: "edit",
      command: `nudge-${d}-fine`,
      description: `Nudge ${d} one pixel`,
    },
  ]),
  { key: "Delete", scope: "edit", command: "delete", description: "Delete the selection" },
  { key: "Backspace", scope: "edit", command: "delete", description: "Delete the selection" },
  { key: "Mod+z", scope: "edit", command: "undo", description: "Undo" },
  { key: "Shift+Mod+z", scope: "edit", command: "redo", description: "Redo" },
  { key: "Mod+y", scope: "edit", command: "redo", description: "Redo" },
  { key: "Mod+c", scope: "edit", command: "copy", description: "Copy" },
  { key: "Mod+x", scope: "edit", command: "cut", description: "Cut" },
  { key: "Mod+v", scope: "edit", command: "paste", description: "Paste" },
  { key: "Mod+d", scope: "edit", command: "duplicate", description: "Duplicate" },
  { key: "Mod+a", scope: "edit", command: "select-all", description: "Select all" },
  { key: "Mod+g", scope: "edit", command: "group", description: "Group" },
  { key: "Shift+Mod+g", scope: "edit", command: "ungroup", description: "Ungroup" },
  { key: "Mod+]", scope: "edit", command: "bring-forward", description: "Bring forward" },
  { key: "Mod+[", scope: "edit", command: "send-backward", description: "Send backward" },
  { key: "f", scope: "edit", command: "frame", description: "Frame the selection" },
  { key: "g", scope: "edit", command: "toggle-snap", description: "Toggle snapping" },
  { key: "[", scope: "edit", command: "hierarchy-up", description: "Select the parent" },
  { key: "]", scope: "edit", command: "hierarchy-down", description: "Select the first child" },
  { key: "Mod+Enter", scope: "edit", command: "play", description: "Play from spawn" },
  {
    key: "Shift+Mod+Enter",
    scope: "edit",
    command: "play-here",
    description: "Play from the cursor",
  },
  {
    key: "Escape",
    scope: "edit",
    command: "cancel-gesture",
    description: "Cancel the gesture",
    when: (c) => c.gesture === true,
  },
  {
    key: "Escape",
    scope: "edit",
    command: "clear-tool",
    description: "Back to the select tool",
    when: (c) => c.tool !== undefined && c.tool !== "select",
  },
  {
    key: "Escape",
    scope: "edit",
    command: "leave-prefab",
    description: "Back to the scene",
    when: (c) =>
      c.inPrefab === true &&
      c.hasSelection !== true &&
      (c.tool === undefined || c.tool === "select"),
  },
  { key: "Escape", scope: "edit", command: "clear-selection", description: "Clear the selection" },

  { key: "p", scope: "play", command: "pause", description: "Pause or resume" },
  { key: ".", scope: "play", command: "step", description: "Step one tick while paused" },
  { key: "[", scope: "play", command: "slower", description: "Slower" },
  { key: "]", scope: "play", command: "faster", description: "Faster" },
  {
    key: "Escape",
    scope: "play",
    command: "stop",
    description: "Stop (a game's own selection clears first)",
  },
];

const MODIFIERS = ["Shift", "Alt", "Mod"] as const;

function chordKey(key: string): string {
  if (key === " " || key.toLowerCase() === "space") return "Space";
  return key.length === 1 ? key.toLowerCase() : key;
}

/** The chord a key press makes: `Shift+`, `Alt+`, `Mod+` (Ctrl or Cmd), then the key. */
export function keyChord(e: EditorKeyEvent): string {
  return (
    (e.shiftKey ? "Shift+" : "") +
    (e.altKey ? "Alt+" : "") +
    (e.ctrlKey || e.metaKey ? "Mod+" : "") +
    chordKey(e.key)
  );
}

/** A chord written in any modifier order (or with `" "` for Space) in canonical form; throws on an unknown modifier. */
export function normalizeChord(chord: string): string {
  const plus = chord === "+" || chord.endsWith("++");
  const parts = (plus ? chord.slice(0, -1) : chord).split("+");
  const key = plus ? "+" : parts.pop()!;
  if (plus) parts.pop();
  if (key === "") throw new Error(`key chord "${chord}" names no key`);
  const mods = new Set<string>();
  for (const part of parts) {
    const mod = MODIFIERS.find((m) => m.toLowerCase() === part.toLowerCase());
    if (!mod) throw new Error(`unknown modifier "${part}" in key chord "${chord}"`);
    mods.add(mod);
  }
  const prefix = MODIFIERS.filter((m) => mods.has(m)).map((m) => `${m}+`);
  return prefix.join("") + chordKey(key);
}

export type Keymap = {
  /** The command for a key press, or null when nothing in the active scopes binds it. */
  resolve(e: EditorKeyEvent, ctx: KeyContext): KeyMatch | null;
  /** The engine's bindings, then the game's that apply, for hints and help. */
  bindings: readonly (EngineKeyBinding | GameKeyBinding)[];
  /** Game bindings that collide with an engine binding in their scope (or a global one); they never fire. */
  shadowed: readonly GameKeyBinding[];
  /** The first chord bound to an engine command, for hints. */
  chordOf(command: EditorCommand): string | undefined;
};

/** Scopes tried in order: the most specific first, `global` before the game's bindings. */
function activeScopes(ctx: KeyContext): KeyScope[] {
  if (ctx.editableTarget) return ["text-field"];
  if (ctx.mode === "play") return ["play", "global"];
  return ctx.subObject ? ["sub-object", "edit", "global"] : ["edit", "global"];
}

/**
 * The editor's scoped keymap with a game's `editorKeys` added. Engine
 * bindings always win: a game binding on a chord the engine binds in the
 * same scope, or globally, is reported in `shadowed` and never resolves.
 */
export function createKeymap(gameKeys: readonly GameKeyBinding[] = []): Keymap {
  const engine = ENGINE_KEYS.map((binding) => ({ binding, chord: normalizeChord(binding.key) }));
  const taken = new Set(
    engine.flatMap(({ binding, chord }) =>
      (binding.scope === "global" ? ["edit", "play"] : [binding.scope]).map((s) => `${s} ${chord}`),
    ),
  );
  const game: { binding: GameKeyBinding; chord: string }[] = [];
  const shadowed: GameKeyBinding[] = [];
  for (const binding of gameKeys) {
    const chord = normalizeChord(binding.key);
    if (taken.has(`${binding.scope} ${chord}`)) shadowed.push(binding);
    else game.push({ binding, chord });
  }

  function resolve(e: EditorKeyEvent, ctx: KeyContext): KeyMatch | null {
    const chord = keyChord(e);
    for (const scope of activeScopes(ctx)) {
      const hit = engine.find(
        ({ binding: b, chord: c }) => b.scope === scope && c === chord && (!b.when || b.when(ctx)),
      );
      if (hit) return { source: "engine", command: hit.binding.command, binding: hit.binding };
    }
    if (ctx.editableTarget) return null;
    const hit = game.find(({ binding: b, chord: c }) => b.scope === ctx.mode && c === chord);
    return hit ? { source: "game", command: hit.binding.command, binding: hit.binding } : null;
  }

  return {
    resolve,
    bindings: [...ENGINE_KEYS, ...game.map((g) => g.binding)],
    shadowed,
    chordOf: (command) =>
      ENGINE_KEYS.find((b) => b.command === command && b.scope !== "text-field")?.key,
  };
}
