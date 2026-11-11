import type { EngineContext, Registry } from "../game/types";
import { buildNavMesh, navContains, navNearest, navPath, type NavMesh } from "../nav/navmesh";
import { isNavType } from "../scene/nav-type";
import type { Pt, RuntimeEntity, ShapeObj } from "../scene/types";
import { isNavSystem, type NavPolygon, type NavSystem } from "../systems/nav";
import type { Vec2 } from "../types";

/** Navigation over the loaded scene's walk areas: present when it has some. */
export type RuntimeNav = {
  mesh: NavMesh;
  path(from: Vec2, to: Vec2): Vec2[] | null;
  contains(p: Vec2): boolean;
  nearest(p: Vec2): Vec2;
};

const pt = (v: Vec2): Pt => [v.x, v.y];
const vec = ([x, y]: Pt): Vec2 => ({ x, y });

/** Every nav system of the runtime, in spawn order. */
function navSystems(ctx: EngineContext): NavSystem[] {
  const out: NavSystem[] = [];
  for (const name of ctx.registry.spawnGroups.flat()) {
    const system = ctx.system(name);
    if (isNavSystem(system)) out.push(system);
  }
  return out;
}

/**
 * The walk areas and holes among `entities` (a loaded scene's, in spawn
 * order) in the order `ctx.nav` reads them: type by type in the registry's
 * spawn order, each type's polygons in entity order.
 */
export function navPolygonsOf(
  entities: readonly RuntimeEntity[],
  registry: Registry,
): { areas: NavPolygon[]; holes: NavPolygon[] } {
  const byType = new Map<string, RuntimeEntity[]>();
  for (const e of entities) {
    const list = byType.get(e.type);
    if (list) list.push(e);
    else byType.set(e.type, [e]);
  }
  const areas: NavPolygon[] = [];
  const holes: NavPolygon[] = [];
  for (const name of registry.spawnGroups.flat()) {
    const list = byType.get(name);
    const type = registry.types.get(name);
    if (!list || !type || !isNavType(type)) continue;
    for (const e of list) {
      const shape = e.shape as ShapeObj | undefined;
      if (shape?.type !== "poly") continue;
      (e.mode === "block" ? holes : areas).push({ id: e.id, pts: shape.pts });
    }
  }
  return { areas, holes };
}

function runtimeNavOver(mesh: NavMesh): RuntimeNav {
  return {
    mesh,
    path: (from, to) => navPath(mesh, pt(from), pt(to))?.map(vec) ?? null,
    contains: (p) => navContains(mesh, pt(p)),
    nearest: (p) => vec(navNearest(mesh, pt(p))),
  };
}

/**
 * The nav systems' mesh as `ctx.nav` reads it, or null while there are no
 * walk areas. The mesh is rebuilt on the first read after an area or hole
 * changes.
 */
export function runtimeNav(ctx: EngineContext): RuntimeNav | null {
  const systems = navSystems(ctx);
  const first = systems[0];
  if (!first) return null;
  const key = systems.map((s) => s.revision()).join(",");
  if (first.memo?.key === key) return first.memo.nav;

  const areas: NavPolygon[] = [];
  const holes: NavPolygon[] = [];
  for (const s of systems) {
    areas.push(...s.areas());
    holes.push(...s.holes());
  }
  let nav: RuntimeNav | null = null;
  if (areas.length > 0) {
    const { mesh, issues } = buildNavMesh(areas, holes);
    if (ctx.dev)
      for (const issue of issues)
        console.warn(`[nav] ${issue.message} (${issue.entityIds.join(", ")})`);
    nav = runtimeNavOver(mesh);
  }
  first.memo = { key, nav };
  return nav;
}
