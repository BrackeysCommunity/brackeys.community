import type { EngineContext, RegisteredType, SceneSystem } from "../game/types";
import type { RuntimeNav } from "../runtime/nav";
import type { Pt, RuntimeEntity, ShapeObj } from "../scene/types";

export type NavEntity = RuntimeEntity<{
  shape: ShapeObj;
  mode?: "walk" | "block";
  tags?: string[];
}>;

/** A nav polygon as the mesh builder takes it. */
export type NavPolygon = { id: string; pts: readonly Pt[] };

export type NavSystem = SceneSystem<NavEntity> & {
  /** Live walk areas in spawn order. */
  areas(): NavPolygon[];
  /** Live block polygons (holes) in spawn order. */
  holes(): NavPolygon[];
  /** Bumped on every change to the areas or holes, so a mesh over them knows when to rebuild. */
  revision(): number;
  /** The runtime's mesh over every nav system, kept on the first one and keyed by their revisions. */
  memo: { key: string; nav: RuntimeNav | null } | null;
};

/** Whether `system` is a nav system: the one `ctx.nav` reads its polygons from. */
export function isNavSystem(system: SceneSystem | undefined): system is NavSystem {
  return (
    system !== undefined &&
    typeof (system as Partial<NavSystem>).areas === "function" &&
    typeof (system as Partial<NavSystem>).holes === "function" &&
    typeof (system as Partial<NavSystem>).revision === "function"
  );
}

/**
 * Walk areas and the holes cut out of them. Nothing enters the physics
 * world: the runtime builds a mesh from these on demand (`ctx.nav`).
 */
export function createNavSystem(_ctx: EngineContext, _type: RegisteredType): NavSystem {
  const live = new Map<string, NavEntity>();
  let rev = 0;

  const polygons = (mode: "walk" | "block"): NavPolygon[] => {
    const out: NavPolygon[] = [];
    for (const e of live.values()) {
      if ((e.mode ?? "walk") === mode && e.shape.type === "poly")
        out.push({ id: e.id, pts: e.shape.pts });
    }
    return out;
  };

  return {
    spawn(e) {
      live.delete(e.id);
      live.set(e.id, e);
      rev++;
    },
    despawn(id) {
      if (live.delete(id)) rev++;
    },
    clear() {
      if (live.size > 0) rev++;
      live.clear();
    },
    update(e) {
      live.set(e.id, e);
      rev++;
    },
    size: () => live.size,
    /** Nothing here simulates, so a disabled entity keeps its record as it is. */
    disable() {},
    enable() {},
    areas: () => polygons("walk"),
    holes: () => polygons("block"),
    revision: () => rev,
    memo: null,
  };
}
