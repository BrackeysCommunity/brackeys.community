import type { QueryClient } from "@tanstack/react-query";

import { orpc } from "@/orpc/client";

/**
 * Refetch everything that counts or lists notifications: the bell badge, the
 * masthead totals and tab badges, the popover's page, and the inbox's pages.
 * Spelled once because a caller that forgets one leaves a stale number on
 * screen next to a fresh list — which reads as a bug in the count.
 *
 * `key()` is oRPC's partial-matching key, so the single call covers the
 * popover's plain query and the inbox's infinite one alike.
 */
export function invalidateNotifications(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: orpc.unreadCount.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.countNotifications.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.listNotifications.key() });
}
