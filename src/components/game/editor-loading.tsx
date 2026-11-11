import { lazy, Suspense } from "react";

import { CanvasShell, Island } from "@/components/canvas/shell/CanvasShell";

import { BlankCanvas } from "./game-canvas-loading";
import { GameSiteIsland } from "./site-island";

/**
 * The editor's skeleton frame, loaded on its own beside the editor's chunk;
 * the play route imports nothing from `@jams/engine/editor-ui` statically, and
 * production builds never emit it.
 */
const EditorSkeleton = import.meta.env.DEV
  ? lazy(() =>
      Promise.all([
        import("@jams/engine/editor-ui"),
        import("@jams/engine/editor-ui/style.css"),
        import("@/styles/editor-ui.css"),
      ]).then(([m]) => ({ default: m.EditorSkeleton })),
    )
  : null;

/** The room's chrome and what is happening, drawn at once while the skeleton's chunk loads. */
function LoadingShell({ roomId }: { roomId: string }) {
  return (
    <CanvasShell
      topLeft={<GameSiteIsland title={roomId} />}
      status={
        <Island
          role="status"
          className="flex-col items-start gap-0.5 px-2.5 py-1.5 text-xs text-muted-foreground"
        >
          <span>Loading the editor</span>
        </Island>
      }
    >
      <BlankCanvas />
    </CanvasShell>
  );
}

/** While the editor's chunk loads: its skeleton frame in the room's chrome, the bare chrome until then. */
export function EditorLoading({ roomId }: { roomId: string }) {
  const shell = <LoadingShell roomId={roomId} />;
  if (!EditorSkeleton) return shell;
  return (
    <Suspense fallback={shell}>
      <EditorSkeleton topLeft={<GameSiteIsland title={roomId} />} />
    </Suspense>
  );
}
