/**
 * The document menu's exports, loaded when one is picked: the `.canvas`
 * file, the "for Obsidian" zip and the Markdown outline.
 */
import type * as Y from "yjs";

import type { JsonCanvas } from "@/lib/canvas/json-canvas";
import { basename, pathTitle } from "@/lib/canvas/paths";

import { runCanvasIo } from "./canvas-io-client";
import type { CanvasIoProgress } from "./canvas-io-jobs";
import {
  buildVaultExport,
  canvasMarkdown,
  type ExportAttachment,
  serializeCanvas,
} from "./vault-export";

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Some browsers start the download after this tick.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function downloadCanvasFile(path: string, canvas: JsonCanvas) {
  download(basename(path), new Blob([serializeCanvas(canvas)], { type: "application/json" }));
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
  const built = buildVaultExport(doc, { canvasPath: path, attachments });
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
