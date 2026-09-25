import {
  ArrowRight02Icon,
  Bookmark02Icon,
  Comment01Icon,
  FavouriteIcon,
  PinIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useNavigate } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { TimeAgo } from "@/components/ui/time-ago";
import { TransformedImage } from "@/components/ui/transformed-image";
import { Censored, Heading, MarkedText, MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { formatCount } from "@/lib/format-count";
import { forumPostLinkParams } from "@/lib/forum-posts";
import { useMemberIdentity } from "@/lib/hooks/use-member-identity";
import { safeThemeColor } from "@/lib/jam-palette";
import { cn } from "@/lib/utils";

import { type ForumCard, useForumReactions } from "./forum-queries";

/** A category's colour square — the rail, the cards and the boards share it. */
export function CategorySwatch({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-[2px] bg-muted-foreground", className)}
      style={{ backgroundColor: safeThemeColor(color) ?? undefined }}
    />
  );
}

export function CategoryBadge({ category }: { category: ForumCard["category"] }) {
  return (
    <Badge
      variant="outline"
      size="label"
      className="pointer-events-auto uppercase hover:border-primary/60"
      render={<Link to="/forum/c/$categorySlug" params={{ categorySlug: category.slug }} />}
    >
      <CategorySwatch color={category.color} />
      {category.name}
    </Badge>
  );
}

export function TagBadges({ tags, className }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {tags.map((tag) => (
        <Badge
          key={tag}
          variant="outline"
          size="label"
          className="pointer-events-auto uppercase hover:border-primary/60"
          render={<Link to="/forum/tags/$tag" params={{ tag }} />}
        >
          #{tag}
        </Badge>
      ))}
    </div>
  );
}

/** Who a card is by: the team for a team devlog, the member otherwise. */
function Byline({ post, showCategory }: { post: ForumCard; showCategory: boolean }) {
  const { name } = useMemberIdentity();
  const authorName = post.author ? name(post.author, "unknown") : "deleted user";

  return (
    <div className="flex items-center gap-2.5">
      {post.team ? (
        <UserAvatar avatarUrl={post.team.avatarUrl} username={post.team.name} size={36} />
      ) : (
        <UserAvatar
          avatarUrl={post.author?.avatarUrl}
          guildAvatarUrl={post.author?.guildAvatarUrl}
          username={authorName}
          guildRoles={post.author?.guildRoles}
          size={36}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Text as="span" size="sm" bold className="truncate">
          {post.team ? (
            <>
              {post.team.name}
              <Text as="span" size="sm" variant="muted">
                {" "}
                · by {authorName}
              </Text>
            </>
          ) : (
            authorName
          )}
        </Text>
        <MicroLabel as="span" className="uppercase">
          {post.kind === "devlog" ? (
            <Text as="span" size="xs" variant="accent">
              Devlog
              {post.seriesIndex != null ? ` · Entry ${post.seriesIndex}` : ""}
              {" · "}
            </Text>
          ) : null}
          {post.publishedAt ? (
            <Link
              to="/forum/$postId"
              params={forumPostLinkParams(post)}
              className="hover:text-foreground"
            >
              <TimeAgo date={post.publishedAt} />
            </Link>
          ) : null}
          {showCategory && post.kind === "post" ? ` · in ${post.category.name}` : ""}
        </MicroLabel>
      </div>
      {showCategory && post.kind !== "post" ? <CategoryBadge category={post.category} /> : null}
    </div>
  );
}

function ActionRow({ post, trailing }: { post: ForumCard; trailing?: React.ReactNode }) {
  const { toggleLike, toggleSave } = useForumReactions(post);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-muted/40 pt-2">
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleLike}
          aria-pressed={post.viewer.liked}
          aria-label={post.viewer.liked ? "Unlike" : "Like"}
          className={cn(post.viewer.liked && "text-brackeys-fuscia")}
        >
          <HugeiconsIcon icon={FavouriteIcon} className={cn(post.viewer.liked && "fill-current")} />
          <span className="tabular-nums">{formatCount(post.likeCount)}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link to="/forum/$postId" params={forumPostLinkParams(post)} hash="comments" />}
          aria-label={`${post.commentCount} comments`}
        >
          <HugeiconsIcon icon={Comment01Icon} />
          <span className="tabular-nums">{formatCount(post.commentCount)}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleSave}
          aria-pressed={post.viewer.saved}
          aria-label={post.viewer.saved ? "Remove from saved" : "Save"}
          tooltip={post.viewer.saved ? "Saved" : "Save for later"}
          className={cn(post.viewer.saved && "text-primary")}
        >
          <HugeiconsIcon
            icon={Bookmark02Icon}
            className={cn(post.viewer.saved && "fill-current")}
          />
        </Button>
      </div>
      {trailing}
    </div>
  );
}

function PinnedMark({ post }: { post: ForumCard }) {
  if (!post.pinnedAt) return null;
  return (
    <Badge variant="warning" size="label">
      <HugeiconsIcon icon={PinIcon} />
      PINNED
    </Badge>
  );
}

function DevlogCard({ post, showCategory }: { post: ForumCard; showCategory: boolean }) {
  const params = forumPostLinkParams(post);
  return (
    <>
      <Byline post={post} showCategory={showCategory} />
      <div className="flex flex-col gap-2">
        <PinnedMark post={post} />
        <Heading as="h2" size="xl" className="leading-snug">
          <Link to="/forum/$postId" params={params} className="hover:text-primary">
            <Censored>{post.title}</Censored>
          </Link>
        </Heading>
        {post.excerpt ? (
          <Text as="p" variant="muted" className="line-clamp-3 text-foreground/80">
            <Censored>{post.excerpt}</Censored>
          </Text>
        ) : null}
      </div>
      {post.coverUrl ? (
        <Link
          to="/forum/$postId"
          params={params}
          tabIndex={-1}
          className="block aspect-video overflow-hidden border border-muted/40 bg-muted/20"
        >
          <TransformedImage
            src={post.coverUrl}
            transform={{ width: 960, quality: 75 }}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </Link>
      ) : null}
      <TagBadges tags={post.tags} />
      <ActionRow
        post={post}
        trailing={
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link to="/forum/$postId" params={params} />}
          >
            Read devlog
            <HugeiconsIcon icon={ArrowRight02Icon} />
          </Button>
        }
      />
    </>
  );
}

function ShortPostCard({ post, showCategory }: { post: ForumCard; showCategory: boolean }) {
  const images = post.images.slice(0, 4);
  return (
    <>
      <Byline post={post} showCategory={showCategory} />
      <PinnedMark post={post} />
      {post.body ? (
        <MarkedText mentions className="text-base text-foreground/90">
          {post.body}
        </MarkedText>
      ) : null}
      {images.length > 0 ? (
        <div className={cn("grid gap-2", images.length > 1 && "grid-cols-2")}>
          {images.map((image) => (
            <TransformedImage
              key={image.id}
              src={image.url}
              transform={{ width: images.length > 1 ? 480 : 960, quality: 75 }}
              alt={image.alt ?? ""}
              loading="lazy"
              decoding="async"
              className={cn(
                "w-full border border-muted/40 bg-muted/20 object-cover",
                images.length > 1 ? "aspect-square sm:aspect-video" : "max-h-96",
              )}
            />
          ))}
        </div>
      ) : null}
      <ActionRow post={post} trailing={<TagBadges tags={post.tags} />} />
    </>
  );
}

function QuestionCard({ post, showCategory }: { post: ForumCard; showCategory: boolean }) {
  const { name } = useMemberIdentity();
  const asker = post.author ? name(post.author, "unknown") : "deleted user";
  return (
    <div className="flex items-start gap-4">
      <div className="chonk-deboss flex size-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border bg-deboss-surface">
        <Text as="span" size="lg" bold density="dense" className="tabular-nums">
          {formatCount(post.commentCount)}
        </Text>
        <MicroLabel as="span" className="text-[8px] uppercase">
          {post.commentCount === 1 ? "Answer" : "Answers"}
        </MicroLabel>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {post.solved ? (
            <Badge variant="success" size="label">
              <HugeiconsIcon icon={Tick01Icon} />
              SOLVED
            </Badge>
          ) : null}
          <PinnedMark post={post} />
          {showCategory ? <CategoryBadge category={post.category} /> : null}
          <MicroLabel as="span" className="uppercase">
            asked by {asker}
            {post.publishedAt ? (
              <>
                {" · "}
                <TimeAgo date={post.publishedAt} />
              </>
            ) : null}
          </MicroLabel>
        </div>
        <Heading as="h2" size="lg" className="leading-snug">
          <Link
            to="/forum/$postId"
            params={forumPostLinkParams(post)}
            className="hover:text-primary"
          >
            <Censored>{post.title}</Censored>
          </Link>
        </Heading>
        <TagBadges tags={post.tags} />
      </div>
    </div>
  );
}

/** One post in a feed, drawn by its kind. */
export function ForumPostCard({
  post,
  showCategory = true,
}: {
  post: ForumCard;
  /** Off on a category board, where every card would repeat its name. */
  showCategory?: boolean;
}) {
  const navigate = useNavigate();
  const params = forumPostLinkParams(post);

  // The whole card opens the post. Links and buttons inside it keep their own
  // target, and a drag-to-select over the body doesn't count as a click.
  function openPost(event: React.MouseEvent<HTMLElement>) {
    if (event.defaultPrevented || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("a, button, input, textarea, [role=button]")) return;
    if (window.getSelection()?.toString()) return;
    if (event.metaKey || event.ctrlKey) {
      window.open(`/forum/${params.postId}`, "_blank", "noopener");
      return;
    }
    void navigate({ to: "/forum/$postId", params });
  }

  return (
    <Chonk
      variant="surface"
      size="lg"
      render={<article />}
      isMagnetic={false}
      onClick={openPost}
      className={cn(
        "cursor-pointer flex-col gap-3 p-4 sm:p-5",
        post.pinnedAt && "border-warning/40",
        post.kind === "question" && "gap-2",
      )}
    >
      {post.kind === "devlog" ? (
        <DevlogCard post={post} showCategory={showCategory} />
      ) : post.kind === "question" ? (
        <QuestionCard post={post} showCategory={showCategory} />
      ) : (
        <ShortPostCard post={post} showCategory={showCategory} />
      )}
    </Chonk>
  );
}

/**
 * One short post in Pulse: a line of chat-like density — who, when, what —
 * with the like and the thread one click away.
 */
export function PulseRow({ post }: { post: ForumCard }) {
  const { name } = useMemberIdentity();
  const { toggleLike } = useForumReactions(post);
  const authorName = post.author ? name(post.author, "unknown") : "deleted user";
  const images = post.images.slice(0, 4);
  return (
    <article className="flex gap-3 px-4 py-3">
      <UserAvatar
        avatarUrl={post.author?.avatarUrl}
        guildAvatarUrl={post.author?.guildAvatarUrl}
        username={authorName}
        guildRoles={post.author?.guildRoles}
        size={32}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Text as="span" size="sm" bold>
            {authorName}
          </Text>
          <MicroLabel as="span" className="uppercase">
            {post.publishedAt ? (
              <Link
                to="/forum/$postId"
                params={forumPostLinkParams(post)}
                className="hover:text-foreground"
              >
                <TimeAgo date={post.publishedAt} />
              </Link>
            ) : null}
            {` · ${post.category.name}`}
          </MicroLabel>
        </div>
        {post.body ? (
          <MarkedText mentions className="text-sm text-foreground/90">
            {post.body}
          </MarkedText>
        ) : null}
        {images.length > 0 ? (
          <div className="flex gap-1.5">
            {images.map((image) => (
              <TransformedImage
                key={image.id}
                src={image.url}
                transform={{ width: 240, quality: 70 }}
                alt={image.alt ?? ""}
                loading="lazy"
                decoding="async"
                className="size-20 border border-muted/40 bg-muted/20 object-cover"
              />
            ))}
          </div>
        ) : null}
        <div className="-ml-2 flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="xs"
            onClick={toggleLike}
            aria-pressed={post.viewer.liked}
            aria-label={post.viewer.liked ? "Unlike" : "Like"}
            className={cn(post.viewer.liked && "text-brackeys-fuscia")}
          >
            <HugeiconsIcon
              icon={FavouriteIcon}
              className={cn(post.viewer.liked && "fill-current")}
            />
            <span className="tabular-nums">{formatCount(post.likeCount)}</span>
          </Button>
          <Button
            variant="ghost"
            size="xs"
            nativeButton={false}
            render={<Link to="/forum/$postId" params={forumPostLinkParams(post)} hash="comments" />}
            aria-label={`${post.commentCount} comments`}
          >
            <HugeiconsIcon icon={Comment01Icon} />
            <span className="tabular-nums">{formatCount(post.commentCount)}</span>
          </Button>
        </div>
      </div>
    </article>
  );
}
