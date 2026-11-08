import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  Edit02Icon,
  Folder01Icon,
  FolderOpenIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ProjectPeer } from "@jams/engine/collab";
import type { AssetDrop, PeerPresence } from "@jams/engine/editor";
import type { AssetEntry } from "@jams/engine/project";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { PeerFaces } from "../peer-faces";
import { DROP_FOLDER_ATTR } from "./file-drop-target";
import { kindIcon } from "./kind-icons";
import {
  baseName,
  carriesAsset,
  readAssetDrag,
  registersSummary,
  ROOT_KEY,
  writeAssetDrag,
  type TreeRow,
} from "./tree-rows";

type Row<T extends TreeRow["type"]> = Extract<TreeRow, { type: T }>;

/** Folder and root rows take dragged assets; this is their drop data. */
export type MoveTarget = { folder: string };
/** An asset row's drag data. */
export type MoveSource = { entry: AssetEntry };

/**
 * The asset a row hands the canvas when dragged natively (the canvas sits
 * outside the tree's DndContext); null leaves the row a folder-move source only.
 */
export type DragAsset = (entry: AssetEntry, frame?: string) => AssetDrop | null;

/** Native drag props for a row that carries `drop` onto the canvas. */
function nativeDrag(drop: (() => AssetDrop | null) | undefined) {
  if (!drop) return {};
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      const payload = drop();
      if (!payload) {
        e.preventDefault();
        return;
      }
      writeAssetDrag(e.dataTransfer, payload);
    },
  };
}

/** Project peers drawn as the editor draws scene peers; only `user` reaches the faces. */
const faces = (peers: readonly ProjectPeer[]): PeerPresence[] =>
  peers.map((p) => ({ user: p.user, mode: p.mode, clientId: p.clientId, selection: [] }));

const indentOf = (depth: number): CSSProperties => ({ paddingLeft: `${depth * 12 + 8}px` });

function DropRow({
  id,
  folder,
  enabled,
  over,
  onMoveAsset,
  children,
}: {
  id: string;
  folder: string;
  enabled: boolean;
  /** A file drag from the desktop is over this folder. */
  over: boolean;
  /** An asset row dragged natively and dropped here. */
  onMoveAsset?: (entry: AssetEntry, folder: string) => void;
  children: ReactNode;
}) {
  const target: MoveTarget = { folder };
  const { setNodeRef, isOver } = useDroppable({ id, data: target, disabled: !enabled });
  const [assetOver, setAssetOver] = useState(false);
  const takes = (e: DragEvent) => enabled && !!onMoveAsset && carriesAsset(e.dataTransfer);
  return (
    <li
      ref={setNodeRef}
      {...{ [DROP_FOLDER_ATTR]: folder }}
      className={cn(
        "group/row relative rounded-md",
        (isOver || over || assetOver) && "bg-primary/10 ring-1 ring-primary",
      )}
      onDragOver={(e) => {
        if (!takes(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setAssetOver(true);
      }}
      onDragLeave={() => setAssetOver(false)}
      onDrop={(e) => {
        if (!takes(e)) return;
        e.preventDefault();
        setAssetOver(false);
        const drop = readAssetDrag(e.dataTransfer);
        if (drop) onMoveAsset?.(drop.entry, folder);
      }}
    >
      {children}
    </li>
  );
}

export function RootItem({
  name,
  count,
  peers,
  movable,
  onMoveAsset,
}: {
  name: string;
  count: number;
  peers: readonly ProjectPeer[] | undefined;
  movable: boolean;
  onMoveAsset?: (entry: AssetEntry, folder: string) => void;
}) {
  return (
    <DropRow
      id={ROOT_KEY}
      folder=""
      enabled={movable}
      over={false}
      {...(onMoveAsset ? { onMoveAsset } : {})}
    >
      <div className="flex items-center gap-2 py-1 pr-2 pl-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        {peers?.length ? (
          <PeerFaces peers={faces(peers)} label="On the overview:" size={14} />
        ) : null}
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      </div>
    </DropRow>
  );
}

export function FolderItem({
  row,
  open,
  peers,
  movable,
  fileOver,
  onToggle,
  onMoveAsset,
}: {
  row: Row<"folder">;
  open: boolean;
  /** Everyone in a doc beneath it; drawn only while it's closed. */
  peers: readonly ProjectPeer[] | undefined;
  movable: boolean;
  fileOver: boolean;
  onToggle: () => void;
  onMoveAsset?: (entry: AssetEntry, folder: string) => void;
}) {
  return (
    <DropRow
      id={row.key}
      folder={row.folder}
      enabled={movable}
      over={fileOver}
      {...(onMoveAsset ? { onMoveAsset } : {})}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs hover:bg-muted"
        style={indentOf(row.depth)}
      >
        <HugeiconsIcon
          icon={open ? ArrowDown01Icon : ArrowRight01Icon}
          className="size-3 text-muted-foreground"
        />
        <HugeiconsIcon
          icon={open ? FolderOpenIcon : Folder01Icon}
          className="size-3.5 text-muted-foreground"
        />
        <span className="min-w-0 truncate">{row.name}</span>
        {!open && peers?.length ? (
          <PeerFaces peers={faces(peers)} label="Open inside by" size={14} />
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{row.count}</span>
      </button>
    </DropRow>
  );
}

/** The file name in an input; Enter or blur commits, Escape cancels. The stem starts selected. */
function RenameField({
  initial,
  indent,
  check,
  onCommit,
  onCancel,
}: {
  initial: string;
  indent: CSSProperties;
  check: (file: string) => string | null;
  onCommit: (file: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  const commit = () => {
    if (done.current) return;
    const file = draft.trim();
    if (file === initial || file === "") {
      done.current = true;
      onCancel();
      return;
    }
    const problem = check(file);
    setError(problem);
    if (problem) return;
    done.current = true;
    onCommit(file);
  };
  return (
    <div className="flex flex-col gap-1 py-0.5 pr-2" style={indent}>
      <Input
        ref={input}
        aria-label="File name"
        aria-invalid={error ? true : undefined}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            done.current = true;
            onCancel();
          }
        }}
        className="h-6"
      />
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function AssetItem({
  row,
  active,
  peers,
  editable,
  fileOver,
  renaming,
  checkRename,
  onOpen,
  onStartRename,
  onRename,
  onCancelRename,
  onDelete,
  dragAsset,
  framesOpen,
  onToggleFrames,
}: {
  row: Row<"asset">;
  active: boolean;
  peers: readonly ProjectPeer[] | undefined;
  editable: { move: boolean; rename: boolean; delete: boolean };
  fileOver: boolean;
  renaming: boolean;
  checkRename: (file: string) => string | null;
  onOpen?: () => void;
  onStartRename: () => void;
  onRename: (file: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
  /** Set, the row drags onto the canvas as this asset. */
  dragAsset?: DragAsset;
  /** An atlas's frame rows are listed. */
  framesOpen?: boolean;
  onToggleFrames?: () => void;
}) {
  const { entry } = row;
  const source: MoveSource = { entry };
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: row.key,
    data: source,
    disabled: !editable.move || renaming,
  });
  const indent = indentOf(row.depth);
  const display = entry.name && entry.name !== baseName(entry.path).replace(/\..*$/, "");
  return (
    <li
      {...{ [DROP_FOLDER_ATTR]: row.folder }}
      data-kind={entry.kind}
      className={cn("group/row relative rounded-md", fileOver && "bg-primary/5")}
    >
      {renaming ? (
        <RenameField
          initial={row.name}
          indent={indent}
          check={checkRename}
          onCommit={onRename}
          onCancel={onCancelRename}
        />
      ) : (
        <button
          ref={setNodeRef}
          type="button"
          aria-current={active ? "true" : undefined}
          {...listeners}
          {...nativeDrag(dragAsset && !renaming ? () => dragAsset(entry) : undefined)}
          onClick={onOpen}
          onDoubleClick={editable.rename ? onStartRename : undefined}
          onKeyDown={(e) => {
            if (e.key === "F2" && editable.rename) {
              e.preventDefault();
              onStartRename();
            } else if ((e.key === "Delete" || e.key === "Backspace") && editable.delete) {
              e.preventDefault();
              onDelete();
            } else listeners?.onKeyDown?.(e);
          }}
          className={cn(
            "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs",
            active ? "bg-primary/15 text-foreground" : "hover:bg-muted",
            isDragging && "opacity-50",
          )}
          style={{ paddingLeft: `calc(${indent.paddingLeft} + 1rem)` }}
        >
          <HugeiconsIcon
            icon={kindIcon(entry.kind)}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 truncate">{row.name}</span>
          {display ? (
            <span className="min-w-0 truncate text-muted-foreground">{entry.name}</span>
          ) : null}
          {peers?.length ? (
            <span className="ml-auto">
              <PeerFaces peers={faces(peers)} label="Open by" size={14} />
            </span>
          ) : null}
        </button>
      )}
      {!renaming && row.frames && onToggleFrames ? (
        <button
          type="button"
          aria-expanded={!!framesOpen}
          aria-label={`${framesOpen ? "Hide" : "Show"} the frames of ${row.name}`}
          onClick={onToggleFrames}
          className="absolute top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
          style={{ left: indent.paddingLeft }}
        >
          <HugeiconsIcon
            icon={framesOpen ? ArrowDown01Icon : ArrowRight01Icon}
            className="size-3"
          />
        </button>
      ) : null}
      {!renaming && (editable.rename || editable.delete) ? (
        <span className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5 rounded-md bg-muted opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
          {editable.rename ? (
            <Button
              size="icon-xs"
              variant="ghost"
              tooltip="Rename (F2)"
              aria-label={`Rename ${row.name}`}
              onClick={onStartRename}
            >
              <HugeiconsIcon icon={Edit02Icon} />
            </Button>
          ) : null}
          {editable.delete ? (
            <Button
              size="icon-xs"
              variant="ghost"
              tooltip="Move to the trash (Delete)"
              aria-label={`Delete ${row.name}`}
              onClick={onDelete}
            >
              <HugeiconsIcon icon={Delete02Icon} />
            </Button>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

/** One frame of an atlas, under its row: dragged onto the canvas it places that frame. */
export function FrameItem({
  row,
  dragAsset,
  onOpen,
}: {
  row: Row<"frame">;
  dragAsset?: DragAsset;
  onOpen?: () => void;
}) {
  const indent = indentOf(row.depth);
  return (
    <li {...{ [DROP_FOLDER_ATTR]: row.folder }} data-kind="frame" className="relative rounded-md">
      <button
        type="button"
        {...nativeDrag(dragAsset ? () => dragAsset(row.entry, row.frame) : undefined)}
        onClick={onOpen}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        style={{ paddingLeft: `calc(${indent.paddingLeft} + 1rem)` }}
      >
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
        <span className="min-w-0 truncate">{row.frame}</span>
      </button>
    </li>
  );
}

/** Code is listed so the tree is complete, but it's edited in a code editor and tracked by git. */
export function CodeItem({ row }: { row: Row<"code"> }) {
  const registers = registersSummary(row.info);
  const indent = indentOf(row.depth);
  return (
    <li data-kind="code">
      <SimpleTooltip
        content={`Read-only here: edit it in your code editor.${registers ? ` Registers ${registers}.` : ""}`}
      >
        <div
          aria-disabled="true"
          className="flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-2 text-xs text-muted-foreground opacity-60"
          style={{ paddingLeft: `calc(${indent.paddingLeft} + 1rem)` }}
        >
          <HugeiconsIcon icon={kindIcon("code")} className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{row.name}</span>
        </div>
      </SimpleTooltip>
    </li>
  );
}
