/**
 * The document menu's exports, loaded when one is picked: the `.canvas`
 * file, the "for Obsidian" zip and the Markdown outline.
 */
import type * as Y from "yjs";

import { siteUrl } from "@/env";
import { docToJsonCanvas, type JsonCanvas } from "@/lib/canvas/json-canvas";
import { basename, pathTitle } from "@/lib/canvas/paths";
import { client } from "@/orpc/client";

import { runCanvasIo } from "./canvas-io-client";
import type { CanvasIoProgress } from "./canvas-io-jobs";
import {
  buildVaultExport,
  canvasFileForObsidian,
  canvasMarkdown,
  entityRefs,
  type ExportAttachment,
  type ExportEntities,
  type ExportEntity,
  exportEntityKey,
  serializeCanvas,
} from "./vault-export";

const ENTITY_BATCH = 200;

/**
 * What the canvas's site cards show now, for their text in the export. A
 * card the lookup misses (or a failed lookup) still exports, as a link.
 */
async function loadEntities(canvas: JsonCanvas): Promise<ExportEntities> {
  const refs = entityRefs(canvas);
  const found = new Map<string, ExportEntity>();
  try {
    for (let i = 0; i < refs.length; i += ENTITY_BATCH) {
      const batch = refs.slice(i, i + ENTITY_BATCH);
      const views = await client.getCanvasEntities({ refs: batch });
      views.forEach((view, j) => {
        if (!view) return;
        found.set(exportEntityKey(batch[j]!), {
          title: view.title,
          subtitle: view.subtitle,
          imageUrl: view.imageUrl ? siteUrl(view.imageUrl) : null,
          url: siteUrl(view.href),
        });
      });
    }
  } catch {
    // Exporting matters more than the cards' details.
  }
  return found;
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Some browsers start the download after this tick.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function downloadCanvasFile(path: string, canvas: JsonCanvas) {
  const file = canvasFileForObsidian(canvas, await loadEntities(canvas));
  download(basename(path), new Blob([serializeCanvas(file)], { type: "application/json" }));
}

export function downloadMarkdown(path: string, doc: Y.Doc) {
  download(`${pathTitle(path)}.md`, new Blob([canvasMarkdown(doc)], { type: "text/markdown" }));
}

/** The zip, built in the worker; returns what was left out of it. */
export async function downloadVaultZip(
  path: string,
  doc: Y.Doc,
  attachments: Readonly<Record<string, ExportAttachment>>,
  onProgress?: (progress: CanvasIoProgress) => void,
): Promise<{ path: string; reason: string }[]> {
  const entities = await loadEntities(docToJsonCanvas(doc));
  const built = buildVaultExport(doc, { canvasPath: path, attachments, entities });
  const { zip, leftOut } = await runCanvasIo("export", { files: built.files }, onProgress);
  download(
    `${pathTitle(path)}.zip`,
    new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
  );
  return [...built.leftOut, ...leftOut];
}

/** The zip's left-out list as one short line: the first few, then a count. */
export function leftOutSummary(leftOut: readonly { path: string; reason: string }[], shown = 3) {
  const listed = leftOut.slice(0, shown).map((l) => `${l.path} (${l.reason})`);
  const more = leftOut.length - listed.length;
  return `Left out of the zip: ${listed.join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
}
