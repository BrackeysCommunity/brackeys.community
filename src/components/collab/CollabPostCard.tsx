import {
  ArrowRight01Icon,
  Edit02Icon,
  PinLocation02Icon,
  Sent02Icon,
  StarIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { cn } from "@/lib/utils";

interface CollabPostCardPost {
  id: number;
  type: string;
  title: string;
  status: string;
  featuredAt: string | Date | null;
  createdAt: string | Date | null;
  authorId: string;
  isIndividual?: boolean | null;
  compensationType?: string | null;
  compensation?: string | null;
  teamSize?: string | null;
  primaryImageUrl?: string | null;
}

interface CollabPostCardProps {
  post: CollabPostCardPost;
  /** Currently authenticated user's id. When equal to `post.authorId`,
   * the card switches to the owner layout (pinned ribbon, EDIT button). */
  currentUserId?: string | null;
  /** Open the post detail popover. */
  onOpen: (postId: number) => void;
  /** Optional explicit "respond" handler — defaults to `onOpen`. */
  onRespond?: (postId: number) => void;
  /** Optional explicit "edit" handler — defaults to `onOpen`. */
  onEdit?: (postId: number) => void;
  /** Pinned to the top because the viewer owns it. Drives the ribbon. */
  pinned?: boolean;
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

function timeAgo(date: string | Date | null): string {
  if (!date) return "";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Compact post card — built on `Well`, with a square primary image on
 * the left, the headline + tags + meta middle column, and a stack of
 * actions (`VIEW`, `RESPOND`, `EDIT`) on the right. `motion` wrapper
 * carries the shared `layoutId` that the post popover animates from.
 */
export function CollabPostCard({
  post,
  currentUserId,
  onOpen,
  onRespond,
  onEdit,
  pinned,
}: CollabPostCardProps) {
  const isOwner = !!currentUserId && currentUserId === post.authorId;
  const isClosed = post.status === "party_full";
  const layoutId = `collab-post-${post.id}`;

  return (
    <motion.div layoutId={layoutId} layout="position" className={cn(isClosed && "opacity-60")}>
      <Well
        className={cn(
          "gap-0 overflow-hidden p-0",
          pinned && "border-warning/40",
          post.featuredAt && "border-primary/40",
        )}
      >
        {pinned ? <OwnerRibbon /> : null}
        <div className="flex gap-3 p-3">
          <PostThumb url={post.primaryImageUrl ?? null} alt={post.title} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <Text
                as="span"
                monospace
                bold
                size="md"
                className="line-clamp-1 tracking-wider text-foreground uppercase"
              >
                {post.title}
              </Text>
              {post.featuredAt ? (
                <Badge
                  variant="warning"
                  className="shrink-0 gap-1 font-mono text-[10px] tracking-widest uppercase"
                >
                  <HugeiconsIcon icon={StarIcon} size={10} />
                  FEATURED
                </Badge>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-1">
              <Badge
                variant="secondary"
                className="font-mono text-[10px] tracking-widest uppercase"
              >
                {TYPE_LABELS[post.type] ?? post.type}
              </Badge>
              {post.isIndividual ? (
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] tracking-widest uppercase"
                >
                  Individual
                </Badge>
              ) : null}
              {post.compensationType ? (
                <Badge
                  variant="success"
                  className="font-mono text-[10px] tracking-widest uppercase"
                >
                  {COMP_TYPE_LABELS[post.compensationType] ?? post.compensationType}
                </Badge>
              ) : null}
              {isClosed ? (
                <Badge
                  variant="destructive"
                  className="font-mono text-[10px] tracking-widest uppercase"
                >
                  Closed
                </Badge>
              ) : null}
            </div>

            <Text monospace size="xs" variant="muted" className="tracking-widest">
              {post.teamSize ? `${post.teamSize.toUpperCase()} · ` : ""}
              {timeAgo(post.createdAt)}
            </Text>
          </div>

          <div className="flex shrink-0 flex-col gap-1.5">
            <Button
              variant="default"
              size="sm"
              onClick={() => onOpen(post.id)}
              className="font-mono tracking-widest"
            >
              VIEW
              <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
            </Button>
            {isOwner ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => (onEdit ?? onOpen)(post.id)}
                className="font-mono tracking-widest"
              >
                <HugeiconsIcon icon={Edit02Icon} size={12} />
                EDIT
              </Button>
            ) : !isClosed ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => (onRespond ?? onOpen)(post.id)}
                className="font-mono tracking-widest"
              >
                <HugeiconsIcon icon={Sent02Icon} size={12} />
                RESPOND
              </Button>
            ) : null}
          </div>
        </div>
      </Well>
    </motion.div>
  );
}

function OwnerRibbon() {
  return (
    <div className="flex items-center gap-1.5 border-b border-warning/30 bg-warning/10 px-3 py-1.5">
      <HugeiconsIcon icon={PinLocation02Icon} size={11} className="text-warning" />
      <Text monospace size="xs" className="tracking-widest text-warning uppercase">
        Pinned · your post
      </Text>
    </div>
  );
}

function PostThumb({ url, alt }: { url: string | null; alt: string }) {
  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden border border-muted/40 bg-muted/30">
      {url ? (
        <img src={url} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div
          aria-hidden
          className="h-full w-full"
          style={{
            backgroundImage:
              "radial-gradient(circle, var(--color-muted-foreground) 1px, transparent 1px)",
            backgroundSize: "8px 8px",
            opacity: 0.3,
          }}
        />
      )}
    </div>
  );
}

// ── User card (people listing) ─────────────────────────────────────────────

interface CollabUserCardProps {
  user: {
    id: string;
    discordUsername: string | null;
    avatarUrl: string | null;
    tagline: string | null;
    availability: string | null;
    rateType: string | null;
    rateMin: number | null;
    rateMax: number | null;
    updatedAt: Date | string;
  };
  skills?: { skillId: number; name: string }[];
}

const AVAILABILITY_LABELS: Record<string, string> = {
  full_time: "FULL-TIME",
  part_time: "PART-TIME",
  limited: "LIMITED",
};

const RATE_TYPE_LABELS: Record<string, string> = {
  hourly: "HOURLY",
  fixed: "FIXED",
  negotiable: "NEGOTIABLE",
};

function formatUserRate(
  rateType: string | null,
  rateMin: number | null,
  rateMax: number | null,
): string {
  if (!rateType || rateType === "negotiable") return rateType === "negotiable" ? "Negotiable" : "";
  const fmt = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : `$${n}`;
  if (rateMin != null && rateMax != null) {
    const suffix = rateType === "hourly" ? " /hr" : "";
    return `${fmt(rateMin)} - ${fmt(rateMax)}${suffix}`;
  }
  if (rateMin != null) {
    const suffix = rateType === "hourly" ? " /hr" : "";
    return `${fmt(rateMin)}+${suffix}`;
  }
  return "";
}

export function CollabUserCard({ user, skills }: CollabUserCardProps) {
  return (
    <Well className="p-0">
      <Link
        to="/profile/$userId"
        params={{ userId: user.id }}
        className="flex items-center gap-3 p-3 transition-colors hover:bg-muted/10"
      >
        <div className="h-9 w-9 shrink-0 overflow-hidden border border-muted/40 bg-muted/30">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Text
            as="span"
            monospace
            bold
            size="sm"
            className="line-clamp-1 tracking-wider text-foreground uppercase"
          >
            {user.tagline || user.discordUsername || "Unknown"}
          </Text>
          <div className="flex flex-wrap gap-1">
            <Badge variant="secondary" className="font-mono text-[10px] tracking-widest uppercase">
              Available
            </Badge>
            {user.availability ? (
              <Badge variant="outline" className="font-mono text-[10px] tracking-widest uppercase">
                {AVAILABILITY_LABELS[user.availability] ?? user.availability}
              </Badge>
            ) : null}
            {user.rateType ? (
              <Badge
                variant={user.rateType === "negotiable" ? "warning" : "success"}
                className="font-mono text-[10px] tracking-widest uppercase"
              >
                {RATE_TYPE_LABELS[user.rateType] ?? user.rateType}
              </Badge>
            ) : null}
            {(skills ?? []).slice(0, 2).map((skill) => (
              <Badge
                key={skill.skillId}
                variant="outline"
                className="font-mono text-[10px] tracking-widest uppercase"
              >
                {skill.name}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <Text monospace size="xs" variant="muted" className="tracking-widest">
            {formatUserRate(user.rateType, user.rateMin, user.rateMax) || "—"}
          </Text>
          <Text monospace size="xs" variant="muted" className="tracking-widest">
            {timeAgo(user.updatedAt)}
          </Text>
        </div>
      </Link>
    </Well>
  );
}
