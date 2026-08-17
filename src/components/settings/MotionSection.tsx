import { VolumeHighIcon, VolumeLowIcon, VolumeMute02Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";

import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/typography";
import { MOTION_OPTIONS, useAppSettings } from "@/lib/hooks/use-app-settings";
import { play } from "@/lib/sound";

import { OptionCard, SettingRow, SettingsSection } from "./SettingsUI";

export function MotionSection() {
  const { motionPref, setMotionPref, reduceMotion, muted, setMuted, volume, setVolume } =
    useAppSettings();

  // The slider reads live while dragging; only the committed value is stored,
  // so a single drag is one write rather than one per pixel.
  const [draft, setDraft] = useState(() => Math.round(volume * 100));

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
        <SettingRow
          label="Volume"
          hint="How loud the cues are, from a whisper to full."
          icon={VolumeLowIcon}
          control={
            <div className="flex w-44 items-center gap-3">
              <Slider
                aria-label="Volume"
                className="flex-1"
                disabled={muted}
                value={[draft]}
                onValueChange={(value) => setDraft(Array.isArray(value) ? value[0] : value)}
                onValueCommitted={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  setVolume(next / 100);
                  // A cue at the level just chosen — the point of the control.
                  play("tick");
                }}
              />
              <Text size="xs" variant="muted" className="w-8 text-right tabular-nums">
                {draft}%
              </Text>
            </div>
          }
        />
      </SettingsSection>
    </>
  );
}
