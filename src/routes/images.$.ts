import { createFileRoute } from "@tanstack/react-router";

import { streamStoredImage } from "@/lib/profile-project-image-storage";
import { isServableImageKey } from "@/lib/profile-project-images";

/**
 * Stable public URLs for uploaded images (project covers, team avatars,
 * collab post images): `/images/<object key>` streams the object from the
 * private MinIO bucket. Keys are nanoid-unique per upload, so responses are
 * immutable — cacheable by browsers, the Cloudflare edge, and usable as
 * `/cdn-cgi/image/` transform sources (src/lib/itch-image.ts) — which
 * presigned links could never be: their signature rotated on every read.
 */
async function handle({ request }: { request: Request }) {
  const { pathname } = new URL(request.url);

  let objectKey: string;
  try {
    objectKey = decodeURIComponent(pathname.slice("/images/".length));
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (!isServableImageKey(objectKey)) {
    return new Response("Not Found", { status: 404 });
  }

  return streamStoredImage(objectKey, request);
}

export const Route = createFileRoute("/images/$")({
  server: {
    handlers: {
      HEAD: handle,
      GET: handle,
    },
  },
});
