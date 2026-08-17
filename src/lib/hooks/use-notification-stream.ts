import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { invalidateNotifications } from "@/components/notifications/notification-queries";
import { authClient } from "@/lib/auth-client";
import { playNotification } from "@/lib/sound";
import { orpc } from "@/orpc/client";

/**
 * Opens a long-lived EventSource to `/api/notifications/stream` while a
 * user is signed in. Each `notification` event:
 *   - chimes, unless the user has muted audio cues
 *   - bumps the cached `unreadCount` by 1 (so the bell flips immediately)
 *   - invalidates every notification list and count, so an open popover or
 *     inbox refetches its freshest page along with its badges
 *
 * Reconnect is handled by EventSource itself. The 30s polling in the
 * bell remains as a safety net if SSE is blocked by the user's network.
 */
export function useNotificationStream() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    const source = new EventSource("/api/notifications/stream", { withCredentials: true });

    const onMessage = () => {
      playNotification();
      const unreadKey = orpc.unreadCount.queryOptions({ input: {} }).queryKey;
      queryClient.setQueryData<{ count: number } | undefined>(unreadKey, (prev) =>
        prev ? { count: prev.count + 1 } : { count: 1 },
      );
      // The optimistic bump above is the only thing that has to be instant;
      // the rest refetches, which also picks up the masthead totals and the
      // inbox's tab badges.
      invalidateNotifications(queryClient);
    };

    source.addEventListener("notification", onMessage);
    source.onerror = () => {
      // EventSource will retry on its own; nothing to do here. We log
      // through console.debug rather than warn so a flaky network
      // doesn't spam the console.
      console.debug("[notifications] EventSource transient error");
    };

    return () => {
      source.removeEventListener("notification", onMessage);
      source.close();
    };
  }, [userId, queryClient]);
}
