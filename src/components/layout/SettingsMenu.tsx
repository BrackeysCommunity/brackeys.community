import { Settings02Icon, VolumeHighIcon, VolumeMute02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppSettings, type MotionPref } from "@/lib/hooks/use-app-settings";
import { useAppTheme } from "@/lib/hooks/use-app-theme";

const MOTION_OPTIONS: { value: MotionPref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "full", label: "On" },
  { value: "reduced", label: "Off" },
];

/**
 * Header cog — the same prefs the mobile shell shows in
 * `AppSettingsDialog` (theme, motion, mute), inline in a dropdown
 * so the desktop header doesn't need a modal to flip a switch. Each
 * control persists immediately via its own provider hook.
 */
export function SettingsMenu() {
  const { themeId, setTheme, sections } = useAppTheme();
  const { motionPref, setMotionPref, muted, setMuted } = useAppSettings();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Settings"
        render={<Button variant="outline" size="icon-lg" />}
      >
        <HugeiconsIcon icon={Settings02Icon} size={16} />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="min-w-[200px]">
        {/* One group per mode. The label registers itself with the
            enclosing group — base-ui throws outside one, and RadioGroup
            is not that group. Each RadioGroup carries the same value, so
            only the section holding the active theme renders a check. */}
        {sections.map((section, i) => (
          <DropdownMenuGroup key={section.mode}>
            {i > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>Theme · {section.label}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={themeId}
              onValueChange={(value) => setTheme(String(value))}
            >
              {section.themes.map((t) => (
                <DropdownMenuRadioItem key={t.id} value={t.id}>
                  {t.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        ))}

        <DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Motion</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={motionPref}
            onValueChange={(value) => setMotionPref(value as MotionPref)}
          >
            {MOTION_OPTIONS.map((o) => (
              <DropdownMenuRadioItem key={o.value} value={o.value}>
                {o.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuCheckboxItem checked={muted} onCheckedChange={setMuted}>
          <HugeiconsIcon icon={muted ? VolumeMute02Icon : VolumeHighIcon} size={14} />
          Mute
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
