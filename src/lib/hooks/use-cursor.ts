import { useLocation } from "@tanstack/react-router";
import { useEventListener } from "ahooks";
import { useCallback, useEffect, useRef, useState } from "react";

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
  const focusLockedRef = useRef<HTMLElement | null>(null);

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
        focusLockedRef.current = null;
        setState(buildMagneticState(magneticTarget, target));
        return;
      }

      if (cursorType || cursorLabel) {
        focusLockedRef.current = null;
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
        } else if (!focusLockedRef.current) {
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

    const active = document.activeElement;
    if (active && magneticTarget.contains(active)) {
      focusLockedRef.current = magneticTarget;
      return;
    }

    setState({ type: "default" });
  }, []);

  useEffect(() => {
    const onFocusOut = () => {
      if (focusLockedRef.current) {
        requestAnimationFrame(() => {
          const active = document.activeElement as HTMLElement | null;
          if (!focusLockedRef.current || !active || !focusLockedRef.current.contains(active)) {
            const newMagnetic = active?.closest("[data-magnetic]") as HTMLElement | null;
            if (newMagnetic && active) {
              focusLockedRef.current = newMagnetic;
              setState(buildMagneticState(newMagnetic, active));
            } else {
              focusLockedRef.current = null;
              setState({ type: "default" });
            }
          }
        });
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (focusLockedRef.current && !focusLockedRef.current.contains(e.target as Node)) {
        focusLockedRef.current = null;
        setState({ type: "default" });
      }
    };

    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [buildMagneticState]);

  const { pathname } = useLocation();
  useEffect(() => {
    focusLockedRef.current = null;
    setState({ type: "default" });
  }, [pathname]);

  useEventListener("mouseover", onMouseEnter, { target: () => document.body });
  useEventListener("mouseout", onMouseLeave, { target: () => document.body });

  return state;
}

export function useMagnetic(strength = 0.2) {
  const ref = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!ref.current) return;

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
