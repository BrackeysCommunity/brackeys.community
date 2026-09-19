import {
  Calendar03Icon,
  ComputerTerminal01Icon,
  UserGroupIcon,
  UserMultiple02Icon,
  UserSearch01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { useBoardStats } from "@/components/home/use-board-stats";
import { PROTOCOL_COUNT } from "@/data/commands";
import { client } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

export interface HomeDestination {
  /** Route to navigate to. Plain strings — all of them are static paths. */
  to: "/collab" | "/jams" | "/command-center" | "/teams" | "/members";
  icon: IconSvgElement;
  /** The destination, in the rail's voice. */
  title: string;
  /** What the number underneath it counts. */
  statLabel: string;
  /** The mobile chip has room for one line, not the rail's two, so it names
      the number rather than the destination — the icon does that job. */
  chipLabel: string;
  /** Already rendered — `—` while its query is in flight. */
  stat: string;
}

function useMemberStats() {
  const { data, isLoading } = useQuery({
    queryKey: ["member-stats"],
    queryFn: () => client.getMemberStats({}),
    staleTime: STALE.listing,
  });

  return { total: data?.total ?? 0, isLoading };
}

function useTeamStats() {
  const { data, isLoading } = useQuery({
    queryKey: ["team-stats"],
    queryFn: () => client.getTeamStats({}),
    staleTime: STALE.listing,
  });

  return { recruiting: data?.recruiting ?? 0, isLoading };
}

/**
 * The destinations the landing page offers, and the live number that makes
 * each worth a tap.
 *
 * One list for both layouts. The desktop rail and the mobile chip row used
 * to name their own tiles and pick their own stats, which is how the phone
 * ended up advertising a theme picker while the desktop advertised a
 * profile — same visitor, same page, two different claims about what this
 * site is for. Layout is the only thing the two are allowed to disagree on.
 */
export function useHomeDestinations(liveCount: number, isLoadingJams: boolean): HomeDestination[] {
  const { openRoles, isLoading: isLoadingRoles } = useBoardStats();
  const { recruiting, isLoading: isLoadingTeams } = useTeamStats();
  const { total: memberCount, isLoading: isLoadingMembers } = useMemberStats();

  return [
    {
      to: "/collab",
      icon: UserGroupIcon,
      title: "COLLAB BOARD",
      statLabel: "Open roles",
      chipLabel: "OPEN ROLES",
      stat: isLoadingRoles ? "—" : String(openRoles),
    },
    {
      to: "/jams",
      icon: Calendar03Icon,
      title: "JAM BOARD",
      statLabel: isLoadingJams ? "Live jams" : "Live now",
      chipLabel: "LIVE JAMS",
      stat: isLoadingJams ? "—" : String(liveCount),
    },
    {
      to: "/command-center",
      icon: ComputerTerminal01Icon,
      title: "COMMAND CENTER",
      statLabel: "Bot Protocols",
      chipLabel: "BOT PROTOCOLS",
      stat: String(PROTOCOL_COUNT),
    },
    {
      to: "/members",
      icon: UserSearch01Icon,
      title: "MEMBERS",
      statLabel: "Profiles",
      chipLabel: "MEMBERS",
      stat: isLoadingMembers ? "—" : String(memberCount),
    },
    {
      to: "/teams",
      icon: UserMultiple02Icon,
      title: "TEAMS",
      statLabel: "Recruiting",
      chipLabel: "TEAMS HIRING",
      stat: isLoadingTeams ? "—" : String(recruiting),
    },
  ];
}
