import { ArrowRight02Icon, Calendar03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { FeaturedJamCarousel } from "@/components/home/FeaturedJamCarousel";
import { UpcomingJamList } from "@/components/home/UpcomingJamList";
import { useHomeJams } from "@/components/jams/JamCalendarPage/use-jam-data";
import { Chonk } from "@/components/ui/chonk";
import { Link, Text } from "@/components/ui/typography";
import useDateNow from "@/lib/hooks/use-date-now";

const UPCOMING_LIMIT = 6;

export function JamsLandingSection() {
  const now = useDateNow();
  const nowDate = new Date(now);

  const { isLoading, featured, upcoming, liveCount, upcomingCount } = useHomeJams(now);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <Text as="div" size="xs" variant="muted" className="tracking-widest">
            § 01
          </Text>
          <h2 className="font-display text-3xl font-bold tracking-tight">JAMS</h2>
          <p className="mt-1 font-sans text-sm text-muted-foreground">
            Tracking {liveCount} live and {upcomingCount} upcoming jams across itch.io.
          </p>
        </div>
        <Chonk
          variant="surface"
          size="sm"
          render={<Link as="router" to="/jams" aria-label="Full calendar" />}
          className="flex items-center gap-2 px-3 py-2 text-[11px] font-bold tracking-widest text-muted-foreground hover:text-primary"
        >
          <HugeiconsIcon icon={Calendar03Icon} size={14} />
          FULL CALENDAR
          <HugeiconsIcon icon={ArrowRight02Icon} size={12} />
        </Chonk>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <FeaturedJamCarousel jams={featured} isLoading={isLoading} density="comfortable" />

        <UpcomingJamList
          jams={upcoming}
          isLoading={isLoading}
          now={nowDate}
          limit={UPCOMING_LIMIT}
          density="comfortable"
          headerRight={
            <Link as="router" to="/jams" variant="inherit" className="hover:text-primary">
              View all
            </Link>
          }
        />
      </div>
    </section>
  );
}
