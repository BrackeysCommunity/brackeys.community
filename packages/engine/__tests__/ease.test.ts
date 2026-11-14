// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { ease, EASE_NAMES, type EaseName } from "../anim/ease";

/** The standard easing curves, written with Math.sin and Math.pow. */
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;
const c5 = (2 * Math.PI) / 4.5;

function bounceOut(x: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x - 1.5 / d1) ** 2 + 0.75;
  if (x < 2.5 / d1) return n1 * (x - 2.25 / d1) ** 2 + 0.9375;
  return n1 * (x - 2.625 / d1) ** 2 + 0.984375;
}

const powerIn = (n: number) => (x: number) => Math.pow(x, n);
const powerOut = (n: number) => (x: number) => 1 - Math.pow(1 - x, n);
const powerInOut = (n: number) => (x: number) =>
  x < 0.5 ? Math.pow(2, n - 1) * Math.pow(x, n) : 1 - Math.pow(-2 * x + 2, n) / 2;

const REFERENCE: Record<EaseName, (x: number) => number> = {
  linear: (x) => x,
  quadIn: powerIn(2),
  quadOut: powerOut(2),
  quadInOut: powerInOut(2),
  cubicIn: powerIn(3),
  cubicOut: powerOut(3),
  cubicInOut: powerInOut(3),
  quartIn: powerIn(4),
  quartOut: powerOut(4),
  quartInOut: powerInOut(4),
  quintIn: powerIn(5),
  quintOut: powerOut(5),
  quintInOut: powerInOut(5),
  sineIn: (x) => 1 - Math.cos((x * Math.PI) / 2),
  sineOut: (x) => Math.sin((x * Math.PI) / 2),
  sineInOut: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  expoIn: (x) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
  expoOut: (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  expoInOut: (x) =>
    x === 0
      ? 0
      : x === 1
        ? 1
        : x < 0.5
          ? Math.pow(2, 20 * x - 10) / 2
          : (2 - Math.pow(2, -20 * x + 10)) / 2,
  circIn: (x) => 1 - Math.sqrt(1 - x * x),
  circOut: (x) => Math.sqrt(1 - (x - 1) * (x - 1)),
  circInOut: (x) =>
    x < 0.5 ? (1 - Math.sqrt(1 - (2 * x) ** 2)) / 2 : (Math.sqrt(1 - (-2 * x + 2) ** 2) + 1) / 2,
  backIn: (x) => c3 * x * x * x - c1 * x * x,
  backOut: (x) => 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2),
  backInOut: (x) =>
    x < 0.5
      ? (Math.pow(2 * x, 2) * ((c2 + 1) * 2 * x - c2)) / 2
      : (Math.pow(2 * x - 2, 2) * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2,
  elasticIn: (x) =>
    x === 0 ? 0 : x === 1 ? 1 : -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * c4),
  elasticOut: (x) =>
    x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1,
  elasticInOut: (x) =>
    x === 0
      ? 0
      : x === 1
        ? 1
        : x < 0.5
          ? -(Math.pow(2, 20 * x - 10) * Math.sin((20 * x - 11.125) * c5)) / 2
          : (Math.pow(2, -20 * x + 10) * Math.sin((20 * x - 11.125) * c5)) / 2 + 1,
  bounceIn: (x) => 1 - bounceOut(1 - x),
  bounceOut,
  bounceInOut: (x) => (x < 0.5 ? (1 - bounceOut(1 - 2 * x)) / 2 : (1 + bounceOut(2 * x - 1)) / 2),
};

const SAMPLES = 1001;
const points = (): number[] => Array.from({ length: SAMPLES }, (_, i) => i / (SAMPLES - 1));

function nonDecreasing(values: readonly number[]): boolean {
  return values.every((v, i) => i === 0 || v >= (values[i - 1] ?? v));
}

describe("ease", () => {
  it("names every family with In, Out and InOut, linear first", () => {
    expect(EASE_NAMES).toHaveLength(31);
    expect(EASE_NAMES[0]).toBe("linear");
    expect(new Set(EASE_NAMES).size).toBe(EASE_NAMES.length);
    expect(Object.keys(REFERENCE).sort()).toEqual([...EASE_NAMES].sort());
  });

  it.each(EASE_NAMES)("%s has exact endpoints", (name) => {
    expect(ease(name, 0)).toBe(0);
    expect(ease(name, 1)).toBe(1);
  });

  it.each(EASE_NAMES)("%s clamps t outside 0–1", (name) => {
    expect(ease(name, -0.5)).toBe(0);
    expect(ease(name, 1.5)).toBe(1);
    expect(ease(name, Number.NaN)).toBe(0);
  });

  it.each(EASE_NAMES)("%s stays within 1e-6 of the reference at 1,001 points", (name) => {
    const reference = REFERENCE[name];
    let worst = 0;
    for (const t of points()) worst = Math.max(worst, Math.abs(ease(name, t) - reference(t)));
    expect(worst).toBeLessThan(1e-6);
  });

  it.each(EASE_NAMES)("%s is monotonic wherever the reference is", (name) => {
    const ts = points();
    if (!nonDecreasing(ts.map(REFERENCE[name]))) return;
    expect(nonDecreasing(ts.map((t) => ease(name, t)))).toBe(true);
  });

  it("finds the overshooting and bouncing eases non-monotonic, and only those", () => {
    const ts = points();
    const wavy = EASE_NAMES.filter((name) => !nonDecreasing(ts.map(REFERENCE[name])));
    expect(wavy.sort()).toEqual(
      [
        "backIn",
        "backInOut",
        "backOut",
        "bounceIn",
        "bounceInOut",
        "bounceOut",
        "elasticIn",
        "elasticInOut",
        "elasticOut",
      ].sort(),
    );
  });

  it("is deterministic: the same input gives the same bits", () => {
    for (const name of EASE_NAMES) {
      for (const t of [0.1, 0.25, 0.333, 0.5, 0.75, 0.999]) {
        expect(Object.is(ease(name, t), ease(name, t))).toBe(true);
      }
    }
  });

  it("uses only + − × ÷ and Math.sqrt", () => {
    const source = readFileSync(fileURLToPath(new URL("../anim/ease.ts", import.meta.url)), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const banned of [
      /Math\.sin\b/,
      /Math\.cos\b/,
      /Math\.pow\b/,
      /Math\.exp\b/,
      /Math\.hypot\b/,
      /\*\*/,
    ]) {
      expect(code).not.toMatch(banned);
    }
    const mathCalls = new Set(code.match(/Math\.\w+/g) ?? []);
    expect([...mathCalls]).toEqual(mathCalls.size ? ["Math.sqrt"] : []);
  });
});
