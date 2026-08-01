import { useEffect } from "react";

import { JamBoard } from "../JamBoard";
import { useJamsPage } from "../jams-context";
import { JamsToolbar } from "../JamsToolbar";
import type { StatKey } from "../shared-types";

/** `/jams` — the ranked discovery board, the section's landing view. */
export function JamBoardView() {
  const { board, now, search, boardSort, boardLayout, pendingShelf, clearPendingShelf } =
    useJamsPage();

  usePendingShelfScroll(pendingShelf, board.isLoading, clearPendingShelf);

  return (
    <JamBoard
      jams={board.jams}
      now={now}
      isLoading={board.isLoading}
      searching={search.trim() !== ""}
      sort={boardSort}
      layout={boardLayout}
      // The toolbar sits *inside* the board, below the featured rail —
      // featured jams are the page's headline and shouldn't be pushed
      // under a filter row.
      toolbar={<JamsToolbar />}
    />
  );
}

/**
 * Scrolls to the shelf a hero stat tile asked for. This lives on the
 * board route rather than in the provider so the shelf anchors are
 * guaranteed to be in the DOM by the time the effect runs.
 */
function usePendingShelfScroll(shelf: StatKey | null, isLoading: boolean, clear: () => void): void {
  useEffect(() => {
    if (!shelf || isLoading) return;
    const jump = () =>
      document
        .getElementById(`shelf-${shelf}`)
        // Instant, not smooth: in-flight smooth scrolls get canceled by
        // other scroll writes in the app shell and silently go nowhere.
        ?.scrollIntoView({ behavior: "instant", block: "start" });
    jump();
    // Consume the request immediately — a re-assert that never runs (a
    // backgrounded tab throttles frames) must not leave the shelf parked
    // and re-scrolling out from under the user on later renders.
    clear();
    // Re-assert once on the next frame: when the click came from another
    // view, the route's transition can still be settling over this
    // commit and shift the shelf back out of place.
    const frame = requestAnimationFrame(jump);
    return () => cancelAnimationFrame(frame);
  }, [shelf, isLoading, clear]);
}
