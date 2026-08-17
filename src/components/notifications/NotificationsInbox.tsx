import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import {
  NotificationRow,
  NotificationRowsSkeleton,
  type NotificationItem,
} from "@/components/notifications/notification-utils";
import { Text } from "@/components/ui/typography";
import { VirtualGrid } from "@/components/ui/virtual-grid";
import { Well } from "@/components/ui/well";
import { type NotificationCategory } from "@/lib/notification-copy";
import { orpc } from "@/orpc/client";

const PAGE_SIZE = 20;

/** One comfortable row — 36px avatar inside `py-3` — before measurement. */
const ROW_ESTIMATE = 68;

export type InboxFilter = "all" | "unread" | NotificationCategory;

/** Copy for a tab that has nothing in it. The generic line is a dead end on
 *  a category tab — "no notifications yet" next to a filled Collab tab reads
 *  as breakage rather than as a quiet corner. */
const EMPTY_COPY: Record<InboxFilter, { title: string; hint: string }> = {
  all: {
    title: "No notifications yet.",
    hint: "Responses, invites, jam deadlines and staff decisions land here.",
  },
  unread: { title: "Nothing unread.", hint: "Everything here has been seen." },
  collab: {
    title: "Nothing from the collab board.",
    hint: "Responses to your posts show up here.",
  },
  teams: { title: "Nothing from your teams.", hint: "Invites and roster changes show up here." },
  jams: { title: "Nothing from your jams.", hint: "Watch a jam to hear about its deadlines." },
  comments: { title: "No replies yet.", hint: "Comments on threads you follow show up here." },
  moderation: { title: "Nothing from staff.", hint: "Decisions on your reports and requests." },
};

export interface NotificationsInboxProps {
  filter: InboxFilter;
}

export function NotificationsInbox({ filter }: NotificationsInboxProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const unreadOnly = filter === "unread";
  // Every filter that isn't "all"/"unread" *is* a category, so it goes to
  // the server as one rather than being restated tab by tab.
  const category = filter === "all" || filter === "unread" ? undefined : filter;

  const {
    data: pages,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    fetchNextPage,
  } = useInfiniteQuery(
    orpc.listNotifications.infiniteOptions({
      input: (cursor: number | undefined) => ({
        cursor,
        limit: PAGE_SIZE,
        unreadOnly: unreadOnly || undefined,
        category,
      }),
      initialPageParam: undefined as number | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }),
  );

  const items = useMemo(
    () => (pages?.pages ?? []).flatMap((p) => p.items) as NotificationItem[],
    [pages],
  );

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const empty = EMPTY_COPY[filter];

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <Well className="overflow-hidden">
          <NotificationRowsSkeleton rows={8} density="comfortable" />
        </Well>
      ) : items.length === 0 ? (
        <Well className="items-center justify-center gap-1 px-4 py-14">
          <Text size="md" variant="primary" align="center">
            {empty.title}
          </Text>
          <Text size="sm" variant="muted" align="center">
            {empty.hint}
          </Text>
        </Well>
      ) : (
        // The frame is the wrapper, not the grid: `VirtualGrid` measures row
        // offsets from its own top edge, and it may not carry top padding.
        <Well className="overflow-hidden">
          {/* The inbox pages forever and never drops what it has paged in,
              so only the rows near the viewport stay mounted. */}
          <VirtualGrid
            items={items}
            getItemKey={(n) => n.id}
            renderItem={(n) => <NotificationRow notification={n} density="comfortable" />}
            rowClassName="flex flex-col"
            estimateRowHeight={ROW_ESTIMATE}
          />
        </Well>
      )}

      <div ref={sentinelRef} className="h-8" aria-hidden />
      {isFetchingNextPage && (
        <Well className="overflow-hidden">
          <NotificationRowsSkeleton rows={3} density="comfortable" />
        </Well>
      )}
    </div>
  );
}
