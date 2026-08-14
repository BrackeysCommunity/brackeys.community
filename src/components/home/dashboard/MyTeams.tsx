import { Link as RouterLink } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Section, SectionAction } from "@/components/ui/section";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { timeAgo } from "@/lib/format-time";
import { teamLinkParams } from "@/lib/team-links";

import type { HomeDashboardData } from "./use-home-dashboard";

/**
 * The viewer's crews, with the one fact the team pages themselves can't
 * volunteer in time: an `archiveWarnedAt` stamp means the lifecycle sweep has
 * scheduled this team for archiving, and until now that warning existed only
 * as a notification that scrolls away.
 */
export function MyTeams({ teams }: { teams: HomeDashboardData["teams"] }) {
  if (teams.length === 0) return null;

  return (
    <Section
      title="YOUR TEAMS"
      size="sm"
      blurb="Crews you're on."
      action={<SectionAction to="/teams">ALL TEAMS</SectionAction>}
    >
      <Well className="overflow-hidden">
        <ul className="divide-y divide-muted/20">
          {teams.map((team) => (
            <li key={team.id}>
              <RouterLink
                to="/teams/$teamId"
                params={teamLinkParams(team)}
                className="group flex items-center gap-3 px-3 py-2.5 text-inherit transition-colors hover:bg-muted/40"
              >
                <UserAvatar avatarUrl={team.avatarUrl} username={team.name} size={28} />
                <div className="min-w-0 flex-1">
                  <Text as="div" bold ellipsis size="md" className="group-hover:text-primary">
                    {team.name}
                  </Text>
                  <MicroLabel as="div" ellipsis>
                    {team.memberCount} MEMBER{team.memberCount === 1 ? "" : "S"}
                    {team.openPostCount > 0 ? ` · ${team.openPostCount} OPEN POST` : ""}
                    {team.openPostCount > 1 ? "S" : ""}
                  </MicroLabel>
                </div>
                {team.archiveWarnedAt ? (
                  <Badge variant="warning" size="label" className="shrink-0">
                    GOING QUIET
                  </Badge>
                ) : null}
                <MicroLabel as="div" className="w-16 shrink-0 text-right tabular-nums">
                  {timeAgo(team.lastActivityAt)}
                </MicroLabel>
              </RouterLink>
            </li>
          ))}
        </ul>
      </Well>
    </Section>
  );
}
