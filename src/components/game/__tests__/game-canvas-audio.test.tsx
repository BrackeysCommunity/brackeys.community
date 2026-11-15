// @vitest-environment jsdom
import type { GameInstance, UiContext } from "@jams/engine";
import { defineGame } from "@jams/engine/game";
import type { FakeAudioBackend } from "@jams/engine/headless";
import { SCENE_FORMAT_VERSION } from "@jams/engine/scene";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { hostedGamesFrom, type HostedGame, type HostedGameGlobs } from "../hosted-games";

/** The games the room built and the backends it asked for, in order. */
const made = vi.hoisted(() => ({
  games: [] as GameInstance[],
  backends: [] as FakeAudioBackend[],
  /** Whether the stand-in for `tryWebAudioBackend` finds no Web Audio, as a browser without it does. */
  noWebAudio: false,
  hosted: null as HostedGame | null,
  flags: {} as Record<string, boolean>,
}));

vi.mock("@/lib/hooks/use-flag", () => ({
  useFlag: (flag: string) => made.flags[flag] ?? false,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/canvas/shell/SiteMenu", () => ({ SiteMenu: () => <nav>site menu</nav> }));
vi.mock("../editor-host", () => ({ SiteSceneEditor: () => <div>package editor</div> }));
vi.mock("@jams/engine/debug", () => ({
  createDebugOverlay: () => ({ setPhysics() {}, update() {}, destroy() {} }),
}));

// The shell's Pixi renderer, stood in for so the shell runs under jsdom.
vi.mock("../../../../packages/engine/renderer", () => ({
  createRenderer: async () => {
    const stage = new Container();
    const worldContainer = new Container();
    const uiContainer = new Container();
    stage.addChild(worldContainer, uiContainer);
    return {
      app: { stage, renderer: { resolution: 1, render() {} } },
      worldContainer,
      uiContainer,
      resize: () => {},
      destroy: () => {},
    };
  },
}));

vi.mock("@jams/engine", async (original) => {
  const real = await original<typeof import("@jams/engine")>();
  const { fakeAudioBackend } = await import("@jams/engine/headless");
  return {
    ...real,
    createGame: async (...args: Parameters<typeof real.createGame>) => {
      const game = await real.createGame(...args);
      made.games.push(game);
      return game;
    },
    tryWebAudioBackend: () => {
      if (made.noWebAudio) return false;
      const backend = fakeAudioBackend();
      made.backends.push(backend);
      return backend;
    },
  };
});

vi.mock("../hosted-games", async (original) => {
  const real = await original<typeof import("../hosted-games")>();
  return {
    ...real,
    hostedGame: (id: string) => (id === "chime" ? made.hosted : real.hostedGame(id)),
  };
});

const { GameCanvas } = await import("../GameCanvas");
const { createDialogueBox } = await import("@jams/engine");

/** A game that asks for its chime every tick. */
const chimeGame = defineGame({
  id: "chime",
  types: [],
  actions: [],
  world: { physics: "none" },
  time: { kind: "fixed", rate: 60 },
  createRuntime(ctx) {
    return {
      afterStep() {
        ctx.present.audio.play("chime");
      },
      snapshot: () => null,
    };
  },
});

/** What the game's UI module saw when it mounted. */
const mounted = { greeting: null as string | null };

function mountChimeUi(ctx: UiContext) {
  mounted.greeting = ctx.strings().get("greeting");
  return createDialogueBox(ctx);
}

const doc = (value: unknown) => vi.fn(async () => ({ default: value }));
const sidecar = (id: string) => doc({ kind: "asset-sidecar", v: 1, key: `k-${id}`, id });

/** The chime project as the site's globs find it: a scene, a synth-patch sound, strings in two locales and a UI. */
const globs: HostedGameGlobs = {
  projects: {
    "/src/games/chime/jams.project.json": {
      kind: "project",
      v: 1,
      id: "chime",
      name: "Chime",
      game: { module: "./index.ts", export: "chimeGame" },
      ui: { module: "./ui/index.ts", export: "mountChimeUi" },
    },
  },
  games: { "/src/games/chime/index.ts": async () => ({ chimeGame }) },
  uis: { "/src/games/chime/ui/index.ts": async () => ({ mountChimeUi }) },
  scenes: {
    "/src/games/chime/scenes/hall.json": doc({
      v: SCENE_FORMAT_VERSION,
      name: "hall",
      bounds: [0, 0, 20, 10],
      settings: { physics: "none" },
      entities: [],
    }),
  },
  prefabs: {},
  docs: {
    "/src/games/chime/game-settings.json": doc({
      kind: "game-settings",
      v: 2,
      engine: { locales: { default: "en", available: ["en", "fr"] } },
      game: {},
    }),
    "/src/games/chime/scene-list.json": doc({
      kind: "scene-list",
      v: 1,
      start: "hall",
      scenes: [{ scene: "hall" }],
    }),
    "/src/games/chime/audio/chime.sound.json": doc({
      kind: "sound",
      v: 1,
      bus: "sfx",
      variants: [{ clip: "chime-patch" }],
    }),
    "/src/games/chime/audio/chime.synth.json": doc({
      kind: "synth",
      v: 1,
      wave: "sine",
      freq: 880,
      sustainMs: 40,
      decayMs: 60,
    }),
    "/src/games/chime/text/chime.strings.json": doc({
      kind: "strings",
      v: 1,
      strings: [{ key: "greeting", en: "Hello", fr: "Bonjour" }],
    }),
  },
  sidecars: {
    "/src/games/chime/scenes/hall.json.asset.json": sidecar("hall"),
    "/src/games/chime/audio/chime.sound.json.asset.json": sidecar("chime"),
    "/src/games/chime/audio/chime.synth.json.asset.json": sidecar("chime-patch"),
    "/src/games/chime/text/chime.strings.json.asset.json": sidecar("chime-strings"),
  },
};

const PREFS_KEY = "jams-engine:prefs:chime";

beforeEach(() => {
  made.games.length = 0;
  made.backends.length = 0;
  made.noWebAudio = false;
  made.flags = {};
  mounted.greeting = null;
  [made.hosted] = hostedGamesFrom(globs, vi.fn());
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** Renders the room and waits for its game to reach Play in the hall. */
async function playing(): Promise<{ game: GameInstance; canvas: HTMLCanvasElement }> {
  const { container } = render(<GameCanvas roomId="lobby-1" gameId="chime" />);
  await waitFor(() => expect(made.games[0]?.getMode()).toBe("play"), { timeout: 10_000 });
  const canvas = container.querySelector("canvas");
  if (!canvas) throw new Error("no canvas");
  return { game: made.games[0]!, canvas };
}

const plays = (backend: FakeAudioBackend) => backend.log.filter((c) => c.op === "play");

describe("GameCanvas audio", () => {
  it("builds the Web Audio backend when Play starts, and plays once a gesture unlocks it", async () => {
    const { game, canvas } = await playing();
    game.step(3);
    expect(made.backends).toHaveLength(1);
    const [backend] = made.backends;
    expect(backend!.state).toBe("locked");
    expect(plays(backend!)).toEqual([]);

    canvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 4, clientY: 4 }));
    await waitFor(() => expect(game.audio?.unlocked).toBe(true));
    game.step(2);
    expect(plays(backend!).length).toBeGreaterThan(0);
    expect(plays(backend!)[0]!.opts.bus).toBe("sfx");

    cleanup();
    expect(backend!.log.filter((c) => c.op === "close")).toHaveLength(1);
  }, 20_000);

  it("reads the player's saved bus volumes", async () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        "audio.bus.sfx": { volume: 0.5, muted: false },
        "audio.bus.music": { volume: 0.25, muted: true },
      }),
    );
    const { game } = await playing();
    game.step(1);
    const [backend] = made.backends;
    expect(backend!.busVolumes.get("sfx")).toBe(0.5);
    expect(backend!.busVolumes.get("music")).toBe(0);
    expect(game.audio?.buses().music).toEqual({ volume: 0.25, muted: true });

    game.audio?.setBus("sfx", 0.75, false);
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>;
    expect(saved["audio.bus.sfx"]).toEqual({ volume: 0.75, muted: false });
  }, 20_000);

  it("plays silent, and still plays, in a browser without Web Audio", async () => {
    made.noWebAudio = true;
    const { game } = await playing();
    game.step(3);
    expect(game.audio).toBeNull();
    expect(game.getStore().state.tick).toBeGreaterThanOrEqual(3);
  }, 20_000);
});

describe("GameCanvas sound menu", () => {
  const soundButton = () => screen.queryByRole("button", { name: "Sound" });
  const openMenu = () => {
    if (!screen.queryByRole("menu")) fireEvent.click(soundButton()!);
  };

  it("is hidden without engine-games-enabled", async () => {
    await playing();
    expect(soundButton()).toBeNull();
  }, 20_000);

  it("mutes the master bus and saves it, and the choice comes back on reload", async () => {
    made.flags = { "engine-games-enabled": true };
    const { game } = await playing();
    game.step(1);
    await waitFor(() => expect(soundButton()).not.toBeNull());
    openMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Mute" }));
    expect(game.audio?.buses().master?.muted).toBe(true);
    expect(made.backends[0]!.busVolumes.get("master")).toBe(0);
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>;
    expect(saved["audio.bus.master"]).toEqual({ volume: 1, muted: true });

    cleanup();
    made.games.length = 0;
    made.backends.length = 0;
    const again = await playing();
    again.game.step(1);
    expect(again.game.audio?.buses().master).toEqual({ volume: 1, muted: true });
    await waitFor(() => expect(soundButton()?.textContent).toContain("Muted"));
  }, 30_000);

  it("saves a choice made while the game plays silent, and the audio opens with it", async () => {
    made.flags = { "engine-games-enabled": true };
    made.noWebAudio = true;
    const { game } = await playing();
    game.step(1);
    expect(game.audio).toBeNull();
    await waitFor(() => expect(soundButton()).not.toBeNull());
    openMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Mute" }));
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>;
    expect(saved["audio.bus.master"]).toEqual({ volume: 1, muted: true });

    made.noWebAudio = false;
    expect(game.reopenAudio()).toBe(true);
    expect(game.audio?.buses().master?.muted).toBe(true);
  }, 20_000);
});

describe("GameCanvas locale and UI", () => {
  it("starts in the saved locale over the browser's languages, and mounts the UI module's dialogue box", async () => {
    vi.stubGlobal("navigator", { ...navigator, languages: ["en-US"] });
    localStorage.setItem(PREFS_KEY, JSON.stringify({ locale: "fr" }));
    await playing();
    const [game] = made.games;
    expect(game!.locale.current()).toBe("fr");
    await waitFor(() => expect(mounted.greeting).toBe("Bonjour"));
    expect(document.querySelector("[data-jams-dialogue]")).not.toBeNull();
  }, 20_000);

  it("with nothing saved, takes the browser's language by its subtag, and saves a change", async () => {
    vi.stubGlobal("navigator", { ...navigator, languages: ["fr-CA", "en"] });
    const { game } = await playing();
    expect(game.locale.current()).toBe("fr");
    game.locale.set("en");
    expect(game.locale.strings().get("greeting")).toBe("Hello");
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>;
    expect(saved.locale).toBe("en");
  }, 20_000);
});

describe("hostedGamesFrom with sound and text", () => {
  it("reads a game's sound, synth and strings docs, and serves its audio clips by URL", async () => {
    const wav = {
      kind: "asset-sidecar",
      v: 1,
      key: "k-bell",
      id: "bell-wav",
      sha256: "c".repeat(64),
      bytes: 64,
      meta: { channels: 1, durationMs: 100, format: "wav", sampleRate: 22050 },
      metaVersion: 2,
    };
    const [hosted] = hostedGamesFrom(
      {
        ...globs,
        sidecars: {
          ...globs.sidecars,
          "/src/games/chime/audio/bell.wav.asset.json": doc(wav),
          "/src/games/chime/audio/gone.ogg.asset.json": doc({
            ...wav,
            key: "k-gone",
            id: "gone",
            sha256: "d".repeat(64),
          }),
        },
        urls: { "/src/games/chime/audio/bell.wav": "/assets/bell-123.wav" },
      },
      vi.fn(),
    );
    const { project, assets } = await hosted!.load();
    expect(project.doc?.("sound", "chime")).toMatchObject({ bus: "sfx" });
    expect(project.docs?.("synth")).toEqual(["chime-patch"]);
    expect(project.docs?.("strings")).toEqual(["chime-strings"]);
    expect(project.engine.locales).toEqual({ default: "en", available: ["en", "fr"] });
    const entry = assets!.view.byId.get("bell-wav")!;
    expect(entry.kind).toBe("audio");
    expect(
      assets!.url("chime", { id: "bell-wav", kind: "audio", sha256: entry.sha256!, bytes: 64 }),
    ).toBe("/assets/bell-123.wav");
    expect(assets!.view.byId.has("gone")).toBe(false);
  });
});
