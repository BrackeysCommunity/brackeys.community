import * as React from "react";

import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

const MAC_MODIFIER_GLYPHS: Record<string, string> = {
  command: "⌘",
  cmd: "⌘",
  ctrl: "⌃",
  control: "⌃",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
};

const OTHER_MODIFIER_LABELS: Record<string, string> = {
  command: "CTRL",
  cmd: "CTRL",
  ctrl: "CTRL",
  control: "CTRL",
  alt: "ALT",
  option: "ALT",
  shift: "⇧",
};

const KEY_GLYPHS: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  enter: "↵",
  return: "↵",
  escape: "Esc",
  esc: "Esc",
  backspace: "⌫",
  delete: "⌦",
  tab: "Tab",
  space: "␣",
};

const MODIFIERS = new Set(Object.keys(MAC_MODIFIER_GLYPHS));

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform;
  const nav = platform || navigator.platform || navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/i.test(nav);
}

function renderKey(raw: string, mac: boolean): string {
  const key = raw.trim().toLowerCase();
  if (MODIFIERS.has(key)) {
    return mac ? MAC_MODIFIER_GLYPHS[key] : OTHER_MODIFIER_LABELS[key];
  }
  if (KEY_GLYPHS[key]) return KEY_GLYPHS[key];
  return raw.length === 1 ? raw.toUpperCase() : raw;
}

function parseCombo(combo: string): string[] {
  return combo
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
}

type HotkeyProps = Omit<React.ComponentProps<"kbd">, "children"> & {
  /**
   * A key combination string like "command+k". Pass an array of strings
   * when the actual keys (not just modifiers) differ across platforms;
   * the first entry wins.
   */
  value: string | string[];
};

function Hotkey({ value, className, ...props }: HotkeyProps) {
  const [mac, setMac] = React.useState(false);
  React.useEffect(() => setMac(isMac()), []);

  const combo = Array.isArray(value) ? (value[0] ?? "") : value;
  const keys = parseCombo(combo);

  return (
    <kbd
      data-slot="hotkey"
      className={cn("inline-flex items-center gap-1 align-middle", className)}
      {...props}
    >
      {keys.map((k, i) => (
        <Kbd key={`${k}-${i}`}>{renderKey(k, mac)}</Kbd>
      ))}
    </kbd>
  );
}

export { Hotkey };
export type { HotkeyProps };
