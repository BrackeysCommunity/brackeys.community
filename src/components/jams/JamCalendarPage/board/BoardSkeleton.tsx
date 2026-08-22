import { ShelfHeader } from "@/components/ui/shelf-header";
import { Skeleton } from "@/components/ui/skeleton";

/** Shelf tile: `h-40` of banner over a three-line body — see `JamCard`.
 * Held here because a placeholder that is the wrong height moves the
 * whole page when the data lands, which is the thing it exists to
 * prevent. */
const SHELF_TILE = "h-68 w-full";

/** Same auto-fill ladder the real shelves use (`ShelfJams`), so the
 * column count doesn't change under the swap either. */
const SHELF_GRID =
  "grid grid-cols-[repeat(auto-fill,minmax(max(min(17rem,100%),calc((100%_-_1.5rem)/3)),1fr))] gap-3";

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
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className={SHELF_TILE} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
