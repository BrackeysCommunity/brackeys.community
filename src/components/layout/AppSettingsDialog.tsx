import { Settings02Icon, VolumeMute02Icon, VolumeHighIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Heading, Text } from "@/components/ui/typography";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useAppTheme } from "@/lib/hooks/use-app-theme";
import { cn } from "@/lib/utils";

interface AppSettingsDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

/**
 * App-wide settings modal — opened from the header cog. Hosts the
 * theme picker, "reduce motion" toggle, and the global mute switch.
 * Each control persists immediately via its own provider hook so
 * there's no save step.
 */
export function AppSettingsDialog({ open, onOpenChange }: AppSettingsDialogProps) {
  const { themeId, setTheme, themes } = useAppTheme();
  const { reduceMotion, setReduceMotion, muted, setMuted } = useAppSettings();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono tracking-widest uppercase">Settings</DialogTitle>
          <DialogDescription>
            Personalize the Brackeys community shell — pick a theme, opt out of decorative motion,
            or mute audio cues. Changes save instantly.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 pt-2">
          <SettingsBlock label="THEME" hint={`${themes.length} variants · pick the look you like`}>
            <div className="grid grid-cols-2 gap-2">
              {themes.map((t) => {
                const isActive = t.id === themeId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTheme(t.id)}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded border px-3 py-2 text-left transition-colors",
                      isActive
                        ? "border-accent bg-accent/10"
                        : "border-muted/40 bg-card/40 hover:border-muted",
                    )}
                  >
                    <Text
                      monospace
                      size="xs"
                      className={cn(
                        "tracking-widest uppercase",
                        isActive ? "text-accent" : "text-foreground",
                      )}
                    >
                      {t.name}
                    </Text>
                    <Text size="xs" variant="muted" className="line-clamp-1">
                      {t.description}
                    </Text>
                  </button>
                );
              })}
            </div>
          </SettingsBlock>

          <SettingsToggle
            label="REDUCE MOTION"
            hint="Skip layout-morph animations and shared-element transitions."
            checked={reduceMotion}
            onCheckedChange={setReduceMotion}
          />
          <SettingsToggle
            label="MUTE"
            hint="Silence any in-app audio cues."
            checked={muted}
            onCheckedChange={setMuted}
            icon={
              <HugeiconsIcon
                icon={muted ? VolumeMute02Icon : VolumeHighIcon}
                size={14}
                className="text-muted-foreground"
              />
            }
          />
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="font-mono tracking-widest"
          >
            DONE
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsBlock({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <Heading
          as="h3"
          monospace
          className="text-[11px] tracking-widest text-muted-foreground uppercase"
        >
          {label}
        </Heading>
        {hint ? (
          <Text monospace size="xs" variant="muted" className="text-right tracking-wide">
            {hint}
          </Text>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function SettingsToggle({
  label,
  hint,
  checked,
  onCheckedChange,
  icon,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Heading
          as="h3"
          monospace
          className="flex items-center gap-2 text-[11px] tracking-widest text-muted-foreground uppercase"
        >
          {icon}
          {label}
        </Heading>
        <Text size="xs" variant="muted" className="max-w-[18rem]">
          {hint}
        </Text>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

// `Settings02Icon` re-exported here so the header's cog button can
// import the same icon without a separate hugeicons round-trip.
export { Settings02Icon };
