import type { RapierModule } from "@jams/engine";
import type { SceneSystem, SceneView, SolidSystem, Style } from "@jams/engine/game";
import { createHeadlessRuntime } from "@jams/engine/headless";
import type { RuntimeEntity, ShapeObj } from "@jams/engine/scene";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createGrappleAnchorSystem } from "../entities/grapple-anchor";
import { createPlayerEntity, PLAYER_VIEW_ID } from "../entities/player";
import { createConstructSystem } from "../entities/shaper-constructs";
import { platformerGame, PLATFORMER_LAYERS, TYPE } from "../index";
import { createCloudSystem } from "../systems/cloud";
import { createShaperSystem } from "../systems/shaper";
import { withVisuals } from "../systems/visuals";

type Visual = { shape: ShapeObj; style: Style; layer: number | string; pose: number[] };

/** A `SceneView` keeping what is drawn now and counting draws per id. */
function recordingView() {
  const live = new Map<string, Visual>();
  const draws = new Map<string, number>();
  const view: SceneView = {
    draw(id, shape, style, layer) {
      live.set(id, { shape, style, layer, pose: live.get(id)?.pose ?? [0, 0, 0] });
      draws.set(id, (draws.get(id) ?? 0) + 1);
    },
    pose(id, x, y, rot = 0) {
      const v = live.get(id);
      if (v) v.pose = [x, y, rot];
    },
    remove: (id) => void live.delete(id),
    layer: () => ({ __viewLayer: true }),
  };
  return { view, live, draws };
}

function fakeSystem() {
  const live = new Set<string>();
  const system: SceneSystem<Shaped> & { calls: string[] } = {
    calls: [],
    spawn(e) {
      system.calls.push(`spawn ${e.id}`);
      live.add(e.id);
    },
    despawn(id) {
      system.calls.push(`despawn ${id}`);
      live.delete(id);
    },
    clear() {
      system.calls.push("clear");
      live.clear();
    },
    update() {},
    size: () => live.size,
  };
  return system;
}

type Shaped = RuntimeEntity<{ shape: ShapeObj }>;
const shape: ShapeObj = { type: "box", cx: 5, cy: 6, hw: 1, hh: 1, rotDeg: 0 };
const entity = (id: string): Shaped => ({ id, type: "thing", shape });

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

/** An empty platformer runtime, for its context. */
const emptyRuntime = () =>
  createHeadlessRuntime({
    rapier,
    game: platformerGame,
    scene: {
      name: "t",
      bounds: [0, 0, 1000, 1000],
      settings: {
        gravity: [0, 1200],
        physics: "rapier",
        grid: null,
        view: { projection: "orthogonal" },
      },
      entities: [],
    },
  });

describe("withVisuals", () => {
  it("draws each spawned entity into the view and drops it with the entity", () => {
    const { view, live } = recordingView();
    const inner = fakeSystem();
    const look = { fill: 1 };
    const { system } = withVisuals({ view }, inner, 7, () => look);

    system.spawn(entity("a"));
    system.spawn(entity("b"));
    expect(live.get("a")).toMatchObject({ shape, style: look, layer: 7 });
    expect([...live.keys()]).toEqual(["a", "b"]);

    system.despawn("a");
    expect([...live.keys()]).toEqual(["b"]);

    system.clear();
    expect(live.size).toBe(0);
    expect(inner.calls).toEqual(["spawn a", "spawn b", "despawn a", "clear"]);
  });

  it("redraws on refresh only the entities whose look changed", () => {
    const { view, live, draws } = recordingView();
    const dim = { fill: 2 };
    const bright = { fill: 3 };
    let dimmed = new Set<string>();
    const { system, visuals } = withVisuals({ view }, fakeSystem(), 0, (e) =>
      dimmed.has(e.id) ? dim : bright,
    );
    system.spawn(entity("a"));
    system.spawn(entity("b"));

    dimmed = new Set(["b"]);
    visuals.refresh();
    visuals.refresh();
    expect(live.get("b")?.style).toBe(dim);
    expect([draws.get("a"), draws.get("b")]).toEqual([1, 2]);
  });

  it("drops the update fast path, so an edit respawns and redraws", () => {
    const { system } = withVisuals({ view: recordingView().view }, fakeSystem(), 0, () => ({}));
    expect("update" in system).toBe(false);
  });

  it("is the system itself without a view", () => {
    const inner = fakeSystem();
    expect(withVisuals({ view: null }, inner, 0, () => ({})).system).toBe(inner);
  });
});

describe("platformer visuals through the view", () => {
  it("dims a cloud while the actor can pass through it", () => {
    const rt = emptyRuntime();
    const { view, live } = recordingView();
    const clouds = createCloudSystem({ ...rt.ctx, view }, rt.ctx.registry.types.get(TYPE.cloud)!);
    clouds.spawn({ id: "c", type: TYPE.cloud, shape: { ...shape, cx: 100, cy: 500, hw: 50 } });
    const solid = live.get("c")!;
    expect(solid.layer).toBe(PLATFORMER_LAYERS.cloud);

    (clouds as SolidSystem).gateOneWay(600, false);
    expect(live.get("c")!.style).not.toEqual(solid.style);
    clouds.reset?.();
    expect(live.get("c")!.style).toEqual(solid.style);
    rt.destroy();
  });

  it("draws anchors as two circles and the tether as a chain", () => {
    const { view, live } = recordingView();
    const anchors = createGrappleAnchorSystem({ view });
    anchors.add("a", { x: 10, y: 20 }, "scene");
    expect(live.get("a")).toMatchObject({
      shape: { type: "circle", cx: 10, cy: 20 },
      layer: PLATFORMER_LAYERS.anchor,
    });
    expect(live.get("a#core")?.shape).toMatchObject({ type: "circle", cx: 10, cy: 20 });

    anchors.drawTether({ x: 0, y: 0 }, { x: 10, y: 20 });
    const [tether] = [...live.entries()].filter(([id]) => id.includes("tether"));
    expect(tether[1]).toMatchObject({
      shape: {
        type: "chain",
        pts: [
          [0, 0],
          [10, 20],
        ],
      },
      layer: PLATFORMER_LAYERS.tether,
    });

    anchors.despawn("a");
    anchors.clearTether();
    expect(live.size).toBe(0);
  });

  it("poses every piece of a construct and removes them with it", () => {
    const rt = emptyRuntime();
    const { view, live } = recordingView();
    const constructs = createConstructSystem(
      { ...rt.ctx, view },
      rt.ctx.registry.types.get(TYPE.construct)!,
    );
    const id = constructs.place("wind_zone", { x: 300, y: 400 }, 0.5);
    const pieces = [...live.keys()].filter((k) => k === id || k.startsWith(`${id}#`));
    expect(pieces).toHaveLength(7);
    for (const k of pieces) expect(live.get(k)!.pose).toEqual([300, 400, 0.5]);
    expect(live.get(id)!.shape).toMatchObject({ type: "box", cx: 0, cy: 0 });

    constructs.despawn(id);
    expect(live.size).toBe(0);
    rt.destroy();
  });

  it("shows the Shaper's ghost at the cursor while a construct is selected", () => {
    const rt = emptyRuntime();
    const { view, live } = recordingView();
    const shaper = createShaperSystem({
      view,
      constructs: createConstructSystem(
        { ...rt.ctx, view: null },
        rt.ctx.registry.types.get(TYPE.construct)!,
      ),
      anchors: createGrappleAnchorSystem({ view: null }),
      bounds: [0, 0, 1000, 1000],
    });
    shaper.setActive(true);
    shaper.selectType("bridge");
    shaper.updatePreview({ x: 50, y: 60 }, 16);
    const [ghost] = [...live.values()];
    expect(ghost).toMatchObject({ layer: PLATFORMER_LAYERS.preview, pose: [50, 60, 0] });

    shaper.setActive(false);
    expect(live.size).toBe(0);
    rt.destroy();
  });

  it("draws the player at its spawn and removes it on destroy", () => {
    const rt = emptyRuntime();
    const { view, live } = recordingView();
    const player = createPlayerEntity({ ...rt.ctx, view }, { x: 100, y: 500 });
    const visual = live.get(PLAYER_VIEW_ID)!;
    expect(visual.layer).toBe(PLATFORMER_LAYERS.player);
    expect(visual.pose).toEqual([100, 470, 0]);

    for (let i = 0; i < 3; i++) {
      player.update(1000 / 60, []);
      rt.ctx.physics!.step();
    }
    expect(live.get(PLAYER_VIEW_ID)!.pose[1]).toBeGreaterThan(470);

    player.destroy();
    expect(live.has(PLAYER_VIEW_ID)).toBe(false);
    rt.destroy();
  });
});
