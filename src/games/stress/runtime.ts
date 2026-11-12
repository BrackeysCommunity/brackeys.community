import type { Vec2 } from "@jams/engine";
import {
  ENTITY_DESTROYED,
  SENSOR_ENTER,
  SENSOR_EXIT,
  type EngineContext,
  type GameCommand,
  type GameRuntime,
  type RuntimeNav,
} from "@jams/engine/game";
import { z } from "zod";

import {
  AGENT,
  AGENT_ART,
  MAX_CROWD,
  PELLET,
  PROJECT_SETTINGS,
  REFUSED,
  SCENE_SETTINGS,
  SPAWNER,
  SPAWNER_DEFAULTS,
  type PelletKind,
  type Slice,
  type Snapshot,
} from "./types";

/** How the crowd walks: speed in m/s, distances in m, the repath period in ticks. */
export const CROWD = {
  speed: 1.2,
  /** A waypoint this close counts as reached. */
  arrive: 0.12,
  /** Agents closer than this push each other apart. */
  personal: 0.3,
  /** How hard that push is against the pull of the path. */
  separation: 1.5,
  /** Every agent plans a new route at least this often, staggered by its place in the crowd. */
  repathTicks: 180,
  /** An agent with nowhere to step waits this long before it plans again. */
  blockedTicks: 30,
  /** A route ends at most this far from where it starts, along each axis. */
  roam: 8,
};

/** How fast `move` pans the camera, m/s. */
const PAN_SPEED = 8;

const sceneSettings = z.object(SCENE_SETTINGS);
const projectSettings = z.object(PROJECT_SETTINGS);

type Spawner = {
  x: number;
  y: number;
  rate: number;
  cap: number;
  lifeMs: number;
  pellet: PelletKind;
  size: number;
  spread: number;
  ccd: boolean;
  /** Pellets owed: `rate` adds to it each tick, a spawn takes one. */
  owed: number;
  live: number;
};

type Agent = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  path: Vec2[] | null;
  /** The waypoint of `path` it walks to. */
  next: number;
  repathAt: number;
};

const AGENTS = { type: AGENT } as const;

const num = (value: unknown, fallback: number) => (typeof value === "number" ? value : fallback);

function pelletShape(kind: PelletKind, x: number, y: number, size: number): unknown[] {
  const half = size / 2;
  if (kind === "box") return ["box", x, y, half, half];
  if (kind === "capsule") return ["capsule", x, y, half, half / 2];
  return ["circle", x, y, half];
}

/**
 * The load a scene's own entities can't make: spawners that emit and lose
 * pellets, a crowd steered along the walk areas every tick, and a tally of
 * what the sensors saw.
 */
export function createRuntime(ctx: EngineContext): GameRuntime<Snapshot> {
  let spawners: Spawner[] = [];
  const owner = new Map<string, Spawner>();
  let agents: Agent[] = [];
  const inside = new Map<string, number>();
  let occupied = 0;
  let spawned = 0;
  let destroyed = 0;
  let enters = 0;
  let exits = 0;
  let walked = 0;
  let crowd = 0;
  let spawnRate = 1;
  let spawnCap = 1;
  let camera: Vec2 = { x: 0, y: 0 };
  let pan: Vec2 = { x: 0, y: 0 };
  let scenes: readonly string[] = [];
  let slice: Slice | null = null;
  let drop = ctx.random.fork("drop");
  let wander = ctx.random.fork("wander");

  /** A whole-pixel point on the walk areas within `rx`, `ry` of `c`, or null when eight tries find none. */
  function walkable(nav: RuntimeNav, c: Vec2, rx: number, ry: number): Vec2 | null {
    const [x0, y0, x1, y1] = ctx.bounds;
    const [px, py] = [Math.round(rx * 100), Math.round(ry * 100)];
    for (let tries = 0; tries < 8; tries++) {
      const p = {
        x: Math.min(x1, Math.max(x0, c.x + wander.range(-px, px) / 100)),
        y: Math.min(y1, Math.max(y0, c.y + wander.range(-py, py) / 100)),
      };
      if (nav.contains(p)) return p;
    }
    return null;
  }

  function setCrowd(count: number): void {
    const nav = ctx.nav;
    crowd = nav ? Math.min(count, MAX_CROWD) : 0;
    while (agents.length > crowd) ctx.destroy(agents.pop()!.id);
    if (!nav) return;
    const [x0, y0, x1, y1] = ctx.bounds;
    const middle = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    while (agents.length < crowd) {
      const at = walkable(nav, middle, (x1 - x0) / 2, (y1 - y0) / 2) ?? nav.nearest(middle);
      const n = agents.length;
      const { id } = ctx.spawn({
        type: AGENT,
        at: [at.x, at.y],
        behaviors: {
          sprite: {
            asset: AGENT_ART.asset,
            frame: AGENT_ART.frames[n % AGENT_ART.frames.length],
            size: [AGENT_ART.size, AGENT_ART.size],
          },
        },
      });
      agents.push({
        id,
        x: at.x,
        y: at.y,
        vx: 0,
        vy: 0,
        path: null,
        next: 0,
        repathAt: n % CROWD.repathTicks,
      });
    }
  }

  function route(a: Agent): void {
    const nav = ctx.nav;
    const to = nav && walkable(nav, a, CROWD.roam, CROWD.roam);
    a.path = nav && to ? nav.path({ x: a.x, y: a.y }, to) : null;
    a.next = a.path && a.path.length > 1 ? 1 : 0;
    a.repathAt = ctx.tick + CROWD.repathTicks;
  }

  /** Picks the agent's velocity: along its route, pushed off the neighbours the entity query finds. */
  function think(a: Agent): void {
    if (ctx.tick >= a.repathAt || (a.path && a.next >= a.path.length)) route(a);
    let dx = 0;
    let dy = 0;
    const to = a.path?.[a.next];
    if (to) {
      dx = to.x - a.x;
      dy = to.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < CROWD.arrive) a.next++;
      if (d > 0) {
        dx /= d;
        dy /= d;
      }
    }
    const r = CROWD.personal;
    const near = ctx.query.inArea(
      { minX: a.x - r, minY: a.y - r, maxX: a.x + r, maxY: a.y + r },
      AGENTS,
    );
    for (const other of near) {
      if (other === a.id) continue;
      const p = ctx.poses.get(other);
      if (!p) continue;
      const ox = a.x - p.x;
      const oy = a.y - p.y;
      const d2 = ox * ox + oy * oy;
      if (d2 === 0 || d2 >= r * r) continue;
      const d = Math.sqrt(d2);
      const push = (CROWD.separation * (r - d)) / r;
      dx += (ox / d) * push;
      dy += (oy / d) * push;
    }
    a.vx = dx * CROWD.speed;
    a.vy = dy * CROWD.speed;
  }

  /** Moves the agent by its velocity, sliding along the walk area's edge, and writes its pose. */
  function walk(a: Agent, dt: number): void {
    const nav = ctx.nav;
    if (!nav) return;
    const nx = a.x + a.vx * dt;
    const ny = a.y + a.vy * dt;
    let x = a.x;
    let y = a.y;
    if (nav.contains({ x: nx, y: ny })) {
      x = nx;
      y = ny;
    } else if (nav.contains({ x: nx, y: a.y })) x = nx;
    else if (nav.contains({ x: a.x, y: ny })) y = ny;
    else {
      a.path = null;
      a.repathAt = Math.min(a.repathAt, ctx.tick + CROWD.blockedTicks);
    }
    if (x === a.x && y === a.y) return;
    const mx = x - a.x;
    const my = y - a.y;
    walked += Math.sqrt(mx * mx + my * my);
    a.x = x;
    a.y = y;
    ctx.poses.set(a.id, x, y);
  }

  function emit(s: Spawner, dt: number): void {
    const cap = Math.round(s.cap * spawnCap);
    s.owed += s.rate * spawnRate * dt;
    const reach = Math.round(s.spread * 100);
    while (s.owed >= 1 && s.live < cap) {
      s.owed -= 1;
      const x = s.x + (reach > 0 ? drop.range(-reach, reach) / 100 : 0);
      const { id } = ctx.spawn({
        type: PELLET,
        shape: pelletShape(s.pellet, x, s.y, s.size),
        density: 1,
        restitution: 0.3,
        ...(s.ccd ? { ccd: true } : {}),
        behaviors: { lifetime: { ms: s.lifeMs } },
      });
      owner.set(id, s);
      s.live++;
      spawned++;
    }
    // At its cap a spawner owes no more than its next pellet.
    if (s.owed > 1) s.owed = 1;
  }

  function refuse(command: GameCommand, reason: string): void {
    ctx.emit({ type: REFUSED, at: camera, data: { command: command.name, reason } });
  }

  function run(command: GameCommand): void {
    const args = (command.args ?? {}) as { count?: number; scale?: number; scene?: string };
    if (command.name === "crowd") {
      if (!ctx.nav) refuse(command, "the scene has no walk area");
      else setCrowd(args.count ?? 0);
    }
    if (command.name === "spawn-rate") spawnRate = args.scale ?? 1;
    if (command.name === "spawn-cap") spawnCap = args.scale ?? 1;
    if (command.name === "goto") {
      if (args.scene !== undefined && scenes.includes(args.scene))
        ctx.flow.request({ to: args.scene });
      else refuse(command, "not a scene the project lists");
    }
  }

  return {
    onLoad(scene) {
      const own = sceneSettings.parse(ctx.settings);
      const project = projectSettings.parse(ctx.project?.settings ?? {});
      spawnRate = (own.spawnRate ?? 1) * project.spawnRateScale;
      spawnCap = (own.spawnCap ?? 1) * project.spawnCapScale;
      drop = ctx.random.fork("drop");
      wander = ctx.random.fork("wander");
      scenes = (ctx.project?.flow?.scenes ?? []).filter((s) => !s.sublevel).map((s) => s.scene);
      const [x0, y0, x1, y1] = ctx.bounds;
      camera = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };

      spawners = scene.entities
        .filter((e) => e.type === SPAWNER)
        .map((e) => {
          const [x, y] = e.at as [number, number];
          return {
            x,
            y,
            rate: num(e.rate, SPAWNER_DEFAULTS.rate),
            cap: num(e.cap, SPAWNER_DEFAULTS.cap),
            lifeMs: num(e.lifeMs, SPAWNER_DEFAULTS.lifeMs),
            pellet: (e.pellet as PelletKind | undefined) ?? SPAWNER_DEFAULTS.pellet,
            size: num(e.size, SPAWNER_DEFAULTS.size),
            spread: num(e.spread, SPAWNER_DEFAULTS.spread),
            ccd: e.ccd === true,
            owed: 0,
            live: 0,
          };
        });

      ctx.events.on(ENTITY_DESTROYED, (e) => {
        const from = owner.get(e.entityId ?? "");
        if (!from) return;
        owner.delete(e.entityId!);
        from.live--;
        destroyed++;
      });

      setCrowd(Math.round((own.crowd ?? 0) * project.crowdScale));
    },
    onUnload() {
      spawners = [];
      owner.clear();
      agents = [];
      inside.clear();
      occupied = spawned = destroyed = enters = exits = walked = crowd = 0;
      pan = { x: 0, y: 0 };
      slice = null;
    },
    beforeStep(dtMs, actions, commands) {
      const dt = dtMs / 1000;
      for (const c of commands) run(c);
      for (const a of actions) {
        if (a.action === "move") pan = a.pressed ? { x: a.x ?? 0, y: a.y ?? 0 } : { x: 0, y: 0 };
      }
      camera = { x: camera.x + pan.x * PAN_SPEED * dt, y: camera.y + pan.y * PAN_SPEED * dt };
      for (const s of spawners) emit(s, dt);
      for (const a of agents) think(a);
    },
    afterStep(dtMs, events) {
      for (const e of events) {
        if (e.entityId === undefined) continue;
        if (e.type === SENSOR_ENTER) {
          enters++;
          const now = (inside.get(e.entityId) ?? 0) + 1;
          inside.set(e.entityId, now);
          if (now === 1) occupied++;
        } else if (e.type === SENSOR_EXIT) {
          exits++;
          const now = (inside.get(e.entityId) ?? 1) - 1;
          inside.set(e.entityId, now);
          if (now === 0) occupied--;
        }
      }
      const dt = dtMs / 1000;
      for (const a of agents) walk(a, dt);
    },
    cameraTarget: () => camera,
    snapshot: () => ({
      agents: agents.length,
      pellets: owner.size,
      spawned,
      destroyed,
      enters,
      exits,
      occupied,
      walked: Math.round(walked * 1000),
    }),
    storeSlice() {
      const scene = ctx.flow.scene;
      if (
        slice === null ||
        slice.scene !== scene ||
        slice.scenes !== scenes ||
        slice.agents !== agents.length ||
        slice.pellets !== owner.size ||
        slice.enters !== enters ||
        slice.crowd !== crowd ||
        slice.spawnRate !== spawnRate ||
        slice.spawnCap !== spawnCap
      )
        slice = {
          scene,
          scenes,
          agents: agents.length,
          pellets: owner.size,
          enters,
          crowd,
          spawnRate,
          spawnCap,
        };
      return slice;
    },
  };
}
