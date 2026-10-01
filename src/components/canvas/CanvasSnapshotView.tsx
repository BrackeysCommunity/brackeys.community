import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import {
  curvedEdge,
  type EdgeDrawing,
  EdgeRouter,
  separateOverlaps,
} from "@/lib/canvas/edge-route";
import type { JsonCanvas } from "@/lib/canvas/json-canvas";
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

/** Routing may hold up the first paint this long; the rest follows in slices. */
const ROUTE_OPEN_MS = 40;
const ROUTE_SLICE_MS = 8;

interface RoutePlan {
  router: EdgeRouter;
  edges: { id: string; from: CanvasCard; to: CanvasCard; fromSide?: string; toSide?: string }[];
  drawings: Map<string, EdgeDrawing>;
  next: number;
}

/** Draws edges in order until the deadline; returns where it stopped. */
function routeSome(plan: RoutePlan, into: Map<string, EdgeDrawing>, from: number, budget: number) {
  const deadline = performance.now() + budget;
  let i = from;
  for (; i < plan.edges.length && performance.now() < deadline; i++) {
    const edge = plan.edges[i]!;
    into.set(edge.id, plan.router.draw(edge.from, edge.to, edge.fromSide, edge.toSide));
  }
  return i;
}

/**
 * Every edge's drawing. Routing a big, crowded canvas can take a while, so
 * edges not routed yet draw their plain curve until a later slice gets to them.
 */
function useEdgeDrawings(
  cards: CanvasCard[],
  byId: Map<string, CanvasCard>,
  edges: JsonCanvas["edges"],
): (edge: JsonCanvas["edges"][number]) => EdgeDrawing | null {
  const plan = useMemo<RoutePlan>(() => {
    const router = new EdgeRouter(cards);
    const list: RoutePlan["edges"] = [];
    for (const edge of edges) {
      const from = byId.get(edge.fromNode);
      const to = byId.get(edge.toNode);
      if (from && to)
        list.push({ id: edge.id, from, to, fromSide: edge.fromSide, toSide: edge.toSide });
    }
    const drawings = new Map<string, EdgeDrawing>();
    const plan = { router, edges: list, drawings, next: 0 };
    plan.next = routeSome(plan, drawings, 0, ROUTE_OPEN_MS);
    return plan;
  }, [cards, byId, edges]);

  const [progress, setProgress] = useState({ plan, drawings: plan.drawings });
  const drawings = progress.plan === plan ? progress.drawings : plan.drawings;

  useEffect(() => {
    if (plan.next >= plan.edges.length) return;
    let next = plan.next;
    let current = plan.drawings;
    let timer: ReturnType<typeof setTimeout>;
    const slice = () => {
      current = new Map(current);
      next = routeSome(plan, current, next, ROUTE_SLICE_MS);
      setProgress({ plan, drawings: current });
      if (next < plan.edges.length) timer = setTimeout(slice, 0);
    };
    timer = setTimeout(slice, 0);
    return () => clearTimeout(timer);
  }, [plan]);

  const separated = useMemo(() => separateOverlaps(drawings), [drawings]);

  return useCallback(
    (edge) => {
      const drawing = separated.get(edge.id) ?? drawings.get(edge.id);
      if (drawing) return drawing;
      const from = byId.get(edge.fromNode);
      const to = byId.get(edge.toNode);
      return from && to ? plan.router.curve(from, to, edge.fromSide, edge.toSide) : null;
    },
    [separated, drawings, byId, plan],
  );
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
  const drawingOf = useEdgeDrawings(cards, byId, snapshot.edges);
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
              const drawing = drawingOf(edge);
              if (!drawing) return null;
              // Too small to see a detour; the plain curve is what Obsidian draws.
              const { d, label } =
                drawing.routed && detail === "blocks"
                  ? curvedEdge(drawing.start, drawing.end)
                  : drawing;
              const stroke = cardColor(edge.color) ?? "var(--muted-foreground)";
              return (
                <g key={edge.id}>
                  <path
                    d={d}
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
                      x={label[0]}
                      y={label[1] - 6}
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
