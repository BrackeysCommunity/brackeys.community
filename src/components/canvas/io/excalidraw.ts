/**
 * Excalidraw scenes (a `.excalidraw` file, or what Excalidraw copies) as
 * JSON Canvas, so they go through the same import as an Obsidian canvas.
 *
 * Rectangles, ellipses and diamonds become text cards holding their bound
 * text, free text becomes a text card, frames become groups, images become
 * file cards, and embeds with a link become link cards. An arrow or line
 * joined to a card at both ends becomes an edge, with its bound text as the
 * label. Everything else (freehand drawing, loose arrows) is left out and
 * counted. Colours become the nearest of JSON Canvas's six presets, so they
 * follow the theme; greys and black become no colour.
 *
 * Pure: runs in the `canvas-io` worker. Image bytes stay as data URLs here
 * and are decoded where the import reads them.
 */
import { base64ToBytes } from "@/lib/canvas/encoding";
import type { CanvasSide, JsonCanvas, JsonCanvasNode } from "@/lib/canvas/json-canvas";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";
import { dirname, joinPath, pathTitle } from "@/lib/canvas/paths";

import { presetFor } from "./preset-color";

interface ExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  strokeColor?: string;
  backgroundColor?: string;
  text?: string;
  originalText?: string;
  containerId?: string | null;
  name?: string | null;
  link?: string | null;
  fileId?: string | null;
  points?: [number, number][];
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
}

interface ExcalidrawFile {
  mimeType?: string;
  dataURL?: string;
}

export interface ExcalidrawScene {
  elements: ExcalidrawElement[];
  files: Record<string, ExcalidrawFile>;
}

export interface ExcalidrawConversion {
  canvas: JsonCanvas;
  /** Images the canvas's file cards point at, by the path they use. */
  images: { path: string; dataUrl: string }[];
  /** What was left out, counted by kind. */
  skipped: { path: string; reason: string }[];
}

export function isExcalidrawPath(path: string): boolean {
  return path.toLowerCase().endsWith(".excalidraw");
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A saved scene or Excalidraw's clipboard JSON, or null for anything else. */
export function parseExcalidraw(text: string): ExcalidrawScene | null {
  if (!text || !text.includes("excalidraw")) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || (raw.type !== "excalidraw" && raw.type !== "excalidraw/clipboard")) {
    return null;
  }
  if (!Array.isArray(raw.elements)) return null;
  const elements = raw.elements.filter(
    (e): e is ExcalidrawElement =>
      isRecord(e) &&
      typeof e.id === "string" &&
      typeof e.type === "string" &&
      finite(e.x) &&
      finite(e.y) &&
      finite(e.width) &&
      finite(e.height),
  );
  const files = isRecord(raw.files) ? (raw.files as Record<string, ExcalidrawFile>) : {};
  return { elements, files };
}

// ── Colours ───────────────────────────────────────────────────────────────

/** A shape's fill if it has one, else its stroke. */
function shapeColor(el: ExcalidrawElement): string | undefined {
  return presetFor(el.backgroundColor) ?? presetFor(el.strokeColor);
}

// ── Conversion ────────────────────────────────────────────────────────────

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const CONNECTORS = new Set(["arrow", "line"]);
const EMBEDS = new Set(["embeddable", "iframe"]);
const FRAMES = new Set(["frame", "magicframe"]);
/** Excalidraw's own UI state, never content. */
const IGNORED = new Set(["selection"]);

/** Room around free text, which Excalidraw sizes to the glyphs. */
const TEXT_PAD = { x: 32, y: 24 };
const MIN_CARD = { w: 80, h: 48 };

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

function textOf(el: ExcalidrawElement | undefined): string {
  const text = el?.originalText ?? el?.text ?? "";
  return text.replace(/\r\n?/g, "\n").slice(0, CANVAS_LIMITS.maxCardText);
}

function sideOf(node: JsonCanvasNode, point: { x: number; y: number }): CanvasSide {
  const dx = (point.x - (node.x + node.width / 2)) / (node.width / 2 || 1);
  const dy = (point.y - (node.y + node.height / 2)) / (node.height / 2 || 1);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "bottom" : "top";
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
}

/**
 * The scene as JSON Canvas. `sourcePath` names the folder its images are
 * placed under (`Board.excalidraw` → `Board images/…`).
 */
export function excalidrawToCanvas(
  scene: ExcalidrawScene,
  sourcePath: string,
): ExcalidrawConversion {
  const live = scene.elements.filter((el) => !el.isDeleted && !IGNORED.has(el.type));
  const boundText = new Map<string, ExcalidrawElement>();
  for (const el of live) {
    if (el.type === "text" && el.containerId) boundText.set(el.containerId, el);
  }
  const byId = new Map(live.map((el) => [el.id, el]));
  const imageFolder = joinPath(dirname(sourcePath), `${pathTitle(sourcePath)} images`);

  const groups: JsonCanvasNode[] = [];
  const cards: JsonCanvasNode[] = [];
  const nodeById = new Map<string, JsonCanvasNode>();
  const images = new Map<string, { path: string; dataUrl: string }>();
  const counts = { drawings: 0, loose: 0, noImage: 0, noLink: 0, other: new Map<string, number>() };

  const box = (el: ExcalidrawElement, pad = { x: 0, y: 0 }) => {
    const width = Math.max(Math.abs(el.width) + pad.x, MIN_CARD.w);
    const height = Math.max(Math.abs(el.height) + pad.y, MIN_CARD.h);
    // A negative size grows up or left from x, y.
    const x = Math.min(el.x, el.x + el.width) - pad.x / 2;
    const y = Math.min(el.y, el.y + el.height) - pad.y / 2;
    return { x, y, width, height };
  };
  const place = (list: JsonCanvasNode[], node: JsonCanvasNode) => {
    list.push(node);
    nodeById.set(node.id, node);
  };

  for (const el of live) {
    if (SHAPES.has(el.type)) {
      place(cards, {
        id: el.id,
        type: "text",
        text: textOf(boundText.get(el.id)),
        ...box(el),
        color: shapeColor(el),
      });
    } else if (el.type === "text") {
      // Bound text is its container's; text whose container is gone stands alone.
      if (el.containerId && byId.has(el.containerId)) continue;
      place(cards, {
        id: el.id,
        type: "text",
        text: textOf(el),
        ...box(el, TEXT_PAD),
        color: presetFor(el.strokeColor),
      });
    } else if (FRAMES.has(el.type)) {
      place(groups, {
        id: el.id,
        type: "group",
        label: (el.name ?? "").slice(0, CANVAS_LIMITS.maxLabel) || "Frame",
        ...box(el),
      });
    } else if (el.type === "image") {
      const file = el.fileId ? scene.files[el.fileId] : undefined;
      const ext = file?.mimeType ? IMAGE_EXTENSIONS[file.mimeType] : undefined;
      if (!file?.dataURL || !ext) {
        counts.noImage++;
        continue;
      }
      const path = joinPath(imageFolder, `${el.fileId}.${ext}`);
      images.set(path, { path, dataUrl: file.dataURL });
      place(cards, { id: el.id, type: "file", file: path, ...box(el) });
    } else if (EMBEDS.has(el.type)) {
      if (!el.link || !/^https?:\/\//i.test(el.link)) {
        counts.noLink++;
        continue;
      }
      place(cards, {
        id: el.id,
        type: "link",
        url: el.link.slice(0, CANVAS_LIMITS.maxUrl),
        ...box(el),
      });
    } else if (el.type === "freedraw") {
      counts.drawings++;
    } else if (!CONNECTORS.has(el.type)) {
      counts.other.set(el.type, (counts.other.get(el.type) ?? 0) + 1);
    }
  }

  const edges: JsonCanvas["edges"] = [];
  for (const el of live) {
    if (!CONNECTORS.has(el.type)) continue;
    const from = el.startBinding ? nodeById.get(el.startBinding.elementId) : undefined;
    const to = el.endBinding ? nodeById.get(el.endBinding.elementId) : undefined;
    const points = Array.isArray(el.points) && el.points.length >= 2 ? el.points : null;
    if (!from || !to || from === to || !points) {
      counts.loose++;
      continue;
    }
    const at = ([px, py]: [number, number]) => ({ x: el.x + px, y: el.y + py });
    const label = textOf(boundText.get(el.id)).slice(0, CANVAS_LIMITS.maxLabel);
    edges.push({
      id: el.id,
      fromNode: from.id,
      fromSide: sideOf(from, at(points[0]!)),
      fromEnd: el.startArrowhead ? "arrow" : undefined,
      toNode: to.id,
      toSide: sideOf(to, at(points[points.length - 1]!)),
      toEnd: el.endArrowhead ? undefined : "none",
      color: presetFor(el.strokeColor),
      label: label || undefined,
    });
  }

  const skipped: ExcalidrawConversion["skipped"] = [];
  if (counts.drawings) {
    skipped.push({
      path: plural(counts.drawings, "freehand drawing", "freehand drawings"),
      reason: "Drawing isn't supported on canvases yet.",
    });
  }
  if (counts.loose) {
    skipped.push({
      path: plural(counts.loose, "arrow or line", "arrows and lines"),
      reason: "Only arrows joined to a shape at both ends become connections.",
    });
  }
  if (counts.noImage) {
    skipped.push({
      path: plural(counts.noImage, "image", "images"),
      reason: "The file didn't include this image's data.",
    });
  }
  if (counts.noLink) {
    skipped.push({
      path: plural(counts.noLink, "embed", "embeds"),
      reason: "Only embeds with a web link become link cards.",
    });
  }
  for (const [type, n] of counts.other) {
    skipped.push({
      path: plural(n, `"${type}" element`, `"${type}" elements`),
      reason: "Not supported.",
    });
  }

  return {
    // Frames first: a group draws beneath the cards inside it.
    canvas: { nodes: [...groups, ...cards].map(dropUndefined), edges: edges.map(dropUndefined) },
    images: [...images.values()],
    skipped,
  };
}

function dropUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** A data URL's bytes, or null if it isn't base64 image data. */
export function dataUrlBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma === -1) return null;
  if (!dataUrl.slice(0, comma).endsWith(";base64")) return null;
  try {
    return base64ToBytes(dataUrl.slice(comma + 1));
  } catch {
    return null;
  }
}
