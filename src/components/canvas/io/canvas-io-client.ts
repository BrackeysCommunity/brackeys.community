/**
 * Runs a `canvas-io` job: in the worker, loaded the first time a job
 * starts, or in the page where there's no `Worker` (and in tests). Either
 * way the job and its result are the same.
 */
import type { CanvasIoProgress, ImportSource } from "./canvas-io-jobs";
import {
  type CanvasIoJob,
  type CanvasIoJobs,
  type CanvasIoRequest,
  type CanvasIoResponse,
  deserializeIoError,
} from "./canvas-io-protocol";
import { isMermaidPath, mermaidSource, mermaidToCanvas } from "./mermaid";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  progress?: (progress: CanvasIoProgress) => void;
};

let worker: Promise<Worker> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function startWorker(): Promise<Worker> {
  if (worker) return worker;
  const started = import("./canvas-io.worker?worker").then(({ default: CanvasIoWorker }) => {
    const instance = new CanvasIoWorker();
    instance.onmessage = (event: MessageEvent<CanvasIoResponse>) => {
      const message = event.data;
      const job = pending.get(message.id);
      if (!job) return;
      if (message.type === "progress") {
        job.progress?.(message.progress);
        return;
      }
      pending.delete(message.id);
      if (message.type === "done") job.resolve(message.result);
      else job.reject(deserializeIoError(message.error));
    };
    instance.onerror = (event) => {
      const error = new Error(event.message || "The file worker stopped.");
      for (const job of pending.values()) job.reject(error);
      pending.clear();
      instance.terminate();
      if (worker === started) worker = null;
    };
    return instance;
  });
  // A failed chunk load isn't cached: the next job tries again.
  started.catch(() => {
    if (worker === started) worker = null;
  });
  worker = started;
  return started;
}

async function runInPage<J extends CanvasIoJob>(
  job: J,
  input: CanvasIoJobs[J]["input"],
  progress?: (progress: CanvasIoProgress) => void,
): Promise<CanvasIoJobs[J]["result"]> {
  const jobs = await import("./canvas-io-jobs");
  type Result = CanvasIoJobs[J]["result"];
  if (job === "import") {
    return (await jobs.runImportJob(input as CanvasIoJobs["import"]["input"], progress)) as Result;
  }
  if (job === "export") {
    return (await jobs.runExportJob(input as CanvasIoJobs["export"]["input"], progress)) as Result;
  }
  return (await jobs.runPrepareImageJob(input as File)) as Result;
}

/** Images are decoded on an `OffscreenCanvas`; a worker without one can't prepare them. */
export function canvasIoUsesWorker(): boolean {
  return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

/**
 * Mermaid files as the canvases they lay out to. Mermaid's parser needs a
 * DOM, so this happens here rather than in the worker.
 */
async function withMermaidConverted(source: ImportSource): Promise<ImportSource> {
  if (!source.files?.some((f) => isMermaidPath(f.path))) return source;
  const taken = new Set(source.files.map((f) => f.path.toLowerCase()));
  const files: NonNullable<ImportSource["files"]> = [];
  const skipped = [...(source.skipped ?? [])];
  for (const entry of source.files) {
    if (!isMermaidPath(entry.path)) {
      files.push(entry);
      continue;
    }
    const diagram = mermaidSource(new TextDecoder().decode(await entry.file.arrayBuffer()));
    if (!diagram) {
      skipped.push({
        path: entry.path,
        reason: "Only flowcharts, state diagrams and mindmaps become canvases.",
      });
      continue;
    }
    try {
      const canvas = await mermaidToCanvas(diagram);
      const stem = entry.path.replace(/\.(mmd|mermaid)$/i, "");
      let path = `${stem}.canvas`;
      if (taken.has(path.toLowerCase())) path = `${stem} (Mermaid).canvas`;
      taken.add(path.toLowerCase());
      files.push({ path, file: new Blob([JSON.stringify(canvas)], { type: "application/json" }) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      skipped.push({
        path: entry.path,
        reason: `Mermaid couldn't read this diagram. ${reason}`.trim(),
      });
    }
  }
  return { ...source, files, skipped };
}

export async function runCanvasIo<J extends CanvasIoJob>(
  job: J,
  input: CanvasIoJobs[J]["input"],
  progress?: (progress: CanvasIoProgress) => void,
): Promise<CanvasIoJobs[J]["result"]> {
  if (job === "import") {
    const importInput = input as CanvasIoJobs["import"]["input"];
    input = {
      ...importInput,
      source: await withMermaidConverted(importInput.source),
    } as typeof input;
  }
  if (!canvasIoUsesWorker()) return runInPage(job, input, progress);
  const instance = await startWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, progress });
    instance.postMessage({ id, job, input } as CanvasIoRequest);
  });
}

/** An image prepared for upload, off the main thread when it can be. */
export function prepareImageForUpload(file: File): Promise<File> {
  return runCanvasIo("prepareImage", file);
}
