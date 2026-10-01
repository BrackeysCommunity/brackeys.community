import { Clock01Icon, FullScreenIcon, LeftToRightListBulletIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";

import { ShellBoundary } from "@/components/layout/ShellBoundary";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { useIsMobile } from "@/lib/hooks/use-mobile";

import {
  canvasQueryOptions,
  canvasScopesQueryOptions,
  useRestoreCanvas,
  type CanvasDetail,
} from "./canvas-queries";
import { CanvasSnapshotView, snapshotCards, type SnapshotViewHandle } from "./CanvasSnapshotView";
import type { CanvasEditorHandle, CanvasPanel } from "./editor/CanvasEditor";
import type { SaveStatus } from "./editor/use-canvas-save";
import { OutlinePanel } from "./OutlinePanel";
import { CanvasShell, Island } from "./shell/CanvasShell";
import { DocumentIsland } from "./shell/DocumentIsland";

const CanvasEditor = lazy(() => import("./editor/CanvasEditor"));
const HistoryPanel = lazy(() =>
  import("./editor/HistoryPanel").then((m) => ({ default: m.HistoryPanel })),
);

const STATUS_COPY: Record<SaveStatus, string> = {
  saved: "Saved",
  pending: "Saving…",
  saving: "Saving…",
  offline: "Offline — changes kept in this tab",
  "too-large": "Too large to save",
};

function useScopeName(canvas: CanvasDetail | undefined): string {
  const { data: scopes } = useQuery({
    ...canvasScopesQueryOptions(),
    enabled: canvas != null && canvas.access !== "read",
  });
  if (!canvas || canvas.scope.kind === "personal") return "Personal";
  const teamId = canvas.scope.teamId;
  return scopes?.teams.find((t) => t.teamId === teamId)?.name ?? "Team";
}

/**
 * Bottom left: save status for an editor, otherwise why the canvas is
 * read-only. A deleted canvas offers Restore here.
 */
function StatusLine({
  canvas,
  editing,
  phone,
  status,
}: {
  canvas: CanvasDetail;
  editing: boolean;
  phone: boolean;
  status: SaveStatus;
}) {
  const restore = useRestoreCanvas();
  const canEdit = canvas.access !== "read";

  if (canvas.deletedAt) {
    return (
      <span className="flex items-center gap-2">
        <Text as="span" size="xs" variant="muted">
          Read-only: in Recently deleted
        </Text>
        {canEdit ? (
          <Button
            size="xs"
            variant="outline"
            disabled={restore.isPending}
            onClick={() => restore.mutate(canvas.id)}
          >
            Restore
          </Button>
        ) : null}
      </span>
    );
  }
  const hidden = canvas.hidden
    ? `Hidden by staff${canvas.hiddenReason ? `: ${canvas.hiddenReason}` : ""}`
    : null;
  if (editing) {
    return (
      <span className="flex items-center gap-2">
        <Text
          as="span"
          size="xs"
          variant={status === "offline" || status === "too-large" ? "danger" : "muted"}
        >
          {STATUS_COPY[status]}
        </Text>
        {hidden ? (
          <Text as="span" size="xs" className="text-warning">
            {hidden}
          </Text>
        ) : null}
      </span>
    );
  }
  const reason = hidden
    ? hidden
    : canEdit && phone
      ? "View only. Editing works on a larger screen."
      : phone
        ? "View only"
        : "Read-only: you can view this canvas";
  return (
    <Text
      as="span"
      size="xs"
      variant={hidden ? undefined : "muted"}
      className={hidden ? "text-warning" : undefined}
    >
      {reason}
    </Text>
  );
}

/**
 * A canvas, taking over the window. Everyone gets the snapshot view first;
 * someone who can edit then loads the editor over it. Readers, phones and
 * deleted canvases stay on the snapshot.
 */
export function CanvasPage({ canvasId }: { canvasId: string }) {
  const { data: canvas } = useQuery(canvasQueryOptions(canvasId));
  const isMobile = useIsMobile();
  const scopeName = useScopeName(canvas);
  const [panel, setPanel] = useState<CanvasPanel>(null);
  const togglePanel = (next: Exclude<CanvasPanel, null>) =>
    setPanel((open) => (open === next ? null : next));
  const [status, setStatus] = useState<SaveStatus>("saved");
  const editorHandle = useRef<CanvasEditorHandle | null>(null);
  const snapshotView = useRef<SnapshotViewHandle>(null);
  const cards = useMemo(() => (canvas ? snapshotCards(canvas.snapshot) : []), [canvas]);

  const onStatus = useCallback((handle: CanvasEditorHandle) => {
    editorHandle.current = handle;
    setStatus(handle.status);
  }, []);

  // Leaving with a save pending: finish it first, then go.
  useBlocker({
    shouldBlockFn: async () => {
      await editorHandle.current?.flush();
      return false;
    },
    enableBeforeUnload: false,
  });

  if (!canvas) return null;

  const canEdit = canvas.access !== "read" && !canvas.deletedAt && canvas.state != null;
  const editing = canEdit && !isMobile;
  // Staff reach any canvas's history from the read-only view.
  const staffHistory = !editing && !isMobile && canvas.canModerate && !canvas.deletedAt;
  const files =
    canvas.access !== "read" && !isMobile
      ? { scope: canvas.scope, currentId: canvas.id }
      : undefined;

  const topLeft = (
    <DocumentIsland
      canvas={canvas}
      scopeName={scopeName}
      editable={editing}
      exportJson={() => editorHandle.current?.exportJson() ?? canvas.snapshot}
      compact={isMobile}
    />
  );
  const toggles = (
    <>
      <Button
        variant={panel === "outline" ? "secondary" : "ghost"}
        size="icon"
        tooltip="Outline"
        aria-label="Outline"
        aria-pressed={panel === "outline"}
        onClick={() => togglePanel("outline")}
      >
        <HugeiconsIcon icon={LeftToRightListBulletIcon} size={16} />
      </Button>
      {editing || staffHistory ? (
        <Button
          variant={panel === "history" ? "secondary" : "ghost"}
          size="icon"
          tooltip="History"
          aria-label="History"
          aria-pressed={panel === "history"}
          onClick={() => togglePanel("history")}
        >
          <HugeiconsIcon icon={Clock01Icon} size={16} />
        </Button>
      ) : null}
    </>
  );
  const statusLine = (
    <StatusLine canvas={canvas} editing={editing} phone={isMobile} status={status} />
  );
  const statusIsland = (
    <Island role="status" aria-live="polite" className="px-2.5 py-1.5">
      {statusLine}
    </Island>
  );

  const reader = (
    <CanvasShell
      phone={isMobile}
      topLeft={topLeft}
      topRight={isMobile ? toggles : <Island aria-label="View">{toggles}</Island>}
      left={
        panel === "outline" ? (
          <OutlinePanel
            cards={cards}
            edges={canvas.snapshot.edges.map((e) => ({
              from: e.fromNode,
              to: e.toNode,
              label: e.label,
            }))}
            onFocus={(id) => {
              if (isMobile) setPanel(null);
              snapshotView.current?.focusCard(id);
            }}
            onClose={() => setPanel(null)}
            files={files}
          />
        ) : null
      }
      right={
        staffHistory && panel === "history" ? (
          <Suspense fallback={null}>
            <HistoryPanel canvasId={canvas.id} onClose={() => setPanel(null)} />
          </Suspense>
        ) : null
      }
      dock={
        isMobile ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => snapshotView.current?.fit()}
            aria-label="Fit to screen"
          >
            <HugeiconsIcon icon={FullScreenIcon} size={14} />
            Fit
          </Button>
        ) : undefined
      }
      status={isMobile ? <span role="status">{statusLine}</span> : statusIsland}
    >
      <CanvasSnapshotView
        ref={snapshotView}
        snapshot={canvas.snapshot}
        attachments={canvas.attachments}
        focusable
        grid
      />
    </CanvasShell>
  );

  if (!editing) return reader;

  return (
    <ShellBoundary scope="canvas_editor" fallback={reader}>
      <Suspense fallback={reader}>
        <CanvasEditor
          canvas={canvas}
          onStatus={onStatus}
          panel={panel}
          onClosePanel={() => setPanel(null)}
          chrome={{ topLeft, toggles, status: statusIsland, files }}
        />
      </Suspense>
    </ShellBoundary>
  );
}
