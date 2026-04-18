import { PatternLines } from "@visx/pattern";
import { useId } from "react";

import { cn } from "@/lib/utils";

const CELL = 40;

interface GridBackgroundProps {
  className?: string;
  opacity?: number;
}

export function GridBackground({ className, opacity = 0.1 }: GridBackgroundProps) {
  const patternId = useId();

  return (
    <div
      className={cn("pointer-events-none fixed inset-0 z-0 overflow-hidden", className)}
      style={{ opacity }}
    >
      <svg
        role="presentation"
        aria-hidden="true"
        width="100%"
        height={`calc(100% + ${CELL * 2}px)`}
        className="animate-[gridScroll_3s_linear_infinite]"
        style={{ marginTop: -CELL }}
      >
        <defs>
          <PatternLines
            id={patternId}
            height={CELL}
            width={CELL}
            stroke="#6B6B6B"
            strokeWidth={1}
            orientation={["vertical", "horizontal"]}
          />
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}
