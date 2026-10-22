/**
 * The worker's message handler, driven with a fake worker scope, and the
 * client's choice between the worker and the in-page fallback.
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { docToJsonCanvas } from "@/lib/canvas/json-canvas";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";

import { type ImportJobResult, runImportJob } from "../canvas-io-jobs";
import type { CanvasIoResponse } from "../canvas-io-protocol";
import { deserializeIoError } from "../canvas-io-protocol";
import { ImportRefusedError } from "../vault-import";
import { zipVault } from "../vault-zip";
import { enc, PNG } from "./vault-fixtures";

/** A job result without what differs run to run: Yjs client ids in states, file timestamps. */
function comparable(result: unknown): unknown {
  const r = result as ImportJobResult;
  if (r.kind !== "import") return r;
  return {
    ...r,
    canvases: r.canvases.map(({ state, ...c }) => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, state);
      return { ...c, json: docToJsonCanvas(doc) };
    }),
    images: r.images.map(({ upload, ...i }) => ({
      ...i,
      upload: upload && [upload.name, upload.size, upload.type],
    })),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadWorker() {
  const posted: { message: CanvasIoResponse; transfer: Transferable[] }[] = [];
  const scope = {
    onmessage: null as null | ((event: MessageEvent) => Promise<void>),
    postMessage: (message: CanvasIoResponse, transfer: Transferable[] = []) =>
      posted.push({ message: structuredClone(message), transfer }),
  };
  vi.stubGlobal("self", scope);
  await import("../canvas-io.worker");
  return { scope, posted };
}

const canvas = enc(
  JSON.stringify({
    nodes: [{ id: "a", type: "file", file: "a.png", x: 0, y: 0, width: 1, height: 1 }],
    edges: [],
  }),
);

describe("the canvas-io worker", () => {
  it("answers an import with progress, then the same result as the in-page job", async () => {
    const { scope, posted } = await loadWorker();
    const zip = new Blob([
      zipVault([
        { path: "C.canvas", bytes: canvas },
        { path: "a.png", bytes: PNG },
      ]) as Uint8Array<ArrayBuffer>,
    ]);
    const input = { source: { zip }, options: { mode: "new" as const } };
    await scope.onmessage!({ data: { id: 7, job: "import", input } } as MessageEvent);

    const kinds = posted.map((p) => p.message.type);
    expect(kinds.at(-1)).toBe("done");
    expect(kinds.slice(0, -1).every((k) => k === "progress")).toBe(true);
    expect(posted.every((p) => p.message.id === 7)).toBe(true);
    const done = posted.at(-1)!.message as Extract<CanvasIoResponse, { type: "done" }>;
    const inPage = await runImportJob(input);
    expect(comparable(done.result)).toEqual(comparable(inPage));
    // Buffers handed over rather than copied, each at most once.
    const transfer = posted.at(-1)!.transfer;
    expect(new Set(transfer).size).toBe(transfer.length);
    expect(transfer.length).toBeGreaterThan(0);
  });

  it("answers a refused import with an error that comes back as ImportRefusedError", async () => {
    const { scope, posted } = await loadWorker();
    const nodes = Array.from({ length: CANVAS_LIMITS.maxNodes + 1 }, (_, i) => ({
      id: `n${i}`,
      type: "text",
      text: "",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }));
    await scope.onmessage!({
      data: {
        id: 1,
        job: "import",
        input: {
          source: { files: [{ path: "big.canvas", file: new Blob([JSON.stringify({ nodes })]) }] },
          options: { mode: "new" },
        },
      },
    } as MessageEvent);
    const last = posted.at(-1)!.message;
    expect(last.type).toBe("error");
    const error = deserializeIoError((last as Extract<CanvasIoResponse, { type: "error" }>).error);
    expect(error).toBeInstanceOf(ImportRefusedError);
    expect((error as ImportRefusedError).limit).toBe("maxNodes");
  });

  it("answers an export with a zip", async () => {
    const { scope, posted } = await loadWorker();
    await scope.onmessage!({
      data: { id: 2, job: "export", input: { files: [{ path: "a.canvas", bytes: enc("{}") }] } },
    } as MessageEvent);
    const last = posted.at(-1)!.message as Extract<CanvasIoResponse, { type: "done" }>;
    expect(last.type).toBe("done");
    expect((last.result as { zip: Uint8Array }).zip[0]).toBe(0x50); // "PK"
  });
});

describe("the canvas-io client", () => {
  it("runs in the page when there is a Worker but no OffscreenCanvas", async () => {
    const WorkerCtor = vi.fn();
    vi.stubGlobal("Worker", WorkerCtor);
    const client = await import("../canvas-io-client");
    expect(client.canvasIoUsesWorker()).toBe(false);
    const result = await client.runCanvasIo("import", {
      source: { files: [{ path: "C.canvas", file: new Blob([canvas]) }] },
      options: { mode: "new" },
    });
    expect(result.kind).toBe("import");
    expect(WorkerCtor).not.toHaveBeenCalled();
  });

  it("gives the same result in the page as the core, for every job", async () => {
    const client = await import("../canvas-io-client");
    const input = {
      source: {
        files: [
          { path: "C.canvas", file: new Blob([canvas]) },
          { path: "a.png", file: new Blob([PNG]) },
        ],
      },
      options: { mode: "new" as const },
    };
    expect(comparable(await client.runCanvasIo("import", input))).toEqual(
      comparable(await runImportJob(input)),
    );
    const png = new File([PNG], "a.png", { type: "image/png" });
    expect(await client.prepareImageForUpload(png)).toBe(png);
  });
});
