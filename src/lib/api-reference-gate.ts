import { auth } from "@/lib/auth";
import { isActiveBan } from "@/lib/ban-state";
import { isStaffMember } from "@/lib/discord";
import { captureServerException } from "@/lib/posthog-server";
import { resolveUserRoles } from "@/lib/staff-roles";

/**
 * The interactive API reference and its generated spec enumerate every
 * procedure in the router — the staff/admin surface included. Individual
 * procedures self-gate, so this is recon exposure rather than a bypass,
 * but the docs are staff-only and everyone else gets a 404 (never a 403)
 * so their existence leaks nothing — the same posture as `/admin`.
 */
export function isReferenceDocsPath(pathname: string): boolean {
  return pathname === "/api" || pathname === "/api/" || pathname === "/api/spec.json";
}

export async function canViewReferenceDocs(request: Request): Promise<boolean> {
  // Reported before degrading to the 404: an auth outage locking staff out
  // of the docs should be visible as what it is.
  const session = await auth.api.getSession({ headers: request.headers }).catch((err: unknown) => {
    captureServerException(err, { scope: "api_reference_gate.session_read" });
    return null;
  });
  if (!session || isActiveBan(session.user)) return false;

  const roles = await resolveUserRoles(session.user.id);
  return isStaffMember(roles);
}
