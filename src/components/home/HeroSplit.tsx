import { ArrowRight02Icon, Calendar03Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { CyclingWord } from "@/components/home/CyclingWord";
import {
  FeaturedJamPanel,
  FeaturedJamPanelSkeleton,
  type HeroJam,
} from "@/components/home/FeaturedJamPanel";
import { HeroWordmark } from "@/components/home/HeroWordmark";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

interface HeroSplitProps {
  hero: HeroJam | null;
  isLoading: boolean;
  now: Date;
}

/**
 * The split hero: the pitch on the left, the live jam on the right.
 *
 * The old hero sold navigation — four equal-weight node cards — which put
 * the thing visitors actually arrive for (the jam) below the fold and
 * behind a section header. Here the pitch keeps its wordmark, and the jam
 * gets the other half of the fold.
 *
 * When there is no jam to promote at all, the panel collapses and the
 * pitch takes the full width rather than holding open an empty column.
 */
export function HeroSplit({ hero, isLoading, now }: HeroSplitProps) {
  const showPanel = isLoading || hero != null;

  return (
    <div
      className={cn(
        "grid items-center gap-8",
        showPanel && "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]",
      )}
    >
      <div className="flex flex-col items-start gap-6">
        <div className="mt-8 lg:mt-12">
          <HeroWordmark primary={<CyclingWord />} secondary="GAMES" />
        </div>

        <p className="max-w-xl font-sans text-sm text-foreground [text-shadow:0_1px_3px_rgba(0,0,0,0.75)] lg:text-base">
          The central neural network for the Brackeys game dev community. Find your squad, browse
          every jam on itch, and deploy your build with a crew that ships.
        </p>

        <div className="flex flex-wrap gap-3">
          {/* `h-11` over the `lg` size's `h-9`: these two carry the fold, and
              at default button height they read as toolbar controls. */}
          <Button
            variant="default"
            size="lg"
            nativeButton={false}
            render={<Link as="router" to="/collab" aria-label="Find a crew" />}
            className="h-11 gap-2 px-5 font-bold tracking-widest"
          >
            <HugeiconsIcon icon={UserGroupIcon} size={16} />
            FIND A CREW
            <HugeiconsIcon icon={ArrowRight02Icon} size={14} />
          </Button>
          <Button
            variant="outline"
            size="lg"
            nativeButton={false}
            render={<Link as="router" to="/jams" aria-label="Browse jams" />}
            className="h-11 gap-2 px-5 font-bold tracking-widest text-muted-foreground hover:text-primary"
          >
            <HugeiconsIcon icon={Calendar03Icon} size={16} />
            BROWSE JAMS
          </Button>
        </div>
      </div>

      {showPanel &&
        (hero ? <FeaturedJamPanel hero={hero} now={now} /> : <FeaturedJamPanelSkeleton />)}
    </div>
  );
}
