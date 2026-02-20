import { AnimatePresence, motion, useAnimation, useMotionValue, useSpring } from 'framer-motion';
import * as React from 'react';
import { useCursorState } from '@/lib/hooks/use-cursor';
import { cn } from '@/lib/utils';

const BORDER = 3;
const CORNER = 12;

const IDLE_POS = [
  { x: -CORNER * 1.5, y: -CORNER * 1.5 }, // TL
  { x: CORNER * 0.5,  y: -CORNER * 1.5 }, // TR
  { x: CORNER * 0.5,  y: CORNER * 0.5  }, // BR
  { x: -CORNER * 1.5, y: CORNER * 0.5  }, // BL
] as const;

const CURSOR_SPRING = { damping: 20, stiffness: 1500, mass: 0.05 };
const CORNER_SPRING = { stiffness: 400, damping: 30, mass: 0.08 };

const CORNER_CLASSES = [
  'border-t-[3px] border-l-[3px]',
  'border-t-[3px] border-r-[3px]',
  'border-b-[3px] border-r-[3px]',
  'border-b-[3px] border-l-[3px]',
] as const;

interface CursorProps {
  className?: string;
  spinDuration?: number;
}

export function Cursor({ className, spinDuration = 3 }: CursorProps) {
  const cursorState = useCursorState();
  const isMagnetic = cursorState.type === 'magnetic';
  const isHidden = cursorState.type === 'hidden';
  const isText = cursorState.type === 'text';

  const [isPressed, setIsPressed] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);

  // Cursor position with spring physics
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, CURSOR_SPRING);
  const springY = useSpring(mouseY, CURSOR_SPRING);

  // Spin animation controller
  const spinControls = useAnimation();
  const isSpinRef = React.useRef(false);
  const spinTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Corner source motion values (raw targets that springs track)
  const c0x = useMotionValue(IDLE_POS[0].x);
  const c0y = useMotionValue(IDLE_POS[0].y);
  const c1x = useMotionValue(IDLE_POS[1].x);
  const c1y = useMotionValue(IDLE_POS[1].y);
  const c2x = useMotionValue(IDLE_POS[2].x);
  const c2y = useMotionValue(IDLE_POS[2].y);
  const c3x = useMotionValue(IDLE_POS[3].x);
  const c3y = useMotionValue(IDLE_POS[3].y);

  // Corner spring outputs — physics on the corners
  const sc0x = useSpring(c0x, CORNER_SPRING);
  const sc0y = useSpring(c0y, CORNER_SPRING);
  const sc1x = useSpring(c1x, CORNER_SPRING);
  const sc1y = useSpring(c1y, CORNER_SPRING);
  const sc2x = useSpring(c2x, CORNER_SPRING);
  const sc2y = useSpring(c2y, CORNER_SPRING);
  const sc3x = useSpring(c3x, CORNER_SPRING);
  const sc3y = useSpring(c3y, CORNER_SPRING);

  React.useEffect(() => {
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
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
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isMobile, mouseX, mouseY]);

  const startSpin = React.useCallback(() => {
    if (isSpinRef.current) return;
    isSpinRef.current = true;
    void spinControls.start({
      rotate: [0, 360],
      transition: { duration: spinDuration, ease: 'linear', repeat: Infinity },
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
      void spinControls.set({ rotate: 0 });
      isSpinRef.current = false;

      const cs = cursorState.cornerSize ?? CORNER;
      const hpx = (cursorState.paddingX ?? 0) / 2;
      const hpy = (cursorState.paddingY ?? 0) / 2;

      const updateCorners = () => {
        const cx = springX.get();
        const cy = springY.get();
        const el = cursorState.targetElement;
        if (!el) return;
        const r = el.getBoundingClientRect();
        c0x.set(r.left   - BORDER - hpx - cx);
        c0y.set(r.top    - BORDER - hpy - cy);
        c1x.set(r.right  + BORDER + hpx - cs - cx);
        c1y.set(r.top    - BORDER - hpy - cy);
        c2x.set(r.right  + BORDER + hpx - cs - cx);
        c2y.set(r.bottom + BORDER + hpy - cs - cy);
        c3x.set(r.left   - BORDER - hpx - cx);
        c3y.set(r.bottom + BORDER + hpy - cs - cy);
      };

      updateCorners();
      const unsubX = springX.on('change', updateCorners);
      const unsubY = springY.on('change', updateCorners);

      return () => {
        unsubX();
        unsubY();
        c0x.set(IDLE_POS[0].x); c0y.set(IDLE_POS[0].y);
        c1x.set(IDLE_POS[1].x); c1y.set(IDLE_POS[1].y);
        c2x.set(IDLE_POS[2].x); c2y.set(IDLE_POS[2].y);
        c3x.set(IDLE_POS[3].x); c3y.set(IDLE_POS[3].y);
        spinTimeoutRef.current = setTimeout(startSpin, 50);
      };
    } else {
      startSpin();
    }
  }, [
    isMagnetic,
    cursorState.targetElement,
    cursorState.cornerSize,
    cursorState.paddingX,
    cursorState.paddingY,
    isMobile,
    startSpin,
    spinControls,
    springX,
    springY,
    c0x, c0y, c1x, c1y, c2x, c2y, c3x, c3y,
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
      className={cn('fixed top-0 left-0 w-0 h-0 pointer-events-none z-9999', className)}
      style={{ x: springX, y: springY, willChange: 'transform' }}
    >
      {/* Center dot */}
      <motion.div
        className="absolute rounded-full bg-foreground"
        style={{ width: 4, height: 4, top: 0, left: 0, x: '-50%', y: '-50%', willChange: 'transform' }}
        animate={{ scale: isPressed ? 0.5 : 1 }}
        transition={{ duration: 0.2 }}
      />

      {/* Text cursor bar */}
      {isText && (
        <div
          className="absolute bg-foreground"
          style={{ width: 2, height: 24, top: 0, left: 0, transform: 'translate(-50%, -50%)' }}
        />
      )}

      {/* Spinning corners wrapper */}
      {!isText && (
        <motion.div
          className="absolute top-0 left-0 w-0 h-0"
          animate={spinControls}
          style={{ willChange: 'transform' }}
        >
          {corners.map((pos, i) => (
            <motion.div
              key={CORNER_CLASSES[i]}
              className={cn('absolute top-0 left-0 border-foreground', CORNER_CLASSES[i])}
              style={{ width: CORNER, height: CORNER, x: pos.x, y: pos.y, willChange: 'transform' }}
            />
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
            className="absolute whitespace-nowrap text-xs font-medium text-foreground"
            style={{ left: 12, top: 12 }}
          >
            {cursorState.label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
