/**
 * JSON Canvas 1.0 ⇄ the canvas Y.Doc. Pure: used by the browser, the web
 * server and `canvas-sync`, so no `@/` imports.
 *
 * Doc layout:
 *
 *   nodes  id → Y.Map { type, x, y, w, h, z, color?, text?: Y.Text, file?,
 *                       subpath?, url?, attachmentId?, entity?, label?,
 *                       background?, backgroundStyle?, bom?, plain?, extra?,
 *                       keys? }
 *   edges  id → Y.Map { from, fromSide?, fromEnd?, to, toSide?, toEnd?,
 *                       color?, label?, extra?, keys? }
 *   meta   { schemaVersion, extra? }
 *
 * `z` is a fractional index; JSON Canvas's array order is derived from it,
 * sorted by `(z, id)`. `image` and `entity` are our node types: in a file
 * they're a `file` and a `link` node carrying a `jamsTeam` key, which
 * Obsidian keeps. Files and stored snapshots written before the rebrand
 * carry the same key as `brackeys`, so every reader accepts both (see
 * `canvasNodeKey`). Keys we don't know (other plugins') ride in `extra` and
 * are written back as they were. `keys` is the order a file listed a node's
 * or edge's keys in, kept when it isn't the order we write anyway, so a
 * file Obsidian wrote exports byte for byte.
 *
 * Some fields live in the doc only and never reach JSON Canvas output or a
 * snapshot (`DOC_ONLY_FIELDS`): a `file` card's `text` is the note's body,
 * imported inline until notes are documents of their own, with `bom` when
 * the file started with a UTF-8 byte order mark; an `image` card's `plain`
 * says it came from a vault as a plain `file` node, so a vault export
 * writes it back that way.
 */
import { generateNKeysBetween } from "fractional-indexing";
import * as Y from "yjs";
import * as z from "zod";

import { CANVAS_LIMITS } from "./limits";

const CANVAS_SCHEMA_VERSION = 1;

const JSON_CANVAS_NODE_TYPES = ["text", "file", "link", "group"] as const;

const CANVAS_SIDES = ["top", "right", "bottom", "left"] as const;
export type CanvasSide = (typeof CANVAS_SIDES)[number];

const CANVAS_ENDS = ["none", "arrow"] as const;
type CanvasEnd = (typeof CANVAS_ENDS)[number];

export const ENTITY_KINDS = ["jam", "game", "team", "profile", "forum-post"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

export type CanvasNodeKey =
  | { type: "image"; attachmentId: string }
  | { type: "entity"; entity: EntityRef };

export interface JsonCanvasNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
  background?: string;
  backgroundStyle?: string;
  jamsTeam?: CanvasNodeKey;
  /** The pre-rebrand spelling of `jamsTeam`; read, never written. */
  brackeys?: CanvasNodeKey;
  [key: string]: unknown;
}

interface JsonCanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: CanvasSide;
  fromEnd?: CanvasEnd;
  toNode: string;
  toSide?: CanvasSide;
  toEnd?: CanvasEnd;
  color?: string;
  label?: string;
  [key: string]: unknown;
}

export interface JsonCanvas {
  nodes: JsonCanvasNode[];
  edges: JsonCanvasEdge[];
  [key: string]: unknown;
}

/**
 * Recognises JSON Canvas in a pasted string or an imported file: lenient on
 * everything the round-trip rules say to accept (missing arrays, any id
 * format, extra keys, Obsidian's `center` on copied fragments).
 */
export const jsonCanvasSchema = z.looseObject({
  nodes: z
    .array(
      z.looseObject({
        id: z.string().min(1),
        type: z.string(),
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      }),
    )
    .optional(),
  edges: z
    .array(
      z.looseObject({
        id: z.string().min(1),
        fromNode: z.string(),
        toNode: z.string(),
      }),
    )
    .optional(),
});

// ── Keys ──────────────────────────────────────────────────────────────────

const COMMON_NODE_KEYS = [
  "id",
  "type",
  "x",
  "y",
  "width",
  "height",
  "color",
  "jamsTeam",
  "brackeys",
];
const TYPE_NODE_KEYS: Record<string, readonly string[]> = {
  text: ["text"],
  file: ["file", "subpath"],
  link: ["url"],
  group: ["label", "background", "backgroundStyle"],
};
/** Known keys per node type: another type's key (a plugin's `text` on a file node) stays in `extra`. */
const NODE_KEYS = Object.fromEntries(
  Object.entries(TYPE_NODE_KEYS).map(([type, keys]) => [
    type,
    new Set([...COMMON_NODE_KEYS, ...keys]),
  ]),
) as Record<string, ReadonlySet<string>>;
/**
 * Our cards written as something Obsidian can show carry what the card
 * needs back: a clipboard image is a `link` with its vault path, and an
 * export writes an image as a `text` placeholder with its path and a site
 * card as `text` with its page's `url`.
 */
const CARRIED_KEYS: Record<string, Partial<Record<CanvasNodeKey["type"], ReadonlySet<string>>>> = {
  link: { image: new Set([...NODE_KEYS.link!, "file"]) },
  text: {
    image: new Set([...NODE_KEYS.text!, "file"]),
    entity: new Set([...NODE_KEYS.text!, "url"]),
  },
};

function nodeKeysFor(type: string, key: CanvasNodeKey["type"] | undefined): ReadonlySet<string> {
  return (key && CARRIED_KEYS[type]?.[key]) ?? NODE_KEYS[type]!;
}
const EDGE_KEYS = new Set([
  "id",
  "fromNode",
  "fromSide",
  "fromEnd",
  "toNode",
  "toSide",
  "toEnd",
  "color",
  "label",
]);
const CANVAS_KEYS = new Set(["nodes", "edges", "jamsTeam", "brackeys", "center"]);

/** The order we write keys in; keys not listed (other plugins') come first, as read. */
const NODE_KEY_ORDER = [
  "id",
  "type",
  "text",
  "file",
  "subpath",
  "url",
  "label",
  "background",
  "backgroundStyle",
  "x",
  "y",
  "width",
  "height",
  "color",
  "jamsTeam",
];
const EDGE_KEY_ORDER = [...EDGE_KEYS];
const MAX_KEY_ORDER_BYTES = 1_024;

/** A file's key order, when it differs from the order we'd write. */
function sourceKeyOrder(
  raw: Record<string, unknown>,
  order: readonly string[],
): string[] | undefined {
  const keys = Object.keys(raw).map((key) => (key === "brackeys" ? "jamsTeam" : key));
  const rank = (key: string) => order.indexOf(key);
  const ours = [...keys].sort((a, b) => rank(a) - rank(b));
  if (ours.every((key, i) => key === keys[i])) return undefined;
  if (JSON.stringify(keys).length > MAX_KEY_ORDER_BYTES) return undefined;
  return keys;
}

/** `record` with its keys in a file's order; keys the file didn't have keep their place after. */
function inKeyOrder<T extends object>(record: T, keys: unknown): T {
  if (!Array.isArray(keys)) return record;
  const entries = Object.entries(record);
  const at = new Map(keys.map((key, i) => [key, i]));
  const placed = entries.filter(([key]) => at.has(key));
  placed.sort(([a], [b]) => at.get(a)! - at.get(b)!);
  return Object.fromEntries([...placed, ...entries.filter(([key]) => !at.has(key))]) as T;
}

/** A `file` card's inline note body. */
export interface FileBody {
  text: string;
  /** The file started with a UTF-8 byte order mark, written back on export. */
  bom?: boolean;
}

/** Per node, what the doc holds beyond JSON Canvas. */
export interface DocOnlyFields {
  /** `file` cards: the inline note body. */
  text?: string;
  bom?: boolean;
  /** `image` cards: imported from a plain `file` node. */
  plain?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Unknown keys, kept only while they stay small. */
function extraOf(
  source: Record<string, unknown>,
  known: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  let any = false;
  for (const [key, value] of Object.entries(source)) {
    if (known.has(key) || value === undefined) continue;
    extra[key] = value;
    any = true;
  }
  if (!any) return undefined;
  return boundedExtra(extra);
}

function boundedExtra(extra: unknown): Record<string, unknown> | undefined {
  if (!isRecord(extra)) return undefined;
  try {
    const json = JSON.stringify(extra);
    if (new TextEncoder().encode(json).length > CANVAS_LIMITS.maxExtraBytes) return undefined;
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function entityOf(value: unknown): EntityRef | undefined {
  if (!isRecord(value)) return undefined;
  const kind = oneOf(ENTITY_KINDS, value.kind);
  const id = str(value.id);
  return kind && id ? { kind, id } : undefined;
}

function nodeKeyOf(value: unknown): CanvasNodeKey | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "image") {
    const attachmentId = str(value.attachmentId);
    return attachmentId ? { type: "image", attachmentId } : undefined;
  }
  if (value.type === "entity") {
    const entity = entityOf(value.entity);
    return entity ? { type: "entity", entity } : undefined;
  }
  return undefined;
}

/** A node's `jamsTeam` key, falling back to the legacy `brackeys` spelling. */
export function canvasNodeKey(node: Record<string, unknown>): CanvasNodeKey | undefined {
  return nodeKeyOf(node.jamsTeam) ?? nodeKeyOf(node.brackeys);
}

function canvasKeyOf(canvas: Record<string, unknown>): Record<string, unknown> | undefined {
  if (isRecord(canvas.jamsTeam)) return canvas.jamsTeam;
  if (isRecord(canvas.brackeys)) return canvas.brackeys;
  return undefined;
}

// ── Reading the doc ───────────────────────────────────────────────────────

export function canvasNodes(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap("nodes");
}

export function canvasEdges(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap("edges");
}

export function canvasMeta(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap("meta");
}

/** Plain string comparison: fractional-index keys order by code unit. */
function compareZ(a: [string, string], b: [string, string]): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
}

/** Node ids bottom to top. */
export function orderedNodeIds(doc: Y.Doc): string[] {
  const entries: [string, string][] = [];
  canvasNodes(doc).forEach((node, id) => {
    entries.push([str(node instanceof Y.Map ? node.get("z") : undefined) ?? "", id]);
  });
  return entries.sort(compareZ).map(([, id]) => id);
}

function maxZ(doc: Y.Doc): string | null {
  let max: string | null = null;
  canvasNodes(doc).forEach((node) => {
    const z = node instanceof Y.Map ? str(node.get("z")) : undefined;
    if (z && (max === null || z > max)) max = z;
  });
  return max;
}

function textOf(value: unknown): string | undefined {
  if (value instanceof Y.Text) return value.toJSON();
  return str(value);
}

function nodeToJson(
  id: string,
  node: Y.Map<unknown>,
  options: { vault?: boolean },
): JsonCanvasNode | null {
  const type = str(node.get("type"));
  const geometry = {
    x: num(node.get("x"), 0),
    y: num(node.get("y"), 0),
    width: num(node.get("w"), 250),
    height: num(node.get("h"), 60),
  };
  const color = str(node.get("color"));
  const extra = boundedExtra(node.get("extra")) ?? {};

  let body: Record<string, unknown>;
  switch (type) {
    case "text":
      body = { type, text: textOf(node.get("text")) ?? "" };
      break;
    case "file":
      body = { type, file: str(node.get("file")) ?? "", subpath: str(node.get("subpath")) };
      break;
    case "link":
      body = { type, url: str(node.get("url")) ?? "" };
      break;
    case "group":
      body = {
        type,
        label: str(node.get("label")),
        background: str(node.get("background")),
        backgroundStyle: str(node.get("backgroundStyle")),
      };
      break;
    case "image": {
      const attachmentId = str(node.get("attachmentId"));
      if (!attachmentId) return null;
      body = {
        type: "file",
        file: str(node.get("file")) ?? "",
        jamsTeam:
          options.vault && node.get("plain") === true ? undefined : { type: "image", attachmentId },
      };
      break;
    }
    case "entity": {
      const entity = entityOf(node.get("entity"));
      if (!entity) return null;
      body = {
        type: "link",
        url: str(node.get("url")) ?? "",
        jamsTeam: { type: "entity", entity },
      };
      break;
    }
    default:
      return null;
  }

  const { jamsTeam, ...content } = body;
  const json = dropUndefined({ ...extra, id, ...content, ...geometry, color, jamsTeam });
  return inKeyOrder(json, node.get("keys")) as JsonCanvasNode;
}

function edgeToJson(id: string, edge: Y.Map<unknown>): JsonCanvasEdge | null {
  const fromNode = str(edge.get("from"));
  const toNode = str(edge.get("to"));
  if (!fromNode || !toNode) return null;
  const extra = boundedExtra(edge.get("extra")) ?? {};
  const json = dropUndefined({
    ...extra,
    id,
    fromNode,
    fromSide: oneOf(CANVAS_SIDES, edge.get("fromSide")),
    fromEnd: oneOf(CANVAS_ENDS, edge.get("fromEnd")),
    toNode,
    toSide: oneOf(CANVAS_SIDES, edge.get("toSide")),
    toEnd: oneOf(CANVAS_ENDS, edge.get("toEnd")),
    color: str(edge.get("color")),
    label: str(edge.get("label")),
  });
  return inKeyOrder(json, edge.get("keys")) as JsonCanvasEdge;
}

function dropUndefined(record: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(record)) if (record[key] === undefined) delete record[key];
  return record;
}

/**
 * The doc as a JSON Canvas file, nodes in z-order. Reads defensively, since
 * any editor can write anything into the doc; run `sanitizeSnapshot` on the
 * result before anyone else sees it (`deriveSnapshot` does both).
 */
export function docToJsonCanvas(
  doc: Y.Doc,
  options: {
    canvasId?: string;
    /**
     * For a vault, next to its images: image cards that came in as plain
     * `file` nodes go back out that way.
     */
    vault?: boolean;
  } = {},
): JsonCanvas {
  const nodesMap = canvasNodes(doc);
  const nodes: JsonCanvasNode[] = [];
  for (const id of orderedNodeIds(doc)) {
    const node = nodesMap.get(id);
    if (!(node instanceof Y.Map)) continue;
    const json = nodeToJson(id, node, options);
    if (json) nodes.push(json);
  }

  const edges: JsonCanvasEdge[] = [];
  canvasEdges(doc).forEach((edge, id) => {
    if (!(edge instanceof Y.Map)) return;
    const json = edgeToJson(id, edge);
    if (json) edges.push(json);
  });

  const extra = boundedExtra(canvasMeta(doc).get("extra")) ?? {};
  const canvas: JsonCanvas = { ...extra, nodes, edges };
  if (options.canvasId) {
    canvas.jamsTeam = { id: options.canvasId, schemaVersion: CANVAS_SCHEMA_VERSION };
  }
  return canvas;
}

// ── Sanitising ────────────────────────────────────────────────────────────

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function truncated(value: unknown, max: number): string | undefined {
  const s = str(value);
  return s === undefined ? undefined : s.slice(0, max);
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const PRESET_COLOR = /^[1-6]$/;

function colorOf(value: unknown): string | undefined {
  const s = str(value);
  return s && (PRESET_COLOR.test(s) || HEX_COLOR.test(s)) ? s : undefined;
}

/**
 * The only validation layer between an editor's Yjs writes and every
 * reader: unknown node types dropped, coordinates and sizes made integers
 * (the spec requires it) and clamped, strings truncated, duplicate ids and
 * dangling edges removed, the node cap applied.
 */
export function sanitizeSnapshot(canvas: JsonCanvas): JsonCanvas {
  const L = CANVAS_LIMITS;
  const ids = new Set<string>();
  const nodes: JsonCanvasNode[] = [];

  for (const raw of Array.isArray(canvas.nodes) ? canvas.nodes : []) {
    if (nodes.length >= L.maxNodes) break;
    if (!isRecord(raw)) continue;
    const id = truncated(raw.id, 200);
    const type = oneOf(JSON_CANVAS_NODE_TYPES, raw.type);
    if (!id || !type || ids.has(id)) continue;

    const key = canvasNodeKey(raw);
    const node: Record<string, unknown> = {
      ...extraOf(raw, nodeKeysFor(type, key?.type)),
      id,
      type,
    };
    if (type === "text") node.text = truncated(raw.text, L.maxCardText) ?? "";
    if (type === "file") {
      node.file = truncated(raw.file, 1_024) ?? "";
      node.subpath = truncated(raw.subpath, 1_024);
    }
    if (type === "link") node.url = truncated(raw.url, L.maxUrl) ?? "";
    if (type === "group") {
      node.label = truncated(raw.label, L.maxLabel);
      node.background = truncated(raw.background, 1_024);
      node.backgroundStyle = oneOf(["cover", "ratio", "repeat"], raw.backgroundStyle);
    }
    node.x = clampInt(raw.x, -L.maxCoordinate, L.maxCoordinate, 0);
    node.y = clampInt(raw.y, -L.maxCoordinate, L.maxCoordinate, 0);
    node.width = clampInt(raw.width, L.minSize, L.maxSize, 250);
    node.height = clampInt(raw.height, L.minSize, L.maxSize, 60);
    node.color = colorOf(raw.color);
    if (
      (key?.type === "image" && (type === "file" || type === "link")) ||
      (key?.type === "entity" && type === "link")
    ) {
      node.jamsTeam = key;
    }

    ids.add(id);
    nodes.push(dropUndefined(node) as JsonCanvasNode);
  }

  const edgeIds = new Set<string>();
  const edges: JsonCanvasEdge[] = [];
  for (const raw of Array.isArray(canvas.edges) ? canvas.edges : []) {
    if (!isRecord(raw)) continue;
    const id = truncated(raw.id, 200);
    const fromNode = str(raw.fromNode);
    const toNode = str(raw.toNode);
    if (!id || edgeIds.has(id) || !fromNode || !toNode) continue;
    if (!ids.has(fromNode) || !ids.has(toNode)) continue;
    edgeIds.add(id);
    edges.push(
      dropUndefined({
        ...extraOf(raw, EDGE_KEYS),
        id,
        fromNode,
        fromSide: oneOf(CANVAS_SIDES, raw.fromSide),
        fromEnd: oneOf(CANVAS_ENDS, raw.fromEnd),
        toNode,
        toSide: oneOf(CANVAS_SIDES, raw.toSide),
        toEnd: oneOf(CANVAS_ENDS, raw.toEnd),
        color: colorOf(raw.color),
        label: truncated(raw.label, L.maxLabel),
      }) as JsonCanvasEdge,
    );
  }

  const top = isRecord(canvas) ? (extraOf(canvas, CANVAS_KEYS) ?? {}) : {};
  const result: JsonCanvas = { ...top, nodes, edges };
  const canvasKey = isRecord(canvas) ? canvasKeyOf(canvas) : undefined;
  if (canvasKey) result.jamsTeam = canvasKey;
  return result;
}

/** What the server stores for readers: the doc, converted and sanitised. */
export function deriveSnapshot(doc: Y.Doc): JsonCanvas {
  return sanitizeSnapshot(docToJsonCanvas(doc));
}

// ── Writing into the doc ──────────────────────────────────────────────────

/** A 16-hex-digit id, the format Obsidian gives its own nodes and edges. */
export function newCanvasId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What a JSON Canvas node becomes in the doc, as plain values. */
function nodeFields(raw: Record<string, unknown>): Record<string, unknown> | null {
  const key = canvasNodeKey(raw);
  const jsonType = oneOf(JSON_CANVAS_NODE_TYPES, raw.type);
  if (!jsonType) return null;

  const fields: Record<string, unknown> = {
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    w: num(raw.width, 250),
    h: num(raw.height, 60),
    color: str(raw.color),
    extra: extraOf(raw, nodeKeysFor(jsonType, key?.type)),
    keys: sourceKeyOrder(raw, NODE_KEY_ORDER),
  };

  if (key?.type === "image" && jsonType !== "group") {
    // On the clipboard an image is a link to its URL, so Obsidian shows it,
    // and in a lone `.canvas` file a text placeholder; both carry its path
    // in `file` so it exports as a usable file node again.
    Object.assign(fields, {
      type: "image",
      attachmentId: key.attachmentId,
      file: str(raw.file),
    });
  } else if (key?.type === "entity" && (jsonType === "link" || jsonType === "text")) {
    Object.assign(fields, { type: "entity", entity: key.entity, url: str(raw.url) });
  } else if (jsonType === "text") {
    Object.assign(fields, { type: "text", text: str(raw.text) ?? "" });
  } else if (jsonType === "file") {
    Object.assign(fields, { type: "file", file: str(raw.file) ?? "", subpath: str(raw.subpath) });
  } else if (jsonType === "link") {
    Object.assign(fields, { type: "link", url: str(raw.url) ?? "" });
  } else {
    Object.assign(fields, {
      type: "group",
      label: str(raw.label),
      background: str(raw.background),
      backgroundStyle: str(raw.backgroundStyle),
    });
  }
  return dropUndefined(fields);
}

/** A doc node from plain fields; `text` becomes a `Y.Text`. */
export function yNodeFrom(fields: Record<string, unknown>): Y.Map<unknown> {
  const node = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    node.set(key, key === "text" && typeof value === "string" ? new Y.Text(value) : value);
  }
  return node;
}

function edgeFields(
  raw: Record<string, unknown>,
  from: string,
  to: string,
): Record<string, unknown> {
  return dropUndefined({
    from,
    fromSide: oneOf(CANVAS_SIDES, raw.fromSide),
    fromEnd: oneOf(CANVAS_ENDS, raw.fromEnd),
    to,
    toSide: oneOf(CANVAS_SIDES, raw.toSide),
    toEnd: oneOf(CANVAS_ENDS, raw.toEnd),
    color: str(raw.color),
    label: str(raw.label),
    extra: extraOf(raw, EDGE_KEYS),
    keys: sourceKeyOrder(raw, EDGE_KEY_ORDER),
  });
}

export function yEdgeFrom(fields: Record<string, unknown>): Y.Map<unknown> {
  const edge = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) edge.set(key, value);
  return edge;
}

interface ApplyJsonCanvasOptions {
  /**
   * `whole`: the canvas is a complete file, loaded as is: ids kept (so a
   * vault's later edits diff by id) and top-level keys kept.
   * `fragment` (default): a paste or import into a canvas: fresh ids, edge
   * endpoints remapped, and the fragment's bounding box moved to `at`.
   */
  mode?: "whole" | "fragment";
  at?: { x: number; y: number };
  /** Transaction origin; local edits pass the editor's undo origin. */
  origin?: unknown;
  /** Doc-only fields per source node id: note bodies, image provenance. */
  docFields?: Readonly<Record<string, DocOnlyFields>>;
}

interface ApplyJsonCanvasResult {
  /** Doc ids of the nodes created, bottom to top. */
  created: string[];
  /** Source node id → doc node id. */
  ids: Map<string, string>;
  /** Nodes left out because their type isn't one we can hold. */
  skipped: { id: string; type: string }[];
}

/**
 * Inserts a JSON Canvas into the doc, above everything already there. Runs
 * in transactions of `applyChunkSize` cards, so a large paste or import is
 * never one sync message over the transport cap.
 */
export function applyJsonCanvas(
  doc: Y.Doc,
  canvas: unknown,
  options: ApplyJsonCanvasOptions = {},
): ApplyJsonCanvasResult {
  const mode = options.mode ?? "fragment";
  const source = isRecord(canvas) ? canvas : {};
  const rawNodes = (Array.isArray(source.nodes) ? source.nodes : []).filter(isRecord);
  const rawEdges = (Array.isArray(source.edges) ? source.edges : []).filter(isRecord);

  const nodesMap = canvasNodes(doc);
  const edgesMap = canvasEdges(doc);
  const idMap = new Map<string, string>();
  const skipped: ApplyJsonCanvasResult["skipped"] = [];
  const pending: { id: string; fields: Record<string, unknown> }[] = [];

  for (const raw of rawNodes) {
    const sourceId = str(raw.id);
    if (!sourceId || idMap.has(sourceId)) continue;
    const fields = nodeFields(raw);
    if (!fields) {
      skipped.push({ id: sourceId, type: String(raw.type) });
      continue;
    }
    const only = options.docFields?.[sourceId];
    if (only) Object.assign(fields, docOnlyFieldsFor(fields.type, only));
    const keep = mode === "whole" && !nodesMap.has(sourceId);
    const id = keep ? sourceId : newCanvasId();
    idMap.set(sourceId, id);
    pending.push({ id, fields });
  }

  if (mode === "fragment" && options.at && pending.length > 0) {
    const minX = Math.min(...pending.map((p) => p.fields.x as number));
    const minY = Math.min(...pending.map((p) => p.fields.y as number));
    for (const p of pending) {
      p.fields.x = (p.fields.x as number) - minX + options.at.x;
      p.fields.y = (p.fields.y as number) - minY + options.at.y;
    }
  }

  const zs = generateNKeysBetween(maxZ(doc), null, pending.length);
  pending.forEach((p, i) => {
    p.fields.z = zs[i];
  });

  const chunk = CANVAS_LIMITS.applyChunkSize;
  for (const batch of nodeBatches(pending, chunk)) {
    doc.transact(() => {
      for (const p of batch) nodesMap.set(p.id, yNodeFrom(p.fields));
    }, options.origin);
  }

  const edges: [string, Record<string, unknown>][] = [];
  const edgeIds = new Set<string>();
  for (const raw of rawEdges) {
    const from = idMap.get(str(raw.fromNode) ?? "");
    const to = idMap.get(str(raw.toNode) ?? "");
    const sourceId = str(raw.id);
    if (!from || !to || !sourceId || edgeIds.has(sourceId)) continue;
    edgeIds.add(sourceId);
    const keep = mode === "whole" && !edgesMap.has(sourceId);
    edges.push([keep ? sourceId : newCanvasId(), edgeFields(raw, from, to)]);
  }
  const topExtra = mode === "whole" ? extraOf(source, CANVAS_KEYS) : undefined;

  for (let start = 0; start < Math.max(edges.length, 1); start += chunk) {
    doc.transact(() => {
      for (const [id, fields] of edges.slice(start, start + chunk))
        edgesMap.set(id, yEdgeFrom(fields));
      if (start === 0) {
        const meta = canvasMeta(doc);
        if (meta.get("schemaVersion") === undefined)
          meta.set("schemaVersion", CANVAS_SCHEMA_VERSION);
        if (topExtra) meta.set("extra", topExtra);
      }
    }, options.origin);
  }

  return { created: pending.map((p) => p.id), ids: idMap, skipped };
}

/** Rough upper bound on a node's encoded size: text is counted at 3 bytes a character. */
function roughNodeBytes(fields: Record<string, unknown>): number {
  let bytes = 200;
  for (const value of Object.values(fields)) {
    if (typeof value === "string") bytes += value.length * 3;
    else if (value && typeof value === "object") bytes += JSON.stringify(value).length;
  }
  return bytes;
}

/**
 * Nodes in transactions of at most `count` cards and about half a sync
 * message's bytes, so one with long note bodies still travels as its own
 * message. A single node larger than that goes alone.
 */
function nodeBatches<T extends { fields: Record<string, unknown> }>(
  pending: readonly T[],
  count: number,
): T[][] {
  const budget = CANVAS_LIMITS.maxMessageBytes / 2;
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const p of pending) {
    const size = roughNodeBytes(p.fields);
    if (current.length && (current.length >= count || bytes + size > budget)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(p);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** The doc-only fields a node of `type` may carry, and nothing else. */
function docOnlyFieldsFor(type: unknown, only: DocOnlyFields): Record<string, unknown> {
  if (type === "file" && typeof only.text === "string") {
    return dropUndefined({ text: only.text, bom: only.bom === true ? true : undefined });
  }
  if (type === "image" && only.plain === true) return { plain: true };
  return {};
}

/**
 * The doc-only fields of the given nodes (all by default), keyed by node
 * id: what a copy or a duplicate carries alongside the JSON Canvas so the
 * same `applyJsonCanvas` brings note bodies with it.
 */
export function docOnlyFields(
  doc: Y.Doc,
  ids?: ReadonlySet<string>,
): Record<string, DocOnlyFields> {
  const out: Record<string, DocOnlyFields> = {};
  canvasNodes(doc).forEach((node, id) => {
    if (!(node instanceof Y.Map) || (ids && !ids.has(id))) return;
    const body = fileBodyOf(node);
    if (body) out[id] = body;
    else if (node.get("type") === "image" && node.get("plain") === true) out[id] = { plain: true };
  });
  return out;
}

/** A `file` card's inline note body, if it has one. */
export function fileBodyOf(node: Y.Map<unknown>): FileBody | undefined {
  const text = node.get("text");
  if (node.get("type") !== "file" || !(text instanceof Y.Text)) return undefined;
  return node.get("bom") === true ? { text: text.toJSON(), bom: true } : { text: text.toJSON() };
}
