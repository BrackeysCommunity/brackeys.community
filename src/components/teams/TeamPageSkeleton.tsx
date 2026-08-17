import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Well } from "@/components/ui/well";

/**
 * Holds the team page's shape while `getTeam` resolves: notched
 * masthead, roster grid, stack chips, showcase. Mirrors `TeamPage`'s
 * section rhythm so the real content lands where the placeholder sat.
 */
export function TeamPageSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy role="status" aria-label="Loading team">
      <Well notchOpts surfaceClassName="bg-card backdrop-blur-none">
        <div className="relative flex flex-col gap-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            <div className="flex min-w-64 flex-1 items-start gap-4">
              <Skeleton className="size-16 shrink-0 rounded-full bg-muted/50" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-24 bg-muted/50" />
                <Skeleton className="h-7 w-56 bg-muted/50" />
                <Skeleton className="h-4 w-full max-w-prose bg-muted/50" />
              </div>
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 w-24 bg-muted/50" />
              <Skeleton className="h-8 w-24 bg-muted/50" />
            </div>
          </div>
          <div className="flex flex-wrap gap-6">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-6 w-10 bg-muted/50" />
                <Skeleton className="h-3 w-16 bg-muted/50" />
              </div>
            ))}
          </div>
        </div>
      </Well>

      <SectionSkeleton>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[62px] w-full bg-muted/50" />
          ))}
        </div>
      </SectionSkeleton>

      <SectionSkeleton>
        <div className="flex flex-wrap gap-1.5">
          {["w-16", "w-20", "w-14", "w-24", "w-16", "w-20"].map((w, i) => (
            <Skeleton key={i} className={`h-5 bg-muted/50 ${w}`} />
          ))}
        </div>
      </SectionSkeleton>

      <SectionSkeleton>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-52 w-full bg-muted/50" />
          ))}
        </div>
      </SectionSkeleton>

      <SectionSkeleton>
        <SkeletonText lines={2} />
      </SectionSkeleton>
    </div>
  );
}

/** `TeamPage`'s `Section` heading — dashed rule, no words. */
function SectionSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 border-b border-dashed border-muted-foreground/25 pb-1.5">
        <Skeleton className="h-3 w-24 bg-muted/50" />
      </div>
      {children}
    </div>
  );
}
