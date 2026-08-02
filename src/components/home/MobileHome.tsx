import {
  Calendar03Icon,
  ComputerTerminal01Icon,
  FireIcon,
  PaintBucketIcon,
} from "@hugeicons/core-free-icons";
import { useRef } from "react";

import { CyclingWord } from "@/components/home/CyclingWord";
import { FeaturedJamCarousel } from "@/components/home/FeaturedJamCarousel";
import { HeroWordmark } from "@/components/home/HeroWordmark";
import { NewestSignups } from "@/components/home/NewestSignups";
import { RecentCollabPosts } from "@/components/home/RecentCollabPosts";
import { ShortcutTiles, type ShortcutTile } from "@/components/home/ShortcutTiles";
import { UpcomingJamList } from "@/components/home/UpcomingJamList";
import { useHomeJams } from "@/components/jams/JamCalendarPage/use-jam-data";
import { Heading, Link, Text } from "@/components/ui/typography";
import { useAppTheme } from "@/lib/hooks/use-app-theme";
import { useCommandPalette } from "@/lib/hooks/use-command-palette";
import useDateNow from "@/lib/hooks/use-date-now";

const UPCOMING_LIMIT = 4;

export function MobileHome() {
  const now = useDateNow();
  const nowDate = new Date(now);
  const { theme } = useAppTheme();
  const { setOpen: openPalette } = useCommandPalette();

  const featuredRef = useRef<HTMLDivElement>(null);
  const upcomingRef = useRef<HTMLDivElement>(null);

  const scrollToRef = (ref: React.RefObject<HTMLElement | null>) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const { isLoading, featured, upcoming, liveCount, upcomingCount } = useHomeJams(now);

  const navTiles: ShortcutTile[] = [
    {
      label: "HOT JAMS",
      stat: isLoading ? "—" : String(liveCount),
      icon: FireIcon,
      onClick: () => scrollToRef(featuredRef),
    },
    {
      label: "UPCOMING",
      stat: isLoading ? "—" : String(upcomingCount),
      icon: Calendar03Icon,
      onClick: () => scrollToRef(upcomingRef),
    },
    {
      label: "THEMES",
      stat: theme.name,
      icon: PaintBucketIcon,
      onClick: () => openPalette(true),
    },
    {
      label: "BOT COMMANDS",
      stat: "58",
      icon: ComputerTerminal01Icon,
      onClick: () => openPalette(true),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Hero + tile dock share a tighter intra-group gap; the page-level
          gap-8 still separates this group from the jams/collab/signups
          sections below. */}
      <div className="flex flex-col gap-3">
        {/* Hero */}
        <div className="flex flex-col gap-4">
          <HeroWordmark
            primary={<CyclingWord />}
            secondary="GAMES"
            className="text-[clamp(3rem,18vw,5rem)]!"
          />
          <Text as="p" size="md" className="[text-shadow:0_1px_3px_rgba(0,0,0,0.75)]">
            The neural network for the Brackeys community. Find your squad, browse every jam, ship.
          </Text>
        </div>

        <ShortcutTiles tiles={navTiles} />
      </div>

      {/* § 01 JAMS */}
      <section className="flex flex-col gap-4">
        <header className="flex items-end justify-between gap-3">
          <div>
            <Text as="div" size="xs" variant="muted" className="tracking-widest">
              § 01
            </Text>
            <Heading as="h2" size="2xl">
              JAMS
            </Heading>
          </div>
          <Link as="router" to="/jams" bold variant="muted" className="text-[11px] tracking-widest">
            FULL ▸
          </Link>
        </header>

        <div ref={featuredRef} className="scroll-mt-20">
          <FeaturedJamCarousel jams={featured} isLoading={isLoading} density="compact" />
        </div>

        {/* Soonest upcoming */}
        <div ref={upcomingRef} className="scroll-mt-20">
          <UpcomingJamList
            jams={upcoming}
            isLoading={isLoading}
            now={nowDate}
            limit={UPCOMING_LIMIT}
            density="compact"
          />
        </div>
      </section>

      <RecentCollabPosts />
      <NewestSignups />
    </div>
  );
}
