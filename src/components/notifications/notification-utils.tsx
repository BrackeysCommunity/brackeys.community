import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export type NotificationItem = {
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

const COLLAB_TYPES = new Set([
  "collab_response_received",
  "collab_response_accepted",
  "collab_response_declined",
  "collab_post_featured",
  "collab_post_closed_by_staff",
]);

export function categoryOf(type: string): "collab" | "system" {
  return COLLAB_TYPES.has(type) ? "collab" : "system";
}

export function renderCopy(n: NotificationItem): {
  line: React.ReactNode;
  href: string | null;
} {
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

export interface NotificationRowProps {
  notification: NotificationItem;
  /** Called after navigation begins, e.g. to close a popover. */
  onNavigate?: () => void;
  /** Visual density — popover uses condensed; inbox uses comfortable. */
  density?: "condensed" | "comfortable";
}

export function NotificationRow({
  notification: n,
  onNavigate,
  density = "condensed",
}: NotificationRowProps) {
  const { line, href } = renderCopy(n);
  const isComfortable = density === "comfortable";

  const Body = (
    <div
      className={cn(
        "flex gap-2.5 border-b border-muted/30 transition-colors last:border-b-0 hover:bg-muted/20",
        isComfortable ? "px-4 py-3" : "px-3 py-2.5",
        !n.readAt && "bg-primary/5",
      )}
    >
      <Avatar
        className={cn(
          "shrink-0 rounded-none border border-muted/40",
          isComfortable ? "h-9 w-9" : "h-7 w-7",
        )}
      >
        {n.actorAvatarUrl ? (
          <AvatarImage src={n.actorAvatarUrl} alt="" />
        ) : (
          <AvatarFallback className="rounded-none bg-muted/40 font-mono text-[10px] font-bold">
            {(n.actorUsername ?? "?")[0]?.toUpperCase()}
          </AvatarFallback>
        )}
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={cn("leading-snug text-foreground/90", isComfortable ? "text-sm" : "text-xs")}>
          {line}
        </p>
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatDistanceToNowStrict(new Date(n.createdAt), { addSuffix: true })}
        </span>
      </div>
      {!n.readAt && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
    </div>
  );

  if (!href) return <div>{Body}</div>;
  return (
    <Link to={href} onClick={onNavigate} className="block">
      {Body}
    </Link>
  );
}
