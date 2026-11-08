import type { EditorSession } from "@jams/engine/editor";
import { useStore } from "@tanstack/react-store";
import type { Store } from "@tanstack/store";

import type { EditorHostState } from "@/components/game/live-scene-editor";
import type { SceneDocStatus } from "@/components/game/use-scene-doc";

import { distinctPeople, PeerFaces } from "./peer-faces";
import { useEditorStore } from "./use-editor-store";

const CONNECTION: Record<SceneDocStatus, { label: string; tone: string }> = {
  connecting: { label: "Connecting", tone: "text-muted-foreground" },
  live: { label: "Live", tone: "text-success" },
  reconnecting: { label: "Reconnecting", tone: "text-warning" },
  offline: { label: "Offline", tone: "text-warning" },
  failed: { label: "Disconnected", tone: "text-destructive" },
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
  const connection = useStore(host, (s) => s.connection);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warn").length;
  const others = distinctPeople(peers).length;
  const { label, tone } = CONNECTION[connection];

  return (
    <div role="status" className="flex items-center gap-3 px-2 text-xs">
      <span className="font-medium">{sceneName}</span>
      <span className={tone}>{label}</span>
      <span className="flex items-center gap-2 text-muted-foreground">
        <PeerFaces peers={peers} label="Here:" size={16} />
        {others === 0 ? "Just you" : others === 1 ? "1 other here" : `${others} others here`}
      </span>
      {errors > 0 ? (
        <span className="text-destructive">{errors === 1 ? "1 error" : `${errors} errors`}</span>
      ) : null}
      {warnings > 0 ? (
        <span className="text-warning">
          {warnings === 1 ? "1 warning" : `${warnings} warnings`}
        </span>
      ) : null}
    </div>
  );
}
