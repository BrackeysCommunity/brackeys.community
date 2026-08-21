import { createFileRoute, notFound } from "@tanstack/react-router";

import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { ProjectPage } from "@/components/projects/ProjectPage";
import { siteUrl } from "@/env";
import { projectTypeLabel } from "@/lib/project-links";
import { breadcrumbNode, buildMeta, jsonLd, NOT_FOUND_OG_CARD, ogCardPath } from "@/lib/site-meta";
import { client } from "@/orpc/client";

/**
 * A project's canonical page — the game, tool, pack or site itself, credited
 * to the people and teams who made it.
 *
 * Loads through a route `loader` for the same reason the jam page does: this
 * is a shareable, indexable destination, and a client-fetched page hands a
 * crawler an empty shell.
 */
export const Route = createFileRoute("/projects/$projectSlug")({
  loader: async ({ params }) => {
    // Two reads: the anonymous page, and where the viewer stands with it.
    // The public one is edge-cacheable and serves published rows only; the
    // private one carries `viewerCanEdit` and, for an editor of an
    // unpublished project, the page the public read withholds.
    const [publicDetail, viewer] = await Promise.all([
      client.getProject({ idOrSlug: params.projectSlug }),
      // Throws UNAUTHORIZED for a signed-out visitor, which is just "no
      // edit rights" — not an error the page should surface.
      client.getProjectViewerState({ idOrSlug: params.projectSlug }).catch(() => null),
    ]);

    const detail = publicDetail ?? viewer?.detail;
    // Null covers both "no such project" and "unpublished, and you're not one
    // of its editors" — the page shouldn't distinguish those to a stranger.
    if (!detail) throw notFound();

    return { ...detail, viewerCanEdit: viewer?.viewerCanEdit ?? false };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return buildMeta({
        title: "Project not found",
        path: "/",
        card: NOT_FOUND_OG_CARD,
        noindexNofollow: true,
        canonical: false,
      });
    }
    const project = loaderData.project;
    const kind = projectTypeLabel(project).toLowerCase();
    const credits = loaderData.contributors
      .slice(0, 3)
      .map((contributor) => contributor.displayName)
      .join(", ");
    const description =
      project.description ??
      (credits ? `A ${kind} by ${credits}.` : `A ${kind} on Brackeys Community.`);
    const path = `/projects/${project.slug}`;

    return {
      ...buildMeta({
        title: project.title,
        description,
        path,
        // A generated card rather than the raw cover: itch's 300×240
        // derivative declared as `summary_large_image` is a blurry stretch.
        card: ogCardPath("project", project.slug),
        imageAlt: `${project.title} on Brackeys Community`,
        // Indexing follows anchoring, not existence: unpublished pages and
        // unanchored single-jam scrape-mints both stay out of the index —
        // the server computes which is which.
        noindex: !loaderData.indexable,
      }),
      scripts: jsonLd([
        {
          "@context": "https://schema.org",
          // itch's `classification` decides which; Google renders both.
          "@type": project.type === "game" ? "VideoGame" : "SoftwareApplication",
          name: project.title,
          url: siteUrl(path),
          description,
          ...(project.imageUrl ? { image: siteUrl(project.imageUrl) } : {}),
          ...(project.platforms?.length ? { gamePlatform: project.platforms } : {}),
          ...(project.releasedAt
            ? { datePublished: new Date(project.releasedAt).toISOString().slice(0, 10) }
            : {}),
          ...(loaderData.contributors.length > 0
            ? {
                author: loaderData.contributors.slice(0, 10).map((contributor) => ({
                  "@type": "Person",
                  name: contributor.displayName,
                })),
              }
            : {}),
          applicationCategory: "Game",
        },
        {
          "@context": "https://schema.org",
          ...breadcrumbNode([{ name: project.title, path }]),
        },
      ]),
    };
  },
  component: ProjectRoute,
  notFoundComponent: ProjectNotFound,
});

function ProjectRoute() {
  return <ProjectPage detail={Route.useLoaderData()} />;
}

function ProjectNotFound() {
  return <NotFoundPage subject="Project" message="That link doesn't match any project here." />;
}
