/**
 * The main thread's half of an import, after the worker: find which
 * images the scope already holds, upload the rest three at a time, and
 * turn each canvas's file nodes into image cards. Re-importing an export
 * into the same scope uploads nothing: an image is matched by the
 * attachment its key names, else by the sha256 of its prepared bytes.
 */
import * as Y from "yjs";

import { bytesToBase64 } from "@/lib/canvas/encoding";
import {
  applyJsonCanvas,
  canvasNodeKey,
  canvasNodes,
  type DocOnlyFields,
  type JsonCanvas,
} from "@/lib/canvas/json-canvas";
import { pathKey, repairPath } from "@/lib/canvas/paths";
import { postImageForm } from "@/lib/image-upload";
import { client } from "@/orpc/client";

import type { CanvasScope } from "../canvas-queries";
import type { PreparedImage } from "./canvas-io-jobs";
import {
  canvasState,
  type ImportedCanvas,
  type ImportReport,
  type ImportReportLine,
  type ResolvedImage,
  withImages,
} from "./vault-import";

/** Uploads run this many at a time. */
export const UPLOAD_CONCURRENCY = 3;

export interface AttachmentMatches {
  /** `sha256` is the stored bytes' hash, to tell an edited image from the one the key names. */
  byId: Record<string, { path: string; sha256?: string }>;
  bySha: Record<string, { id: string; path: string }>;
}

export interface ImageUploader {
  match(input: { attachmentIds: string[]; sha256s: string[] }): Promise<AttachmentMatches>;
  upload(file: File, path: string): Promise<{ id: string; path: string; url: string }>;
}

export interface FinishedImportReport extends ImportReport {
  imagesUploaded: number;
  imagesReused: number;
}

export interface FinalCanvas {
  sourcePath: string;
  targetPath: string;
  canvas: JsonCanvas;
  docFields: Record<string, DocOnlyFields>;
  /** The Yjs state a new canvas starts from. */
  state: Uint8Array;
  nodeCount: number;
}

/** Runs `task` over `items`, at most `limit` at once, in order of start. */
export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index]!, index);
    }
  });
  await Promise.all(runners);
}

export async function resolveImages(
  canvases: readonly ImportedCanvas[],
  images: readonly PreparedImage[],
  uploader: ImageUploader,
  options: {
    onProgress?: (done: number, total: number) => void;
    /** Checked before each upload: a stopped import spends no more of the daily image budget. */
    shouldStop?: () => boolean;
  } = {},
): Promise<{
  resolved: Map<PreparedImage, ResolvedImage>;
  uploaded: number;
  reused: number;
  skipped: ImportReportLine[];
  repairs: ImportReport["repairs"];
}> {
  const keyedIds = new Set<string>();
  for (const { canvas } of canvases) {
    for (const node of canvas.nodes) {
      const key = canvasNodeKey(node);
      if (key?.type === "image") keyedIds.add(key.attachmentId);
    }
  }
  for (const image of images) for (const id of image.attachmentIds) keyedIds.add(id);
  const shas = [...new Set(images.flatMap((i) => (i.sha256 ? [i.sha256] : [])))];
  const matches =
    keyedIds.size || shas.length
      ? await uploader.match({ attachmentIds: [...keyedIds], sha256s: shas })
      : { byId: {}, bySha: {} };

  const resolved = new Map<PreparedImage, ResolvedImage>();
  const skipped: ImportReportLine[] = [];
  const repairs: ImportReport["repairs"] = [];
  const toUpload: PreparedImage[] = [];
  const pendingBySha = new Map<string, PreparedImage>();
  let reused = 0;

  // A card follows its image wherever it lands; the report says so when
  // that isn't the path the vault had.
  const land = (image: PreparedImage, landed: ResolvedImage, reason: string) => {
    resolved.set(image, landed);
    if (landed.path !== image.path) repairs.push({ from: image.path, to: landed.path, reason });
  };

  for (const image of images) {
    const byId = image.attachmentIds.find((id) => {
      const row = matches.byId[id];
      // A keyed image edited outside the site comes back with new bytes: upload those.
      return row && !(image.sha256 && row.sha256 && row.sha256 !== image.sha256);
    });
    if (byId) {
      land(
        image,
        { attachmentId: byId, path: matches.byId[byId]!.path },
        "The card's image is already in this scope; the card uses that copy.",
      );
      reused++;
      continue;
    }
    const bySha = image.sha256 ? matches.bySha[image.sha256] : undefined;
    if (bySha) {
      land(
        image,
        { attachmentId: bySha.id, path: bySha.path },
        "The same image is already in this scope at this path; the card uses it.",
      );
      reused++;
      continue;
    }
    if (image.error || !image.upload) {
      skipped.push({ path: image.path, reason: image.error ?? "Couldn't read this image." });
      continue;
    }
    if (image.sha256 && pendingBySha.has(image.sha256)) continue;
    if (image.sha256) pendingBySha.set(image.sha256, image);
    toUpload.push(image);
  }

  // Keys naming an attachment this scope doesn't have, with no file to upload instead.
  const jobIds = new Set(images.flatMap((i) => i.attachmentIds));
  for (const id of keyedIds) {
    if (!matches.byId[id] && !jobIds.has(id)) {
      skipped.push({
        path: id,
        reason: "An image card names an image that isn't in this scope; it shows as missing.",
      });
    }
  }

  const { onProgress, shouldStop = () => false } = options;
  let uploaded = 0;
  let done = 0;
  onProgress?.(0, toUpload.length);
  await eachLimited(toUpload, UPLOAD_CONCURRENCY, async (image) => {
    if (shouldStop()) return;
    try {
      const result = await uploader.upload(image.upload!, image.uploadPath);
      uploaded++;
      land(
        image,
        { attachmentId: result.id, path: result.path },
        image.uploadPath !== image.path
          ? "Re-encoded to fit the upload limit."
          : "The scope already had a different file there.",
      );
    } catch (error) {
      skipped.push({
        path: image.path,
        reason: error instanceof Error ? error.message : "Couldn't upload this image.",
      });
    } finally {
      onProgress?.(++done, toUpload.length);
    }
  });

  if (shouldStop()) return { resolved, uploaded, reused, skipped, repairs };

  // Duplicates within this import share the upload of the first.
  for (const image of images) {
    if (resolved.has(image) || !image.sha256) continue;
    const first = pendingBySha.get(image.sha256);
    if (!first || first === image) continue;
    const landed = resolved.get(first);
    if (landed) {
      land(image, landed, `Same image as ${first.path}; both cards use one copy.`);
      reused++;
    } else {
      skipped.push({
        path: image.path,
        reason: `Same image as ${first.path}, which couldn't be uploaded.`,
      });
    }
  }
  return { resolved, uploaded, reused, skipped, repairs };
}

/**
 * Applies an import's chunks as one undo step, however long each takes:
 * the capture window only has to cover the gap between chunks when the
 * apply is slow, so it's held open until the last one lands.
 */
export function asOneUndoStep<T>(undo: Y.UndoManager, apply: () => T): T {
  const timeout = undo.captureTimeout;
  undo.stopCapturing();
  undo.captureTimeout = Infinity;
  try {
    return apply();
  } finally {
    undo.captureTimeout = timeout;
    undo.stopCapturing();
  }
}

/** Each canvas with its images in place, and the state it's created from. */
export function finalizeCanvases(
  canvases: readonly ImportedCanvas[],
  images: readonly PreparedImage[],
  resolved: ReadonlyMap<PreparedImage, ResolvedImage>,
): FinalCanvas[] {
  return canvases.map((imported, index) => {
    const { canvas, docFields } = withImages(imported, index, images, resolved);
    return {
      sourcePath: imported.sourcePath,
      targetPath: imported.targetPath,
      canvas,
      docFields,
      state: canvasState(canvas, docFields),
      nodeCount: imported.nodeCount,
    };
  });
}

/**
 * The uploader for a real scope: `listCanvasAttachmentMatches` and `/api/canvas/image`.
 * With `canvasId`, images land in that canvas's scope rather than the importer's.
 */
export function scopeUploader(scope: CanvasScope, canvasId?: string): ImageUploader {
  const fields: Record<string, string> = {
    ...(scope.kind === "team" ? { scope: "team", teamId: scope.teamId } : { scope: "personal" }),
    ...(canvasId ? { canvasId } : {}),
  };
  return {
    match: async ({ attachmentIds, sha256s }) => {
      const out: AttachmentMatches = { byId: {}, bySha: {} };
      // The procedure takes 2,000 of each per call.
      for (let i = 0; i < Math.max(attachmentIds.length, sha256s.length); i += 2_000) {
        const page = await client.listCanvasAttachmentMatches({
          scope,
          canvasId,
          attachmentIds: attachmentIds.slice(i, i + 2_000),
          sha256s: sha256s.slice(i, i + 2_000),
        });
        Object.assign(out.byId, page.byId);
        Object.assign(out.bySha, page.bySha);
      }
      return out;
    },
    upload: (file, path) =>
      postImageForm<{ id: string; path: string; url: string; key: string }>(
        "/api/canvas/image",
        file,
        { ...fields, path },
        "Couldn't upload this image.",
      ),
  };
}

/** Space between canvases imported side by side. */
const IMPORT_GAP = 200;

function widthOf(canvas: JsonCanvas): number {
  if (canvas.nodes.length === 0) return 0;
  const left = Math.min(...canvas.nodes.map((n) => n.x));
  const right = Math.max(...canvas.nodes.map((n) => n.x + n.width));
  return right - left;
}

export interface BuiltImport {
  /** Everything the tab holds, so the server's `pre-import` version has it all. */
  base: Uint8Array;
  /** The tab's state vector once the import lands. */
  stateVector: Uint8Array;
  /** The import's cards, as an update on top of `base`. */
  update: Uint8Array;
  /** The Yjs client the import's structs are written under. */
  client: number;
  created: string[];
  /** The canvas once the import lands, as this tab sees it. */
  nodes: number;
  stateBytes: number;
}

/**
 * The import as its own update on top of what `doc` holds, built on a copy
 * (under a client of its own) so nothing reaches the doc until the server
 * has taken it. Canvases go side by side from `at`.
 */
export function buildImport(
  doc: Y.Doc,
  finals: readonly FinalCanvas[],
  at: { x: number; y: number },
): BuiltImport {
  const base = Y.encodeStateAsUpdate(doc);
  const baseVector = Y.encodeStateVectorFromUpdate(base);
  const copy = new Y.Doc();
  try {
    Y.applyUpdate(copy, base);
    const created: string[] = [];
    let x = at.x;
    for (const final of finals) {
      const applied = applyJsonCanvas(copy, final.canvas, {
        mode: "fragment",
        at: { x, y: at.y },
        docFields: final.docFields,
      });
      created.push(...applied.created);
      x += widthOf(final.canvas) + IMPORT_GAP;
    }
    return {
      base,
      stateVector: Y.encodeStateVector(copy),
      update: Y.encodeStateAsUpdate(copy, baseVector),
      client: copy.clientID,
      created,
      nodes: canvasNodes(copy).size,
      stateBytes: Y.encodeStateAsUpdate(copy).length,
    };
  } finally {
    copy.destroy();
  }
}

/**
 * Stores an import into an open canvas (`saveCanvasImport`): the server
 * keeps a `pre-import` version, refuses the whole import over a cap, and
 * passes it to anyone editing live. The reply is what the tab is missing.
 */
export async function sendImport(
  canvasId: string,
  built: BuiltImport,
): Promise<{ update: string; stateVector: string }> {
  return client.saveCanvasImport({
    canvasId,
    base: bytesToBase64(built.base),
    update: bytesToBase64(built.update),
    stateVector: bytesToBase64(built.stateVector),
  });
}

/**
 * Makes an import one step of the editor's undo, whichever way its structs
 * arrive: applied by the tab once the server stored it, or first through
 * canvas-sync's broadcast under the provider's origin (which the undo
 * manager doesn't track). Any transaction that inserts under the import's
 * `client` while this is open becomes its own undo step, cut down to the
 * import's own structs: canvas-sync's apply can carry other people's edits
 * (another member's import stored in the same window, say) in the same
 * transaction, and ⌘Z must leave those alone. Returns the release.
 */
export function captureImport(
  doc: Y.Doc,
  undo: Y.UndoManager,
  built: Pick<BuiltImport, "client" | "update">,
): () => void {
  const capture = undo.captureTransaction;
  const added = new Set<unknown>();
  let inImport = false;
  let ownDeletes: DeleteSet | undefined;
  const fromImport = (tr: Y.Transaction) =>
    (tr.afterState.get(built.client) ?? 0) > (tr.beforeState.get(built.client) ?? 0);
  // Called first by the undo manager's afterTransaction handler, so the
  // origin is tracked by the time it checks.
  undo.captureTransaction = (tr) => {
    if (!capture(tr)) return false;
    if (!fromImport(tr)) return true;
    inImport = true;
    undo.stopCapturing();
    if (!undo.trackedOrigins.has(tr.origin)) {
      undo.trackedOrigins.add(tr.origin);
      added.add(tr.origin);
    }
    return true;
  };
  const onAdded = ({
    stackItem,
    type,
  }: {
    stackItem: Y.UndoManager["undoStack"][number];
    type: string;
  }) => {
    if (!inImport || type !== "undo") return;
    ownDeletes ??= Y.decodeUpdate(built.update).ds;
    stackItem.insertions = onlyClient(stackItem.insertions, built.client);
    stackItem.deletions = intersect(stackItem.deletions, ownDeletes);
  };
  undo.on("stack-item-added", onAdded);
  // Registered after the undo manager's, so it runs once the step is pushed.
  const after = () => {
    if (!inImport) return;
    inImport = false;
    undo.stopCapturing();
    for (const origin of added) undo.trackedOrigins.delete(origin);
    added.clear();
  };
  doc.on("afterTransaction", after);
  return () => {
    doc.off("afterTransaction", after);
    undo.off("stack-item-added", onAdded);
    undo.captureTransaction = capture;
    after();
  };
}

type DeleteSet = ReturnType<typeof Y.createDeleteSet>;
type DeleteRange = { clock: number; len: number };

function onlyClient(set: DeleteSet, client: number): DeleteSet {
  const out = Y.createDeleteSet();
  const ranges = set.clients.get(client);
  if (ranges) out.clients.set(client, ranges);
  return out;
}

function intersect(a: DeleteSet, b: DeleteSet): DeleteSet {
  const out = Y.createDeleteSet();
  for (const [client, left] of a.clients) {
    const right = b.clients.get(client);
    if (!right) continue;
    const ranges: DeleteRange[] = [];
    for (const l of left as DeleteRange[]) {
      for (const r of right as DeleteRange[]) {
        const from = Math.max(l.clock, r.clock);
        const to = Math.min(l.clock + l.len, r.clock + r.len);
        if (to > from) ranges.push({ clock: from, len: to - from });
      }
    }
    if (ranges.length) {
      ranges.sort((x, y) => x.clock - y.clock);
      out.clients.set(client, ranges as never);
    }
  }
  return out;
}

export type ImportSourceKind = "obsidian_canvas" | "obsidian_zip" | "obsidian_folder";

/**
 * Creates each final canvas in the scope, one at a time. A path taken
 * meanwhile gets the next free name; a refusal (the personal cap, say)
 * is reported and the rest carry on.
 */
export async function createImportedCanvases(
  finals: readonly FinalCanvas[],
  options: { scope: CanvasScope; source: ImportSourceKind; shouldStop?: () => boolean },
): Promise<{
  created: (FinalCanvas & { id: string; path: string })[];
  skipped: ImportReportLine[];
}> {
  const created: (FinalCanvas & { id: string; path: string })[] = [];
  const skipped: ImportReportLine[] = [];
  for (const final of finals) {
    if (options.shouldStop?.()) break;
    let path = final.targetPath;
    const tried = new Set<string>();
    for (let attempt = 0; ; attempt++) {
      try {
        const made = await client.createCanvas({
          scope: options.scope,
          path,
          initialState: bytesToBase64(final.state),
          source: options.source,
        });
        created.push({ ...final, ...made });
        break;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "CONFLICT" && attempt < 5) {
          tried.add(pathKey(path));
          path = repairPath(final.targetPath, "canvas", (key) => tried.has(key));
          continue;
        }
        skipped.push({
          path: final.sourcePath || final.targetPath,
          reason: error instanceof Error ? error.message : "Couldn't create this canvas.",
        });
        break;
      }
    }
  }
  return { created, skipped };
}
