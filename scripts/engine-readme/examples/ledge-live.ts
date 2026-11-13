import type { StagedVersion } from "@jams/engine";
import { createRegistry, withProject, type GameDefinition } from "@jams/engine/game";
import { createHeadlessRuntime, swapCheck } from "@jams/engine/headless";
import { buildSceneVersion, heldProject, type HeldFile } from "@jams/engine/project";
import {
  expandScene,
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type SceneDefinition,
} from "@jams/engine/scene";

import { ledgeGame, makeLedge, type LedgeSnapshot } from "./ledge-game";

/** The level as released: a runner on an empty ledge 16 m long. */
export function ledge(extra: EntityDef[] = [], bounds = [0, 0, 16, 4]): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: "ledge",
    name: "ledge",
    bounds: bounds as SceneDefinition["bounds"],
    settings: { physics: "none" },
    entities: [{ id: "runner", type: "runner", at: [1, 1], speed: 2 }, ...extra],
  };
}

/** A crate 12 m wide over the middle of the ledge: wherever the runner is when it lands, it is inside. */
const WIDE_CRATE: EntityDef = { id: "crate", type: "crate", at: [8, 1], w: 12 };

/** Builds one version of the ledge scene from its files, as `game live build` does. */
export async function versionOf(
  def: SceneDefinition,
  game: GameDefinition = ledgeGame,
): Promise<StagedVersion> {
  const docs: Record<string, unknown> = {
    "scene-list.json": { kind: "scene-list", v: 1, start: "ledge", scenes: [{ scene: "ledge" }] },
    "game-settings.json": { kind: "game-settings", v: 2, engine: {}, game: {} },
    "ledge.json": def,
  };
  const files: HeldFile[] = Object.entries(docs).map(([path, json]) => ({ path, json }));
  const { view } = heldProject(files, createRegistry(game), { projectId: "ledge", name: "Ledge" });
  const texts = new Map<string, string>();
  for (const entry of view.byId.values())
    texts.set(entry.id, `${JSON.stringify(docs[entry.path], null, 2)}\n`);
  const values = new Map([...texts].map(([id, text]) => [id, JSON.parse(text) as unknown]));
  const built = await buildSceneVersion({
    view,
    texts,
    // The schema hashes of the code doing the build, by kind.
    build: Object.fromEntries(Object.entries(view.state.build).map(([kind, s]) => [kind, s.hash])),
    game,
    registry: withProject(createRegistry(game), view, values),
    scene: "ledge",
  });
  if (!built.ok) throw new Error(built.issues.map((i) => i.message).join("; "));
  return { id: built.id, version: built.version, texts: built.texts };
}

/** Swaps the crate in at a quarter, half and three quarters of a 200-tick run, with and without `onSwap`. */
export async function checkCrate() {
  const scripts = [
    { name: "run", script: { v: 1 as const, scene: "ledge", steps: [{ wait: 200 }] } },
  ];
  const from = { def: ledge(), prefabs: new Map() };
  const run = (game: GameDefinition, to: StagedVersion) => {
    const report = swapCheck({ game, from, to, scripts });
    return {
      ok: report.ok,
      runs: report.runs.map((r) => ({
        tick: r.tick,
        strategy: r.strategy,
        codes: r.issues.map((i) => i.code),
      })),
    };
  };
  const stubborn = makeLedge({ freeOnSwap: false });
  return {
    freed: run(ledgeGame, await versionOf(ledge([WIDE_CRATE]))),
    stuck: run(stubborn, await versionOf(ledge([WIDE_CRATE]), stubborn)),
    // New bounds change the scene's header: the world is rebuilt and its state restored.
    longer: run(ledgeGame, await versionOf(ledge([], [0, 0, 20, 4]))),
  };
}

/** A headless run that takes the crate at its next respawn, the way a player's game would. */
export async function crateAtRespawn() {
  const def = ledge();
  const registry = createRegistry(ledgeGame);
  const rt = createHeadlessRuntime({
    game: ledgeGame,
    registry,
    flow: { list: [{ scene: "ledge" }], scenes: new Map([["ledge", { def, prefabs: new Map() }]]) },
    scene: expandScene(def, registry),
  });
  const next = await versionOf(ledge([WIDE_CRATE]));
  const staged = rt.live.stage(next);
  const activated = rt.live.activate("ledge", next.id, "boundary");
  const waiting = rt.live.pending().map((p) => p.timing);
  let swappedAt: number | null = null;
  for (let tick = 0; tick < 600 && swappedAt === null; tick++) {
    rt.step(rt.ctx.time.tickMs, []);
    if ((rt.snapshot() as LedgeSnapshot).swaps.length > 0) swappedAt = rt.ctx.tick;
  }
  const snap = rt.snapshot() as LedgeSnapshot;
  const result = {
    staged: staged.ok,
    timing: activated.timing,
    waiting,
    swappedAt,
    current: rt.live.current("ledge") === next.id,
    ...snap,
  };
  rt.destroy();
  return result;
}
