import {
  createGame,
  createLoadingOverlay,
  fadeTransition,
  type GameInstance,
  type SceneSource,
} from "@jams/engine";
import {
  defineGame,
  type EngineContext,
  type SceneLibrary,
  type TransitionSpec,
} from "@jams/engine/game";
import { replayRecording, runPlaytest } from "@jams/engine/headless";
import type { EntityDef, Pt, SceneDefinition } from "@jams/engine/scene";
import { z } from "zod";

type Post = { letters: number };

export type CourierSnapshot = {
  scene: string | null;
  entry: string | null;
  arrivedAt: Pt | null;
  /** What the cellar's attach spawned (`cellar:<id>`), and the sublevels attached now. */
  attached: string[];
  sublevels: string[];
  letters: number;
};

const FADE: TransitionSpec = { kind: "fade", ms: 400 };

/**
 * A courier walks scenes: `start` leaves the title for the harbour, which
 * attaches its cellar beside it; two `deliver`s close the cellar and end
 * the round, and the ending goes back to the title on its own.
 */
export const courierGame = defineGame<CourierSnapshot>({
  id: "courier",
  types: [],
  actions: [],
  world: { physics: "none" },
  persist: {
    initial: () => ({ letters: 0 }),
    schema: z.strictObject({ letters: z.number().int().min(0) }),
  },
  commands: {
    start: { description: "Leaves the title for the harbour, arriving at the pier." },
    deliver: { description: "Delivers a letter; the second ends the round." },
  },
  createRuntime(ctx: EngineContext) {
    let arrivedAt: Pt | null = null;
    let attached: string[] = [];
    let ticks = 0;
    const letters = () => (ctx.persist.value as Post).letters;
    return {
      onLoad(scene) {
        ticks = 0;
        attached = [];
        const entry = scene.entities.find((e) => e.id === ctx.flow.entry);
        arrivedAt = (entry?.at as Pt | undefined) ?? null;
        if (ctx.flow.scene === "harbour") {
          const cellar = ctx.flow.attach("cellar", { label: "cellar", at: [4, 0] });
          if (!cellar.ok) throw new Error(cellar.issue.message);
          attached = [...cellar.entities];
        }
      },
      beforeStep(_dtMs, _actions, commands) {
        for (const command of commands) {
          if (command.name === "start") {
            ctx.flow.request({ to: "harbour", entry: "pier", transition: FADE });
          }
          if (command.name === "deliver") {
            ctx.persist.set({ letters: letters() + 1 });
            if (letters() === 2) {
              ctx.flow.detach("cellar");
              ctx.flow.request({ to: "ending", transition: FADE });
            }
          }
        }
      },
      afterStep() {
        ticks++;
        if (ctx.flow.scene === "ending" && ticks === 3) {
          ctx.flow.request({ to: "title", persist: { letters: 0 } });
        }
      },
      snapshot: () => ({
        scene: ctx.flow.scene,
        entry: ctx.flow.entry,
        arrivedAt,
        attached,
        sublevels: ctx.flow.sublevels().map((s) => s.label),
        letters: letters(),
      }),
    };
  },
});

const scene = (name: string, entities: EntityDef[]): SceneDefinition => ({
  v: 4,
  game: "courier",
  name,
  bounds: [0, 0, 6.4, 3.2],
  entities,
});

/** The scene list and every listed scene, resident: what a host's `SceneSource` serves. */
export const courierScenes: SceneLibrary = {
  list: [
    { scene: "title", title: "Title" },
    { scene: "harbour", title: "Harbour" },
    { scene: "ending" },
    { scene: "cellar", sublevel: true },
  ],
  scenes: new Map(
    Object.entries({
      title: scene("title", [{ id: "sign", type: "marker", at: [3.2, 1.6] }]),
      harbour: scene("harbour", [
        { id: "pier", type: "marker", at: [0.5, 2.5] },
        { id: "post-office", type: "marker", at: [3, 2.5] },
      ]),
      ending: scene("ending", [{ id: "sunset", type: "marker", at: [3.2, 0.5] }]),
      cellar: scene("cellar", [
        { id: "barrel", type: "marker", at: [0.5, 0.5] },
        { id: "ladder", type: "marker", at: [1.5, 0.5] },
      ]),
    }).map(([id, def]) => [id, { def, prefabs: new Map() }]),
  ),
};

/** One script across every scene: title → harbour → ending → title, each scene its own segment. */
export function deliveryRound() {
  const title = courierScenes.scenes.get("title")!.def;
  const run = runPlaytest<CourierSnapshot>({
    game: courierGame,
    scene: title,
    flow: courierScenes,
    script: {
      v: 1,
      steps: [
        { command: "start" },
        { command: "deliver" },
        { hold: [], until: { persist: { pointer: "/letters", eq: 1 } }, max: 5 },
        { wait: 5 },
        { command: "deliver" },
        { hold: [], until: { scene: "title" }, max: 30 },
      ],
    },
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.issues)}`);
  const segments = run.segments ?? [];
  // Each segment's recording replays alone and stops at its `next` without following it.
  const replays = segments.map((s) =>
    replayRecording<CourierSnapshot>({
      game: courierGame,
      scene: courierScenes.scenes.get(s.scene)!.def,
      recording: s.recording,
      flow: courierScenes,
    }),
  );
  return {
    visited: segments.map((s) => s.scene),
    ends: segments.map((s) => s.end),
    persistAtStart: segments.map((s) => s.recording.start?.persist),
    sceneEnds: replays.map((r) => (r.blocked ? null : r.final)),
    replayed: replays.every((r) => !r.blocked && r.matches),
    final: run.final,
  };
}

/** A host's scenes: here a map, on the site the project's files bundled by glob. */
export function courierSource(library: SceneLibrary = courierScenes): SceneSource {
  return {
    list: () => library.list,
    start: () => "title",
    scene: (id) => library.scenes.get(id) ?? null,
  };
}

/** Plays from the list's start, with a dark fade and a loading line on a slow load. */
export async function playCourier(canvas: HTMLCanvasElement): Promise<GameInstance> {
  const game = await createGame(canvas, {
    game: courierGame,
    displayWidth: canvas.clientWidth,
    displayHeight: canvas.clientHeight,
    flow: {
      source: courierSource(),
      transition: fadeTransition({ color: 0x10141c }),
      loading: createLoadingOverlay({ label: "Sorting the post…" }),
    },
  });
  game.on("flow:change", ({ from, to, entry }) => {
    console.log(`${from ?? "start"} → ${to}${entry ? ` at ${entry}` : ""}`);
  });
  game.start();
  const started = await game.flow.restart();
  if (!started.ok) throw new Error(`${started.issue.code}: ${started.issue.message}`);
  return game;
}
