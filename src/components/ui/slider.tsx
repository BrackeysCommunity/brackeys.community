"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import * as React from "react";

import { APP_LOCALE } from "@/lib/format-date";
import { SLIDER_CUES } from "@/lib/sound";
import { cn } from "@/lib/utils";

type TickConfig = {
  count?: number;
  interval?: number;
  values?: number[];
  labels?: boolean;
};

type SliderProps = SliderPrimitive.Root.Props & {
  ticks?: TickConfig;
  formatOptions?: Intl.NumberFormatOptions;
  /** A bubble over the thumb while it is dragged, naming the value under the
   *  pointer — the finger or cursor covers whatever else would say it. */
  valueLabel?: (value: number, index: number) => React.ReactNode;
};

function computeTickPositions(ticks: TickConfig | undefined, min: number, max: number): number[] {
  if (!ticks) return [];
  if (ticks.values) return ticks.values;
  if (ticks.count != null && ticks.count > 1) {
    const step = (max - min) / (ticks.count - 1);
    return Array.from({ length: ticks.count }, (_, i) => min + i * step);
  }
  if (ticks.interval != null && ticks.interval > 0) {
    const positions: number[] = [];
    for (let v = min; v <= max; v += ticks.interval) {
      positions.push(v);
    }
    if (positions[positions.length - 1] !== max) positions.push(max);
    return positions;
  }
  return [];
}

function formatValue(value: number, options?: Intl.NumberFormatOptions): string {
  if (!options) return String(value);
  return new Intl.NumberFormat(APP_LOCALE, options).format(value);
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ticks,
  formatOptions,
  valueLabel,
  ...props
}: SliderProps) {
  const _values = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]),
    [value, defaultValue, min, max],
  );

  const tickPositions = React.useMemo(
    () => computeTickPositions(ticks, min, max),
    [ticks, min, max],
  );

  const range = max - min;

  return (
    <div className={cn("relative", className)}>
      <SliderPrimitive.Root
        className="group/slider data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full"
        data-slot="slider"
        defaultValue={defaultValue}
        value={value}
        min={min}
        max={max}
        thumbAlignment="edge"
        {...props}
      >
        <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col">
          <SliderPrimitive.Track
            data-slot="slider-track"
            className="relative grow overflow-hidden rounded border border-border/30 bg-muted select-none data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
          >
            <SliderPrimitive.Indicator
              data-slot="slider-range"
              className="bg-primary select-none data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
            />
          </SliderPrimitive.Track>
          {Array.from({ length: _values.length }, (_, index) => (
            <SliderPrimitive.Thumb
              data-slot="slider-thumb"
              key={index}
              {...SLIDER_CUES}
              className="group/thumb chonk-emboss relative block size-3.5 shrink-0 rounded border border-ring bg-white transition-all select-none [--chonk-lift-hover:2px] [--chonk-lift:1px] after:absolute after:-inset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none"
            >
              {valueLabel && _values[index] != null ? (
                <span
                  data-slot="slider-value-label"
                  aria-hidden
                  className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 translate-y-1 rounded bg-foreground px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap text-background tabular-nums opacity-0 shadow-[0_2px_0_0_color-mix(in_srgb,var(--foreground)_50%,black)] transition-[opacity,translate] duration-100 group-data-dragging/thumb:translate-y-0 group-data-dragging/thumb:opacity-100 motion-reduce:transition-none"
                >
                  {valueLabel(_values[index], index)}
                </span>
              ) : null}
            </SliderPrimitive.Thumb>
          ))}
        </SliderPrimitive.Control>
      </SliderPrimitive.Root>

      {/* Tick marks */}
      {tickPositions.length > 0 && (
        <div className="relative mt-1.5 h-4 w-full" aria-hidden="true">
          {tickPositions.map((tickVal) => {
            const pct = range > 0 ? ((tickVal - min) / range) * 100 : 0;
            return (
              <div
                key={tickVal}
                className="absolute flex flex-col items-center"
                style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
              >
                <div className="h-1.5 w-px bg-muted-foreground/40" />
                {ticks?.labels && (
                  <span className="mt-0.5 text-[9px] text-muted-foreground tabular-nums">
                    {formatValue(tickVal, formatOptions)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { Slider };
export type { SliderProps, TickConfig };
