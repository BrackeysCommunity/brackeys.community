import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { ProfileBuilderPage } from "@/components/profile/ProfileBuilderPage";
import { Text } from "@/components/ui/typography";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/profile/")({
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

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-24">
        <Text
          monospace
          size="xs"
          variant="muted"
          className="animate-pulse tracking-widest uppercase"
        >
          Authenticating…
        </Text>
      </div>
    );
  }

  if (!session?.user) return <ProfileBuilderPage />;

  return (
    <div className="flex items-center justify-center py-24">
      <Text monospace size="xs" variant="muted" className="animate-pulse tracking-widest uppercase">
        Redirecting to your profile…
      </Text>
    </div>
  );
}
