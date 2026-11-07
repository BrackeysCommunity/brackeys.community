import type { GameStoreState } from "@jams/engine";
import {
  lookupRef,
  type EditorSession,
  type PeerPresence,
  type Pt,
  type Ref,
  type SceneDefinition,
} from "@jams/engine/editor";
import { parseShape } from "@jams/engine/scene";
import type { Store } from "@tanstack/store";
import { useEffect, useMemo } from "react";

import {
  num,
  POINT_RADIUS_PX,
  shapePath,
  useView,
  worldPx,
  worldTransform,
  type View,
} from "./canvas-layer/view";
import { peerLook } from "./peer-faces";
import { useEditorDoc, useEditorStore } from "./use-editor-store";

const NAME_TAG = "rounded-md px-1.5 py-0.5 text-[11px] leading-tight font-medium text-white";

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
        ? { "data-ghost": label, transform: `translate(${num(by[0])} ${num(by[1])})` }
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
 * Everyone else over the game canvas, in their colours: their selections,
 * the drags they have in progress and their cursors. Yours is the tool
 * host's overlay.
 */
export function EditorCanvasOverlay({
  session,
  store,
}: {
  session: EditorSession;
  store: Store<GameStoreState>;
}) {
  const def = useEditorDoc(session);
  const peers = useEditorStore(session, (s) => s.peers);
  const view = useView(store);
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
  const cursors = peers.filter(
    (p): p is PeerPresence & { cursor: Pt } => p.mode === "edit" && isPoint(p.cursor),
  );

  if (theirs.length === 0 && cursors.length === 0) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <svg width={view.width} height={view.height} className="absolute inset-0">
        <g transform={worldTransform(view)}>
          {theirs.map(({ peer, marks, ghost }) => {
            const { name, color } = peerLook(peer);
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
        </g>
      </svg>
      {cursors.map((p) => {
        const { name, color } = peerLook(p);
        return (
          <div
            key={p.clientId}
            data-peer-cursor={p.user.id}
            className="absolute top-0 left-0 transition-transform duration-75 ease-linear"
            style={{
              transform: `translate(${num(view.tx + p.cursor[0] * view.scale)}px, ${num(view.ty + p.cursor[1] * view.scale)}px)`,
            }}
          >
            <svg width="16" height="18" viewBox="0 0 16 18" className="drop-shadow-sm">
              <path
                d="M1 1l13 7.5-5.8 1.4L5.6 16z"
                fill={color}
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className={`${NAME_TAG} absolute top-4 left-3 whitespace-nowrap shadow-sm`}
              style={{ backgroundColor: color }}
            >
              {name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
