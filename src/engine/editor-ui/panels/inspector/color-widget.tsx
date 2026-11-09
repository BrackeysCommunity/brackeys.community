import { useRef, useState } from "react";

import {
  ColorField as ColorPicker,
  Input,
  parseHex,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toHex,
} from "../../kit/index";

/** A stored colour as `#rrggbb`: a `0xRRGGBB` number or a hex string; "" for anything else. */
export function colorText(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffff)
    return `#${value.toString(16).padStart(6, "0")}`;
  if (typeof value === "string") {
    const rgb = parseHex(value);
    return rgb ? toHex(rgb) : "";
  }
  return "";
}

/** `text` as the field stores it: `0xRRGGBB` when `numeric`, else `#rrggbb`; null when it isn't a colour. */
export function colorValue(text: string, numeric: boolean): number | string | null {
  const rgb = parseHex(text);
  if (!rgb) return null;
  const hex = toHex(rgb);
  return numeric ? parseInt(hex.slice(1), 16) : hex;
}

const INVALID = "Enter a colour like #ff8800.";

/**
 * A colour field's control: a swatch that opens the kit's picker and a hex
 * field. The picker previews on the swatch as it moves and commits when a
 * control is let go; the hex field commits on Enter or blur. An emptied
 * optional field commits `undefined`.
 */
export function ColorWidget({
  title,
  path,
  value,
  mixed,
  optional,
  numeric,
  placeholder,
  onCommit,
  onProblem,
}: {
  title: string;
  /** The hex field's accessible name. */
  path: string;
  value: unknown;
  mixed: boolean;
  optional: boolean;
  /** The field stores `0xRRGGBB` rather than `#rrggbb`. */
  numeric: boolean;
  /** Shown while the hex field is empty: "—" when mixed, the default when unset. */
  placeholder?: string;
  /** Writes the value; returns why it didn't land, or null. */
  onCommit: (value: number | string | undefined) => string | null;
  onProblem: (message: string | null) => void;
}) {
  const shown = mixed ? "" : colorText(value);
  const [draft, setDraft] = useState<string | null>(null);
  // The picker commits right after its last change, before a re-render.
  const latest = useRef<string | null>(null);
  const edit = (text: string | null) => {
    latest.current = text;
    setDraft(text);
  };

  const commit = (text: string | null) => {
    if (text === null) return;
    let next: number | string | undefined;
    if (text.trim() === "" && optional) next = undefined;
    else {
      const parsed = colorValue(text, numeric);
      if (parsed === null) return onProblem(INVALID);
      next = parsed;
    }
    const problem = onCommit(next);
    onProblem(problem);
    if (!problem) edit(null);
  };

  const live = draft !== null ? colorText(draft) : "";
  const swatch = live || shown;
  return (
    <div className="je-insp-row" data-gap="tight">
      <Popover>
        <PopoverTrigger
          aria-label={`Pick ${title}`}
          className="je-insp-swatch"
          data-unset={swatch ? undefined : ""}
          style={swatch ? { background: swatch } : undefined}
        />
        <PopoverContent>
          <ColorPicker
            label={title}
            value={swatch || "#000000"}
            onChange={edit}
            onCommit={() => commit(latest.current)}
          />
        </PopoverContent>
      </Popover>
      <Input
        aria-label={path}
        className="je-insp-color-hex"
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        value={draft ?? shown}
        onChange={(e) => edit(e.target.value)}
        onBlur={() => commit(latest.current)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(latest.current);
          if (e.key === "Escape") {
            edit(null);
            onProblem(null);
          }
        }}
      />
    </div>
  );
}
