import { StatCard } from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";

import type { ProfileStats } from "./helpers";

interface ProfileStatsProps {
  stats: ProfileStats;
  /** Tightens padding/typography for the mobile 2×2 grid. */
  compact?: boolean;
}

/**
 * The four-up tile row: PROJECTS / JAMS / SKILLS / STREAK. Each tile is
 * the shared `StatCard` primitive so the row reads as a single coded
 * block. Mobile collapses to 2×2 via `compact`.
 */
export function ProfileStatsRow({ stats, compact = false }: ProfileStatsProps) {
  return (
    <div className={cn("grid gap-3", compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4")}>
      <StatCard
        index="01/04"
        label="PROJECTS"
        value={pad2(stats.projectsShipped)}
        suffix="SHIPPED"
        subtitle={stats.projectsLabel}
        compact={compact}
      />
      <StatCard
        index="02/04"
        label="JAMS"
        value={pad2(stats.jamsEntered)}
        suffix="ENTERED"
        subtitle={stats.jamsBestRank ? `BEST RANK · ${stats.jamsBestRank}` : "—"}
        compact={compact}
      />
      <StatCard
        index="03/04"
        label="SKILLS"
        value={pad2(stats.skillsListed)}
        suffix="LISTED"
        subtitle={
          stats.skillsPendingCount > 0 ? `${stats.skillsPendingCount} PENDING` : "ALL ACTIVE"
        }
        compact={compact}
      />
      <StatCard
        index="04/04"
        label="STREAK"
        value={stats.streakDays}
        suffix="DAYS"
        subtitle={stats.streakStatus.toUpperCase()}
        compact={compact}
      />
    </div>
  );
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
