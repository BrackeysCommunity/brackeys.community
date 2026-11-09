import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  Edit02Icon,
  Folder01Icon,
  FolderOpenIcon,
} from "@hugeicons/core-free-icons";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";

import type { ProjectPeer } from "../../../collab/index";
import type { AssetDrop, PeerPresence } from "../../../editor/index";
import type { AssetEntry } from "../../../project/index";
import { IconButton } from "../../kit/button";
import { Hint } from "../../kit/hint";
import { Icon } from "../../kit/icon";
import { Input } from "../../kit/input";
import { Spinner } from "../../kit/spinner";
import { useBusy } from "../../pending/use-pending";
import { PeerFaces } from "../peer-faces";
import { DROP_FOLDER_ATTR } from "./file-drop-target";
import { kindIcon } from "./kind-icons";
import { assetScope, importScope } from "./tree-pending";
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

/** What a folder or the root shows while files dropped on it import: a spinner and "2 of 5". */
function ImportBusy({ folder, children }: { folder: string; children: ReactNode }) {
  const task = useBusy(importScope(folder));
  if (!task) return children;
  return (
    <span className="je-ptree-busy" data-end="">
      <Spinner size={12} label={null} />
      {task.progress ? (
        <span className="je-ptree-count">
          {task.progress.done} of {task.progress.total}
        </span>
      ) : null}
    </span>
  );
}

function DropRow({
  id,
  folder,
  enabled,
  over,
  inert = false,
  onMoveAsset,
  children,
}: {
  id: string;
  folder: string;
  enabled: boolean;
  /** A file drag from the desktop is over this folder. */
  over: boolean;
  /** Takes no files and no assets: a folder under the Code row. */
  inert?: boolean;
  /** An asset row dragged natively and dropped here. */
  onMoveAsset?: (entry: AssetEntry, folder: string) => void;
  children: ReactNode;
}) {
  const target: MoveTarget = { folder };
  const { setNodeRef, isOver } = useDroppable({ id, data: target, disabled: !enabled || inert });
  const [assetOver, setAssetOver] = useState(false);
  const importing = useBusy(importScope(folder)) !== undefined && !inert;
  const takes = (e: DragEvent) =>
    enabled && !inert && !!onMoveAsset && carriesAsset(e.dataTransfer);
  return (
    <li
      ref={setNodeRef}
      {...(inert ? {} : { [DROP_FOLDER_ATTR]: folder })}
      className="je-ptree-row"
      aria-busy={importing || undefined}
      data-busy={importing ? "" : undefined}
      data-drop-over={isOver || over || assetOver ? "" : undefined}
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
      <div className="je-ptree-root">
        <span className="je-ptree-root-name">{name}</span>
        {peers?.length ? (
          <PeerFaces peers={faces(peers)} label="On the overview:" size={14} />
        ) : null}
        <ImportBusy folder="">
          <span className="je-ptree-count">{count}</span>
        </ImportBusy>
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
      inert={!!row.code}
      {...(onMoveAsset ? { onMoveAsset } : {})}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="je-ptree-item"
        style={indentOf(row.depth)}
      >
        <Icon
          icon={open ? ArrowDown01Icon : ArrowRight01Icon}
          size={12}
          className="je-ptree-muted"
        />
        <Icon icon={open ? FolderOpenIcon : Folder01Icon} className="je-ptree-muted" />
        <span className="je-ptree-name">{row.name}</span>
        {!open && peers?.length ? (
          <PeerFaces peers={faces(peers)} label="Open inside by" size={14} />
        ) : null}
        {row.code ? (
          <span className="je-ptree-count" data-end="">
            {row.count}
          </span>
        ) : (
          <ImportBusy folder={row.folder}>
            <span className="je-ptree-count" data-end="">
              {row.count}
            </span>
          </ImportBusy>
        )}
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
    <div className="je-ptree-rename" style={indent}>
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
        size="sm"
      />
      {error ? (
        <span role="alert" className="je-ptree-error">
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
  const busy = useBusy(assetScope(entry));
  const source: MoveSource = { entry };
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: row.key,
    data: source,
    disabled: !editable.move || renaming || !!busy,
  });
  const indent = indentOf(row.depth);
  const display = entry.name && entry.name !== baseName(entry.path).replace(/\..*$/, "");
  return (
    <li
      {...{ [DROP_FOLDER_ATTR]: row.folder }}
      data-kind={entry.kind}
      className="je-ptree-row"
      aria-busy={busy ? true : undefined}
      data-busy={busy ? "" : undefined}
      data-file-over={fileOver ? "" : undefined}
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
          onDoubleClick={editable.rename && !busy ? onStartRename : undefined}
          onKeyDown={(e) => {
            if (e.key === "F2" && editable.rename) {
              e.preventDefault();
              if (!busy) onStartRename();
            } else if ((e.key === "Delete" || e.key === "Backspace") && editable.delete) {
              e.preventDefault();
              if (!busy) onDelete();
            } else listeners?.onKeyDown?.(e);
          }}
          className="je-ptree-item"
          data-active={active ? "" : undefined}
          data-dragging={isDragging ? "" : undefined}
          style={{ paddingLeft: `calc(${indent.paddingLeft} + 1rem)` }}
        >
          <Icon icon={kindIcon(entry.kind)} className="je-ptree-muted" />
          <span className="je-ptree-name">{row.name}</span>
          {display ? <span className="je-ptree-name je-ptree-muted">{entry.name}</span> : null}
          {peers?.length ? (
            <span className="je-ptree-end">
              <PeerFaces peers={faces(peers)} label="Open by" size={14} />
            </span>
          ) : null}
          {busy ? (
            <span className="je-ptree-busy" data-end="">
              <Spinner size={12} label={null} />
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
          className="je-ptree-frames-toggle"
          style={{ left: indent.paddingLeft }}
        >
          <Icon icon={framesOpen ? ArrowDown01Icon : ArrowRight01Icon} size={12} />
        </button>
      ) : null}
      {!renaming && !busy && (editable.rename || editable.delete) ? (
        <span className="je-ptree-actions">
          {editable.rename ? (
            <IconButton
              size="icon-xs"
              icon={Edit02Icon}
              tooltip="Rename (F2)"
              label={`Rename ${row.name}`}
              onClick={onStartRename}
            />
          ) : null}
          {editable.delete ? (
            <IconButton
              size="icon-xs"
              icon={Delete02Icon}
              tooltip="Move to the trash (Delete)"
              label={`Delete ${row.name}`}
              onClick={onDelete}
            />
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
    <li {...{ [DROP_FOLDER_ATTR]: row.folder }} data-kind="frame" className="je-ptree-row">
      <button
        type="button"
        {...nativeDrag(dragAsset ? () => dragAsset(row.entry, row.frame) : undefined)}
        onClick={onOpen}
        className="je-ptree-item"
        data-tone="frame"
        style={{ paddingLeft: `calc(${indent.paddingLeft} + 1rem)` }}
      >
        <span aria-hidden className="je-ptree-dot" />
        <span className="je-ptree-name">{row.frame}</span>
      </button>
    </li>
  );
}

/** The one row the code modules sit under, after the assets; closed until opened. */
export function CodeGroupItem({
  row,
  open,
  onToggle,
}: {
  row: Row<"code-group">;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li data-kind="code-group" className="je-ptree-row">
      <Hint content="The game's code modules: read-only here, edit them in your code editor.">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="je-ptree-item"
          data-tone="code-group"
          style={indentOf(row.depth)}
        >
          <Icon
            icon={open ? ArrowDown01Icon : ArrowRight01Icon}
            size={12}
            className="je-ptree-muted"
          />
          <Icon icon={kindIcon("code")} className="je-ptree-muted" />
          <span className="je-ptree-name">Code</span>
          <span className="je-ptree-count" data-end="">
            {row.count}
          </span>
        </button>
      </Hint>
    </li>
  );
}

/** Code is listed so the tree is complete, but it's edited in a code editor and tracked by git. */
export function CodeItem({ row }: { row: Row<"code"> }) {
  const registers = registersSummary(row.info);
  const indent = indentOf(row.depth);
  return (
    <li data-kind="code">
      <Hint
        content={`Read-only here: edit it in your code editor.${registers ? ` Registers ${registers}.` : ""}`}
      >
        <div
          aria-disabled="true"
          className="je-ptree-item"
          data-tone="code"
          style={{ paddingLeft: `calc(${indent.paddingLeft} + 1rem)` }}
        >
          <Icon icon={kindIcon("code")} />
          <span className="je-ptree-name">{row.name}</span>
        </div>
      </Hint>
    </li>
  );
}
