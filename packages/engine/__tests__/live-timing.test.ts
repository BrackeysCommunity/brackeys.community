// @vitest-environment jsdom
import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { defineGame } from "../game/define";
import type { LiveDeclaration, SceneSwap } from "../game/live";
import type { GameDefinition } from "../game/types";
import { liveIssue } from "../scene/issues";
import type { GameEventMap, GameInstance, StagedVersion } from "../types";
import { installLiveGames, noopLoader, world } from "./fixtures/live-game";
import { markerScene, markerSource, oneSceneVersion } from "./fixtures/live-version";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

/** A physics-free game whose `safe` command marks a live boundary and whose `go` changes scene. */
function liveGame(log: string[], live?: LiveDeclaration): GameDefinition {
  return defineGame({
    id: "livy",
    types: [],
    actions: [],
    world: { physics: "none" },
    ...(live ? { live } : {}),
    commands: {
      safe: { description: "Marks a safe moment.", args: z.strictObject({}) },
      go: {
        description: "Requests a scene.",
        args: z.strictObject({ to: z.string().describe("The scene.") }),
      },
    },
    createRuntime(ctx) {
      return {
        onLoad(scene) {
          log.push(`load ${scene.name} ${ctx.exists("well") ? "with" : "without"} well`);
        },
        beforeStep(_dt, _actions, commands) {
          for (const c of commands) {
            if (c.name === "safe") ctx.live.boundary("checkpoint");
            if (c.name === "go") ctx.flow.request({ to: (c.args as { to: string }).to });
          }
        },
        afterStep() {
          log.push(`tick ${ctx.tick} ${ctx.exists("well") ? "with" : "without"} well`);
        },
        onSwap(swap) {
          log.push(`onSwap ${swap.strategy} +${swap.diff.added.join(",")} at ${swap.tick}`);
        },
        snapshot: () => null,
      };
    },
  });
}

const ALL: LiveDeclaration = { timings: ["boundary", "now"] };

/** A version of `id` with a `well` marker added, as a host hands it to `stage`. */
const wellVersion = (game: GameDefinition, id = "hall"): Promise<StagedVersion> =>
  oneSceneVersion(markerScene(id, ["start", "well"]), game, { scene: id });

const startedLiveGame = installLiveGames();

type Live = {
  game: GameInstance;
  def: GameDefinition;
  log: string[];
  swaps: SceneSwap[];
  failed: GameEventMap["live:failed"][];
};

/** A started game on its start scene, with every swap and failure collected. */
async function started(live?: LiveDeclaration): Promise<Live> {
  const log: string[] = [];
  const def = liveGame(log, live);
  const swaps: SceneSwap[] = [];
  const failed: GameEventMap["live:failed"][] = [];
  const game = await startedLiveGame(def, {
    source: markerSource(["hall", "yard"]),
    loader: noopLoader(),
    beforeLoad(g) {
      g.on("live:swapped", (s) => swaps.push(s));
      g.on("live:failed", (f) => failed.push(f));
    },
  });
  log.length = 0;
  return { game, def, log, swaps, failed };
}

async function staged(t: Live, id = "hall"): Promise<StagedVersion> {
  const v = await wellVersion(t.def, id);
  expect(await t.game.live.stage(v)).toEqual({ ok: true });
  return v;
}

describe("next-load", () => {
  it("never touches the running world, and the next restart loads the version", async () => {
    const t = await started(ALL);
    const v = await staged(t);
    expect(t.game.live.activate("hall", v.id, "next-load")).toMatchObject({
      timing: "next-load",
      clamped: false,
    });
    expect(t.game.live.current("hall")).toBe(v.id);
    expect(t.game.live.pending()).toEqual([]);

    t.game.step(3);
    expect(world(t.game).get("well")).toBeUndefined();
    expect(world(t.game).ctx.live.version).toBeNull();
    expect(t.swaps).toEqual([]);

    const done = t.game.flow.restart();
    await vi.runAllTimersAsync();
    expect(await done).toMatchObject({ ok: true, scene: "hall" });
    expect(t.log).toContain("load hall with well");
    expect(world(t.game).get("well")).toBeDefined();
    expect(world(t.game).ctx.live.version).toBe(v.id);
    expect(t.swaps).toEqual([]);
  });

  it("reaches a scene that isn't running at its next load", async () => {
    const t = await started(ALL);
    const v = await staged(t, "yard");
    expect(t.game.live.activate("yard", v.id, "now")).toMatchObject({ timing: "now" });
    t.game.step();
    expect(t.swaps).toEqual([]);
    const done = t.game.flow.go("yard");
    await vi.runAllTimersAsync();
    expect(await done).toMatchObject({ ok: true, scene: "yard" });
    expect(world(t.game).get("well")).toBeDefined();
  });
});

describe("boundary", () => {
  it("swaps after the tick that called boundary(), and not before", async () => {
    const t = await started(ALL);
    const v = await staged(t);
    t.game.live.activate("hall", v.id, "boundary");
    t.game.step(3);
    expect(t.swaps).toEqual([]);
    expect(t.game.live.pending()).toEqual([{ scene: "hall", version: v.id, timing: "boundary" }]);

    const tick = world(t.game).ctx.tick;
    t.log.length = 0;
    t.game.send({ name: "safe", args: {} });
    t.game.step();
    // The tick that marked the boundary ran on the old world; the swap came after it.
    expect(t.log).toEqual([`tick ${tick} without well`, `onSwap reconcile +well at ${tick + 1}`]);
    expect(t.swaps).toMatchObject([
      { scene: "hall", timing: "boundary", strategy: "reconcile", tick: tick + 1 },
    ]);
    expect(t.swaps[0]?.to.version).toBe(v.id);
    expect(t.swaps[0]?.from.version).toBeNull();
    expect(world(t.game).ctx.live.version).toBe(v.id);
    expect(t.game.live.pending()).toEqual([]);
  });
});

describe("now", () => {
  it("swaps after the current tick, once, keeping the camera where it was", async () => {
    const t = await started(ALL);
    const v = await staged(t);
    t.game.step();
    const camera = { ...t.game.getStore().state.camera };
    t.game.live.activate("hall", v.id, "now");
    expect(world(t.game).get("well")).toBeUndefined();

    const tick = world(t.game).ctx.tick;
    t.log.length = 0;
    t.game.step();
    expect(t.log).toEqual([`tick ${tick} without well`, `onSwap reconcile +well at ${tick + 1}`]);
    expect(t.swaps).toHaveLength(1);
    expect(t.swaps[0]).toMatchObject({
      timing: "now",
      carried: "all",
      diff: { added: ["well"], removed: [], changed: [], header: false },
    });
    expect(world(t.game).get("well")).toBeDefined();
    expect(t.game.getStore().state.camera.zoom).toBe(camera.zoom);
    expect(t.game.getStore().state.camera.position).toEqual(camera.position);

    t.game.step(2);
    expect(t.swaps).toHaveLength(1);
    expect(t.log.filter((l) => l.startsWith("onSwap"))).toHaveLength(1);
  });

  it("doesn't swap while the loop is paused, and swaps once it runs again", async () => {
    const t = await started(ALL);
    const v = await staged(t);
    t.game.live.activate("hall", v.id, "now");
    t.game.pause();
    t.game.step(3);
    expect(t.swaps).toEqual([]);
    expect(world(t.game).get("well")).toBeUndefined();
    t.game.resume();
    t.game.step();
    expect(t.swaps).toHaveLength(1);
    expect(world(t.game).get("well")).toBeDefined();
  });
});

describe("a game without live", () => {
  it("clamps every timing to next-load with live-timing-unsupported", async () => {
    const t = await started();
    const v = await staged(t);
    const out = t.game.live.activate("hall", v.id, "now");
    expect(out).toMatchObject({ timing: "next-load", clamped: true });
    expect(
      liveIssue({ code: "live-timing-unsupported", version: v.id, accepted: [] }),
    ).toMatchObject({ code: "live-timing-unsupported", severity: "warn" });
    expect(t.game.live.pending()).toEqual([]);
    t.game.step(3);
    expect(t.swaps).toEqual([]);
    expect(world(t.game).get("well")).toBeUndefined();

    await t.game.flow.restart();
    await vi.runAllTimersAsync();
    expect(world(t.game).get("well")).toBeDefined();
  });
});

describe("a flow change", () => {
  it("to the same scene loads the version and drops the pending swap", async () => {
    const t = await started(ALL);
    const v = await staged(t);
    t.game.live.activate("hall", v.id, "boundary");
    expect(t.game.live.pending()).toHaveLength(1);

    t.game.send({ name: "go", args: { to: "hall" } });
    t.game.send({ name: "safe", args: {} });
    t.game.step();
    // The request runs first: the change holds the swap, and its load uses the version.
    expect(t.swaps).toEqual([]);
    await vi.runAllTimersAsync();
    expect(t.game.flow.current()).toBe("hall");
    expect(t.log).toContain("load hall with well");
    expect(t.game.live.pending()).toEqual([]);
    expect(t.game.live.current("hall")).toBe(v.id);

    t.game.send({ name: "safe", args: {} });
    t.game.step(2);
    expect(t.game.live.pending()).toEqual([]);
    expect(t.swaps).toEqual([]);
    expect(t.log.some((l) => l.startsWith("onSwap"))).toBe(false);
    expect(t.failed).toEqual([]);
  });
});
