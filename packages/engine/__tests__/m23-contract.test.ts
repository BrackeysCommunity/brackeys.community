// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { synthDurationMs } from "../audio/synth";
import { SYNTH_PRESETS } from "../audio/synth-presets";
import { createGame } from "../engine";
import { AUDIO } from "../game/behaviors/audio";
import { TEXT } from "../game/behaviors/text";
import {
  DIALOGUE_ADVANCE_COMMAND,
  DIALOGUE_CHOOSE_COMMAND,
  LATENCY_COMMAND,
} from "../game/commands";
import { createRegistry } from "../game/define";
import type { GameCommand, GameDefinition } from "../game/types";
import { memoryPrefsStore } from "../prefs";
import { createKindRegistry, type DocKindDef } from "../project/kinds";
import { audioBuses } from "../project/kinds/sound";
import { SYNTH_BOUNDS, type SynthFile } from "../project/kinds/synth";
import { createSceneRuntime } from "../runtime/runtime";
import { checkCommand } from "../scene/input-script";
import { parseSceneOrThrow } from "../scene/parse";
import { SCENE_FORMAT_VERSION } from "../scene/types";
import engineYardJson from "../scenes/engine-yard.json";
import { createGameStore } from "../store";
import { emptyStringTable, localeDirection } from "../text/strings";
import type { GameInstance, RapierModule } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
import { testGame } from "./fixtures/test-game";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

const registry = createRegistry(testGame);

describe("the four kinds", () => {
  const kinds = createKindRegistry(null);

  it.each([
    ["sound", "view", { maxStateBytes: 32_768, maxItems: 64 }],
    ["synth", "view", { maxStateBytes: 4_096 }],
    ["dialogue", "sim", { maxStateBytes: 524_288, maxItems: 4_096 }],
    ["strings", "view", { maxStateBytes: 1_048_576, maxItems: 20_000 }],
  ] as const)(
    "%s: a %s runtime doc kind with its limits, matched by its json kind",
    (name, runtime, limits) => {
      const def = kinds.get(name) as DocKindDef | undefined;
      expect(def?.storage).toBe("doc");
      expect(def?.runtime).toBe(runtime);
      expect(def?.limits).toEqual(limits);
      expect(def?.match).toEqual({ jsonKind: name });
      expect(def?.schemaId).toBe(`urn:jams-engine:${name}:v1`);
    },
  );

  it("keys sound variants by clip, strings by key, and dialogue speakers and nodes by id", () => {
    const layout = (name: string) => (kinds.get(name) as DocKindDef).layout;
    expect(layout("sound")).toMatchObject({
      fields: { variants: { as: "keyed", id: "clip" }, on: { as: "list" } },
    });
    expect(layout("strings")).toMatchObject({ fields: { strings: { as: "keyed", id: "key" } } });
    expect(layout("dialogue")).toMatchObject({
      fields: {
        speakers: { as: "keyed" },
        nodes: { as: "keyed", item: { fields: { lines: { as: "list" } } } },
      },
    });
  });

  it("lists the engine's buses, then a game's own", () => {
    expect(audioBuses({ game: null })).toEqual(["master", "music", "sfx", "voice", "ui"]);
    const game = { ...testGame, audio: { buses: [{ name: "ambience" }, { name: "sfx" }] } };
    expect(audioBuses({ game })).toEqual(["master", "music", "sfx", "voice", "ui", "ambience"]);
  });

  it("bounds a patch to 5 s, and measures its length without rendering", () => {
    const longest = SYNTH_BOUNDS.attackMs[1] + SYNTH_BOUNDS.sustainMs[1] + SYNTH_BOUNDS.decayMs[1];
    expect(longest).toBe(5_000);
    const patch: SynthFile = {
      kind: "synth",
      v: 1,
      wave: "square",
      freq: 880,
      sustainMs: 60,
      decayMs: 240,
    };
    expect(synthDurationMs(patch)).toBe(300);
    expect(synthDurationMs({ ...patch, attackMs: 10 })).toBe(310);
    expect(SYNTH_PRESETS).toContain("pickup");
  });
});

describe("the two behaviors", () => {
  it("registers text and audio after emitter, visual only", () => {
    const names = registry.behaviorNames;
    expect(names.slice(names.indexOf("emitter"), names.indexOf("emitter") + 3)).toEqual([
      "emitter",
      "text",
      "audio",
    ]);
    expect(TEXT.visualOnly).toBe(true);
    expect(AUDIO.visualOnly).toBe(true);
  });
});

describe("the three engine commands", () => {
  const check = (command: GameCommand) => checkCommand(registry, command).ok;

  it("parses @latency within ±500 ms", () => {
    expect(check({ name: LATENCY_COMMAND, args: { ms: -40 } })).toBe(true);
    expect(check({ name: LATENCY_COMMAND, args: { ms: 501 } })).toBe(false);
    expect(check({ name: LATENCY_COMMAND, args: { ms: 1.5 } })).toBe(false);
  });

  it("parses @dialogue-advance with no args and @dialogue-choose with a choice index", () => {
    expect(check({ name: DIALOGUE_ADVANCE_COMMAND })).toBe(true);
    expect(check({ name: DIALOGUE_ADVANCE_COMMAND, args: { choice: 0 } })).toBe(false);
    expect(check({ name: DIALOGUE_CHOOSE_COMMAND, args: { choice: 0 } })).toBe(true);
    expect(check({ name: DIALOGUE_CHOOSE_COMMAND, args: { choice: -1 } })).toBe(false);
  });
});

describe("ctx.dialogue in a fresh runtime", () => {
  it("has no view, and ignores the dialogue commands a tick carries", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, game: null });
    expect(rt.ctx.dialogue.view()).toBeNull();
    const report = rt.load({
      v: SCENE_FORMAT_VERSION,
      name: "empty",
      bounds: [0, 0, 10, 10],
      settings: { physics: "none", gravity: [0, 0] },
      entities: [],
    } as never);
    expect(report.ok).toBe(true);
    rt.step(
      rt.ctx.time.tickMs,
      [],
      [{ name: DIALOGUE_ADVANCE_COMMAND }, { name: DIALOGUE_CHOOSE_COMMAND, args: { choice: 0 } }],
    );
    expect(rt.ctx.dialogue.view()).toBeNull();
    expect(rt.ctx.input.latencyMs()).toBe(0);
    rt.destroy();
  });
});

describe("the stores and tables", () => {
  it("starts the store with no dialogue", () => {
    expect(createGameStore().state.dialogue).toBeNull();
  });

  it("brackets every key in an empty table, with the locale's direction", () => {
    const table = emptyStringTable("ar-EG");
    expect(table.get("intro.hello")).toBe("[intro.hello]");
    expect(table.has("intro.hello")).toBe(false);
    expect(table.direction).toBe("rtl");
    expect(localeDirection("en")).toBe("ltr");
  });

  it("keeps preferences per game in memory", () => {
    const prefs = memoryPrefsStore();
    prefs.save("a", { "audio.music": 0.5 });
    expect(prefs.load("a")).toEqual({ "audio.music": 0.5 });
    expect(prefs.load("b")).toEqual({});
  });
});

describe("the shell", () => {
  let rapier: RapierModule;
  let canvas: HTMLCanvasElement;
  const games: GameInstance[] = [];

  beforeAll(async () => {
    rapier = await loadCompatRapier();
  });
  beforeEach(() => {
    canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    for (const g of games.splice(0)) g.destroy();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  async function makeGame(game: GameDefinition = testGame): Promise<GameInstance> {
    const instance = await createGame(canvas, {
      game,
      rapier: async () => rapier,
      scene: parseSceneOrThrow(engineYardJson, createRegistry(game)),
    });
    games.push(instance);
    return instance;
  }

  it("has no audio, the default locale with a bracketing table, and no calibration", async () => {
    const game = await makeGame();
    expect(game.audio).toBeNull();
    expect(game.locale.current()).toBe("en");
    expect(game.locale.available()).toEqual(["en"]);
    expect(game.locale.strings().get("menu.start")).toBe("[menu.start]");
    game.locale.set("fr");
    expect(game.locale.current()).toBe("en");
    await expect(game.calibrateLatency()).resolves.toBeNull();
    expect(game.getStore().state.dialogue).toBeNull();
  });

  it("delivers @latency with the next tick and never wakes a turns game for it", async () => {
    let pending: FrameRequestCallback[] = [];
    let now = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => pending.push(cb));
    const wall = (ms: number) => {
      for (let t = 0; t < ms; t += 1000 / 120) {
        now += 1000 / 120;
        const due = pending;
        pending = [];
        for (const cb of due) cb(now);
      }
    };
    const delivered: GameCommand[][] = [];
    const def: GameDefinition = {
      ...testGame,
      time: { kind: "turns", rate: 30 },
      commands: { wait: { description: "Takes no args." } },
      createRuntime(ctx) {
        const base = testGame.createRuntime(ctx);
        return {
          ...base,
          beforeStep(dtMs, actions, commands) {
            delivered.push([...commands]);
            base.beforeStep?.(dtMs, actions, commands);
          },
        };
      },
    };
    const game = await makeGame(def);
    game.start();
    expect(game.play(parseSceneOrThrow(engineYardJson, game.registry)).ok).toBe(true);
    expect(game.send({ name: LATENCY_COMMAND, args: { ms: 30 } })).toBe(true);
    wall(1000);
    expect(delivered).toEqual([]);
    expect(game.send({ name: "wait" })).toBe(true);
    wall(1000);
    expect(delivered).toEqual([[{ name: LATENCY_COMMAND, args: { ms: 30 } }, { name: "wait" }]]);
  });
});
