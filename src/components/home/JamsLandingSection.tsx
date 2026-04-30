import { ArrowRight02Icon, Calendar03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { FeaturedJamCarousel } from "@/components/home/FeaturedJamCarousel";
import { Chonk } from "@/components/ui/chonk";
import { Well } from "@/components/ui/well";
import useDateNow from "@/lib/hooks/use-date-now";
import { durationDays, effectiveJamState, formatCountdown } from "@/lib/jam-countdown";
import { client } from "@/orpc/client";

const FEATURED_LIMIT = 10;
const UPCOMING_LIMIT = 6;

function jamUrl(slug: string) {
  return `https://itch.io/jam/${slug}`;
}

export function JamsLandingSection() {
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
    <section className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] tracking-widest text-muted-foreground">§ 01</div>
          <h2 className="font-mono text-3xl font-bold tracking-tight">JAMS</h2>
          <p className="mt-1 font-sans text-sm text-muted-foreground">
            Tracking {liveJams.length} live and {upcoming.length} upcoming jams across itch.io.
          </p>
        </div>
        <Chonk
          variant="surface"
          size="sm"
          render={
            <a
              href="https://itch.io/jams"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Full calendar"
            />
          }
          className="flex items-center gap-2 px-3 py-2 font-mono text-[11px] font-bold tracking-widest text-muted-foreground hover:text-primary"
        >
          <HugeiconsIcon icon={Calendar03Icon} size={14} />
          FULL CALENDAR
          <HugeiconsIcon icon={ArrowRight02Icon} size={12} />
        </Chonk>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <FeaturedJamCarousel jams={liveJams} isLoading={liveLoading} density="comfortable" />

        <Well>
          <div className="flex items-center justify-between gap-2 border-b border-muted/30 px-3 py-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            <span>◆ Soonest Upcoming</span>
            <a
              href="https://itch.io/jams"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary"
            >
              View all
            </a>
          </div>
          {upcomingLoading ? (
            <div className="h-64 animate-pulse" aria-hidden />
          ) : upcoming.length === 0 ? (
            <div className="p-6 text-center font-mono text-xs tracking-widest text-muted-foreground uppercase">
              No upcoming jams
            </div>
          ) : (
            <ul className="divide-y divide-muted/20">
              {upcoming.map((jam) => {
                const start = jam.startsAt ? new Date(jam.startsAt) : null;
                const state = effectiveJamState(jam.startsAt, jam.endsAt, nowDate);
                const counted = state === "ended" ? null : formatCountdown(jam.startsAt, nowDate);
                return (
                  <li key={jam.jamId}>
                    <a
                      href={jamUrl(jam.slug)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
                    >
                      <div className="w-10 shrink-0 text-center">
                        <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                          {start?.toLocaleString(undefined, { month: "short" }).toUpperCase() ??
                            "TBA"}
                        </div>
                        <div className="font-mono text-base leading-none font-bold">
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
  );
}
