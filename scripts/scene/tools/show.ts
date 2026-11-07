import {
  aabb,
  bulkEntries,
  closest,
  geometryFields,
  groupOrigin,
  instanceOrigin,
  parseShape,
  resolveSceneDetailed,
  sceneHash,
  topSpan,
  translateShape,
  type Aabb,
  type EntityDef,
  type ExpandedScene,
  type PathDef,
  type PrefabLibrary,
  type Pt,
  type Registry,
  type SceneDefinition,
  type ShapeObj,
  type ShapeTuple,
} from "@jams/engine/scene";

import { openScene, usage, type Tool } from "../context";

const addPt = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];

export type ShowInput = { scene?: string; ref?: string; type?: string; near?: string };

/** Rows past this are left out and the report says `truncated`; filters narrow it. */
export const MAX_ROWS = 200;

export type ShownEntity = {
  ref: string;
  type: string;
  bulk?: boolean;
  material?: string;
  shape?: ShapeTuple;
  at?: Pt;
  /** World-space; a shape that rides a path is placed at its first point. */
  aabb?: Aabb;
  /** `[x0, x1, y]`, the walkable top edge. */
  top?: [number, number, number];
  /** On an instance: the prefab it places. */
  prefab?: string;
  /** On an instance's child (`gate-3/door`, world coordinates): its instance. */
  instance?: string;
  /** On a group member: the group's origin; `shape` and `at` are relative to it, the AABB isn't. */
  origin?: Pt;
  extra?: Record<string, unknown>;
};

export function countEntities(scene: ExpandedScene): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of scene.entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return counts;
}

function geometry(tuple: ShapeTuple, offset?: Pt): Pick<ShownEntity, "aabb" | "top"> {
  const parsed = parseShape(tuple);
  if (!parsed.ok) return {};
  const shape: ShapeObj = offset ? translateShape(parsed.shape, offset) : parsed.shape;
  return { aabb: aabb(shape), top: topSpan(shape) };
}

/** An entity's first shape, point and path fields come out as `shape`, `at` and the AABB; every other field is `extra`. */
function entityRow(e: EntityDef, registry: Registry, origin?: Pt): ShownEntity {
  const { id, type, material, ...fields } = e;
  const row: ShownEntity = { ref: id, type };
  if (typeof material === "string") row.material = material;
  if (origin) row.origin = origin;
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
  }
  if (shapeField !== undefined) {
    row.shape = fields[shapeField] as ShapeTuple;
    delete fields[shapeField];
    const first = path?.pts[0];
    const offset = origin && first ? addPt(origin, first) : (origin ?? first);
    Object.assign(row, geometry(row.shape, offset));
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
  for (const e of def.entities ?? []) {
    rows.push(entityRow(e, registry, e.group ? groupOrigin(def, e.group) : undefined));
  }
  if (!def.instances?.length) return rows;
  const resolved = resolveSceneDetailed(def, registry, prefabs);
  const children = new Map<number, ShownEntity[]>();
  resolved.origins.forEach((o, i) => {
    if (o.kind !== "child") return;
    const row = entityRow(resolved.def.entities![i]!, registry);
    row.instance = def.instances![o.instance]!.id;
    children.set(o.instance, [...(children.get(o.instance) ?? []), row]);
  });
  def.instances.forEach((inst, i) => {
    const { id, prefab, at: _at, ...rest } = inst;
    const row: ShownEntity = { ref: id, type: "instance", prefab, at: instanceOrigin(def, inst) };
    if (Object.keys(rest).length > 0) row.extra = rest;
    rows.push(row, ...(children.get(i) ?? []));
  });
  return rows;
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
  if (row.at) {
    const [ox, oy] = row.origin ?? [0, 0];
    return Math.hypot(row.at[0] + ox - x, row.at[1] + oy - y);
  }
  return Infinity;
}

function rowLine(r: ShownEntity): string {
  const box = r.aabb ? ` aabb ${r.aabb.minX},${r.aabb.minY}..${r.aabb.maxX},${r.aabb.maxY}` : "";
  const top = r.top ? ` top ${r.top[0]}..${r.top[1]}@${r.top[2]}` : "";
  const at = r.at ? ` at ${r.at.join(",")}` : "";
  const shape = r.shape ? ` ${JSON.stringify(r.shape)}` : "";
  const mat = r.material ? `:${r.material}` : "";
  const of = r.prefab ? ` of ${r.prefab}` : "";
  return `${r.ref}  ${r.type}${of}${mat}${shape}${at}${box}${top}`;
}

export const show: Tool<ShowInput> = async (input, ctx) => {
  const loaded = await openScene(ctx, input.scene, "show");
  if (!loaded.ok) return loaded.result;
  const { def, registry, prefabs } = loaded;
  const near = input.near === undefined ? undefined : parseNear(input.near);
  if (near === null) return usage("--near x,y,r (numbers, r >= 0)");
  if (input.type !== undefined && !registry.types.has(input.type)) {
    const guess = closest(input.type, registry.typeNames);
    return usage(
      `--type ${JSON.stringify(input.type)} is not a type of ${registry.id}${guess ? `; did you mean "${guess}"?` : ""} (one of ${registry.typeNames.join(", ")})`,
    );
  }

  const all = sceneRows(def, registry, prefabs);
  let rows = all;
  if (input.ref) rows = rows.filter((r) => r.ref === input.ref);
  if (input.type) rows = rows.filter((r) => r.type === input.type);
  if (near) rows = rows.filter((r) => distanceTo(r, [near[0], near[1]]) <= near[2]);

  const hash = sceneHash(def);
  const total = rows.length;
  const truncated = total > MAX_ROWS;
  const shown = truncated ? rows.slice(0, MAX_ROWS) : rows;
  const data = {
    ok: true,
    scene: loaded.name,
    game: def.game ?? null,
    sceneHash: hash,
    bounds: def.bounds,
    ...(def.settings ? { settings: def.settings } : {}),
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
  const head = `${loaded.name} ${hash} game ${def.game ?? "(none)"} bounds ${def.bounds.join(",")}${settings}`;
  const more = truncated
    ? [`(${total - MAX_ROWS} more rows; narrow with --ref, --type or --near)`]
    : [];
  return { exitCode: 0, data, text: [head, ...shown.map(rowLine), ...more].join("\n") };
};
