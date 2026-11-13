import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../../game/define";
import type { GameDefinition } from "../../game/types";
import { createSceneRuntime } from "../../runtime/runtime";
import { expandScene } from "../../scene/expand";
import type { EntityDef, SceneDefinition } from "../../scene/types";
import type { RapierModule, Vec2 } from "../../types";
import { createMotionBody } from "../body";
import {
  createSideViewController,
  type SideViewEnv,
  type SideViewIntent,
  type SideViewOptions,
} from "../side-view";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const BACKENDS = ["rapier", "none"] as const;
type Backend = (typeof BACKENDS)[number];

const game: GameDefinition = defineGame({
  id: "side",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});
const registry = createRegistry(game);

const HH = 0.3;
const BOX = { type: "box", cx: 0, cy: 0, hw: 0.15, hh: HH, rotDeg: 0 } as const;
/** The floor's top is y = 2, from x = 0 to 2: a ledge at x = 2. */
const FLOOR_TOP = 2;
const LEDGE = { id: "floor", type: "solid", shape: ["box", 1, 2.25, 1, 0.25] } as EntityDef;
const LONG_FLOOR = { id: "floor", type: "solid", shape: ["box", 4, 2.25, 4, 0.25] } as EntityDef;
/** The centre's y when the box stands on the floor. */
const STANDING = FLOOR_TOP - HH;

const OPTS: SideViewOptions = {
  shape: BOX,
  maxSpeed: 6,
  accel: 60,
  decel: 70,
  airControl: 0.6,
  jumpHeight: 1.2,
  gravityScale: 1,
  maxFallSpeed: 15,
  coyoteMs: 100,
  jumpBufferMs: 100,
  jumpCut: 0.5,
};

const IDLE: SideViewIntent = { move: 0, jump: false, jumpHeld: false };
const RIGHT: SideViewIntent = { move: 1, jump: false, jumpHeld: false };
const JUMP: SideViewIntent = { move: 0, jump: true, jumpHeld: true };
const HOLD: SideViewIntent = { move: 0, jump: false, jumpHeld: true };

function rig(
  physics: Backend,
  entities: EntityDef[],
  at: Vec2,
  opts: Partial<SideViewOptions> = {},
) {
  const def: SceneDefinition = {
    v: 3,
    game: "side",
    name: "side",
    bounds: [0, 0, 8, 4],
    settings: { gravity: [0, 12], physics },
    entities,
  };
  const rt = createSceneRuntime({ rapier, view: null, game });
  expect(rt.load(expandScene(def, registry))).toMatchObject({ ok: true });
  const body = createMotionBody(rt.ctx, { id: "hero", type: "hero" }, at, { shape: BOX });
  const ctl = createSideViewController(rt.ctx, body, { ...OPTS, ...opts });
  const dt = rt.ctx.time.tickMs;
  const tick = (intent: SideViewIntent, env?: SideViewEnv) => {
    const r = ctl.step(dt, intent, env);
    rt.step(dt, []);
    return r;
  };
  return { rt, body, ctl, tick };
}

const standing = (x = 1): Vec2 => ({ x, y: STANDING });

describe.each(BACKENDS)("the side-view controller (physics %s)", (physics) => {
  it("starts grounded on the floor and stays put", () => {
    const { rt, body, ctl, tick } = rig(physics, [LEDGE], standing());
    expect(ctl.grounded()).toBe(true);
    for (let i = 0; i < 30; i++)
      expect(tick(IDLE)).toMatchObject({ grounded: true, landed: false });
    expect(body.position().y).toBeCloseTo(STANDING, 3);
    expect(ctl.velocity()).toEqual({ x: 0, y: 0 });
    rt.destroy();
  });

  it("jumps to within 1% of jumpHeight", () => {
    const { rt, body, tick } = rig(physics, [LEDGE], standing());
    const start = body.position().y;
    expect(tick(JUMP)).toMatchObject({ jumped: true, grounded: false });
    let top = start;
    let landedAt = -1;
    for (let i = 1; i < 120 && landedAt < 0; i++) {
      const r = tick(HOLD);
      top = Math.min(top, body.position().y);
      expect(r.jumped).toBe(false);
      if (r.landed) landedAt = i;
    }
    expect(Math.abs(start - top - OPTS.jumpHeight)).toBeLessThan(OPTS.jumpHeight * 0.01);
    // Up and down again: 2 × √(2h/g) is 0.894 s, 53.7 ticks.
    expect(landedAt).toBeGreaterThanOrEqual(53);
    expect(landedAt).toBeLessThanOrEqual(55);
    expect(body.position().y).toBeCloseTo(STANDING, 3);
    rt.destroy();
  });

  it("keeps less of the rise when the jump is released early", () => {
    const apex = (holdTicks: number) => {
      const { rt, body, tick } = rig(physics, [LEDGE], standing());
      tick(JUMP);
      let top = body.position().y;
      for (let i = 1; i < 60; i++) {
        tick(i < holdTicks ? HOLD : IDLE);
        top = Math.min(top, body.position().y);
      }
      rt.destroy();
      return STANDING - top;
    };
    const full = apex(60);
    const cut = apex(6);
    expect(full).toBeCloseTo(OPTS.jumpHeight, 1);
    expect(cut).toBeLessThan(full * 0.6);
    expect(cut).toBeGreaterThan(0.2);
  });

  it("takes a jump within coyoteMs of leaving a ledge, and not after", () => {
    const run = (pressAfter: number) => {
      const { rt, tick } = rig(physics, [LEDGE], standing(1.6));
      let off = -1;
      for (let i = 0; i < 60 && off < 0; i++) if (!tick(RIGHT).grounded) off = i;
      expect(off).toBeGreaterThan(0);
      for (let i = 1; i < pressAfter; i++) tick(RIGHT);
      const r = tick({ move: 1, jump: true, jumpHeld: true });
      rt.destroy();
      return r.jumped;
    };
    expect(run(5)).toBe(true);
    expect(run(6)).toBe(true);
    expect(run(7)).toBe(false);
  });

  it("keeps a press made before landing for the landing, within jumpBufferMs", () => {
    const drop = { x: 1, y: 1 };
    const landing = () => {
      const { rt, tick } = rig(physics, [LEDGE], drop);
      let at = -1;
      for (let i = 0; i < 120 && at < 0; i++) if (tick(IDLE).landed) at = i;
      rt.destroy();
      return at;
    };
    const land = landing();
    expect(land).toBeGreaterThan(10);
    const run = (before: number) => {
      const { rt, tick } = rig(physics, [LEDGE], drop);
      const jumps: number[] = [];
      for (let i = 0; i <= land + 2; i++) {
        const r = tick(i === land - before ? JUMP : HOLD);
        if (i === land) expect(r.landed).toBe(true);
        if (r.jumped) jumps.push(i);
      }
      rt.destroy();
      return jumps;
    };
    expect(run(5)).toEqual([land + 1]);
    expect(run(7)).toEqual([]);
  });

  it("walks up a 30° slope and not a 60° one at maxSlopeDeg 50", () => {
    const rise = (deg: number) => {
      const run = 1.5;
      const top = FLOOR_TOP - run * Math.tan((deg * Math.PI) / 180);
      const slope = {
        id: "slope",
        type: "solid",
        shape: ["poly", 3, FLOOR_TOP, 3 + run, top, 3 + run, FLOOR_TOP],
      } as EntityDef;
      const { rt, body, tick } = rig(physics, [LONG_FLOOR, slope], standing(2), {
        maxSlopeDeg: 50,
      });
      let grounded = 0;
      for (let i = 0; i < 40; i++) if (tick(RIGHT).grounded) grounded++;
      const p = body.position();
      rt.destroy();
      return { climbed: STANDING - p.y, x: p.x, grounded };
    };
    const gentle = rise(30);
    expect(gentle.climbed).toBeGreaterThan(0.4);
    expect(gentle.grounded).toBeGreaterThan(30);
    const steep = rise(60);
    expect(steep.climbed).toBeLessThan(0.02);
    expect(steep.x).toBeLessThan(3);
    expect(steep.grounded).toBe(40);
  });

  it("climbs a step of stepHeight, and not a taller one", () => {
    const climb = (height: number) => {
      const step = {
        id: "step",
        type: "solid",
        shape: ["box", 5, FLOOR_TOP - height / 2, 2, height / 2],
      } as EntityDef;
      const { rt, body, tick } = rig(physics, [LONG_FLOOR, step], standing(2), {
        stepHeight: 0.04,
      });
      for (let i = 0; i < 30; i++) tick(RIGHT);
      const p = body.position();
      rt.destroy();
      return p;
    };
    const low = climb(0.04);
    expect(low.x).toBeGreaterThan(3.5);
    expect(low.y).toBeCloseTo(STANDING - 0.04, 3);
    const tall = climb(0.08);
    expect(tall.x).toBeLessThan(3);
    expect(tall.y).toBeCloseTo(STANDING, 3);
  });

  /** Walks right from x = 3 on `upper` for `ticks` ticks, noting each tick it leaves or lands. */
  const walkDown = (entities: EntityDef[], snapToGround: number, ticks: number) => {
    const { rt, body, tick } = rig(physics, entities, standing(3), { snapToGround });
    const events: string[] = [];
    let was = true;
    for (let i = 0; i < ticks; i++) {
      const r = tick(RIGHT);
      if (r.grounded !== was) events.push(`${r.grounded ? "landed" : "left"} ${i}`);
      was = r.grounded;
    }
    const p = body.position();
    rt.destroy();
    return { events, x: p.x, y: p.y };
  };
  const UPPER = { id: "upper", type: "solid", shape: ["box", 2, 2.25, 2, 0.25] } as EntityDef;

  it("sticks to a step down within snapToGround, and drops off it with snapToGround 0", () => {
    const DROP = 0.03;
    const lower = {
      id: "lower",
      type: "solid",
      shape: ["box", 6, FLOOR_TOP + DROP + 0.25, 2, 0.25],
    } as EntityDef;
    const stuck = walkDown([UPPER, lower], 0.04, 30);
    expect(stuck.events).toEqual([]);
    expect(stuck.x).toBeGreaterThan(5);
    expect(stuck.y).toBeCloseTo(STANDING + DROP, 3);
    const dropped = walkDown([UPPER, lower], 0, 30);
    expect(dropped.events).toEqual(["left 14", "landed 19"]);
    expect(dropped.y).toBeCloseTo(STANDING + DROP, 3);
  });

  it("follows a 20° slope down within snapToGround, and leaves it with snapToGround 0", () => {
    const run = 1.5;
    const bottom = FLOOR_TOP + run * Math.tan((20 * Math.PI) / 180);
    const slope = {
      id: "slope",
      type: "solid",
      shape: ["poly", 4, FLOOR_TOP, 4 + run, bottom, 4, bottom],
    } as EntityDef;
    const lower = {
      id: "lower",
      type: "solid",
      shape: ["box", 7.5, bottom + 0.25, 2, 0.25],
    } as EntityDef;
    const stuck = walkDown([UPPER, slope, lower], 0.04, 40);
    expect(stuck.events).toEqual([]);
    expect(stuck.x).toBeGreaterThan(4 + run);
    expect(stuck.y).toBeCloseTo(bottom - HH, 3);
    // Off the slope's top it flies over the slope and lands on the floor past it.
    const flown = walkDown([UPPER, slope, lower], 0, 40);
    expect(flown.events).toEqual(
      physics === "rapier" ? ["left 15", "landed 34"] : ["left 14", "landed 33"],
    );
    expect(flown.y).toBeCloseTo(bottom - HH, 3);
  });

  it("stops at a wall and loses the speed heading into it", () => {
    const wall = { id: "wall", type: "solid", shape: ["box", 3.1, 1, 0.1, 1] } as EntityDef;
    const { rt, body, ctl, tick } = rig(physics, [LONG_FLOOR, wall], standing(2));
    let blocked = 0;
    for (let i = 0; i < 30; i++) {
      const r = tick(RIGHT);
      expect(r.grounded).toBe(true);
      if (r.blocked) {
        blocked++;
        expect(r.hits.some((h) => h.tag.entityId === "wall")).toBe(true);
      }
    }
    expect(blocked).toBeGreaterThan(10);
    expect(body.position().x).toBeCloseTo(3 - BOX.hw, 3);
    expect(body.position().y).toBeCloseTo(STANDING, 3);
    expect(ctl.velocity().x).toBeLessThan(1.01);
    rt.destroy();
  });

  it("walks off a ledge and falls, landing on the floor below", () => {
    const low = { id: "low", type: "solid", shape: ["box", 4, 3.25, 4, 0.25] } as EntityDef;
    const { rt, body, tick } = rig(physics, [LEDGE, low], standing(1.6));
    const events: string[] = [];
    let was = true;
    for (let i = 0; i < 90; i++) {
      const r = tick(i < 10 ? RIGHT : IDLE);
      if (r.grounded !== was) events.push(r.grounded ? `landed ${r.landed}` : "left");
      was = r.grounded;
    }
    expect(events).toEqual(["left", "landed true"]);
    expect(body.position().y).toBeCloseTo(3 - HH, 3);
    rt.destroy();
  });

  it("adds a carrier's delta to its own movement", () => {
    const { rt, body, tick } = rig(physics, [LONG_FLOOR], standing(2));
    for (let i = 0; i < 10; i++) {
      expect(tick(IDLE, { carrier: { x: 0.02, y: 0 } }).grounded).toBe(true);
    }
    expect(body.position().x).toBeCloseTo(2.2, 4);
    for (let i = 0; i < 10; i++) tick(RIGHT, { carrier: { x: -0.02, y: 0 } });
    // Its own speed ramps 1, 2 … 6 m/s, then holds; the carrier takes 0.02 m a tick.
    const own = (1 + 2 + 3 + 4 + 5 + 6 * 5) / 60;
    expect(body.position().x).toBeCloseTo(2.2 + own - 0.2, 4);
    rt.destroy();
  });

  it("is pushed by an outside acceleration", () => {
    const { rt, ctl, tick } = rig(physics, [LONG_FLOOR], { x: 2, y: 0.5 }, { airControl: 0 });
    for (let i = 0; i < 10; i++) tick(IDLE, { accel: { x: 6, y: -12 } });
    expect(ctl.velocity().x).toBeCloseTo(1, 9);
    expect(ctl.velocity().y).toBeCloseTo(0, 9);
    rt.destroy();
  });

  it("continues a jump identically after save and restore", () => {
    const script = (i: number): SideViewIntent =>
      i === 0
        ? { move: 1, jump: true, jumpHeld: true }
        : { move: i < 30 ? 1 : -0.5, jump: false, jumpHeld: i < 12 };
    const a = rig(physics, [LONG_FLOOR], standing(2));
    for (let i = 0; i < 8; i++) a.tick(script(i));
    const saved = a.ctl.save();
    const at = a.body.position();
    const trace = (r: typeof a, from: number) => {
      const out: number[] = [];
      for (let i = from; i < from + 60; i++) {
        const s = r.tick(script(i));
        const p = r.body.position();
        out.push(p.x, p.y, s.grounded ? 1 : 0);
      }
      return out;
    };
    const first = trace(a, 8);
    a.rt.destroy();

    const b = rig(physics, [LONG_FLOOR], standing(2));
    b.body.teleport(at.x, at.y);
    b.ctl.restore(JSON.parse(JSON.stringify(saved)));
    expect(b.ctl.grounded()).toBe(false);
    expect(trace(b, 8)).toEqual(first);
    b.rt.destroy();
  });
});

describe("the side-view controller's options", () => {
  it("refuses tuning out of range", () => {
    const def: SceneDefinition = {
      v: 3,
      game: "side",
      name: "side",
      bounds: [0, 0, 8, 4],
      settings: { gravity: [0, 12], physics: "none" },
      entities: [],
    };
    const rt = createSceneRuntime({ rapier, view: null, game });
    rt.load(expandScene(def, registry));
    const body = createMotionBody(rt.ctx, { id: "hero", type: "hero" }, standing(), {
      shape: BOX,
    });
    const make = (o: Partial<SideViewOptions>) => () =>
      createSideViewController(rt.ctx, body, { ...OPTS, ...o });
    expect(make({ accel: -1 })).toThrow(/accel/);
    expect(make({ jumpCut: 1.5 })).toThrow(/jumpCut/);
    expect(make({ maxFallSpeed: 0 })).toThrow(/maxFallSpeed/);
    expect(make({ maxSlopeDeg: 95 })).toThrow(/maxSlopeDeg/);
    rt.destroy();
  });
});
