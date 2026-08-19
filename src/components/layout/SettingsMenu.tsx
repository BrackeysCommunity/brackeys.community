import {
  MagicWand01Icon,
  Settings02Icon,
  VolumeHighIcon,
  VolumeMute02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";

import {
  LOCAL_SETTINGS_TABS,
  SETTINGS_TAB_META,
  SETTINGS_TABS,
  type SettingsTab,
} from "@/components/settings/settings-tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MicroLabel } from "@/components/ui/typography";
import { authClient } from "@/lib/auth-client";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useAppTheme } from "@/lib/hooks/use-app-theme";

/**
 * Header cog — a readout, not a control panel. Each row states what the
 * pref is currently set to and opens the pane on `/settings` that changes
 * it; sixteen themes don't belong in a dropdown. Motion and mute stay
 * inline because they are genuinely one click — the motion pane still owns
 * the tri-state, this row only flips the effective value.
 */
export function SettingsMenu() {
  const { theme } = useAppTheme();
  const { muted, setMuted, reduceMotion, setMotionPref } = useAppSettings();
  const { data: session } = authClient.useSession();
  // From anywhere else these rows are a page hop and should transition like
  // one. From inside `/settings` they're the same pane swap the rail does,
  // so they suppress the cross-route fade for the same reason it does.
  const onSettings = useRouterState({
    select: (s) => s.location.pathname.startsWith("/settings"),
  });

  const values: Partial<Record<SettingsTab, string>> = {
    appearance: theme.name,
  };

  // Motion drops out of the link list — it toggles below instead. The
  // `/settings` rail still carries it. Signed out, so do the sections that
  // are account-backed: they'd open on a notice rather than a control.
  const linkTabs = SETTINGS_TABS.filter(
    (id) => id !== "motion" && (session?.user != null || LOCAL_SETTINGS_TABS.includes(id)),
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Settings"
        title="Settings"
        render={<Button variant="outline" size="icon-lg" />}
      >
        <HugeiconsIcon icon={Settings02Icon} size={16} />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="min-w-[240px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Settings</DropdownMenuLabel>
          {linkTabs.map((id) => (
            <DropdownMenuItem
              key={id}
              render={<Link to={SETTINGS_TAB_META[id].to} viewTransition={!onSettings} />}
            >
              <HugeiconsIcon icon={SETTINGS_TAB_META[id].icon} size={14} />
              {SETTINGS_TAB_META[id].label}
              <MicroLabel as="span" className="ml-auto pl-4 uppercase">
                {values[id]}
              </MicroLabel>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* The two controls that stay: both are a single click, and routing
            to a page to make one is worse than the dropdown. Motion checks
            the effective value, so `system` reads as whatever the OS
            resolves to; flipping it writes an explicit override. */}
        <DropdownMenuCheckboxItem
          checked={!reduceMotion}
          onCheckedChange={(next) => setMotionPref(next ? "full" : "reduced")}
        >
          <HugeiconsIcon icon={MagicWand01Icon} size={14} />
          Motion
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem checked={muted} onCheckedChange={setMuted}>
          <HugeiconsIcon icon={muted ? VolumeMute02Icon : VolumeHighIcon} size={14} />
          Mute
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
