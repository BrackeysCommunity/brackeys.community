/** Messages between the page and the `canvas-io` worker. */
import type {
  CanvasIoProgress,
  ImportJobResult,
  ImportSource,
  runExportJob,
} from "./canvas-io-jobs";
import type { VaultExportFile } from "./vault-export";
import { type ImportLimit, ImportRefusedError, type VaultImportOptions } from "./vault-import";

export interface CanvasIoJobs {
  import: {
    input: { source: ImportSource; options: VaultImportOptions; scanOnly?: boolean };
    result: ImportJobResult;
  };
  prepareImage: { input: File; result: File };
  export: {
    input: { files: VaultExportFile[] };
    result: Awaited<ReturnType<typeof runExportJob>>;
  };
}

export type CanvasIoJob = keyof CanvasIoJobs;

export type CanvasIoRequest = {
  [J in CanvasIoJob]: { id: number; job: J; input: CanvasIoJobs[J]["input"] };
}[CanvasIoJob];

export interface SerializedIoError {
  name: string;
  message: string;
  limit?: ImportLimit;
  actual?: number;
  max?: number;
}

export type CanvasIoResponse =
  | { id: number; type: "progress"; progress: CanvasIoProgress }
  | { id: number; type: "done"; result: unknown }
  | { id: number; type: "error"; error: SerializedIoError };

export function serializeIoError(error: unknown): SerializedIoError {
  if (error instanceof ImportRefusedError) {
    return {
      name: error.name,
      message: error.message,
      limit: error.limit,
      actual: error.actual,
      max: error.max,
    };
  }
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function deserializeIoError(error: SerializedIoError): Error {
  if (error.name === "ImportRefusedError" && error.limit) {
    return new ImportRefusedError(error.limit, error.actual ?? 0, error.max ?? 0, error.message);
  }
  const out = new Error(error.message);
  out.name = error.name;
  return out;
}

/** The buffers a result can hand over instead of copying. */
export function transferablesOf(result: unknown): Transferable[] {
  const out = new Set<ArrayBufferLike>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || value == null || typeof value !== "object") return;
    if (value instanceof Uint8Array) {
      if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) {
        out.add(value.buffer);
      }
      return;
    }
    if (typeof Blob !== "undefined" && value instanceof Blob) return;
    for (const child of Array.isArray(value) ? value : Object.values(value))
      visit(child, depth + 1);
  };
  visit(result, 0);
  return [...out].filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);
}
