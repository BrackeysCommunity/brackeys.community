// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { createRegistry, defineGame } from "../game/define";
import {
  formatSaveFile,
  MAX_BROWSER_SAVE_LIMITS,
  type SaveDepth,
  type SaveFile,
} from "../game/save-file";
import type { GameDefinition } from "../game/types";
import type { SceneRuntimeHandle, StepResult } from "../runtime/types";
import { browserSaveStore } from "../saves/browser";
import { createSaveSlots, pickSaveStore, type SaveSlotsHost } from "../saves/slots";
import {
  DEFAULT_LOCAL_STORAGE_PREFIX,
  indexedDbSaveStore,
  localStorageSaveStore,
  memorySaveStore,
  type SaveStore,
} from "../saves/store";
import { SCENE_FORMAT_VERSION, type SceneDefinition, type SceneIssue } from "../scene/types";
import type { GameInstance, SceneSource } from "../types";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

/** What the shell asked capture and restore for, standing in for the world-state code. */
const saveState = vi.hoisted(() => ({
  captured: [] as { tick: number; slot: string; depth: string }[],
  restored: [] as { scene: string; loaded: string | undefined }[],
}));

vi.mock("../runtime/save-state", () => ({
  captureSave: (
    runtime: SceneRuntimeHandle,
    opts: { depth: SaveDepth; slot: string; title?: string; now: number },
  ) => {
    saveState.captured.push({ tick: runtime.ctx.tick, slot: opts.slot, depth: opts.depth });
    const scene = runtime.scene()!.name;
    return {
      ok: true,
      file: saveFile(opts.slot, scene, {
        savedAt: opts.now,
        playTicks: runtime.ctx.tick,
        ...(opts.title !== undefined ? { title: opts.title } : {}),
      }),
    };
  },
  restoreSave: (runtime: SceneRuntimeHandle, file: SaveFile) => {
    saveState.restored.push({ scene: file.scene.id, loaded: runtime.scene()?.name });
    return { ok: true, report: { ok: true, ms: 0, issues: [] } };
  },
}));

function saveFile(slot: string, scene = "one", meta: Partial<SaveFile["meta"]> = {}): SaveFile {
  return {
    kind: "save",
    v: 1,
    game: "vault",
    gameVersion: 1,
    engine: "0.13.0",
    release: null,
    project: null,
    slot,
    meta: { scene, savedAt: 0, playTicks: 0, ...meta },
    depth: "progress",
    persist: null,
    scene: { id: scene, runHash: "", sublevels: [] },
    data: null,
  };
}

function fakeStorage(): Storage & { probes: number } {
  const items = new Map<string, string>();
  const storage = {
    probes: 0,
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key: string) => items.get(key) ?? null,
    key: (i: number) => [...items.keys()][i] ?? null,
    removeItem: (key: string) => void items.delete(key),
    setItem: (key: string, value: string) => {
      if (key === `${DEFAULT_LOCAL_STORAGE_PREFIX}probe`) storage.probes++;
      items.set(key, String(value));
    },
  };
  return storage;
}

const boom = () => {
  throw new DOMException("blocked", "SecurityError");
};
const throwingStorage = () =>
  ({ getItem: boom, setItem: boom, removeItem: boom, key: boom, length: 0 }) as unknown as Storage;

afterEach(() => {
  vi.unstubAllGlobals();
  saveState.captured.length = 0;
  saveState.restored.length = 0;
});

describe("the stores", () => {
  it("memorySaveStore keeps each game's slots, summarised by meta and size", async () => {
    const store = memorySaveStore();
    expect(store.kind).toBe("memory");
    expect(store.describe).toBe("Saves last until this tab closes.");
    const text = formatSaveFile(saveFile("b", "one", { title: "Bee" }));
    expect(await store.write("vault", "b", text)).toEqual({ ok: true, bytes: text.length });
    await store.write("vault", "a", formatSaveFile(saveFile("a")));
    await store.write("other", "c", formatSaveFile(saveFile("c")));
    const listed = await store.list("vault");
    expect(listed.map((s) => s.slot)).toEqual(["a", "b"]);
    expect(listed[1]).toEqual({
      slot: "b",
      meta: { scene: "one", savedAt: 0, playTicks: 0, title: "Bee" },
      bytes: text.length,
    });
    expect(await store.read("vault", "b")).toBe(text);
    await store.remove("vault", "b");
    expect(await store.read("vault", "b")).toBeNull();
    expect((await store.list("other")).map((s) => s.slot)).toEqual(["c"]);
  });

  it("localStorageSaveStore writes `${prefix}${gameId}:${slot}` and skips what isn't a save", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const store = localStorageSaveStore();
    expect(store.kind).toBe("browser");
    expect(store.describe).toBe("Saves stay in this browser until you clear its site data.");
    const text = formatSaveFile(saveFile("slot-1"));
    expect((await store.write("vault", "slot-1", text)).ok).toBe(true);
    expect(storage.getItem("jams-engine:save:vault:slot-1")).toBe(text);
    storage.setItem("jams-engine:save:vault:junk", "{not json");
    expect((await store.list("vault")).map((s) => s.slot)).toEqual(["slot-1"]);

    const own = fakeStorage();
    const custom = localStorageSaveStore({ prefix: "mine:", storage: own });
    await custom.write("vault", "x", text);
    expect(own.getItem("mine:vault:x")).toBe(text);
    expect(storage.getItem("mine:vault:x")).toBeNull();
  });

  it("localStorageSaveStore never throws: a write is save-store-failed, reads are empty", async () => {
    vi.stubGlobal("localStorage", throwingStorage());
    const store = localStorageSaveStore();
    const written = await store.write("vault", "s", formatSaveFile(saveFile("s")));
    expect(written.ok).toBe(false);
    if (written.ok) return;
    expect(written.issue.code).toBe("save-store-failed");
    expect(written.issue.severity).toBe("warn");
    expect(await store.list("vault")).toEqual([]);
    expect(await store.read("vault", "s")).toBeNull();
    await expect(store.remove("vault", "s")).resolves.toBeUndefined();
  });

  it("indexedDbSaveStore without IndexedDB fails its writes as save-store-failed", async () => {
    const store = indexedDbSaveStore();
    expect(store.describe).toBe("Saves stay in this browser until you clear its site data.");
    const written = await store.write("vault", "s", formatSaveFile(saveFile("s")));
    expect(written.ok ? null : written.issue.code).toBe("save-store-failed");
    expect(await store.list("vault")).toEqual([]);
  });

  it("the browser stores hold at most MAX_BROWSER_SAVE_LIMITS whatever calls them", async () => {
    const store = localStorageSaveStore({ storage: fakeStorage() });
    const huge = formatSaveFile(saveFile("s", "one", { title: "x".repeat(1_100_000) }));
    const written = await store.write("vault", "s", huge);
    expect(written.ok ? null : written.issue.code).toBe("save-too-large");
    for (let i = 0; i < MAX_BROWSER_SAVE_LIMITS.maxSlots; i++)
      expect((await store.write("vault", `s${i}`, formatSaveFile(saveFile(`s${i}`)))).ok).toBe(
        true,
      );
    const over = await store.write("vault", "one-more", formatSaveFile(saveFile("one-more")));
    expect(over.ok ? null : over.issue.code).toBe("save-slot-limit");
  });
});

describe("browserSaveStore", () => {
  it("uses localStorage without IndexedDB, probing it once", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const store = browserSaveStore();
    expect(store.kind).toBe("browser");
    expect(store.describe).toBe("Saves stay in this browser until you clear its site data.");
    const text = formatSaveFile(saveFile("s"));
    await store.write("vault", "s", text);
    await store.write("vault", "t", text);
    await store.list("vault");
    expect(storage.getItem("jams-engine:save:vault:s")).toBe(text);
    expect(storage.probes).toBe(1);
  });

  it("falls back to memory, saying so, when localStorage throws", async () => {
    vi.stubGlobal("localStorage", throwingStorage());
    const store = browserSaveStore();
    expect(store.kind).toBe("browser");
    expect(store.describe).toBe("Saves last until this tab closes.");
    const text = formatSaveFile(saveFile("s"));
    expect((await store.write("vault", "s", text)).ok).toBe(true);
    expect(await store.read("vault", "s")).toBe(text);
  });

  it("falls back to memory when reading localStorage itself throws", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: boom });
    try {
      expect(browserSaveStore().describe).toBe("Saves last until this tab closes.");
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  it("falls back from an IndexedDB that won't open to localStorage", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    let opens = 0;
    vi.stubGlobal("indexedDB", {
      open() {
        opens++;
        const req = { error: new DOMException("denied", "InvalidStateError") } as {
          onerror?: () => void;
          error: DOMException;
        };
        setTimeout(() => req.onerror?.(), 0);
        return req;
      },
    });
    const store = browserSaveStore();
    const text = formatSaveFile(saveFile("s"));
    expect((await store.write("vault", "s", text)).ok).toBe(true);
    expect(storage.getItem("jams-engine:save:vault:s")).toBe(text);
    expect(store.describe).toBe("Saves stay in this browser until you clear its site data.");
    await store.list("vault");
    expect(opens).toBe(1);
  });
});

describe("store precedence", () => {
  const host = memorySaveStore();
  const own: SaveStore = { ...memorySaveStore(), kind: "game", describe: "The game's own." };

  it("is the game's own store, else the host's, else the browser's", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(pickSaveStore({ saves: { version: 1, store: () => own } }, host)).toBe(own);
    expect(pickSaveStore({ saves: { version: 1 } }, host)).toBe(host);
    expect(pickSaveStore(null, host)).toBe(host);
    const browser = pickSaveStore({ saves: { version: 1 } }, undefined);
    expect(browser.kind).toBe("browser");
  });

  it("is what an instance's slots describe", async () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const withOwn = await shell({ saves: { version: 1, store: () => own } }, { saves: host });
    expect(withOwn.saves.store).toEqual({ kind: "game", describe: "The game's own." });
    const withHost = await shell({}, { saves: host });
    expect(withHost.saves.store.kind).toBe("memory");
    const browser = await shell({});
    expect(browser.saves.store).toEqual({
      kind: "browser",
      describe: "Saves stay in this browser until you clear its site data.",
    });
    expect(browser.saves.limits).toEqual({ maxBytes: 65_536, maxSlots: 8 });
  });
});

/** Slots over `store` whose capture is a save padded to `pad` characters. */
function slotsOver(store: SaveStore, opts: { pad?: number; game?: SaveSlotsHost["game"] } = {}) {
  let pad = opts.pad ?? 0;
  const slots = createSaveSlots({
    game: opts.game ?? { id: "vault" },
    store,
    now: () => 1234,
    capture: ({ slot, title, now }) => ({
      ok: true,
      file: saveFile(slot, "one", {
        savedAt: now,
        title: (title ?? "") + "x".repeat(pad),
      }),
    }),
    restore: async () => ({ ok: true }),
  });
  return { slots, setPad: (n: number) => (pad = n) };
}

describe("SaveSlots", () => {
  it("limits are the game's under the store's ceilings", () => {
    const raised = { id: "vault", saves: { version: 1, limits: { maxBytes: 4_000_000 } } };
    expect(
      slotsOver(localStorageSaveStore({ storage: fakeStorage() }), { game: raised }).slots.limits,
    ).toEqual({ maxBytes: MAX_BROWSER_SAVE_LIMITS.maxBytes, maxSlots: 8 });
    expect(slotsOver(memorySaveStore(), { game: raised }).slots.limits.maxBytes).toBe(4_000_000);
    const strict: SaveStore = { ...memorySaveStore(), kind: "host", limits: { maxSlots: 2 } };
    expect(slotsOver(strict).slots.limits).toEqual({ maxBytes: 65_536, maxSlots: 2 });
  });

  it("refuses a save past maxBytes before writing anything", async () => {
    const store = memorySaveStore();
    const write = vi.spyOn(store, "write");
    const list = vi.spyOn(store, "list");
    const { slots } = slotsOver(store, { pad: 70_000 });
    const result = await slots.save("big");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.code).toBe("save-too-large");
    expect(result.issue.severity).toBe("error");
    expect(result.issue.message).toMatch(
      /^This save is 69 KB; saves for this game are limited to 64 KB\. Save less state in snapshot\(\)/,
    );
    expect(write).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it("refuses a ninth new slot but never an overwrite", async () => {
    const { slots } = slotsOver(memorySaveStore());
    for (let i = 1; i <= 8; i++) expect((await slots.save(`slot-${i}`)).ok).toBe(true);
    const ninth = await slots.save("slot-9");
    expect(ninth.ok ? null : ninth.issue).toMatchObject({
      code: "save-slot-limit",
      severity: "error",
      message: "This game keeps at most 8 saves; delete one to save again.",
    });
    expect((await slots.save("slot-3", { title: "again" })).ok).toBe(true);
    await slots.remove("slot-1");
    expect((await slots.save("slot-9")).ok).toBe(true);
  });

  it("two new slots saved together at maxSlots - 1 keep the cap", async () => {
    const { slots } = slotsOver(memorySaveStore());
    for (let i = 1; i <= 7; i++) expect((await slots.save(`slot-${i}`)).ok).toBe(true);
    const [eighth, ninth] = await Promise.all([slots.save("slot-8"), slots.save("slot-9")]);
    expect(eighth.ok).toBe(true);
    expect(ninth.ok ? null : ninth.issue.code).toBe("save-slot-limit");
    expect((await slots.list()).length).toBe(8);
  });

  it("lists the slots with their meta, savedAt from the host's clock", async () => {
    const { slots } = slotsOver(memorySaveStore());
    await slots.save("b", { title: "Second" });
    await slots.save("a");
    const listed = await slots.list();
    expect(listed.map((s) => s.slot)).toEqual(["a", "b"]);
    expect(listed[1]!.meta).toEqual({ scene: "one", savedAt: 1234, playTicks: 0, title: "Second" });
    expect(listed[1]!.bytes).toBeGreaterThan(0);
  });

  it("turns a store that throws into save-store-failed, a warning", async () => {
    const thrower: SaveStore = {
      kind: "host",
      describe: "The host's.",
      list: async () => [],
      read: async () => boom(),
      write: async () => boom(),
      remove: async () => boom(),
    };
    const { slots } = slotsOver(thrower);
    const saved = await slots.save("s");
    expect(saved.ok ? null : saved.issue).toMatchObject({
      code: "save-store-failed",
      severity: "warn",
    });
    const loaded = await slots.load("s");
    expect(loaded.ok ? null : loaded.issue.code).toBe("save-store-failed");
    await expect(slots.remove("s")).resolves.toBeUndefined();
  });

  it("refuses a slot name outside SLOT_PATTERN", async () => {
    const { slots } = slotsOver(memorySaveStore());
    const result = await slots.save("Bad Slot");
    expect(result.ok ? null : result.issue.code).toBe("schema");
  });

  it("loads through the host's restore and reports a newer save's version", async () => {
    const store = memorySaveStore();
    const restored: string[] = [];
    const slots = createSaveSlots({
      game: { id: "vault", saves: { version: 1 } },
      store,
      now: () => 0,
      capture: () => ({ ok: true, file: saveFile("s") }),
      restore: async (file) => {
        restored.push(file.slot);
        return { ok: true };
      },
    });
    await store.write("vault", "s", formatSaveFile(saveFile("s", "two")));
    expect(await slots.load("s")).toEqual({
      ok: true,
      meta: { scene: "two", savedAt: 0, playTicks: 0 },
    });
    expect(restored).toEqual(["s"]);
    await store.write("vault", "n", formatSaveFile({ ...saveFile("n"), gameVersion: 2 }));
    const newer = await slots.load("n");
    expect(newer.ok ? null : newer.issue.code).toBe("save-version-newer");
    const missing = await slots.load("nothing");
    expect(missing.ok ? null : missing.issue.code).toBe("save-store-failed");
  });
});

// ─── The shell ──────────────────────────────────────────

const scene = (name: string): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name,
  game: "vault",
  bounds: [0, 0, 10, 10],
  entities: [{ id: "start", type: "marker", at: [1, 1], tags: ["spawn"] }],
});

const SCENES: Record<string, SceneDefinition> = { one: scene("one"), two: scene("two") };
const source: SceneSource = {
  list: () => [{ scene: "one" }, { scene: "two" }],
  start: () => "one",
  scene: (id) => (SCENES[id] ? { def: SCENES[id], prefabs: new Map() } : null),
};

/** A physics-free game that asks for a save of slot `auto` on its third tick. */
function vaultGame(extra: Partial<GameDefinition<{ ticks: number }>>) {
  return defineGame<{ ticks: number }>({
    id: "vault",
    types: [],
    actions: [],
    world: { physics: "none" },
    createRuntime(ctx) {
      let ticks = 0;
      return {
        onLoad() {
          ticks = 0;
        },
        afterStep() {
          ticks++;
          if (ticks === 3) ctx.saves.request("auto", { title: "Auto" });
        },
        snapshot: () => ({ ticks }),
      };
    },
    ...extra,
  });
}

const instances: GameInstance[] = [];
afterEach(() => {
  for (const g of instances.splice(0)) g.destroy();
});

async function shell(
  extra: Partial<GameDefinition<{ ticks: number }>>,
  config: { saves?: SaveStore; scene?: SceneDefinition } = {},
): Promise<GameInstance> {
  const game = vaultGame(extra);
  const instance = await createGame(document.createElement("canvas"), {
    game,
    registry: createRegistry(game),
    rapier: async () => {
      throw new Error("no Rapier");
    },
    scene: config.scene ?? scene("one"),
    flow: { source },
    ...(config.saves ? { saves: config.saves } : {}),
  });
  instances.push(instance);
  return instance;
}

const sceneName = (game: GameInstance) =>
  (game.runtime() as SceneRuntimeHandle | null)?.scene()?.name;

const flushed = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the shell's saves", () => {
  it("saves a request after its tick, answering only with a host event", async () => {
    const store = memorySaveStore();
    const game = await shell({ saves: { version: 1, store: () => store } });
    const written: unknown[] = [];
    const failed: unknown[] = [];
    const steps: StepResult[] = [];
    game.on("save:written", (e) => written.push(e));
    game.on("save:failed", (e) => failed.push(e));
    game.on("scene:step", (r) => steps.push(r));
    game.start();
    game.step(5);
    await flushed();
    expect(saveState.captured).toEqual([{ tick: 3, slot: "auto", depth: "progress" }]);
    const text = await store.read("vault", "auto");
    expect(written).toEqual([{ slot: "auto", bytes: new TextEncoder().encode(text!).length }]);
    expect(failed).toEqual([]);
    for (const step of steps) expect(Object.keys(step).sort()).toEqual(["events", "game", "tick"]);
    expect(steps.flatMap((s) => s.events)).toEqual([]);
  });

  it("reports a refused save as save:failed", async () => {
    const store: SaveStore = { ...memorySaveStore(), kind: "host", limits: { maxBytes: 10 } };
    const game = await shell({}, { saves: store });
    const failed: { slot: string; issue: SceneIssue }[] = [];
    game.on("save:failed", (e) => failed.push(e));
    game.start();
    game.step(3);
    await flushed();
    expect(failed.map((f) => [f.slot, f.issue.code])).toEqual([["auto", "save-too-large"]]);
  });

  it("restores a save from level 2 in a new instance over the same localStorage", async () => {
    const storage = fakeStorage();
    const first = await shell(
      {},
      { saves: localStorageSaveStore({ storage }), scene: scene("two") },
    );
    first.start();
    const saved = await first.saves.save("slot-1", { title: "Level 2" });
    expect(saved.ok).toBe(true);
    first.destroy();

    const second = await shell({}, { saves: localStorageSaveStore({ storage }) });
    expect((await second.saves.list()).map((s) => [s.slot, s.meta.scene, s.meta.title])).toEqual([
      ["slot-1", "two", "Level 2"],
    ]);
    const changes: unknown[] = [];
    second.on("flow:change", (e) => changes.push(e));
    second.start();
    const loaded = await second.saves.load("slot-1");
    expect(loaded.ok).toBe(true);
    expect(saveState.restored).toEqual([{ scene: "two", loaded: "two" }]);
    expect(sceneName(second)).toBe("two");
    expect(changes).toEqual([{ from: null, to: "two", entry: null }]);
    expect(second.getStore().state.sim.paused).toBe(false);
  });

  it("leaves a host's pause as it was across a load", async () => {
    const store = memorySaveStore();
    const game = await shell({}, { saves: store });
    await store.write("vault", "s", formatSaveFile(saveFile("s", "two")));
    game.start();
    game.pause();
    expect((await game.saves.load("s")).ok).toBe(true);
    expect(sceneName(game)).toBe("two");
    expect(game.getStore().state.sim.paused).toBe(true);
  });

  it("refuses to load a save whose scene isn't listed, keeping the scene it had", async () => {
    const store = memorySaveStore();
    const game = await shell({}, { saves: store });
    await store.write("vault", "s", formatSaveFile(saveFile("s", "attic")));
    const loaded = await game.saves.load("s");
    expect(loaded.ok ? null : loaded.issue.code).toBe("scene-unlisted");
    expect(sceneName(game)).toBe("one");
    expect(saveState.restored).toEqual([]);
  });
});
