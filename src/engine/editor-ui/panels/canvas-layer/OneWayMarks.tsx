import { useMemo } from "react";

import type { EditorSession, Pt, Ref, ToolOverlay } from "../../../editor/index";
import { drawnEntities, oneWayEdges, type OneWayEdge } from "../../../scene/render-geometry";
import { CHILD_SEPARATOR } from "../../../scene/resolve";
import type { ExpandedScene } from "../../../scene/types";
import { num, worldPx, type View } from "./view";

/** Screen px of the face's highlight and of each arrow. */
const EDGE_PX = 3;
const ARROW_PX = 6;
/** Screen px between arrows along a face; a short face still gets one. */
const ARROW_EVERY_PX = 48;
const MAX_ARROWS = 12;

/** The scene's one-way faces, from its resolved view; none while the document doesn't expand. */
function useOneWayEdges(session: EditorSession, scene: ExpandedScene | null): OneWayEdge[] {
  return useMemo(
    () => (scene ? oneWayEdges(drawnEntities(scene, session.registry)) : []),
    [scene, session],
  );
}

/** The refs a drag in progress is moving: the overlay outlines them where the preview puts them. */
function previewedRefs(overlay: ToolOverlay | undefined): Ref[] {
  const refs = new Set<Ref>();
  for (const mark of [...(overlay?.outlines ?? []), ...(overlay?.points ?? [])])
    if (mark.preview && mark.ref !== undefined) refs.add(mark.ref);
  return [...refs];
}

/** Whether `id` is `ref` or a child of it (an instance's or a group's member). */
const within = (id: string, refs: readonly Ref[]) =>
  refs.some((ref) => id === ref || id.startsWith(`${ref}${CHILD_SEPARATOR}`));

/** Chevrons just outside a face, pointing into it: the way an actor lands. */
function arrowsPath(edge: OneWayEdge, view: View): string {
  const { from, to, normal } = edge;
  const len = Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1]);
  const count = Math.min(MAX_ARROWS, Math.max(1, Math.floor((len * view.scale) / ARROW_EVERY_PX)));
  const size = worldPx(view, ARROW_PX);
  const along: Pt = len > 0 ? [(to[0] - from[0]) / len, (to[1] - from[1]) / len] : [0, 0];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const tip: Pt = [
      from[0] + (to[0] - from[0]) * t + normal[0] * size,
      from[1] + (to[1] - from[1]) * t + normal[1] * size,
    ];
    const back: Pt = [tip[0] + normal[0] * size, tip[1] + normal[1] * size];
    const a: Pt = [back[0] + along[0] * size, back[1] + along[1] * size];
    const b: Pt = [back[0] - along[0] * size, back[1] - along[1] * size];
    out.push(
      `M${num(a[0])} ${num(a[1])} L${num(tip[0])} ${num(tip[1])} L${num(b[0])} ${num(b[1])}`,
    );
  }
  return out.join(" ");
}

/**
 * Each one-way solid's landing face, highlighted, with arrows on the side
 * actors land from: they pass through from every other side. The faces come
 * from the committed document, so those of what a drag is moving are left
 * out until it lands.
 */
export function OneWayMarks({
  session,
  scene,
  view,
  transform,
  overlay,
}: {
  session: EditorSession;
  /** The committed document, expanded (`useExpandedScene`). */
  scene: ExpandedScene | null;
  view: View;
  /** The world group's transform. */
  transform: string;
  /** The tool host's overlay, whose previewed outlines name what a drag is moving. */
  overlay?: ToolOverlay;
}) {
  const all = useOneWayEdges(session, scene);
  const moving = previewedRefs(overlay);
  const edges = moving.length > 0 ? all.filter((e) => !within(e.entity.id, moving)) : all;
  if (edges.length === 0) return null;
  return (
    <g
      data-one-way=""
      transform={transform}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ stroke: "var(--je-info)" }}
    >
      {edges.map((edge) => (
        <g key={edge.entity.id} data-one-way-side={edge.side} data-ref={edge.entity.id}>
          <path
            data-one-way-face=""
            d={`M${num(edge.from[0])} ${num(edge.from[1])} L${num(edge.to[0])} ${num(edge.to[1])}`}
            strokeWidth={EDGE_PX}
            vectorEffect="non-scaling-stroke"
          />
          <path
            data-one-way-arrows=""
            d={arrowsPath(edge, view)}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
    </g>
  );
}
