import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { collabListingDeps } from "@/components/collab/collab-filters";
import { CollabBrowsePage } from "@/components/collab/CollabBrowsePage";
import { collabPostsQueryOptions } from "@/components/collab/use-collab-listing";
import { prefetchInLoader } from "@/lib/route-prefetch";
import { listingMeta, ogCardPath } from "@/lib/site-meta";

// Validates the URL search params. The board's filters live entirely in
// the URL (see `collab-filters.ts`), so every narrowed board is
// shareable/bookmarkable. Beyond the filters:
//   `?new=true`    opens the create flyout (set by the legacy
//                  /collab/new route's redirect). Alongside it, `jam`/
//                  `team`/`project` preselect in the wizard instead of
//                  filtering the board (the jam modal's "FIND A TEAM",
//                  the team page's "POST AN OPENING", and the project
//                  page's "RECRUIT" CTAs send those pairs), and
//                  `flow=wizard` opens the five-step wizard instead of
//                  the one-screen post — a tester's escape hatch for one
//                  release.
//   `?post=<id>`   the pre-page way to address one post. Redirected to
//                  `/collab/$postId` in `beforeLoad` so old shared links
//                  still land on the post.
const searchSchema = z.object({
  new: z.boolean().optional(),
  flow: z.enum(["wizard"]).optional(),
  post: z.coerce.number().int().positive().optional(),
  type: z.enum(["paid", "hobby"]).optional(),
  status: z.enum(["recruiting", "party_full"]).optional(),
  level: z.enum(["beginner", "intermediate", "experienced"]).optional(),
  comp: z.enum(["hourly", "fixed", "rev_share", "negotiable"]).optional(),
  solo: z.boolean().optional(),
  q: z.string().optional(),
  roles: z.array(z.coerce.number().int().positive()).optional(),
  skills: z.array(z.coerce.number().int().positive()).optional(),
  matchAll: z.boolean().optional(),
  jam: z.coerce.number().int().positive().optional(),
  team: z.string().optional(),
  project: z.string().optional(),
  sort: z.enum(["newest", "oldest", "active"]).optional(),
});

export const Route = createFileRoute("/collab/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => collabListingDeps(search),
  // Keyed on the filters the URL actually describes, so a shared link to a
  // narrowed board server-renders that board rather than the default one.
  // `new` is deliberately not a dep — it opens the flyout, and re-running
  // the prefetch for that would refetch the whole list once its 15s
  // staleness elapsed.
  beforeLoad: ({ search }) => {
    if (search.post !== undefined) {
      throw redirect({ to: "/collab/$postId", params: { postId: String(search.post) } });
    }
  },
  loader: ({ context: { queryClient }, deps }) =>
    prefetchInLoader(queryClient.prefetchInfiniteQuery(collabPostsQueryOptions(deps))),
  head: ({ match }) =>
    listingMeta({
      title: "Collab board",
      description:
        "Find people to build with — open roles on game projects in the Brackeys community, paid and hobby, with the skills each one is looking for.",
      path: "/collab",
      card: ogCardPath("board", "collab"),
      search: match.search,
    }),
  component: CollabBrowsePage,
});
