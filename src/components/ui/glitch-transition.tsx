import { memo, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type GlitchTrigger = "mount" | "manual" | "change" | "hover" | "continuous";

interface GlitchTransitionProps {
  children: React.ReactNode;
  /** When to play the glitch. */
  trigger?: GlitchTrigger;
  /** Controls the glitch when `trigger="manual"`. Also force-plays when toggled true. */
  active?: boolean;
  /** When `trigger="change"`, replays the glitch whenever this value changes. */
  triggerKey?: string | number | boolean | null;
  /** Animation duration in seconds (ignored for `continuous`). */
  duration?: number;
  /** Overall visual intensity, 0-1. Scales displacement, skew, rgb split. */
  intensity?: number;
  /** Max pixel jitter on each axis. Defaults scale off `intensity`. */
  displacement?: number;
  /** Max skew in degrees. */
  skew?: number;
  /** RGB-channel split distance in px. */
  rgbSplit?: number;
  /** Channel A tint (drop-shadow). Defaults to magenta. */
  colorA?: string;
  /** Channel B tint (drop-shadow). Defaults to cyan. */
  colorB?: string;
  /** Show CRT scanline overlay during the glitch. */
  scanlines?: boolean;
  /** Flicker opacity during the glitch. */
  flicker?: boolean;
  /** Fires when the glitch animation completes (not emitted for `continuous`). */
  onGlitchEnd?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

const STYLE_ID = "brackeys-glitch-transition-styles";

const GLITCH_CSS = `
@keyframes bk-gt-jitter {
  0%,100% { transform: translate3d(0,0,0) skewX(0) scale(1,1); }
  6%  { transform: translate3d(calc(var(--bk-gt-dx) * -1), calc(var(--bk-gt-dy) * 0.5), 0) skewX(calc(var(--bk-gt-sk) * -1deg)) scale(1.018, 0.985); }
  14% { transform: translate3d(var(--bk-gt-dx), calc(var(--bk-gt-dy) * -1), 0) skewX(calc(var(--bk-gt-sk) * 1deg)) scale(0.99, 1.015); }
  22% { transform: translate3d(0, 0, 0) skewX(calc(var(--bk-gt-sk) * -0.6deg)) scale(1.012, 1); }
  30% { transform: translate3d(calc(var(--bk-gt-dx) * -0.5), var(--bk-gt-dy), 0) skewX(calc(var(--bk-gt-sk) * 0.7deg)) scale(0.992, 1.008); }
  40% { transform: translate3d(var(--bk-gt-dx), 0, 0) skewX(calc(var(--bk-gt-sk) * -0.9deg)) scale(1.02, 0.98); }
  50% { transform: translate3d(0, calc(var(--bk-gt-dy) * -0.5), 0) skewX(0) scale(1, 1); }
  60% { transform: translate3d(calc(var(--bk-gt-dx) * -0.8), 0, 0) skewX(calc(var(--bk-gt-sk) * 0.5deg)) scale(1.015, 0.99); }
  72% { transform: translate3d(calc(var(--bk-gt-dx) * 0.4), calc(var(--bk-gt-dy) * 0.6), 0) skewX(calc(var(--bk-gt-sk) * -0.4deg)) scale(0.995, 1.01); }
  82% { transform: translate3d(calc(var(--bk-gt-dx) * -0.3), 0, 0) skewX(0) scale(1.008, 0.996); }
  92% { transform: translate3d(calc(var(--bk-gt-dx) * 0.2), 0, 0) skewX(0) scale(1, 1); }
}
@keyframes bk-gt-flicker {
  0%,100% { opacity: 1; }
  10% { opacity: .82; }
  22% { opacity: 1; }
  33% { opacity: .6; }
  41% { opacity: 1; }
  56% { opacity: .9; }
  68% { opacity: .45; }
  80% { opacity: 1; }
}
@keyframes bk-gt-slice-a {
  0%,100% { clip-path: inset(0 0 0 0); transform: translate3d(0,0,0); }
  6%  { clip-path: inset(8% 0 78% 0);  transform: translate3d(var(--bk-gt-rgb),0,0); }
  13% { clip-path: inset(72% 0 8% 0);  transform: translate3d(calc(var(--bk-gt-rgb) * -1.2),0,0); }
  20% { clip-path: inset(35% 0 55% 0); transform: translate3d(calc(var(--bk-gt-rgb) * 0.9),0,0); }
  27% { clip-path: inset(82% 0 6% 0);  transform: translate3d(calc(var(--bk-gt-rgb) * -0.7),0,0); }
  34% { clip-path: inset(18% 0 68% 0); transform: translate3d(var(--bk-gt-rgb),0,0); }
  41% { clip-path: inset(55% 0 30% 0); transform: translate3d(calc(var(--bk-gt-rgb) * -1),0,0); }
  48% { clip-path: inset(4% 0 85% 0);  transform: translate3d(calc(var(--bk-gt-rgb) * 1.3),0,0); }
  55% { clip-path: inset(45% 0 35% 0); transform: translate3d(calc(var(--bk-gt-rgb) * -0.8),0,0); }
  62% { clip-path: inset(68% 0 18% 0); transform: translate3d(var(--bk-gt-rgb),0,0); }
  70% { clip-path: inset(22% 0 62% 0); transform: translate3d(calc(var(--bk-gt-rgb) * -1.1),0,0); }
  78% { clip-path: inset(80% 0 8% 0);  transform: translate3d(var(--bk-gt-rgb),0,0); }
  86% { clip-path: inset(12% 0 74% 0); transform: translate3d(calc(var(--bk-gt-rgb) * -0.9),0,0); }
  94% { clip-path: inset(50% 0 40% 0); transform: translate3d(var(--bk-gt-rgb),0,0); }
}
@keyframes bk-gt-slice-b {
  0%,100% { clip-path: inset(0 0 0 0); transform: translate3d(0,0,0); }
  6%  { clip-path: inset(62% 0 22% 0); transform: translate3d(calc(var(--bk-gt-rgb) * -1),0,0); }
  13% { clip-path: inset(14% 0 72% 0); transform: translate3d(var(--bk-gt-rgb),0,0); }
  20% { clip-path: inset(70% 0 15% 0); transform: translate3d(calc(var(--bk-gt-rgb) * -1.2),0,0); }
  27% { clip-path: inset(28% 0 55% 0); transform: translate3d(calc(var(--bk-gt-rgb) * 0.8),0,0); }
  34% { clip-path: inset(85% 0 4% 0);  transform: translate3d(calc(var(--bk-gt-rgb) * -1),0,0); }
  41% { clip-path: inset(6% 0 80% 0);  transform: translate3d(var(--bk-gt-rgb),0,0); }
  48% { clip-path: inset(42% 0 42% 0); transform: translate3d(calc(var(--bk-gt-rgb) * -1.1),0,0); }
  55% { clip-path: inset(66% 0 22% 0); transform: translate3d(var(--bk-gt-rgb),0,0); }
  62% { clip-path: inset(10% 0 74% 0); transform: translate3d(calc(var(--bk-gt-rgb) * -1),0,0); }
  70% { clip-path: inset(58% 0 28% 0); transform: translate3d(var(--bk-gt-rgb),0,0); }
  78% { clip-path: inset(24% 0 62% 0); transform: translate3d(calc(var(--bk-gt-rgb) * -1.2),0,0); }
  86% { clip-path: inset(76% 0 12% 0); transform: translate3d(var(--bk-gt-rgb),0,0); }
  94% { clip-path: inset(38% 0 48% 0); transform: translate3d(calc(var(--bk-gt-rgb) * -0.9),0,0); }
}
@keyframes bk-gt-scanlines {
  0% { background-position: 0 0; }
  100% { background-position: 0 var(--bk-gt-scan-step, 6px); }
}
.bk-gt-root {
  position: relative;
  isolation: isolate;
  width: fit-content;
  max-width: 100%;
  align-self: start;
  justify-self: start;
}
.bk-gt-root[data-glitch="on"] {
  animation:
    bk-gt-jitter var(--bk-gt-dur) steps(12,end) var(--bk-gt-iter,1) both,
    bk-gt-flicker var(--bk-gt-dur) steps(20,end) var(--bk-gt-iter,1) both;
  will-change: transform, opacity;
}
.bk-gt-root[data-glitch="on"][data-flicker="off"] { animation: bk-gt-jitter var(--bk-gt-dur) steps(12,end) var(--bk-gt-iter,1) both; }
.bk-gt-layer {
  position: absolute; inset: 0;
  pointer-events: none;
  mix-blend-mode: screen;
  will-change: transform, clip-path;
}
.bk-gt-layer-a { animation: bk-gt-slice-a var(--bk-gt-dur) steps(20,end) var(--bk-gt-iter,1) both; filter: drop-shadow(0 0 0 var(--bk-gt-color-a)); }
.bk-gt-layer-b { animation: bk-gt-slice-b var(--bk-gt-dur) steps(20,end) var(--bk-gt-iter,1) both; filter: drop-shadow(0 0 0 var(--bk-gt-color-b)); }
.bk-gt-scanlines {
  position: absolute; inset: 0;
  pointer-events: none;
  background-image: repeating-linear-gradient(
    to bottom,
    rgba(255,255,255,0.06) 0px,
    rgba(255,255,255,0.06) 1px,
    transparent 1px,
    transparent 3px
  );
  mix-blend-mode: overlay;
  animation: bk-gt-scanlines 1.2s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .bk-gt-root[data-glitch="on"],
  .bk-gt-root[data-glitch="on"] .bk-gt-layer,
  .bk-gt-scanlines { animation: none !important; }
  .bk-gt-layer { display: none; }
}
`;

let styleInjected = false;
function useGlitchStyles() {
  useEffect(() => {
    if (styleInjected || typeof document === "undefined") return;
    if (document.getElementById(STYLE_ID)) {
      styleInjected = true;
      return;
    }
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = GLITCH_CSS;
    document.head.appendChild(el);
    styleInjected = true;
  }, []);
}

const GlitchTransition = memo(function GlitchTransition({
  children,
  trigger = "mount",
  active,
  triggerKey,
  duration = 0.6,
  intensity = 1,
  displacement,
  skew,
  rgbSplit,
  colorA = "#ff00d4",
  colorB = "#00e5ff",
  scanlines = false,
  flicker = true,
  onGlitchEnd,
  className,
  style,
}: GlitchTransitionProps) {
  useGlitchStyles();

  const [isGlitching, setIsGlitching] = useState(
    trigger === "mount" || trigger === "continuous",
  );
  const endedRef = useRef<() => void>(() => {});
  endedRef.current = onGlitchEnd ?? (() => {});

  // Buffered children so `trigger="change"` can defer the content swap
  // until mid-glitch — old content glitches out, new content glitches in.
  const [displayedChildren, setDisplayedChildren] = useState(children);
  const latestChildrenRef = useRef(children);
  latestChildrenRef.current = children;

  // Keep buffered children in sync when we're NOT orchestrating a change.
  useEffect(() => {
    if (trigger !== "change") setDisplayedChildren(children);
  }, [trigger, children]);

  // Forces a CSS animation restart without remounting children.
  const restart = useCallback(() => {
    setIsGlitching(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setIsGlitching(true));
    });
  }, []);

  // Mount / continuous
  useEffect(() => {
    if (trigger === "mount" || trigger === "continuous") {
      setIsGlitching(true);
    }
  }, [trigger]);

  // Replay when triggerKey changes and defer the content swap.
  const firstChangeRun = useRef(true);
  useEffect(() => {
    if (trigger !== "change") return;
    if (firstChangeRun.current) {
      firstChangeRun.current = false;
      setDisplayedChildren(latestChildrenRef.current);
      setIsGlitching(true);
      return;
    }
    restart();
    // Swap content ~55% of the way through — heavy glitch covers the transition,
    // new content still gets the tail of the animation.
    const swapMs = Math.max(0, duration * 1000 * 0.55);
    const timer = window.setTimeout(() => {
      setDisplayedChildren(latestChildrenRef.current);
    }, swapMs);
    return () => window.clearTimeout(timer);
  }, [trigger, triggerKey, duration, restart]);

  // Manual control
  useEffect(() => {
    if (trigger !== "manual") return;
    if (active) restart();
    else setIsGlitching(false);
  }, [trigger, active, restart]);

  const handleHoverEnter = useCallback(() => {
    if (trigger !== "hover") return;
    restart();
  }, [trigger, restart]);

  const handleAnimationEnd = useCallback(
    (e: React.AnimationEvent<HTMLDivElement>) => {
      if (trigger === "continuous") return;
      if (e.target !== e.currentTarget) return;
      if (e.animationName !== "bk-gt-jitter") return;
      setIsGlitching(false);
      endedRef.current();
    },
    [trigger],
  );

  const i = Math.max(0, Math.min(1, intensity));
  // Tuned so the frame shakes aggressively in place rather than sliding around;
  // the streaking/RGB-band effect does most of the visual work.
  const dx = displacement ?? 1.5 * i;
  const dy = displacement ?? 1 * i;
  const sk = skew ?? 3 * i;
  const rgb = rgbSplit ?? 7 * i;
  const iter = trigger === "continuous" ? "infinite" : 1;

  const rootStyle: React.CSSProperties = {
    ...style,
    ["--bk-gt-dur" as string]: `${duration}s`,
    ["--bk-gt-dx" as string]: `${dx}px`,
    ["--bk-gt-dy" as string]: `${dy}px`,
    ["--bk-gt-sk" as string]: `${sk}`,
    ["--bk-gt-rgb" as string]: `${rgb}px`,
    ["--bk-gt-color-a" as string]: colorA,
    ["--bk-gt-color-b" as string]: colorB,
    ["--bk-gt-iter" as string]: iter,
  };

  const showLayers = isGlitching && rgb > 0;

  return (
    <div
      className={cn("bk-gt-root", className)}
      data-glitch={isGlitching ? "on" : "off"}
      data-flicker={flicker ? "on" : "off"}
      style={rootStyle}
      onAnimationEnd={handleAnimationEnd}
      onPointerEnter={handleHoverEnter}
    >
      {displayedChildren}
      {showLayers && (
        <>
          <div className="bk-gt-layer bk-gt-layer-a" aria-hidden="true">
            {displayedChildren}
          </div>
          <div className="bk-gt-layer bk-gt-layer-b" aria-hidden="true">
            {displayedChildren}
          </div>
        </>
      )}
      {isGlitching && scanlines && (
        <div className="bk-gt-scanlines" aria-hidden="true" />
      )}
    </div>
  );
});

export default GlitchTransition;
export { GlitchTransition };
export type { GlitchTransitionProps, GlitchTrigger };
