import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMemo, useState } from "react";

import type { AssetEntry } from "../../../project/index";
import type { EditorNotify } from "../../host";
import { Skeleton } from "../../kit/skeleton";
import { DeleteConfirm, type PendingDelete } from "./delete-confirm";
import { FileDropTarget } from "./file-drop-target";
import { consoleErrors } from "./notify";
import {
  AssetItem,
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
  fileCount,
  flattenTree,
  namesIn,
  parentFolder,
  peersByRow,
  renameProblem,
  ROOT_KEY,
} from "./tree-rows";
import type { ProjectTreeProps } from "./types";

const messageOf = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

/** Runs a host callback; a rejection goes to `notify.error` and rethrows for the caller. */
async function attempt<T>(
  notify: Pick<EditorNotify, "error">,
  fn: () => T | Promise<T>,
  fallback: string,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    notify.error(messageOf(err, fallback));
    throw err;
  }
}

const settle = (p: Promise<unknown>) => void p.catch(() => {});

/**
 * The project's files: folders, assets with their kind icons, and code
 * modules (greyed, read-only), with the peers in each doc on its row. Assets
 * rename in place, drag between folders and go to the trash through the
 * shared confirm, which lists referrers and offers "Delete anyway" when one
 * is in use. Files dropped from the desktop go to `onDropFiles`.
 */
export function ProjectTree({
  projectId,
  projectName,
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
  const run = <T,>(fn: () => T | Promise<T>, fallback: string) => attempt(notify, fn, fallback);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const rows = useMemo(
    () =>
      flattenTree(nodes, collapsed, {
        expanded,
        ...(assetInfo ? { framesOf: (entry) => assetInfo(entry)?.frames } : {}),
      }),
    [nodes, collapsed, expanded, assetInfo],
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

  const rename = (entry: AssetEntry, file: string) => {
    setRenaming(null);
    if (onRename) settle(run(() => onRename(entry, { file }), `Couldn't rename ${entry.id}.`));
  };

  const move = (entry: AssetEntry, folder: string) => {
    if (!onMove || parentFolder(entry.path) === folder) return;
    settle(run(() => onMove([entry.id], folder), `Couldn't move ${entry.id}.`));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const source = active.data.current as MoveSource | undefined;
    const target = over?.data.current as MoveTarget | undefined;
    if (source && target) move(source.entry, target.folder);
  };
  // A row dragged natively (for the canvas) still moves when it lands on a folder.
  const nativeMove = editable.move ? move : undefined;

  const confirmDelete = async ({ entry, referrers }: PendingDelete) => {
    if (!onDelete) return;
    const result = await run(
      () => onDelete(entry, { force: referrers.length > 0, referrers }),
      `Couldn't delete ${entry.id}.`,
    );
    if (result && result.inUse.length > 0) {
      setPending({ entry, referrers: result.inUse });
      // Keeps the confirm open, now as the in-use variant.
      throw new Error("asset-in-use");
    }
  };

  const drop = (files: File[], folder: string) => {
    if (onDropFiles) settle(run(() => onDropFiles(files, folder), "Couldn't import those files."));
  };

  return (
    <nav aria-label="Project" className="je-ptree">
      <FileDropTarget enabled={!readOnly && !!onDropFiles} onDrop={drop}>
        {(fileOver) => (
          <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
            <ul aria-label="Files" className="je-ptree-files">
              {rows.map((row) => {
                if (row.type === "root") {
                  return (
                    <RootItem
                      key={row.key}
                      name={projectName}
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
                      movable={editable.move}
                      fileOver={fileOver === row.folder}
                      onToggle={() => toggle(row.key)}
                      {...(nativeMove ? { onMoveAsset: nativeMove } : {})}
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
                    onDelete={() => setPending({ entry, referrers: referrersOf?.(entry.id) ?? [] })}
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
        onRestore={
          onRestore
            ? (entry) => settle(run(() => onRestore(entry), `Couldn't restore ${entry.id}.`))
            : undefined
        }
      />
      <DeleteConfirm pending={pending} onConfirm={confirmDelete} onClose={() => setPending(null)} />
    </nav>
  );
}
