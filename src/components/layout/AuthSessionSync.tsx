import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { clearActiveUserProfile, fetchActiveUserProfile } from "@/lib/active-user-store";
import { authClient } from "@/lib/auth-client";
import { setAuthSession } from "@/lib/auth-store";
import { isActiveBan } from "@/lib/ban-state";
import { identifyUser } from "@/lib/posthog";

/**
 * Mirrors the better-auth client session into `authStore` (and keeps the
 * active-user profile in step with it). Mounted once in the root shell,
 * outside the mobile/desktop split — `authStore` consumers must see the
 * session regardless of which layout is up.
 */
export function AuthSessionSync() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // The ban fields ride on the session, so this costs no request.
  const suspended = session?.user ? isActiveBan(session.user) : false;

  // Once per page load: `/suspended` re-checks against the database, so a
  // session still carrying a just-lifted ban would otherwise bounce.
  const redirected = useRef(false);
  useEffect(() => {
    if (suspended && pathname !== "/suspended" && !redirected.current) {
      redirected.current = true;
      void navigate({ to: "/suspended", replace: true });
    }
  }, [suspended, pathname, navigate]);

  useEffect(() => {
    // Hold the store's initial pending state until the session fetch
    // resolves — writing `null` early would read as a settled "signed out".
    if (isPending) return;
    setAuthSession(session ?? null);
    if (session?.user) {
      void fetchActiveUserProfile();
      // Analytics identity is memory-only under cookieless mode, so this
      // re-attaches on every page load rather than once at login. The absent
      // branch deliberately doesn't `reset()` — sign-out handles that.
      identifyUser(session.user);
    } else {
      clearActiveUserProfile();
    }
  }, [session, isPending]);

  return null;
}
