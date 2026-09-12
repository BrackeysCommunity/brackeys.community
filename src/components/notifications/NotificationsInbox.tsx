import { CheckmarkCircle02Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  NotificationRow,
  NotificationRowsSkeleton,
  type NotificationItem,
} from "@/components/notifications/notification-row";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MicroLabel, Text } from "@/components/ui/typography";
import { VirtualGrid } from "@/components/ui/virtual-grid";
import { Well } from "@/components/ui/well";
import { useInfiniteScrollSentinel } from "@/lib/hooks/use-infinite-scroll-sentinel";
import { type NotificationCategory } from "@/lib/notification-copy";
import { invalidateNotifications } from "@/lib/notification-queries";
import { client, orpc } from "@/orpc/client";

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
    hint: "Applications, invites, jam deadlines and staff decisions land here.",
  },
  unread: { title: "Nothing unread.", hint: "Everything here has been seen." },
  collab: {
    title: "Nothing from the collab board.",
    hint: "Applications to your posts show up here.",
  },
  teams: { title: "Nothing from your teams.", hint: "Invites and roster changes show up here." },
  jams: { title: "Nothing from your jams.", hint: "Watch a jam to hear about its deadlines." },
  comments: { title: "No replies yet.", hint: "Comments on threads you follow show up here." },
  moderation: { title: "Nothing from staff.", hint: "Decisions on your reports and requests." },
};

export interface NotificationsInboxProps {
  filter: InboxFilter;
}

/**
 * The inbox as a controlled table: every row carries a checkbox, and the
 * bar above it holds whatever applies to the current selection — the
 * whole-inbox actions while nothing is checked, the per-selection ones
 * once something is. Removing notifications happens here and nowhere
 * else; the bell only reads.
 */
export function NotificationsInbox({ filter }: NotificationsInboxProps) {
  const queryClient = useQueryClient();
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

  const counts = useQuery(orpc.countNotifications.queryOptions({ input: {} }));

  const items = useMemo(
    () => (pages?.pages ?? []).flatMap((p) => p.items) as NotificationItem[],
    [pages],
  );

  // Ids, not rows: a refetch replaces the row objects, and a selection that
  // survived a mark-read should still name the same notifications.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(() => new Set());
  const selected = useMemo(() => items.filter((n) => selectedIds.has(n.id)), [items, selectedIds]);
  const allSelected = items.length > 0 && selected.length === items.length;
  const someSelected = selected.length > 0 && !allSelected;

  const toggleOne = (id: number, next: boolean) =>
    setSelectedIds((prev) => {
      const draft = new Set(prev);
      if (next) draft.add(id);
      else draft.delete(id);
      return draft;
    });
  const toggleAll = (next: boolean) =>
    setSelectedIds(next ? new Set(items.map((n) => n.id)) : new Set());

  const settle = () => {
    setSelectedIds(new Set());
    invalidateNotifications(queryClient);
  };
  const markSelectedRead = useMutation({
    mutationFn: (ids: number[]) => client.markRead({ ids }),
    onSuccess: settle,
  });
  const dismissSelected = useMutation({
    mutationFn: (ids: number[]) => client.dismissNotifications({ ids }),
    onSuccess: settle,
  });
  const markAllRead = useMutation({
    mutationFn: () => client.markAllRead({}),
    onSuccess: settle,
  });
  const clearRead = useMutation({
    mutationFn: () => client.clearReadNotifications({}),
    onSuccess: settle,
  });
  const busy =
    markSelectedRead.isPending ||
    dismissSelected.isPending ||
    markAllRead.isPending ||
    clearRead.isPending;

  const sentinelRef = useInfiniteScrollSentinel({
    hasNextPage: Boolean(hasNextPage),
    isFetching: isFetchingNextPage,
    fetchNext: fetchNextPage,
    rootMargin: "200px",
  });

  const empty = EMPTY_COPY[filter];
  const unreadTotal = counts.data?.unread ?? 0;
  const readTotal = (counts.data?.total ?? 0) - unreadTotal;
  const selectedUnread = selected.filter((n) => !n.readAt).length;

  const actions =
    selected.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="xs"
          disabled={busy || selectedUnread === 0}
          onClick={() => markSelectedRead.mutate(selected.map((n) => n.id))}
        >
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} data-icon="inline-start" />
          Mark read
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={busy}
          onClick={() => dismissSelected.mutate(selected.map((n) => n.id))}
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} data-icon="inline-start" />
          Dismiss
        </Button>
        <Button variant="ghost" size="xs" disabled={busy} onClick={() => toggleAll(false)}>
          Cancel
        </Button>
      </div>
    ) : (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="xs"
          disabled={busy || unreadTotal === 0}
          onClick={() => markAllRead.mutate()}
        >
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} data-icon="inline-start" />
          Mark all read
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={busy || readTotal <= 0}
          onClick={() => clearRead.mutate()}
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} data-icon="inline-start" />
          Clear read
        </Button>
      </div>
    );

  // The bar is the table's header row: its checkbox sits in the same
  // column as the rows' (`px-4` here, `left-4` there). An empty table has
  // nothing to select, so only the whole-inbox actions remain.
  const header = (
    <div
      role="toolbar"
      aria-label="Inbox actions"
      className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-muted/30 px-4 py-2"
    >
      {items.length > 0 ? (
        <div className="flex items-center gap-4">
          <Checkbox
            aria-label={allSelected ? "Clear selection" : "Select all loaded"}
            checked={allSelected}
            indeterminate={someSelected}
            onCheckedChange={(checked) => toggleAll(Boolean(checked) && !allSelected)}
          />
          <MicroLabel as="span">
            {selected.length > 0 ? `${selected.length} SELECTED` : `${items.length} LOADED`}
          </MicroLabel>
        </div>
      ) : (
        <span />
      )}
      {actions}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <Well className="overflow-hidden">
          {header}
          <NotificationRowsSkeleton rows={8} density="comfortable" />
        </Well>
      ) : items.length === 0 ? (
        <Well className="overflow-hidden">
          {header}
          <div className="flex flex-col items-center justify-center gap-1 px-4 py-14">
            <Text size="md" variant="primary" align="center">
              {empty.title}
            </Text>
            <Text size="sm" variant="muted" align="center">
              {empty.hint}
            </Text>
          </div>
        </Well>
      ) : (
        // The frame is the wrapper, not the grid: `VirtualGrid` measures row
        // offsets from its own top edge, and it may not carry top padding.
        <Well className="overflow-hidden">
          {header}
          {/* The inbox pages forever and never drops what it has paged in,
              so only the rows near the viewport stay mounted. */}
          <VirtualGrid
            items={items}
            getItemKey={(n) => n.id}
            renderItem={(n) => (
              <NotificationRow
                notification={n}
                density="comfortable"
                selection={{
                  selected: selectedIds.has(n.id),
                  onSelectedChange: (next) => toggleOne(n.id, next),
                }}
              />
            )}
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
