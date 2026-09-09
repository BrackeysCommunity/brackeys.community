import { describe, expect, it } from "vite-plus/test";

import {
  ANGLE_UNITS,
  angleToSlot,
  DEFLECTOR_COUNT,
  deflectorAngle,
  nearestDeflector,
  normalizeAngle,
  normalizeSlot,
  numberAt,
  POCKET_COUNT,
  pocketColor,
  SECTORS,
  sectorOf,
  slotDistance,
  slotOf,
  slotToAngle,
  UNITS_PER_POCKET,
  WHEEL_ORDER,
} from "../wheel.ts";

describe("WHEEL_ORDER", () => {
  it("is a single-zero wheel: every number once, no more", () => {
    expect(WHEEL_ORDER).toHaveLength(POCKET_COUNT);
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
  });

  it("starts at zero", () => {
    expect(WHEEL_ORDER[0]).toBe(0);
  });

  it("puts a red opposite a black at every pocket", () => {
    // The real wheel alternates colour all the way round except across the
    // zero. If a transcription error crept into the order this catches it.
    for (let slot = 1; slot < POCKET_COUNT - 1; slot++) {
      const here = pocketColor(WHEEL_ORDER[slot]!);
      const next = pocketColor(WHEEL_ORDER[slot + 1]!);
      if (here === "green" || next === "green") continue;
      expect(here).not.toBe(next);
    }
  });

  it("pairs consecutive numbers across the wheel", () => {
    // Another property of the real layout: 1 faces 2, 3 faces 4, and so on
    // across the diameter, give or take a slot for the zero.
    expect(Math.abs(slotDistance(slotOf(1), slotOf(2)))).toBeGreaterThan(15);
    expect(Math.abs(slotDistance(slotOf(35), slotOf(36)))).toBeGreaterThan(15);
  });
});

describe("pocketColor", () => {
  it("makes zero green", () => {
    expect(pocketColor(0)).toBe("green");
  });

  it("splits eighteen and eighteen", () => {
    const numbers = Array.from({ length: 36 }, (_, i) => i + 1);
    expect(numbers.filter((n) => pocketColor(n) === "red")).toHaveLength(18);
    expect(numbers.filter((n) => pocketColor(n) === "black")).toHaveLength(18);
  });

  it("matches the felt on the numbers people check", () => {
    expect(pocketColor(1)).toBe("red");
    expect(pocketColor(2)).toBe("black");
    expect(pocketColor(10)).toBe("black");
    expect(pocketColor(19)).toBe("red");
    expect(pocketColor(36)).toBe("red");
  });
});

describe("slotOf / numberAt", () => {
  it("round-trips every number", () => {
    for (let n = 0; n <= 36; n++) expect(numberAt(slotOf(n))).toBe(n);
  });

  it("wraps a slot past the end of the wheel", () => {
    expect(numberAt(POCKET_COUNT)).toBe(numberAt(0));
    expect(numberAt(-1)).toBe(numberAt(POCKET_COUNT - 1));
  });

  it("refuses a number that is not on the wheel", () => {
    expect(() => slotOf(37)).toThrow(RangeError);
    expect(() => slotOf(-1)).toThrow(RangeError);
  });
});

describe("angles", () => {
  it("divides evenly by both pockets and deflectors", () => {
    expect(ANGLE_UNITS % POCKET_COUNT).toBe(0);
    expect(ANGLE_UNITS % DEFLECTOR_COUNT).toBe(0);
  });

  it("normalizes onto one revolution", () => {
    expect(normalizeAngle(ANGLE_UNITS)).toBe(0);
    expect(normalizeAngle(-1)).toBe(ANGLE_UNITS - 1);
    expect(normalizeAngle(ANGLE_UNITS * 3 + 5)).toBe(5);
  });

  it("round-trips slots through angles", () => {
    for (let slot = 0; slot < POCKET_COUNT; slot++) {
      expect(angleToSlot(slotToAngle(slot))).toBe(slot);
    }
  });

  it("keeps a whole pocket's worth of angle in the same pocket", () => {
    expect(angleToSlot(0)).toBe(0);
    expect(angleToSlot(UNITS_PER_POCKET - 1)).toBe(0);
    expect(angleToSlot(UNITS_PER_POCKET)).toBe(1);
  });

  it("normalizes slots", () => {
    expect(normalizeSlot(-1)).toBe(36);
    expect(normalizeSlot(38)).toBe(1);
  });
});

describe("slotDistance", () => {
  it("takes the short way round and keeps the sign", () => {
    expect(slotDistance(0, 3)).toBe(3);
    expect(slotDistance(3, 0)).toBe(-3);
    expect(slotDistance(0, 36)).toBe(-1);
    expect(slotDistance(36, 0)).toBe(1);
  });

  it("is zero for a pocket against itself", () => {
    expect(slotDistance(12, 12)).toBe(0);
  });
});

describe("SECTORS", () => {
  it("covers the wheel exactly once", () => {
    const all = [...SECTORS.voisins, ...SECTORS.tiers, ...SECTORS.orphelins];
    expect(all).toHaveLength(POCKET_COUNT);
    expect(new Set(all).size).toBe(POCKET_COUNT);
  });

  it("has the sizes the call bets are named for", () => {
    expect(SECTORS.voisins).toHaveLength(17);
    expect(SECTORS.tiers).toHaveLength(12);
    expect(SECTORS.orphelins).toHaveLength(8);
  });

  it("lists voisins and tiers as single contiguous arcs", () => {
    // The set bonus keys off "three or more upgraded pockets in one
    // sector", which only means anything if a sector is an arc of the
    // wheel, so the order stored here has to be the wheel's own.
    for (const numbers of [SECTORS.voisins, SECTORS.tiers]) {
      for (let i = 1; i < numbers.length; i++) {
        expect(slotDistance(slotOf(numbers[i - 1]!), slotOf(numbers[i]!))).toBe(1);
      }
    }
  });

  it("lists orphelins as the two arcs it actually is", () => {
    // Orphelins are the pockets orphaned by the other two sectors: 17-34-6
    // on one side of the wheel and 1-20-14-31-9 on the other. It is a set,
    // not an arc, and anything drawing sector highlights has to know that.
    const breaks = SECTORS.orphelins.filter(
      (n, i) => i > 0 && slotDistance(slotOf(SECTORS.orphelins[i - 1]!), slotOf(n)) !== 1,
    );
    expect(breaks).toEqual([1]);
  });

  it("puts zero in the voisins, where it belongs", () => {
    expect(sectorOf(0)).toBe("voisins");
    expect(sectorOf(27)).toBe("tiers");
    expect(sectorOf(17)).toBe("orphelins");
  });
});

describe("deflectors", () => {
  it("spaces eight diamonds evenly and wraps", () => {
    for (let i = 0; i < DEFLECTOR_COUNT; i++) {
      expect(deflectorAngle(i)).toBe((i * ANGLE_UNITS) / DEFLECTOR_COUNT);
    }
    expect(deflectorAngle(DEFLECTOR_COUNT)).toBe(0);
    expect(deflectorAngle(-1)).toBe(deflectorAngle(DEFLECTOR_COUNT - 1));
  });

  it("finds the nearest diamond and how far off the ball arrived", () => {
    expect(nearestDeflector(deflectorAngle(3))).toEqual({ index: 3, offset: 0 });
    expect(nearestDeflector(deflectorAngle(3) + 10)).toEqual({ index: 3, offset: 10 });
    expect(nearestDeflector(deflectorAngle(3) - 10)).toEqual({ index: 3, offset: -10 });
  });

  it("wraps past the last diamond back to the first", () => {
    const { index } = nearestDeflector(ANGLE_UNITS - 5);
    expect(index).toBe(0);
  });

  it("never reports an offset more than half a gap", () => {
    const halfGap = ANGLE_UNITS / DEFLECTOR_COUNT / 2;
    for (let a = 0; a < ANGLE_UNITS; a += 7) {
      const { index, offset } = nearestDeflector(a);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(DEFLECTOR_COUNT);
      expect(Math.abs(offset)).toBeLessThanOrEqual(halfGap);
    }
  });
});
