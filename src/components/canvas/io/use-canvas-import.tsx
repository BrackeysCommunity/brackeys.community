import { useCallback, useState } from "react";
import * as Y from "yjs";

import { Button } from "@/components/ui/button";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Text } from "@/components/ui/typography";
import { base64ToBytes } from "@/lib/canvas/encoding";
import { canvasNodes } from "@/lib/canvas/json-canvas";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";
import { toast } from "@/lib/toast";

import type { CanvasScope } from "../canvas-queries";
import { runCanvasIo } from "./canvas-io-client";
import type { CanvasIoProgress, ImportSource } from "./canvas-io-jobs";
import {
  buildImport,
  captureImport,
  finalizeCanvases,
  type FinishedImportReport,
  resolveImages,
  scopeUploader,
  sendImport,
} from "./import-flow";
import { ImportReport } from "./ImportReport";
import type { DroppedFile } from "./read-drop";
import { refusal } from "./vault-import";

const PHASE_LABEL: Record<CanvasIoProgress["phase"], string> = {
  reading: "Reading files…",
  unzipping: "Unzipping…",
  importing: "Reading canvases…",
  preparing: "Preparing images…",
  fetching: "Downloading images…",
  zipping: "Zipping…",
};

/** Canvases with an import running in this tab: one at a time each. */
const importing = new Set<string>();

export const IMPORT_BUSY_MESSAGE =
  "An import is already running on this canvas. Try again once it's done.";

/** Codes the server refuses with before storing anything. */
const REFUSED = new Set([
  "PAYLOAD_TOO_LARGE",
  "BAD_REQUEST",
  "FORBIDDEN",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "TOO_MANY_REQUESTS",
]);

function refusedMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code && REFUSED.has(code) && error instanceof Error) return error.message;
  // Anything else (a proxy timeout, a failure after the commit, no answer):
  // the server may have stored it.
  return "We couldn't confirm the import was saved. Check the canvas before trying again, or it may be added twice.";
}

export type ImportIntoCanvas = (
  source: ImportSource,
  options: {
    at?: { x: number; y: number };
    selected?: string[];
    onProgress?: (label: string, value: number | null) => void;
    /** Checked between steps; once true, nothing more is uploaded or applied. */
    shouldStop?: () => boolean;
  },
) => Promise<FinishedImportReport | null>;

/**
 * Importing files into the open canvas, one import per canvas at a time.
 * The cards are built on a copy of the doc and sent to `saveCanvasImport`,
 * which keeps a `pre-import` version, checks the caps against the merged
 * state and stores it (and passes it to canvas-sync); only then are they
 * applied here, as already stored, in one undo step. Refused, nothing
 * changes.
 */
export function useCanvasImport({
  doc,
  canvasId,
  scope,
  undo,
  flush,
  applyServerUpdate,
  center,
  onCreated,
}: {
  doc: Y.Doc;
  canvasId: string;
  scope: CanvasScope;
  undo: Y.UndoManager;
  /** Sends anything unsaved first. */
  flush: () => Promise<void>;
  /** Applies an update the server already stored, so it isn't sent back. */
  applyServerUpdate: (update: Uint8Array, stateVector: Uint8Array) => void;
  center: () => { x: number; y: number };
  onCreated: (ids: string[]) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<FinishedImportReport | null>(null);

  const importInto = useCallback<ImportIntoCanvas>(
    async (source, { at, selected, onProgress, shouldStop = () => false }) => {
      if (importing.has(canvasId)) throw new Error(IMPORT_BUSY_MESSAGE);
      importing.add(canvasId);
      try {
        const progress = (label: string, value: number | null) => onProgress?.(label, value);
        const result = await runCanvasIo(
          "import",
          {
            source,
            options: {
              mode: "into",
              selected,
              existing: {
                nodes: canvasNodes(doc).size,
                stateBytes: Y.encodeStateAsUpdate(doc).length,
              },
            },
          },
          (p) =>
            progress(PHASE_LABEL[p.phase], p.total ? Math.round((p.done / p.total) * 100) : null),
        );
        if (result.kind !== "import" || shouldStop()) return null;

        progress("Uploading images…", 0);
        const images = await resolveImages(
          result.canvases,
          result.images,
          scopeUploader(scope, canvasId),
          {
            onProgress: (done, total) =>
              progress("Uploading images…", total ? Math.round((done / total) * 100) : null),
            shouldStop,
          },
        );
        if (shouldStop()) return null;
        const finals = finalizeCanvases(result.canvases, result.images, images.resolved);

        progress("Adding cards…", null);
        await flush();
        if (shouldStop()) return null;
        const built = buildImport(doc, finals, at ?? center());
        if (built.created.length) {
          // What this tab already sees; the server re-checks with everyone's edits.
          if (built.nodes > CANVAS_LIMITS.maxNodes) {
            throw refusal("maxNodes", built.nodes, CANVAS_LIMITS.maxNodes);
          }
          if (built.stateBytes > CANVAS_LIMITS.maxStateBytes) {
            throw refusal("maxStateBytes", built.stateBytes, CANVAS_LIMITS.maxStateBytes);
          }
          // Open before sending: live, canvas-sync's broadcast can bring the
          // import before the reply does.
          const release = captureImport(doc, undo, built);
          try {
            let reply: { update: string; stateVector: string };
            try {
              reply = await sendImport(canvasId, built);
            } catch (error) {
              throw new Error(refusedMessage(error), { cause: error });
            }
            const vector = base64ToBytes(reply.stateVector);
            applyServerUpdate(built.update, vector);
            applyServerUpdate(base64ToBytes(reply.update), vector);
          } finally {
            release();
          }
          onCreated(built.created);
        }

        return {
          ...result.report,
          skipped: [...result.report.skipped, ...images.skipped],
          repairs: [...result.report.repairs, ...images.repairs],
          imagesUploaded: images.uploaded,
          imagesReused: images.reused,
        };
      } finally {
        importing.delete(canvasId);
      }
    },
    [applyServerUpdate, canvasId, center, doc, flush, onCreated, scope, undo],
  );

  /** A drop of canvases, a zip, a folder or notes: imported at the drop point, then reported. */
  const importDropped = useCallback(
    (files: DroppedFile[], at: { x: number; y: number }) => {
      if (files.length === 0) return;
      if (importing.has(canvasId)) {
        toast.error(IMPORT_BUSY_MESSAGE);
        return;
      }
      const zip = files.find((f) => f.path.toLowerCase().endsWith(".zip"));
      const source: ImportSource = zip
        ? { zip: zip.file }
        : { files: files.map((f) => ({ path: f.path, file: f.file })) };
      setBusy("Importing…");
      void importInto(source, { at, onProgress: (label) => setBusy(label) })
        .then((done) => {
          if (!done) return;
          if (done.skipped.length || done.repairs.length) setReport(done);
          else toast.success("Imported.");
        })
        .catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : "That import didn't work."),
        )
        .finally(() => setBusy(null));
    },
    [canvasId, importInto],
  );

  const ui = (
    <>
      {busy ? (
        <div
          role="status"
          className="pointer-events-none absolute top-16 left-1/2 z-30 -translate-x-1/2 rounded-full border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-lg"
        >
          {busy}
        </div>
      ) : null}
      <ResponsiveModal
        open={report != null}
        onClose={() => setReport(null)}
        title="Import finished"
        description="What came in, and what was left out."
        className="sm:max-w-lg"
        footer={
          <div className="flex justify-end p-4">
            <Button onClick={() => setReport(null)}>Done</Button>
          </div>
        }
      >
        <div className="p-4">
          {report ? <ImportReport report={report} /> : null}
          {report && report.canvases.length === 0 ? (
            <Text as="p" size="xs" variant="muted">
              Nothing in that drop could go on a canvas.
            </Text>
          ) : null}
        </div>
      </ResponsiveModal>
    </>
  );

  return { importInto, importDropped, ui };
}
