// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { probesFrom, type GenreRow } from "./harness";
import { GENRE_MATRIX, GENRE_ROWS, LANDED_THROUGH, genreMatrix, milestonesOf } from "./matrix";

const PROBES = probesFrom(
  import.meta.glob<Record<string, unknown>>("./*.probe.ts", { eager: true }),
);
const MATRIX = genreMatrix(PROBES);

describe("the genre matrix", () => {
  it("has plan 53's twenty rows, each delivered by at least one milestone", () => {
    expect(GENRE_ROWS).toHaveLength(20);
    for (const row of GENRE_ROWS) expect(MATRIX[row].milestones.length, row).toBeGreaterThan(0);
  });

  it("reads milestone lists, notes and ranges", () => {
    expect(milestonesOf("M14 (PHY-2), M15, M16, M22")).toStrictEqual([14, 15, 16, 22]);
    expect(milestonesOf("M16, M22 (ANI-5, FX-2), M27")).toStrictEqual([16, 22, 27]);
    expect(milestonesOf("M19–M21")).toStrictEqual([19, 20, 21]);
    expect(milestonesOf("M13, M14, M18, M23, M25, M11")).toStrictEqual([11, 13, 14, 18, 23, 25]);
    expect(() => milestonesOf("later")).toThrow(/can't read/);
  });

  it("names a probe for every row whose milestones have all landed", () => {
    const landed = GENRE_ROWS.filter((row) =>
      MATRIX[row].milestones.every((m) => m <= LANDED_THROUGH),
    );
    for (const row of landed) expect(MATRIX[row].probes.length, row).toBeGreaterThan(0);
  });

  describe.each(PROBES.map((p) => [p.id, p] as const))("%s", (_, probe) => {
    it("proves rows the matrix has", () => {
      expect(probe.rows.length).toBeGreaterThan(0);
      for (const row of probe.rows) expect(Object.keys(GENRE_MATRIX)).toContain(row);
    });

    it("lists pending needs only for its own rows, each naming a milestone still to land", () => {
      for (const [row, need] of Object.entries(probe.pending ?? {})) {
        expect(probe.rows).toContain(row as GenreRow);
        const named = [...(need ?? "").matchAll(/M(\d+)/g)].map((m) => Number(m[1]));
        expect(
          named.some((m) => m > LANDED_THROUGH),
          `${row}: ${need}`,
        ).toBe(true);
      }
    });
  });
});
