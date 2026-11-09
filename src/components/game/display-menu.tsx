import { AspectRatioIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ResolutionPolicy } from "@jams/engine";
import { useCallback, useState } from "react";

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
import { MicroLabel } from "@/components/ui/typography";

/** `native` leaves the resolution to the project and the game; the rest are the host's fit. */
export type DisplayFit = "native" | ResolutionPolicy["fit"];

export type DisplaySize = { width: number; height: number };

export type DisplaySetting = {
  fit: DisplayFit;
  size: DisplaySize;
  /** Whole-multiple scaling, for pixel art. */
  integer: boolean;
};

export const DISPLAY_FITS: readonly { value: DisplayFit; label: string }[] = [
  { value: "native", label: "Native" },
  { value: "expand", label: "Expand" },
  { value: "letterbox", label: "Letterbox" },
  { value: "crop", label: "Crop" },
];

export const DISPLAY_SIZES: readonly DisplaySize[] = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 640, height: 360 },
  { width: 320, height: 180 },
];

export const DEFAULT_DISPLAY: DisplaySetting = {
  fit: "native",
  size: { width: 1920, height: 1080 },
  integer: false,
};

const sizeKey = (s: DisplaySize) => `${s.width}x${s.height}`;

/** The host's `GameConfig.resolution` for a setting; `undefined` under Native. */
export function displayResolution(setting: DisplaySetting): Partial<ResolutionPolicy> | undefined {
  if (setting.fit === "native") return undefined;
  return {
    virtual: { width: setting.size.width, height: setting.size.height },
    fit: setting.fit,
    ...(setting.integer ? { integer: true } : {}),
  };
}

const STORAGE_KEY = "game-display";

function readStored(): DisplaySetting {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DISPLAY;
    const parsed = JSON.parse(raw) as Partial<DisplaySetting>;
    const fit = DISPLAY_FITS.find((f) => f.value === parsed.fit)?.value;
    const size = DISPLAY_SIZES.find((s) => parsed.size && sizeKey(s) === sizeKey(parsed.size));
    return {
      fit: fit ?? DEFAULT_DISPLAY.fit,
      size: size ?? DEFAULT_DISPLAY.size,
      integer: parsed.integer === true,
    };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

/** The viewer's display setting, remembered in this browser. */
export function useDisplaySetting(): [DisplaySetting, (next: DisplaySetting) => void] {
  const [setting, setSetting] = useState(readStored);
  const update = useCallback((next: DisplaySetting) => {
    setSetting(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
  }, []);
  return [setting, update];
}

/** The game room's display menu: how the game's virtual area fits the window, and at what size. */
export function DisplayMenu({
  value,
  onChange,
}: {
  value: DisplaySetting;
  onChange: (next: DisplaySetting) => void;
}) {
  const native = value.fit === "native";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Display"
        render={<Button variant="ghost" size="sm" className="gap-1 px-1.5" tooltip="Display" />}
      >
        <HugeiconsIcon icon={AspectRatioIcon} size={14} />
        <MicroLabel as="span" className="uppercase">
          {native ? "Native" : `${value.size.width}×${value.size.height}`}
        </MicroLabel>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Fit</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value.fit}
            onValueChange={(fit) => onChange({ ...value, fit: fit as DisplayFit })}
          >
            {DISPLAY_FITS.map((f) => (
              <DropdownMenuRadioItem key={f.value} value={f.value}>
                {f.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Virtual size</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sizeKey(value.size)}
            onValueChange={(key) => {
              const size = DISPLAY_SIZES.find((s) => sizeKey(s) === key);
              if (size) onChange({ ...value, size });
            }}
          >
            {DISPLAY_SIZES.map((s) => (
              <DropdownMenuRadioItem key={sizeKey(s)} value={sizeKey(s)} disabled={native}>
                {s.width}×{s.height}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuCheckboxItem
            checked={value.integer}
            disabled={native}
            onCheckedChange={(integer) => onChange({ ...value, integer })}
          >
            Whole-pixel scaling
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
