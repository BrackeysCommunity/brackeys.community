import { createFileRoute } from "@tanstack/react-router";

import { siteOrigin, siteUrl } from "@/env";
import { withErrorReporting } from "@/lib/posthog-server";

/**
 * Generated rather than static: the `Sitemap:` line carries this
 * deployment's own origin, and a preview or staging hostname disallows the
 * whole site instead of shipping production's "index me".
 */
const DISALLOWED = [
  "/api/",
  "/oauth/",
  "/images/",
  "/command-center",
  "/game",
  "/profile$",
  "/suspended",
  "/settings",
  "/notifications",
  "/admin",
];

function isCanonicalOrigin(request: Request): boolean {
  try {
    return new URL(request.url).host === new URL(siteOrigin()).host;
  } catch {
    return false;
  }
}

function handle({ request }: { request: Request }) {
  const lines = isCanonicalOrigin(request)
    ? [
        "User-agent: *",
        ...DISALLOWED.map((path) => `Disallow: ${path}`),
        "",
        `Sitemap: ${siteUrl("/sitemap.xml")}`,
      ]
    : [
        "# Non-canonical origin (preview, staging, or a bare Railway hostname).",
        "User-agent: *",
        "Disallow: /",
      ];

  return new Response(`${lines.join("\n")}\n`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600",
    },
  });
}

const reportedHandle = withErrorReporting("/robots.txt", handle);

export const Route = createFileRoute("/robots.txt")({
  server: { handlers: { HEAD: reportedHandle, GET: reportedHandle } },
});
