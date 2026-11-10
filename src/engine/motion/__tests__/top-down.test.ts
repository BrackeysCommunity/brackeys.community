import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../../game/define";
import type { GameDefinition } from "../../game/types";
import { createSceneRuntime } from "../../runtime/runtime";
import { expandScene } from "../../scene/expand";
import type { EntityDef, SceneDefinition } from "../../scene/types";
import type { RapierModule, Vec2 } from "../../types";
import { createMotionBody } from "../body";
import { createTopDownController } from "../top-down";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;
const BOX = { type: "box", cx: 0, cy: 0, hw: 6, hh: 6, rotDeg: 0 } as const;
const TUNING = { maxSpeed: 120, accel: 600, decel: 300 };

const game: GameDefinition = defineGame({
  id: "topdown",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});
const registry = createRegistry(game);

/** A wall whose left face is at x = 160, from y = 0 to 200, in a 320 × 320 room of 32 px cells. */
function loaded(physics: "rapier" | "none", entities: EntityDef[] = []) {
  const def: SceneDefinition = {
    v: 3,
    game: "topdown",
    name: "top-down",
    bounds: [0, 0, 320, 320],
    settings: { gravity: [0, 0], physics, grid: { kind: "square", cell: [32, 32] } },
    entities,
  };
  const rt = createSceneRuntime({ rapier, view: null, game });
  expect(rt.load(expandScene(def, registry))).toMatchObject({ ok: true });
  return rt;
}

const WALL = { id: "wall", type: "solid", shape: ["box", 165, 100, 5, 100] } as EntityDef;

function rig(physics: "rapier" | "none", at: Vec2 = { x: 48, y: 48 }) {
  const rt = loaded(physics, [WALL]);
  const body = createMotionBody(rt.ctx, { id: "rover", type: "rover" }, at, { shape: BOX });
  return { rt, body, ctl: createTopDownController(body, TUNING) };
}

const speed = (v: Vec2) => Math.sqrt(v.x * v.x + v.y * v.y);

describe("the top-down controller", () => {
  it("accelerates to max speed and holds it", () => {
    const { rt, body, ctl } = rig("none");
    const speeds: number[] = [];
    for (let i = 0; i < 14; i++) {
      const r = ctl.step(DT, { x: 1, y: 0 });
      speeds.push(ctl.velocity().x);
      expect(r.moved.x).toBeCloseTo((ctl.velocity().x * DT) / 1000, 9);
    }
    expect(speeds.map((s) => Math.round(s * 1000) / 1000)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 120, 120,
    ]);
    expect(ctl.velocity().y).toBe(0);
    expect(rt.ctx.poses.get("rover")).toMatchObject(body.position());
    rt.destroy();
  });

  it("decelerates to rest without overshooting", () => {
    const { rt, ctl } = rig("none");
    for (let i = 0; i < 12; i++) ctl.step(DT, { x: 0, y: 1 });
    expect(ctl.velocity().y).toBeCloseTo(120, 9);
    const speeds: number[] = [];
    for (let i = 0; i < 26; i++) {
      ctl.step(DT, { x: 0, y: 0 });
      speeds.push(Math.round(ctl.velocity().y * 1000) / 1000);
    }
    expect(speeds.slice(0, 3)).toEqual([115, 110, 105]);
    expect(speeds.slice(22)).toEqual([5, 0, 0, 0]);
    expect(ctl.step(DT, { x: 0, y: 0 })).toEqual({
      moved: { x: 0, y: 0 },
      hits: [],
      blocked: false,
    });
    rt.destroy();
  });

  it("clamps a diagonal intent to the unit disc, and takes a short one as it is", () => {
    const { rt, ctl } = rig("none", { x: 20, y: 20 });
    for (let i = 0; i < 30; i++) ctl.step(DT, { x: 1, y: 1 });
    expect(speed(ctl.velocity())).toBeCloseTo(120, 9);
    expect(ctl.velocity().x).toBeCloseTo(120 / Math.sqrt(2), 9);
    expect(ctl.velocity().y).toBeCloseTo(ctl.velocity().x, 12);
    for (let i = 0; i < 30; i++) ctl.step(DT, { x: 0, y: 0.5 });
    expect(ctl.velocity().x).toBeCloseTo(0, 9);
    expect(ctl.velocity().y).toBeCloseTo(60, 9);
    for (let i = 0; i < 30; i++) ctl.step(DT, { x: -3, y: 4 });
    expect(ctl.velocity().x).toBeCloseTo(-72, 9);
    expect(ctl.velocity().y).toBeCloseTo(96, 9);
    rt.destroy();
  });

  it("loses the velocity that heads into a wall and keeps the rest", () => {
    for (const physics of ["rapier", "none"] as const) {
      const { rt, ctl } = rig(physics, { x: 140, y: 48 });
      for (let i = 0; i < 30; i++) {
        ctl.step(DT, { x: 1, y: 1 });
        rt.step(DT, []);
      }
      expect(ctl.velocity().x, physics).toBeCloseTo(0, 6);
      expect(ctl.velocity().y, physics).toBeCloseTo(120 / Math.sqrt(2), 2);
      rt.destroy();
    }
  });

  it("refuses negative tuning", () => {
    const { rt, body } = rig("none");
    expect(() => createTopDownController(body, { ...TUNING, accel: -1 })).toThrow(/accel/);
    rt.destroy();
  });

  it("ends the same script in the same cell on both backends", () => {
    const script: [Vec2, number][] = [
      [{ x: 1, y: 0.4 }, 90],
      [{ x: 0, y: 1 }, 40],
      [{ x: 0.7, y: 0.7 }, 50],
      [{ x: -1, y: 0 }, 6],
      [{ x: 0, y: 0 }, 40],
    ];
    const run = (physics: "rapier" | "none") => {
      const { rt, body, ctl } = rig(physics);
      let walled = 0;
      for (const [intent, ticks] of script) {
        for (let i = 0; i < ticks; i++) {
          if (ctl.step(DT, intent).hits.some((h) => h.tag.entityId === "wall")) walled++;
          rt.step(DT, []);
        }
      }
      const at = body.position();
      const cell = rt.ctx.grid!.geometry.cellAt([at.x, at.y]);
      rt.destroy();
      return { at, cell, walled };
    };
    const onRapier = run("rapier");
    const onGeometry = run("none");
    expect(onRapier.walled).toBeGreaterThan(0);
    expect(onGeometry.walled).toBeGreaterThan(0);
    expect(onGeometry.cell).toEqual(onRapier.cell);
    expect(onRapier.cell).toEqual([6, 8]);
    // Rapier's controller loses a little travel on the ticks it meets the wall.
    expect(Math.abs(onGeometry.at.x - onRapier.at.x)).toBeLessThan(2);
    expect(Math.abs(onGeometry.at.y - onRapier.at.y)).toBeLessThan(2);
  });
});
