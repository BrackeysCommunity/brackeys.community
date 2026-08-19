import { Rail } from "@/components/ui/rail";
import { ShelfHeader } from "@/components/ui/shelf-header";
import { Skeleton } from "@/components/ui/skeleton";

/** Featured tile: `h-52` of banner over a four-line body — see
 * `FeaturedCard`. Shelf tile: `h-40` of banner over the same body
 * one line shorter — see `JamCard`. Both are held here because a
 * placeholder that is the wrong height moves the whole page when the
 * data lands, which is the thing it exists to prevent. */
const FEATURED_TILE = "h-80 w-80 shrink-0 sm:w-96";
const SHELF_TILE = "h-68 w-full";

/** Same auto-fill ladder the real shelves use (`ShelfJams`), so the
 * column count doesn't change under the swap either. */
const SHELF_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(17rem,100%),1fr))] gap-3";

/**
 * The featured rail's placeholder, on the real `Rail` so the heading,
 * gutters and edge fades are the ones that will still be there once the
 * jams arrive — only the tiles are stand-ins.
 */
export function FeaturedShelfSkeleton() {
  return (
    <Rail title="FEATURED" blurb="the biggest jams on the board" label="featured jams">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className={FEATURED_TILE} />
      ))}
    </Rail>
  );
}

/** The phase shelves below the toolbar. Two of the four: the board
 * rarely fills all of them, and a short placeholder growing is a better
 * miss than a tall one collapsing. */
export function BoardShelvesSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      {["LIVE NOW", "UPCOMING"].map((title) => (
        <div key={title} className="flex flex-col gap-3">
          <ShelfHeader title={title} />
          <div className={SHELF_GRID}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className={SHELF_TILE} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
