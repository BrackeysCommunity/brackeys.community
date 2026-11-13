import { useMemo } from "react";

import { colliderOutlines, pathFollowPath } from "../../../editor/gizmos/behavior-marks";
import {
  behaviorMarks,
  gizmoTarget,
  targetHandles,
  type EditorSession,
  type Pt,
  type ToolOverlay,
} from "../../../editor/index";
import { useEditorResolved, useEditorStore } from "../../session/use-editor-store";
import { num, polylinePath, shapePath, worldPx, type View } from "./view";

/** Screen px of an arrow's head. */
const HEAD_PX = 8;
/** Screen px of the chevrons on a ring that pulls or pushes. */
const CHEVRON_PX = 5;
/** Screen px radius of a path-follow waypoint's dot. */
const WAYPOINT_PX = 3;
/** How strongly an unselected entity's collider outline draws. */
const FAINT_OPACITY = 0.4;

function arrowPath(from: Pt, to: Pt, view: View): string {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  const line = `M${num(from[0])} ${num(from[1])} L${num(to[0])} ${num(to[1])}`;
  if (len === 0) return line;
  const size = Math.min(worldPx(view, HEAD_PX), len / 2);
  const [ux, uy] = [dx / len, dy / len];
  const back: Pt = [to[0] - ux * size, to[1] - uy * size];
  const a: Pt = [back[0] - uy * size * 0.5, back[1] + ux * size * 0.5];
  const b: Pt = [back[0] + uy * size * 0.5, back[1] - ux * size * 0.5];
  return `${line} M${num(a[0])} ${num(a[1])} L${num(to[0])} ${num(to[1])} L${num(b[0])} ${num(b[1])}`;
}

/** Four chevrons on a ring's compass points, pointing in (a pull) or out (a push). */
function chevronsPath(at: Pt, r: number, inward: boolean, view: View): string {
  const size = worldPx(view, CHEVRON_PX);
  const out: string[] = [];
  for (const [ux, uy] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const) {
    const s = inward ? -1 : 1;
    const tip: Pt = [at[0] + ux * (r + s * size), at[1] + uy * (r + s * size)];
    const a: Pt = [at[0] + ux * r - uy * size, at[1] + uy * r + ux * size];
    const b: Pt = [at[0] + ux * r + uy * size, at[1] + uy * r - ux * size];
    out.push(
      `M${num(a[0])} ${num(a[1])} L${num(tip[0])} ${num(tip[1])} L${num(b[0])} ${num(b[1])}`,
    );
  }
  return out.join(" ");
}

/**
 * Every collider in the scene but the one the selected entity's gizmo draws, outlined faintly (dashed
 * for a sensor), so an entity with no art of its own still shows where it is.
 */
export function ColliderOutlines({
  session,
  transform,
}: {
  session: EditorSession;
  /** The world group's transform. */
  transform: string;
}) {
  const doc = useEditorResolved(session);
  const selection = useEditorStore(session, (s) => s.selection);
  const only = selection.length === 1 ? selection[0] : undefined;
  const outlines = useMemo(
    () => colliderOutlines(doc, session.registry, only === undefined ? [] : [only]),
    [doc, session, only],
  );
  if (outlines.length === 0) return null;
  return (
    <g
      data-collider-outlines=""
      transform={transform}
      fill="none"
      strokeLinejoin="round"
      strokeOpacity={FAINT_OPACITY}
      style={{ stroke: "var(--je-info)" }}
    >
      {outlines.map((o) => (
        <path
          key={o.ref}
          data-ref={o.ref}
          data-sensor={o.sensor ? "" : undefined}
          d={shapePath(o.shape)}
          strokeWidth={1}
          strokeDasharray={o.sensor ? "4 3" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

/**
 * The selected entity's behavior gizmo, under the tool's handles: its
 * collider's outline (dashed for a sensor), its joint's line to the entity
 * it links and between its anchors, its path-follow path and waypoints, its
 * force area's arrow or strength ring, its spawner's spread ring and
 * velocity arrow. The marks follow the host's handles, so a drag in
 * progress draws where it is before it commits.
 */
export function BehaviorMarks({
  session,
  view,
  transform,
  overlay,
}: {
  session: EditorSession;
  view: View;
  /** The world group's transform. */
  transform: string;
  /** The tool host's overlay, whose handles a drag moves first. */
  overlay: ToolOverlay;
}) {
  const doc = useEditorResolved(session);
  const selection = useEditorStore(session, (s) => s.selection);
  const only = selection.length === 1 ? selection[0] : undefined;
  const target = useMemo(
    () => (only === undefined ? undefined : gizmoTarget(doc, session.registry, only)),
    [doc, session, only],
  );
  const path = useMemo(
    () => (only === undefined ? undefined : pathFollowPath(doc, session.registry, only)),
    [doc, session, only],
  );
  if (!target || (!target.behaviors && !path)) return null;
  const handles = overlay.handles ?? [];
  const was = targetHandles(target, { scale: view.scale }).find((h) => h.id === "move")?.at;
  const now = handles.find((h) => h.id === "move")?.at;
  const shift: Pt = was && now ? [now[0] - was[0], now[1] - was[1]] : [0, 0];
  const marks = target.behaviors
    ? behaviorMarks(target.behaviors, view.scale, handles, { shift })
    : { outlines: [], lines: [], arrows: [], rings: [] };
  const dot = worldPx(view, WAYPOINT_PX);
  return (
    <g
      data-behavior-marks=""
      data-ref={target.ref}
      transform={transform}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ stroke: "var(--je-info)" }}
    >
      {marks.outlines.map((o, i) => (
        <path
          key={`outline-${i}`}
          data-behavior-mark="collider"
          data-sensor={o.sensor ? "" : undefined}
          d={shapePath(o.shape)}
          strokeWidth={1.5}
          strokeDasharray={o.sensor ? "4 3" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {path ? (
        <g data-behavior-mark="path">
          <path
            d={polylinePath(path.pts, path.closed)}
            strokeWidth={1.5}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
          {path.pts.map((p, i) => (
            <circle
              key={`waypoint-${i}`}
              data-waypoint={i}
              cx={num(p[0])}
              cy={num(p[1])}
              r={dot}
              style={{ fill: "var(--je-info)" }}
            />
          ))}
        </g>
      ) : null}
      {marks.lines.map((l, i) => (
        <path
          key={`line-${i}`}
          data-behavior-mark="joint"
          data-joint-line={l.kind}
          d={`M${num(l.from[0])} ${num(l.from[1])} L${num(l.to[0])} ${num(l.to[1])}`}
          strokeWidth={1.5}
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {marks.arrows.map((a, i) => (
        <path
          key={`arrow-${i}`}
          data-behavior-mark="arrow"
          d={arrowPath(a.from, a.to, view)}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {marks.rings.map((r, i) => (
        <g key={`ring-${i}`} data-behavior-mark="ring">
          <circle
            cx={num(r.at[0])}
            cy={num(r.at[1])}
            r={r.r}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
          {r.inward !== undefined ? (
            <path
              d={chevronsPath(r.at, r.r, r.inward, view)}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </g>
      ))}
    </g>
  );
}
