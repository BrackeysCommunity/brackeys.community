import { pxPerMetreOf, type TimeKind } from "@jams/engine/game";
import { cameraRegionsOf, type CameraRegion } from "@jams/engine/headless";
import type { ProjectView } from "@jams/engine/project";
import {
  aabb,
  bulkEntries,
  closest,
  compose,
  decodeRow,
  expandScene,
  frameOf,
  geometryFields,
  gridCellBounds,
  IDENTITY_2D,
  instanceSteps,
  isGridValue,
  parseShape,
  resolvePrefab,
  resolveSceneDetailed,
  resolveTime,
  roundLength,
  sceneHash,
  scenePhysics,
  sceneSprites,
  topSpan,
  translateShape,
  type Aabb,
  type EntityDef,
  type GridCells,
  type ExpandedScene,
  type InstanceDef,
  type Orientation,
  type PathDef,
  type PrefabLibrary,
  type Pt,
  type Registry,
  type SceneDefinition,
  type ShapeObj,
  type ShapeTuple,
  type Transform2D,
} from "@jams/engine/scene";

import { openScene, usage, type Tool } from "../context";
import { roundBox, sceneProjectView } from "./render";
import { projectEngine } from "./step";

export type ShowInput = {
  scene?: string;
  ref?: string;
  type?: string;
  near?: string;
  /** Rows under their parents, depth first, each with its `depth`. */
  tree?: boolean;
};

/** Rows past this are left out and the report says `truncated`; filters narrow it. */
export const MAX_ROWS = 200;

export type ShownEntity = {
  ref: string;
  type: string;
  bulk?: boolean;
  material?: string;
  /** Metres, as the file writes it. */
  shape?: ShapeTuple;
  /** Metres. */
  at?: Pt;
  /** World-space metres; a shape that rides a path is placed at its first point. */
  aabb?: Aabb;
  /** `[x0, x1, y]`, the walkable top edge, metres. */
  top?: [number, number, number];
  /** The parent it names: an entity's or instance's own, an instance child's remapped under its instance. */
  parent?: string;
  /** On an instance: the prefab it places. */
  prefab?: string;
  /** On an instance's child (`gate-3/door`, world coordinates): its instance. */
  instance?: string;
  /** On a nested child (`room-1/door-1/panel`): the instance ids from the scene down, `["room-1", "door-1"]`. */
  instancePath?: string[];
  /** On an instance: the instances nested in it at any depth, by ref below it (`door-1`, `door-1/latch`). */
  nested?: string[];
  /**
   * On a parented entity or a child: where the frame its geometry is stored in
   * stands in the world; `shape` and `at` are in that frame, the AABB isn't.
   */
  origin?: Pt;
  /** Draw order: an entity's own, a child's with its instances' added, an instance's offset. */
  z?: number;
  /**
   * The world angle (degrees clockwise) and flip of the frame its geometry
   * is stored in: its parent chain's; on an instance or an
   * instance's child, the one it is placed with. Absent when there is none.
   */
  transform?: Orientation;
  /** With `--tree`: how many parents are above it. */
  depth?: number;
  /** On an instance: the parameter values it sets. */
  params?: Record<string, unknown>;
  /** On an instance: the parameters its prefab exposes, sorted. */
  exposes?: string[];
  /** Behavior blocks by name. */
  behaviors?: Record<string, unknown>;
  /** What its sprite draws and where: sized from the project's asset info, else the block or 32×32. */
  sprite?: ShownSprite;
  /** Each grid field: filled cells, chunks, and the filled cells' bounds (inclusive). */
  grids?: Record<string, GridSummary>;
  extra?: Record<string, unknown>;
};

export type ShownSprite = {
  /** `asset`, `asset:frame` or `(no asset)`. */
  label: string;
  asset?: string;
  frame?: string;
  /** Metres. */
  size: [w: number, h: number];
  /** The world box it draws, metres. */
  aabb: Aabb;
};

export type GridSummary = {
  cells: number;
  chunks: number;
  bounds: { c0: number; r0: number; c1: number; r1: number } | null;
};

/** World points of rows whose stored `at` is in a parent's frame. */
const WORLD_AT = new WeakMap<ShownEntity, Pt>();

/** The row each row sits under in `--tree`, as the resolver places it. */
const TREE_PARENT = new WeakMap<ShownEntity, string>();

export function gridSummary(grid: GridCells): GridSummary {
  let cells = 0;
  for (const rows of Object.values(grid))
    for (const row of rows) for (const c of decodeRow(row) ?? []) if (c !== 0) cells++;
  return { cells, chunks: Object.keys(grid).length, bounds: gridCellBounds(grid) };
}

const turns = (o: Orientation | undefined): o is Orientation => !!o && (o.rot !== 0 || o.flip);

const composeSteps = (steps: readonly Transform2D[]): Transform2D =>
  steps.reduce((acc, t) => compose(t, acc), IDENTITY_2D);

/**
 * The transforms that take an entity's stored geometry to the world,
 * innermost first: its parent chain's read leniently as the
 * resolver reads it (none for a root, a missing parent or the id a cycle
 * drops).
 */
function storedSteps(
  def: SceneDefinition,
  e: EntityDef,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
): Transform2D[] {
  if (e.parent === undefined) return [];
  const item: InstanceDef = { id: e.id, prefab: "", at: [0, 0], parent: e.parent };
  return instanceSteps(def, item, registry, prefabs).slice(1);
}

export function countEntities(scene: ExpandedScene): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of scene.entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return counts;
}

function geometry(tuple: ShapeTuple, offset?: Pt): Pick<ShownEntity, "aabb" | "top"> {
  const parsed = parseShape(tuple);
  if (!parsed.ok) return {};
  const shape: ShapeObj = offset ? translateShape(parsed.shape, offset) : parsed.shape;
  const [x0, x1, y] = topSpan(shape);
  return { aabb: roundBox(aabb(shape)), top: [roundLength(x0), roundLength(x1), roundLength(y)] };
}

/** An entity's first shape, point and path fields come out as `shape`, `at` and the AABB; every other field is `extra`. */
function entityRow(e: EntityDef, registry: Registry): ShownEntity {
  const { id, type, material, z, behaviors, parent, ...fields } = e;
  const row: ShownEntity = { ref: id, type };
  if (typeof parent === "string") row.parent = parent;
  if (typeof material === "string") row.material = material;
  if (typeof z === "number" && z !== 0) row.z = z;
  if (behaviors && typeof behaviors === "object" && Object.keys(behaviors).length > 0)
    row.behaviors = behaviors as Record<string, unknown>;
  const t = registry.types.get(type);
  let shapeField: string | undefined;
  let path: PathDef | undefined;
  for (const { field, kind } of t ? geometryFields(t) : []) {
    const value = fields[field];
    if (value === undefined) continue;
    if (kind === "shape" && shapeField === undefined) shapeField = field;
    else if (kind === "point" && row.at === undefined) {
      row.at = value as Pt;
      delete fields[field];
    } else if (kind === "path") path ??= value as PathDef;
    else if (kind === "grid" && isGridValue(value)) {
      (row.grids ??= {})[field] = gridSummary(value);
      delete fields[field];
    }
  }
  if (shapeField !== undefined) {
    row.shape = fields[shapeField] as ShapeTuple;
    delete fields[shapeField];
    Object.assign(row, geometry(row.shape, path?.pts[0]));
  }
  if (Object.keys(fields).length > 0) row.extra = fields;
  return row;
}

/**
 * Every bulk entry and entity, with its reference and derived geometry:
 * bulk keys in spawn order, entities in file order, then each instance
 * followed by its children in world coordinates.
 */
export function sceneRows(
  def: SceneDefinition,
  registry: Registry,
  prefabs?: PrefabLibrary,
  project?: ProjectView,
): ShownEntity[] {
  const rows = sceneRowsOf(def, registry, prefabs);
  const sprites = new Map(
    sceneSprites(def, { registry, prefabs, ...(project ? { project } : {}) }).map((s) => [
      s.ref,
      s,
    ]),
  );
  if (sprites.size === 0) return rows;
  for (const row of rows) {
    const s = sprites.get(row.ref);
    if (!s) continue;
    row.sprite = {
      label: s.label,
      ...(s.asset !== undefined ? { asset: s.asset } : {}),
      ...(s.frame !== undefined ? { frame: s.frame } : {}),
      size: [roundLength(s.size[0]), roundLength(s.size[1])],
      aabb: roundBox(s.box),
    };
  }
  return rows;
}

function sceneRowsOf(
  def: SceneDefinition,
  registry: Registry,
  prefabs?: PrefabLibrary,
): ShownEntity[] {
  const rows: ShownEntity[] = [];
  for (const b of registry.bulkKeys) {
    bulkEntries(def, b.key).forEach((value, i) => {
      const row: ShownEntity = { ref: `~${b.key}:${i}`, type: b.type, bulk: true };
      if (b.material) row.material = b.material;
      if (b.form === "point") row.at = value as Pt;
      else {
        row.shape = value as ShapeTuple;
        Object.assign(row, geometry(row.shape));
      }
      rows.push(row);
    });
  }
  const resolved = resolveSceneDetailed(def, registry, prefabs);
  (def.entities ?? []).forEach((e, i) => {
    const row = entityRow(e, registry);
    const steps = storedSteps(def, e, registry, prefabs);
    if (steps.length > 0) {
      const t = composeSteps(steps);
      row.origin = [roundLength(t.tx), roundLength(t.ty)];
      const turn = frameOf(t);
      if (turns(turn)) row.transform = turn;
      const world = entityRow(resolved.def.entities![i]!, registry);
      delete row.aabb;
      delete row.top;
      if (world.aabb) row.aabb = world.aabb;
      if (world.top) row.top = world.top;
      if (world.at) WORLD_AT.set(row, world.at);
      if (row.parent !== undefined) TREE_PARENT.set(row, row.parent);
    }
    rows.push(row);
  });
  if (!def.instances?.length) return rows;
  const children = new Map<number, ShownEntity[]>();
  const nested = new Map<number, Set<string>>();
  resolved.origins.forEach((o, i) => {
    if (o.kind !== "child") return;
    const row = entityRow(resolved.def.entities![i]!, registry);
    row.instance = def.instances![o.instance]!.id;
    if (o.path.length > 1) {
      row.instancePath = o.path;
      const ids = nested.get(o.instance) ?? new Set<string>();
      for (let n = 2; n <= o.path.length; n++) ids.add(o.path.slice(1, n).join("/"));
      nested.set(o.instance, ids);
    }
    if (turns(o.transform)) row.transform = o.transform;
    TREE_PARENT.set(row, row.instance);
    children.set(o.instance, [...(children.get(o.instance) ?? []), row]);
  });
  def.instances.forEach((inst, i) => {
    const { id, prefab, at: _at, rot: _rot, flip: _flip, z, params, parent, ...rest } = inst;
    const steps = instanceSteps(def, inst, registry, prefabs);
    const t = composeSteps(steps);
    const row: ShownEntity = { ref: id, type: "instance" };
    if (parent !== undefined) row.parent = parent;
    row.prefab = prefab;
    row.at = [roundLength(t.tx), roundLength(t.ty)];
    if (parent !== undefined && steps.length > 1) TREE_PARENT.set(row, parent);
    if (typeof z === "number" && z !== 0) row.z = z;
    const turn = frameOf(t);
    if (turns(turn)) row.transform = turn;
    if (params && Object.keys(params).length > 0) row.params = params;
    const resolvedPrefab = prefabs ? resolvePrefab(prefab, prefabs, registry) : null;
    const exposed = resolvedPrefab?.ok ? Object.keys(resolvedPrefab.prefab.params) : [];
    if (exposed.length > 0) row.exposes = exposed.sort();
    const inside = nested.get(i);
    if (inside) row.nested = [...inside];
    if (Object.keys(rest).length > 0) row.extra = rest;
    rows.push(row, ...(children.get(i) ?? []));
  });
  return rows;
}

/** How the scene's clock runs, as Play resolves it: the project's tick rate, else the game's time model. */
export type ShownTime = {
  kind: TimeKind;
  rate: number;
  catchUp: { maxMs: number } | null;
  wakeOnPointerMove: boolean;
};

/** `time turns 60Hz catch-up 3600000ms; physics none, no wasm`. */
export function worldLine(time: ShownTime, physics: "rapier" | "none"): string {
  const catchUp = time.catchUp ? ` catch-up ${time.catchUp.maxMs}ms` : "";
  const pointer = time.wakeOnPointerMove ? " wakes on pointer move" : "";
  const backend = physics === "none" ? "none, no wasm" : physics;
  return `time ${time.kind} ${time.rate}Hz${catchUp}${pointer}; physics ${backend}`;
}

function parseNear(near: string): [number, number, number] | null {
  const parts = near.split(",").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n)) || parts[2]! < 0) return null;
  return parts as [number, number, number];
}

function distanceTo(row: ShownEntity, [x, y]: Pt): number {
  if (row.aabb) {
    const dx = Math.max(row.aabb.minX - x, 0, x - row.aabb.maxX);
    const dy = Math.max(row.aabb.minY - y, 0, y - row.aabb.maxY);
    return Math.hypot(dx, dy);
  }
  const at = WORLD_AT.get(row) ?? (row.origin ? undefined : row.at);
  return at ? Math.hypot(at[0] - x, at[1] - y) : Infinity;
}

/**
 * `rows` depth first under their parents, each given its `depth`: roots in
 * row order, each followed by its children in row order. A row sits under
 * the parent the resolver places it by; an instance's child under its
 * parent in the prefab, else its instance.
 */
export function treeRows(rows: readonly ShownEntity[]): ShownEntity[] {
  const known = new Set(rows.map((r) => r.ref));
  const parentOf = (r: ShownEntity): string | undefined => {
    if (r.instance !== undefined && r.parent !== undefined && known.has(r.parent)) return r.parent;
    const p = TREE_PARENT.get(r);
    return p !== undefined && known.has(p) ? p : undefined;
  };
  const kids = new Map<string, ShownEntity[]>();
  const roots: ShownEntity[] = [];
  for (const r of rows) {
    const p = parentOf(r);
    if (p === undefined) roots.push(r);
    else kids.set(p, [...(kids.get(p) ?? []), r]);
  }
  const out: ShownEntity[] = [];
  const seen = new Set<string>();
  const visit = (r: ShownEntity, depth: number) => {
    if (seen.has(r.ref)) return;
    seen.add(r.ref);
    r.depth = depth;
    out.push(r);
    for (const k of kids.get(r.ref) ?? []) visit(k, depth + 1);
  };
  for (const r of roots) visit(r, 0);
  for (const r of rows) visit(r, 0);
  return out;
}

/** `x0,y0..x1,y1 m`. */
export const boxText = (b: Aabb) => `${b.minX},${b.minY}..${b.maxX},${b.maxY} m`;

/**
 * The scene's camera regions as the camera rig reads them from the expanded
 * scene (`cameraRegionsOf`): instance children included, defaults applied.
 */
export function sceneRegions(
  def: SceneDefinition,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  engine: Readonly<Record<string, unknown>> | undefined,
): CameraRegion[] {
  const scene = expandScene(def, registry, { prefabs, engine });
  return cameraRegionsOf(scene.entities, registry).map((r) => {
    const b = roundBox({ minX: r.min.x, minY: r.min.y, maxX: r.max.x, maxY: r.max.y });
    return { ...r, min: { x: b.minX, y: b.minY }, max: { x: b.maxX, y: b.maxY } };
  });
}

/** `framing 9,0.5..21,7.5 m zoom 1.5 clamp ease 0.5 s`. */
export function regionLine(r: CameraRegion): string {
  const zoom = r.zoom === undefined ? "" : ` zoom ${r.zoom}`;
  const box = boxText({ minX: r.min.x, minY: r.min.y, maxX: r.max.x, maxY: r.max.y });
  return `  ${r.id} ${box}${zoom} ${r.clamp ? "clamp" : "no clamp"} ease ${r.ease} s`;
}

/** One row as text; lengths are metres, each followed by its unit. */
function rowLine(r: ShownEntity): string {
  const box = r.aabb ? ` aabb ${boxText(r.aabb)}` : "";
  const top = r.top ? ` top ${r.top[0]}..${r.top[1]}@${r.top[2]} m` : "";
  const at = r.at ? ` at ${r.at.join(",")} m` : "";
  const shape = r.shape ? ` ${JSON.stringify(r.shape)}` : "";
  const mat = r.material ? `:${r.material}` : "";
  const of = r.prefab ? ` of ${r.prefab}` : "";
  const parent = r.parent !== undefined ? ` parent ${r.parent}` : "";
  const origin = r.origin ? ` in ${r.origin.join(",")} m` : "";
  const turn = r.transform ? ` rot ${r.transform.rot}${r.transform.flip ? " flip" : ""}` : "";
  const z = r.z !== undefined ? ` z ${r.z}` : "";
  const params = r.params ? ` params ${JSON.stringify(r.params)}` : "";
  const exposes = r.exposes ? ` exposes ${r.exposes.join(",")}` : "";
  const nested = r.nested ? ` nests ${r.nested.join(",")}` : "";
  const behaviors = r.behaviors ? ` behaviors ${Object.keys(r.behaviors).join(",")}` : "";
  const b = r.sprite?.aabb;
  const sprite = r.sprite ? ` sprite ${r.sprite.label} ${boxText(b!)}` : "";
  const grids = Object.entries(r.grids ?? {})
    .map(([field, { cells, bounds: b }]) => {
      const span = b ? ` ${b.c0},${b.r0}..${b.c1},${b.r1}` : "";
      return ` ${field} ${cells} cells${span}`;
    })
    .join("");
  const geometry = `${shape}${at}${origin}${turn}${z}${box}${top}`;
  const indent = "  ".repeat(r.depth ?? 0);
  return `${indent}${r.ref}  ${r.type}${of}${mat}${parent}${geometry}${params}${exposes}${nested}${behaviors}${sprite}${grids}`;
}

export const show: Tool<ShowInput> = async (input, ctx) => {
  const loaded = await openScene(ctx, input.scene, "show");
  if (!loaded.ok) return loaded.result;
  const { def, registry, prefabs } = loaded;
  const near = input.near === undefined ? undefined : parseNear(input.near);
  if (near === null) return usage("--near x,y,r in metres (numbers, r >= 0)");
  if (input.type !== undefined && !registry.types.has(input.type)) {
    const guess = closest(input.type, registry.typeNames);
    return usage(
      `--type ${JSON.stringify(input.type)} is not a type of ${registry.id}${guess ? `; did you mean "${guess}"?` : ""} (one of ${registry.typeNames.join(", ")})`,
    );
  }

  const flat = sceneRows(def, registry, prefabs, await sceneProjectView(loaded.project));
  const all = input.tree ? treeRows(flat) : flat;
  const engine = await projectEngine(loaded.project, registry);
  const { kind, rate, catchUp, wakeOnPointerMove } = resolveTime({
    project: engine,
    game: registry.time,
  });
  const time: ShownTime = { kind, rate, catchUp, wakeOnPointerMove };
  const physics = scenePhysics(def, registry, engine);
  let rows = all;
  if (input.ref) rows = rows.filter((r) => r.ref === input.ref);
  if (input.type) rows = rows.filter((r) => r.type === input.type);
  if (near) rows = rows.filter((r) => distanceTo(r, [near[0], near[1]]) <= near[2]);

  const hash = sceneHash(def);
  const pxPerMetre = pxPerMetreOf(registry);
  const total = rows.length;
  const truncated = total > MAX_ROWS;
  const shown = truncated ? rows.slice(0, MAX_ROWS) : rows;
  const listed = new Set(rows.map((r) => r.ref));
  const regions = sceneRegions(def, registry, prefabs, engine).filter((r) => listed.has(r.id));
  const data = {
    ok: true,
    scene: loaded.name,
    game: def.game ?? null,
    sceneHash: hash,
    bounds: def.bounds,
    pxPerMetre,
    ...(def.settings ? { settings: def.settings } : {}),
    time,
    physics,
    cameraRegions: regions,
    entities: shown,
    total,
    truncated,
  };
  if (input.ref && rows.length === 0) {
    const guess = closest(
      input.ref,
      all.map((r) => r.ref),
    );
    const hint = guess ? `; did you mean ${guess}?` : "";
    return {
      exitCode: 1,
      data: { ...data, ok: false, error: `No entity or bulk entry ${input.ref}${hint}` },
      text: `error: no entity or bulk entry ${input.ref} in ${loaded.name} (${hash})${hint}`,
    };
  }
  const settings = def.settings ? ` settings ${JSON.stringify(def.settings)}` : "";
  const head = `${loaded.name} ${hash} game ${def.game ?? "(none)"} bounds ${def.bounds.join(",")} m (${pxPerMetre} px/m)${settings}`;
  const more = truncated
    ? [`(${total - MAX_ROWS} more rows; narrow with --ref, --type or --near)`]
    : [];
  return {
    exitCode: 0,
    data,
    text: [
      head,
      worldLine(time, physics),
      ...(regions.length > 0
        ? ["camera regions (as the camera rig reads them):", ...regions.map(regionLine)]
        : []),
      ...shown.map(rowLine),
      ...more,
    ].join("\n"),
  };
};
