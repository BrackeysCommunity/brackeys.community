import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { DotGrid } from "@/components/ui/dot-grid";
import { HoverPlayImage } from "@/components/ui/hover-play-image";
import { Section } from "@/components/ui/section";
import { MicroLabel, Text } from "@/components/ui/typography";
import { formatCount } from "@/lib/format-count";
import { formatJamShortDates } from "@/lib/jam-countdown";
import { jamLinkParams } from "@/lib/jam-links";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { safeThemeColor } from "../JamCalendarPage/helpers";

/**
 * The host's other jams, most recent first.
 *
 * Falls out of a jsonb containment match on `hosts` — no schema, no
 * curation, and it gives every recurring event a series index for free
 * ("every Brackeys jam", "every Trijam"). The scrape carries host *names*
 * only, so that's the join key; a host who renamed themselves splits into
 * two series, which is the honest reading of what we know.
 */
export function JamHostSeries({ hostName, jamId }: { hostName: string; jamId: number }) {
  const { data } = useQuery({
    ...orpc.listJamsByHost.queryOptions({ input: { hostName, excludeJamId: jamId } }),
    staleTime: STALE.jam,
  });

  const jams = data?.jams ?? [];
  if (jams.length === 0) return null;

  return (
    <Section id="series" title="MORE FROM THIS HOST" blurb={`Every jam ${hostName} has run.`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {jams.map((jam) => {
          // Scraped text never reaches a style attribute without validation.
          const color = safeThemeColor(jam.themeColor) ?? "var(--muted)";
          return (
            <Link
              key={jam.jamId}
              to="/jams/$jamSlug"
              params={jamLinkParams(jam)}
              data-hover-play-group
              className="group/series flex flex-col gap-1.5"
            >
              <div
                className="relative aspect-[16/9] w-full overflow-hidden rounded border border-muted/40 transition-colors group-hover/series:border-primary"
                style={{ background: color }}
              >
                {jam.bannerUrl ? (
                  <HoverPlayImage
                    src={jam.bannerUrl}
                    transform={{ width: 480 }}
                    loading="lazy"
                    // `contain` over the theme colour, same as the board's
                    // cards: itch jam banners have no common aspect ratio and
                    // cropping them destroys the poster.
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <DotGrid />
                )}
              </div>
              <Text
                as="div"
                size="sm"
                bold
                ellipsis
                density="compressed"
                className="group-hover/series:text-primary"
              >
                {jam.title}
              </Text>
              <MicroLabel as="div" ellipsis>
                {formatJamShortDates(jam.startsAt, jam.endsAt) ?? "DATES TBA"}
                {jam.entriesCount ? ` · ${formatCount(jam.entriesCount)} ENTRIES` : ""}
              </MicroLabel>
            </Link>
          );
        })}
      </div>
    </Section>
  );
}
