import {
  ArrowDown01Icon,
  Delete02Icon,
  Download01Icon,
  Flag02Icon,
  FolderTransferIcon,
  PencilEdit01Icon,
  ViewIcon,
  ViewOffIcon,
  Upload04Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Textarea } from "@/components/ui/textarea";
import { MicroLabel, Text } from "@/components/ui/typography";
import { base64ToBytes } from "@/lib/canvas/encoding";
import type { JsonCanvas } from "@/lib/canvas/json-canvas";
import {
  basename,
  checkPath,
  dirname,
  joinPath,
  PATH_PROBLEM_MESSAGES,
  pathTitle,
} from "@/lib/canvas/paths";
import { toast } from "@/lib/toast";

import {
  useDeleteCanvas,
  useMoveCanvas,
  useReportCanvas,
  useSetCanvasHidden,
  type CanvasDetail,
} from "../canvas-queries";
import type { CanvasEditorHandle } from "../editor/CanvasEditor";
import { Island } from "./CanvasShell";
import { SiteMenu } from "./SiteMenu";

function scopeSearch(canvas: CanvasDetail) {
  return { scope: canvas.scope.kind === "team" ? canvas.scope.teamId : "personal" };
}

function TitleField({
  canvas,
  editable,
  inputRef,
}: {
  canvas: CanvasDetail;
  editable: boolean;
  inputRef: React.Ref<HTMLInputElement>;
}) {
  const move = useMoveCanvas(canvas.id);
  const [draft, setDraft] = useState<string | null>(null);
  const title = pathTitle(canvas.path);

  if (!editable) {
    return <h1 className="min-w-0 truncate px-1 text-sm font-bold text-foreground">{title}</h1>;
  }

  const commit = () => {
    const next = (draft ?? title).trim();
    setDraft(null);
    if (next && next !== title) {
      move.mutate(joinPath(dirname(canvas.path), `${next.replaceAll("/", "-")}.canvas`));
    }
  };

  return (
    <input
      ref={inputRef}
      aria-label="Canvas name"
      value={draft ?? title}
      maxLength={200}
      size={Math.max(4, Math.min(40, (draft ?? title).length + 1))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      className="min-w-0 truncate rounded-md bg-transparent px-1 py-0.5 text-sm font-bold text-foreground outline-none hover:bg-muted/60 focus:bg-muted"
    />
  );
}

function MoveDialog({ canvas, onClose }: { canvas: CanvasDetail; onClose: () => void }) {
  const move = useMoveCanvas(canvas.id);
  const [folder, setFolder] = useState(dirname(canvas.path));
  const id = useId();
  const trimmed = folder.trim().replace(/^\/+|\/+$/g, "");
  const path = joinPath(trimmed, basename(canvas.path));
  const checked = checkPath(path, "canvas");
  const submit = () => {
    if (!checked.ok) return;
    if (path === canvas.path) return onClose();
    move.mutate(path, { onSuccess: onClose });
  };

  return (
    <ResponsiveModal
      open
      onClose={onClose}
      title="Move canvas"
      description="Choose the folder it lives in. Leave it empty for the top level."
      className="sm:max-w-md"
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!checked.ok || move.isPending} onClick={submit}>
            Move
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-folder`}>
            <MicroLabel as="span">FOLDER</MicroLabel>
          </label>
          <Input
            id={`${id}-folder`}
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={folder}
            placeholder="Like Jam 42/Art"
            maxLength={500}
            onChange={(e) => setFolder(e.target.value)}
          />
        </div>
        {!checked.ok ? (
          <Text as="p" size="xs" variant="danger">
            {PATH_PROBLEM_MESSAGES[checked.problem]}
          </Text>
        ) : null}
        <input type="submit" className="hidden" tabIndex={-1} />
      </form>
    </ResponsiveModal>
  );
}

/** A Confirm that collects a required reason: staff hide and Report. */
function ReasonConfirm({
  open,
  onOpenChange,
  title,
  message,
  placeholder,
  confirmText,
  maxLength,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  placeholder: string;
  confirmText: string;
  maxLength: number;
  onSubmit: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState("");
  return (
    <Confirm
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setReason("");
      }}
      title={title}
      message={
        <>
          <span>{message}</span>
          <Textarea
            aria-label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={placeholder}
            rows={3}
            maxLength={maxLength}
          />
        </>
      }
      confirmText={confirmText}
      confirmDisabled={!reason.trim()}
      variant="destructive"
      onConfirm={async () => {
        await onSubmit(reason.trim());
        setReason("");
      }}
    />
  );
}

/**
 * Staff hide and unhide, and Report for a signed-in reader of a public or
 * unlisted canvas. Kept in their own group at the end of the menu.
 */
function ModerationItems({
  canvas,
  onHide,
  onUnhide,
  onReport,
}: {
  canvas: CanvasDetail;
  onHide: () => void;
  onUnhide: () => void;
  onReport: () => void;
}) {
  if (!canvas.canModerate && !canvas.canReport) return null;
  return (
    <DropdownMenuGroup>
      {canvas.canModerate ? (
        canvas.hidden ? (
          <DropdownMenuItem onClick={onUnhide}>
            <HugeiconsIcon icon={ViewIcon} size={14} />
            Unhide canvas
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={onHide}>
            <HugeiconsIcon icon={ViewOffIcon} size={14} />
            Hide canvas…
          </DropdownMenuItem>
        )
      ) : null}
      {canvas.canReport ? (
        <DropdownMenuItem onClick={onReport}>
          <HugeiconsIcon icon={Flag02Icon} size={14} />
          Report…
        </DropdownMenuItem>
      ) : null}
    </DropdownMenuGroup>
  );
}

const ImportDialog = lazy(() =>
  import("../io/ImportDialog").then((m) => ({ default: m.ImportDialog })),
);

const loadExports = () => import("../io/export-actions");

/** The open editor's doc, or one read from the canvas's stored state. */
async function exportSource(canvas: CanvasDetail, editor: CanvasEditorHandle | null) {
  if (editor) return editor.exportDoc();
  const { docFromState } = await import("@/lib/canvas/doc-state");
  return {
    doc: docFromState(canvas.state ? base64ToBytes(canvas.state) : new Uint8Array()),
    attachments: canvas.attachments,
  };
}

/**
 * The top-left island: the site menu, then the crumb (scope, folders,
 * title) and the document menu.
 */
export function DocumentIsland({
  canvas,
  scopeName,
  editable,
  exportJson,
  editor = () => null,
  compact = false,
}: {
  canvas: CanvasDetail;
  scopeName: string;
  /** The title renames inline, and the document menu shows. */
  editable: boolean;
  /** The canvas as it stands, for Export. */
  exportJson: () => JsonCanvas;
  /** The open editor, for the vault and Markdown exports and importing into it. */
  editor?: () => CanvasEditorHandle | null;
  /** Phones: the title over the scope, no folders. */
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const del = useDeleteCanvas();
  const titleInput = useRef<HTMLInputElement>(null);
  const [moving, setMoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [reporting, setReporting] = useState(false);
  const setHidden = useSetCanvasHidden(canvas.id);
  const report = useReportCanvas(canvas.id);
  const moderation = canvas.canModerate || canvas.canReport;
  const [importing, setImporting] = useState(false);
  const folders = dirname(canvas.path).split("/").filter(Boolean);
  const moderationItems = (
    <ModerationItems
      canvas={canvas}
      onHide={() => setHiding(true)}
      onUnhide={() => setHidden.mutate({ hidden: false })}
      onReport={() => setReporting(true)}
    />
  );

  const crumb = compact ? (
    <div className="flex min-w-0 flex-col">
      <TitleField canvas={canvas} editable={false} inputRef={titleInput} />
      <Text as="span" size="xs" variant="muted" ellipsis className="px-1">
        {scopeName}
      </Text>
    </div>
  ) : (
    <nav aria-label="Location" className="flex min-w-0 items-center gap-0.5 text-xs">
      <Link
        to="/canvases"
        search={scopeSearch(canvas)}
        className="shrink-0 rounded-md px-1 py-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      >
        {scopeName}
      </Link>
      {folders.map((folder, i) => (
        <span key={i} className="flex min-w-0 items-center gap-0.5 text-muted-foreground">
          <span aria-hidden>/</span>
          <span className="truncate px-0.5">{folder}</span>
        </span>
      ))}
      <span aria-hidden className="text-muted-foreground">
        /
      </span>
      <TitleField canvas={canvas} editable={editable} inputRef={titleInput} />
    </nav>
  );

  return (
    <Island
      aria-label="Canvas"
      region={!compact}
      className={compact ? "min-w-0 flex-1 border-0 bg-transparent p-0 shadow-none" : "min-w-0"}
    >
      <SiteMenu scope={canvas.scope} scopeName={scopeName} />
      {compact ? null : <span className="h-5 w-px shrink-0 bg-border" aria-hidden />}
      {crumb}
      {editable && !compact ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Canvas menu"
            render={<Button variant="ghost" size="icon-sm" tooltip="Canvas menu" />}
          >
            <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={8} className="min-w-44">
            <DropdownMenuItem
              onClick={() =>
                requestAnimationFrame(() => {
                  titleInput.current?.focus();
                  titleInput.current?.select();
                })
              }
            >
              <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setMoving(true)}>
              <HugeiconsIcon icon={FolderTransferIcon} size={14} />
              Move…
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <HugeiconsIcon icon={Download01Icon} size={14} />
                Export
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-44">
                <DropdownMenuItem
                  onClick={() =>
                    void loadExports().then((m) => m.downloadCanvasFile(canvas.path, exportJson()))
                  }
                >
                  .canvas file
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void (async () => {
                      const { doc, attachments } = await exportSource(canvas, editor());
                      const { downloadVaultZip, leftOutSummary } = await loadExports();
                      const leftOut = await downloadVaultZip(canvas.path, doc, attachments);
                      if (leftOut.length) toast.warning(leftOutSummary(leftOut));
                    })().catch(() => toast.error("Couldn't build the zip."))
                  }
                >
                  Zip for Obsidian
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void (async () => {
                      const { doc } = await exportSource(canvas, editor());
                      (await loadExports()).downloadMarkdown(canvas.path, doc);
                    })().catch(() => toast.error("Couldn't build the Markdown."))
                  }
                >
                  Markdown
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => setImporting(true)}>
              <HugeiconsIcon icon={Upload04Icon} size={14} />
              Import into this canvas…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => setConfirmDelete(true)}>
              <HugeiconsIcon icon={Delete02Icon} size={14} />
              Delete
            </DropdownMenuItem>
            {moderation ? <DropdownMenuSeparator /> : null}
            {moderationItems}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : moderation ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Canvas menu"
            render={<Button variant="ghost" size="icon-sm" tooltip="Canvas menu" />}
          >
            <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align={compact ? "end" : "start"}
            sideOffset={8}
            className="min-w-44"
          >
            {moderationItems}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {moving ? <MoveDialog canvas={canvas} onClose={() => setMoving(false)} /> : null}
      <ReasonConfirm
        open={hiding}
        onOpenChange={setHiding}
        title="Hide this canvas?"
        message="Only its owner and staff can see it while it's hidden. The owner sees the reason."
        placeholder="Reason (shown to the owner)"
        confirmText="HIDE"
        maxLength={500}
        onSubmit={(reason) => setHidden.mutateAsync({ hidden: true, reason })}
      />
      <ReasonConfirm
        open={reporting}
        onOpenChange={setReporting}
        title="Report this canvas?"
        message="Tell staff what's wrong. Only staff see this."
        placeholder="Reason"
        confirmText="REPORT"
        maxLength={1000}
        onSubmit={(reason) => report.mutateAsync(reason)}
      />
      {importing ? (
        <Suspense fallback={null}>
          <ImportDialog
            open
            mode="into"
            scope={canvas.scope}
            onClose={() => setImporting(false)}
            importInto={async (source, options) => {
              const handle = editor();
              if (!handle) throw new Error("The editor is still loading. Try again in a moment.");
              return handle.importInto(source, options);
            }}
          />
        </Suspense>
      ) : null}
      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this canvas?"
        message="It moves to Recently deleted, where it can be restored for 30 days."
        confirmText="DELETE"
        variant="destructive"
        onConfirm={async () => {
          await del.mutateAsync(canvas.id);
          await navigate({ to: "/canvases", search: scopeSearch(canvas) });
        }}
      />
    </Island>
  );
}
