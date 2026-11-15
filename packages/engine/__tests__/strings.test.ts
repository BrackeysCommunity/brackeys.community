// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import { memoryRuntimeView } from "../headless/runtime-view";
import { parseAssetDoc } from "../project/kinds";
import { gameSettingsKind } from "../project/kinds/game-settings";
import { localeFont, stringsKind, type LocaleSettings } from "../project/kinds/strings";
import { heldProject, type HeldFile } from "../project/runtime-view";
import type { AssetSidecar } from "../project/sidecar";
import { validateProject } from "../project/validate-project";
import type { SceneIssue } from "../scene/types";
import {
  bracketKey,
  keyedText,
  localeDirection,
  resolveLocale,
  stringTable,
  stringTableData,
  stringTableOf,
} from "../text/strings";
import { heldDocs } from "./fixtures/held-project";

const LOCALES: LocaleSettings = {
  default: "en",
  available: ["en", "fr", "pt", "pt-BR", "ar"],
  fallback: { "pt-BR": ["pt"] },
};

const strings = (rows: Record<string, string>[]) => ({ kind: "strings", v: 1, strings: rows });
const settings = (locales: unknown) => ({
  kind: "game-settings",
  v: 2,
  engine: { locales },
  game: {},
});

const VIEW = memoryRuntimeView({
  engine: { locales: LOCALES },
  docs: {
    strings: {
      "a-menu": strings([
        { key: "menu.play", en: "Play", fr: "Jouer", pt: "Jogar" },
        { key: "door.open", en: "Open", "pt-BR": "Abrir" },
        { key: "greet", en: "Hello, {name}.", ar: "مرحبا، {name}." },
      ]),
      "b-talk": strings([
        { key: "menu.play", en: "Start" },
        { key: "talk.hi", en: "Hi", fr: "", pt: "Oi" },
      ]),
    },
  },
});

describe("stringTable", () => {
  it("walks the locale, its fallback chain, then the default", () => {
    const br = stringTable(VIEW, "pt-BR");
    expect(br.get("door.open")).toBe("Abrir");
    expect(br.get("menu.play")).toBe("Jogar");
    expect(br.get("talk.hi")).toBe("Oi");
    expect(br.get("greet", { name: "Ana" })).toBe("Hello, Ana.");

    const fr = stringTable(VIEW, "fr");
    expect(fr.get("menu.play")).toBe("Jouer");
    // An empty text counts as none: the default's shows.
    expect(fr.get("talk.hi")).toBe("Hi");
    expect(fr.get("door.open")).toBe("Open");
  });

  it("keeps a key two files hold from the first by path", () => {
    expect(stringTable(VIEW, "en").get("menu.play")).toBe("Play");
  });

  it("brackets a key no locale has, and says so through has()", () => {
    const table = stringTable(VIEW, "fr");
    expect(table.get("nope.missing")).toBe("[nope.missing]");
    expect(table.get("nope.missing")).toBe(bracketKey("nope.missing"));
    expect(table.has("nope.missing")).toBe(false);
    expect(table.has("menu.play")).toBe(true);
  });

  it("fills placeholders as text, leaving unnamed ones and escapes for the rich-text parser", () => {
    const view = memoryRuntimeView({
      docs: { strings: { s: strings([{ key: "k", en: "{who} has \\{n} and {n}" }]) } },
    });
    const table = stringTable(view, "en");
    expect(table.get("k", { who: "[b]Ann{x}" })).toBe("\\[b]Ann\\{x} has \\{n} and {n}");
    expect(table.get("k")).toBe("{who} has \\{n} and {n}");
  });

  it("names its locale and direction, and plays in the default without any settings", () => {
    const ar = stringTable(VIEW, "ar");
    expect(ar.locale).toBe("ar");
    expect(ar.direction).toBe("rtl");
    expect(ar.get("greet", { name: 3 })).toBe("مرحبا، 3.");
    const bare = stringTable(memoryRuntimeView(), "en");
    expect(bare.get("menu.play")).toBe("[menu.play]");
    expect(bare.direction).toBe("ltr");
  });

  it("gives a scene view the same text as plain data", () => {
    const data = stringTableData(VIEW, "pt-BR", { kind: "web", family: "serif" });
    expect(data).toEqual({
      locale: "pt-BR",
      direction: "ltr",
      font: { kind: "web", family: "serif" },
      strings: {
        "menu.play": "Jogar",
        "door.open": "Abrir",
        greet: "Hello, {name}.",
        "talk.hi": "Oi",
      },
    });
    expect(() => structuredClone(data)).not.toThrow();
  });

  it("builds a table over that data that reads what the view's table reads", () => {
    const data = stringTableData(VIEW, "ar", null);
    const table = stringTableOf(data);
    const fromView = stringTable(VIEW, "ar");
    expect([table.locale, table.direction]).toEqual([fromView.locale, fromView.direction]);
    for (const key of ["greet", "menu.play", "nope.missing"]) {
      expect(table.get(key, { name: "Ann" }), key).toBe(fromView.get(key, { name: "Ann" }));
      expect(table.has(key), key).toBe(fromView.has(key));
    }
  });

  it("looks a key up as its own text only, else brackets it", () => {
    const strings = { "menu.play": "Play" };
    expect(keyedText(strings, "menu.play")).toBe("Play");
    expect(keyedText(strings, "toString")).toBe(bracketKey("toString"));
    expect(keyedText(null, "menu.play")).toBe("[menu.play]");
    expect(keyedText(undefined, "menu.play")).toBe("[menu.play]");
  });
});

describe("localeDirection", () => {
  it("is rtl for the listed languages and their regions, ltr otherwise", () => {
    for (const l of ["ar", "fa", "he", "ur", "yi", "ps", "sd", "ug", "dv", "ckb"]) {
      expect(localeDirection(l), l).toBe("rtl");
      expect(localeDirection(`${l}-XX`), l).toBe("rtl");
    }
    expect(localeDirection("ar-EG")).toBe("rtl");
    expect(localeDirection("AR")).toBe("rtl");
    for (const l of ["en", "fr", "pt-BR", "ja", "zh-Hans", "arn", "her"])
      expect(localeDirection(l), l).toBe("ltr");
  });

  it("lets a script subtag decide", () => {
    expect(localeDirection("sd-Deva")).toBe("ltr");
    expect(localeDirection("pa-Arab")).toBe("rtl");
    expect(localeDirection("az-Arab-IR")).toBe("rtl");
  });
});

describe("resolveLocale", () => {
  const locales: LocaleSettings = { default: "en", available: ["en", "fr", "pt-BR"] };

  it("takes the saved preference first, when the game offers it", () => {
    expect(resolveLocale(locales, { saved: "fr", languages: ["pt-BR"] })).toBe("fr");
    expect(resolveLocale(locales, { saved: "FR" })).toBe("fr");
    expect(resolveLocale(locales, { saved: "de", languages: ["pt-BR"] })).toBe("pt-BR");
  });

  it("then the first browser language matching one, exactly or by language subtag", () => {
    expect(resolveLocale(locales, { languages: ["de-DE", "fr-CA", "en-US"] })).toBe("fr");
    expect(resolveLocale(locales, { languages: ["pt"] })).toBe("pt-BR");
    expect(resolveLocale(locales, { languages: ["en-GB", "fr"] })).toBe("en");
  });

  it("else the default; without settings, the engine's", () => {
    expect(resolveLocale(locales, { saved: null, languages: ["ja"] })).toBe("en");
    expect(resolveLocale({ default: "fr", available: [] }, {})).toBe("fr");
    expect(resolveLocale(null, { languages: ["fr"] })).toBe("en");
  });
});

const font = (id: string, coverage?: [number, number][]): HeldFile => {
  const sidecar: AssetSidecar = {
    kind: "asset-sidecar",
    v: 1,
    key: `key-${id}`,
    id,
    assetKind: "font",
    sha256: "f".repeat(64),
    bytes: 100,
    meta: coverage ? { format: "woff2", coverage } : { format: "woff2" },
  };
  return { path: `fonts/${id}.woff2`, sidecar };
};

/** `validateProject` over docs by path and font files. */
function validated(docs: Record<string, unknown>, fonts: HeldFile[] = []): SceneIssue[] {
  const held = heldDocs(docs);
  const registry = createRegistry();
  const { view, kinds } = heldProject([...held.files, ...fonts], registry, {
    projectId: "p",
    name: "P",
  });
  const texts = new Map<string, string>();
  for (const entry of view.byId.values()) {
    const text = held.texts.get(entry.path);
    if (text !== undefined) texts.set(entry.id, text);
  }
  return validateProject(view, texts, kinds, { registry, project: view });
}

const LATIN: [number, number][] = [
  [0x20, 0x7e],
  [0xa0, 0xff],
];

describe("the strings kind", () => {
  it("refuses a key outside the pattern", () => {
    const read = parseAssetDoc(
      stringsKind,
      JSON.stringify(strings([{ key: "Bad Key", en: "x" }])),
      { registry: createRegistry(), project: null },
    );
    expect(read.ok).toBe(false);
    expect(read.issues[0]).toMatchObject({ code: "schema", path: "/strings/0/key" });
  });

  it("refuses a key a file repeats, as every keyed collection does", () => {
    const read = parseAssetDoc(
      stringsKind,
      JSON.stringify(strings([{ key: "a", en: "1" }, { key: "b" }, { key: "a", en: "2" }])),
      { registry: createRegistry(), project: null },
    );
    expect(read.ok).toBe(false);
    expect(read.issues).toEqual([
      expect.objectContaining({ code: "dup-id", severity: "error", path: "/strings/2/key" }),
    ]);
  });

  it("warns dup-id on the later file by path for a key two files hold", () => {
    const issues = validated({
      "settings.json": settings({ default: "en", available: ["en"] }),
      "strings/b.json": strings([
        { key: "menu.play", en: "Start" },
        { key: "own", en: "x" },
      ]),
      "strings/a.json": strings([{ key: "menu.play", en: "Play" }]),
    });
    expect(issues).toEqual([
      expect.objectContaining({
        code: "dup-id",
        severity: "warn",
        entityIds: ["b"],
        path: "/strings/0/key",
        message: expect.stringContaining('strings "a"') as string,
      }),
    ]);
  });

  it("warns locale-unknown once per column outside the available locales", () => {
    const issues = validated({
      "settings.json": settings({ default: "en", available: ["en", "fr"] }),
      "strings/ui.json": strings([
        { key: "a", en: "A", note: "for translators" },
        { key: "b", en: "B", de: "B", fr: "B" },
        { key: "c", de: "C", ja: "C" },
      ]),
    });
    expect(issues.map((i) => [i.code, i.severity, i.path, i.got])).toEqual([
      ["locale-unknown", "warn", "/strings/1/de", "de"],
      ["locale-unknown", "warn", "/strings/2/ja", "ja"],
    ]);
  });

  it("offers only the engine's default locale without game settings", () => {
    const issues = validated({ "strings/ui.json": strings([{ key: "a", en: "A", fr: "A" }]) });
    expect(issues.map((i) => [i.code, i.got])).toEqual([["locale-unknown", "fr"]]);
  });

  it("warns font-missing when a locale's text uses a code point its font doesn't cover", () => {
    const issues = validated(
      {
        "settings.json": settings({
          default: "en",
          available: ["en", "ar", "fr"],
          fonts: { default: "latin", ar: "arabic" },
        }),
        "strings/ui.json": strings([
          { key: "greet", en: "Hello, {name}. [b]Hi[/b]", ar: "مرحبا، {name}.", fr: "Ça va‏\n" },
          { key: "omega", en: "Ω" },
        ]),
      },
      [font("latin", LATIN), font("arabic", [[0x20, 0x2e]])],
    );
    const missing = issues.filter((i) => i.code === "font-missing");
    expect(missing.map((i) => [i.severity, i.path, i.got])).toEqual([
      ["warn", "/strings/1/en", "latin"],
      ["warn", "/strings/0/ar", "arabic"],
      // fr shows the default's text where it has none, in the default font.
      ["warn", "/strings/1/en", "latin"],
    ]);
    expect(missing[0]!.message).toContain('U+03A9 "Ω"');
    expect(missing[1]!.message).toMatch(/locale "ar" shows 7 characters font "arabic"/);
    expect(missing[1]!.message).toContain('U+060C "،"');
  });

  it("checks the characters a malformed tag draws, and never a well-formed tag's or a placeholder's", () => {
    const issues = validated(
      {
        "settings.json": settings({ default: "en", available: ["en"], fonts: { en: "digits" } }),
        "strings/ui.json": strings([
          { key: "ok", en: "[b]1[/b] {name} [icon=ui:coin] \\[2" },
          { key: "bad", en: "[size=x]3" },
        ]),
      },
      [
        font("digits", [
          [0x20, 0x20],
          [0x30, 0x39],
          [0x5b, 0x5b],
        ]),
      ],
    );
    const missing = issues.filter((i) => i.code === "font-missing");
    expect(missing.map((i) => i.path)).toEqual(["/strings/1/en"]);
    expect(missing[0]!.message).toMatch(/shows 7 characters/);
    expect(missing[0]!.message).toContain('U+0073 "s"');
  });

  it("skips a font whose coverage wasn't read, and a project without fonts", () => {
    const docs = {
      "settings.json": settings({ default: "en", available: ["en"], fonts: { default: "f" } }),
      "strings/ui.json": strings([{ key: "omega", en: "Ω" }]),
    };
    expect(validated(docs, [font("f")])).toEqual([]);
    expect(validated(docs)).toEqual([]);
  });

  it("checks only a key's winning row", () => {
    const issues = validated(
      {
        "settings.json": settings({ default: "en", available: ["en"], fonts: { en: "latin" } }),
        "strings/a.json": strings([{ key: "k", en: "plain" }]),
        "strings/b.json": strings([{ key: "k", en: "Ω" }]),
      },
      [font("latin", LATIN)],
    );
    expect(issues.map((i) => i.code)).toEqual(["dup-id"]);
  });

  it("picks the locale's font, else the default's", () => {
    const locales: LocaleSettings = { ...LOCALES, fonts: { default: "base", ar: "naskh" } };
    expect(localeFont(locales, "ar")).toBe("naskh");
    expect(localeFont(locales, "fr")).toBe("base");
    expect(localeFont(LOCALES, "fr")).toBeUndefined();
  });
});

describe("string-key-missing from a scene's text blocks", () => {
  const sign = (id: string, key: string) => ({
    id,
    type: "marker",
    at: [1, 1],
    behaviors: { text: { key } },
  });
  const level = (entities: unknown[]) => ({
    v: 5,
    name: "level",
    bounds: [0, 0, 10, 10],
    settings: { physics: "none" },
    entities,
  });

  it("errs for the default locale and informs for the others", () => {
    const issues = validated({
      "settings.json": settings({ default: "en", available: ["en", "fr", "pt-BR"] }),
      "strings/ui.json": strings([
        { key: "sign.hi", en: "Hi", fr: "Salut" },
        { key: "sign.en", en: "Only English" },
      ]),
      "level.json": level([sign("a", "sign.hi"), sign("b", "sign.none"), sign("c", "sign.en")]),
    });
    const missing = issues.filter((i) => i.code === "string-key-missing");
    expect(missing.map((i) => [i.severity, i.path, i.got, i.entityIds[0]])).toEqual([
      ["info", "/entities/0/behaviors/text/key", "sign.hi", "level"],
      ["error", "/entities/1/behaviors/text/key", "sign.none", "level"],
      ["info", "/entities/2/behaviors/text/key", "sign.en", "level"],
    ]);
    expect(missing[0]!.message).toContain("pt-BR");
    expect(missing[1]!.message).toContain('default locale "en" nor in fr, pt-BR');
  });

  it("is silent when every locale has the text", () => {
    const issues = validated({
      "strings/ui.json": strings([{ key: "sign.hi", en: "Hi" }]),
      "level.json": level([sign("a", "sign.hi")]),
    });
    expect(issues.filter((i) => i.code === "string-key-missing")).toEqual([]);
  });
});

describe("game-settings' engine.locales", () => {
  const env = { registry: createRegistry(), project: null };
  const parse = (locales: unknown) =>
    parseAssetDoc(gameSettingsKind, JSON.stringify(settings(locales)), env);

  it("takes the default, available, fallback chains and fonts", () => {
    const read = parse({
      default: "en",
      available: ["en", "pt-BR", "pt"],
      fallback: { "pt-BR": ["pt"] },
      fonts: { default: "body-font", "pt-BR": "other-font" },
    });
    expect(read).toMatchObject({ ok: true, issues: [] });
  });

  it("refuses a tag that isn't BCP 47 and a font that isn't an asset id", () => {
    expect(parse({ default: "English", available: [] }).ok).toBe(false);
    expect(parse({ default: "en", available: ["en"], fonts: { en: "Bad Id" } }).ok).toBe(false);
    expect(parse({ default: "en", available: ["en"], fonts: { latin: "f" } }).ok).toBe(false);
  });

  it("names its fonts as references", () => {
    const file = settings({ default: "en", available: ["en"], fonts: { default: "f", en: "g" } });
    expect(gameSettingsKind.refs!(file as never, env)).toEqual([
      { pointer: "/engine/locales/fonts/default", id: "f", kinds: ["font"] },
      { pointer: "/engine/locales/fonts/en", id: "g", kinds: ["font"] },
    ]);
  });
});
