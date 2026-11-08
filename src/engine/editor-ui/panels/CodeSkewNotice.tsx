import type { Store } from "@tanstack/store";

import { Island } from "../frame/EditorFrame";
import { Button, MicroLabel } from "../kit/index";
import type { EditorHostState } from "../session/live-scene-editor";
import { useStoreValue } from "../session/use-store-value";

/** Says the doc on screen is read-only because a newer build of the game changed its kind's schema. */
export function CodeSkewNotice({
  host,
  onReload = () => globalThis.location?.reload(),
}: {
  host: Store<EditorHostState>;
  onReload?: () => void;
}) {
  const issue = useStoreValue(host, (s) => s.readOnly ?? null);
  if (!issue) return null;
  return (
    <Island role="status" aria-label="Read only" className="je-notice">
      <MicroLabel as="span" variant="warning" className="je-notice-label">
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
