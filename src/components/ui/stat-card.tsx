import { Chonk } from "@/components/ui/chonk";
import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  /** Pagination chip in the corner ("01/04"). */
  index: string;
  /** Section label ("PROJECTS"). */
  label: string;
  /** Big number value. */
  value: number | string;
  /** Suffix shown next to the number ("SHIPPED", "OPEN"). */
  suffix?: string;
  /** Sub-line under the number ("TOOLS & GAMES"). */
  subtitle?: string;
  /** Tightens padding/typography for compact layouts (mobile 2×2). */
  compact?: boolean;
  className?: string;
}

/**
 * Stat tile primitive used in the four-up rows on profile, collab, and
 * other dashboard surfaces. Renders a `Chonk` surface with three
 * vertical bands: corner-paginated label, big number + suffix, and a
 * muted subtitle. Compact mode tightens padding/typography for mobile
 * 2×2 grids.
 */
export function StatCard({
  index,
  label,
  value,
  suffix,
  subtitle,
  compact = false,
  className,
}: StatCardProps) {
  return (
    <Chonk
      variant="surface"
      size="lg"
      className={cn(
        "relative flex flex-col gap-2",
        compact ? "px-3 py-2.5" : "px-4 py-3.5",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Text monospace size="xs" variant="muted" className="tracking-widest">
          {label}
        </Text>
        <Text
          monospace
          size="xs"
          variant="muted"
          className="tracking-widest tabular-nums opacity-70"
        >
          {index}
        </Text>
      </div>
      <div className="flex items-baseline gap-2">
        <Text
          as="span"
          monospace
          bold
          density="dense"
          className={cn("text-foreground tabular-nums", compact ? "text-3xl" : "text-4xl")}
        >
          {value}
        </Text>
        {suffix ? (
          <Text as="span" monospace size="xs" variant="muted" className="tracking-widest">
            {suffix}
          </Text>
        ) : null}
      </div>
      {subtitle ? (
        <Text as="div" monospace size="xs" variant="muted" className="tracking-widest">
          {subtitle}
        </Text>
      ) : null}
    </Chonk>
  );
}
