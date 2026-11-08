import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import type { CSSProperties } from "react";

import { cx } from "./cx";

export type SliderProps = Omit<SliderPrimitive.Root.Props, "className" | "style"> & {
  className?: string;
  style?: CSSProperties;
  /** A CSS background painted on the track in place of the filled range (a colour channel's ramp). */
  track?: string;
};

/** One or more thumbs on a range; arrow keys step, Shift steps ten. */
export function Slider({
  className,
  style,
  track,
  value,
  defaultValue,
  "aria-label": ariaLabel,
  ...props
}: SliderProps) {
  const values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [value ?? defaultValue ?? 0];
  const trackStyle = track ? ({ ...style, "--je-slider-track": track } as CSSProperties) : style;
  return (
    <SliderPrimitive.Root
      {...props}
      aria-label={ariaLabel}
      value={value}
      defaultValue={defaultValue}
      thumbAlignment="edge"
      className={cx("je-slider", className)}
      data-track={track ? "" : undefined}
      style={trackStyle}
    >
      <SliderPrimitive.Control className="je-slider-control">
        <SliderPrimitive.Track className="je-slider-track">
          <SliderPrimitive.Indicator className="je-slider-range" />
        </SliderPrimitive.Track>
        {values.map((_, index) => (
          <SliderPrimitive.Thumb
            key={index}
            index={index}
            aria-label={ariaLabel}
            className="je-slider-thumb"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
