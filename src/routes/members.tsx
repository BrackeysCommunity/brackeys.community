import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { MembersDiscoveryPage } from "@/components/members/MembersDiscoveryPage";
import {
  membersListingIsShareable,
  membersListQueryOptions,
} from "@/components/members/use-members-listing";
import { prefetchInLoader } from "@/lib/route-prefetch";
import { listingMeta, ogCardPath } from "@/lib/site-meta";

// Validates the URL search params:
//   `?q=…`            username/tagline/looking-for search
//   `?skills=…`       skills the member has on their profile
//   `?matchAll=true`  skills combine as all-of instead of the default any-of
//   `?roles=…`        craft claims — the shared collab_roles vocabulary
//   `?availability=…` commitment level, any of full_time/part_time/limited
//   `?open=1`         only members flagged open to work
//   `?rate=50`        hourly ceiling in whole dollars
//   `?tz=3`           timezone window in hours ("within ±3h of me") —
//                     viewer-relative; the offset comes from the browser
//   `?sort=…`         listing order; `active` is the default and stays out
//                     of the URL
const facetId = z.coerce.number().int().positive();
const availability = z.enum(["full_time", "part_time", "limited"]);

const searchSchema = z.object({
  q: z.string().optional(),
  // A one-value URL parses as a bare scalar, not a one-element array —
  // the page always writes arrays, but a hand-typed or trimmed link must
  // not throw the route into its error boundary.
  skills: z.union([z.array(facetId), facetId.transform((id) => [id])]).optional(),
  matchAll: z.boolean().optional(),
  roles: z.union([z.array(facetId), facetId.transform((id) => [id])]).optional(),
  availability: z
    .union([z.array(availability), availability.transform((value) => [value])])
    .optional(),
  open: z.boolean().optional(),
  rate: z.coerce.number().int().positive().optional(),
  tz: z.coerce.number().int().min(1).max(12).optional(),
  sort: z.enum(["active", "newest", "rate"]).optional(),
});

export const Route = createFileRoute("/members")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  // Puts real member links in the document; see `membersListingIsShareable`
  // for the one shape that must not be prefetched.
  loader: ({ context: { queryClient }, deps }) =>
    membersListingIsShareable(deps)
      ? prefetchInLoader(queryClient.prefetchInfiniteQuery(membersListQueryOptions(deps)))
      : undefined,
  head: ({ match }) =>
    listingMeta({
      title: "Members",
      description:
        "Find the people behind the games — artists, composers, programmers and designers in the Brackeys community, with what they work in and whether they are open to work.",
      path: "/members",
      card: ogCardPath("board", "members"),
      search: match.search,
    }),
  component: MembersDiscoveryPage,
});
