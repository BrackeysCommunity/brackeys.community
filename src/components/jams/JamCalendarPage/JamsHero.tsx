import { Archive02Icon, Calendar03Icon, DashboardSquare02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { GraphPaper } from "@/components/ui/graph-paper";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";

import type { ViewMode } from "./helpers";

const VIEWS: { mode: ViewMode; label: string; icon: typeof Calendar03Icon }[] = [
  { mode: "board", label: "BOARD", icon: DashboardSquare02Icon },
  { mode: "calendar", label: "CALENDAR", icon: Calendar03Icon },
  { mode: "archive", label: "ARCHIVE", icon: Archive02Icon },
];

const VIEW_BLURB: Record<ViewMode, string> = {
  board:
    "Ranked by who's actually joining — live jams first, then upcoming and voting. The long tail of small jams sits behind each shelf's fold; search reaches everything.",
  calendar: "The biggest jams drawn as bars across each week. Click any day for the full list.",
  archive:
    "Every finished jam. Sort by entries, ratings, length, or date — click a row for details.",
};

interface JamsHeroProps {
  totalJams: number;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
}

/**
 * The jam section's masthead, on the same frame as the collab and team
 * boards' heroes so the discovery surfaces read as one product. The
 * switcher moves between the section's three views — each is its own
 * route, so a chosen view is shareable and survives reload.
 */
export function JamsHero({ totalJams, view, onViewChange }: JamsHeroProps) {
  return (
    <Well
      // Keeps the app bar pinned until you scroll past — see `useHideOnScrollDown`.
      data-header-hero
      notchOpts
      // The gradient is the surface's alone — see the team hero for why
      // it can't ride on the frame.
      surfaceClassName="bg-card bg-linear-to-br from-deboss-surface via-deboss-surface to-primary/12 backdrop-blur-none"
    >
      <GraphPaper fade="bottom-left" />
      <div className="relative flex flex-wrap items-end justify-between gap-6 p-6">
        <div className="flex max-w-prose min-w-64 flex-col gap-2">
          <MicroLabel>GAME JAMS</MicroLabel>
          <Heading as="h1" className="text-2xl tracking-widest uppercase">
            Find a jam to enter
          </Heading>
          <Text size="sm" variant="muted">
            Tracking {totalJams.toLocaleString()} jams across itch.io. {VIEW_BLURB[view]}
          </Text>
        </div>
        <SegmentedControl
          value={view}
          onChange={(v) => onViewChange(v as ViewMode)}
          aria-label="Jam views"
        >
          {VIEWS.map(({ mode, label, icon }) => (
            <SegmentedControl.Item
              key={mode}
              value={mode}
              icon={<HugeiconsIcon icon={icon} size={14} />}
              className="px-4 tracking-widest"
            >
              {label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </div>
    </Well>
  );
}
