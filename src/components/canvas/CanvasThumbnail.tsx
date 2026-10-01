import type { CanvasThumbnail as Thumbnail } from "@/lib/canvas/thumbnail";
import { cn } from "@/lib/utils";

import { cardColor } from "./canvas-cards";

/** A canvas's cards as colored rectangles, scaled into the box. */
export function CanvasThumbnail({
  thumbnail,
  className,
}: {
  thumbnail: Thumbnail | null;
  className?: string;
}) {
  if (!thumbnail) {
    return <div className={cn("bg-muted/30", className)} aria-hidden />;
  }
  const pad = Math.max(thumbnail.box.w, thumbnail.box.h) * 0.06;
  const { x, y, w, h } = thumbnail.box;
  return (
    <svg
      viewBox={`${x - pad} ${y - pad} ${w + pad * 2} ${h + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      className={cn("bg-muted/20", className)}
      aria-hidden
    >
      {thumbnail.rects.map(([rx, ry, rw, rh, color, group], i) => {
        const fill = cardColor(color ?? undefined) ?? "var(--muted-foreground)";
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: rects are positional
            key={i}
            x={rx}
            y={ry}
            width={rw}
            height={rh}
            rx={Math.min(rw, rh) * 0.04}
            fill={fill}
            fillOpacity={group ? 0.06 : 0.28}
            stroke={fill}
            strokeOpacity={group ? 0.5 : 0.7}
            strokeWidth={Math.max(w, h) / 300}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}
