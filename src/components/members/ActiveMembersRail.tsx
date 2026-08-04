import { useQuery } from "@tanstack/react-query";

import { Rail } from "@/components/ui/rail";
import { Skeleton } from "@/components/ui/skeleton";
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
    <Rail
      title="MOST ACTIVE"
      blurb="shipping, joining crews, and posting in the last six months"
      label="most active members"
    >
      {isLoading
        ? Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-42 w-64 shrink-0" />
          ))
        : ranked.map((member, index) => (
            <div key={member.id} className="w-64 shrink-0">
              <MemberDirectoryCard member={member} rank={index + 1} />
            </div>
          ))}
    </Rail>
  );
}
