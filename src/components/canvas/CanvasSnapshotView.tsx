import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import {
  type CanvasSide,
  isCanvasSide,
  type JsonCanvas,
  nearestSides,
} from "@/lib/canvas/json-canvas";
import { cn } from "@/lib/utils";

import {
  CanvasLinksContext,
  CARD_SURFACE,
  CardBody,
  cardColor,
  cardColorStyle,
  cardFromJson,
  detailLevelFor,
  EDGE_WIDTH,
  GRID_DOT,
  GRID_GAP,
  GROUP_SURFACE,
  GroupLabel,
  useCanvasLinks,
  type CanvasCard,
} from "./canvas-cards";
import type { CanvasAttachmentMap } from "./canvas-queries";
import { canvasOutline, cardAriaLabel, flattenOutline } from "./outline";

const SIDE_POINT: Record<CanvasSide, (c: CanvasCard) => [number, number]> = {
  top: (c) => [c.x + c.w / 2, c.y],
  right: (c) => [c.x + c.w, c.y + c.h / 2],
  bottom: (c) => [c.x + c.w / 2, c.y + c.h],
  left: (c) => [c.x, c.y + c.h / 2],
};

const NORMAL: Record<CanvasSide, [number, number]> = {
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0],
};

function anchor(
  card: CanvasCard,
  side: string | undefined,
  fallback: CanvasSide,
): [number, number, CanvasSide] {
  const resolved = isCanvasSide(side) ? side : fallback;
  const [x, y] = SIDE_POINT[resolved](card);
  return [x, y, resolved];
}

/** A curve that leaves and arrives square to each card's side, as the editor draws it. */
function edgePath(
  [x1, y1, s1]: [number, number, CanvasSide],
  [x2, y2, s2]: [number, number, CanvasSide],
): string {
  const reach = Math.max(40, Math.hypot(x2 - x1, y2 - y1) * 0.3);
  const [ax, ay] = NORMAL[s1];
  const [bx, by] = NORMAL[s2];
  return `M${x1},${y1} C${x1 + ax * reach},${y1 + ay * reach} ${x2 + bx * reach},${y2 + by * reach} ${x2},${y2}`;
}

interface View {
  x: number;
  y: number;
  zoom: number;
}

function fitView(cards: CanvasCard[], width: number, height: number): View {
  if (cards.length === 0) return { x: width / 2, y: height / 2, zoom: 1 };
  const minX = Math.min(...cards.map((c) => c.x));
  const minY = Math.min(...cards.map((c) => c.y));
  const maxX = Math.max(...cards.map((c) => c.x + c.w));
  const maxY = Math.max(...cards.map((c) => c.y + c.h));
  const zoom = Math.min(
    1,
    Math.max(0.1, Math.min(width / (maxX - minX + 120), height / (maxY - minY + 120))),
  );
  return {
    zoom,
    x: width / 2 - ((minX + maxX) / 2) * zoom,
    y: height / 2 - ((minY + maxY) / 2) * zoom,
  };
}

/** What the page's chrome can ask of a snapshot view. */
export interface SnapshotViewHandle {
  fit: () => void;
  focusCard: (id: string) => void;
}

/** The snapshot's cards, as the outline and the view both read them. */
export function snapshotCards(snapshot: JsonCanvas): CanvasCard[] {
  return snapshot.nodes.map(cardFromJson).filter((c): c is CanvasCard => c != null);
}

/**
 * A canvas drawn straight from its snapshot: the first paint for everyone
 * and all a reader ever loads. Pans with a drag and zooms with the wheel;
 * nothing here can edit. `focusable` makes the cards tab stops in reading
 * order, for the page's own view rather than previews.
 */
export function CanvasSnapshotView({
  snapshot,
  attachments,
  className,
  focusable = false,
  grid = false,
  ref,
}: {
  snapshot: JsonCanvas;
  attachments: CanvasAttachmentMap;
  className?: string;
  focusable?: boolean;
  /** The editor's dot grid, moving with the view. */
  grid?: boolean;
  ref?: React.Ref<SnapshotViewHandle>;
}) {
  const cards = useMemo(() => snapshotCards(snapshot), [snapshot]);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => fitView(cards, 1200, 700));
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (el) setView(fitView(cards, el.clientWidth, el.clientHeight));
  }, [cards]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const zoom = Math.min(2, Math.max(0.1, v.zoom * Math.exp(-e.deltaY * 0.0015)));
        return { zoom, x: px - ((px - v.x) / v.zoom) * zoom, y: py - ((py - v.y) / v.zoom) * zoom };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const centerOn = useCallback(
    (id: string) => {
      const card = byId.get(id);
      const el = host.current;
      if (!card || !el) return;
      // Focus can scroll even an overflow-hidden box; the view is the only offset.
      el.scrollTo(0, 0);
      setView((v) => {
        const zoom = Math.max(v.zoom, 0.8);
        return {
          zoom,
          x: el.clientWidth / 2 - (card.x + card.w / 2) * zoom,
          y: el.clientHeight / 2 - (card.y + card.h / 2) * zoom,
        };
      });
    },
    [byId],
  );

  const focusCard = useCallback(
    (id: string) => {
      centerOn(id);
      host.current
        ?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`)
        ?.focus({ preventScroll: true });
    },
    [centerOn],
  );
  const links = useCanvasLinks(cards, attachments, focusCard);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => {
        const el = host.current;
        if (el) setView(fitView(cards, el.clientWidth, el.clientHeight));
      },
      focusCard,
    }),
    [cards, focusCard],
  );

  const detail = detailLevelFor(view.zoom);
  // Reading order in the DOM, so tabbing follows it; groups paint underneath.
  const ordered = useMemo(() => flattenOutline(canvasOutline(cards)), [cards]);

  return (
    <CanvasLinksContext value={links}>
      <div
        ref={host}
        className={cn(
          "relative h-full w-full cursor-grab touch-none overflow-hidden select-none",
          className,
        )}
        style={
          grid
            ? {
                backgroundImage: `radial-gradient(${GRID_DOT} 2px, transparent 2px)`,
                backgroundSize: `${GRID_GAP * view.zoom}px ${GRID_GAP * view.zoom}px`,
                backgroundPosition: `${view.x}px ${view.y}px`,
              }
            : undefined
        }
        onPointerDown={(e) => {
          // Capturing the pointer would retarget the click away from a link or chip.
          if ((e.target as HTMLElement).closest("a, button")) return;
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dx = e.clientX - drag.current.x;
          const dy = e.clientY - drag.current.y;
          drag.current = { x: e.clientX, y: e.clientY };
          setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        >
          <svg className="absolute overflow-visible" width={1} height={1} aria-hidden>
            <defs>
              <marker
                id="canvas-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="14"
                markerHeight="14"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
              </marker>
            </defs>
            {snapshot.edges.map((edge) => {
              const from = byId.get(edge.fromNode);
              const to = byId.get(edge.toNode);
              if (!from || !to) return null;
              const [autoFrom, autoTo] = nearestSides(from, to);
              const start = anchor(from, edge.fromSide, autoFrom);
              const end = anchor(to, edge.toSide, autoTo);
              const [x1, y1] = start;
              const [x2, y2] = end;
              const stroke = cardColor(edge.color) ?? "var(--muted-foreground)";
              return (
                <g key={edge.id}>
                  <path
                    d={edgePath(start, end)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={EDGE_WIDTH}
                    strokeLinecap="round"
                    markerEnd={
                      (edge.toEnd ?? "arrow") === "arrow" ? "url(#canvas-arrow)" : undefined
                    }
                    markerStart={edge.fromEnd === "arrow" ? "url(#canvas-arrow)" : undefined}
                  />
                  {edge.label && (detail === "mid" || detail === "near") ? (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 6}
                      textAnchor="middle"
                      className="fill-foreground text-xs"
                    >
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {ordered.map((card) => (
            <div
              key={card.id}
              data-card-id={card.id}
              tabIndex={focusable ? 0 : undefined}
              aria-label={focusable ? cardAriaLabel(card) : undefined}
              onFocus={(e) => {
                if (e.target === e.currentTarget && e.currentTarget.matches(":focus-visible")) {
                  centerOn(card.id);
                }
              }}
              className="absolute rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              style={{
                left: card.x,
                top: card.y,
                width: card.w,
                height: card.h,
                // Groups under the edges, cards over them.
                zIndex: card.type === "group" ? -1 : 1,
                ...cardColorStyle(card.color),
              }}
            >
              {card.type === "group" ? (
                <div className={GROUP_SURFACE}>
                  <GroupLabel label={card.label} />
                </div>
              ) : (
                <div className={CARD_SURFACE}>
                  <CardBody card={card} detail={detail} attachments={attachments} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </CanvasLinksContext>
  );
}
