import { Store } from "@tanstack/store";
import { useEffect, useMemo, type ReactElement, type ReactNode } from "react";

import { sceneToDoc, type SceneOrigin } from "../../collab/index";
import { createEditorSession, type SceneIssue } from "../../editor/index";
import { createRegistry, type Registry } from "../../game/index";
import type { AssetKey } from "../../project/index";
import { createScene, EMPTY_SCENE_TEMPLATE } from "../../scene/index";
import type { EditorNotify } from "../host";
import { Spinner } from "../kit/index";
import type { PanelControls } from "../panels/registry";
import type { LoadedRun } from "../session/loaded-run";
import { EditorFrame, Island, type EditorFrameProps, type FramePanels } from "./EditorFrame";

export const LOADING_LABEL = "Loading the editor";

/** What the editor's bottom-left island says while its panels can't be used yet. */
export function EditorBooting({
  label,
  working,
  error = null,
}: {
  label: string;
  working: boolean;
  error?: string | null;
}) {
  return (
    <Island role="status" aria-live="polite" className="je-editor-connecting">
      <span className="je-session-boot-label">
        {working ? <Spinner size={12} label={null} /> : null}
        {label}
      </span>
      {error ? <span className="je-editor-connecting-error">{error}</span> : null}
    </Island>
  );
}

const BOOT_ORIGIN: SceneOrigin = { kind: "user", userId: "booting" };

const silent: EditorNotify = Object.assign(() => undefined, {
  success: () => undefined,
  warning: () => undefined,
  error: () => undefined,
});

/**
 * The panels' tabs before the editor has a scene: an empty scene's session,
 * so nothing to count or follow, controls that do nothing, and every body
 * its skeleton.
 */
function skeletonPanels(registry: Registry, notify: EditorNotify): FramePanels {
  const session = createEditorSession({
    doc: sceneToDoc(createScene("booting", registry, { template: EMPTY_SCENE_TEMPLATE })),
    origin: BOOT_ORIGIN,
    name: "booting",
    registry,
  });
  const controls: PanelControls = {
    session,
    notify,
    onReplay: () => {},
    runStore: new Store<LoadedRun | null>(null),
    playFrom: () => {},
    frame: () => false,
  };
  return {
    context: {
      controls,
      physical: new Store<readonly SceneIssue[]>([]),
      pickedAsset: new Store<AssetKey | null>(null),
    },
    booting: true,
  };
}

export type EditorSkeletonProps = Omit<EditorFrameProps, "children" | "panels"> & {
  /** The editor's panels once it has them; until then each panel draws its skeleton. */
  panels?: FramePanels;
  /** What the skeleton's empty scene is built with; default the engine's own registry. */
  registry?: Registry;
  /** What the skeleton's inert controls report through; default nowhere. */
  notify?: EditorNotify;
  /** The bottom-left island; default the loading status while there are no `panels`, `null` for none. */
  status?: ReactNode;
  /** The canvas; default a blank one. */
  children?: ReactNode;
};

/**
 * The editor's frame in its default layout with every panel's skeleton and
 * a "Loading the editor" status: what a host draws while the editor's code
 * loads, and what `SceneEditor` draws while it boots. Given `panels` (and
 * `status`), it is the editor's own frame, so a booting editor keeps its
 * canvas and columns when its panels arrive.
 */
export function EditorSkeleton({
  panels,
  registry,
  notify = silent,
  status,
  children,
  ...frame
}: EditorSkeletonProps): ReactElement {
  const fallbackRegistry = useMemo(() => registry ?? createRegistry(null), [registry]);
  const boot = useMemo(() => skeletonPanels(fallbackRegistry, notify), [fallbackRegistry, notify]);
  useEffect(() => () => boot.context.controls.session.destroy(), [boot]);
  return (
    <EditorFrame
      {...frame}
      panels={panels ?? boot}
      status={
        status === undefined && !panels ? <EditorBooting label={LOADING_LABEL} working /> : status
      }
    >
      {children ?? <canvas className="je-scene-canvas" aria-hidden />}
    </EditorFrame>
  );
}
