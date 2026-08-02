import type { ReactNode } from "react";

import { Heading, Text } from "@/components/ui/typography";

/** Shelf title row. The trailing edge carries the jam count, or
 * `actions` when the shelf has its own controls (the featured rail's
 * paging arrows) — a count and a control set would crowd each other. */
export function ShelfHeader({
  title,
  blurb,
  count,
  actions,
}: {
  title: string;
  blurb: string;
  count?: number;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-muted/30 pb-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <Heading as="h2" className="text-2xl tracking-tight">
          {title}
        </Heading>
        <Text size="xs" variant="muted" className="tracking-widest">
          {blurb}
        </Text>
      </div>
      {actions ??
        (count != null && (
          <Text size="xs" variant="muted" className="tracking-widest tabular-nums">
            {count} JAM{count === 1 ? "" : "S"}
          </Text>
        ))}
    </header>
  );
}
