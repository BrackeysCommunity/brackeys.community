import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";

import { profileLinkParams, timeAgo } from "./format";

interface CollabUserCardProps {
  user: {
    id: string;
    urlStub?: string | null;
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
  const suffix = rateType === "hourly" ? " /hr" : "";
  if (rateMin != null && rateMax != null) return `${fmt(rateMin)} - ${fmt(rateMax)}${suffix}`;
  if (rateMin != null) return `${fmt(rateMin)}+${suffix}`;
  return "";
}

export function CollabUserCard({ user, skills }: CollabUserCardProps) {
  const rate = formatUserRate(user.rateType, user.rateMin, user.rateMax);

  return (
    <Well className="overflow-hidden p-0">
      <Link
        to="/profile/$userId"
        params={profileLinkParams(user)}
        className="flex flex-col gap-2 p-3 transition-colors hover:bg-muted/10"
      >
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 shrink-0 overflow-hidden border border-muted/40 bg-muted/30">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <Text as="span" size="sm" bold className="truncate text-foreground">
              {user.discordUsername ?? "Unknown"}
            </Text>
            <Text as="span" size="xs" variant="muted" className="tracking-widest">
              {timeAgo(user.updatedAt)}
            </Text>
          </div>
        </div>

        {user.tagline ? (
          <Text size="sm" variant="muted" className="line-clamp-2">
            {user.tagline}
          </Text>
        ) : null}

        <div className="flex flex-wrap items-center gap-1">
          {user.availability ? (
            <Badge variant="outline" className="font-mono text-[10px] tracking-widest">
              {AVAILABILITY_LABELS[user.availability] ?? user.availability}
            </Badge>
          ) : null}
          {user.rateType ? (
            <Badge
              variant={user.rateType === "negotiable" ? "warning" : "success"}
              className="font-mono text-[10px] tracking-widest"
            >
              {rate || (RATE_TYPE_LABELS[user.rateType] ?? user.rateType)}
            </Badge>
          ) : null}
          {(skills ?? []).slice(0, 3).map((skill) => (
            <Badge
              key={skill.skillId}
              variant="outline"
              className="font-mono text-[10px] tracking-widest uppercase"
            >
              {skill.name}
            </Badge>
          ))}
        </div>
      </Link>
    </Well>
  );
}
