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
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useAppTheme } from "@/lib/hooks/use-app-theme";
import { HEADER_MAGNET_STRENGTH } from "@/lib/hooks/use-cursor";

const ITEM_CLASS = "text-xs font-bold tracking-widest uppercase";

/**
 * Header cog — the same prefs the mobile shell shows in
 * `AppSettingsDialog` (theme, reduce motion, mute), inline in a dropdown
 * so the desktop header doesn't need a modal to flip a switch. Each
 * control persists immediately via its own provider hook.
 */
export function SettingsMenu() {
  const { themeId, setTheme, themes } = useAppTheme();
  const { reduceMotion, setReduceMotion, muted, setMuted } = useAppSettings();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Settings"
        render={
          <Button
            variant="outline"
            size="icon-lg"
            isMagnetic
            magneticStrength={HEADER_MAGNET_STRENGTH}
          />
        }
      >
        <HugeiconsIcon icon={Settings02Icon} size={16} />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="min-w-[200px] border border-muted bg-background/95 p-1 backdrop-blur-md"
      >
        {/* The label registers itself with the enclosing group — base-ui
            throws outside one, and RadioGroup is not that group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[10px] font-bold tracking-widest uppercase">
            Theme
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={themeId}
            onValueChange={(value) => setTheme(String(value))}
          >
            {themes.map((t) => (
              <DropdownMenuRadioItem key={t.id} value={t.id} className={ITEM_CLASS}>
                {t.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuCheckboxItem
          checked={reduceMotion}
          onCheckedChange={setReduceMotion}
          className={ITEM_CLASS}
        >
          Reduce motion
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={muted} onCheckedChange={setMuted} className={ITEM_CLASS}>
          <HugeiconsIcon icon={muted ? VolumeMute02Icon : VolumeHighIcon} size={14} />
          Mute
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
