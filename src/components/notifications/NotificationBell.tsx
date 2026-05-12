import { Notification03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  NotificationRow,
  type NotificationItem,
} from "@/components/notifications/notification-utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { client, orpc } from "@/orpc/client";

const REFETCH_INTERVAL_MS = 30_000;
const AUTO_MARK_DELAY_MS = 1500;

export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const unread = useQuery({
    ...orpc.unreadCount.queryOptions({ input: {} }),
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const list = useQuery({
    ...orpc.listNotifications.queryOptions({ input: { limit: 20 } }),
    enabled: open,
  });

  const { mutate: markAllReadMutate } = useMutation({
    mutationFn: (vars: { before?: number }) => client.markAllRead(vars),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.unreadCount.queryOptions({ input: {} }).queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: orpc.listNotifications.queryOptions({ input: { limit: 20 } }).queryKey,
      });
    },
  });

  // Auto-mark-read after the popover has been open for AUTO_MARK_DELAY_MS,
  // so a quick open-and-close doesn't silently clear unread state.
  const autoMarkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autoMarkTimer.current) {
      clearTimeout(autoMarkTimer.current);
      autoMarkTimer.current = null;
    }
    if (!open) return;
    const items = list.data?.items;
    if (!items?.length) return;
    const topId = items[0]?.id;
    if (topId === undefined) return;

    autoMarkTimer.current = setTimeout(() => {
      markAllReadMutate({ before: topId });
    }, AUTO_MARK_DELAY_MS);

    return () => {
      if (autoMarkTimer.current) {
        clearTimeout(autoMarkTimer.current);
        autoMarkTimer.current = null;
      }
    };
  }, [open, list.data, markAllReadMutate]);

  const count = unread.data?.count ?? 0;
  const items = (list.data?.items ?? []) as NotificationItem[];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={count > 0 ? `Notifications (${count} unread)` : "Notifications"}
        className="relative flex h-9 w-9 items-center justify-center border border-muted bg-card/40 text-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <HugeiconsIcon icon={Notification03Icon} size={16} />
        {count > 0 && (
          <span
            data-testid="notification-bell-badge"
            className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] font-bold text-primary-foreground"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-muted/40 px-3 py-2">
          <span className="font-mono text-[10px] font-bold tracking-widest text-foreground/70 uppercase">
            Notifications
          </span>
          {count > 0 && (
            <button
              type="button"
              onClick={() => markAllReadMutate({})}
              className="font-mono text-[10px] tracking-wider text-muted-foreground transition-colors hover:text-primary"
            >
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {list.isLoading ? (
            <div className="px-3 py-6 text-center font-mono text-xs text-muted-foreground">
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 text-center font-mono text-xs text-muted-foreground">
              You're all caught up.
            </div>
          ) : (
            items.map((n) => (
              <NotificationRow key={n.id} notification={n} onNavigate={() => setOpen(false)} />
            ))
          )}
        </div>

        <div className="border-t border-muted/40 px-3 py-2 text-center">
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="font-mono text-[10px] tracking-wider text-muted-foreground transition-colors hover:text-primary"
          >
            See all
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
