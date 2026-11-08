import { useEffect, useState } from "react";

import type { EditorSession, SceneIssue } from "../../editor/index";
import { validatePhysical } from "../../headless/index";
import type { RapierModule } from "../../index";
import { useEditorStore } from "./use-editor-store";

export const PHYSICAL_DEBOUNCE_MS = 400;

const NONE: readonly SceneIssue[] = Object.freeze([]);

/**
 * The scene's physical issues (a spawn in a solid, a path that runs into one),
 * rechecked in a headless world `delayMs` after the doc or one of its
 * prefabs stops changing. None without Rapier, and none while playing.
 */
export function usePhysicalIssues(
  session: EditorSession,
  rapier: RapierModule | null,
  delayMs = PHYSICAL_DEBOUNCE_MS,
): readonly SceneIssue[] {
  const hash = useEditorStore(session, (s) => s.hash);
  const mode = useEditorStore(session, (s) => s.mode);
  const [issues, setIssues] = useState<readonly SceneIssue[]>(NONE);
  const [prefabRevision, setPrefabRevision] = useState(0);

  useEffect(() => session.prefabs.subscribe(() => setPrefabRevision((n) => n + 1)), [session]);

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
  }, [session, rapier, hash, prefabRevision, mode, delayMs]);

  return rapier ? issues : NONE;
}
