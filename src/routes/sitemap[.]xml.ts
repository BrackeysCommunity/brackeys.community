import { createFileRoute } from "@tanstack/react-router";

import { withErrorReporting } from "@/lib/posthog-server";
import { isSitemapSection, renderSitemapIndex, renderSitemapSection } from "@/lib/sitemap";

/**
 * The index, or — with `?section=jams&page=0` — one of its children. The
 * `[.]` in the filename escapes the dot so the router reads it as part of
 * the path segment rather than its own nesting separator.
 */
async function handle({ request }: { request: Request }) {
  const { searchParams } = new URL(request.url);
  const section = searchParams.get("section");

  let body: string;
  if (section == null) {
    body = await renderSitemapIndex();
  } else if (isSitemapSection(section)) {
    const page = Number(searchParams.get("page") ?? "0");
    if (!Number.isInteger(page) || page < 0) return new Response("Not Found", { status: 404 });
    body = await renderSitemapSection(section, page);
  } else {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      // Restated from `routeRules` for crawlers that reach the origin directly.
      "cache-control": "public, max-age=0, s-maxage=3600",
    },
  });
}

const reportedHandle = withErrorReporting("/sitemap.xml", handle);

export const Route = createFileRoute("/sitemap.xml")({
  server: { handlers: { HEAD: reportedHandle, GET: reportedHandle } },
});
