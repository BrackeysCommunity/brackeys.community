/**
 * What a canvas exports as: the `.canvas` file, the "for Obsidian" zip's
 * contents, and the Markdown outline. Pure apart from Yjs, so it runs
 * anywhere; fetching the images and zipping happen in the `canvas-io`
 * worker.
 *
 * The zip mirrors the vault: the canvas at its own path, each file card's
 * note at the path the card names, each image at its attachment's path.
 * Obsidian resolves file nodes from the vault root, so unzipped into the
 * vault (or the scope's folder in it) everything opens where the canvas
 * expects it, and the zip imports back with no path rewriting.
 */
import * as Y from "yjs";

import {
  canvasNodeKey,
  canvasNodes,
  docToJsonCanvas,
  fileBodyOf,
  type JsonCanvas,
  type JsonCanvasNode,
} from "@/lib/canvas/json-canvas";
import { pathKey } from "@/lib/canvas/paths";

import type { CanvasCard } from "../canvas-cards";
import { canvasOutline, outlineMarkdown } from "../outline";
import { encodeNote } from "./markdown-seam";

export interface ExportAttachment {
  path: string;
  url: string | null;
  quarantined: boolean;
}

/** One file of the zip: its bytes, or a same-origin URL the worker fetches. */
export type VaultExportFile = { path: string } & (
  | { bytes: Uint8Array; url?: undefined }
  | { url: string; bytes?: undefined }
);

export interface VaultExport {
  files: VaultExportFile[];
  /** What was left out, and why. */
  leftOut: { path: string; reason: string }[];
}

/**
 * The `.canvas` file's text in Obsidian's own layout: tab-indented, one node
 * or edge per line, no newline at the end. With the key order each card
 * remembers, a canvas Obsidian wrote comes back byte for byte.
 */
export function serializeCanvas(canvas: JsonCanvas): string {
  const value = (v: unknown) =>
    Array.isArray(v)
      ? v.length
        ? `[\n\t\t${v.map((item) => JSON.stringify(item)).join(",\n\t\t")}\n\t]`
        : "[]"
      : JSON.stringify(v);
  const lines = Object.entries(canvas)
    .filter(([, v]) => v !== undefined)
    .map(([key, v]) => `\t${JSON.stringify(key)}:${value(v)}`);
  return `{\n${lines.join(",\n")}\n}`;
}

function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    path.split("/").every((s) => s !== "" && s !== "." && s !== "..")
  );
}

/** The canvas as JSON Canvas for a vault, image nodes at their attachments' paths. */
function vaultCanvas(doc: Y.Doc, attachments: Readonly<Record<string, ExportAttachment>>) {
  const canvas = docToJsonCanvas(doc, { vault: true });
  const nodes = canvas.nodes.map((node) => {
    const id = imageAttachmentId(node, doc);
    const attachment = id ? attachments[id] : undefined;
    return attachment ? { ...node, file: attachment.path } : node;
  });
  return { ...canvas, nodes };
}

/** The attachment an image card shows, keyed or plain. */
function imageAttachmentId(node: JsonCanvasNode, doc: Y.Doc): string | undefined {
  const key = canvasNodeKey(node);
  if (key?.type === "image") return key.attachmentId;
  const ynode = canvasNodes(doc).get(node.id);
  if (ynode instanceof Y.Map && ynode.get("type") === "image") {
    const id = ynode.get("attachmentId");
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

/**
 * The "for Obsidian" zip's files. Note bodies are written once per path,
 * byte for byte (with their byte order mark if they had one); quarantined
 * and missing images are left out and listed.
 */
export function buildVaultExport(
  doc: Y.Doc,
  options: { canvasPath: string; attachments: Readonly<Record<string, ExportAttachment>> },
): VaultExport {
  const canvas = vaultCanvas(doc, options.attachments);
  const files: VaultExportFile[] = [
    { path: options.canvasPath, bytes: new TextEncoder().encode(serializeCanvas(canvas)) },
  ];
  const leftOut: VaultExport["leftOut"] = [];
  const written = new Map<string, string>([[pathKey(options.canvasPath), "canvas"]]);
  const nodes = canvasNodes(doc);

  for (const node of canvas.nodes) {
    const path = typeof node.file === "string" ? node.file : "";
    const ynode = nodes.get(node.id);
    if (!(ynode instanceof Y.Map) || node.type !== "file") continue;

    const attachmentId = imageAttachmentId(node, doc);
    if (attachmentId) {
      const attachment = options.attachments[attachmentId];
      if (!attachment) {
        leftOut.push({ path, reason: "The image isn't available in this canvas's scope." });
        continue;
      }
      if (attachment.quarantined || !attachment.url) {
        leftOut.push({ path: attachment.path, reason: "The image is under review." });
        continue;
      }
      if (written.has(pathKey(attachment.path))) continue;
      written.set(pathKey(attachment.path), attachmentId);
      files.push({ path: attachment.path, url: attachment.url });
      continue;
    }

    const body = fileBodyOf(ynode);
    if (!body) continue;
    if (!safePath(path)) {
      leftOut.push({ path, reason: "The note's path can't be written in a vault." });
      continue;
    }
    const previous = written.get(pathKey(path));
    if (previous !== undefined) {
      if (previous !== body.text) {
        leftOut.push({
          path,
          reason: "Two cards hold different text for this note; the first one was written.",
        });
      }
      continue;
    }
    written.set(pathKey(path), body.text);
    files.push({ path, bytes: encodeNote(body) });
  }
  return { files, leftOut };
}

/** The canvas's cards as the outline reads them, note bodies included. */
function docCards(doc: Y.Doc): CanvasCard[] {
  const nodes = canvasNodes(doc);
  return docToJsonCanvas(doc).nodes.map((node): CanvasCard => {
    const key = canvasNodeKey(node);
    const base = { id: node.id, x: node.x, y: node.y, w: node.width, h: node.height };
    if (key?.type === "image") {
      return { ...base, type: "image", attachmentId: key.attachmentId, file: node.file };
    }
    if (key?.type === "entity")
      return { ...base, type: "entity", entity: key.entity, url: node.url };
    const ynode = nodes.get(node.id);
    const body = ynode instanceof Y.Map ? fileBodyOf(ynode) : undefined;
    switch (node.type) {
      case "text":
        return { ...base, type: "text", text: node.text ?? "" };
      case "file":
        return { ...base, type: "file", file: node.file, subpath: node.subpath, text: body?.text };
      case "link":
        return { ...base, type: "link", url: node.url };
      default:
        return { ...base, type: "group", label: node.label };
    }
  });
}

/** The Markdown export: the outline, with each note's body in place of its link. */
export function canvasMarkdown(doc: Y.Doc): string {
  const edges = docToJsonCanvas(doc).edges.map((e) => ({
    from: e.fromNode,
    to: e.toNode,
    label: e.label,
  }));
  return outlineMarkdown(canvasOutline(docCards(doc)), edges);
}
