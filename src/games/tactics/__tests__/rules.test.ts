// @vitest-environment node
import { Rng } from "@jams/engine/sim-kit";
import { describe, expect, it } from "vite-plus/test";

import { parseTacticsCommand, type TacticsCommand } from "../commands";
import {
  applyCommand,
  isLegal,
  legal,
  reachCells,
  reachField,
  resultOf,
  rollDamage,
  targetsFrom,
} from "../rules";
import { board, CLASSES, snapshot, unit } from "./fixtures";

/** First draws: seed 12's is under 0.1 (a crit at the default chance), seed 0's isn't. */
const CRIT_SEED = 12;
const PLAIN_SEED = 0;

describe("reach", () => {
  it("walks around walls and stops at the class's move", () => {
    const snap = snapshot({ k: unit("blue", "knight", [0, 0]) });
    const open = reachCells(snap, "k", CLASSES, board());
    expect(open).toContainEqual([3, 0]);
    expect(open).not.toContainEqual([4, 0]);
    expect(open).toHaveLength(9);

    const walled = board([
      [1, 0],
      [1, 1],
    ]);
    const cells = reachCells(snap, "k", CLASSES, walled);
    expect(cells).not.toContainEqual([1, 0]);
    expect(cells).not.toContainEqual([2, 0]);
    expect(cells).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
    ]);
  });

  it("charges rough on the cells walked into, not the one left", () => {
    const snap = snapshot({ k: unit("blue", "knight", [5, 4]) });
    const rough = board([], [[[6, 4], 1]]);
    const field = reachField(snap, "k", CLASSES, rough)!;
    expect(field.cost([6, 4])).toBe(20);
    expect(field.cost([4, 4])).toBe(10);
    expect(field.cost([8, 4])).toBeUndefined();
    expect(reachCells(snap, "k", CLASSES, rough)).not.toContainEqual([8, 4]);
    expect(reachCells(snap, "k", CLASSES, board())).toContainEqual([8, 4]);

    const from = snapshot({ k: unit("blue", "knight", [6, 4]) });
    expect(reachField(from, "k", CLASSES, rough)!.cost([7, 4])).toBe(10);
  });

  it("never steps onto or through another unit", () => {
    const snap = snapshot({
      k: unit("blue", "knight", [0, 0]),
      a: unit("blue", "archer", [1, 0]),
      r: unit("red", "knight", [0, 1]),
    });
    expect(reachCells(snap, "k", CLASSES, board())).toEqual([]);
  });
});

describe("attacks", () => {
  it("measures range by grid distance", () => {
    const snap = snapshot({
      a: unit("blue", "archer", [2, 2]),
      near: unit("red", "knight", [3, 2]),
      mid: unit("red", "knight", [3, 3]),
      far: unit("red", "knight", [5, 2]),
      out: unit("red", "knight", [5, 3]),
    });
    expect(targetsFrom(snap, "a", CLASSES, board())).toEqual(["far", "mid"]);
  });

  it("needs a clear line of sight for an archer, walls opaque, units not", () => {
    const units = {
      a: unit("blue", "archer", [0, 3]),
      t: unit("red", "knight", [3, 3]),
      between: unit("blue", "knight", [1, 3]),
    };
    const snap = snapshot(units);
    const shot: TacticsCommand = { name: "attack", args: { unit: "a", target: "t" } };
    expect(isLegal(snap, shot, CLASSES, board())).toBe(true);
    const walled = board([[2, 3]]);
    expect(isLegal(snap, shot, CLASSES, walled)).toBe(false);
    expect(legal(snap, CLASSES, walled)).not.toContainEqual(shot);
    expect(applyCommand(snap, shot, CLASSES, walled, Rng.from(1), 0.1)).toBeNull();

    // A knight swings without needing sight.
    const swing = snapshot({ k: unit("blue", "knight", [2, 2]), t: unit("red", "knight", [3, 2]) });
    expect(targetsFrom(swing, "k", CLASSES, board([[3, 2]]))).toEqual(["t"]);
  });

  it("doubles the class's attack on a crit from a seeded draw", () => {
    const knight = CLASSES.knight!;
    expect(rollDamage(knight, Rng.from(CRIT_SEED), 0.1)).toEqual({ damage: 8, crit: true });
    expect(rollDamage(knight, Rng.from(PLAIN_SEED), 0.1)).toEqual({ damage: 4, crit: false });
    expect(rollDamage(knight, Rng.from(CRIT_SEED), 0)).toEqual({ damage: 4, crit: false });

    const snap = snapshot({ k: unit("blue", "knight", [2, 2]), t: unit("red", "knight", [3, 2]) });
    const hit: TacticsCommand = { name: "attack", args: { unit: "k", target: "t" } };
    const crit = applyCommand(snap, hit, CLASSES, board(), Rng.from(CRIT_SEED), 0.1)!;
    expect(crit.snapshot.units.t!.hp).toBe(2);
    expect(crit.log).toEqual(["k hits t for 8 (crit)"]);
    const plain = applyCommand(snap, hit, CLASSES, board(), Rng.from(PLAIN_SEED), 0.1)!;
    expect(plain.snapshot.units.t!.hp).toBe(6);
  });

  it("removes a fallen unit and ends the fight when a side is gone", () => {
    const snap = snapshot({
      k: unit("blue", "knight", [2, 2]),
      t: unit("red", "knight", [3, 2], { hp: 3 }),
    });
    const hit: TacticsCommand = { name: "attack", args: { unit: "k", target: "t" } };
    const done = applyCommand(snap, hit, CLASSES, board(), Rng.from(PLAIN_SEED), 0.1)!;
    expect(done.snapshot.units.t).toBeUndefined();
    expect(done.snapshot.result).toBe("won");
    expect(done.snapshot.phase).toBe("over");
    expect(done.log).toEqual(["k hits t for 4", "t falls", "blue wins"]);
    expect(legal(done.snapshot, CLASSES, board())).toEqual([]);
  });
});

describe("resultOf", () => {
  it("is won or lost once a side is gone, open while both stand or with no units at all", () => {
    expect(resultOf({ k: unit("blue", "knight", [0, 0]) })).toBe("won");
    expect(resultOf({ t: unit("red", "knight", [0, 0]) })).toBe("lost");
    expect(
      resultOf({ k: unit("blue", "knight", [0, 0]), t: unit("red", "knight", [1, 0]) }),
    ).toBeNull();
    expect(resultOf({})).toBeNull();
  });
});

describe("legal", () => {
  const snap = snapshot({
    b2: unit("blue", "scout", [6, 6]),
    b1: unit("blue", "knight", [2, 2]),
    r1: unit("red", "knight", [3, 2]),
  });

  it("lists the side to act's commands in a stable order, end-turn last", () => {
    const list = legal(snap, CLASSES, board());
    const names = list.map((c) => (c.name === "end-turn" ? c.name : `${c.name}:${c.args.unit}`));
    expect(names.at(-1)).toBe("end-turn");
    expect(names.indexOf("wait:b1")).toBeLessThan(names.indexOf("move:b2"));
    expect(list).toContainEqual({ name: "attack", args: { unit: "b1", target: "r1" } });
    expect(list.some((c) => c.name !== "end-turn" && c.args.unit === "r1")).toBe(false);
    expect(legal(snap, CLASSES, board())).toEqual(list);
    const moves = list.filter((c) => c.name === "move" && c.args.unit === "b1");
    expect(moves.map((c) => (c.name === "move" ? c.args.to : null))).toEqual(
      reachCells(snap, "b1", CLASSES, board()),
    );
  });

  it("agrees with isLegal and applyCommand", () => {
    for (const c of legal(snap, CLASSES, board())) {
      expect(isLegal(snap, c, CLASSES, board())).toBe(true);
      expect(applyCommand(snap, c, CLASSES, board(), Rng.from(3), 0.1)).not.toBeNull();
    }
  });

  it("moves once, then attacks or waits once", () => {
    const moved = applyCommand(
      snap,
      { name: "move", args: { unit: "b2", to: [6, 4] } },
      CLASSES,
      board(),
      Rng.from(1),
      0.1,
    )!;
    expect(moved.snapshot.units.b2).toMatchObject({ cell: [6, 4], moved: true, acted: false });
    const again: TacticsCommand = { name: "move", args: { unit: "b2", to: [6, 3] } };
    expect(isLegal(moved.snapshot, again, CLASSES, board())).toBe(false);
    const waited = applyCommand(
      moved.snapshot,
      { name: "wait", args: { unit: "b2" } },
      CLASSES,
      board(),
      Rng.from(1),
      0.1,
    )!;
    expect(
      legal(waited.snapshot, CLASSES, board()).some(
        (c) => c.name !== "end-turn" && c.args.unit === "b2",
      ),
    ).toBe(false);
  });

  it("hands the turn over and back, resetting every unit", () => {
    const end = { name: "end-turn" } as const;
    const red = applyCommand(snap, end, CLASSES, board(), Rng.from(1), 0.1)!.snapshot;
    expect(red).toMatchObject({ side: "red", phase: "enemy", turn: 1 });
    const blue = applyCommand(red, end, CLASSES, board(), Rng.from(1), 0.1)!.snapshot;
    expect(blue).toMatchObject({ side: "blue", phase: "orders", turn: 2 });
    expect(legal({ ...snap, phase: "moving" }, CLASSES, board())).toEqual([]);
  });

  it("parses commands as they arrive", () => {
    expect(parseTacticsCommand({ name: "move", args: { unit: "b1", to: [1, 2] } })).toEqual({
      name: "move",
      args: { unit: "b1", to: [1, 2] },
    });
    expect(parseTacticsCommand({ name: "move", args: { unit: "b1", to: [1.5, 2] } })).toBeNull();
    expect(parseTacticsCommand({ name: "end-turn" })).toEqual({ name: "end-turn" });
    expect(parseTacticsCommand({ name: "fly", args: {} })).toBeNull();
  });
});
