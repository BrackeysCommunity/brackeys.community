import type { BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import type { OccupantBlock } from "../../game/behaviors/occupant";
import type { EngineContext, JsonValue } from "../../game/types";
import { cellKey, cellOf, type CellKey } from "../../grid/geometry";

/** The occupant system; the grid calls `resync` when it is rebuilt under attached entities. */
export type OccupantSystem = BehaviorSystem<OccupantBlock> & {
  /** Places every attached entity afresh at its pose's cell. */
  resync(): void;
};

type Attached = { blocks: boolean; key: CellKey | null };

/**
 * The occupant system: each entity carrying an `occupant` block stands in
 * `ctx.grid.occupancy` on the cell under its pose, re-placed after each
 * tick when its pose crossed into another cell. Nothing is placed while the
 * loaded scene has no grid. A world save keeps the cell it stands in.
 */
export const createOccupantSystem: BehaviorSystemFactory = (ctx: EngineContext) => {
  const attached = new Map<string, Attached>();

  /** Places `id` at its pose's cell when that differs from where it stands (or `force`). */
  function place(id: string, a: Attached, force: boolean): void {
    const grid = ctx.grid;
    const pose = ctx.poses.get(id);
    if (!grid || !pose) return;
    const cell = grid.geometry.cellAt([pose.x, pose.y]);
    const key = cellKey(cell);
    if (!force && key === a.key) return;
    grid.occupancy.place(id, cell, { blocks: a.blocks });
    a.key = key;
  }

  function show(id: string, block: OccupantBlock): void {
    const a: Attached = { blocks: block.blocks !== false, key: null };
    attached.set(id, a);
    place(id, a, true);
  }

  function hide(id: string): void {
    if (!attached.delete(id)) return;
    ctx.grid?.occupancy.remove(id);
  }

  const system: OccupantSystem = {
    attach: (id, block) => show(id, block),
    update: (id, block) => show(id, block),
    detach: hide,
    step() {
      for (const [id, a] of attached) place(id, a, false);
    },
    /** The cell it stands in, which trails its pose until the tick's end. */
    save(id) {
      const a = attached.get(id);
      return a && a.key !== null ? [...cellOf(a.key)] : undefined;
    },
    restore(id, state: JsonValue) {
      const a = attached.get(id);
      const grid = ctx.grid;
      if (!a || !grid || !Array.isArray(state)) return;
      const [c, r] = state;
      if (!Number.isInteger(c) || !Number.isInteger(r)) return;
      const cell: [number, number] = [c as number, r as number];
      grid.occupancy.place(id, cell, { blocks: a.blocks });
      a.key = cellKey(cell);
    },
    resync() {
      for (const [id, a] of attached) place(id, a, true);
    },
    clear() {
      for (const id of [...attached.keys()]) hide(id);
    },
    size: () => attached.size,
  };
  return system as BehaviorSystem;
};
