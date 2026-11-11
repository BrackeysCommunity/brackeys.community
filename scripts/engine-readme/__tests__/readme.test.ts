import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { mountUi, type GameInstance, type GameStoreState, type UiActionEvent } from "@jams/engine";
import {
  createProjectSession,
  docToScene,
  memoryDocHost,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
} from "@jams/engine/collab";
import { createRegistry } from "@jams/engine/game";
import { createKindRegistry, ENGINE_ASSET_KINDS, type AssetEntry } from "@jams/engine/project";
import type { SceneDefinition } from "@jams/engine/scene";
import { Store } from "@tanstack/store";
import { describe, expect, it } from "vite-plus/test";
import type * as Y from "yjs";

import { loadCompatRapier } from "../../scene/rapier-compat";
import type { FerrySlice } from "../examples/dom-hud";
import {
  formatReference,
  REFERENCE_END,
  REFERENCE_START,
  withReference,
} from "../format-reference";

/**
 * Keeps `src/engine/README.md` honest: the format reference is the
 * generator's output, and every `ts` block is a file in `examples/` that `vp
 * check` type-checks against the engine's public entries. After changing
 * either on purpose, run `UPDATE_README=1 vp test run scripts/engine-readme`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const README = join(REPO, "src/engine/README.md");
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
async function dom(html: string): Promise<Dom> {
  const { JSDOM } = (await import(/* @vite-ignore */ JSDOM_MODULE)) as {
    JSDOM: new (html: string) => Dom;
  };
  return new JSDOM(html);
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
