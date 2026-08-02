import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { formatRate } from "@/lib/format-rate";
import { timeAgo } from "@/lib/format-time";
import { profileLinkParams } from "@/lib/profile-links";

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
    lookingFor: string | null;
    collabPreference: string | null;
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

const PREFERENCE_LABELS: Record<string, string> = {
  paid: "PAID",
  hobby: "HOBBY",
  either: "PAID OR HOBBY",
};

export function CollabUserCard({ user, skills }: CollabUserCardProps) {
  const rate = formatRate(user.rateType, user.rateMin, user.rateMax, {
    negotiableLabel: "Negotiable",
  });

  return (
    <Well className="overflow-hidden p-0">
      <Link
        to="/profile/$userId"
        params={profileLinkParams(user)}
        className="flex flex-col gap-2 p-3 transition-colors hover:bg-muted/10"
      >
        <div className="flex items-center gap-2.5">
          <UserAvatar avatarUrl={user.avatarUrl} username={user.discordUsername} size={36} />
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

        {/* What this person is actually after — the line an "I'm
            available" post would have carried, kept on the profile so it
            can't go stale behind their back. */}
        {user.lookingFor ? (
          <Text size="xs" className="line-clamp-2 text-foreground/80 italic">
            “{user.lookingFor}”
          </Text>
        ) : null}

        <div className="flex flex-wrap items-center gap-1">
          {user.availability ? (
            <Badge variant="outline" size="label">
              {AVAILABILITY_LABELS[user.availability] ?? user.availability}
            </Badge>
          ) : null}
          {user.collabPreference ? (
            <Badge variant="secondary" size="label">
              {PREFERENCE_LABELS[user.collabPreference] ?? user.collabPreference}
            </Badge>
          ) : null}
          {user.rateType ? (
            <Badge variant={user.rateType === "negotiable" ? "warning" : "success"} size="label">
              {rate || (RATE_TYPE_LABELS[user.rateType] ?? user.rateType)}
            </Badge>
          ) : null}
          {(skills ?? []).slice(0, 3).map((skill) => (
            <Badge key={skill.skillId} variant="outline" size="label" className="uppercase">
              {skill.name}
            </Badge>
          ))}
        </div>
      </Link>
    </Well>
  );
}
