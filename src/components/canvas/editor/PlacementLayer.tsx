import { useReactFlow } from "@xyflow/react";
import { useRef, useState } from "react";

/** Below this many pixels of travel a drag is a click. */
const CLICK_SLOP = 4;

export interface Placement {
  /** Flow coordinates. A click gives the point only; the card takes its default size. */
  at: { x: number; y: number };
  size?: { w: number; h: number };
}

/**
 * Covers the canvas while a creation tool is armed: a click places a card
 * there, a drag places it at the dragged size.
 */
export function PlacementLayer({ onPlace }: { onPlace: (placement: Placement) => void }) {
  const flow = useReactFlow();
  const start = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const box = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });

  return (
    <div
      data-testid="placement-layer"
      className="absolute inset-0 z-10 cursor-crosshair touch-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        start.current = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        setRect(box(start.current, { x: e.clientX - bounds.left, y: e.clientY - bounds.top }));
      }}
      onPointerUp={(e) => {
        const from = start.current;
        start.current = null;
        setRect(null);
        if (!from) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        const to = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
        const dragged = box(from, to);
        const toFlow = (p: { x: number; y: number }) =>
          flow.screenToFlowPosition({ x: p.x + bounds.left, y: p.y + bounds.top });
        if (dragged.w < CLICK_SLOP && dragged.h < CLICK_SLOP) {
          onPlace({ at: toFlow(to) });
          return;
        }
        const a = toFlow({ x: dragged.x, y: dragged.y });
        const b = toFlow({ x: dragged.x + dragged.w, y: dragged.y + dragged.h });
        onPlace({ at: a, size: { w: b.x - a.x, h: b.y - a.y } });
      }}
    >
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-md border-2 border-dashed border-primary bg-primary/5"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        />
      ) : null}
    </div>
  );
}
