import {
  Bookmark02Icon,
  Delete02Icon,
  FavouriteIcon,
  Flag01Icon,
  PencilEdit01Icon,
  Share08Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useEffect, useState } from "react";

import { CrewTile } from "@/components/collab/CrewTile";
import { CommentThread, type CommentGate } from "@/components/comments/CommentThread";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { GraphPaper } from "@/components/ui/graph-paper";
import { HoverPlayImage } from "@/components/ui/hover-play-image";
import { ReportDialog } from "@/components/ui/report-dialog";
import { Section } from "@/components/ui/section";
import { TransformedImage } from "@/components/ui/transformed-image";
import { Censored, Heading, MarkedText, MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { authStore } from "@/lib/auth-store";
import { EVENTS } from "@/lib/event-taxonomy";
import { formatCount } from "@/lib/format-count";
import { formatDate } from "@/lib/format-date";
import { FORUM_KIND_LABEL, FORUM_LIMITS, forumReadMinutes } from "@/lib/forum-posts";
import { useMemberIdentity } from "@/lib/hooks/use-member-identity";
import { jamLinkParams } from "@/lib/jam-links";
import { toastMutationError } from "@/lib/mutation-errors";
import { captureEvent } from "@/lib/product-insights";
import { profileLinkParams } from "@/lib/profile-links";
import { projectLinkParams } from "@/lib/project-links";
import { teamLinkParams } from "@/lib/team-links";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { client } from "@/orpc/client";

import {
  type ForumPostDetail,
  forumPostQueryOptions,
  invalidateForum,
  useForumReactions,
} from "./forum-queries";
import { ForumEditDialog } from "./ForumComposer";
import { CategoryBadge, TagBadges } from "./ForumPostCard";
import { ForumStaffMenu } from "./ForumStaffMenu";
import { useGuildGate } from "./guild-gate";

function Breadcrumb({ post }: { post: ForumPostDetail }) {
  const crumb = "text-primary hover:underline";
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2">
      <MicroLabel as="span" className="uppercase">
        <Link to="/forum" className={crumb}>
          Forum
        </Link>
      </MicroLabel>
      <MicroLabel as="span">/</MicroLabel>
      <MicroLabel as="span" className="uppercase">
        <Link
          to="/forum/c/$categorySlug"
          params={{ categorySlug: post.category.slug }}
          className={crumb}
        >
          {post.category.name}
        </Link>
      </MicroLabel>
      {post.team ? (
        <>
          <MicroLabel as="span">/</MicroLabel>
          <MicroLabel as="span" className="uppercase">
            <Link to="/teams/$teamId" params={teamLinkParams(post.team)} className={crumb}>
              {post.team.name}
            </Link>
          </MicroLabel>
        </>
      ) : null}
    </nav>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse gap-0.5">
      <dt>
        <MicroLabel as="span" className="uppercase">
          {label}
        </MicroLabel>
      </dt>
      <dd className="text-lg leading-none font-bold tracking-tight tabular-nums">{value}</dd>
    </div>
  );
}

/** Masthead per layout D: cover, kind, title, byline and the numbers. */
function PostHero({ post }: { post: ForumPostDetail }) {
  const { name } = useMemberIdentity();
  const authorName = post.author ? name(post.author, "unknown") : "deleted user";
  const title = post.title ?? (post.visibility === "visible" ? null : "Post unavailable");

  return (
    <Well notchOpts surfaceClassName="bg-card backdrop-blur-none">
      {post.coverUrl ? (
        <div className="relative aspect-video max-h-96 w-full overflow-hidden bg-muted/20">
          <HoverPlayImage
            src={post.coverUrl}
            transform={{ width: 1280, quality: 75 }}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
      ) : null}
      <div className="relative bg-linear-to-br from-deboss-surface via-deboss-surface to-primary/12">
        <GraphPaper fade="bottom-left" />
        <div className="relative flex flex-col gap-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge size="label" className="uppercase">
              {FORUM_KIND_LABEL[post.kind]}
            </Badge>
            {post.seriesIndex != null ? (
              <Badge variant="outline" size="label" className="uppercase">
                Entry {post.seriesIndex}
              </Badge>
            ) : null}
            {post.solved ? (
              <Badge variant="success" size="label">
                <HugeiconsIcon icon={Tick01Icon} />
                SOLVED
              </Badge>
            ) : null}
            {post.status === "draft" ? (
              <Badge variant="warning" size="label">
                DRAFT
              </Badge>
            ) : null}
            <CategoryBadge category={post.category} />
          </div>
          {title ? (
            <Heading as="h1" className="text-3xl leading-tight md:text-4xl">
              <Censored>{title}</Censored>
            </Heading>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              {post.team ? (
                <UserAvatar
                  avatarUrl={post.team.avatarUrl}
                  username={post.team.name}
                  size={40}
                  shape="square"
                />
              ) : (
                <UserAvatar
                  avatarUrl={post.author?.avatarUrl}
                  guildAvatarUrl={post.author?.guildAvatarUrl}
                  username={authorName}
                  guildRoles={post.author?.guildRoles}
                  size={40}
                />
              )}
              <div className="flex min-w-0 flex-col gap-0.5">
                <Text as="span" size="sm" bold className="truncate">
                  {post.team ? (
                    <Link
                      to="/teams/$teamId"
                      params={teamLinkParams(post.team)}
                      className="hover:text-primary"
                    >
                      {post.team.name}
                    </Link>
                  ) : post.author ? (
                    <Link
                      to="/profile/$userId"
                      params={profileLinkParams(post.author)}
                      className="hover:text-primary"
                    >
                      {authorName}
                    </Link>
                  ) : (
                    authorName
                  )}
                </Text>
                {post.team ? (
                  <Text as="span" size="xs" variant="muted">
                    written by{" "}
                    {post.author ? (
                      <Link
                        to="/profile/$userId"
                        params={profileLinkParams(post.author)}
                        className="text-foreground hover:text-primary"
                      >
                        {authorName}
                      </Link>
                    ) : (
                      authorName
                    )}
                  </Text>
                ) : null}
              </div>
            </div>
            <dl className="flex flex-wrap items-end gap-6">
              {post.publishedAt ? (
                <Stat
                  label={post.editedAt ? "Edited" : "Published"}
                  value={formatDate(post.editedAt ?? post.publishedAt, {
                    month: "short",
                    day: "numeric",
                  })}
                />
              ) : null}
              {post.body && post.kind === "devlog" ? (
                <Stat label="Read" value={`${forumReadMinutes(post.body)} min`} />
              ) : null}
              <Stat label="Likes" value={formatCount(post.likeCount)} />
            </dl>
          </div>
        </div>
      </div>
    </Well>
  );
}

/** What stands in for the body when a reader can't see it. */
function VisibilityNotice({ post }: { post: ForumPostDetail }) {
  if (post.visibility === "visible") return null;
  const deleted = post.visibility === "deleted";
  return (
    <Well variant="ghost" className="gap-1 p-5 backdrop-blur-none">
      <MicroLabel className="uppercase" variant={deleted ? "muted" : "warning"}>
        {deleted ? "This post was deleted" : "Hidden by staff"}
      </MicroLabel>
      <Text size="sm" variant="muted">
        {deleted
          ? "The discussion below stays up."
          : post.body
            ? "Only you and staff can see it right now."
            : "It's under review. The discussion below stays readable."}
      </Text>
      {post.hiddenReason ? (
        <Text size="sm" className="mt-1">
          Reason: {post.hiddenReason}
        </Text>
      ) : null}
    </Well>
  );
}

function ActionBar({ post, onEdit }: { post: ForumPostDetail; onEdit: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = useStore(authStore);
  const { toggleLike, toggleSave } = useForumReactions(post);
  const { guard, onServerRefusal } = useGuildGate();
  const [reported, setReported] = useState(false);
  const live = post.visibility === "visible" && post.status === "published";
  const isOwnPost = session?.user?.id != null && post.author?.id === session.user.id;

  const remove = useMutation({
    mutationFn: () => client.deleteForumPost({ postId: post.id }),
    onSuccess: () => {
      invalidateForum(queryClient, post.id);
      toast.success("Post deleted.");
      void navigate({ to: "/forum" });
    },
    onError: (error) => {
      if (onServerRefusal(error, "delete", () => remove.mutate())) return;
      toastMutationError("forum.delete")(error);
    },
  });

  const share = async () => {
    const url = window.location.href.split("#")[0]!;
    if (navigator.share) {
      await navigator
        .share({ title: post.title ?? "A post on the Brackeys forum", url })
        .catch(() => {});
      return;
    }
    await navigator.clipboard?.writeText(url);
    toast.success("Link copied.");
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-y border-dashed border-muted/40 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {live ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleLike}
              aria-pressed={post.viewer.liked}
              className={cn(post.viewer.liked && "text-brackeys-fuscia")}
            >
              <HugeiconsIcon
                icon={FavouriteIcon}
                className={cn(post.viewer.liked && "fill-current")}
              />
              <span className="tabular-nums">{formatCount(post.likeCount)}</span>
              <span className="sr-only">{post.viewer.liked ? "Unlike" : "Like"}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleSave}
              aria-pressed={post.viewer.saved}
              className={cn("tracking-widest", post.viewer.saved && "text-primary")}
            >
              <HugeiconsIcon
                icon={Bookmark02Icon}
                className={cn(post.viewer.saved && "fill-current")}
              />
              {post.viewer.saved ? "SAVED" : "SAVE"}
            </Button>
            <Button variant="outline" size="sm" onClick={share} className="tracking-widest">
              <HugeiconsIcon icon={Share08Icon} />
              SHARE
            </Button>
          </>
        ) : null}
        {post.viewer.canEdit && post.visibility !== "hidden" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => guard("edit", onEdit)}
            className="tracking-widest"
          >
            <HugeiconsIcon icon={PencilEdit01Icon} />
            EDIT
          </Button>
        ) : null}
        {post.viewer.canDelete ? (
          <Confirm
            variant="destructive"
            title="Delete this post?"
            message="The post is replaced by a notice and its images are deleted. Comments stay."
            confirmText="DELETE"
            onConfirm={() => guard("delete", () => remove.mutate())}
          >
            <Button
              variant="outline"
              size="sm"
              disabled={remove.isPending}
              className="tracking-widest"
            >
              <HugeiconsIcon icon={Delete02Icon} />
              DELETE
            </Button>
          </Confirm>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {live && session?.user && !isOwnPost ? (
          reported ? (
            <Text size="xs" variant="success" className="tracking-widest uppercase">
              Report sent
            </Text>
          ) : (
            <ReportDialog
              title="Report this post?"
              message="Tell staff what's wrong with it. Only staff see this."
              onSubmit={async (reason) => {
                await client.reportForumPost({ postId: post.id, reason });
                setReported(true);
                toast.success("Report sent — staff will take a look.");
              }}
            >
              <Button variant="ghost" size="sm" className="tracking-widest">
                <HugeiconsIcon icon={Flag01Icon} />
                REPORT
              </Button>
            </ReportDialog>
          )
        ) : null}
        {post.viewer.isStaff ? (
          <ForumStaffMenu post={post} onRemoved={() => void navigate({ to: "/forum" })} />
        ) : null}
      </div>
    </div>
  );
}

/** The team, the author, and whatever the post links to. */
function PostSidebar({ post }: { post: ForumPostDetail }) {
  const { name } = useMemberIdentity();
  const { project, jam, collabPost } = post.links;
  const tiles = [
    post.team ? (
      <CrewTile
        key="team"
        label={post.kind === "devlog" ? "DEVLOG BY" : "TEAM"}
        title={post.team.name}
        avatar={
          <UserAvatar
            avatarUrl={post.team.avatarUrl}
            username={post.team.name}
            size={40}
            shape="square"
          />
        }
        link={
          <Link
            to="/teams/$teamId"
            params={teamLinkParams(post.team)}
            aria-label={post.team.name}
          />
        }
      />
    ) : null,
    post.author ? (
      <CrewTile
        key="author"
        label={post.team ? "WRITTEN BY" : "POSTED BY"}
        title={name(post.author, "unknown")}
        avatar={
          <UserAvatar
            avatarUrl={post.author.avatarUrl}
            guildAvatarUrl={post.author.guildAvatarUrl}
            username={name(post.author, "unknown")}
            guildRoles={post.author.guildRoles}
            size={40}
          />
        }
        link={
          <Link
            to="/profile/$userId"
            params={profileLinkParams(post.author)}
            aria-label={`${name(post.author, "unknown")}'s profile`}
          />
        }
      />
    ) : null,
    project ? (
      <CrewTile
        key="project"
        label="PROJECT"
        title={project.title}
        avatar={
          project.imageUrl ? (
            <span className="relative h-10 w-16 shrink-0 overflow-hidden border border-muted/40">
              <HoverPlayImage
                src={project.imageUrl}
                transform={{ width: 192 }}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </span>
          ) : null
        }
        link={
          <Link
            to="/projects/$projectSlug"
            params={projectLinkParams(project)}
            aria-label={project.title}
          />
        }
      />
    ) : null,
    jam ? (
      <CrewTile
        key="jam"
        label="JAM"
        title={jam.title}
        avatar={null}
        link={<Link to="/jams/$jamSlug" params={jamLinkParams(jam)} aria-label={jam.title} />}
      />
    ) : null,
    collabPost ? (
      <CrewTile
        key="collab"
        label="COLLAB POST"
        title={collabPost.title}
        avatar={null}
        link={
          <Link
            to="/collab/$postId"
            params={{ postId: String(collabPost.id) }}
            aria-label={collabPost.title}
          />
        }
      />
    ) : null,
  ].filter(Boolean);

  if (tiles.length === 0) return null;
  return (
    <Section id="behind" title="BEHIND THE POST" size="sm">
      <div className="flex flex-col gap-2">{tiles}</div>
    </Section>
  );
}

/**
 * A forum post's own page (layout D). Loads through the route's loader so
 * the text and meta tags are in the served document; the query keeps it
 * live for likes, edits and staff actions.
 */
export function ForumPostPage({ initialPost }: { initialPost: ForumPostDetail }) {
  const { guard, onServerRefusal } = useGuildGate();
  const { data } = useQuery({
    ...forumPostQueryOptions(initialPost.id),
    initialData: initialPost,
  });
  const post = data ?? initialPost;
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    captureEvent(EVENTS.forumPostViewed, { post_id: initialPost.id, kind: initialPost.kind });
  }, [initialPost.id, initialPost.kind]);

  const commentGate: CommentGate = {
    guard: (run) => guard("comment", run),
    onServerRefusal: (error, retry) => onServerRefusal(error, "comment", retry),
  };

  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-8 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <main className="flex min-w-0 flex-col gap-6">
        <Breadcrumb post={post} />
        <PostHero post={post} />
        <VisibilityNotice post={post} />

        {post.body ? (
          <MarkedText className="max-w-prose text-base text-foreground/90">{post.body}</MarkedText>
        ) : null}

        {post.images.length > 0 ? (
          <div
            className={cn(
              "grid gap-2",
              post.images.length > 1 && "sm:grid-cols-2",
              post.images.length > FORUM_LIMITS.post.images && "lg:grid-cols-3",
            )}
          >
            {post.images.map((image) => (
              <a key={image.id} href={image.url} target="_blank" rel="noopener noreferrer">
                <TransformedImage
                  src={image.url}
                  transform={{ width: post.images.length > 1 ? 640 : 1280, quality: 80 }}
                  alt={image.alt ?? ""}
                  loading="lazy"
                  decoding="async"
                  className="w-full border border-muted/40 bg-muted/20 object-cover"
                />
              </a>
            ))}
          </div>
        ) : null}

        <TagBadges tags={post.tags} />
        <ActionBar post={post} onEdit={() => setEditOpen(true)} />

        <CommentThread
          subject={{ type: "forum_post", id: post.id }}
          maxLength={2000}
          placeholder={
            post.kind === "question" ? "Answer, or ask for details…" : "Add to the discussion…"
          }
          emptyLabel={post.kind === "question" ? "NO ANSWERS YET" : "NO COMMENTS YET"}
          emptyHint={
            post.kind === "question"
              ? "Know the fix? Be the first to answer."
              : "Start the conversation."
          }
          signInPrompt="Sign in with Discord to join the discussion."
          gate={commentGate}
          shell={(content, count) => (
            <Section
              id="comments"
              title={post.kind === "question" ? "ANSWERS" : "COMMENTS"}
              size="sm"
              blurb={count === 0 ? undefined : `${count} so far.`}
            >
              {content}
            </Section>
          )}
        />
      </main>

      <aside className="flex flex-col gap-6 lg:sticky lg:top-4 lg:self-start">
        <PostSidebar post={post} />
      </aside>

      {post.viewer.canEdit ? (
        <ForumEditDialog post={post} open={editOpen} onClose={() => setEditOpen(false)} />
      ) : null}
    </div>
  );
}
