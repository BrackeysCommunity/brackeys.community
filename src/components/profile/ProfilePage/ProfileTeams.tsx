import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { orpc } from "@/orpc/client";

import { ProfileSectionHeader } from "./ProfileSectionHeader";

/**
 * `§N TEAMS` — the active teams this profile belongs to, as chips
 * linking to their pages. Self-fetching and self-effacing: renders
 * nothing at all when the user is on no team, since an empty "teams"
 * section is noise on the majority of profiles.
 */
export function ProfileTeamsSection({ index, profileId }: { index: string; profileId: string }) {
  const { data: teams } = useQuery({
    ...orpc.listUserTeams.queryOptions({ input: { userId: profileId } }),
    staleTime: 60 * 1000,
  });

  if (!teams || teams.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <ProfileSectionHeader index={index} title="TEAMS" />
      <Well className="gap-2 p-3">
        {teams.map((team) => (
          <Link
            key={team.id}
            to="/teams/$teamId"
            params={{ teamId: team.slug || team.id }}
            className="flex items-center gap-2.5 border border-muted/40 bg-background p-2 transition-colors hover:border-primary/50 hover:bg-muted/10 dark:bg-emboss-surface"
          >
            <UserAvatar avatarUrl={team.avatarUrl} username={team.name} size={24} />
            <Text as="span" size="sm" ellipsis className="min-w-0 flex-1">
              {team.name}
            </Text>
            {team.role === "owner" ? <MicroLabel>OWNER</MicroLabel> : null}
          </Link>
        ))}
      </Well>
    </section>
  );
}
