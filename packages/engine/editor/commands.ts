import type { Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import { parseBulkId } from "../scene/expand";
import { CHILD_SEPARATOR, parseChildRef } from "../scene/resolve";
import type { Aabb, OpBatch, Pt, Ref, SceneDefinition, SceneOp } from "../scene/types";
import { snapToPixel } from "../scene/units";
import { moveBatch } from "./gizmos/batch";
import { shapePivot } from "./gizmos/handles";
import { rotateTargetsBatch, selectionBox } from "./gizmos/multi";
import { gizmoTarget, type GizmoTarget } from "./gizmos/target";
import { buildOutline } from "./outline";
import { outlineBounds, outlineLook } from "./outline-bounds";
import type { PickLayers } from "./picking";
import { docRefs } from "./refs";
import type { SpatialIndex } from "./tools";

/** World px a coarse (Shift) nudge moves. */
export const COARSE_NUDGE_STEPS = 10;

const DIRECTIONS: Record<string, Pt> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/**
 * The offset, in metres, a `nudge-<dir>[-coarse|-fine]` command moves by:
 * one world px at `pxPerMetre` (also with `-fine`), ten with `-coarse`.
 * `null` for any other command.
 */
export function nudgeDelta(command: string, pxPerMetre: number): Pt | null {
  const m = /^nudge-(up|down|left|right)(?:-(coarse|fine))?$/.exec(command);
  if (!m) return null;
  const [dx, dy] = DIRECTIONS[m[1]!]!;
  const by = snapToPixel((m[2] === "coarse" ? COARSE_NUDGE_STEPS : 1) / pxPerMetre, pxPerMetre);
  return [dx * by + 0, dy * by + 0];
}

/** The selection's editable targets, in selection order; refs without geometry are left out. */
export function targetsOf(
  def: SceneDefinition,
  registry: Registry,
  refs: readonly Ref[],
): GizmoTarget[] {
  return refs
    .map((r) => gizmoTarget(def, registry, r))
    .filter((t): t is GizmoTarget => t !== undefined);
}

/** What a selection turns about: one shape's pivot, else the centre of the box around all of it. */
export function rotationPivot(targets: readonly GizmoTarget[]): Pt | null {
  if (targets.length === 0) return null;
  const only = targets.length === 1 ? targets[0]! : undefined;
  if (only?.shape) return shapePivot(only.shape);
  const b = selectionBox(targets);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

/** One batch moving `refs` by `delta`, on whole world px; `null` when nothing moves. */
export function nudgeBatch(refs: readonly Ref[], delta: Pt, pxPerMetre: number): OpBatch | null {
  const label = `Nudge ${refs.length === 1 ? refs[0] : `${refs.length} entities`}`;
  return moveBatch(refs, delta, pxPerMetre, label);
}

/** One batch turning the selection `deg` degrees (clockwise on screen) about its pivot. */
export function rotateSelectionBatch(
  def: SceneDefinition,
  registry: Registry,
  refs: readonly Ref[],
  deg: number,
): OpBatch | null {
  const targets = targetsOf(def, registry, refs);
  const about = rotationPivot(targets);
  return about ? rotateTargetsBatch(targets, about, deg, pxPerMetreOf(registry)) : null;
}

/**
 * The box around what the selection outlines (`outlineBounds` with the
 * registry's look), an instance by its children: the box the selection's
 * outline, its gizmo and a tool's offer sit on. `null` when nothing in it
 * draws. Framing goes by `frameBounds`, which also takes in the paths movers
 * travel.
 */
export function selectionBounds(
  def: SceneDefinition,
  registry: Registry,
  refs: readonly Ref[],
): Aabb | null {
  return outlineBounds(def, refs, outlineLook(registry));
}

/** Every ref in the document, in file order, except those on a hidden or locked layer. */
export function selectAllRefs(
  def: SceneDefinition,
  index: SpatialIndex,
  layers?: PickLayers,
): Ref[] {
  return docRefs(def).filter((r) => {
    const layer = index.get(r)?.layer;
    return !layers || !layer || (!layers.hidden.has(layer) && !layers.locked.has(layer));
  });
}

/** One batch removing `refs`; `null` for an empty selection. */
export function deleteBatch(refs: readonly Ref[]): OpBatch | null {
  if (refs.length === 0) return null;
  const unique = [...new Set(refs)];
  return {
    label: `Delete ${unique.length === 1 ? unique[0] : `${unique.length} entities`}`,
    ops: [{ op: "remove", refs: unique }],
  };
}

/**
 * One batch raising (`by` 1, bring forward) or lowering (`by` -1, send
 * backward) the `z` of the selected entities and instances. Bulk entries,
 * including an instance's bulk children, carry no `z` and are left out;
 * `null` when nothing is left.
 */
export function zOrderBatch(refs: readonly Ref[], by: 1 | -1): OpBatch | null {
  const placed = [...new Set(refs)].filter(
    (r) => !parseBulkId(r.slice(r.lastIndexOf(CHILD_SEPARATOR) + 1)),
  );
  if (placed.length === 0) return null;
  const n = placed.length === 1 ? placed[0]! : `${placed.length} entities`;
  return {
    label: by > 0 ? `Bring ${n} forward` : `Send ${n} backward`,
    ops: [{ op: "setZ", refs: placed, by }],
  };
}

export type QuarterTurnTargets = {
  /** Selected instances (by id, or through a child) outside the groups below, in selection order. */
  instances: string[];
  /** Declared groups every member of which is selected, in declaration order. */
  groups: string[];
  /** What neither covers: plain entities and bulk entries. */
  rest: Ref[];
};

/**
 * What a turn or flip of `refs` acts on in `def` (the document, not the
 * resolved view): instances and whole groups, which turn by quarter turns
 * and flip exactly.
 */
export function quarterTurnTargets(def: SceneDefinition, refs: readonly Ref[]): QuarterTurnTargets {
  const instances = def.instances ?? [];
  const known = new Set(instances.map((i) => i.id));
  const instanceOf = (r: Ref) => {
    const id = parseChildRef(r)?.instance ?? r;
    return known.has(id) ? id : undefined;
  };
  const picked = new Set(refs.flatMap((r) => instanceOf(r) ?? []));
  const sel = new Set(refs);
  const entities = def.entities ?? [];
  const groups = Object.keys(def.groups ?? {}).filter((g) => {
    const ents = entities.filter((e) => e.group === g);
    const insts = instances.filter((i) => i.group === g);
    return (
      ents.length + insts.length > 0 &&
      ents.every((e) => sel.has(e.id)) &&
      insts.every((i) => picked.has(i.id))
    );
  });
  const whole = new Set(groups);
  const groupOf = new Map<string, string | undefined>([
    ...entities.map((e): [string, string | undefined] => [e.id, e.group]),
    ...instances.map((i): [string, string | undefined] => [i.id, i.group]),
  ]);
  const inWhole = (id: string) => {
    const g = groupOf.get(id);
    return g !== undefined && whole.has(g);
  };
  const out: QuarterTurnTargets = { instances: [], groups, rest: [] };
  for (const r of new Set(refs)) {
    const inst = instanceOf(r);
    if (inst !== undefined) {
      if (!inWhole(inst) && !out.instances.includes(inst)) out.instances.push(inst);
    } else if (!inWhole(r)) out.rest.push(r);
  }
  return out;
}

function transformBatch(
  def: SceneDefinition,
  refs: readonly Ref[],
  label: (what: string) => string,
  change: { turn: 1 | -1 } | { flip: "x" | "y" },
): OpBatch | null {
  const t = quarterTurnTargets(def, refs);
  const n = t.instances.length + t.groups.length;
  if (n === 0) return null;
  const what = n === 1 ? (t.instances[0] ?? t.groups[0]!) : `${n} items`;
  return {
    label: label(what),
    ops: [
      {
        op: "transform",
        ...(t.instances.length > 0 ? { refs: t.instances } : {}),
        ...(t.groups.length > 0 ? { groups: t.groups } : {}),
        ...change,
      },
    ],
  };
}

/**
 * One batch turning the selected instances and whole groups a quarter turn
 * (`turn` 1 clockwise on screen, -1 counter-clockwise), each about its own
 * `at`. Plain entities in the selection are left out; `null` when nothing
 * is left.
 */
export function turnBatch(
  def: SceneDefinition,
  refs: readonly Ref[],
  turn: 1 | -1,
): OpBatch | null {
  const dir = turn > 0 ? "clockwise" : "counter-clockwise";
  return transformBatch(def, refs, (w) => `Turn ${w} ${dir}`, { turn });
}

/**
 * One batch mirroring the selected instances and whole groups across the
 * world axis: `x` flips left and right, `y` up and down, each about its own
 * `at`. `null` when the selection holds neither.
 */
export function flipBatch(
  def: SceneDefinition,
  refs: readonly Ref[],
  axis: "x" | "y",
): OpBatch | null {
  const dir = axis === "x" ? "horizontally" : "vertically";
  return transformBatch(def, refs, (w) => `Flip ${w} ${dir}`, { flip: axis });
}

const groupsOf = (def: SceneDefinition) =>
  new Set((def.entities ?? []).flatMap((e) => (typeof e.group === "string" ? [e.group] : [])));

/** The first `group-<n>` no entity uses. */
export function nextGroupName(def: SceneDefinition): string {
  const taken = groupsOf(def);
  for (let n = 1; ; n++) if (!taken.has(`group-${n}`)) return `group-${n}`;
}

const entityRefs = (refs: readonly Ref[]) => refs.filter((r) => !parseBulkId(r));

/**
 * One batch putting the selected entities in a group (their `group` field),
 * a new one unless `name` is given. Bulk entries have no fields, so they are
 * left out; `null` when no entity is selected or all are already in it.
 */
export function groupBatch(
  def: SceneDefinition,
  refs: readonly Ref[],
  name = nextGroupName(def),
): OpBatch | null {
  const byId = new Map((def.entities ?? []).map((e) => [e.id, e]));
  const ops: SceneOp[] = entityRefs(refs)
    .filter((r) => byId.has(r) && byId.get(r)!.group !== name)
    .map((ref) => ({ op: "update", ref, set: { group: name } }));
  return ops.length > 0 ? { label: `Group ${ops.length} as ${name}`, ops } : null;
}

/** One batch taking the selected entities out of their groups; `null` when none is in one. */
export function ungroupBatch(def: SceneDefinition, refs: readonly Ref[]): OpBatch | null {
  const byId = new Map((def.entities ?? []).map((e) => [e.id, e]));
  const ops: SceneOp[] = entityRefs(refs)
    .filter((r) => byId.get(r)?.group !== undefined)
    .map((ref) => ({ op: "update", ref, unset: ["group"] }));
  return ops.length > 0 ? { label: `Ungroup ${ops.length}`, ops } : null;
}

const sameSet = (a: readonly Ref[], b: readonly Ref[]) =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;

/**
 * `[`: the selection's parent. Inside a group not wholly selected, the whole
 * group; otherwise everything under the first selected ref's outline row
 * (its bulk key, or its type), climbing past rows that hold exactly the
 * selection. `null` at the top.
 */
export function hierarchyUp(
  def: SceneDefinition,
  registry: Registry,
  sel: readonly Ref[],
): Ref[] | null {
  const first = sel[0];
  if (first === undefined) return null;
  const group = (def.entities ?? []).find((e) => e.id === first)?.group;
  if (group !== undefined) {
    const members = (def.entities ?? []).filter((e) => e.group === group).map((e) => e.id);
    if (!members.every((m) => sel.includes(m))) return members;
  }
  const rows = buildOutline(def, registry);
  const at = rows.findIndex((r) => r.ref === first);
  if (at < 0) return null;
  // Climb past rows whose contents are already exactly the selection.
  for (let row = at; ; ) {
    let parent = row - 1;
    while (parent >= 0 && rows[parent]!.depth >= rows[row]!.depth) parent--;
    if (parent < 0) return null;
    const under: Ref[] = [];
    for (let i = parent + 1; i < rows.length && rows[i]!.depth > rows[parent]!.depth; i++) {
      const ref = rows[i]!.ref;
      if (ref !== undefined) under.push(ref);
    }
    if (!sameSet(under, sel)) return under;
    row = parent;
  }
}

/** `]`: from a selection of several, its first ref in outline order; `null` for one or none. */
export function hierarchyDown(
  def: SceneDefinition,
  registry: Registry,
  sel: readonly Ref[],
): Ref[] | null {
  if (sel.length < 2) return null;
  const has = new Set(sel);
  const first = buildOutline(def, registry).find((r) => r.ref !== undefined && has.has(r.ref));
  return [first?.ref ?? sel[0]!];
}
