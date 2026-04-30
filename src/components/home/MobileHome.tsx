import {
  Calendar03Icon,
  ComputerTerminal01Icon,
  IdentityCardIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { CyclingWord } from "@/components/home/CyclingWord";
import { FeaturedJamCarousel } from "@/components/home/FeaturedJamCarousel";
import { HeroWordmark } from "@/components/home/HeroWordmark";
import { NewestSignups } from "@/components/home/NewestSignups";
import { RecentCollabPosts } from "@/components/home/RecentCollabPosts";
import { SectionRule } from "@/components/home/SectionRule";
import { Chonk } from "@/components/ui/chonk";
import { Well } from "@/components/ui/well";
import useDateNow from "@/lib/hooks/use-date-now";
import { durationDays, formatCountdown } from "@/lib/jam-countdown";
import { client } from "@/orpc/client";

const FEATURED_LIMIT = 10;
const UPCOMING_LIMIT = 4;

interface NavTile {
  label: string;
  stat: string;
  icon: IconSvgElement;
  to?: string;
}

const NAV_TILES: NavTile[] = [
  { label: "JAM CALENDAR", stat: "50+", icon: Calendar03Icon },
  { label: "COLLAB BOARD", stat: "312", icon: UserGroupIcon, to: "/collab" },
  { label: "COMMANDS", stat: "58", icon: ComputerTerminal01Icon, to: "/command-center" },
  { label: "PROFILE", stat: "L14", icon: IdentityCardIcon, to: "/profile" },
];

function jamUrl(slug: string) {
  return `https://itch.io/jam/${slug}`;
}

export function MobileHome() {
  const now = useDateNow();
  const nowDate = new Date(now);

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

  return (
    <div className="flex flex-col gap-8">
      {/* Hero */}
      <div className="flex flex-col gap-4">
        <HeroWordmark
          primary={<CyclingWord />}
          secondary="GAMES"
          className="!text-[clamp(3rem,18vw,5rem)]"
        />
        <p className="font-sans text-sm text-foreground [text-shadow:0_1px_3px_rgba(0,0,0,0.75)]">
          The neural network for the Brackeys community. Find your squad, browse every jam, ship.
        </p>
      </div>

      {/* Enter Node — horizontal scroll */}
      <div className="flex flex-col gap-3">
        <SectionRule label="Enter Node" />
        <div className="-mx-4 flex snap-x snap-mandatory gap-1.5 overflow-x-auto py-3 pr-4 pl-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV_TILES.map((tile) => {
            const inner = (
              <div className="flex h-full flex-col justify-between gap-1 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2 font-mono text-[10px] font-bold tracking-widest text-muted-foreground">
                  <HugeiconsIcon icon={tile.icon} size={14} />
                  <span className="text-right leading-tight">{tile.label}</span>
                </div>
                <div className="font-mono text-2xl leading-none font-bold text-primary">
                  {tile.stat}
                </div>
              </div>
            );
            return tile.to ? (
              <Chonk
                key={tile.label}
                variant="surface"
                size="lg"
                render={<Link to={tile.to} aria-label={tile.label} />}
                className="block w-36 shrink-0 snap-start"
              >
                {inner}
              </Chonk>
            ) : (
              <Chonk
                key={tile.label}
                variant="surface"
                size="lg"
                className="block w-36 shrink-0 snap-start"
              >
                {inner}
              </Chonk>
            );
          })}
        </div>
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

        <FeaturedJamCarousel jams={liveJams} isLoading={liveLoading} density="compact" />

        {/* Soonest upcoming */}
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
      </section>

      <RecentCollabPosts />
      <NewestSignups />
    </div>
  );
}
