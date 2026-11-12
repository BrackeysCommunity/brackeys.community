import { PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import type { PlayableGame } from "@/lib/engine/playable-game";

export type { PlayableGame };

/**
 * The game, when there is one to play: a live release, or on a jam's entry
 * the version pinned to that jam. The payload decides both, so the UI only
 * reads them.
 */
export const playableGame = (game: PlayableGame | null | undefined): PlayableGame | null =>
  game && (game.playable || game.jamVersion !== undefined) ? game : null;

/** The play page for a jam's pinned version, else the live release. */
export function PlayButton({
  game,
  label,
  ...button
}: {
  game: PlayableGame;
  label: string;
} & Pick<ComponentProps<typeof Button>, "size" | "variant" | "className">) {
  const version = game.jamVersion !== undefined ? String(game.jamVersion) : "latest";
  return (
    <Button
      {...button}
      nativeButton={false}
      render={
        <Link
          to="/games/$projectId/play/$version"
          params={{ projectId: game.projectId, version }}
        />
      }
    >
      <HugeiconsIcon icon={PlayIcon} data-icon="inline-start" />
      {label}
    </Button>
  );
}
