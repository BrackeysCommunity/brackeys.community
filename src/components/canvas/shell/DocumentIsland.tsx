import {
  ArrowDown01Icon,
  Delete02Icon,
  Download01Icon,
  FolderTransferIcon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { MicroLabel, Text } from "@/components/ui/typography";
import type { JsonCanvas } from "@/lib/canvas/json-canvas";
import {
  basename,
  checkPath,
  dirname,
  joinPath,
  PATH_PROBLEM_MESSAGES,
  pathTitle,
} from "@/lib/canvas/paths";

import { useDeleteCanvas, useMoveCanvas, type CanvasDetail } from "../canvas-queries";
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

function downloadCanvas(path: string, json: JsonCanvas) {
  const blob = new Blob([JSON.stringify(json, null, "\t")], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = basename(path);
  a.click();
  URL.revokeObjectURL(url);
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
  compact = false,
}: {
  canvas: CanvasDetail;
  scopeName: string;
  /** The title renames inline, and the document menu shows. */
  editable: boolean;
  /** The canvas as it stands, for Export. */
  exportJson: () => JsonCanvas;
  /** Phones: the title over the scope, no folders. */
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const del = useDeleteCanvas();
  const titleInput = useRef<HTMLInputElement>(null);
  const [moving, setMoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const folders = dirname(canvas.path).split("/").filter(Boolean);

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
            <DropdownMenuItem onClick={() => downloadCanvas(canvas.path, exportJson())}>
              <HugeiconsIcon icon={Download01Icon} size={14} />
              Export .canvas
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => setConfirmDelete(true)}>
              <HugeiconsIcon icon={Delete02Icon} size={14} />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {moving ? <MoveDialog canvas={canvas} onClose={() => setMoving(false)} /> : null}
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
