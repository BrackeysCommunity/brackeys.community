import { CheckmarkCircle02Icon, EyeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/lib/utils";

import { useJamWatches } from "./use-jam-watches";

/**
 * The "you're on this one" mark on a jam card. Renders nothing for a jam the
 * viewer doesn't watch, and nothing at all when signed out, so the board is
 * unchanged for the anonymous majority.
 *
 * An icon rather than a label: it sits on a card whose text budget is
 * already spent on the title, host and countdown, and the two states only
 * have to be distinguishable from each other.
 */
export function JamWatchMarker({ jamId, className }: { jamId: number; className?: string }) {
  const { intentOf } = useJamWatches();
  const intent = intentOf(jamId);
  if (!intent) return null;

  const entering = intent === "entering";
  return (
    <span
      title={entering ? "You're entering this jam" : "You're watching this jam"}
      aria-label={entering ? "You're entering this jam" : "You're watching this jam"}
      className={cn(
        "inline-flex items-center rounded-full p-1 backdrop-blur-sm",
        entering ? "bg-success/20 text-success" : "bg-background/70 text-muted-foreground",
        className,
      )}
    >
      <HugeiconsIcon icon={entering ? CheckmarkCircle02Icon : EyeIcon} size={12} />
    </span>
  );
}
