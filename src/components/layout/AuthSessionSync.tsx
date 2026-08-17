import { useEffect } from "react";

import { clearActiveUserProfile, fetchActiveUserProfile } from "@/lib/active-user-store";
import { authClient } from "@/lib/auth-client";
import { setAuthSession } from "@/lib/auth-store";
import { identifyUser } from "@/lib/posthog";

/**
 * Mirrors the better-auth client session into `authStore` (and keeps the
 * active-user profile in step with it). Mounted once in the root shell,
 * outside the mobile/desktop split — `authStore` consumers must see the
 * session regardless of which layout is up.
 */
export function AuthSessionSync() {
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    // Hold the store's initial pending state until the session fetch
    // resolves — writing `null` early would read as a settled "signed out".
    if (isPending) return;
    setAuthSession(session ?? null);
    if (session?.user) {
      void fetchActiveUserProfile();
      // Analytics identity is memory-only under cookieless mode, so this is
      // how a signed-in visitor gets re-attached on every page load — not a
      // one-off at login. The absent-session branch deliberately does *not*
      // `reset()`: that would churn the anonymous id on every logged-out
      // page load. Sign-out handles it (see `UserMenu`).
      identifyUser(session.user);
    } else {
      clearActiveUserProfile();
    }
  }, [session, isPending]);

  return null;
}
