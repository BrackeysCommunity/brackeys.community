import type { Aabb } from "./types";

/** A uniform-cell index of boxes by key. */
export type SpatialHash<K> = {
  /** Adds `key` at `box`; a key already present is moved and keeps its place in the order. */
  insert(key: K, box: Aabb): void;
  update(key: K, box: Aabb): void;
  remove(key: K): void;
  /** Keys whose boxes overlap `box` (touching counts), in insertion order. */
  query(box: Aabb): K[];
  clear(): void;
  readonly size: number;
};

/** A box covering more cells than this lives on a list every query scans. */
const MAX_CELLS = 1024;

type Slot<K> = { key: K; box: Aabb; seq: number; cells: string[] | null };

const overlaps = (a: Aabb, b: Aabb) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** The default cell's side, m. */
const DEFAULT_CELL = 2.56;

/** A hash with square cells of side `cell` (default 2.56 m). */
export function createSpatialHash<K>(cell = DEFAULT_CELL): SpatialHash<K> {
  if (!(cell > 0) || !Number.isFinite(cell)) {
    throw new RangeError(`createSpatialHash: cell must be a positive number, got ${cell}`);
  }
  const slots = new Map<K, Slot<K>>();
  const cells = new Map<string, Set<K>>();
  const big = new Set<K>();
  let nextSeq = 0;

  const span = (b: Aabb) => ({
    x0: Math.floor(b.minX / cell),
    y0: Math.floor(b.minY / cell),
    x1: Math.floor(b.maxX / cell),
    y1: Math.floor(b.maxY / cell),
  });

  function place(key: K, box: Aabb): string[] | null {
    const { x0, y0, x1, y1 } = span(box);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) {
      big.add(key);
      return null;
    }
    const keys: string[] = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        let set = cells.get(k);
        if (!set) cells.set(k, (set = new Set()));
        set.add(key);
        keys.push(k);
      }
    }
    return keys;
  }

  function unplace(key: K, slot: Slot<K>) {
    if (!slot.cells) {
      big.delete(key);
      return;
    }
    for (const k of slot.cells) {
      const set = cells.get(k);
      set?.delete(key);
      if (set?.size === 0) cells.delete(k);
    }
  }

  function put(key: K, box: Aabb) {
    const was = slots.get(key);
    if (was) unplace(key, was);
    const at = { ...box };
    slots.set(key, { key, box: at, seq: was?.seq ?? nextSeq++, cells: place(key, at) });
  }

  return {
    insert: put,
    update: put,
    remove(key) {
      const slot = slots.get(key);
      if (!slot) return;
      unplace(key, slot);
      slots.delete(key);
    },
    query(box) {
      const { x0, y0, x1, y1 } = span(box);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > cells.size) {
        const out: K[] = [];
        for (const [key, slot] of slots) if (overlaps(slot.box, box)) out.push(key);
        return out;
      }
      const seen = new Set<K>(big);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++)
          for (const key of cells.get(`${x},${y}`) ?? []) seen.add(key);
      }
      const hits: Slot<K>[] = [];
      for (const key of seen) {
        const slot = slots.get(key)!;
        if (overlaps(slot.box, box)) hits.push(slot);
      }
      return hits.sort((a, b) => a.seq - b.seq).map((slot) => slot.key);
    },
    clear() {
      slots.clear();
      cells.clear();
      big.clear();
      nextSeq = 0;
    },
    get size() {
      return slots.size;
    },
  };
}
