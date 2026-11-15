import type { Store } from "@tanstack/store";
import { useEffect, useMemo, type CSSProperties } from "react";

import {
  lookupRef,
  type EditorSession,
  type PeerPresence,
  type Pt,
  type Ref,
  type Registry,
  type SceneDefinition,
} from "../../editor/index";
import { cssHex } from "../../game/color";
import { isNodeType } from "../../game/primitives";
import { styleOf } from "../../game/style";
import type { CellBounds } from "../../grid/geometry";
import type { GameStoreState } from "../../index";
import { parseShape } from "../../scene/index";
import { gridCellOutline } from "../../scene/render-geometry";
import type { GridSettings } from "../../scene/types";
import { useEditorDoc, useEditorResolved, useEditorStore } from "../session/use-editor-store";
import {
  num,
  POINT_RADIUS_PX,
  shapePath,
  toScreen,
  useView,
  worldNum,
  worldPx,
  worldTransform,
  type View,
} from "./canvas-layer/view";
import { peerLook, usePeerColor } from "./peer-faces";

type Mark = { kind: "path"; d: string } | { kind: "point"; x: number; y: number };

const isPoint = (v: unknown): v is Pt =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number");

/** Where a ref is drawn: its shape's outline, or a dot at its point. */
function markOf(def: SceneDefinition, ref: Ref): Mark | null {
  const target = lookupRef(def, ref);
  if (!target) return null;
  const geometry =
    target.kind === "bulk" ? target.value : (target.entity.shape ?? target.entity.at);
  if (isPoint(geometry)) return { kind: "point", x: geometry[0], y: geometry[1] };
  if (geometry === undefined) return null;
  const parsed = parseShape(geometry);
  return parsed.ok ? { kind: "path", d: shapePath(parsed.shape) } : null;
}

function Marks({
  marks,
  color,
  view,
  label,
  by,
}: {
  marks: Mark[];
  color: string;
  view: View;
  label: string;
  /** Draws the marks moved by this much, dashed: a drag in progress. */
  by?: Pt;
}) {
  return (
    <g
      {...(by
        ? { "data-ghost": label, transform: `translate(${worldNum(by[0])} ${worldNum(by[1])})` }
        : { "data-selection": label })}
      fill="none"
      strokeWidth={2}
      strokeDasharray={by ? "6 4" : undefined}
      style={{ stroke: color }}
    >
      {marks.map((m, i) =>
        m.kind === "path" ? (
          <path key={i} d={m.d} vectorEffect="non-scaling-stroke" />
        ) : (
          <circle
            key={i}
            cx={m.x}
            cy={m.y}
            r={worldPx(view, POINT_RADIUS_PX)}
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
    </g>
  );
}

type NodeMark = { id: string; at: Pt; rot: number; flip: boolean; tone: string | undefined };

/** A node draws as a bare point like a marker, so the editor adds its axis: where its +x points. */
function nodeMarks(def: SceneDefinition, registry: Registry): NodeMark[] {
  const out: NodeMark[] = [];
  for (const e of def.entities ?? []) {
    const type = registry.types.get(e.type);
    if (!type || !isNodeType(type) || !isPoint(e.at)) continue;
    const style = styleOf({ registry }, type, undefined);
    const tone = style?.stroke ?? style?.fill;
    out.push({
      id: e.id,
      at: e.at,
      rot: typeof e.rot === "number" ? e.rot : 0,
      flip: e.flip === true,
      tone: tone === undefined ? undefined : cssHex(tone),
    });
  }
  return out;
}

/** Screen px from a node's origin to its axis's tip, past the point's ring. */
const NODE_AXIS_PX = POINT_RADIUS_PX + 8;
const NODE_ARM_PX = 4;
/** In the node's frame, unturned: a cross at the origin and an arrow along +x. */
const NODE_GLYPH = `M${-NODE_ARM_PX} 0H${NODE_AXIS_PX}M0 ${-NODE_ARM_PX}V${NODE_ARM_PX}M${NODE_AXIS_PX - 4} -3L${NODE_AXIS_PX} 0L${NODE_AXIS_PX - 4} 3`;

/** Each node's axis at a constant screen size, turned by its `rot` and mirrored by its `flip`. */
function NodeGlyphs({ nodes, view }: { nodes: NodeMark[]; view: View }) {
  return (
    <g>
      {nodes.map((n) => {
        const [x, y] = toScreen(view, n.at);
        return (
          <g
            key={n.id}
            className="je-ov-mark"
            data-node={n.id}
            transform={`translate(${num(x)} ${num(y)}) rotate(${n.rot})${n.flip ? " scale(-1 1)" : ""}`}
            style={n.tone ? ({ "--je-ov-tone": n.tone } as CSSProperties) : undefined}
          >
            <path className="je-ov-halo" d={NODE_GLYPH} />
            <path className="je-ov-stroke" d={NODE_GLYPH} />
          </g>
        );
      })}
    </g>
  );
}

/** Whether `type` is the `tilemap` primitive or a type based on it. */
export function isTilemapIn(registry: Pick<Registry, "types">, type: string): boolean {
  const t = registry.types.get(type);
  return (t?.base ?? t?.type ?? type) === "tilemap";
}

const isCellBounds = (v: unknown): v is CellBounds => {
  if (v === null || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  return (["c0", "r0", "c1", "r1"] as const).every((k) => Number.isInteger(b[k]));
};

/** The most cells of a hex brush outlined one by one; a larger one draws its corner cells. */
const HEX_BRUSH_MAX_CELLS = 256;

/**
 * A painter's brush as a world path: the rectangle on a square grid, its
 * cells' outlines on a hex grid. The cells are the resolved tilemap's, which
 * already carry its frame's turn and mirror.
 */
function brushMark(
  def: SceneDefinition,
  registry: Registry,
  grid: GridSettings | undefined,
  brush: { map: unknown; rect: unknown } | undefined,
): string | null {
  if (!grid || !brush || typeof brush.map !== "string" || !isCellBounds(brush.rect)) return null;
  const map = (def.entities ?? []).find((e) => e.id === brush.map);
  if (!map || !isTilemapIn(registry, map.type) || !isPoint(map.at)) return null;
  const { c0, r0, c1, r1 } = brush.rect;
  const [lo, hi] = [Math.min(c0, c1), Math.max(c0, c1)];
  const [top, bottom] = [Math.min(r0, r1), Math.max(r0, r1)];
  const ring = (pts: Pt[]) => `M${pts.map(([x, y]) => `${worldNum(x)} ${worldNum(y)}`).join("L")}Z`;
  if (grid.kind === "square") {
    const a = gridCellOutline(grid, map.at, lo, top)[0]!;
    const b = gridCellOutline(grid, map.at, hi, bottom)[2]!;
    return ring([a, [b[0], a[1]], b, [a[0], b[1]]]);
  }
  const cells: [number, number][] = [];
  if ((hi - lo + 1) * (bottom - top + 1) <= HEX_BRUSH_MAX_CELLS) {
    for (let r = top; r <= bottom; r++) for (let c = lo; c <= hi; c++) cells.push([c, r]);
  } else {
    cells.push([lo, top], [hi, top], [hi, bottom], [lo, bottom]);
  }
  return cells.map(([c, r]) => ring(gridCellOutline(grid, map.at as Pt, c, r))).join("");
}

/** Clears this tab's published pointer once it leaves the game's canvas; the tool host publishes it over the canvas. */
function useClearCursorOffCanvas(session: EditorSession) {
  useEffect(() => {
    let over = false;
    const onMove = (e: PointerEvent) => {
      const onCanvas = e.target instanceof HTMLCanvasElement;
      if (over && !onCanvas) session.setCursor(undefined);
      over = onCanvas;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      session.setCursor(undefined);
    };
  }, [session]);
}

/**
 * Under the tool host's overlay: each node's axis, then everyone else's
 * selections, drags in progress, tile brushes and cursors, in their colours.
 */
export function EditorCanvasOverlay({
  session,
  store,
}: {
  session: EditorSession;
  store: Store<GameStoreState>;
}) {
  const def = useEditorDoc(session);
  const resolved = useEditorResolved(session);
  const nodes = useMemo(() => nodeMarks(resolved, session.registry), [resolved, session.registry]);
  const peers = useEditorStore(session, (s) => s.peers);
  const view = useView(store);
  const peerColor = usePeerColor();
  useClearCursorOffCanvas(session);

  const theirs = useMemo(() => {
    const marksOf = (keys: readonly string[]) =>
      keys
        .map((k) => session.refOf(k))
        .filter((r): r is Ref => r !== undefined)
        .map((r) => markOf(def, r))
        .filter((m): m is Mark => m !== null);
    return peers
      .filter((p) => p.mode === "edit")
      .map((p) => ({
        peer: p,
        marks: marksOf(p.selection),
        ghost:
          p.ghost && isPoint(p.ghost.by) ? { by: p.ghost.by, marks: marksOf(p.ghost.keys) } : null,
      }))
      .filter((p) => p.marks.length > 0 || (p.ghost?.marks.length ?? 0) > 0);
  }, [def, peers, session]);
  const brushes = useMemo(
    () =>
      peers
        .filter((p) => p.mode === "edit")
        .map((peer) => ({
          peer,
          mark: brushMark(resolved, session.registry, resolved.settings?.grid, peer.brush),
        }))
        .filter((b): b is { peer: PeerPresence; mark: string } => b.mark !== null),
    [peers, resolved, session.registry],
  );
  const cursors = peers.filter(
    (p): p is PeerPresence & { cursor: Pt } => p.mode === "edit" && isPoint(p.cursor),
  );

  if (nodes.length === 0 && theirs.length === 0 && cursors.length === 0 && brushes.length === 0)
    return null;

  return (
    <div aria-hidden className="je-canvas-layer">
      <svg width={view.width} height={view.height} className="je-canvas-svg">
        <NodeGlyphs nodes={nodes} view={view} />
        <g transform={worldTransform(view)}>
          {theirs.map(({ peer, marks, ghost }) => {
            const { name, color } = peerLook(peer, peerColor);
            return (
              <g key={peer.clientId}>
                {marks.length > 0 ? (
                  <Marks marks={marks} color={color} view={view} label={name} />
                ) : null}
                {ghost && ghost.marks.length > 0 ? (
                  <Marks marks={ghost.marks} color={color} view={view} label={name} by={ghost.by} />
                ) : null}
              </g>
            );
          })}
          {brushes.map(({ peer, mark }) => {
            const { name, color } = peerLook(peer, peerColor);
            return (
              <path
                key={peer.clientId}
                data-peer-brush={name}
                d={mark}
                fill={color}
                fillOpacity={0.15}
                strokeWidth={2}
                style={{ stroke: color }}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>
      </svg>
      {cursors.map((p) => {
        const { name, color } = peerLook(p, peerColor);
        return (
          <div
            key={p.clientId}
            data-peer-cursor={p.user.id}
            className="je-peer-cursor"
            style={{
              transform: `translate(${num(view.tx + p.cursor[0] * view.scale)}px, ${num(view.ty + p.cursor[1] * view.scale)}px)`,
            }}
          >
            <svg width="16" height="18" viewBox="0 0 16 18" className="je-peer-cursor-arrow">
              <path
                d="M1 1l13 7.5-5.8 1.4L5.6 16z"
                fill={color}
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <span className="je-peer-name" style={{ backgroundColor: color }}>
              {name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
