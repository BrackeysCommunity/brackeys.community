import { useEffect, useRef, useState } from "react";

import type { EditorSession, SceneIssue } from "../../editor/index";
import { validatePhysical } from "../../headless/index";
import type { RapierModule } from "../../index";
import { useOptionalPending } from "../pending/use-pending";
import { useEditorStore } from "./use-editor-store";

export const PHYSICAL_DEBOUNCE_MS = 400;

/** The pending task the checks hold: the Problems tab spins while it runs. */
export const PHYSICAL_CHECK = {
  id: "physical-checks",
  label: "Checking the scene",
  scope: "panel:problems",
} as const;

const NONE: readonly SceneIssue[] = Object.freeze([]);

/**
 * The scene's physical issues (a spawn in a solid, a path that runs into one),
 * rechecked in a headless world `delayMs` after the doc or one of its
 * prefabs stops changing, on the backend the project's engine block and the
 * scene resolve to. None without Rapier, and none while playing.
 * From a change until its check lands, `PHYSICAL_CHECK` is held on the
 * editor's `Pending`.
 */
export function usePhysicalIssues(
  session: EditorSession,
  rapier: RapierModule | null,
  delayMs = PHYSICAL_DEBOUNCE_MS,
): readonly SceneIssue[] {
  const pending = useOptionalPending();
  const hash = useEditorStore(session, (s) => s.hash);
  const mode = useEditorStore(session, (s) => s.mode);
  const [issues, setIssues] = useState<readonly SceneIssue[]>(NONE);
  const [prefabRevision, setPrefabRevision] = useState(0);
  const release = useRef<(() => void) | null>(null);

  useEffect(() => session.prefabs.subscribe(() => setPrefabRevision((n) => n + 1)), [session]);

  useEffect(
    () => () => {
      release.current?.();
      release.current = null;
    },
    [pending],
  );

  useEffect(() => {
    if (!rapier || mode !== "edit") {
      release.current?.();
      release.current = null;
      return;
    }
    // One hold across a burst of changes, so the task keeps its start time.
    release.current ??= pending?.hold(PHYSICAL_CHECK) ?? null;
    const timer = setTimeout(() => {
      try {
        const engine = session.engine();
        setIssues(
          validatePhysical({
            rapier,
            scene: session.getDoc(),
            registry: session.registry,
            prefabs: session.getPrefabs(),
            ...(engine ? { engine } : {}),
          }),
        );
      } catch {
        // A scene mid-edit can fail to load; structural validation already reports why.
        setIssues(NONE);
      }
      release.current?.();
      release.current = null;
    }, delayMs);
    return () => clearTimeout(timer);
  }, [session, rapier, hash, prefabRevision, mode, delayMs, pending]);

  return rapier ? issues : NONE;
}
