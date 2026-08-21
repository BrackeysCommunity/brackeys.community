import { useStore } from "@tanstack/react-store";

import { activeUserStore } from "@/lib/active-user-store";
import { profileLinkParams } from "@/lib/profile-links";

/**
 * Route params for the signed-in user's own `/profile/$userId` link,
 * preferring their claimed stub. The store hydrates just after the session
 * resolves, so early clicks may still carry the raw id — the profile
 * route's loader 301s those onto the stub, so the landing URL is always
 * canonical either way.
 */
export function useMyProfileParams(userId: string | null | undefined): { userId: string } | null {
  const urlStub = useStore(activeUserStore, (s) => s.profile?.urlStub);
  if (!userId) return null;
  return profileLinkParams({ id: userId, urlStub });
}
