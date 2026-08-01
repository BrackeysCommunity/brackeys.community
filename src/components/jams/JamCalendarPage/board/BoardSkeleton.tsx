import { Skeleton } from "@/components/ui/skeleton";

export function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48 rounded" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-84 w-80 shrink-0 rounded-lg sm:w-96" />
          ))}
        </div>
      </div>
      {Array.from({ length: 2 }).map((_, s) => (
        <div key={s} className="flex flex-col gap-3">
          <Skeleton className="h-8 w-40 rounded" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-52 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
