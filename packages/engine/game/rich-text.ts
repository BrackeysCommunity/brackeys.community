/**
 * The engine's rich-text markup, parsed once for the Pixi view, the DOM
 * helpers and the strings kind's font check. Pure; `text/rich` re-exports it.
 */
import type { AssetId } from "../project/types";

/** Values a `{name}` placeholder is filled from. */
export type TextVars = Readonly<Record<string, string | number>>;

export type RichSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** 0xRRGGBB. */
  color?: number;
  size?: number;
  /** An inline atlas frame. */
  icon?: { asset: AssetId; frame: string };
  /** Animated per glyph; still under reduced motion. */
  effect?: "shake" | "wave";
};
export type RichLine = readonly RichSpan[];

type Style = Omit<RichSpan, "text" | "icon">;
type PairedTag = "b" | "i" | "color" | "size" | "shake" | "wave";
type Open = { tag: PairedTag; style: Partial<Style> };

const MAX_SIZE = 512;
const TAG = /^\[(\/?)([a-z]+)(?:=([^\]\n]*))?\]/;
/** A `{name}` placeholder's name, as a regex source. */
export const PLACEHOLDER_NAME = "[A-Za-z_][A-Za-z0-9_.-]*";
const PLACEHOLDER = new RegExp(`^\\{(${PLACEHOLDER_NAME})\\}`);
/** The characters a backslash escapes. */
export const ESCAPABLE = "[{\\";
/** `ESCAPABLE` as the inside of a regex character class. */
export const ESCAPABLE_CLASS = [...ESCAPABLE].map((ch) => `\\${ch}`).join("");

/** `text` with every escapable character but those in `except` escaped, so the parser shows it as written. */
export function escapeRich(text: string, except = ""): string {
  let out = "";
  for (const ch of text) out += ESCAPABLE.includes(ch) && !except.includes(ch) ? `\\${ch}` : ch;
  return out;
}

/** The style a paired opening tag sets, or a reason it's malformed; null for a tag that isn't paired. */
function openStyle(tag: string, value: string | undefined): Partial<Style> | string | null {
  switch (tag) {
    case "b":
    case "i":
    case "shake":
    case "wave":
      if (value !== undefined) return `[${tag}] takes no value`;
      if (tag === "b") return { bold: true };
      if (tag === "i") return { italic: true };
      return { effect: tag };
    case "color":
      if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) return "[color] needs #rrggbb";
      return { color: Number.parseInt(value.slice(1), 16) };
    case "size": {
      const size = value === undefined || !/^\d+(\.\d+)?$/.test(value) ? NaN : Number(value);
      if (!(size > 0 && size <= MAX_SIZE))
        return `[size] needs a number above 0, up to ${MAX_SIZE}`;
      return { size };
    }
    default:
      return null;
  }
}

function parseIcon(value: string | undefined): RichSpan["icon"] | null {
  const match = value === undefined ? null : /^([^:\s]+):(\S+)$/.exec(value);
  if (!match?.[1] || !match[2]) return null;
  return { asset: match[1], frame: match[2] };
}

function styleOf(stack: readonly Open[]): Style {
  const style: Style = {};
  for (const open of stack) Object.assign(style, open.style);
  return style;
}

function sameStyle(a: RichSpan, b: Style): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.color === b.color &&
    a.size === b.size &&
    a.effect === b.effect
  );
}

/**
 * `[b]…[/b]`, `[i]`, `[color=#rrggbb]`, `[size=n]`, `[icon=asset:frame]`,
 * `[shake]`, `[wave]`, `\[` `\{` `\\` escapes; `{name}` filled from `vars`.
 * Tags nest and may close out of order; vars are inserted as text, never
 * parsed; unknown or missing ones stay literal with a warning.
 */
export function parseRichText(
  source: string,
  vars?: TextVars,
): { lines: readonly RichLine[]; warnings: readonly string[] } {
  return parse(source, (name) => (vars && Object.hasOwn(vars, name) ? vars[name] : undefined));
}

/** The characters `source` draws whatever its vars fill: markup, icons and `{name}` placeholders left out. */
export function drawnText(source: string): string {
  return richPlainText(parse(source, () => "").lines);
}

function parse(
  source: string,
  valueOf: (name: string) => string | number | undefined,
): { lines: readonly RichLine[]; warnings: readonly string[] } {
  const lines: RichSpan[][] = [[]];
  const warnings: string[] = [];
  const stack: Open[] = [];
  let style: Style = {};

  const push = (text: string, icon?: RichSpan["icon"]): void => {
    const line = lines[lines.length - 1]!;
    if (!icon) {
      if (text === "") return;
      const last = line[line.length - 1];
      if (last && !last.icon && sameStyle(last, style)) {
        last.text += text;
        return;
      }
    }
    line.push(icon ? { text: "", ...style, icon } : { text, ...style });
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "\\" && i + 1 < source.length && ESCAPABLE.includes(source[i + 1]!)) {
      push(source[i + 1]!);
      i += 2;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      lines.push([]);
      i += ch === "\r" && source[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "{") {
      const match = PLACEHOLDER.exec(source.slice(i));
      if (match) {
        const name = match[1]!;
        const value = valueOf(name);
        if (value === undefined) warnings.push(`{${name}} has no value; it shows as written`);
        push(value === undefined ? match[0] : String(value));
        i += match[0].length;
        continue;
      }
    }
    if (ch === "[") {
      const match = TAG.exec(source.slice(i));
      if (match) {
        const [whole, slash, tag = "", value] = match;
        const problem = applyTag(slash === "/", tag, value);
        if (problem) {
          warnings.push(`${whole}: ${problem}; it shows as written`);
          push(whole);
        }
        i += whole.length;
        continue;
      }
    }
    push(ch);
    i++;
  }

  for (const open of stack) warnings.push(`[${open.tag}] is never closed`);
  return { lines, warnings };

  function applyTag(closing: boolean, tag: string, value: string | undefined): string | null {
    if (tag === "icon" && !closing) {
      const icon = parseIcon(value);
      if (!icon) return "[icon] needs asset:frame";
      push("", icon);
      return null;
    }
    const opened = closing ? null : openStyle(tag, value);
    if (closing) {
      if (value !== undefined) return "a closing tag takes no value";
      let at = stack.length - 1;
      while (at >= 0 && stack[at]!.tag !== tag) at--;
      if (at < 0) return openStyle(tag, undefined) === null ? "unknown tag" : "it closes nothing";
      stack.splice(at, 1);
    } else if (opened === null) {
      return "unknown tag";
    } else if (typeof opened === "string") {
      return opened;
    } else {
      stack.push({ tag: tag as PairedTag, style: opened });
    }
    style = styleOf(stack);
    return null;
  }
}

/** Parsed lines as plain text, icons dropped. */
export const richPlainText = (lines: readonly RichLine[]): string =>
  lines.map((line) => line.map((span) => span.text).join("")).join("\n");

/** Plain text with the markup removed: for captions, screen readers and measuring. */
export function plainText(source: string, vars?: TextVars): string {
  return richPlainText(parseRichText(source, vars).lines);
}
