// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { probeProjectView, runGenreProbe, type GenreProbe } from "./harness";
import {
  towerDefenseProbe as probe,
  WAVE_ROWS,
  type TowerDefenseSnapshot,
} from "./tower-defense.probe";

const withWaves = (rows: readonly Record<string, unknown>[]): GenreProbe<TowerDefenseSnapshot> => ({
  ...probe,
  project: { tables: { wave: rows } },
});

describe(`${probe.id} probe`, () => {
  it("spawns the waves its project's wave table holds", async () => {
    const { report } = await runGenreProbe(probe);
    const final = report.final as TowerDefenseSnapshot;
    const total = WAVE_ROWS.reduce((n, w) => n + w.count, 0);
    expect(report.outcome.result).toBe("won");
    expect(final).toMatchObject({ total, spawned: total, kills: total, escaped: 0 });
  });

  it("follows a changed table without a code change", async () => {
    const { report } = await runGenreProbe(
      withWaves([{ id: "only", startMs: 500, everyMs: 400, count: 2, hp: 1 }]),
    );
    expect(report.outcome.result).toBe("won");
    expect(report.final).toMatchObject({ total: 2, spawned: 2, kills: 2 });
  });

  it("spawns nothing and never wins without a project", async () => {
    const { report } = await runGenreProbe({ ...probe, project: undefined });
    expect(report.outcome.result).not.toBe("won");
    expect(report.final).toMatchObject({ total: 0, spawned: 0 });
  });

  it("refuses a table the game doesn't declare and a row its schema leaves out", () => {
    expect(() =>
      probeProjectView({ ...probe, project: { tables: { creeps: [] } } } as GenreProbe),
    ).toThrow(/no data table creeps/);
    expect(() =>
      probeProjectView(
        withWaves([{ id: "bad", startMs: 0, everyMs: 0, count: 1, hp: 1 }]) as GenreProbe,
      ),
    ).toThrow(/doesn't fit its schema/);
  });
});
