import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/orpc/client";

/**
 * The owner's own view of their profile, layered over the anonymous core
 * that `getProfile` now returns.
 *
 * Three things the public response deliberately withholds, all of which the
 * existing private `getMyProfile` already carries — so this is a
 * composition, not a new endpoint:
 *
 * - the **full project set**, including itch.io drafts, "Restricted" pages
 *   and titles that vanished from the linked library;
 * - **pending skill requests**, which are between the member and staff;
 * - **`linkedAccounts` with `tokenInvalidAt`**, the flag behind the
 *   "reconnect" prompt.
 *
 * The overlay is cached *underneath* the profile's own query key. Nine
 * mutation sites on this page already call
 * `invalidateQueries({ queryKey })` with that key, and TanStack matches
 * query keys by prefix — so nesting means every one of them refreshes the
 * overlay too, without threading a second key through the component tree.
 */
export function useProfileOwnerOverlay({
  profileId,
  currentUserId,
  profileQueryKey,
}: {
  /** The *resolved* profile id, not the route param — which may be a stub. */
  profileId: string | undefined;
  currentUserId: string | undefined;
  profileQueryKey: readonly unknown[];
}) {
  const isOwner = Boolean(profileId) && profileId === currentUserId;

  const { data } = useQuery({
    ...orpc.getMyProfile.queryOptions({
      input: {},
      queryKey: [...profileQueryKey, "owner-overlay"],
    }),
    enabled: isOwner,
  });

  return { isOwner, overlay: data ?? null };
}
