import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { forumFeedSearchSchema } from "@/components/forum/forum-search";
import { ForumTagPage } from "@/components/forum/ForumBrowse";
import { listingMeta, ogCardPath } from "@/lib/site-meta";

const routeApi = getRouteApi("/forum/tags/$tag");

export const Route = createFileRoute("/forum/tags/$tag")({
  validateSearch: forumFeedSearchSchema,
  head: ({ params, match }) =>
    listingMeta({
      title: `#${params.tag} on the forum`,
      description: `Forum posts tagged #${params.tag} in the Brackeys community.`,
      path: `/forum/tags/${params.tag}`,
      card: ogCardPath("board", "forum"),
      search: match.search,
    }),
  component: TagRoute,
});

function TagRoute() {
  const { tag } = routeApi.useParams();
  const search = routeApi.useSearch();
  return <ForumTagPage tag={tag} search={search} />;
}
