import { useMemo } from "react";

import { useHomeDashboard } from "@/components/home/dashboard/use-home-dashboard";
import { selectShowcaseJams } from "@/components/home/JamShowcaseBand";
import { entryJamIdsFor, useRecentEntries } from "@/components/home/use-recent-entries";
import { useHomeJams } from "@/components/jams/JamCalendarPage/use-jam-data";
import useDateNow from "@/lib/hooks/use-date-now";

/**
 * Everything both landing pages decide before they render anything: which
 * jam leads, which ones fill the band, and whether the viewer has a hub
 * worth showing.
 *
 * `HomePage` and `MobileHome` stay separate components because their hero
 * and navigation are different components, not different props — but the
 * reasoning above the markup was identical in both, seven statements copied
 * byte for byte, and that is the half that drifts. It drifted twice while
 * the dashboard was being built: once on `showDashboard`, and once on where
 * the dashboard sits in the page, which left the two devices arguing for
 * different hierarchies while `MobileHome`'s own comment claimed they
 * couldn't. One brain, two layouts.
 */
export function useHomeContent() {
  const now = useDateNow();
  const nowDate = useMemo(() => new Date(now), [now]);

  const { isLoading, featured, upcoming, heroSlides, liveCount, upcomingCount } = useHomeJams(now);
  const dashboard = useHomeDashboard();

  const heroJamIds = useMemo(() => heroSlides.map((slide) => slide.jam.jamId), [heroSlides]);

  const showcaseJams = useMemo(
    () => selectShowcaseJams(featured, upcoming, heroJamIds),
    [featured, upcoming, heroJamIds],
  );

  // One request for every cover the page shows, hero rotation included —
  // the band deliberately excludes the rotation's jams, so it can't cover
  // for them.
  const entryJamIds = useMemo(
    () => entryJamIdsFor(heroJamIds, showcaseJams),
    [heroJamIds, showcaseJams],
  );
  const { byJamId: entriesByJamId, isLoading: entriesLoading } = useRecentEntries(entryJamIds);

  return {
    nowDate,
    isLoading,
    heroSlides,
    showcaseJams,
    entriesByJamId,
    entriesLoading,
    liveCount,
    upcomingCount,
    dashboard,
    /**
     * A member with nothing in collab or teams has an empty hub, and an
     * empty hub is worth less than the browse surfaces around it — so the
     * standard page holds until the dashboard proves it has something to
     * say. Pending counts as "something": the sections render skeletons
     * rather than letting the page settle and then shoving it down.
     */
    showDashboard: dashboard.signedIn && (dashboard.isPending || dashboard.hasContent),
  };
}

export type HomeContent = ReturnType<typeof useHomeContent>;
