import {
  Calendar03Icon,
  ComputerTerminal01Icon,
  FireIcon,
  PaintBucketIcon,
  ToolsIcon,
} from "@hugeicons/core-free-icons";
import { useRef } from "react";

import { CyclingWord } from "@/components/home/CyclingWord";
import { FeaturedJamCarousel } from "@/components/home/FeaturedJamCarousel";
import { HeroWordmark } from "@/components/home/HeroWordmark";
import { NewestSignups } from "@/components/home/NewestSignups";
import { RecentCollabPosts } from "@/components/home/RecentCollabPosts";
import { ShortcutTiles, type ShortcutTile } from "@/components/home/ShortcutTiles";
import { useHomeJams } from "@/components/jams/JamCalendarPage/use-jam-data";
import { Heading, Link, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { useAppTheme } from "@/lib/hooks/use-app-theme";
import { useCommandPalette } from "@/lib/hooks/use-command-palette";
import useDateNow from "@/lib/hooks/use-date-now";
import { durationDays, formatCountdown } from "@/lib/jam-countdown";

const UPCOMING_LIMIT = 4;

function jamUrl(slug: string) {
  return `https://itch.io/jam/${slug}`;
}

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

  const { isLoading, featured, upcoming: upcomingAll, liveCount, upcomingCount } = useHomeJams(now);
  const upcoming = upcomingAll.slice(0, UPCOMING_LIMIT);

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
    { label: "TOOLS", stat: "9", icon: ToolsIcon },
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
          <Link
            href="https://itch.io/jams"
            target="_blank"
            rel="noopener noreferrer"
            bold
            variant="muted"
            className="text-[11px] tracking-widest"
          >
            FULL ▸
          </Link>
        </header>

        <div ref={featuredRef} className="scroll-mt-20">
          <FeaturedJamCarousel jams={featured} isLoading={isLoading} density="compact" />
        </div>

        {/* Soonest upcoming */}
        <div ref={upcomingRef} className="scroll-mt-20">
          <Well>
            <div className="flex items-center gap-2 border-b border-muted/30 px-3 py-2">
              <Text size="xs" variant="muted" className="tracking-widest uppercase">
                ◆ Soonest Upcoming
              </Text>
            </div>
            {isLoading ? (
              <div className="h-40 animate-pulse" aria-hidden />
            ) : upcoming.length === 0 ? (
              <Text
                as="div"
                size="sm"
                variant="muted"
                align="center"
                className="p-6 tracking-widest uppercase"
              >
                No upcoming jams
              </Text>
            ) : (
              <ul className="divide-y divide-muted/20">
                {upcoming.map((jam) => {
                  const start = jam.startsAt ? new Date(jam.startsAt) : null;
                  const counted = formatCountdown(jam.startsAt, nowDate);
                  return (
                    <li key={jam.jamId}>
                      <Link
                        href={jamUrl(jam.slug)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 px-3 py-3 transition-colors active:bg-muted/40"
                      >
                        <div className="w-10 shrink-0 text-center">
                          <Text as="div" size="xs" variant="muted" className="tracking-widest">
                            {start?.toLocaleString(undefined, { month: "short" }).toUpperCase() ??
                              "TBA"}
                          </Text>
                          <Text as="div" bold density="dense" className="text-lg">
                            {start?.getUTCDate() ?? "—"}
                          </Text>
                        </div>
                        <div className="min-w-0 flex-1">
                          <Text as="div" bold ellipsis size="md">
                            {jam.title}
                          </Text>
                          <Text
                            as="div"
                            size="xs"
                            variant="muted"
                            className="tracking-widest uppercase"
                          >
                            {jam.hosts[0]?.name ?? "COMMUNITY"}
                            {durationDays(jam.startsAt, jam.endsAt) &&
                              ` · ${durationDays(jam.startsAt, jam.endsAt)}`}
                          </Text>
                        </div>
                        <Text size="xs" variant="muted" className="tracking-widest">
                          {counted ? `in ${counted.text}` : ""}
                        </Text>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Well>
        </div>
      </section>

      <RecentCollabPosts />
      <NewestSignups />
    </div>
  );
}
