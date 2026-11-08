import { useStore } from "@tanstack/react-store";
import type { Store } from "@tanstack/store";

import { Island } from "@/components/canvas/shell/CanvasShell";
import type { EditorHostState } from "@/components/game/live-scene-editor";
import { Button } from "@/components/ui/button";
import { MicroLabel } from "@/components/ui/typography";

/** Says the doc on screen is read-only because a newer build of the game changed its kind's schema. */
export function CodeSkewNotice({
  host,
  onReload = () => window.location.reload(),
}: {
  host: Store<EditorHostState>;
  onReload?: () => void;
}) {
  const issue = useStore(host, (s) => s.readOnly ?? null);
  if (!issue) return null;
  return (
    <Island
      role="status"
      aria-label="Read only"
      className="mb-2 w-full flex-col items-start gap-1 px-2.5 py-2 text-xs"
    >
      <MicroLabel as="span" className="text-warning uppercase">
        Read only
      </MicroLabel>
      <p>
        A newer build of the game changed the {issue.detail.kind} schema, so this{" "}
        {issue.detail.kind} can be read here but not edited.
      </p>
      <Button
        size="xs"
        variant="outline"
        tooltip="Load the newer build of the game to edit again"
        onClick={onReload}
      >
        Reload
      </Button>
    </Island>
  );
}
