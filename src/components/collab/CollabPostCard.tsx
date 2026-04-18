import { Link } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

interface CollabPostCardProps {
  post: {
    id: number;
    type: string;
    title: string;
    status: string;
    featuredAt: string | Date | null;
    createdAt: string | Date | null;
    authorId: string;
    isIndividual?: boolean | null;
    compensationType?: string | null;
    teamSize?: string | null;
  };
  responseCount?: number;
  roles?: { id: number; name: string }[];
}

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

const TYPE_COLORS: Record<string, string> = {
  paid: "bg-green-500/15 border-green-500/40 text-green-500",
  hobby: "bg-blue-500/15 border-blue-500/40 text-blue-500",
  playtest: "bg-purple-500/15 border-purple-500/40 text-purple-500",
  mentor: "bg-brackeys-yellow/15 border-brackeys-yellow/40 text-brackeys-yellow",
};

const COMP_TYPE_COLORS: Record<string, string> = {
  hourly: "bg-green-500/15 border-green-500/40 text-green-500",
  fixed: "bg-green-500/15 border-green-500/40 text-green-500",
  rev_share: "bg-green-500/15 border-green-500/40 text-green-500",
  negotiable: "bg-brackeys-yellow/15 border-brackeys-yellow/40 text-brackeys-yellow",
};

const COMP_TYPE_LABELS: Record<string, string> = {
  hourly: "HOURLY",
  fixed: "FIXED",
  rev_share: "REV SHARE",
  negotiable: "NEGOTIABLE",
};

export function CollabPostCard({ post, responseCount, roles }: CollabPostCardProps) {
  const isFeatured = !!post.featuredAt;
  const isClosed = post.status === "party_full";

  return (
    <Link
      to="/collab/$postId"
      params={{ postId: String(post.id) }}
      className={cn(
        "block space-y-2 border bg-muted/30 p-3 transition-all hover:bg-muted/40",
        isFeatured ? "border-brackeys-yellow/60" : "border-muted",
        isClosed && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-1 font-mono text-xs font-bold tracking-wider text-foreground uppercase">
          {post.title}
        </span>
        {isFeatured && (
          <span className="shrink-0 font-mono text-[10px] tracking-widest text-brackeys-yellow uppercase">
            FEATURED
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        <span
          className={cn(
            "inline-block border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase",
            TYPE_COLORS[post.type] ?? "border-muted/50 bg-muted/30 text-muted-foreground",
          )}
        >
          {post.type}
        </span>
        {post.isIndividual && (
          <span className="inline-block border border-primary/40 bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-primary uppercase">
            INDIVIDUAL
          </span>
        )}
        {post.compensationType && (
          <span
            className={cn(
              "inline-block border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase",
              COMP_TYPE_COLORS[post.compensationType] ??
                "border-muted/50 bg-muted/30 text-muted-foreground",
            )}
          >
            {COMP_TYPE_LABELS[post.compensationType] ?? post.compensationType}
          </span>
        )}
        {isClosed && (
          <span className="inline-block border border-destructive/40 bg-destructive/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-destructive uppercase">
            CLOSED
          </span>
        )}
      </div>

      {roles && roles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {roles.slice(0, 3).map((role) => (
            <span
              key={role.id}
              className="inline-block border border-primary/40 bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-primary uppercase"
            >
              {role.name}
            </span>
          ))}
          {roles.length > 3 && (
            <span className="font-mono text-[10px] text-muted-foreground">+{roles.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-muted-foreground">
          {post.teamSize && <>{post.teamSize.toUpperCase()} DEVS &middot; </>}
          {timeAgo(post.createdAt)}
        </span>
        {responseCount !== undefined && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {responseCount} {responseCount === 1 ? "response" : "responses"}
          </span>
        )}
      </div>
    </Link>
  );
}

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
    <Link
      to="/profile/$userId"
      params={{ userId: user.id }}
      className="block space-y-2 border border-muted bg-muted/30 p-3 transition-all hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="h-6 w-6 shrink-0 rounded-full border border-muted/30"
            />
          ) : (
            <div className="h-6 w-6 shrink-0 rounded-full border border-muted/30 bg-muted/30" />
          )}
          <span className="line-clamp-1 font-mono text-xs font-bold tracking-wider text-foreground uppercase">
            {user.tagline || user.discordUsername || "Unknown"}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        <span className="inline-block border border-cyan-500/40 bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-cyan-500 uppercase">
          AVAILABLE
        </span>
        {user.availability && (
          <span className="inline-block border border-muted/50 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            {AVAILABILITY_LABELS[user.availability] ?? user.availability}
          </span>
        )}
        {user.rateType && (
          <span
            className={cn(
              "inline-block border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase",
              user.rateType === "negotiable"
                ? "border-brackeys-yellow/40 bg-brackeys-yellow/15 text-brackeys-yellow"
                : "border-green-500/40 bg-green-500/15 text-green-500",
            )}
          >
            {RATE_TYPE_LABELS[user.rateType] ?? user.rateType}
          </span>
        )}
      </div>

      {skills && skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skills.slice(0, 3).map((skill) => (
            <span
              key={skill.skillId}
              className="inline-block border border-primary/40 bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-primary uppercase"
            >
              {skill.name}
            </span>
          ))}
          {skills.length > 3 && (
            <span className="font-mono text-[10px] text-muted-foreground">
              +{skills.length - 3}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatUserRate(user.rateType, user.rateMin, user.rateMax)}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {timeAgo(user.updatedAt)}
        </span>
      </div>
    </Link>
  );
}
