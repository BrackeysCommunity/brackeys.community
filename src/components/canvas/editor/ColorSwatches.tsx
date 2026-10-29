import { useRef, useState, useSyncExternalStore } from "react";

import { ColorPicker } from "@/components/ui/color-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { CARD_COLOR_CHOICES, cardColor, isHexColor } from "../canvas-cards";
import {
  noRecentColors,
  readRecentColors,
  rememberColor,
  subscribeRecentColors,
} from "./recent-colors";

const CUSTOM_SEED = "#7f5af0";

const SWATCH = "size-5 shrink-0 rounded-full border border-border";
const ACTIVE = "ring-2 ring-ring ring-offset-1 ring-offset-popover";

/** Any hex color, for when the six presets aren't it. Canvas files only store hex. */
function CustomColorPopover({
  current,
  active,
  onChange,
  onCommit,
}: {
  current: string | undefined;
  active: boolean;
  onChange: (hex: string) => void;
  onCommit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const picked = useRef<string | null>(null);
  const hex = current && isHexColor(current) ? current : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Custom color"
        render={
          <button
            type="button"
            className={cn(SWATCH, active && ACTIVE)}
            style={{
              background:
                hex ??
                "conic-gradient(from 0deg, #f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e)",
            }}
          />
        }
      />
      <PopoverContent side="top" sideOffset={10} className="w-80 gap-3 p-3">
        <ColorPicker
          label="CUSTOM COLOR"
          gamut="srgb"
          value={hex ?? CUSTOM_SEED}
          onChange={(next) => {
            picked.current = next;
            onChange(next);
          }}
          onCommit={() => {
            if (picked.current) rememberColor(picked.current);
            picked.current = null;
            onCommit();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** No color, the six presets, recent custom picks, then any hex. */
export function ColorSwatches({
  current,
  onColor,
  onCommit,
  className,
}: {
  current: string | undefined;
  onColor: (color: string | undefined) => void;
  /** A custom pick is finished; ends its undo step. */
  onCommit: () => void;
  className?: string;
}) {
  const recent = useSyncExternalStore(subscribeRecentColors, readRecentColors, noRecentColors);
  const custom = current && isHexColor(current) ? current.toLowerCase() : undefined;
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <button
        type="button"
        aria-label="No color"
        aria-pressed={current == null}
        className={cn(SWATCH, "bg-card", current == null && ACTIVE)}
        onClick={() => onColor(undefined)}
      />
      {CARD_COLOR_CHOICES.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Color ${color}`}
          aria-pressed={current === color}
          className={cn(SWATCH, current === color && ACTIVE)}
          style={{ background: cardColor(color) ?? undefined }}
          onClick={() => onColor(color)}
        />
      ))}
      {recent.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Recent color ${color}`}
          aria-pressed={custom === color}
          className={cn(SWATCH, custom === color && ACTIVE)}
          style={{ background: color }}
          onClick={() => onColor(color)}
        />
      ))}
      <CustomColorPopover
        current={current}
        active={custom != null && !recent.includes(custom)}
        onChange={onColor}
        onCommit={onCommit}
      />
    </div>
  );
}
