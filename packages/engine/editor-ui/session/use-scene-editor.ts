import { Store } from "@tanstack/store";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { ProjectSession, UndoneStep } from "../../collab/index";
import {
  projectHistory,
  type EditorStoreState,
  type Ref,
  type SessionHistory,
} from "../../editor/index";
import type { GameInstance, PlayOptions, RapierModule, RunRecording } from "../../index";
import {
  parseDocName,
  SCENE_KIND_NAME,
  type KindRegistry,
  type ProjectId,
  type ProjectRuntimeView,
  type ProjectView,
  type SceneListFlow,
} from "../../project/index";
import type { Registry } from "../../scene/index";
import { reloadOf } from "../connect/project-session";
import {
  assetName,
  useSceneDoc,
  type SceneDocStatus,
  type SceneFallback,
} from "../connect/scene-doc";
import {
  hostPeerColor,
  type EditorHost,
  type EditorNotify,
  type EditorProjectChoice,
  type ProjectBlobs,
  type ProjectConnection,
} from "../host";
import type { Pending } from "../pending/pending";
import {
  editorIdentity,
  openLiveEditor,
  prefabsReady,
  projectRegistry,
  type EditingTarget,
  type EditorHostState,
  type EditorIdentity,
  type LiveEditor,
  type OpenPrefab,
  type ProjectRegistry,
} from "./live-scene-editor";
import type { LoadedRun } from "./loaded-run";
import { useWarmDocs } from "./use-project-session";
import { useStoreValue } from "./use-store-value";

/** The parts of the game the editor's chrome reads and drives. */
export type EditorChromeGame = Pick<
  GameInstance,
  | "getStore"
  | "registry"
  | "router"
  | "pause"
  | "resume"
  | "step"
  | "setTimeScale"
  | "command"
  | "cancel"
  | "pointerWorld"
  | "screenToWorld"
  | "panBy"
  | "zoomAt"
  | "frame"
  | "runtime"
  | "input"
>;

/** The project the open scene belongs to, as the project tree edits it. */
export type EditorProjectLink = {
  session: ProjectSession;
  /** The scene doc the editor has open. */
  doc: string;
  /** The open scene's asset id. */
  scene?: string;
  /** The project's scene list as flow reads it; default empty. */
  flow?: SceneListFlow;
  /**
   * Opens another scene of the project in the editor, in place of this one.
   * `madeFrom` names the scene a new one was made from: an undo that removes
   * the new scene returns the editor there.
   */
  openScene?: (id: string, opts?: { madeFrom?: string }) => void;
  /** Why the editor last switched scenes by itself, for the status bar; null when it didn't. */
  notice?: Store<SceneNotice | null>;
  /** Where dropped files are uploaded; without it the tree takes no files. */
  blobs?: ProjectBlobs;
  /** Viewers: the tree and the licence fields take no edits. */
  readOnly?: boolean;
  /** The host's projects, offered in a switcher when there are two or more. */
  projects?: readonly EditorProjectChoice[];
  onProjectChange?: (id: ProjectId) => void;
};

/** An undo or redo whose step was in another scene switched the editor there. */
export type SceneNotice = { text: string };

/** How long the status bar says why the editor switched scenes. */
export const SCENE_NOTICE_MS = 12_000;

/** What the editor says when the server reset the project and the session opened it again. */
export function reloadNotice(dropped: number): { message: string; description: string } {
  const lost =
    dropped === 1
      ? " One change that hadn't synced was dropped."
      : dropped > 1
        ? ` ${dropped} changes that hadn't synced were dropped.`
        : "";
  return {
    message: "The project was reset on the server",
    description: `The editor reloaded its current state.${lost}`,
  };
}

/** Warns through `notify` each time `connection` reloads its project from the server's state. */
export function useProjectReloadNotice(
  connection: ProjectConnection | null,
  notify: EditorNotify,
): void {
  useEffect(() => {
    if (!connection) return;
    let before = connection.getState();
    return connection.subscribe(() => {
      const next = connection.getState();
      const reload = reloadOf(before, next);
      before = next;
      if (!reload) return;
      const { message, description } = reloadNotice(reload.dropped);
      notify.warning(message, { id: "project-reloaded", description });
    });
  }, [connection, notify]);
}

const NO_FLOW: SceneListFlow = Object.freeze({ start: null, scenes: Object.freeze([]) });

/** Everything the editor's frame and panels are drawn from. */
export type EditorProps = EditingTarget & {
  /** The connection and play state the host keeps. */
  host: Store<EditorHostState>;
  /** The game the editor drives: its camera, its router for keys and pointers, its sim controls. */
  game: EditorChromeGame;
  onPlay: (opts?: PlayOptions) => void;
  /** Plays a recording's input again in place of the keyboard's. */
  onReplay: (recording: RunRecording) => void;
  onStop: () => void;
  /** Rebuilds the play world from the latest doc. */
  onRestart: () => void;
  /** Turns Live in Play on or off; without it the play controls offer no toggle. */
  onLivePlay?: (on: boolean) => void;
  /** Rapier, for the physical checks; null until it has loaded. */
  rapier?: RapierModule | null;
  /** The run loaded into the editor; one is made when absent. */
  runStore?: Store<LoadedRun | null>;
  /** The game's canvas, which takes the active tool's cursor. */
  canvas?: () => HTMLElement | null;
  /** The project the scene belongs to: its tree goes above the outliner. */
  project?: EditorProjectLink;
};

type Loaded = { identity: EditorIdentity; avatarUrl: string | null; rapier: RapierModule | null };

/** Who the editor joined as: its presence user and the host's avatar for them. */
export type EditorSelf = EditorIdentity["user"] & { avatarUrl: string | null };

const NO_PREFAB = new Store<OpenPrefab | null>(null);
// Only `mode` is read from it.
const NOT_EDITING = new Store({ mode: "edit" } as EditorStoreState);

const consoleNotify: EditorNotify = Object.assign(
  (message: string) => console.info(`[editor] ${message}`),
  {
    success: (message: string) => console.info(`[editor] ${message}`),
    warning: (message: string) => console.warn(`[editor] ${message}`),
    error: (message: string) => console.error(`[editor] ${message}`),
  },
);

export type SceneEditorOptions = {
  /**
   * The project connection and who is editing; read once, except `connect`,
   * which runs again when `project` or `registry` changes, and `identity`,
   * read when the editor has loaded, and `onProjectChange`, called as it is now.
   */
  host: Pick<
    EditorHost,
    | "connect"
    | "identity"
    | "peerColor"
    | "notify"
    | "readOnly"
    | "projects"
    | "onProjectChange"
    | "onSceneChange"
  >;
  /** Where notices go when the host has no `notify`: the frame's own toast region. */
  notify?: EditorNotify;
  /** The editor's tasks: opening prefabs, creating variants and reloading art run through it. */
  pending?: Pending;
  /** Built with the `registry` and `projectData` this hook returns; the editor opens once it is. */
  game: GameInstance | null;
  /** The `projectData` `game` was built with (`createGame`'s `project`); default null. */
  builtWith?: ProjectRuntimeView | null;
  project: ProjectId;
  /** The game's code registry; the project session is opened with it. */
  registry: Registry;
  /**
   * The scene to open, by id; the project's first scene when it holds none
   * of that id. A scene opened from the picker replaces it until this changes.
   */
  scene?: string | null;
  enabled: boolean;
  /** The game's Rapier loader, for the editor's physical checks. */
  rapier?: () => Promise<RapierModule>;
  /** The game's canvas, which takes the active tool's cursor. */
  canvas?: () => HTMLElement | null;
};

/**
 * How far an editor that isn't up yet has got: connecting to the project,
 * opening the scene's doc, opening the material, settings, table and prefab
 * docs, then building the game on them.
 */
export type BootPhase = "connecting" | "scene" | "assets" | "game";

export type SceneEditorState = {
  /** What the editor's frame draws, once the scene has synced and the game is up. */
  editor: EditorProps | null;
  /** While there is no `editor` and it isn't `rebuilding`: what it is waiting for. */
  phase: BootPhase | null;
  /** The connection while the editor is on; null when it's off. */
  status: SceneDocStatus | null;
  /** Updates the server hasn't acknowledged yet. */
  unsynced: number;
  /** The id of the scene the editor has open. */
  scene: string | null;
  /** Set while the open scene isn't the one asked for. */
  fellBack: SceneFallback | null;
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
   * game settings and tables, null without one. It changes as `registry` does;
   * while the editor plays, the running game takes the change in place.
   */
  projectData: ProjectRuntimeView | null;
  /** Who the editor joined as, once it has loaded. */
  identity: EditorSelf | null;
  /** True from a change that needs a new game until the editor is open on it. */
  rebuilding: boolean;
  /** What the host's asset loader bundles scenes over while the project is open; null without one. */
  assets: EditorAssets | null;
  /**
   * The switcher's projects while the host offers two or more and a way to
   * open another; set while the editor boots or has failed too, so a project
   * that won't open can still be left.
   */
  projectChoice: EditorProjectChoices | null;
};

/** The host's projects as the Project panel's switcher offers them. */
export type EditorProjectChoices = {
  current: ProjectId;
  projects: readonly EditorProjectChoice[];
  onChange: (id: ProjectId) => void;
};

/** The open project's assets: `view` follows its edits, so read it when bundling, not once. */
export type EditorAssets = { project: ProjectId; view: () => ProjectView; kinds: KindRegistry };

type Build = { registry: Registry; projectData: ProjectRuntimeView | null };

/** What a rebuild carries from the editor it replaces to the next one on the same doc. */
export type Carried = { doc: string; selection: Ref[]; tool: string };

/**
 * The scene editor on the host's project connection, where everyone with
 * the project open edits its scene and prefab docs. A dropped connection
 * resumes the same docs, so the editor stays open through it. When the
 * game has to be rebuilt (the project's materials, settings or tables
 * changed), the next editor keeps the selection that still resolves and
 * the tool.
 */
export function useSceneEditor({
  host,
  notify,
  pending,
  game,
  builtWith = null,
  project,
  registry,
  scene,
  enabled,
  rapier,
  canvas,
}: SceneEditorOptions): SceneEditorState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [liveCell] = useState(() => new Store<LiveEditor | null>(null));
  // Outlives reconnects, so a loaded run stays loaded.
  const [runStore] = useState(() => new Store<LoadedRun | null>(null));
  const [loadRapier] = useState(() => rapier);
  const [getCanvas] = useState(() => canvas);
  const [projectCell] = useState(() => new Store<ProjectConnection | null>(null));
  const [say] = useState(() => notify ?? host.notify ?? consoleNotify);
  const [tasks] = useState(() => pending);
  const [connect] = useState(() => host.connect);
  const [readOnly] = useState(() => host.readOnly);
  const [peerColor] = useState(() => hostPeerColor(host));
  // The switcher shows only for a host that can open another project.
  const [projects] = useState(() =>
    host.onProjectChange && host.projects && host.projects.length > 1 ? host.projects : null,
  );
  const projectChange = useRef(host.onProjectChange);
  const [switchProject] = useState(() => (id: ProjectId) => projectChange.current?.(id));
  const sceneChange = useRef(host.onSceneChange);
  // A host's profile can arrive after the editor mounts; whoever it names once Rapier is in is who joins.
  const identityInput = useRef(host.identity);
  useEffect(() => {
    identityInput.current = host.identity;
    projectChange.current = host.onProjectChange;
    sceneChange.current = host.onSceneChange;
  });
  const carried = useRef<Carried | null>(null);
  const [carrying, setCarrying] = useState(false);
  const projectChoice = useMemo<EditorProjectChoices | null>(
    () => (projects ? { current: project, projects, onChange: switchProject } : null),
    [projects, project, switchProject],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (loadRapier?.().catch(() => null) ?? Promise.resolve(null)).then((rapierModule) => {
      if (cancelled) return;
      const input = identityInput.current;
      setLoaded({
        identity: editorIdentity(input?.name ?? null, peerColor),
        avatarUrl: input?.avatarUrl ?? null,
        rapier: rapierModule,
      });
    });
    return () => {
      cancelled = true;
      setLoaded(null);
    };
  }, [enabled, loadRapier, peerColor]);

  useEffect(() => {
    if (!loaded) return;
    const link = connect({ project, registry, origin: loaded.identity.origin });
    projectCell.setState(() => link);
    return () => {
      projectCell.setState(() => null);
      link.destroy();
    };
  }, [projectCell, loaded, connect, project, registry]);

  const connection = useStoreValue(projectCell);
  useProjectReloadNotice(connection, say);
  const watchConnection = useCallback(
    (listener: () => void) => connection?.subscribe(listener) ?? (() => {}),
    [connection],
  );
  const readUnsynced = () => connection?.getState().unsynced ?? 0;
  const unsynced = useSyncExternalStore(watchConnection, readUnsynced, readUnsynced);
  const readProjectOpen = () => connection?.getState().session != null;
  const projectOpen = useSyncExternalStore(watchConnection, readProjectOpen, readProjectOpen);
  // A scene opened here holds until the host asks for another; a host following it asks for that one.
  const asked = scene ?? null;
  const [picked, setPicked] = useState<{ asked: string | null; id: string } | null>(null);
  const askedRef = useRef(asked);
  const wanted = picked && picked.asked === asked ? picked.id : asked;
  const link = useSceneDoc(connection, wanted);
  const ready = link.ready;
  const session = ready?.session ?? null;
  const keepWarm = useWarmDocs();

  const [notice] = useState(() => new Store<SceneNotice | null>(null));
  const shownNotice = useStoreValue(notice);
  useEffect(() => {
    if (!shownNotice) return;
    const timer = setTimeout(
      () => notice.setState((n) => (n === shownNotice ? null : n)),
      SCENE_NOTICE_MS,
    );
    return () => clearTimeout(timer);
  }, [notice, shownNotice]);
  const opened = useRef<typeof ready>(null);
  useEffect(() => {
    askedRef.current = asked;
    opened.current = ready;
  });
  /** Where each scene was last opened from, and where each new scene was made from. */
  const cameFrom = useRef(new Map<string, string>());
  const madeFrom = useRef(new Map<string, string>());
  // The live session on the open doc closes; the doc stays connected a while, so switching back is quick.
  const [switchTo] = useState(() => (id: string) => {
    const from = opened.current;
    if (id === from?.id) return;
    if (from) {
      keepWarm(from.session, from.name);
      cameFrom.current.set(id, from.id);
    }
    setPicked({ asked: askedRef.current, id });
    sceneChange.current?.(id);
  });
  /** An undo or redo whose step is in another scene: the editor switches there first, then takes it. */
  const deferred = useRef<DeferredStep | null>(null);
  const [openScene] = useState(() => (id: string, opts?: { madeFrom?: string }) => {
    notice.setState(() => null);
    deferred.current = null;
    if (opts?.madeFrom) madeFrom.current.set(id, opts.madeFrom);
    switchTo(id);
  });
  /**
   * After an undo or redo took the open scene away (New scene… undone), the
   * editor goes to the scene it was made from, else the one it came to it
   * from, while that scene is still there.
   */
  const [leaveIfGone] = useState(() => (session: ProjectSession, id: string) => {
    const view = session.view();
    if (view.byId.has(id)) return;
    const back = [madeFrom.current.get(id), cameFrom.current.get(id)].find(
      (other) => other !== undefined && view.byId.get(other)?.kind === SCENE_KIND_NAME,
    );
    if (back) switchTo(back);
  });

  const [overlay, setOverlay] = useState<
    ({ session: ProjectSession; watch: ProjectRegistry } & Build) | null
  >(null);
  useEffect(() => {
    if (!loaded || !session) return;
    const watch = projectRegistry(session);
    let opened = false;
    let gone = false;
    const publish = () => {
      if (opened && !gone)
        setOverlay({
          session,
          watch,
          registry: watch.current(),
          projectData: watch.project?.() ?? null,
        });
    };
    const off = watch.subscribe(publish);
    // Published once every material and prefab doc is open, so the game isn't built twice on the way.
    void Promise.all([watch.ready(), prefabsReady(session).catch(() => {})]).then(() => {
      opened = true;
      publish();
    });
    return () => {
      gone = true;
      off();
      watch.destroy();
      setOverlay(null);
    };
  }, [loaded, session]);
  const current = session !== null && overlay?.session === session ? overlay : null;
  const settled = current !== null;
  const openSession = current?.session ?? null;
  const flow = current?.projectData?.flow ?? NO_FLOW;
  const flowRef = useRef(flow);
  useEffect(() => {
    flowRef.current = flow;
  });
  const assets = useMemo<EditorAssets | null>(
    () =>
      openSession ? { project, view: () => openSession.view(), kinds: openSession.kinds } : null,
    [openSession, project],
  );

  // Re-imported art (only the dev server sends these messages) and, during Play, edited project data reach the running game.
  const watch = current?.watch ?? null;
  useEffect(() => {
    if (!watch || !connection || !game) return;
    return watch.followAssets?.(connection, game, tasks ? { pending: tasks } : {});
  }, [watch, connection, game, tasks]);

  const live = useStoreValue(liveCell);
  const playing = useStoreValue(live?.session.store ?? NOT_EDITING, (s) => s.mode === "play");
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
    if (!loaded || !game || !ready || !settled || !fits) return;
    let next: LiveEditor | null = null;
    let gone = false;
    const titleOf = (scene: { id: string; name: string }) =>
      flowRef.current.scenes.find((e) => e.scene === scene.id)?.title ?? scene.name;
    // A step the peek didn't foresee still opens its scene once taken, and the status bar says so.
    const onUndone = (step: UndoneStep, how: "undo" | "redo") => {
      if (step.refused !== undefined) {
        say(step.refused, {
          description: `${step.label} can't be ${how === "undo" ? "undone" : "redone"}: its asset was deleted from the trash.`,
        });
        return;
      }
      if (step.docs.includes(ready.name)) return;
      const verb = how === "undo" ? "Undid" : "Redid";
      const other = sceneOfStep(ready.session, step.docs);
      if (other) {
        notice.setState(() => ({ text: `${verb} ${step.label} in ${titleOf(other)}` }));
        switchTo(other.id);
        return;
      }
      const where = step.docs
        .filter((d) => d !== ready.session.name)
        .map((d) => assetIdOf(ready.session, d));
      say(`${verb} ${step.label} in ${where.length > 0 ? where.join(", ") : "the project"}`);
    };
    const history = projectHistory(ready.session, ready.name, { onUndone });
    /** Defers a step that lies in another live scene until the editor has opened it. */
    const elsewhere = (how: "undo" | "redo"): boolean => {
      const step = how === "undo" ? ready.session.peekUndo() : ready.session.peekRedo();
      if (!step || step.docs.includes(ready.name)) return false;
      const other = sceneOfStep(ready.session, step.docs);
      if (!other) return false;
      const due: DeferredStep = { doc: other.doc, how, label: step.label, scene: titleOf(other) };
      deferred.current = due;
      notice.setState(() => ({ text: stepNotice(due, "opening") }));
      switchTo(other.id);
      return true;
    };
    const here = (how: "undo" | "redo") => {
      const taken = how === "undo" ? history.undo() : history.redo();
      leaveIfGone(ready.session, ready.id);
      return taken;
    };
    const switching: SessionHistory = {
      ...history,
      undo: () => elsewhere("undo") || here("undo"),
      redo: () => elsewhere("redo") || here("redo"),
    };
    // Opened once the prefab docs are, so the scene's instances resolve from the first frame.
    void prefabsReady(ready.session)
      .catch(() => {})
      .then(() => {
        if (gone) return;
        next = openLiveEditor({
          game,
          doc: ready.doc.doc,
          awareness: ready.doc.awareness,
          name: ready.id,
          identity: loaded.identity,
          notify: say,
          ...(tasks ? { pending: tasks } : {}),
          project: { session: ready.session, doc: ready.name },
          history: switching,
        });
        const kept = carried.current;
        carried.current = null;
        if (kept && kept.doc === ready.name) restore(next, kept);
        liveCell.setState(() => next);
        setCarrying(false);
        const due = deferred.current;
        if (due?.doc === ready.name) {
          deferred.current = null;
          const taken = due.how === "undo" ? next.session.undo() : next.session.redo();
          notice.setState(() => ({ text: stepNotice(due, taken ? "taken" : "failed") }));
        }
      });
    return () => {
      gone = true;
      liveCell.setState(() => null);
      if (next) {
        carried.current = carry(next, ready.name);
        setCarrying(true);
      }
      next?.destroy();
    };
  }, [liveCell, loaded, game, ready, settled, fits, say, tasks, notice, switchTo, leaveIfGone]);

  // A deferred step whose scene didn't open, or opened another in its place, is never taken.
  const switchFailed = link.error !== null || link.status === "failed" || link.fellBack !== null;
  useEffect(() => {
    const due = deferred.current;
    if (!switchFailed || !due) return;
    deferred.current = null;
    notice.setState(() => ({ text: stepNotice(due, "failed") }));
  }, [switchFailed, notice]);

  useEffect(() => {
    live?.host.setState((s) => ({ ...s, connection: link.status }));
  }, [live, link.status]);

  useEffect(() => {
    live?.host.setState((s) => (s.unsynced === unsynced ? s : { ...s, unsynced }));
  }, [live, unsynced]);

  // The last Play's recording becomes the loaded run, so its ghost shows after Stop.
  useEffect(() => {
    if (!game || !live) return;
    const show = (recording: RunRecording) => {
      if (!live.replaying()) runStore.setState(() => ({ recording, name: "Last run" }));
    };
    game.on("play:recorded", show);
    return () => game.off("play:recorded", show);
  }, [game, live, runStore]);

  const open = useStoreValue(live?.prefab ?? NO_PREFAB);

  const editor = useMemo<EditorProps | null>(() => {
    if (!live || !loaded || !game) return null;
    return {
      ...live.editing(open),
      host: live.host,
      game,
      onPlay: live.play,
      onReplay: live.replay,
      onStop: live.stop,
      onRestart: live.restart,
      onLivePlay: live.setLivePlay,
      rapier: loaded.rapier,
      runStore,
      ...(getCanvas ? { canvas: getCanvas } : {}),
      ...(ready
        ? {
            project: {
              session: ready.session,
              doc: ready.name,
              scene: ready.id,
              flow,
              openScene,
              notice,
              ...(connection?.blobs ? { blobs: connection.blobs } : {}),
              ...(readOnly ? { readOnly } : {}),
              ...(projects ? { projects, onProjectChange: switchProject } : {}),
            },
          }
        : {}),
    };
  }, [
    live,
    loaded,
    game,
    runStore,
    getCanvas,
    open,
    ready,
    connection,
    readOnly,
    projects,
    switchProject,
    flow,
    openScene,
    notice,
  ]);

  const self = useMemo<EditorSelf | null>(
    () => (loaded ? { ...loaded.identity.user, avatarUrl: loaded.avatarUrl } : null),
    [loaded],
  );

  const on = enabled;
  const rebuilding = on && (carrying ? ready !== null && live === null : live !== null && !fits);
  const phase: BootPhase | null =
    !on || editor || rebuilding
      ? null
      : !ready
        ? projectOpen && link.status !== "failed"
          ? "scene"
          : "connecting"
        : !settled
          ? "assets"
          : "game";
  return {
    editor,
    phase,
    status: on ? link.status : null,
    unsynced: on ? unsynced : 0,
    scene: on ? (ready?.id ?? null) : null,
    fellBack: on ? link.fellBack : null,
    error: on ? link.error : null,
    registry: applied.registry,
    projectData: applied.projectData,
    identity: on ? self : null,
    rebuilding,
    assets: on ? assets : null,
    projectChoice: on ? projectChoice : null,
  };
}

/** An undo or redo step in another scene, waiting for the editor to open it. */
type DeferredStep = { doc: string; how: "undo" | "redo"; label: string; scene: string };

/** The status bar's word on a deferred step: while its scene opens, once taken, or when it couldn't be. */
export function stepNotice(
  step: Omit<DeferredStep, "doc">,
  stage: "opening" | "taken" | "failed",
): string {
  const { how, label, scene } = step;
  if (stage === "opening") return `Opening ${scene} to ${how} ${label}…`;
  if (stage === "failed") return `Couldn't ${how} ${label} in ${scene}`;
  return `${how === "undo" ? "Undid" : "Redid"} ${label} in ${scene}`;
}

/** A doc's asset id in `session`, else the doc's name. */
function assetIdOf(session: ProjectSession, docName: string): string {
  const ref = parseDocName(docName);
  if (!ref || ref.kind === "project") return docName;
  return session.state().assets[ref.key]?.id ?? ref.key;
}

/** The first live scene among `docs`, with its doc and display name. */
function sceneOfStep(
  session: ProjectSession,
  docs: readonly string[],
): { id: string; doc: string; name: string } | null {
  for (const docName of docs) {
    const ref = parseDocName(docName);
    if (!ref || ref.kind === "project") continue;
    const entry = session.state().assets[ref.key];
    if (entry?.kind === SCENE_KIND_NAME && !entry.deleted)
      return { id: entry.id, doc: docName, name: assetName(entry) };
  }
  return null;
}

export function carry(live: LiveEditor, doc: string): Carried {
  const { selection = [], tool = "select" } = live.session.store.state;
  return { doc, selection: [...selection], tool };
}

/**
 * Puts what `kept` carried on `live`'s session: the refs that still resolve,
 * and the tool, which the frame's tool host then starts on.
 */
export function restore(live: LiveEditor, kept: Carried): void {
  if (kept.selection.length > 0) live.session.select(kept.selection);
  if (kept.tool !== live.session.store.state.tool) {
    live.session.setTool(kept.tool);
    live.session.store.setState((s) => ({ ...s, tool: kept.tool }));
  }
}
