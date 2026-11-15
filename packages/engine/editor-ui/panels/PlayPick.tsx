import { Store } from "@tanstack/store";
import { useEffect } from "react";

import type { EditorSession } from "../../editor/index";
import { TOOL_PRIORITY, type ToolEvent } from "../../tool-router";
import type { GameInstance, Vec2 } from "../../types";

/** The parts of the game Alt+click picking needs. */
export type PlayPickGame = Pick<GameInstance, "debug" | "router" | "screenToWorld">;

export type PickState = { id: string | null };

// Keyed by session so the outliner's Spawned group, the event log and the inspector share one pick.
const picks = new WeakMap<EditorSession, Store<PickState>>();

/**
 * The runtime entity picked in Play (a Spawned row, an event, or an Alt+click
 * on the canvas). It outranks the edit selection until the selection changes.
 */
export function playPickOf(session: EditorSession): Store<PickState> {
  let store = picks.get(session);
  if (!store) {
    store = new Store<PickState>({ id: null });
    picks.set(session, store);
  }
  return store;
}

/** Alt+click on the canvas picks the topmost entity there while this is mounted. */
export function usePlayPick(game: PlayPickGame, session: EditorSession) {
  useEffect(() => {
    const pick = playPickOf(session);
    let seq = 0;
    const isPick = (e: ToolEvent) =>
      e.kind === "pointer" && e.type === "down" && e.button === 0 && e.native.altKey;
    return game.router.register({
      id: "editor-play-pick",
      priority: TOOL_PRIORITY.editor,
      accepts: isPick,
      handle(e) {
        if (e.kind !== "pointer") return;
        const at: Vec2 = game.screenToWorld(e.screen);
        const mine = ++seq;
        void game.debug.pick(at).then((id) => {
          if (mine === seq && id !== null) pick.setState(() => ({ id }));
        });
      },
    });
  }, [game, session]);
}
