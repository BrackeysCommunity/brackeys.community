import { aabbUnion, rotateShape } from "../../scene/shape-geometry";
import type { Aabb, OpBatch, Pt, SceneOp } from "../../scene/types";
import { roundPt, snapAngle, snapMove } from "../snap";
import { moveBatch, normDeg, shapeSet } from "./batch";
import { dragAngle } from "./drag";
import { withPreview, type DragOptions, type GizmoEdit } from "./edit";
import { readAngle, readDelta } from "./readout";
import { treeBox, type GizmoTarget } from "./target";

/** The box around every target and what sits under it, which a multi-selection's gizmo frames. */
export function selectionBox(targets: readonly GizmoTarget[]): Aabb {
  return targets.map(treeBox).reduce(aabbUnion);
}

/** The targets no other target holds in its subtree: what a move or turn writes, since the rest follows. */
export function rootTargets(targets: readonly GizmoTarget[]): GizmoTarget[] {
  const under = new Set(targets.flatMap((t) => t.subtree ?? []));
  return targets.filter((t) => !under.has(t.ref));
}

const samePt = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

const centreOf = (b: Aabb): Pt => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];

function turnPt([x, y]: Pt, about: Pt, deg: number): Pt {
  const rad = deg * (Math.PI / 180);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = x - about[0];
  const dy = y - about[1];
  return [about[0] + dx * c - dy * s, about[1] + dx * s + dy * c];
}

/**
 * One batch turning every target `deg` degrees about `about`: nodes and
 * instances by one `transform` with `rotate` (what sits under them turns
 * with them), shapes about it (boxes and capsules also turn their
 * `rotDeg`), points orbit it, and a target on a path has its waypoints orbit
 * and its local shape turn with them. Targets under another one are left
 * to it. `null` when rounding leaves everything as it was.
 */
export function rotateTargetsBatch(
  targets: readonly GizmoTarget[],
  about: Pt,
  deg: number,
  pxPerMetre: number,
  label = `Rotate ${targets.length === 1 ? targets[0]!.ref : `${targets.length} entities`}`,
): OpBatch | null {
  const ops: SceneOp[] = [];
  const roots = rootTargets(targets);
  const framed = roots.filter((t) => t.frame).map((t) => t.ref);
  if (framed.length > 0 && deg % 360 !== 0) {
    const own = framed.length === 1 && roots.length === 1 && samePt(roots[0]!.frame!.at, about);
    ops.push({ op: "transform", refs: framed, rotate: deg, ...(own ? {} : { about }) });
  }
  for (const t of roots) {
    if (t.frame) continue;
    const set: Record<string, unknown> = {};
    if (t.path && t.local && t.shapeField) {
      const pts = t.path.pts.map((p) => roundPt(turnPt(p, about, deg), pxPerMetre));
      if (JSON.stringify(pts) !== JSON.stringify(t.path.pts)) set[`${t.path.field}.pts`] = pts;
      const local = rotateShape(t.local, [0, 0], deg);
      const shape =
        local.type === "box" || local.type === "capsule"
          ? { ...local, rotDeg: normDeg(local.rotDeg) }
          : local;
      // The local shape is relative to the first waypoint, so it is set as given, not re-based.
      Object.assign(set, shapeSet({ ...t, path: undefined }, shape, pxPerMetre) ?? {});
    } else if (t.shape) {
      const turned = rotateShape(t.shape, about, deg);
      const shape =
        turned.type === "box" || turned.type === "capsule"
          ? { ...turned, rotDeg: normDeg(turned.rotDeg) }
          : turned;
      Object.assign(set, shapeSet(t, shape, pxPerMetre) ?? {});
    } else if (t.at && t.pointField) {
      const at = roundPt(turnPt(t.at, about, deg), pxPerMetre);
      if (at[0] !== t.at[0] || at[1] !== t.at[1]) set[t.pointField] = at;
    }
    if (Object.keys(set).length > 0) ops.push({ op: "update", ref: t.ref, set });
  }
  return ops.length > 0 ? { label, ops } : null;
}

/**
 * A multi-selection's gizmo drag: `move` snaps the selection box and moves
 * every target in one `move`; `rotate` turns them all about the box's
 * centre, the turn snapped to the step (Shift: free). No resize: there's
 * no scaling. `null` for any other handle.
 */
export function dragSelection(
  targets: readonly GizmoTarget[],
  handleId: string,
  from: Pt,
  to: Pt,
  opts: DragOptions,
): GizmoEdit | null {
  if (targets.length === 0) return null;
  const box = selectionBox(targets);
  const refs = rootTargets(targets).map((t) => t.ref);
  if (handleId === "move") {
    const r = snapMove({
      aabb: box,
      grab: from,
      delta: [to[0] - from[0], to[1] - from[1]],
      settings: opts.snap,
      index: opts.index,
      exclude: targets.flatMap((t) => [t.ref, ...(t.subtree ?? [])]),
      scale: opts.scale,
      pxPerMetre: opts.pxPerMetre,
      bypass: opts.mods.mod,
    });
    return withPreview(
      {
        batch: moveBatch(refs, r.delta, opts.pxPerMetre),
        readout: readDelta(r.delta, opts.pxPerMetre),
        guides: r.guides,
      },
      targets,
    );
  }
  if (handleId === "rotate") {
    const about = centreOf(box);
    const deg = Math.round(snapAngle(dragAngle(about, from, to), opts.snap, opts.mods.shift)) + 0;
    return withPreview(
      { batch: rotateTargetsBatch(targets, about, deg, opts.pxPerMetre), readout: readAngle(deg) },
      targets,
    );
  }
  return null;
}
