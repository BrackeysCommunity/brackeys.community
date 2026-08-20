import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { TeamsDiscoveryPage } from "@/components/teams/TeamsDiscoveryPage";
import { teamsListQueryOptions } from "@/components/teams/use-teams-listing";
import { prefetchInLoader } from "@/lib/route-prefetch";
import { listingMeta } from "@/lib/site-meta";

// Validates the URL search params:
//   `?q=…`           name/tagline search
//   `?recruiting=1`  only teams taking members
//   `?shipped=1`     only teams with something on the showcase
//   `?skills=…`      derived stack filter (the roster's skills)
//   `?sort=…`        listing order; `active` is the default and stays out
//                    of the URL
//   `?new=1`         opens the create drawer on arrival
const skillId = z.coerce.number().int().positive();

const searchSchema = z.object({
  q: z.string().optional(),
  recruiting: z.boolean().optional(),
  shipped: z.boolean().optional(),
  // A one-skill URL parses as a bare number, not a one-element array —
  // the page always writes arrays, but a hand-typed or trimmed link
  // must not throw the route into its error boundary.
  skills: z.union([z.array(skillId), skillId.transform((id) => [id])]).optional(),
  sort: z.enum(["active", "shipped", "newest"]).optional(),
  new: z.boolean().optional(),
});

export const Route = createFileRoute("/teams/")({
  validateSearch: searchSchema,
  // `new` opens the create drawer: a UI flag, not a query input.
  loaderDeps: ({ search }) => ({ ...search, new: undefined }),
  loader: ({ context: { queryClient }, deps }) =>
    prefetchInLoader(queryClient.prefetchInfiniteQuery(teamsListQueryOptions(deps))),
  head: ({ match }) =>
    listingMeta({
      title: "Teams",
      description:
        "Find a crew to build with — the teams in the Brackeys community, what they have shipped, the stack they work in, and who is recruiting.",
      path: "/teams",
      search: match.search,
    }),
  component: TeamsDiscoveryPage,
});
