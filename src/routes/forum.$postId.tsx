import { ORPCError } from "@orpc/client";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { forumPostQueryOptions, type ForumPostDetail } from "@/components/forum/forum-queries";
import { ForumPostPage } from "@/components/forum/ForumPostPage";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { siteUrl } from "@/env";
import { forumPostParam, forumPostTitle, parseForumPostParam } from "@/lib/forum-posts";
import { ANON_VIEWER, memberDisplayName } from "@/lib/member-name";
import { censorText } from "@/lib/profanity";
import { profileSlug } from "@/lib/profile-links";
import { breadcrumbNode, buildMeta, jsonLd, NOT_FOUND_OG_CARD, ogCardPath } from "@/lib/site-meta";

/**
 * JSON-LD for a live post: `BlogPosting` for a devlog, which reads as an
 * article, and `DiscussionForumPosting` for posts and questions.
 */
function postNode(post: ForumPostDetail, path: string, headline: string) {
  const authorName = post.author ? memberDisplayName(post.author, ANON_VIEWER) : null;
  return {
    "@context": "https://schema.org",
    "@type": post.kind === "devlog" ? "BlogPosting" : "DiscussionForumPosting",
    headline,
    url: siteUrl(path),
    ...(post.publishedAt ? { datePublished: new Date(post.publishedAt).toISOString() } : {}),
    ...(post.editedAt ? { dateModified: new Date(post.editedAt).toISOString() } : {}),
    ...(post.excerpt ? { text: censorText(post.excerpt) } : {}),
    ...(post.team
      ? {
          author: {
            "@type": "Organization",
            name: post.team.name,
            url: siteUrl(`/teams/${post.team.slug}`),
          },
        }
      : post.author && authorName
        ? {
            author: {
              "@type": "Person",
              name: authorName,
              url: siteUrl(`/profile/${profileSlug(post.author)}`),
            },
          }
        : {}),
    commentCount: post.commentCount,
    interactionStatistic: [
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/LikeAction",
        userInteractionCount: post.likeCount,
      },
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/CommentAction",
        userInteractionCount: post.commentCount,
      },
    ],
  };
}

/**
 * A forum post's page. `$postId` takes `1234` or `1234-some-slug`; either
 * hops to the canonical slugged URL, so shares and crawlers converge on one
 * address and a renamed post's old links still land.
 */
export const Route = createFileRoute("/forum/$postId")({
  loader: async ({ context: { queryClient }, params, location }) => {
    const postId = parseForumPostParam(params.postId);
    if (postId == null) throw notFound();
    const post = await queryClient
      .ensureQueryData(forumPostQueryOptions(postId))
      .catch((error: unknown) => {
        // A dark forum answers NOT_FOUND too; both are this page's 404.
        if (error instanceof ORPCError && error.code === "NOT_FOUND") return null;
        throw error;
      });
    if (!post) throw notFound();

    const canonical = forumPostParam(post);
    if (params.postId !== canonical) {
      throw redirect({
        to: "/forum/$postId",
        params: { postId: canonical },
        hash: location.hash || undefined,
        statusCode: 301,
      });
    }
    return post;
  },
  head: ({ loaderData: post }) => {
    if (!post) {
      return buildMeta({
        title: "Post not found",
        path: "/forum",
        card: NOT_FOUND_OG_CARD,
        noindexNofollow: true,
        canonical: false,
      });
    }
    const path = `/forum/${forumPostParam(post)}`;
    const title = censorText(forumPostTitle(post)) ?? "Forum post";
    const live = post.visibility === "visible" && post.status === "published";
    const description =
      censorText(post.excerpt) ?? `${post.category.name} on the Brackeys community forum.`;

    return {
      ...buildMeta({
        title,
        description,
        path,
        card: ogCardPath("forum", post.id),
        imageAlt: title,
        type: "article",
        ...(live ? {} : { noindexNofollow: true, canonical: false }),
        meta: post.publishedAt
          ? [
              {
                property: "article:published_time",
                content: new Date(post.publishedAt).toISOString(),
              },
              { property: "article:section", content: post.category.name },
              ...post.tags.map((tag) => ({ property: "article:tag", content: tag })),
            ]
          : [],
      }),
      scripts: live
        ? jsonLd([
            postNode(post, path, title),
            {
              "@context": "https://schema.org",
              ...breadcrumbNode([
                { name: "Forum", path: "/forum" },
                { name: post.category.name, path: `/forum/c/${post.category.slug}` },
                { name: title, path },
              ]),
            },
          ])
        : [],
    };
  },
  component: ForumPostRoute,
  notFoundComponent: PostNotFound,
});

function ForumPostRoute() {
  const post = Route.useLoaderData();
  return <ForumPostPage key={post.id} initialPost={post} />;
}

function PostNotFound() {
  return <NotFoundPage subject="Post" message="This post does not exist or has been deleted." />;
}
