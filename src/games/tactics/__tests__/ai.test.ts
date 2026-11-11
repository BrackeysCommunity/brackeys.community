// @vitest-environment node
import { cellKey, findPath, type Cell } from "@jams/engine/game";
import { Rng } from "@jams/engine/sim-kit";
import { describe, expect, it } from "vite-plus/test";

import { enemyOrders, enemyTurn, nextEnemyUnit } from "../ai";
import { applyCommand, legal, reachField, unitIds } from "../rules";
import { BOARD_COLS, BOARD_ROWS, type TacticsSnapshot, type UnitState } from "../types";
import { board, CLASSES, snapshot, unit } from "./fixtures";

const CRIT = 0.1;

const WALLS = board(
  [
    [5, 1],
    [5, 2],
    [5, 3],
    [6, 5],
    [6, 6],
  ],
  [
    [[4, 4], 1],
    [[7, 2], 2],
  ],
);

const redTurn = (units: Record<string, UnitState>) =>
  snapshot(units, { side: "red", phase: "enemy" });

/** Three units a side, scattered by `rng`, each on its own open cell. */
function scatter(rng: Rng): TacticsSnapshot {
  const units: Record<string, UnitState> = {};
  const taken = new Set<number>(WALLS.walls);
  const classes = Object.keys(CLASSES);
  for (const side of ["blue", "red"] as const)
    for (let i = 0; i < 3; i++) {
      let cell: Cell;
      do cell = [rng.below(BOARD_COLS), rng.below(BOARD_ROWS)];
      while (taken.has(cellKey(cell)));
      taken.add(cellKey(cell));
      units[`${side}-${i}`] = unit(side, rng.pick(classes), cell);
    }
  return snapshot(units);
}

describe("the computer side", () => {
  it("strikes the weakest blue unit it can reach a strike on", () => {
    const snap = redTurn({
      r: unit("red", "knight", [4, 4]),
      strong: unit("blue", "knight", [4, 3]),
      weak: unit("blue", "knight", [6, 4], { hp: 3 }),
    });
    expect(enemyOrders(snap, "r", CLASSES, board(), Rng.from(1))).toEqual([
      { name: "move", args: { unit: "r", to: [5, 4] } },
      { name: "attack", args: { unit: "r", target: "weak" } },
    ]);
  });

  it("strikes from where it stands when it can", () => {
    const snap = redTurn({
      r: unit("red", "knight", [4, 4]),
      b: unit("blue", "knight", [4, 3]),
    });
    expect(enemyOrders(snap, "r", CLASSES, board(), Rng.from(1))).toEqual([
      { name: "attack", args: { unit: "r", target: "b" } },
    ]);
  });

  it("walks toward the nearest blue unit along a path when none is in reach", () => {
    const snap = redTurn({
      r: unit("red", "knight", [3, 2]),
      near: unit("blue", "knight", [9, 2]),
      far: unit("blue", "knight", [11, 7]),
    });
    const orders = enemyOrders(snap, "r", CLASSES, WALLS, Rng.from(1));
    expect(orders).toHaveLength(2);
    const [move, wait] = orders;
    expect(wait).toEqual({ name: "wait", args: { unit: "r" } });
    if (move?.name !== "move") throw new Error("expected a move first");
    const field = reachField(snap, "r", CLASSES, WALLS)!;
    const routeCost = (from: Cell, to: Cell) =>
      findPath(WALLS.geometry, from, to, {
        bounds: WALLS.bounds,
        passable: (c) => !WALLS.walls.has(cellKey(c)),
        cost: (_f, c) => WALLS.costs.get(cellKey(c)) ?? 0,
      })!.cost;
    // A full move's worth along a shortest route around the wall, not toward the farther unit.
    expect(field.cost(move.args.to)).toBe(30);
    expect(routeCost(move.args.to, [9, 2])).toBe(routeCost([3, 2], [9, 2]) - 30);
    expect(enemyOrders(snap, "r", CLASSES, WALLS, Rng.from(99))).toEqual(orders);
  });

  it("waits when no blue unit can be reached at all", () => {
    const boxed = board([
      [1, 0],
      [0, 1],
    ]);
    const snap = redTurn({ r: unit("red", "knight", [0, 0]), b: unit("blue", "knight", [9, 7]) });
    expect(enemyOrders(snap, "r", CLASSES, boxed, Rng.from(1))).toEqual([
      { name: "wait", args: { unit: "r" } },
    ]);
  });

  it("acts unit by unit in id order and ends its turn", () => {
    const snap = redTurn({
      "r-b": unit("red", "knight", [8, 6]),
      "r-a": unit("red", "archer", [8, 1]),
      b: unit("blue", "knight", [2, 3]),
    });
    expect(nextEnemyUnit(snap)).toBe("r-a");
    const { orders, snapshot: after } = enemyTurn(snap, CLASSES, WALLS, Rng.from(5), CRIT);
    const units = orders.map((c) => (c.name === "end-turn" ? c.name : c.args.unit));
    expect(units).toEqual(["r-a", "r-a", "r-b", "r-b", "end-turn"]);
    expect(after).toMatchObject({ side: "blue", phase: "orders", turn: 2 });
    expect(nextEnemyUnit(snapshot(snap.units))).toBeNull();
  });

  it("gives the same orders for the same snapshot and seed", () => {
    for (let seed = 0; seed < 16; seed++) {
      const snap = { ...scatter(Rng.from(seed)), side: "red" as const, phase: "enemy" as const };
      const a = enemyTurn(snap, CLASSES, WALLS, Rng.from(seed), CRIT);
      const b = enemyTurn(structuredClone(snap), CLASSES, WALLS, Rng.from(seed), CRIT);
      expect(b).toEqual(a);
    }
  });

  it("never orders a command legal doesn't list, over whole fights", { timeout: 20_000 }, () => {
    let strikes = 0;
    let ended = 0;
    for (let seed = 0; seed < 24; seed++) {
      const draw = Rng.from(seed).fork("fight");
      let state = scatter(Rng.from(seed));
      // A fight ends or stalls inside 40 rounds on a 12×8 board.
      for (let round = 0; round < 40 && state.result === null; round++) {
        // Blue plays legal commands at random until it ends its turn.
        while (state.result === null && state.side === "blue") {
          const pick = draw.pick(legal(state, CLASSES, WALLS));
          state = applyCommand(state, pick, CLASSES, WALLS, draw, CRIT)!.snapshot;
        }
        if (state.result !== null) break;
        const before = state;
        const turn = enemyTurn(before, CLASSES, WALLS, draw.clone(), CRIT);
        let replay = before;
        for (const order of turn.orders) {
          expect(legal(replay, CLASSES, WALLS)).toContainEqual(order);
          if (order.name === "attack") strikes++;
          replay = applyCommand(replay, order, CLASSES, WALLS, draw, CRIT)!.snapshot;
        }
        expect(replay).toEqual(turn.snapshot);
        state = replay;
      }
      expect(unitIds(state).length).toBeGreaterThan(0);
      if (state.result !== null) ended++;
    }
    expect(strikes).toBeGreaterThan(0);
    expect(ended).toBeGreaterThan(0);
  });
});
