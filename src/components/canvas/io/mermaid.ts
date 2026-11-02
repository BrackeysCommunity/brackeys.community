/**
 * Mermaid flowcharts, state diagrams and mindmaps as JSON Canvas. Mermaid's
 * own parser reads the text (so every syntax it accepts works) and dagre,
 * the layout Mermaid draws flowcharts with, places the cards; a pasted
 * diagram comes out close to how mermaid.live shows it.
 *
 * Nodes become text cards, subgraphs and composite states become groups,
 * and links become edges with their labels and arrowheads. `fill` and
 * `stroke` styles become the nearest preset.
 *
 * The parser needs a DOM, so this runs in the page, never the worker. Both
 * libraries load on first use.
 */
import type { CanvasSide, JsonCanvas, JsonCanvasNode } from "@/lib/canvas/json-canvas";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";

import { unescapeHtml } from "./clipboard";
import { presetFor } from "./preset-color";

const MERMAID_EXTENSIONS = /\.(mmd|mermaid)$/i;

export function isMermaidPath(path: string): boolean {
  return MERMAID_EXTENSIONS.test(path);
}

const SUPPORTED_HEADER =
  /^(?:(?:flowchart|graph)(?:\s+(?:TB|TD|BT|RL|LR))?|stateDiagram(?:-v2)?|mindmap)\s*;?$/;

/**
 * The diagram in a paste or a file, out of a ```mermaid fence and past any
 * front matter, when it's a kind that can become a canvas; else null.
 * Cheap: nothing is loaded.
 */
export function mermaidSource(text: string): string | null {
  let source = text.replace(/\r\n?/g, "\n").trim();
  const fenced = /^```\s*mermaid[^\n]*\n([\s\S]*?)\n```$/.exec(source);
  if (fenced) source = fenced[1]!.trim();
  const lines = source.split("\n");
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, n) => n > 0 && line.trim() === "---");
    if (end === -1) return null;
    i = end + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("%%")) continue;
    return SUPPORTED_HEADER.test(line) ? source : null;
  }
  return null;
}

export class MermaidImportError extends Error {
  readonly name = "MermaidImportError";
}

// ── What Mermaid's `getData()` hands back ─────────────────────────────────

interface MermaidNode {
  id: string;
  label?: string;
  labelType?: string;
  shape?: string;
  isGroup?: boolean;
  parentId?: string;
  cssStyles?: string[];
  cssCompiledStyles?: string[];
}

interface MermaidEdge {
  id: string;
  start: string;
  end: string;
  label?: string;
  arrowTypeStart?: string;
  arrowTypeEnd?: string;
  style?: string[] | string;
}

interface DiagramDb {
  getData?: () => { nodes: MermaidNode[]; edges: MermaidEdge[] };
  getDirection?: () => string | undefined;
}

const SUPPORTED_TYPES = new Set([
  "flowchart",
  "flowchart-v2",
  "flowchart-elk",
  "stateDiagram",
  "mindmap",
]);

// ── Labels and sizes ──────────────────────────────────────────────────────

const PSEUDO_STATES: Record<string, string> = { stateStart: "Start", stateEnd: "End" };

function labelText(node: Pick<MermaidNode, "label" | "shape">): string {
  if (node.shape && PSEUDO_STATES[node.shape]) return PSEUDO_STATES[node.shape]!;
  if (node.shape === "fork" || node.shape === "join") return "";
  const text = (node.label ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  return unescapeHtml(text).trim().slice(0, CANVAS_LIMITS.maxCardText);
}

const CHAR_WIDTH = 8;
const LINE_HEIGHT = 22;
const PAD = { x: 48, y: 32 };
const CARD_WIDTH = { min: 120, max: 360 };
const CARD_MIN_HEIGHT = 60;

/** Room for the text at the card's font, wrapping past the widest a card gets. */
function cardSize(text: string): { width: number; height: number } {
  const lines = text.split("\n");
  const longest = Math.max(...lines.map((l) => l.length));
  const width = Math.min(Math.max(longest * CHAR_WIDTH + PAD.x, CARD_WIDTH.min), CARD_WIDTH.max);
  const perLine = Math.max(1, Math.floor((width - PAD.x) / CHAR_WIDTH));
  const rows = lines.reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return { width, height: Math.max(rows * LINE_HEIGHT + PAD.y, CARD_MIN_HEIGHT) };
}

function styleValue(styles: readonly string[], key: string): string | undefined {
  let value: string | undefined;
  for (const style of styles) {
    for (const part of style.split(";")) {
      const [k, v] = part.split(":");
      if (k?.trim() === key && v) value = v.trim();
    }
  }
  return value;
}

/** Inline `style` wins over a class, as Mermaid draws it. */
function nodeColor(node: MermaidNode): string | undefined {
  const styles = [...(node.cssCompiledStyles ?? []), ...(node.cssStyles ?? [])];
  return presetFor(styleValue(styles, "fill")) ?? presetFor(styleValue(styles, "stroke"));
}

// ── Layout ────────────────────────────────────────────────────────────────

const RANKDIR: Record<string, string> = { TB: "TB", TD: "TB", BT: "BT", LR: "LR", RL: "RL" };
const GROUP_PAD = { side: 24, top: 48 };

function facing(from: JsonCanvasNode, to: JsonCanvasNode): CanvasSide {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) * from.height > Math.abs(dy) * from.width) return dx > 0 ? "right" : "left";
  return dy > 0 ? "bottom" : "top";
}

let ready: Promise<{
  mermaid: typeof import("mermaid").default;
  dagre: typeof import("@dagrejs/dagre");
}> | null = null;

function load() {
  ready ??= Promise.all([import("mermaid"), import("@dagrejs/dagre")]).then(
    ([{ default: mermaid }, dagre]) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
      return { mermaid, dagre };
    },
  );
  // A failed chunk load isn't cached: the next paste tries again.
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

/** Throws `MermaidImportError` with Mermaid's own reason when it can't be read. */
export async function mermaidToCanvas(source: string): Promise<JsonCanvas> {
  const { mermaid, dagre } = await load();
  // Deprecated without a replacement: the only public way to the parsed graph.
  // oxlint-disable-next-line typescript-eslint/no-deprecated
  const { getDiagramFromText } = mermaid.mermaidAPI;
  let diagram: Awaited<ReturnType<typeof getDiagramFromText>>;
  try {
    diagram = await getDiagramFromText(source);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : "";
    throw new MermaidImportError(reason || "Mermaid couldn't read this diagram.");
  }
  const db = diagram.db as DiagramDb;
  const data = SUPPORTED_TYPES.has(diagram.type) ? db.getData?.() : undefined;
  if (!data) {
    throw new MermaidImportError("Only flowcharts, state diagrams and mindmaps become canvases.");
  }

  const groupIds = new Set(data.nodes.filter((n) => n.isGroup).map((n) => n.id));
  const parentOf = (n: MermaidNode) =>
    n.parentId && groupIds.has(n.parentId) && n.parentId !== n.id ? n.parentId : undefined;
  const hasChildren = new Set(data.nodes.map(parentOf).filter(Boolean));

  const graph = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  const direction = db.getDirection?.() ?? (diagram.type === "mindmap" ? "LR" : "TB");
  graph.setGraph({ rankdir: RANKDIR[direction] ?? "TB", nodesep: 50, ranksep: 70 });
  graph.setDefaultEdgeLabel(() => ({}));

  const texts = new Map<string, string>();
  for (const node of data.nodes) {
    const text = labelText(node);
    texts.set(node.id, text);
    // An empty subgraph is laid out like a card, since dagre only sizes clusters by what's in them.
    if (node.isGroup && hasChildren.has(node.id)) graph.setNode(node.id, {});
    else graph.setNode(node.id, cardSize(node.isGroup ? "" : text));
  }
  for (const node of data.nodes) {
    const parent = parentOf(node);
    if (parent) graph.setParent(node.id, parent);
  }
  // dagre can't route to a cluster; a link to a subgraph is laid out without it.
  const laidOut = data.edges.filter(
    (e) =>
      graph.hasNode(e.start) &&
      graph.hasNode(e.end) &&
      !hasChildren.has(e.start) &&
      !hasChildren.has(e.end),
  );
  for (const edge of laidOut) {
    const label = labelText({ label: edge.label });
    graph.setEdge(
      edge.start,
      edge.end,
      label ? { ...cardSize(label), labelpos: "c" } : {},
      edge.id,
    );
  }
  dagre.layout(graph);

  const cards = new Map<string, JsonCanvasNode>();
  for (const node of data.nodes) {
    if (node.isGroup && hasChildren.has(node.id)) continue;
    const { x, y, width, height } = graph.node(node.id) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    const color = nodeColor(node);
    cards.set(node.id, {
      id: node.id,
      ...(node.isGroup
        ? { type: "group", label: texts.get(node.id) || node.id }
        : { type: "text", text: texts.get(node.id)! }),
      x: x - width / 2,
      y: y - height / 2,
      width,
      height,
      ...(color ? { color } : {}),
    });
  }

  // Groups wrap what's in them, with room above for the label.
  const groups = new Map<string, JsonCanvasNode>();
  const children = (id: string) => data.nodes.filter((n) => parentOf(n) === id);
  const boxOf = (id: string, depth = 0): JsonCanvasNode | undefined => {
    if (cards.has(id)) return cards.get(id);
    if (groups.has(id) || depth > data.nodes.length) return groups.get(id);
    const inside = children(id)
      .map((n) => boxOf(n.id, depth + 1))
      .filter((b): b is JsonCanvasNode => b != null);
    if (inside.length === 0) return undefined;
    const left = Math.min(...inside.map((b) => b.x)) - GROUP_PAD.side;
    const top = Math.min(...inside.map((b) => b.y)) - GROUP_PAD.top;
    const right = Math.max(...inside.map((b) => b.x + b.width)) + GROUP_PAD.side;
    const bottom = Math.max(...inside.map((b) => b.y + b.height)) + GROUP_PAD.side;
    const color = nodeColor(data.nodes.find((n) => n.id === id)!);
    const group: JsonCanvasNode = {
      id,
      type: "group",
      label: (texts.get(id) || id).slice(0, CANVAS_LIMITS.maxLabel),
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      ...(color ? { color } : {}),
    };
    groups.set(id, group);
    return group;
  };
  for (const id of hasChildren) if (id) boxOf(id);

  const placed = new Map([...groups, ...cards]);
  const depthOf = (id: string): number => {
    const parent = parentOf(data.nodes.find((n) => n.id === id)!);
    return parent ? depthOf(parent) + 1 : 0;
  };
  // Outer groups first, then inner ones, then cards: each draws above what holds it.
  const sortedGroups = [...groups.values()].sort((a, b) => depthOf(a.id) - depthOf(b.id));

  return {
    nodes: [...sortedGroups, ...cards.values()],
    edges: data.edges.flatMap((edge) => {
      const from = placed.get(edge.start);
      const to = placed.get(edge.end);
      if (!from || !to) return [];
      const label = labelText({ label: edge.label }).slice(0, CANVAS_LIMITS.maxLabel);
      const startArrow = edge.arrowTypeStart && edge.arrowTypeStart !== "none";
      const endArrow = edge.arrowTypeEnd && edge.arrowTypeEnd !== "none";
      const stroke = presetFor(
        styleValue(Array.isArray(edge.style) ? edge.style : [edge.style ?? ""], "stroke"),
      );
      return [
        {
          id: edge.id,
          fromNode: from.id,
          fromSide: facing(from, to),
          ...(startArrow ? { fromEnd: "arrow" as const } : {}),
          toNode: to.id,
          toSide: facing(to, from),
          ...(endArrow ? {} : { toEnd: "none" as const }),
          ...(stroke ? { color: stroke } : {}),
          ...(label ? { label } : {}),
        },
      ];
    }),
  };
}
