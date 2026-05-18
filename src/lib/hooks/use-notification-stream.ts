import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/orpc/client";

/**
 * Opens a long-lived EventSource to `/api/notifications/stream` while a
 * user is signed in. Each `notification` event:
 *   - bumps the cached `unreadCount` by 1 (so the bell flips immediately)
 *   - invalidates any active `listNotifications` queries so an open
 *     popover / inbox refetches the freshest page
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
      const unreadKey = orpc.unreadCount.queryOptions({ input: {} }).queryKey;
      queryClient.setQueryData<{ count: number } | undefined>(unreadKey, (prev) =>
        prev ? { count: prev.count + 1 } : { count: 1 },
      );
      void queryClient.invalidateQueries({
        queryKey: orpc.listNotifications.queryOptions({ input: { limit: 20 } }).queryKey,
      });
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
