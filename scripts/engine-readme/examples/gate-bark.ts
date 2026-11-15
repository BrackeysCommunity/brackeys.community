import {
  createDialogueRunner,
  createRegistry,
  defineGame,
  DIALOGUE_LINE,
  persistVars,
  type DialogueLineEvent,
  type DialogueRunner,
  type JsonValue,
  type SaveFile,
} from "@jams/engine/game";
import { createHeadlessRuntime } from "@jams/engine/headless";
import type { DialogueFile } from "@jams/engine/project";
import { expandScene } from "@jams/engine/scene";

import { gateProject, gateScene } from "./gate-game";

/** The crow's barks, round and round: literal `say` lines, as a prototype writes them. */
export const crowBarks: DialogueFile = {
  kind: "dialogue",
  v: 1,
  start: "caw",
  nodes: [{ id: "caw", lines: [{ say: "Caw!" }, { say: "Coins! Coins!" }], next: "caw" }],
};

/**
 * The gate with a crow on it: the guard talks through `ctx.dialogue` while
 * the crow barks from a runner of its own, a line every 20 ticks. The
 * runner's `save()` rides in the snapshot, so a world save keeps the crow
 * where it was.
 */
export const crowGateGame = defineGame<{ crow: JsonValue }>({
  id: "gate",
  types: [],
  actions: [],
  world: { physics: "none" },
  persist: { initial: () => ({ gold: 3, toll: 3 }) },
  createRuntime(ctx) {
    let crow: DialogueRunner | null = null;
    return {
      onLoad() {
        ctx.dialogue.start("gate-talk");
        crow = createDialogueRunner(crowBarks, "crow-barks", persistVars(ctx), (type, data) =>
          ctx.emit({ type, at: { x: 0, y: 0 }, ...(data === undefined ? {} : { data }) }),
        );
      },
      beforeStep() {
        if (ctx.tick % 20 === 19) crow?.advance();
      },
      snapshot: () => ({ crow: crow?.save() ?? null }),
      restore(state) {
        if (state.crow !== null) crow?.restore(state.crow);
      },
    };
  },
});

/**
 * Plays 50 ticks and saves the world, then plays 30 more on and from the
 * save: both hear the same barks, and the guard is still waiting.
 */
export function crowAlong() {
  const registry = createRegistry(crowGateGame);
  const scene = expandScene(gateScene, registry);
  const open = (fromSave?: SaveFile) =>
    createHeadlessRuntime({
      game: crowGateGame,
      registry,
      scene,
      project: gateProject,
      ...(fromSave ? { fromSave } : {}),
    });
  const barks = (run: ReturnType<typeof open>, ticks: number) => {
    const heard: string[] = [];
    for (let i = 0; i < ticks; i++) {
      for (const e of run.step(run.ctx.time.tickMs, []).events) {
        const line = e.data as DialogueLineEvent;
        if (e.type === DIALOGUE_LINE && line.dialogue === "crow-barks")
          heard.push(`${e.tick} line ${line.line}`);
      }
    }
    return heard;
  };

  const run = open();
  const first = barks(run, 50);
  const saved = run.save({ depth: "world", slot: "crow", now: 0 });
  if (!saved.ok) throw new Error(saved.issue.message);
  const resumed = open(saved.file);
  const on = barks(run, 30);
  const fromSave = barks(resumed, 30);
  const guard = resumed.ctx.dialogue.view()?.node;
  run.destroy();
  resumed.destroy();
  return { first, on, fromSave, guard };
}
