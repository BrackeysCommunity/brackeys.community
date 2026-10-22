import { basename, dirname, joinPath } from "@/lib/canvas/paths";
/**
 * The `canvas-io` jobs: import (read, unzip, parse, resolve, prepare the
 * images), image preparation, and export (fetch the images, zip). The
 * worker runs these; `canvas-io-client.ts` runs the same functions in the
 * page when there's no worker.
 */
import {
  isAllowedProfileProjectImageType,
  PROFILE_PROJECT_IMAGE_MAX_SIZE_BYTES as MAX_UPLOAD_BYTES,
} from "@/lib/image-upload-policy";

import { ImageTooLargeError, prepareImage } from "./prepare-image";
import type { VaultExportFile } from "./vault-export";
import {
  checkEntryLimits,
  type ImageJob,
  importVault,
  type ImportReport,
  type ImportedCanvas,
  scanVault,
  type VaultEntry,
  type VaultImportOptions,
} from "./vault-import";
import { unzipVault, zipVault } from "./vault-zip";

export interface CanvasIoProgress {
  phase: "reading" | "unzipping" | "importing" | "preparing" | "fetching" | "zipping";
  done: number;
  total: number;
}

type Progress = (progress: CanvasIoProgress) => void;

/** What an import reads: one zip, or files with their paths in the vault. */
export interface ImportSource {
  zip?: Blob;
  files?: { path: string; file: Blob }[];
}

/** An image ready to upload: prepared bytes, their sha256, or why it can't go. */
export interface PreparedImage extends ImageJob {
  /** The file to upload, named for the path it asks for. */
  upload: File | null;
  sha256: string | null;
  /** The path the upload asks for: the vault path, with a new extension if re-encoded. */
  uploadPath: string;
  error: string | null;
}

export type ImportJobResult =
  | { kind: "scan"; scan: ReturnType<typeof scanVault>; ignored: number }
  | {
      kind: "import";
      canvases: ImportedCanvas[];
      images: PreparedImage[];
      report: ImportReport;
    };

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

function mimeOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return MIME_BY_EXTENSION[path.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

async function readSource(
  source: ImportSource,
  progress: Progress,
): Promise<{ entries: VaultEntry[]; ignored: number }> {
  if (source.zip) {
    progress({ phase: "unzipping", done: 0, total: 1 });
    const unzipped = unzipVault(new Uint8Array(await source.zip.arrayBuffer()));
    progress({ phase: "unzipping", done: 1, total: 1 });
    return unzipped;
  }
  const files = source.files ?? [];
  let bytes = 0;
  for (const f of files) bytes += f.file.size;
  checkEntryLimits(files.length, bytes);
  const entries: VaultEntry[] = [];
  for (const [i, f] of files.entries()) {
    entries.push({ path: f.path, bytes: new Uint8Array(await f.file.arrayBuffer()) });
    if (i % 25 === 0) progress({ phase: "reading", done: i + 1, total: files.length });
  }
  return { entries, ignored: 0 };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * `prepareImage` where the platform can decode images; elsewhere (node)
 * the file goes as it is if it's under the upload cap.
 */
export async function prepareForUpload(file: File): Promise<File> {
  if (typeof createImageBitmap === "undefined") {
    if (file.size > MAX_UPLOAD_BYTES) throw new ImageTooLargeError();
    return file;
  }
  return prepareImage(file);
}

async function prepareJob(job: ImageJob): Promise<PreparedImage> {
  const type = mimeOf(job.path);
  const base = { ...job, upload: null, sha256: null, uploadPath: job.path };
  if (!isAllowedProfileProjectImageType(type)) {
    return { ...base, error: "Only PNG, JPEG, GIF and WebP images can be uploaded." };
  }
  try {
    const original = new File([job.bytes as Uint8Array<ArrayBuffer>], basename(job.path), {
      type,
    });
    const prepared = await prepareForUpload(original);
    const bytes = prepared === original ? job.bytes : new Uint8Array(await prepared.arrayBuffer());
    return {
      ...base,
      upload: prepared,
      sha256: await sha256Hex(bytes),
      uploadPath: joinPath(dirname(job.path), prepared.name),
      error: null,
    };
  } catch (error) {
    return {
      ...base,
      error: error instanceof ImageTooLargeError ? error.message : "Couldn't read this image.",
    };
  }
}

export async function runImportJob(
  input: { source: ImportSource; options: VaultImportOptions; scanOnly?: boolean },
  progress: Progress = () => {},
): Promise<ImportJobResult> {
  const { entries, ignored } = await readSource(input.source, progress);
  if (input.scanOnly) return { kind: "scan", scan: scanVault(entries), ignored };

  progress({ phase: "importing", done: 0, total: 1 });
  const result = importVault(entries, input.options);
  const images: PreparedImage[] = [];
  for (const [i, job] of result.images.entries()) {
    progress({ phase: "preparing", done: i, total: result.images.length });
    images.push(await prepareJob(job));
  }
  return { kind: "import", canvases: result.canvases, images, report: result.report };
}

export async function runPrepareImageJob(file: File): Promise<File> {
  return prepareForUpload(file);
}

export async function runExportJob(
  input: { files: VaultExportFile[] },
  progress: Progress = () => {},
): Promise<{ zip: Uint8Array; leftOut: { path: string; reason: string }[] }> {
  const leftOut: { path: string; reason: string }[] = [];
  const files: { path: string; bytes: Uint8Array }[] = [];
  const fetches = input.files.filter((f) => f.url);
  let fetched = 0;
  for (const file of input.files) {
    if (file.bytes) {
      files.push({ path: file.path, bytes: file.bytes });
      continue;
    }
    progress({ phase: "fetching", done: fetched++, total: fetches.length });
    try {
      const response = await fetch(file.url!, { credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      files.push({ path: file.path, bytes: new Uint8Array(await response.arrayBuffer()) });
    } catch {
      leftOut.push({ path: file.path, reason: "The image couldn't be downloaded." });
    }
  }
  progress({ phase: "zipping", done: 0, total: 1 });
  return { zip: zipVault(files), leftOut };
}
