import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  AdminEmpty,
  AdminPager,
  AdminRow,
  AdminSection,
  ReasonField,
  errText,
} from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { timeAgo } from "@/lib/format-time";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

type RecentComment = Awaited<ReturnType<typeof client.listRecentComments>>["items"][number];

const PAGE_SIZE = 15;

/**
 * The proactive half of moderation: everything said site-wide, newest first.
 * The report queue only ever shows what someone bothered to flag.
 */
export function AdminRecentComments() {
  const [scope, setScope] = useState<"live" | "all">("live");
  const [page, setPage] = useState(1);
  // Keyed by comment so a reason typed in one dialog can't leak into the next.
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const queryClient = useQueryClient();

  const comments = useQuery(
    orpc.listRecentComments.queryOptions({
      input: { page, pageSize: PAGE_SIZE, includeRemoved: scope === "all" },
    }),
  );

  const removeComment = useMutation({
    mutationFn: (input: { commentId: number; reason?: string }) => client.deleteComment(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.listRecentComments.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.listComments.key() });
    },
    onError: (err: unknown) => toast.error(errText(err)),
  });

  const items = comments.data?.items ?? [];
  const total = comments.data?.total ?? 0;

  return (
    <AdminSection
      title="Recent comments"
      count={comments.isPending ? undefined : total}
      hint="Newest first, across collab posts and profile walls."
      actions={
        <SegmentedControl
          size="sm"
          value={scope}
          onChange={(next) => {
            setScope(next as "live" | "all");
            setPage(1);
          }}
        >
          <SegmentedControl.Item value="live">Live</SegmentedControl.Item>
          <SegmentedControl.Item value="all">Include removed</SegmentedControl.Item>
        </SegmentedControl>
      }
    >
      <AdminPager
        page={page}
        pageCount={comments.data?.pageCount ?? 1}
        total={total}
        pageSize={PAGE_SIZE}
        unit="comments"
        onPage={setPage}
      />

      {comments.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : items.length === 0 ? (
        <AdminEmpty>Nothing has been said yet.</AdminEmpty>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((comment) => (
            <AdminRow key={comment.id} muted={comment.deletedAt != null}>
              <div className="flex items-start gap-3">
                <UserAvatar
                  avatarUrl={comment.author?.avatarUrl}
                  username={comment.author?.name}
                  size={28}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Text size="sm" className="font-medium">
                      {comment.author?.name ?? "Deleted user"}
                    </Text>
                    <Text size="xs" variant="muted">
                      {timeAgo(comment.createdAt)}
                      {comment.editedAt ? " · edited" : ""}
                      {comment.depth > 0 ? " · reply" : ""}
                    </Text>
                    {comment.deletedAt ? (
                      <Badge size="label" variant="outline">
                        REMOVED
                      </Badge>
                    ) : null}
                  </div>
                  <Text size="sm" className="max-w-prose break-words whitespace-pre-wrap">
                    {comment.content}
                  </Text>
                  <CommentContext comment={comment} />
                </div>

                {comment.deletedAt == null && (
                  <Confirm
                    title="Remove this comment?"
                    message={
                      <>
                        It’s tombstoned for everyone and replies below it survive.{" "}
                        {comment.author?.name ?? "The author"} is notified.
                        <ReasonField
                          id={`remove-reason-${comment.id}`}
                          value={reasons[comment.id] ?? ""}
                          onChange={(next) =>
                            setReasons((prev) => ({ ...prev, [comment.id]: next }))
                          }
                        />
                      </>
                    }
                    confirmText="Remove comment"
                    variant="destructive"
                    onConfirm={async () => {
                      const reason = reasons[comment.id]?.trim();
                      await removeComment.mutateAsync({
                        commentId: comment.id,
                        ...(reason ? { reason } : {}),
                      });
                    }}
                  >
                    <Button variant="outline" size="xs" disabled={removeComment.isPending}>
                      Remove
                    </Button>
                  </Confirm>
                )}
              </div>
            </AdminRow>
          ))}
        </div>
      )}
    </AdminSection>
  );
}

/** Where it was said, linked so a moderator lands on the comment itself. */
function CommentContext({ comment }: { comment: RecentComment }) {
  if (comment.subjectType === "collab_post" && comment.subjectCollabPostId != null) {
    return (
      <Link
        to="/collab/$postId"
        params={{ postId: String(comment.subjectCollabPostId) }}
        hash={`comment-${comment.id}`}
        className="w-fit text-xs text-muted-foreground hover:text-primary hover:underline"
      >
        on “{comment.postTitle ?? "a collab post"}” →
      </Link>
    );
  }
  if (comment.subjectType === "collab_response" && comment.subjectResponsePostId != null) {
    return (
      <Link
        to="/collab/$postId"
        params={{ postId: String(comment.subjectResponsePostId) }}
        className="w-fit text-xs text-muted-foreground hover:text-primary hover:underline"
      >
        in a private application thread on “{comment.subjectResponsePostTitle ?? "a collab post"}” →
      </Link>
    );
  }
  if (comment.subjectType === "profile" && comment.subjectProfileUserId != null) {
    return (
      <Link
        to="/profile/$userId"
        params={{ userId: comment.subjectProfileUserId }}
        hash={`comment-${comment.id}`}
        className="w-fit text-xs text-muted-foreground hover:text-primary hover:underline"
      >
        on {comment.subjectOwner?.name ?? "a member"}’s wall →
      </Link>
    );
  }
  return null;
}
