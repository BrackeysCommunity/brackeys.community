/**
 * The import core: a vault's files in, canvases out. Takes `{ path, bytes }`
 * entries (from a zip, a dropped folder or picked files) and returns, per
 * canvas, its JSON Canvas with note bodies attached, a scratch Y.Doc state,
 * the images to upload, and a report of everything left out and why.
 *
 * Pure: no DOM and no network, so it runs in the `canvas-io` worker, on the
 * main thread as a fallback, and in node tests. Uploading and creating
 * happen afterwards on the main thread (`import-flow.ts`).
 */
import * as Y from "yjs";

import {
  applyJsonCanvas,
  canvasNodeKey,
  type DocOnlyFields,
  type JsonCanvas,
  type JsonCanvasNode,
  jsonCanvasSchema,
  newCanvasId,
} from "@/lib/canvas/json-canvas";
import { CANVAS_IMPORT_LIMITS, CANVAS_LIMITS } from "@/lib/canvas/limits";
import { basename, joinPath, pathKey, pathKind, pathTitle, repairPath } from "@/lib/canvas/paths";

import { formatBytes, isMarkdownPath, placeLoneNote, placeReferencedNote } from "./markdown-seam";

export interface VaultEntry {
  path: string;
  bytes: Uint8Array;
}

export type ImportMode = "new" | "into";

export interface VaultImportOptions {
  mode: ImportMode;
  /** Canvases to import, by `sourcePath` from `scanVault`; all of them when absent. */
  selected?: readonly string[];
  /** New canvases are created under this folder of the scope. */
  folder?: string;
  /** `pathKey`s of canvases already in the target scope, so new paths don't collide. */
  takenCanvasKeys?: Iterable<string>;
  /** Into mode: what the open canvas already holds, counted against the caps. */
  existing?: { nodes: number; stateBytes: number };
}

export interface ImportedCanvas {
  /** The canvas's path in the vault, with a shared top folder stripped. */
  sourcePath: string;
  /** Where a new canvas is created (new mode). */
  targetPath: string;
  /** The canvas as read; file nodes are rewritten only once images are resolved. */
  canvas: JsonCanvas;
  /** Note bodies by source node id. */
  docFields: Record<string, DocOnlyFields>;
  nodeCount: number;
  /** The scratch doc's encoded state, before images. */
  state: Uint8Array;
}

/** One image to upload (or reuse), and every file node that shows it. */
export interface ImageJob {
  /** Its vault path, normalised: where the upload asks to be stored. */
  path: string;
  bytes: Uint8Array;
  /** Attachments the source named for it (`jamsTeam` image keys): reused if in the scope. */
  attachmentIds: string[];
  refs: { canvas: number; nodeId: string }[];
}

export interface ImportReportLine {
  path: string;
  /** The canvas it was on, if any. */
  canvas?: string;
  reason: string;
}

export interface ImportReport {
  canvases: { sourcePath: string; targetPath: string; nodes: number }[];
  notesAttached: number;
  /** Lone notes that became text cards. */
  textCards: number;
  imagesFound: number;
  /** Everything left out or kept in the "not included" state, with why. */
  skipped: ImportReportLine[];
  /** Paths that changed on the way in. */
  repairs: { from: string; to: string; reason: string }[];
}

export interface VaultImportResult {
  canvases: ImportedCanvas[];
  images: ImageJob[];
  report: ImportReport;
}

export type ImportLimit =
  | "maxFiles"
  | "maxUnzippedBytes"
  | "maxZipBytes"
  | "maxNodes"
  | "maxStateBytes"
  | "maxImagesPerImport";

/** An import over a cap, refused before anything is uploaded or created. */
export class ImportRefusedError extends Error {
  readonly name = "ImportRefusedError";
  constructor(
    readonly limit: ImportLimit,
    readonly actual: number,
    readonly max: number,
    message: string,
  ) {
    super(message);
  }
}

export function refusal(limit: ImportLimit, actual: number, max: number): ImportRefusedError {
  const bytes = (n: number) => formatBytes(n);
  const messages: Record<ImportLimit, string> = {
    maxFiles: `This import has ${actual.toLocaleString("en")} files; the most one import can read is ${max.toLocaleString("en")}.`,
    maxUnzippedBytes: `This import unpacks to ${bytes(actual)}; the most one import can unpack is ${bytes(max)}.`,
    maxZipBytes: `This zip is ${bytes(actual)}; the most one import can read is ${bytes(max)}.`,
    maxNodes: `That makes ${actual.toLocaleString("en")} cards; a canvas holds ${max.toLocaleString("en")} at most.`,
    maxStateBytes: `That makes ${bytes(actual)} of canvas; a canvas holds ${bytes(max)} at most.`,
    maxImagesPerImport: `This import has ${actual.toLocaleString("en")} images; one import can upload ${max.toLocaleString("en")} at most.`,
  };
  return new ImportRefusedError(limit, actual, max, messages[limit]);
}

// ── Paths ─────────────────────────────────────────────────────────────────

const nfc = (path: string) => path.normalize("NFC");

/** A folder every entry sits in (a zipped or dropped vault's own folder), or "". */
export function commonRoot(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const first = paths[0]!.split("/");
  if (first.length < 2) return "";
  const root = first[0]!;
  return paths.every((p) => p.startsWith(`${root}/`)) ? root : "";
}

function stripRoot(path: string, root: string): string {
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

type Resolution =
  | { kind: "found"; entry: VaultEntry; vaultPath: string; how: ResolvedBy }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "missing" };

type ResolvedBy = "exact" | "root-stripped" | "case" | "basename";

/**
 * Obsidian's lookup for a file node's path: the exact path, then the path
 * inside the vault's folder, then the same ignoring case and Unicode form,
 * then a basename found once anywhere. Several files with that basename is
 * ambiguous, and reported rather than guessed.
 */
export class VaultResolver {
  private exact = new Map<string, VaultEntry>();
  private stripped = new Map<string, VaultEntry>();
  private byKey = new Map<string, VaultEntry[]>();
  private byBase = new Map<string, VaultEntry[]>();
  readonly root: string;

  constructor(entries: readonly VaultEntry[]) {
    this.root = commonRoot(entries.map((e) => e.path));
    for (const entry of entries) {
      const inVault = stripRoot(entry.path, this.root);
      this.exact.set(nfc(entry.path), entry);
      this.stripped.set(nfc(inVault), entry);
      push(this.byKey, pathKey(inVault), entry);
      push(this.byBase, pathKey(basename(inVault)), entry);
    }
  }

  vaultPath(entry: VaultEntry): string {
    return nfc(stripRoot(entry.path, this.root));
  }

  resolve(file: string): Resolution {
    const found = (entry: VaultEntry, how: ResolvedBy): Resolution => ({
      kind: "found",
      entry,
      vaultPath: this.vaultPath(entry),
      how,
    });
    const wanted = nfc(file);
    const exact = this.exact.get(wanted);
    if (exact) return found(exact, "exact");
    const stripped = this.stripped.get(wanted);
    if (stripped) return found(stripped, "root-stripped");
    const byKey = this.byKey.get(pathKey(file)) ?? [];
    if (byKey.length === 1) return found(byKey[0]!, "case");
    const byBase = this.byBase.get(pathKey(basename(file))) ?? [];
    if (byBase.length === 1) return found(byBase[0]!, "basename");
    if (byBase.length > 1 || byKey.length > 1) {
      return {
        kind: "ambiguous",
        candidates: (byKey.length > 1 ? byKey : byBase).map((e) => this.vaultPath(e)).sort(),
      };
    }
    return { kind: "missing" };
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// ── Reading ───────────────────────────────────────────────────────────────

type EntryKind = "canvas" | "markdown" | "image" | "other";

function kindOf(path: string): EntryKind {
  if (isMarkdownPath(path)) return "markdown";
  const kind = pathKind(path);
  return kind === "canvas" ? "canvas" : kind === "image" ? "image" : "other";
}

const EXTENSION_NAMES: Record<string, string> = {
  pdf: "PDF files",
  base: "Bases (.base)",
  mp3: "Audio files",
  wav: "Audio files",
  m4a: "Audio files",
  ogg: "Audio files",
  webm: "Audio and video files",
  mp4: "Video files",
  mov: "Video files",
};

function unsupportedReason(path: string, onCard = true): string {
  const dot = path.lastIndexOf(".");
  const ext = dot > path.lastIndexOf("/") ? path.slice(dot + 1).toLowerCase() : "";
  const name = EXTENSION_NAMES[ext] ?? (ext ? `.${ext} files` : "Files without an extension");
  return `${name} aren't supported on canvases yet${onCard ? "; the card shows its path" : ""}.`;
}

function parseCanvas(bytes: Uint8Array): JsonCanvas | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const raw: unknown = JSON.parse(text);
    // Checked, not taken from the parse, which would reorder each card's keys.
    if (!jsonCanvasSchema.safeParse(raw).success) return null;
    const canvas = raw as Partial<JsonCanvas>;
    return {
      ...canvas,
      nodes: (canvas.nodes ?? []) as JsonCanvasNode[],
      edges: canvas.edges ?? [],
    } as JsonCanvas;
  } catch {
    return null;
  }
}

/** What a vault holds, for choosing what to import. Cheap: canvases are parsed, nothing else is read. */
export function scanVault(entries: readonly VaultEntry[]): {
  root: string;
  canvases: { sourcePath: string; nodes: number; valid: boolean }[];
  notes: number;
  images: number;
  other: number;
} {
  const resolver = new VaultResolver(entries);
  const out = { root: resolver.root, canvases: [] as ScanCanvas[], notes: 0, images: 0, other: 0 };
  for (const entry of entries) {
    const kind = kindOf(entry.path);
    if (kind === "canvas") {
      const canvas = parseCanvas(entry.bytes);
      out.canvases.push({
        sourcePath: resolver.vaultPath(entry),
        nodes: canvas?.nodes.length ?? 0,
        valid: canvas != null,
      });
    } else if (kind === "markdown") out.notes++;
    else if (kind === "image") out.images++;
    else out.other++;
  }
  out.canvases.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  return out;
}

type ScanCanvas = { sourcePath: string; nodes: number; valid: boolean };

function totalBytes(entries: readonly VaultEntry[]): number {
  let sum = 0;
  for (const entry of entries) sum += entry.bytes.length;
  return sum;
}

/** Refuses an import whose files alone are over the caps. */
export function checkEntryLimits(count: number, bytes: number): void {
  const L = CANVAS_IMPORT_LIMITS;
  if (count > L.maxFiles) throw refusal("maxFiles", count, L.maxFiles);
  if (bytes > L.maxUnzippedBytes) throw refusal("maxUnzippedBytes", bytes, L.maxUnzippedBytes);
}

const EMBED = /!\[\[([^\]|#^]+)/g;

/** `![[image.png]]` embeds in a note body: images an import doesn't upload. */
function embeddedImages(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(EMBED)) {
    const target = match[1]!.trim();
    if (pathKind(target) === "image") out.push(target);
  }
  return out;
}

/** Lone notes and images, laid out in a grid, when the import holds no canvas. */
const LOOSE_COLUMNS = 4;
const LOOSE_CARD = { w: 400, h: 300, gap: 40 };

// ── The import ────────────────────────────────────────────────────────────

/**
 * Reads the entries into canvases. Throws `ImportRefusedError` when the
 * import is over a cap, before anything has been uploaded or created.
 */
export function importVault(
  entries: readonly VaultEntry[],
  options: VaultImportOptions,
): VaultImportResult {
  checkEntryLimits(entries.length, totalBytes(entries));

  const resolver = new VaultResolver(entries);
  const report: ImportReport = {
    canvases: [],
    notesAttached: 0,
    textCards: 0,
    imagesFound: 0,
    skipped: [],
    repairs: [],
  };
  const taken = new Set(options.takenCanvasKeys ?? []);
  const selected = options.selected ? new Set(options.selected.map(nfc)) : null;
  const jobs = new Map<string, ImageJob>();
  const used = new Set<VaultEntry>();
  const canvases: ImportedCanvas[] = [];
  const embeds = new Map<string, string>();

  const jobFor = (entry: VaultEntry, vaultPath: string): ImageJob => {
    const key = pathKey(vaultPath);
    let job = jobs.get(key);
    if (!job) {
      job = { path: vaultPath, bytes: entry.bytes, attachmentIds: [], refs: [] };
      jobs.set(key, job);
    }
    return job;
  };

  const canvasEntries = entries.filter((e) => kindOf(e.path) === "canvas");
  for (const entry of canvasEntries) {
    const sourcePath = resolver.vaultPath(entry);
    if (selected && !selected.has(sourcePath)) continue;
    used.add(entry);
    const parsed = parseCanvas(entry.bytes);
    if (!parsed) {
      report.skipped.push({ path: sourcePath, reason: "Not a readable JSON Canvas file." });
      continue;
    }
    const index = canvases.length;
    const docFields: Record<string, DocOnlyFields> = {};
    const line = (path: string, reason: string) =>
      report.skipped.push({ path, canvas: sourcePath, reason });

    for (const node of parsed.nodes) {
      if (node.type === "group" && typeof node.background === "string" && node.background) {
        line(node.background, "Group background images aren't uploaded; the group keeps its path.");
      }
      if (node.type !== "file" || typeof node.file !== "string") continue;
      const key = canvasNodeKey(node);
      const resolved = resolver.resolve(node.file);

      if (resolved.kind === "missing") {
        line(
          node.file,
          key?.type === "image"
            ? "Image isn't in the import; the card keeps its link to the uploaded image."
            : "Not in the import; the card shows its path.",
        );
        continue;
      }
      if (resolved.kind === "ambiguous") {
        line(
          node.file,
          `${resolved.candidates.length} files match this name (${resolved.candidates.join(", ")}); the card shows its path.`,
        );
        continue;
      }
      const { entry: target, vaultPath } = resolved;
      used.add(target);
      // An exported zip names its files from outside its own folder; the card
      // keeps the path inside it, as the vault knows it.
      if (resolved.how === "exact" && resolver.root) node.file = vaultPath;
      const kind = kindOf(vaultPath);

      if (kind === "markdown" && key?.type !== "image") {
        const placed = placeReferencedNote(target.bytes);
        if (placed.kind === "inline-body") {
          docFields[node.id] = { text: placed.body.text, bom: placed.body.bom };
          report.notesAttached++;
          for (const embed of embeddedImages(placed.body.text)) {
            embeds.set(pathKey(embed), embed);
          }
        } else if (placed.kind === "skipped") {
          line(node.file, placed.reason);
        }
      } else if (kind === "image") {
        const job = jobFor(target, vaultPath);
        job.refs.push({ canvas: index, nodeId: node.id });
        if (key?.type === "image" && !job.attachmentIds.includes(key.attachmentId)) {
          job.attachmentIds.push(key.attachmentId);
        }
      } else if (kind === "canvas") {
        line(node.file, "A canvas inside a canvas isn't supported; import it on its own.");
      } else {
        line(node.file, unsupportedReason(vaultPath));
      }
    }

    const doc = new Y.Doc();
    const applied = applyJsonCanvas(doc, parsed, { mode: "whole", docFields });
    for (const skip of applied.skipped) {
      line(skip.id, `Cards of type "${skip.type}" aren't supported and were left out.`);
    }
    const state = Y.encodeStateAsUpdate(doc);
    doc.destroy();

    const wanted = joinPath(options.folder ?? "", sourcePath);
    const targetPath = repairPath(wanted, "canvas", (k) => taken.has(k));
    taken.add(pathKey(targetPath));
    if (options.mode === "new" && targetPath !== nfc(wanted)) {
      report.repairs.push({
        from: wanted,
        to: targetPath,
        reason: taken.has(pathKey(wanted)) ? "Name already taken." : "Not a valid name here.",
      });
    }
    canvases.push({
      sourcePath,
      targetPath,
      canvas: parsed,
      docFields,
      nodeCount: applied.created.length,
      state,
    });
  }

  // No canvas at all: whatever notes and images came in land on one canvas.
  if (canvasEntries.length === 0) {
    const loose = looseCanvas(entries, resolver, options, taken, report, jobFor, canvases.length);
    if (loose) {
      canvases.push(loose.canvas);
      for (const entry of loose.used) used.add(entry);
    }
  }

  for (const entry of entries) {
    if (used.has(entry)) continue;
    const path = resolver.vaultPath(entry);
    const kind = kindOf(path);
    if (kind === "canvas") continue;
    report.skipped.push({
      path,
      reason: kind === "other" ? unsupportedReason(path, false) : "Not on any imported canvas.",
    });
  }
  for (const [key, embed] of embeds) {
    if (jobs.has(key)) continue;
    report.skipped.push({
      path: embed,
      reason: "Embedded in a note; only images placed on the canvas are uploaded.",
    });
  }

  const images = [...jobs.values()].filter((job) => job.refs.length > 0);
  report.imagesFound = images.length;
  report.canvases = canvases.map((c) => ({
    sourcePath: c.sourcePath,
    targetPath: c.targetPath,
    nodes: c.nodeCount,
  }));
  checkCanvasLimits(canvases, images, options);
  return { canvases, images, report };
}

function checkCanvasLimits(
  canvases: readonly ImportedCanvas[],
  images: readonly ImageJob[],
  options: VaultImportOptions,
): void {
  const L = CANVAS_LIMITS;
  if (images.length > CANVAS_IMPORT_LIMITS.maxImagesPerImport) {
    throw refusal("maxImagesPerImport", images.length, CANVAS_IMPORT_LIMITS.maxImagesPerImport);
  }
  if (options.mode === "into") {
    // An early warning before any upload: `saveCanvasImport` checks the merged result.
    const nodes = (options.existing?.nodes ?? 0) + sum(canvases.map((c) => c.nodeCount));
    if (nodes > L.maxNodes) throw refusal("maxNodes", nodes, L.maxNodes);
    const bytes = (options.existing?.stateBytes ?? 0) + sum(canvases.map((c) => c.state.length));
    if (bytes > L.maxStateBytes) throw refusal("maxStateBytes", bytes, L.maxStateBytes);
    return;
  }
  for (const canvas of canvases) {
    if (canvas.nodeCount > L.maxNodes) throw refusal("maxNodes", canvas.nodeCount, L.maxNodes);
    if (canvas.state.length > L.maxStateBytes) {
      throw refusal("maxStateBytes", canvas.state.length, L.maxStateBytes);
    }
  }
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function looseCanvas(
  entries: readonly VaultEntry[],
  resolver: VaultResolver,
  options: VaultImportOptions,
  taken: Set<string>,
  report: ImportReport,
  jobFor: (entry: VaultEntry, vaultPath: string) => ImageJob,
  index: number,
): { canvas: ImportedCanvas; used: VaultEntry[] } | null {
  const nodes: JsonCanvasNode[] = [];
  const used: VaultEntry[] = [];
  const sorted = [...entries].sort((a, b) =>
    resolver.vaultPath(a).localeCompare(resolver.vaultPath(b)),
  );
  const at = (i: number) => ({
    x: (i % LOOSE_COLUMNS) * (LOOSE_CARD.w + LOOSE_CARD.gap),
    y: Math.floor(i / LOOSE_COLUMNS) * (LOOSE_CARD.h + LOOSE_CARD.gap),
    width: LOOSE_CARD.w,
    height: LOOSE_CARD.h,
  });
  for (const entry of sorted) {
    const path = resolver.vaultPath(entry);
    const kind = kindOf(path);
    if (kind === "markdown") {
      const placed = placeLoneNote(entry.bytes);
      if (placed.kind !== "text-card") {
        if (placed.kind === "skipped") report.skipped.push({ path, reason: placed.reason });
        used.push(entry);
        continue;
      }
      if (placed.truncated) {
        report.skipped.push({
          path,
          reason: `Longer than a card holds; the text was cut at ${CANVAS_LIMITS.maxCardText.toLocaleString("en")} characters.`,
        });
      }
      nodes.push({ id: newCanvasId(), type: "text", text: placed.text, ...at(nodes.length) });
      report.textCards++;
      used.push(entry);
    } else if (kind === "image") {
      const id = newCanvasId();
      nodes.push({ id, type: "file", file: path, ...at(nodes.length) });
      jobFor(entry, path).refs.push({ canvas: index, nodeId: id });
      used.push(entry);
    }
  }
  if (nodes.length === 0) return null;

  const canvas: JsonCanvas = { nodes, edges: [] };
  const doc = new Y.Doc();
  applyJsonCanvas(doc, canvas, { mode: "whole" });
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  const name = resolver.root || (sorted.length === 1 ? pathTitle(basename(sorted[0]!.path)) : "");
  const targetPath = repairPath(joinPath(options.folder ?? "", name || "Imported"), "canvas", (k) =>
    taken.has(k),
  );
  taken.add(pathKey(targetPath));
  return {
    canvas: {
      sourcePath: "",
      targetPath,
      canvas,
      docFields: {},
      nodeCount: nodes.length,
      state,
    },
    used,
  };
}

// ── After the uploads ─────────────────────────────────────────────────────

/** Where an image job landed: an attachment in the target scope. */
export interface ResolvedImage {
  attachmentId: string;
  path: string;
}

/**
 * A canvas with its images resolved: each file node showing an uploaded or
 * reused image becomes an image node at the attachment's path. Nodes whose
 * image failed keep the "not included" state.
 */
export function withImages(
  imported: ImportedCanvas,
  index: number,
  images: readonly ImageJob[],
  resolved: ReadonlyMap<ImageJob, ResolvedImage>,
): { canvas: JsonCanvas; docFields: Record<string, DocOnlyFields> } {
  const byNode = new Map<string, ResolvedImage>();
  for (const job of images) {
    const image = resolved.get(job);
    if (!image) continue;
    for (const ref of job.refs) if (ref.canvas === index) byNode.set(ref.nodeId, image);
  }
  const docFields = { ...imported.docFields };
  const nodes = imported.canvas.nodes.map((node) => {
    const image = byNode.get(node.id);
    if (!image) return node;
    const keyed = canvasNodeKey(node)?.type === "image";
    if (!keyed) docFields[node.id] = { plain: true };
    const { brackeys: _legacy, ...rest } = node;
    return {
      ...rest,
      file: image.path,
      jamsTeam: { type: "image" as const, attachmentId: image.attachmentId },
    };
  });
  return { canvas: { ...imported.canvas, nodes }, docFields };
}

/** The Yjs state a new canvas is created from. */
export function canvasState(
  canvas: JsonCanvas,
  docFields: Record<string, DocOnlyFields>,
): Uint8Array {
  const doc = new Y.Doc();
  try {
    applyJsonCanvas(doc, canvas, { mode: "whole", docFields });
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}
