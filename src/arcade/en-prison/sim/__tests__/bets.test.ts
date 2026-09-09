import { describe, expect, it } from "vite-plus/test";

import { fp, FP_ONE } from "../../../sim-kit/index.ts";
import {
  type Bet,
  BET_ODDS,
  betNumbers,
  isLegalBet,
  type LandedBall,
  resolveBet,
  samePocketBonus,
} from "../bets.ts";
import { pocketColor } from "../wheel.ts";

const plain = (n: number): LandedBall => ({ number: n, multiplier: FP_ONE });
const gaffed = (n: number, times: number): LandedBall => ({ number: n, multiplier: fp(times) });

describe("betNumbers", () => {
  it("covers a straight-up", () => {
    expect(betNumbers({ kind: "straight", amount: 1, number: 17 })).toEqual([17]);
  });

  it("covers a street as its row of three", () => {
    expect(betNumbers({ kind: "street", amount: 1, row: 0 })).toEqual([1, 2, 3]);
    expect(betNumbers({ kind: "street", amount: 1, row: 11 })).toEqual([34, 35, 36]);
  });

  it("covers a corner as the square below and right of its anchor", () => {
    expect(betNumbers({ kind: "corner", amount: 1, corner: 1 })).toEqual([1, 2, 4, 5]);
    expect(betNumbers({ kind: "corner", amount: 1, corner: 17 })).toEqual([17, 18, 20, 21]);
  });

  it("covers a six line as two streets", () => {
    expect(betNumbers({ kind: "sixLine", amount: 1, row: 0 })).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("covers a dozen", () => {
    expect(betNumbers({ kind: "dozen", amount: 1, dozen: 1 })).toEqual([
      13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
  });

  it("covers a column as every third number", () => {
    expect(betNumbers({ kind: "column", amount: 1, column: 0 })).toEqual([
      1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34,
    ]);
  });

  it("covers each even-money pick with eighteen numbers and never zero", () => {
    for (const pick of ["red", "black", "even", "odd", "low", "high"] as const) {
      const numbers = betNumbers({ kind: "evenMoney", amount: 1, pick });
      expect(numbers).toHaveLength(18);
      expect(numbers).not.toContain(0);
    }
  });

  it("matches the felt's colours", () => {
    for (const n of betNumbers({ kind: "evenMoney", amount: 1, pick: "red" })) {
      expect(pocketColor(n)).toBe("red");
    }
  });
});

describe("isLegalBet", () => {
  it("takes a straight-up on zero", () => {
    expect(isLegalBet({ kind: "straight", amount: 1, number: 0 })).toBe(true);
  });

  it("refuses a number that is not on the felt", () => {
    expect(isLegalBet({ kind: "straight", amount: 1, number: 37 })).toBe(false);
    expect(isLegalBet({ kind: "straight", amount: 1, number: -1 })).toBe(false);
  });

  it("refuses a stake that is not a positive whole number of chips", () => {
    expect(isLegalBet({ kind: "straight", amount: 0, number: 17 })).toBe(false);
    expect(isLegalBet({ kind: "straight", amount: -5, number: 17 })).toBe(false);
    expect(isLegalBet({ kind: "straight", amount: 1.5, number: 17 })).toBe(false);
  });

  describe("split", () => {
    it("takes numbers that touch across the layout", () => {
      expect(isLegalBet({ kind: "split", amount: 1, numbers: [1, 2] })).toBe(true);
      expect(isLegalBet({ kind: "split", amount: 1, numbers: [1, 4] })).toBe(true);
      expect(isLegalBet({ kind: "split", amount: 1, numbers: [17, 18] })).toBe(true);
    });

    it("takes the three splits zero makes", () => {
      expect(isLegalBet({ kind: "split", amount: 1, numbers: [0, 1] })).toBe(true);
      expect(isLegalBet({ kind: "split", amount: 1, numbers: [0, 3] })).toBe(true);
      expect(isLegalBet({ kind: "split", amount: 1, numbers: [0, 4] })).toBe(false);
    });

    it("refuses a pair that does not touch", () => {
      // This is the one the validator exists for: a crafted log claiming a
      // split on any two numbers would buy 17-to-1 odds on a free choice.
      expect(isLegalBet({ kind: "split", amount: 1, numbers: [1, 5] })).toBe(false);
      expect(isLegalBet({ kind: "split", amount: 1, numbers: [1, 36] })).toBe(false);
      expect(isLegalBet({ kind: "split", amount: 1, numbers: [3, 4] })).toBe(false);
    });
  });

  describe("corner", () => {
    it("refuses an anchor in the right-hand column, where there is no square", () => {
      expect(isLegalBet({ kind: "corner", amount: 1, corner: 3 })).toBe(false);
      expect(isLegalBet({ kind: "corner", amount: 1, corner: 2 })).toBe(true);
    });

    it("refuses an anchor on the bottom row", () => {
      expect(isLegalBet({ kind: "corner", amount: 1, corner: 34 })).toBe(false);
      expect(isLegalBet({ kind: "corner", amount: 1, corner: 31 })).toBe(true);
    });
  });

  it("bounds rows, dozens, and columns", () => {
    expect(isLegalBet({ kind: "street", amount: 1, row: 12 })).toBe(false);
    expect(isLegalBet({ kind: "sixLine", amount: 1, row: 11 })).toBe(false);
    expect(isLegalBet({ kind: "sixLine", amount: 1, row: 10 })).toBe(true);
    expect(isLegalBet({ kind: "dozen", amount: 1, dozen: 3 })).toBe(false);
    expect(isLegalBet({ kind: "column", amount: 1, column: 3 })).toBe(false);
  });

  it("refuses an even-money pick that is not on the felt", () => {
    const forged = { kind: "evenMoney", amount: 1, pick: "green" } as unknown as Bet;
    expect(isLegalBet(forged)).toBe(false);
  });
});

describe("resolveBet", () => {
  it("pays a straight-up at 35 to 1 and returns the stake", () => {
    const outcome = resolveBet({ kind: "straight", amount: 1, number: 17 }, [plain(17)], "none");
    expect(outcome).toMatchObject({ hits: 1, profit: 35, returned: 36, imprisoned: 0 });
  });

  it("pays every bet at its printed odds", () => {
    const cases: Array<[Bet, number]> = [
      [{ kind: "straight", amount: 1, number: 17 }, 35],
      [{ kind: "split", amount: 1, numbers: [17, 18] }, 17],
      [{ kind: "street", amount: 1, row: 5 }, 11],
      [{ kind: "corner", amount: 1, corner: 17 }, 8],
      [{ kind: "sixLine", amount: 1, row: 5 }, 5],
      [{ kind: "dozen", amount: 1, dozen: 1 }, 2],
      [{ kind: "column", amount: 1, column: 1 }, 2],
      // 17 is a black pocket, whatever `07`'s worked example says.
      [{ kind: "evenMoney", amount: 1, pick: "black" }, 1],
    ];
    for (const [bet, odds] of cases) {
      expect(BET_ODDS[bet.kind]).toBe(odds);
      expect(resolveBet(bet, [plain(17)], "none").profit).toBe(odds);
    }
  });

  it("takes the stake on a loss", () => {
    const outcome = resolveBet({ kind: "straight", amount: 5, number: 17 }, [plain(4)], "none");
    expect(outcome).toMatchObject({ hits: 0, profit: 0, returned: 0, rule: "none" });
  });

  it("loses every outside bet to zero", () => {
    for (const pick of ["red", "black", "even", "odd", "low", "high"] as const) {
      expect(resolveBet({ kind: "evenMoney", amount: 2, pick }, [plain(0)], "none").returned).toBe(
        0,
      );
    }
  });

  describe("pocket multipliers", () => {
    it("scales the odds, not the stake", () => {
      // `07`'s worked example: a x3 on 17 makes a straight-up pay 105 and
      // an even-money bet that lands on 17 pay 3. The doc calls that bet
      // red; 17 is black, so the outside bet here is the one that would
      // actually have been standing.
      expect(
        resolveBet({ kind: "straight", amount: 1, number: 17 }, [gaffed(17, 3)], "none").profit,
      ).toBe(105);
      expect(
        resolveBet({ kind: "evenMoney", amount: 1, pick: "black" }, [gaffed(17, 3)], "none").profit,
      ).toBe(3);
    });

    it("leaves a plain pocket paying the printed odds", () => {
      expect(
        resolveBet({ kind: "straight", amount: 2, number: 17 }, [plain(17)], "none").profit,
      ).toBe(70);
    });
  });

  describe("multi-ball", () => {
    it("pays once per ball that lands on the bet, charging the stake once", () => {
      const outcome = resolveBet(
        { kind: "straight", amount: 1, number: 17 },
        [plain(17), plain(17)],
        "none",
      );
      expect(outcome.hits).toBe(2);
      expect(outcome.profit).toBe(70);
      expect(outcome.returned).toBe(71);
    });

    it("pays only the balls that landed on it", () => {
      const outcome = resolveBet(
        { kind: "evenMoney", amount: 10, pick: "red" },
        [plain(1), plain(2)],
        "none",
      );
      expect(outcome.hits).toBe(1);
      expect(outcome.returned).toBe(20);
    });

    it("applies each ball's own pocket multiplier", () => {
      const outcome = resolveBet(
        { kind: "evenMoney", amount: 1, pick: "red" },
        [gaffed(1, 3), plain(3)],
        "none",
      );
      expect(outcome.profit).toBe(4);
    });
  });

  describe("zero rules", () => {
    it("returns half an even-money stake under La Partage", () => {
      const outcome = resolveBet(
        { kind: "evenMoney", amount: 10, pick: "red" },
        [plain(0)],
        "la-partage",
      );
      expect(outcome).toMatchObject({ returned: 5, imprisoned: 0, rule: "la-partage" });
    });

    it("gives the house the odd chip", () => {
      const outcome = resolveBet(
        { kind: "evenMoney", amount: 5, pick: "red" },
        [plain(0)],
        "la-partage",
      );
      expect(outcome.returned).toBe(2);
    });

    it("holds the stake on the table under En Prison", () => {
      const outcome = resolveBet(
        { kind: "evenMoney", amount: 10, pick: "red" },
        [plain(0)],
        "en-prison",
      );
      expect(outcome).toMatchObject({ returned: 0, imprisoned: 10, rule: "en-prison" });
    });

    it("does not rescue an inside bet", () => {
      const outcome = resolveBet(
        { kind: "straight", amount: 10, number: 17 },
        [plain(0)],
        "la-partage",
      );
      expect(outcome).toMatchObject({ returned: 0, imprisoned: 0, rule: "none" });
    });

    it("does not fire when the bet won anyway", () => {
      const outcome = resolveBet(
        { kind: "evenMoney", amount: 10, pick: "red" },
        [plain(0), plain(1)],
        "en-prison",
      );
      expect(outcome).toMatchObject({ hits: 1, imprisoned: 0, rule: "none" });
    });

    it("fires on a multi-ball spin where one ball found the zero", () => {
      // The stingy reading, written down deliberately: a second ball is not
      // a hedge against the house edge.
      const outcome = resolveBet(
        { kind: "evenMoney", amount: 10, pick: "red" },
        [plain(0), plain(2)],
        "la-partage",
      );
      expect(outcome).toMatchObject({ hits: 0, returned: 5, rule: "la-partage" });
    });
  });
});

describe("samePocketBonus", () => {
  it("pays nothing on a single ball", () => {
    expect(samePocketBonus([plain(17)], 10)).toEqual({ pairs: 0, profit: 0 });
  });

  it("pays nothing when the balls split", () => {
    expect(samePocketBonus([plain(17), plain(4)], 10)).toEqual({ pairs: 0, profit: 0 });
  });

  it("pays 35 to 1 on the stake when two balls share a pocket", () => {
    expect(samePocketBonus([plain(17), plain(17)], 10)).toEqual({ pairs: 1, profit: 350 });
  });

  it("counts three balls in one pocket as three pairs", () => {
    expect(samePocketBonus([plain(17), plain(17), plain(17)], 1)).toEqual({
      pairs: 3,
      profit: 105,
    });
  });

  it("scales by the shared pocket's multiplier", () => {
    expect(samePocketBonus([gaffed(17, 2), gaffed(17, 2)], 10)).toEqual({ pairs: 1, profit: 700 });
  });
});
