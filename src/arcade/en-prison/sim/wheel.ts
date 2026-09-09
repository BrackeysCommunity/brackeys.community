/**
 * The wheel's anatomy: pocket order, colours, sectors, deflectors, and the
 * angular space the spin stages work in.
 *
 * Angles are integers in `ANGLE_UNITS` per revolution, chosen so that both
 * 37 pockets and 8 deflectors divide it exactly — 7400 = 37 × 200 = 8 × 925.
 * Every stage that reasons about "where on the wheel" does it in these
 * units, never in degrees or radians, so nothing in the sim needs a float
 * or a trig call. The renderer converts to radians on its own side.
 */

export const POCKET_COUNT = 37;
export const ANGLE_UNITS = 7400;
export const UNITS_PER_POCKET = ANGLE_UNITS / POCKET_COUNT; // 200
export const DEFLECTOR_COUNT = 8;
export const UNITS_PER_DEFLECTOR = ANGLE_UNITS / DEFLECTOR_COUNT; // 925

/**
 * A single-zero (European) wheel, clockwise from the zero pocket. This is
 * the real order, not a sorted list, and it is load-bearing: the call-bet
 * sectors below are contiguous arcs of *this* sequence, and a magnet or a
 * spring pocket acts on physical neighbours, which are nothing like
 * numeric neighbours.
 */
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const SLOT_OF = (() => {
  const map = new Int8Array(POCKET_COUNT).fill(-1);
  for (let slot = 0; slot < WHEEL_ORDER.length; slot++) map[WHEEL_ORDER[slot]!] = slot;
  return map;
})();

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export type PocketColor = "red" | "black" | "green";

export function pocketColor(n: number): PocketColor {
  if (n === 0) return "green";
  return RED.has(n) ? "red" : "black";
}

/** The physical position of a number on the rotor, 0 at the zero pocket. */
export function slotOf(n: number): number {
  const slot = SLOT_OF[n];
  if (slot === undefined || slot < 0) throw new RangeError(`no pocket for ${n}`);
  return slot;
}

export function numberAt(slot: number): number {
  return WHEEL_ORDER[normalizeSlot(slot)]!;
}

export function normalizeSlot(slot: number): number {
  return ((slot % POCKET_COUNT) + POCKET_COUNT) % POCKET_COUNT;
}

export function normalizeAngle(angle: number): number {
  return ((angle % ANGLE_UNITS) + ANGLE_UNITS) % ANGLE_UNITS;
}

/** The pocket an angle in rotor-frame units falls in. */
export function angleToSlot(angle: number): number {
  return Math.floor(normalizeAngle(angle) / UNITS_PER_POCKET);
}

export function slotToAngle(slot: number): number {
  return normalizeSlot(slot) * UNITS_PER_POCKET;
}

/** Signed distance in pockets, shortest way round: negative is anticlockwise. */
export function slotDistance(from: number, to: number): number {
  const raw = normalizeSlot(to - from);
  return raw > POCKET_COUNT / 2 ? raw - POCKET_COUNT : raw;
}

/**
 * The three call-bet sectors, listed in wheel order. Their membership is
 * what the set bonus keys off ("three or more upgraded pockets in one
 * sector"), so they are stored in the order they sit on the rotor rather
 * than sorted, to keep that adjacency visible.
 *
 * Voisins and Tiers are each one arc. Orphelins is two — 17-34-6 and
 * 1-20-14-31-9, the pockets the other two leave behind, which is where the
 * name comes from. Anything drawing a sector highlight has to handle the
 * gap.
 */
export const SECTORS = {
  voisins: [22, 18, 29, 7, 28, 12, 35, 3, 26, 0, 32, 15, 19, 4, 21, 2, 25],
  tiers: [27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33],
  orphelins: [17, 34, 6, 1, 20, 14, 31, 9],
} as const satisfies Record<string, readonly number[]>;

export type SectorName = keyof typeof SECTORS;

const SECTOR_OF = (() => {
  const map = new Map<number, SectorName>();
  for (const name of Object.keys(SECTORS) as SectorName[]) {
    for (const n of SECTORS[name]) map.set(n, name);
  }
  return map;
})();

export function sectorOf(n: number): SectorName {
  const sector = SECTOR_OF.get(n);
  if (!sector) throw new RangeError(`no sector for ${n}`);
  return sector;
}

/**
 * The eight diamonds, at fixed angles in the *table* frame — they are bolted
 * to the bowl, not to the rotor, which is the entire reason a dominant
 * deflector is exploitable: it is the one part of the wheel that does not
 * move under the ball.
 */
export function deflectorAngle(index: number): number {
  return (((index % DEFLECTOR_COUNT) + DEFLECTOR_COUNT) % DEFLECTOR_COUNT) * UNITS_PER_DEFLECTOR;
}

/** The diamond nearest a table angle, and how far off it the ball arrived. */
export function nearestDeflector(tableAngle: number): { index: number; offset: number } {
  const a = normalizeAngle(tableAngle);
  const index = Math.round(a / UNITS_PER_DEFLECTOR) % DEFLECTOR_COUNT;
  let offset = a - index * UNITS_PER_DEFLECTOR;
  if (offset > ANGLE_UNITS / 2) offset -= ANGLE_UNITS;
  if (offset < -ANGLE_UNITS / 2) offset += ANGLE_UNITS;
  return { index, offset };
}
