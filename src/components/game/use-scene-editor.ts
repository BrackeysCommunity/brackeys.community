import type { GameInstance, RapierModule, RunRecording } from "@jams/engine";
import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { useEffect, useMemo, useState } from "react";

import type { EditorChrome } from "@/components/game/editor/EditorShell";
import type { LoadedRun } from "@/components/game/editor/loaded-run";
import { activeUserStore } from "@/lib/active-user-store";

import type { EditorIdentity, LiveEditor, OpenPrefab } from "./live-scene-editor";
import { useSceneDoc, type ConnectSceneDoc, type SceneDocStatus } from "./use-scene-doc";

type EditorModules = {
  openLiveEditor: typeof import("./live-scene-editor").openLiveEditor;
  editorChrome: typeof import("@/components/game/editor/EditorShell").editorChrome;
  connect: ConnectSceneDoc;
  identity: EditorIdentity;
  rapier: RapierModule | null;
};

const NO_PREFAB = new Store<OpenPrefab | null>(null);

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
  game: GameInstance | null;
  /** The scene co-edited as `scene:<name>` on the dev server. */
  name: string;
  enabled: boolean;
  /** The game's Rapier loader, for the editor's physical checks. */
  rapier?: () => Promise<RapierModule>;
  /** The game's canvas, which takes the active tool's cursor. */
  canvas?: () => HTMLElement | null;
};

export type SceneEditorState = {
  /** The editor's islands, once the doc has synced and the game is up. */
  chrome: EditorChrome | null;
  /** The connection while the editor is on; null when it's off. */
  status: SceneDocStatus | null;
};

/**
 * The in-game scene editor, in dev builds with `?edit=1`: everyone with the
 * scene open edits one shared doc on the dev server, which writes it back
 * to the scene file. A reconnect that brings a fresh doc reopens the editor
 * on it.
 */
export function useSceneEditor({
  game,
  name,
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
        editorChrome: shell.editorChrome,
        connect: provider.connectSceneDoc,
        identity: liveModule.editorIdentity(profile?.guildNickname ?? profile?.discordUsername),
        rapier: rapierModule,
      });
    });
    return () => {
      cancelled = true;
      setModules(null);
    };
  }, [enabled, loadRapier]);

  const link = useSceneDoc(name, modules?.connect ?? null);
  const ready = link.ready;

  useEffect(() => {
    if (!modules || !game || !ready) return;
    const next = modules.openLiveEditor({
      game,
      doc: ready.doc,
      awareness: ready.awareness,
      name,
      identity: modules.identity,
    });
    liveCell.setState(() => next);
    return () => {
      liveCell.setState(() => null);
      next.destroy();
    };
  }, [liveCell, modules, game, ready, name]);
  const live = useStore(liveCell);

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
    });
  }, [live, modules, game, runStore, getCanvas, open]);

  return { chrome, status: enabled && loadEditor ? link.status : null };
}
