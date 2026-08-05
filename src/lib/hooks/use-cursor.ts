import { useLocation } from "@tanstack/react-router";
import { useEventListener } from "ahooks";
import { useCallback, useRef, useState } from "react";

const CORNER_SIZE_MAP = { xs: 4, sm: 8, md: 12, lg: 16 } as const;

export type CursorCornerSize = keyof typeof CORNER_SIZE_MAP;

export function resolveCornerSize(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (value in CORNER_SIZE_MAP) return CORNER_SIZE_MAP[value as CursorCornerSize];
  const n = parseInt(value);
  return Number.isNaN(n) ? undefined : n;
}

export interface CursorState {
  type: "default" | "pointer" | "text" | "hidden" | "magnetic";
  label?: string;
  targetElement?: HTMLElement;
  color?: string;
  cornerSize?: number;
  paddingX?: number;
  paddingY?: number;
  noDrift?: boolean;
  bounce?: number;
}

export function useCursorState() {
  const [state, setState] = useState<CursorState>({ type: "default" });

  const buildMagneticState = useCallback(
    (magneticTarget: HTMLElement, target: HTMLElement): CursorState => {
      const cursorLabel = target.closest("[data-cursor-label]")?.getAttribute("data-cursor-label");
      const cursorColor = target.closest("[data-cursor-color]")?.getAttribute("data-cursor-color");
      const cornerSize = target
        .closest("[data-cursor-corner-size]")
        ?.getAttribute("data-cursor-corner-size");
      const paddingX = target
        .closest("[data-cursor-padding-x]")
        ?.getAttribute("data-cursor-padding-x");
      const paddingY = target
        .closest("[data-cursor-padding-y]")
        ?.getAttribute("data-cursor-padding-y");
      const noDrift = target.closest("[data-cursor-no-drift]") !== null;
      const bounceAttr = target.closest("[data-cursor-bounce]")?.getAttribute("data-cursor-bounce");
      return {
        type: "magnetic",
        targetElement: magneticTarget,
        label: cursorLabel || undefined,
        color: cursorColor || undefined,
        cornerSize: resolveCornerSize(cornerSize ?? undefined),
        paddingX: paddingX ? parseInt(paddingX) : undefined,
        paddingY: paddingY ? parseInt(paddingY) : undefined,
        noDrift,
        bounce: bounceAttr ? parseFloat(bounceAttr) : undefined,
      };
    },
    [],
  );

  const onMouseEnter = useCallback(
    (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const magneticTarget = target.closest("[data-magnetic]") as HTMLElement;
      const cursorType = target.closest("[data-cursor]")?.getAttribute("data-cursor");
      const cursorLabel = target.closest("[data-cursor-label]")?.getAttribute("data-cursor-label");

      if (magneticTarget) {
        setState(buildMagneticState(magneticTarget, target));
        return;
      }

      if (cursorType || cursorLabel) {
        setState({
          type: (cursorType as CursorState["type"]) || "pointer",
          label: cursorLabel || undefined,
        });
      } else {
        const style = window.getComputedStyle(target);
        if (style.cursor === "pointer") {
          setState({ type: "pointer" });
        } else if (style.cursor === "text") {
          setState({ type: "text" });
        } else {
          setState({ type: "default" });
        }
      }
    },
    [buildMagneticState],
  );

  const onMouseLeave = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const magneticTarget = target.closest("[data-magnetic]") as HTMLElement;
    if (!magneticTarget) return;
    setState({ type: "default" });
  }, []);

  // A route change leaves no `mouseout` behind — whatever the cursor was
  // latched onto is simply unmounted — so the reset has to be by hand.
  // Adjusted during render rather than from an effect: an effect commits the
  // new route first and paints one frame of the old page's cursor over it.
  const { pathname } = useLocation();
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setState({ type: "default" });
  }

  useEventListener("mouseover", onMouseEnter, { target: () => document.body });
  useEventListener("mouseout", onMouseLeave, { target: () => document.body });

  return state;
}

/**
 * Magnetic pull for the fixed header chrome: none.
 *
 * A non-zero strength slides a target toward the pointer, which in a bar
 * pinned over scrolling content reads as the header itself shifting. Header
 * targets stay exactly where they are and let the cursor's own corner frame do
 * the moving — they keep `data-magnetic` (that is what the frame latches onto)
 * and stay off `data-cursor-no-drift`, so the frame is still free to trail.
 *
 * This is also `Button`'s default, so every button in the app magnetizes the
 * cursor the same way the header chrome does. Buttons that should physically
 * drift pass their own `magneticStrength`.
 */
export const HEADER_MAGNET_STRENGTH = 0;

export function useMagnetic(strength = 0.2) {
  const ref = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      // A zero-strength target never moves, so skip the per-move measuring
      // entirely rather than writing the same {0, 0} on every event.
      if (strength === 0 || !ref.current) return;

      const { left, top, width, height } = ref.current.getBoundingClientRect();
      const centerX = left + width / 2;
      const centerY = top + height / 2;

      const distanceX = e.clientX - centerX;
      const distanceY = e.clientY - centerY;

      const threshold = Math.max(width, height) * 0.6;
      if (Math.abs(distanceX) < threshold && Math.abs(distanceY) < threshold) {
        setPosition({ x: distanceX * strength, y: distanceY * strength });
      } else {
        setPosition({ x: 0, y: 0 });
      }
    },
    [strength],
  );

  const handleMouseLeave = useCallback(() => {
    setPosition({ x: 0, y: 0 });
  }, []);

  useEventListener("mousemove", handleMouseMove, { target: () => ref.current });
  useEventListener("mouseleave", handleMouseLeave, { target: () => ref.current });

  return { ref, position };
}
