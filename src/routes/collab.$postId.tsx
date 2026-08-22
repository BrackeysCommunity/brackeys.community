import { createFileRoute, notFound } from "@tanstack/react-router";

import { CollabPostPage } from "@/components/collab/CollabPostPage";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { htmlToPlainText } from "@/lib/html-text";
import { memberName } from "@/lib/member-name";
import { breadcrumbNode, buildMeta, jsonLd, NOT_FOUND_OG_CARD, ogCardPath } from "@/lib/site-meta";
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
    if (!post) {
      return buildMeta({
        title: "Post not found",
        path: "/collab",
        card: NOT_FOUND_OG_CARD,
        noindexNofollow: true,
        canonical: false,
      });
    }
    const description =
      htmlToPlainText(post.description, 180) ??
      `${post.title} — an open collaboration post on the Brackeys community board.`;
    const path = `/collab/${post.id}`;
    const authorName = post.author ? memberName(post.author, null) : null;

    return {
      ...buildMeta({
        title: post.title,
        description,
        path,
        card: ogCardPath("collab", post.id),
        imageAlt: `${post.title} — an open role on the Brackeys collab board`,
        type: "article",
        meta: [
          ...(post.createdAt
            ? [
                {
                  property: "article:published_time",
                  content: new Date(post.createdAt).toISOString(),
                },
              ]
            : []),
          ...(authorName ? [{ property: "article:author", content: authorName }] : []),
        ],
      }),
      // No `JobPosting` node: Google requires real countries in
      // `applicantLocationRequirements` for a remote posting, and posts
      // carry no country data — "Worldwide" is not a country.
      scripts: jsonLd([
        {
          "@context": "https://schema.org",
          ...breadcrumbNode([
            { name: "Collab board", path: "/collab" },
            { name: post.title, path },
          ]),
        },
      ]),
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
  return <NotFoundPage subject="Post" message="This post does not exist or has been deleted." />;
}
