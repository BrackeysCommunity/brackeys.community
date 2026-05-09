import { Chonk } from "@/components/ui/chonk";
import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import type { ProfileStats } from "./helpers";

interface ProfileStatsProps {
  stats: ProfileStats;
  /** Tightens padding/typography for the mobile 2×2 grid. */
  compact?: boolean;
}

interface StatTileSpec {
  /** Two-digit pagination chip in the corner ("01/04"). */
  index: string;
  /** Section label ("PROJECTS"). */
  label: string;
  /** Big number value. */
  value: number | string;
  /** Suffix shown next to the number ("SHIPPED", "ENTERED"). */
  suffix: string;
  /** Sub-line under the number ("TOOLS & GAMES"). */
  subtitle: string;
}

/**
 * The four-up tile row: PROJECTS / JAMS / SKILLS / STREAK. Each tile
 * is a `Chonk` surface with the same internal grid so the row reads
 * as a single coded block. Mobile collapses to 2×2 via `compact`.
 */
export function ProfileStatsRow({ stats, compact = false }: ProfileStatsProps) {
  const tiles: StatTileSpec[] = [
    {
      index: "01/04",
      label: "PROJECTS",
      value: pad2(stats.projectsShipped),
      suffix: "SHIPPED",
      subtitle: stats.projectsLabel,
    },
    {
      index: "02/04",
      label: "JAMS",
      value: pad2(stats.jamsEntered),
      suffix: "ENTERED",
      subtitle: stats.jamsBestRank ? `BEST RANK · ${stats.jamsBestRank}` : "—",
    },
    {
      index: "03/04",
      label: "SKILLS",
      value: pad2(stats.skillsListed),
      suffix: "LISTED",
      subtitle: stats.skillsPendingCount > 0 ? `${stats.skillsPendingCount} PENDING` : "ALL ACTIVE",
    },
    {
      index: "04/04",
      label: "STREAK",
      value: stats.streakDays,
      suffix: "DAYS",
      subtitle: stats.streakStatus.toUpperCase(),
    },
  ];

  return (
    <div className={cn("grid gap-3", compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4")}>
      {tiles.map((tile) => (
        <StatTile key={tile.label} tile={tile} compact={compact} />
      ))}
    </div>
  );
}

function StatTile({ tile, compact }: { tile: StatTileSpec; compact: boolean }) {
  return (
    <Chonk
      variant="surface"
      size="lg"
      className={cn("relative flex flex-col gap-2", compact ? "px-3 py-2.5" : "px-4 py-3.5")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Text monospace size="xs" variant="muted" className="tracking-widest">
          {tile.label}
        </Text>
        <Text
          monospace
          size="xs"
          variant="muted"
          className="tracking-widest tabular-nums opacity-70"
        >
          {tile.index}
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
          {tile.value}
        </Text>
        <Text as="span" monospace size="xs" variant="muted" className="tracking-widest">
          {tile.suffix}
        </Text>
      </div>
      <Text as="div" monospace size="xs" variant="muted" className="tracking-widest">
        {tile.subtitle}
      </Text>
    </Chonk>
  );
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
