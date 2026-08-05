import {
  Calendar03Icon,
  ComputerTerminal01Icon,
  IdentityCardIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";

import { useBoardStats } from "@/components/home/use-board-stats";
import { Chonk } from "@/components/ui/chonk";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { PROTOCOL_COUNT } from "@/data/commands";
import { activeUserStore } from "@/lib/active-user-store";
import { authStore } from "@/lib/auth-store";
import { profileLinkParams } from "@/lib/profile-links";

interface FeatureRailProps {
  liveCount: number;
  upcomingCount: number;
  isLoadingJams: boolean;
}

/**
 * The four destinations, compressed to one quiet row.
 *
 * These used to be 280px-tall cards with hover-revealed sparklines sitting
 * directly under the wordmark — they read as the page's main content and
 * pushed the jam below the fold. Reduced to a single line each they still
 * do their job (a labelled way into every section) without competing with
 * the hero.
 *
 * Every stat here is live. The old cards showed `312`, `50+`, `58` and
 * `LV 14`, all hard-coded and all wrong by the time anyone read them.
 */
export function FeatureRail({ liveCount, upcomingCount, isLoadingJams }: FeatureRailProps) {
  const { openRoles, isLoading: isLoadingStats } = useBoardStats();

  const session = useStore(authStore, (s) => s.session);
  const profile = useStore(activeUserStore, (s) => s.profile);
  const user = session?.user;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <FeatureTile
        link={<Link to="/collab" />}
        icon={UserGroupIcon}
        title="COLLAB BOARD"
        stat={isLoadingStats ? "—" : String(openRoles)}
        statLabel="Open roles"
      />
      <FeatureTile
        link={<Link to="/jams" />}
        icon={Calendar03Icon}
        title="JAM CALENDAR"
        stat={isLoadingJams ? "—" : String(liveCount)}
        statLabel={isLoadingJams ? "Live jams" : `Live · ${upcomingCount} soon`}
      />
      <FeatureTile
        link={<Link to="/command-center" />}
        icon={ComputerTerminal01Icon}
        title="COMMAND CENTER"
        stat={String(PROTOCOL_COUNT)}
        statLabel="Protocols"
      />
      {user ? (
        <FeatureTile
          link={
            <Link
              to="/profile/$userId"
              params={profileLinkParams({ id: user.id, urlStub: profile?.urlStub })}
            />
          }
          icon={IdentityCardIcon}
          title="DEV PROFILE"
          stat={profile?.guildNickname ?? profile?.discordUsername ?? user.name ?? "YOU"}
          statLabel="Signed in"
          avatarUrl={profile?.avatarUrl ?? user.image}
        />
      ) : (
        <FeatureTile
          link={<Link to="/profile" />}
          icon={IdentityCardIcon}
          title="DEV PROFILE"
          stat="CLAIM"
          statLabel="Your profile"
        />
      )}
    </div>
  );
}

interface FeatureTileProps {
  /** The destination, as an element rather than a `to` string: the profile
   * tile takes route params, and passing those through a prop erases
   * TanStack's per-route type inference. */
  link: React.ReactElement;
  icon: IconSvgElement;
  title: string;
  stat: string;
  statLabel: string;
  /** Replaces the icon for the signed-in profile tile. */
  avatarUrl?: string | null;
}

function FeatureTile({ link, icon, title, stat, statLabel, avatarUrl }: FeatureTileProps) {
  return (
    <Chonk
      variant="surface"
      size="sm"
      render={link}
      aria-label={title}
      data-magnetic
      data-cursor-no-drift
      className="group/tile flex min-w-0 items-center gap-3 px-3 py-2.5"
    >
      {avatarUrl !== undefined ? (
        <UserAvatar avatarUrl={avatarUrl} username={stat} size={24} />
      ) : (
        <HugeiconsIcon
          icon={icon}
          size={18}
          className="shrink-0 text-muted-foreground transition-colors group-hover/tile:text-accent"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <MicroLabel as="div" className="transition-colors group-hover/tile:text-accent">
          {title}
        </MicroLabel>
        <Text as="div" size="sm" variant="muted" ellipsis density="compressed">
          {statLabel}
        </Text>
      </div>
      <Text bold ellipsis density="dense" className="max-w-28 text-lg text-accent tabular-nums">
        {stat}
      </Text>
    </Chonk>
  );
}
