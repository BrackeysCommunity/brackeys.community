import { useEffect } from "react";

import { clearActiveUserProfile, fetchActiveUserProfile } from "@/lib/active-user-store";
import { authClient } from "@/lib/auth-client";
import { setAuthSession } from "@/lib/auth-store";

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
    } else {
      clearActiveUserProfile();
    }
  }, [session, isPending]);

  return null;
}
