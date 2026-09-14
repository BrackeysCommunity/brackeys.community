import { ArrowDown01Icon, LinkSquare01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { JamFindTeamButton, JamTeamPostsLink } from "@/components/jams/JamTeamCta";
import { JamWatchToggle } from "@/components/jams/JamWatchToggle";
import { Button } from "@/components/ui/button";
import { Well } from "@/components/ui/well";
import { jamUrl } from "@/lib/jam-links";

import type { JamPhase } from "../JamCalendarPage/helpers";
import type { JamDetailRow } from "./types";

/** itch's own submission browser for a jam — where "play & rate" goes. */
function jamEntriesUrl(slug: string): string {
  return `${jamUrl(slug)}/entries`;
}

/**
 * The full label wherever the rail has room for it, the short one on a
 * phone, where these buttons sit four to a line. Both are rendered and one
 * is hidden, so it costs no JS and can't flash on hydration — and `hidden`
 * keeps the unused half out of the accessibility tree too, leaving each
 * button with exactly one name.
 */
function CtaLabel({ short, full }: { short: string; full: string }) {
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{full}</span>
    </>
  );
}

/**
 * What this page wants you to do next, which is entirely a function of
 * phase.
 *
 * Before the deadline the answer is "join, and find people to join with";
 * during voting it's "go play the submissions"; afterwards it's "look at
 * who won", which is on this page — so the archive CTA is an in-page jump
 * rather than a fifth link off to itch.
 */
export function JamCtaRail({
  jam,
  phase,
  hasResults,
}: {
  jam: JamDetailRow;
  phase: JamPhase;
  hasResults: boolean;
}) {
  const joinable = phase === "upcoming" || phase === "running";

  // `label` is what the button says once there's width; `short` is the
  // phone's version of it, and `name` is the accessible name — spelled so
  // it contains whichever of the two is on screen.
  const primary = (() => {
    if (joinable) {
      return phase === "upcoming"
        ? {
            short: "JOIN",
            label: "JOIN ON ITCH.IO",
            name: "Join on itch.io",
            href: jamUrl(jam.slug),
          }
        : {
            short: "SUBMIT",
            label: "JOIN & SUBMIT",
            name: "Join & submit on itch.io",
            href: jamUrl(jam.slug),
          };
    }
    if (phase === "voting") {
      return {
        short: "RATE",
        label: "PLAY & RATE",
        name: "Play & rate on itch.io",
        href: jamEntriesUrl(jam.slug),
      };
    }
    return null;
  })();

  return (
    <Well variant="ghost" className="gap-2 p-3 backdrop-blur-none">
      {/* The two blues sit together at the head of the row — they are the
          page's actual asks — and the standing toggles follow as icons. */}
      <div className="flex flex-row flex-wrap items-center gap-2">
        {primary ? (
          <Button
            size="sm"
            className="tracking-widest"
            nativeButton={false}
            render={
              <a
                href={primary.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={primary.name}
              />
            }
          >
            <CtaLabel short={primary.short} full={primary.label} />
            <HugeiconsIcon icon={LinkSquare01Icon} size={12} />
          </Button>
        ) : null}

        <JamFindTeamButton jam={jam} />

        {/* Archived jams point at the results board below instead of off-site
            — the placements are the reason to be on this page. */}
        {!joinable && phase === "archive" && hasResults ? (
          <Button
            size="sm"
            variant="outline"
            className="tracking-widest"
            nativeButton={false}
            render={<a href="#results" aria-label="See the results" />}
          >
            <CtaLabel short="RESULTS" full="SEE THE RESULTS" />
            <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
          </Button>
        ) : null}

        {/* Voting and archived jams get the entries browser as a secondary,
            since the primary is either the rate page or the results jump. */}
        {phase === "archive" ? (
          <Button
            size="sm"
            variant="outline"
            className="tracking-widest"
            nativeButton={false}
            render={
              <a
                href={jamEntriesUrl(jam.slug)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Submissions on itch.io"
              />
            }
          >
            <CtaLabel short="SUBMISSIONS" full="SUBMISSIONS ON ITCH.IO" />
            <HugeiconsIcon icon={LinkSquare01Icon} size={12} />
          </Button>
        ) : null}

        <JamWatchToggle jamId={jam.jamId} phase={phase} />
      </div>

      {/* `self-start` so the link's hit area is the text, not the row. */}
      <JamTeamPostsLink jam={jam} className="self-start" />
    </Well>
  );
}
