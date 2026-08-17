import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { ProfilePage } from "@/components/profile/ProfilePage";
import { adaptProfile, type RpcProfile } from "@/components/profile/ProfilePage/profile-adapter";
import { ProfilePageSkeleton } from "@/components/profile/ProfilePage/ProfilePageSkeleton";
import { useProfileOwnerOverlay } from "@/components/profile/use-profile-owner-overlay";
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

  // Ownership follows the *resolved* profile id, not the route param — the
  // param is a vanity stub as often as an id, and comparing the session
  // against a stub never matches.
  const { isOwner, overlay } = useProfileOwnerOverlay({
    profileId: data?.profile.id,
    currentUserId: session?.user?.id,
    profileQueryKey: queryOptions.queryKey,
  });

  if (isLoading) return <ProfilePageSkeleton />;
  if (!data) return <ProfileNotFoundState />;

  // The anonymous core, plus what only the owner may see. Until the overlay
  // lands the page renders the public view of your own profile, which is
  // the correct intermediate state rather than a flash of missing sections.
  const profile = adaptProfile({
    ...data,
    isOwner,
    pendingSkillRequests: overlay?.pendingSkillRequests ?? [],
    projects: overlay?.projects ?? data.projects,
    linkedAccounts: overlay?.linkedAccounts ?? data.linkedAccounts,
  } as unknown as RpcProfile);

  return <ProfilePage profile={profile} isOwner={isOwner} queryKey={queryOptions.queryKey} />;
}

function ProfileNotFoundState() {
  return (
    <NotFoundPage
      subject="Profile"
      message="The handle you're looking for doesn't match any profile."
    />
  );
}
