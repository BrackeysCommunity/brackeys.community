import {
  AnimatePresence,
  animate,
  motion,
  useAnimation,
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

const IDLE_GAP = 2;
const IDLE_POS = [
  { x: -CORNER - IDLE_GAP, y: -CORNER - IDLE_GAP },
  { x: IDLE_GAP, y: -CORNER - IDLE_GAP },
  { x: IDLE_GAP, y: IDLE_GAP },
  { x: -CORNER - IDLE_GAP, y: IDLE_GAP },
] as Array<{ x: number; y: number }>;

const PRESSED_POS: Array<{ x: number; y: number }> = [
  { x: -CORNER, y: -CORNER },
  { x: 0, y: -CORNER },
  { x: 0, y: 0 },
  { x: -CORNER, y: 0 },
];

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
// Leaving a target is the one moment the frame should take its time: it
// travels from the button's corners back to the idle cluster at the pointer.
const CORNER_RELEASE = { duration: 0.28, ease: [0.22, 1, 0.36, 1] } as const;
const FADE_TRANSITION = { duration: 0.15, ease: "easeInOut" } as const;

const CORNER_BORDERS = [
  { borderTopWidth: 1, borderLeftWidth: 1 },
  { borderTopWidth: 1, borderRightWidth: 1 },
  { borderBottomWidth: 1, borderRightWidth: 1 },
  { borderBottomWidth: 1, borderLeftWidth: 1 },
] as const;

const BOUNCE_PX = 0.5;
const CORNER_BOUNCE = [
  { dx: BOUNCE_PX, dy: BOUNCE_PX },
  { dx: -BOUNCE_PX, dy: BOUNCE_PX },
  { dx: -BOUNCE_PX, dy: -BOUNCE_PX },
  { dx: BOUNCE_PX, dy: -BOUNCE_PX },
] as const;
const BOUNCE_TRANSITION = { duration: 0.5, repeat: Infinity, ease: "backInOut" } as const;

interface CursorProps {
  className?: string;
  spinDuration?: number;
}

export function Cursor({ className, spinDuration = 3 }: CursorProps) {
  const cursorState = useCursorState();
  const isMagnetic = cursorState.type === "magnetic";
  const isHidden = cursorState.type === "hidden";
  const isText = cursorState.type === "text";

  const [isPressed, setIsPressed] = React.useState(false);
  const isMobile = useIsTouchDevice();

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, CURSOR_SPRING);
  const springY = useSpring(mouseY, CURSOR_SPRING);

  const spinControls = useAnimation();
  const isSpinRef = React.useRef(false);
  const spinTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const c0x = useMotionValue(IDLE_POS[0].x);
  const c0y = useMotionValue(IDLE_POS[0].y);
  const c1x = useMotionValue(IDLE_POS[1].x);
  const c1y = useMotionValue(IDLE_POS[1].y);
  const c2x = useMotionValue(IDLE_POS[2].x);
  const c2y = useMotionValue(IDLE_POS[2].y);
  const c3x = useMotionValue(IDLE_POS[3].x);
  const c3y = useMotionValue(IDLE_POS[3].y);

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
    const onDown = () => setIsPressed(true);
    const onUp = () => setIsPressed(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isMobile, mouseX, mouseY]);

  // Corner tweens that run on release. Tracked so a re-hover (or a press)
  // mid-flight can cancel them instead of fighting them frame by frame.
  const releaseAnimsRef = React.useRef<AnimationPlaybackControls[]>([]);
  const stopRelease = React.useCallback(() => {
    releaseAnimsRef.current.forEach((a) => a.stop());
    releaseAnimsRef.current = [];
  }, []);
  const wasMagneticRef = React.useRef(false);

  // Snap idle corners between normal and pressed positions — except on the way
  // out of a magnetic target, where the corners ease home. The tween drives the
  // spring *source*, so the (stiff) corner spring follows it rather than
  // overriding it, and the two never disagree about where the corner is.
  const idlePressed = isPressed && !isMagnetic;
  React.useEffect(() => {
    if (isMagnetic) return;
    stopRelease();

    const pos = idlePressed ? PRESSED_POS : IDLE_POS;
    const releasing = wasMagneticRef.current && !idlePressed;
    wasMagneticRef.current = false;

    const values = [c0x, c0y, c1x, c1y, c2x, c2y, c3x, c3y];
    const targets = [
      pos[0].x,
      pos[0].y,
      pos[1].x,
      pos[1].y,
      pos[2].x,
      pos[2].y,
      pos[3].x,
      pos[3].y,
    ];

    if (releasing) {
      releaseAnimsRef.current = values.map((v, i) => animate(v, targets[i], CORNER_RELEASE));
      return;
    }
    values.forEach((v, i) => v.set(targets[i]));
  }, [idlePressed, isMagnetic, stopRelease, c0x, c0y, c1x, c1y, c2x, c2y, c3x, c3y]);

  const startSpin = React.useCallback(() => {
    if (isSpinRef.current) return;
    isSpinRef.current = true;
    void spinControls.start({
      rotate: [0, 360],
      transition: { duration: spinDuration, ease: "linear", repeat: Infinity },
    });
  }, [spinControls, spinDuration]);

  React.useEffect(() => {
    if (isMobile) return;

    if (isMagnetic && cursorState.targetElement) {
      // Re-hovered before the release tween finished — drop it and take the
      // corners back under the spring.
      stopRelease();
      wasMagneticRef.current = true;

      if (spinTimeoutRef.current) {
        clearTimeout(spinTimeoutRef.current);
        spinTimeoutRef.current = null;
      }

      spinControls.stop();
      spinControls.set({ rotate: 0 });
      isSpinRef.current = false;

      const cs = CORNER_HOVERED;
      const hpx = (cursorState.paddingX ?? 0) / 2;
      const hpy = (cursorState.paddingY ?? 0) / 2;

      const noDrift = cursorState.noDrift ?? false;

      const jumpToIdle = () => {
        c0x.set(IDLE_POS[0].x);
        c0y.set(IDLE_POS[0].y);
        c1x.set(IDLE_POS[1].x);
        c1y.set(IDLE_POS[1].y);
        c2x.set(IDLE_POS[2].x);
        c2y.set(IDLE_POS[2].y);
        c3x.set(IDLE_POS[3].x);
        c3y.set(IDLE_POS[3].y);
        sc0x.jump(IDLE_POS[0].x);
        sc0y.jump(IDLE_POS[0].y);
        sc1x.jump(IDLE_POS[1].x);
        sc1y.jump(IDLE_POS[1].y);
        sc2x.jump(IDLE_POS[2].x);
        sc2y.jump(IDLE_POS[2].y);
        sc3x.jump(IDLE_POS[3].x);
        sc3y.jump(IDLE_POS[3].y);
      };

      const updateCorners = () => {
        const el = cursorState.targetElement;
        if (!el || !el.isConnected) {
          jumpToIdle();
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
        // Deliberately no corner reset here: on a release the idle effect
        // eases them home (resetting first would leave that tween nothing to
        // travel), and on a target change the branch above re-measures them
        // in the same pass.
        spinTimeoutRef.current = setTimeout(startSpin, 50);
      };
    }
    startSpin();
  }, [
    isMagnetic,
    cursorState.targetElement,
    cursorState.cornerSize,
    cursorState.paddingX,
    cursorState.paddingY,
    cursorState.noDrift,
    isMobile,
    startSpin,
    stopRelease,
    spinControls,
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
      {/* Center dot */}
      <div
        className="absolute rounded-full bg-foreground"
        style={{
          width: 4,
          height: 4,
          top: 0,
          left: 0,
          transform: "translate(-2px, -2px)",
          boxShadow: isMagnetic ? "0 0 0 1.5px var(--background)" : undefined,
        }}
      />

      {/* Text cursor bar */}
      {isText && (
        <div
          className="absolute bg-foreground"
          style={{ width: 2, height: 24, top: 0, left: 0, transform: "translate(-50%, -50%)" }}
        />
      )}

      {/* Corner brackets */}
      {!isText && (
        <motion.div
          className="absolute top-0 left-0 h-0 w-0"
          animate={spinControls}
          style={{ willChange: "transform" }}
        >
          {corners.map((pos, i) => (
            <motion.div
              key={i}
              className="absolute top-0 left-0"
              animate={
                isMagnetic
                  ? { x: [0, CORNER_BOUNCE[i].dx, 0], y: [0, CORNER_BOUNCE[i].dy, 0] }
                  : { x: 0, y: 0 }
              }
              transition={isMagnetic ? BOUNCE_TRANSITION : { duration: 0.15 }}
            >
              <motion.div
                className="absolute top-0 left-0 border-foreground"
                animate={{
                  width: isMagnetic ? CORNER_HOVERED : CORNER,
                  height: isMagnetic ? CORNER_HOVERED : CORNER,
                  borderRadius: isMagnetic ? 1 : idlePressed ? 0 : 1,
                  ...Object.fromEntries(
                    Object.entries(CORNER_BORDERS[i]).map(([k]) => [
                      k,
                      isMagnetic ? BORDER_HOVERED : BORDER,
                    ]),
                  ),
                }}
                transition={FADE_TRANSITION}
                style={{
                  width: CORNER,
                  height: CORNER,
                  ...CORNER_BORDERS[i],
                  x: pos.x,
                  y: pos.y,
                  willChange: "transform",
                }}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

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
