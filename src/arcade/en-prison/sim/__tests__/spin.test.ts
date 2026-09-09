import { describe, expect, it } from "vite-plus/test";

import { digestOf, FP_ONE, Rng } from "../../../sim-kit/index.ts";
import type { Bet } from "../bets.ts";
import {
  bounceChance,
  IllegalBetError,
  launch,
  previewDropZone,
  rotorAngleAt,
  type SpinInput,
  spin,
  spinSummary,
  trackPhase,
} from "../spin.ts";
import { plainWheel, ROTOR_SPEEDS, type Ball } from "../state.ts";
import { plainPockets, withGaff } from "../upgrades.ts";
import { ANGLE_UNITS, POCKET_COUNT, slotDistance } from "../wheel.ts";

const BALL: Ball = { id: "ball-1", material: "ivory", size: "standard", chipped: false };

/**
 * Tick zero is the tap the marker is drawn for: the rotor starts at angle
 * zero and so does the marker, so a launch there scores a perfect window.
 */
const PERFECT_TICK = 0;

function oneSpin(overrides: Partial<SpinInput> = {}, wheel = plainWheel()) {
  const input: SpinInput = {
    bets: [{ kind: "straight", amount: 1, number: 17 }],
    balls: [{ ballId: "ball-1", launchTick: PERFECT_TICK }],
    ...overrides,
  };
  return spin(wheel, input, "seed-1");
}

describe("spin", () => {
  it("is reproducible from the same seed and inputs", () => {
    const a = oneSpin();
    const b = oneSpin();
    expect(digestOf(spinSummary(a))).toBe(digestOf(spinSummary(b)));
    expect(a).toEqual(b);
  });

  it("gives a different result on a different seed", () => {
    const wheel = plainWheel();
    const input: SpinInput = {
      bets: [{ kind: "straight", amount: 1, number: 17 }],
      balls: [{ ballId: "ball-1", launchTick: 0 }],
    };
    const results = new Set(
      Array.from({ length: 40 }, (_, i) => spin(wheel, input, `seed-${i}`).pockets[0]!.number),
    );
    expect(results.size).toBeGreaterThan(10);
  });

  it("runs all six stages and records each one", () => {
    const result = oneSpin();
    const trace = result.balls[0]!;
    expect(trace.launch.ballId).toBe("ball-1");
    expect(trace.drop.deflector).toBeGreaterThanOrEqual(0);
    expect(trace.drop.deflector).toBeLessThan(8);
    expect(trace.scatters.length).toBeGreaterThanOrEqual(1);
    expect(trace.settles.length).toBe(trace.scatters.length);
    expect(trace.final.number).toBe(trace.settles.at(-1)!.number);
  });

  it("lands in a real pocket", () => {
    for (let i = 0; i < 200; i++) {
      const n = spin(
        plainWheel(),
        { bets: [], balls: [{ ballId: "ball-1", launchTick: i }] },
        `seed-${i}`,
      ).pockets[0]!.number;
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(36);
    }
  });

  it("keeps the ticks moving forward through the stages", () => {
    const trace = oneSpin().balls[0]!;
    expect(trace.drop.contactTick).toBeGreaterThan(trace.launch.dropTick);
    let tick = trace.drop.contactTick;
    for (const leg of trace.scatters) {
      for (const fret of leg.frets) {
        expect(fret.tick).toBeGreaterThan(tick);
        tick = fret.tick;
      }
    }
  });

  it("refuses an illegal bet rather than paying it", () => {
    // The validator runs this against a log it did not write.
    expect(() =>
      oneSpin({ bets: [{ kind: "split", amount: 1, numbers: [1, 36] } as Bet] }),
    ).toThrow(IllegalBetError);
  });

  it("refuses a ball that is not on this wheel", () => {
    expect(() => oneSpin({ balls: [{ ballId: "ghost", launchTick: 0 }] })).toThrow(RangeError);
  });

  it("takes the stake when nothing hits", () => {
    const wheel = plainWheel();
    const result = spin(
      wheel,
      {
        bets: [{ kind: "straight", amount: 10, number: 17 }],
        balls: [{ ballId: "ball-1", launchTick: 0 }],
      },
      "loser",
    );
    if (result.pockets[0]!.number !== 17) {
      expect(result.returned).toBe(0);
      expect(result.net).toBe(-10);
    }
  });

  it("reports net as returns minus stake", () => {
    const result = oneSpin({
      bets: [
        { kind: "evenMoney", amount: 5, pick: "red" },
        { kind: "evenMoney", amount: 5, pick: "black" },
      ],
    });
    expect(result.stake).toBe(10);
    expect(result.net).toBe(result.returned + result.imprisoned - result.stake);
  });

  it("holds an imprisoned stake out of the net loss", () => {
    // Under En Prison a stake lost to zero is still on the table, so the
    // spin's net must not count it as gone.
    const wheel = plainWheel({ zeroRule: "en-prison" });
    for (let i = 0; i < 300; i++) {
      const result = spin(
        wheel,
        {
          bets: [{ kind: "evenMoney", amount: 8, pick: "red" }],
          balls: [{ ballId: "ball-1", launchTick: i }],
        },
        `zero-${i}`,
      );
      if (result.pockets[0]!.number !== 0) continue;
      expect(result.imprisoned).toBe(8);
      expect(result.net).toBe(0);
      return;
    }
    throw new Error("no spin in 300 found the zero");
  });
});

describe("launch", () => {
  const phaseOf = (seed: string) => trackPhase(seed, BALL.id);

  it("scores a tap on the marker as a perfect window", () => {
    const record = launch(
      plainWheel(),
      BALL,
      { ballId: BALL.id, launchTick: 0 },
      phaseOf("launch"),
      Rng.from("launch"),
    );
    expect(record.quality).toBe(FP_ONE);
  });

  it("scores a tap half the wheel away as a miss", () => {
    const wheel = plainWheel();
    // Half a revolution of rotor travel puts the marker as far off as it goes.
    const tick = Math.round(ANGLE_UNITS / 2 / wheel.rotorSpeed);
    const record = launch(
      wheel,
      BALL,
      { ballId: BALL.id, launchTick: tick },
      phaseOf("launch"),
      Rng.from("launch"),
    );
    expect(record.quality).toBe(0);
  });

  it("narrows the drop zone as the tap gets better", () => {
    const wheel = plainWheel();
    const at = (tick: number) =>
      launch(wheel, BALL, { ballId: BALL.id, launchTick: tick }, 0, Rng.from("width"));
    expect(at(0).dropZoneHalfWidth).toBeLessThan(
      at(Math.round(ANGLE_UNITS / 2 / wheel.rotorSpeed)).dropZoneHalfWidth,
    );
  });

  it("never claims a drop zone wider than the wheel", () => {
    const wheel = plainWheel();
    for (let tick = 0; tick < 400; tick++) {
      const record = launch(
        wheel,
        BALL,
        { ballId: BALL.id, launchTick: tick },
        phaseOf(`t-${tick}`),
        Rng.from(tick),
      );
      expect(record.dropZoneHalfWidth).toBeLessThanOrEqual(18);
      expect(record.dropZoneHalfWidth).toBeGreaterThanOrEqual(1);
    }
  });

  it("widens the drop zone for a chipped ball", () => {
    const wheel = plainWheel();
    const clean = launch(wheel, BALL, { ballId: BALL.id, launchTick: 0 }, 0, Rng.from("chip"));
    const damaged = launch(
      wheel,
      { ...BALL, chipped: true },
      { ballId: BALL.id, launchTick: 0 },
      0,
      Rng.from("chip"),
    );
    expect(damaged.dropZoneHalfWidth).toBeGreaterThan(clean.dropZoneHalfWidth);
  });

  it("moves the drop zone as the rotor turns under a fixed phase", () => {
    // Visual ballistics: the phase is where the ball leaves the track, and
    // waiting a beat changes which numbers are under it.
    const wheel = plainWheel();
    const zones = new Set(
      Array.from({ length: 40 }, (_, i) => previewDropZone(wheel, BALL, i * 5, 0).slot),
    );
    expect(zones.size).toBeGreaterThan(5);
  });

  it("spreads the track phase across the whole rim", () => {
    // A phase pinned near one angle hands the plain wheel a dominant
    // deflector, which is something `07` sells as an upgrade, not a default.
    const buckets = new Set(
      Array.from({ length: 400 }, (_, i) =>
        Math.floor(trackPhase(`phase-${i}`, "ball-1") / (ANGLE_UNITS / 8)),
      ),
    );
    expect(buckets.size).toBe(8);
  });

  it("draws the phase from the seed alone, so the band can be shown before the tap", () => {
    expect(trackPhase("stable", "ball-1")).toBe(trackPhase("stable", "ball-1"));
    expect(trackPhase("stable", "ball-1")).not.toBe(trackPhase("stable", "ball-2"));
  });
});

describe("previewDropZone", () => {
  it("agrees with the launch it is previewing", () => {
    // What the band shows and what the roll uses come from the same maths,
    // or the mechanic is a lie.
    const wheel = plainWheel();
    for (const tick of [0, 17, 55, 120, 240]) {
      const phase = trackPhase(`p-${tick}`, BALL.id);
      const preview = previewDropZone(wheel, BALL, tick, phase);
      const actual = launch(
        wheel,
        BALL,
        { ballId: BALL.id, launchTick: tick },
        phase,
        Rng.from(tick),
      );
      expect(preview.quality).toBe(actual.quality);
      expect(preview.halfWidth).toBe(actual.dropZoneHalfWidth);
      expect(preview.slot).toBe(actual.dropZoneSlot);
    }
  });

  it("puts the ball's contact inside the band it promised", () => {
    // The band predicts where the ball meets the rotor, not where it comes
    // to rest: scatter is a separate stage and deliberately outside it. If
    // this ever misses, the width is lying to the player.
    const wheel = plainWheel();
    const tries = 500;
    let inside = 0;
    for (let i = 0; i < tries; i++) {
      const { launch: l, drop: d } = spin(
        wheel,
        { bets: [], balls: [{ ballId: "ball-1", launchTick: 0 }] },
        `band-${i}`,
      ).balls[0]!;
      if (Math.abs(slotDistance(l.dropZoneSlot, d.contactSlot)) <= l.dropZoneHalfWidth) inside += 1;
    }
    expect(inside).toBe(tries);
  });

  it("keeps a perfect tap's contact tighter to the band than a missed tap's", () => {
    const wheel = plainWheel();
    const meanMiss = (launchTick: number) => {
      let total = 0;
      const runs = 300;
      for (let i = 0; i < runs; i++) {
        const { launch: l, drop: d } = spin(
          wheel,
          { bets: [], balls: [{ ballId: "ball-1", launchTick }] },
          `tight-${launchTick}-${i}`,
        ).balls[0]!;
        total += Math.abs(slotDistance(l.dropZoneSlot, d.contactSlot));
      }
      return total / runs;
    };
    expect(meanMiss(0)).toBeLessThan(meanMiss(Math.round(ANGLE_UNITS / 2 / wheel.rotorSpeed)));
  });
});

describe("bounceChance", () => {
  it("ranks the materials the way the doc describes them", () => {
    const wheel = plainWheel();
    const of = (material: Ball["material"]) => bounceChance(wheel, { ...BALL, material });
    expect(of("lead")).toBeLessThan(of("steel"));
    expect(of("steel")).toBeLessThan(of("ivory"));
    expect(of("ivory")).toBeLessThan(of("rubber"));
  });

  it("makes a small ball bounce more and a large ball less", () => {
    const wheel = plainWheel();
    const of = (size: Ball["size"]) => bounceChance(wheel, { ...BALL, size });
    expect(of("large")).toBeLessThan(of("standard"));
    expect(of("standard")).toBeLessThan(of("small"));
  });

  it("rises with rotor speed", () => {
    const slow = bounceChance(plainWheel({ rotorSpeed: ROTOR_SPEEDS.slow }), BALL);
    const standard = bounceChance(plainWheel({ rotorSpeed: ROTOR_SPEEDS.standard }), BALL);
    const fast = bounceChance(plainWheel({ rotorSpeed: ROTOR_SPEEDS.fast }), BALL);
    expect(slow).toBeLessThan(standard);
    expect(standard).toBeLessThan(fast);
  });

  it("stays a probability", () => {
    for (const material of ["ivory", "rubber", "steel", "glass", "lead", "teflon"] as const) {
      for (const size of ["small", "standard", "large"] as const) {
        const chance = bounceChance(plainWheel({ rotorSpeed: 90 }), { ...BALL, material, size });
        expect(chance).toBeGreaterThanOrEqual(0);
        expect(chance).toBeLessThanOrEqual(FP_ONE);
      }
    }
  });
});

describe("nudges", () => {
  it("spends a nudge tap that lands inside the scatter", () => {
    const wheel = plainWheel();
    const base = spin(wheel, { bets: [], balls: [{ ballId: "ball-1", launchTick: 0 }] }, "nudge")
      .balls[0]!;
    const nudgeTick = base.drop.contactTick + 1;
    const nudged = spin(
      wheel,
      { bets: [], balls: [{ ballId: "ball-1", launchTick: 0, nudgeTicks: [nudgeTick] }] },
      "nudge",
    ).balls[0]!;
    expect(base.nudgesUsed).toBe(0);
    expect(nudged.nudgesUsed).toBe(1);
    expect(nudged.scatters[0]!.frets.some((f) => f.nudged)).toBe(true);
  });

  it("ignores taps beyond the wheel's allowance", () => {
    const wheel = plainWheel({ nudgesPerTable: 1 });
    const contact = spin(wheel, { bets: [], balls: [{ ballId: "ball-1", launchTick: 0 }] }, "n2")
      .balls[0]!.drop.contactTick;
    const trace = spin(
      wheel,
      {
        bets: [],
        balls: [
          { ballId: "ball-1", launchTick: 0, nudgeTicks: [contact + 1, contact + 2, contact + 3] },
        ],
      },
      "n2",
    ).balls[0]!;
    expect(trace.nudgesUsed).toBe(1);
  });

  it("ignores a tap that arrives after the ball has settled", () => {
    const wheel = plainWheel();
    const trace = spin(
      wheel,
      { bets: [], balls: [{ ballId: "ball-1", launchTick: 0, nudgeTicks: [1_000_000] }] },
      "n3",
    ).balls[0]!;
    expect(trace.nudgesUsed).toBe(0);
  });

  it("does not care what order the taps arrived in", () => {
    const wheel = plainWheel({ nudgesPerTable: 2 });
    const contact = spin(wheel, { bets: [], balls: [{ ballId: "ball-1", launchTick: 0 }] }, "n4")
      .balls[0]!.drop.contactTick;
    const ticks = [contact + 20, contact + 2];
    const forward = spin(
      wheel,
      { bets: [], balls: [{ ballId: "ball-1", launchTick: 0, nudgeTicks: ticks }] },
      "n4",
    );
    const reversed = spin(
      wheel,
      { bets: [], balls: [{ ballId: "ball-1", launchTick: 0, nudgeTicks: [...ticks].reverse() }] },
      "n4",
    );
    expect(forward).toEqual(reversed);
  });
});

describe("bounce chains", () => {
  it("stops at the cap even on a ball that bounces every time", () => {
    const wheel = plainWheel({ rotorSpeed: 90 });
    const rubber: Ball = { id: "ball-1", material: "rubber", size: "small", chipped: false };
    for (let i = 0; i < 100; i++) {
      const trace = spin(
        { ...wheel, balls: [rubber] },
        { bets: [], balls: [{ ballId: "ball-1", launchTick: i }] },
        `bounce-${i}`,
      ).balls[0]!;
      expect(trace.settles.length).toBeLessThanOrEqual(4);
      expect(trace.settles.at(-1)!.bounced).toBe(false);
    }
  });

  it("never bounces a lead ball on a slow rotor as often as a rubber one", () => {
    const count = (ball: Ball) => {
      let legs = 0;
      for (let i = 0; i < 150; i++) {
        legs += spin(
          { ...plainWheel({ rotorSpeed: ROTOR_SPEEDS.slow }), balls: [ball] },
          { bets: [], balls: [{ ballId: "ball-1", launchTick: i }] },
          `mat-${i}`,
        ).balls[0]!.settles.length;
      }
      return legs;
    };
    const lead = count({ id: "ball-1", material: "lead", size: "large", chipped: false });
    const rubber = count({ id: "ball-1", material: "rubber", size: "small", chipped: false });
    expect(lead).toBeLessThan(rubber);
  });
});

describe("multi-ball", () => {
  const twoBallWheel = plainWheel({
    balls: [
      { id: "ball-1", material: "ivory", size: "standard", chipped: false },
      { id: "ball-2", material: "ivory", size: "standard", chipped: false },
    ],
  });

  it("resolves a pocket per ball", () => {
    const result = spin(
      twoBallWheel,
      {
        bets: [{ kind: "evenMoney", amount: 1, pick: "red" }],
        balls: [
          { ballId: "ball-1", launchTick: 0 },
          { ballId: "ball-2", launchTick: 30 },
        ],
      },
      "two",
    );
    expect(result.pockets).toHaveLength(2);
    expect(result.balls.map((b) => b.ballId)).toEqual(["ball-1", "ball-2"]);
  });

  it("gives each ball its own stream, so they do not land together by construction", () => {
    let same = 0;
    for (let i = 0; i < 200; i++) {
      const result = spin(
        twoBallWheel,
        {
          bets: [],
          balls: [
            { ballId: "ball-1", launchTick: i },
            { ballId: "ball-2", launchTick: i + 7 },
          ],
        },
        `pair-${i}`,
      );
      if (result.pockets[0]!.number === result.pockets[1]!.number) same += 1;
    }
    // One in 37 is the honest rate; anything near 200 or 0 means the two
    // balls are sharing or mirroring a stream.
    expect(same).toBeGreaterThan(0);
    expect(same).toBeLessThan(40);
  });

  it("pays the same-pocket jackpot when both balls agree", () => {
    for (let i = 0; i < 400; i++) {
      const result = spin(
        twoBallWheel,
        {
          bets: [{ kind: "evenMoney", amount: 2, pick: "red" }],
          balls: [
            { ballId: "ball-1", launchTick: i },
            { ballId: "ball-2", launchTick: i + 3 },
          ],
        },
        `jackpot-${i}`,
      );
      if (result.pockets[0]!.number !== result.pockets[1]!.number) continue;
      expect(result.samePocket.pairs).toBe(1);
      expect(result.samePocket.profit).toBe(2 * 35);
      return;
    }
    throw new Error("no spin in 400 put both balls in one pocket");
  });
});

describe("the wheel is honest", () => {
  /**
   * The house edge on a single-zero wheel is 1/37, and it must come from
   * the zero alone. If the stages have a bias — a dominant deflector by
   * accident, a scatter that drifts one way, a settle that favours the
   * pocket under the drop — it shows up here as a straight-up bet that
   * wins at the wrong rate, and the whole upgrade economy is tuned against
   * a wheel nobody can price.
   */
  it("lands roughly uniformly across all thirty-seven pockets", () => {
    const wheel = plainWheel();
    const counts = new Array<number>(POCKET_COUNT).fill(0);
    const spins = 37 * 300;
    for (let i = 0; i < spins; i++) {
      const n = spin(
        wheel,
        { bets: [], balls: [{ ballId: "ball-1", launchTick: i % 240 }] },
        `fair-${i}`,
      ).pockets[0]!.number;
      counts[n]! += 1;
    }
    const expected = spins / POCKET_COUNT;
    for (let n = 0; n < POCKET_COUNT; n++) {
      expect(Math.abs(counts[n]! - expected)).toBeLessThan(expected * 0.35);
    }
  });

  it("pays a straight-up back at about the house edge", () => {
    const wheel = plainWheel();
    let staked = 0;
    let returned = 0;
    for (let i = 0; i < 20_000; i++) {
      const result = spin(
        wheel,
        {
          bets: [{ kind: "straight", amount: 1, number: 17 }],
          balls: [{ ballId: "ball-1", launchTick: i % 240 }],
        },
        `edge-${i}`,
      );
      staked += result.stake;
      returned += result.returned;
    }
    // 36/37 = 0.973 is the fair return. Wide bounds: 20k spins on a 1-in-37
    // event is a noisy estimate, and the point is to catch a stage that is
    // paying 1.2 or 0.6, not to measure the edge precisely.
    expect(returned / staked).toBeGreaterThan(0.85);
    expect(returned / staked).toBeLessThan(1.1);
  });

  it("pays an even-money bet back at about the house edge", () => {
    const wheel = plainWheel();
    let staked = 0;
    let returned = 0;
    for (let i = 0; i < 6000; i++) {
      const result = spin(
        wheel,
        {
          bets: [{ kind: "evenMoney", amount: 1, pick: "red" }],
          balls: [{ ballId: "ball-1", launchTick: i % 240 }],
        },
        `even-${i}`,
      );
      staked += result.stake;
      returned += result.returned;
    }
    expect(returned / staked).toBeGreaterThan(0.93);
    expect(returned / staked).toBeLessThan(1.01);
  });

  it("does not let a good launch beat the wheel on its own", () => {
    // The launch narrows the drop zone. It must not narrow the *pocket*:
    // scatter and settle are what stand between a perfect tap and a known
    // number, and if a perfect tap alone could pick a pocket the game has
    // no upgrade curve left to sell.
    const wheel = plainWheel();
    const counts = new Map<number, number>();
    const spins = 3000;
    for (let i = 0; i < spins; i++) {
      const n = spin(
        wheel,
        { bets: [], balls: [{ ballId: "ball-1", launchTick: 0 }] },
        `perfect-${i}`,
      ).pockets[0]!.number;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const best = Math.max(...counts.values()) / spins;
    expect(counts.size).toBeGreaterThan(8);
    expect(best).toBeLessThan(0.35);
  });
});

describe("spinSummary", () => {
  it("carries every number a payout depends on", () => {
    const summary = spinSummary(oneSpin());
    expect(Object.keys(summary).sort()).toEqual([
      "imprisoned",
      "net",
      "nudges",
      "pockets",
      "returned",
      "samePocketPairs",
      "stake",
    ]);
  });

  it("digests to the same value for the same spin", () => {
    expect(digestOf(spinSummary(oneSpin()))).toBe(digestOf(spinSummary(oneSpin())));
  });

  it("holds only integers, so the digest cannot refuse it", () => {
    expect(() => digestOf(spinSummary(oneSpin()))).not.toThrow();
  });

  it("changes when a gaffed pocket changes the payout", () => {
    const landed = oneSpin().pockets[0]!.number;
    const pockets = withGaff(plainPockets(), landed, 2);
    const gaffedResult = spin(
      plainWheel({ pockets }),
      {
        bets: [{ kind: "straight", amount: 1, number: landed }],
        balls: [{ ballId: "ball-1", launchTick: 0 }],
      },
      "seed-1",
    );
    expect(gaffedResult.returned).toBe(1 + 105);
  });
});

describe("rotorAngleAt", () => {
  it("advances with the tick and wraps at a revolution", () => {
    const wheel = plainWheel({ rotorSpeed: 100, rotorStartAngle: 0 });
    expect(rotorAngleAt(wheel, 0)).toBe(0);
    expect(rotorAngleAt(wheel, 1)).toBe(100);
    expect(rotorAngleAt(wheel, ANGLE_UNITS / 100)).toBe(0);
  });
});
