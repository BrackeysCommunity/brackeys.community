/**
 * What a canvas exports as: the `.canvas` file, the "for Obsidian" zip's
 * contents, and the Markdown outline. Pure apart from Yjs, so it runs
 * anywhere; fetching the images and zipping happen in the `canvas-io`
 * worker.
 *
 * The zip mirrors the vault inside one folder named for the canvas: the
 * canvas at its own path, each file card's note at the path the card names,
 * each image at its attachment's path, and every file node pointing into
 * that folder. Obsidian resolves file nodes from the vault root, so the
 * folder unzipped at the root opens as is; the importer strips it again.
 *
 * Site cards (jams, teams, people) go out as Markdown text cards that link
 * to their pages, since Obsidian would embed the page itself. A lone
 * `.canvas` file can't hold images, so it shows a placeholder for each.
 * Both keep the `jamsTeam` key, so the file imports back as the same cards.
 */
import * as Y from "yjs";

import {
  canvasNodeKey,
  canvasNodes,
  docToJsonCanvas,
  type EntityKind,
  type EntityRef,
  fileBodyOf,
  type JsonCanvas,
  type JsonCanvasNode,
} from "@/lib/canvas/json-canvas";
import { basename, pathKey, pathTitle } from "@/lib/canvas/paths";

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

/** A site card as it reads now, with absolute URLs. */
export interface ExportEntity {
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  url: string;
}

export type ExportEntities = ReadonlyMap<string, ExportEntity>;

export const exportEntityKey = (entity: EntityRef) => `${entity.kind}:${entity.id}`;

/** The site cards a canvas shows. */
export function entityRefs(canvas: JsonCanvas): EntityRef[] {
  const refs = new Map<string, EntityRef>();
  for (const node of canvas.nodes) {
    const key = canvasNodeKey(node);
    if (key?.type === "entity") refs.set(exportEntityKey(key.entity), key.entity);
  }
  return [...refs.values()];
}

const ENTITY_LABEL: Record<EntityKind, string> = {
  jam: "Jam",
  game: "Game",
  team: "Team",
  profile: "Member",
  "forum-post": "Forum post",
};

const escapeLinkText = (text: string) => text.replace(/[[\]\\]/g, "\\$&");

/** Its title linked to its page, what it is, then its picture. */
function entityMarkdown(entity: EntityRef, found: ExportEntity | undefined, url: string): string {
  const label = ENTITY_LABEL[entity.kind];
  if (!found) return url ? `### [${label}](<${url}>)` : `### ${label}`;
  const lines = [`### [${escapeLinkText(found.title)}](<${found.url}>)`];
  const about =
    entity.kind === "forum-post"
      ? found.subtitle
      : [label, found.subtitle].filter(Boolean).join(" · ");
  if (about) lines.push(about);
  if (found.imageUrl) lines.push("", `![](<${found.imageUrl}>)`);
  return lines.join("\n");
}

/** Site cards as text cards Obsidian can show; everything else as it is. */
function withEntityText(canvas: JsonCanvas, entities: ExportEntities): JsonCanvas {
  const nodes = canvas.nodes.map((node): JsonCanvasNode => {
    const key = canvasNodeKey(node);
    if (key?.type !== "entity" || node.type !== "link") return node;
    const { url = "", ...rest } = node;
    const text = entityMarkdown(key.entity, entities.get(exportEntityKey(key.entity)), url);
    return { ...rest, type: "text", text, url };
  });
  return { ...canvas, nodes };
}

const IMAGE_PLACEHOLDER = "Images come with the \u201cZip for Obsidian\u201d export.";

/**
 * The `.canvas` file on its own: site cards as text, and a placeholder
 * naming each image, which a lone file can't carry.
 */
export function canvasFileForObsidian(canvas: JsonCanvas, entities: ExportEntities): JsonCanvas {
  const withText = withEntityText(canvas, entities);
  const nodes = withText.nodes.map((node): JsonCanvasNode => {
    if (canvasNodeKey(node)?.type !== "image" || node.type !== "file") return node;
    const { file = "", subpath: _subpath, ...rest } = node;
    const text = `**${basename(file) || "Image"}**\n\n${IMAGE_PLACEHOLDER}`;
    return { ...rest, type: "text", text, file };
  });
  return { ...withText, nodes };
}

/** The zip's one top folder: the canvas's title, safe as a folder name. */
export function vaultFolder(canvasPath: string): string {
  const title = pathTitle(canvasPath)
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim();
  return title && title !== "." && title !== ".." ? title : "Canvas";
}

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

/** The canvas as JSON Canvas for a vault: images at their attachments' paths, site cards as text. */
function vaultCanvas(
  doc: Y.Doc,
  attachments: Readonly<Record<string, ExportAttachment>>,
  entities: ExportEntities,
) {
  const canvas = docToJsonCanvas(doc, { vault: true });
  const nodes = canvas.nodes.map((node) => {
    const id = imageAttachmentId(node, doc);
    const attachment = id ? attachments[id] : undefined;
    return attachment ? { ...node, file: attachment.path } : node;
  });
  return withEntityText({ ...canvas, nodes }, entities);
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
  options: {
    canvasPath: string;
    attachments: Readonly<Record<string, ExportAttachment>>;
    entities?: ExportEntities;
  },
): VaultExport {
  const canvas = vaultCanvas(doc, options.attachments, options.entities ?? new Map());
  const files: VaultExportFile[] = [];
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

  // Only what's in the zip moves into its folder; a card naming a file it
  // left out keeps pointing where that file already is.
  const folder = vaultFolder(options.canvasPath);
  const inFolder = (path: string) => `${folder}/${path}`;
  const nodesInFolder = canvas.nodes.map((node) =>
    typeof node.file === "string" && written.has(pathKey(node.file))
      ? { ...node, file: inFolder(node.file) }
      : node,
  );
  const text = serializeCanvas({ ...canvas, nodes: nodesInFolder });
  return {
    files: [
      { path: inFolder(options.canvasPath), bytes: new TextEncoder().encode(text) },
      ...files.map((file) => ({ ...file, path: inFolder(file.path) })),
    ],
    leftOut,
  };
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
