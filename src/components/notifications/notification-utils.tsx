import {
  BubbleChatIcon,
  Calendar03Icon,
  Megaphone01Icon,
  Notification03Icon,
  Shield02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { invalidateNotifications } from "@/components/notifications/notification-queries";
import { Skeleton } from "@/components/ui/skeleton";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { timeAgo } from "@/lib/format-time";
import { NOTIFICATION_CATEGORY, type NotificationCategory } from "@/lib/notification-copy";
import { cn } from "@/lib/utils";
import { client } from "@/orpc/client";

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

/** Category lives with the rest of the per-type copy data; an unknown
 *  type simply matches no inbox tab. */
export function categoryOf(type: string): NotificationCategory | null {
  return (NOTIFICATION_CATEGORY as Record<string, NotificationCategory>)[type] ?? null;
}

const CATEGORY_ICON: Record<NotificationCategory, IconSvgElement> = {
  collab: Megaphone01Icon,
  teams: UserGroupIcon,
  jams: Calendar03Icon,
  comments: BubbleChatIcon,
  moderation: Shield02Icon,
};

/** System notifications have no actor, so the frame that would hold an
 *  avatar shows the category's icon instead of the "?" initial fallback. */
function CategoryGlyph({ type, size }: { type: string; size: number }) {
  const category = categoryOf(type);
  return (
    <div
      className="flex shrink-0 items-center justify-center border border-border bg-muted text-muted-foreground"
      style={{ width: size, height: size }}
    >
      <HugeiconsIcon
        icon={category ? CATEGORY_ICON[category] : Notification03Icon}
        size={Math.round(size * 0.5)}
      />
    </div>
  );
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
  const jamTitle = (n.data.jamTitle as string | undefined) ?? "a jam";
  const jamHref = (n.data.jamUrl as string | undefined) ?? null;
  const jamEm = <em className="font-medium not-italic">{jamTitle}</em>;

  switch (n.type) {
    case "jam_starting":
      return { line: <>{jamEm} starts soon</>, href: jamHref };
    case "jam_voting_open":
      return { line: <>Voting is open for {jamEm}</>, href: jamHref };
    case "jam_results_posted":
      return { line: <>Results are up for {jamEm}</>, href: jamHref };
    case "jam_team_post_created":
      return {
        line: (
          <>
            {actor} is crewing up for {jamEm}
          </>
        ),
        href,
      };
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
    case "collab_response_withdrawn":
      return {
        line: (
          <>
            {actor} withdrew their response to{" "}
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
    case "comment_received": {
      const subjectTitle = (n.data.subjectTitle as string | undefined) ?? "a thread you follow";
      return {
        line: (
          <>
            {actor} commented on <em className="font-medium not-italic">{subjectTitle}</em>
          </>
        ),
        href: (n.data.subjectUrl as string | undefined) ?? null,
      };
    }
    case "comment_reply": {
      const subjectTitle = (n.data.subjectTitle as string | undefined) ?? "a thread";
      return {
        line: (
          <>
            {actor} replied to your comment on{" "}
            <em className="font-medium not-italic">{subjectTitle}</em>
          </>
        ),
        href: (n.data.subjectUrl as string | undefined) ?? null,
      };
    }
    case "comment_removed_by_staff": {
      const subjectTitle = (n.data.subjectTitle as string | undefined) ?? "a thread";
      const reason = n.data.reason as string | undefined;
      return {
        line: (
          <>
            A moderator removed your comment on{" "}
            <em className="font-medium not-italic">{subjectTitle}</em>
            {reason ? <> — {reason}</> : null}
          </>
        ),
        href: (n.data.subjectUrl as string | undefined) ?? null,
      };
    }
    case "skill_request_approved": {
      const skillName = n.data.skillName as string | undefined;
      const requestedName = n.data.requestedName as string | undefined;
      // Naming both sides is the whole point when staff corrected the
      // casing or matched an existing entry — otherwise the skill on the
      // profile silently doesn't match what was typed.
      const renamed = skillName && requestedName && skillName !== requestedName;
      return {
        line: renamed ? (
          <>
            Your <em className="font-medium not-italic">{requestedName}</em> request was approved as{" "}
            <em className="font-medium not-italic">{skillName}</em>
          </>
        ) : (
          <>
            Your <em className="font-medium not-italic">{skillName ?? requestedName ?? "skill"}</em>{" "}
            request was approved
          </>
        ),
        href: "/profile",
      };
    }
    case "skill_request_rejected": {
      const requestedName = (n.data.requestedName as string | undefined) ?? "skill";
      const reason = n.data.reason as string | undefined;
      return {
        line: (
          <>
            Your <em className="font-medium not-italic">{requestedName}</em> request wasn’t approved
            {reason ? <> — {reason}</> : null}
          </>
        ),
        href: "/profile",
      };
    }
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
  const category = categoryOf(n.type);
  const queryClient = useQueryClient();

  // Opening a notification is the reader saying they've seen it. The bell's
  // auto-mark can't stand in for this: clicking a row closes the popover
  // long before that timer fires.
  const { mutate: markReadMutate } = useMutation({
    mutationFn: (id: number) => client.markRead({ ids: [id] }),
    onSuccess: () => invalidateNotifications(queryClient),
  });

  const handleClick = () => {
    if (!n.readAt) markReadMutate(n.id);
    onNavigate?.();
  };

  const Body = (
    <div
      className={cn(
        "flex gap-2.5 border-b border-muted/30 transition-colors last:border-b-0 hover:bg-muted/20",
        isComfortable ? "px-4 py-3" : "px-3 py-2.5",
        // Unread reads off the left edge in the inbox — a wash alone is
        // hard to see against a full column of rows, and the accent scans
        // as a stack of what's left to deal with.
        !n.readAt && "bg-primary/5",
        // The rail is on every comfortable row, coloured only when unread,
        // so a row changing state doesn't shift its own text sideways.
        isComfortable && "border-l-2",
        isComfortable && (n.readAt ? "border-l-transparent" : "border-l-primary"),
      )}
    >
      {n.actorId ? (
        <UserAvatar
          avatarUrl={n.actorAvatarUrl}
          username={n.actorUsername}
          size={isComfortable ? 36 : 28}
        />
      ) : (
        <CategoryGlyph type={n.type} size={isComfortable ? 36 : 28} />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={cn("leading-snug text-foreground/90", isComfortable ? "text-sm" : "text-xs")}>
          {line}
        </p>
        <Text size="xs" variant="muted">
          {timeAgo(n.createdAt)}
        </Text>
      </div>
      {/* The category is already legible from the copy at popover width;
          in the inbox it earns its place as the column that lets a reader
          skim for one kind of thing without switching tabs. */}
      {isComfortable && category && (
        <MicroLabel as="span" className="mt-0.5 hidden shrink-0 uppercase sm:inline">
          {category}
        </MicroLabel>
      )}
      {!n.readAt && !isComfortable && (
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
      )}
    </div>
  );

  if (!href) return <div>{Body}</div>;
  return (
    <Link to={href} onClick={handleClick} className="block">
      {Body}
    </Link>
  );
}

/**
 * Placeholder rows in `NotificationRow`'s exact geometry — the popover
 * and the inbox both open at their loaded height instead of snapping
 * from a one-line message to a full list.
 */
export function NotificationRowsSkeleton({
  rows = 4,
  density = "condensed",
}: {
  rows?: number;
  density?: NotificationRowProps["density"];
}) {
  const isComfortable = density === "comfortable";

  return (
    <div aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={cn(
            "flex gap-2.5 border-b border-muted/30 last:border-b-0",
            isComfortable ? "border-l-2 border-l-transparent px-4 py-3" : "px-3 py-2.5",
          )}
        >
          <Skeleton
            className={cn("shrink-0 rounded-full bg-muted/50", isComfortable ? "size-9" : "size-7")}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton
              className={cn(
                "bg-muted/50",
                isComfortable ? "h-4" : "h-3.5",
                i % 2 ? "w-3/5" : "w-4/5",
              )}
            />
            <Skeleton className="h-3 w-14 bg-muted/50" />
          </div>
        </div>
      ))}
    </div>
  );
}
