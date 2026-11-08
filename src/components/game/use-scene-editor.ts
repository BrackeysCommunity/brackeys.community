import type { GameInstance, RapierModule, RunRecording } from "@jams/engine";
import type { ProjectSession } from "@jams/engine/collab";
import type { EditorStoreState } from "@jams/engine/editor";
import type { ProjectRuntimeView } from "@jams/engine/project";
import type { Registry } from "@jams/engine/scene";
import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { useEffect, useMemo, useState } from "react";

import type { EditorChrome } from "@/components/game/editor/EditorShell";
import type { LoadedRun } from "@/components/game/editor/loaded-run";
import { activeUserStore } from "@/lib/active-user-store";

import type { EditorIdentity, LiveEditor, OpenPrefab } from "./live-scene-editor";
import type { EditorProjectConnection } from "./scene-provider";
import { useSceneDoc, type SceneDocStatus } from "./use-scene-doc";

type EditorModules = {
  openLiveEditor: typeof import("./live-scene-editor").openLiveEditor;
  prefabsReady: typeof import("./live-scene-editor").prefabsReady;
  projectRegistry: typeof import("./live-scene-editor").projectRegistry;
  editorChrome: typeof import("@/components/game/editor/EditorShell").editorChrome;
  connectProject: typeof import("./scene-provider").connectEditorProject;
  identity: EditorIdentity;
  rapier: RapierModule | null;
};

const NO_PREFAB = new Store<OpenPrefab | null>(null);
// Only `mode` is read from it.
const NOT_EDITING = new Store({ mode: "edit" } as EditorStoreState);

/** `null` in production builds, so the editor's chunks (and the provider) are never emitted there. */
const loadEditor = import.meta.env.DEV
  ? () =>
      Promise.all([
        import("./live-scene-editor"),
        import("@/components/game/editor/EditorShell"),
        import("./scene-provider"),
      ])
  : null;

type SceneEditorOptions = {
  /** Built with the `registry` and `projectData` this hook returns; the editor opens once it is. */
  game: GameInstance | null;
  /** The `projectData` `game` was built with (`createGame`'s `project`); default null. */
  builtWith?: ProjectRuntimeView | null;
  /** The project the dev server co-edits, as `project:<id>`. */
  project: string;
  /** The game's code registry; the project session is opened with it. */
  registry: Registry;
  /** The scene to open, by id; the project's first scene when it holds none of that id. */
  scene?: string | null;
  enabled: boolean;
  /** The game's Rapier loader, for the editor's physical checks. */
  rapier?: () => Promise<RapierModule>;
  /** The game's canvas, which takes the active tool's cursor. */
  canvas?: () => HTMLElement | null;
};

export type SceneEditorState = {
  /** The editor's islands, once the scene has synced and the game is up. */
  chrome: EditorChrome | null;
  /** The connection while the editor is on; null when it's off. */
  status: SceneDocStatus | null;
  /** The id of the scene the editor has open. */
  scene: string | null;
  /** Why the project or its scene couldn't be opened. */
  error: Error | null;
  /**
   * The registry the host builds its game with: the code registry with the
   * open project's material assets overlaid. It changes when they do, except
   * while the editor plays, when the change waits for Stop.
   */
  registry: Registry;
  /**
   * What the host builds its game with as `project`: the open project's
   * game settings and tables, null without one. It changes as `registry` does.
   */
  projectData: ProjectRuntimeView | null;
};

type Build = { registry: Registry; projectData: ProjectRuntimeView | null };

/**
 * The in-game scene editor, in dev builds with `?edit=1`: a project
 * session on the dev server, where everyone with the project open edits
 * its scene and prefab docs, written back to the project's files. A
 * dropped connection resumes the same docs, so the editor stays open
 * through it.
 */
export function useSceneEditor({
  game,
  builtWith = null,
  project,
  registry,
  scene,
  enabled,
  rapier,
  canvas,
}: SceneEditorOptions): SceneEditorState {
  const [modules, setModules] = useState<EditorModules | null>(null);
  const [liveCell] = useState(() => new Store<LiveEditor | null>(null));
  // Outlives reconnects, so a loaded run stays loaded.
  const [runStore] = useState(() => new Store<LoadedRun | null>(null));
  const [loadRapier] = useState(() => rapier);
  const [getCanvas] = useState(() => canvas);
  const [projectCell] = useState(() => new Store<EditorProjectConnection | null>(null));

  useEffect(() => {
    if (!loadEditor || !enabled) return;
    let cancelled = false;
    void Promise.all([
      loadEditor(),
      loadRapier?.().catch(() => null) ?? Promise.resolve(null),
    ]).then(([[liveModule, shell, provider], rapierModule]) => {
      if (cancelled) return;
      const profile = activeUserStore.state.profile;
      setModules({
        openLiveEditor: liveModule.openLiveEditor,
        prefabsReady: liveModule.prefabsReady,
        projectRegistry: liveModule.projectRegistry,
        editorChrome: shell.editorChrome,
        connectProject: provider.connectEditorProject,
        identity: liveModule.editorIdentity(profile?.guildNickname ?? profile?.discordUsername),
        rapier: rapierModule,
      });
    });
    return () => {
      cancelled = true;
      setModules(null);
    };
  }, [enabled, loadRapier]);

  useEffect(() => {
    if (!modules) return;
    const link = modules.connectProject({ project, registry, origin: modules.identity.origin });
    projectCell.setState(() => link);
    return () => {
      projectCell.setState(() => null);
      link.destroy();
    };
  }, [projectCell, modules, project, registry]);

  const connection = useStore(projectCell);
  const link = useSceneDoc(connection, scene);
  const ready = link.ready;
  const session = ready?.session ?? null;

  const [overlay, setOverlay] = useState<({ session: ProjectSession } & Build) | null>(null);
  useEffect(() => {
    if (!modules || !session) return;
    const watch = modules.projectRegistry(session);
    let opened = false;
    let gone = false;
    const publish = () => {
      if (opened && !gone)
        setOverlay({ session, registry: watch.current(), projectData: watch.project?.() ?? null });
    };
    const off = watch.subscribe(publish);
    // Published once every material doc is open, so the game isn't built twice on the way.
    void watch.ready().then(() => {
      opened = true;
      publish();
    });
    return () => {
      gone = true;
      off();
      watch.destroy();
      setOverlay(null);
    };
  }, [modules, session]);
  const current = session !== null && overlay?.session === session ? overlay : null;
  const settled = current !== null;

  const live = useStore(liveCell);
  const playing = useStore(live?.session.store ?? NOT_EDITING, (s) => s.mode === "play");
  const [applied, setApplied] = useState<Build>(() => ({ registry, projectData: null }));
  const target: Build = {
    registry: current?.registry ?? registry,
    projectData: current?.projectData ?? null,
  };
  if (
    !playing &&
    (applied.registry !== target.registry || applied.projectData !== target.projectData)
  )
    setApplied(target);
  const fits =
    game !== null && game.registry === applied.registry && builtWith === applied.projectData;

  useEffect(() => {
    if (!modules || !game || !ready || !settled || !fits) return;
    let next: LiveEditor | null = null;
    let gone = false;
    // Opened once the prefab docs are, so the scene's instances resolve from the first frame.
    void modules
      .prefabsReady(ready.session)
      .catch(() => {})
      .then(() => {
        if (gone) return;
        next = modules.openLiveEditor({
          game,
          doc: ready.doc.doc,
          awareness: ready.doc.awareness,
          name: ready.id,
          identity: modules.identity,
          project: { session: ready.session, doc: ready.name },
        });
        liveCell.setState(() => next);
      });
    return () => {
      gone = true;
      liveCell.setState(() => null);
      next?.destroy();
    };
  }, [liveCell, modules, game, ready, settled, fits]);

  useEffect(() => {
    live?.host.setState((s) => ({ ...s, connection: link.status }));
  }, [live, link.status]);

  // The last Play's recording becomes the loaded run, so its ghost shows after Stop.
  useEffect(() => {
    if (!game || !live) return;
    const show = (recording: RunRecording) => {
      if (!live.replaying()) runStore.setState(() => ({ recording, name: "Last run" }));
    };
    game.on("play:recorded", show);
    return () => game.off("play:recorded", show);
  }, [game, live, runStore]);

  const open = useStore(live?.prefab ?? NO_PREFAB);

  const chrome = useMemo(() => {
    if (!live || !modules || !game) return null;
    return modules.editorChrome({
      ...live.editing(open),
      host: live.host,
      game,
      onPlay: live.play,
      onReplay: live.replay,
      onStop: live.stop,
      onRestart: live.restart,
      rapier: modules.rapier,
      runStore,
      ...(getCanvas ? { canvas: getCanvas } : {}),
      ...(ready
        ? {
            project: {
              session: ready.session,
              doc: ready.name,
              ...(connection?.blobs ? { blobs: connection.blobs } : {}),
            },
          }
        : {}),
    });
  }, [live, modules, game, runStore, getCanvas, open, ready, connection]);

  const on = enabled && loadEditor !== null;
  return {
    chrome,
    status: on ? link.status : null,
    scene: on ? (ready?.id ?? null) : null,
    error: on ? link.error : null,
    registry: applied.registry,
    projectData: applied.projectData,
  };
}
