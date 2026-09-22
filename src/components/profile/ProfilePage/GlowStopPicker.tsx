import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { MicroLabel } from "@/components/ui/typography";
import type { Hsl } from "@/lib/name-glow";
import {
  clampGlowColor,
  GLOW_MAX_LIGHTNESS,
  GLOW_MIN_LIGHTNESS,
  hexToHsl,
  hslToHex,
} from "@/lib/name-glow";
import { cn } from "@/lib/utils";

/**
 * One gradient stop, edited in hue/saturation/lightness rather than through
 * `<input type="color">`.
 *
 * The native control opens an OS window that can't be themed, and — worse
 * here — it offers a whole cube of colours the site then quietly pulls back
 * to a legible band, so the swatch and the name disagree. These three
 * sliders can only express what will actually be painted: lightness is
 * bounded to the band, so nothing is clamped behind the member's back.
 *
 * Removing a stop lives in here rather than beside the swatch: a delete
 * affordance per swatch crowded the row and left the controls misaligned.
 */
export function GlowStopPicker({
  value,
  onChange,
  onCommit,
  onRemove,
  index,
}: {
  value: string;
  /** Fires while a slider is dragged — cheap, local updates only. */
  onChange: (hex: string) => void;
  /** Fires when a slider is released, which is when a write is worth making. */
  onCommit: () => void;
  onRemove: () => void;
  index: number;
}) {
  // The knobs read this, not the hex. Deriving HSL from the colour on every
  // render round-trips through eight bits a channel, which drifts the other
  // two knobs every time one moves — and at zero saturation hue isn't
  // recoverable at all, so dropping saturation would snap hue back to red.
  // Seeded when the popover opens, which is the only moment the stored
  // colour can have changed underneath it.
  const [hsl, setHsl] = useState<Hsl>(() => hexToHsl(clampGlowColor(value) ?? value));
  const [open, setOpen] = useState(false);

  const set = (next: Partial<Hsl>) => {
    const merged = { ...hsl, ...next };
    setHsl(merged);
    onChange(hslToHex(merged));
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setHsl(hexToHsl(clampGlowColor(value) ?? value));
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Colour ${index + 1}`}
            className={cn(
              // Deliberately no scale on hover or press: the swatch is the
              // popover's anchor, and resizing it shifts the open panel.
              "size-8 shrink-0 rounded-md border border-border transition-colors",
              "hover:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              open && "ring-2 ring-ring",
            )}
            style={{ backgroundColor: value }}
          />
        }
      />
      <PopoverContent align="start" className="w-64 gap-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <MicroLabel as="span">COLOUR {index + 1}</MicroLabel>
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            {value}
          </span>
        </div>

        <SliderRow
          label="HUE"
          value={hsl.h}
          min={0}
          max={359}
          onChange={(h) => set({ h })}
          onCommit={onCommit}
          // Painted at the stop's own saturation and lightness, so a
          // desaturated colour shows a grey ramp rather than a rainbow it
          // cannot actually produce.
          track={`linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360]
            .map((h) => hslToHex({ h: h % 360, s: hsl.s, l: hsl.l }))
            .join(", ")})`}
        />
        <SliderRow
          label="SATURATION"
          value={Math.round(hsl.s * 100)}
          min={0}
          max={100}
          onChange={(s) => set({ s: s / 100 })}
          onCommit={onCommit}
          track={`linear-gradient(90deg, ${hslToHex({ h: hsl.h, s: 0, l: hsl.l })}, ${hslToHex({
            h: hsl.h,
            s: 1,
            l: hsl.l,
          })})`}
        />
        <SliderRow
          label="LIGHTNESS"
          value={Math.round(hsl.l * 100)}
          min={Math.round(GLOW_MIN_LIGHTNESS * 100)}
          max={Math.round(GLOW_MAX_LIGHTNESS * 100)}
          onChange={(l) => set({ l: l / 100 })}
          onCommit={onCommit}
          track={`linear-gradient(90deg, ${hslToHex({
            h: hsl.h,
            s: hsl.s,
            l: GLOW_MIN_LIGHTNESS,
          })}, ${hslToHex({ h: hsl.h, s: hsl.s, l: GLOW_MAX_LIGHTNESS })})`}
        />

        <Button
          size="sm"
          variant="ghost"
          className="justify-center"
          onClick={() => {
            setOpen(false);
            onRemove();
          }}
        >
          REMOVE COLOUR
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** A labelled slider whose track previews the axis it controls. */
function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
  onCommit,
  track,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onCommit: () => void;
  track: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <MicroLabel as="span" className="text-muted-foreground">
        {label}
      </MicroLabel>
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
        // The write waits for the release: dragging a slider is one decision,
        // not one per frame.
        onValueCommitted={onCommit}
        style={{ "--glow-track": track } as React.CSSProperties}
        // The filled indicator would paint over the gradient the track is
        // showing, and here the track *is* the information.
        className="[&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-track]]:bg-[image:var(--glow-track)]"
      />
    </div>
  );
}
