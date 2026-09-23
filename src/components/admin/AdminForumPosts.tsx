import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  AdminPager,
  AdminPerson,
  AdminRow,
  AdminSection,
  ReasonField,
} from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Empty } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeAgo } from "@/components/ui/time-ago";
import { Text } from "@/components/ui/typography";
import { toastMutationError } from "@/lib/mutation-errors";
import { client, orpc } from "@/orpc/client";

type RecentForumPost = Awaited<ReturnType<typeof client.listRecentForumPosts>>["posts"][number];

const PAGE_SIZE = 15;

/**
 * Every forum post, newest first and whatever its state — the proactive
 * half of forum moderation, beside the report queue's reactive half.
 * Moving and retagging live on the post page, where the context is.
 */
export function AdminForumPosts() {
  const [page, setPage] = useState(1);
  // Keyed by post so a reason typed in one dialog can't leak into the next.
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const queryClient = useQueryClient();

  const posts = useQuery(
    orpc.listRecentForumPosts.queryOptions({ input: { page, pageSize: PAGE_SIZE } }),
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.listRecentForumPosts.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.listForumPosts.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.getForumPost.key() });
  };
  const onError = toastMutationError("admin.forum_moderate");

  const setHidden = useMutation({
    mutationFn: (input: { postId: number; hidden: boolean; reason?: string }) =>
      client.setForumPostHidden(input),
    onSuccess: invalidate,
    onError,
  });
  const setPinned = useMutation({
    mutationFn: (input: { postId: number; scope: "global" | "category" | null }) =>
      client.setForumPostPinned(input),
    onSuccess: invalidate,
    onError,
  });
  const setLocked = useMutation({
    mutationFn: (input: { postId: number; locked: boolean }) =>
      client.lockThread({
        subject: { type: "forum_post", id: input.postId },
        locked: input.locked,
      }),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: (input: { postId: number; reason?: string }) => client.staffDeleteForumPost(input),
    onSuccess: invalidate,
    onError,
  });

  const busy =
    setHidden.isPending || setPinned.isPending || setLocked.isPending || remove.isPending;
  const items = posts.data?.posts ?? [];
  const total = posts.data?.total ?? 0;
  const reasonOf = (id: number) => reasons[id]?.trim() || undefined;
  const reasonField = (id: number, required = false) => (
    <ReasonField
      id={`forum-reason-${id}`}
      required={required}
      value={reasons[id] ?? ""}
      onChange={(next) => setReasons((prev) => ({ ...prev, [id]: next }))}
    />
  );

  return (
    <AdminSection
      title="Forum posts"
      count={posts.isPending ? undefined : total}
      hint="Newest first, drafts, hidden and removed posts included."
    >
      <AdminPager
        page={page}
        pageCount={posts.data?.pageCount ?? 1}
        total={total}
        pageSize={PAGE_SIZE}
        unit="posts"
        onPage={setPage}
      />

      {posts.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : items.length === 0 ? (
        <Empty>Nobody has posted yet.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((post) => {
            const live = post.status === "published" && !post.deletedAt;
            return (
              <AdminRow key={post.id} muted={post.deletedAt != null || post.hiddenAt != null}>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminPerson
                      user={post.author}
                      name={post.author?.displayName ?? "Deleted user"}
                    />
                    <Text size="xs" variant="muted">
                      <TimeAgo date={post.createdAt} /> · {post.category}
                      {post.teamName ? ` · as ${post.teamName}` : ""} · {post.likeCount} likes ·{" "}
                      {post.commentCount} comments
                    </Text>
                  </div>
                  <PostBadges post={post} />
                  <a
                    href={`/forum/${post.id}`}
                    className="w-fit text-sm font-medium text-primary hover:underline"
                  >
                    {post.displayTitle}
                  </a>
                  {post.hiddenReason ? (
                    <Text size="xs" variant="muted">
                      Hidden: {post.hiddenReason}
                    </Text>
                  ) : null}

                  {live && (
                    <div className="flex flex-wrap items-center gap-2">
                      {post.hiddenAt ? (
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={busy}
                          onClick={() => setHidden.mutate({ postId: post.id, hidden: false })}
                        >
                          Unhide
                        </Button>
                      ) : (
                        <Confirm
                          title="Hide this post?"
                          message={
                            <>
                              It leaves the forum for everyone but staff and its authors, who are
                              told why.
                              {reasonField(post.id, true)}
                            </>
                          }
                          confirmText="Hide post"
                          variant="destructive"
                          onConfirm={async () => {
                            await setHidden.mutateAsync({
                              postId: post.id,
                              hidden: true,
                              reason: reasonOf(post.id),
                            });
                          }}
                        >
                          <Button variant="outline" size="xs" disabled={busy}>
                            Hide
                          </Button>
                        </Confirm>
                      )}
                      {!post.hiddenAt &&
                        (post.pinnedScope ? (
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={busy}
                            onClick={() => setPinned.mutate({ postId: post.id, scope: null })}
                          >
                            Unpin
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="xs"
                              disabled={busy}
                              onClick={() => setPinned.mutate({ postId: post.id, scope: "global" })}
                            >
                              Pin to forum
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              disabled={busy}
                              onClick={() =>
                                setPinned.mutate({ postId: post.id, scope: "category" })
                              }
                            >
                              Pin to {post.category}
                            </Button>
                          </>
                        ))}
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={busy}
                        onClick={() =>
                          setLocked.mutate({ postId: post.id, locked: !post.lockedAt })
                        }
                      >
                        {post.lockedAt ? "Unlock comments" : "Lock comments"}
                      </Button>
                      <Confirm
                        title="Remove this post?"
                        message={
                          <>
                            The post becomes a tombstone and its images are deleted; the comment
                            thread stays readable. Its author is notified.
                            {reasonField(post.id)}
                          </>
                        }
                        confirmText="Remove post"
                        variant="destructive"
                        onConfirm={async () => {
                          await remove.mutateAsync({ postId: post.id, reason: reasonOf(post.id) });
                        }}
                      >
                        <Button variant="ghost" size="xs" disabled={busy}>
                          Remove
                        </Button>
                      </Confirm>
                    </div>
                  )}
                </div>
              </AdminRow>
            );
          })}
        </div>
      )}
    </AdminSection>
  );
}

function PostBadges({ post }: { post: RecentForumPost }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge size="label" variant="outline">
        {post.kind.toUpperCase()}
      </Badge>
      {post.status === "draft" ? (
        <Badge size="label" variant="secondary">
          DRAFT
        </Badge>
      ) : null}
      {post.pinnedScope ? (
        <Badge size="label" variant="default">
          {post.pinnedScope === "global" ? "PINNED" : "PINNED IN CATEGORY"}
        </Badge>
      ) : null}
      {post.lockedAt ? (
        <Badge size="label" variant="secondary">
          LOCKED
        </Badge>
      ) : null}
      {post.hiddenAt ? (
        <Badge size="label" variant="destructive">
          HIDDEN
        </Badge>
      ) : null}
      {post.deletedAt ? (
        <Badge size="label" variant="destructive">
          REMOVED
        </Badge>
      ) : null}
    </div>
  );
}
