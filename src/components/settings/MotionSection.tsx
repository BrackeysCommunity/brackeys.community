import { VolumeHighIcon, VolumeMute02Icon } from "@hugeicons/core-free-icons";

import { Switch } from "@/components/ui/switch";
import { MOTION_OPTIONS, useAppSettings } from "@/lib/hooks/use-app-settings";

import { OptionCard, SettingRow, SettingsSection } from "./SettingsUI";

export function MotionSection() {
  const { motionPref, setMotionPref, reduceMotion, muted, setMuted } = useAppSettings();

  return (
    <>
      <SettingsSection
        index="01"
        title="Motion"
        hint={
          motionPref === "system"
            ? `Following your OS setting — motion is currently ${reduceMotion ? "off" : "on"}.`
            : "Page transitions, staggered lists, and the animated backdrop."
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {MOTION_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              active={option.value === motionPref}
              title={option.label}
              description={option.description}
              onClick={() => setMotionPref(option.value)}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection index="02" title="Sound">
        <SettingRow
          label="Mute"
          hint="Silence any in-app audio cues."
          icon={muted ? VolumeMute02Icon : VolumeHighIcon}
          control={<Switch checked={muted} onCheckedChange={setMuted} aria-label="Mute" />}
        />
      </SettingsSection>
    </>
  );
}
