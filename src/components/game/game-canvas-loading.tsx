import { lazy, Suspense } from "react";

/**
 * The game route's pending view. The route keeps it in its own module, which
 * the client entry imports eagerly, so this file must stay free of static
 * imports of the engine, the game or the room's chrome: they would land in
 * every page's preload.
 */

export const BlankCanvas = () => <div className="h-full w-full bg-[#1a1a2e]" />;

/** Stands in while the editor's loading frame itself downloads. */
const EditorPending = () => (
  <div className="relative h-full w-full bg-[#1a1a2e]">
    <span role="status" className="absolute top-3 left-3 text-xs text-muted-foreground">
      Loading the editor
    </span>
  </div>
);

/** `null` in production builds, where the editor never opens. */
const EditorLoading = import.meta.env.DEV
  ? lazy(() => import("./editor-loading").then((m) => ({ default: m.EditorLoading })))
  : null;

/** The room before its code runs: the editor's loading frame with `edit`, else the bare canvas. */
export function GameCanvasLoading({ roomId, edit = false }: { roomId: string; edit?: boolean }) {
  if (!edit || !EditorLoading) return <BlankCanvas />;
  return (
    <Suspense fallback={<EditorPending />}>
      <EditorLoading roomId={roomId} />
    </Suspense>
  );
}
