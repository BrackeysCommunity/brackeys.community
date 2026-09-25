import { createFileRoute } from "@tanstack/react-router";

import { forumCategoriesQueryOptions } from "@/components/forum/forum-queries";
import { forumFeedSearchSchema } from "@/components/forum/forum-search";
import { ForumCategoryPage } from "@/components/forum/ForumBrowse";
import { listingMeta, ogCardPath } from "@/lib/site-meta";

export const Route = createFileRoute("/forum/c/$categorySlug")({
  validateSearch: forumFeedSearchSchema,
  // The same for every viewer, so safe to load on the server; a dark
  // forum answers NOT_FOUND and the page renders its own 404.
  loader: async ({ context: { queryClient }, params }) => {
    const categories = await queryClient
      .ensureQueryData(forumCategoriesQueryOptions())
      .catch(() => null);
    return { category: categories?.find((c) => c.slug === params.categorySlug) ?? null };
  },
  head: ({ params, match, loaderData }) =>
    listingMeta({
      title: loaderData?.category ? `${loaderData.category.name} · Forum` : "Forum",
      description: loaderData?.category?.description ?? undefined,
      path: `/forum/c/${params.categorySlug}`,
      card: loaderData?.category
        ? ogCardPath("category", params.categorySlug)
        : ogCardPath("board", "forum"),
      search: match.search,
    }),
  component: CategoryRoute,
});

function CategoryRoute() {
  const { categorySlug } = Route.useParams();
  const search = Route.useSearch();
  return <ForumCategoryPage categorySlug={categorySlug} search={search} />;
}
