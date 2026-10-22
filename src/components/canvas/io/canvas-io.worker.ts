/**
 * The `canvas-io` worker: unzipping, parsing, image decoding and zipping,
 * off the main thread. Loaded with `?worker` only when an import, export or
 * image preparation starts (`canvas-io-client.ts`), so it's in no route's
 * graph.
 */
/// <reference lib="webworker" />
import { runExportJob, runImportJob, runPrepareImageJob } from "./canvas-io-jobs";
import {
  type CanvasIoRequest,
  type CanvasIoResponse,
  serializeIoError,
  transferablesOf,
} from "./canvas-io-protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(message: CanvasIoResponse, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

scope.onmessage = async (event: MessageEvent<CanvasIoRequest>) => {
  const request = event.data;
  const progress = (p: Parameters<NonNullable<Parameters<typeof runImportJob>[1]>>[0]) =>
    post({ id: request.id, type: "progress", progress: p });
  try {
    const result =
      request.job === "import"
        ? await runImportJob(request.input, progress)
        : request.job === "export"
          ? await runExportJob(request.input, progress)
          : await runPrepareImageJob(request.input);
    post({ id: request.id, type: "done", result }, transferablesOf(result));
  } catch (error) {
    post({ id: request.id, type: "error", error: serializeIoError(error) });
  }
};
