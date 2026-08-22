import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "framer-motion";
import * as React from "react";

import { useCursorState } from "@/lib/hooks/use-cursor";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { cn } from "@/lib/utils";

const BORDER = 3;
const CORNER = 5;
const CORNER_HOVERED = 8;
const BORDER_HOVERED = 2;
const HOVER_GAP = 3;

// Off a target the frame has no job — the native cursor is drawn, and the
// corners collapse into its tip. Parking all four with their own centers on the
// pointer means `scale: 0` retires them exactly under the arrow's point rather
// than at four spots around it.
const COLLAPSED = -CORNER / 2;

// Trails the pointer; only ever seen through the label and through where the
// corners converge on release, because the corners cancel it exactly (see
// useCornerOffset).
const CURSOR_SPRING = { damping: 26, stiffness: 3000, mass: 0.045 };
// Governs the corners in *viewport* space, so while a latched target holds
// still this spring is parked on a constant and contributes no lag no matter
// how fast the pointer moves. What it still smooths is the target itself
// moving — a chonk button's press/hover lift, scroll — which is the only thing
// it should be smoothing. Overdamped (no overshoot), ~6ms slow pole.
const CORNER_SPRING = { stiffness: 6000, damping: 42, mass: 0.05 };
// The release is what reads as drift: for as long as it runs, the corners are
// still crossing the gap to the tip while the pointer keeps moving, so they
// trail it. A tween's ease-out tail is the worst shape for that — most of its
// time goes to the last few pixels, exactly where the lag is visible. A spring
// front-loads the travel instead. Overdamped (ratio 1.5, no overshoot); the
// slow pole is ~43ms, so it's effectively home in ~130ms rather than 280ms.
// It and CORNER_VANISH are a pair — the corners should land and disappear
// together, not shrink to nothing halfway across.
const CORNER_RELEASE = { type: "spring", stiffness: 900, damping: 45, mass: 0.25 } as const;
const FADE_TRANSITION = { duration: 0.15, ease: "easeInOut" } as const;
// Latching on: the corners are already seated on the target by the time they
// become visible (the first measurement jumps the corner springs there), so
// this is a pop into place, not a flight out from the tip. The overshoot is
// the pop.
const CORNER_APPEAR = { duration: 0.18, ease: [0.34, 1.56, 0.64, 1] } as const;
const CORNER_VANISH = { duration: 0.12, ease: "easeIn" } as const;

const CORNER_BORDERS = [
  { borderTopWidth: 1, borderLeftWidth: 1 },
  { borderTopWidth: 1, borderRightWidth: 1 },
  { borderBottomWidth: 1, borderRightWidth: 1 },
  { borderBottomWidth: 1, borderLeftWidth: 1 },
] as const;

// Sub-pixel idle sway, each corner breathing out along its own diagonal.
const BOUNCE_PX = 0.5;
const BOUNCE_DIR = [
  { dx: 1, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
  { dx: 1, dy: -1 },
] as const;
const BOUNCE_TRANSITION = { duration: 0.5, repeat: Infinity, ease: "backInOut" } as const;

interface CursorProps {
  className?: string;
}

/**
 * One corner's rendered offset inside the cursor container.
 *
 * The corner is stored in viewport coordinates (`abs`) because that is the
 * frame where a hovered button is *stationary* — store it relative to the
 * pointer instead and it becomes a moving target that the corner spring can
 * never catch, which is drift you see as a lag on every mouse move. Cancelling
 * the container's own transform (`base`) here rather than inside the measuring
 * loop also means both are read in the same frame; sampling the spring from a
 * separate rAF is off by exactly one frame of pointer travel.
 *
 * `latch` blends the two resting states: 1 wraps the target, 0 collapses into
 * the pointer tip. Animating it is what plays the release, and because the
 * blend is re-evaluated against a live `base`, the corners keep converging on
 * the tip even while the pointer is still moving.
 */
function useCornerOffset(
  abs: MotionValue<number>,
  base: MotionValue<number>,
  latch: MotionValue<number>,
) {
  return useTransform(
    [abs, base, latch],
    ([a, b, l]: number[]) => COLLAPSED + (a - b - COLLAPSED) * l,
  );
}

export function Cursor({ className }: CursorProps) {
  const cursorState = useCursorState();
  const isMagnetic = cursorState.type === "magnetic";
  const isHidden = cursorState.type === "hidden";
  const bouncePx = cursorState.bounce ?? BOUNCE_PX;

  const isMobile = useIsMobile();

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, CURSOR_SPRING);
  const springY = useSpring(mouseY, CURSOR_SPRING);

  // Viewport coordinates of each corner while latched. Meaningless at latch 0,
  // where the blend ignores them entirely.
  const c0x = useMotionValue(0);
  const c0y = useMotionValue(0);
  const c1x = useMotionValue(0);
  const c1y = useMotionValue(0);
  const c2x = useMotionValue(0);
  const c2y = useMotionValue(0);
  const c3x = useMotionValue(0);
  const c3y = useMotionValue(0);

  const sc0x = useSpring(c0x, CORNER_SPRING);
  const sc0y = useSpring(c0y, CORNER_SPRING);
  const sc1x = useSpring(c1x, CORNER_SPRING);
  const sc1y = useSpring(c1y, CORNER_SPRING);
  const sc2x = useSpring(c2x, CORNER_SPRING);
  const sc2y = useSpring(c2y, CORNER_SPRING);
  const sc3x = useSpring(c3x, CORNER_SPRING);
  const sc3y = useSpring(c3y, CORNER_SPRING);

  const latch = useMotionValue(0);

  // Per-corner visibility while latched. The overlay paints above every
  // stacking context, so a corner can never slide *under* whatever covers its
  // patch of the target (a sticky toolbar band, an open popover) — but it can
  // vanish there, which reads the same because those surfaces are opaque.
  const vis0 = useMotionValue(1);
  const vis1 = useMotionValue(1);
  const vis2 = useMotionValue(1);
  const vis3 = useMotionValue(1);

  const o0x = useCornerOffset(sc0x, springX, latch);
  const o0y = useCornerOffset(sc0y, springY, latch);
  const o1x = useCornerOffset(sc1x, springX, latch);
  const o1y = useCornerOffset(sc1y, springY, latch);
  const o2x = useCornerOffset(sc2x, springX, latch);
  const o2y = useCornerOffset(sc2y, springY, latch);
  const o3x = useCornerOffset(sc3x, springX, latch);
  const o3y = useCornerOffset(sc3y, springY, latch);

  React.useEffect(() => {
    if (isMobile) return;
    const onMove = (e: MouseEvent) => {
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [isMobile, mouseX, mouseY]);

  // Corner tweens that run on release. Tracked so a re-hover mid-flight can
  // cancel them instead of fighting them frame by frame.
  const releaseAnimsRef = React.useRef<AnimationPlaybackControls[]>([]);
  const stopRelease = React.useCallback(() => {
    releaseAnimsRef.current.forEach((a) => a.stop());
    releaseAnimsRef.current = [];
  }, []);
  const wasMagneticRef = React.useRef(false);

  // Off a target the corners collapse into the pointer tip — eased on the way
  // out of a magnetic target, snapped on a cold start (nothing was on screen to
  // animate).
  React.useEffect(() => {
    if (isMagnetic) return;
    stopRelease();

    const releasing = wasMagneticRef.current;
    wasMagneticRef.current = false;

    if (releasing) {
      releaseAnimsRef.current = [animate(latch, 0, CORNER_RELEASE)];
      return;
    }
    latch.set(0);
  }, [isMagnetic, stopRelease, latch]);

  React.useEffect(() => {
    if (isMobile) return;
    if (!isMagnetic || !cursorState.targetElement) return;

    // Re-hovered before the release tween finished — drop it and take the
    // corners back under the spring.
    stopRelease();
    wasMagneticRef.current = true;

    const cs = CORNER_HOVERED;
    const hpx = (cursorState.paddingX ?? 0) / 2;
    const hpy = (cursorState.paddingY ?? 0) / 2;

    const noDrift = cursorState.noDrift ?? false;

    // Ancestors that clip the target (overflow ≠ visible), gathered once per
    // latch. Past one of their edges the target isn't painted at all, and the
    // hit test below can't tell: the fixed bars covering those bands are
    // pointer-events-none shells, so a probe there sails through and lands on
    // a page wrapper — an ancestor of the target, indistinguishable from the
    // rounded-corner case. Geometry answers what hit-testing can't.
    const latched = cursorState.targetElement;
    const clipAncestors: HTMLElement[] = [];
    for (let a = latched.parentElement; a; a = a.parentElement) {
      const s = window.getComputedStyle(a);
      if (s.overflowX !== "visible" || s.overflowY !== "visible") clipAncestors.push(a);
    }

    // Opaque chrome the hit test can't see: the app header and the sticky
    // toolbar bands are (or sit under) pointer-events-none shells, so a probe
    // through their empty stretches lands on the still-painted content behind
    // them and reads as uncovered. Those surfaces declare themselves with
    // `data-cursor-occlude` and get subtracted geometrically instead. A
    // surface wrapping the target doesn't cover it (a toolbar's own
    // controls).
    const occluders = Array.from(
      document.querySelectorAll<HTMLElement>("[data-cursor-occlude]"),
    ).filter((o) => !o.contains(latched));

    // First measurement of a newly latched target: jump the springs onto it
    // rather than letting them fly across the viewport from the previous
    // target. The corners are hidden until CORNER_APPEAR pops them, so they
    // should already be in place when they become visible.
    let seated = false;

    const updateCorners = () => {
      const el = cursorState.targetElement;
      if (!el || !el.isConnected) {
        latch.set(0);
        return;
      }
      const r = el.getBoundingClientRect();

      const g = HOVER_GAP;
      const v0x = r.left - BORDER - hpx - g;
      const v0y = r.top - BORDER - hpy - g;
      const v1x = r.right + BORDER + hpx + g - cs;
      const v1y = r.top - BORDER - hpy - g;
      const v2x = r.right + BORDER + hpx + g - cs;
      const v2y = r.bottom + BORDER + hpy + g - cs;
      const v3x = r.left - BORDER - hpx - g;
      const v3y = r.bottom + BORDER + hpy + g - cs;

      c0x.set(v0x);
      c0y.set(v0y);
      c1x.set(v1x);
      c1y.set(v1y);
      c2x.set(v2x);
      c2y.set(v2y);
      c3x.set(v3x);
      c3y.set(v3y);

      if (noDrift || !seated) {
        sc0x.jump(v0x);
        sc0y.jump(v0y);
        sc1x.jump(v1x);
        sc1y.jump(v1y);
        sc2x.jump(v2x);
        sc2y.jump(v2y);
        sc3x.jump(v3x);
        sc3y.jump(v3y);
      }
      seated = true;
      if (latch.get() !== 1) latch.set(1);

      // Where the target is still painted, occlusion is sampled, not
      // inherited: hit-testing just inside the target's own corner lets the
      // browser report real paint order. Anything on top that isn't the
      // target, inside it, or the ancestor showing through a rounded corner
      // is covering that corner.
      let clipL = 0;
      let clipT = 0;
      let clipR = window.innerWidth - 1;
      let clipB = window.innerHeight - 1;
      for (const a of clipAncestors) {
        const ar = a.getBoundingClientRect();
        if (ar.left > clipL) clipL = ar.left;
        if (ar.top > clipT) clipT = ar.top;
        if (ar.right < clipR) clipR = ar.right;
        if (ar.bottom < clipB) clipB = ar.bottom;
      }
      // Measured per frame: the header rides a transform when it hides, and
      // the corners should come back once it has slid away.
      const occRects = occluders.map((o) => o.getBoundingClientRect());
      // `gx/gy` is the glyph's outermost tip — declared chrome hides a corner
      // the moment any of it would overlap. `tx/ty` is just inside the
      // target's own corner, where the clip box and the hit test have
      // something real to sample.
      const probe = (gx: number, gy: number, tx: number, ty: number, vis: MotionValue<number>) => {
        if (tx < clipL || tx > clipR || ty < clipT || ty > clipB) {
          vis.set(0);
          return;
        }
        for (const or of occRects) {
          if (gx >= or.left && gx <= or.right && gy >= or.top && gy <= or.bottom) {
            vis.set(0);
            return;
          }
        }
        const hit = document.elementFromPoint(tx, ty);
        vis.set(hit !== null && (hit === el || el.contains(hit) || hit.contains(el)) ? 1 : 0);
      };
      const ix = Math.min(2, r.width / 2);
      const iy = Math.min(2, r.height / 2);
      probe(v0x, v0y, r.left + ix, r.top + iy, vis0);
      probe(v1x + cs, v1y, r.right - ix, r.top + iy, vis1);
      probe(v2x + cs, v2y + cs, r.right - ix, r.bottom - iy, vis2);
      probe(v3x, v3y + cs, r.left + ix, r.bottom - iy, vis3);
    };

    updateCorners();

    // Re-measure every frame rather than only when the pointer moves. A
    // chonk button drops by its lift height on press and rises on hover,
    // and both transitions run with the pointer sitting still — sampling on
    // pointer movement alone left the frame floating at the raised position
    // through the whole click. The pointer's own motion needs no sampling at
    // all now: these are viewport coordinates, and useCornerOffset subtracts
    // the container transform at render time.
    let rafId = requestAnimationFrame(function tick() {
      updateCorners();
      rafId = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(rafId);
      // Deliberately no corner reset here: on a release the collapse effect
      // eases the latch to 0 (resetting first would leave that tween nothing
      // to travel), and on a target change the effect re-runs and re-measures
      // them in the same pass.
    };
  }, [
    isMagnetic,
    cursorState.targetElement,
    cursorState.cornerSize,
    cursorState.paddingX,
    cursorState.paddingY,
    cursorState.noDrift,
    isMobile,
    stopRelease,
    latch,
    c0x,
    c0y,
    c1x,
    c1y,
    c2x,
    c2y,
    c3x,
    c3y,
    sc0x,
    sc0y,
    sc1x,
    sc1y,
    sc2x,
    sc2y,
    sc3x,
    sc3y,
    vis0,
    vis1,
    vis2,
    vis3,
  ]);

  if (isMobile || isHidden) return null;

  const corners = [
    { x: o0x, y: o0y, vis: vis0 },
    { x: o1x, y: o1y, vis: vis1 },
    { x: o2x, y: o2y, vis: vis2 },
    { x: o3x, y: o3y, vis: vis3 },
  ];

  return (
    <motion.div
      className={cn("pointer-events-none fixed top-0 left-0 z-9999 h-0 w-0", className)}
      style={{ x: springX, y: springY, willChange: "transform" }}
    >
      {/* Corner brackets */}
      {corners.map((pos, i) => (
        <motion.div
          key={i}
          className="absolute top-0 left-0"
          style={{ opacity: pos.vis }}
          animate={
            isMagnetic
              ? {
                  x: [0, BOUNCE_DIR[i].dx * bouncePx, 0],
                  y: [0, BOUNCE_DIR[i].dy * bouncePx, 0],
                }
              : { x: 0, y: 0 }
          }
          transition={isMagnetic ? BOUNCE_TRANSITION : FADE_TRANSITION}
        >
          <motion.div
            className="absolute top-0 left-0 border-foreground"
            animate={{
              width: isMagnetic ? CORNER_HOVERED : CORNER,
              height: isMagnetic ? CORNER_HOVERED : CORNER,
              borderRadius: 1,
              scale: isMagnetic ? 1 : 0,
              opacity: isMagnetic ? 1 : 0,
              ...Object.fromEntries(
                Object.entries(CORNER_BORDERS[i]).map(([k]) => [
                  k,
                  isMagnetic ? BORDER_HOVERED : BORDER,
                ]),
              ),
            }}
            transition={{
              ...FADE_TRANSITION,
              scale: isMagnetic ? CORNER_APPEAR : CORNER_VANISH,
              opacity: isMagnetic ? CORNER_APPEAR : CORNER_VANISH,
            }}
            style={{
              width: CORNER,
              height: CORNER,
              ...CORNER_BORDERS[i],
              x: pos.x,
              y: pos.y,
              scale: 0,
              opacity: 0,
              willChange: "transform, opacity",
            }}
          />
        </motion.div>
      ))}

      {/* Label */}
      <AnimatePresence>
        {cursorState.label && (
          <motion.span
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            className="absolute text-xs font-medium whitespace-nowrap text-foreground"
            style={{ left: 12, top: 12 }}
          >
            {cursorState.label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
