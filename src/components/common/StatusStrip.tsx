import { Well } from "@/components/ui/well";
import { cn } from "@/lib/utils";

export interface StatusSegment {
  key: string;
  label?: string;
  value: string;
  leadingDot?: boolean;
}

function StatusDot() {
  return (
    <span className="relative inline-flex h-1.5 w-1.5">
      <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60" />
      <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-success" />
    </span>
  );
}

// Tailwind needs concrete class names at build time. Map segment counts here.
const XL_COLS: Record<number, string> = {
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
};

interface StatusStripProps {
  segments: StatusSegment[];
  className?: string;
}

/**
 * Generic page-heading status strip: a notched `Well` that lays its segments
 * out as a grid. Stacks 2-up on narrow viewports and expands to one-cell-per
 * -segment on xl. Supports an optional leading pulse dot per cell.
 */
export function StatusStrip({ segments, className }: StatusStripProps) {
  const xlCols = XL_COLS[segments.length] ?? "xl:grid-cols-4";

  return (
    <Well notchOpts={{ size: 10 }} className={className}>
      <div className={cn("mt-1 grid grid-cols-2", xlCols)}>
        {segments.map((seg) => (
          <div
            key={seg.key}
            className="flex items-center gap-2 px-3 py-2 font-mono text-xs tracking-widest text-muted-foreground uppercase not-last:border-r not-last:border-muted/40"
          >
            {seg.leadingDot && <StatusDot />}
            {seg.label && <span>{seg.label}</span>}
            <span className={seg.label ? "text-foreground" : ""}>{seg.value}</span>
          </div>
        ))}
      </div>
    </Well>
  );
}
