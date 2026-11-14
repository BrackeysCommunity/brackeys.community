/**
 * Named eases over t in 0–1. The names and their schema live with the tween
 * spec in `game/behaviors/tween.ts`, which the hosted service reads; the
 * functions use only `+ − × ÷` and `Math.sqrt`, so every JS engine rounds
 * them alike and a tweened run replays anywhere. Sine and powers of two are
 * series evaluated after an exact range reduction, accurate well within 1e-6.
 */
export { EASE_NAMES, type EaseName } from "../game/behaviors/tween";
import type { EaseName } from "../game/behaviors/tween";

type FamilyOf<N> = N extends `${infer F}In` ? F : never;
type EaseFamily = FamilyOf<EaseName>;

const TAU = 6.283185307179586;
const LN2 = 0.6931471805599453;
const BACK = 1.70158;
const BACK_IN_OUT = BACK * 1.525;
const ELASTIC_PERIOD = 3;
const ELASTIC_IN_OUT_PERIOD = 4.5;
const BOUNCE_N = 7.5625;
const BOUNCE_D = 2.75;

/** sin(2π·u). The reduction to a quarter turn is exact; the series' error is below 1e-11. */
function sinTurns(u: number): number {
  while (u > 0.5) u -= 1;
  while (u < -0.5) u += 1;
  if (u > 0.25) u = 0.5 - u;
  else if (u < -0.25) u = -0.5 - u;
  const x = u * TAU;
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let k = 1; k <= 8; k++) {
    term = (term * -x2) / (2 * k * (2 * k + 1));
    sum += term;
  }
  return sum;
}

function cosTurns(u: number): number {
  return sinTurns(u + 0.25);
}

/** 2^x for x ≤ 0: whole halvings by repeated multiplication, the rest by e^y's series. */
function pow2(x: number): number {
  let scale = 1;
  while (x < -0.5) {
    x += 1;
    scale *= 0.5;
  }
  const y = x * LN2;
  let term = 1;
  let sum = 1;
  for (let k = 1; k <= 12; k++) {
    term = (term * y) / k;
    sum += term;
  }
  return sum * scale;
}

function bounceOut(t: number): number {
  if (t < 1 / BOUNCE_D) return BOUNCE_N * t * t;
  if (t < 2 / BOUNCE_D) {
    const u = t - 1.5 / BOUNCE_D;
    return BOUNCE_N * u * u + 0.75;
  }
  if (t < 2.5 / BOUNCE_D) {
    const u = t - 2.25 / BOUNCE_D;
    return BOUNCE_N * u * u + 0.9375;
  }
  const u = t - 2.625 / BOUNCE_D;
  return BOUNCE_N * u * u + 0.984375;
}

/** A family's `In` curve; `Out` and `InOut` mirror it. */
function easeIn(family: EaseFamily, t: number): number {
  switch (family) {
    case "quad":
      return t * t;
    case "cubic":
      return t * t * t;
    case "quart":
      return t * t * t * t;
    case "quint":
      return t * t * t * t * t;
    case "sine":
      return 1 - cosTurns(t / 4);
    case "expo":
      return pow2(10 * t - 10);
    case "circ":
      return 1 - Math.sqrt(1 - t * t);
    case "back":
      return (BACK + 1) * t * t * t - BACK * t * t;
    case "elastic":
      return -pow2(10 * t - 10) * sinTurns((10 * t - 10.75) / ELASTIC_PERIOD);
    case "bounce":
      return 1 - bounceOut(1 - t);
    default: {
      const unknown: never = family;
      throw new Error(`Unknown ease family "${String(unknown)}"`);
    }
  }
}

/** `back` and `elastic` overshoot differently when played both ways. */
function easeInOut(family: EaseFamily, t: number): number {
  if (family === "back") {
    const u = 2 * t;
    if (t < 0.5) return (u * u * ((BACK_IN_OUT + 1) * u - BACK_IN_OUT)) / 2;
    const v = u - 2;
    return (v * v * ((BACK_IN_OUT + 1) * v + BACK_IN_OUT) + 2) / 2;
  }
  if (family === "elastic") {
    const wave = sinTurns((20 * t - 11.125) / ELASTIC_IN_OUT_PERIOD);
    if (t < 0.5) return -(pow2(20 * t - 10) * wave) / 2;
    return (pow2(10 - 20 * t) * wave) / 2 + 1;
  }
  return t < 0.5 ? easeIn(family, 2 * t) / 2 : 1 - easeIn(family, 2 - 2 * t) / 2;
}

/**
 * The eased value of `t` under `name`. `t` is clamped to 0–1, and the ends
 * are exact: every ease gives 0 at 0 and 1 at 1.
 */
export function ease(name: EaseName, t: number): number {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  if (name === "linear") return t;
  if (name.endsWith("InOut")) return easeInOut(name.slice(0, -5) as EaseFamily, t);
  if (name.endsWith("Out")) return 1 - easeIn(name.slice(0, -3) as EaseFamily, 1 - t);
  return easeIn(name.slice(0, -2) as EaseFamily, t);
}
