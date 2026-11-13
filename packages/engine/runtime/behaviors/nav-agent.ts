import { z } from "zod";

import type {
  BehaviorSystem,
  BehaviorSystemFactory,
  RegisteredBehavior,
} from "../../game/behaviors";
import { COLLIDER, type ColliderBlock, type ColliderSystem } from "../../game/behaviors/collider";
import type { NavAgentBlock, NavAgentSystem } from "../../game/behaviors/nav-agent";
import type { EngineContext, JsonValue } from "../../game/types";
import { createMotionBody, type MotionBody } from "../../motion/index";
import { parseShape } from "../../scene/shapes";
import type { Aabb, RuntimeEntity } from "../../scene/types";
import type { RuntimeNav } from "../nav";
import { NAV_ARRIVED, NAV_BLOCKED } from "../types";

type Vec2 = { x: number; y: number };

type BlockedReason = "no-path" | "stuck" | "gone";

const ORIGIN: Readonly<Vec2> = Object.freeze({ x: 0, y: 0 });

/** Route length lost below this, m, is no progress. */
const PROGRESS_EPSILON = 1e-4;

type Agent = {
  id: string;
  /** Its entity's type. */
  type: string;
  block: NavAgentBlock;
  /** Its place among the agents attached since the load: what staggers its repaths. */
  order: number;
  /** False while the entity is disabled. */
  on: boolean;
  /** A point destination, world m; null when it follows an entity or has none. */
  to: Vec2 | null;
  /** The entity it follows; null for a point or none. */
  target: string | null;
  /** The route from where it last planned; null with no destination. */
  path: Vec2[] | null;
  /** The waypoint of `path` it walks to. */
  next: number;
  /** Ticks until it plans toward its target again. */
  repathIn: number;
  /** The shortest route left it has walked down to since it last advanced, m. */
  best: number;
  /** Ticks since the route left last got shorter. */
  stuck: number;
  /** Raised at the next tick and ending the walk: a plan that found no route. */
  blocked: BlockedReason | null;
  /** The motion body it moves through when the entity has a solid `collider`; else it moves by pose. */
  body: MotionBody | null;
  /** The collider system's own copy of that collider, taken out of the world while the motion body stands in for it. */
  stood: boolean;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCount = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 0;

function readPoint(v: unknown): Vec2 | null {
  return Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1])
    ? { x: v[0], y: v[1] }
    : null;
}

/**
 * The route with each turn moved `clearance` away from the corner it bends
 * around (less where that leaves the walk areas), so an agent rounds a hole
 * instead of grazing its edge. The funnel puts turns on the corners.
 */
function clearCorners(path: Vec2[], clearance: number, nav: RuntimeNav): Vec2[] {
  if (path.length < 3 || !(clearance > 0)) return path;
  const out: Vec2[] = [path[0]!];
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i - 1]!;
    const w = path[i]!;
    const n = path[i + 1]!;
    const ix = w.x - p.x;
    const iy = w.y - p.y;
    const ox = n.x - w.x;
    const oy = n.y - w.y;
    const il = Math.sqrt(ix * ix + iy * iy);
    const ol = Math.sqrt(ox * ox + oy * oy);
    let kept = w;
    if (il > 0 && ol > 0) {
      // The corner lies on the inside of the bend: the way the heading turns.
      const bx = ox / ol - ix / il;
      const by = oy / ol - iy / il;
      const bl = Math.sqrt(bx * bx + by * by);
      for (let c = clearance; bl > 1e-9 && c > clearance / 8; c /= 2) {
        const moved = { x: w.x - (bx / bl) * c, y: w.y - (by / bl) * c };
        if (nav.contains(moved)) {
          kept = moved;
          break;
        }
      }
    }
    out.push(kept);
  }
  out.push(path[path.length - 1]!);
  return out;
}

/**
 * The `nav-agent` system: each agent walks its route across `ctx.nav` to a
 * point, or after an entity it plans toward again every `repathTicks`
 * (staggered by attach order), at `speed` and pushed off the agents within
 * its `radius`. Agents step in attach order, so in spawn order. It arrives
 * within `arrive` of a point (within `arrive + radius` of an entity) and
 * raises `nav:arrived`; with no route, or no progress along it for
 * `repathTicks`, it raises `nav:blocked`. Either ends the walk. An entity
 * with a solid `collider` moves through a motion body of the collider's
 * shape, sliding along what it meets, and the collider system's own copy
 * of the collider leaves the world while it does; any other moves by pose.
 * Both stay on the walk areas. A world save holds the destination, the
 * route and its timers.
 */
export const createNavAgentSystem: BehaviorSystemFactory = (
  ctx: EngineContext,
  def: RegisteredBehavior,
) => {
  const schema = z.object(def.shape);
  const agents = new Map<string, Agent>();
  let attached = 0;
  /** How many agents each entity type holds; the separation query looks at those types only. */
  const typeCounts = new Map<string, number>();
  const neighbours: { type: string | string[] } = { type: [] };
  function countType(type: string, by: number): void {
    const was = typeCounts.get(type) ?? 0;
    const n = was + by;
    if (n > 0) typeCounts.set(type, n);
    else typeCounts.delete(type);
    if (was > 0 === n > 0) return;
    const types = [...typeCounts.keys()];
    neighbours.type = types.length === 1 ? types[0]! : types;
  }
  const box: Aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const probe: Vec2 = { x: 0, y: 0 };

  function withDefaults(block: NavAgentBlock): NavAgentBlock {
    const parsed = schema.safeParse(block);
    return parsed.success ? (parsed.data as NavAgentBlock) : block;
  }

  const colliders = () => ctx.behavior<ColliderSystem>(COLLIDER.name);

  function bodyFor(e: RuntimeEntity): MotionBody | null {
    const block = e.behaviors?.[COLLIDER.name] as Partial<ColliderBlock> | undefined;
    if (!block || block.sensor === true) return null;
    const parsed = parseShape(block.shape, `${e.id}.behaviors.${COLLIDER.name}.shape`);
    if (!parsed.ok || parsed.shape.type === "chain") return null;
    const pose = ctx.poses.get(e.id);
    return createMotionBody(
      ctx,
      e,
      { x: pose?.x ?? 0, y: pose?.y ?? 0 },
      {
        shape: parsed.shape,
        ...(block.group !== undefined ? { group: block.group } : {}),
        ...(block.material !== undefined ? { tag: { material: block.material } } : {}),
      },
    );
  }

  /** Takes the collider system's copy out of the world while the motion body stands in for it. */
  function standIn(a: Agent): void {
    const system = colliders();
    a.stood = a.body !== null && system?.has(a.id) === true;
    if (a.stood) system!.disable?.(a.id);
  }

  /** Its pose as the pose index holds it (a motion body writes it too), so reading it allocates nothing. */
  const position = (a: Agent): Readonly<Vec2> => ctx.poses.get(a.id) ?? ORIGIN;

  function end(a: Agent): void {
    a.to = null;
    a.target = null;
    a.path = null;
    a.next = 0;
    a.stuck = 0;
    a.best = Infinity;
    a.blocked = null;
    a.body?.setVelocity({ x: 0, y: 0 });
  }

  /** Where it heads for: its point, or its target's pose on the walk areas; null when the target is gone. */
  function goalOf(a: Agent, nav: RuntimeNav | null): Vec2 | null {
    if (a.to) return a.to;
    if (a.target === null || !ctx.exists(a.target)) return null;
    const p = ctx.poses.get(a.target);
    if (!p) return null;
    const at = { x: p.x, y: p.y };
    return nav && !nav.contains(at) ? nav.nearest(at) : at;
  }

  function remaining(a: Agent, from: Readonly<Vec2>): number {
    const path = a.path;
    if (!path) return 0;
    let len = 0;
    let x = from.x;
    let y = from.y;
    for (let i = a.next; i < path.length; i++) {
      const w = path[i]!;
      const dx = w.x - x;
      const dy = w.y - y;
      len += Math.sqrt(dx * dx + dy * dy);
      x = w.x;
      y = w.y;
    }
    return len;
  }

  /** Plans from where it stands; a failed plan is raised as `blocked` at the next tick. */
  function plan(a: Agent): void {
    a.repathIn = a.block.repathTicks;
    const nav = ctx.nav;
    const goal = goalOf(a, nav);
    if (!goal) {
      a.path = null;
      a.blocked = a.target !== null ? "gone" : "no-path";
      return;
    }
    const at = position(a);
    const from = nav && !nav.contains(at) ? nav.nearest(at) : at;
    const path = nav?.path(from, goal) ?? null;
    if (!path) {
      a.path = null;
      a.blocked = "no-path";
      return;
    }
    a.path = clearCorners(path, a.block.radius, nav!);
    a.next = path.length > 1 ? 1 : 0;
    a.best = remaining(a, at);
  }

  function raise(a: Agent, type: string, at: Readonly<Vec2>, reason?: BlockedReason): void {
    const target = a.target;
    end(a);
    ctx.emit({
      type,
      entityId: a.id,
      at: { x: at.x, y: at.y },
      ...(target !== null ? { other: target } : {}),
      ...(reason ? { data: { reason } } : {}),
    });
  }

  /** Moves it by `dx, dy` within the walk areas, sliding along their edges, and through its motion body when it has one. */
  function walk(
    a: Agent,
    at: Readonly<Vec2>,
    dx: number,
    dy: number,
    dt: number,
    nav: RuntimeNav,
  ): void {
    let mx = 0;
    let my = 0;
    probe.x = at.x + dx;
    probe.y = at.y + dy;
    if (nav.contains(probe)) {
      mx = dx;
      my = dy;
    } else {
      probe.y = at.y;
      if (dx !== 0 && nav.contains(probe)) mx = dx;
      else {
        probe.x = at.x;
        probe.y = at.y + dy;
        if (dy !== 0 && nav.contains(probe)) my = dy;
      }
    }
    if (a.body) {
      const moved = mx !== 0 || my !== 0 ? a.body.move({ x: mx, y: my }).moved : null;
      a.body.setVelocity(moved ? { x: moved.x / dt, y: moved.y / dt } : { x: 0, y: 0 });
    } else if (mx !== 0 || my !== 0) {
      ctx.poses.set(a.id, at.x + mx, at.y + my);
    }
  }

  function tick(a: Agent, dt: number): void {
    if (a.blocked) {
      raise(a, NAV_BLOCKED, position(a), a.blocked);
      return;
    }
    if (a.to === null && a.target === null) return;
    const nav = ctx.nav;
    if (!nav) {
      raise(a, NAV_BLOCKED, position(a), "no-path");
      return;
    }
    if (!a.path && a.target === null) {
      plan(a);
      if (a.blocked) {
        raise(a, NAV_BLOCKED, position(a), a.blocked);
        return;
      }
    }
    if (a.target !== null) {
      if (!ctx.exists(a.target)) {
        raise(a, NAV_BLOCKED, position(a), "gone");
        return;
      }
      a.repathIn--;
      if (a.repathIn <= 0 || !a.path || a.next >= a.path.length) {
        plan(a);
        if (a.blocked) {
          raise(a, NAV_BLOCKED, position(a), a.blocked);
          return;
        }
      }
    }
    const at = position(a);
    const block = a.block;
    const path = a.path!;

    if (a.target !== null) {
      const t = ctx.poses.get(a.target);
      if (t) {
        const ox = t.x - at.x;
        const oy = t.y - at.y;
        const reach = block.arrive + block.radius;
        if (ox * ox + oy * oy <= reach * reach) {
          raise(a, NAV_ARRIVED, at);
          return;
        }
      }
    }

    let to = path[a.next];
    while (to) {
      const wx = to.x - at.x;
      const wy = to.y - at.y;
      if (wx * wx + wy * wy > block.arrive * block.arrive) break;
      if (a.next >= path.length - 1) {
        if (a.to !== null) {
          raise(a, NAV_ARRIVED, at);
          return;
        }
        // Following: the route is used up before the target is reached, so plan again.
        a.repathIn = 1;
      }
      a.next++;
      a.best = Infinity;
      to = path[a.next];
    }

    let vx = 0;
    let vy = 0;
    let hx = 0;
    let hy = 0;
    if (to) {
      const wx = to.x - at.x;
      const wy = to.y - at.y;
      const d = Math.sqrt(wx * wx + wy * wy);
      if (d > 0) {
        hx = wx / d;
        hy = wy / d;
        const pull = Math.min(block.speed, d / dt);
        vx = hx * pull;
        vy = hy * pull;
      }
    }

    const r = block.radius;
    if (block.separation > 0) {
      box.minX = at.x - r;
      box.minY = at.y - r;
      box.maxX = at.x + r;
      box.maxY = at.y + r;
      for (const other of ctx.query.inArea(box, neighbours)) {
        if (other === a.id) continue;
        const o = agents.get(other);
        if (!o?.on) continue;
        const p = ctx.poses.get(other);
        if (!p) continue;
        const ox = at.x - p.x;
        const oy = at.y - p.y;
        const d2 = ox * ox + oy * oy;
        if (d2 === 0 || d2 >= r * r) continue;
        const d = Math.sqrt(d2);
        const nx = ox / d;
        const ny = oy / d;
        const push = (block.separation * block.speed * (r - d)) / r;
        // A neighbour in its way also steers it to one side, so two agents meeting head-on pass.
        const ahead = -(nx * hx + ny * hy);
        const side = ahead > 0 ? push * ahead : 0;
        vx += nx * push + ny * side;
        vy += ny * push - nx * side;
      }
    }

    walk(a, at, vx * dt, vy * dt, dt, nav);

    const left = remaining(a, position(a));
    if (left < a.best - PROGRESS_EPSILON) {
      a.best = left;
      a.stuck = 0;
    } else if (++a.stuck >= block.repathTicks) {
      raise(a, NAV_BLOCKED, position(a), "stuck");
    }
  }

  const system: NavAgentSystem = {
    attach(id, block, entity) {
      const a: Agent = {
        id,
        type: entity.type,
        block: withDefaults(block),
        order: attached++,
        on: true,
        to: null,
        target: null,
        path: null,
        next: 0,
        repathIn: 0,
        best: Infinity,
        stuck: 0,
        blocked: null,
        body: bodyFor(entity),
        stood: false,
      };
      agents.set(id, a);
      countType(entity.type, 1);
      standIn(a);
      // The scene's own destination; planned at the first tick, once the walk areas and its target are in.
      const to = a.block.to;
      if (to !== undefined) {
        if (typeof to === "string") a.target = to;
        else a.to = { x: to[0], y: to[1] };
      }
    },
    update(id, block) {
      const a = agents.get(id);
      if (a) a.block = withDefaults(block);
    },
    detach(id) {
      const a = agents.get(id);
      if (!a) return;
      agents.delete(id);
      countType(a.type, -1);
      if (a.body) {
        a.body.destroy();
        if (a.stood && a.on) colliders()?.enable?.(id);
      }
    },
    beforeStep(dtMs) {
      if (agents.size === 0) return;
      const dt = dtMs / 1000;
      for (const a of agents.values()) if (a.on) tick(a, dt);
    },
    disable(id) {
      const a = agents.get(id);
      if (!a || !a.on) return;
      a.on = false;
      a.body?.setEnabled(false);
    },
    enable(id) {
      const a = agents.get(id);
      if (!a || a.on) return;
      a.on = true;
      a.body?.setEnabled(true);
      if (a.stood) colliders()?.disable?.(id);
    },
    setDestination(id, to) {
      const a = agents.get(id);
      if (!a) throw new Error(`"${id}" has no ${def.name} behavior`);
      end(a);
      if (typeof to === "string") a.target = to;
      else a.to = { x: to.x, y: to.y };
      a.stuck = 0;
      plan(a);
      // Followers spread their repaths across the period by the order they attached in.
      if (a.target !== null) a.repathIn = a.block.repathTicks - (a.order % a.block.repathTicks);
    },
    stop(id) {
      const a = agents.get(id);
      if (a) end(a);
    },
    path(id) {
      const a = agents.get(id);
      if (!a?.path || (a.to === null && a.target === null)) return null;
      return a.path.slice(a.next);
    },
    clear() {
      for (const a of agents.values()) a.body?.destroy();
      agents.clear();
      typeCounts.clear();
      neighbours.type = [];
      attached = 0;
    },
    size: () => agents.size,
    save(id) {
      const a = agents.get(id);
      if (!a) return undefined;
      // Idle, but its block names a destination: saved so a restore doesn't walk it there again.
      if (a.to === null && a.target === null) return a.block.to !== undefined ? {} : undefined;
      const state: { [key: string]: JsonValue } = a.to
        ? { to: [a.to.x, a.to.y] }
        : { target: a.target };
      if (a.path) state.path = a.path.map((w) => [w.x, w.y]);
      state.next = a.next;
      if (a.target !== null) state.repathIn = a.repathIn;
      if (Number.isFinite(a.best)) state.best = a.best;
      if (a.stuck > 0) state.stuck = a.stuck;
      if (a.blocked) state.blocked = a.blocked;
      return state;
    },
    restore(id, state) {
      const a = agents.get(id);
      if (!a || !isRecord(state)) return;
      end(a);
      const { to, target, path, next, repathIn, best, stuck, blocked } = state;
      const point = readPoint(to);
      if (point) a.to = point;
      else if (typeof target === "string") a.target = target;
      else return;
      if (Array.isArray(path)) {
        const pts: Vec2[] = [];
        for (const w of path) {
          const p = readPoint(w);
          if (p) pts.push(p);
        }
        a.path = pts;
      }
      if (isCount(next)) a.next = next;
      if (isNum(repathIn)) a.repathIn = repathIn;
      if (isNum(best)) a.best = best;
      if (isCount(stuck)) a.stuck = stuck;
      if (blocked === "no-path" || blocked === "stuck" || blocked === "gone") a.blocked = blocked;
    },
  };
  return system as BehaviorSystem;
};
