import { createFileRoute } from "@tanstack/react-router";

import { ProfilePage } from "@/components/profile/ProfilePage";
import { SAMPLE_PROFILE } from "@/components/profile/ProfilePage/sample-profile";

export const Route = createFileRoute("/profile/preview")({
  component: ProfilePagePreview,
});

/**
 * Sandbox route for the redesigned profile page. Reads from a fixed
 * sample so we can iterate on layout / typography without touching the
 * live `/profile/$userId` while the schema migrations and data
 * adapters land in a later phase.
 */
function ProfilePagePreview() {
  return <ProfilePage profile={SAMPLE_PROFILE} isOwner />;
}
