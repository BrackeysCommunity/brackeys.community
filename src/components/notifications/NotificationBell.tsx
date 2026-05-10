import { Notification03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { useEffect, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/orpc/client";

const REFETCH_INTERVAL_MS = 30_000;
const AUTO_MARK_DELAY_MS = 1500;

type NotificationItem = {
  id: number;
  type: string;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  data: Record<string, unknown>;
  readAt: Date | string | null;
  createdAt: Date | string;
  actorUsername: string | null;
  actorAvatarUrl: string | null;
};

function renderCopy(n: NotificationItem): { line: React.ReactNode; href: string | null } {
  const actor = n.actorUsername ? `@${n.actorUsername}` : "Someone";
  const postTitle = (n.data.postTitle as string | undefined) ?? "your post";
  const postId = n.data.postId as number | undefined;
  const href = postId ? `/collab/${postId}` : null;

  switch (n.type) {
    case "collab_response_received":
      return {
        line: (
          <>
            {actor} responded to <em className="font-medium not-italic">{postTitle}</em>
          </>
        ),
        href,
      };
    case "collab_response_accepted":
      return {
        line: (
          <>
            {actor} accepted your response on{" "}
            <em className="font-medium not-italic">{postTitle}</em>
          </>
        ),
        href,
      };
    case "collab_response_declined":
      return {
        line: (
          <>
            {actor} declined your response on{" "}
            <em className="font-medium not-italic">{postTitle}</em>
          </>
        ),
        href,
      };
    case "collab_post_featured":
      return {
        line: (
          <>
            Your post <em className="font-medium not-italic">{postTitle}</em> was featured
          </>
        ),
        href,
      };
    case "collab_post_closed_by_staff":
      return {
        line: (
          <>
            Staff closed your post <em className="font-medium not-italic">{postTitle}</em>
          </>
        ),
        href,
      };
    default:
      return { line: <>You have a new notification</>, href };
  }
}

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
            items.map((n) => {
              const { line, href } = renderCopy(n);
              const Body = (
                <div
                  className={cn(
                    "flex gap-2.5 border-b border-muted/30 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-muted/20",
                    !n.readAt && "bg-primary/5",
                  )}
                >
                  <Avatar className="h-7 w-7 shrink-0 rounded-none border border-muted/40">
                    {n.actorAvatarUrl ? (
                      <AvatarImage src={n.actorAvatarUrl} alt="" />
                    ) : (
                      <AvatarFallback className="rounded-none bg-muted/40 font-mono text-[10px] font-bold">
                        {(n.actorUsername ?? "?")[0]?.toUpperCase()}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="text-xs leading-snug text-foreground/90">{line}</p>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatDistanceToNowStrict(new Date(n.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  {!n.readAt && (
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  )}
                </div>
              );
              return href ? (
                <Link key={n.id} to={href} onClick={() => setOpen(false)} className="block">
                  {Body}
                </Link>
              ) : (
                <div key={n.id}>{Body}</div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
