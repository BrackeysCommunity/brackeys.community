import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  mountUi,
  type GameInstance,
  type GameStoreState,
  type SaveSlots,
  type UiActionEvent,
} from "@jams/engine";
import {
  createProjectSession,
  docToScene,
  memoryDocHost,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
} from "@jams/engine/collab";
import { DEFAULT_EXPORT_BUDGET, exportTargetNames, ITCH_LIMITS } from "@jams/engine/export";
import {
  clampTiming,
  createRegistry,
  LIVE_DEFAULTS,
  SLOT_MAX_LENGTH,
  SLOT_PATTERN,
  SLOT_RULE,
} from "@jams/engine/game";
import { createKindRegistry, ENGINE_ASSET_KINDS, type AssetEntry } from "@jams/engine/project";
import type { SceneDefinition } from "@jams/engine/scene";
import { Store } from "@tanstack/store";
import { describe, expect, it } from "vite-plus/test";
import type * as Y from "yjs";

import { SITE } from "../../../src/lib/legal-meta";
import { loadCompatRapier } from "../../scene/rapier-compat";
import { GAME_LIVE_BUILD_USAGE, GAME_LIVE_CHECK_USAGE } from "../../scene/tools/game-live";
import type { FerrySlice } from "../examples/dom-hud";
import {
  formatReference,
  REFERENCE_END,
  REFERENCE_START,
  withReference,
} from "../format-reference";

/**
 * Keeps `packages/engine/README.md` honest: the format reference is the
 * generator's output, and every `ts` block is a file in `examples/` that `vp
 * check` type-checks against the engine's public entries. After changing
 * either on purpose, run `UPDATE_README=1 vp test run scripts/engine-readme`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const README = join(REPO, "packages/engine/README.md");
const EXAMPLES = join(HERE, "../examples");
const update = process.env.UPDATE_README === "1";

/**
 * The text with what the formatter changes taken out: table padding, rule
 * widths and escapes. The README is formatted like any other file, so the
 * generator's raw output is compared in this form.
 */
const normalize = (text: string) =>
  text
    .replace(/\\([*_])/g, "$1")
    .replace(/-{3,}/g, "---")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\| ?/g, "|")
    .trim();

const section = (readme: string) =>
  readme.slice(
    readme.indexOf(REFERENCE_START) + REFERENCE_START.length,
    readme.indexOf(REFERENCE_END),
  );

type Block = { lang: string; name: string | undefined; body: string };

function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  for (const m of markdown.matchAll(/^```(\w+)(?:[ \t]+(\S+))?\n([\s\S]*?)^```$/gm)) {
    out.push({ lang: m[1]!, name: m[2], body: m[3]! });
  }
  return out;
}

describe("the engine README", () => {
  it("has the generated scene format reference", () => {
    const readme = readFileSync(README, "utf8");
    expect(readme.indexOf(REFERENCE_START)).toBeLessThan(readme.indexOf(REFERENCE_END));
    const reference = formatReference();
    if (update && normalize(section(readme)) !== normalize(reference)) {
      writeFileSync(README, withReference(readme, reference));
      spawnSync("vp", ["fmt", README], { cwd: REPO });
    }
    expect(normalize(section(readFileSync(README, "utf8")))).toBe(normalize(reference));
  });

  it("names every ts block, and each is a file in examples/", () => {
    const ts = blocks(readFileSync(README, "utf8")).filter((b) => b.lang === "ts");
    expect(ts.length).toBeGreaterThan(0);
    const unnamed = ts.filter((b) => !b.name?.endsWith(".ts"));
    expect(
      unnamed.map((b) => b.body.split("\n")[0]),
      "every ts block needs a file name",
    ).toEqual([]);
    const names = ts.map((b) => b.name!);
    expect(new Set(names).size, "block names must be unique").toBe(names.length);

    if (update) {
      if (existsSync(EXAMPLES)) rmSync(EXAMPLES, { recursive: true });
      mkdirSync(EXAMPLES, { recursive: true });
      for (const b of ts) writeFileSync(join(EXAMPLES, b.name!), b.body);
    }
    expect(readdirSync(EXAMPLES).sort()).toEqual([...names].sort());
    for (const b of ts) {
      expect(readFileSync(join(EXAMPLES, b.name!), "utf8"), b.name).toBe(b.body);
    }
  });
});

describe("the entity lifecycle examples run", () => {
  it("lantern-lifecycle.ts logs the hooks in load, step and flush order", async () => {
    const { lanternNight } = await import("../examples/lantern-lifecycle");
    expect(lanternNight()).toEqual([
      "attach glow west",
      "attach glow east",
      "ready lantern west,east",
      "ready glow west,east",
      "onLoad",
      "attach glow lantern#1",
      "ready lantern lantern#1",
      "ready glow lantern#1",
      "disable glow west",
      "disable lantern west",
      "entity:spawned lantern#1",
      "entity:disabled west",
      "east exists after destroy: true",
      "despawn east",
      "entity:destroyed east",
      "east exists: false",
      "enable lantern west",
      "enable glow west",
    ]);
  });

  it("fountain-playtest.ts pours, runs dry, replays its seed and blocks on a reused id", async () => {
    const { pourTwice, spillTwice } = await import("../examples/fountain-playtest");
    const r = pourTwice();
    expect(r.result).toBe("dry");
    expect(r.final).toMatchObject({ fell: 24, live: 0, dry: true });
    expect(r.steps).toEqual(["done", "until", "until"]);
    expect(r.spawned).toEqual(["twin-spout#1/left", "twin-spout#1/right", "drop#1", "drop#2"]);
    expect(r.allRuntime).toBe(true);
    expect(r.sameSeedSameRun).toBe(true);
    expect(r.otherSeedJitter).not.toBe(r.final?.jitter);
    expect(r.recordedSeed).toBe(1);
    expect(r.replayed).toBe(true);
    expect(spillTwice()).toEqual({ stage: "run", codes: ["spawn-id-invalid"] });
  });

  it("shuttle-contacts.ts bumps, pools and queries alike on both backends", async () => {
    const { shuttle } = await import("../examples/shuttle-contacts");
    const geometry = shuttle(null);
    expect(geometry.bumps).toHaveLength(16);
    expect(geometry.bumps.slice(0, 4)).toEqual([
      "start west",
      "end west",
      "start east",
      "end east",
    ]);
    expect(geometry).toMatchObject({ sparks: 2, refused: 2, lit: 2, nearest: "east" });
    expect(geometry.west).toEqual(["west", "spark#1"]);
    expect(shuttle(await loadCompatRapier())).toEqual(geometry);
  });
});

describe("the world-model examples run", () => {
  it("grid-tools.ts paths round the rocks, floods a field and casts sight", async () => {
    const { scout } = await import("../examples/grid-tools");
    const r = scout();
    expect(r.steps).toBeGreaterThan(8);
    expect(r.cost).toBe(r.steps! * 10);
    expect(r.fromCorner).toBeGreaterThan(0);
    expect(r.nextFromCorner).toBeDefined();
    expect(r.seesAcross).toBe(false);
    expect(r.clearShot).toBe(true);
  });

  it("shape-queries.ts finds what a blade cuts and where a laser lands, exactly", async () => {
    const { workbench } = await import("../examples/shape-queries");
    const cut = workbench({ type: "circle", cx: 3, cy: 0.6, r: 0.05 }, [2, 1]);
    expect(cut.upright).toEqual({ minX: 2.95, minY: 0.6, maxX: 3.05, maxY: 1.4 });
    expect(cut.near).toEqual(["upright"]);
    expect(cut.cuts).toEqual(["upright"]);
    expect(cut.laser).toEqual({ at: 2.95, normal: [-1, 0] });
    const both = workbench({ type: "box", cx: 2, cy: 1, hw: 1, hh: 0.02, rotDeg: 0 }, [2, 3]);
    expect(both.near).toEqual(["flat", "upright"]);
    expect(both.cuts).toEqual(["flat", "upright"]);
    expect(both.laser).toBeNull();
    const corner = workbench({ type: "circle", cx: 3.09, cy: 1.44, r: 0.05 }, [2, 1]);
    expect(corner.near).toEqual(["upright"]);
    expect(corner.cuts).toEqual([]);
  });

  it("nav-walk.ts walks round the table and through the doorway", async () => {
    const { walkAround } = await import("../examples/nav-walk");
    const r = walkAround();
    expect(r.issues).toEqual([]);
    expect(r.path?.[0]).toEqual([1, 1.5]);
    expect(r.path?.at(-1)).toEqual([6.5, 1.5]);
    expect(r.path!.length).toBeGreaterThan(2);
    expect(r.onTable).toBe(false);
    expect(r.clickedOutside).toEqual([5.5, 2]);
  });

  it("orchard-game.ts catches up eight hours of a day away", async () => {
    const { dayAway } = await import("../examples/orchard-game");
    expect(dayAway().final).toEqual({ trees: 2, ripe: 0, picked: 2 * 8 * 60 });
  });

  it("balloon-type.ts is physics-required in a scene without physics", async () => {
    const { balloonIssues } = await import("../examples/balloon-type");
    expect(balloonIssues()).toEqual(["physics-required"]);
  });

  it("rover-game.ts drives home on both backends", async () => {
    const { driveHome } = await import("../examples/rover-game");
    expect(driveHome(null).result).toBe("won");
    expect(driveHome(await loadCompatRapier()).result).toBe("won");
  });

  it("walker-playtest.ts wins, replays, skips idle slots and never loads Rapier", async () => {
    const { walkCorridor } = await import("../examples/walker-playtest");
    let loaded = false;
    const r = await walkCorridor(async () => {
      loaded = true;
      return loadCompatRapier();
    });
    expect(loaded).toBe(false);
    expect(r.result).toBe("won");
    expect(r.replayed).toBe(true);
    expect(r.ticks).toBeLessThan(r.slots);
    expect(r.commands.map((c) => c[1])).toEqual(["walk", "walk"]);
  });
});

describe("the co-editing example", () => {
  const entry = (key: string, id: string, path: string, name?: string): AssetEntry => ({
    key,
    id,
    kind: "scene",
    path,
    ...(name ? { name } : {}),
    created: { at: 0, by: "seed" },
  });
  const yard: SceneDefinition = {
    v: 4,
    name: "Yard",
    bounds: [0, 0, 6.4, 3.84],
    settings: { physics: "none" },
    entities: [{ id: "crate", type: "solid", shape: ["box", 1, 1, 0.16, 0.16] }],
  };

  async function project() {
    const host = memoryDocHost();
    seedProjectDoc(
      host.doc("project:p"),
      {
        meta: { projectId: "p", layout: 1, name: "P" },
        assets: {
          k7: entry("k7", "yard-id", "levels/old-yard.json", "Yard"),
          k8: entry("k8", "dock-id", "levels/dock.json"),
        },
        history: {},
        code: {},
        build: {},
      },
      { kind: "migration" },
    );
    sceneToDoc(yard, { doc: host.doc("scene:p.k7"), key: sequentialKeys("srv") });
    const registry = createRegistry(null);
    const session = await createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin: { kind: "user", userId: "ada" },
      registry,
      kinds: createKindRegistry(null, ENGINE_ASSET_KINDS),
    });
    return { host, registry, session };
  }

  it("names a scene's doc by its registry key, not by its name", async () => {
    const { coEdit, sceneDocOf } = await import("../examples/co-editing");
    const { host, registry, session } = await project();
    expect(sceneDocOf(session, "Yard")?.docName).toBe("scene:p.k7");
    expect(sceneDocOf(session, "yard-id")?.docName).toBe("scene:p.k7");
    expect(sceneDocOf(session, "dock")?.docName).toBe("scene:p.k8");
    expect(sceneDocOf(session, "old-yard")).toBeNull();

    const edit = await coEdit({ registry, runtime: () => null }, session, "Yard", "ada");
    expect(edit.docName).toBe("scene:p.k7");
    expect(edit.move("crate").ok).toBe(true);
    const moved = (doc: Y.Doc) => docToScene(doc).entities?.find((e) => e.id === "crate")?.shape;
    expect(moved(host.doc("scene:p.k7"))).toEqual(["box", 1.16, 1, 0.16, 0.16]);
    edit.undo();
    expect(moved(host.doc("scene:p.k7"))).toEqual(["box", 1, 1, 0.16, 0.16]);
    edit.close();
    session.destroy();
  });
});

/** A DOM to drive the browser-side examples in, without switching this file's environment; jsdom ships no types. */
type Dom = { window: Window & typeof globalThis };
const JSDOM_MODULE = "jsdom";
async function dom(html: string, url?: string): Promise<Dom> {
  const { JSDOM } = (await import(/* @vite-ignore */ JSDOM_MODULE)) as {
    JSDOM: new (html: string, opts?: { url?: string }) => Dom;
  };
  return new JSDOM(html, url ? { url } : {});
}

describe("the input examples run", () => {
  it("duel-seats.ts races two seats, records both streams and replays from JSON", async () => {
    const { runRace } = await import("../examples/duel-seats");
    const r = runRace();
    expect(r.result).toBe("seat-0-wins");
    expect(r.joins).toEqual([0, 1]);
    expect(r.seats).toEqual([
      { index: 0, devices: ["keyboard"] },
      { index: 1, devices: ["pad:0"] },
    ]);
    expect(r.actions).toEqual(["move"]);
    expect(r.seat1First).toEqual([11, "v", 0, 800, -600]);
    expect(r.migrated).toBeNull();
    expect(r.replayed).toBe(true);
    expect(r.ticksWithInput).toBeGreaterThan(2);
  });

  it("tabletop-game.ts takes dropped cards as commands and a click back through the pointer", async () => {
    const { dealAndTake } = await import("../examples/tabletop-game");
    const r = dealAndTake();
    expect(r.final).toEqual({ table: [{ card: "king", at: [4, 1.5] }], hover: [3, 1] });
    expect(r.firstSample).toEqual([2, "p", 20500, 15000, 0, 1]);
    expect(r.samples).toBeGreaterThan(1);
  });

  it("hand-drop.ts sends a drop as a command at the world point under it", async () => {
    const { dealFromHand } = await import("../examples/hand-drop");
    const { window } = await dom(`<div id="hand"><span data-card="ace">A</span></div>`);
    const hand = window.document.getElementById("hand")!;
    const tracking: boolean[] = [];
    const sent: unknown[] = [];
    const game = {
      clientToWorld: (x: number, y: number) => ({ x: x / 100 + 1 / 3, y: y / 100 }),
      input: { trackPointer: (on: boolean) => void tracking.push(on) },
      send: (command: unknown) => (sent.push(command), true),
    } as unknown as Parameters<typeof dealFromHand>[0];
    const stop = dealFromHand(game, hand);
    const card = hand.querySelector("span")!;
    card.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
    window.document.dispatchEvent(
      new window.MouseEvent("pointerup", { bubbles: true, clientX: 250, clientY: 120 }),
    );
    stop();
    expect(tracking).toEqual([true, false]);
    expect(sent).toEqual([{ name: "play-card", args: { card: "ace", at: [2.833333, 1.2] } }]);
  });

  it("touch-pad.ts reports the stick and the button from touches", async () => {
    const { window } = await dom(`<div id="frame"></div>`);
    const { mountPad } = await import("../examples/touch-pad");
    const frame = window.document.getElementById("frame")!;
    frame.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 1000,
        height: 500,
        right: 1000,
        bottom: 500,
        x: 0,
        y: 0,
      }) as DOMRect;
    const { pad, seen } = mountPad(frame);
    const touch = (target: EventTarget, type: string, id: number, x: number, y: number) =>
      target.dispatchEvent(
        new window.PointerEvent(type, {
          pointerId: id,
          pointerType: "touch",
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }),
      );
    const node = (id: string) => frame.querySelector(`[data-touch-control="${id}"]`)!;
    // The stick is centred at (100, 400) with a 75 px radius; the button at (775, 400).
    touch(node("stick"), "pointerdown", 1, 100, 400);
    touch(window, "pointermove", 1, 175, 400);
    touch(node("taunt"), "pointerdown", 2, 775, 400);
    touch(window, "pointerup", 2, 775, 400);
    expect(pad.hitTest(100, 400)).toBe("stick");
    pad.destroy();
    expect(seen).toEqual([
      ["stick", { x: 1, y: 0 }],
      ["taunt", { down: true }],
      ["taunt", { down: false }],
      ["stick", { x: 0, y: 0 }],
    ]);
  });

  it("remapping.ts resolves the four layers, catches a key typo and maps 0.x keys", async () => {
    const { layers } = await import("../examples/remapping");
    expect(layers()).toEqual({
      move: "host",
      taunt0: ["map", [{ device: "key", code: "KeyQ" }]],
      taunt1: ["remap", [{ device: "key", code: "Backslash", player: 1 }]],
      typo: ['unknown key code "space"; did you mean "Space"?'],
      shift: ["ShiftLeft", "ShiftRight"],
    });
  });

  it("remapping.ts's prompt rebinds the captured key, and gives up on Escape", async () => {
    const { remapPrompt } = await import("../examples/remapping");
    const bound: unknown[] = [];
    const prompt = (captured: unknown) =>
      ({
        input: {
          capture: async () => captured,
          rebind: (action: string, bindings: unknown, opts: unknown) => {
            bound.push([action, bindings, opts]);
            return { ok: true };
          },
        },
      }) as unknown as Parameters<typeof remapPrompt>[0];
    expect(await remapPrompt(prompt({ device: "key", code: "KeyJ" }), "taunt", 1)).toBe("bound");
    expect(await remapPrompt(prompt(null), "taunt")).toBe("cancelled");
    expect(bound).toEqual([["taunt", [{ device: "key", code: "KeyJ" }], { player: 1 }]]);
  });

  it("metric-units.ts rounds, snaps and scales at 32 px per metre", async () => {
    const { units } = await import("../examples/metric-units");
    expect(units()).toEqual({
      ppm: 32,
      snapped: [0.5, 0.5],
      fromPx: 1.5,
      whole: [true, false],
      decimals: [2, 5],
      scaled: { speed: 10, count: 3 },
    });
  });
});

describe("the UI example runs", () => {
  type Listener = (e: UiActionEvent) => void;

  async function mountFerry(opts: { reducedMotion?: boolean } = {}) {
    const { mountFerryHud } = await import("../examples/dom-hud");
    const { window } = await dom(
      `<div id="stage" style="position: relative"><canvas></canvas></div>`,
    );
    if (opts.reducedMotion) {
      window.matchMedia = ((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
      })) as unknown as typeof window.matchMedia;
    }
    const canvas = window.document.querySelector("canvas")!;
    const store = new Store({ game: null } as unknown as GameStoreState);
    const sent: unknown[] = [];
    const listeners: { fn: Listener; actions?: readonly string[] }[] = [];
    const game = {
      getStore: () => store,
      project: () => ({ settings: { boatName: "Molly" } }),
      send: (command: unknown) => (sent.push(command), true),
      worldToClient: (p: { x: number; y: number }) => ({ x: p.x * 100, y: p.y * 100 }),
      input: {
        onAction(fn: Listener, o?: { actions?: readonly string[] }) {
          const entry = { fn, actions: o?.actions };
          listeners.push(entry);
          return () => void listeners.splice(listeners.indexOf(entry), 1);
        },
      },
    } as unknown as GameInstance;
    const before = store.listeners.size;
    const unmount = mountUi(game, canvas, mountFerryHud);
    const emit = (e: Partial<UiActionEvent>) => {
      for (const l of [...listeners]) {
        if (!l.actions || l.actions.includes(e.action!)) l.fn(e as UiActionEvent);
      }
    };
    const slice = (game: FerrySlice | null) => store.setState((s) => ({ ...s, game }));
    const q = <T extends Element>(sel: string) => window.document.querySelector<T>(sel)!;
    return { window, store, before, sent, listeners, unmount, emit, slice, q };
  }

  it("dom-hud.ts follows the slice, sends cross and toggles help on the UI action", async () => {
    const h = await mountFerry();
    const status = h.q<HTMLElement>("[data-jams-ui] [role=status]");
    const cross = h.q<HTMLButtonElement>("[data-jams-ui] button");
    const tag = h.q<HTMLElement>("[data-jams-ui] span");
    const help = h.q<HTMLElement>("[data-jams-ui] aside");
    expect(h.q<HTMLElement>("[data-jams-ui] div").dataset.motion).toBe("full");
    expect(status.textContent).toBe("Loading the ferry");
    expect(cross.disabled).toBe(true);
    expect(cross.style.pointerEvents).toBe("auto");
    expect(tag.textContent).toBe("Molly");
    expect(tag.style.visibility).toBe("hidden");

    h.slice({ turn: 1, boat: [2, 1.5], aboard: 3, canCross: true, result: null });
    expect(status.textContent).toBe("Turn 1 · 3 aboard");
    expect(cross.disabled).toBe(false);
    expect(tag.style.visibility).toBe("");
    expect(tag.style.transform).toBe("translate(200px, 100px)");

    cross.click();
    expect(h.sent).toEqual([{ name: "cross" }]);

    expect(h.listeners.map((l) => l.actions)).toEqual([["help"]]);
    h.emit({ action: "help", down: true });
    expect(help.hidden).toBe(false);
    h.emit({ action: "help", down: true, repeat: true });
    h.emit({ action: "help", down: false });
    expect(help.hidden).toBe(false);
    h.emit({ action: "help", down: true });
    expect(help.hidden).toBe(true);

    h.slice({ turn: 2, boat: [6, 1.5], aboard: 0, canCross: false, result: "won" });
    expect(status.textContent).toBe("Everyone is across");
    expect(cross.disabled).toBe(true);
    expect(tag.style.transform).toBe("translate(600px, 100px)");

    h.unmount();
    expect(h.window.document.querySelector("[data-jams-ui]")).toBeNull();
    expect(h.listeners).toEqual([]);
    expect(h.store.listeners.size).toBe(h.before);
  });

  it("dom-hud.ts marks reduced motion when the page prefers it", async () => {
    const h = await mountFerry({ reducedMotion: true });
    expect(h.q<HTMLElement>("[data-jams-ui] div").dataset.motion).toBe("reduced");
    h.unmount();
  });
});

describe("the scene flow and save examples run", () => {
  it("scene-flow.ts walks title → harbour → ending → title, the cellar attached in the harbour", async () => {
    const { deliveryRound } = await import("../examples/scene-flow");
    const r = deliveryRound();
    expect(r.visited).toEqual(["title", "harbour", "ending", "title"]);
    expect(r.ends.map((e) => [e.result, e.to, e.entry])).toEqual([
      ["flow", "harbour", "pier"],
      ["flow", "ending", undefined],
      ["flow", "title", undefined],
      ["script-end", undefined, undefined],
    ]);
    expect(r.persistAtStart).toEqual([
      { letters: 0 },
      { letters: 0 },
      { letters: 2 },
      { letters: 0 },
    ]);
    expect(r.sceneEnds[1]).toEqual({
      scene: "harbour",
      entry: "pier",
      arrivedAt: [0.5, 2.5],
      attached: ["cellar:barrel", "cellar:ladder"],
      sublevels: [],
      letters: 2,
    });
    expect(r.replayed).toBe(true);
    expect(r.final).toMatchObject({ scene: "title", letters: 0, sublevels: [] });
  });

  it("scene-flow.ts's source serves the list, its start and each listed scene", async () => {
    const { courierSource } = await import("../examples/scene-flow");
    const source = courierSource();
    expect(source.start()).toBe("title");
    expect(source.list().map((e) => e.scene)).toEqual(["title", "harbour", "ending", "cellar"]);
    expect(source.scene("cellar")?.def.name).toBe("cellar");
    expect(source.scene("nowhere")).toBeNull();
  });

  it("save-slots.ts resumes a world save to the same state, migrates and refuses a newer save", async () => {
    const { keepHive } = await import("../examples/save-slots");
    const r = await keepHive();
    expect(r.limits).toEqual({ maxBytes: 65_536, maxSlots: 8 });
    expect(r.slots).toEqual([
      ["auto", "Tick 49", 50],
      ["slot-1", "Before the swarm", 30],
    ]);
    expect(r.sameState).toBe(true);
    expect(r.honey).toBeGreaterThan(0);
    expect(r.progressHasWorld).toBe(false);
    expect(r.migrated).toEqual([1, { honey: 3 }]);
    expect(r.newer).toEqual(["save-version-newer"]);
  });

  it("save-slots.ts's menu shows where saves live and the next free slot, and Continue loads the newest", async () => {
    const { continueNewest, saveMenu } = await import("../examples/save-slots");
    const meta = (title: string, savedAt: number) => ({
      title,
      scene: "meadow",
      savedAt,
      playTicks: 0,
    });
    const loaded: string[] = [];
    const saves = (n: number) =>
      ({
        store: { kind: "memory", describe: "Saves last until this tab closes." },
        limits: { maxBytes: 65_536, maxSlots: 3 },
        list: async () =>
          Array.from({ length: n }, (_, i) => ({
            slot: `slot-${i + 1}`,
            meta: meta(`Day ${i + 1}`, [30, 10, 20][i]!),
            bytes: 2048,
          })),
        load: async (slot: string) => {
          loaded.push(slot);
          return { ok: true as const, meta: meta(slot, 0) };
        },
      }) as unknown as SaveSlots;
    expect(await saveMenu(saves(2))).toEqual({
      where: "Saves last until this tab closes.",
      rows: ["Day 1 · 2 KB", "Day 2 · 2 KB"],
      free: "slot-3",
    });
    expect((await saveMenu(saves(3))).free).toBeNull();
    expect(await continueNewest({ saves: saves(0) })).toBeNull();
    await continueNewest({ saves: saves(3) });
    expect(loaded).toEqual(["slot-1"]);
  });
});

/** The README's text from heading `name` to the next heading of the same depth. */
function readmeSection(name: string): string {
  const readme = readFileSync(README, "utf8");
  const depth = /^#+/.exec(name)![0];
  const start = readme.indexOf(`\n${name}\n`);
  expect(start, name).toBeGreaterThan(-1);
  const next = readme.slice(start + name.length + 2).search(new RegExp(`\n${depth} `));
  return next === -1 ? readme.slice(start) : readme.slice(start, start + name.length + 2 + next);
}

/** A Markdown table's body rows, each cell trimmed and its backticks taken out. */
function tableRows(markdown: string, header: string): string[][] {
  const at = markdown.indexOf(header);
  expect(at, header).toBeGreaterThan(-1);
  const lines = markdown.slice(at).split("\n");
  const rows: string[][] = [];
  for (const line of lines.slice(2)) {
    if (!line.startsWith("|")) break;
    rows.push(
      line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((c) => c.trim().replace(/`/g, "")),
    );
  }
  return rows;
}

describe("the saves section", () => {
  it("names the slot constants instead of restating their length", () => {
    const saves = readmeSection("## Saves");
    const slots = { SLOT_MAX_LENGTH, SLOT_PATTERN, SLOT_RULE };
    for (const [name, value] of Object.entries(slots)) {
      expect(value, name).toBeDefined();
      expect(saves).toContain(`\`${name}\``);
    }
    expect(saves).not.toMatch(/\b\d+\s+characters/);
  });
});

describe("the export section", () => {
  const MiB = 1024 * 1024;

  it("lists the targets the table builds, and the reserved ones as unbuilt", () => {
    const rows = tableRows(readmeSection("### Targets"), "| Target");
    const built = rows.filter((r) => r[3]!.startsWith("yes")).map((r) => r[0]);
    expect(built).toEqual(exportTargetNames());
    expect(rows.filter((r) => !r[3]!.startsWith("yes")).map((r) => r[0])).toEqual([
      "desktop",
      "mobile",
    ]);
  });

  it("states the budgets' numbers as DEFAULT_EXPORT_BUDGET has them", () => {
    const rows = tableRows(readmeSection("### Budgets"), "| Budget");
    const stated = Object.fromEntries(
      rows.map((r) => [r[0], Number(/^(\d+) MiB$/.exec(r[1]!)?.[1]) * MiB]),
    );
    expect(stated).toEqual(DEFAULT_EXPORT_BUDGET);
  });

  it("states itch.io's limits as ITCH_LIMITS has them", () => {
    const rows = tableRows(readmeSection("### itch.io"), "| Limit");
    const stated = Object.fromEntries(
      rows.map((r) => {
        const bytes = /\(([\d,]+) bytes\)/.exec(r[1]!)?.[1] ?? /^([\d,]+)/.exec(r[1]!)![1]!;
        return [r[0], Number(bytes.replace(/,/g, ""))];
      }),
    );
    expect(stated).toEqual(ITCH_LIMITS);
  });

  it("carries the size line verbatim, and names the site only as SITE does", () => {
    const section = readmeSection("## Export");
    expect(section).toContain(
      "A build's size is reported against its budget before anything is uploaded; jams.team's own limits are stated in its publish flow.",
    );
    expect(section).toContain("Not from `file://`: use a static server or a wrapper.");
    expect(section).toContain("An installed game keeps its saves in the same browser store");
    expect(readFileSync(README, "utf8")).not.toMatch(/(?<!git\.)\bbrackeys\.(community|dev)\b/i);
  });
});

describe("the export examples run", () => {
  /** The layout block's lines as patterns over a build's paths. */
  const LAYOUT = [
    /^index\.html$/,
    /^release\.json$/,
    /^app\.webmanifest$/,
    /^sw\.js$/,
    /^credits\.html$/,
    /^code\/[\w.-]+\.(js|css|wasm)$/,
    /^data\/[0-9a-f]{64}\.json$/,
    /^assets\/[0-9a-f]{64}\.\w+$/,
    /^icons\/icon-(192|512)\.png$/,
  ];

  it("export-targets.ts reads web and itch from their rows", async () => {
    const { targetRows } = await import("../examples/export-targets");
    expect(targetRows()).toEqual({
      rows: [
        { name: "web", pwa: true, layoutChecked: false },
        { name: "itch", pwa: false, layoutChecked: true },
      ],
      desktop: null,
      zipDefault: "itch",
    });
  });

  it("export-plan.ts plans the lane in the documented layout, a PWA only on the web", async () => {
    const { planLane } = await import("../examples/export-plan");
    const web = await planLane("web");
    expect(web.needsRapier).toBe(false);
    expect(web.issues).toEqual(["warn licence-missing"]);
    for (const line of web.files) {
      const path = line.split(" ")[0]!;
      expect(
        LAYOUT.some((p) => p.test(path)),
        path,
      ).toBe(true);
    }
    const roles = (files: string[]) =>
      files.map((f) => f.split(" ")).filter(([p]) => !/^(assets|data)\//.test(p!));
    expect(roles(web.files)).toEqual([
      ["app.webmanifest", "shell"],
      ["code/main-1a2b3c.js", "code"],
      ["credits.html", "shell"],
      ["icons/icon-192.png", "icon"],
      ["icons/icon-512.png", "icon"],
      ["index.html", "shell"],
      ["sw.js", "worker"],
    ]);
    expect(web.files.filter((f) => f.startsWith("data/"))).toHaveLength(3);
    expect(web.files.filter((f) => f.startsWith("assets/"))).toHaveLength(2);
    const m = web.plan.manifest;
    expect(m.build.rapier).toBeNull();
    expect(m.flow.scenes.map((s) => [s.id, s.physics])).toEqual([["lane", "none"]]);
    expect(m.pwa).toMatchObject({ name: "Lane Walk", shortName: "Lane", display: "fullscreen" });
    expect(m.credits).toEqual({
      assets: [{ assets: ["moss"], spdx: "CC0-1.0", author: "Ada" }],
      missing: ["lamp"],
      code: [{ package: "zod", version: "4.1.12", licence: "MIT", notice: "MIT License…" }],
    });

    const itch = await planLane("itch");
    expect(itch.plan.manifest.pwa).toBeNull();
    expect(itch.files.some((f) => /^(sw\.js|app\.webmanifest) /.test(f))).toBe(false);

    const desktop = await planLane("desktop");
    expect(desktop.issues).toContain("error export-target-unsupported");
  });

  it("export-plan.ts's shell pages hold no script of their own and no outside URL", async () => {
    const { planLane } = await import("../examples/export-plan");
    const { plan } = await planLane("web");
    const text = (path: string) => {
      const source = plan.files.find((f) => f.path === path)?.source;
      return source?.kind === "text" ? source.text : "";
    };
    const index = text("index.html");
    expect(index).toContain('<html lang="en">');
    expect(index).toContain("<title>Lane Walk</title>");
    expect(index).toContain('<link rel="manifest" href="app.webmanifest">');
    expect(index.match(/<script/g)).toHaveLength(1);
    expect(index).toContain('<script type="module" src="code/main-1a2b3c.js"></script>');
    const credits = text("credits.html");
    expect(credits).not.toContain("<script");
    expect(credits).toContain("No licence recorded");
    expect(credits).toContain("Made with @jams/engine");
    for (const page of [index, credits]) expect(page).not.toMatch(/https?:\/\//);
    expect(text("sw.js")).toContain(
      `jams-lane-${plan.manifest.build.hash.slice(0, 12)}-${plan.manifest.project.snapshot.slice(0, 12)}`,
    );
  });

  it("release-manifest.ts reads the lane's release back, refuses a changed hash and finds its release", async () => {
    const { laneRelease } = await import("../examples/release-manifest");
    expect(await laneRelease()).toEqual({
      sameId: true,
      read: [],
      tampered: ["hash-mismatch"],
      byId: true,
      bySnapshot: true,
      elsewhere: null,
    });
  });

  it("export-budget.ts resolves overrides and names what puts the lane over", async () => {
    const { budgets, tightLane } = await import("../examples/export-budget");
    expect(budgets()).toEqual({
      defaults: ["codeBytes 4 MB", "firstLoadBytes 16 MB", "totalBytes 100 MB", "fileBytes 32 MB"],
      limits: ["codeBytes 4 MB", "firstLoadBytes 16 MB", "totalBytes 50 MB", "fileBytes 8 MB"],
    });
    const tight = await tightLane();
    expect(tight.over).toEqual(["firstLoadBytes"]);
    expect(tight.files).toBe(12);
    expect(tight.messages).toHaveLength(1);
    expect(tight.messages[0]).toMatch(
      /^firstLoadBytes 5 KB over 4 KB: assets\/a{64}\.png 2 KB \(moss\), .*\. Lower the asset's size or raise export\.budget\.firstLoadBytes\.$/,
    );
  });

  it("itch-zip.ts passes a root build, refuses a nested one and zips the same bytes in any order", async () => {
    const { itchUpload } = await import("../examples/itch-zip");
    const r = itchUpload();
    expect(r.limits).toEqual(ITCH_LIMITS);
    expect(r.issues).toEqual([]);
    expect(r.nested).toEqual([
      `index.html is at "lane/index.html"; itch.io needs it at the zip's root, not in a folder`,
      `"lane/.DS_Store" is a dotfile or in a dot folder; itch.io builds ship neither`,
    ]);
    expect(r.zipBytes).toBeGreaterThan(0);
    expect(r.sameZip).toBe(true);
  });

  it("standalone-page.ts shows a refused boot's code and a Reload button", async () => {
    const { playLane } = await import("../examples/standalone-page");
    const { window } = await dom(`<div id="game"></div>`, "https://games.example.test/lane/");
    const root = window.document.getElementById("game")!;
    const asked: string[] = [];
    const notFound = async (url: string) => {
      asked.push(url);
      return new Response("not here", { status: 404 });
    };
    const game = await playLane(root, notFound as unknown as typeof fetch);
    expect(game).toBeNull();
    expect(asked).toEqual(["https://games.example.test/lane/release.json"]);
    expect(window.document.documentElement.dataset.jamsState).toBe("error");
    const alert = root.querySelector<HTMLElement>("[role=alert]")!;
    expect(alert.dataset.jamsError).toBe("export-asset-missing");
    expect(alert.querySelector("code")?.textContent).toBe("export-asset-missing");
    expect(alert.querySelector("button")?.textContent).toBe("Reload");
    expect(root.querySelector("[title]")).toBeNull();
    expect(root.querySelector("canvas")).toBeNull();
  });

  it("standalone-page.ts shows Install only while the browser offers it, and links the credits", async () => {
    const { laneMenu } = await import("../examples/standalone-page");
    const { window } = await dom(`<div></div>`, "https://games.example.test/lane/");
    let offered = false;
    let prompted = 0;
    const game = {
      get install() {
        return offered ? async () => (prompted++, (offered = false), true) : null;
      },
      credits: "credits.html",
    } as unknown as Parameters<typeof laneMenu>[0];
    const menu = laneMenu(game, window.document);
    const [install, credits] = [menu.querySelector("button")!, menu.querySelector("a")!];
    expect(install.hidden).toBe(true);
    expect(credits.getAttribute("href")).toBe("credits.html");
    offered = true;
    window.dispatchEvent(new window.Event("beforeinstallprompt"));
    await Promise.resolve();
    expect(install.hidden).toBe(false);
    install.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prompted).toBe(1);
    expect(install.hidden).toBe(true);
  });
});

describe("the graphics loss example runs", () => {
  it("graphics-loss.ts's overlay shows a status line and takes it away", async () => {
    const { restoringCard } = await import("../examples/graphics-loss");
    const { window } = await dom(`<div id="layer"></div>`);
    const layer = window.document.getElementById("layer")!;
    const shown = restoringCard(layer);
    expect(layer.querySelector("[role=status]")?.textContent).toContain("paused");
    shown.destroy();
    expect(layer.querySelector("[role=status]")).toBeNull();
  });

  it("graphics-loss.ts logs a loss, a rebuild on WebGL and the fallback", async () => {
    const { watchGraphics } = await import("../examples/graphics-loss");
    const handlers = new Map<string, (payload: unknown) => void>();
    const game = {
      on: (event: string, handler: (payload: unknown) => void) => void handlers.set(event, handler),
    } as unknown as Parameters<typeof watchGraphics>[0];
    const lines: string[] = [];
    watchGraphics(game, (line) => lines.push(line));
    handlers.get("render:lost")!({ backend: "webgpu" });
    handlers.get("render:fallback")!({ from: "webgpu", reason: "lost" });
    handlers.get("render:restored")!({ backend: "webgl", rebuilt: true });
    handlers.get("render:lost")!({ backend: "webgl" });
    handlers.get("render:restored")!({ backend: "webgl", rebuilt: false });
    expect(lines).toEqual([
      "lost webgpu: paused",
      "webgpu lost: WebGL from here on",
      "back on webgl, rebuilt: resumed",
      "lost webgl: paused",
      "back on webgl: resumed",
    ]);
  });
});

describe("the live levels section", () => {
  const live = () => readmeSection("## Live levels");
  const flat = () => live().replace(/\s+/g, " ");

  it("comes right after Publishing on jams.team", () => {
    const readme = readFileSync(README, "utf8");
    const headings = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    const at = headings.indexOf("Live levels");
    expect(headings.slice(at - 1, at + 2)).toEqual([
      `Publishing on ${SITE.name}`,
      "Live levels",
      "Graphics loss",
    ]);
  });

  it("names the timings as SwapTiming does, in clampTiming's order", () => {
    const rows = tableRows(live(), "| Timing");
    expect(rows.map((r) => r[0])).toEqual(["Next load", "At a boundary", "Now"]);
    const listed = rows.map((r) => /list "(\w+)" in live\.timings/.exec(r[2]!)?.[1] ?? null);
    expect(listed).toEqual([null, "boundary", "now"]);
    for (const t of ["boundary", "now"] as const) {
      expect(clampTiming({ timings: [] }, t)).toEqual({ timing: "next-load", clamped: true });
      expect(clampTiming({ timings: [t] }, t)).toEqual({ timing: t, clamped: false });
    }
  });

  it("states the site's limits as the live levels plan gives them", () => {
    expect(Object.fromEntries(tableRows(live(), "| Limit").map((r) => [r[0], r[1]]))).toEqual({
      "Data per version":
        "2 MB: the scene, its prefabs and the version file (art is the project's own assets)",
      "Versions per day": "100",
      "Versions kept": "the 5 newest of each scene, plus every version a channel points at",
      Storage: "part of the project's 512 MB of release storage",
      "A channel's size": "the release plus its live levels' new files stay within 100 MB",
    });
    const text = flat();
    for (const line of [
      "A version that is neither among its scene's 5 newest nor on a channel is removed 14 days after it was published.",
      "checks again every 60 seconds if its live connection drops (it reconnects every 60 minutes anyway).",
      "If 5 signed-in players' games fail after an update within 30 minutes of it going live (failing includes crashing within 10 seconds of the swap), and that is at least 25% of the signed-in players who reported,",
    ])
      expect(text).toContain(line);
  });

  it("states the engine's numbers as LIVE_DEFAULTS has them", () => {
    const text = flat();
    const seconds = LIVE_DEFAULTS.preloadTimeoutMs / 1000;
    expect(text).toContain(`The game has ${seconds} seconds to download, check and prepare`);
    expect(text).toContain(`preloaded within ${seconds} seconds`);
    const pct = LIVE_DEFAULTS.checkAt.map((f) => `${f * 100}%`);
    expect(text).toContain(`at ${pct.slice(0, -1).join(", ")} and ${pct.at(-1)} of each run`);
    expect(text).toContain(`steps ${LIVE_DEFAULTS.checkTicks} more ticks`);
    expect(text).toContain(`once ${LIVE_DEFAULTS.livePlayDebounceMs} ms pass without another`);
  });

  it("gives the CLI's usage as the tools have it, and Live in Play's tooltip", () => {
    const text = flat().replace(/` `/g, " ");
    for (const usage of [GAME_LIVE_BUILD_USAGE, GAME_LIVE_CHECK_USAGE])
      expect(text).toContain(`vp run scene ${usage}`);
    expect(text).toContain(
      '("Apply edits to the running game, the way players get a live update")',
    );
  });

  it("names the site only as SITE does, with no URL", () => {
    const section = live();
    const names = new Set(section.match(/\b[\w-]+\.team\b/g));
    expect([...names]).toEqual([SITE.name]);
    expect(section).not.toMatch(/https?:\/\//);
  });
});

describe("the live levels examples run", () => {
  it("ledge-live.ts lifts the runner out of the crate, reports it stuck without onSwap, and reloads on new bounds", async () => {
    const { checkCrate } = await import("../examples/ledge-live");
    const runs = (strategy: string, codes: string[]) =>
      [50, 100, 150].map((tick) => ({ tick, strategy, codes }));
    expect(await checkCrate()).toEqual({
      freed: { ok: true, runs: runs("reconcile", []) },
      stuck: { ok: false, runs: runs("reconcile", ["ledge/stuck"]) },
      longer: { ok: true, runs: runs("reload", []) },
    });
  });

  it("ledge-live.ts takes the crate on the tick after the runner's respawn", async () => {
    const { crateAtRespawn } = await import("../examples/ledge-live");
    expect(await crateAtRespawn()).toEqual({
      staged: true,
      timing: "boundary",
      waiting: ["boundary"],
      swappedAt: 451,
      current: true,
      x: 1,
      respawns: 1,
      swaps: ["boundary reconcile +crate"],
    });
  });
});
