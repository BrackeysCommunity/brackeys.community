import { expect, test } from "vite-plus/test";

import {
  adds,
  amount,
  band,
  bandShort,
  bareNumbers,
  change,
  level,
  outOf,
  percent,
  plural,
  quantity,
  range,
  seconds,
  share,
  signed,
  signedPercent,
  stopwatch,
  ticks,
  uses,
} from "../src/units.ts";

test("a number always carries its unit", () => {
  expect(amount(14, "coin")).toBe("14 coin");
  expect(plural(1, "use")).toBe("1 use");
  expect(plural(3, "use")).toBe("3 uses");
  expect(plural(2, "pouch", "pouches")).toBe("2 pouches");
  expect(outOf(14, 30, "load")).toBe("14 of 30 load");
  expect(uses(12, 60)).toBe("12 of 60 uses");
  expect(level(10)).toBe("level 10");
});

test("thousands take a comma", () => {
  expect(amount(1240, "supply")).toBe("1,240 supply");
  expect(outOf(6900, 10000, "health")).toBe("6,900 of 10,000 health");
});

test("ranges and changes are written out", () => {
  expect(range(30, 38, "pts")).toBe("30 to 38 pts");
  expect(range(30, 30, "pts")).toBe("30 pts");
  expect(change(70, 64, "durability", 90)).toBe("70 to 64 of 90 durability");
  expect(change(64, 64, "durability", 90)).toBe("64 of 90 durability");
  expect(change(3, 5, "uses")).toBe("3 to 5 uses");
});

test("percents and signed changes", () => {
  expect(percent(12)).toBe("12%");
  expect(share(3, "each fill")).toBe("3% of each fill");
  expect(signed(38, "xp")).toBe("+38 xp");
  expect(signed(-8, "durability")).toBe("−8 durability");
  expect(signedPercent(10)).toBe("+10%");
  expect(signedPercent(-15)).toBe("−15%");
});

test("seconds are written 40 s and a running clock never reads early", () => {
  expect(seconds(40_000)).toBe("40 s");
  expect(seconds(39_001)).toBe("40 s");
  expect(seconds(1)).toBe("1 s");
  expect(seconds(0)).toBe("0 s");
  expect(seconds(-500)).toBe("0 s");
  expect(stopwatch(9150)).toBe("9.2 s");
  expect(stopwatch(250)).toBe("0.3 s");
  expect(stopwatch(61_000)).toBe("61.0 s");
});

test("world time names its real time", () => {
  expect(ticks(2)).toBe("2 ticks (20 min)");
  expect(ticks(1)).toBe("1 tick (10 min)");
  expect(ticks(144)).toBe("144 ticks (1,440 min)");
});

test("the world's own units", () => {
  expect(quantity(40, "s")).toBe("40 s");
  expect(quantity(15, "percent")).toBe("15%");
  expect(quantity(1, "days")).toBe("1 world day");
  expect(quantity(2, "count", "beat")).toBe("2 beats");
  expect(quantity(8, "durability")).toBe("8 durability");
  expect(adds(8, "s")).toBe("+8 s");
  expect(adds(-15, "percent")).toBe("−15%");
  expect(adds(34, "pts")).toBe("+34 pts");
});

test("bands by name", () => {
  expect(band("near-certain")).toBe("Near certain (about 9 in 10)");
  expect(band("even")).toBe("Even (about 1 in 2)");
  expect(bandShort("long-shot")).toBe("Long shot");
  expect(band("certain")).toBe("Certain");
});

test("a bare number is found, and a number with its unit is not", () => {
  expect(bareNumbers("Beat 2 of 3 beats.")).toEqual([]);
  expect(bareNumbers("Rewire, level 3")).toEqual([]);
  expect(bareNumbers("48 s left")).toEqual([]);
  expect(bareNumbers("Likely (about 3 in 4), risks 6 durability.")).toEqual([]);
  expect(
    bareNumbers("Holds 3 copper wire, 2 scrap iron.", new Set(["copper wire", "scrap iron"])),
  ).toEqual([]);
  expect(bareNumbers("Shut for 96 ticks (960 min)")).toEqual([]);
  expect(bareNumbers("+10% and 1,240 of 2,000 threat")).toEqual([]);
  expect(bareNumbers("You have 5 left")).toEqual(["5"]);
  expect(bareNumbers("Wire 3")).toEqual(["3"]);
});
