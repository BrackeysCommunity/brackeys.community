import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Well } from "@/components/ui/well";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * Holds the profile's shape while `getProfile` resolves — hero card,
 * then the desktop two-column body or the mobile stack. It mirrors
 * `ProfileDesktop`/`ProfileMobile` closely enough that the real page
 * settles into the same slots instead of shoving the fold around.
 */
export function ProfilePageSkeleton() {
  const isMobile = useIsMobile();

  return (
    <div className="flex flex-col gap-8" aria-busy role="status" aria-label="Loading profile">
      <HeroSkeleton compact={isMobile} />

      {isMobile ? (
        <div className="flex flex-col gap-6">
          <SectionSkeleton>
            <SkeletonText lines={3} />
          </SectionSkeleton>
          <SectionSkeleton>
            <ChipRowSkeleton />
          </SectionSkeleton>
          <SectionSkeleton>
            <Skeleton className="h-32 w-full bg-muted/50" />
          </SectionSkeleton>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2.4fr)_minmax(19rem,1fr)]">
          <div className="flex min-w-0 flex-col gap-8">
            <Skeleton className="h-12 w-full bg-muted/50" />
            <SectionSkeleton>
              <Skeleton className="h-28 w-full bg-muted/50" />
            </SectionSkeleton>
            <SectionSkeleton>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-40 w-full bg-muted/50" />
                ))}
              </div>
            </SectionSkeleton>
            <SectionSkeleton>
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-14 w-full bg-muted/50" />
                ))}
              </div>
            </SectionSkeleton>
          </div>

          <div className="flex flex-col gap-6">
            <SectionSkeleton>
              <SkeletonText lines={3} />
            </SectionSkeleton>
            <SectionSkeleton>
              <Skeleton className="h-20 w-full bg-muted/50" />
            </SectionSkeleton>
            <SectionSkeleton>
              <ChipRowSkeleton count={4} />
            </SectionSkeleton>
            <SectionSkeleton>
              <ChipRowSkeleton />
            </SectionSkeleton>
          </div>
        </div>
      )}
    </div>
  );
}

function HeroSkeleton({ compact }: { compact: boolean }) {
  return (
    <Well className="overflow-hidden p-0">
      <Skeleton className={compact ? "h-16 w-full bg-muted/50" : "h-28 w-full bg-muted/50"} />
      <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5 sm:pb-5">
        <div className="flex items-start justify-between gap-4">
          <Skeleton
            className={
              compact ? "size-16 rounded-full bg-muted/50" : "size-24 rounded-full bg-muted/50"
            }
          />
          <div className="flex gap-2 pt-3">
            <Skeleton className="h-7 w-20 bg-muted/50" />
            <Skeleton className="h-7 w-20 bg-muted/50" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-56 bg-muted/50" />
          <Skeleton className="h-4 w-full max-w-prose bg-muted/50" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-40 bg-muted/50" />
          ))}
        </div>
      </div>
    </Well>
  );
}

/** The dotted-rule heading from `ProfileSectionHeader`, minus the words. */
function SectionSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-8 bg-muted/50" />
        <Skeleton className="h-4 w-28 bg-muted/50" />
        <div aria-hidden className="flex-1 border-t border-dashed border-muted-foreground/30" />
      </div>
      {children}
    </div>
  );
}

function ChipRowSkeleton({ count = 6 }: { count?: number }) {
  const widths = ["w-16", "w-20", "w-14", "w-24", "w-18", "w-16"];
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={`h-5 bg-muted/50 ${widths[i % widths.length]}`} />
      ))}
    </div>
  );
}
