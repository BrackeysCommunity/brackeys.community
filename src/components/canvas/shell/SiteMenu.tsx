import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  Calendar03Icon,
  Comment01Icon,
  DashboardSquare02Icon,
  Files01Icon,
  Home01Icon,
  Login01Icon,
  Notification03Icon,
  Settings02Icon,
  UserGroupIcon,
  UserIcon,
  UserMultiple02Icon,
  UserSearch01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import type { ReactElement } from "react";

import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { activeUserStore } from "@/lib/active-user-store";
import { authClient, signInWithDiscord } from "@/lib/auth-client";
import type { SigninSource } from "@/lib/event-taxonomy";
import { useFlag } from "@/lib/hooks/use-flag";
import { profileLinkParams } from "@/lib/profile-links";
import { orpc } from "@/orpc/client";

import { openWorkspace } from "../workspace-store";
import { WorkspacePanel } from "../WorkspacePanel";

const SECTIONS = [
  { to: "/jams", label: "Jams", icon: Calendar03Icon },
  { to: "/collab", label: "Collab", icon: UserGroupIcon },
  { to: "/teams", label: "Teams", icon: UserMultiple02Icon },
  { to: "/members", label: "Members", icon: UserSearch01Icon },
] as const;

/**
 * Everything the site header gave, behind the logo, for pages that take over
 * the window: the way back, the site sections, notifications and your
 * profile. With `workspace` it also offers the canvas workspace and mounts
 * its panel, which the header would otherwise own.
 */
export type SiteMenuProps = {
  /** The first item: where this page came from, as a `Link` element. */
  back?: { label: string; link: ReactElement };
  signinSource: SigninSource;
  workspace?: boolean;
  /** The game editor's host: opens its Project settings panel. */
  onProjectSettings?: () => void;
  /** Runs in place of signing in straight away, for a page that asks first. */
  onSignIn?: () => void;
};

export function SiteMenu({
  back,
  signinSource,
  workspace = false,
  onProjectSettings,
  onSignIn,
}: SiteMenuProps) {
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const forumOn = useFlag("forum-enabled");
  const urlStub = useStore(activeUserStore, (s) => s.profile?.urlStub);
  const unread = useQuery({
    ...orpc.unreadCount.queryOptions({ input: {} }),
    enabled: user != null,
    refetchInterval: 30_000,
  });
  const unreadCount = unread.data?.count ?? 0;

  return (
    <>
      {user && workspace ? <WorkspacePanel /> : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={
            unreadCount > 0 ? `Site menu, ${unreadCount} unread notifications` : "Site menu"
          }
          render={
            <Button
              variant="ghost"
              size="sm"
              className="relative gap-1 px-1.5"
              tooltip="Site menu"
            />
          }
        >
          <BrandMark className="size-5" />
          <HugeiconsIcon icon={ArrowDown01Icon} size={12} className="text-muted-foreground" />
          {unreadCount > 0 ? (
            <span aria-hidden className="absolute top-1 left-5 size-2 rounded-full bg-primary" />
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={8} className="min-w-56">
          {back ? (
            <>
              <DropdownMenuItem render={back.link}>
                <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
                Back to {back.label}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {onProjectSettings ? (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel>Editor</DropdownMenuLabel>
                <DropdownMenuItem onClick={onProjectSettings}>
                  <HugeiconsIcon icon={Settings02Icon} size={14} />
                  Project settings
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Site</DropdownMenuLabel>
            <DropdownMenuItem render={<Link to="/" />}>
              <HugeiconsIcon icon={Home01Icon} size={14} />
              Home
            </DropdownMenuItem>
            {forumOn ? (
              <DropdownMenuItem render={<Link to="/forum" />}>
                <HugeiconsIcon icon={Comment01Icon} size={14} />
                Forum
              </DropdownMenuItem>
            ) : null}
            {SECTIONS.map((section) => (
              <DropdownMenuItem key={section.to} render={<Link to={section.to} />}>
                <HugeiconsIcon icon={section.icon} size={14} />
                {section.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {user ? (
            <>
              {workspace ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Workspace</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => openWorkspace()}>
                      <HugeiconsIcon icon={DashboardSquare02Icon} size={14} />
                      Switch canvas
                    </DropdownMenuItem>
                    <DropdownMenuItem render={<Link to="/canvases" />}>
                      <HugeiconsIcon icon={Files01Icon} size={14} />
                      All canvases
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link to="/notifications" />}>
                <HugeiconsIcon icon={Notification03Icon} size={14} />
                Notifications
                {unreadCount > 0 ? (
                  <Badge size="label" className="ml-auto">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </Badge>
                ) : null}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    to="/profile/$userId"
                    params={profileLinkParams({ id: user.id, urlStub })}
                  />
                }
              >
                <HugeiconsIcon icon={UserIcon} size={14} />
                Your profile
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSignIn ?? (() => void signInWithDiscord(signinSource))}>
                <HugeiconsIcon icon={Login01Icon} size={14} />
                Sign in with Discord
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
