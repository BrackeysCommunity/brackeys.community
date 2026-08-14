import { ArrowDown01Icon, LinkSquare01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { JamTeamCta } from "@/components/jams/JamTeamCta";
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

  const primary = (() => {
    if (joinable) {
      return {
        label: phase === "upcoming" ? "JOIN ON ITCH.IO" : "JOIN & SUBMIT",
        href: jamUrl(jam.slug),
      };
    }
    if (phase === "voting") return { label: "PLAY & RATE", href: jamEntriesUrl(jam.slug) };
    return null;
  })();

  return (
    <Well variant="ghost" className="flex-row flex-wrap items-center gap-3 p-3 backdrop-blur-none">
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
              aria-label={primary.label}
            />
          }
        >
          {primary.label}
          <HugeiconsIcon icon={LinkSquare01Icon} size={12} />
        </Button>
      ) : null}

      {/* Archived jams point at the results board below instead of off-site
          — the placements are the reason to be on this page. */}
      {!joinable && phase === "archive" && hasResults ? (
        <Button
          size="sm"
          variant="outline"
          className="tracking-widest"
          nativeButton={false}
          render={<a href="#results" aria-label="Jump to results" />}
        >
          SEE THE RESULTS
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
              aria-label="Browse submissions on itch.io"
            />
          }
        >
          SUBMISSIONS ON ITCH.IO
          <HugeiconsIcon icon={LinkSquare01Icon} size={12} />
        </Button>
      ) : null}

      <JamWatchToggle jamId={jam.jamId} phase={phase} />

      <JamTeamCta jam={jam} className="ml-auto items-end" />
    </Well>
  );
}
