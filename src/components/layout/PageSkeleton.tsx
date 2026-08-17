import { Skeleton } from "@/components/ui/skeleton";

/**
 * The generic page placeholder behind the router's `pendingComponent`.
 * It can't know which route is arriving, so it draws the shape every
 * page in the app shares — a title block over a card grid — rather
 * than a word in the middle of an empty screen.
 */
export function PageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-8" aria-busy role="status" aria-label="Loading page">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24 bg-muted/50" />
        <Skeleton className="h-8 w-64 max-w-full bg-muted/50" />
        <Skeleton className="h-4 w-full max-w-prose bg-muted/50" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-42 w-full bg-muted/50" />
        ))}
      </div>
    </div>
  );
}
