import { Store } from "@tanstack/store";
import { useEffect, useRef } from "react";

import {
  applyDialogueCommand,
  createDialogueRunner,
  type DialogueRunner,
} from "../../../dialogue/runner";
import { memoryVars } from "../../../dialogue/vars";
import { isDialogueCommand } from "../../../game/commands";
import type { GameCommand } from "../../../game/types";
import { DIALOGUE_KIND, type DialogueFile } from "../../../project/kinds/dialogue";
import type { AssetId } from "../../../project/types";
import type { GameInstance, GameStoreState } from "../../../types";
import { createCaptions, type GameCaptions } from "../../../ui/captions";
import { createDialogueBox } from "../../../ui/dialogue";
import { mountUi } from "../../../ui/layer";

/** Captions that read as on, so the preview leaves the player's saved choice alone. */
const CAPTIONS_ON: GameCaptions = { enabled: () => true, set: () => {} };

/** The chrome's game type leaves these out; a stand-in game may have none. */
type OverlayGame = Partial<Pick<GameInstance, "registry" | "on" | "project">>;

/** Whether `game` runs a project without game code, whose Play gets this overlay's UI. */
export function isGamelessPlay(game: object): boolean {
  const g = game as OverlayGame;
  return g.on !== undefined && g.registry !== undefined && !g.registry.game;
}

/** The project's dialogues in path order, the ones a gameless Play can preview. */
export function previewDialogues(game: object): readonly AssetId[] {
  if (!isGamelessPlay(game)) return [];
  return (game as OverlayGame).project?.()?.docs?.(DIALOGUE_KIND) ?? [];
}

/** One run of a dialogue preview; a new `run` restarts the same dialogue. */
export type DialoguePreview = { id: AssetId; run: number };

type PreviewControl = { start(id: AssetId): boolean };

/**
 * The captions and dialogue box a gameless project gets over the canvas in
 * Play: a conversation the scene's scripts start, or the `dialogue` preview.
 * A preview runs its own copy of the dialogue over its own variables, so the
 * run and its recording are untouched; `onDialogueEnd` hears when it ends.
 * A game places its own captions and dialogue, so it gets none of this.
 */
export function PlayCaptions({
  game,
  canvas,
  dialogue = null,
  onDialogueEnd,
}: {
  game: object;
  canvas: (() => HTMLElement | null) | undefined;
  dialogue?: DialoguePreview | null;
  onDialogueEnd?: () => void;
}) {
  const control = useRef<PreviewControl | null>(null);
  const ended = useRef(onDialogueEnd);
  useEffect(() => {
    ended.current = onDialogueEnd;
  });

  useEffect(() => {
    const el = canvas?.();
    if (!isGamelessPlay(game) || !(el instanceof HTMLCanvasElement)) return;
    const real = game as GameInstance;
    const store = real.getStore();
    let runner: DialogueRunner | null = null;
    const stateNow = (): GameStoreState => ({
      ...store.state,
      dialogue: runner ? runner.view() : store.state.dialogue,
    });
    const shown = new Store<GameStoreState>(stateNow());
    const sync = () => shown.setState(stateNow);
    const unsubscribe = store.subscribe(sync);

    const finish = () => {
      runner = null;
      sync();
      ended.current?.();
    };
    const send = (command: GameCommand): boolean => {
      if (!runner || !isDialogueCommand(command.name)) return real.send(command);
      const moved = applyDialogueCommand(runner, command);
      if (runner.view().ended !== null) finish();
      else if (moved) sync();
      return moved;
    };
    control.current = {
      start(id) {
        const file = real.project()?.doc?.<DialogueFile>(DIALOGUE_KIND, id);
        if (!file) return false;
        runner = createDialogueRunner(file, id, memoryVars(), () => {});
        if (runner.view().ended !== null) finish();
        else sync();
        return true;
      },
    };

    // The game's members are closures, so a view over it with these replaced stays live.
    const overlay = Object.create(game, {
      captions: { value: CAPTIONS_ON },
      getStore: { value: () => shown },
      send: { value: send },
    }) as GameInstance;
    const unmount = mountUi(overlay, el, (ctx) => {
      const captions = createCaptions(ctx);
      const box = createDialogueBox(ctx);
      return {
        destroy() {
          box.destroy();
          captions.destroy();
        },
      };
    });
    return () => {
      control.current = null;
      unsubscribe();
      unmount();
    };
  }, [game, canvas]);

  useEffect(() => {
    if (dialogue && !control.current?.start(dialogue.id)) ended.current?.();
  }, [dialogue]);
  return null;
}
