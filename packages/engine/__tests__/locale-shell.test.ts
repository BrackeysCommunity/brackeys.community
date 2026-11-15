// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { defineGame } from "../game/define";
import type { EngineContext, GameDefinition } from "../game/types";
import { memoryPrefsStore, PREF_KEYS, type PrefsStore } from "../prefs";
import { createKindRegistry } from "../project/kinds";
import type { ProjectRuntimeView } from "../project/runtime-view";
import { projectView } from "../project/view";
import type { PixiView } from "../render/pixi-view";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../scene/types";
import type { StringTableData } from "../text/strings";
import type { GameConfig, GameInstance } from "../types";
import { onLocale } from "../ui/bind";
import { manualFrames, type FrameClock } from "./fixtures/frame-clock";

/** Every table the shell handed a scene view, in order. */
const handed = vi.hoisted(() => [] as StringTableData[]);

vi.mock("../render/pixi-view", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../render/pixi-view")>();
  return {
    ...actual,
    createPixiView: (...args: Parameters<typeof actual.createPixiView>): PixiView => {
      const view = actual.createPixiView(...args);
      const locale = view.locale?.bind(view);
      view.locale = (table) => {
        handed.push(table);
        locale?.(table);
      };
      return view;
    },
  };
});

vi.mock("../renderer", async () => (await import("./fixtures/frame-clock")).stubRenderer());

const STRINGS = {
  kind: "strings",
  v: 1,
  strings: [
    { key: "sign.hello", en: "Hello", fr: "Bonjour", "pt-BR": "Olá" },
    { key: "sign.bye", en: "Bye" },
  ],
};

const project: ProjectRuntimeView = {
  settings: {},
  engine: { locales: { default: "en", available: ["en", "fr", "pt-BR"] } },
  table: () => [],
  asset: () => undefined,
  inputMap: null,
  doc: <T>(kind: string, id: string): T | undefined =>
    kind === "strings" && id === "signs" ? (STRINGS as T) : undefined,
  docs: (kind) => (kind === "strings" ? ["signs"] : []),
};

/** Counts its ticks into the snapshot; nothing it does reads the locale. */
const counter: GameDefinition<{ n: number }> = defineGame({
  id: "counter",
  types: [],
  actions: [],
  world: { physics: "none" },
  time: { kind: "fixed", rate: 60 },
  createRuntime(ctx: EngineContext) {
    let n = 0;
    return {
      afterStep() {
        n += ctx.tick;
      },
      snapshot: () => ({ n }),
      restore: (state) => {
        n = state.n;
      },
    };
  },
});

const doc: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: "counter",
  name: "counter",
  bounds: [0, 0, 40, 20],
  settings: { physics: "none" },
  entities: [{ id: "post", type: "marker", at: [5, 5] }],
};

const games: GameInstance[] = [];
let frames: FrameClock;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  frames = manualFrames({ timers: true });
  document.body.appendChild(document.createElement("canvas"));
  handed.length = 0;
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stubLanguages(languages: readonly string[]): void {
  vi.stubGlobal("navigator", { ...navigator, languages });
}

async function makeGame(
  prefs: PrefsStore,
  config: Partial<GameConfig> = {},
): Promise<GameInstance> {
  const game = await createGame(document.querySelector("canvas")!, {
    game: counter as GameDefinition,
    project,
    audio: { backend: false, prefs },
    ...config,
  });
  games.push(game);
  return game;
}

describe("the initial locale", () => {
  it("is the first of navigator.languages the project offers, by language subtag", async () => {
    stubLanguages(["de-DE", "fr-CA", "en"]);
    const game = await makeGame(memoryPrefsStore());
    expect(game.locale.current()).toBe("fr");
    expect(game.locale.available()).toEqual(["en", "fr", "pt-BR"]);
  });

  it("is the saved preference over the browser's languages", async () => {
    stubLanguages(["fr"]);
    const prefs = memoryPrefsStore();
    prefs.save("counter", { locale: "pt-BR" });
    const game = await makeGame(prefs);
    expect(game.locale.current()).toBe("pt-BR");
    expect(game.locale.strings().get("sign.hello")).toBe("Olá");
  });

  it("is the default when nothing matches", async () => {
    stubLanguages(["ja-JP"]);
    const game = await makeGame(memoryPrefsStore());
    expect(game.locale.current()).toBe("en");
  });
});

describe("locale.set", () => {
  it("saves the locale, raises locale:change and hands the view the new table as data", async () => {
    stubLanguages(["en"]);
    const prefs = memoryPrefsStore();
    prefs.save("counter", { [PREF_KEYS.busKey("music")]: { volume: 0.5, muted: false } });
    const game = await makeGame(prefs, { scene: doc });
    const changes: { from: string; to: string }[] = [];
    game.on("locale:change", (e) => changes.push(e));
    expect(handed.at(-1)).toMatchObject({ locale: "en", strings: { "sign.hello": "Hello" } });
    const before = handed.length;

    game.locale.set("fr");
    expect(changes).toEqual([{ from: "en", to: "fr" }]);
    expect(prefs.load("counter")).toEqual({
      [PREF_KEYS.busKey("music")]: { volume: 0.5, muted: false },
      [PREF_KEYS.locale]: "fr",
    });
    expect(handed.slice(before)).toEqual([
      {
        locale: "fr",
        direction: "ltr",
        // A key with no French text falls back to the default's.
        strings: { "sign.hello": "Bonjour", "sign.bye": "Bye" },
        font: null,
      },
    ]);
    expect(game.locale.current()).toBe("fr");
    expect(game.locale.strings().get("sign.hello")).toBe("Bonjour");
    expect(game.locale.strings().locale).toBe("fr");

    game.locale.set("fr");
    expect(changes).toHaveLength(1);
    expect(handed.length).toBe(before + 1);
  });

  it("reaches onLocale's listeners on the game or a UI context's game, until they unsubscribe", async () => {
    stubLanguages(["en"]);
    const game = await makeGame(memoryPrefsStore(), { scene: doc });
    const direct = vi.fn();
    const viaContext = vi.fn();
    const stopDirect = onLocale(game, direct);
    const stopContext = onLocale({ game }, viaContext);
    game.locale.set("fr");
    expect([direct.mock.calls.length, viaContext.mock.calls.length]).toEqual([1, 1]);
    stopDirect();
    stopContext();
    game.locale.set("en");
    expect([direct.mock.calls.length, viaContext.mock.calls.length]).toEqual([1, 1]);
  });

  it("draws a locale whose font is empty or inherited in the default's, as the font check reads it", async () => {
    stubLanguages(["en"]);
    const fonted: ProjectRuntimeView = {
      ...project,
      engine: {
        locales: {
          default: "en",
          available: ["en", "fr", "constructor"],
          fonts: { default: "body", fr: "" },
        },
      },
      asset: (id) =>
        id === "body"
          ? { id, kind: "font", sha256: "b0d1", font: { format: "woff2" as const } }
          : undefined,
    };
    const game = await makeGame(memoryPrefsStore(), {
      scene: doc,
      ...({ project: fonted } as Partial<GameConfig>),
    });
    expect(handed.at(-1)).toMatchObject({ locale: "en", font: { kind: "web", family: "b0d1" } });
    game.locale.set("fr");
    expect(handed.at(-1)).toMatchObject({ locale: "fr", font: { kind: "web", family: "b0d1" } });
    game.locale.set("constructor");
    expect(handed.at(-1)).toMatchObject({
      locale: "constructor",
      font: { kind: "web", family: "b0d1" },
    });
  });

  it("refuses a locale the project doesn't offer", async () => {
    stubLanguages(["en"]);
    const prefs = memoryPrefsStore();
    const game = await makeGame(prefs, { scene: doc });
    const changes: unknown[] = [];
    game.on("locale:change", (e) => changes.push(e));
    game.locale.set("de");
    expect(game.locale.current()).toBe("en");
    expect(changes).toEqual([]);
    expect(prefs.load("counter")).toEqual({});
  });

  it("never changes a digest", async () => {
    stubLanguages(["en"]);
    const run = async (switching: boolean) => {
      const game = await makeGame(memoryPrefsStore());
      let changes = 0;
      game.on("locale:change", () => changes++);
      game.start();
      expect(game.play(doc)).toMatchObject({ ok: true });
      const tick = () => game.getStore().state.tick;
      for (let i = 0; i < 30; i++) {
        if (switching && i % 10 === 5) game.locale.set(i % 20 === 5 ? "fr" : "pt-BR");
        const next = tick() + 1;
        for (let ms = 0; tick() < next && ms < 1000; ms++) frames.advance(1);
      }
      game.stop();
      expect(changes).toBe(switching ? 3 : 0);
      return game.recording()!;
    };
    const plain = await run(false);
    const switched = await run(true);
    expect(switched.ticks).toBe(plain.ticks);
    expect(switched.end).toBe(plain.end);
    expect(switched.inputs).toEqual(plain.inputs);
  });
});

describe("a project edit", () => {
  const view = projectView(
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: {},
      history: {},
      code: {},
      build: {},
    },
    createKindRegistry(counter as GameDefinition),
  );
  const offering = (available: string[]): ProjectRuntimeView => ({
    ...project,
    engine: { locales: { default: "en", available } },
  });

  it("that drops the locale in use raises locale:change and hands the view the new one's table", async () => {
    stubLanguages(["fr"]);
    const game = await makeGame(memoryPrefsStore(), { scene: doc });
    expect(game.locale.current()).toBe("fr");
    const changes: { from: string; to: string }[] = [];
    game.on("locale:change", (e) => changes.push(e));
    const heard = vi.fn();
    onLocale(game, heard);

    await game.reloadAssets({ project: offering(["en", "pt-BR"]), view, changed: [] });
    expect(changes).toEqual([{ from: "fr", to: "en" }]);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(game.locale.current()).toBe("en");
    expect(handed.at(-1)).toMatchObject({ locale: "en", strings: { "sign.hello": "Hello" } });
    expect(game.locale.strings().get("sign.hello")).toBe("Hello");
  });

  it("that keeps the locale in use raises nothing", async () => {
    stubLanguages(["fr"]);
    const game = await makeGame(memoryPrefsStore(), { scene: doc });
    expect(game.locale.current()).toBe("fr");
    const changes: unknown[] = [];
    game.on("locale:change", (e) => changes.push(e));
    await game.reloadAssets({ project: offering(["fr", "en"]), view, changed: [] });
    expect(changes).toEqual([]);
    expect(game.locale.current()).toBe("fr");
    expect(handed.at(-1)).toMatchObject({ locale: "fr" });
  });
});
