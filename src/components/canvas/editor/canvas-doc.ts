import type { Edge, Node } from "@xyflow/react";
import { generateKeyBetween } from "fractional-indexing";
import * as Y from "yjs";

import {
  type Box,
  type EdgeDrawing,
  type EdgeEnd,
  EdgeRouter,
  nearestSides,
  overlaps,
  separateOverlaps,
  sideAnchor,
} from "@/lib/canvas/edge-route";
import {
  canvasEdges,
  canvasNodes,
  ENTITY_KINDS,
  type EntityRef,
  newCanvasId,
  orderedNodeIds,
  yNodeFrom,
} from "@/lib/canvas/json-canvas";

import { cardColor, EDGE_WIDTH, type CanvasCard } from "../canvas-cards";
import { cardAriaLabel } from "../outline";

/** Origin of every edit made in this tab; the undo manager tracks only these. */
export const LOCAL = { origin: "local" };
/** Origin of updates that came back from the server; never undoable, never re-saved. */
export const SERVER = { origin: "server" };

type CanvasNodeData = {
  card: CanvasCard;
  /** The card's live text, for text cards; the editor binds CodeMirror to it. */
  ytext: Y.Text | null;
  /** Bumped whenever this card changes, so memoised cards re-render only then. */
  version: number;
};

export type CanvasFlowNode = Node<CanvasNodeData>;

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function entityOf(value: unknown): EntityRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { kind, id } = value as { kind?: unknown; id?: unknown };
  return typeof id === "string" && (ENTITY_KINDS as readonly unknown[]).includes(kind)
    ? { kind: kind as EntityRef["kind"], id }
    : undefined;
}

function cardFromYNode(id: string, node: Y.Map<unknown>): CanvasCard | null {
  const type = str(node.get("type"));
  if (
    type !== "text" &&
    type !== "file" &&
    type !== "link" &&
    type !== "group" &&
    type !== "image" &&
    type !== "entity"
  ) {
    return null;
  }
  const text = node.get("text");
  return {
    id,
    type,
    x: num(node.get("x"), 0),
    y: num(node.get("y"), 0),
    w: Math.max(20, num(node.get("w"), 250)),
    h: Math.max(20, num(node.get("h"), 60)),
    color: str(node.get("color")),
    text: text instanceof Y.Text ? text.toJSON() : str(text),
    file: str(node.get("file")),
    subpath: str(node.get("subpath")),
    url: str(node.get("url")),
    label: str(node.get("label")),
    attachmentId: str(node.get("attachmentId")),
    entity: entityOf(node.get("entity")),
  };
}

function flowNode(
  id: string,
  node: Y.Map<unknown>,
  version: number,
  order: number,
  previous: CanvasFlowNode | undefined,
): CanvasFlowNode | null {
  const card = cardFromYNode(id, node);
  if (!card) return null;
  const text = node.get("text");
  return {
    ...previous,
    id,
    // Not "group": React Flow ships its own border and padding for that name.
    type: card.type === "group" ? "canvasGroup" : card.type,
    position: { x: card.x, y: card.y },
    width: card.w,
    height: card.h,
    // Groups sit behind everything; the rest keep the doc's z-order.
    zIndex: card.type === "group" ? -1000 + order : order,
    ariaLabel: cardAriaLabel(card),
    data: { card, ytext: text instanceof Y.Text ? text : null, version },
  };
}

export type CanvasFlowEdge = Edge<{
  label?: string;
  color?: string;
  /**
   * Its route around cards, from the doc's geometry; absent, it draws the
   * plain curve. While an end is mid-drag the edge routes from the screen.
   */
  drawing?: EdgeDrawing;
}>;

/** What routing may add to a rebuild; mid-drag that's once per doc write. */
const ROUTE_REBUILD_MS = 4;
/** The rest runs in slices this long, so a big canvas never blocks a frame. */
const ROUTE_SLICE_MS = 8;
/** What live routing for dragged cards' connections may take per frame. */
const LIVE_ROUTE_MS = 6;
/** What routing may take synchronously when a canvas opens, so routes paint with it. */
const ROUTE_OPEN_MS = 40;

function flowEdge(
  id: string,
  edge: Y.Map<unknown>,
  cards: Map<string, CanvasCard>,
  previous: CanvasFlowEdge | undefined,
): CanvasFlowEdge | null {
  const source = str(edge.get("from"));
  const target = str(edge.get("to"));
  const from = source ? cards.get(source) : undefined;
  const to = target ? cards.get(target) : undefined;
  if (!from || !to) return null;
  // A side the file didn't give is picked for drawing only, never written.
  const [autoFrom, autoTo] = nearestSides(from, to);
  const color = str(edge.get("color"));
  const stroke = cardColor(color) ?? "var(--muted-foreground)";
  // Sized in pixels, not stroke widths, so a thicker selected edge keeps the
  // same head. React Flow's arrow fills a quarter of the box: about 12px.
  const arrow = {
    type: "arrowclosed" as const,
    color: stroke,
    width: 48,
    height: 48,
    markerUnits: "userSpaceOnUse",
  };
  return {
    ...previous,
    id,
    source: from.id,
    target: to.id,
    sourceHandle: str(edge.get("fromSide")) ?? autoFrom,
    targetHandle: str(edge.get("toSide")) ?? autoTo,
    type: "canvas",
    markerEnd: (str(edge.get("toEnd")) ?? "arrow") === "arrow" ? arrow : undefined,
    markerStart: str(edge.get("fromEnd")) === "arrow" ? arrow : undefined,
    style: { stroke, strokeWidth: EDGE_WIDTH, strokeLinecap: "round" },
    data: { label: str(edge.get("label")), color, drawing: previous?.data?.drawing },
  };
}

/**
 * The doc as React Flow nodes and edges, rebuilt at most once a frame.
 * Unchanged cards keep their previous object (and React Flow's own fields:
 * `measured`, `selected`, `dragging`), so moving one card re-renders one card.
 */
export class CanvasDocView {
  nodes: CanvasFlowNode[] = [];
  edges: CanvasFlowEdge[] = [];
  private versions = new Map<string, number>();
  private dirty = new Set<string>();
  private dirtyEdges = new Set<string>();
  private all = true;
  private frame: number | null = null;
  private listeners = new Set<() => void>();
  private observing = false;
  private unrouted = new Set<string>();
  private routeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Every edge's latest drawing, routed or not: where each line runs, for spotting cards moved into it. */
  private drawings = new Map<string, EdgeDrawing>();
  private router = new EdgeRouter([]);
  private cards = new Map<string, CanvasCard>();
  private liveFrame = { start: 0, spent: 0 };

  constructor(readonly doc: Y.Doc) {
    this.connect();
  }

  /**
   * Starts following the doc, catching up on anything missed while
   * disconnected. Safe to call again: an effect re-runs it after React
   * replays the cleanup (StrictMode), and the view must survive that.
   */
  connect() {
    if (this.observing) return;
    this.observing = true;
    canvasNodes(this.doc).observeDeep(this.onNodes);
    canvasEdges(this.doc).observeDeep(this.onEdges);
    this.all = true;
    this.rebuild();
  }

  disconnect() {
    if (!this.observing) return;
    this.observing = false;
    canvasNodes(this.doc).unobserveDeep(this.onNodes);
    canvasEdges(this.doc).unobserveDeep(this.onEdges);
    if (this.frame != null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.routeTimer != null) clearTimeout(this.routeTimer);
    this.routeTimer = null;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** React Flow's own per-node state, kept across rebuilds. */
  patchLocal(update: (nodes: CanvasFlowNode[]) => CanvasFlowNode[]) {
    this.nodes = update(this.nodes);
    this.emit();
  }

  patchLocalEdges(update: (edges: CanvasFlowEdge[]) => CanvasFlowEdge[]) {
    this.edges = update(this.edges);
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private onNodes = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    for (const event of events) {
      if (event.path.length === 0) {
        for (const key of event.keys.keys()) this.dirty.add(key);
      } else {
        this.dirty.add(String(event.path[0]));
      }
    }
    this.schedule();
  };

  private onEdges = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    for (const event of events) {
      if (event.path.length === 0) {
        for (const key of event.keys.keys()) this.dirtyEdges.add(key);
      } else {
        this.dirtyEdges.add(String(event.path[0]));
      }
    }
    this.schedule();
  };

  private schedule() {
    if (this.frame != null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.rebuild();
    });
  }

  private rebuild() {
    const nodesMap = canvasNodes(this.doc);
    const previous = new Map(this.nodes.map((n) => [n.id, n]));
    const nodes: CanvasFlowNode[] = [];
    const rebuilt = new Set<string>();
    orderedNodeIds(this.doc).forEach((id, order) => {
      const ynode = nodesMap.get(id);
      if (!(ynode instanceof Y.Map)) return;
      const prior = previous.get(id);
      if (prior && !this.all && !this.dirty.has(id) && prior.zIndex !== undefined) {
        const expectedZ = prior.data.card.type === "group" ? -1000 + order : order;
        if (prior.zIndex === expectedZ) {
          nodes.push(prior);
          return;
        }
      }
      const version = (this.versions.get(id) ?? 0) + 1;
      this.versions.set(id, version);
      const node = flowNode(id, ynode, version, order, prior);
      if (node) nodes.push(node);
      rebuilt.add(id);
    });
    for (const id of previous.keys()) if (!nodesMap.has(id)) rebuilt.add(id);
    const cards = new Map(nodes.map((n) => [n.id, n.data.card]));
    // Where cards were and are now: any line through either may need a new route.
    const moved: Box[] = [];
    for (const id of this.all ? [] : rebuilt) {
      for (const card of [previous.get(id)?.data.card, cards.get(id)]) {
        if (card && card.type !== "group") moved.push(card);
      }
    }

    // An edge is redrawn only when it or a card at either end changed, so
    // moving one card doesn't hand React Flow a new object for every edge.
    const previousEdges = new Map(this.edges.map((e) => [e.id, e]));
    const edges: CanvasFlowEdge[] = [];
    canvasEdges(this.doc).forEach((edge, id) => {
      if (!(edge instanceof Y.Map)) return;
      const prior = previousEdges.get(id);
      if (
        prior &&
        !this.all &&
        !this.dirtyEdges.has(id) &&
        !rebuilt.has(prior.source) &&
        !rebuilt.has(prior.target)
      ) {
        const bounds = this.drawings.get(id)?.bounds;
        if (bounds && moved.some((box) => overlaps(box, bounds))) this.unrouted.add(id);
        edges.push(prior);
        return;
      }
      const built = flowEdge(id, edge, cards, prior);
      if (built) {
        edges.push(built);
        this.unrouted.add(id);
      }
    });
    if (this.drawings.size > edges.length) {
      const live = new Set(edges.map((e) => e.id));
      for (const id of this.drawings.keys()) if (!live.has(id)) this.drawings.delete(id);
    }
    const opening = this.all;
    this.dirty.clear();
    this.dirtyEdges.clear();
    this.all = false;

    this.nodes = nodes;
    this.edges = edges;
    this.cards = cards;
    this.router = new EdgeRouter(cards.values());
    this.route(opening ? ROUTE_OPEN_MS : ROUTE_REBUILD_MS, false);
    this.emit();
  }

  private scheduleRoutes() {
    if (this.routeTimer != null || this.unrouted.size === 0 || !this.observing) return;
    this.routeTimer = setTimeout(() => {
      this.routeTimer = null;
      this.route(ROUTE_SLICE_MS, true);
    }, 0);
  }

  /**
   * A connection drawn where its cards are on screen rather than in the
   * doc: React Flow moves a dragged card every frame but the doc only on
   * each write. Over the frame's budget it keeps the plain curve.
   */
  liveDrawing = (
    source: string,
    target: string,
    start: EdgeEnd,
    end: EdgeEnd,
  ): EdgeDrawing | null => {
    const from = this.cards.get(source);
    const to = this.cards.get(target);
    if (!from || !to) return null;
    const now = performance.now();
    if (now - this.liveFrame.start > 16) this.liveFrame = { start: now, spent: 0 };
    if (this.liveFrame.spent > LIVE_ROUTE_MS) return null;
    const at = (card: CanvasCard, live: EdgeEnd) => {
      const anchor = sideAnchor(card, live.side);
      return { ...card, x: card.x + live.x - anchor.x, y: card.y + live.y - anchor.y };
    };
    const drawing = this.router.draw(at(from, start), at(to, end), start.side, end.side);
    this.liveFrame.spent += performance.now() - now;
    return drawing;
  };

  /**
   * Draws the edges waiting for a route, for up to `budget` ms; the rest
   * wait for the next slice. An edge gets a new object only when it gains,
   * loses or changes a route, so routing a canvas of plain curves re-renders nothing.
   */
  private route(budget: number, emit: boolean) {
    const deadline = performance.now() + budget;
    const { router, cards } = this;
    const byId = new Map(this.edges.map((e) => [e.id, e]));
    let changed = false;
    for (const id of this.unrouted) {
      if (performance.now() > deadline) break;
      this.unrouted.delete(id);
      const edge = byId.get(id);
      const from = edge && cards.get(edge.source);
      const to = edge && cards.get(edge.target);
      if (!edge || !from || !to) continue;
      const drawing = router.draw(from, to, edge.sourceHandle, edge.targetHandle);
      const before = this.drawings.get(id);
      this.drawings.set(id, drawing);
      if ((drawing.routed || before?.routed) && drawing.d !== before?.d) changed = true;
    }
    if (changed && this.showRoutes() && emit) this.emit();
    this.scheduleRoutes();
  }

  /** Hands each edge its route, with shared stretches spread apart; true if any changed. */
  private showRoutes(): boolean {
    const routed = [...this.drawings].filter(([, drawing]) => drawing.routed);
    const separated = separateOverlaps(routed);
    let edges = this.edges;
    this.edges.forEach((edge, i) => {
      const own = this.drawings.get(edge.id);
      const drawing = separated.get(edge.id) ?? (own?.routed ? own : undefined);
      if (drawing?.d === edge.data?.drawing?.d) return;
      if (edges === this.edges) edges = [...edges];
      edges[i] = { ...edge, data: { ...edge.data, drawing } };
    });
    if (edges === this.edges) return false;
    this.edges = edges;
    return true;
  }
}

// ── Writes ──────────────────────────────────────────────────────────────────

function topZ(doc: Y.Doc): string | null {
  const ids = orderedNodeIds(doc);
  const last = ids.length ? canvasNodes(doc).get(ids[ids.length - 1]!) : undefined;
  return last instanceof Y.Map ? (str(last.get("z")) ?? null) : null;
}

/** Adds a card above everything else; returns its id. */
export function addCard(doc: Y.Doc, fields: Record<string, unknown>): string {
  const id = newCanvasId();
  doc.transact(() => {
    canvasNodes(doc).set(id, yNodeFrom({ ...fields, z: generateKeyBetween(topZ(doc), null) }));
  }, LOCAL);
  return id;
}

export function addEdge(
  doc: Y.Doc,
  edge: { from: string; to: string; fromSide?: string; toSide?: string },
): string {
  const id = newCanvasId();
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(edge)) if (value !== undefined) map.set(key, value);
  doc.transact(() => canvasEdges(doc).set(id, map), LOCAL);
  return id;
}

export function setCardFields(doc: Y.Doc, updates: Map<string, Record<string, unknown>>) {
  if (updates.size === 0) return;
  const nodes = canvasNodes(doc);
  doc.transact(() => {
    for (const [id, fields] of updates) {
      const node = nodes.get(id);
      if (!(node instanceof Y.Map)) continue;
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) node.delete(key);
        else if (node.get(key) !== value) node.set(key, value);
      }
    }
  }, LOCAL);
}

export function setEdgeFields(doc: Y.Doc, id: string, fields: Record<string, unknown>) {
  const edge = canvasEdges(doc).get(id);
  if (!(edge instanceof Y.Map)) return;
  doc.transact(() => {
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === "") edge.delete(key);
      else edge.set(key, value);
    }
  }, LOCAL);
}

/** Deletes cards and edges, plus any edge left pointing at a deleted card. */
export function deleteElements(doc: Y.Doc, nodeIds: Iterable<string>, edgeIds: Iterable<string>) {
  const nodes = canvasNodes(doc);
  const edges = canvasEdges(doc);
  const goneNodes = new Set(nodeIds);
  doc.transact(() => {
    for (const id of goneNodes) nodes.delete(id);
    for (const id of edgeIds) edges.delete(id);
    edges.forEach((edge, id) => {
      if (!(edge instanceof Y.Map)) return;
      if (goneNodes.has(String(edge.get("from"))) || goneNodes.has(String(edge.get("to")))) {
        edges.delete(id);
      }
    });
  }, LOCAL);
}

/** Moves cards to the top of the stack, keeping their order among themselves. */
export function bringToFront(doc: Y.Doc, ids: string[]) {
  const nodes = canvasNodes(doc);
  const ordered = orderedNodeIds(doc).filter((id) => ids.includes(id));
  let z = topZ(doc);
  doc.transact(() => {
    for (const id of ordered) {
      z = generateKeyBetween(z, null);
      (nodes.get(id) as Y.Map<unknown> | undefined)?.set("z", z);
    }
  }, LOCAL);
}

/** Moves cards under everything else, keeping their order among themselves. */
export function sendToBack(doc: Y.Doc, ids: string[]) {
  const nodes = canvasNodes(doc);
  const all = orderedNodeIds(doc);
  const bottom = all.find((id) => !ids.includes(id));
  let z = bottom
    ? (str((nodes.get(bottom) as Y.Map<unknown> | undefined)?.get("z")) ?? null)
    : null;
  if (!z) return;
  const moving = all.filter((id) => ids.includes(id)).reverse();
  doc.transact(() => {
    for (const id of moving) {
      z = generateKeyBetween(null, z);
      (nodes.get(id) as Y.Map<unknown> | undefined)?.set("z", z);
    }
  }, LOCAL);
}

/** Cards whose box lies wholly inside the group: what a group drag carries. */
export function cardsInside(group: CanvasCard, cards: Iterable<CanvasCard>): string[] {
  const inside: string[] = [];
  for (const card of cards) {
    if (card.id === group.id) continue;
    if (
      card.x >= group.x &&
      card.y >= group.y &&
      card.x + card.w <= group.x + group.w &&
      card.y + card.h <= group.y + group.h
    ) {
      inside.push(card.id);
    }
  }
  return inside;
}
