import { describe, expect, it } from "vite-plus/test";

import { ticksFor } from "../../game/time";
import { runGenreProbe } from "./harness";
import {
  END_TURN,
  MOVE,
  MS_PER_STEP,
  probe,
  REACHED,
  REVEALED,
  type TurnTacticsSnapshot,
} from "./turn-tactics.probe";

describe(`${probe.id} probe`, () => {
  it("ticks once per command plus once per tick a unit was walking", async () => {
    const run = await runGenreProbe(probe);
    const { report } = run;
    const final = report.final as TurnTacticsSnapshot;
    expect(report.outcome.result).toBe("won");
    expect(final).toMatchObject({ turn: 3, revealed: true, reached: true, walked: 10 });
    expect(final.units.scout).toEqual([7, 3]);
    const busyTicks = final.walked * ticksFor(MS_PER_STEP, { rate: report.tickRate });
    expect(report.commands.map(([, name]) => name)).toEqual([
      MOVE,
      MOVE,
      END_TURN,
      MOVE,
      MOVE,
      END_TURN,
      MOVE,
    ]);
    expect(report.ticks).toBe(report.commands.length + busyTicks);
    expect(report.slots).toBeGreaterThan(report.ticks);
    // The key's press and release waited, in order, for the tick the first command woke.
    expect(report.inputs).toEqual([
      [0, "inspect", 1],
      [0, "inspect", 0],
    ]);
    expect(report.commands[0]![0]).toBe(0);
    expect(final.inspected).toBe(1);
    expect(report.events.map((e) => e.type)).toEqual([REVEALED, REACHED]);
    expect(run.replay.matches).toBe(true);
    expect(run.replay.recording.end).toBe(report.recording.end);
  });
});
