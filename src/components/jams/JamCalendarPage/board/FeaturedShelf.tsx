import { Rail } from "@/components/ui/rail";

import type { JamFromList } from "../helpers";
import { FeaturedCard } from "./FeaturedCard";

/**
 * The featured shelf: the board's one horizontal carousel, on the shared
 * `Rail` — heading, edge fades, paging arrows, and drag-scroll all come
 * from there. This only decides which jams are on it.
 */
export function FeaturedShelf({ jams, now }: { jams: JamFromList[]; now: Date }) {
  return (
    <Rail title="FEATURED" blurb="the biggest jams on the board" label="featured jams">
      {jams.map((jam) => (
        <FeaturedCard key={jam.jamId} jam={jam} now={now} />
      ))}
    </Rail>
  );
}
