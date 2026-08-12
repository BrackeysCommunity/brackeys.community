import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import {
  categoryOf,
  NotificationRow,
  type NotificationItem,
} from "@/components/notifications/notification-utils";
import { Button } from "@/components/ui/button";
import { VirtualGrid } from "@/components/ui/virtual-grid";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/orpc/client";

const PAGE_SIZE = 20;

/** One comfortable row — 36px avatar inside `py-3` — before measurement. */
const ROW_ESTIMATE = 68;

export type InboxFilter = "all" | "unread" | "collab" | "teams" | "comments" | "system";

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "collab", label: "Collab" },
  { value: "teams", label: "Teams" },
  { value: "comments", label: "Comments" },
  { value: "system", label: "System" },
];

export interface NotificationsInboxProps {
  filter: InboxFilter;
  onFilterChange: (filter: InboxFilter) => void;
}

export function NotificationsInbox({ filter, onFilterChange }: NotificationsInboxProps) {
  const queryClient = useQueryClient();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // unread-only is enforced server-side; collab/system filter client-side
  // off the type field since the server doesn't take a category yet.
  const unreadOnly = filter === "unread";

  const {
    data: pages,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ["listNotifications", { unreadOnly }],
    queryFn: ({ pageParam }: { pageParam: number | undefined }) =>
      client.listNotifications({
        cursor: pageParam,
        limit: PAGE_SIZE,
        unreadOnly: unreadOnly || undefined,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const { mutate: markAllReadMutate } = useMutation({
    mutationFn: () => client.markAllRead({}),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.unreadCount.queryOptions({ input: {} }).queryKey,
      });
      void queryClient.invalidateQueries({ queryKey: ["listNotifications"] });
    },
  });

  const items = useMemo(() => {
    const flat = (pages?.pages ?? []).flatMap((p) => p.items) as NotificationItem[];
    if (filter === "collab") return flat.filter((n) => categoryOf(n.type) === "collab");
    if (filter === "teams") return flat.filter((n) => categoryOf(n.type) === "teams");
    if (filter === "comments") return flat.filter((n) => categoryOf(n.type) === "comments");
    if (filter === "system") return flat.filter((n) => categoryOf(n.type) === "system");
    return flat;
  }, [pages, filter]);

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-sm font-bold tracking-widest text-foreground uppercase">Inbox</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => markAllReadMutate()}
          className="text-[10px] tracking-wider"
        >
          Mark all read
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => onFilterChange(f.value)}
            className={cn(
              "border px-3 py-1 text-[10px] font-bold tracking-widest uppercase transition-colors",
              filter === f.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-muted/40 text-muted-foreground hover:border-primary/50 hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="border border-muted/30 bg-card/40 px-4 py-10 text-center text-xs text-muted-foreground">
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-1 border border-muted/30 bg-card/40 px-4 py-12 text-center">
          <p className="text-sm text-foreground/80">
            {filter === "unread" ? "Nothing unread." : "No notifications yet."}
          </p>
          <p className="text-[10px] text-muted-foreground">
            You'll see activity from collab posts and staff actions here.
          </p>
        </div>
      ) : (
        // The inbox pages forever and never drops what it has paged in,
        // so only the rows near the viewport stay mounted.
        <VirtualGrid
          items={items}
          getItemKey={(n) => n.id}
          renderItem={(n) => <NotificationRow notification={n} density="comfortable" />}
          rowClassName="flex flex-col"
          className="border border-muted/30 bg-card/40"
          estimateRowHeight={ROW_ESTIMATE}
        />
      )}

      <div ref={sentinelRef} className="h-8" aria-hidden />
      {isFetchingNextPage && (
        <p className="text-center text-[10px] text-muted-foreground">Loading more…</p>
      )}
    </div>
  );
}
