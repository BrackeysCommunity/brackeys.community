import { describe, expect, it } from "vite-plus/test";

import type { InputScriptV2 } from "../../headless/playtest-types";
import { runGenreProbe, type GenreProbe } from "./harness";
import {
  pointAndClickProbe as probe,
  TRIGGERED,
  USE,
  type PointAndClickSnapshot,
} from "./point-and-click.probe";

/** The probe with its script's `use` naming another hotspot than the press picked. */
function usingInstead(hotspot: string): GenreProbe<PointAndClickSnapshot> {
  const script = probe.script as InputScriptV2 & { steps: NonNullable<InputScriptV2["steps"]> };
  const steps = script.steps.map((s) =>
    "command" in s && s.command === USE ? { command: USE, args: { hotspot } } : s,
  );
  return { ...probe, script: { ...script, steps } };
}

describe(`${probe.id} probe`, () => {
  it("fires a hotspot through the `use` command sent for the press that picked it", async () => {
    const run = await runGenreProbe(probe);
    const { report } = run;
    const final = report.final as PointAndClickSnapshot;
    expect(report.outcome.result).toBe("won");
    expect(final).toMatchObject({ clicks: 3, ignored: 1, picked: null, triggered: ["door"] });
    expect(report.commands.map(([, name, args]) => [name, args])).toEqual([
      [USE, { hotspot: "door" }],
    ]);
    expect(report.events.filter((e) => e.type === TRIGGERED).map((e) => e.entityId)).toEqual([
      "door",
    ]);
    expect(run.replay.matches).toBe(true);
    expect(run.replay.recording.commands).toEqual(report.recording.commands);
  });

  it("refuses a `use` of anything the last press didn't pick", async () => {
    const { report } = await runGenreProbe(usingInstead("window"));
    const final = report.final as PointAndClickSnapshot;
    expect(report.outcome.result).not.toBe("won");
    expect(final).toMatchObject({ ignored: 2, picked: "door", triggered: [] });
  });
});
