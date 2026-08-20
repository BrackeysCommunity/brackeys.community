import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { ProfileBuilderPage } from "@/components/profile/ProfileBuilderPage";
import { ProfilePageSkeleton } from "@/components/profile/ProfilePage/ProfilePageSkeleton";
import { authClient } from "@/lib/auth-client";
import { buildMeta } from "@/lib/site-meta";

export const Route = createFileRoute("/profile/")({
  // Forwards a signed-in viewer to their own profile and shows everyone
  // else a sign-in CTA; `/profile/$userId` is the page worth indexing.
  head: () => buildMeta({ title: "Your profile", path: "/profile", noindexNofollow: true }),
  component: ProfileIndex,
});

/**
 * Bottom-nav `ME` destination. Signed-in viewers are forwarded to
 * their own `/profile/$userId` (which renders the redesigned
 * `ProfilePage` against real data via `getProfile`); unauthed
 * viewers see the legacy sign-in CTA. Reads `authClient.useSession`
 * directly because the desktop-only `authStore` doesn't hydrate on
 * mobile.
 */
function ProfileIndex() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPending && session?.user?.id) {
      navigate({
        to: "/profile/$userId",
        params: { userId: session.user.id },
        replace: true,
      });
    }
  }, [isPending, session?.user?.id, navigate]);

  // Resolving the session and hopping to `/profile/$userId` are two
  // waits in a row, and the destination opens on the same skeleton —
  // so drawing it here makes the whole hop one continuous load rather
  // than two announcements of it.
  if (isPending || session?.user) return <ProfilePageSkeleton />;

  return <ProfileBuilderPage />;
}
