import { Rail } from "@/components/ui/rail";

import type { JamFromList } from "../helpers";
import { FeaturedCard } from "./FeaturedCard";

/** Layout key a featured card publishes to the shared-layout morph. */
const featuredKey = (jam: JamFromList) => `feat-${jam.jamId}`;

/**
 * The featured shelf: the board's one horizontal carousel, on the shared
 * `Rail` — heading, edge fades, paging arrows, and drag-scroll all come
 * from there. This only decides which jams are on it and hands the
 * selected card off to the detail modal's shared-layout morph.
 */
export function FeaturedShelf({
  jams,
  now,
  selectedKey,
  onSelect,
}: {
  jams: JamFromList[];
  now: Date;
  selectedKey: string | null;
  onSelect: (jam: JamFromList, layoutKey: string) => void;
}) {
  return (
    <Rail title="FEATURED" blurb="the biggest jams on the board" label="featured jams">
      {jams.map((jam) => {
        const layoutKey = featuredKey(jam);
        return (
          <FeaturedCard
            key={jam.jamId}
            jam={jam}
            now={now}
            layoutKey={layoutKey}
            isSelected={selectedKey === layoutKey}
            onSelect={() => onSelect(jam, layoutKey)}
          />
        );
      })}
    </Rail>
  );
}
