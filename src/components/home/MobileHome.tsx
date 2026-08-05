import { useMemo } from "react";

import {
  FeaturedJamPanel,
  FeaturedJamPanelSkeleton,
  pickHeroJam,
} from "@/components/home/FeaturedJamPanel";
import { JamShowcaseBand, selectShowcaseJams } from "@/components/home/JamShowcaseBand";
import { NewestSignups } from "@/components/home/NewestSignups";
import { RecentCollabPosts } from "@/components/home/RecentCollabPosts";
import { ShortcutTiles, type ShortcutTile } from "@/components/home/ShortcutTiles";
import { useHomeDestinations } from "@/components/home/use-home-destinations";
import { useHomeJams } from "@/components/jams/JamCalendarPage/use-jam-data";
import { Section, SectionAction } from "@/components/ui/section";
import useDateNow from "@/lib/hooks/use-date-now";

/**
 * The mobile landing page.
 *
 * Mirrors the desktop hierarchy — the live jam before the navigation,
 * showcase rows before the community — minus the anchor rail, which has
 * nowhere to stick on a phone. Keeping the two pages on different
 * hierarchies would be worse than either: the same visitor sees both
 * depending on the device, and they'd be told different things matter.
 */
export function MobileHome() {
  const now = useDateNow();
  const nowDate = new Date(now);

  const { isLoading, featured, upcoming, liveCount, upcomingCount } = useHomeJams(now);

  const hero = useMemo(() => pickHeroJam(featured), [featured]);
  const showcaseJams = useMemo(
    () => selectShowcaseJams(featured, upcoming, hero?.jam.jamId ?? null),
    [featured, upcoming, hero],
  );

  // The same four destinations and the same four numbers the desktop rail
  // shows. These used to scroll to a section further down this page, which
  // meant the chip row and the rail agreed on nothing — not the tiles, not
  // the stats, not where a tap ended up.
  const destinations = useHomeDestinations(liveCount, isLoading);
  const navTiles: ShortcutTile[] = destinations.map((d) => ({
    label: d.chipLabel,
    stat: d.stat,
    icon: d.icon,
    to: d.to,
  }));

  return (
    <div className="flex flex-col gap-8">
      {/* No wordmark here. On a phone it filled most of the first screen
          to say something the header already says, pushing the live jam —
          the reason anyone opens this on a phone — below the fold. */}
      <div className="flex flex-col gap-3">
        {isLoading ? (
          <FeaturedJamPanelSkeleton density="compact" />
        ) : hero ? (
          <FeaturedJamPanel hero={hero} now={nowDate} density="compact" />
        ) : null}

        <ShortcutTiles tiles={navTiles} />
      </div>

      <Section
        id="jams"
        title="JAMS"
        blurb={`${liveCount} live · ${upcomingCount} upcoming.`}
        action={<SectionAction to="/jams">FULL</SectionAction>}
      >
        <JamShowcaseBand jams={showcaseJams} isLoading={isLoading} now={nowDate} />
      </Section>

      <RecentCollabPosts />

      <NewestSignups />
    </div>
  );
}
