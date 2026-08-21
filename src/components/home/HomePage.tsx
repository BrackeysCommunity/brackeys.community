import { motion } from "framer-motion";

import { CommandCenterTeaser } from "@/components/home/CommandCenterTeaser";
import { HomeDashboard } from "@/components/home/dashboard/HomeDashboard";
import { FeatureRail } from "@/components/home/FeatureRail";
import { HeroSplit } from "@/components/home/HeroSplit";
import { JamShowcaseBand } from "@/components/home/JamShowcaseBand";
import { NewestSignups } from "@/components/home/NewestSignups";
import { RecentCollabPosts } from "@/components/home/RecentCollabPosts";
import { useHomeContent } from "@/components/home/use-home-content";
import { PageStack } from "@/components/ui/page-motion";
import { Section, SectionAction } from "@/components/ui/section";
import { fadeUp } from "@/lib/motion";

/**
 * The desktop landing page — "command deck" layout.
 *
 * The hierarchy the page argues for, top to bottom: what's happening at
 * Brackeys right now (the hero's jam panel), where else to go (the feature
 * rail), what's running and what people shipped (the jam band), who is
 * hiring and who just arrived (collab + community). The previous version
 * led with four equal-weight navigation cards, which asked the visitor to
 * pick a destination before the page had given them a reason to.
 *
 * Signed in, that hierarchy gains a rung rather than losing one. The
 * dashboard — invites, applications, posts, teams, jam clocks — slots in
 * directly under the rail, above discovery: it is the most specific thing on
 * the page to the person reading it. Everything a signed-out visitor gets
 * stays, jam band included; the one exception is the newest-signups rail,
 * which is a welcome mat and has nothing to say to someone already inside.
 *
 * `MobileHome` renders the same slots in the same order off the same hook —
 * only the hero and the navigation are different components there.
 */
export function HomePage() {
  const {
    nowDate,
    isLoading,
    heroSlides,
    showcaseJams,
    entriesByJamId,
    entriesLoading,
    liveCount,
    upcomingCount,
    dashboard,
    showDashboard,
  } = useHomeContent();

  return (
    // `data-content-pane` tells the shell's readability pane how wide this
    // page's measure is — keep it in step with the max-width beside it.
    <PageStack data-content-pane="6xl" className="mx-auto flex w-full max-w-7xl flex-col gap-12">
      <motion.div variants={fadeUp}>
        <HeroSplit
          heroSlides={heroSlides}
          entriesByJamId={entriesByJamId}
          isLoading={isLoading}
          now={nowDate}
        />
      </motion.div>

      <motion.div variants={fadeUp}>
        <FeatureRail
          liveCount={liveCount}
          upcomingCount={upcomingCount}
          isLoadingJams={isLoading}
        />
      </motion.div>

      {showDashboard ? (
        <motion.div variants={fadeUp}>
          <HomeDashboard data={dashboard} />
        </motion.div>
      ) : null}

      <motion.div variants={fadeUp}>
        <Section
          id="jams"
          title="JAMS"
          blurb={`Tracking ${liveCount} live and ${upcomingCount} upcoming jams across itch.io.`}
          action={<SectionAction to="/jams">JAM BOARD</SectionAction>}
        >
          <JamShowcaseBand
            jams={showcaseJams}
            entries={entriesByJamId}
            isLoading={isLoading}
            entriesLoading={entriesLoading}
            now={nowDate}
          />
        </Section>
      </motion.div>

      <motion.div variants={fadeUp}>
        <RecentCollabPosts />
      </motion.div>

      {/* Community band: the two quietest sections share a row so neither
          gets a full-width slot it can't fill. The columns stretch (the
          grid default) rather than sitting at `items-start`: the signup
          list is the taller of the two and sets the row, and the command
          panel clips itself to that height instead of running past it.
          The signup rail is a welcome mat, so it steps aside for the
          dashboard and the command panel takes the full row. */}
      <motion.div
        variants={fadeUp}
        className={showDashboard ? "grid gap-8" : "grid gap-8 lg:grid-cols-2"}
      >
        {showDashboard ? null : <NewestSignups />}
        <CommandCenterTeaser />
      </motion.div>
    </PageStack>
  );
}
