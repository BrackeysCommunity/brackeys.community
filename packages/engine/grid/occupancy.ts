import { cellKey, cellOf, type Cell, type CellKey } from "./geometry";

/** Who stands on which cell, and which cells are walls. */
export interface Occupancy {
  /** Places or moves `id`; `blocks` (default true) makes the cell impassable to paths. */
  place(id: string, cell: Cell, opts?: { blocks?: boolean }): void;
  remove(id: string): void;
  /** Ids in placement order. */
  at(cell: Cell): readonly string[];
  cellOf(id: string): Cell | undefined;
  blocked(cell: Cell): boolean;
  setWall(cell: Cell, wall: boolean): void;
  wall(cell: Cell): boolean;
  clear(): void;
}

type Placed = { key: CellKey; blocks: boolean };

const NONE: readonly string[] = Object.freeze([]);

export function createOccupancy(): Occupancy {
  const placed = new Map<string, Placed>();
  const ids = new Map<CellKey, string[]>();
  /** Blocking occupants per cell. */
  const blockers = new Map<CellKey, number>();
  const walls = new Set<CellKey>();

  const addBlocker = (key: CellKey, n: number) => {
    const next = (blockers.get(key) ?? 0) + n;
    if (next > 0) blockers.set(key, next);
    else blockers.delete(key);
  };

  function remove(id: string): void {
    const p = placed.get(id);
    if (!p) return;
    placed.delete(id);
    const list = ids.get(p.key)!;
    list.splice(list.indexOf(id), 1);
    if (list.length === 0) ids.delete(p.key);
    if (p.blocks) addBlocker(p.key, -1);
  }

  return {
    place(id, cell, opts) {
      const key = cellKey(cell);
      const blocks = opts?.blocks ?? true;
      const p = placed.get(id);
      if (p && p.key === key) {
        // Same cell: keep its place in the order.
        if (p.blocks !== blocks) addBlocker(key, blocks ? 1 : -1);
        p.blocks = blocks;
        return;
      }
      remove(id);
      placed.set(id, { key, blocks });
      const list = ids.get(key);
      if (list) list.push(id);
      else ids.set(key, [id]);
      if (blocks) addBlocker(key, 1);
    },
    remove,
    at(cell) {
      const list = ids.get(cellKey(cell));
      return list ? [...list] : NONE;
    },
    cellOf(id) {
      const p = placed.get(id);
      return p ? cellOf(p.key) : undefined;
    },
    blocked: (cell) => blockers.has(cellKey(cell)),
    setWall(cell, wall) {
      if (wall) walls.add(cellKey(cell));
      else walls.delete(cellKey(cell));
    },
    wall: (cell) => walls.has(cellKey(cell)),
    clear() {
      placed.clear();
      ids.clear();
      blockers.clear();
      walls.clear();
    },
  };
}
