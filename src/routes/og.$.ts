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
    if (!input) {
      // Unknown kind or id still gets a card body — the 404 status keeps
      // it honest, the image keeps a stale link's unfurl ours. Short edge
      // TTL (`cdn-cache-control` outranks the `/og/**` route rule) since
      // the id may start existing.
      const { notFoundCard } = await import("@/lib/og/data");
      const png = await renderOgPng(ogCard(notFoundCard()));
      return pngResponse(png, {
        status: 404,
        headers: {
          "cache-control": "public, max-age=0, s-maxage=300",
          "cdn-cache-control": "max-age=300",
        },
      });
    }

    const png = await renderOgPng(ogCard(input));
    return pngResponse(png, { headers: { "cache-control": "public, max-age=0, s-maxage=86400" } });
  } catch (error) {
    console.error("[og] card render failed", target, error);
    // The `/og/**` route rule overwrites `cache-control` with the day-long
    // edge TTL; `cdn-cache-control` outranks it at Cloudflare and the rule
    // leaves it alone, so a transient failure is never edge-cached.
    return new Response(null, {
      status: 302,
      headers: {
        location: DEFAULT_OG_IMAGE,
        "cache-control": "no-store",
        "cdn-cache-control": "no-store",
      },
    });
  }
}

function pngResponse(
  png: Uint8Array,
  { status = 200, headers }: { status?: number; headers: Record<string, string> },
): Response {
  // `slice()`, not `png.buffer`: the view's slack bytes would be sent too.
  return new Response(png.slice().buffer as ArrayBuffer, {
    status,
    headers: {
      "content-type": "image/png",
      "content-length": String(png.byteLength),
      ...headers,
    },
  });
}

async function resolveCard(target: string) {
  const data = await import("@/lib/og/data");
  if (target === "default.png") return data.siteCard();
  if (target === "notfound.png") return data.notFoundCard();

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
