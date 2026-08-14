import {
  Calendar03Icon,
  ComputerTerminal01Icon,
  Home01Icon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

interface NavTabBody {
  icon: IconSvgElement;
  label: string;
  /** Optional avatar image used by the ME tab when the user is
   * signed in — sits in place of the icon at the same size. */
  avatarUrl?: string | null;
  /** Renders a small red dot on the icon corner — used to signal
   * unread notifications on the ME tab. */
  showDot?: boolean;
}

function TabBody({ icon, label, avatarUrl, showDot }: NavTabBody) {
  return (
    <span className="flex flex-col items-center gap-1">
      <span className="relative">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" aria-hidden className="size-6 rounded-full object-cover" />
        ) : (
          <HugeiconsIcon icon={icon} className="size-6" />
        )}
        {showDot && (
          <span
            data-testid="me-tab-unread-dot"
            aria-label="Unread notifications"
            className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary ring-1 ring-background"
          />
        )}
      </span>
      <span className="text-xs font-bold tracking-widest">{label}</span>
    </span>
  );
}

export interface MobileBottomNavProps {
  pathnameOverride?: string;
  inline?: boolean;
}

/**
 * Applied to every tab: segments grow to share the bar's width equally, and
 * neighbors of the depressed key curve down toward it (the parkfi keyboard-row
 * treatment). chonk-emboss lg has the same geometry that made this work there —
 * 3px press depth, 1px border, shelf and border sharing one color — so the
 * curve classes port directly, retargeted from `aria-current` to the toggle
 * group's `aria-pressed`.
 *
 * Top corners: an elliptical radius — 14px sweep, 4px deep — on the side the
 * pressed key shares, so the top edge dives into the key and bottoms out at its
 * top corner. Needs `!` because the group root squares interior corners with a
 * higher-specificity rule. Covers both the routed key (aria-pressed) and a
 * transient finger-down (:active).
 *
 * Bottom corners can't use border-radius (any rounding bows the curve concave
 * and curls the shelf up over the corner). Each segment instead carries two
 * hidden 14×4px body-colored patches over its shelf band (`::after`
 * bottom-right, `::before` bottom-left), clip-pathed to a convex arc mirroring
 * the top curve: flush with the straight bottom edge at the far end, diving to
 * the key's base at the junction. Border and shelf share --emboss-shadow, so
 * the un-clipped remnant of the band tapers into the 1px line that continues
 * as the key's own bottom border. The facing patch fades in when the adjacent
 * key is down.
 */
const SEG =
  // px-1: five equal segments on a 375px screen leave ~70px each — the lg
  // default px-3 would make the widest label (COLLAB) overflow its cell.
  //
  // The transition must be one shorthand replacing chonk-emboss's own
  // (`transition: --chonk-y 75ms`), because a shorthand resets
  // transition-property — a `transition-[...]` utility would be wiped by it,
  // leaving border-radius to snap instead of arcing between segment changes.
  // `!` lets it also beat `.chonk-emboss:active`'s 50ms duration override, so
  // press depth and curve move together at one speed, parkfi's 150ms.
  "flex-1 px-1 [transition:--chonk-y_150ms_ease-out,border-radius_150ms_ease-out,color_150ms_ease-out,background-color_150ms_ease-out,border-color_150ms_ease-out]! " +
  "[&:has(+[aria-pressed=true])]:rounded-tr-[14px_4px]! [[aria-pressed=true]+&]:rounded-tl-[14px_4px]! [&:has(+:active)]:rounded-tr-[14px_4px]! [:active+&]:rounded-tl-[14px_4px]! " +
  "before:pointer-events-none before:absolute before:-bottom-1 before:left-0 before:h-1 before:w-[14px] before:bg-background dark:before:bg-emboss-surface before:[clip-path:path('M14_0_A14_3_0_0_0_0_3_L0_0_Z')] before:opacity-0 before:transition-opacity before:duration-150 before:ease-out before:content-[''] " +
  "after:pointer-events-none after:absolute after:-bottom-1 after:right-0 after:h-1 after:w-[14px] after:bg-background dark:after:bg-emboss-surface after:[clip-path:path('M0_0_A14_3_0_0_1_14_3_L14_0_Z')] after:opacity-0 after:transition-opacity after:duration-150 after:ease-out after:content-[''] " +
  "[&:has(+[aria-pressed=true])]:after:opacity-100 [[aria-pressed=true]+&]:before:opacity-100 [&:has(+:active)]:after:opacity-100 [:active+&]:before:opacity-100";

type TabValue = "home" | "jams" | "collab" | "command" | "me";

/** Extract the `/profile/<param>` segment, or null on any other
 * route (including the bare `/profile` index, which is always the
 * viewer's own profile). */
function profileParamFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/profile\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function MobileBottomNav({ pathnameOverride, inline = false }: MobileBottomNavProps = {}) {
  const routerPathname = useRouterState({ select: (s) => s.location.pathname });
  const pathname = pathnameOverride ?? routerPathname;
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const avatarUrl = session?.user?.image ?? null;

  const unread = useQuery({
    ...orpc.unreadCount.queryOptions({ input: {} }),
    enabled: !!session?.user,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const hasUnread = (unread.data?.count ?? 0) > 0;

  // `/profile/<param>` may be someone else's profile — ME only
  // highlights when the viewed profile is the session user's own.
  // Reuses the profile route's `getProfile` cache entry (same query
  // key), so this doesn't issue a second fetch in practice.
  const profileParam = profileParamFromPath(pathname);
  const viewedProfile = useQuery({
    ...orpc.getProfile.queryOptions({ input: { userId: profileParam ?? "" } }),
    enabled: !!profileParam && profileParam !== "preview",
    staleTime: 60 * 1000,
  });
  const isOwnProfile =
    !profileParam ||
    profileParam === "preview" ||
    profileParam === session?.user?.id ||
    // The param is a vanity stub as often as an id, so fall back to the
    // resolved profile rather than comparing against the URL.
    (viewedProfile.data?.profile.id != null && viewedProfile.data.profile.id === session?.user?.id);

  const active: TabValue | "none" = pathname.startsWith("/collab")
    ? "collab"
    : pathname.startsWith("/command-center")
      ? "command"
      : pathname.startsWith("/profile")
        ? isOwnProfile
          ? "me"
          : "none"
        : pathname.startsWith("/jams")
          ? "jams"
          : "home";

  // The chonk press animation only lines up if the tapped key stays down the
  // moment the finger lifts (`:active` and `aria-pressed` share the same
  // depressed position). `active` is derived from the pathname, which lags the
  // tap by a route transition (loaders, lazy chunks) — long enough for the key
  // to visibly spring back up before selection lands. So the tapped tab is
  // lit optimistically on tap and reconciled once the route actually changes.
  const [pending, setPending] = useState<TabValue | null>(null);
  useEffect(() => {
    setPending(null);
  }, [pathname]);

  const handleChange = (value: string) => {
    setPending(value as TabValue);
    switch (value as TabValue) {
      case "home":
        navigate({ to: "/" });
        return;
      case "jams":
        navigate({ to: "/jams" });
        return;
      case "collab":
        navigate({ to: "/collab" });
        return;
      case "command":
        navigate({ to: "/command-center" });
        return;
      case "me":
        navigate({ to: "/profile" });
        return;
    }
  };

  return (
    <nav
      aria-label="Primary"
      data-testid="mobile-bottom-nav"
      className={cn(
        inline
          ? "pointer-events-auto"
          : "pointer-events-auto fixed inset-x-0 bottom-0 z-50 flex justify-center px-3",
      )}
      style={
        inline
          ? undefined
          : {
              paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)",
              paddingLeft: "calc(env(safe-area-inset-left) + 0.75rem)",
              paddingRight: "calc(env(safe-area-inset-right) + 0.75rem)",
            }
      }
    >
      <SegmentedControl
        size="lg"
        priority="default"
        value={pending ?? active}
        onChange={handleChange}
        aria-label="Primary navigation"
        className="w-full max-w-md"
      >
        <SegmentedControl.Item value="home" aria-label="Home" className={cn(SEG, "rounded-l-md")}>
          <TabBody icon={Home01Icon} label="HOME" />
        </SegmentedControl.Item>
        <SegmentedControl.Item value="jams" aria-label="Jams" className={SEG}>
          <TabBody icon={Calendar03Icon} label="JAMS" />
        </SegmentedControl.Item>
        <SegmentedControl.Item
          value="collab"
          priority="primary"
          aria-label="Collab"
          className={SEG}
        >
          <TabBody icon={UserGroupIcon} label="COLLAB" />
        </SegmentedControl.Item>
        <SegmentedControl.Item value="command" aria-label="Command" className={SEG}>
          <TabBody icon={ComputerTerminal01Icon} label="BOTS" />
        </SegmentedControl.Item>
        <SegmentedControl.Item value="me" aria-label="Profile" className={cn(SEG, "rounded-r-md")}>
          <TabBody icon={UserIcon} label="ME" avatarUrl={avatarUrl} showDot={hasUnread} />
        </SegmentedControl.Item>
      </SegmentedControl>
    </nav>
  );
}
