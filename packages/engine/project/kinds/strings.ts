/**
 * The `strings` kind's file: rows keyed by `key`, one text per locale. Any
 * number of files merge by key. The string-key rules (which keys a project
 * uses, which a locale is missing) live here, so the CLI, the kinds'
 * cross-checks and the runtime table agree. Presentation only: the locale
 * never reaches a simulation. Zod, game/, scene/ and project/ only (all in
 * the hosted service's image).
 */
import { z } from "zod";

import { BEHAVIORS_FIELD } from "../../game/behaviors";
import { drawnText } from "../../game/rich-text";
import { splitOverridePath } from "../../scene/field-path";
import { jsonPointer, makeIssue } from "../../scene/issues";
import { plural } from "../../scene/plural";
import {
  PREFAB_KIND,
  PREFAB_MAX_DEPTH,
  type PrefabBody,
  type PrefabParam,
  type SceneIssue,
} from "../../scene/types";
import type { AssetId, AssetKindName } from "../types";
import {
  byCodeUnit,
  defineAssetKind,
  folderOf,
  isPlainObject,
  type DocLookup,
  type KindEnv,
} from "./define";
import type { DIALOGUE_KIND } from "./dialogue";
import type { FONT_KIND, FontMeta } from "./font";
import type { GAME_SETTINGS_KIND } from "./game-settings";
import type { SOUND_KIND } from "./sound";

export const STRINGS_KIND = "strings";
export const STRINGS_VERSION = 1;
export const STRINGS_SCHEMA_ID = `urn:jams-engine:strings:v${STRINGS_VERSION}`;

/** What a string key looks like: `intro.hello`, `caption.hit`. */
export const STRING_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
/** A locale column's name: a BCP 47 tag such as `en`, `fr` or `pt-BR`. */
export const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** A row's fields that aren't locale columns: its key, and a note for translators. */
export const STRING_ROW_FIELDS: readonly string[] = ["key", "note"];

/** Whether a row's column holds a locale's text rather than its key or note. */
export const isLocaleColumn = (column: string): boolean => !STRING_ROW_FIELDS.includes(column);

/** One key's text per locale; `note` is for translators and never shown. */
export type StringRow = { key: string; note?: string } & { [locale: string]: string | undefined };

/** A `strings:v1` file. */
export type StringsFile = {
  $schema?: string;
  kind: typeof STRINGS_KIND;
  v: typeof STRINGS_VERSION;
  strings: StringRow[];
};

/** game-settings' `engine.locales`: the default, what the game offers, fallbacks and fonts. */
export type LocaleSettings = {
  /** BCP 47, e.g. "en". */
  default: string;
  available: readonly string[];
  /** A locale's fallback chain before default, e.g. { "pt-BR": ["pt"] }. */
  fallback?: Readonly<Record<string, readonly string[]>>;
  /** The font for each locale (asset ids), and the default. */
  fonts?: Readonly<Record<string, AssetId>> & { default?: AssetId };
};

/** One place a project names a string key: a scene's `text` block, a dialogue line, a sound's caption. */
export type StringKeyUse = {
  key: string;
  kind: AssetKindName;
  id: AssetId;
  /** JSON Pointer into that doc. */
  pointer: string;
};

/**
 * Scripts written right to left: their script subtag, and their Unicode
 * Script name. Only scripts every supported browser's regex knows by name.
 */
const RTL_SCRIPTS: Readonly<Record<string, string>> = {
  arab: "Arabic",
  hebr: "Hebrew",
  thaa: "Thaana",
  syrc: "Syriac",
  nkoo: "Nko",
  adlm: "Adlam",
  rohg: "Hanifi_Rohingya",
  samr: "Samaritan",
  mand: "Mandaic",
  mend: "Mende_Kikakui",
  armi: "Imperial_Aramaic",
  avst: "Avestan",
  cprt: "Cypriot",
  hatr: "Hatran",
  hung: "Old_Hungarian",
  khar: "Kharoshthi",
  lydi: "Lydian",
  mani: "Manichaean",
  merc: "Meroitic_Cursive",
  mero: "Meroitic_Hieroglyphs",
  narb: "Old_North_Arabian",
  nbat: "Nabataean",
  orkh: "Old_Turkic",
  palm: "Palmyrene",
  phli: "Inscriptional_Pahlavi",
  phlp: "Psalter_Pahlavi",
  phnx: "Phoenician",
  prti: "Inscriptional_Parthian",
  sarb: "Old_South_Arabian",
  sogd: "Sogdian",
  sogo: "Old_Sogdian",
};

/**
 * A character of a right-to-left script, or punctuation only those scripts
 * use (the Arabic comma and question mark). Combining marks shared with
 * left-to-right scripts don't count, so a Latin letter's accent stays ltr.
 */
export const RTL_CHAR = new RegExp(
  `(?!\\p{Script=Inherited})[${Object.values(RTL_SCRIPTS)
    .map((name) => `\\p{Script_Extensions=${name}}`)
    .join("")}]`,
  "u",
);

/** Whether a script subtag ("Arab", "Deva") names a script written right to left. */
export const isRtlScript = (script: string): boolean =>
  Object.hasOwn(RTL_SCRIPTS, script.toLowerCase());

/** The locale a project without `engine.locales` plays in. */
export const DEFAULT_LOCALE = "en";

/**
 * game-settings' `engine.locales` as far as it reads: the default (else
 * `DEFAULT_LOCALE`), the available locales with the default always among
 * them, the fallback chains and fonts. Never throws on a malformed block.
 */
export function localeSettingsOf(block: unknown): LocaleSettings {
  const given = isPlainObject(block) ? block : {};
  const fallbackLocale =
    typeof given.default === "string" && given.default !== "" ? given.default : DEFAULT_LOCALE;
  const listed = Array.isArray(given.available)
    ? given.available.filter((l): l is string => typeof l === "string" && l !== "")
    : [];
  const available = unique([fallbackLocale, ...listed]);
  const out: LocaleSettings = { default: fallbackLocale, available };
  if (isPlainObject(given.fallback)) {
    const chains: Record<string, readonly string[]> = {};
    for (const [locale, chain] of Object.entries(given.fallback))
      if (Array.isArray(chain))
        chains[locale] = chain.filter((l): l is string => typeof l === "string");
    out.fallback = chains;
  }
  if (isPlainObject(given.fonts)) out.fonts = given.fonts as LocaleSettings["fonts"];
  return out;
}

const GAME_SETTINGS: typeof GAME_SETTINGS_KIND = "game-settings";

/** The project's locales: the game-settings in effect (first by path), read by `localeSettingsOf`. */
export function projectLocales(lookup: DocLookup): LocaleSettings {
  const [id] = lookup.ids(GAME_SETTINGS);
  const settings = id === undefined ? undefined : lookup.read(GAME_SETTINGS, id);
  const engine = isPlainObject(settings) ? settings.engine : undefined;
  return localeSettingsOf(isPlainObject(engine) ? engine.locales : undefined);
}

/**
 * The locales whose text stands for `locale`'s own: `locale`, then its
 * `fallback` chain. A key with text in none of them is untranslated there,
 * even when the default's text would show.
 */
export function localeFallbacks(locales: LocaleSettings, locale: string): string[] {
  return unique([locale, ...(locales.fallback?.[locale] ?? [])]);
}

/** Where a table looks a key up for `locale`: its fallbacks, then the default. */
export function localeChain(locales: LocaleSettings, locale: string): string[] {
  return unique([...localeFallbacks(locales, locale), locales.default]);
}

/** A row's text along `chain`: the first locale with a non-empty text. */
export function stringRowText(row: StringRow, chain: readonly string[]): string | undefined {
  for (const locale of chain) {
    const text = isLocaleColumn(locale) ? row[locale] : undefined;
    if (typeof text === "string" && text !== "") return text;
  }
  return undefined;
}

/** One key's row as the project merges it: the strings file it comes from and its index there. */
export type MergedStringRow = { row: StringRow; id: AssetId; index: number };

/** Every key's row across the project's strings files; a key in two files keeps the first by path. */
export function mergedStrings(lookup: DocLookup): Map<string, MergedStringRow> {
  const out = new Map<string, MergedStringRow>();
  for (const id of lookup.ids(STRINGS_KIND)) {
    const file = lookup.read<StringsFile>(STRINGS_KIND, id);
    if (!file || !Array.isArray(file.strings)) continue;
    file.strings.forEach((row, index) => {
      if (isPlainObject(row) && typeof row.key === "string" && !out.has(row.key))
        out.set(row.key, { row, id, index });
    });
  }
  return out;
}

/**
 * The locales a project's strings speak: the available ones, the default
 * first, then any other locale column a strings file holds (a row that
 * loses to another file's too), by name.
 */
export function stringLocales(lookup: DocLookup, locales: LocaleSettings): string[] {
  const columns = new Set<string>();
  for (const id of lookup.ids(STRINGS_KIND))
    for (const row of records(lookup.read<StringsFile>(STRINGS_KIND, id)?.strings))
      for (const column of Object.keys(row)) if (isLocaleColumn(column)) columns.add(column);
  const listed = unique([locales.default, ...locales.available]);
  return [...listed, ...[...columns].filter((c) => !listed.includes(c)).sort(byCodeUnit)];
}

const DIALOGUE: typeof DIALOGUE_KIND = "dialogue";
const SOUND: typeof SOUND_KIND = "sound";
const SCENE = "scene";
const TEXT_BEHAVIOR = "text";
/** The kinds whose docs name string keys, in the order `usedStringKeys` lists them. */
const KEYED_KINDS: readonly AssetKindName[] = [DIALOGUE, PREFAB_KIND, SCENE, SOUND];

/**
 * The string keys one doc names: a dialogue's lines' and choices' `text`
 * and its speakers' `name`; a sound's `caption`; the `text` blocks' `key`
 * in a scene or prefab (its entities, its instances' overrides and the
 * params that feed one, its own variant overrides). `lookup` finds an
 * instance's prefab for its params. In document order.
 */
export function stringKeysIn(
  kind: AssetKindName,
  id: AssetId,
  value: unknown,
  lookup?: DocLookup,
): StringKeyUse[] {
  if (!isPlainObject(value)) return [];
  const out: StringKeyUse[] = [];
  const use = (key: unknown, pointer: string) => {
    if (typeof key === "string" && key !== "") out.push({ key, kind, id, pointer });
  };
  if (kind === DIALOGUE) {
    for (const speaker of records(value.speakers))
      use(speaker.name, `/speakers/${itemSegment(speaker)}/name`);
    for (const node of records(value.nodes)) {
      const at = `/nodes/${itemSegment(node)}`;
      for (const [i, line] of list(node.lines).entries())
        if (isPlainObject(line)) use(line.text, `${at}/lines/${i}/text`);
      for (const [i, choice] of list(node.choices).entries())
        if (isPlainObject(choice)) use(choice.text, `${at}/choices/${i}/text`);
    }
  } else if (kind === SOUND) {
    use(value.caption, "/caption");
  } else if (kind === SCENE || kind === PREFAB_KIND) {
    bodyKeys(value, lookup, use);
  }
  return out;
}

/**
 * Every string key the project's docs name, by kind (dialogue, prefab,
 * scene, sound), then each kind's docs in path order, then document order.
 * `scenes` stands in for the lookup's scene docs (an editor's unsaved scene).
 */
export function usedStringKeys(
  lookup: DocLookup,
  scenes?: ReadonlyMap<AssetId, unknown>,
): StringKeyUse[] {
  const out: StringKeyUse[] = [];
  for (const kind of KEYED_KINDS) {
    if (kind === SCENE && scenes) {
      for (const [id, value] of scenes) out.push(...stringKeysIn(kind, id, value, lookup));
      continue;
    }
    for (const id of lookup.ids(kind))
      out.push(...stringKeysIn(kind, id, lookup.read(kind, id), lookup));
  }
  return out;
}

/**
 * The uses whose key has no text in `locale` nor along its fallback chain
 * (`localeFallbacks`); the default's text doesn't count for another locale,
 * so a key only the default holds is missing there.
 */
export function missingStringKeys(
  lookup: DocLookup,
  locales: LocaleSettings,
  locale: string,
  uses: readonly StringKeyUse[] = usedStringKeys(lookup),
): StringKeyUse[] {
  const rows = mergedStrings(lookup);
  const chain = localeFallbacks(locales, locale);
  return uses.filter((u) => {
    const merged = rows.get(u.key);
    return !merged || stringRowText(merged.row, chain) === undefined;
  });
}

/**
 * `string-key-missing` for each of `uses` with no text in some available
 * locale (`missingStringKeys`): an error when the default is among them,
 * else info. The one rule every kind's `crossValidate` reports keys by.
 */
export function stringKeyIssues(lookup: DocLookup, uses: readonly StringKeyUse[]): SceneIssue[] {
  if (uses.length === 0) return [];
  const locales = projectLocales(lookup);
  const missingIn = new Map<StringKeyUse, string[]>();
  for (const locale of locales.available)
    for (const use of missingStringKeys(lookup, locales, locale, uses)) {
      const listed = missingIn.get(use);
      if (listed) listed.push(locale);
      else missingIn.set(use, [locale]);
    }
  const issues: SceneIssue[] = [];
  for (const use of uses) {
    const missing = missingIn.get(use);
    if (!missing) continue;
    const others = missing.filter((l) => l !== locales.default);
    const inDefault = others.length < missing.length;
    const message = inDefault
      ? `string key "${use.key}" has no text in the default locale "${locales.default}"${others.length > 0 ? ` nor in ${others.join(", ")}` : ""}`
      : `string key "${use.key}" has no text in ${others.join(", ")}; the default locale's shows`;
    issues.push(
      makeIssue("string-key-missing", {
        severity: inDefault ? "error" : "info",
        message,
        path: use.pointer,
        got: use.key,
      }),
    );
  }
  return issues;
}

/**
 * `pointer` with each `@<id>` token turned into its item's index, so it
 * names a line in the file as the doc's other issues do.
 */
function indexedPointer(value: unknown, pointer: string): string {
  let at = value;
  const tokens = pointer
    .split("/")
    .slice(1)
    .map((raw): string | number => {
      const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
      const index =
        Array.isArray(at) && token.startsWith("@")
          ? at.findIndex((item) => isPlainObject(item) && item.id === token.slice(1))
          : -1;
      if (index >= 0) {
        at = (at as unknown[])[index];
        return index;
      }
      at = isPlainObject(at) ? at[token] : Array.isArray(at) ? at[Number(token)] : undefined;
      return token;
    });
  return jsonPointer(tokens);
}

/** `stringKeyIssues` for the keys one doc names (`stringKeysIn`), each at its indexed pointer. */
export function docStringKeyIssues(
  kind: AssetKindName,
  value: unknown,
  lookup: DocLookup,
): SceneIssue[] {
  const uses = stringKeysIn(kind, lookupIdOf(lookup, kind, value) ?? "", value, lookup);
  return stringKeyIssues(
    lookup,
    uses.map((use) => ({ ...use, pointer: indexedPointer(value, use.pointer) })),
  );
}

/** The font a locale's text draws in: its own in `fonts`, else the default's. */
export function localeFont(locales: LocaleSettings, locale: string): AssetId | undefined {
  const fonts = locales.fonts;
  if (!fonts) return undefined;
  const own = Object.hasOwn(fonts, locale) ? fonts[locale] : undefined;
  if (typeof own === "string" && own !== "") return own;
  return typeof fonts.default === "string" && fonts.default !== "" ? fonts.default : undefined;
}

/**
 * The id `lookup` holds `value` under, by identity: `crossValidate` is
 * handed a doc's value, not its id. Undefined for a value the lookup
 * doesn't hold (an unsaved copy).
 */
export function lookupIdOf(
  lookup: DocLookup,
  kind: AssetKindName,
  value: unknown,
): AssetId | undefined {
  return lookup.ids(kind).find((id) => lookup.read(kind, id) === value);
}

/** `locale-unknown` once per column the game settings don't offer, at its first row. */
function unknownLocaleIssues(file: StringsFile, locales: LocaleSettings): SceneIssue[] {
  const firstRow = new Map<string, number>();
  file.strings.forEach((row, index) => {
    for (const column of Object.keys(row))
      if (isLocaleColumn(column) && !locales.available.includes(column) && !firstRow.has(column))
        firstRow.set(column, index);
  });
  return [...firstRow].map(([column, index]) =>
    makeIssue("locale-unknown", {
      message: `column "${column}" is a locale the game settings don't offer (available: ${locales.available.join(", ")}); its text never shows`,
      path: jsonPointer(["strings", index, column]),
      got: column,
      expected: locales.available.join(", "),
    }),
  );
}

/** `dup-id` (warn) for each row whose key an earlier file by path holds: that file's text wins. */
function duplicateKeyIssues(file: StringsFile, lookup: DocLookup): SceneIssue[] {
  const own = lookupIdOf(lookup, STRINGS_KIND, file);
  const merged = mergedStrings(lookup);
  const issues: SceneIssue[] = [];
  file.strings.forEach((row, index) => {
    const winner = merged.get(row.key);
    if (!winner || winner.id === own) return;
    issues.push(
      makeIssue("dup-id", {
        severity: "warn",
        message: `string key "${row.key}" is also in strings "${winner.id}", which comes first by path and wins`,
        path: jsonPointer(["strings", index, "key"]),
        got: row.key,
        expected: `a key no other strings file holds`,
        hint: "Keep each key in one strings file: remove this row, or rename its key.",
      }),
    );
  });
  return issues;
}

const FONT: typeof FONT_KIND = "font";

type Coverage = NonNullable<FontMeta["coverage"]>;

/** A font asset's code point ranges; undefined when the project lacks it or its coverage wasn't read. */
function fontCoverage(env: KindEnv, font: AssetId): Coverage | undefined {
  const entry = env.project?.byId.get(font);
  if (entry?.kind !== FONT) return undefined;
  const coverage = (entry.meta as Partial<FontMeta> | undefined)?.coverage;
  return Array.isArray(coverage) ? coverage : undefined;
}

function covers(coverage: Coverage, cp: number): boolean {
  let lo = 0;
  let hi = coverage.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [from, to] = coverage[mid]!;
    if (cp < from) hi = mid - 1;
    else if (cp > to) lo = mid + 1;
    else return true;
  }
  return false;
}

/** The code points `text` draws: markup, placeholders, control and format characters left out. */
function drawnCodePoints(text: string): number[] {
  const out: number[] = [];
  for (const ch of drawnText(text)) {
    if (/[\p{Cc}\p{Cf}]/u.test(ch)) continue;
    out.push(ch.codePointAt(0)!);
  }
  return out;
}

const codePointName = (cp: number) =>
  `U+${cp.toString(16).toUpperCase().padStart(4, "0")} "${String.fromCodePoint(cp)}"`;

/** How many uncovered characters a `font-missing` message lists. */
const LISTED_CODE_POINTS = 8;

/**
 * `font-missing` (warn), once per available locale: the text this file's
 * winning rows show in it (along `localeChain`) uses code points its font
 * (`localeFont`) doesn't cover. A font with no `coverage` is skipped.
 */
function fontCoverageIssues(
  file: StringsFile,
  lookup: DocLookup,
  env: KindEnv,
  locales: LocaleSettings,
): SceneIssue[] {
  if (!locales.fonts) return [];
  const own = lookupIdOf(lookup, STRINGS_KIND, file);
  const merged = mergedStrings(lookup);
  const issues: SceneIssue[] = [];
  for (const locale of locales.available) {
    const font = localeFont(locales, locale);
    const coverage = font === undefined ? undefined : fontCoverage(env, font);
    if (!coverage) continue;
    const chain = localeChain(locales, locale);
    const missing = new Set<number>();
    let rows = 0;
    let first: { pointer: string; key: string } | undefined;
    file.strings.forEach((row, index) => {
      const winner = merged.get(row.key);
      if (winner && (winner.id !== own || winner.index !== index)) return;
      const column = chain.find(
        (l) => isLocaleColumn(l) && typeof row[l] === "string" && row[l] !== "",
      );
      if (column === undefined) return;
      const uncovered = drawnCodePoints(row[column]!).filter((cp) => !covers(coverage, cp));
      if (uncovered.length === 0) return;
      for (const cp of uncovered) missing.add(cp);
      rows++;
      first ??= { pointer: jsonPointer(["strings", index, column]), key: row.key };
    });
    if (!first) continue;
    const listed = [...missing].sort((a, b) => a - b);
    const shown = listed.slice(0, LISTED_CODE_POINTS).map(codePointName).join(", ");
    const more =
      listed.length > LISTED_CODE_POINTS ? `, and ${listed.length - LISTED_CODE_POINTS} more` : "";
    issues.push(
      makeIssue("font-missing", {
        message: `locale "${locale}" shows ${plural(listed.length, "character")} font "${font}" doesn't cover: ${shown}${more} (in ${plural(rows, "row")}, first "${first.key}")`,
        path: first.pointer,
        got: font,
      }),
    );
  }
  return issues;
}

type UseKey = (key: unknown, pointer: string) => void;

/** A scene's or prefab's `text` keys: entities, then instances, then its own overrides. */
function bodyKeys(body: Record<string, unknown>, lookup: DocLookup | undefined, use: UseKey) {
  for (const entity of records(body.entities)) {
    const behaviors = entity[BEHAVIORS_FIELD];
    const block = isPlainObject(behaviors) ? behaviors[TEXT_BEHAVIOR] : undefined;
    if (isPlainObject(block))
      use(block.key, `/entities/${itemSegment(entity)}/${BEHAVIORS_FIELD}/${TEXT_BEHAVIOR}/key`);
  }
  for (const inst of records(body.instances)) {
    const at = `/instances/${itemSegment(inst)}`;
    overrideKeys(inst.overrides, `${at}/overrides`, use);
    if (isPlainObject(inst.params) && typeof inst.prefab === "string" && lookup)
      paramKeys(inst.params, lookup, inst.prefab, `${at}/params`, use);
  }
  overrideKeys(body.overrides, "/overrides", use);
}

/** `text` keys an overrides record sets: a key, a whole block, or a whole behaviors record. */
function overrideKeys(overrides: unknown, at: string, use: UseKey) {
  if (!isPlainObject(overrides)) return;
  for (const [path, value] of Object.entries(overrides)) {
    const split = splitOverridePath(path);
    if (!split) continue;
    const pointer = `${at}${jsonPointer([path])}`;
    const field = split.field;
    if (field === `${BEHAVIORS_FIELD}.${TEXT_BEHAVIOR}.key`) use(value, pointer);
    else if (field === `${BEHAVIORS_FIELD}.${TEXT_BEHAVIOR}` && isPlainObject(value))
      use(value.key, `${pointer}/key`);
    else if (field === BEHAVIORS_FIELD && isPlainObject(value)) {
      const block = value[TEXT_BEHAVIOR];
      if (isPlainObject(block)) use(block.key, `${pointer}/${TEXT_BEHAVIOR}/key`);
    }
  }
}

/** `text` keys an instance's params feed, through its prefab's params (a variant's bases too). */
function paramKeys(
  params: Record<string, unknown>,
  lookup: DocLookup,
  prefab: string,
  at: string,
  use: UseKey,
) {
  for (const [name, value] of Object.entries(params)) {
    const param = prefabParam(lookup, prefab, name);
    if (!param) continue;
    for (const target of param.targets ?? []) {
      if (splitOverridePath(target)?.field !== `${BEHAVIORS_FIELD}.${TEXT_BEHAVIOR}.key`) continue;
      const mapped = param.map?.[target];
      const key =
        mapped && typeof value === "string" && Object.hasOwn(mapped, value) ? mapped[value] : value;
      use(key, `${at}${jsonPointer([name])}`);
    }
  }
}

function prefabParam(lookup: DocLookup, prefab: string, name: string): PrefabParam | undefined {
  let id: unknown = prefab;
  for (let depth = 0; typeof id === "string" && depth <= PREFAB_MAX_DEPTH; depth++) {
    const doc = lookup.read<Partial<PrefabBody>>(PREFAB_KIND, id);
    if (!isPlainObject(doc)) return undefined;
    const param = isPlainObject(doc.params) ? doc.params[name] : undefined;
    if (isPlainObject(param)) return param;
    id = doc.base;
  }
  return undefined;
}

const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);
const records = (v: unknown): Record<string, unknown>[] => list(v).filter(isPlainObject);
/** A keyed item's pointer segment, `@<id>`; the escaping `jsonPointer` gives. */
const itemSegment = (item: Record<string, unknown>) =>
  jsonPointer([`@${String(item.id)}`]).slice(1);
const unique = (values: readonly string[]): string[] => [...new Set(values)];

const rowSchema = z
  .object({
    key: z
      .string()
      .regex(STRING_KEY_PATTERN)
      .describe("The key game code, text blocks and dialogue name, e.g. `intro.hello`."),
    note: z.string().optional().describe("For translators; never shown."),
  })
  .catchall(z.string().describe("The text in the locale this column names (BCP 47)."))
  .describe("One key's text in each locale, by locale column.");

const stringsSchema: z.ZodType<StringsFile> = z
  .strictObject({
    $schema: z.string().optional().describe("The strings JSON Schema this file follows."),
    kind: z.literal(STRINGS_KIND).describe('Always "strings".'),
    v: z.literal(STRINGS_VERSION).describe("Strings format version."),
    strings: z
      .array(rowSchema)
      .describe("Rows keyed by `key`; every strings file in a project merges by key."),
  })
  .describe(
    "A string table: text by key and locale, merged across a project's strings files. Presentation only.",
  ) as unknown as z.ZodType<StringsFile>;

/** Text by key and locale for world text, dialogue and captions; presentation only. */
export const stringsKind = defineAssetKind({
  kind: STRINGS_KIND,
  title: "Strings",
  description:
    "Text by key and locale for world text, dialogue and captions; every strings file merges by key.",
  match: { jsonKind: STRINGS_KIND },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "doc",
  runtime: "view",
  version: STRINGS_VERSION,
  schemaId: STRINGS_SCHEMA_ID,
  schema: () => stringsSchema,
  layout: {
    as: "map",
    fields: {
      strings: { as: "keyed", id: "key", item: { as: "map", rest: { as: "atomic" } } },
    },
    rest: { as: "atomic" },
  },
  limits: { maxStateBytes: 1_048_576, maxItems: 20_000 },
  crossValidate: (file: StringsFile, lookup: DocLookup, env: KindEnv): SceneIssue[] => {
    const locales = projectLocales(lookup);
    return [
      ...unknownLocaleIssues(file, locales),
      ...duplicateKeyIssues(file, lookup),
      ...fontCoverageIssues(file, lookup, env, locales),
    ];
  },
  empty: (): StringsFile => ({ kind: STRINGS_KIND, v: STRINGS_VERSION, strings: [] }),
});
