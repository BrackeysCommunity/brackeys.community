import type { ReactNode } from "react";

import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { formatCount } from "@/lib/format-count";
import { cn } from "@/lib/utils";

/**
 * Title row for a shelf — a horizontal `Rail` or a plain stacked list.
 * The trailing edge carries the shelf's count, or `actions` when it has
 * controls of its own (a rail's paging arrows); a count and a control set
 * would crowd each other, so it's one or the other.
 *
 * `variant` is how loudly the shelf announces itself: `display` is a
 * section heading in its own right, `label` the lighter micro-label
 * treatment for a shelf sitting under a page's real heading.
 */
export function ShelfHeader({
  title,
  blurb,
  variant = "display",
  count,
  unit = "ITEM",
  unitPlural,
  actions,
}: {
  title?: string;
  blurb?: string;
  variant?: "display" | "label";
  count?: number;
  /** Singular noun the count is of. */
  unit?: string;
  /** Plural form, when a trailing S won't do it ("ENTRY" → "ENTRIES"). */
  unitPlural?: string;
  actions?: ReactNode;
}) {
  const display = variant === "display";

  return (
    <header
      className={cn(
        "flex flex-wrap items-center justify-between gap-2",
        display
          ? "border-b border-muted/30 pb-2"
          : "border-b border-dashed border-muted-foreground/25 pb-1.5",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-3">
        {title &&
          (display ? (
            <Heading as="h2" className="text-2xl tracking-tight">
              {title}
            </Heading>
          ) : (
            <MicroLabel>{title}</MicroLabel>
          ))}
        {blurb && (
          <Text size="xs" variant="muted" className={cn(display && "tracking-widest")}>
            {blurb}
          </Text>
        )}
      </div>
      {actions ??
        (count != null && (
          <Text size="xs" variant="muted" className="tracking-widest tabular-nums">
            {/* Grouped: a shelf over 2,090 submissions rendered "2090". */}
            {formatCount(count)} {count === 1 ? unit : (unitPlural ?? `${unit}S`)}
          </Text>
        ))}
    </header>
  );
}
