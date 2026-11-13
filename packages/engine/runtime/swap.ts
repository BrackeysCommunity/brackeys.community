import type { RigidBody } from "@dimforge/rapier2d";

import { swapStrategyFor, type SceneDiff } from "../game/live";
import { isRuntimeId } from "../game/runtime-ids";
import type { SaveDepth, SaveFile } from "../game/save-file";
import type { EngineContext, GameRuntime, JsonValue, Registry } from "../game/types";
import { sameValue } from "../project/canonical";
import { diffExpanded } from "../scene/expanded-diff";
import { errorText, liveIssue } from "../scene/issues";
import type { ExpandedScene, PrefabLibrary, RuntimeEntity } from "../scene/types";
import type { SpawnRecord } from "./lifecycle";
import type { Pose } from "./poses";
import type { SaveHost } from "./runtime";
import { captureSave, restoreLoaded, worldSaveBlockers } from "./save-state";
import { spawnPose } from "./spawn-pose";
import type { LoadReport, ReconcileReport, SceneRuntimeHandle, SwapReport } from "./types";

/** What a runtime hands `swapRuntime`: the parts of its closure a swap reads and drives. */
export type SwapHost = {
  readonly ctx: EngineContext;
  readonly registry: Registry;
  readonly game: GameRuntime | null;
  /** World-save access: the main scene, the frozen prefabs, a fresh reload, capture and restore. */
  readonly save: SaveHost;
  runtime(): SceneRuntimeHandle;
  /** The loaded scene with every reconcile since applied, or null. */
  scene(): ExpandedScene | null;
  add(entities: RuntimeEntity[]): ReconcileReport;
  update(entities: RuntimeEntity[]): ReconcileReport;
  remove(ids: string[]): void;
  /** Scene and sublevel entities as loaded and attached; one no longer live was destroyed at runtime. */
  authored(): Set<string>;
  /** The live entities switched off, in the order they were. */
  disabledIds(): readonly string[];
  /** The runtime spawns and instances with a live entity, in spawn order. */
  spawns(): readonly SpawnRecord[];
  /** Changes at every load and unload. */
  generation(): number;
  /**
   * Loads a scene fresh as the main scene with `library` frozen, under the
   * flow identity and play options the main scene has now: they hold for
   * every call, after a failed load too. The load starts on `tick`.
   */
  freshLoader(): FreshLoad;
  /**
   * Makes `scene` the main scene's version, the one reloads and world saves
   * load, and freezes `library` as the run's prefab library from now on.
   */
  setVersion(scene: ExpandedScene, library: PrefabLibrary): void;
  /** Puts the live entities in `ids`' order, the rest after them as they were. */
  order(ids: readonly string[]): void;
  /** `e`'s world-save state by owner: its type system's, its behaviors' and what game code registered. */
  saveEntity(e: RuntimeEntity): Record<string, JsonValue>;
  restoreEntity(e: RuntimeEntity, states: Readonly<Record<string, JsonValue>>): void;
};

export type SwapOptions = { prefabs: PrefabLibrary; strategy?: "auto" | "reload" };

/** `back` when the load puts back the version a swap left. */
export type FreshLoad = (
  scene: ExpandedScene,
  library: PrefabLibrary,
  tick: number,
  back?: boolean,
) => LoadReport;

/** A Rapier body of an entity as it was: where it was and how it moved. */
type BodyState = { x: number; y: number; rot: number; vx: number; vy: number; w: number };

/** An entity's runtime state: its pose, each owner's save state and its bodies. */
type Kept = { pose: Pose | null; states: Record<string, JsonValue>; bodies: BodyState[] };

/** A live entity as the swap found it: its record, whether it was off, and its state. */
type Taken = { e: RuntimeEntity; off: boolean; kept: Kept };

/** The entity's bodies in its collider order, each once. */
function bodiesOf(ctx: EngineContext, id: string): RigidBody[] {
  const physics = ctx.physics;
  if (!physics) return [];
  const seen = new Set<number>();
  const out: RigidBody[] = [];
  for (const handle of ctx.tags.handlesOf(id)) {
    const body = physics.world.getCollider(handle)?.parent();
    if (!body || body.isFixed() || seen.has(body.handle)) continue;
    seen.add(body.handle);
    out.push(body);
  }
  return out;
}

function bodyState(body: RigidBody): BodyState {
  const at = body.translation();
  const v = body.linvel();
  return { x: at.x, y: at.y, rot: body.rotation(), vx: v.x, vy: v.y, w: body.angvel() };
}

function keep(host: SwapHost, e: RuntimeEntity): Kept {
  const pose = host.ctx.poses.get(e.id) ?? null;
  return {
    pose: pose ? { x: pose.x, y: pose.y, rot: pose.rot } : null,
    states: structuredClone(host.saveEntity(e)),
    bodies: bodiesOf(host.ctx, e.id).map(bodyState),
  };
}

/** Puts `kept`'s pose and each owner's state back on `e`, a record that replaced the one it was taken from. */
function putBack(host: SwapHost, e: RuntimeEntity, kept: Kept): void {
  if (kept.pose) host.ctx.poses.set(e.id, kept.pose.x, kept.pose.y, kept.pose.rot, { snap: true });
  host.restoreEntity(e, kept.states);
}

function place(body: RigidBody, was: BodyState): void {
  body.setTranslation({ x: was.x, y: was.y }, false);
  body.setRotation(was.rot, false);
  if (body.isDynamic()) {
    body.setLinvel({ x: was.vx, y: was.vy }, false);
    body.setAngvel(was.w, false);
  }
}

/**
 * After the runtime's add, update and remove: queries see the new world,
 * and each entity in `carried` has its bodies put where they were (a system
 * that keeps no pose of its own still has its body moved).
 */
function settle(ctx: EngineContext, carried: readonly Taken[]): void {
  const physics = ctx.physics;
  if (!physics) return;
  physics.refreshQueries();
  for (const { e, kept } of carried) {
    const bodies = bodiesOf(ctx, e.id);
    if (bodies.length !== kept.bodies.length) continue;
    for (const [i, body] of bodies.entries()) place(body, kept.bodies[i]!);
  }
  physics.world.propagateModifiedBodyPositionsToColliders();
}

/** Whether a designer moved the entity: its type, spawn pose or transform differ. */
function moved(registry: Registry, prev: RuntimeEntity, next: RuntimeEntity): boolean {
  if (prev.type !== next.type) return true;
  const a = spawnPose(prev, registry);
  const b = spawnPose(next, registry);
  return (
    a.x !== b.x ||
    a.y !== b.y ||
    a.rot !== b.rot ||
    !sameValue(prev.transform ?? null, next.transform ?? null)
  );
}

/**
 * The version the runtime runs, as its live scene entities show it: the
 * loaded version's entities in its order (a live one as it is now, one
 * destroyed at runtime as it was authored), then scene entities added
 * since. Runtime spawns and sublevel entities are never part of it.
 */
function runningVersion(host: SwapHost, scene: ExpandedScene, version: ExpandedScene) {
  const { ctx } = host;
  const authored = host.authored();
  const entities: RuntimeEntity[] = [];
  const destroyed: string[] = [];
  const listed = new Set<string>();
  for (const e of version.entities) {
    if (isRuntimeId(e.id)) continue;
    const live = ctx.get(e.id);
    if (live) entities.push(live);
    else if (authored.has(e.id)) {
      entities.push(e);
      destroyed.push(e.id);
    } else continue;
    listed.add(e.id);
  }
  for (const e of scene.entities) if (!isRuntimeId(e.id) && !listed.has(e.id)) entities.push(e);
  return { scene: { ...scene, entities }, destroyed: new Set(destroyed) };
}

/** The slot name a swap's captures are taken under; they never leave memory. */
const SWAP_SLOT = "live-swap";

type Refuse = (
  cause: string,
  more?: { reason?: "reload" | "refused"; entityId?: string },
) => SwapReport;

type Refusal = { cause: string; entityId?: string };

/**
 * The version the runtime ran before the swap. `loadFresh` loads a scene
 * under the run's identity; `loadBack` loads this version again.
 */
type Previous = {
  version: ExpandedScene;
  library: PrefabLibrary;
  loadFresh: FreshLoad;
  loadBack: FreshLoad;
};

/** A capture of the run at `depth`, in memory: the same one a save of that depth takes. */
const capture = (host: SwapHost, depth: SaveDepth) =>
  captureSave(host.runtime(), { depth, slot: SWAP_SLOT, now: 0 });

/** `file` without its world: what a scene that can't take the world gets back. */
function asProgress(file: SaveFile): SaveFile {
  const out: SaveFile = { ...file, depth: "progress" };
  delete out.world;
  return out;
}

/**
 * Loads `scene` fresh with `library`, starting on `tick`, and puts `file`
 * back on it (a world capture's own tick wins): null when both ran.
 */
function loadAndRestore(
  host: SwapHost,
  loadFresh: FreshLoad,
  scene: ExpandedScene,
  library: PrefabLibrary,
  file: SaveFile,
  tick: number,
): Refusal | null {
  const loaded = loadFresh(scene, library, tick);
  if (!loaded.ok) {
    return {
      cause: `loading it fresh failed: ${loaded.error}`,
      ...(loaded.entityId !== undefined ? { entityId: loaded.entityId } : {}),
    };
  }
  const issue = restoreLoaded(host.runtime(), file);
  return issue ? { cause: `putting the run back failed: ${issue.message}` } : null;
}

/** Applies `next` to the runtime `host` describes: `SceneRuntime.swap`. */
export function swapRuntime(host: SwapHost, next: ExpandedScene, opts: SwapOptions): SwapReport {
  const { ctx } = host;
  const scene = host.scene();
  const sceneId = host.save.sceneId() ?? next.name;
  const refuse: Refuse = (cause, more = {}) => ({
    ok: false,
    issue: liveIssue({ code: "live-swap-failed", scene: sceneId, cause, phase: "swap", ...more }),
  });
  if (!scene) return refuse("no scene is loaded");
  if (host.save.stepping()) return refuse("a swap runs between ticks, never inside a step");

  const version = host.save.mainScene() ?? scene;
  const library = host.save.prefabs();
  const loadFresh = host.freshLoader();
  const was: Previous = {
    version,
    library,
    loadFresh,
    loadBack: (s, lib, tick) => loadFresh(s, lib, tick, true),
  };
  const running = runningVersion(host, scene, version);
  const diff = diffExpanded(running.scene, next);
  if (swapStrategyFor(diff, opts.strategy) === "reload") {
    return reload(host, next, opts.prefabs, diff, was, refuse, null);
  }

  const nextById = new Map(next.entities.map((e) => [e.id, e]));
  const isAdded = new Set(diff.added);
  const take = (id: string): Taken => {
    const e = ctx.get(id)!;
    return { e, off: !ctx.enabled(id), kept: keep(host, e) };
  };
  const removed = diff.removed.filter((id) => !running.destroyed.has(id)).map(take);
  const added = next.entities.filter((e) => isAdded.has(e.id));
  const changed = diff.changed
    .filter((id) => !running.destroyed.has(id))
    .map((id) => ({ ...take(id), to: nextById.get(id)! }));

  const order = scene.entities.map((e) => e.id);
  const authored = new Set(host.authored());
  const touches = removed.length + added.length + changed.length > 0;
  const world =
    touches && worldSaveBlockers(host.runtime()).length === 0 ? capture(host, "world") : null;
  const exact = world?.ok ? world.file : null;
  const applied = { removed: false, added: false, updated: false };
  const carried: Taken[] = [];

  /** Undoes what `applied` says ran, from what was taken before it ran. */
  function inverse(): void {
    const back: Taken[] = [];
    if (applied.updated) {
      host.update(changed.map((c) => c.e));
      back.push(...changed);
    }
    if (applied.added) host.remove(added.map((e) => e.id));
    if (applied.removed) {
      host.add(removed.map((r) => r.e));
      back.push(...removed);
    }
    for (const t of back) restoreTaken(host, t);
    const now = host.authored();
    now.clear();
    for (const id of authored) now.add(id);
    host.setVersion(version, library);
    host.order(order);
    settle(
      ctx,
      back.filter((t) => ctx.get(t.e.id)),
    );
  }

  let refused: Refusal | null = null;
  /** An update refused: a system that can't change the entity in place, which a fresh spawn may still build. */
  let updateRefused = false;
  const refusal = (what: string, report: Extract<ReconcileReport, { ok: false }>) => ({
    cause: `${what} "${report.entityId ?? "?"}" was refused: ${report.error}`,
    ...(report.entityId !== undefined ? { entityId: report.entityId } : {}),
  });
  try {
    host.remove(removed.map((r) => r.e.id));
    applied.removed = true;
    const add = host.add(added);
    if (!add.ok) refused = refusal("adding", add);
    else {
      applied.added = true;
      const update = host.update(changed.map((c) => c.to));
      if (!update.ok) {
        refused = refusal("updating", update);
        updateRefused = true;
      } else {
        applied.updated = true;
        for (const c of changed) {
          if (moved(host.registry, c.e, c.to)) continue;
          const now = ctx.get(c.to.id);
          if (!now) continue;
          putBack(host, now, c.kept);
          carried.push({ ...c, e: now });
        }
      }
    }
  } catch (err) {
    refused = { cause: errorText(err) };
  }
  if (refused) {
    if (exact) return reload(host, next, opts.prefabs, diff, was, refuse, { file: exact, refused });
    inverse();
    // Without a world capture the reload carries progress. A refused add or
    // a throw would refuse again in the fresh load and lose the world, so
    // only a refused update reloads; the others keep the inverse's world.
    if (updateRefused) return reload(host, next, opts.prefabs, diff, was, refuse, { refused });
    return refuse(refused.cause, {
      reason: "refused",
      ...(refused.entityId !== undefined ? { entityId: refused.entityId } : {}),
    });
  }

  const now = host.authored();
  for (const id of diff.removed) now.delete(id);
  for (const e of added) now.add(e.id);
  host.setVersion(next, opts.prefabs);
  host.order(next.entities.map((e) => e.id));
  settle(ctx, carried);

  const swapTick = ctx.tick;
  const generation = host.generation();
  let undone = false;
  return {
    ok: true,
    strategy: "reconcile",
    carried: "all",
    diff,
    undo() {
      if (undone || host.generation() !== generation || host.save.stepping()) return;
      undone = true;
      if (exact && ctx.tick === swapTick) {
        rolledBack(loadAndRestore(host, was.loadBack, version, library, exact, swapTick));
        return;
      }
      inverse();
    },
  };
}

/**
 * The reload strategy: the run captured at world depth when
 * `worldSaveBlockers` names nothing, else at progress depth; `next` loaded
 * fresh with `prefabs` as its library, which runs the game's `onLoad`; then
 * the capture restored in a save restore's order, which runs its `restore`.
 * The tick carries on at every depth. A world capture goes back as
 * progress onto a scene that now runs on Rapier. `after` is a reconcile
 * that refused, with its world capture when it took one; its refusal is
 * reported when the reload fails too. On a failure the old version is
 * loaded again and the capture put back.
 */
function reload(
  host: SwapHost,
  next: ExpandedScene,
  prefabs: PrefabLibrary,
  diff: SceneDiff,
  was: Previous,
  refuse: Refuse,
  after: { file?: SaveFile; refused: Refusal } | null,
): SwapReport {
  let file = after?.file ?? null;
  if (!file) {
    const depth = worldSaveBlockers(host.runtime()).length === 0 ? "world" : "progress";
    let taken = capture(host, depth);
    if (!taken.ok && depth === "world") taken = capture(host, "progress");
    if (!taken.ok) {
      return refuse(`the run couldn't be captured for a reload: ${taken.issue.message}`, {
        reason: "refused",
      });
    }
    file = taken.file;
  }
  const before = file;
  const onto =
    before.depth === "world" && next.settings.physics === "rapier" ? asProgress(before) : before;
  // Read before the load: a failed one unloads, which zeroes the tick.
  const tick = host.ctx.tick;
  const failed = loadAndRestore(host, was.loadFresh, next, prefabs, onto, tick);
  if (failed) {
    const back =
      host.save.mainScene() !== was.version
        ? loadAndRestore(host, was.loadBack, was.version, was.library, before, tick)
        : null;
    const why: Refusal = after
      ? {
          cause: `${after.refused.cause}; reloading instead failed too: ${failed.cause}`,
          ...(after.refused.entityId !== undefined ? { entityId: after.refused.entityId } : {}),
        }
      : failed;
    if (back) why.cause += `; putting the old version back failed too: ${back.cause}`;
    return refuse(why.cause, {
      reason: "refused",
      ...(why.entityId !== undefined ? { entityId: why.entityId } : {}),
    });
  }

  const generation = host.generation();
  let undone = false;
  return {
    ok: true,
    strategy: "reload",
    carried: onto.depth === "world" ? "world" : "progress",
    diff,
    undo() {
      if (undone || host.generation() !== generation || host.save.stepping()) return;
      undone = true;
      rolledBack(
        loadAndRestore(host, was.loadBack, was.version, was.library, before, host.ctx.tick),
      );
    },
  };
}

/** An undo that couldn't put the old version back throws its cause, so the caller can say so. */
function rolledBack(failed: Refusal | null): void {
  if (failed) throw new Error(`putting the old version back failed: ${failed.cause}`);
}

/** A taken entity back as it was: switched off again when it was off, its state restored. */
function restoreTaken(host: SwapHost, t: Taken): void {
  const e = host.ctx.get(t.e.id);
  if (!e) return;
  if (t.off && host.ctx.enabled(e.id)) host.ctx.setEnabled(e.id, false);
  putBack(host, e, t.kept);
}
