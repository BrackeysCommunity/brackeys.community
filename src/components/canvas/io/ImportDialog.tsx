import { FolderUploadIcon, Upload04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { MicroLabel, Text } from "@/components/ui/typography";
import { pathKey } from "@/lib/canvas/paths";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

import type { CanvasScope } from "../canvas-queries";
import { runCanvasIo } from "./canvas-io-client";
import type { CanvasIoProgress, ImportJobResult, ImportSource } from "./canvas-io-jobs";
import {
  createImportedCanvases,
  finalizeCanvases,
  type FinishedImportReport,
  type ImportSourceKind,
  resolveImages,
  scopeUploader,
} from "./import-flow";
import { ImportReport } from "./ImportReport";
import { captureDrop, type DroppedFile, filesFromInput, readCapturedDrop } from "./read-drop";

type Scan = Extract<ImportJobResult, { kind: "scan" }>;

type Step =
  | { kind: "pick" }
  | { kind: "busy"; label: string; progress: number | null }
  | { kind: "choose"; scan: Scan }
  | { kind: "report"; report: FinishedImportReport }
  | { kind: "failed"; message: string };

const PHASE_LABEL: Record<CanvasIoProgress["phase"], string> = {
  reading: "Reading files…",
  unzipping: "Unzipping…",
  importing: "Reading canvases…",
  preparing: "Preparing images…",
  fetching: "Downloading images…",
  zipping: "Zipping…",
};

/** One zip, or every file with its folder path. */
function sourceOf(files: DroppedFile[]): { source: ImportSource; kind: ImportSourceKind } {
  const zip = files.find((f) => f.path.toLowerCase().endsWith(".zip"));
  if (zip) return { source: { zip: zip.file }, kind: "obsidian_zip" };
  const folder = files.some((f) => f.path.includes("/"));
  return {
    source: { files: files.map((f) => ({ path: f.path, file: f.file })) },
    kind: folder ? "obsidian_folder" : "obsidian_canvas",
  };
}

function percent(progress: CanvasIoProgress): number | null {
  return progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;
}

/**
 * Import from Obsidian: a `.canvas`, a vault `.zip`, a folder or loose
 * notes and images. In `new` mode each chosen canvas becomes a canvas in
 * the scope; in `into` mode they land on the open canvas, through
 * `importInto`.
 */
export function ImportDialog({
  open,
  onClose,
  mode,
  scope,
  folder: initialFolder = "",
  importInto,
}: {
  open: boolean;
  onClose: () => void;
  mode: "new" | "into";
  scope: CanvasScope;
  folder?: string;
  /** Into mode: the open canvas's import. */
  importInto?: (
    source: ImportSource,
    options: {
      selected?: string[];
      onProgress: (label: string, value: number | null) => void;
      shouldStop: () => boolean;
    },
  ) => Promise<FinishedImportReport | null>;
}) {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [picked, setPicked] = useState<ReturnType<typeof sourceOf> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [folder, setFolder] = useState(initialFolder);
  const [confirmStop, setConfirmStop] = useState(false);
  const stopped = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const id = useId();

  // `stopped` stays set after a stop until the next run starts, so a run
  // still awaiting the worker or an upload sees it when it resumes.
  const reset = () => {
    setStep({ kind: "pick" });
    setPicked(null);
    setSelected(new Set());
  };
  const close = () => {
    if (step.kind === "busy") {
      setConfirmStop(true);
      return;
    }
    reset();
    onClose();
  };
  const busy = (label: string, progress: number | null = null) =>
    setStep({ kind: "busy", label, progress });
  const onProgress = (p: CanvasIoProgress) => busy(PHASE_LABEL[p.phase], percent(p));
  const fail = (error: unknown) =>
    setStep({
      kind: "failed",
      message: error instanceof Error ? error.message : "That import didn't work.",
    });

  const scan = async (files: DroppedFile[]) => {
    if (files.length === 0) return;
    const next = sourceOf(files);
    stopped.current = false;
    setPicked(next);
    busy("Reading…");
    try {
      const result = await runCanvasIo(
        "import",
        { source: next.source, options: { mode }, scanOnly: true },
        onProgress,
      );
      if (result.kind !== "scan" || stopped.current) return;
      setSelected(new Set(result.scan.canvases.filter((c) => c.valid).map((c) => c.sourcePath)));
      setStep({ kind: "choose", scan: result });
    } catch (error) {
      fail(error);
    }
  };

  const runNew = async (source: ImportSource, kind: ImportSourceKind, chosen: string[]) => {
    const existing = await client.listCanvases({ scope });
    if (stopped.current) return null;
    const result = await runCanvasIo(
      "import",
      {
        source,
        options: {
          mode: "new",
          selected: chosen,
          folder: folder.trim().replace(/^\/+|\/+$/g, ""),
          takenCanvasKeys: existing.map((c) => pathKey(c.path)),
        },
      },
      onProgress,
    );
    if (result.kind !== "import" || stopped.current) return null;
    busy("Uploading images…", 0);
    const images = await resolveImages(result.canvases, result.images, scopeUploader(scope), {
      onProgress: (done, total) =>
        busy("Uploading images…", total ? Math.round((done / total) * 100) : null),
      shouldStop: () => stopped.current,
    });
    if (stopped.current) return null;
    busy("Creating canvases…");
    const finals = finalizeCanvases(result.canvases, result.images, images.resolved);
    const created = await createImportedCanvases(finals, {
      scope,
      source: kind,
      shouldStop: () => stopped.current,
    });
    await queryClient.invalidateQueries({ queryKey: orpc.listCanvases.key() });
    return {
      ...result.report,
      canvases: created.created.map((c) => ({
        sourcePath: c.sourcePath,
        targetPath: c.path,
        nodes: c.nodeCount,
      })),
      skipped: [...result.report.skipped, ...images.skipped, ...created.skipped],
      repairs: [...result.report.repairs, ...images.repairs],
      imagesUploaded: images.uploaded,
      imagesReused: images.reused,
    } satisfies FinishedImportReport;
  };

  const start = async (scanned: Scan) => {
    if (!picked) return;
    const chosen = scanned.scan.canvases.length
      ? scanned.scan.canvases.filter((c) => selected.has(c.sourcePath)).map((c) => c.sourcePath)
      : undefined;
    stopped.current = false;
    busy("Starting…");
    try {
      const report =
        mode === "into"
          ? await importInto?.(picked.source, {
              selected: chosen,
              onProgress: (label, value) => busy(label, value),
              shouldStop: () => stopped.current,
            })
          : await runNew(picked.source, picked.kind, chosen ?? []);
      if (stopped.current) return;
      if (!report) {
        reset();
        return;
      }
      setStep({ kind: "report", report });
      toast.success(
        report.canvases.length === 1 || mode === "into"
          ? "Imported."
          : `Imported ${report.canvases.length} canvases.`,
      );
    } catch (error) {
      if (!stopped.current) fail(error);
    }
  };

  const footer =
    step.kind === "choose" ? (
      <div className="flex justify-end gap-2 p-4">
        <Button variant="ghost" onClick={reset}>
          Back
        </Button>
        <Button
          disabled={step.scan.scan.canvases.length > 0 && selected.size === 0}
          onClick={() => void start(step.scan)}
        >
          Import
        </Button>
      </div>
    ) : step.kind === "report" || step.kind === "failed" ? (
      <div className="flex justify-end gap-2 p-4">
        {step.kind === "failed" ? (
          <Button variant="ghost" onClick={reset}>
            Try another
          </Button>
        ) : null}
        <Button onClick={close}>Done</Button>
      </div>
    ) : null;

  return (
    <ResponsiveModal
      open={open}
      onClose={close}
      title={mode === "into" ? "Import into this canvas" : "Import from Obsidian"}
      description="A .canvas file, a zipped vault, a vault folder, or notes and images."
      className="sm:max-w-lg"
      footer={footer}
    >
      <div className="flex flex-col gap-4 p-4">
        {step.kind === "pick" ? (
          <div
            className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-6 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const captured = captureDrop(e.dataTransfer);
              void readCapturedDrop(captured).then(scan, fail);
            }}
          >
            <Text as="p" size="sm" variant="muted">
              Drop files or a folder here, or choose them.
            </Text>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                <HugeiconsIcon icon={Upload04Icon} size={14} />
                Choose files
              </Button>
              <Button variant="outline" size="sm" onClick={() => folderInput.current?.click()}>
                <HugeiconsIcon icon={FolderUploadIcon} size={14} />
                Choose a folder
              </Button>
            </div>
            <Text as="p" size="xs" variant="muted">
              Copying cards from Obsidian and pasting them here works in Chrome.
            </Text>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".canvas,.zip,.md,image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void scan(filesFromInput(e.target.files));
                e.target.value = "";
              }}
            />
            <input
              ref={folderInput}
              type="file"
              className="hidden"
              {...{ webkitdirectory: "" }}
              onChange={(e) => {
                if (e.target.files) void scan(filesFromInput(e.target.files));
                e.target.value = "";
              }}
            />
          </div>
        ) : null}

        {step.kind === "busy" ? (
          <div className="flex flex-col gap-2" role="status" aria-live="polite">
            <Text as="p" size="sm">
              {step.label}
            </Text>
            <Progress value={step.progress} />
          </div>
        ) : null}

        {step.kind === "choose" ? (
          <ChooseCanvases
            scan={step.scan}
            selected={selected}
            onSelected={setSelected}
            folder={mode === "new" ? folder : null}
            onFolder={setFolder}
            folderId={`${id}-folder`}
          />
        ) : null}

        {step.kind === "report" ? <ImportReport report={step.report} /> : null}

        {step.kind === "failed" ? (
          <Text as="p" size="sm" variant="danger">
            {step.message}
          </Text>
        ) : null}
      </div>
      <Confirm
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="Stop this import?"
        message="Images uploaded so far stay in the scope. Nothing more is created."
        confirmText="STOP"
        cancelText="KEEP GOING"
        variant="destructive"
        onConfirm={() => {
          stopped.current = true;
          reset();
          onClose();
        }}
      />
    </ResponsiveModal>
  );
}

function ChooseCanvases({
  scan,
  selected,
  onSelected,
  folder,
  onFolder,
  folderId,
}: {
  scan: Scan;
  selected: Set<string>;
  onSelected: (next: Set<string>) => void;
  /** New mode only: the folder the canvases go in. */
  folder: string | null;
  onFolder: (folder: string) => void;
  folderId: string;
}) {
  const { canvases, notes, images, other } = scan.scan;
  const toggle = (path: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(path);
    else next.delete(path);
    onSelected(next);
  };
  return (
    <div className="flex flex-col gap-4">
      <Text as="p" size="xs" variant="muted">
        {[
          `${canvases.length} canvas${canvases.length === 1 ? "" : "es"}`,
          `${notes} note${notes === 1 ? "" : "s"}`,
          `${images} image${images === 1 ? "" : "s"}`,
          other ? `${other} other file${other === 1 ? "" : "s"}` : null,
          scan.ignored ? `${scan.ignored} settings or hidden files skipped` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {canvases.length ? (
        <div className="flex flex-col gap-1.5">
          <MicroLabel>CANVASES</MicroLabel>
          <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
            {canvases.map((canvas) => (
              <li key={canvas.sourcePath}>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={selected.has(canvas.sourcePath)}
                    disabled={!canvas.valid}
                    onCheckedChange={(on) => toggle(canvas.sourcePath, on === true)}
                  />
                  <Text as="span" size="sm" ellipsis>
                    {canvas.sourcePath}
                  </Text>
                  <Text as="span" size="xs" variant="muted" className="ml-auto shrink-0">
                    {canvas.valid ? `${canvas.nodes} cards` : "unreadable"}
                  </Text>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Text as="p" size="sm">
          No canvases here: the notes become text cards and the images image cards, on{" "}
          {folder === null ? "this canvas" : "one new canvas"}.
        </Text>
      )}
      {folder !== null ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={folderId}>
            <MicroLabel as="span">INTO FOLDER</MicroLabel>
          </label>
          <Input
            id={folderId}
            value={folder}
            placeholder="Optional, like Imported"
            maxLength={500}
            onChange={(e) => onFolder(e.target.value)}
          />
        </div>
      ) : null}
    </div>
  );
}
