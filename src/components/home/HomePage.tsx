import { useMemo } from "react";

import { CommandCenterTeaser } from "@/components/home/CommandCenterTeaser";
import { pickHeroJam } from "@/components/home/FeaturedJamPanel";
import { FeatureRail } from "@/components/home/FeatureRail";
import { HeroSplit } from "@/components/home/HeroSplit";
import { JamShowcaseBand, selectShowcaseJams } from "@/components/home/JamShowcaseBand";
import { NewestSignups } from "@/components/home/NewestSignups";
import { RecentCollabPosts } from "@/components/home/RecentCollabPosts";
import { useHomeJams } from "@/components/jams/JamCalendarPage/use-jam-data";
import { Section, SectionAction } from "@/components/ui/section";
import useDateNow from "@/lib/hooks/use-date-now";

/**
 * The desktop landing page — "command deck" layout.
 *
 * The hierarchy the page argues for, top to bottom: what's happening at
 * Brackeys right now (the hero's jam panel), where else to go (the feature
 * rail), what's running and what people shipped (the jam band), who is
 * hiring and who just arrived (collab + community). The previous version
 * led with four equal-weight navigation cards, which asked the visitor to
 * pick a destination before the page had given them a reason to.
 */
export function HomePage() {
  const now = useDateNow();
  const nowDate = new Date(now);

  const { isLoading, featured, upcoming, liveCount, upcomingCount } = useHomeJams(now);

  const hero = useMemo(() => pickHeroJam(featured), [featured]);
  const showcaseJams = useMemo(
    () => selectShowcaseJams(featured, upcoming, hero?.jam.jamId ?? null),
    [featured, upcoming, hero],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-12">
      <HeroSplit hero={hero} isLoading={isLoading} now={nowDate} />

      <FeatureRail liveCount={liveCount} upcomingCount={upcomingCount} isLoadingJams={isLoading} />

      <Section
        id="jams"
        title="JAMS"
        blurb={`Tracking ${liveCount} live and ${upcomingCount} upcoming jams across itch.io.`}
        action={<SectionAction to="/jams">JAM BOARD</SectionAction>}
      >
        <JamShowcaseBand jams={showcaseJams} isLoading={isLoading} now={nowDate} />
      </Section>

      <RecentCollabPosts />

      {/* Community band: the two quietest sections share a row so neither
          gets a full-width slot it can't fill. The columns stretch (the
          grid default) rather than sitting at `items-start`: the signup
          list is the taller of the two and sets the row, and the command
          panel clips itself to that height instead of running past it. */}
      <div className="grid gap-8 lg:grid-cols-2">
        <NewestSignups />
        <CommandCenterTeaser />
      </div>
    </div>
  );
}
