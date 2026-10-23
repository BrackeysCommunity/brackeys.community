import { useStore } from "@tanstack/react-store";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import {
  SPOTLIGHT_ATTR,
  SPOTLIGHT_KEEP_ATTR,
  type SpotlightTarget,
  spotlightStore,
} from "@/components/announcements/spotlight";

/** Breathing room between an element and the edge of its hole. */
const PAD = 4;

interface Hole {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

interface Frame {
  target: Hole;
  keep: Hole[];
}

function holeFor(el: Element): Hole | null {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  // Off-screen counts as absent: a hidden header is translated above the
  // viewport, and dimming the page around nothing reads as a glitch.
  if (r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) {
    return null;
  }
  const radius = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  return {
    x: r.left - PAD,
    y: r.top - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
    radius: radius + PAD,
  };
}

function measure(target: SpotlightTarget): Frame | null {
  let hole: Hole | null = null;
  for (const el of document.querySelectorAll(`[${SPOTLIGHT_ATTR}="${target}"]`)) {
    hole = holeFor(el);
    if (hole) break;
  }
  if (!hole) return null;
  const keep: Hole[] = [];
  for (const el of document.querySelectorAll(`[${SPOTLIGHT_KEEP_ATTR}]`)) {
    const h = holeFor(el);
    if (h) keep.push(h);
  }
  return { target: hole, keep };
}

/**
 * Tracks the spotlit element every frame while it's up: the header slides,
 * the nav links are magnetic, and the page can scroll under the cursor.
 */
function useSpotlightFrame(target: SpotlightTarget | null): Frame | null {
  const [frame, setFrame] = useState<Frame | null>(null);
  useEffect(() => {
    if (!target) return;
    let raf = 0;
    let last = "";
    const tick = () => {
      const next = measure(target);
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setFrame(next);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      setFrame(null);
    };
  }, [target]);
  return target ? frame : null;
}

/**
 * Dims the window except for the spotlit element and anything marked
 * `data-spotlight-keep`, and runs a sheen across the target. Purely visual:
 * it never takes pointer events, so the control that raised it keeps its
 * hover. Renders nothing when the target isn't on screen.
 */
export function SpotlightOverlay() {
  const target = useStore(spotlightStore);
  const frame = useSpotlightFrame(target);
  const maskId = useId();

  return createPortal(
    <AnimatePresence>
      {frame ? (
        <motion.div
          key="spotlight"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="pointer-events-none fixed inset-0 z-60"
        >
          <svg className="absolute inset-0 size-full">
            <defs>
              <mask id={maskId}>
                <rect width="100%" height="100%" fill="white" />
                {[frame.target, ...frame.keep].map((h, i) => (
                  <rect
                    key={i}
                    x={h.x}
                    y={h.y}
                    width={h.width}
                    height={h.height}
                    rx={h.radius}
                    fill="black"
                  />
                ))}
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="black"
              fillOpacity={0.6}
              mask={`url(#${maskId})`}
            />
          </svg>
          <div
            className="absolute overflow-hidden ring-2 ring-primary"
            style={{
              left: frame.target.x,
              top: frame.target.y,
              width: frame.target.width,
              height: frame.target.height,
              borderRadius: frame.target.radius,
              boxShadow: "0 0 24px 4px color-mix(in srgb, var(--primary) 45%, transparent)",
            }}
          >
            <span className="animate-spotlight-sheen absolute inset-y-0 left-0 w-2/3 bg-linear-to-r from-transparent via-white/50 to-transparent" />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
