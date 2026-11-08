import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { AssetEntry } from "@jams/engine/project";
import { useMemo, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";

import { DeleteConfirm, type PendingDelete } from "./delete-confirm";
import { FileDropTarget } from "./file-drop-target";
import {
  AssetItem,
  CodeItem,
  FolderItem,
  RootItem,
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

const NO_PEERS = new Map<string | null, never[]>();

const messageOf = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

/** Runs a host callback; a rejection becomes an error toast and rethrows for the caller. */
async function run<T>(fn: () => T | Promise<T>, fallback: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    toast.error(messageOf(err, fallback));
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
  peersByDoc = NO_PEERS,
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
}: ProjectTreeProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const rows = useMemo(() => flattenTree(nodes, collapsed), [nodes, collapsed]);
  const peers = useMemo(
    () => peersByRow(projectId, nodes, peersByDoc),
    [projectId, nodes, peersByDoc],
  );
  const editable = {
    move: !readOnly && !!onMove,
    rename: !readOnly && !!onRename,
    delete: !readOnly && !!onDelete,
  };

  const toggle = (key: string) => {
    const next = new Set(collapsed);
    if (!next.delete(key)) next.add(key);
    setCollapsed(next);
  };

  const rename = (entry: AssetEntry, file: string) => {
    setRenaming(null);
    if (onRename) settle(run(() => onRename(entry, { file }), `Couldn't rename ${entry.id}.`));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const source = active.data.current as MoveSource | undefined;
    const target = over?.data.current as MoveTarget | undefined;
    if (!source || !target || !onMove) return;
    if (parentFolder(source.entry.path) === target.folder) return;
    settle(
      run(() => onMove([source.entry.id], target.folder), `Couldn't move ${source.entry.id}.`),
    );
  };

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
    <nav aria-label="Project" className="flex min-h-0 w-full flex-col gap-1 p-1">
      <FileDropTarget enabled={!readOnly && !!onDropFiles} onDrop={drop}>
        {(fileOver) => (
          <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
            <ul aria-label="Files" className="min-h-0 flex-1 overflow-y-auto">
              {rows.map((row) => {
                if (row.type === "root") {
                  return (
                    <RootItem
                      key={row.key}
                      name={projectName}
                      count={fileCount(nodes)}
                      peers={peers.get(ROOT_KEY)}
                      movable={editable.move}
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
                    />
                  );
                }
                if (row.type === "code") return <CodeItem key={row.key} row={row} />;
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
                  />
                );
              })}
              {loading ? (
                <li aria-label="Loading" className="flex flex-col gap-1.5 px-2 py-1">
                  {[0.7, 0.5, 0.6].map((w) => (
                    <Skeleton key={w} className="h-4" style={{ width: `${w * 100}%` }} />
                  ))}
                </li>
              ) : nodes.length === 0 ? (
                <li className="px-2 py-1 text-xs text-muted-foreground">
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
