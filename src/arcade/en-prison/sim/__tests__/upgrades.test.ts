import { describe, expect, it } from "vite-plus/test";

import { FP_ONE, Rng } from "../../../sim-kit/index.ts";
import type { Bet } from "../bets.ts";
import { nextTable, openRun, settleTable, spinSeed } from "../run.ts";
import {
  applyPocketEffects,
  DOMINANT_REACH,
  drop,
  emptyContext,
  launch,
  MIN_BAND_HALF_WIDTH,
  previewDropZone,
  type SpinContext,
  spin,
  strikingDeflector,
  trackPhase,
} from "../spin.ts";
import { type Ball, plainWheel, type WheelState } from "../state.ts";
import { checkBets, closeTable, openTable, playSpin, type TableRules } from "../table.ts";
import {
  GAFF_MULTIPLIERS,
  hasTrait,
  isUpgraded,
  plainDeflectors,
  plainFrets,
  plainPocket,
  plainPockets,
  pocketMultiplier,
  setBonuses,
  withGaff,
  withTrait,
} from "../upgrades.ts";
import {
  numberAt,
  POCKET_COUNT,
  SECTORS,
  sectorOf,
  slotOf,
  UNITS_PER_DEFLECTOR,
} from "../wheel.ts";

const BALL: Ball = { id: "ball-1", material: "ivory", size: "standard", chipped: false };
const STEEL: Ball = { ...BALL, material: "steel" };
const RULES: TableRules = { spins: 8, minimumBet: 1, quota: 1, nudges: 1 };

/** The number one slot anticlockwise of `n` on the rotor. */
const before = (n: number) => numberAt(slotOf(n) - 1);

describe("pocketMultiplier", () => {
  it("pays a plain pocket at face value", () => {
    expect(pocketMultiplier(plainPocket())).toBe(FP_ONE);
  });

  it("pays a gaff at x2, x3, x4 as `07` prints it", () => {
    expect(GAFF_MULTIPLIERS).toEqual([FP_ONE, FP_ONE * 2, FP_ONE * 3, FP_ONE * 4]);
    for (const level of [0, 1, 2, 3] as const) {
      expect(pocketMultiplier({ ...plainPocket(), gaff: level })).toBe(GAFF_MULTIPLIERS[level]);
    }
  });

  it("gains a multiplier per hit on a hot pocket", () => {
    const hot = withTrait(plainPockets(), 17, "hot")[17]!;
    expect(pocketMultiplier(hot, { hits: 0 })).toBe(FP_ONE);
    expect(pocketMultiplier(hot, { hits: 3 })).toBe(FP_ONE * 4);
  });

  it("stacks hot on top of a gaff", () => {
    const pocket = withTrait(withGaff(plainPockets(), 17, 2), 17, "hot")[17]!;
    expect(pocketMultiplier(pocket, { hits: 2 })).toBe(FP_ONE * 5);
  });

  it("doubles everything with echo, which is what keeps it off the gaff ladder", () => {
    const pocket = withTrait(withGaff(plainPockets(), 17, 3), 17, "echo")[17]!;
    expect(pocketMultiplier(pocket)).toBe(FP_ONE * 8);
  });

  it("adds the Voisins set bonus only inside the set", () => {
    const bonuses = { voisins: true, tiers: false, orphelins: false };
    const gaff = withGaff(plainPockets(), 17, 1)[17]!;
    expect(pocketMultiplier(gaff, { sector: "voisins", bonuses })).toBe(FP_ONE * 3);
    expect(pocketMultiplier(gaff, { sector: "tiers", bonuses })).toBe(FP_ONE * 2);
  });
});

describe("setBonuses", () => {
  it("stays off on a plain wheel", () => {
    expect(setBonuses(plainPockets())).toEqual({
      voisins: false,
      tiers: false,
      orphelins: false,
    });
  });

  it("turns on at three upgraded pockets in a sector and not at two", () => {
    let pockets = plainPockets();
    const [a, b, c] = SECTORS.tiers;
    pockets = withGaff(pockets, a!, 1);
    pockets = withGaff(pockets, b!, 1);
    expect(setBonuses(pockets).tiers).toBe(false);
    pockets = withGaff(pockets, c!, 1);
    expect(setBonuses(pockets).tiers).toBe(true);
  });

  it("counts a trait-only pocket as upgraded", () => {
    let pockets = plainPockets();
    for (const n of SECTORS.orphelins.slice(0, 3)) pockets = withTrait(pockets, n, "cold");
    expect(setBonuses(pockets).orphelins).toBe(true);
  });

  it("does not let one sector's pockets light another's set", () => {
    let pockets = plainPockets();
    for (const n of SECTORS.tiers.slice(0, 4)) pockets = withGaff(pockets, n, 1);
    expect(setBonuses(pockets)).toMatchObject({ tiers: true, voisins: false, orphelins: false });
  });
});

describe("isUpgraded", () => {
  it("is false only for a wholly plain pocket", () => {
    expect(isUpgraded(plainPocket())).toBe(false);
    expect(isUpgraded({ ...plainPocket(), gaff: 1 })).toBe(true);
    expect(isUpgraded({ ...plainPocket(), traits: ["cold"] })).toBe(true);
  });
});

describe("applyPocketEffects", () => {
  const at = (pockets: readonly ReturnType<typeof plainPocket>[]) => plainWheel({ pockets });

  it("leaves a plain pocket alone", () => {
    const result = applyPocketEffects(at(plainPockets()), BALL, 5);
    expect(result).toEqual({ slot: 5, effects: [], sticky: false });
  });

  describe("magnet", () => {
    it("pulls a steel ball settling within two pockets", () => {
      const target = numberAt(10);
      const wheel = at(withTrait(plainPockets(), target, "magnet"));
      expect(applyPocketEffects(wheel, STEEL, 12).slot).toBe(10);
      expect(applyPocketEffects(wheel, STEEL, 8).slot).toBe(10);
    });

    it("does not reach a third pocket", () => {
      const wheel = at(withTrait(plainPockets(), numberAt(10), "magnet"));
      expect(applyPocketEffects(wheel, STEEL, 13).slot).toBe(13);
    });

    it("ignores every material but steel", () => {
      const wheel = at(withTrait(plainPockets(), numberAt(10), "magnet"));
      for (const material of ["ivory", "rubber", "glass", "lead", "teflon"] as const) {
        expect(applyPocketEffects(wheel, { ...BALL, material }, 12).slot).toBe(12);
      }
    });

    it("does nothing when the ball is already in the magnet", () => {
      const wheel = at(withTrait(plainPockets(), numberAt(10), "magnet"));
      expect(applyPocketEffects(wheel, STEEL, 10)).toEqual({
        slot: 10,
        effects: [],
        sticky: false,
      });
    });
  });

  describe("spring", () => {
    it("throws the ball one pocket in its chosen direction", () => {
      const wheel = at(withTrait(plainPockets(), numberAt(10), "spring", 1));
      expect(applyPocketEffects(wheel, BALL, 10)).toMatchObject({ slot: 11, effects: ["spring"] });
    });

    it("throws the other way when told to", () => {
      const wheel = at(withTrait(plainPockets(), numberAt(10), "spring", -1));
      expect(applyPocketEffects(wheel, BALL, 10).slot).toBe(9);
    });

    it("fires once, so two springs facing each other cannot oscillate", () => {
      let pockets = withTrait(plainPockets(), numberAt(10), "spring", 1);
      pockets = withTrait(pockets, numberAt(11), "spring", -1);
      const result = applyPocketEffects(at(pockets), BALL, 10);
      expect(result.slot).toBe(11);
      expect(result.effects).toEqual(["spring"]);
    });
  });

  describe("sticky", () => {
    it("reports the lock without moving the ball", () => {
      const wheel = at(withTrait(plainPockets(), numberAt(10), "sticky"));
      expect(applyPocketEffects(wheel, BALL, 10)).toEqual({
        slot: 10,
        effects: ["sticky"],
        sticky: true,
      });
    });

    it("is checked where the ball ends up, not where it landed", () => {
      // This is the funnel: spring out of one pocket, into a sticky gaff.
      let pockets = withTrait(plainPockets(), numberAt(10), "spring", 1);
      pockets = withTrait(pockets, numberAt(11), "sticky");
      const result = applyPocketEffects(at(pockets), BALL, 10);
      expect(result).toEqual({ slot: 11, effects: ["spring", "sticky"], sticky: true });
    });
  });

  it("fires magnet, then spring, then sticky", () => {
    // The precedence the multi-ball resolution order sets down.
    let pockets = withTrait(plainPockets(), numberAt(10), "magnet");
    pockets = withTrait(pockets, numberAt(10), "spring", 1);
    pockets = withTrait(pockets, numberAt(11), "sticky");
    const result = applyPocketEffects(at(pockets), STEEL, 12);
    expect(result.effects).toEqual(["magnet", "spring", "sticky"]);
    expect(result.slot).toBe(11);
  });
});

describe("sticky in the spin", () => {
  it("refuses the bounce outright rather than lowering its odds", () => {
    // A lock that fails one time in five is not a lock.
    const wheel = plainWheel({
      pockets: plainPockets().map((p) => ({ ...p, traits: ["sticky" as const] })),
      rotorSpeed: 90,
      balls: [{ id: "ball-1", material: "rubber", size: "small", chipped: false }],
    });
    for (let i = 0; i < 200; i++) {
      const trace = spin(
        wheel,
        { bets: [], balls: [{ ballId: "ball-1", launchTick: i }] },
        `s-${i}`,
      ).balls[0]!;
      expect(trace.settles).toHaveLength(1);
      expect(trace.settles[0]!.bounced).toBe(false);
    }
  });
});

describe("frets", () => {
  it("ends the scatter leg early on a sticky fret", () => {
    const wheel = plainWheel({ frets: plainFrets().map(() => "sticky" as const) });
    for (let i = 0; i < 100; i++) {
      const leg = spin(wheel, { bets: [], balls: [{ ballId: "ball-1", launchTick: i }] }, `f-${i}`)
        .balls[0]!.scatters[0]!;
      // At most one crossing, and `stopped` iff there was one to stop: a
      // scatter that rolled zero frets never met a divider.
      expect(leg.frets.length).toBeLessThanOrEqual(1);
      expect(leg.stopped).toBe(leg.frets.length === 1);
    }
  });

  it("adds a crossing on a spring fret", () => {
    const springy = plainWheel({ frets: plainFrets().map(() => "spring" as const) });
    const plain = plainWheel();
    const total = (wheel: WheelState) => {
      let sum = 0;
      for (let i = 0; i < 300; i++) {
        sum += spin(wheel, { bets: [], balls: [{ ballId: "ball-1", launchTick: i }] }, `sp-${i}`)
          .balls[0]!.scatters[0]!.frets.length;
      }
      return sum;
    };
    expect(total(springy)).toBeGreaterThan(total(plain));
  });

  it("records which divider each crossing went over", () => {
    const wheel = plainWheel();
    const leg = spin(wheel, { bets: [], balls: [{ ballId: "ball-1", launchTick: 0 }] }, "rec")
      .balls[0]!.scatters[0]!;
    for (const hit of leg.frets) expect(hit.fret).toBe("plain");
  });
});

describe("deflectors", () => {
  const dominantAt = (index: number) => {
    const deflectors = plainDeflectors();
    deflectors[index] = { kind: "dominant", sector: "voisins" };
    return deflectors;
  };

  it("takes the nearest diamond on a plain wheel", () => {
    const wheel = plainWheel();
    expect(strikingDeflector(wheel, 0)).toBe(0);
    expect(strikingDeflector(wheel, 925 * 3)).toBe(3);
  });

  it("captures anything inside its reach for a dominant diamond", () => {
    const wheel = plainWheel({ deflectors: dominantAt(2) });
    expect(strikingDeflector(wheel, 925 * 2)).toBe(2);
    expect(strikingDeflector(wheel, 925 * 2 + DOMINANT_REACH - 1)).toBe(2);
    expect(strikingDeflector(wheel, 925 * 2 - DOMINANT_REACH + 1)).toBe(2);
  });

  it("lets go beyond its reach", () => {
    const wheel = plainWheel({ deflectors: dominantAt(2) });
    expect(strikingDeflector(wheel, 925 * 5)).toBe(5);
  });

  it("doubles its share of the drops, which is its reach over the natural gap", () => {
    // `07`: a dominant diamond "makes the drop land there more often". How
    // much more is exactly the geometry: it captures DOMINANT_REACH either
    // side, against the half-gap a plain diamond gets, so it takes twice the
    // rim. Measured at 515 against 258 of 2000.
    const count = (wheel: WheelState) => {
      let hits = 0;
      for (let i = 0; i < 2000; i++) {
        const trace = spin(
          wheel,
          { bets: [], balls: [{ ballId: "ball-1", launchTick: i % 240 }] },
          `d-${i}`,
        ).balls[0]!;
        if (trace.drop.deflector === 2) hits += 1;
      }
      return hits;
    };
    expect(DOMINANT_REACH).toBe(UNITS_PER_DEFLECTOR);
    expect(count(plainWheel({ deflectors: dominantAt(2) }))).toBeGreaterThan(
      (count(plainWheel()) * 17) / 10,
    );
  });

  it("rolls no kick on a dead diamond", () => {
    const deflectors = plainDeflectors().map(() => ({
      kind: "dead" as const,
      sector: "voisins" as const,
    }));
    const wheel = plainWheel({ deflectors });
    for (let i = 0; i < 50; i++) {
      const trace = spin(
        wheel,
        { bets: [], balls: [{ ballId: "ball-1", launchTick: i }] },
        `dead-${i}`,
      ).balls[0]!;
      expect(trace.drop.kick).toBe(0);
    }
  });

  it("throws a steel ball toward its sector on a magnetic diamond", () => {
    const deflectors = plainDeflectors().map(() => ({
      kind: "magnetic" as const,
      sector: "tiers" as const,
    }));
    const wheel = plainWheel({ deflectors, balls: [STEEL] });
    const plain = plainWheel({ balls: [STEEL] });

    const inTiers = (w: WheelState) => {
      let hits = 0;
      for (let i = 0; i < 1200; i++) {
        const result = spin(
          w,
          { bets: [], balls: [{ ballId: "ball-1", launchTick: i % 240 }] },
          `m-${i}`,
        );
        if (sectorOf(numberAt(result.balls[0]!.drop.contactSlot)) === "tiers") hits += 1;
      }
      return hits;
    };
    expect(inTiers(wheel)).toBeGreaterThan(inTiers(plain));
  });

  it("leaves every other material alone on a magnetic diamond", () => {
    const deflectors = plainDeflectors().map(() => ({
      kind: "magnetic" as const,
      sector: "tiers" as const,
    }));
    for (let i = 0; i < 60; i++) {
      const input = { bets: [], balls: [{ ballId: "ball-1", launchTick: i }] };
      const magnetic = spin(plainWheel({ deflectors }), input, `nm-${i}`).balls[0]!;
      const plain = spin(plainWheel(), input, `nm-${i}`).balls[0]!;
      expect(magnetic.drop.contactSlot).toBe(plain.drop.contactSlot);
    }
  });
});

describe("the drop-zone ceiling", () => {
  const dominant = () => {
    const deflectors = plainDeflectors();
    deflectors[0] = { kind: "dominant", sector: "voisins" };
    return deflectors;
  };

  it("narrows the band when a dominant diamond owns the phase", () => {
    const wheel = plainWheel({ deflectors: dominant() });
    const plain = plainWheel();
    const width = (w: WheelState) => previewDropZone(w, BALL, 0, 0).halfWidth;
    expect(width(wheel)).toBeLessThan(width(plain));
  });

  it("never narrows below the floor `07` asks for a number on", () => {
    const wheel = plainWheel({ deflectors: dominant() });
    for (let phase = 0; phase < 7400; phase += 37) {
      for (const tick of [0, 5, 60, 119]) {
        expect(previewDropZone(wheel, BALL, tick, phase).halfWidth).toBeGreaterThanOrEqual(
          MIN_BAND_HALF_WIDTH,
        );
      }
    }
  });

  it("still tells the truth about where the ball arrives", () => {
    // The narrowed band is a smaller promise, so it is the one most likely
    // to be a lie. It is not.
    const wheel = plainWheel({ deflectors: dominant() });
    let inside = 0;
    const tries = 600;
    for (let i = 0; i < tries; i++) {
      const phase = trackPhase(`ceil-${i}`, BALL.id);
      const record = launch(wheel, BALL, { ballId: BALL.id, launchTick: 0 }, phase, Rng.from(i));
      const landed = drop(wheel, BALL, record, Rng.from(`k-${i}`));
      const gap = Math.abs(((landed.contactSlot - record.dropZoneSlot + 55) % POCKET_COUNT) - 18);
      if (gap <= record.dropZoneHalfWidth + 1) inside += 1;
    }
    expect(inside / tries).toBeGreaterThan(0.9);
  });

  /**
   * The number `07`'s risks section asks for.
   *
   * The strongest build the sim can express against a single number: a
   * dominant diamond, a perfect tap, a lead ball that barely scatters,
   * sticky frets that end the scatter early, a magnet to pull it in and a
   * sticky gaff to hold it. If this ever reads as a near-certainty, the
   * funnel has beaten the game and the lever is `MIN_BAND_HALF_WIDTH` or the
   * scatter floor, not a nerf to any one pocket.
   */
  it("keeps the best possible funnel a favourite rather than a certainty", () => {
    const target = 17;
    let pockets = withGaff(plainPockets(), target, 3);
    pockets = withTrait(pockets, target, "sticky");
    pockets = withTrait(pockets, target, "magnet");
    pockets = withTrait(pockets, before(target), "spring", 1);

    const wheel = plainWheel({
      pockets,
      deflectors: (() => {
        const d = plainDeflectors();
        d[0] = { kind: "dominant", sector: "voisins" };
        return d;
      })(),
      frets: plainFrets().map(() => "sticky" as const),
      balls: [{ id: "ball-1", material: "steel", size: "large", chipped: false }],
      rotorSpeed: 21,
    });

    let hits = 0;
    const spins = 4000;
    for (let i = 0; i < spins; i++) {
      const result = spin(
        wheel,
        { bets: [], balls: [{ ballId: "ball-1", launchTick: 0 }] },
        `funnel-${i}`,
      );
      if (result.pockets[0]!.number === target) hits += 1;
    }
    const rate = hits / spins;
    // Far better than the 1-in-37 an honest wheel pays, and far short of a
    // lock. The upper bound is the guard rail; the lower is the promise that
    // the build is worth buying at all.
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.55);
  });
});

describe("bank", () => {
  const wheel = (n: number) => plainWheel({ pockets: withTrait(plainPockets(), n, "bank") });
  const RED: Bet = { kind: "evenMoney", amount: 4, pick: "red" };

  it("swallows what its own ball won and pays nothing now", () => {
    for (let i = 0; i < 400; i++) {
      const result = spin(
        wheel(1),
        {
          bets: [{ kind: "straight", amount: 2, number: 1 }],
          balls: [{ ballId: "ball-1", launchTick: i }],
        },
        `bank-${i}`,
      );
      if (result.pockets[0]!.number !== 1) continue;
      expect(result.bankedThisSpin).toBe(70);
      expect(result.returned).toBe(2);
      expect(result.banked).toBe(70);
      return;
    }
    throw new Error("no spin in 400 landed on the bank pocket");
  });

  it("releases what it is holding into the next spin that pays", () => {
    const context: SpinContext = { ...emptyContext(plainWheel()), banked: 50 };
    for (let i = 0; i < 400; i++) {
      const result = spin(
        plainWheel(),
        { bets: [RED], balls: [{ ballId: "ball-1", launchTick: i }] },
        `rel-${i}`,
        context,
      );
      if (result.outcomes[0]!.hits === 0) continue;
      expect(result.released).toBe(50);
      expect(result.returned).toBe(8 + 50);
      expect(result.banked).toBe(0);
      return;
    }
    throw new Error("no spin in 400 paid the red bet");
  });

  it("keeps holding through a spin that pays nothing", () => {
    const context: SpinContext = { ...emptyContext(plainWheel()), banked: 50 };
    for (let i = 0; i < 400; i++) {
      const result = spin(
        plainWheel(),
        { bets: [RED], balls: [{ ballId: "ball-1", launchTick: i }] },
        `hold-${i}`,
        context,
      );
      if (result.outcomes[0]!.hits > 0) continue;
      expect(result.released).toBe(0);
      expect(result.banked).toBe(50);
      return;
    }
    throw new Error("no spin in 400 lost the red bet");
  });

  it("hands back what it is still holding when the table closes", () => {
    // The same rule as an imprisoned stake: the player won those chips.
    const state = openTable(plainWheel(), RULES, 100);
    const close = closeTable({ ...state, banked: 40 });
    expect(close.released).toBe(40);
    expect(close.counted).toBe(140);
  });
});

describe("wild", () => {
  it("pays every bet on the layout, whatever it covers", () => {
    const wheel = plainWheel({ pockets: withTrait(plainPockets(), 1, "wild") });
    for (let i = 0; i < 400; i++) {
      const result = spin(
        wheel,
        {
          bets: [{ kind: "straight", amount: 1, number: 33 }],
          balls: [{ ballId: "ball-1", launchTick: i }],
        },
        `wild-${i}`,
      );
      if (result.pockets[0]!.number !== 1) continue;
      expect(result.outcomes[0]!.hits).toBe(1);
      expect(result.returned).toBe(36);
      expect(result.wildSpent).toEqual([1]);
      return;
    }
    throw new Error("no spin in 400 landed on the wild pocket");
  });

  it("fires once per table and never again", () => {
    const wheel = plainWheel({ pockets: withTrait(plainPockets(), 1, "wild") });
    const spent: SpinContext = { ...emptyContext(wheel), wildSpent: [1] };
    for (let i = 0; i < 400; i++) {
      const result = spin(
        wheel,
        {
          bets: [{ kind: "straight", amount: 1, number: 33 }],
          balls: [{ ballId: "ball-1", launchTick: i }],
        },
        `wild-${i}`,
        spent,
      );
      if (result.pockets[0]!.number !== 1) continue;
      expect(result.outcomes[0]!.hits).toBe(0);
      expect(result.wildSpent).toEqual([]);
      return;
    }
    throw new Error("no spin in 400 landed on the wild pocket");
  });
});

describe("the table's long-lived pockets", () => {
  const RED: Bet = { kind: "evenMoney", amount: 1, pick: "red" };
  const BALLS = [{ ballId: "ball-1", launchTick: 0 }];

  it("counts hits for a hot pocket across the table", () => {
    const state = openTable(plainWheel(), RULES, 100);
    const after = playSpin(state, [RED], BALLS, "hot-1");
    const landed = after.spins[0]!.result.pockets[0]!.number;
    expect(after.hits[landed]).toBe(1);
    const again = playSpin(after, [RED], BALLS, "hot-1");
    expect(again.hits[landed]).toBe(2);
  });

  it("starts every table with a cold count", () => {
    const state = openTable(plainWheel(), RULES, 100);
    expect(state.hits).toHaveLength(POCKET_COUNT);
    expect(state.hits.every((h) => h === 0)).toBe(true);
  });

  it("takes heat off on a cold pocket and never below zero", () => {
    const wheel = plainWheel({
      pockets: plainPockets().map((p) => ({ ...p, traits: ["cold" as const] })),
    });
    const state = openTable(wheel, RULES, 100);
    const after = playSpin(state, [RED], BALLS, "cold");
    expect(after.spins[0]!.result.heatRelief).toBeGreaterThan(0);
    expect(after.heat).toBe(0);
  });

  it("gives the table an extra nudge for the Tiers set", () => {
    let pockets = plainPockets();
    for (const n of SECTORS.tiers.slice(0, 3)) pockets = withGaff(pockets, n, 1);
    expect(openTable(plainWheel({ pockets }), RULES, 100).nudgesRemaining).toBe(RULES.nudges + 1);
    expect(openTable(plainWheel(), RULES, 100).nudgesRemaining).toBe(RULES.nudges);
  });
});

describe("the funnel `07` milestone 3 asks about", () => {
  it("makes a gaffed number meaningfully likelier without a tooltip explaining it", () => {
    // Spring on the pocket before a sticky gaff. The player builds this out
    // of two purchases on adjacent numbers, and the wheel has to reward it
    // enough that the pattern is discoverable by noticing.
    const target = 17;
    let pockets = withGaff(plainPockets(), target, 3);
    pockets = withTrait(pockets, target, "sticky");
    pockets = withTrait(pockets, before(target), "spring", 1);
    const built = plainWheel({ pockets });
    const plain = plainWheel();

    const rate = (wheel: WheelState) => {
      let hits = 0;
      for (let i = 0; i < 4000; i++) {
        const result = spin(
          wheel,
          { bets: [], balls: [{ ballId: "ball-1", launchTick: i % 240 }] },
          `fn-${i}`,
        );
        if (result.pockets[0]!.number === target) hits += 1;
      }
      return hits;
    };
    expect(rate(built)).toBeGreaterThan(rate(plain) * 1.5);
  });

  it("does not make an unbuilt number likelier by accident", () => {
    const target = 17;
    let pockets = withGaff(plainPockets(), target, 3);
    pockets = withTrait(pockets, target, "sticky");
    pockets = withTrait(pockets, before(target), "spring", 1);
    const built = plainWheel({ pockets });

    // A number on the far side of the wheel should be untouched.
    const far = numberAt(slotOf(target) + 18);
    let builtHits = 0;
    let plainHits = 0;
    for (let i = 0; i < 3000; i++) {
      const input = { bets: [], balls: [{ ballId: "ball-1", launchTick: i % 240 }] };
      if (spin(built, input, `far-${i}`).pockets[0]!.number === far) builtHits += 1;
      if (spin(plainWheel(), input, `far-${i}`).pockets[0]!.number === far) plainHits += 1;
    }
    expect(Math.abs(builtHits - plainHits)).toBeLessThan(plainHits * 0.5);
  });
});

describe("hasTrait", () => {
  it("reads a pocket's traits", () => {
    const pocket = withTrait(plainPockets(), 5, "spring")[5]!;
    expect(hasTrait(pocket, "spring")).toBe(true);
    expect(hasTrait(pocket, "sticky")).toBe(false);
  });

  it("does not add a trait twice", () => {
    let pockets = withTrait(plainPockets(), 5, "spring");
    pockets = withTrait(pockets, 5, "spring");
    expect(pockets[5]!.traits).toEqual(["spring"]);
  });

  it("leaves every other pocket alone", () => {
    const pockets = withTrait(plainPockets(), 5, "spring");
    expect(pockets.filter((p) => p.traits.length > 0)).toHaveLength(1);
  });
});

describe("what a build is worth to a run", () => {
  /**
   * The measurement Phase 3 exists to produce.
   *
   * Phase 2 established that nobody clears a twelve-table run on a plain
   * wheel — the quota compounds and a fair wheel does not. This is the check
   * that the pocket grid is what closes that gap, and that it closes it
   * through the *pattern* rather than the multiplier: a bare gaff on a
   * number is worth almost nothing, and the same gaff with a spring feeding
   * it and a sticky holding it is worth a run.
   *
   * If this ever inverts — a bare gaff carrying a run, or the funnel not
   * beating it — the upgrade economy has stopped rewarding the thing `07`
   * milestone 3 wants players to discover.
   */
  const RUNS = 300;

  function clearedTables(level: "plain" | "gaff" | "funnel"): number {
    let total = 0;
    for (let i = 0; i < RUNS; i++) {
      let pockets = plainPockets();
      if (level !== "plain") pockets = withGaff(pockets, 17, 3);
      if (level === "funnel") {
        pockets = withTrait(pockets, 17, "sticky");
        pockets = withTrait(pockets, before(17), "spring", 1);
      }
      const wheel = plainWheel({ pockets });

      let run = openRun(`econ-${level}-${i}`);
      while (run.status === "playing") {
        const next = nextTable(run);
        let table = openTable(wheel, next.rules, run.bankroll);
        for (let s = 0; s < next.rules.spins; s++) {
          const outside = Math.max(next.rules.minimumBet, Math.floor(table.bankroll / 6));
          const bets: Bet[] = [
            { kind: "straight", amount: Math.max(1, Math.floor(outside / 4)), number: 17 },
            { kind: "evenMoney", amount: outside, pick: "red" },
          ];
          const balls = [{ ballId: "ball-1", launchTick: 0 }];
          if (checkBets(table, bets, balls)) break;
          table = playSpin(table, bets, balls, spinSeed(run, next.index, s));
        }
        run = settleTable(run, closeTable(table));
      }
      total += run.tables.filter((t) => t.cleared).length;
    }
    return total;
  }

  it("makes the funnel worth far more than the gaff it is built around", () => {
    const gaff = clearedTables("gaff");
    const funnel = clearedTables("funnel");
    expect(funnel).toBeGreaterThan((gaff * 13) / 10);
  });

  it("leaves a plain wheel unable to compound", () => {
    // The Phase 2 baseline, kept as a floor: if a plain wheel ever starts
    // clearing runs, the quota curve has gone soft.
    expect(clearedTables("plain")).toBeLessThan(clearedTables("funnel"));
  });
});
