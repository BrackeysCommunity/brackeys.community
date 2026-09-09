import { describe, expect, it } from "vite-plus/test";

import { spin } from "../../sim/spin.ts";
import { plainWheel } from "../../sim/state.ts";
import { plainPockets, withGaff, withTrait } from "../../sim/upgrades.ts";
import { ANGLE_UNITS, POCKET_COUNT } from "../../sim/wheel.ts";
import { bandSlots, cues, durationMs, durationTicks, frameAt, tickAt } from "../playback.ts";
import { describeWheel, pocketMarks } from "../WheelView.tsx";

const trace = (seed: string, nudgeTicks?: number[]) =>
  spin(plainWheel(), { bets: [], balls: [{ ballId: "ball-1", launchTick: 0, nudgeTicks }] }, seed)
    .balls[0]!;

describe("frameAt", () => {
  it("holds the ball on the track before it drops", () => {
    const t = trace("pb-1");
    const frame = frameAt(t, t.launch.dropTick - 60);
    expect(frame.phase).toBe("track");
    expect(frame.radius).toBe(1);
    expect(frame.slot).toBeNull();
  });

  it("arrives at the exit angle exactly on the drop tick", () => {
    // The renderer's interpolated run-up has to land where the sim says.
    const t = trace("pb-2");
    const frame = frameAt(t, t.launch.dropTick - 1);
    expect(Math.abs(frame.angle - t.launch.exitAngle)).toBeLessThan(60);
  });

  it("falls toward the rotor between the drop and the diamond", () => {
    const t = trace("pb-3");
    const mid = Math.floor((t.launch.dropTick + t.drop.contactTick) / 2);
    const frame = frameAt(t, mid);
    expect(frame.phase).toBe("drop");
    expect(frame.radius).toBeGreaterThan(0);
    expect(frame.radius).toBeLessThan(1);
  });

  it("walks the frets in the order the trace recorded them", () => {
    const t = trace("pb-4");
    const hits = t.scatters.flatMap((leg) => leg.frets);
    if (hits.length === 0) return;
    for (const [index, hit] of hits.entries()) {
      const before = frameAt(t, hit.tick - 1);
      expect(before.crossings).toBe(index);
      const after = frameAt(t, hit.tick);
      expect(after.slot).toBe(hit.slot);
    }
  });

  it("ends on the pocket the sim settled in", () => {
    for (let i = 0; i < 60; i++) {
      const t = trace(`pb-end-${i}`);
      const frame = frameAt(t, durationTicks(t));
      expect(frame.phase).toBe("settled");
      expect(frame.slot).not.toBeNull();
      expect(frame.radius).toBe(0);
    }
  });

  it("never reports a slot off the wheel", () => {
    const t = trace("pb-5");
    for (let tick = 0; tick <= durationTicks(t); tick += 3) {
      const frame = frameAt(t, tick);
      if (frame.slot === null) continue;
      expect(frame.slot).toBeGreaterThanOrEqual(0);
      expect(frame.slot).toBeLessThan(POCKET_COUNT);
    }
  });

  it("keeps every angle inside one revolution", () => {
    const t = trace("pb-6");
    for (let tick = 0; tick <= durationTicks(t); tick += 3) {
      const { angle } = frameAt(t, tick);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(ANGLE_UNITS);
    }
  });

  it("is a pure function of the trace and the tick", () => {
    const t = trace("pb-7");
    expect(frameAt(t, 400)).toEqual(frameAt(t, 400));
  });
});

describe("durationTicks", () => {
  it("outlasts the final fret crossing", () => {
    const t = trace("dur-1");
    const last = t.scatters.at(-1)!.endTick;
    expect(durationTicks(t)).toBeGreaterThan(last);
  });

  it("converts to a watchable number of milliseconds", () => {
    const ms = durationMs(trace("dur-2"));
    expect(ms).toBeGreaterThan(4000);
    expect(ms).toBeLessThan(20_000);
  });

  it("round-trips through tickAt", () => {
    expect(tickAt(1000)).toBe(60);
    expect(tickAt(0)).toBe(0);
  });
});

describe("cues", () => {
  it("emits one per fret crossing plus a settle", () => {
    const t = trace("cue-1");
    const crossings = t.scatters.flatMap((leg) => leg.frets).length;
    const list = cues(t);
    expect(list.filter((c) => c.kind === "fret")).toHaveLength(crossings);
    expect(list.filter((c) => c.kind === "settle")).toHaveLength(1);
  });

  it("comes back in tick order, so a player can walk it with one cursor", () => {
    for (let i = 0; i < 40; i++) {
      const list = cues(trace(`cue-${i}`));
      const ticks = list.map((c) => c.tick);
      expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
    }
  });

  it("marks a nudged crossing so it can sound different", () => {
    const t = trace("cue-nudge", [493, 495]);
    if (t.nudgesUsed === 0) return;
    expect(cues(t).some((c) => c.kind === "fret" && c.nudged)).toBe(true);
  });

  it("names the number it settled on", () => {
    const t = trace("cue-settle");
    const settle = cues(t).find((c) => c.kind === "settle");
    expect(settle).toMatchObject({ number: t.final.number });
  });
});

describe("bandSlots", () => {
  it("covers the centre plus its half-width either side", () => {
    expect(bandSlots(10, 2)).toEqual([8, 9, 10, 11, 12]);
  });

  it("wraps around the zero", () => {
    expect(bandSlots(0, 1)).toEqual([36, 0, 1]);
  });

  it("never returns more slots than the wheel has", () => {
    expect(bandSlots(5, 40).length).toBeLessThanOrEqual(POCKET_COUNT);
  });
});

describe("pocketMarks", () => {
  it("draws nothing on a plain pocket", () => {
    expect(pocketMarks(plainPockets()[17]!)).toBe("");
  });

  it("counts a gaff in dots, which reads faster than a numeral at this size", () => {
    expect(pocketMarks(withGaff(plainPockets(), 17, 1)[17]!)).toBe("•");
    expect(pocketMarks(withGaff(plainPockets(), 17, 3)[17]!)).toBe("•••");
  });

  it("gives every trait its own glyph", () => {
    const glyphs = new Set<string>();
    for (const trait of [
      "spring",
      "sticky",
      "magnet",
      "hot",
      "echo",
      "bank",
      "wild",
      "cold",
    ] as const) {
      glyphs.add(pocketMarks(withTrait(plainPockets(), 17, trait)[17]!));
    }
    expect(glyphs.size).toBe(8);
  });

  it("stacks a gaff and its traits", () => {
    const pockets = withTrait(withGaff(plainPockets(), 17, 2), 17, "sticky");
    expect(pocketMarks(pockets[17]!)).toBe("••●");
  });
});

describe("describeWheel", () => {
  /**
   * `07` lists "a plain-text wheel summary" among the things its legibility
   * risk probably needs. This is it, and it doubles as the SVG's accessible
   * name so the two cannot drift.
   */
  it("says the wheel is plain when it is", () => {
    expect(describeWheel(plainWheel())).toContain("No upgraded pockets");
  });

  it("names every upgraded pocket and what it carries", () => {
    let pockets = withGaff(plainPockets(), 17, 2);
    pockets = withTrait(pockets, 17, "sticky");
    pockets = withTrait(pockets, 16, "spring");
    const summary = describeWheel(plainWheel({ pockets }));
    expect(summary).toContain("17 x3 sticky");
    expect(summary).toContain("16 spring");
  });

  it("reports the last number when there is one", () => {
    expect(describeWheel(plainWheel(), 17)).toContain("Last number 17");
    expect(describeWheel(plainWheel(), null)).not.toContain("Last number");
  });
});
