import { useEffect, useMemo } from "react";

import { Section } from "@/components/ui/section";
import { MicroLabel, RichHtml, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { EVENTS } from "@/lib/analytics-events";
import useDateNow from "@/lib/hooks/use-date-now";
import { hostName } from "@/lib/jam-links";
import { captureEvent } from "@/lib/posthog";

import { jamPhase } from "../JamCalendarPage/helpers";
import { JamCommunitySection } from "./JamCommunitySection";
import { JamCtaRail } from "./JamCtaRail";
import { JamDetailHero } from "./JamDetailHero";
import { JamEntriesSection } from "./JamEntriesSection";
import { JamHostSeries } from "./JamHostSeries";
import { JamResultsSection } from "./JamResultsSection";
import type { JamDetail, JamEntryRow, JamResultsCriterion } from "./types";

export interface JamDetailPageProps {
  detail: JamDetail;
  /** First page of submissions, fetched by the route loader so the grid is
   * in the server-rendered document rather than a post-hydration flash. */
  initialEntries: { entries: JamEntryRow[]; total: number };
  results: JamResultsCriterion[];
}

/**
 * A jam's own page.
 *
 * The board's detail modal proved out this content — banner morph,
 * description, phase-aware stats, the team CTA — but a modal has no URL,
 * which means ~23k tracked jams were unshareable and unindexable, and the
 * "search → jam detail" path dead-ended in an overlay. Everything here is
 * the modal's content given a place to live, plus the two sections a modal
 * had no room for: the ranked submissions grid and the results board.
 *
 * `now` ticks from `useDateNow`, so the countdown in the hero and the
 * phase-dependent CTA stay live without a reload.
 */
export function JamDetailPage({ detail, initialEntries, results }: JamDetailPageProps) {
  const { jam, trackedEntries, hasResults } = detail;
  const nowMs = useDateNow();
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const phase = jamPhase(jam, now);

  // Per-jam identity on the pageview — funnels filter on `jam_id` instead
  // of parsing the `$pageview` URL.
  useEffect(() => {
    captureEvent(EVENTS.jamViewed, { jam_id: jam.jamId, jam_slug: jam.slug, status: jam.status });
  }, [jam.jamId, jam.slug, jam.status]);

  return (
    <div className="flex flex-col gap-8 pb-8">
      <JamDetailHero jam={jam} phase={phase} now={now} trackedEntries={trackedEntries} />

      <JamCtaRail jam={jam} phase={phase} hasResults={hasResults} />

      <JamCommunitySection jamId={jam.jamId} phase={phase} />

      <Section
        id="about"
        title="ABOUT THIS JAM"
        blurb={`Straight from ${hostName(jam, "the host")}.`}
      >
        {jam.contentHtml ? (
          <RichHtml html={jam.contentHtml} />
        ) : (
          <Well variant="ghost" className="p-6 backdrop-blur-none">
            <Text size="sm" variant="muted" italic>
              The host didn't write a description for this jam.
            </Text>
          </Well>
        )}
      </Section>

      {hasResults ? <JamResultsSection jamId={jam.jamId} criteria={results} /> : null}

      {/* An upcoming jam has no entries by definition; a scraped jam we
          never fetched entries for has none either. Neither case wants an
          empty grid with a search box over it. */}
      {trackedEntries > 0 ? (
        <JamEntriesSection jamId={jam.jamId} total={trackedEntries} initialData={initialEntries} />
      ) : (
        <Section
          id="entries"
          title="SUBMISSIONS"
          blurb={
            phase === "upcoming"
              ? "Nothing has been submitted yet."
              : "No submissions tracked for this jam."
          }
        >
          <Well variant="ghost" className="items-center gap-1 p-8 backdrop-blur-none">
            <MicroLabel>
              {phase === "upcoming" ? "NOTHING SUBMITTED YET" : "NO SUBMISSIONS TRACKED"}
            </MicroLabel>
            <Text size="xs" variant="muted">
              {phase === "upcoming"
                ? "Submissions appear here once the jam opens."
                : "We haven't fetched this jam's entries from itch.io."}
            </Text>
          </Well>
        </Section>
      )}

      {/* Series index, free from a jsonb containment match. Only rendered
          for a jam that actually names a host — `hostName`'s "COMMUNITY"
          fallback isn't a host to look up. */}
      {jam.hosts[0]?.name ? <JamHostSeries hostName={jam.hosts[0].name} jamId={jam.jamId} /> : null}
    </div>
  );
}
