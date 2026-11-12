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
  SAVE_AT,
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
    const inspect = report.stream.actions.indexOf("inspect");
    expect(inspect).toBeGreaterThanOrEqual(0);
    expect(report.stream.inputs[0]!.filter((e) => e[1] === "b")).toEqual([
      [0, "b", inspect, 1],
      [0, "b", inspect, 0],
    ]);
    expect(report.commands[0]![0]).toBe(0);
    expect(final.inspected).toBe(1);
    expect(report.events.map((e) => e.type)).toEqual([REVEALED, REACHED]);
    expect(run.replay.matches).toBe(true);
    expect(run.replay.recording.end).toBe(report.recording.end);
  });

  it("finishes from a world save taken mid-step, with steps still queued", async () => {
    const variant = probe.variants!.find((v) => v.saveAt === SAVE_AT)!;
    const run = await runGenreProbe(probe, variant);
    const restored = run.fromSave!;
    const saved = restored.saved as TurnTacticsSnapshot;
    expect(saved).toMatchObject({ turn: 1, moving: true, walked: 2 });
    expect(saved.queued?.scout?.length).toBeGreaterThan(0);
    expect(restored.save.data).toStrictEqual(saved);
    expect(restored.final).toStrictEqual(run.report.final);
    expect((restored.final as TurnTacticsSnapshot).queued).toBeUndefined();
    expect(restored.outcome).toStrictEqual(run.report.outcome);
    expect(restored.digest).toBe(run.digest);
  });
});
