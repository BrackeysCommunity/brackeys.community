import { useState } from "react";

import { cx } from "./cx";

const MAC_GLYPHS: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
const OTHER_GLYPHS: Record<string, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "⇧" };
const KEY_GLYPHS: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  enter: "↵",
  escape: "Esc",
  backspace: "⌫",
  delete: "⌦",
  tab: "Tab",
  space: "␣",
  " ": "␣",
};

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform;
  return /Mac|iPhone|iPad|iPod/i.test(platform || navigator.platform || navigator.userAgent || "");
}

/** A keymap chord (`Shift+Mod+Enter`, `Mod++`) split into its keys. */
export function chordKeys(chord: string): string[] {
  return chord.endsWith("++") ? [...chord.slice(0, -2).split("+"), "+"] : chord.split("+");
}

/** How a key of a chord is drawn on this platform. */
export function keyLabel(key: string, mac: boolean): string {
  const modifier = (mac ? MAC_GLYPHS : OTHER_GLYPHS)[key];
  if (modifier) return modifier;
  const glyph = KEY_GLYPHS[key.toLowerCase()];
  if (glyph) return glyph;
  return key.length === 1 ? key.toUpperCase() : key;
}

/** A chord as key caps. */
export function Hotkey({ chord, className }: { chord: string; className?: string }) {
  const [mac] = useState(isMac);
  return (
    <kbd className={cx("je-hotkey", className)}>
      {chordKeys(chord).map((key, i) => (
        <kbd key={`${key}-${i}`} className="je-kbd">
          {keyLabel(key, mac)}
        </kbd>
      ))}
    </kbd>
  );
}

/** A hint line: what the control does and, when it has one, its chord. */
export function KeyHint({ text, chord }: { text: string; chord?: string }) {
  return (
    <span className="je-key-hint">
      {text}
      {chord ? <Hotkey chord={chord} /> : null}
    </span>
  );
}
