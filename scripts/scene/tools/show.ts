import {
  aabb,
  BEHAVIORS,
  BULK_KEYS,
  closest,
  parseShape,
  sceneHash,
  topSpan,
  translateShape,
  type Aabb,
  type EntityDef,
  type ExpandedScene,
  type Pt,
  type SceneDefinition,
  type ShapeObj,
  type ShapeTuple,
} from "@jams/engine/scene";

import { loadScene, usage, type Tool } from "../context";

export type ShowInput = { scene?: string; ref?: string; behavior?: string; near?: string };

/** Rows past this are left out and the report says `truncated`; filters narrow it. */
export const MAX_ROWS = 200;

export type ShownEntity = {
  ref: string;
  b: string;
  bulk?: boolean;
  material?: string;
  shape?: ShapeTuple;
  at?: Pt;
  /** World-space; a mover's is at its first path point. */
  aabb?: Aabb;
  /** `[x0, x1, y]`, the walkable top edge. */
  top?: [number, number, number];
  extra?: Record<string, unknown>;
};

export function countEntities(scene: ExpandedScene): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of scene.entities) counts[e.b] = (counts[e.b] ?? 0) + 1;
  return counts;
}

function geometry(tuple: ShapeTuple, offset?: Pt): Pick<ShownEntity, "aabb" | "top"> {
  const parsed = parseShape(tuple);
  if (!parsed.ok) return {};
  const shape: ShapeObj = offset ? translateShape(parsed.shape, offset) : parsed.shape;
  return { aabb: aabb(shape), top: topSpan(shape) };
}

function entityRow(e: EntityDef): ShownEntity {
  const { id, b } = e;
  const meta: Record<string, unknown> = {};
  if (e.name) meta.name = e.name;
  if (e.layer) meta.layer = e.layer;
  if (e.group) meta.group = e.group;
  if (e.off) meta.off = true;
  const withMeta = (row: ShownEntity): ShownEntity =>
    Object.keys(meta).length > 0 ? { ...row, extra: { ...meta, ...row.extra } } : row;

  switch (e.b) {
    case "solid":
    case "cloud":
      return withMeta({
        ref: id,
        b,
        ...("material" in e && e.material ? { material: e.material } : {}),
        shape: e.shape,
        ...geometry(e.shape),
      });
    case "sensor":
      return withMeta({
        ref: id,
        b,
        shape: e.shape,
        ...geometry(e.shape),
        extra: { kind: e.kind },
      });
    case "prop":
      return withMeta({
        ref: id,
        b,
        shape: e.shape,
        ...geometry(e.shape),
        extra: { density: e.density, restitution: e.restitution, friction: e.friction },
      });
    case "mover":
      return withMeta({
        ref: id,
        b,
        ...(e.material ? { material: e.material } : {}),
        shape: e.shape,
        ...geometry(e.shape, e.path.pts[0]),
        extra: { path: e.path },
      });
    case "anchor":
      return withMeta({ ref: id, b, at: e.at });
    case "construct":
      return withMeta({ ref: id, b, at: e.at, extra: { type: e.type, rot: e.rot ?? 0 } });
    case "note":
      return withMeta({ ref: id, b, at: e.at, extra: { text: e.text } });
  }
}

/** Every bulk entry and entity, with its reference and derived geometry, in file order. */
export function sceneRows(def: SceneDefinition): ShownEntity[] {
  const rows: ShownEntity[] = [];
  for (const key of BULK_KEYS) {
    const bucket = def[key];
    if (!bucket) continue;
    bucket.forEach((value, i) => {
      const ref = `~${key}:${i}`;
      if (key === "anchor") {
        rows.push({ ref, b: "anchor", bulk: true, at: value as Pt });
        return;
      }
      const tuple = value as ShapeTuple;
      const [b, material] = key.split(":");
      rows.push({
        ref,
        b: b!,
        bulk: true,
        ...(material ? { material } : {}),
        shape: tuple,
        ...geometry(tuple),
      });
    });
  }
  for (const e of def.entities ?? []) rows.push(entityRow(e));
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
  if (row.at) return Math.hypot(row.at[0] - x, row.at[1] - y);
  return Infinity;
}

function rowLine(r: ShownEntity): string {
  const box = r.aabb ? ` aabb ${r.aabb.minX},${r.aabb.minY}..${r.aabb.maxX},${r.aabb.maxY}` : "";
  const top = r.top ? ` top ${r.top[0]}..${r.top[1]}@${r.top[2]}` : "";
  const at = r.at ? ` at ${r.at.join(",")}` : "";
  const shape = r.shape ? ` ${JSON.stringify(r.shape)}` : "";
  const mat = r.material ? `:${r.material}` : "";
  return `${r.ref}  ${r.b}${mat}${shape}${at}${box}${top}`;
}

export const show: Tool<ShowInput> = async (input, ctx) => {
  const loaded = await loadScene(ctx, input.scene, "show");
  if (!loaded.ok) return loaded.result;
  const { def } = loaded;
  const near = input.near === undefined ? undefined : parseNear(input.near);
  if (near === null) return usage("--near x,y,r (numbers, r >= 0)");
  if (input.behavior !== undefined && !(BEHAVIORS as readonly string[]).includes(input.behavior)) {
    const guess = closest(input.behavior, BEHAVIORS);
    return usage(
      `--behavior ${JSON.stringify(input.behavior)} is not a behavior${guess ? `; did you mean "${guess}"?` : ""} (one of ${BEHAVIORS.join(", ")})`,
    );
  }

  const all = sceneRows(def);
  let rows = all;
  if (input.ref) rows = rows.filter((r) => r.ref === input.ref);
  if (input.behavior) rows = rows.filter((r) => r.b === input.behavior);
  if (near) rows = rows.filter((r) => distanceTo(r, [near[0], near[1]]) <= near[2]);

  const hash = sceneHash(def);
  const total = rows.length;
  const truncated = total > MAX_ROWS;
  const shown = truncated ? rows.slice(0, MAX_ROWS) : rows;
  const data = {
    ok: true,
    scene: loaded.name,
    sceneHash: hash,
    bounds: def.bounds,
    spawn: def.spawn,
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
  const head = `${loaded.name} ${hash} bounds ${def.bounds.join(",")} spawn ${def.spawn
    .map((p) => p.join(","))
    .join(" ")}`;
  const more = truncated
    ? [`(${total - MAX_ROWS} more rows; narrow with --ref, --behavior or --near)`]
    : [];
  return { exitCode: 0, data, text: [head, ...shown.map(rowLine), ...more].join("\n") };
};
