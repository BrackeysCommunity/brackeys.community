import type { Store } from "@tanstack/store";

import type { EditorSession } from "../../editor/index";
import type { SceneDocStatus } from "../connect/scene-doc";
import type { EditorHostState } from "../session/live-scene-editor";
import { useEditorStore } from "../session/use-editor-store";
import { useStoreValue } from "../session/use-store-value";
import { distinctPeople, PeerFaces } from "./peer-faces";

type Tone = "muted" | "success" | "warning" | "danger";

const CONNECTION: Record<SceneDocStatus, { label: string; tone: Tone }> = {
  connecting: { label: "Connecting", tone: "muted" },
  live: { label: "Live", tone: "success" },
  reconnecting: { label: "Reconnecting", tone: "warning" },
  offline: { label: "Offline", tone: "warning" },
  failed: { label: "Disconnected", tone: "danger" },
};

export function EditorStatusBar({
  session,
  host,
}: {
  session: EditorSession;
  host: Store<EditorHostState>;
}) {
  const sceneName = useEditorStore(session, (s) => s.sceneName);
  const issues = useEditorStore(session, (s) => s.issues);
  const peers = useEditorStore(session, (s) => s.peers);
  const connection = useStoreValue(host, (s) => s.connection);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warn").length;
  const others = distinctPeople(peers).length;
  const { label, tone } = CONNECTION[connection];

  return (
    <div role="status" className="je-status">
      <span className="je-status-scene">{sceneName}</span>
      <span data-tone={tone}>{label}</span>
      <span className="je-status-peers" data-tone="muted">
        <PeerFaces peers={peers} label="Here:" size={16} />
        {others === 0 ? "Just you" : others === 1 ? "1 other here" : `${others} others here`}
      </span>
      {errors > 0 ? (
        <span data-tone="danger">{errors === 1 ? "1 error" : `${errors} errors`}</span>
      ) : null}
      {warnings > 0 ? (
        <span data-tone="warning">{warnings === 1 ? "1 warning" : `${warnings} warnings`}</span>
      ) : null}
    </div>
  );
}
