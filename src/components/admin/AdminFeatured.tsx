import { StarIcon, StarOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AdminEmpty, AdminRow, AdminSection, Field, errText } from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MicroLabel, Text } from "@/components/ui/typography";
import { timeAgo } from "@/lib/format-time";
import { client, orpc } from "@/orpc/client";

/** How many search hits to offer at once — enough to find a post, not a board. */
const SEARCH_LIMIT = 8;

/** Derived rather than restated, same as `CollabPostDetailData` — the board
 *  listing's row shape is wide and moves. */
type ListedPost = Awaited<ReturnType<typeof client.listPosts>>["posts"][number];

/**
 * Staff curation for the collab board. Featuring pins a post to the top of
 * `listPosts` for everyone and notifies its author, so this is the one admin
 * section whose effect is immediately public — hence the confirm-free but
 * explicit toggles, and the live list of what is currently pinned.
 */
export function AdminFeatured() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const featured = useQuery(orpc.listPosts.queryOptions({ input: { featured: true, limit: 50 } }));

  const trimmed = search.trim();
  const results = useQuery({
    ...orpc.listPosts.queryOptions({ input: { search: trimmed, limit: SEARCH_LIMIT } }),
    enabled: trimmed.length > 1,
  });

  const toggle = useMutation({
    mutationFn: (input: { postId: number; featured: boolean }) => client.featurePost(input),
    onSuccess: (_result, input) => {
      toast.success(input.featured ? "Pinned to the board." : "Unpinned.");
      // The board's own listing and the counters beside it move too.
      void queryClient.invalidateQueries({ queryKey: orpc.listPosts.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.getPost.key() });
    },
    onError: (err: unknown) => toast.error(errText(err)),
  });

  const featuredPosts: ListedPost[] = featured.data?.posts ?? [];
  const featuredIds = new Set(featuredPosts.map((p) => p.id));

  return (
    <div className="flex flex-col gap-8">
      <AdminSection
        title="Featured posts"
        count={featured.isPending ? undefined : featuredPosts.length}
        hint="Pinned above every other post on the board, in every sort order. The author is notified when you pin."
      >
        {featured.isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : featuredPosts.length === 0 ? (
          <AdminEmpty>Nothing is pinned. The board is in pure recency order.</AdminEmpty>
        ) : (
          <div className="flex flex-col gap-3">
            {featuredPosts.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                isFeatured
                busy={toggle.isPending}
                onToggle={() => toggle.mutate({ postId: post.id, featured: false })}
              />
            ))}
          </div>
        )}
      </AdminSection>

      <AdminSection title="Find a post to feature" hint="Search titles and descriptions.">
        <Field label="Search" htmlFor="admin-featured-search">
          <Input
            id="admin-featured-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. pixel artist"
            maxLength={100}
          />
        </Field>

        {trimmed.length <= 1 ? null : results.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (results.data?.posts.length ?? 0) === 0 ? (
          <AdminEmpty>No posts match “{trimmed}”.</AdminEmpty>
        ) : (
          <div className="flex flex-col gap-3">
            {(results.data?.posts ?? []).map((post: ListedPost) => {
              const isFeatured = featuredIds.has(post.id) || post.featuredAt != null;
              return (
                <PostRow
                  key={post.id}
                  post={post}
                  isFeatured={isFeatured}
                  busy={toggle.isPending}
                  onToggle={() => toggle.mutate({ postId: post.id, featured: !isFeatured })}
                />
              );
            })}
          </div>
        )}
      </AdminSection>
    </div>
  );
}

function PostRow({
  post,
  isFeatured,
  busy,
  onToggle,
}: {
  post: ListedPost;
  isFeatured: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <AdminRow muted={post.status !== "recruiting"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <RouterLink
            to="/collab/$postId"
            params={{ postId: String(post.id) }}
            className="min-w-0 text-sm font-medium hover:text-primary hover:underline"
          >
            {post.title}
          </RouterLink>
          <div className="flex flex-wrap items-center gap-2">
            <Badge size="label" variant="secondary">
              {post.type}
            </Badge>
            {post.status !== "recruiting" ? (
              <Badge size="label" variant="outline">
                {post.status === "expired" ? "EXPIRED" : "CLOSED"}
              </Badge>
            ) : null}
            <MicroLabel as="span" className="text-muted-foreground">
              {timeAgo(post.createdAt)}
            </MicroLabel>
          </div>
          {isFeatured && post.featuredAt ? (
            <Text size="xs" variant="muted">
              Pinned {timeAgo(post.featuredAt)}
            </Text>
          ) : null}
        </div>

        <Button
          size="sm"
          variant={isFeatured ? "outline" : "default"}
          disabled={busy}
          onClick={onToggle}
          className="tracking-widest"
        >
          <HugeiconsIcon
            icon={isFeatured ? StarOffIcon : StarIcon}
            strokeWidth={2}
            data-icon="inline-start"
          />
          {isFeatured ? "UNPIN" : "PIN"}
        </Button>
      </div>
    </AdminRow>
  );
}
