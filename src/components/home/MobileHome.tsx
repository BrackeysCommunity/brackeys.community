import {
  Calendar03Icon,
  ComputerTerminal01Icon,
  FireIcon,
  PaintBucketIcon,
  ToolsIcon,
} from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import { CyclingWord } from "@/components/home/CyclingWord";
import { FeaturedJamCarousel } from "@/components/home/FeaturedJamCarousel";
import { HeroWordmark } from "@/components/home/HeroWordmark";
import { NewestSignups } from "@/components/home/NewestSignups";
import { RecentCollabPosts } from "@/components/home/RecentCollabPosts";
import { ShortcutTiles, type ShortcutTile } from "@/components/home/ShortcutTiles";
import { Well } from "@/components/ui/well";
import { useAppTheme } from "@/lib/hooks/use-app-theme";
import { useCommandPalette } from "@/lib/hooks/use-command-palette";
import useDateNow from "@/lib/hooks/use-date-now";
import { durationDays, formatCountdown } from "@/lib/jam-countdown";
import { client } from "@/orpc/client";

const FEATURED_LIMIT = 10;
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

  const { data: liveData, isLoading: liveLoading } = useQuery({
    queryKey: ["list-jams", "live", "popularity", FEATURED_LIMIT],
    queryFn: () => client.listJams({ filter: "live", sortBy: "popularity", limit: FEATURED_LIMIT }),
    staleTime: 5 * 60 * 1000,
  });

  const { data: upcomingData, isLoading: upcomingLoading } = useQuery({
    queryKey: ["list-jams", "upcoming", "soonest", UPCOMING_LIMIT],
    queryFn: () =>
      client.listJams({ filter: "upcoming", sortBy: "soonest", limit: UPCOMING_LIMIT }),
    staleTime: 5 * 60 * 1000,
  });

  const liveJams = liveData?.jams ?? [];
  const upcoming = upcomingData?.jams ?? [];

  const navTiles: ShortcutTile[] = [
    {
      label: "HOT JAMS",
      stat: liveLoading ? "—" : String(liveJams.length),
      icon: FireIcon,
      onClick: () => scrollToRef(featuredRef),
    },
    {
      label: "UPCOMING",
      stat: upcomingLoading ? "—" : String(upcoming.length),
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
          <p className="font-sans text-sm text-foreground [text-shadow:0_1px_3px_rgba(0,0,0,0.75)]">
            The neural network for the Brackeys community. Find your squad, browse every jam, ship.
          </p>
        </div>

        <ShortcutTiles tiles={navTiles} />
      </div>

      {/* § 01 JAMS */}
      <section className="flex flex-col gap-4">
        <header className="flex items-end justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] tracking-widest text-muted-foreground">§ 01</div>
            <h2 className="font-mono text-2xl font-bold tracking-tight">JAMS</h2>
          </div>
          <a
            href="https://itch.io/jams"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] font-bold tracking-widest text-muted-foreground"
          >
            FULL ▸
          </a>
        </header>

        <div ref={featuredRef} className="scroll-mt-20">
          <FeaturedJamCarousel jams={liveJams} isLoading={liveLoading} density="compact" />
        </div>

        {/* Soonest upcoming */}
        <div ref={upcomingRef} className="scroll-mt-20">
          <Well>
            <div className="flex items-center gap-2 border-b border-muted/30 px-3 py-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
              <span>◆ Soonest Upcoming</span>
            </div>
            {upcomingLoading ? (
              <div className="h-40 animate-pulse" aria-hidden />
            ) : upcoming.length === 0 ? (
              <div className="p-6 text-center font-mono text-xs tracking-widest text-muted-foreground uppercase">
                No upcoming jams
              </div>
            ) : (
              <ul className="divide-y divide-muted/20">
                {upcoming.map((jam) => {
                  const start = jam.startsAt ? new Date(jam.startsAt) : null;
                  const counted = formatCountdown(jam.startsAt, nowDate);
                  return (
                    <li key={jam.jamId}>
                      <a
                        href={jamUrl(jam.slug)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 px-3 py-3 transition-colors active:bg-muted/40"
                      >
                        <div className="w-10 shrink-0 text-center">
                          <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                            {start?.toLocaleString(undefined, { month: "short" }).toUpperCase() ??
                              "TBA"}
                          </div>
                          <div className="font-mono text-lg leading-none font-bold">
                            {start?.getUTCDate() ?? "—"}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-sans text-sm font-bold">{jam.title}</div>
                          <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                            {jam.hosts[0]?.name ?? "COMMUNITY"}
                            {durationDays(jam.startsAt, jam.endsAt) &&
                              ` · ${durationDays(jam.startsAt, jam.endsAt)}`}
                          </div>
                        </div>
                        <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                          {counted ? `in ${counted.text}` : ""}
                        </div>
                      </a>
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
