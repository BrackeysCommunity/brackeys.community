import { Skeleton } from "@/components/ui/skeleton";

/** Card-grid placeholder for the members/teams directories — the same
 * three-column rhythm their loaded grids use. */
export function DirectorySkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
        <Skeleton key={i} className="h-42 w-full" />
      ))}
    </div>
  );
}
