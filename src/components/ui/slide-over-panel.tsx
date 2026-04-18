"use client";

import { AnimatePresence, motion, type HTMLMotionProps, type Transition } from "framer-motion";
import * as React from "react";

import { cn } from "@/lib/utils";

type Position = "right" | "left" | "bottom";

type RenderProps = { isOpening: boolean };

type SlideOverPanelProps = Omit<HTMLMotionProps<"div">, "children"> & {
  position?: Position;
  /**
   * Pixel size of the panel along the axis it slides from.
   * Width for right/left, height for bottom.
   */
  size?: number;
  children?: React.ReactNode | ((props: RenderProps) => React.ReactNode);
};

// Quick spring with a minimal bounce on open.
const OPEN_SPRING: Transition = { type: "spring", stiffness: 700, damping: 34, mass: 1 };

function positionToAnchor(position: Position) {
  switch (position) {
    case "left":
      return { initial: { x: "-100%" }, animate: { x: 0 }, exit: { x: "-100%" } };
    case "bottom":
      return { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" } };
    case "right":
    default:
      return { initial: { x: "100%" }, animate: { x: 0 }, exit: { x: "100%" } };
  }
}

function positionToClasses(position: Position) {
  switch (position) {
    case "left":
      return "inset-y-0 left-0 h-full border-r";
    case "bottom":
      return "inset-x-0 bottom-0 w-full border-t";
    case "right":
    default:
      return "inset-y-0 right-0 h-full border-l";
  }
}

function SlideOverPanel({
  position = "right",
  size,
  children,
  className,
  style,
  ...props
}: SlideOverPanelProps) {
  // Defer rendering of children on mount — this is the "skeleton UI" pattern:
  // the panel itself opens immediately so it can respond to input, and the
  // contents render in a subsequent pass.
  const [isOpening, setIsOpening] = React.useState(true);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setIsOpening(false));
    return () => cancelAnimationFrame(id);
  }, []);

  const anchor = positionToAnchor(position);
  const sizeStyle: React.CSSProperties = {};
  if (size !== undefined) {
    if (position === "bottom") sizeStyle.height = size;
    else sizeStyle.width = size;
  }

  return (
    <motion.div
      data-slot="slide-over-panel"
      data-position={position}
      initial={anchor.initial}
      animate={anchor.animate}
      exit={anchor.exit}
      transition={OPEN_SPRING}
      style={{ ...sizeStyle, ...style }}
      className={cn(
        "fixed z-40 flex flex-col bg-background shadow-lg",
        positionToClasses(position),
        // sensible defaults when no explicit size
        position !== "bottom" && size === undefined && "w-full max-w-md",
        position === "bottom" && size === undefined && "h-1/2",
        className,
      )}
      {...props}
    >
      {typeof children === "function" ? children({ isOpening }) : children}
    </motion.div>
  );
}

/**
 * Re-export framer-motion's AnimatePresence so consumers can opt into
 * animated unmount without importing framer-motion directly.
 */
export { SlideOverPanel, AnimatePresence };
export type { SlideOverPanelProps, RenderProps as SlideOverPanelRenderProps };
