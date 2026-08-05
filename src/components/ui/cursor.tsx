import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useSpring,
  type AnimationPlaybackControls,
} from "framer-motion";
import * as React from "react";

import { useIsTouchDevice } from "@/hooks/use-touch-device";
import { useCursorState } from "@/lib/hooks/use-cursor";
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

// While the frame wraps a target, its on-screen position is the cursor spring
// plus the corner spring: the corners are measured *relative* to where the
// cursor spring currently is, so whatever the cursor spring has left to travel
// shows up as slack in the frame. Both have to be tight for the frame to sit
// still on the button, which is why these two move together.
const CURSOR_SPRING = { damping: 26, stiffness: 3000, mass: 0.045 };
// Overdamped on purpose (no overshoot); settle time is roughly
// damping/stiffness, so raising stiffness shortens the trail without changing
// its shape. 30/400 = 75ms read as the frame coming loose from the button;
// 42/6000 = 7ms holds the edge. Release is no longer this spring's job —
// see CORNER_RELEASE — so tracking can be stiff without the frame snapping
// home the instant you leave.
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
// Latching on: the corners are already measured onto the target by the time
// they become visible (the corner spring settles in ~7ms), so this is a pop
// into place, not a flight out from the tip. The overshoot is the pop.
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

export function Cursor({ className }: CursorProps) {
  const cursorState = useCursorState();
  const isMagnetic = cursorState.type === "magnetic";
  const isHidden = cursorState.type === "hidden";
  const bouncePx = cursorState.bounce ?? BOUNCE_PX;

  const isMobile = useIsTouchDevice();

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, CURSOR_SPRING);
  const springY = useSpring(mouseY, CURSOR_SPRING);

  const c0x = useMotionValue(COLLAPSED);
  const c0y = useMotionValue(COLLAPSED);
  const c1x = useMotionValue(COLLAPSED);
  const c1y = useMotionValue(COLLAPSED);
  const c2x = useMotionValue(COLLAPSED);
  const c2y = useMotionValue(COLLAPSED);
  const c3x = useMotionValue(COLLAPSED);
  const c3y = useMotionValue(COLLAPSED);

  const sc0x = useSpring(c0x, CORNER_SPRING);
  const sc0y = useSpring(c0y, CORNER_SPRING);
  const sc1x = useSpring(c1x, CORNER_SPRING);
  const sc1y = useSpring(c1y, CORNER_SPRING);
  const sc2x = useSpring(c2x, CORNER_SPRING);
  const sc2y = useSpring(c2y, CORNER_SPRING);
  const sc3x = useSpring(c3x, CORNER_SPRING);
  const sc3y = useSpring(c3y, CORNER_SPRING);

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
  // animate). The tween drives the spring *source*, so the (stiff) corner
  // spring follows it rather than overriding it, and the two never disagree
  // about where the corner is.
  React.useEffect(() => {
    if (isMagnetic) return;
    stopRelease();

    const releasing = wasMagneticRef.current;
    wasMagneticRef.current = false;

    const values = [c0x, c0y, c1x, c1y, c2x, c2y, c3x, c3y];

    if (releasing) {
      releaseAnimsRef.current = values.map((v) => animate(v, COLLAPSED, CORNER_RELEASE));
      return;
    }
    values.forEach((v) => v.set(COLLAPSED));
  }, [isMagnetic, stopRelease, c0x, c0y, c1x, c1y, c2x, c2y, c3x, c3y]);

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

    const collapse = () => {
      const values = [c0x, c0y, c1x, c1y, c2x, c2y, c3x, c3y];
      const springs = [sc0x, sc0y, sc1x, sc1y, sc2x, sc2y, sc3x, sc3y];
      values.forEach((v) => v.set(COLLAPSED));
      springs.forEach((s) => s.jump(COLLAPSED));
    };

    const updateCorners = () => {
      const el = cursorState.targetElement;
      if (!el || !el.isConnected) {
        collapse();
        return;
      }
      const r = el.getBoundingClientRect();
      const cx = springX.get();
      const cy = springY.get();

      const g = HOVER_GAP;
      const v0x = r.left - BORDER - hpx - g - cx;
      const v0y = r.top - BORDER - hpy - g - cy;
      const v1x = r.right + BORDER + hpx + g - cs - cx;
      const v1y = r.top - BORDER - hpy - g - cy;
      const v2x = r.right + BORDER + hpx + g - cs - cx;
      const v2y = r.bottom + BORDER + hpy + g - cs - cy;
      const v3x = r.left - BORDER - hpx - g - cx;
      const v3y = r.bottom + BORDER + hpy + g - cs - cy;

      c0x.set(v0x);
      c0y.set(v0y);
      c1x.set(v1x);
      c1y.set(v1y);
      c2x.set(v2x);
      c2y.set(v2y);
      c3x.set(v3x);
      c3y.set(v3y);

      if (noDrift) {
        sc0x.jump(v0x);
        sc0y.jump(v0y);
        sc1x.jump(v1x);
        sc1y.jump(v1y);
        sc2x.jump(v2x);
        sc2y.jump(v2y);
        sc3x.jump(v3x);
        sc3y.jump(v3y);
      }
    };

    updateCorners();

    // Re-measure every frame rather than only when the pointer moves. A
    // chonk button drops by its lift height on press and rises on hover,
    // and both transitions run with the pointer sitting still — sampling on
    // pointer movement alone left the frame floating at the raised position
    // through the whole click. This also subsumes the spring's own motion,
    // since updateCorners reads springX/springY as it goes.
    let rafId = requestAnimationFrame(function tick() {
      updateCorners();
      rafId = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(rafId);
      // Deliberately no corner reset here: on a release the collapse effect
      // eases them into the tip (resetting first would leave that tween
      // nothing to travel), and on a target change the effect re-runs and
      // re-measures them in the same pass.
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
    springX,
    springY,
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
  ]);

  if (isMobile || isHidden) return null;

  const corners = [
    { x: sc0x, y: sc0y },
    { x: sc1x, y: sc1y },
    { x: sc2x, y: sc2y },
    { x: sc3x, y: sc3y },
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
