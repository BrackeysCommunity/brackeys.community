// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";

import { goldenCases } from "../../../test/golden.ts";
import { stage } from "../../../test/stage.ts";
import { HIT } from "../../shell/board.ts";
import { DONE } from "../../shell/kit.ts";
import { play } from "../../shell/play.ts";
import circuit from "./index.ts";
import { EMPTY, lit, sidesOf, type CircuitModel } from "./model.ts";
import { centre, geometry, pick } from "./scene.ts";

const cases = goldenCases("circuit");
const small = cases.find((c) => c.name === "level-1-full")!;
const capped = cases.find((c) => c.name === "level-9-compact")!;
const phone = { width: 360, height: 420 };
const wide = { width: 900, height: 560 };

test("tapping the tiles round until the conduits join lights the load", () => {
  for (const c of [small, capped]) {
    const n = c.layout.size;
    const s = stage(circuit, c.layout, phone);
    const geo = geometry(n, phone);
    const solve = c.logs.find((l) => l.name === "solve")!.log.moves;
    for (const m of solve) s.tap(centre(geo, n, m.a));
    expect(s.moves).toEqual(solve.map(({ a }) => ({ at: 0, a })));
    const on = (s.model as CircuitModel).lit();
    expect(on[c.layout.goal]).toBe(true);
    for (const trap of c.layout.false ?? []) expect(on[trap]).toBe(false);
    expect(play(circuit, c.layout, undefined, { moves: s.moves }, c.horizon).status).toBe(DONE);
  }
});

test("a tap is one move, and four of them bring a tile back round", () => {
  const n = small.layout.size;
  const s = stage(circuit, small.layout, phone);
  const geo = geometry(n, phone);
  const model = s.model as CircuitModel;
  const tile = small.layout.tiles!.findIndex((k) => k !== EMPTY);
  s.at = 300;
  s.tap(centre(geo, n, tile));
  expect(s.moves).toEqual([{ at: 300, a: tile }]);
  expect(model.at[tile]).toBe((small.layout.turn![tile]! + 1) % 4);
  for (let i = 0; i < 3; i++) s.tap(centre(geo, n, tile));
  expect(model.at[tile]).toBe(small.layout.turn![tile]);
});

test("a bare tile, a touch off the board and a finger that slides away turn nothing", () => {
  const withBare = cases.find((c) => c.layout.tiles!.includes(EMPTY))!;
  const n = withBare.layout.size;
  const s = stage(circuit, withBare.layout, wide);
  const geo = geometry(n, wide);
  s.tap(centre(geo, n, withBare.layout.tiles!.indexOf(EMPTY)));
  s.tap({ x: 3, y: 3 });
  const tile = withBare.layout.tiles!.findIndex((k) => k !== EMPTY);
  s.drag(centre(geo, n, tile), centre(geo, n, tile + 1));
  expect(s.moves).toEqual([]);
});

test("a cancelled pointer turns nothing", () => {
  const n = small.layout.size;
  const s = stage(circuit, small.layout, phone);
  const geo = geometry(n, phone);
  s.down(centre(geo, n, 0));
  s.cancel();
  s.up(centre(geo, n, 0));
  expect(s.moves).toEqual([]);
});

test("power only crosses where both tiles open onto each other", () => {
  for (const c of cases) {
    const n = c.layout.size;
    const on = lit(c.layout, c.layout.turn!);
    expect(on[c.layout.start]).toBe(true);
    for (let cell = 0; cell < n * n; cell++) {
      if (!on[cell] || cell === c.layout.start) continue;
      const fed = [
        [cell - 1, 4, 1, cell % n > 0],
        [cell + 1, 1, 4, cell % n < n - 1],
        [cell - n, 8, 2, cell >= n],
        [cell + n, 2, 8, cell + n < n * n],
      ].some(
        ([nb, mine, theirs, there]) =>
          there &&
          on[nb as number] &&
          (sidesOf(c.layout, c.layout.turn!, cell) & (mine as number)) !== 0 &&
          (sidesOf(c.layout, c.layout.turn!, nb as number) & (theirs as number)) !== 0,
      );
      expect(fed).toBe(true);
    }
  }
});

test("a thumb can tap every tile, on a phone and at full size", () => {
  for (const c of cases) {
    const size = c.name.endsWith("compact") ? phone : wide;
    const n = c.layout.size;
    const geo = geometry(n, size);
    expect(geo.cell / 2).toBeGreaterThanOrEqual(HIT);
    for (let cell = 0; cell < n * n; cell++) {
      const at = centre(geo, n, cell);
      expect(pick(geo, n, at)).toBe(cell);
      expect(pick(geo, n, { x: at.x + geo.cell / 2 - 1, y: at.y - geo.cell / 2 + 1 })).toBe(cell);
    }
    expect(pick(geo, n, { x: geo.origin.x - 1, y: geo.origin.y + 5 })).toBeUndefined();
  }
});

test("the phone's cap of five tiles a side is kept", () => {
  for (const c of cases.filter((x) => x.name.endsWith("compact")))
    expect(c.layout.size).toBeLessThanOrEqual(5);
});

test("the scene cleans up after itself", () => {
  const s = stage(circuit, small.layout, phone);
  expect(s.surface.children.length).toBe(1);
  s.scene.hint({ at: 0, a: 4 });
  s.frame();
  expect(s.surface.querySelector(".hint")!.getAttribute("opacity")).toBe("1");
  s.scene.destroy();
  expect(s.surface.children.length).toBe(0);
});
