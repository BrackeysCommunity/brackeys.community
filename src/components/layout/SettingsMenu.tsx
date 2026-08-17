import { Settings02Icon, VolumeHighIcon, VolumeMute02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";

import {
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
import { MOTION_LABEL, useAppSettings } from "@/lib/hooks/use-app-settings";
import { useAppTheme } from "@/lib/hooks/use-app-theme";

/**
 * Header cog — a readout, not a control panel. Each row states what the
 * pref is currently set to and opens the pane on `/settings` that changes
 * it; sixteen themes and a three-way motion switch don't belong in a
 * dropdown. Mute stays inline because it is genuinely one click.
 */
export function SettingsMenu() {
  const { theme } = useAppTheme();
  const { motionPref, muted, setMuted } = useAppSettings();
  // From anywhere else these rows are a page hop and should transition like
  // one. From inside `/settings` they're the same pane swap the rail does,
  // so they suppress the cross-route fade for the same reason it does.
  const onSettings = useRouterState({
    select: (s) => s.location.pathname.startsWith("/settings"),
  });

  const values: Partial<Record<SettingsTab, string>> = {
    appearance: theme.name,
    motion: MOTION_LABEL[motionPref],
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Settings"
        render={<Button variant="outline" size="icon-lg" />}
      >
        <HugeiconsIcon icon={Settings02Icon} size={16} />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="min-w-[240px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Settings</DropdownMenuLabel>
          {SETTINGS_TABS.map((id) => (
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

        {/* The one control that stays: a mute is a single click, and
            routing to a page to make it is worse than the dropdown. */}
        <DropdownMenuCheckboxItem checked={muted} onCheckedChange={setMuted}>
          <HugeiconsIcon icon={muted ? VolumeMute02Icon : VolumeHighIcon} size={14} />
          Mute
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
