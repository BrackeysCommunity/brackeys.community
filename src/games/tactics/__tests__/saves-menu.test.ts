// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import { createGame, mountUi, type GameInstance, type SceneSource } from "@jams/engine";
import { formatSaveFile, type LibraryScene, type SaveFile } from "@jams/engine/game";
import { sceneListFlow } from "@jams/engine/project";
import { createRegistry, parsePrefab, parseSceneOrThrow, type Prefab } from "@jams/engine/scene";
import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { tacticsGame, type TacticsFlowSlice, type TacticsRunSnapshot } from "..";
import sceneList from "../scene-list.json";
import { boardView } from "../ui/cursor";
import { canSaveNow, SAVE_SLOT } from "../ui/hud";
import { mountTacticsHud } from "../ui/index";
import { newestSave } from "../ui/menu";
import { tacticsHeldProject } from "./pins";

const init = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@dimforge/rapier2d-compat", () => ({ init, default: { init } }));

// The shell's Pixi renderer, stood in for so the shell runs under jsdom.
vi.mock("../../../engine/renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

const here = (path: string) => new URL(path, import.meta.url);
const json = (path: string): unknown => JSON.parse(readFileSync(here(path), "utf8"));

const registry = createRegistry(tacticsGame);
const prefabs = new Map(
  ["../scenes/prefabs/knight.json", "../scenes/prefabs/archer.json"].map(
    (path): [string, Prefab] => {
      const parsed = parsePrefab(json(path), registry);
      if (!parsed.ok) throw new Error(`${path} doesn't parse`);
      return [parsed.prefab.id, parsed.prefab];
    },
  ),
);

/** The project's scene list as a host's synchronous source. */
function source(): SceneSource {
  const { start, scenes: list } = sceneListFlow(sceneList);
  const scenes = new Map<string, LibraryScene>(
    list.map(({ scene }) => [
      scene,
      { def: parseSceneOrThrow(json(`../scenes/${scene}.json`), registry), prefabs },
    ]),
  );
  return { list: () => list, start: () => start, scene: (id) => scenes.get(id) ?? null };
}

/** A loader with nothing to fetch: textures stay placeholders. */
const loader = {
  async load() {
    return { failed: [] };
  },
  retain() {},
  release() {},
  texture: () => null,
  get: () => null,
  onLoad: () => () => {},
  destroy() {},
} as unknown as NonNullable<Parameters<typeof createGame>[1]["assets"]>["loader"];

/** A page's `localStorage`, kept across the two instances as a reload keeps it. */
function pageStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

type Live = { ctx: { tick: number }; game: { snapshot(): unknown } | null };
const live = (game: GameInstance) => game.runtime() as unknown as Live;
const slice = (game: GameInstance) => game.getStore().state.game as TacticsFlowSlice | null;

const games: GameInstance[] = [];
const unmounts: (() => void)[] = [];
let canvas: HTMLCanvasElement;

async function boot(): Promise<GameInstance> {
  canvas?.remove();
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const held = tacticsHeldProject();
  const game = await createGame(canvas, {
    game: tacticsGame,
    dev: true,
    project: held.runtime,
    assets: { loader, view: held.view, kinds: held.kinds },
    flow: { source: source(), loading: false },
  });
  games.push(game);
  game.start();
  unmounts.push(mountUi(game, canvas, mountTacticsHud));
  return game;
}

/** Steps until `done` holds, a tick at a time, failing past `max`. */
function stepUntil(game: GameInstance, done: (s: TacticsFlowSlice) => boolean, max = 2000) {
  for (let i = 0; i < max; i++) {
    const s = slice(game);
    if (s && done(s)) return;
    game.step();
  }
  throw new Error(`not reached in ${max} ticks: ${JSON.stringify(slice(game)?.log)}`);
}

const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector);
const saveButton = () => button('.tactics-hud button[data-action="save"]');
const continueButton = () => button('.tactics-menu button[data-action="continue"]');

describe("the save menu", () => {
  let storage: Storage;

  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 11, 12) });
    storage = pageStorage();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
  });

  afterEach(() => {
    for (const u of unmounts.splice(0)) u();
    for (const g of games.splice(0)) g.destroy();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("saves level 2 from the HUD, and Continue in a new instance on the same storage restores it", async () => {
    const first = await boot();
    const went = first.flow.go("level-2");
    await vi.runAllTimersAsync();
    expect(await went).toMatchObject({ ok: true, scene: "level-2" });

    // The board is up and it's the player's first orders: Save is offered.
    stepUntil(first, (s) => s.flow?.screen === "level" && s.side === "blue");
    const save = saveButton();
    expect(save?.textContent).toBe("Save");
    expect(save?.type).toBe("button");
    expect(save?.closest('[role="group"]')?.getAttribute("aria-label")).toBe("Game");
    expect(save?.getAttribute("aria-disabled")).toBe("false");

    // Hand over to the red side: no Save while it plays, and back on the player's next turn.
    expect(first.send({ name: "end-turn" })).toBe(true);
    first.step();
    expect(saveButton()?.getAttribute("aria-disabled")).toBe("true");
    stepUntil(first, (s) => s.turn === 2 && s.side === "blue" && s.phase === "orders");
    first.step(3);
    await vi.runAllTimersAsync();
    expect(saveButton()?.getAttribute("aria-disabled")).toBe("false");

    // Later than any autosave the turn's start asked for, so Continue picks this one.
    vi.setSystemTime(Date.now() + 60_000);
    const expected = {
      tick: live(first).ctx.tick,
      snapshot: structuredClone(live(first).game!.snapshot()) as TacticsRunSnapshot,
    };
    saveButton()!.click();
    expect(saveButton()?.getAttribute("aria-disabled")).toBe("true");
    await vi.runAllTimersAsync();
    expect(document.querySelector('.tactics-hud [data-save="note"]')?.textContent).toBe("Saved");
    const stored = JSON.parse(storage.getItem(`jams-engine:save:tactics:${SAVE_SLOT}`)!);
    expect(stored).toMatchObject({ game: "tactics", slot: SAVE_SLOT, depth: "world" });
    const listed = await first.saves.list();
    expect(newestSave(listed)).toMatchObject({
      slot: SAVE_SLOT,
      meta: { scene: "level-2", title: "Turn 2" },
    });

    // Once an order is given this turn, Save waits for the next.
    const blue = Object.entries(expected.snapshot.units).find(([, u]) => u.side === "blue")![0];
    expect(first.send({ name: "wait", args: { unit: blue } })).toBe(true);
    first.step(2);
    expect(saveButton()?.getAttribute("aria-disabled")).toBe("true");

    // The page reloads: a new instance over the same localStorage starts at the menu.
    unmounts.pop()!();
    first.destroy();
    games.splice(games.indexOf(first), 1);
    const second = await boot();
    const restarted = second.flow.restart();
    await vi.runAllTimersAsync();
    expect(await restarted).toMatchObject({ ok: true, scene: "menu" });
    expect(document.querySelector(".tactics-menu-note")?.textContent).toBe(
      "Saves stay in this browser until you clear its site data.",
    );
    expect(second.saves.store.describe).toBe(
      "Saves stay in this browser until you clear its site data.",
    );
    const resume = continueButton();
    expect(resume?.textContent).toBe("Continue");
    expect(resume?.type).toBe("button");
    expect(resume?.getAttribute("aria-disabled")).toBe("false");
    expect(resume?.dataset.slot).toBe(SAVE_SLOT);
    const line = document.getElementById(resume!.getAttribute("aria-describedby")!);
    expect(line?.textContent).toBe("Last save: Bridge · Turn 2");

    const changes: unknown[] = [];
    second.on("flow:change", (e) => changes.push(e));
    resume!.click();
    await vi.runAllTimersAsync();
    expect(changes).toEqual([{ from: "menu", to: "level-2", entry: null }]);
    expect(second.flow.current()).toBe("level-2");
    expect(live(second).ctx.tick).toBe(expected.tick);
    expect(live(second).game!.snapshot()).toEqual(expected.snapshot);
    expect(document.querySelector(".tactics-menu")).toBeNull();
    expect(document.querySelector<HTMLElement>(".tactics-hud")?.hidden).toBe(false);
    expect(document.querySelector(".tactics-hud-banner")?.textContent).toBe("Turn 2 · Your orders");
    expect(second.getStore().state.sim.paused).toBe(false);
  });

  it("keeps Continue off with no save, and says why a save it offered won't load", async () => {
    const game = await boot();
    const restarted = game.flow.restart();
    await vi.runAllTimersAsync();
    await restarted;
    expect(continueButton()?.getAttribute("aria-disabled")).toBe("true");
    expect(continueButton()?.hasAttribute("aria-describedby")).toBe(false);
    unmounts.pop()!();
    games.pop()!.destroy();

    // Another game's save under this game's key: listed, then refused on load.
    const foreign: SaveFile = {
      kind: "save",
      v: 1,
      game: "other",
      gameVersion: 1,
      engine: "0.13.0",
      release: null,
      project: null,
      slot: SAVE_SLOT,
      meta: { scene: "level-2", savedAt: Date.now(), playTicks: 0 },
      depth: "progress",
      persist: null,
      scene: { id: "level-2", runHash: "", sublevels: [] },
      data: null,
    };
    storage.setItem(`jams-engine:save:tactics:${SAVE_SLOT}`, formatSaveFile(foreign));
    const again = await boot();
    const menu = again.flow.restart();
    await vi.runAllTimersAsync();
    await menu;
    expect(continueButton()?.getAttribute("aria-disabled")).toBe("false");
    continueButton()!.focus();
    continueButton()!.click();
    await vi.runAllTimersAsync();
    expect(again.flow.current()).toBe("menu");
    expect(document.querySelector('.tactics-menu [role="alert"]')?.textContent).toBe(
      'That save couldn\'t be loaded: this save is for the game "other", not "tactics"',
    );
    // The redraw keeps the player's place on Continue.
    expect(document.activeElement).toBe(continueButton());
  });
});

describe("when Save is offered", () => {
  const units = {
    "blue-1/unit": {
      side: "blue",
      class: "knight",
      cell: [1, 1],
      hp: 5,
      moved: false,
      acted: false,
    },
    "red-1/unit": { side: "red", class: "knight", cell: [5, 1], hp: 5, moved: false, acted: false },
  } as const;
  const sliceWith = (over: Partial<TacticsFlowSlice> = {}): TacticsFlowSlice =>
    ({
      turn: 1,
      side: "blue",
      phase: "orders",
      result: null,
      units,
      grid: { cols: 8, rows: 4, cell: 1, walls: [], costs: [] },
      classes: { knight: { hp: 5, move: 3, range: [1, 1], sight: false } },
      log: [],
      ...over,
    }) as unknown as TacticsFlowSlice;
  const flow: TacticsFlowSlice["flow"] = {
    screen: "level",
    scene: "level-2",
    progress: { cleared: [], roster: [], last: null },
    stairs: [],
    next: null,
  };

  it("is the start of the player's turn on a listed level that hasn't ended", () => {
    const s = sliceWith();
    expect(canSaveNow(boardView(s), flow)).toBe(true);
    expect(canSaveNow(boardView(s), undefined)).toBe(false);
    expect(canSaveNow(boardView(s), { ...flow, scene: null })).toBe(false);
    expect(canSaveNow(boardView(s), { ...flow, next: "result" })).toBe(false);
    expect(canSaveNow(boardView(sliceWith({ side: "red", phase: "enemy" })), flow)).toBe(false);
    expect(canSaveNow(boardView(sliceWith({ result: "won" })), flow)).toBe(false);
    const moved = sliceWith({
      units: { ...units, "blue-1/unit": { ...units["blue-1/unit"], moved: true } },
    });
    expect(canSaveNow(boardView(moved), flow)).toBe(false);
  });

  it("Continue picks the newest slot, autosaves included", () => {
    const at = (slot: string, savedAt: number) => ({
      slot,
      bytes: 1,
      meta: { scene: "level-2", savedAt, playTicks: 0 },
    });
    expect(newestSave([])).toBeNull();
    expect(newestSave([at("slot-1", 5), at("auto", 9)])?.slot).toBe("auto");
    expect(newestSave([at("slot-1", 9), at("auto", 5)])?.slot).toBe("slot-1");
    expect(newestSave([at("slot-1", 5), at("auto", 5)])?.slot).toBe("auto");
  });
});
