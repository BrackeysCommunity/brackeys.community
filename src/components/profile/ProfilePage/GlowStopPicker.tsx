import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * One gradient stop: a swatch that opens the shared `ColorPicker`.
 *
 * Whatever is picked is painted, with no pull towards legibility. OKLCH can
 * go past sRGB, and those picks are stored as `oklch(…)` rather than clipped
 * to a hex.
 */
export function GlowStopPicker({
  value,
  onChange,
  onCommit,
  onRemove,
  index,
}: {
  value: string;
  /** Fires while a control is moving — cheap, local updates only. */
  onChange: (hex: string) => void;
  /** Fires when an edit is finished, which is when a write is worth making. */
  onCommit: () => void;
  onRemove: () => void;
  index: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
      <PopoverContent align="start" className="w-80 gap-3 p-3">
        <ColorPicker
          label={`COLOUR ${index + 1}`}
          value={value}
          onChange={onChange}
          onCommit={onCommit}
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
