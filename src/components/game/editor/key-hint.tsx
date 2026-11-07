import { Hotkey } from "@/components/ui/hotkey";

const MODIFIER: Record<string, string> = { Mod: "command", Shift: "shift", Alt: "alt" };

/** A keymap chord (`Shift+Mod+Enter`) as `Hotkey` spells it (`shift+command+enter`). */
export function hotkeyOf(chord: string): string {
  const parts = chord.endsWith("++") ? [...chord.slice(0, -2).split("+"), "+"] : chord.split("+");
  return parts.map((p) => MODIFIER[p] ?? p.toLowerCase()).join("+");
}

/** A tooltip line: what the control does and, when it has one, its chord. */
export function KeyHint({ text, chord }: { text: string; chord?: string }) {
  return (
    <span className="flex items-center gap-2">
      {text}
      {chord ? <Hotkey value={hotkeyOf(chord)} /> : null}
    </span>
  );
}
