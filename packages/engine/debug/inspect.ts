import { layerOrder } from "../context";
import type { BehaviorName } from "../game/behaviors";
import { isCameraRegionType } from "../game/primitives";
import type { EngineContext, EntitySelector, JsonValue } from "../game/types";
import { saveRegistryOf } from "../motion/body";
import type { RuntimeContacts } from "../runtime/contacts";
import type { Pose } from "../runtime/poses";
import type { RuntimeTimers } from "../runtime/timers";
import type { SceneRuntimeHandle } from "../runtime/types";
import type { EntityTypeName, RuntimeEntity } from "../scene/types";
import { entityHomeLayer } from "../systems/bodies";
import type { Vec2 } from "../types";

/** One pending timer or coroutine an entity owns; `due` is the tick it next runs, -1 when unknown. */
export type InspectedTimer = { id: number; due: number; kind: "after" | "every" | "co" };

/** Everything a debugger shows of one live entity: plain data, read-only. */
export type EntityInspection = {
  id: string;
  type: EntityTypeName;
  enabled: boolean;
  /** Its parent in the runtime tree now, after any reparent; null for a root. */
  parent: string | null;
  /** World metres and radians. */
  pose: Pose | null;
  prevPose: Pose | null;
  entity: RuntimeEntity;
  /** The type system's `inspect`. */
  system: JsonValue | undefined;
  /** Each behavior's `inspect` that answers for it, by name. */
  behaviors: Readonly<Record<BehaviorName, JsonValue | undefined>>;
  /** Rapier: linear (metres per second) and angular velocity; other bodies: their own inspect. */
  body?: { velocity: Vec2; angular: number; sleeping: boolean } | null;
  timers: readonly InspectedTimer[];
  /** Ids of what it touches now: watched contacts and what its sensors hold. */
  contacts: readonly string[];
  /** What game code made for it (a motion body, a grid stepper, a controller), by owner name. */
  owners?: Readonly<Record<string, JsonValue | undefined>>;
};

/** One row of the play outliner: `at` in world metres, null for an entity without a pose. */
export type EntityRow = { id: string; type: string; enabled: boolean; at: Vec2 | null };

const copyPose = (p: Readonly<Pose> | undefined): Pose | null =>
  p ? { x: p.x, y: p.y, rot: p.rot } : null;

const isRecord = (v: JsonValue | undefined): v is { [k: string]: JsonValue } =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** JSON through and through: what a worker link carries unchanged. */
const plain = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function timersOf(ctx: EngineContext, id: string): InspectedTimer[] {
  const timers = ctx.timers as Partial<RuntimeTimers> & {
    owned?: (owner: string) => readonly InspectedTimer[];
  };
  if (typeof timers.owned === "function") return timers.owned(id).map((t) => ({ ...t }));
  const out: InspectedTimer[] = [];
  for (const t of timers.capture?.(ctx.tick).timers ?? [])
    if (t.owner === id) out.push({ id: t.id, due: t.due, kind: t.period ? "every" : "after" });
  for (const t of timers.unsaveable?.() ?? [])
    if (t.owner === id)
      out.push({ id: t.id, due: -1, kind: t.kind === "coroutine" ? "co" : "after" });
  return out.sort((a, b) => a.id - b.id);
}

function contactsOf(ctx: EngineContext, id: string, inspects: readonly JsonValue[]): string[] {
  const touching = new Set<string>();
  const contacts = ctx.contacts as Partial<RuntimeContacts>;
  for (const watch of contacts.capture?.() ?? [])
    for (const [a, b] of watch) {
      if (a === id) touching.add(b);
      else if (b === id) touching.add(a);
    }
  for (const v of inspects)
    if (isRecord(v) && Array.isArray(v.inside))
      for (const other of v.inside)
        if (typeof other === "string" && other !== id) touching.add(other);
  return [...touching];
}

function ownersOf(ctx: EngineContext, id: string): Record<string, JsonValue | undefined> {
  const registry = saveRegistryOf(ctx) as {
    inspect?: (id: string) => Record<string, JsonValue | undefined>;
  } | null;
  return typeof registry?.inspect === "function" ? registry.inspect(id) : {};
}

function bodyOf(
  ctx: EngineContext,
  id: string,
  inspects: readonly JsonValue[],
): EntityInspection["body"] {
  if (!ctx.bodies.has(id)) return null;
  const v = ctx.bodies.velocity(id);
  const sleeping = inspects.some((i) => isRecord(i) && i.sleeping === true);
  return { velocity: { x: v.x, y: v.y }, angular: ctx.bodies.angularVelocity(id), sleeping };
}

/** Everything a debugger shows of `id`, loaded or spawned, enabled or not; null for an id that isn't live. */
export function inspectEntity(runtime: SceneRuntimeHandle, id: string): EntityInspection | null {
  const { ctx } = runtime;
  const entity = ctx.get(id);
  if (!entity) return null;
  const system = ctx.system(entity.type)?.inspect?.(id);
  const behaviors: Record<BehaviorName, JsonValue | undefined> = {};
  for (const name of ctx.registry.behaviorNames) {
    const shown = ctx.behavior(name)?.inspect?.(id);
    if (shown !== undefined) behaviors[name] = shown;
  }
  const inspects = [system, ...Object.values(behaviors)].filter((v) => v !== undefined);
  return plain({
    id,
    type: entity.type,
    enabled: ctx.enabled(id),
    parent: ctx.tree.parent(id),
    pose: copyPose(ctx.poses.get(id)),
    prevPose: copyPose(ctx.poses.prev(id)),
    entity,
    system,
    behaviors,
    body: bodyOf(ctx, id, inspects),
    timers: timersOf(ctx, id),
    contacts: contactsOf(ctx, id, inspects),
    owners: ownersOf(ctx, id),
  });
}

/**
 * The entities `sel` selects, in spawn order. Without `sel`, every live
 * entity, disabled ones too; a selector keeps its own `enabled` default.
 */
export function listEntities(
  runtime: SceneRuntimeHandle,
  sel?: EntitySelector,
): readonly EntityRow[] {
  const { ctx } = runtime;
  const rows: EntityRow[] = [];
  for (const id of ctx.query.select(sel ?? { enabled: false })) {
    const entity = ctx.get(id);
    if (!entity) continue;
    const p = ctx.poses.get(id);
    rows.push({
      id,
      type: entity.type,
      enabled: ctx.enabled(id),
      at: p ? { x: p.x, y: p.y } : null,
    });
  }
  return rows;
}

/**
 * The topmost enabled entity whose extent contains `p` (world metres): the
 * highest draw layer, then the highest `z`, then the latest spawn. Camera
 * regions and editor-only layers never draw in play, so they aren't picked.
 * Null for none.
 */
export function pickEntity(runtime: SceneRuntimeHandle, p: Vec2): string | null {
  const { ctx } = runtime;
  const { layers, types } = ctx.registry;
  let best: { id: string; layer: number; z: number } | null = null;
  for (const id of ctx.query.at(p)) {
    const entity = ctx.get(id);
    if (!entity || isCameraRegionType(types.get(entity.type))) continue;
    const layer = layerOrder(entityHomeLayer(ctx, id, entity));
    if (layers.some((l) => l.editorOnly && l.draw === layer)) continue;
    const z = entity.z ?? 0;
    if (!best || layer > best.layer || (layer === best.layer && z >= best.z))
      best = { id, layer, z };
  }
  return best?.id ?? null;
}
