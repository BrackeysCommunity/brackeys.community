/**
 * Files out of a drop or a folder picker, with their paths inside the
 * folder. Two browser catches: a drop's items are emptied at the first
 * `await`, so every entry is taken synchronously in the handler
 * (`captureDrop`); and a directory reader hands back its children in
 * batches, so `readEntries` is called until it returns nothing.
 */
import { CANVAS_IMPORT_LIMITS } from "@/lib/canvas/limits";

import { keepVaultPath } from "./vault-paths";

export interface DroppedFile {
  /** `/`-separated, relative to what was dropped (a folder's own name first). */
  path: string;
  file: File;
}

/** What a drop held, taken before anything awaits. */
export interface CapturedDrop {
  entries: FileSystemEntry[];
  /** Files from browsers without `webkitGetAsEntry`. */
  files: File[];
}

/** Call synchronously inside the `drop` handler. */
export function captureDrop(dataTransfer: DataTransfer): CapturedDrop {
  const entries: FileSystemEntry[] = [];
  const items = dataTransfer.items ? [...dataTransfer.items] : [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  return { entries, files: entries.length ? [] : [...dataTransfer.files] };
}

/** True when a drop holds a folder. */
export function hasDirectory(captured: CapturedDrop): boolean {
  return captured.entries.some((e) => e.isDirectory);
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

/** Every child of a directory: `readEntries` returns at most ~100 at a time. */
export async function readAllEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await readBatch(reader);
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

async function walk(
  entry: FileSystemEntry,
  prefix: string,
  out: DroppedFile[],
  max: number,
): Promise<void> {
  if (out.length >= max) return;
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (!keepVaultPath(path)) return;
  if (entry.isFile) {
    out.push({ path, file: await fileOf(entry as FileSystemFileEntry) });
  } else if (entry.isDirectory) {
    for (const child of await readAllEntries(entry as FileSystemDirectoryEntry)) {
      await walk(child, path, out, max);
    }
  }
}

/**
 * The captured drop's files, folders walked all the way down. The walk
 * stops after `max` files: one more than an import takes is enough for the
 * import to refuse it with the count.
 */
export async function readCapturedDrop(
  captured: CapturedDrop,
  max = CANVAS_IMPORT_LIMITS.maxFiles + 1,
): Promise<DroppedFile[]> {
  const out: DroppedFile[] = [];
  for (const entry of captured.entries) await walk(entry, "", out, max);
  for (const file of captured.files) out.push({ path: file.name, file });
  return out;
}

/** An `<input webkitdirectory>` or plain file picker's files, with folder paths. */
export function filesFromInput(files: FileList | readonly File[]): DroppedFile[] {
  return [...files]
    .map((file) => ({ path: file.webkitRelativePath || file.name, file }))
    .filter((f) => keepVaultPath(f.path));
}
