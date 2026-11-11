// @vitest-environment jsdom
import { createGame, type GameInstance, type RapierModule } from "@jams/engine";
import {
  createRegistry,
  type GameCommand,
  type SceneRuntimeHandle,
  type ToolEvent,
} from "@jams/engine/game";
import { createHeadlessRuntime, replayRecording } from "@jams/engine/headless";
import {
  expandScene,
  parseSceneOrThrow,
  type Bounds,
  type RunRecording,
  type SceneDefinition,
} from "@jams/engine/scene";
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGrappleAnchorSystem } from "../entities/grapple-anchor";
import {
  CONSTRUCT_CONFIGS,
  CONSTRUCT_TYPES,
  type ConstructSystem,
} from "../entities/shaper-constructs";
import { platformerGame, TYPE, type PlayerSnapshot } from "../index";
import { SHAPER_REFUSED } from "../runtime";
import testYard from "../scenes/test-yard.json";
import {
  createShaperSystem,
  SHAPER_PLACE,
  SHAPER_REMOVE,
  validatePlacement,
  zeroCounts,
} from "../systems/shaper";

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

const DT = 1000 / 60;
const registry = createRegistry(platformerGame);
const yardDoc = (): SceneDefinition => parseSceneOrThrow(structuredClone(testYard), registry);

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

function headless(): SceneRuntimeHandle {
  return createHeadlessRuntime({
    rapier,
    game: platformerGame,
    registry,
    scene: expandScene(yardDoc(), registry),
  });
}

const place = (type: string, at: [number, number], rot = 0, player?: number): GameCommand => ({
  name: SHAPER_PLACE,
  args: { type, at, rot },
  ...(player !== undefined && { player }),
});
const remove = (id: string): GameCommand => ({ name: SHAPER_REMOVE, args: { id } });

const constructsOf = (rt: SceneRuntimeHandle) => rt.ctx.system<ConstructSystem>(TYPE.construct)!;
const snapshot = (rt: SceneRuntimeHandle) => rt.snapshot() as PlayerSnapshot;

const BOUNDS: Bounds = [-20, -5, 40, 12];

describe("validatePlacement", () => {
  it("accepts a valid placement", () => {
    const result = validatePlacement(
      "bridge",
      { x: 5, y: 5 },
      zeroCounts(),
      0, // last placement
      1000, // current time (well past cooldown)
      BOUNDS,
    );
    expect(result.valid).toBe(true);
  });

  it("rejects when on cooldown", () => {
    const result = validatePlacement(
      "bridge",
      { x: 5, y: 5 },
      zeroCounts(),
      900, // placed 100ms ago
      1000,
      BOUNDS,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Cooldown");
  });

  it("accepts when cooldown has elapsed", () => {
    const result = validatePlacement(
      "bridge",
      { x: 5, y: 5 },
      zeroCounts(),
      400, // placed 600ms ago (> 500ms cooldown)
      1000,
      BOUNDS,
    );
    expect(result.valid).toBe(true);
  });

  it("rejects when max per round is reached", () => {
    const counts = zeroCounts();
    counts.bridge = CONSTRUCT_CONFIGS.bridge.maxPerRound; // 12
    const result = validatePlacement("bridge", { x: 5, y: 5 }, counts, 0, 1000, BOUNDS);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Max");
  });

  it("accepts when below max per round", () => {
    const counts = zeroCounts();
    counts.bridge = CONSTRUCT_CONFIGS.bridge.maxPerRound - 1;
    const result = validatePlacement("bridge", { x: 5, y: 5 }, counts, 0, 1000, BOUNDS);
    expect(result.valid).toBe(true);
  });

  it("rejects when out of bounds (x too high)", () => {
    const result = validatePlacement("bridge", { x: 50, y: 5 }, zeroCounts(), 0, 1000, BOUNDS);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("bounds");
  });

  it("rejects when out of bounds (y too low)", () => {
    const result = validatePlacement("bridge", { x: 5, y: -6 }, zeroCounts(), 0, 1000, BOUNDS);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("bounds");
  });

  it("respects per-type limits independently", () => {
    const counts = zeroCounts();
    counts.bounce_pad = CONSTRUCT_CONFIGS.bounce_pad.maxPerRound; // 4
    // Bounce pad should be rejected
    expect(validatePlacement("bounce_pad", { x: 5, y: 5 }, counts, 0, 1000, BOUNDS).valid).toBe(
      false,
    );
    // But bridge should still be accepted
    expect(validatePlacement("bridge", { x: 5, y: 5 }, counts, 0, 1000, BOUNDS).valid).toBe(true);
  });

  it("validates every construct type", () => {
    for (const type of CONSTRUCT_TYPES) {
      const result = validatePlacement(type, { x: 5, y: 5 }, zeroCounts(), 0, 1000, BOUNDS);
      expect(result.valid).toBe(true);
    }
  });
});

describe("validatePlacement bounds", () => {
  it("uses the bounds it is given", () => {
    const small: Bounds = [0, 0, 1, 1];
    expect(validatePlacement("bridge", { x: 5, y: 0.5 }, zeroCounts(), 0, 1000, small).valid).toBe(
      false,
    );
    expect(
      validatePlacement("bridge", { x: 0.5, y: 0.5 }, zeroCounts(), 0, 1000, small).valid,
    ).toBe(true);
  });
});

describe("the Shaper on commands", () => {
  it("places nothing itself: placing and removing send commands", () => {
    const rt = headless();
    const sent: GameCommand[] = [];
    const shaper = createShaperSystem({
      view: null,
      constructs: constructsOf(rt),
      anchors: createGrappleAnchorSystem({ view: null }),
      bounds: rt.ctx.bounds,
      send: (c) => (sent.push(c), true),
    });
    shaper.setActive(true);
    shaper.selectType("bridge");
    shaper.rotatePreview(2);
    shaper.updatePreview({ x: 5.1234567, y: 6 });
    expect(shaper.place()).toEqual({ valid: true });
    expect(sent).toEqual([place("bridge", [5.123457, 6], 18)]);
    expect(rt.ctx.query.byType(TYPE.construct)).toEqual([]);

    const pads = createShaperSystem({
      view: null,
      constructs: constructsOf(rt),
      anchors: createGrappleAnchorSystem({ view: null }),
      bounds: rt.ctx.bounds,
      send: () => false,
    });
    pads.setActive(true);
    pads.selectType("bounce_pad");
    pads.updatePreview({ x: 1, y: 1 });
    expect(pads.place()).toMatchObject({ valid: false });
    rt.destroy();
  });

  it("applies them on the tick as construct#<n> entities, and refuses what the rules don't allow", () => {
    const rt = headless();
    rt.step(DT, [], [place("bridge", [5, 6], 18), place("bounce_pad", [7, 6])]);
    // The second falls inside the first's cooldown.
    expect(constructsOf(rt).shaped()).toEqual(["construct#1"]);
    const bridge = rt.ctx.get("construct#1")!;
    expect(bridge).toMatchObject({
      type: TYPE.construct,
      construct: "bridge",
      at: [5, 6],
      rot: 18,
    });
    expect(constructsOf(rt).get("construct#1")).toMatchObject({ source: "runtime" });
    expect(snapshot(rt).constructs).toEqual(["construct#1"]);

    let events = rt.step(DT, [], [place("light_orb", [50, 6])]).events;
    expect(events.filter((e) => e.type === SHAPER_REFUSED)).toEqual([
      expect.objectContaining({
        at: { x: 50, y: 6 },
        player: 0,
        data: { command: SHAPER_PLACE, reason: expect.stringMatching(/Cooldown|bounds/) },
      }),
    ]);

    for (let i = 0; i < 40; i++) rt.step(DT, []);
    rt.step(DT, [], [place("wind_zone", [3, 4], 90, 1)]);
    expect(constructsOf(rt).shaped()).toEqual(["construct#1", "construct#2"]);
    expect(rt.ctx.get("construct#2")).toMatchObject({ construct: "wind_zone", rot: 90 });

    events = rt.step(DT, [], [remove("construct#1"), remove("construct#1")]).events;
    expect(rt.ctx.exists("construct#1")).toBe(false);
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining([SHAPER_REFUSED, "entity:destroyed"]),
    );
    expect(constructsOf(rt).shaped()).toEqual(["construct#2"]);

    // The scene's own entities aren't the Shaper's to remove.
    events = rt.step(DT, [], [remove("pit-shuttle")]).events;
    expect(rt.ctx.exists("pit-shuttle")).toBe(true);
    expect(events.filter((e) => e.type === SHAPER_REFUSED)).toEqual([
      expect.objectContaining({
        entityId: "pit-shuttle",
        data: expect.objectContaining({ command: SHAPER_REMOVE }),
      }),
    ]);
    rt.destroy();
  });

  it("refuses a type past its per-round limit, counting only the live ones", () => {
    const rt = headless();
    const { maxPerRound } = CONSTRUCT_CONFIGS.shield_barrier;
    const wait = () => {
      for (let i = 0; i < 31; i++) rt.step(DT, []);
    };
    for (let i = 0; i < maxPerRound; i++) {
      rt.step(DT, [], [place("shield_barrier", [i, 2])]);
      wait();
    }
    expect(constructsOf(rt).shaped()).toHaveLength(maxPerRound);
    const events = rt.step(DT, [], [place("shield_barrier", [9, 2])]).events;
    expect(events.find((e) => e.type === SHAPER_REFUSED)?.data).toMatchObject({
      reason: expect.stringContaining("Max"),
    });
    wait();
    rt.step(DT, [], [remove("construct#1")]);
    rt.step(DT, [], [place("shield_barrier", [9, 2])]);
    expect(constructsOf(rt).shaped()).toHaveLength(maxPerRound);
    rt.destroy();
  });

  it("picks the Shaper's constructs under the pointer, never the scene's", () => {
    const rt = headless();
    rt.step(DT, [], [place("bridge", [5, 6], 90)]);
    for (let i = 0; i < 31; i++) rt.step(DT, []);
    rt.step(DT, [], [place("grapple_anchor", [8, 3])]);
    const sent: GameCommand[] = [];
    const shaper = createShaperSystem({
      view: null,
      constructs: constructsOf(rt),
      anchors: rt.ctx.system(TYPE.anchor)!,
      bounds: rt.ctx.bounds,
      send: (c) => (sent.push(c), true),
    });
    // Turned 90°, the bridge stands upright.
    expect(shaper.removableAt({ x: 5, y: 6.5 })).toBe("construct#1");
    expect(shaper.removableAt({ x: 5.5, y: 6 })).toBeUndefined();
    expect(shaper.removableAt({ x: 8.1, y: 3.05 })).toBe("construct#2");
    // A scene anchor sits at (6, 6).
    expect(shaper.removableAt({ x: 6, y: 6 })).toBeUndefined();

    shaper.updatePreview({ x: 5, y: 6.5 });
    expect(shaper.hovered()).toBe("construct#1");
    expect(shaper.remove()).toBe(true);
    expect(sent).toEqual([remove("construct#1")]);
    rt.destroy();
  });

  it("places the same constructs when the same commands replay", () => {
    const script: [number, GameCommand[]][] = [
      [3, [place("bridge", [5, 9.8], 9)]],
      [40, [place("bounce_pad", [9.6, 9.9])]],
      // Inside the bounce pad's cooldown: refused, the same way each run.
      [41, [place("light_orb", [2, 2])]],
      [80, [remove("construct#1"), place("wind_zone", [10, 9], 27)]],
    ];
    const run = () => {
      const rt = headless();
      const snaps: string[] = [];
      for (let tick = 0; tick < 120; tick++) {
        const commands = script.find(([t]) => t === tick)?.[1] ?? [];
        rt.step(DT, [], commands);
        snaps.push(JSON.stringify(rt.snapshot()));
      }
      const placed = constructsOf(rt)
        .shaped()
        .map((id) => ({ entity: rt.ctx.get(id), pose: rt.ctx.poses.get(id) }));
      rt.destroy();
      return { snaps, placed };
    };
    const first = run();
    expect(first.placed.map((p) => p.entity?.id)).toEqual(["construct#2", "construct#3"]);
    expect(run()).toEqual(first);
  });
});

describe("a recorded Shaper session", () => {
  const games: GameInstance[] = [];

  beforeEach(() => {
    document.body.appendChild(document.createElement("canvas"));
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    for (const g of games.splice(0)) g.destroy();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  const key = (k: string, type: "down" | "up" = "down"): ToolEvent => ({
    kind: "key",
    type,
    key: k,
    native: new KeyboardEvent(`key${type}`, { key: k }),
  });

  const pointer = (type: "down" | "move" | "up", x: number, y: number, button = 0): ToolEvent => ({
    kind: "pointer",
    type,
    screen: { x, y },
    button: type === "move" ? -1 : button,
    deltaY: 0,
    native: new MouseEvent(`pointer${type}`, { button }),
  });

  it("records placements as commands and replays to the same digest in the shell and headless", async () => {
    const game = await createGame(document.querySelector("canvas")!, {
      game: platformerGame,
      registry,
      rapier: async () => rapier,
      scene: yardDoc(),
    });
    games.push(game);
    game.start();
    game.stop();
    const recorded: RunRecording[] = [];
    game.on("play:recorded", (r) => recorded.push(r));
    const doc = yardDoc();

    expect(game.play(doc)).toMatchObject({ ok: true });
    game.step(2);
    game.router.dispatch(key("Tab"));
    game.router.dispatch(key("1"));
    game.router.dispatch(pointer("move", 0, 0));
    game.step(2);
    game.router.dispatch(pointer("down", 0, 0));
    game.router.dispatch(pointer("up", 0, 0));
    game.step(40);
    game.router.dispatch(key("2"));
    game.router.dispatch(pointer("move", 40, 10));
    game.step(1);
    game.router.dispatch(pointer("down", 40, 10));
    game.router.dispatch(pointer("up", 40, 10));
    game.step(5);
    const live = game.runtime()!;
    const shaped = () => (game.runtime()!.snapshot() as PlayerSnapshot).constructs;
    expect(shaped()).toEqual(["construct#1", "construct#2"]);
    const bridge = live.get("construct#1");
    expect(bridge).toMatchObject({ construct: "bridge" });
    expect(live.get("construct#2")).toMatchObject({ construct: "bounce_pad" });

    // With nothing picked, a right click on a placed construct removes it.
    game.router.dispatch(key("Escape"));
    game.step(1);
    game.router.dispatch(pointer("down", 40, 10, 2));
    game.step(3);
    expect(shaped()).toEqual(["construct#1"]);
    game.stop();

    expect(recorded).toHaveLength(1);
    const rec = recorded[0]!;
    expect(rec.commands).toEqual(expect.arrayContaining([SHAPER_PLACE, SHAPER_REMOVE]));
    const sends = rec.inputs[0]!.filter((e) => e[1] === "c");
    expect(sends).toHaveLength(3);
    expect(sends[2]).toEqual([
      expect.any(Number),
      "c",
      rec.commands.indexOf(SHAPER_REMOVE),
      { id: "construct#2" },
    ]);

    expect(game.replay(doc, rec)).toMatchObject({ ok: true });
    game.router.dispatch(pointer("down", 90, 90));
    game.step(rec.ticks);
    expect(recorded).toHaveLength(2);
    expect(recorded[1]!.end).toBe(rec.end);
    expect(recorded[1]!.inputs).toEqual(rec.inputs);
    expect(shaped()).toEqual(["construct#1"]);
    expect(game.runtime()!.get("construct#1")).toEqual(bridge);

    const headlessRun = replayRecording<PlayerSnapshot>({
      rapier,
      game: platformerGame,
      registry,
      scene: doc,
      recording: rec,
    });
    if (headlessRun.blocked) throw new Error("replay blocked");
    expect(headlessRun.matches, headlessRun.divergence ?? "").toBe(true);
    expect(headlessRun.final?.constructs).toEqual(["construct#1"]);
  });
});
