import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth";
import { isActiveBan } from "@/lib/ban-state";
import { isStaffMember } from "@/lib/discord";
import { quarantineKey } from "@/lib/image-quarantine";
import { withErrorReporting } from "@/lib/posthog-server";
import { streamStoredImage } from "@/lib/profile-project-image-storage";
import { resolveUserRoles } from "@/lib/staff-roles";
import { isServableImageKey } from "@/lib/stored-image-keys";

/**
 * Staff-only view of an uploaded image wherever it currently sits: a
 * quarantined object has moved under `quarantine/`, which `/images/`
 * refuses by design, and the `/admin` upload-flags queue still has to show
 * the mod what was flagged. Never cached — the answer changes with the
 * ruling, and the whole point of the prefix is that the public edge never
 * held it.
 */
async function handle({ request }: { request: Request }) {
  const { pathname } = new URL(request.url);

  let objectKey: string;
  try {
    objectKey = decodeURIComponent(pathname.slice("/staff-image/".length));
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  if (!isServableImageKey(objectKey)) {
    return new Response("Not Found", { status: 404 });
  }

  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session || isActiveBan(session.user)) return new Response("Not Found", { status: 404 });
  if (!isStaffMember(await resolveUserRoles(session.user.id))) {
    return new Response("Not Found", { status: 404 });
  }

  const opts = { cacheControl: "private, no-store" };
  const quarantined = await streamStoredImage(quarantineKey(objectKey), request, opts);
  if (quarantined.status !== 404) return quarantined;
  return streamStoredImage(objectKey, request, opts);
}

const reportedHandle = withErrorReporting("/staff-image/$", handle);

export const Route = createFileRoute("/staff-image/$")({
  server: {
    handlers: {
      HEAD: reportedHandle,
      GET: reportedHandle,
    },
  },
});
