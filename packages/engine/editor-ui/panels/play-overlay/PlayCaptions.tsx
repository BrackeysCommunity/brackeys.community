import { useEffect } from "react";

import type { GameInstance } from "../../../types";
import { createCaptions, type GameCaptions } from "../../../ui/captions";
import { mountUi } from "../../../ui/layer";

/** Captions that read as on, so the preview leaves the player's saved choice alone. */
const CAPTIONS_ON: GameCaptions = { enabled: () => true, set: () => {} };

/**
 * The sounds' captions over the canvas while a project without game code
 * plays with sound, so they can be read without writing a game UI. A game's
 * own UI places its captions itself, so a game gets none from here.
 */
export function PlayCaptions({
  game,
  canvas,
  sound,
}: {
  game: object;
  canvas: (() => HTMLElement | null) | undefined;
  /** Whether Sound in Play is on. */
  sound: boolean;
}) {
  useEffect(() => {
    const g = game as Partial<Pick<GameInstance, "registry" | "on">>;
    const el = canvas?.();
    if (!sound || !g.on || g.registry?.game || !(el instanceof HTMLCanvasElement)) return;
    // The game's members are closures, so a view over it with only `captions` replaced stays live.
    const preview = Object.create(game, { captions: { value: CAPTIONS_ON } }) as GameInstance;
    return mountUi(preview, el, (ctx) => createCaptions(ctx));
  }, [game, canvas, sound]);
  return null;
}
