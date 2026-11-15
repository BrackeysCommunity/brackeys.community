import { describe, expect, it } from "vite-plus/test";

import { docLookup, type DocLookup } from "../kinds/define";
import { prefabKind } from "../kinds/prefab";
import { soundKind } from "../kinds/sound";
import {
  DEFAULT_LOCALE,
  localeChain,
  localeFallbacks,
  localeSettingsOf,
  mergedStrings,
  missingStringKeys,
  projectLocales,
  stringKeysIn,
  stringLocales,
  stringRowText,
  usedStringKeys,
  type LocaleSettings,
  type StringKeyUse,
} from "../kinds/strings";
import type { AssetId, AssetKindName } from "../types";

const LOCALES: LocaleSettings = {
  default: "en",
  available: ["en", "fr", "pt", "pt-BR"],
  fallback: { "pt-BR": ["pt"] },
};

/** A project's parsed docs by kind, each kind's ids in path order. */
const FIXTURE: Record<AssetKindName, Record<AssetId, unknown>> = {
  "game-settings": {
    settings: { kind: "game-settings", v: 2, engine: { locales: LOCALES }, game: {} },
  },
  strings: {
    // "a-common" sorts first by path: its rows win.
    "a-common": {
      kind: "strings",
      v: 1,
      strings: [
        { key: "menu.play", en: "Play", fr: "Jouer", pt: "Jogar" },
        { key: "door.open", en: "Open", "pt-BR": "Abrir" },
      ],
    },
    "b-dialogue": {
      kind: "strings",
      v: 1,
      strings: [
        { key: "menu.play", en: "Start", ar: "ابدأ" },
        { key: "talk.hi", en: "Hi", fr: "Salut", pt: "" },
        { key: "talk.name", en: "Guide", note: "The speaker." },
        { key: "door.shut", en: "Shut", fr: "Fermé" },
      ],
    },
  },
  dialogue: {
    chat: {
      kind: "dialogue",
      v: 1,
      start: "a",
      speakers: [{ id: "guide", name: "talk.name" }],
      nodes: [
        {
          id: "a",
          lines: [{ speaker: "guide", text: "talk.hi" }, { say: "Literal." }],
          choices: [
            { text: "menu.play", to: "b" },
            { say: "Literal too.", to: "b" },
          ],
        },
        { id: "b", lines: [{ text: "talk.gone" }], end: "done" },
      ],
    },
  },
  sound: {
    knock: { kind: "sound", v: 1, bus: "sfx", variants: [], caption: "door.knock" },
    quiet: { kind: "sound", v: 1, bus: "sfx", variants: [] },
  },
  prefab: {
    door: {
      kind: "prefab",
      v: 5,
      id: "door",
      params: {
        label: {
          description: "What the sign says.",
          targets: ["sign.behaviors.text.key"],
          map: { "sign.behaviors.text.key": { shut: "door.shut" } },
        },
      },
      entities: [
        { id: "sign", type: "marker", at: [0, 0], behaviors: { text: { key: "door.open" } } },
      ],
    },
    "big-door": {
      kind: "prefab",
      v: 5,
      id: "big-door",
      base: "door",
      overrides: { "sign.behaviors.text.key": "door.big" },
      entities: [],
    },
  },
  scene: {
    hall: {
      v: 5,
      name: "hall",
      bounds: [0, 0, 10, 10],
      entities: [
        { id: "title", type: "marker", at: [1, 1], behaviors: { text: { key: "menu.play" } } },
        { id: "plain", type: "marker", at: [2, 1], behaviors: { text: { text: "Literal." } } },
        { id: "bare", type: "marker", at: [3, 1] },
      ],
      instances: [
        {
          id: "door-1",
          prefab: "door",
          at: [4, 4],
          overrides: {
            "sign.behaviors.text": { key: "door.left" },
            "sign.behaviors": { text: { key: "door.right" } },
            "sign.tags": ["x"],
          },
        },
        { id: "door-2", prefab: "big-door", at: [6, 4], params: { label: "shut" } },
        { id: "door-3", prefab: "door", at: [8, 4], params: { label: "door.odd" } },
      ],
    },
  },
};

function fixture(docs = FIXTURE): DocLookup {
  const byKind = new Map<AssetKindName, Map<AssetId, unknown>>();
  for (const [kind, ofKind] of Object.entries(docs))
    byKind.set(kind, new Map(Object.entries(ofKind)));
  return docLookup(byKind);
}

const keys = (uses: readonly StringKeyUse[]) => uses.map((u) => u.key);

describe("locale settings", () => {
  it("reads engine.locales, the default always available, and defaults without it", () => {
    expect(projectLocales(fixture())).toEqual(LOCALES);
    expect(projectLocales(fixture({}))).toEqual({
      default: DEFAULT_LOCALE,
      available: [DEFAULT_LOCALE],
    });
    expect(localeSettingsOf({ default: "fr", available: ["de", 3, "fr"] })).toEqual({
      default: "fr",
      available: ["fr", "de"],
    });
    expect(localeSettingsOf("not a block")).toEqual({ default: "en", available: ["en"] });
  });

  it("chains a locale through its fallbacks, then the default", () => {
    expect(localeFallbacks(LOCALES, "pt-BR")).toEqual(["pt-BR", "pt"]);
    expect(localeChain(LOCALES, "pt-BR")).toEqual(["pt-BR", "pt", "en"]);
    expect(localeChain(LOCALES, "en")).toEqual(["en"]);
    expect(localeChain(LOCALES, "fr")).toEqual(["fr", "en"]);
  });

  it("takes a row's first non-empty text along a chain", () => {
    const row = { key: "talk.hi", en: "Hi", pt: "", note: "never text" };
    expect(stringRowText(row, ["pt", "en"])).toBe("Hi");
    expect(stringRowText(row, ["pt"])).toBeUndefined();
    expect(stringRowText(row, ["note"])).toBeUndefined();
  });
});

describe("merged strings", () => {
  it("keeps a key's first row by path", () => {
    const merged = mergedStrings(fixture());
    expect([...merged.keys()]).toEqual([
      "menu.play",
      "door.open",
      "talk.hi",
      "talk.name",
      "door.shut",
    ]);
    expect(merged.get("menu.play")).toMatchObject({ id: "a-common", index: 0 });
    expect(merged.get("talk.hi")).toMatchObject({ id: "b-dialogue", index: 1 });
  });

  it("speaks the available locales, then every other column, a losing row's too", () => {
    expect(stringLocales(fixture(), LOCALES)).toEqual(["en", "fr", "pt", "pt-BR", "ar"]);
  });
});

describe("used string keys", () => {
  it("collects dialogue, prefab, scene and sound keys with their pointers", () => {
    expect(usedStringKeys(fixture())).toEqual([
      { key: "talk.name", kind: "dialogue", id: "chat", pointer: "/speakers/@guide/name" },
      { key: "talk.hi", kind: "dialogue", id: "chat", pointer: "/nodes/@a/lines/0/text" },
      { key: "menu.play", kind: "dialogue", id: "chat", pointer: "/nodes/@a/choices/0/text" },
      { key: "talk.gone", kind: "dialogue", id: "chat", pointer: "/nodes/@b/lines/0/text" },
      {
        key: "door.open",
        kind: "prefab",
        id: "door",
        pointer: "/entities/@sign/behaviors/text/key",
      },
      {
        key: "door.big",
        kind: "prefab",
        id: "big-door",
        pointer: "/overrides/sign.behaviors.text.key",
      },
      {
        key: "menu.play",
        kind: "scene",
        id: "hall",
        pointer: "/entities/@title/behaviors/text/key",
      },
      {
        key: "door.left",
        kind: "scene",
        id: "hall",
        pointer: "/instances/@door-1/overrides/sign.behaviors.text/key",
      },
      {
        key: "door.right",
        kind: "scene",
        id: "hall",
        pointer: "/instances/@door-1/overrides/sign.behaviors/text/key",
      },
      // A variant's params are its base's; a mapped value takes the map's key.
      { key: "door.shut", kind: "scene", id: "hall", pointer: "/instances/@door-2/params/label" },
      { key: "door.odd", kind: "scene", id: "hall", pointer: "/instances/@door-3/params/label" },
      { key: "door.knock", kind: "sound", id: "knock", pointer: "/caption" },
    ]);
  });

  it("reads given scenes in place of the lookup's", () => {
    const unsaved = new Map([
      ["hall", { v: 5, entities: [{ id: "t", behaviors: { text: { key: "menu.quit" } } }] }],
    ]);
    const scene = usedStringKeys(fixture(), unsaved).filter((u) => u.kind === "scene");
    expect(keys(scene)).toEqual(["menu.quit"]);
  });

  it("reads one doc, and nothing from a doc that isn't an object", () => {
    expect(keys(stringKeysIn("sound", "knock", FIXTURE.sound!.knock))).toEqual(["door.knock"]);
    expect(stringKeysIn("dialogue", "x", null)).toEqual([]);
    expect(stringKeysIn("material", "x", { caption: "menu.play" })).toEqual([]);
  });
});

describe("missing string keys", () => {
  it("lists the default's uses with no row or no text", () => {
    expect(keys(missingStringKeys(fixture(), LOCALES, "en"))).toEqual([
      "talk.gone",
      "door.big",
      "door.left",
      "door.right",
      "door.odd",
      "door.knock",
    ]);
  });

  it("doesn't count the default's text for another locale", () => {
    expect(keys(missingStringKeys(fixture(), LOCALES, "fr"))).toEqual([
      "talk.name",
      "talk.gone",
      "door.open",
      "door.big",
      "door.left",
      "door.right",
      "door.odd",
      "door.knock",
    ]);
  });

  it("counts a locale's fallback chain, and an empty text as none", () => {
    const pt = keys(missingStringKeys(fixture(), LOCALES, "pt"));
    expect(pt).toContain("talk.hi");
    expect(pt).not.toContain("menu.play");
    const ptBr = keys(missingStringKeys(fixture(), LOCALES, "pt-BR"));
    expect(ptBr).not.toContain("menu.play");
    expect(ptBr).not.toContain("door.open");
    expect(ptBr).toContain("talk.hi");
  });

  it("checks the uses it's given, as a doc's crossValidate passes its own", () => {
    const own = stringKeysIn("sound", "knock", FIXTURE.sound!.knock);
    expect(missingStringKeys(fixture(), LOCALES, "en", own)).toEqual(own);
    const lines = stringKeysIn("dialogue", "chat", FIXTURE.dialogue!.chat);
    expect(keys(missingStringKeys(fixture(), LOCALES, "en", lines))).toEqual(["talk.gone"]);
  });

  it("is raised by a sound's caption and a prefab's text keys through the same rule", () => {
    const lookup = fixture();
    const brief = (issues: readonly { severity: string; path?: string; got?: unknown }[]) =>
      issues.map((i) => [i.severity, i.path, i.got]);
    expect(brief(soundKind.crossValidate!(FIXTURE.sound!.knock as never, lookup))).toEqual([
      ["error", "/caption", "door.knock"],
    ]);
    expect(brief(soundKind.crossValidate!(FIXTURE.sound!.quiet as never, lookup))).toEqual([]);
    expect(brief(prefabKind.crossValidate!(FIXTURE.prefab!.door as never, lookup))).toEqual([
      ["info", "/entities/0/behaviors/text/key", "door.open"],
    ]);
  });
});
