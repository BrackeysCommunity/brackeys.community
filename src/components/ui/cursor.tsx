import { AnimatePresence, motion, useAnimation, useMotionValue, useSpring } from "framer-motion";
import * as React from "react";

import { useCursorState } from "@/lib/hooks/use-cursor";
import { cn } from "@/lib/utils";

const BORDER = 3;
const CORNER = 12;
const CORNER_HOVERED = 8;
const BORDER_HOVERED = 2;
const ARC_RADIUS = 14;
const ARC_STROKE = 3;
const ARC_GAP = 40;
const ARC_SWEEP = 90 - ARC_GAP;

const IDLE_POS = [
  { x: -CORNER * 1.5, y: -CORNER * 1.5 },
  { x: CORNER * 0.5, y: -CORNER * 1.5 },
  { x: CORNER * 0.5, y: CORNER * 0.5 },
  { x: -CORNER * 1.5, y: CORNER * 0.5 },
] as const;

const CURSOR_SPRING = { damping: 20, stiffness: 1500, mass: 0.05 };
const CORNER_SPRING = { stiffness: 400, damping: 30, mass: 0.08 };
const FADE_TRANSITION = { duration: 0.15, ease: "easeInOut" } as const;
const ARC_SPRING = { type: "spring", stiffness: 500, damping: 25, mass: 0.08 } as const;

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

const toRad = (deg: number) => (deg * Math.PI) / 180;

function bezierArc(r: number, startDeg: number, endDeg: number, controlRadius: number) {
  const midDeg = (startDeg + endDeg) / 2;
  const x1 = r * Math.cos(toRad(startDeg));
  const y1 = r * Math.sin(toRad(startDeg));
  const x2 = r * Math.cos(toRad(endDeg));
  const y2 = r * Math.sin(toRad(endDeg));
  const cx = controlRadius * Math.cos(toRad(midDeg));
  const cy = controlRadius * Math.sin(toRad(midDeg));
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const halfGap = ARC_GAP / 2;
const arcAngles = [
  [225 + halfGap, 225 + halfGap + ARC_SWEEP],
  [315 + halfGap, 315 + halfGap + ARC_SWEEP],
  [45 + halfGap, 45 + halfGap + ARC_SWEEP],
  [135 + halfGap, 135 + halfGap + ARC_SWEEP],
] as const;

const halfSweepRad = toRad(ARC_SWEEP / 2);
const outwardControlR = ARC_RADIUS / Math.cos(halfSweepRad);
const inwardControlR = ARC_RADIUS * Math.cos(halfSweepRad) * 0.55;

const ARC_NORMAL = arcAngles.map(([s, e]) => bezierArc(ARC_RADIUS, s, e, outwardControlR));
const ARC_PRESSED = arcAngles.map(([s, e]) => bezierArc(ARC_RADIUS, s, e, inwardControlR));

const svgSize = ARC_RADIUS * 2 + ARC_STROKE;
const svgHalf = ARC_RADIUS + ARC_STROKE / 2;

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
  const [isMobile, setIsMobile] = React.useState(false);

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
    const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    setIsMobile(hasTouch && window.innerWidth <= 768);
  }, []);

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
      if (spinTimeoutRef.current) {
        clearTimeout(spinTimeoutRef.current);
        spinTimeoutRef.current = null;
      }

      spinControls.stop();
      spinControls.set({ rotate: 0 });
      isSpinRef.current = false;

      const cs = cursorState.cornerSize ?? CORNER;
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

        const v0x = r.left - BORDER - hpx - cx;
        const v0y = r.top - BORDER - hpy - cy;
        const v1x = r.right + BORDER + hpx - cs - cx;
        const v1y = r.top - BORDER - hpy - cy;
        const v2x = r.right + BORDER + hpx - cs - cx;
        const v2y = r.bottom + BORDER + hpy - cs - cy;
        const v3x = r.left - BORDER - hpx - cx;
        const v3y = r.bottom + BORDER + hpy - cs - cy;

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

      let rafId: number;
      if (noDrift) {
        const tick = () => {
          updateCorners();
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      }

      const unsubX = springX.on("change", updateCorners);
      const unsubY = springY.on("change", updateCorners);

      return () => {
        unsubX();
        unsubY();
        if (noDrift) cancelAnimationFrame(rafId);
        c0x.set(IDLE_POS[0].x);
        c0y.set(IDLE_POS[0].y);
        c1x.set(IDLE_POS[1].x);
        c1y.set(IDLE_POS[1].y);
        c2x.set(IDLE_POS[2].x);
        c2y.set(IDLE_POS[2].y);
        c3x.set(IDLE_POS[3].x);
        c3y.set(IDLE_POS[3].y);
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

  const idlePressed = isPressed && !isMagnetic;

  return (
    <motion.div
      className={cn("pointer-events-none fixed top-0 left-0 z-9999 h-0 w-0", className)}
      style={{ x: springX, y: springY, willChange: "transform" }}
    >
      {/* Center dot */}
      <motion.div
        className="absolute rounded-full bg-foreground"
        style={{ width: 4, height: 4, top: 0, left: 0, x: -2, y: -2, willChange: "transform" }}
        animate={{ scale: idlePressed ? 0.5 : 1 }}
        transition={{ duration: 0.2 }}
      />

      {/* Text cursor bar */}
      {isText && (
        <div
          className="absolute bg-foreground"
          style={{ width: 2, height: 24, top: 0, left: 0, transform: "translate(-50%, -50%)" }}
        />
      )}

      {/* Spinning shape wrapper */}
      {!isText && (
        <motion.div
          className="absolute top-0 left-0 h-0 w-0"
          animate={{ x: 0, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            className="absolute top-0 left-0 h-0 w-0"
            animate={spinControls}
            style={{ willChange: "transform" }}
          >
            {/* Square corner brackets — visible when magnetic */}
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
                    opacity: isMagnetic ? 1 : 0,
                    width: isMagnetic ? CORNER_HOVERED : CORNER,
                    height: isMagnetic ? CORNER_HOVERED : CORNER,
                    borderRadius: isMagnetic ? 1 : 3,
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

            {/* Broken circle arcs — bezier curves that bend inward on press */}
            <motion.svg
              aria-hidden="true"
              width={svgSize}
              height={svgSize}
              viewBox={`${-svgHalf} ${-svgHalf} ${svgSize} ${svgSize}`}
              className="absolute top-0 left-0"
              style={{ x: -svgHalf, y: -svgHalf }}
              animate={{ opacity: isMagnetic ? 0 : 1 }}
              transition={FADE_TRANSITION}
            >
              {arcAngles.map((_, i) => (
                <motion.path
                  key={ARC_NORMAL[i]}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={ARC_STROKE}
                  strokeLinecap="round"
                  className="text-foreground"
                  animate={{
                    d: idlePressed ? ARC_PRESSED[i] : ARC_NORMAL[i],
                    strokeWidth: idlePressed ? 2 : ARC_STROKE,
                  }}
                  transition={ARC_SPRING}
                />
              ))}
            </motion.svg>
          </motion.div>
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
