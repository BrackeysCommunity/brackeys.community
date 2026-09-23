import { createFileRoute } from "@tanstack/react-router";

import { forumFeedSearchSchema } from "@/components/forum/forum-search";
import { ForumTagPage } from "@/components/forum/ForumBrowse";
import { listingMeta } from "@/lib/site-meta";

export const Route = createFileRoute("/forum/tags/$tag")({
  validateSearch: forumFeedSearchSchema,
  head: ({ params, match }) =>
    listingMeta({
      title: `#${params.tag} on the forum`,
      description: `Forum posts tagged #${params.tag} in the Brackeys community.`,
      path: `/forum/tags/${params.tag}`,
      search: match.search,
    }),
  component: TagRoute,
});

function TagRoute() {
  const { tag } = Route.useParams();
  const search = Route.useSearch();
  return <ForumTagPage tag={tag} search={search} />;
}
