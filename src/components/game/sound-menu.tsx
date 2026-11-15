import { VolumeHighIcon, VolumeMute02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PREF_KEYS,
  setPref,
  type BusLevel,
  type GameInstance,
  type PrefsStore,
} from "@jams/engine";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { MicroLabel } from "@/components/ui/typography";

const MASTER = "master";
const FULL: BusLevel = { volume: 1, muted: false };

/** The master bus as saved for the game, full and unmuted with nothing saved. */
export function savedMaster(prefs: PrefsStore, gameId: string): BusLevel {
  const saved = prefs.load(gameId)[PREF_KEYS.busKey(MASTER)];
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return FULL;
  const { volume, muted } = saved as Partial<Record<keyof BusLevel, unknown>>;
  return {
    volume:
      typeof volume === "number" && Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
    muted: muted === true,
  };
}

/**
 * The game room's sound menu: the player's master volume and mute. With the
 * game's audio open it goes through `setBus`, which saves it; while the game
 * plays silent it is saved in the prefs, which the audio reads when it opens.
 */
export function SoundMenu({
  game,
  gameId,
  prefs,
}: {
  game: GameInstance | null;
  gameId: string;
  prefs: PrefsStore;
}) {
  const read = (): BusLevel => {
    const open = game?.audio?.buses()[MASTER];
    return open ? { ...open } : savedMaster(prefs, gameId);
  };
  const [level, setLevel] = useState(read);
  // Re-read when the game or its prefs change, during render rather than in an effect.
  const [source, setSource] = useState({ game, gameId, prefs });
  if (source.game !== game || source.gameId !== gameId || source.prefs !== prefs) {
    setSource({ game, gameId, prefs });
    setLevel(read());
  }

  const change = useCallback(
    (next: BusLevel) => {
      setLevel(next);
      const audio = game?.audio ?? null;
      if (audio) audio.setBus(MASTER, next.volume, next.muted);
      else setPref(prefs, gameId, PREF_KEYS.busKey(MASTER), { ...next });
    },
    [game, gameId, prefs],
  );

  const silent = level.muted || level.volume === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Sound"
        render={<Button variant="ghost" size="sm" className="gap-1 px-1.5" tooltip="Sound" />}
      >
        <HugeiconsIcon icon={silent ? VolumeMute02Icon : VolumeHighIcon} size={14} />
        <MicroLabel as="span" className="uppercase">
          {level.muted ? "Muted" : `${Math.round(level.volume * 100)}%`}
        </MicroLabel>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Volume</DropdownMenuLabel>
          <div className="px-2 pt-1 pb-2">
            <Slider
              aria-label="Volume"
              min={0}
              max={100}
              step={5}
              value={[Math.round(level.volume * 100)]}
              disabled={level.muted}
              onValueChange={(value) => {
                const v = Array.isArray(value) ? value[0] : value;
                if (typeof v === "number") change({ ...level, volume: v / 100 });
              }}
            />
          </div>
          <DropdownMenuCheckboxItem
            checked={level.muted}
            onCheckedChange={(muted) => change({ ...level, muted })}
          >
            Mute
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
