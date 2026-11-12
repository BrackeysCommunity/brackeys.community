import { ORPCError } from "@orpc/client";
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";

import { GamePage, type GamePageView } from "@/components/games/GamePage";
import { componentEmbed } from "@/lib/discord-embed";
import { gameLinkPreview } from "@/lib/discord-link-preview";
import { buildMeta, NOT_FOUND_OG_CARD, ogCardPath, SITE_NAME } from "@/lib/site-meta";
import { client } from "@/orpc/client";

/**
 * The game page as this viewer may see it, or null when there is none for
 * them: a missing game, one they may not see, and a closed site all read the
 * same.
 */
export async function loadGamePage(projectId: string): Promise<GamePageView | null> {
  try {
    return await client.getGamePage({ projectId });
  } catch (error) {
    if (
      error instanceof ORPCError &&
      (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST")
    ) {
      return null;
    }
    throw error;
  }
}

/** The meta for a game page: only a public game is indexed and gets its card and Discord preview. */
export function gamePageHead(projectId: string, page: GamePageView | null | undefined) {
  if (!page) {
    return buildMeta({
      title: "Game not found",
      path: "/",
      card: NOT_FOUND_OG_CARD,
      noindexNofollow: true,
      canonical: false,
    });
  }
  const listed = page.visibility === "public" && !page.noindex && !page.hidden;
  return {
    ...buildMeta({
      title: page.title,
      description: page.description ?? `${page.title}, playable in your browser on ${SITE_NAME}.`,
      path: `/games/${projectId}`,
      ...(listed
        ? { card: ogCardPath("game", projectId), imageAlt: `${page.title} on ${SITE_NAME}` }
        : {}),
      noindex: !listed,
    }),
    scripts: listed
      ? componentEmbed(
          gameLinkPreview(
            { projectId, title: page.title, visibility: page.visibility },
            { blurb: page.description },
          ),
        )
      : [],
  };
}

const routeApi = getRouteApi("/games/$projectId");

/** A hosted game's page: its versions, where its saves go, and its credits. */
export const Route = createFileRoute("/games/$projectId")({
  loader: ({ params }) => loadGamePage(params.projectId),
  head: ({ params, loaderData }) => gamePageHead(params.projectId, loaderData),
  component: GameRoute,
});

function GameRoute() {
  const page = routeApi.useLoaderData();
  const router = useRouter();
  return <GamePage page={page} onChanged={() => void router.invalidate()} />;
}
