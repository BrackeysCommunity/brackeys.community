import { StarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";

import { Badge } from "@/components/ui/badge";
import { Chonk } from "@/components/ui/chonk";
import { MediaCardFloatingBadge, MediaCardImage, MediaCardScrim } from "@/components/ui/media-card";
import { Text } from "@/components/ui/typography";
import { timeAgo } from "@/lib/format-time";
import { cn } from "@/lib/utils";

interface CollabPostCardPost {
  id: number;
  type: string;
  title: string;
  status: string;
  featuredAt: string | Date | null;
  createdAt: string | Date | null;
  authorId: string;
  compensationType?: string | null;
  primaryImageUrl?: string | null;
  jam?: { jamId: number; title: string } | null;
  team?: { id: string; slug: string; name: string } | null;
  /** How the viewer's own skills line up with the post's stack. Null for
   *  signed-out viewers, the author, and posts with no stack. */
  viewerOverlap?: { matched: string[]; total: number } | null;
}

interface CollabPostCardProps {
  post: CollabPostCardPost;
  /** Highlighted because it's the post loaded in the inspector. */
  selected?: boolean;
  /** Hoisted to the top because the viewer owns it. */
  pinned?: boolean;
  /**
   * Load the post into the board's inspector instead of navigating. Omit it
   * off the board — the home ticker has no inspector to drive, and a row
   * that swallows its own click there would go nowhere.
   */
  onSelect?: (postId: number) => void;
}

const TYPE_LABELS: Record<string, string> = {
  paid: "PAID",
  hobby: "HOBBY",
  playtest: "PLAYTEST",
  mentor: "MENTOR",
};

const COMP_TYPE_LABELS: Record<string, string> = {
  hourly: "HOURLY",
  fixed: "FIXED",
  rev_share: "REV SHARE",
  negotiable: "NEGOT.",
};

/**
 * The card's click target: a real anchor to the post's own page, so
 * every post is a crawlable link and cmd/middle-click opens the page —
 * but a plain click is intercepted to drive the board's inspector
 * selection instead, exactly as the old button did. Without `onSelect`
 * (off the board) the anchor is left to navigate. `preload={false}`
 * because hover-preloading a whole post per card the pointer crosses
 * would hammer `getPost` for nothing.
 */
function PostCardLink({
  post,
  selected,
  onSelect,
  ...merged
}: Pick<CollabPostCardProps, "post" | "selected" | "onSelect"> &
  // `onSelect` is also a DOM event handler on anchors — ours wins.
  Omit<React.ComponentProps<"a">, "href" | "onSelect">) {
  return (
    <Link
      // Chonk's `useRender` clones this element with the tile's className,
      // children, and data attributes merged in — they arrive as props here
      // and must reach the anchor.
      {...merged}
      to="/collab/$postId"
      params={{ postId: String(post.id) }}
      preload={false}
      onClick={(e) => {
        if (!onSelect) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onSelect(post.id);
      }}
      aria-current={selected ? "true" : undefined}
      aria-label={`${post.title} — ${TYPE_LABELS[post.type] ?? post.type}`}
    />
  );
}

/**
 * Shared shell for both post layouts, matching the team directory's
 * tile: an embossed surface that lifts on hover, opaque `bg-card` so
 * the dot field doesn't read through it, and the whole tile as the
 * click target. Selection swaps the emboss to primary rather than
 * painting a tint over the content.
 */
function postCardClasses(selected: boolean, closed: boolean) {
  return cn(
    "w-full cursor-pointer bg-card backdrop-blur-none",
    // `--emboss-shadow` is inherited, so the tile's hover/selected switch
    // to primary would repaint every badge inside it too. The badges'
    // own row pins the var back to the theme value — `--color-emboss-shadow`
    // is substituted at `:root`, so it still carries the neutral colour.
    "[&_[data-emboss-reset]]:[--emboss-shadow:var(--color-emboss-shadow)]",
    closed && !selected && "opacity-60",
    selected &&
      "border-primary bg-[color-mix(in_srgb,var(--primary)_12%,var(--card))] [--emboss-shadow:var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_16%,var(--card))]",
  );
}

/** Badges every layout carries, in one order so the two agree. */
function PostBadges({
  post,
  closed,
  showType,
}: {
  post: CollabPostCardPost;
  closed: boolean;
  /** The card layout floats the type over the art instead. */
  showType?: boolean;
}) {
  return (
    <>
      {post.featuredAt ? (
        <Badge variant="warning" size="label" className="gap-1">
          <HugeiconsIcon icon={StarIcon} size={10} />
          FEATURED
        </Badge>
      ) : null}
      {showType ? (
        <Badge variant="secondary" size="label">
          {TYPE_LABELS[post.type] ?? post.type}
        </Badge>
      ) : null}
      {post.compensationType ? (
        <Badge variant="success" size="label">
          {COMP_TYPE_LABELS[post.compensationType] ?? post.compensationType}
        </Badge>
      ) : null}
      {closed ? (
        <Badge variant={post.status === "expired" ? "warning" : "destructive"} size="label">
          {post.status === "expired" ? "EXPIRED" : "CLOSED"}
        </Badge>
      ) : null}
      <JamBadge jam={post.jam} />
      <TeamBadge team={post.team} />
      <MatchBadge overlap={post.viewerOverlap} />
    </>
  );
}

/** "4h ago" — the same trailing meta line in both layouts. */
function PostMeta({ post, className }: { post: CollabPostCardPost; className?: string }) {
  return (
    <Text
      as="span"
      size="xs"
      variant="muted"
      className={cn("tracking-widest whitespace-nowrap tabular-nums", className)}
    >
      {timeAgo(post.createdAt)}
    </Text>
  );
}

/** The viewer's own post, marked the way the team shelf marks a role. */
function YoursBadge() {
  return (
    <Badge variant="outline" size="label" className="border-warning/50 text-warning">
      YOURS
    </Badge>
  );
}

/**
 * A post as one row of the stacked list: square cover thumbnail, title,
 * badges, and the meta pinned to the trailing edge. The thumbnail is
 * square rather than a full-bleed banner because post art is
 * user-uploaded and tends to be small and roughly square — cropping that
 * to a wide strip upscales it into mush.
 *
 * Carries no action buttons: the inspector owns everything you can do
 * to a post, leaving the row free to be scannable.
 */
export function CollabPostCard({ post, selected = false, pinned, onSelect }: CollabPostCardProps) {
  const isClosed = post.status !== "recruiting";

  return (
    <motion.div layout="position">
      <Chonk
        variant="surface"
        size="lg"
        render={<PostCardLink post={post} selected={selected} onSelect={onSelect} />}
        className={cn(postCardClasses(selected, isClosed), "items-center gap-3 p-3")}
      >
        <CardThumb url={post.primaryImageUrl ?? null} />

        <span data-emboss-reset className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex items-center gap-2">
            <Text
              as="span"
              bold
              size="sm"
              className="line-clamp-2 min-w-0 flex-1 tracking-wider text-foreground uppercase"
            >
              {post.title}
            </Text>
            {pinned ? <YoursBadge /> : null}
          </span>

          <span className="flex flex-wrap items-center gap-1">
            <PostBadges post={post} closed={isClosed} showType />
            {/* Rides the trailing edge on a wide row; drops onto its own
                line once the badges fill the width. */}
            <PostMeta post={post} className="ml-auto pl-2" />
          </span>
        </span>
      </Chonk>
    </motion.div>
  );
}

/**
 * The same post as a banner-led tile for the card layout. Post art is
 * shown whole against a blurred copy of itself rather than cropped to
 * the banner's aspect.
 */
export function CollabPostGridCard({
  post,
  selected = false,
  pinned,
  onSelect,
}: CollabPostCardProps) {
  const isClosed = post.status !== "recruiting";

  return (
    <motion.div layout="position" className="h-full">
      <Chonk
        variant="surface"
        size="lg"
        render={<PostCardLink post={post} selected={selected} onSelect={onSelect} />}
        className={cn(postCardClasses(selected, isClosed), "h-full flex-col overflow-hidden p-0")}
      >
        <span className="relative block h-36 w-full shrink-0 overflow-hidden bg-muted/20">
          {post.primaryImageUrl ? <MediaCardImage src={post.primaryImageUrl} /> : <DotField />}
          <MediaCardScrim />
          <MediaCardFloatingBadge as="span">
            <Text as="span" size="xs" className="tracking-widest text-foreground uppercase">
              {TYPE_LABELS[post.type] ?? post.type}
            </Text>
          </MediaCardFloatingBadge>
        </span>

        <span data-emboss-reset className="flex min-h-0 flex-1 flex-col gap-2 p-4">
          <span className="flex items-start gap-2">
            <Text
              as="span"
              bold
              size="sm"
              className="line-clamp-2 min-w-0 flex-1 tracking-wider text-foreground uppercase"
            >
              {post.title}
            </Text>
            {pinned ? <YoursBadge /> : null}
          </span>

          <span className="flex flex-wrap items-center gap-1">
            <PostBadges post={post} closed={isClosed} />
          </span>

          <PostMeta post={post} className="mt-auto pt-1" />
        </span>
      </Chonk>
    </motion.div>
  );
}

/**
 * Badge text long enough to need an ellipsis. The truncation has to live
 * on a child: the badge is a flex box, and `text-overflow` never applies
 * to the anonymous flex item bare text becomes — it just overflows and
 * gets clipped at both edges by the badge's centring.
 */
function BadgeLabel({ children }: { children: React.ReactNode }) {
  return <span className="truncate">{children}</span>;
}

/** The jam a post is recruiting for, when it named one. */
function JamBadge({ jam }: { jam?: { jamId: number; title: string } | null }) {
  if (!jam) return null;
  return (
    <Badge variant="warning" size="label" className="max-w-40">
      <BadgeLabel>{jam.title.toUpperCase()}</BadgeLabel>
    </Badge>
  );
}

/** The named team behind the post, when it has a page. */
function TeamBadge({ team }: { team?: { id: string; name: string } | null }) {
  if (!team) return null;
  return (
    <Badge variant="outline" size="label" className="max-w-40">
      <BadgeLabel>{team.name.toUpperCase()}</BadgeLabel>
    </Badge>
  );
}

/**
 * "You match 3/5" — the viewer's skills against the post's stack. Only
 * meaningful once there's something to match, so a zero-overlap post
 * stays quiet rather than advertising the mismatch.
 */
function MatchBadge({ overlap }: { overlap?: { matched: string[]; total: number } | null }) {
  if (!overlap || overlap.total === 0 || overlap.matched.length === 0) return null;
  return (
    <Badge variant="outline" size="label" className="border-success/50 text-success">
      {overlap.matched.length}/{overlap.total} MATCH
    </Badge>
  );
}

/** Dotted placeholder for posts with no art. */
function DotField() {
  return (
    <span
      aria-hidden
      className="block h-full w-full"
      style={{
        backgroundImage:
          "radial-gradient(circle, var(--color-muted-foreground) 1px, transparent 1px)",
        backgroundSize: "7px 7px",
        opacity: 0.3,
      }}
    />
  );
}

function CardThumb({ url }: { url: string | null }) {
  return (
    <span className="relative block h-14 w-14 shrink-0 overflow-hidden rounded border border-muted/40 bg-muted/30">
      {url ? (
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <DotField />
      )}
    </span>
  );
}
