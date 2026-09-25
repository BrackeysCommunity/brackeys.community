import { formatCountdown } from "@/lib/jam-countdown";
import type { SearchHit } from "@/lib/search-hits";

type JamHit = Extract<SearchHit, { kind: "jam" }>;

const BOUNDARY = {
  upcoming: { at: "startsAt", short: "starts in", long: "Starts in" },
  running: { at: "endsAt", short: "closes in", long: "Submissions close in" },
  voting: { at: "votingEndsAt", short: "voting ends in", long: "Voting ends in" },
} as const;

/**
 * The next boundary a live or upcoming jam is counting down to, as a row
 * hint ("closes in 3h 12m") and a sentence for the preview. Null once the
 * jam is over, or when the date it would count to is missing.
 */
export function jamNextBoundary(
  jam: JamHit,
  now: Date = new Date(),
): { short: string; long: string } | null {
  if (jam.phase === "archive") return null;
  const boundary = BOUNDARY[jam.phase];
  const countdown = formatCountdown(jam[boundary.at], now);
  if (!countdown || countdown.past) return null;
  return {
    short: `${boundary.short} ${countdown.text}`,
    long: `${boundary.long} ${countdown.text}`,
  };
}
