/**
 * The canvas clipboard, both ways. Copy writes three types inside the
 * `copy` event (`clipboardData.setData` works in every browser):
 *
 * - `obsidian/canvas`: what Obsidian itself copies and pastes, JSON Canvas
 *   plus `center`. Our types map down as on export, except an image card
 *   becomes a `link` to the image's URL so Obsidian shows the picture; it
 *   keeps its `jamsTeam` key and `file` so it comes back as the same image.
 * - `text/html`: our full fragment, note bodies included, in a
 *   `data-jams-team-canvas` attribute, around the outline as readable text.
 * - `text/plain`: the Markdown outline, for notes and chats.
 *
 * Paste reads `obsidian/canvas`, then our HTML payload, then `text/plain`
 * that parses as JSON Canvas, then image files, then a single URL, then any
 * text. One copy of ours writes both canvas types; when both are there and
 * hold the same cards, the HTML payload wins, being the lossless one.
 *
 * Pure: no DOM.
 */
import * as Y from "yjs";

import {
  applyJsonCanvas,
  canvasNodeKey,
  type DocOnlyFields,
  type JsonCanvas,
  type JsonCanvasNode,
  jsonCanvasSchema,
} from "@/lib/canvas/json-canvas";
import { CANVAS_IMPORT_LIMITS, CANVAS_LIMITS } from "@/lib/canvas/limits";

export const OBSIDIAN_CANVAS_TYPE = "obsidian/canvas";
export const CANVAS_HTML_ATTRIBUTE = "data-jams-team-canvas";

/** What our HTML payload carries. */
export interface CanvasClipboardPayload {
  v: 1;
  canvas: JsonCanvas;
  fields: Record<string, DocOnlyFields>;
}

export type CanvasClipboardWrite = Record<"obsidian/canvas" | "text/html" | "text/plain", string>;

function bounds(nodes: readonly JsonCanvasNode[]) {
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const maxY = Math.max(...nodes.map((n) => n.y + n.height));
  return { minX, minY, maxX, maxY };
}

function centerOf(nodes: readonly JsonCanvasNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 0, y: 0 };
  const b = bounds(nodes);
  return { x: Math.round((b.minX + b.maxX) / 2), y: Math.round((b.minY + b.maxY) / 2) };
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const NAMED: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: "\u00a0",
};

export function unescapeHtml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code =
        ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

/**
 * The selection as Obsidian sees it: image cards as links to their URL
 * (keeping the key), everything else as the `.canvas` export writes it.
 */
export function toObsidianFragment(
  fragment: JsonCanvas,
  imageUrl: (attachmentId: string) => string | null,
): JsonCanvas {
  const nodes = fragment.nodes.map((node) => {
    const key = canvasNodeKey(node);
    if (key?.type !== "image" || node.type !== "file") return node;
    const url = imageUrl(key.attachmentId);
    if (!url) return node;
    // `file` rides along so a paste that only gets this type keeps the path.
    return { ...node, type: "link", url };
  });
  return { ...fragment, nodes, center: centerOf(fragment.nodes) };
}

export function writeCanvasClipboard(
  fragment: JsonCanvas,
  options: {
    fields: Record<string, DocOnlyFields>;
    markdown: string;
    /** An image's absolute URL; null when it can't be shown (quarantined, unknown). */
    imageUrl: (attachmentId: string) => string | null;
  },
): CanvasClipboardWrite {
  const payload: CanvasClipboardPayload = { v: 1, canvas: fragment, fields: options.fields };
  return {
    "obsidian/canvas": JSON.stringify(toObsidianFragment(fragment, options.imageUrl)),
    "text/html": `<meta charset="utf-8"><div ${CANVAS_HTML_ATTRIBUTE}="${escapeHtml(JSON.stringify(payload))}"><pre>${escapeHtml(options.markdown)}</pre></div>`,
    "text/plain": options.markdown,
  };
}

// ── Reading ───────────────────────────────────────────────────────────────

export type CanvasClipboardRead =
  | {
      kind: "canvas";
      source: "obsidian" | "jams-team" | "json";
      canvas: JsonCanvas;
      fields: Record<string, DocOnlyFields>;
    }
  | { kind: "images"; files: File[] }
  | { kind: "url"; url: string }
  | { kind: "text"; text: string };

/** JSON Canvas with at least one card, or null. */
export function parseCanvasText(text: string): JsonCanvas | null {
  if (!text) return null;
  try {
    const raw: unknown = JSON.parse(text);
    // Checked, not taken from the parse, which would reorder each card's keys.
    const parsed = jsonCanvasSchema.safeParse(raw);
    if (!parsed.success || (parsed.data.nodes?.length ?? 0) === 0) return null;
    const canvas = raw as JsonCanvas;
    return { ...canvas, edges: canvas.edges ?? [] };
  } catch {
    return null;
  }
}

const PAYLOAD_PATTERN = new RegExp(`${CANVAS_HTML_ATTRIBUTE}="([^"]*)"`);

/** Our payload out of a `text/html` clipboard value, wherever the browser wrapped it. */
export function parseCanvasHtml(html: string): CanvasClipboardPayload | null {
  const match = html ? PAYLOAD_PATTERN.exec(html) : null;
  if (!match) return null;
  try {
    const raw = JSON.parse(unescapeHtml(match[1]!)) as Partial<CanvasClipboardPayload>;
    const canvas = parseCanvasText(JSON.stringify(raw.canvas ?? null));
    if (!canvas) return null;
    const fields =
      raw.fields && typeof raw.fields === "object" && !Array.isArray(raw.fields) ? raw.fields : {};
    return { v: 1, canvas, fields: cappedFields(fields) };
  } catch {
    return null;
  }
}

/** Note bodies over the per-note cap are left out; those cards paste as "not included". */
function cappedFields(fields: Record<string, DocOnlyFields>): Record<string, DocOnlyFields> {
  const encoder = new TextEncoder();
  const out: Record<string, DocOnlyFields> = {};
  for (const [id, value] of Object.entries(fields)) {
    if (!value || typeof value !== "object") continue;
    const { text, ...rest } = value;
    const fits =
      typeof text === "string" &&
      text.length <= CANVAS_IMPORT_LIMITS.maxMarkdownBytes &&
      encoder.encode(text).length <= CANVAS_IMPORT_LIMITS.maxMarkdownBytes;
    out[id] = fits ? value : rest;
  }
  return out;
}

function sameCards(a: JsonCanvas, b: JsonCanvas): boolean {
  if (a.nodes.length !== b.nodes.length) return false;
  const ids = new Set(a.nodes.map((n) => n.id));
  return b.nodes.every((n) => ids.has(n.id));
}

const SINGLE_URL = /^https?:\/\/\S+$/;

/** What a paste holds, in the plan's order; null for nothing usable. */
export function readCanvasClipboard(
  getData: (type: string) => string,
  files: readonly File[],
): CanvasClipboardRead | null {
  const obsidian = parseCanvasText(getData(OBSIDIAN_CANVAS_TYPE));
  const ours = parseCanvasHtml(getData("text/html"));
  if (obsidian && !(ours && sameCards(obsidian, ours.canvas))) {
    return { kind: "canvas", source: "obsidian", canvas: obsidian, fields: {} };
  }
  if (ours)
    return { kind: "canvas", source: "jams-team", canvas: ours.canvas, fields: ours.fields };

  const plain = getData("text/plain");
  const json = parseCanvasText(plain);
  if (json) return { kind: "canvas", source: "json", canvas: json, fields: {} };

  const images = files.filter((f) => f.type.startsWith("image/"));
  if (images.length) return { kind: "images", files: images };

  const text = plain.trim();
  if (!text) return null;
  if (SINGLE_URL.test(text)) return { kind: "url", url: text };
  return {
    kind: "text",
    text: text.replace(/\r\n?/g, "\n").slice(0, CANVAS_LIMITS.maxCardText),
  };
}

/**
 * Where a pasted fragment's top-left goes so its middle lands on the
 * cursor; the layout inside it is kept.
 */
export function pasteOrigin(
  canvas: JsonCanvas,
  cursor: { x: number; y: number },
): { x: number; y: number } {
  if (canvas.nodes.length === 0) return cursor;
  const b = bounds(canvas.nodes);
  return {
    x: Math.round(cursor.x - (b.maxX - b.minX) / 2),
    y: Math.round(cursor.y - (b.maxY - b.minY) / 2),
  };
}

/**
 * The canvas's saved state size once `fragment` lands in `doc` at `at`,
 * measured on a copy of the doc with the same client, so the clocks and
 * references cost what they will for real. A paste or duplicate that would
 * take the canvas past `maxStateBytes` (after which every save is refused)
 * can be turned down first.
 */
export function stateBytesWith(
  doc: Y.Doc,
  fragment: JsonCanvas,
  options: { at: { x: number; y: number }; docFields?: Record<string, DocOnlyFields> },
): number {
  const copy = new Y.Doc();
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    // After the apply: a doc that receives its own client's structs picks a new id.
    copy.clientID = doc.clientID;
    applyJsonCanvas(copy, fragment, options);
    return Y.encodeStateAsUpdate(copy).length;
  } finally {
    copy.destroy();
  }
}

/**
 * Whether `fragment` landing in `doc` at `at` keeps the saved state within
 * `cap`: null when it does, else the exact size. A cheap upper bound
 * settles it away from the cap: written into the live doc, the fragment
 * grows by under 1.5× its size in a fresh doc with the smallest client id
 * and clocks (bigger ids and clocks cost more bytes per reference), so 3×
 * plus slack is safe. Only near the cap is the exact measure run.
 */
export function stateOverCap(
  doc: Y.Doc,
  fragment: JsonCanvas,
  options: { at: { x: number; y: number }; docFields?: Record<string, DocOnlyFields> },
  cap: number,
): number | null {
  const scratch = new Y.Doc();
  scratch.clientID = 1;
  let alone: number;
  try {
    applyJsonCanvas(scratch, fragment, options);
    alone = Y.encodeStateAsUpdate(scratch).length;
  } finally {
    scratch.destroy();
  }
  if (Y.encodeStateAsUpdate(doc).length + alone * 3 + 4_096 <= cap) return null;
  const bytes = stateBytesWith(doc, fragment, options);
  return bytes > cap ? bytes : null;
}
