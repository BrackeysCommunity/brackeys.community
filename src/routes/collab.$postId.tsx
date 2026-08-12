import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { CollabPostPage } from "@/components/collab/CollabPostPage";
import { htmlToPlainText, Text } from "@/components/ui/typography";
import { client } from "@/orpc/client";

/**
 * A post's permanent page — the shareable, indexable URL for one post.
 *
 * The board keeps its own `?post=<id>` selection for the inspector and
 * drawer; this page exists so a post can be linked, unfurled, and
 * crawled. Like the jam page, it loads through a server `loader` rather
 * than a `useQuery` so the content and meta tags are in the document a
 * crawler receives, not fetched into an empty shell afterwards.
 */
export const Route = createFileRoute("/collab/$postId")({
  loader: async ({ params }) => {
    const postId = Number(params.postId);
    if (!Number.isFinite(postId) || postId <= 0) throw notFound();
    const post = await client.getPost({ postId });
    if (!post) throw notFound();
    return { post };
  },
  head: ({ loaderData }) => {
    const post = loaderData?.post;
    if (!post) return {};
    const title = `${post.title} · Brackeys Community`;
    const description =
      htmlToPlainText(post.description, 180) ??
      `${post.title} — an open collaboration post on the Brackeys community board.`;
    // Same art-fallback chain as the page's hero, so the unfurl card
    // matches what the link opens onto.
    const image = post.images[0]?.url ?? post.project?.imageUrl ?? post.jam?.bannerUrl;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: post.title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        ...(image ? [{ property: "og:image", content: image }] : []),
        { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
      ],
    };
  },
  component: CollabPostRoute,
  notFoundComponent: PostNotFound,
});

function CollabPostRoute() {
  const { post } = Route.useLoaderData();
  return <CollabPostPage initialPost={post} />;
}

function PostNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-24">
      <Text size="xs" variant="muted" className="tracking-widest uppercase">
        ✕ POST NOT FOUND
      </Text>
      <Text size="sm" variant="muted">
        This post does not exist or has been deleted.
      </Text>
      <Link
        to="/collab"
        search={{}}
        className="mt-2 text-xs tracking-widest text-primary uppercase hover:underline"
      >
        BROWSE THE BOARD →
      </Link>
    </div>
  );
}
