/**
 * The input devices' vocabularies: key codes, gamepad buttons and axes,
 * pointer buttons, and the US-layout table that reads 0.x `keys` bindings.
 * Data only and no imports, so the canvas-sync image can judge input maps.
 */

const range = (prefix: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** W3C UI Events `KeyboardEvent.code` values: "KeyA"…"KeyZ", "Digit0"…"Digit9", "Space", "Enter", "ShiftLeft", "ArrowUp", "Numpad0", "F1"… */
export const KEY_CODES: readonly string[] = Object.freeze([
  ...LETTERS.map((l) => `Key${l}`),
  ...range("Digit", 0, 9),
  "Backquote",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash",
  "IntlBackslash",
  "IntlRo",
  "IntlYen",
  "Space",
  "Enter",
  "Tab",
  "Backspace",
  "Escape",
  "CapsLock",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "ContextMenu",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Insert",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "PrintScreen",
  "ScrollLock",
  "Pause",
  "NumLock",
  ...range("Numpad", 0, 9),
  "NumpadAdd",
  "NumpadSubtract",
  "NumpadMultiply",
  "NumpadDivide",
  "NumpadDecimal",
  "NumpadEnter",
  "NumpadEqual",
  "NumpadComma",
  ...range("F", 1, 24),
]);

/** The W3C standard gamepad mapping's buttons, in index order. */
export const PAD_BUTTONS = [
  "south",
  "east",
  "west",
  "north",
  "lb",
  "rb",
  "lt",
  "rt",
  "select",
  "start",
  "ls",
  "rs",
  "dpad-up",
  "dpad-down",
  "dpad-left",
  "dpad-right",
  "home",
] as const;

/** The standard mapping's stick axes, in index order. */
export const PAD_AXES = ["left-x", "left-y", "right-x", "right-y"] as const;

export const POINTER_BUTTONS = ["primary", "secondary", "middle"] as const;

/** A standard-mapping button by name, or a raw index for a pad without the standard mapping. */
export type PadButton = (typeof PAD_BUTTONS)[number] | number;
export type PadAxis = (typeof PAD_AXES)[number] | number;
export type PointerButton = (typeof POINTER_BUTTONS)[number];

/** A pointer button's bit in a DOM `buttons` mask, and in a tick's recorded pointer buttons. */
export const pointerBit = (button: PointerButton): number => 1 << POINTER_BUTTONS.indexOf(button);

/** The digit row's shifted characters on a US layout, "!" for Digit1 through ")" for Digit0. */
const SHIFTED_DIGITS = ")!@#$%^&*(";

function keyTable(): Record<string, readonly string[]> {
  const table: Record<string, string[]> = {};
  const add = (key: string, ...codes: string[]) => {
    (table[key] ??= []).push(...codes);
  };
  for (const l of LETTERS) add(l.toLowerCase(), `Key${l}`);
  for (let d = 0; d <= 9; d++) {
    add(String(d), `Digit${d}`, `Numpad${d}`);
    add(SHIFTED_DIGITS[d]!, `Digit${d}`);
  }
  const punctuation: [plain: string, shifted: string, code: string][] = [
    ["`", "~", "Backquote"],
    ["-", "_", "Minus"],
    ["=", "+", "Equal"],
    ["[", "{", "BracketLeft"],
    ["]", "}", "BracketRight"],
    ["\\", "|", "Backslash"],
    [";", ":", "Semicolon"],
    ["'", '"', "Quote"],
    [",", "<", "Comma"],
    [".", ">", "Period"],
    ["/", "?", "Slash"],
  ];
  for (const [plain, shifted, code] of punctuation) {
    add(plain, code);
    add(shifted, code);
  }
  add("+", "NumpadAdd");
  add("-", "NumpadSubtract");
  add("*", "NumpadMultiply");
  add("/", "NumpadDivide");
  add(".", "NumpadDecimal");
  add("=", "NumpadEqual");
  add(" ", "Space");
  add("Enter", "Enter", "NumpadEnter");
  for (const mod of ["Shift", "Control", "Alt", "Meta"]) add(mod, `${mod}Left`, `${mod}Right`);
  for (const named of [
    "Tab",
    "Backspace",
    "Escape",
    "CapsLock",
    "ContextMenu",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Insert",
    "Delete",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "PrintScreen",
    "ScrollLock",
    "Pause",
    "NumLock",
  ])
    add(named, named);
  for (const f of range("F", 1, 24)) add(f, f);
  const frozen: Record<string, readonly string[]> = {};
  for (const [key, codes] of Object.entries(table)) frozen[key] = Object.freeze(codes);
  return frozen;
}

/**
 * US-layout `KeyboardEvent.key` (single characters lowercase, as 0.x
 * bindings matched them) → every `code` that produced it, for 0.x `keys`
 * bindings: "Shift" is both Shifts, "1" the digit row and the numpad.
 */
export const KEY_TO_CODE: Readonly<Record<string, readonly string[]>> = Object.freeze(keyTable());
