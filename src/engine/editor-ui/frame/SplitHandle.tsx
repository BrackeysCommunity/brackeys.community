import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

import { cx } from "../kit/index";

/** How far an arrow key moves a handle; Shift moves it further. */
export const HANDLE_STEP = 8;
export const HANDLE_STEP_LARGE = 32;

export type SplitHandleProps = {
  /** `vertical` for a column's edge, `horizontal` for the split between two groups. */
  orientation: "vertical" | "horizontal";
  label: string;
  /** The size the handle controls, as drawn. */
  value: number;
  min: number;
  max: number;
  /**
   * Which way of the handle's axis grows the size: +1 when moving right (or
   * down) grows it, -1 when moving left (or up) does.
   */
  grow: 1 | -1;
  /** While a pointer drags: the size it would set, or null once released. */
  onPreview: (value: number | null) => void;
  /** A key, or the end of a drag: the size the viewer chose. */
  onChange: (value: number) => void;
  /** Enter: collapses what the handle sizes, or restores it. */
  onToggle: () => void;
  /** Double-click: back to the default size. */
  onReset: () => void;
  className?: string;
  style?: CSSProperties;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A `role="separator"` between two areas. Arrows move it 8 px, Shift+arrows
 * 32 px, Home and End go to the limits, Enter collapses or restores and a
 * double-click restores the default. A drag captures the pointer, previews
 * as it goes and changes the size once, on release.
 */
export function SplitHandle({
  orientation,
  label,
  value,
  min,
  max,
  grow,
  onPreview,
  onChange,
  onToggle,
  onReset,
  className,
  style,
}: SplitHandleProps) {
  const drag = useRef<{ pointer: number; from: number; start: number; last: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const vertical = orientation === "vertical";
  const hi = Math.max(min, max);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? HANDLE_STEP_LARGE : HANDLE_STEP;
    const back = vertical ? "ArrowLeft" : "ArrowUp";
    const forward = vertical ? "ArrowRight" : "ArrowDown";
    let next: number | null = null;
    if (e.key === back) next = value - step * grow;
    else if (e.key === forward) next = value + step * grow;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = hi;
    else if (e.key === "Enter") {
      e.preventDefault();
      onToggle();
      return;
    }
    if (next === null) return;
    e.preventDefault();
    onChange(clamp(next, min, hi));
  };

  const position = (e: PointerEvent) => (vertical ? e.clientX : e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { pointer: e.pointerId, from: position(e), start: value, last: value };
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    d.last = clamp(d.start + (position(e) - d.from) * grow, min, hi);
    onPreview(d.last);
  };

  const end = (e: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    onPreview(null);
    if (commit && d.last !== d.start) onChange(Math.round(d.last));
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(hi)}
      tabIndex={0}
      className={cx("je-split", className)}
      data-orientation={orientation}
      data-dragging={dragging ? "" : undefined}
      style={style}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => end(e, true)}
      onPointerCancel={(e) => end(e, false)}
      onLostPointerCapture={(e) => end(e, true)}
      onDoubleClick={(e) => {
        e.preventDefault();
        onReset();
      }}
    />
  );
}
