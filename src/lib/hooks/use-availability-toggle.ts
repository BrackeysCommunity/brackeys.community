import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";

import { activeUserStore, updateActiveUserProfile } from "@/lib/active-user-store";
import { reportMutationError } from "@/lib/product-insights";
import { toast } from "@/lib/toast";
import { client } from "@/orpc/client";

/**
 * The one writer of `developer_profiles.availableForWork`.
 *
 * Three surfaces flip this flag — the profile hero's card, the edit flyout's
 * AVAILABILITY step, and the header's user menu — and each of the first two
 * used to own its own mutation, so flipping it in one left the others
 * showing the old state until something refetched. The flag now lives in
 * `activeUserStore`, this hook is what writes it, and every surface reads
 * back from there.
 *
 * The store write is optimistic and rolls back on failure: the switch has to
 * move under the finger, and a round trip is long enough that it otherwise
 * reads as a dead control (§8.2 is the same complaint about a different one).
 */
export function useAvailabilityToggle({
  initial,
  queryKey,
  onStatus,
  notify = true,
}: {
  /** What the server said, for the frames before the store has loaded — the
      profile page renders from its own query well before the session's
      `getMyProfile` resolves, and reading `false` in the gap would flip a
      switch the owner had left on. */
  initial?: boolean;
  /** Profile query to invalidate once the write lands, when one is mounted. */
  queryKey?: readonly unknown[];
  /** The flyout reports into its own save indicator instead of a toast. */
  onStatus?: (status: "saving" | "saved" | "error") => void;
  /** Toast on success/failure. Off where the caller shows its own state. */
  notify?: boolean;
} = {}) {
  const qc = useQueryClient();
  const stored = useStore(activeUserStore, (s) => s.profile?.availableForWork);
  const available = stored ?? initial ?? false;

  const mutation = useMutation({
    mutationFn: (next: boolean) => client.updateProfile({ availableForWork: next }),
    onMutate: (next) => {
      const previous = activeUserStore.state.profile?.availableForWork;
      updateActiveUserProfile({ availableForWork: next });
      onStatus?.("saving");
      return { previous };
    },
    onSuccess: (_data, next) => {
      onStatus?.("saved");
      if (queryKey) void qc.invalidateQueries({ queryKey });
      if (notify) {
        toast.success(next ? "You're shown as available for work" : "Availability turned off");
      }
    },
    onError: (error, _next, context) => {
      if (context?.previous !== undefined) {
        updateActiveUserProfile({ availableForWork: context.previous });
      }
      reportMutationError(error, "profile.toggle_availability");
      onStatus?.("error");
      if (notify) toast.error("Failed to update availability");
    },
  });

  return {
    available,
    isPending: mutation.isPending,
    setAvailable: (next: boolean) => mutation.mutate(next),
  };
}
