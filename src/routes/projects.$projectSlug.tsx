import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { ProjectPage } from "@/components/projects/ProjectPage";
import { Text } from "@/components/ui/typography";
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
    const detail = await client.getProject({ idOrSlug: params.projectSlug });
    // Null covers both "no such project" and "unpublished, and you're not one
    // of its editors" — the page shouldn't distinguish those to a stranger.
    if (!detail) throw notFound();
    return detail;
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
        // An unpublished project is visible only to its editors; keep it out
        // of the index even for them.
        ...(project.published ? [] : [{ name: "robots", content: "noindex" }]),
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
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-24">
      <Text size="xs" variant="muted" className="tracking-widest uppercase">
        ✕ PROJECT NOT FOUND
      </Text>
      <Text size="sm" variant="muted">
        That link doesn't match any project here.
      </Text>
      <Link
        to="/members"
        className="mt-2 font-mono text-[10px] tracking-widest text-primary uppercase hover:underline"
      >
        BROWSE MEMBERS →
      </Link>
    </div>
  );
}
