import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { ProfilePage } from "@/components/profile/ProfilePage";
import { adaptProfile, type RpcProfile } from "@/components/profile/ProfilePage/profile-adapter";
import { Text } from "@/components/ui/typography";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/profile/$userId")({
  component: ProfileById,
});

/**
 * Renders the redesigned profile page for a specific user. The
 * route param accepts both the raw `developer_profiles.id` and the
 * URL-stub form (resolution happens server-side in `getProfile`).
 *
 * The oRPC response shape is mapped to the page's typed view model
 * via `adaptProfile` so the UI is decoupled from the database
 * schema's evolution; phase 5 lands the migrations for the fields
 * the view model carries as `null` today.
 */
function ProfileById() {
  const { userId } = Route.useParams();
  const { data: session } = authClient.useSession();
  const queryOptions = orpc.getProfile.queryOptions({ input: { userId } });
  const { data, isLoading } = useQuery({
    ...queryOptions,
    staleTime: 60 * 1000,
  });

  if (isLoading) return <ProfileLoadingState />;
  if (!data) return <ProfileNotFoundState />;

  const profile = adaptProfile(data as unknown as RpcProfile);
  const isOwner = data.isOwner || session?.user?.id === userId;
  return <ProfilePage profile={profile} isOwner={isOwner} queryKey={queryOptions.queryKey} />;
}

function ProfileLoadingState() {
  return (
    <div className="flex items-center justify-center py-24">
      <Text monospace size="xs" variant="muted" className="animate-pulse tracking-widest uppercase">
        Loading profile…
      </Text>
    </div>
  );
}

function ProfileNotFoundState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-24">
      <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
        ✕ PROFILE NOT FOUND
      </Text>
      <Text size="sm" variant="muted">
        The handle you're looking for doesn't match any profile.
      </Text>
    </div>
  );
}
