import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeAgo } from "@/components/ui/time-ago";
import { Text } from "@/components/ui/typography";
import { base64ToBytes, bytesToBase64 } from "@/lib/canvas/encoding";
import { toastMutationError } from "@/lib/mutation-errors";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/orpc/client";

import { canvasQueryOptions, canvasVersionsQueryOptions } from "../canvas-queries";
import { CanvasSnapshotView } from "../CanvasSnapshotView";

const REASON_LABEL: Record<string, string> = {
  hourly: "Autosave",
  "pre-restore": "Before a restore",
  "pre-link": "Before a vault link",
  "pre-import": "Before an import",
  staff: "Staff",
};

/** What an open editor hands the panel, so a restore lands in its doc. */
interface HistoryEditorLink {
  onRestored: (update: Uint8Array, stateVector: Uint8Array) => void;
  flushBeforeRestore: () => Promise<void>;
  stateVector: () => Uint8Array;
}

/**
 * The canvas's versions, a preview of the one picked, and restore. A
 * restore arrives as an ordinary edit, so undo can take it back too.
 * Without an `editor` (staff on the read-only view) the page's snapshot
 * is refetched instead.
 */
export function HistoryPanel({
  canvasId,
  onClose,
  editor,
}: {
  canvasId: string;
  onClose: () => void;
  editor?: HistoryEditorLink;
}) {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery(canvasVersionsQueryOptions(canvasId));
  const [selected, setSelected] = useState<number | null>(null);
  const preview = useQuery({
    ...orpc.getCanvasVersion.queryOptions({ input: { canvasId, versionId: selected ?? 0 } }),
    enabled: selected != null,
    staleTime: Infinity,
  });

  async function restore(versionId: number) {
    try {
      await editor?.flushBeforeRestore();
      const result = await client.restoreCanvasVersion({
        canvasId,
        versionId,
        stateVector: editor ? bytesToBase64(editor.stateVector()) : undefined,
      });
      if (editor && result.update) {
        editor.onRestored(base64ToBytes(result.update), base64ToBytes(result.stateVector));
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: canvasVersionsQueryOptions(canvasId).queryKey,
        }),
        editor
          ? null
          : queryClient.invalidateQueries({ queryKey: canvasQueryOptions(canvasId).queryKey }),
      ]);
      toast.success("Restored. The canvas you had is kept as a version.");
      setSelected(null);
    } catch (error) {
      toastMutationError("canvas.restore_version", "Couldn't restore that version.")(error);
    }
  }

  return (
    <aside
      aria-label="History"
      data-shell-region=""
      className="pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
    >
      <header className="flex items-center justify-between border-b border-border py-1.5 pr-1.5 pl-3">
        <h2 className="text-sm font-bold">History</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close history">
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </Button>
      </header>

      {selected != null ? (
        <div className="h-56 shrink-0 border-b border-border">
          {preview.data ? (
            <CanvasSnapshotView snapshot={preview.data.snapshot} attachments={{}} />
          ) : (
            <Skeleton className="h-full w-full" />
          )}
        </div>
      ) : null}

      <ul className="flex flex-1 flex-col overflow-y-auto p-2">
        {isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : data?.versions.length ? (
          data.versions.map((version) => (
            <li key={version.id}>
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-2",
                  selected === version.id ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col items-start text-left"
                  onClick={() => setSelected(version.id === selected ? null : version.id)}
                >
                  <Text as="span" size="sm" bold>
                    <TimeAgo date={version.takenAt} />
                  </Text>
                  <Text as="span" size="xs" variant="muted">
                    {REASON_LABEL[version.reason] ?? version.reason}
                  </Text>
                </button>
                {data.canRestore && selected === version.id ? (
                  <Confirm
                    title="Restore this version?"
                    message="The canvas goes back to how it was then. What it holds now is kept as a version, so you can come back to it."
                    confirmText="RESTORE"
                    onConfirm={() => restore(version.id)}
                  >
                    <Button size="sm">Restore</Button>
                  </Confirm>
                ) : null}
              </div>
            </li>
          ))
        ) : (
          <li className="p-2">
            <Text as="span" size="xs" variant="muted">
              No versions yet. One is kept each hour you edit, for 30 days.
            </Text>
          </li>
        )}
      </ul>
    </aside>
  );
}
