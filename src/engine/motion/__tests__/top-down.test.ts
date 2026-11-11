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
const BOX = { type: "box", cx: 0, cy: 0, hw: 0.06, hh: 0.06, rotDeg: 0 } as const;
const TUNING = { maxSpeed: 1.2, accel: 6, decel: 3 };

const game: GameDefinition = defineGame({
  id: "topdown",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});
const registry = createRegistry(game);

/** A wall whose left face is at x = 1.6, from y = 0 to 2, in a 3.2 × 3.2 m room of 0.32 m cells. */
function loaded(physics: "rapier" | "none", entities: EntityDef[] = []) {
  const def: SceneDefinition = {
    v: 3,
    game: "topdown",
    name: "top-down",
    bounds: [0, 0, 3.2, 3.2],
    settings: { gravity: [0, 0], physics, grid: { kind: "square", cell: [0.32, 0.32] } },
    entities,
  };
  const rt = createSceneRuntime({ rapier, view: null, game });
  expect(rt.load(expandScene(def, registry))).toMatchObject({ ok: true });
  return rt;
}

const WALL = { id: "wall", type: "solid", shape: ["box", 1.65, 1, 0.05, 1] } as EntityDef;

function rig(physics: "rapier" | "none", at: Vec2 = { x: 0.48, y: 0.48 }) {
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
    expect(speeds.map((s) => Math.round(s * 1e5) / 1e5)).toEqual([
      0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.2, 1.2,
    ]);
    expect(ctl.velocity().y).toBe(0);
    expect(rt.ctx.poses.get("rover")).toMatchObject(body.position());
    rt.destroy();
  });

  it("decelerates to rest without overshooting", () => {
    const { rt, ctl } = rig("none");
    for (let i = 0; i < 12; i++) ctl.step(DT, { x: 0, y: 1 });
    expect(ctl.velocity().y).toBeCloseTo(1.2, 11);
    const speeds: number[] = [];
    for (let i = 0; i < 26; i++) {
      ctl.step(DT, { x: 0, y: 0 });
      speeds.push(Math.round(ctl.velocity().y * 1e5) / 1e5);
    }
    expect(speeds.slice(0, 3)).toEqual([1.15, 1.1, 1.05]);
    expect(speeds.slice(22)).toEqual([0.05, 0, 0, 0]);
    expect(ctl.step(DT, { x: 0, y: 0 })).toEqual({
      moved: { x: 0, y: 0 },
      hits: [],
      blocked: false,
    });
    rt.destroy();
  });

  it("clamps a diagonal intent to the unit disc, and takes a short one as it is", () => {
    const { rt, ctl } = rig("none", { x: 0.2, y: 0.2 });
    for (let i = 0; i < 30; i++) ctl.step(DT, { x: 1, y: 1 });
    expect(speed(ctl.velocity())).toBeCloseTo(1.2, 11);
    expect(ctl.velocity().x).toBeCloseTo(1.2 / Math.sqrt(2), 11);
    expect(ctl.velocity().y).toBeCloseTo(ctl.velocity().x, 14);
    for (let i = 0; i < 30; i++) ctl.step(DT, { x: 0, y: 0.5 });
    expect(ctl.velocity().x).toBeCloseTo(0, 11);
    expect(ctl.velocity().y).toBeCloseTo(0.6, 11);
    for (let i = 0; i < 30; i++) ctl.step(DT, { x: -3, y: 4 });
    expect(ctl.velocity().x).toBeCloseTo(-0.72, 11);
    expect(ctl.velocity().y).toBeCloseTo(0.96, 11);
    rt.destroy();
  });

  it("loses the velocity that heads into a wall and keeps the rest", () => {
    for (const physics of ["rapier", "none"] as const) {
      const { rt, ctl } = rig(physics, { x: 1.4, y: 0.48 });
      for (let i = 0; i < 30; i++) {
        ctl.step(DT, { x: 1, y: 1 });
        rt.step(DT, []);
      }
      // Against the wall Rapier's controller, at its metre tolerances, gains or loses a few µm a tick.
      expect(ctl.velocity().x, physics).toBeCloseTo(0, physics === "rapier" ? 3 : 8);
      expect(ctl.velocity().y, physics).toBeCloseTo(1.2 / Math.sqrt(2), 3);
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
    expect(Math.abs(onGeometry.at.x - onRapier.at.x)).toBeLessThan(0.02);
    expect(Math.abs(onGeometry.at.y - onRapier.at.y)).toBeLessThan(0.02);
  });
});
