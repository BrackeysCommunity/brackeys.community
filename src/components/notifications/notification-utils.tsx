import { Link } from "@tanstack/react-router";

import { Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { timeAgo } from "@/lib/format-time";
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
  "collab_post_expiring",
  "collab_post_expired",
]);

const TEAM_TYPES = new Set([
  "team_invite_received",
  "team_invite_accepted",
  "team_invite_declined",
  "team_member_removed",
  "team_archive_warning",
  "team_auto_archived",
]);

export function categoryOf(type: string): "collab" | "teams" | "system" {
  if (COLLAB_TYPES.has(type)) return "collab";
  if (TEAM_TYPES.has(type)) return "teams";
  return "system";
}

export function renderCopy(n: NotificationItem): {
  line: React.ReactNode;
  href: string | null;
} {
  const actor = n.actorUsername ? `@${n.actorUsername}` : "Someone";
  const postTitle = (n.data.postTitle as string | undefined) ?? "your post";
  const postId = n.data.postId as number | undefined;
  const href = postId ? `/collab/${postId}` : null;
  const teamName = (n.data.teamName as string | undefined) ?? "a team";
  const teamSlug = n.data.teamSlug as string | undefined;
  const teamHref = teamSlug ? `/teams/${teamSlug}` : null;
  const teamEm = <em className="font-medium not-italic">{teamName}</em>;

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
    case "team_invite_received":
      return {
        line: (
          <>
            {actor} invited you to join {teamEm}
          </>
        ),
        href: teamHref,
      };
    case "team_invite_accepted":
      return {
        line: (
          <>
            {actor} joined {teamEm}
          </>
        ),
        href: teamHref,
      };
    case "team_invite_declined":
      return {
        line: (
          <>
            {actor} declined your invite to {teamEm}
          </>
        ),
        href: teamHref,
      };
    case "collab_post_expiring":
      return {
        line: (
          <>
            <em className="font-medium not-italic">{postTitle}</em> closes soon — extend it if
            you're still looking
          </>
        ),
        href,
      };
    case "collab_post_expired":
      return {
        line: (
          <>
            <em className="font-medium not-italic">{postTitle}</em> expired — reopen it if you're
            still looking
          </>
        ),
        href,
      };
    case "team_member_removed":
      return {
        line: <>You were removed from {teamEm}</>,
        href: teamHref,
      };
    case "team_archive_warning":
      return {
        line: (
          <>{teamEm} has been quiet — it archives in a week unless something happens on its page</>
        ),
        href: teamHref,
      };
    case "team_auto_archived":
      return {
        line: <>{teamEm} was archived after a quiet spell — restore it from its page</>,
        href: teamHref,
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
      <UserAvatar
        avatarUrl={n.actorAvatarUrl}
        username={n.actorUsername}
        size={isComfortable ? 36 : 28}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={cn("leading-snug text-foreground/90", isComfortable ? "text-sm" : "text-xs")}>
          {line}
        </p>
        <Text size="xs" variant="muted">
          {timeAgo(n.createdAt)}
        </Text>
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
