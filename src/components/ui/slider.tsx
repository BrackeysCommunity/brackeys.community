"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import * as React from "react";

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
  return new Intl.NumberFormat(undefined, options).format(value);
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ticks,
  formatOptions,
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
        className="group/slider data-horizontal:w-full data-vertical:h-full"
        data-slot="slider"
        defaultValue={defaultValue}
        value={value}
        min={min}
        max={max}
        thumbAlignment="edge"
        {...props}
      >
        <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
          <SliderPrimitive.Track
            data-slot="slider-track"
            className="relative grow overflow-hidden rounded-xs border border-border/30 bg-muted select-none data-horizontal:h-1.5 data-horizontal:w-full data-vertical:h-full data-vertical:w-1.5"
          >
            <SliderPrimitive.Indicator
              data-slot="slider-range"
              className="bg-primary select-none data-horizontal:h-full data-vertical:w-full"
            />
          </SliderPrimitive.Track>
          {Array.from({ length: _values.length }, (_, index) => (
            <SliderPrimitive.Thumb
              data-slot="slider-thumb"
              key={index}
              className="chonk-emboss relative block size-3.5 shrink-0 rounded-xs border border-ring bg-white transition-all select-none [--chonk-lift-hover:2px] [--chonk-lift:1px] after:absolute after:-inset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none"
            />
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
