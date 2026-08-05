import {
  ComputerTerminal01Icon,
  FireIcon,
  PaintBucketIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { useMemo, useRef } from "react";

import {
  FeaturedJamPanel,
  FeaturedJamPanelSkeleton,
  pickHeroJam,
} from "@/components/home/FeaturedJamPanel";
import { JamShowcaseBand, selectShowcaseJams } from "@/components/home/JamShowcaseBand";
import { NewestSignups } from "@/components/home/NewestSignups";
import { RecentCollabPosts } from "@/components/home/RecentCollabPosts";
import { ShortcutTiles, type ShortcutTile } from "@/components/home/ShortcutTiles";
import { useBoardStats } from "@/components/home/use-board-stats";
import { useHomeJams } from "@/components/jams/JamCalendarPage/use-jam-data";
import { Section, SectionAction } from "@/components/ui/section";
import { PROTOCOL_COUNT } from "@/data/commands";
import { useAppTheme } from "@/lib/hooks/use-app-theme";
import { useCommandPalette } from "@/lib/hooks/use-command-palette";
import useDateNow from "@/lib/hooks/use-date-now";

/**
 * The touch landing page.
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
  const { theme } = useAppTheme();
  const { setOpen: openPalette } = useCommandPalette();

  const jamsRef = useRef<HTMLDivElement>(null);
  const collabRef = useRef<HTMLDivElement>(null);

  const scrollToRef = (ref: React.RefObject<HTMLElement | null>) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const { isLoading, featured, upcoming, liveCount, upcomingCount } = useHomeJams(now);
  const { openRoles, isLoading: isLoadingStats } = useBoardStats();

  const hero = useMemo(() => pickHeroJam(featured), [featured]);
  const showcaseJams = useMemo(
    () => selectShowcaseJams(featured, upcoming, hero?.jam.jamId ?? null),
    [featured, upcoming, hero],
  );

  const navTiles: ShortcutTile[] = [
    {
      label: "LIVE JAMS",
      stat: isLoading ? "—" : String(liveCount),
      icon: FireIcon,
      onClick: () => scrollToRef(jamsRef),
    },
    {
      label: "OPEN ROLES",
      stat: isLoadingStats ? "—" : String(openRoles),
      icon: UserGroupIcon,
      onClick: () => scrollToRef(collabRef),
    },
    {
      label: "THEMES",
      stat: theme.name,
      icon: PaintBucketIcon,
      onClick: () => openPalette(true),
    },
    {
      label: "BOT COMMANDS",
      stat: String(PROTOCOL_COUNT),
      icon: ComputerTerminal01Icon,
      onClick: () => openPalette(true),
    },
  ];

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

      <div ref={jamsRef} className="scroll-mt-20">
        <Section
          id="jams"
          title="JAMS"
          blurb={`${liveCount} live · ${upcomingCount} upcoming.`}
          action={<SectionAction to="/jams">FULL</SectionAction>}
        >
          <JamShowcaseBand jams={showcaseJams} isLoading={isLoading} now={nowDate} />
        </Section>
      </div>

      <div ref={collabRef} className="scroll-mt-20">
        <RecentCollabPosts />
      </div>

      <NewestSignups />
    </div>
  );
}
