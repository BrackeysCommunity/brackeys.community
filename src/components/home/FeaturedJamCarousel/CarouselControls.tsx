import { ArrowLeft01Icon, ArrowRight01Icon, PauseIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "framer-motion";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

interface NubProps {
  active: boolean;
  label: string;
  onClick: () => void;
}

export function Nub({ active, label, onClick }: NubProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      // Don't take focus on click — keeps the carousel container from
      // receiving a focus-within outline as we tap through nubs.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="group flex h-3 items-center"
    >
      <motion.span
        animate={{ width: active ? 18 : 6 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className={cn(
          "block h-1.5",
          active ? "bg-primary" : "bg-muted-foreground/40 group-hover:bg-muted-foreground",
        )}
      />
    </button>
  );
}

interface CarouselControlsProps {
  paused: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTogglePause: () => void;
}

/**
 * Right-anchored prev / pause / next segment built on `SegmentedControl`.
 * Prev and next fire on click but never become the selected value; pause
 * is the only keepable selection (toggling sets the segmented value to
 * "pause" or back to "" so the pressed state reflects autoplay state).
 */
export function CarouselControls({ paused, onPrev, onNext, onTogglePause }: CarouselControlsProps) {
  return (
    <SegmentedControl
      size="xs"
      priority="default"
      value={paused ? "pause" : ""}
      // Selection is owned by `paused`; SegmentedControl's onChange fires
      // for every item click but we route the actual side-effects through
      // each item's onClick (which still fires when the wrapper suppresses
      // the change, e.g. clicking the same pause to toggle it off).
      onChange={() => {}}
      aria-label="Carousel controls"
    >
      <SegmentedControl.Item
        value="prev"
        aria-label="Previous jam"
        className="rounded-l-sm"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onPrev}
        icon={<HugeiconsIcon icon={ArrowLeft01Icon} size={12} />}
      />
      <SegmentedControl.Item
        value="pause"
        aria-label={paused ? "Resume autoplay" : "Pause autoplay"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onTogglePause}
        icon={<HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} size={12} />}
      />
      <SegmentedControl.Item
        value="next"
        aria-label="Next jam"
        className="rounded-r-sm"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onNext}
        icon={<HugeiconsIcon icon={ArrowRight01Icon} size={12} />}
      />
    </SegmentedControl>
  );
}
