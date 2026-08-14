import { HomeDashboard } from "@/components/home/dashboard/HomeDashboard";
import { FeaturedJamPanel, FeaturedJamPanelSkeleton } from "@/components/home/FeaturedJamPanel";
import { JamShowcaseBand } from "@/components/home/JamShowcaseBand";
import { NewestSignups } from "@/components/home/NewestSignups";
import { RecentCollabPosts } from "@/components/home/RecentCollabPosts";
import { ShortcutTiles, type ShortcutTile } from "@/components/home/ShortcutTiles";
import { useHomeContent } from "@/components/home/use-home-content";
import { useHomeDestinations } from "@/components/home/use-home-destinations";
import { Section, SectionAction } from "@/components/ui/section";

/**
 * The mobile landing page.
 *
 * Same slots in the same order as `HomePage`, off the same `useHomeContent`
 * hook — which is what keeps the two from arguing about what matters, since
 * one visitor sees both depending on the device. What differs is only what
 * a phone can't carry: the hero split becomes a bare compact jam panel, and
 * the anchor rail — which has nothing to stick to here — becomes tiles.
 */
export function MobileHome() {
  const {
    nowDate,
    isLoading,
    hero,
    showcaseJams,
    liveCount,
    upcomingCount,
    dashboard,
    showDashboard,
  } = useHomeContent();

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

      {showDashboard ? <HomeDashboard data={dashboard} /> : null}

      <Section
        id="jams"
        title="JAMS"
        blurb={`${liveCount} live · ${upcomingCount} upcoming.`}
        action={<SectionAction to="/jams">FULL</SectionAction>}
      >
        <JamShowcaseBand jams={showcaseJams} isLoading={isLoading} now={nowDate} />
      </Section>

      <RecentCollabPosts />

      {showDashboard ? null : <NewestSignups />}
    </div>
  );
}
