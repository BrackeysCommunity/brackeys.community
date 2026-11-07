import type { RapierModule } from "@jams/engine";
import type { EditorSession, SceneIssue } from "@jams/engine/editor";
import { validatePhysical } from "@jams/engine/headless";
import { useEffect, useState } from "react";

import { useEditorStore } from "./use-editor-store";

export const PHYSICAL_DEBOUNCE_MS = 400;

const NONE: SceneIssue[] = [];

/**
 * The scene's physical issues (a spawn in a solid, a mover hitting one),
 * rechecked in a headless world `delayMs` after the doc stops changing.
 * None without Rapier, and none while playing.
 */
export function usePhysicalIssues(
  session: EditorSession,
  rapier: RapierModule | null,
  delayMs = PHYSICAL_DEBOUNCE_MS,
): SceneIssue[] {
  const hash = useEditorStore(session, (s) => s.hash);
  const mode = useEditorStore(session, (s) => s.mode);
  const [issues, setIssues] = useState<SceneIssue[]>(NONE);

  useEffect(() => {
    if (!rapier || mode !== "edit") return;
    const timer = setTimeout(() => {
      try {
        setIssues(
          validatePhysical({
            rapier,
            scene: session.getDoc(),
            registry: session.registry,
            prefabs: session.getPrefabs(),
          }),
        );
      } catch {
        // A scene mid-edit can fail to load; structural validation already reports why.
        setIssues(NONE);
      }
    }, delayMs);
    return () => clearTimeout(timer);
  }, [session, rapier, hash, mode, delayMs]);

  return rapier ? issues : NONE;
}
