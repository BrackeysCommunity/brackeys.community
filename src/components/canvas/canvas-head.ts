import { buildMeta, ogCardPath, pageTitle, SITE_NAME } from "@/lib/site-meta";

type HeadCanvas = {
  id: string;
  title: string;
  visibility: string;
  hidden: boolean;
  deletedAt: Date | string | null;
  nodeCount: number;
};

/** Public or unlisted, and not hidden or deleted: a canvas a link preview may show. */
function isOpen(
  canvas: HeadCanvas | null,
): canvas is HeadCanvas & { visibility: "public" | "unlisted" } {
  return (
    canvas != null &&
    (canvas.visibility === "public" || canvas.visibility === "unlisted") &&
    !canvas.hidden &&
    !canvas.deletedAt
  );
}

/**
 * Only a public canvas is indexed. An unlisted one is shared by link, so
 * the link unfurls with its card but stays out of search; everything else
 * is only ever seen by people it's shared with.
 */
export function canvasHeadMeta(canvas: HeadCanvas | null) {
  if (!isOpen(canvas)) {
    return {
      meta: [
        { title: pageTitle(canvas?.title ?? "Canvas") },
        { name: "robots", content: "noindex" },
      ],
      links: [],
    };
  }
  const cards = `${canvas.nodeCount} ${canvas.nodeCount === 1 ? "card" : "cards"}`;
  return buildMeta({
    title: canvas.title,
    description: `A canvas on ${SITE_NAME}: ${cards}.`,
    path: `/canvases/${canvas.id}`,
    card: ogCardPath("canvas", canvas.id),
    imageAlt: `${canvas.title} on ${SITE_NAME}`,
    noindex: canvas.visibility !== "public",
  });
}

/** The same robots rule as a response header, for crawlers that skip the HTML. */
export function canvasHeadHeaders(canvas: HeadCanvas | null): Record<string, string> | undefined {
  if (isOpen(canvas) && canvas.visibility === "public") return undefined;
  return { "X-Robots-Tag": "noindex" };
}
