import { describe, expect, it } from "vite-plus/test";

import type { Bet } from "../bets.ts";
import {
  buy,
  CAGE_PITY_THRESHOLD,
  checkPurchase,
  type FloorState,
  MARKER_HEAT,
  MAX_BALLS,
  offers,
  openFloor,
  PRICES,
  type Purchase,
  priceOf,
  pullCage,
  PurchaseRefused,
} from "../floor.ts";
import { nextTable, openRun, settleFloor, settleTable, spinSeed, tableRules } from "../run.ts";
import { plainWheel, ROTOR_SPEEDS } from "../state.ts";
import { checkBets, closeTable, openTable, playSpin } from "../table.ts";
import { hasTrait } from "../upgrades.ts";
import { numberAt, POCKET_COUNT, slotOf } from "../wheel.ts";

const floor = (bankroll = 500) => openFloor(plainWheel(), bankroll);

describe("priceOf", () => {
  it("charges more for each gaff level", () => {
    let state = floor();
    for (const expected of PRICES.gaff) {
      expect(priceOf(state, { kind: "gaff", number: 17 })).toBe(expected);
      state = buy(state, { kind: "gaff", number: 17 });
    }
  });

  it("prices the third ball far above the second", () => {
    expect(PRICES.ballAdd[1]).toBeGreaterThan(PRICES.ballAdd[0]! * 2);
  });

  it("charges nothing up front for a marker, which is the trap", () => {
    expect(priceOf(floor(), { kind: "marker", amount: 50 })).toBe(0);
  });
});

describe("checkPurchase", () => {
  it("refuses what the bankroll cannot cover", () => {
    expect(checkPurchase(floor(10), { kind: "gaff", number: 17 })).toBe("unaffordable");
  });

  it("refuses a fourth gaff level", () => {
    let state = floor();
    for (let i = 0; i < 3; i++) state = buy(state, { kind: "gaff", number: 17 });
    expect(checkPurchase(state, { kind: "gaff", number: 17 })).toBe("already-at-max");
  });

  it("refuses a trait the pocket already carries", () => {
    const state = buy(floor(), { kind: "trait", number: 17, trait: "sticky" });
    expect(checkPurchase(state, { kind: "trait", number: 17, trait: "sticky" })).toBe(
      "already-owned",
    );
    expect(checkPurchase(state, { kind: "trait", number: 17, trait: "spring" })).toBeNull();
  });

  it("refuses a pocket that is not on the wheel", () => {
    expect(checkPurchase(floor(), { kind: "gaff", number: 37 })).toBe("no-such-pocket");
  });

  it("refuses a ball the wheel does not have", () => {
    expect(
      checkPurchase(floor(), { kind: "ball-material", ballId: "ghost", material: "steel" }),
    ).toBe("no-such-ball");
  });

  it("refuses to repair a ball that is not chipped", () => {
    expect(checkPurchase(floor(), { kind: "ball-repair", ballId: "ball-1" })).toBe("not-chipped");
  });

  it("refuses a fourth ball", () => {
    let state = floor(5000);
    for (let i = 1; i < MAX_BALLS; i++) state = buy(state, { kind: "ball-add" });
    expect(state.wheel.balls).toHaveLength(MAX_BALLS);
    expect(checkPurchase(state, { kind: "ball-add" })).toBe("already-at-max");
  });

  it("refuses a rotor speed the mechanic does not stock", () => {
    expect(checkPurchase(floor(), { kind: "rotor", speed: 77 })).toBe("unknown-rotor");
    expect(checkPurchase(floor(), { kind: "rotor", speed: ROTOR_SPEEDS.fast })).toBeNull();
  });

  it("refuses the rotor it is already turning at", () => {
    expect(checkPurchase(floor(), { kind: "rotor", speed: ROTOR_SPEEDS.standard })).toBe(
      "already-owned",
    );
  });

  it("refuses a diamond or fret that is off the wheel", () => {
    expect(checkPurchase(floor(), { kind: "deflector", index: 9, deflector: "dominant" })).toBe(
      "no-such-deflector",
    );
    expect(checkPurchase(floor(), { kind: "fret", index: 99, fret: "spring" })).toBe(
      "no-such-fret",
    );
  });
});

describe("buy", () => {
  it("throws the refusal rather than applying it", () => {
    expect(() => buy(floor(10), { kind: "gaff", number: 17 })).toThrow(PurchaseRefused);
    try {
      buy(floor(10), { kind: "gaff", number: 17 });
    } catch (error) {
      expect((error as PurchaseRefused).reason).toBe("unaffordable");
    }
  });

  it("does not mutate the floor it was given", () => {
    const state = floor();
    const snapshot = JSON.stringify(state);
    buy(state, { kind: "gaff", number: 17 });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("takes the price out of the bankroll", () => {
    const state = buy(floor(500), { kind: "gaff", number: 17 });
    expect(state.bankroll).toBe(500 - PRICES.gaff[0]!);
  });

  it("records what was bought", () => {
    let state = buy(floor(), { kind: "gaff", number: 17 });
    state = buy(state, { kind: "trait", number: 17, trait: "sticky" });
    expect(state.purchases).toHaveLength(2);
  });

  describe("the pocket smith", () => {
    it("raises a gaff one level at a time", () => {
      let state = floor();
      state = buy(state, { kind: "gaff", number: 17 });
      expect(state.wheel.pockets[17]!.gaff).toBe(1);
      state = buy(state, { kind: "gaff", number: 17 });
      expect(state.wheel.pockets[17]!.gaff).toBe(2);
    });

    it("adds a trait and remembers which way a spring points", () => {
      const state = buy(floor(), {
        kind: "trait",
        number: 16,
        trait: "spring",
        springDirection: -1,
      });
      expect(hasTrait(state.wheel.pockets[16]!, "spring")).toBe(true);
      expect(state.wheel.pockets[16]!.springDirection).toBe(-1);
    });

    it("leaves every other pocket alone", () => {
      const state = buy(floor(), { kind: "gaff", number: 17 });
      expect(state.wheel.pockets.filter((p) => p.gaff > 0)).toHaveLength(1);
    });
  });

  describe("the ball shop", () => {
    it("re-materials a ball", () => {
      const state = buy(floor(), { kind: "ball-material", ballId: "ball-1", material: "steel" });
      expect(state.wheel.balls[0]!.material).toBe("steel");
    });

    it("resizes a ball", () => {
      const state = buy(floor(), { kind: "ball-size", ballId: "ball-1", size: "large" });
      expect(state.wheel.balls[0]!.size).toBe("large");
    });

    it("adds a second ball as plain ivory", () => {
      const state = buy(floor(1000), { kind: "ball-add" });
      expect(state.wheel.balls).toHaveLength(2);
      expect(state.wheel.balls[1]).toMatchObject({
        id: "ball-2",
        material: "ivory",
        chipped: false,
      });
    });

    it("repairs a chipped ball", () => {
      const chipped = openFloor(
        plainWheel({
          balls: [{ id: "ball-1", material: "ivory", size: "standard", chipped: true }],
        }),
        500,
      );
      const state = buy(chipped, { kind: "ball-repair", ballId: "ball-1" });
      expect(state.wheel.balls[0]!.chipped).toBe(false);
    });
  });

  describe("the wheel mechanic", () => {
    it("fits a diamond", () => {
      const state = buy(floor(), {
        kind: "deflector",
        index: 3,
        deflector: "magnetic",
        sector: "tiers",
      });
      expect(state.wheel.deflectors[3]).toEqual({ kind: "magnetic", sector: "tiers" });
    });

    it("replaces a fret", () => {
      const state = buy(floor(), { kind: "fret", index: 5, fret: "spring" });
      expect(state.wheel.frets[5]).toBe("spring");
      expect(state.wheel.frets.filter((f) => f !== "plain")).toHaveLength(1);
    });

    it("changes the rotor", () => {
      const state = buy(floor(), { kind: "rotor", speed: ROTOR_SPEEDS.slow });
      expect(state.wheel.rotorSpeed).toBe(ROTOR_SPEEDS.slow);
    });
  });
});

describe("the cage", () => {
  it("draws a number from anywhere on the wheel", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 800; i++) seen.add(pullCage(floor(), `cage-${i}`).number);
    expect(seen.size).toBe(POCKET_COUNT);
  });

  it("draws a real gaff level", () => {
    for (let i = 0; i < 200; i++) {
      const pull = pullCage(floor(), `cage-${i}`);
      expect([1, 2, 3]).toContain(pull.level);
    }
  });

  it("is reproducible from its seed", () => {
    expect(pullCage(floor(), "same")).toEqual(pullCage(floor(), "same"));
  });

  it("favours the cheapest level, which is what makes the pity counter matter", () => {
    let ones = 0;
    for (let i = 0; i < 1000; i++) if (pullCage(floor(), `w-${i}`).level === 1) ones += 1;
    expect(ones).toBeGreaterThan(500);
  });

  it("guarantees a level above the floor once pity is up", () => {
    const state: FloorState = { ...floor(), pity: CAGE_PITY_THRESHOLD };
    for (let i = 0; i < 50; i++) {
      const pull = pullCage(state, `p-${i}`);
      expect(pull.pity).toBe(true);
      expect(pull.level).toBeGreaterThanOrEqual(2);
    }
  });

  it("counts pity up on a dud and resets it on a hit", () => {
    let state = floor(500);
    for (let i = 0; i < 6; i++) {
      const before = state.pity;
      state = buy(state, { kind: "cage-pull" }, { seed: `pull-${i}` });
      expect(state.pity === 0 || state.pity === before + 1).toBe(true);
    }
  });

  it("never downgrades a pocket it already improved", () => {
    // Paying for a downgrade is a bug nobody would report as one.
    let state = floor(5000);
    for (let i = 0; i < 3; i++) state = buy(state, { kind: "gaff", number: 17 });
    for (let i = 0; i < 40; i++) {
      state = buy(state, { kind: "cage-pull" }, { seed: `keep-${i}` });
      expect(state.wheel.pockets[17]!.gaff).toBe(3);
    }
  });
});

describe("the marker desk", () => {
  it("hands over chips now and owes half again on the next quota", () => {
    const state = buy(floor(100), { kind: "marker", amount: 40 }, { nextQuota: 200 });
    expect(state.bankroll).toBe(140);
    expect(state.debt).toBe(60);
  });

  it("raises heat, because the pit notices a marker", () => {
    const state = buy(floor(100), { kind: "marker", amount: 40 }, { nextQuota: 200 });
    expect(state.heat).toBe(MARKER_HEAT);
  });

  it("will not write a marker for more than half the next quota", () => {
    expect(checkPurchase(floor(), { kind: "marker", amount: 101 }, 200)).toBe("marker-too-large");
    expect(checkPurchase(floor(), { kind: "marker", amount: 100 }, 200)).toBeNull();
  });

  it("refuses a nonsense amount", () => {
    expect(checkPurchase(floor(), { kind: "marker", amount: 0 }, 200)).toBe("marker-too-large");
    expect(checkPurchase(floor(), { kind: "marker", amount: -5 }, 200)).toBe("marker-too-large");
  });

  it("lands on the next table's quota, not on the bankroll", () => {
    // `07` calls a marker "credit against the next quota". The chips are
    // spent on the floor; what is owed is a harder table.
    const run = settleFloor(openRun("m"), { bankroll: 90, debt: 60, heat: 2, pity: 0 });
    const plain = tableRules(0).quota;
    expect(nextTable(run).rules.quota).toBe(plain + 60);
    expect(run.bankroll).toBe(90);
  });
});

describe("settleFloor", () => {
  it("takes back what the floor left and carries its heat", () => {
    const run = settleFloor(openRun("s"), { bankroll: 45, debt: 0, heat: 3, pity: 2 });
    expect(run).toMatchObject({ bankroll: 45, heat: 3, pity: 2, debt: 0 });
  });

  it("does not mutate the run it was given", () => {
    const run = openRun("s");
    const snapshot = JSON.stringify(run);
    settleFloor(run, { bankroll: 1, debt: 1, heat: 1, pity: 1 });
    expect(JSON.stringify(run)).toBe(snapshot);
  });
});

describe("offers", () => {
  it("lists something from every shop", () => {
    const list = offers(floor(), 200);
    const kinds = new Set(list.map((o) => o.purchase.kind));
    expect(kinds).toContain("gaff");
    expect(kinds).toContain("trait");
    expect(kinds).toContain("ball-material");
    expect(kinds).toContain("deflector");
    expect(kinds).toContain("fret");
    expect(kinds).toContain("cage-pull");
  });

  it("prices and judges each one, so a UI never has to guess", () => {
    const list = offers(floor(30), 200);
    const gaff = list.find((o) => o.purchase.kind === "gaff")!;
    expect(gaff.price).toBe(PRICES.gaff[0]);
    expect(gaff.refusal).toBeNull();
    const ball = list.find((o) => o.purchase.kind === "ball-add")!;
    expect(ball.refusal).toBe("unaffordable");
  });

  it("only offers a repair on a ball that needs one", () => {
    expect(offers(floor()).some((o) => o.purchase.kind === "ball-repair")).toBe(false);
    const chipped = openFloor(
      plainWheel({ balls: [{ id: "ball-1", material: "ivory", size: "standard", chipped: true }] }),
      500,
    );
    expect(offers(chipped).some((o) => o.purchase.kind === "ball-repair")).toBe(true);
  });
});

describe("what the floor does to a run", () => {
  /**
   * The measurement the floor was built to produce, and the one that
   * reversed the quota rule two phases up.
   *
   * Phases 2 and 3 could only show what a wheel is worth when it is handed
   * over free. These play the shops: a scripted shopper buying the funnel in
   * the order a player who found it would, against a shopper who buys
   * nothing, over the same seeds.
   */
  const RUNS = 250;
  const TARGET = 17;
  const FEEDER = numberAt(slotOf(TARGET) - 1);

  const PLAN: Purchase[] = [
    { kind: "gaff", number: TARGET },
    { kind: "trait", number: TARGET, trait: "sticky" },
    { kind: "trait", number: FEEDER, trait: "spring", springDirection: 1 },
    { kind: "gaff", number: TARGET },
    { kind: "gaff", number: TARGET },
    { kind: "deflector", index: 0, deflector: "dominant" },
  ];

  /** `spend`: "none", "surplus" (only what the next quota does not need), or "all". */
  function clears(spend: "none" | "surplus" | "all"): number {
    let cleared = 0;
    for (let i = 0; i < RUNS; i++) {
      let run = openRun(`floor-econ-${i}`);
      let wheel = plainWheel();

      while (run.status === "playing") {
        const next = nextTable(run);
        let table = openTable(wheel, next.rules, run.bankroll);
        for (let s = 0; s < next.rules.spins; s++) {
          const outside = Math.max(next.rules.minimumBet, Math.floor(table.bankroll / 6));
          const bets: Bet[] = [
            { kind: "straight", amount: Math.max(1, Math.floor(outside / 4)), number: TARGET },
            { kind: "evenMoney", amount: outside, pick: "red" },
          ];
          const balls = [{ ballId: "ball-1", launchTick: 0 }];
          if (checkBets(table, bets, balls)) break;
          table = playSpin(table, bets, balls, spinSeed(run, next.index, s));
        }
        run = settleTable(run, closeTable(table));
        if (run.status !== "playing" || spend === "none") continue;

        const quota = nextTable(run).rules.quota;
        const budget = spend === "all" ? run.bankroll : Math.max(0, run.bankroll - quota);
        const held = run.bankroll - budget;
        let shop = openFloor(wheel, budget, run.pity);
        for (const purchase of PLAN) {
          if (!checkPurchase(shop, purchase, quota))
            shop = buy(shop, purchase, { nextQuota: quota });
        }
        wheel = shop.wheel;
        run = settleFloor(run, {
          bankroll: shop.bankroll + held,
          debt: shop.debt,
          heat: shop.heat,
          pity: shop.pity,
        });
      }
      if (run.status === "cleared") cleared += 1;
    }
    return cleared;
  }

  it("makes a run clearable at all, which no wheel bought for free had to prove", () => {
    expect(clears("none")).toBe(0);
    expect(clears("surplus")).toBeGreaterThan(0);
  });

  it("rewards spending only the surplus over spending everything", () => {
    // `surplus` is the number `closeTable` reports and the floor is meant to
    // respect: what can be spent without dropping under the next quota.
    // Ignoring it roughly halves the clear rate, which is why the UI has to
    // put it in front of the player rather than leave it to be inferred.
    expect(clears("surplus")).toBeGreaterThan(clears("all"));
  });
});
