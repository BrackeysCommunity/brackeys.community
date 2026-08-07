import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { useHomeDestinations, type HomeDestination } from "@/components/home/use-home-destinations";
import { GraphPaper } from "@/components/ui/graph-paper";
import { Heading, Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import { Chonk } from "../ui/chonk";

interface FeatureRailProps {
  liveCount: number;
  upcomingCount: number;
  isLoadingJams: boolean;
}

/**
 * The four destinations.
 *
 * These used to be 280px-tall cards with hover-revealed sparklines sitting
 * directly under the wordmark — they read as the page's main content and
 * pushed the jam below the fold. The current tile is the middle setting:
 * tall enough to give the number real weight, short enough that four of
 * them still read as a rail rather than as the page's content.
 *
 * Every stat here is live, and comes from `useHomeDestinations` so the
 * mobile chip row is making the same four claims. The old cards showed
 * `312`, `50+`, `58` and `LV 14`, all hard-coded and all wrong by the time
 * anyone read them.
 */
export function FeatureRail({ liveCount, isLoadingJams }: FeatureRailProps) {
  const destinations = useHomeDestinations(liveCount, isLoadingJams);

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {destinations.map((d) => (
        <FeatureTile
          key={d.to}
          to={d.to}
          icon={d.icon}
          title={d.title}
          stat={d.stat}
          statLabel={d.statLabel}
        />
      ))}
    </div>
  );
}

interface FeatureTileProps {
  to: HomeDestination["to"];
  icon: IconSvgElement;
  title: string;
  stat: string;
  statLabel: string;
}

function FeatureTile({ to, icon, title, stat, statLabel }: FeatureTileProps) {
  // Counts get the display size; anything wordier would wrap or truncate
  // there, so words drop a step.
  const isCount = /^[\d,]+$/.test(stat);

  return (
    <Chonk
      variant="surface"
      render={<Link to={to} />}
      aria-label={title}
      className="group/tile align-start flex min-h-28 min-w-0 flex-col justify-between gap-4 overflow-hidden p-4"
    >
      <GraphPaper fade="bottom-right" fadeStop="90%" size={12} />
      <div className="relative flex min-w-0 items-center gap-2.5">
        <HugeiconsIcon
          icon={icon}
          size={24}
          className="shrink-0 text-muted-foreground transition-colors group-hover/tile:text-accent"
        />
        <Heading
          as="h3"
          size="sm"
          ellipsis
          className="min-w-0 tracking-wide transition-colors group-hover/tile:text-accent"
        >
          {title}
        </Heading>
      </div>

      {/* Caption above value, same as the jam rows' `Stat` — the number is
          the thing being read, so nothing sits between it and the edge. */}
      <div className="relative min-w-0">
        <Text as="div" size="sm" ellipsis density="dense" className="tracking-wide">
          {statLabel}
        </Text>
        <Text
          as="div"
          bold
          ellipsis
          density="dense"
          className={cn("mt-1 text-accent tabular-nums", isCount ? "text-4xl" : "text-2xl")}
        >
          {stat}
        </Text>
      </div>
    </Chonk>
  );
}
