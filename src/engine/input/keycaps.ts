import type { Binding } from "../game/types";

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

const POINTER_BUTTONS: Readonly<Record<string, string>> = {
  primary: "Click",
  secondary: "Right-click",
  middle: "Middle-click",
};

/**
 * What a `KeyboardEvent.code` reads as on a keycap: `KeyA` is "A",
 * `Digit3` is "3", `Numpad4` is "Num 4", `ShiftLeft` is "Shift",
 * `ArrowLeft` is "←"; a code with no shorter name reads as itself.
 */
export function keycapLabel(code: string): string {
  const named = NAMED_KEYS[code];
  if (named !== undefined) return named;
  const short = /^(?:Key|Digit)(.)$/.exec(code);
  if (short) return short[1]!;
  const numpad = /^Numpad(.+)$/.exec(code);
  if (numpad) return `Num ${numpad[1]}`;
  const side = /^(Shift|Control|Alt|Meta)(?:Left|Right)$/.exec(code);
  if (side) return side[1] === "Control" ? "Ctrl" : side[1]!;
  return code;
}

/** What a pointer button reads as: `primary` is "Click"; null for one with no name. */
export function pointerButtonLabel(button: string): string | null {
  return POINTER_BUTTONS[button] ?? null;
}

/** A key or pointer binding as its keycap; null for a pad or touch binding. */
export function bindingKeyLabel(binding: Binding): string | null {
  if (binding.device === "key") return keycapLabel(binding.code);
  if (binding.device === "pointer") return pointerButtonLabel(binding.button);
  return null;
}
