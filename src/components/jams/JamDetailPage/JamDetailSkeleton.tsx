import { Skeleton } from "@/components/ui/skeleton";
import { Well } from "@/components/ui/well";

/**
 * Placeholder for a jam page while its loader is in flight.
 *
 * The page loads server-side (see `routes/jams_.$jamSlug.tsx`), so a
 * click from the board waits on a round trip; this is what stands in for
 * it. Shaped to `JamDetailPage`'s running order — hero well, CTA rail,
 * then sections — so the real page settles into the same boxes
 * rather than shoving them around.
 */
export function JamDetailSkeleton() {
  return (
    <div className="flex flex-col gap-8 pb-8" aria-busy role="status" aria-label="Loading jam">
      <Well className="overflow-hidden p-0">
        {/* The banner's own ladder, from `JamDetailHero`. */}
        <Skeleton className="h-44 w-full rounded-none sm:h-56 lg:h-72" />
        <div className="flex flex-col gap-4 p-4 sm:p-6">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-28" />
            </div>
            <Skeleton className="h-9 w-3/4 max-w-lg" />
          </div>
          <Skeleton className="h-2 w-full" />
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-24" />
            ))}
          </div>
        </div>
      </Well>

      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-32" />
      </div>

      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-32 w-full" />
        </div>
      ))}
    </div>
  );
}
