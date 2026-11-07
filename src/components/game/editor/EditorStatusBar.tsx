import type { EditorSession } from "@jams/engine/editor";

import { TimeAgo } from "@/components/ui/time-ago";

import { useEditorStore } from "./use-editor-store";

export function EditorStatusBar({ session }: { session: EditorSession }) {
  const sceneName = useEditorStore(session, (s) => s.sceneName);
  const dirty = useEditorStore(session, (s) => s.dirty);
  const savedAt = useEditorStore(session, (s) => s.savedAt);
  const issues = useEditorStore(session, (s) => s.issues);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warn").length;

  return (
    <div role="status" className="flex items-center gap-3 px-2 text-xs">
      <span className="font-medium">{sceneName}</span>
      <span className="text-muted-foreground">
        {dirty ? (
          "Unsaved changes"
        ) : savedAt ? (
          <>
            Saved <TimeAgo date={new Date(savedAt)} />
          </>
        ) : (
          "Saved"
        )}
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
