/**
 * The runtime string table and locale rules. Pure; the key rules
 * themselves live in the strings kind, which this calls.
 */
import type { TextFont } from "../context";
import { textFontOf } from "../game/behaviors/text";
import type { DocLookup } from "../project/kinds/define";
import {
  DEFAULT_LOCALE,
  isRtlScript,
  localeChain,
  localeFont,
  localeSettingsOf,
  mergedStrings,
  stringRowText,
  type LocaleSettings,
} from "../project/kinds/strings";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId } from "../project/types";
import { ESCAPABLE_CLASS, escapeRich, PLACEHOLDER_NAME, type TextVars } from "./rich";

export type TextDirection = "ltr" | "rtl";

export interface StringTable {
  /** The text for `key` in the locale, its fallbacks, then default; the key itself, bracketed, when missing. */
  get(key: string, vars?: TextVars): string;
  has(key: string): boolean;
  readonly locale: string;
  readonly direction: TextDirection;
}

/**
 * A locale's strings as plain data, what the shell hands a scene view: the
 * text of each key after the fallback chain, and the locale's font.
 */
export type StringTableData = {
  locale: string;
  direction: TextDirection;
  strings: Readonly<Record<string, string>>;
  font: TextFont | null;
};

export { DEFAULT_LOCALE };

/** How a key with no text shows. */
export const bracketKey = (key: string): string => `[${key}]`;

/** A table with no strings: every key shows bracketed. */
export function emptyStringTable(locale: string): StringTable {
  return Object.freeze({
    get: bracketKey,
    has: () => false,
    locale,
    direction: localeDirection(locale),
  });
}

/** `key`'s text in `strings`, else the key bracketed. */
export const keyedText = (
  strings: Readonly<Record<string, string>> | null | undefined,
  key: string,
): string => (strings && Object.hasOwn(strings, key) ? strings[key]! : bracketKey(key));

/**
 * A locale's text by key across the view's strings files (a key in two
 * files keeps the first by path): `locale`, its fallback chain, then the
 * default (`localeChain`). A key with no text there shows bracketed.
 */
export function stringTable(view: ProjectRuntimeView, locale: string): StringTable {
  return stringTableOf(stringTableData(view, locale, null));
}

/** The table over strings already resolved for a locale, sharing them. */
export function stringTableOf(data: StringTableData): StringTable {
  const { strings } = data;
  return Object.freeze({
    get: (key: string, vars?: TextVars) => {
      const text = keyedText(strings, key);
      return vars && Object.hasOwn(strings, key) ? fillVars(text, vars) : text;
    },
    has: (key: string) => Object.hasOwn(strings, key),
    locale: data.locale,
    direction: data.direction,
  });
}

/** What a scene view resolves keyed text through: the table's text by key and `font`, as data. */
export function stringTableData(
  view: ProjectRuntimeView,
  locale: string,
  font: TextFont | null,
): StringTableData {
  return Object.freeze({
    locale,
    direction: localeDirection(locale),
    strings: localeStrings(view, locale),
    font,
  });
}

/**
 * The font `locale`'s text draws in (`engine.locales.fonts`) and its asset
 * id; null when the locale names none or the asset isn't a font yet.
 */
export function localeFontOf(
  view: ProjectRuntimeView,
  locale: string,
): { id: AssetId; font: TextFont } | null {
  const id = localeFont(localeSettingsOf(view.engine.locales), locale);
  const font = textFontOf((asset) => view.asset(asset), id);
  return font && id !== undefined ? { id, font } : null;
}

/** `locale`'s table and font in `view` (default the default locale), as the shell hands a scene view. */
export function localeTableData(view: ProjectRuntimeView, locale?: string): StringTableData {
  const shown = locale ?? localeSettingsOf(view.engine.locales).default;
  return stringTableData(view, shown, localeFontOf(view, shown)?.font ?? null);
}

/** Every key with text along `locale`'s chain, and that text. */
function localeStrings(view: ProjectRuntimeView, locale: string): Readonly<Record<string, string>> {
  const lookup: DocLookup = {
    ids: (kind) => view.docs?.(kind) ?? [],
    read: (kind, id) => view.doc?.(kind, id),
  };
  const chain = localeChain(localeSettingsOf(view.engine.locales), locale);
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, { row }] of mergedStrings(lookup)) {
    const text = stringRowText(row, chain);
    if (text !== undefined) out[key] = text;
  }
  return Object.freeze(out);
}

/** A `{name}` placeholder, or a backslash escape to keep as written. */
const PLACEHOLDER_OR_ESCAPE = new RegExp(
  `\\\\[${ESCAPABLE_CLASS}]|\\{(${PLACEHOLDER_NAME})\\}`,
  "g",
);

/**
 * `text` with each placeholder `vars` names filled in, the value escaped
 * so the rich-text parser shows it as written; others stay for the parser.
 */
function fillVars(text: string, vars: TextVars): string {
  return text.replace(PLACEHOLDER_OR_ESCAPE, (whole, name: string | undefined) => {
    if (name === undefined || !Object.hasOwn(vars, name)) return whole;
    return escapeRich(String(vars[name]));
  });
}

/** Languages written right to left, by language subtag. */
const RTL_LANGUAGES: readonly string[] = [
  "ar",
  "fa",
  "he",
  "ur",
  "yi",
  "ps",
  "sd",
  "ug",
  "dv",
  "ckb",
];

/**
 * Right to left for the RTL languages above and the strings kind's RTL
 * scripts; a script subtag decides ("sd-Deva" ltr, "pa-Arab" rtl).
 */
export function localeDirection(locale: string): TextDirection {
  const script = locale
    .split("-")
    .slice(1)
    .find((part) => /^[A-Za-z]{4}$/.test(part));
  if (script !== undefined) return isRtlScript(script) ? "rtl" : "ltr";
  return RTL_LANGUAGES.includes(languageOf(locale)) ? "rtl" : "ltr";
}

/**
 * The locale a player starts in: the saved preference, else the first of
 * `languages` matching `available` by language subtag, else the default.
 */
export function resolveLocale(
  locales: LocaleSettings | null,
  opts: { saved?: string | null; languages?: readonly string[] },
): string {
  const fallback = locales?.default ?? DEFAULT_LOCALE;
  const available = [fallback, ...(locales?.available ?? [])];
  const exact = (tag: string) => available.find((l) => l.toLowerCase() === tag.toLowerCase());
  if (opts.saved) {
    const saved = exact(opts.saved);
    if (saved !== undefined) return saved;
  }
  for (const tag of opts.languages ?? []) {
    const match =
      exact(tag) ??
      available.find((l) => languageOf(l) === languageOf(tag) && languageOf(tag) !== "");
    if (match !== undefined) return match;
  }
  return fallback;
}

const languageOf = (locale: string): string => locale.split("-")[0]?.toLowerCase() ?? "";
