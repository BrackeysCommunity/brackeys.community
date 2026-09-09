import { describe, expect, it } from "vite-plus/test";

import type { Bet } from "../bets.ts";
import type { BallInput } from "../spin.ts";
import { plainWheel, type WheelState } from "../state.ts";
import {
  BetRefused,
  checkBets,
  closeTable,
  isOpen,
  openTable,
  playSpin,
  type TableRules,
  type TableState,
  tableSummary,
  totalStake,
} from "../table.ts";

const RULES: TableRules = { spins: 8, minimumBet: 2, quota: 100, nudges: 1 };
const BALLS: readonly BallInput[] = [{ ballId: "ball-1", launchTick: 0 }];
const RED: Bet = { kind: "evenMoney", amount: 5, pick: "red" };

function table(rules: Partial<TableRules> = {}, bankroll = 100, wheel?: WheelState): TableState {
  return openTable(wheel ?? plainWheel(), { ...RULES, ...rules }, bankroll);
}

/** Plays a table out with the same bet every spin, skipping refused spins. */
function playOut(state: TableState, bet: Bet = RED, seedPrefix = "t"): TableState {
  let current = state;
  for (let i = 0; i < current.rules.spins; i++) {
    if (checkBets(current, [bet], BALLS)) break;
    current = playSpin(current, [bet], BALLS, `${seedPrefix}-${i}`);
  }
  return current;
}

describe("openTable", () => {
  it("starts with the rules' allowance and nothing on the felt", () => {
    const state = table();
    expect(state.bankroll).toBe(100);
    expect(state.spinsPlayed).toBe(0);
    expect(state.nudgesRemaining).toBe(1);
    expect(state.imprisoned).toEqual([]);
    expect(state.heat).toBe(0);
    expect(isOpen(state)).toBe(true);
  });
});

describe("checkBets", () => {
  it("stands a legal bet inside the bankroll", () => {
    expect(checkBets(table(), [RED], BALLS)).toBeNull();
  });

  it("refuses a stake under the table minimum", () => {
    // `07` wants the exposure per spin never to be zero.
    expect(checkBets(table(), [{ ...RED, amount: 1 }], BALLS)).toBe("below-minimum");
    expect(checkBets(table(), [], BALLS)).toBe("below-minimum");
  });

  it("counts every bet toward the minimum", () => {
    const bets: Bet[] = [
      { kind: "straight", amount: 1, number: 17 },
      { kind: "straight", amount: 1, number: 18 },
    ];
    expect(checkBets(table(), bets, BALLS)).toBeNull();
  });

  it("refuses a stake the bankroll cannot cover", () => {
    expect(checkBets(table({}, 4), [RED], BALLS)).toBe("over-bankroll");
  });

  it("refuses an illegal bet", () => {
    const forged = { kind: "split", amount: 5, numbers: [1, 36] } as Bet;
    expect(checkBets(table(), [forged], BALLS)).toBe("illegal-bet");
  });

  it("refuses a spin with no ball, or with a ball this wheel does not have", () => {
    expect(checkBets(table(), [RED], [])).toBe("no-balls");
    expect(checkBets(table(), [RED], [{ ballId: "ghost", launchTick: 0 }])).toBe("unknown-ball");
  });

  it("refuses anything once the table is out of spins", () => {
    const state = playOut(table({ minimumBet: 1 }, 500), { ...RED, amount: 1 });
    expect(state.spinsPlayed).toBe(8);
    expect(isOpen(state)).toBe(false);
    expect(checkBets(state, [RED], BALLS)).toBe("table-closed");
  });
});

describe("playSpin", () => {
  it("throws the refusal rather than playing it", () => {
    expect(() => playSpin(table(), [{ ...RED, amount: 1 }], BALLS, "s")).toThrow(BetRefused);
    try {
      playSpin(table({}, 1), [RED], BALLS, "s");
    } catch (error) {
      expect((error as BetRefused).reason).toBe("over-bankroll");
    }
  });

  it("moves the bankroll by the spin's net", () => {
    const before = table();
    const after = playSpin(before, [RED], BALLS, "net");
    const result = after.spins[0]!.result;
    expect(after.bankroll).toBe(before.bankroll - result.stake + result.returned);
  });

  it("does not mutate the state it was given", () => {
    const before = table();
    const snapshot = JSON.stringify(before);
    playSpin(before, [RED], BALLS, "pure");
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("records every spin in order", () => {
    const state = playOut(table({ minimumBet: 1 }, 500), { ...RED, amount: 1 });
    expect(state.spins.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("replays to the same table from the same seeds", () => {
    // This is what the validator does: fold the input log and compare.
    const one = playOut(table({ minimumBet: 1 }, 500), { ...RED, amount: 1 }, "replay");
    const two = playOut(table({ minimumBet: 1 }, 500), { ...RED, amount: 1 }, "replay");
    expect(tableSummary(two, closeTable(two))).toEqual(tableSummary(one, closeTable(one)));
  });

  it("leaves a bankrupt player unable to bet, which ends their table early", () => {
    // The intended failure, not a bug to route around.
    const state = playSpin(table({ minimumBet: 2 }, 6), [{ ...RED, amount: 6 }], BALLS, "bust");
    if (state.bankroll === 0) {
      expect(checkBets(state, [RED], BALLS)).toBe("over-bankroll");
    }
  });
});

describe("the nudge allowance", () => {
  it("belongs to the table, not the spin", () => {
    const wheel = plainWheel({ nudgesPerTable: 1 });
    let state = openTable(wheel, { ...RULES, minimumBet: 1, nudges: 1 }, 500);
    const contact = state.spins.length;
    expect(contact).toBe(0);

    // Two spins, each with a nudge tap inside its scatter. Only the first
    // can be paid for.
    const nudge: BallInput = { ballId: "ball-1", launchTick: 0, nudgeTicks: [493, 495, 500] };
    state = playSpin(state, [{ ...RED, amount: 1 }], [nudge], "n-0");
    const first = state.spins[0]!.result.nudgesUsed;
    state = playSpin(state, [{ ...RED, amount: 1 }], [nudge], "n-1");
    const second = state.spins[1]!.result.nudgesUsed;

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(state.nudgesRemaining).toBe(0);
  });

  it("is shared across the balls on one spin", () => {
    const wheel = plainWheel({
      balls: [
        { id: "ball-1", material: "ivory", size: "standard", chipped: false },
        { id: "ball-2", material: "ivory", size: "standard", chipped: false },
      ],
    });
    const state = openTable(wheel, { ...RULES, minimumBet: 1, nudges: 1 }, 500);
    const after = playSpin(
      state,
      [{ ...RED, amount: 1 }],
      [
        { ballId: "ball-1", launchTick: 0, nudgeTicks: [493, 495] },
        { ballId: "ball-2", launchTick: 0, nudgeTicks: [493, 495] },
      ],
      "shared",
    );
    expect(after.spins[0]!.result.nudgesUsed).toBe(1);
    expect(after.nudgesRemaining).toBe(0);
  });

  it("charges heat for a nudge", () => {
    const state = openTable(plainWheel(), { ...RULES, minimumBet: 1, nudges: 1 }, 500);
    const after = playSpin(
      state,
      [{ ...RED, amount: 1 }],
      [{ ballId: "ball-1", launchTick: 0, nudgeTicks: [493, 495] }],
      "heat",
    );
    expect(after.heat).toBeGreaterThanOrEqual(1);
  });

  it("costs nothing when nobody taps", () => {
    const after = playSpin(table(), [RED], BALLS, "quiet");
    expect(after.nudgesRemaining).toBe(1);
    expect(after.heat).toBe(0);
  });
});

describe("imprisoned stakes", () => {
  const prisonWheel = plainWheel({ zeroRule: "en-prison" });

  /** Finds a seed whose spin lands on zero, so the rule actually fires. */
  function seedHittingZero(): string {
    for (let i = 0; i < 500; i++) {
      const state = playSpin(
        openTable(prisonWheel, { ...RULES, minimumBet: 1 }, 500),
        [RED],
        BALLS,
        `z-${i}`,
      );
      if (state.spins[0]!.result.pockets[0]!.number === 0) return `z-${i}`;
    }
    throw new Error("no seed in 500 found the zero");
  }

  it("holds an even-money stake the zero took", () => {
    const state = playSpin(
      openTable(prisonWheel, { ...RULES, minimumBet: 1 }, 500),
      [RED],
      BALLS,
      seedHittingZero(),
    );
    expect(state.imprisoned).toEqual([RED]);
    expect(state.bankroll).toBe(495);
  });

  it("returns the stake and nothing more when the held bet comes in", () => {
    const zero = seedHittingZero();
    let state = playSpin(
      openTable(prisonWheel, { ...RULES, minimumBet: 1 }, 500),
      [RED],
      BALLS,
      zero,
    );
    const held = state.bankroll;

    // Walk seeds until the next spin lands red, so the held stake is freed.
    for (let i = 0; i < 200; i++) {
      const next = playSpin(state, [{ ...RED, amount: 1 }], BALLS, `free-${i}`);
      const record = next.spins[1]!;
      if (record.released === 0) continue;
      expect(record.released).toBe(5);
      expect(record.taken).toBe(0);
      // The freed stake comes back at face value: no odds, no multiplier.
      expect(next.bankroll).toBe(held - 1 + record.result.returned + 5);
      expect(next.imprisoned).toEqual([]);
      return;
    }
    throw new Error("no seed in 200 released the held stake");
  });

  it("lets the house keep a held stake that misses again", () => {
    const zero = seedHittingZero();
    const state = playSpin(
      openTable(prisonWheel, { ...RULES, minimumBet: 1 }, 500),
      [RED],
      BALLS,
      zero,
    );
    for (let i = 0; i < 200; i++) {
      const next = playSpin(state, [{ ...RED, amount: 1 }], BALLS, `lose-${i}`);
      const record = next.spins[1]!;
      if (record.taken === 0) continue;
      expect(record.taken).toBe(5);
      expect(record.released).toBe(0);
      return;
    }
    throw new Error("no seed in 200 took the held stake");
  });

  it("does not hold a stake on a table with no zero rule", () => {
    const state = playOut(table({ minimumBet: 1 }, 500), { ...RED, amount: 1 });
    expect(state.imprisoned).toEqual([]);
  });
});

describe("closeTable", () => {
  it("clears when the bankroll reaches the quota and takes it", () => {
    const state = table({ quota: 100 }, 100);
    const close = closeTable(state);
    expect(close).toMatchObject({ cleared: true, counted: 100, quota: 100, surplus: 0 });
  });

  it("hands the surplus to the floor", () => {
    const close = closeTable(table({ quota: 100 }, 260));
    expect(close.surplus).toBe(160);
  });

  it("busts a bankroll one chip short", () => {
    const close = closeTable(table({ quota: 100 }, 99));
    expect(close).toMatchObject({ cleared: false, surplus: 0 });
  });

  it("hands back stakes the felt was still holding", () => {
    // A bet imprisoned on the eighth spin has no ninth spin to free it, and
    // the house does not get to keep it because the table ran out.
    const state: ReturnType<typeof table> = { ...table({ quota: 100 }, 96), imprisoned: [RED] };
    const close = closeTable(state);
    expect(close.released).toBe(5);
    expect(close.counted).toBe(101);
    expect(close.cleared).toBe(true);
  });
});

describe("totalStake", () => {
  it("adds the chips going down", () => {
    expect(totalStake([RED, { kind: "straight", amount: 3, number: 17 }])).toBe(8);
    expect(totalStake([])).toBe(0);
  });
});

describe("tableSummary", () => {
  it("holds only integers, so the digest cannot refuse it", () => {
    const state = playOut(table({ minimumBet: 1 }, 500), { ...RED, amount: 1 });
    const summary = tableSummary(state, closeTable(state));
    for (const value of [summary.cleared, summary.counted, summary.quota, summary.surplus]) {
      expect(Number.isInteger(value)).toBe(true);
    }
    for (const spin of summary.spins) {
      expect(Number.isInteger(spin.bankroll)).toBe(true);
    }
  });

  it("tracks the bankroll spin by spin", () => {
    const state = playOut(table({ minimumBet: 1 }, 500), { ...RED, amount: 1 });
    const summary = tableSummary(state, closeTable(state));
    expect(summary.spins.at(-1)!.bankroll).toBe(state.bankroll);
  });
});
