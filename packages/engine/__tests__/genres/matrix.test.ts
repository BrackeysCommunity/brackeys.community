// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { ENGINE_VERSION } from "../../version";
import { probesFrom, type GenreRow } from "./harness";
import {
  GENRE_MATRIX,
  GENRE_ROWS,
  MILESTONE_VERSIONS,
  compareVersions,
  genreMatrix,
  landed,
  landedRows,
  milestonesOf,
} from "./matrix";

const PROBES = probesFrom(
  import.meta.glob<Record<string, unknown>>("./*.probe.ts", { eager: true }),
);
const MATRIX = genreMatrix(PROBES);

/** The probes that list `row` with nothing pending on it. */
const completing = (row: GenreRow) =>
  PROBES.filter((p) => p.rows.includes(row) && p.pending?.[row] === undefined).map((p) => p.id);

/** The milestones a pending need names. */
const named = (need: string) => [...need.matchAll(/M(\d+)/g)].map((m) => Number(m[1]));

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

  it("dates only shipped milestones, each version once, none ahead of the engine", () => {
    const versions = Object.values(MILESTONE_VERSIONS);
    expect(new Set(versions).size).toBe(versions.length);
    for (const [m, at] of Object.entries(MILESTONE_VERSIONS)) {
      expect(compareVersions(at, ENGINE_VERSION), `M${m} at ${at}`).toBeLessThanOrEqual(0);
    }
    expect(MILESTONE_VERSIONS[22]).toBe("0.15.0");
  });

  it("counts a milestone landed once the engine's version reaches its own", () => {
    expect(compareVersions("0.15.0", "0.14.5")).toBeGreaterThan(0);
    expect(compareVersions("0.14.10", "0.14.9")).toBeGreaterThan(0);
    expect(compareVersions("0.15.0-dev.1", "0.15.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(() => compareVersions("next", "1.0.0")).toThrow(/can't read/);
    expect(landed(22, "0.14.5")).toBe(false);
    expect(landed(22, "0.15.0")).toBe(true);
    expect(landed(31, "0.14.5")).toBe(true);
    // Milestones don't land in number order.
    expect(landed(42, "0.14.5")).toBe(true);
    expect(landed(99, "9.0.0")).toBe(false);
    expect(landed(19)).toBe(compareVersions(ENGINE_VERSION, "0.14.0") >= 0);
  });

  it("names a probe with nothing pending for every row whose milestones have all landed", () => {
    for (const row of landedRows()) expect(completing(row), row).not.toStrictEqual([]);
    expect(MATRIX["tower-defense"].probes).toContain("tower-defense");
    expect(MATRIX.tactics.probes).toContain("turn-tactics");
  });

  it("completes the rows animation, cameras and effects finish, and idle", () => {
    const rows: GenreRow[] = [
      "puzzle",
      "twin-stick",
      "racing",
      "local-multiplayer",
      "endless-runner",
      "idle",
    ];
    for (const row of rows) expect(completing(row), row).not.toStrictEqual([]);
    expect(completing("puzzle")).toContain("grid-puzzle");
    expect(completing("twin-stick")).toContain("shooter");
    expect(completing("endless-runner")).toContain("shooter");
    expect(completing("racing")).toContain("racing");
    expect(completing("local-multiplayer")).toContain("local-versus");
    expect(completing("idle")).toContain("idle");
  });

  it("lands exactly those rows with the milestone that finishes them", () => {
    const before = new Set(landedRows("0.14.5"));
    expect([...before].sort()).toStrictEqual(["idle", "tactics", "tower-defense"]);
    const added = landedRows(MILESTONE_VERSIONS[22]).filter((row) => !before.has(row));
    expect(added.sort()).toStrictEqual([
      "endless-runner",
      "local-multiplayer",
      "puzzle",
      "racing",
      "twin-stick",
    ]);
  });

  it("leaves turn-tactics nothing pending on the tactics row", () => {
    const probe = PROBES.find((p) => p.id === "turn-tactics");
    expect(probe?.rows).toContain("tactics");
    expect(probe?.pending?.tactics).toBeUndefined();
  });

  it("names the input probes on the rows they prove", () => {
    expect(GENRE_MATRIX["local-multiplayer"].probes).toContain("local-versus");
    expect(GENRE_MATRIX.fighting.probes).toContain("local-versus");
    expect(GENRE_MATRIX["point-and-click"].probes).toContain("point-and-click");
    expect(GENRE_MATRIX.rts.probes).toContain("point-and-click");
    expect(GENRE_MATRIX.rhythm.probes).toContain("rhythm-tap");
  });

  it("names, on each row, exactly the probes that list it", () => {
    for (const row of GENRE_ROWS)
      expect(MATRIX[row].probes, row).toStrictEqual([...GENRE_MATRIX[row].probes].sort());
  });

  describe.each(PROBES.map((p) => [p.id, p] as const))("%s", (_, probe) => {
    it("proves rows the matrix has", () => {
      expect(probe.rows.length).toBeGreaterThan(0);
      for (const row of probe.rows) expect(Object.keys(GENRE_MATRIX)).toContain(row);
    });

    it("lists pending needs only for its own rows, naming only milestones still to land", () => {
      for (const [row, need] of Object.entries(probe.pending ?? {})) {
        expect(probe.rows).toContain(row as GenreRow);
        const milestones = named(need ?? "");
        expect(milestones.length, `${row}: ${need}`).toBeGreaterThan(0);
        expect(
          milestones.filter((m) => landed(m)),
          `${row}: ${need}`,
        ).toStrictEqual([]);
      }
    });
  });
});
