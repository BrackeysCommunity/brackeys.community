import type { Store } from "@tanstack/store";
import type { ReactNode } from "react";

import { Island } from "../frame/EditorFrame";
import { Button, MicroLabel } from "../kit/index";
import type { EditorHostState } from "../session/live-scene-editor";
import { useStoreValue } from "../session/use-store-value";

/** Reloads the page the editor runs in; a no-op where there is none. */
const reloadPage = () => globalThis.location?.reload();

/** The editor's Reload control, for the banners and statuses that need a fresh page. */
export function ReloadButton({
  tooltip,
  onReload = reloadPage,
}: {
  tooltip: ReactNode;
  onReload?: () => void;
}) {
  return (
    <Button size="xs" variant="outline" tooltip={tooltip} onClick={onReload}>
      Reload
    </Button>
  );
}

/**
 * The banner over the canvas saying the doc on screen is read-only because a
 * newer build of the game changed its kind's schema.
 */
export function CodeSkewNotice({
  host,
  onReload = reloadPage,
}: {
  host: Store<EditorHostState>;
  onReload?: () => void;
}) {
  const issue = useStoreValue(host, (s) => s.readOnly ?? null);
  if (!issue) return null;
  return (
    <Island role="status" aria-label="Read only" className="je-banner">
      <MicroLabel as="span" variant="warning" className="je-banner-label">
        Read only
      </MicroLabel>
      <p className="je-banner-text">
        A newer build of the game changed the {issue.detail.kind} schema, so this{" "}
        {issue.detail.kind} can be read here but not edited.
      </p>
      <ReloadButton tooltip="Load the newer build of the game to edit again" onReload={onReload} />
    </Island>
  );
}
