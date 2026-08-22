import { useMotionValue } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

interface UseAnimatedUnderlineArgs<TabId extends string | number> {
  /** Currently active tab id. */
  active: TabId;
  /** Stable list of tab ids in render order — drives index lookups. */
  tabIds: readonly TabId[];
  /** Width of the underline at rest, in px. */
  underlineWidth?: number;
  /** Animation duration for the stretch keyframe, in seconds. */
  duration?: number;
}

interface UseAnimatedUnderlineResult<TabId extends string | number> {
  /** Wraps the row of tabs — measurement happens against this rect. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Per-tab callback that receives the tab's button node so we can
   * read its bounds when the active tab changes. */
  registerTab: (id: TabId) => (node: HTMLButtonElement | null) => void;
  /** Live MotionValues for the underline's `left` / `width` /
   * `opacity` styles. */
  motionStyle: {
    left: ReturnType<typeof useMotionValue<number>>;
    width: ReturnType<typeof useMotionValue<number>>;
    opacity: ReturnType<typeof useMotionValue<number>>;
  };
}

const DEFAULT_WIDTH = 40;
const DEFAULT_DURATION = 0.42;
const STRETCH_EASE = [0.32, 0.72, 0.24, 1] as const;

/**
 * Drives a tab strip's active-underline animation. The underline is a
 * single absolutely-positioned element whose `left` / `width` are
 * separately animated through a stretch keyframe — the bar grows to
 * span the gap between the previous and new tabs, then contracts to
 * the new tab's resting width.
 *
 * Implementation notes that previous iterations got wrong:
 *
 * - The mount-time `placeNoAnim` only runs once (empty deps) so it
 *   never snaps the underline to the new tab's position before the
 *   animation effect has a chance to read the *current* position as
 *   its starting point. Snapping-then-animating produced a visible
 *   double-start flicker.
 * - Resize keeps the bar locked to the active cell without animating
 *   by reading the active id from a ref rather than re-creating
 *   `placeNoAnim` on every render.
 * - Opacity stays at 0 until the first measurement so the bar never
 *   paints in its default `(0, underlineWidth)` initial position.
 */
export function useAnimatedUnderline<TabId extends string | number>({
  active,
  tabIds,
  underlineWidth = DEFAULT_WIDTH,
  duration = DEFAULT_DURATION,
}: UseAnimatedUnderlineArgs<TabId>): UseAnimatedUnderlineResult<TabId> {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<TabId, HTMLButtonElement>>(new Map());
  const left = useMotionValue(0);
  const width = useMotionValue(underlineWidth);
  const opacity = useMotionValue(0);
  const prevActiveRef = useRef<TabId>(active);
  const activeRef = useRef<TabId>(active);
  // Mirror the active id into a ref so `snapToActive`'s identity
  // can stay stable (the callback reads the current active from the
  // ref rather than closing over `active`). Effect, not render-time
  // assignment, so we don't violate the no-write-during-render rule.
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Compute and snap to a tab's resting position (no animation).
  // Reads the active id from `activeRef` so the callback identity
  // can stay stable across renders — that's what keeps the
  // mount/resize layout effect from re-firing when the active tab
  // changes.
  const snapToActive = useCallback(() => {
    const container = containerRef.current;
    const node = nodeRefs.current.get(activeRef.current);
    if (!container || !node) return;
    const cRect = container.getBoundingClientRect();
    const nRect = node.getBoundingClientRect();
    const center = nRect.left - cRect.left + nRect.width / 2;
    left.set(center - underlineWidth / 2);
    width.set(underlineWidth);
    opacity.set(1);
  }, [left, width, opacity, underlineWidth]);

  // Mount + container resize. Empty deps for mount ensure this
  // doesn't fire on active-tab changes and pre-empt the animation.
  useLayoutEffect(() => {
    snapToActive();
    const ro = new ResizeObserver(snapToActive);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [snapToActive]);

  // Active-tab change: stretch then contract from wherever the
  // underline currently sits to the new tab's center. Reads
  // `prevActiveRef` directly (an effect, not render-time) which is
  // safe.
  useEffect(() => {
    const prev = prevActiveRef.current;
    if (prev === active) return;
    prevActiveRef.current = active;

    const container = containerRef.current;
    const prevNode = nodeRefs.current.get(prev);
    const nextNode = nodeRefs.current.get(active);
    if (!container || !prevNode || !nextNode) return;

    const cRect = container.getBoundingClientRect();
    const prevR = prevNode.getBoundingClientRect();
    const nextR = nextNode.getBoundingClientRect();
    const prevCenter = prevR.left - cRect.left + prevR.width / 2;
    const nextCenter = nextR.left - cRect.left + nextR.width / 2;

    const stretchLeft = Math.min(prevCenter, nextCenter) - underlineWidth / 2;
    const stretchWidth = Math.abs(nextCenter - prevCenter) + underlineWidth;
    const finalLeft = nextCenter - underlineWidth / 2;

    const cfg = { duration, ease: STRETCH_EASE };
    const animLeft = animateValue(left, [left.get(), stretchLeft, finalLeft], [0, 0.45, 1], cfg);
    const animWidth = animateValue(
      width,
      [width.get(), stretchWidth, underlineWidth],
      [0, 0.45, 1],
      cfg,
    );
    return () => {
      animLeft?.stop();
      animWidth?.stop();
    };
  }, [active, left, width, underlineWidth, duration]);

  const registerTab = useCallback(
    (id: TabId) => (node: HTMLButtonElement | null) => {
      if (node) nodeRefs.current.set(id, node);
      else nodeRefs.current.delete(id);
    },
    [],
  );

  // Touch tabIds so a re-ordering of the tab list invalidates any
  // cached layout work in the future.
  void tabIds;

  return { containerRef, registerTab, motionStyle: { left, width, opacity } };
}

interface AnimateConfig {
  duration: number;
  ease: readonly [number, number, number, number];
}

function animateValue(
  mv: ReturnType<typeof useMotionValue<number>>,
  values: [number, number, number],
  times: [number, number, number],
  config: AnimateConfig,
) {
  let raf = 0;
  const start = performance.now();
  const totalMs = config.duration * 1000;
  const ease = bezier(...config.ease);
  const step = (now: number) => {
    const elapsed = (now - start) / totalMs;
    if (elapsed >= 1) {
      mv.set(values[2]);
      return;
    }
    const t = ease(elapsed);
    let v: number;
    if (t < times[1]) {
      const sub = t / times[1];
      v = lerp(values[0], values[1], sub);
    } else {
      const sub = (t - times[1]) / (times[2] - times[1]);
      v = lerp(values[1], values[2], sub);
    }
    mv.set(v);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return { stop: () => cancelAnimationFrame(raf) };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const sampleCurveX = (t: number) =>
    3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const sampleCurveY = (t: number) =>
    3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  const sampleDerivativeX = (t: number) =>
    3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const cx = sampleCurveX(t) - x;
      if (Math.abs(cx) < 1e-5) break;
      const dx = sampleDerivativeX(t);
      if (Math.abs(dx) < 1e-6) break;
      t -= cx / dx;
    }
    return sampleCurveY(t);
  };
}
