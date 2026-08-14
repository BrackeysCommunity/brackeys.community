import { createFileRoute, notFound } from "@tanstack/react-router";

import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { ProjectPage } from "@/components/projects/ProjectPage";
import { projectTypeLabel } from "@/lib/project-links";
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
    const project = loaderData?.project;
    if (!project) return {};
    const kind = projectTypeLabel(project).toLowerCase();
    const credits = loaderData.contributors
      .slice(0, 3)
      .map((contributor) => contributor.displayName)
      .join(", ");
    const description =
      project.description ??
      (credits ? `A ${kind} by ${credits}.` : `A ${kind} on Brackeys Community.`);
    return {
      meta: [
        { title: `${project.title} · Brackeys Community` },
        { name: "description", content: description },
        { property: "og:title", content: project.title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        ...(project.imageUrl ? [{ property: "og:image", content: project.imageUrl }] : []),
        { name: "twitter:card", content: project.imageUrl ? "summary_large_image" : "summary" },
        // Indexing follows anchoring, not existence: unpublished pages and
        // unanchored single-jam scrape-mints both stay out of the index —
        // the server computes which is which.
        ...(loaderData.indexable ? [] : [{ name: "robots", content: "noindex" }]),
      ],
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
