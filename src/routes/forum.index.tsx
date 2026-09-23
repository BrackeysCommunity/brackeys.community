import { createFileRoute } from "@tanstack/react-router";

import { forumFeedSearchSchema } from "@/components/forum/forum-search";
import { ForumHomePage } from "@/components/forum/ForumBrowse";
import { listingMeta } from "@/lib/site-meta";

export const Route = createFileRoute("/forum/")({
  validateSearch: forumFeedSearchSchema,
  head: ({ match }) =>
    listingMeta({
      title: "Forum",
      description:
        "Devlogs, questions and show-and-tell from the Brackeys community — the things worth keeping between jams.",
      path: "/forum",
      search: match.search,
    }),
  component: ForumIndex,
});

function ForumIndex() {
  const search = Route.useSearch();
  return <ForumHomePage search={search} />;
}
