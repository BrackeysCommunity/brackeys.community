import { useQuery } from "@tanstack/react-query";

import { Skeleton } from "@/components/ui/skeleton";
import { MicroLabel, Text } from "@/components/ui/typography";
import { orpc } from "@/orpc/client";

import { MemberDirectoryCard } from "./MemberDirectoryCard";

/** How many make the rail. Enough to scroll, few enough to still be a shortlist. */
const RAIL_SIZE = 8;

/**
 * The most-active shelf, above the directory. "Active" is what someone
 * has put into the community — work shipped, crews joined, posts opened —
 * counted twice if they did it inside the last six months; the ranking is
 * computed server-side in `listMembers`, this only draws it.
 *
 * A rail rather than the grid below it, for two reasons: it's a
 * shortlist, not a listing, and the horizontal run reads as a highlight
 * instead of "the first eight results". The tiles are the directory's
 * own, plus the standing — someone on the rail shouldn't look like a
 * different kind of object from the same person found by filtering.
 *
 * It hides itself when nobody has any recorded activity rather than
 * showing eight blank profiles under a "most active" heading.
 */
export function ActiveMembersRail() {
  const { data, isLoading } = useQuery({
    ...orpc.listMembers.queryOptions({ input: { sort: "active", limit: RAIL_SIZE } }),
    staleTime: 5 * 60 * 1000,
  });

  const ranked = (data?.members ?? []).filter((member) => member.activityScore > 0);
  if (!isLoading && ranked.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3 border-b border-dashed border-muted-foreground/25 pb-1.5">
        <MicroLabel>MOST ACTIVE</MicroLabel>
        <Text as="span" size="xs" variant="muted">
          shipping, joining crews, and posting in the last six months
        </Text>
      </div>

      {/* Negative margins let the run bleed to the page gutters, so the
          last tile is visibly cut off rather than ending in a tidy column
          that reads as "that's all of them". The padding puts the gutter
          back inside the scrollport so the first tile isn't flush to the
          edge and focus rings aren't clipped. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:thin] sm:-mx-6 sm:px-6">
        <div className="flex snap-x snap-mandatory gap-3">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-42 w-64 shrink-0" />
              ))
            : ranked.map((member, index) => (
                <div key={member.id} className="w-64 shrink-0 snap-start">
                  <MemberDirectoryCard member={member} rank={index + 1} />
                </div>
              ))}
        </div>
      </div>
    </section>
  );
}
