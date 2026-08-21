import { motion } from "framer-motion";
import { useMemo, useState } from "react";

import { FeaturedJamPanel, FeaturedJamPanelSkeleton } from "@/components/home/FeaturedJamPanel";
import type { HeroJam } from "@/components/home/hero-jam";
import { useRecentEntries } from "@/components/home/use-recent-entries";
import { PageStack } from "@/components/ui/page-motion";
import { useLaneRelease } from "@/hooks/use-lane-release";
import { fadeUp } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { buildBoard } from "../board/build-board";
import { JamBoard } from "../JamBoard";
import { useJamsPage } from "../jams-context";
import { JamsToolbar } from "../JamsToolbar";

/**
 * `/jams` — the ranked discovery board, the section's landing view.
 *
 * Two panes on the same frame as the collab board: the phase shelves in
 * the lane on the left, and the featured tier as the homepage's jam
 * panel on the right, sticky beside the lane, carouselling through the
 * jams the old horizontal rail held. Below `lg` the panel stacks on top,
 * where the rail used to sit.
 */
export function JamBoardView() {
  const { board, now, search, boardSort, boardLayout } = useJamsPage();

  // A callback ref rather than a `useRef`: the bar remounts with the
  // loading/loaded swap, and each mount has to re-measure.
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);
  const laneRelease = useLaneRelease(toolbarEl);

  const { featured, shelves } = useMemo(
    () => buildBoard(board.jams, now, boardSort),
    [board.jams, now, boardSort],
  );

  const heroes = useMemo<HeroJam[]>(
    () => featured.map((jam) => ({ jam, source: "ranked" })),
    [featured],
  );

  // Content-keyed rather than mapped off `featured` directly: the ticking
  // clock rebuilds the board every second, and a fresh array identity per
  // tick would churn the entries query's memoized options for no change.
  const entryIdsKey = featured.map((jam) => jam.jamId).join(",");
  const entryJamIds = useMemo(
    () => (entryIdsKey === "" ? [] : entryIdsKey.split(",").map(Number)),
    [entryIdsKey],
  );
  const { byJamId: entriesByJamId } = useRecentEntries(entryJamIds);

  const panel = board.isLoading ? (
    <FeaturedJamPanelSkeleton density="compact" />
  ) : heroes.length > 0 ? (
    <FeaturedJamPanel heroes={heroes} entriesByJamId={entriesByJamId} now={now} density="compact" />
  ) : null;

  return (
    <PageStack>
      <motion.div
        variants={fadeUp}
        className={cn(
          "flex flex-col gap-8",
          // Same split as the collab board. Explicit placement because the
          // panel leads the DOM order (it stacks on top below `lg`) but
          // belongs in the right column once there's room.
          panel &&
            "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(360px,360px)] lg:items-start lg:gap-6",
        )}
      >
        {panel && (
          // `z-30`, one over the toolbar band: the collab inspector wins that
          // overlap by DOM order, but here the panel leads the DOM so it
          // stacks on top below `lg`. `mt-4` pays the sticky inset in flow.
          <aside className="header-follow z-30 lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1 lg:mt-4">
            {panel}
          </aside>
        )}
        <section className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">
          {/* Same band as the collab board's toolbar: pinned under the app
              header, riding with it, carrying its surface so the shelves
              pass behind an opaque band. The pseudo-element extends that
              background across the panel column. */}
          <div
            ref={setToolbarEl}
            className="header-follow toolbar-band sticky top-0 z-20 lg:before:absolute lg:before:inset-y-0 lg:before:left-full lg:before:w-96 lg:before:bg-background lg:before:content-['']"
            style={{ marginBottom: laneRelease }}
          >
            <JamsToolbar />
          </div>
          {/* The wrapper hands the overhang back so it takes no space in flow. */}
          <div style={{ marginTop: -laneRelease }}>
            <JamBoard
              shelves={shelves}
              total={board.jams.length}
              now={now}
              isLoading={board.isLoading}
              searching={search.trim() !== ""}
              layout={boardLayout}
            />
          </div>
        </section>
      </motion.div>
    </PageStack>
  );
}
