import { useEffect, useState } from "react";

import { useReducedMotion } from "@/lib/hooks/use-app-settings";

import type { SpinResult } from "../sim/spin.ts";
import { ROTOR_SPEEDS, TICKS_PER_SECOND } from "../sim/state.ts";
import { ANGLE_UNITS } from "../sim/wheel.ts";
import { type BallFrame, durationTicks, frameAt } from "./playback.ts";

/**
 * Drives a spin's animation off the trace the sim already produced.
 *
 * The clock is the only thing here that is not deterministic, and it is
 * deliberately kept out of the sim: this reads `performance.now` to decide
 * *when* to draw a frame the sim decided long ago. Nothing it computes feeds
 * back into an outcome, which is why the determinism guard does not cover
 * this directory.
 *
 * With reduced motion on it shows the settled wheel immediately rather than
 * animating. That is the house rule and also the honest one — a spin the
 * player has asked not to watch should not cost them eight seconds.
 */
export function useSpinPlayback(result: SpinResult | null): {
  balls: BallFrame[];
  rotorAngle: number;
  running: boolean;
  tick: number;
} {
  // The tick is stored beside the result it belongs to. A new spin is
  // therefore at tick zero from the first render, without an effect having
  // to reset it — which is what keeps this free of a synchronous setState
  // in an effect body and free of a frame of the previous spin's ending.
  const [frame, setFrame] = useState<{ result: SpinResult | null; tick: number }>({
    result: null,
    tick: 0,
  });
  const reduced = useReducedMotion();

  const total = result ? Math.max(...result.balls.map(durationTicks)) : 0;

  useEffect(() => {
    if (!result || reduced) return;
    let raf = 0;
    const started = performance.now();
    const step = () => {
      const elapsed = ((performance.now() - started) * TICKS_PER_SECOND) / 1000;
      setFrame({ result, tick: Math.min(elapsed, total) });
      if (elapsed < total) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [result, total, reduced]);

  const tick = !result ? 0 : reduced ? total : frame.result === result ? frame.tick : 0;
  const balls = result ? result.balls.map((trace) => frameAt(trace, tick)) : [];

  // The rotor turns for the whole spin at the standard rate. The trace does
  // not carry the wheel's own speed, and a bought rotor drawing slightly out
  // of step is not something anyone can see.
  const rotorAngle = (tick * ROTOR_SPEEDS.standard) % ANGLE_UNITS;

  return { balls, rotorAngle, running: Boolean(result) && !reduced && tick < total, tick };
}
