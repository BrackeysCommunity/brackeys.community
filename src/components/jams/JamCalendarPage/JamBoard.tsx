import { LayoutGroup } from "framer-motion";
import { type ReactNode, useMemo, useState } from "react";

import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import { BoardSkeleton } from "./board/BoardSkeleton";
import { type BoardLayout, type BoardSort, buildBoard } from "./board/build-board";
import { FeaturedShelf } from "./board/FeaturedShelf";
import { JamCard } from "./board/JamCard";
import { ShelfHeader } from "./board/ShelfHeader";
import { ShelfRow } from "./board/ShelfRow";
import { type JamFromList, type ShelfKind } from "./helpers";
import { JamDetailModal } from "./JamDetailModal";

interface ShelfMeta {
  kind: ShelfKind;
  title: string;
  blurb: string;
}

const SHELVES: ShelfMeta[] = [
  { kind: "live", title: "LIVE NOW", blurb: "running — join and submit before the deadline" },
  { kind: "upcoming", title: "UPCOMING", blurb: "join now, starts soon" },
  { kind: "voting", title: "VOTING", blurb: "submissions closed — play and rate the games" },
  { kind: "ongoing", title: "ONGOING", blurb: "perpetual jams and community hubs" },
];

interface JamBoardProps {
  jams: JamFromList[];
  now: Date;
  isLoading: boolean;
  /** Search active — collapse thresholds are bypassed so every match
   * is visible. */
  searching: boolean;
  sort: BoardSort;
  layout: BoardLayout;
  /** The search rail, rendered below the featured carousel so the
   * headline jams stay at the top of the page. */
  toolbar: ReactNode;
}

/**
 * The default jams surface: a phase-segmented, signal-ranked discovery
 * board. A featured carousel up top, then the search rail, then one
 * shelf per phase; within each shelf jams rank by the phase-appropriate
 * participation metric, and the zero-signal long tail collapses behind
 * a per-shelf expander. Shelves render as card grids by default with a
 * list toggle for dense scanning.
 */
export function JamBoard({
  jams,
  now,
  isLoading,
  searching,
  sort,
  layout,
  toolbar,
}: JamBoardProps) {
  const [selected, setSelected] = useState<{ jam: JamFromList; layoutKey: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<ShelfKind, boolean>>({
    live: false,
    upcoming: false,
    voting: false,
    ongoing: false,
  });

  const { featured, shelves } = useMemo(() => buildBoard(jams, now, sort), [jams, now, sort]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-8">
        {toolbar}
        <BoardSkeleton />
      </div>
    );
  }

  if (jams.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        {toolbar}
        <Text
          as="div"
          size="sm"
          variant="muted"
          align="center"
          className="p-12 tracking-widest uppercase"
        >
          {searching ? "No jams match that search" : "No active jams tracked right now"}
        </Text>
      </div>
    );
  }

  return (
    <LayoutGroup>
      <div className="flex flex-col gap-10">
        {featured.length > 0 && (
          <FeaturedShelf
            jams={featured}
            now={now}
            selectedKey={selected?.layoutKey ?? null}
            onSelect={(jam, layoutKey) => setSelected({ jam, layoutKey })}
          />
        )}

        {toolbar}

        {SHELVES.map((meta) => {
          const shelf = shelves[meta.kind];
          if (shelf.ranked.length === 0 && shelf.tail.length === 0) return null;
          // ONGOING is all tail by design — perpetual jams never headline.
          const showAll = searching || expanded[meta.kind];
          const visible = showAll ? [...shelf.ranked, ...shelf.tail] : shelf.ranked;
          const hidden = showAll ? 0 : shelf.tail.length;
          return (
            <section
              key={meta.kind}
              id={`shelf-${meta.kind}`}
              className="flex scroll-mt-24 flex-col gap-3"
            >
              <ShelfHeader
                title={meta.title}
                blurb={meta.blurb}
                count={shelf.ranked.length + shelf.tail.length}
              />
              {visible.length === 0 ? (
                <Text size="xs" variant="muted" className="px-1 tracking-widest uppercase">
                  Only small jams here —{" "}
                  <button
                    type="button"
                    className="cursor-pointer underline decoration-accent/50 underline-offset-2 hover:decoration-accent"
                    onClick={() => setExpanded((e) => ({ ...e, [meta.kind]: true }))}
                  >
                    show all {shelf.tail.length}
                  </button>
                </Text>
              ) : (
                <ShelfJams
                  kind={meta.kind}
                  jams={visible}
                  now={now}
                  layout={layout}
                  selectedKey={selected?.layoutKey ?? null}
                  onSelect={(jam, layoutKey) => setSelected({ jam, layoutKey })}
                />
              )}
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded((e) => ({ ...e, [meta.kind]: true }))}
                  className="cursor-pointer self-start rounded-md border border-muted/30 bg-card px-3 py-1.5 font-mono text-[11px] tracking-widest text-muted-foreground transition-colors hover:border-muted/60 hover:text-foreground"
                >
                  + {hidden} MORE SMALL JAM{hidden === 1 ? "" : "S"}
                </button>
              )}
            </section>
          );
        })}

        <JamDetailModal
          jam={selected?.jam ?? null}
          layoutKey={selected?.layoutKey ?? null}
          onClose={() => setSelected(null)}
        />
      </div>
    </LayoutGroup>
  );
}

/** One shelf's jams in the active layout — a responsive card grid, or
 * the dense bordered list. */
function ShelfJams({
  kind,
  jams,
  now,
  layout,
  selectedKey,
  onSelect,
}: {
  kind: ShelfKind;
  jams: JamFromList[];
  now: Date;
  layout: BoardLayout;
  selectedKey: string | null;
  onSelect: (jam: JamFromList, layoutKey: string) => void;
}) {
  if (layout === "cards") {
    // Column count comes from the available width rather than a
    // breakpoint ladder: cards hold a ~17rem floor and the grid fits as
    // many as it can, so ultrawide displays keep gaining columns instead
    // of stretching four cards across 1900px. `min(...,100%)` keeps the
    // floor from overflowing viewports narrower than a single card.
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(17rem,100%),1fr))] gap-3">
        {jams.map((jam) => {
          const layoutKey = `${kind}-${jam.jamId}`;
          return (
            <JamCard
              key={jam.jamId}
              jam={jam}
              now={now}
              layoutKey={layoutKey}
              isSelected={selectedKey === layoutKey}
              onSelect={() => onSelect(jam, layoutKey)}
            />
          );
        })}
      </div>
    );
  }
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-muted/20">
      {jams.map((jam, i) => {
        const layoutKey = `${kind}-${jam.jamId}`;
        return (
          <div key={jam.jamId} className={cn(i > 0 && "border-t border-muted/20")}>
            <ShelfRow
              jam={jam}
              now={now}
              layoutKey={layoutKey}
              isSelected={selectedKey === layoutKey}
              onSelect={() => onSelect(jam, layoutKey)}
            />
          </div>
        );
      })}
    </div>
  );
}
