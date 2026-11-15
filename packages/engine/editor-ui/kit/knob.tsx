import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { clamp } from "../../math";
import { cx } from "./cx";

export type KnobProps = {
  /** Shown over the dial, and the slider's name unless `aria-label` gives a fuller one. */
  label: string;
  "aria-label"?: string;
  value: number;
  min: number;
  max: number;
  /** The value's step; a stepped knob (`options`) always steps 1. */
  step?: number;
  /** `log` spreads a wide positive range (Hz) evenly over the turn. */
  scale?: "linear" | "log";
  /** Where a reset goes, marked on the dial. */
  defaultValue?: number;
  /** Whether the value shown is the default rather than one set; defaults to value === defaultValue. */
  isDefault?: boolean;
  /** A stepped switch: the value is an index into these, each shown by name. */
  options?: readonly string[];
  /** The readout; defaults to the value at the step's decimals. */
  format?: (value: number) => string;
  unit?: string;
  disabled?: boolean;
  /** The dial's diameter in px. */
  size?: number;
  className?: string;
  /** Every value a drag or wheel passes through, before it settles. */
  onChange?: (value: number) => void;
  /** Once per gesture: a drag's release, a key, a settled wheel, a typed value. */
  onCommit: (value: number) => void;
  /** Double-click or Delete; defaults to committing `defaultValue`. */
  onReset?: () => void;
};

/** The dial's sweep, degrees either side of straight up. */
const SWEEP = 135;
/** Pixels of vertical drag for the whole range; Shift makes it ten times finer. */
const DRAG_SPAN_PX = 200;
const FINE = 10;
/** How long the wheel rests before its turn is committed as one change. */
export const KNOB_WHEEL_SETTLE_MS = 250;

const decimalsOf = (step: number) => {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
};

/** The 0–1 position of `value` on the turn. */
function positionOf(value: number, min: number, max: number, log: boolean): number {
  if (max === min) return 0;
  if (log) return clamp(Math.log(value / min) / Math.log(max / min), 0, 1);
  return clamp((value - min) / (max - min), 0, 1);
}

function valueAt(position: number, min: number, max: number, log: boolean): number {
  const p = clamp(position, 0, 1);
  return log ? min * (max / min) ** p : min + p * (max - min);
}

function snap(value: number, min: number, max: number, step: number): number {
  const snapped = Math.round(value / step) * step;
  return clamp(Number(snapped.toFixed(decimalsOf(step))), min, max);
}

/** A point on the dial's circle, `deg` clockwise from straight up. */
function polar(c: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [c + r * Math.sin(rad), c - r * Math.cos(rad)];
}

function arc(c: number, r: number, from: number, to: number): string {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const [x0, y0] = polar(c, r, a);
  const [x1, y1] = polar(c, r, b);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * A rotary control: drag up or down to turn it (Shift for fine), the wheel
 * while it has focus, the arrow keys (Shift for ten steps), Page Up and Down
 * for a tenth of the turn, Home and End; double-click or Delete resets it,
 * and a click on its readout (or Enter) types a value. A slider to assistive
 * tech. A drag is one `onCommit`, so it undoes in one step.
 */
export function Knob({
  label,
  "aria-label": ariaLabel = label,
  value,
  min: minIn,
  max: maxIn,
  step: stepIn,
  scale = "linear",
  defaultValue,
  isDefault,
  options,
  format,
  unit,
  disabled = false,
  size = 38,
  className,
  onChange,
  onCommit,
  onReset,
}: KnobProps) {
  const stepped = options !== undefined;
  const min = stepped ? 0 : minIn;
  const max = stepped ? options.length - 1 : maxIn;
  const step = stepped ? 1 : (stepIn ?? (max - min) / 100);
  const log = scale === "log" && min > 0 && !stepped;
  const [live, setLive] = useState<number | null>(null);
  const [typing, setTypingState] = useState<string | null>(null);
  // Enter and Escape hand focus back to the dial; the blur that follows must see the draft already gone.
  const draft = useRef<string | null>(null);
  const setTyping = (next: string | null) => {
    draft.current = next;
    setTypingState(next);
  };
  const shown = live ?? value;
  const atDefault = isDefault ?? (defaultValue !== undefined && value === defaultValue);
  const wheel = useRef<{
    from: number;
    value: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const dial = useRef<HTMLDivElement>(null);
  // A gesture's listeners and timers read these, so a re-render mid-gesture doesn't strand them on old props.
  const latest = useRef({ onChange, onCommit });
  useLayoutEffect(() => {
    latest.current = { onChange, onCommit };
  });
  const input = useRef<HTMLInputElement>(null);
  const isTyping = typing !== null;
  useEffect(() => {
    if (!isTyping) return;
    input.current?.focus();
    input.current?.select();
  }, [isTyping]);

  const text = (v: number) =>
    stepped
      ? (options[Math.round(v)] ?? "")
      : format
        ? format(v)
        : String(Number(v.toFixed(decimalsOf(step))));
  const valueText = `${text(shown)}${unit && !stepped ? ` ${unit}` : ""}`;

  const reset = () => {
    if (disabled) return;
    if (onReset) onReset();
    else if (defaultValue !== undefined) onCommit(defaultValue);
  };

  /** The value a key or the wheel moves to: `steps` steps, or a share of the turn on a log dial. */
  const nudged = (from: number, steps: number) => {
    if (!log) return snap(from + steps * step, min, max, step);
    const next = snap(
      valueAt(positionOf(from, min, max, true) + steps / 100, min, max, true),
      min,
      max,
      step,
    );
    // A fine step can round back to where it was low on a log dial.
    return next === from ? snap(from + Math.sign(steps) * step, min, max, step) : next;
  };

  const settleWheel = () => {
    const pending = wheel.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    wheel.current = null;
    setLive(null);
    if (pending.value !== pending.from) latest.current.onCommit(pending.value);
  };

  useEffect(() => {
    const el = dial.current;
    if (!el) return;
    // A wheel over the panel scrolls it; only a focused knob takes the wheel, so it can cancel the scroll.
    const onWheel = (e: WheelEvent) => {
      if (disabled || document.activeElement !== el || e.deltaY === 0) return;
      e.preventDefault();
      const from = wheel.current?.value ?? value;
      const next = nudged(from, (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 1 : stepped ? 1 : 2));
      if (wheel.current) clearTimeout(wheel.current.timer);
      wheel.current = {
        from: wheel.current?.from ?? value,
        value: next,
        timer: setTimeout(settleWheel, KNOB_WHEEL_SETTLE_MS),
      };
      setLive(next);
      latest.current.onChange?.(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  useEffect(
    () => () => {
      if (wheel.current) clearTimeout(wheel.current.timer);
    },
    [],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus();
    const drag = {
      position: positionOf(value, min, max, log),
      y: e.clientY,
      from: value,
      last: value,
    };
    // On the window, not the dial: the pointer leaves the dial as soon as it moves far.
    const move = (ev: PointerEvent) => {
      const dy = drag.y - ev.clientY;
      if (dy === 0) return;
      drag.y = ev.clientY;
      drag.position = clamp(drag.position + dy / (DRAG_SPAN_PX * (ev.shiftKey ? FINE : 1)), 0, 1);
      const next = snap(valueAt(drag.position, min, max, log), min, max, step);
      if (next === drag.last) return;
      drag.last = next;
      setLive(next);
      latest.current.onChange?.(next);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setLive(null);
      // Against where it started: a host may feed `onChange` back through `value` while it turns.
      if (drag.last !== drag.from) latest.current.onCommit(drag.last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const many = e.shiftKey ? 10 : 1;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowUp":
      case "ArrowRight":
        next = nudged(value, many);
        break;
      case "ArrowDown":
      case "ArrowLeft":
        next = nudged(value, -many);
        break;
      case "PageUp":
        next = stepped
          ? nudged(value, 1)
          : snap(valueAt(positionOf(value, min, max, log) + 0.1, min, max, log), min, max, step);
        break;
      case "PageDown":
        next = stepped
          ? nudged(value, -1)
          : snap(valueAt(positionOf(value, min, max, log) - 0.1, min, max, log), min, max, step);
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        reset();
        return;
      case "Enter":
        if (!stepped) {
          e.preventDefault();
          setTyping(text(value));
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    if (next !== value) onCommit(next);
  };

  const commitTyped = () => {
    const typed = draft.current;
    if (typed === null) return;
    const n = Number.parseFloat(typed);
    setTyping(null);
    if (!Number.isFinite(n)) return;
    const next = snap(n, min, max, step);
    if (next !== value) onCommit(next);
  };

  const c = size / 2;
  const r = c - 3;
  const angle = (v: number) => -SWEEP + 2 * SWEEP * positionOf(v, min, max, log);
  const bipolar = !stepped && !log && min < 0 && max > 0;
  const anchor = bipolar ? angle(0) : -SWEEP;
  const [px, py] = polar(c, r * 0.62, angle(shown));
  const [qx, qy] = polar(c, r * 0.2, angle(shown));
  const mark = defaultValue !== undefined ? polar(c, r + 1.5, angle(defaultValue)) : null;

  return (
    <div
      className={cx("je-knob", className)}
      data-disabled={disabled ? "" : undefined}
      data-default={atDefault ? "" : undefined}
    >
      <span className="je-knob-label" aria-hidden>
        {label}
      </span>
      <div
        ref={dial}
        role="slider"
        className="je-knob-dial"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-orientation="vertical"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={shown}
        aria-valuetext={atDefault && live === null ? `${valueText}, default` : valueText}
        aria-disabled={disabled || undefined}
        style={{ width: size, height: size }}
        onPointerDown={onPointerDown}
        onDoubleClick={reset}
        onKeyDown={onKeyDown}
        onBlur={settleWheel}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <path className="je-knob-track" d={arc(c, r, -SWEEP, SWEEP)} />
          <path className="je-knob-fill" d={arc(c, r, anchor, angle(shown))} />
          {mark ? <circle className="je-knob-mark" cx={mark[0]} cy={mark[1]} r={1.5} /> : null}
          <circle className="je-knob-cap" cx={c} cy={c} r={r - 4} />
          <line className="je-knob-pointer" x1={qx} y1={qy} x2={px} y2={py} />
        </svg>
      </div>
      {typing !== null ? (
        <input
          className="je-knob-input"
          aria-label={`${ariaLabel} value`}
          inputMode="decimal"
          value={typing}
          ref={input}
          onChange={(e) => setTyping(e.target.value)}
          onBlur={commitTyped}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitTyped();
              dial.current?.focus();
            }
            if (e.key === "Escape") {
              setTyping(null);
              dial.current?.focus();
            }
          }}
        />
      ) : stepped ? (
        <span className="je-knob-value" aria-hidden>
          {valueText}
        </span>
      ) : (
        <button
          type="button"
          className="je-knob-value"
          tabIndex={-1}
          aria-label={`Type a value for ${ariaLabel}`}
          disabled={disabled}
          onClick={() => setTyping(text(value))}
        >
          {valueText}
        </button>
      )}
    </div>
  );
}
