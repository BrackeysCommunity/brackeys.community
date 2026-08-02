import { StarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "framer-motion";

import { Badge } from "@/components/ui/badge";
import {
  MediaCardFloatingBadge,
  MediaCardImage,
  MediaCardScrim,
  MediaCardSelectedTint,
  mediaCardClasses,
} from "@/components/ui/media-card";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { cn } from "@/lib/utils";

import { timeAgo } from "./format";

interface CollabPostCardPost {
  id: number;
  type: string;
  title: string;
  status: string;
  featuredAt: string | Date | null;
  createdAt: string | Date | null;
  authorId: string;
  compensationType?: string | null;
  teamSize?: string | null;
  primaryImageUrl?: string | null;
}

interface CollabPostCardProps {
  post: CollabPostCardPost;
  /** Highlighted because it's the post loaded in the inspector. */
  selected: boolean;
  /** Hoisted to the top because the viewer owns it. */
  pinned?: boolean;
  onSelect: (postId: number) => void;
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
 * A post as a card in the list lane: square cover thumbnail, title,
 * badges, meta. The thumbnail is square rather than a full-bleed banner
 * because post art is user-uploaded and tends to be small and roughly
 * square — cropping that to a wide strip upscales it into mush.
 *
 * Carries no action buttons: the inspector owns everything you can do
 * to a post, leaving the card free to be scannable at ~320px.
 */
export function CollabPostCard({ post, selected, pinned, onSelect }: CollabPostCardProps) {
  const isClosed = post.status === "party_full";

  return (
    <motion.div layout="position">
      <Well
        className={cn(
          "overflow-hidden p-0 transition-colors",
          isClosed && !selected && "opacity-60",
          selected ? "border-primary ring-1 ring-primary/40" : "hover:bg-muted/10",
        )}
      >
        {selected ? <MediaCardSelectedTint /> : null}
        <button
          type="button"
          onClick={() => onSelect(post.id)}
          aria-current={selected ? "true" : undefined}
          aria-label={`${post.title} — ${TYPE_LABELS[post.type] ?? post.type}`}
          className="flex w-full gap-3 p-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <CardThumb url={post.primaryImageUrl ?? null} />

          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="flex items-start gap-2">
              <Text
                as="span"
                monospace
                bold
                size="sm"
                className="line-clamp-2 flex-1 tracking-wider text-foreground uppercase"
              >
                {post.title}
              </Text>
              {pinned ? (
                <Text
                  as="span"
                  monospace
                  size="xs"
                  className="mt-0.5 shrink-0 tracking-widest text-warning uppercase"
                >
                  yours
                </Text>
              ) : null}
            </span>

            <span className="flex flex-wrap items-center gap-1">
              {post.featuredAt ? (
                <Badge variant="warning" className="gap-1 font-mono text-[10px] tracking-widest">
                  <HugeiconsIcon icon={StarIcon} size={10} />
                  FEATURED
                </Badge>
              ) : null}
              <Badge variant="secondary" className="font-mono text-[10px] tracking-widest">
                {TYPE_LABELS[post.type] ?? post.type}
              </Badge>
              {post.compensationType ? (
                <Badge variant="success" className="font-mono text-[10px] tracking-widest">
                  {COMP_TYPE_LABELS[post.compensationType] ?? post.compensationType}
                </Badge>
              ) : null}
              {isClosed ? (
                <Badge variant="destructive" className="font-mono text-[10px] tracking-widest">
                  CLOSED
                </Badge>
              ) : null}
            </span>

            <Text
              as="span"
              monospace
              size="xs"
              variant="muted"
              className="tracking-widest tabular-nums"
            >
              {post.teamSize ? `${post.teamSize.toUpperCase()} · ` : ""}
              {timeAgo(post.createdAt)}
            </Text>
          </span>
        </button>
      </Well>
    </motion.div>
  );
}

/**
 * The same post as a banner-led tile for the card layout, built on the
 * jam board's shared card shell so the two boards stay visually in
 * step. Post art is shown whole against a blurred copy of itself rather
 * than cropped to the banner's aspect.
 */
export function CollabPostGridCard({ post, selected, pinned, onSelect }: CollabPostCardProps) {
  const isClosed = post.status === "party_full";

  return (
    <motion.div layout="position" className="h-full">
      <button
        type="button"
        onClick={() => onSelect(post.id)}
        aria-current={selected ? "true" : undefined}
        aria-label={`${post.title} — ${TYPE_LABELS[post.type] ?? post.type}`}
        className={cn(
          mediaCardClasses.frame,
          "h-full w-full cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring",
          isClosed && !selected && "opacity-60",
          selected && "border-primary ring-1 ring-primary/40",
        )}
      >
        {selected ? <MediaCardSelectedTint /> : null}
        <div className={cn(mediaCardClasses.media, "bg-muted/20")}>
          {post.primaryImageUrl ? <MediaCardImage src={post.primaryImageUrl} /> : <DotField />}
          <MediaCardScrim />
          <MediaCardFloatingBadge>
            <Text
              as="span"
              monospace
              size="xs"
              className="tracking-widest text-foreground uppercase"
            >
              {TYPE_LABELS[post.type] ?? post.type}
            </Text>
          </MediaCardFloatingBadge>
        </div>

        <div className={mediaCardClasses.body}>
          <span className="flex items-start gap-2">
            <Text
              as="span"
              monospace
              bold
              size="sm"
              className="line-clamp-2 flex-1 tracking-wider text-foreground uppercase"
            >
              {post.title}
            </Text>
            {pinned ? (
              <Text
                as="span"
                monospace
                size="xs"
                className="mt-0.5 shrink-0 tracking-widest text-warning uppercase"
              >
                yours
              </Text>
            ) : null}
          </span>

          <span className="flex flex-wrap items-center gap-1">
            {post.featuredAt ? (
              <Badge variant="warning" className="gap-1 font-mono text-[10px] tracking-widest">
                <HugeiconsIcon icon={StarIcon} size={10} />
                FEATURED
              </Badge>
            ) : null}
            {post.compensationType ? (
              <Badge variant="success" className="font-mono text-[10px] tracking-widest">
                {COMP_TYPE_LABELS[post.compensationType] ?? post.compensationType}
              </Badge>
            ) : null}
            {isClosed ? (
              <Badge variant="destructive" className="font-mono text-[10px] tracking-widest">
                CLOSED
              </Badge>
            ) : null}
          </span>

          <Text
            as="span"
            monospace
            size="xs"
            variant="muted"
            className="mt-auto pt-1.5 tracking-widest tabular-nums"
          >
            {post.teamSize ? `${post.teamSize.toUpperCase()} · ` : ""}
            {timeAgo(post.createdAt)}
          </Text>
        </div>
      </button>
    </motion.div>
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
    <span className="relative block h-16 w-16 shrink-0 overflow-hidden border border-muted/40 bg-muted/30">
      {url ? (
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <DotField />
      )}
    </span>
  );
}
