import { createFileRoute, notFound } from "@tanstack/react-router";

import { CollabPostPage } from "@/components/collab/CollabPostPage";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { htmlToPlainText } from "@/components/ui/typography";
import { siteUrl } from "@/env";
import { memberName } from "@/lib/member-name";
import { breadcrumbNode, buildMeta, jsonLd, ogCardPath, organizationNode } from "@/lib/site-meta";
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
      return buildMeta({ title: "Post not found", path: "/collab", noindexNofollow: true });
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
      scripts: jsonLd([
        ...(jobPostingNode(post, description) ?? []),
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

interface JobPostingSource {
  id: number;
  title: string;
  type: string;
  status: string;
  createdAt: Date | string | null;
  expiresAt: Date | string | null;
  compensationType: string | null;
  compensationMin: number | null;
  compensationMax: number | null;
  roles: { name: string }[];
  team: { name: string } | null;
}

/**
 * Google Jobs treats `JobPosting` as a commitment, so a post that isn't
 * paid, recruiting, priced and dated stays a plain article.
 */
function jobPostingNode(post: JobPostingSource, description: string) {
  if (post.type !== "paid" || post.status !== "recruiting") return null;
  if (post.compensationMin == null && post.compensationMax == null) return null;
  if (!post.expiresAt) return null;

  const amount = post.compensationMax ?? post.compensationMin!;
  const unitText = post.compensationType === "hourly" ? "HOUR" : "MONTH";

  return [
    {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: post.title,
      description,
      url: siteUrl(`/collab/${post.id}`),
      ...(post.createdAt ? { datePosted: new Date(post.createdAt).toISOString() } : {}),
      validThrough: new Date(post.expiresAt).toISOString(),
      employmentType: "CONTRACTOR",
      hiringOrganization: post.team
        ? { "@type": "Organization", name: post.team.name }
        : organizationNode(),
      jobLocationType: "TELECOMMUTE",
      applicantLocationRequirements: { "@type": "Country", name: "Worldwide" },
      baseSalary: {
        "@type": "MonetaryAmount",
        currency: "USD",
        value: {
          "@type": "QuantitativeValue",
          ...(post.compensationMin != null && post.compensationMax != null
            ? { minValue: post.compensationMin, maxValue: post.compensationMax }
            : { value: amount }),
          unitText,
        },
      },
      ...(post.roles.length > 0 ? { occupationalCategory: post.roles[0]!.name } : {}),
    },
  ];
}

function CollabPostRoute() {
  const { post } = Route.useLoaderData();
  return <CollabPostPage initialPost={post} />;
}

function PostNotFound() {
  return <NotFoundPage subject="Post" message="This post does not exist or has been deleted." />;
}
