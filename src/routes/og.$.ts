import { createFileRoute } from "@tanstack/react-router";

import { withErrorReporting } from "@/lib/posthog-server";
import { DEFAULT_OG_IMAGE } from "@/lib/site-meta";

/**
 * `/og/<kind>/<id>.png` — the generated social card for one page. A failure
 * falls back to the committed static card rather than a 500: an `og:image`
 * that errors makes the page itself look broken in the unfurl.
 */
async function handle({ request }: { request: Request }) {
  const { pathname } = new URL(request.url);
  const target = pathname.slice("/og/".length);

  try {
    const { renderOgPng } = await import("@/lib/og/render");
    const { ogCard } = await import("@/lib/og/card");
    const input = await resolveCard(target);
    if (!input) return new Response("Not Found", { status: 404 });

    const png = await renderOgPng(ogCard(input));
    // `slice()`, not `png.buffer`: the view's slack bytes would be sent too.
    const body = png.slice().buffer as ArrayBuffer;

    return new Response(body, {
      headers: {
        "content-type": "image/png",
        "content-length": String(png.byteLength),
        "cache-control": "public, max-age=0, s-maxage=86400",
      },
    });
  } catch (error) {
    console.error("[og] card render failed", target, error);
    return new Response(null, {
      status: 302,
      headers: { location: DEFAULT_OG_IMAGE, "cache-control": "no-store" },
    });
  }
}

async function resolveCard(target: string) {
  const data = await import("@/lib/og/data");
  if (target === "default.png") return data.siteCard();

  const match = /^([a-z]+)\/(.+)\.png$/.exec(target);
  if (!match) return null;
  const [, kind, rawId] = match;

  let id: string;
  try {
    id = decodeURIComponent(rawId!);
  } catch {
    return null;
  }

  switch (kind) {
    case "jam":
      return data.jamCard(id);
    case "project":
      return data.projectCard(id);
    case "collab": {
      const postId = Number(id);
      return Number.isInteger(postId) && postId > 0 ? data.collabCard(postId) : null;
    }
    case "profile":
      return data.profileCard(id);
    case "team":
      return data.teamCard(id);
    case "board":
      return data.boardCard(id);
    default:
      return null;
  }
}

const reportedHandle = withErrorReporting("/og/$", handle);

export const Route = createFileRoute("/og/$")({
  server: { handlers: { HEAD: reportedHandle, GET: reportedHandle } },
});
