import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMemo, useRef, useState, type ReactNode } from "react";

import type { AssetEntry } from "../../../project/index";
import { STORAGE_PREFIX } from "../../host";
import { useKit } from "../../kit/context";
import { Skeleton } from "../../kit/skeleton";
import { PendingProvider, usePendingTasks } from "../../pending/use-pending";
import { DeleteConfirm, type PendingDelete } from "./delete-confirm";
import { FileDropTarget } from "./file-drop-target";
import { filesLabel } from "./import-files";
import { consoleErrors } from "./notify";
import {
  AssetItem,
  CodeGroupItem,
  CodeItem,
  FolderItem,
  FrameItem,
  RootItem,
  type DragAsset,
  type MoveSource,
  type MoveTarget,
} from "./rows";
import { TrashSection } from "./trash-section";
import {
  assetScope,
  IMPORT_SCOPE_PREFIX,
  importScope,
  runOp,
  useTreePending,
} from "./tree-pending";
import {
  baseName,
  fileCount,
  namesIn,
  parentFolder,
  peersByRow,
  projectRows,
  renameProblem,
  ROOT_KEY,
} from "./tree-rows";
import type { ProjectTreeProps } from "./types";

const CODE_OPEN_KEY = `${STORAGE_PREFIX}project-code-open`;
const ALL_FILES = "All files";

/** The row above the tree that holds its `head`. */
export function ProjectTreeHead({ children }: { children: ReactNode }) {
  return <div className="je-panel-toolbar je-ptree-head">{children}</div>;
}

/**
 * The project's files: folders and assets with their kind icons, then one
 * Code row, closed until opened, over the code modules (greyed, read-only),
 * with the peers in each doc on its row. Assets rename in place, drag
 * between folders and go to the trash through the shared confirm, which
 * lists referrers and offers "Delete anyway" when one is in use. Files
 * dropped from the desktop go to `onDropFiles`. Each edit is a pending task:
 * its row, or the folder an import landed on, shows busy until it settles.
 * A `head` (the project switcher) names the project, so the root row then
 * says "All files" rather than repeating it.
 */
export function ProjectTree({
  projectId,
  projectName,
  head,
  nodes,
  trash = [],
  peersByDoc,
  activeKey = null,
  loading = false,
  readOnly = false,
  referrersOf,
  onOpen,
  onRename,
  onMove,
  onDelete,
  onRestore,
  onDropFiles,
  assetInfo,
  notify = consoleErrors,
}: ProjectTreeProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const { cue, storage } = useKit();
  const [codeOpen, setCodeOpen] = useState(() => storage.get(CODE_OPEN_KEY) === "1");
  const pendingOps = useTreePending(notify);
  const importing = usePendingTasks().some((t) => t.scope.startsWith(IMPORT_SCOPE_PREFIX));
  const imports = useRef(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const rows = useMemo(
    () =>
      projectRows(nodes, collapsed, {
        codeOpen,
        expanded,
        ...(assetInfo ? { framesOf: (entry) => assetInfo(entry)?.frames } : {}),
      }),
    [nodes, collapsed, codeOpen, expanded, assetInfo],
  );
  const toggleCode = () => {
    const next = !codeOpen;
    setCodeOpen(next);
    storage.set(CODE_OPEN_KEY, next ? "1" : "0");
  };

  /** One edit of an asset, busy on its row. */
  const onAsset = <T,>(
    entry: AssetEntry,
    op: string,
    label: string,
    fallback: string,
    fn: () => T | Promise<T>,
  ) =>
    runOp(
      pendingOps,
      { id: `project:${op}:${entry.key}`, scope: assetScope(entry), label, fallback },
      fn,
    );
  const peers = useMemo(
    () => peersByRow(projectId, nodes, peersByDoc),
    [projectId, nodes, peersByDoc],
  );
  const editable = {
    move: !readOnly && !!onMove,
    rename: !readOnly && !!onRename,
    delete: !readOnly && !!onDelete,
  };

  const toggleIn = (set: ReadonlySet<string>, key: string) => {
    const next = new Set(set);
    if (!next.delete(key)) next.add(key);
    return next;
  };
  const toggle = (key: string) => setCollapsed(toggleIn(collapsed, key));
  const toggleFrames = (key: string) => setExpanded(toggleIn(expanded, key));

  const dragAsset: DragAsset | undefined =
    !readOnly && assetInfo
      ? (entry, frame) => {
          const info = assetInfo(entry, frame);
          return info ? { entry, info, ...(frame !== undefined ? { frame } : {}) } : null;
        }
      : undefined;

  const dropped = () => cue("drop");

  const rename = (entry: AssetEntry, file: string) => {
    setRenaming(null);
    if (!onRename) return;
    void onAsset(
      entry,
      "rename",
      `Renaming ${baseName(entry.path)}`,
      `Couldn't rename ${entry.id}`,
      () => onRename(entry, { file }),
    );
  };

  const move = async (entry: AssetEntry, folder: string) => {
    if (!onMove || parentFolder(entry.path) === folder) return;
    const moved = await onAsset(
      entry,
      "move",
      `Moving ${baseName(entry.path)}`,
      `Couldn't move ${entry.id}`,
      () => onMove([entry.id], folder),
    );
    if (moved.ok) dropped();
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const source = active.data.current as MoveSource | undefined;
    const target = over?.data.current as MoveTarget | undefined;
    if (source && target) void move(source.entry, target.folder);
  };
  // A row dragged natively (for the canvas) still moves when it lands on a folder.
  const nativeMove = editable.move
    ? (entry: AssetEntry, folder: string) => void move(entry, folder)
    : undefined;

  const confirmDelete = async ({ entry, referrers }: PendingDelete) => {
    if (!onDelete) return;
    const result = await onAsset(
      entry,
      "delete",
      `Deleting ${baseName(entry.path)}`,
      `Couldn't delete ${entry.id}`,
      () => onDelete(entry, { force: referrers.length > 0, referrers }),
    );
    // A refusal keeps the confirm open; it was toasted already.
    if (!result.ok) throw result.error;
    if (result.value && result.value.inUse.length > 0) {
      setPending({ entry, referrers: result.value.inUse });
      // Keeps the confirm open, now as the in-use variant.
      throw new Error("asset-in-use");
    }
  };

  const restore = (entry: AssetEntry) => {
    if (!onRestore) return;
    void onAsset(
      entry,
      "restore",
      `Restoring ${baseName(entry.path)}`,
      `Couldn't restore ${entry.id}`,
      () => onRestore(entry),
    );
  };

  const drop = async (files: File[], folder: string) => {
    if (!onDropFiles) return;
    imports.current += 1;
    const imported = await runOp(
      pendingOps,
      {
        // Each drop is its own import, even onto a folder still importing.
        id: `project:import:${imports.current}`,
        scope: importScope(folder),
        label: `Importing ${filesLabel(files.length)}`,
        total: files.length,
        fallback: "Couldn't import those files.",
      },
      (step) => onDropFiles(files, folder, step),
    );
    if (imported.ok) dropped();
  };

  return (
    <PendingProvider pending={pendingOps}>
      <nav aria-label="Project" className="je-ptree">
        {head ? <ProjectTreeHead>{head}</ProjectTreeHead> : null}
        <FileDropTarget
          enabled={!readOnly && !!onDropFiles}
          busy={importing}
          onDrop={(files, folder) => void drop(files, folder)}
        >
          {(fileOver) => (
            <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
              <ul aria-label="Files" className="je-ptree-files">
                {rows.map((row) => {
                  if (row.type === "root") {
                    return (
                      <RootItem
                        key={row.key}
                        name={head ? ALL_FILES : projectName}
                        count={fileCount(nodes)}
                        peers={peers.get(ROOT_KEY)}
                        movable={editable.move}
                        {...(nativeMove ? { onMoveAsset: nativeMove } : {})}
                      />
                    );
                  }
                  if (row.type === "folder") {
                    return (
                      <FolderItem
                        key={row.key}
                        row={row}
                        open={!collapsed.has(row.key)}
                        peers={peers.get(row.key)}
                        movable={editable.move && !row.code}
                        fileOver={!row.code && fileOver === row.folder}
                        onToggle={() => toggle(row.key)}
                        {...(nativeMove && !row.code ? { onMoveAsset: nativeMove } : {})}
                      />
                    );
                  }
                  if (row.type === "code-group") {
                    return (
                      <CodeGroupItem
                        key={row.key}
                        row={row}
                        open={codeOpen}
                        onToggle={toggleCode}
                      />
                    );
                  }
                  if (row.type === "code") return <CodeItem key={row.key} row={row} />;
                  if (row.type === "frame") {
                    return (
                      <FrameItem
                        key={row.key}
                        row={row}
                        {...(dragAsset ? { dragAsset } : {})}
                        {...(onOpen ? { onOpen: () => onOpen(row.entry) } : {})}
                      />
                    );
                  }
                  const { entry } = row;
                  return (
                    <AssetItem
                      key={row.key}
                      row={row}
                      active={entry.key === activeKey}
                      peers={peers.get(row.key)}
                      editable={editable}
                      fileOver={fileOver === row.folder && row.folder !== ""}
                      renaming={renaming === row.key}
                      checkRename={(file) => renameProblem(entry, file, namesIn(nodes, row.folder))}
                      onOpen={onOpen ? () => onOpen(entry) : undefined}
                      onStartRename={() => setRenaming(row.key)}
                      onRename={(file) => rename(entry, file)}
                      onCancelRename={() => setRenaming(null)}
                      onDelete={() =>
                        setPending({ entry, referrers: referrersOf?.(entry.id) ?? [] })
                      }
                      {...(dragAsset ? { dragAsset } : {})}
                      framesOpen={expanded.has(row.key)}
                      onToggleFrames={() => toggleFrames(row.key)}
                    />
                  );
                })}
                {loading ? (
                  <li aria-label="Loading" className="je-ptree-loading">
                    {[0.7, 0.5, 0.6].map((w) => (
                      <Skeleton
                        key={w}
                        data-slot="skeleton"
                        className="je-ptree-skeleton"
                        style={{ width: `${w * 100}%` }}
                      />
                    ))}
                  </li>
                ) : nodes.length === 0 ? (
                  <li className="je-ptree-empty">
                    {!readOnly && onDropFiles
                      ? "No assets yet. Drop files here to import them."
                      : "No assets yet."}
                  </li>
                ) : null}
              </ul>
            </DndContext>
          )}
        </FileDropTarget>
        <TrashSection
          trash={trash}
          readOnly={readOnly}
          onRestore={onRestore ? restore : undefined}
        />
        <DeleteConfirm
          pending={pending}
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      </nav>
    </PendingProvider>
  );
}
